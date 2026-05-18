import type {Host} from "./Host";

export type AxiiErrorCode = 'AXII_DOM_BOUNDARY_BROKEN'

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
    key?: string | number
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
    enabled?: boolean
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
        {
            code,
            phase,
            cause,
            componentStack,
            hostStack,
            reactiveTrace,
            domSnapshot,
            hints,
            docsUrl,
        }: {
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
        this.code = code
        this.phase = phase
        this.cause = cause
        this.componentStack = componentStack
        this.hostStack = hostStack
        this.reactiveTrace = reactiveTrace
        this.domSnapshot = domSnapshot
        this.hints = hints
        this.docsUrl = docsUrl
    }
}

export function configureDiagnostics(config: DiagnosticsConfig) {
    diagnosticsConfig = config
}

export function isAxiiDiagnosticsEnabled() {
    return diagnosticsConfig.enabled ?? (typeof __DEV__ === 'undefined' || __DEV__)
}

export function reportAxiiError(error: unknown) {
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

async function attachCodeFrameToConsole(payload: AxiiOverlayPayload) {
    if (!payload.source) return

    const endpoint = (globalThis as { __AXII_CODE_FRAME_ENDPOINT__?: string }).__AXII_CODE_FRAME_ENDPOINT__
    if (!endpoint || typeof fetch === 'undefined') return

    const codeFrame = await fetchCodeFrame(endpoint, payload.source)
    if (!codeFrame) return

    logAxiiErrorToConsole({
        ...payload,
        codeFrame,
    })
}

function logAxiiErrorToConsole(payload: AxiiOverlayPayload, error?: AxiiError) {
    /* v8 ignore next 20 */
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
    if (reactiveTraceHistory.length > MAX_REACTIVE_TRACE_HISTORY) {
        reactiveTraceHistory = reactiveTraceHistory.slice(-MAX_REACTIVE_TRACE_HISTORY)
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
    const hostStack = collectHostStack(context.ownerHost)
    const componentStack = hostStack.filter(frame => !!frame.componentName)
    const reactiveTrace = collectReactiveTrace()
    return new AxiiError(
        `${detail} (AXII_DOM_BOUNDARY_BROKEN)`,
        {
            code: 'AXII_DOM_BOUNDARY_BROKEN',
            phase: context.operation,
            cause: context.cause,
            componentStack,
            hostStack,
            reactiveTrace,
            domSnapshot: createDomSnapshot(context),
            hints: [
                'Do not remove or move DOM nodes managed by Axii manually.',
                'Check whether a ref callback, effect, or third-party library mutates children inside this range.',
                'If detachStyle is involved, check whether the same nodes are removed while an animation is still running.',
            ],
            docsUrl: 'https://axii.dev/errors/AXII_DOM_BOUNDARY_BROKEN',
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
    return stack.slice().reverse().find(frame => frame.source)?.source
}

function formatSource(source: AxiiSource) {
    return `${source.fileName}:${source.lineNumber}:${source.columnNumber}`
}

function collectReactiveTrace() {
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
        if (node.className) summary.className = node.className
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
