/** @jsx createElement */
import {
    AxiiError,
    assertRangeReachable,
    clearReactiveTrace,
    configureDiagnostics,
    createAxiiOverlayPayload,
    createElement,
    createHost,
    createRoot,
    dismissAxiiDevOverlay,
    type ComponentNode,
    type ExtendedElement,
    jsx,
    jsxDEV,
    jsxs,
    recordReactiveTrace,
    reportAxiiError,
    showAxiiDevOverlay,
    getRecentReactiveTrace,
    summarizeArgv,
    withReactiveTrace,
    type AxiiSource,
    type Host,
    type PathContext,
    RxList,
    atom,
} from "@framework";
import {axiiDevtools, createCodeFrame, createCodeFrameMiddleware} from "../src/vitePlugin.js";
import {ReusableHost} from "../src/ComponentHost.js";
import {beforeEach, describe, expect, test, vi} from "vitest";

function captureError(fn: () => void) {
    try {
        fn()
    } catch (error) {
        return error
    }
    throw new Error('Expected function to throw')
}

describe('error handling examples', () => {
    let root: ReturnType<typeof createRoot>
    let rootEl: HTMLElement

    beforeEach(() => {
        configureDiagnostics({})
        clearReactiveTrace()
        document.body.innerHTML = ''
        rootEl = document.createElement('div')
        document.body.appendChild(rootEl)
        root = createRoot(rootEl)
    })

    test('turns a broken DOM boundary into an AxiiError', () => {
        const host = root.render([
            <span>first</span>,
            <span>second</span>,
        ] as unknown as JSX.Element)

        const rootPlaceholder = Array.from(rootEl.childNodes).find(
            node => node.nodeType === Node.COMMENT_NODE && node.textContent === 'root'
        )!

        rootEl.insertBefore(rootPlaceholder, rootEl.firstChild)

        expect(() => host.destroy()).toThrow(AxiiError)

        const error = captureError(() => host.destroy())
        expect(error).toBeInstanceOf(AxiiError)
        const axiiError = error as AxiiError
        expect(axiiError.code).toBe('AXII_DOM_BOUNDARY_BROKEN')
        expect(axiiError.phase).toBe('destroy')
        expect(axiiError.message).toContain('start can not reach placeholder through nextSibling')
        expect(axiiError.hostStack.at(-1)?.type).toBe('StaticArrayHost')
        expect(axiiError.domSnapshot.boundaryKind).toBe('range')
        expect(axiiError.domSnapshot.start.name).toBe('span')
        expect(axiiError.domSnapshot.end.text).toBe('root')
        expect(axiiError.hints[0]).toContain('Do not remove or move DOM nodes managed by Axii manually')
        expect(axiiError.docsUrl).toContain('AXII_DOM_BOUNDARY_BROKEN')
        const payload = createAxiiOverlayPayload(axiiError)
        expect(payload.source).toBeUndefined()
        expect(payload.sourceText).toBeUndefined()
        expect(showAxiiDevOverlay(axiiError).textContent).not.toContain('Source:')
        axiiError.hints = []
        expect(showAxiiDevOverlay(axiiError).textContent).not.toContain('Hints:')
        dismissAxiiDevOverlay()
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
        const consoleGroup = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
        const consoleGroupEnd = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
        reportAxiiError(axiiError)
        expect(document.getElementById('axii-dev-overlay')).toBeNull()
        expect(consoleGroup).toHaveBeenCalledWith('[Axii] AXII_DOM_BOUNDARY_BROKEN during destroy')
        expect(consoleError).toHaveBeenCalledWith(axiiError)
        expect(consoleInfo.mock.calls[0][0]).not.toContain('Source:')
        expect(consoleGroupEnd).toHaveBeenCalled()
        consoleGroupEnd.mockRestore()
        consoleGroup.mockRestore()
        consoleInfo.mockRestore()
        consoleError.mockRestore()
    })

    test('can disable structured diagnostics for low cost production removal', () => {
        configureDiagnostics({enabled: false})
        const host = root.render([
            <span>first</span>,
            <span>second</span>,
        ] as unknown as JSX.Element)

        const rootPlaceholder = Array.from(rootEl.childNodes).find(
            node => node.nodeType === Node.COMMENT_NODE && node.textContent === 'root'
        )!
        rootEl.insertBefore(rootPlaceholder, rootEl.firstChild)

        const error = captureError(() => host.destroy())
        expect(error).not.toBeInstanceOf(AxiiError)
        expect((error as Error).message).toBe('can not find nextSibling')
    })

    test('invokes the configured onError hook for reported errors, even with diagnostics disabled', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        const seen: unknown[] = []
        configureDiagnostics({
            enabled: false,
            onError(error) {
                seen.push(error)
            },
        })

        const axiiError = new AxiiError('boundary broken in production', {
            code: 'AXII_DOM_BOUNDARY_BROKEN',
            phase: 'destroy',
            componentStack: [],
            hostStack: [],
            reactiveTrace: [],
            domSnapshot: {
                boundaryKind: 'range',
                operation: 'destroy',
                start: {nodeType: Node.TEXT_NODE, name: '#text', text: 'start'},
                end: {nodeType: Node.COMMENT_NODE, name: '#comment', text: 'end'},
                siblingsBefore: [],
                siblingsAfter: [],
            },
            hints: [],
            docsUrl: 'https://axii.dev/errors/AXII_DOM_BOUNDARY_BROKEN',
        })
        const plainError = new Error('plain')

        // 诊断关闭时不做结构化 console 报告，但 onError（生产可观测性）仍要触发
        reportAxiiError(axiiError)
        reportAxiiError(plainError)
        expect(seen).toEqual([axiiError, plainError])
        expect(consoleError).toHaveBeenCalledWith(axiiError)
        expect(consoleError).toHaveBeenCalledWith(plainError)

        // onError 自己抛错时不能掩盖原始错误
        consoleError.mockClear()
        configureDiagnostics({
            enabled: false,
            onError() {
                throw new Error('broken hook')
            },
        })
        reportAxiiError(plainError)
        expect(consoleError.mock.calls.some(call => (call[0] as Error)?.message === 'broken hook')).toBe(true)
        expect(consoleError).toHaveBeenCalledWith(plainError)
        consoleError.mockRestore()
    })

    test('carries JSX dev source into component and host frames', async () => {
        function App() {
            return jsxDEV(
                'div',
                {children: 'hello'},
                undefined,
                false,
                divSource,
                undefined
            )
        }

        const appSource: AxiiSource = {
            fileName: '/src/App.tsx',
            lineNumber: 10,
            columnNumber: 8,
        }
        const divSource: AxiiSource = {
            fileName: '/src/App.tsx',
            lineNumber: 11,
            columnNumber: 12,
        }
        const host = root.render(jsxDEV(
            App,
            {},
            undefined,
            false,
            appSource,
            undefined
        ) as JSX.Element)

        const rootPlaceholder = Array.from(rootEl.childNodes).find(
            node => node.nodeType === Node.COMMENT_NODE && node.textContent === 'root'
        )!
        rootEl.insertBefore(rootPlaceholder, rootEl.firstChild)

        const thrownError = captureError(() => host.destroy())
        expect(thrownError).toBeInstanceOf(AxiiError)
        const axiiError = thrownError as AxiiError
        expect(axiiError.componentStack).toEqual([
            {
                type: 'ComponentHost',
                componentName: 'App',
                elementPath: [],
                source: appSource,
            },
        ])
        expect(axiiError.hostStack.at(-1)).toEqual({
            type: 'StaticHost',
            elementPath: [],
            source: divSource,
        })
        const payload = createAxiiOverlayPayload(axiiError)
        expect(payload).toMatchObject({
            title: 'AXII_DOM_BOUNDARY_BROKEN during destroy',
            code: 'AXII_DOM_BOUNDARY_BROKEN',
            phase: 'destroy',
            source: divSource,
            sourceText: '/src/App.tsx:11:12',
        })

        const overlay = showAxiiDevOverlay(axiiError)
        expect(overlay.id).toBe('axii-dev-overlay')
        expect(overlay.textContent).toContain('AXII_DOM_BOUNDARY_BROKEN during destroy')
        expect(overlay.textContent).toContain('Source: /src/App.tsx:11:12')
        dismissAxiiDevOverlay()
        expect(document.getElementById('axii-dev-overlay')).toBeNull()

        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
        const consoleGroup = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
        const consoleGroupEnd = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
        const originalFetch = globalThis.fetch
        const codeFrame = '> 11 |     <div>hello</div>\n     |            ^'

        reportAxiiError(axiiError)
        expect(document.getElementById('axii-dev-overlay')).toBeNull()
        expect(consoleInfo.mock.calls.some(call => String(call[0]).includes('Source: /src/App.tsx:11:12'))).toBe(true)

        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            text: () => Promise.resolve(''),
        } as Response)
        ;(globalThis as { __AXII_CODE_FRAME_ENDPOINT__?: string }).__AXII_CODE_FRAME_ENDPOINT__ = '/__axii/code-frame'
        reportAxiiError(axiiError)
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(document.getElementById('axii-dev-overlay')).toBeNull()
        expect(consoleInfo.mock.calls.some(call => String(call[0]).includes(codeFrame))).toBe(false)

        // code frame 请求失败（网络错误）时，诊断系统自身不能产生 unhandled rejection
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'))
        reportAxiiError(axiiError)
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(consoleInfo.mock.calls.some(call => String(call[0]).includes(codeFrame))).toBe(false)

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(codeFrame),
        } as Response)
        globalThis.fetch = fetchMock
        reportAxiiError(axiiError)
        await vi.waitFor(() => {
            expect(consoleInfo.mock.calls.some(call => String(call[0]).includes(codeFrame))).toBe(true)
        })
        expect(document.getElementById('axii-dev-overlay')).toBeNull()
        expect(fetchMock.mock.calls[0][0].toString()).toContain('/__axii/code-frame?file=%2Fsrc%2FApp.tsx&line=11&column=12')
        expect(consoleError).toHaveBeenCalledWith(axiiError)
        delete (globalThis as { __AXII_CODE_FRAME_ENDPOINT__?: string }).__AXII_CODE_FRAME_ENDPOINT__
        globalThis.fetch = originalFetch
        consoleGroupEnd.mockRestore()
        consoleGroup.mockRestore()
        consoleInfo.mockRestore()
        consoleError.mockRestore()
    })

    test('supports console fallback paths without mutating the page', () => {
        const plainError = new Error('plain error')
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

        reportAxiiError(plainError)

        expect(consoleError).toHaveBeenCalledWith(plainError)

        const payload = createAxiiOverlayPayload(new AxiiError('manual payload', {
            code: 'AXII_DOM_BOUNDARY_BROKEN',
            phase: 'destroy',
            componentStack: [],
            hostStack: [],
            reactiveTrace: [],
            domSnapshot: {
                boundaryKind: 'range',
                operation: 'destroy',
                start: {nodeType: Node.TEXT_NODE, name: '#text', text: 'start'},
                end: {nodeType: Node.COMMENT_NODE, name: '#comment', text: 'end'},
                siblingsBefore: [],
                siblingsAfter: [],
            },
            hints: [],
            docsUrl: 'https://axii.dev/errors/AXII_DOM_BOUNDARY_BROKEN',
        }))
        payload.codeFrame = '> 1 | start'
        expect(showAxiiDevOverlay(payload).textContent).toContain('manual payload')
        expect(document.getElementById('axii-dev-overlay')?.textContent).toContain('> 1 | start')
        dismissAxiiDevOverlay()

        const originalGroupCollapsed = console.groupCollapsed
        const originalGroupEnd = console.groupEnd
        console.groupCollapsed = undefined as unknown as typeof console.groupCollapsed
        console.groupEnd = undefined as unknown as typeof console.groupEnd
        reportAxiiError(new AxiiError('fallback payload', {
            code: 'AXII_DOM_BOUNDARY_BROKEN',
            phase: 'destroy',
            componentStack: [],
            hostStack: [],
            reactiveTrace: [],
            domSnapshot: {
                boundaryKind: 'range',
                operation: 'destroy',
                start: {nodeType: Node.TEXT_NODE, name: '#text', text: 'start'},
                end: {nodeType: Node.COMMENT_NODE, name: '#comment', text: 'end'},
                siblingsBefore: [],
                siblingsAfter: [],
            },
            hints: [],
            docsUrl: 'https://axii.dev/errors/AXII_DOM_BOUNDARY_BROKEN',
        }))
        expect(consoleError.mock.calls.some(call => String(call[0]).includes('[Axii] AXII_DOM_BOUNDARY_BROKEN during destroy'))).toBe(true)
        console.groupCollapsed = originalGroupCollapsed
        console.groupEnd = originalGroupEnd
        consoleError.mockRestore()
    })

    test('stores JSX dev source on DOM nodes, component nodes, and lifted dynamic children', () => {
        const parentSource: AxiiSource = {
            fileName: '/src/Parent.tsx',
            lineNumber: 20,
            columnNumber: 4,
        }
        const childSource: AxiiSource = {
            fileName: '/src/Child.tsx',
            lineNumber: 21,
            columnNumber: 8,
        }

        function Child() {
            return null
        }

        const childNode = jsxDEV(
            Child,
            {children: []},
            undefined,
            false,
            childSource,
            undefined
        ) as ComponentNode
        expect(childNode.__axiiSource).toBe(childSource)
        expect(childNode.props.__source).toBeUndefined()
        expect(childNode.props.__self).toBeUndefined()

        const dynamicChild = () => jsx('span', {children: 'dynamic'})
        const container = jsxDEV(
            'div',
            {
                style: () => ({color: 'red'}),
                children: [
                    jsxs('section', {
                        children: [
                            dynamicChild,
                        ],
                    }),
                ],
            },
            undefined,
            false,
            parentSource,
            {debugSelf: true}
        ) as ExtendedElement

        expect(container.__axiiSource).toBe(parentSource)
        expect(container.unhandledAttr).toEqual([
            {
                el: container,
                key: 'style',
                value: expect.any(Function),
                path: [],
                source: parentSource,
            },
        ])
        expect(container.unhandledChildren).toEqual([
            {
                placeholder: expect.any(Comment),
                child: dynamicChild,
                path: [0, 0],
                source: parentSource,
            },
        ])
    })

    test('provides a Vite plugin that enables JSX dev source metadata in dev server only', () => {
        expect(axiiDevtools()).toEqual({
            name: 'axii-devtools',
            enforce: 'pre',
            apply: 'serve',
            config: expect.any(Function),
            configureServer: expect.any(Function),
            transformIndexHtml: expect.any(Function),
        })
        expect(axiiDevtools().config()).toEqual({
            esbuild: {
                jsxDev: true,
            },
        })
        expect(axiiDevtools().transformIndexHtml()).toEqual([{
            tag: 'script',
            attrs: {
                type: 'module',
            },
            children: 'globalThis.__AXII_CODE_FRAME_ENDPOINT__="/__axii/code-frame";',
            injectTo: 'head',
        }])
        expect(createCodeFrame('one\ntwo\nthree', 2, 2, 1)).toBe([
            '  1 | one',
            '> 2 | two',
            '    |  ^',
            '  3 | three',
        ].join('\n'))
    })

    test('serves Vite code frames through the middleware', async () => {
        const response = {
            statusCode: 200,
            headers: {} as Record<string, string>,
            body: undefined as string | undefined,
            setHeader(name: string, value: string) {
                this.headers[name] = value
            },
            end(body?: string) {
                this.body = body
            },
        }

        await createCodeFrameMiddleware(async () => 'one\ntwo\nthree')(
            {url: '?file=/tmp/App.tsx&line=2&column=2'},
            response
        )

        expect(response.statusCode).toBe(200)
        expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8')
        expect(response.body).toContain('> 2 | two')

        const badRequest = {...response, statusCode: 200, body: undefined}
        await createCodeFrameMiddleware(async () => 'one')(
            {url: '?file=/tmp/App.tsx&line=bad&column=2'},
            badRequest
        )
        expect(badRequest.statusCode).toBe(400)
        expect(badRequest.body).toBe('Missing file, line, or column')

        const missingRequest = {...response, statusCode: 200, body: undefined}
        await createCodeFrameMiddleware(async () => 'one')(
            {},
            missingRequest
        )
        expect(missingRequest.statusCode).toBe(400)
        expect(missingRequest.body).toBe('Missing file, line, or column')

        const failed = {...response, statusCode: 200, body: undefined}
        await createCodeFrameMiddleware(async () => {
            throw new Error('read failed')
        })(
            {url: '?file=/tmp/App.tsx&line=1&column=1'},
            failed
        )
        expect(failed.statusCode).toBe(500)
        expect(failed.body).toBe('read failed')

        const failedWithUnknown = {...response, statusCode: 200, body: undefined}
        await createCodeFrameMiddleware(async () => {
            throw 'unknown failure'
        })(
            {url: '?file=/tmp/App.tsx&line=1&column=1'},
            failedWithUnknown
        )
        expect(failedWithUnknown.statusCode).toBe(500)
        expect(failedWithUnknown.body).toBe('unknown failure')
    })

    test('restricts code frame reads to the project root', async () => {
        const readFile = vi.fn(async () => 'secret')
        const makeResponse = () => ({
            statusCode: 200,
            headers: {} as Record<string, string>,
            body: undefined as string | undefined,
            setHeader(name: string, value: string) {
                this.headers[name] = value
            },
            end(body?: string) {
                this.body = body
            },
        })

        const middleware = createCodeFrameMiddleware(readFile, '/home/me/project')

        const outsideRoot = makeResponse()
        await middleware({url: '?file=/etc/passwd&line=1&column=1'}, outsideRoot)
        expect(outsideRoot.statusCode).toBe(403)
        expect(readFile).not.toHaveBeenCalled()

        const traversal = makeResponse()
        await middleware({url: `?file=${encodeURIComponent('/home/me/project/../../etc/passwd')}&line=1&column=1`}, traversal)
        expect(traversal.statusCode).toBe(403)
        expect(readFile).not.toHaveBeenCalled()

        const insideRoot = makeResponse()
        await middleware({url: `?file=${encodeURIComponent('/home/me/project/src/App.tsx')}&line=1&column=1`}, insideRoot)
        expect(insideRoot.statusCode).toBe(200)
        expect(insideRoot.body).toContain('secret')

        // root 自带尾部斜杠时行为一致
        const slashRootMiddleware = createCodeFrameMiddleware(readFile, '/home/me/project/')
        const insideSlashRoot = makeResponse()
        await slashRootMiddleware({url: `?file=${encodeURIComponent('/home/me/project/src/App.tsx')}&line=1&column=1`}, insideSlashRoot)
        expect(insideSlashRoot.statusCode).toBe(200)
    })

    test('adds RxList patch information to AxiiError reactive traces', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        let rejectedError: unknown
        const unhandledRejection = new Promise<void>(resolve => {
            window.addEventListener('unhandledrejection', (event) => {
                event.preventDefault()
                rejectedError = event.reason
                resolve()
            }, {once: true})
        })
        const list = new RxList([
            <span>first</span>,
            <span>second</span>,
        ])
        root.render(list as unknown as JSX.Element)

        const firstItemPlaceholder = Array.from(rootEl.childNodes).find(
            node => node.nodeType === Node.COMMENT_NODE && node.textContent === 'rx list item'
        )!
        rootEl.insertBefore(firstItemPlaceholder, rootEl.firstChild)

        list.splice(0, 1)
        await unhandledRejection

        const error = consoleError.mock.calls[0][0]
        expect(error).toBeInstanceOf(AxiiError)
        expect(rejectedError).toBe(error)
        const axiiError = error as AxiiError
        expect(axiiError.reactiveTrace.some(frame =>
            frame.type === 'rx-list-patch' &&
            frame.method === 'splice' &&
            frame.argvSummary === '0,1' &&
            frame.deletedCount === 1
        )).toBe(true)
        expect(showAxiiDevOverlay(axiiError).textContent).toContain('Reactive update:')
        expect(document.getElementById('axii-dev-overlay')?.textContent).toContain('RxListHost.apply-patch')
        dismissAxiiDevOverlay()
        consoleError.mockRestore()
    })

    test('records atom, function, and dynamic attribute reactive traces', async () => {
        const text = atom('hello')
        const title = atom('a')
        const showSpan = atom(true)

        root.render(<div title={() => title()}>
            {text}
            {() => showSpan() ? <span>visible</span> : <i>hidden</i>}
        </div>)

        title('b')
        text('world')
        showSpan(false)
        await new Promise<void>(resolve => queueMicrotask(() => resolve()))

        const traceTypes = getRecentReactiveTrace().map(frame => frame.type)
        expect(traceTypes).toContain('static-attr')
        expect(traceTypes).toContain('atom-text')
        expect(traceTypes).toContain('function-node-recompute')
        expect(traceTypes).toContain('function-node')
    })

    test('records the initial component render as a reactive trace frame', () => {
        function App() {
            return <div>app</div>
        }
        root.render(<App/>)

        const traces = getRecentReactiveTrace()
        expect(traces.some(frame => frame.type === 'component-render' && frame.hostType === 'ComponentHost')).toBe(true)
    })

    test('keeps reactive trace history bounded and disables recording with diagnostics off', () => {
        configureDiagnostics({enabled: false})
        expect(recordReactiveTrace({
            type: 'component-render',
            operation: 'render',
            hostType: 'ComponentHost',
            elementPath: [],
        })).toBeUndefined()
        expect(withReactiveTrace({
            type: 'component-render',
            operation: 'render',
            hostType: 'ComponentHost',
            elementPath: [],
        }, () => 'disabled')).toBe('disabled')

        configureDiagnostics({})
        recordReactiveTrace({
            type: 'static-attr',
            operation: 'update-attr',
            hostType: 'StaticHost',
            elementPath: [],
            attrName: 'title',
        })
        const traceError = captureError(() => {
            assertRangeReachable({
                start: document.createTextNode('start'),
                end: document.createComment('end'),
                operation: 'destroy',
            })
        }) as AxiiError
        expect(showAxiiDevOverlay(traceError).textContent).toContain('attr=title')
        dismissAxiiDevOverlay()
        clearReactiveTrace()

        for (let index = 0; index < 25; index++) {
            recordReactiveTrace({
                type: 'component-render',
                operation: `render-${index}`,
                hostType: 'ComponentHost',
                elementPath: [index],
            })
        }

        const traces = getRecentReactiveTrace()
        expect(traces).toHaveLength(20)
        expect(traces[0].operation).toBe('render-5')
        expect(traces.at(-1)?.operation).toBe('render-24')
    })

    test('summarizes patch arguments without dumping user data', () => {
        expect(summarizeArgv([0, 1])).toBe('0,1')
        expect(summarizeArgv([0, 'x', null, undefined])).toBe('0,x,null,undefined')
        // 对象只显示构造器名，不 dump 内容
        expect(summarizeArgv([{secret: 'value'}, new Date(0)])).toBe('Object,Date')
        expect(summarizeArgv([Object.create(null)])).toBe('object')
        // 函数显示名字
        function namedFn() {}
        expect(summarizeArgv([namedFn, () => {}])).toBe('function namedFn,function')
        // 超长参数截断
        expect(summarizeArgv([1, 2, 3, 4, 5, 6, 7])).toBe('1,2,3,4,5,…(+2 more)')
    })

    test('updates ReusableHost path context when it is moved to a new placeholder', () => {
        const oldSource: AxiiSource = {
            fileName: '/src/Old.tsx',
            lineNumber: 1,
            columnNumber: 1,
        }
        const newSource: AxiiSource = {
            fileName: '/src/New.tsx',
            lineNumber: 2,
            columnNumber: 2,
        }
        const oldContext = {
            root,
            hostPath: null as unknown as PathContext['hostPath'],
            elementPath: [1],
            debugSource: oldSource,
        }
        const newContext = {
            root,
            hostPath: null as unknown as PathContext['hostPath'],
            elementPath: [2],
            debugSource: newSource,
        }
        const newPlaceholder = document.createComment('new reusable')
        rootEl.appendChild(newPlaceholder)
        const reusableHost = new ReusableHost(<span>reuse</span>, document.createComment('old reusable'), oldContext)

        const host = createHost(reusableHost, newPlaceholder, newContext)

        expect(host).toBe(reusableHost)
        expect(reusableHost.pathContext.elementPath).toEqual(newContext.elementPath)
        expect(reusableHost.pathContext.root).toBe(newContext.root)
        expect(reusableHost.pathContext.debugSource).toBe(newSource)
    })

    test('captures host stack, component stack, cause, and DOM snapshot details', () => {
        function TodoList() {}

        class FakeComponentHost implements Host {
            type = TodoList
            element = document.createComment('component')
            placeholder = document.createComment('component placeholder')
            pathContext: PathContext
            render = () => {}
            destroy = () => {}

            constructor(pathContext: PathContext) {
                this.pathContext = pathContext
            }
        }

        class FakeStaticHost implements Host {
            element = document.createElement('div')
            placeholder = document.createComment('static placeholder')
            pathContext: PathContext
            render = () => {}
            destroy = () => {}

            constructor(pathContext: PathContext) {
                this.pathContext = pathContext
            }
        }

        const rootContext = {
            root: {} as PathContext['root'],
            hostPath: null as unknown as PathContext['hostPath'],
            elementPath: [0],
        }
        const componentHost = new FakeComponentHost(rootContext)
        const componentPath = {node: componentHost, prev: null}
        componentHost.pathContext.hostPath = componentPath

        const staticContext = {
            root: {} as PathContext['root'],
            hostPath: null as unknown as PathContext['hostPath'],
            elementPath: [0, 1],
        }
        const staticHost = new FakeStaticHost(staticContext)
        staticHost.pathContext.hostPath = {node: staticHost, prev: componentPath}

        const startParent = document.createElement('section')
        startParent.className = 'todo-list'
        const textBefore = document.createTextNode('before')
        const start = document.createElement('span')
        start.setAttribute('data-as', 'item')
        start.setAttribute('data-testid', 'todo-item')
        start.setAttribute('data-axii-host-id', 'h1')
        start.className = 'todo-item'
        const commentAfter = document.createComment('after start')
        startParent.append(textBefore, start, commentAfter)

        const endParent = document.createElement('ul')
        const end = document.createComment('end')
        endParent.append(end)

        const cause = new Error('placeholder and element parentElement not same')

        const error = captureError(() => {
            assertRangeReachable({
                ownerHost: staticHost,
                start,
                end,
                boundaryKind: 'reusable-range',
                operation: 'move',
                cause,
            })
        })
        expect(error).toBeInstanceOf(AxiiError)
        const axiiError = error as AxiiError
        expect(axiiError.cause).toBe(cause)
        expect(axiiError.phase).toBe('move')
        expect(axiiError.componentStack).toEqual([
            {type: 'FakeComponentHost', componentName: 'TodoList', elementPath: [0]},
        ])
        expect(axiiError.hostStack).toEqual([
            {type: 'FakeComponentHost', componentName: 'TodoList', elementPath: [0]},
            {type: 'FakeStaticHost', elementPath: [0, 1]},
        ])
        expect(axiiError.domSnapshot.boundaryKind).toBe('reusable-range')
        expect(axiiError.domSnapshot.start).toMatchObject({
            name: 'span',
            dataAs: 'item',
            dataTestId: 'todo-item',
            dataAxiiHostId: 'h1',
            className: 'todo-item',
        })
        expect(axiiError.domSnapshot.startParent).toMatchObject({
            name: 'section',
            className: 'todo-list',
        })
        expect(axiiError.domSnapshot.endParent?.name).toBe('ul')
        expect(axiiError.domSnapshot.siblingsBefore).toEqual([
            {nodeType: Node.TEXT_NODE, name: '#text', text: 'before'},
        ])
        expect(axiiError.domSnapshot.siblingsAfter).toEqual([
            {nodeType: Node.COMMENT_NODE, name: '#comment', text: 'after start'},
        ])
    })

    test('summarizes SVG elements through the class attribute', () => {
        // CAUTION SVGElement.className 是 SVGAnimatedString，快照必须读 class attribute
        const start = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        start.setAttribute('class', 'chart-dot')
        const end = document.createComment('end')

        const error = captureError(() => {
            assertRangeReachable({start, end, operation: 'destroy'})
        }) as AxiiError
        expect(error.domSnapshot.start).toEqual({
            nodeType: Node.ELEMENT_NODE,
            name: 'circle',
            className: 'chart-dot',
        })
    })

    test('validates reachable ranges without throwing', () => {
        const parent = document.createElement('div')
        const start = document.createTextNode('start')
        const middle = document.createElement('span')
        const end = document.createComment('end')
        parent.append(start, middle, end)

        expect(() => {
            assertRangeReachable({
                start,
                end,
                operation: 'destroy',
            })
        }).not.toThrow()

        expect(() => {
            assertRangeReachable({
                start: end,
                end,
                operation: 'destroy',
            })
        }).not.toThrow()
    })

    test('captures detached start nodes when a boundary has no parent', () => {
        const start = document.createTextNode('detached')
        const parent = document.createDocumentFragment()
        const end = document.createComment('end')
        parent.append(end)

        const error = captureError(() => {
            assertRangeReachable({
                start,
                end,
                operation: 'destroy',
            })
        })
        expect(error).toBeInstanceOf(AxiiError)
        const axiiError = error as AxiiError
        expect(axiiError.hostStack).toEqual([])
        expect(axiiError.componentStack).toEqual([])
        expect(axiiError.domSnapshot.startParent).toBeUndefined()
        expect(axiiError.domSnapshot.endParent).toEqual({
            nodeType: Node.DOCUMENT_FRAGMENT_NODE,
            name: '#document-fragment',
        })
        expect(axiiError.domSnapshot.siblingsBefore).toEqual([])
        expect(axiiError.domSnapshot.siblingsAfter).toEqual([])
    })
})
