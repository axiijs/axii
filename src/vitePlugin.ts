type AxiiVitePlugin = {
    name: string
    enforce: 'pre'
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
 * Enables JSX dev source metadata for Axii projects running under Vite.
 */
export function axiiDevtools(): AxiiVitePlugin {
    return {
        name: 'axii-devtools',
        enforce: 'pre',
        config() {
            return {
                esbuild: {
                    jsxDev: true,
                },
            }
        },
        /* v8 ignore start */
        configureServer(server) {
            server.middlewares.use('/__axii/code-frame', async (req, res) => {
                const {readFile} = await import('node:fs/promises')
                return createCodeFrameMiddleware((fileName) => readFile(fileName, 'utf-8'))(req, res)
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

export function createCodeFrameMiddleware(readFile: ReadSourceFile): AxiiMiddleware {
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

            const source = await readFile(fileName)
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(createCodeFrame(source, lineNumber, columnNumber))
        } catch (error) {
            res.statusCode = 500
            res.end(error instanceof Error ? error.message : String(error))
        }
    }
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
