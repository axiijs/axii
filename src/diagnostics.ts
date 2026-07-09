import type {Host} from "./Host";

/**
 * Axii 开发期诊断系统。
 *
 * 设计目标（见 prompt/error-task-1.md）：
 * 1. 把 `can not find nextSibling` 这类 DOM 底层错误翻译成 Axii 语义错误（AxiiError）。
 * 2. 附带组件栈、Host 栈、响应式更新链路和 DOM 现场快照，让错误回到业务代码。
 * 3. 开发环境强诊断，生产环境低成本：诊断逻辑只在 __DEV__ 或显式开启时运行。
 *
 * CAUTION 不能把所有 Host 都统一建模成 `element ... placeholder` 连续区间：
 * AtomHost 首次渲染后 placeholder 脱离 DOM 是合法状态，ComponentHost/FunctionHost
 * 把 DOM 委托给 innerHost，ReusableHost 存在合法的 DocumentFragment 搬移阶段。
 * 因此 assertRangeReachable 只用于 range / reusable-range 两种真实 DOM 区间。
 */

export type AxiiErrorCode = 'AXII_DOM_BOUNDARY_BROKEN' | 'AXII_LIST_ORDER_BROKEN'

export type AxiiErrorPhase = 'render' | 'destroy' | 'insert' | 'move' | 'splice' | 'reorder'

export type AxiiSource = {
    fileName: string
    lineNumber: number
    columnNumber: number
}

export type HostBoundaryKind =
    | 'range'
    | 'single-node'
    | 'delegated'
    | 'list'
    | 'empty'
    | 'reusable-range'

export type HostFrame = {
    type: string
    componentName?: string
    elementPath: number[]
    source?: AxiiSource
}

export type ReactiveTraceFrame = {
    type:
        | 'component-render'
        | 'function-node'
        | 'function-node-recompute'
        | 'static-attr'
        | 'atom-text'
        | 'rx-list-patch'
    operation: string
    hostType: string
    elementPath: number[]
    source?: AxiiSource
    attrName?: string
    method?: string
    // RxList 的 trigger key 可能是 index，也可能是 Symbol(iterate) 之类的内部 key
    key?: PropertyKey
    argvSummary?: string
    createdCount?: number
    deletedCount?: number
    timestamp: number
}

export type NodeSummary = {
    nodeType: number
    name: string
    text?: string
    dataAs?: string
    dataTestId?: string
    dataAxiiHostId?: string
    className?: string
}

export type DomSnapshot = {
    boundaryKind: HostBoundaryKind
    operation: AxiiErrorPhase
    start: NodeSummary
    end: NodeSummary
    startParent?: NodeSummary
    endParent?: NodeSummary
    siblingsBefore: NodeSummary[]
    siblingsAfter: NodeSummary[]
}

export type AxiiOverlayPayload = {
    title: string
    code: AxiiErrorCode
    phase: AxiiErrorPhase
    message: string
    source?: AxiiSource
    sourceText?: string
    codeFrame?: string
    componentStack: HostFrame[]
    hostStack: HostFrame[]
    reactiveTrace: ReactiveTraceFrame[]
    hints: string[]
    docsUrl: string
}

type DiagnosticsConfig = {
    // 是否开启结构化诊断（默认跟随 __DEV__）。关闭后回退到原始低成本错误路径。
    enabled?: boolean
    // 框架内部 report（而非直接向上抛）错误时的回调，可接入 Sentry 等监控。
    // CAUTION 无论 enabled 与否都会被调用：生产环境往往正是需要上报的环境。
    onError?: (error: unknown) => void
}

let diagnosticsConfig: DiagnosticsConfig = {}

export class AxiiError extends Error {
    code: AxiiErrorCode
    phase: AxiiErrorPhase
    cause?: unknown
    componentStack: HostFrame[]
    hostStack: HostFrame[]
    reactiveTrace: ReactiveTraceFrame[]
    domSnapshot: DomSnapshot
    hints: string[]
    docsUrl: string

