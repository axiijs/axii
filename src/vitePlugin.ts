/**
 * Axii 开发期 Vite 插件（`axii/vite-plugin` 子路径导出）。
 *
 * 职责：
 * 1. 开启 esbuild 的 jsxDev，让 jsxDEV 拿到 source（文件、行、列）信息。
 * 2. 注入 __AXII_CODE_FRAME_ENDPOINT__，并提供 /__axii/code-frame middleware，
 *    让 reportAxiiError 能在 console 中输出出错位置的 code frame。
 *
 * CAUTION 这是 node-only 代码，必须和主 runtime 入口分开打包，
 * 否则浏览器侧 bundle 会引入 node:fs/promises。
 */

type AxiiVitePlugin = {
    name: string
    enforce: 'pre'
    // 纯开发期能力，只在 dev server 下生效，避免污染生产构建
    apply: 'serve'
    config: () => {
        esbuild: {
            jsxDev: boolean
        }
    }
    configureServer: (server: AxiiViteDevServer) => void
    transformIndexHtml: () => {
        tag: string
        attrs: {
            type: string
        }
        children: string
        injectTo: string
    }[]
}

type AxiiViteDevServer = {
    config?: {
        root?: string
    }
    middlewares: {
        use: (path: string, handler: AxiiMiddleware) => void
    }
}

type AxiiMiddleware = (
    req: {
        url?: string
    },
    res: {
        statusCode: number
        setHeader: (name: string, value: string) => void
        end: (body?: string) => void
    }
) => void | Promise<void>

type ReadSourceFile = (fileName: string) => Promise<string>

/**
 * Enables JSX dev source metadata and code frames for Axii projects running under Vite.
 */
export function axiiDevtools(): AxiiVitePlugin {
    return {
        name: 'axii-devtools',
        enforce: 'pre',
        apply: 'serve',
        config() {
            return {
                esbuild: {
                    jsxDev: true,
                },
            }
        },
        /* v8 ignore start */
        configureServer(server) {
            const root = server.config?.root
            server.middlewares.use('/__axii/code-frame', async (req, res) => {
                const {readFile} = await import('node:fs/promises')
                return createCodeFrameMiddleware((fileName) => readFile(fileName, 'utf-8'), root)(req, res)
            })
        },
        /* v8 ignore stop */
        transformIndexHtml() {
            return [{
                tag: 'script',
                attrs: {
                    type: 'module',
                },
                children: 'globalThis.__AXII_CODE_FRAME_ENDPOINT__="/__axii/code-frame";',
                injectTo: 'head',
            }]
        },
    }
}

/**
 * CAUTION 这个 endpoint 会按请求参数读文件。即使只在 dev server 存在，
 * 也必须限制在项目 root 内并拒绝 `..`，防止 DNS rebinding 之类场景下的任意文件读取。
 */
export function createCodeFrameMiddleware(readFile: ReadSourceFile, root?: string): AxiiMiddleware {
    return async (req, res) => {
        try {
            const url = new URL(req.url ?? '', 'http://axii.local')
            const fileName = url.searchParams.get('file')
            const lineNumber = Number(url.searchParams.get('line'))
            const columnNumber = Number(url.searchParams.get('column'))
            if (!fileName || !Number.isFinite(lineNumber) || !Number.isFinite(columnNumber)) {
                res.statusCode = 400
                res.end('Missing file, line, or column')
                return
            }

            if (!isFileAllowed(fileName, root)) {
                res.statusCode = 403
                res.end('File is outside of the project root')
                return
            }

            const source = await readFile(fileName)
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(createCodeFrame(source, lineNumber, columnNumber))
        } catch (error) {
            res.statusCode = 500
            res.end(error instanceof Error ? error.message : String(error))
        }
    }
}

function isFileAllowed(fileName: string, root?: string) {
    const segments = fileName.split(/[\\/]/)
    if (segments.includes('..')) return false
    if (!root) return true

    // Vite 的 root 是 posix 风格的绝对路径
    const normalizedRoot = root.endsWith('/') ? root : `${root}/`
    return fileName.startsWith(normalizedRoot)
}

export function createCodeFrame(source: string, lineNumber: number, columnNumber: number, radius = 2) {
    const lines = source.split(/\r?\n/)
    const start = Math.max(1, lineNumber - radius)
    const end = Math.min(lines.length, lineNumber + radius)
    const lineNumberWidth = String(end).length
    const output: string[] = []

    for (let line = start; line <= end; line++) {
        const marker = line === lineNumber ? '>' : ' '
        const paddedLine = String(line).padStart(lineNumberWidth, ' ')
        output.push(`${marker} ${paddedLine} | ${lines[line - 1]}`)
        if (line === lineNumber) {
            output.push(`  ${' '.repeat(lineNumberWidth)} | ${' '.repeat(Math.max(0, columnNumber - 1))}^`)
        }
    }

    return output.join('\n')
}