    constructor(
        message: string,
        detail: {
            code: AxiiErrorCode
            phase: AxiiErrorPhase
            cause?: unknown
            componentStack: HostFrame[]
            hostStack: HostFrame[]
            reactiveTrace: ReactiveTraceFrame[]
            domSnapshot: DomSnapshot
            hints: string[]
            docsUrl: string
        }
    ) {
        super(message)
        this.name = 'AxiiError'
        this.code = detail.code
        this.phase = detail.phase
        this.cause = detail.cause
        this.componentStack = detail.componentStack
        this.hostStack = detail.hostStack
        this.reactiveTrace = detail.reactiveTrace
        this.domSnapshot = detail.domSnapshot
        this.hints = detail.hints
        this.docsUrl = detail.docsUrl
    }
}

export function configureDiagnostics(config: DiagnosticsConfig) {
    diagnosticsConfig = config
}

export function isAxiiDiagnosticsEnabled() {
    return diagnosticsConfig.enabled ?? (typeof __DEV__ === 'undefined' || __DEV__)
}

/**
 * 框架内部无法直接向上抛（例如响应式 patch、异步删除）的错误统一从这里出去：
 * 结构化打印 + 用户 onError 回调。onError 抛错不能掩盖原始错误，所以要吞掉。
 */
export function reportAxiiError(error: unknown) {
    if (diagnosticsConfig.onError) {
        try {
            diagnosticsConfig.onError(error)
        } catch (hookError) {
            /* v8 ignore next 3 */
            if (typeof console !== 'undefined') {
                console.error(hookError)
            }
        }
    }

    if (error instanceof AxiiError && isAxiiDiagnosticsEnabled()) {
        const payload = createAxiiOverlayPayload(error)
        logAxiiErrorToConsole(payload, error)
        void attachCodeFrameToConsole(payload)
    } else {
        /* v8 ignore next 3 */
        if (typeof console !== 'undefined') {
            console.error(error)
        }
    }
}

export function createAxiiOverlayPayload(error: AxiiError): AxiiOverlayPayload {
    const source = findMostSpecificSource(error.hostStack) ?? findMostSpecificSource(error.componentStack)
    return {
        title: `${error.code} during ${error.phase}`,
        code: error.code,
        phase: error.phase,
        message: error.message,
        source,
        sourceText: source && formatSource(source),
        componentStack: error.componentStack,
        hostStack: error.hostStack,
        reactiveTrace: error.reactiveTrace,
        hints: error.hints,
        docsUrl: error.docsUrl,
    }
}

/**
 * 手动调试用 overlay。CAUTION 错误报告默认只走 console，不自动覆盖页面：
 * 页面上的错误现场（DOM 停在什么状态）本身就是重要的诊断信息。
 */
export function showAxiiDevOverlay(errorOrPayload: AxiiError | AxiiOverlayPayload): HTMLElement {
    const payload = errorOrPayload instanceof AxiiError
        ? createAxiiOverlayPayload(errorOrPayload)
        : errorOrPayload
    dismissAxiiDevOverlay()

    const overlay = document.createElement('div')
    overlay.id = 'axii-dev-overlay'
    overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'background:rgba(15,23,42,.92)',
        'color:#f8fafc',
        'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
        'padding:32px',
        'overflow:auto',
        'white-space:pre-wrap',
    ].join(';')

    const title = document.createElement('h1')
    title.textContent = payload.title
    overlay.appendChild(title)

    const message = document.createElement('pre')
    message.textContent = [
        payload.message,
        payload.sourceText ? `\nSource: ${payload.sourceText}` : '',
        payload.codeFrame ? `\n\n${payload.codeFrame}` : '',
        payload.reactiveTrace.length ? `\nReactive update:\n${formatReactiveTrace(payload.reactiveTrace)}` : '',
        payload.hints.length ? `\nHints:\n${payload.hints.map(hint => `- ${hint}`).join('\n')}` : '',
        `\nDocs: ${payload.docsUrl}`,
    ].join('')
    overlay.appendChild(message)

    document.body.appendChild(overlay)
    return overlay
}

export function dismissAxiiDevOverlay() {
    document.getElementById('axii-dev-overlay')?.remove()
}

/**
 * code frame 是异步获取的，不能阻塞第一次错误输出；这里在拿到后补一条带 code frame 的分组。
 * CAUTION 诊断系统自己绝不能产生 unhandled rejection，所有异常都要就地收敛。
 */
async function attachCodeFrameToConsole(payload: AxiiOverlayPayload) {
    try {
        if (!payload.source) return

        const endpoint = (globalThis as { __AXII_CODE_FRAME_ENDPOINT__?: string }).__AXII_CODE_FRAME_ENDPOINT__
        if (!endpoint || typeof fetch === 'undefined' || typeof location === 'undefined') return

        const codeFrame = await fetchCodeFrame(endpoint, payload.source)
        if (!codeFrame) return

        logAxiiErrorToConsole({
            ...payload,
            codeFrame,
        })
        /* v8 ignore next 2 */
    } catch {
        // code frame 只是锦上添花，获取失败不产生新的错误噪音
    }
}

function logAxiiErrorToConsole(payload: AxiiOverlayPayload, error?: AxiiError) {
    /* v8 ignore next */
    if (typeof console === 'undefined') return

    const title = `[Axii] ${payload.title}`
    const body = [
        payload.message,
        payload.sourceText ? `Source: ${payload.sourceText}` : '',
        payload.codeFrame ?? '',
        payload.reactiveTrace.length ? `Reactive update:\n${formatReactiveTrace(payload.reactiveTrace)}` : '',
        payload.hints.length ? `Hints:\n${payload.hints.map(hint => `- ${hint}`).join('\n')}` : '',
        `Docs: ${payload.docsUrl}`,
    ].filter(Boolean).join('\n\n')

    if (console.groupCollapsed) {
        console.groupCollapsed(title)
        if (error) console.error(error)
        console.info(body)
        console.info('Component stack', payload.componentStack)
        console.info('Host stack', payload.hostStack)
        console.info('DOM snapshot', error?.domSnapshot)
        console.groupEnd()
    } else {
        console.error(`${title}\n${body}`)
        if (error) console.error(error)
    }
}

async function fetchCodeFrame(endpoint: string, source: AxiiSource) {
    const url = new URL(endpoint, location.origin)
    url.searchParams.set('file', source.fileName)
    url.searchParams.set('line', String(source.lineNumber))
    url.searchParams.set('column', String(source.columnNumber))
    const response = await fetch(url)
    if (!response.ok) return undefined
    return response.text()
}

export type RangeBoundaryContext = {
    ownerHost?: Host
    start: ChildNode
    end: ChildNode
    boundaryKind?: Extract<HostBoundaryKind, 'range' | 'reusable-range'>
    operation: AxiiErrorPhase
    cause?: unknown
}

const MAX_REACTIVE_TRACE_HISTORY = 20
let reactiveTraceStack: ReactiveTraceFrame[] = []
let reactiveTraceHistory: ReactiveTraceFrame[] = []

export function recordReactiveTrace(frame: Omit<ReactiveTraceFrame, 'timestamp'>) {
    if (!isAxiiDiagnosticsEnabled()) return undefined
    const frameWithTime = {
        ...frame,
        timestamp: Date.now(),
    }
    reactiveTraceHistory.push(frameWithTime)
    // CAUTION 用 shift 而不是 slice 维持上限，响应式更新高频发生，避免每次都重新分配数组
    if (reactiveTraceHistory.length > MAX_REACTIVE_TRACE_HISTORY) {
        reactiveTraceHistory.shift()
    }
    return frameWithTime
}

export function withReactiveTrace<T>(frame: Omit<ReactiveTraceFrame, 'timestamp'>, fn: () => T): T {
    const frameWithTime = recordReactiveTrace(frame)
    if (!frameWithTime) return fn()
    reactiveTraceStack.push(frameWithTime)
    try {
        return fn()
    } finally {
        reactiveTraceStack.pop()
    }
}

export function getRecentReactiveTrace() {
    return reactiveTraceHistory.slice()
}

export function clearReactiveTrace() {
    reactiveTraceStack = []
    reactiveTraceHistory = []
}

/**
 * 校验 `start ... end` 是一段连续的 DOM 兄弟区间。
 * 只适用于 range / reusable-range 边界（StaticHost、StaticArrayHost、PrimitiveHost、ReusableHost 搬移）。
 * 在真正破坏性的 DOM 操作之前调用，避免删到一半才暴露底层错误。
 */
export function assertRangeReachable(context: RangeBoundaryContext) {
    if (context.start.parentNode !== context.end.parentNode) {
        throw createDomBoundaryError(
            context,
            'Axii DOM boundary is broken: start and placeholder do not share the same parent.'
        )
    }

    let pointer: ChildNode | null = context.start
    while (pointer && pointer !== context.end) {
        pointer = pointer.nextSibling
    }

    if (!pointer) {
        throw createDomBoundaryError(
            context,
            'Axii DOM boundary is broken: start can not reach placeholder through nextSibling.'
        )
    }
}

export function createDomBoundaryError(context: RangeBoundaryContext, detail: string) {
    return createStructureError('AXII_DOM_BOUNDARY_BROKEN', context, detail, [
        'Do not remove or move DOM nodes managed by Axii manually.',
        'Check whether a ref callback, effect, or third-party library mutates children inside this range.',
        'If detachStyle is involved, check whether the same nodes are removed while an animation is still running.',
    ])
}

/**
 * RxListHost 的列表不变量（hosts 数与 data 数一致、行区间在 DOM 中按数组顺序排列）
 * 被破坏时的结构化错误。这类破坏意味着「数据与 DOM 已经静默错位」——
 * 没有这个校验的话它不会抛任何错，只会一直渲染错的顺序。
 */
export function createListOrderError(context: RangeBoundaryContext, detail: string) {
    return createStructureError('AXII_LIST_ORDER_BROKEN', context, detail, [
        'The rendered DOM order of this RxList no longer matches list.data.',
        'Check for out-of-contract RxList usage (e.g. set() with an out-of-range index creating a sparse list).',
        'Check whether external code moved or removed row nodes managed by Axii.',
    ])
}

function createStructureError(code: AxiiErrorCode, context: RangeBoundaryContext, detail: string, hints: string[]) {
    const hostStack = collectHostStack(context.ownerHost)
    const componentStack = hostStack.filter(frame => !!frame.componentName)
    const reactiveTrace = collectReactiveTrace()
    return new AxiiError(
        `${detail} (${code})`,
        {
            code,
            phase: context.operation,
            cause: context.cause,
            componentStack,
            hostStack,
            reactiveTrace,
            domSnapshot: createDomSnapshot(context),
            hints,
            docsUrl: `https://axii.dev/errors/${code}`,
        }
    )
}

function collectHostStack(ownerHost?: Host): HostFrame[] {
    const frames: HostFrame[] = []
    const hostPath = ownerHost?.pathContext.hostPath
    let current = hostPath ?? null
    while (current) {
        frames.unshift(createHostFrame(current.node))
        current = current.prev
    }
    // hostPath 记录的是「父级路径」，ownerHost 自己不在其中时要补到栈顶
    if (ownerHost && hostPath?.node !== ownerHost) frames.push(createHostFrame(ownerHost))
    return frames
}

function createHostFrame(host: Host): HostFrame {
    const componentName = getComponentName(host)
    const frame: HostFrame = {
        type: host.constructor.name,
        elementPath: host.pathContext.elementPath,
    }
    if (componentName) frame.componentName = componentName
    const source = getHostSource(host)
    if (source) frame.source = source
    return frame
}

function getComponentName(host: Host) {
    const type = (host as unknown as { type?: { name?: string } }).type
    return type?.name
}

export function getAxiiSource(source: unknown): AxiiSource | undefined {
    return (source as { __axiiSource?: AxiiSource } | undefined)?.__axiiSource
}

function getHostSource(host: Host): AxiiSource | undefined {
    return host.pathContext.debugSource ?? getAxiiSource((host as unknown as { source?: unknown }).source)
}

function findMostSpecificSource(stack: HostFrame[]): AxiiSource | undefined {
    for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].source) return stack[i].source
    }
    return undefined
}

function formatSource(source: AxiiSource) {
    return `${source.fileName}:${source.lineNumber}:${source.columnNumber}`
}

function collectReactiveTrace() {
    // 正在进行的 trace（stack）优先，最近历史随后，去重
    const seen = new Set<ReactiveTraceFrame>()
    const frames = reactiveTraceStack.concat(reactiveTraceHistory.slice(-5))
    return frames.filter(frame => {
        if (seen.has(frame)) return false
        seen.add(frame)
        return true
    })
}

function formatReactiveTrace(trace: ReactiveTraceFrame[]) {
    return trace.map((frame, index) => {
        const details = [
            frame.attrName && `attr=${frame.attrName}`,
            frame.method && `method=${frame.method}`,
            frame.key !== undefined && `key=${String(frame.key)}`,
            frame.argvSummary && `args=${frame.argvSummary}`,
            frame.createdCount !== undefined && `created=${frame.createdCount}`,
            frame.deletedCount !== undefined && `deleted=${frame.deletedCount}`,
        ].filter(Boolean).join(' ')
        return `${index + 1}. ${frame.hostType}.${frame.operation}${details ? ` (${details})` : ''}`
    }).join('\n')
}

const MAX_ARGV_SUMMARY_ITEMS = 5

/**
 * 安全摘要：错误报告里绝不完整 dump 用户数据（可能巨大，也可能敏感），
 * 对象只显示构造器名，超长参数列表截断。
 */
export function summarizeArgv(argv: unknown[]) {
    const summarized = argv.slice(0, MAX_ARGV_SUMMARY_ITEMS).map(summarizeArg)
    if (argv.length > MAX_ARGV_SUMMARY_ITEMS) {
        summarized.push(`…(+${argv.length - MAX_ARGV_SUMMARY_ITEMS} more)`)
    }
    return summarized.join(',')
}

function summarizeArg(arg: unknown) {
    if (arg && typeof arg === 'object') return Object.getPrototypeOf(arg)?.constructor?.name ?? 'object'
    if (typeof arg === 'function') return arg.name ? `function ${arg.name}` : 'function'
    return String(arg)
}

function createDomSnapshot(context: RangeBoundaryContext): DomSnapshot {
    return {
        boundaryKind: context.boundaryKind ?? 'range',
        operation: context.operation,
        start: summarizeNode(context.start),
        end: summarizeNode(context.end),
        startParent: summarizeParent(context.start),
        endParent: summarizeParent(context.end),
        siblingsBefore: summarizeSiblings(context.start, -2),
        siblingsAfter: summarizeSiblings(context.start, 2),
    }
}

function summarizeParent(node: ChildNode) {
    const parent = node.parentNode
    return parent ? summarizeNode(parent) : undefined
}

function summarizeSiblings(node: ChildNode, count: number): NodeSummary[] {
    const parent = node.parentNode
    if (!parent) return []

    const siblings = Array.from(parent.childNodes)
    const index = siblings.indexOf(node)
    const start = count < 0 ? Math.max(0, index + count) : index + 1
    const end = count < 0 ? index : index + 1 + count
    return siblings.slice(start, end).map(summarizeNode)
}

function summarizeNode(node: Node): NodeSummary {
    if (node instanceof Element) {
        const summary: NodeSummary = {
            nodeType: node.nodeType,
            name: node.tagName.toLowerCase(),
        }
        const dataAs = node.getAttribute('data-as')
        if (dataAs) summary.dataAs = dataAs
        const dataTestId = node.getAttribute('data-testid')
        if (dataTestId) summary.dataTestId = dataTestId
        const dataAxiiHostId = node.getAttribute('data-axii-host-id')
        if (dataAxiiHostId) summary.dataAxiiHostId = dataAxiiHostId
        // CAUTION SVGElement 的 className 是 SVGAnimatedString 对象，必须走 attribute
        const className = node.getAttribute('class')
        if (className) summary.className = className
        return summary
    }

    if (node instanceof Text) {
        return {
            nodeType: node.nodeType,
            name: '#text',
            text: node.textContent!,
        }
    }

    if (node instanceof Comment) {
        return {
            nodeType: node.nodeType,
            name: '#comment',
            text: node.textContent!,
        }
    }

    return {
        nodeType: node.nodeType,
        name: node.nodeName,
    }
}
