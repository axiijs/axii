// Vite plugin: build-time Shiki tokenize for `?shiki` imports (DR-04, C-43).
//
// Background: <Example> needs to display source code as a highlighted code block
// AND mount a live axii subtree from the same source file. DR-06 fixes the
// "same file" relationship: the source `.tsx` is imported with `?raw` for the
// copyable string and with a normal import for the `render` function.
//
// This plugin adds a third import suffix `?shiki` that returns the highlighted
// HTML string for the same file. Shiki runs ONLY in the plugin (build/dev server
// context, Node), so grammar/theme modules never enter the client bundle. The
// client just receives a pre-tokenized HTML string and writes it as innerHTML.
//
// `?raw` and `?shiki` resolve to the same physical file on disk, which is what
// keeps the displayed code, the highlighted code, and the live `render` instance
// from drifting (C-19).
//
// The JavaScript regex engine (`createJavaScriptRegexEngine`) is used instead of
// the Oniguruma WASM engine: it is pure JS, has no `.wasm` asset to load, and is
// fast enough at build time. This keeps the plugin self-contained.

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import {
  createHighlighterCoreSync,
  createJavaScriptRegexEngine,
  type HighlighterCore,
} from 'shiki'
import type { Plugin } from 'vite'

const supported = {
  '.tsx': 'tsx',
  '.ts': 'typescript',
  '.jsx': 'jsx',
  '.js': 'javascript',
  '.json': 'json',
  '.css': 'css',
  '.html': 'html',
  '.md': 'markdown',
} as const

let highlighterPromise: Promise<HighlighterCore> | null = null

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    const [engine, tsx, ts, jsx, js, json, css, html, md, theme] = await Promise.all([
      createJavaScriptRegexEngine(),
      import('shiki/langs/tsx.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/jsx.mjs'),
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/css.mjs'),
      import('shiki/langs/html.mjs'),
      import('shiki/langs/markdown.mjs'),
      import('shiki/themes/github-dark.mjs'),
    ])
    highlighterPromise = Promise.resolve(
      createHighlighterCoreSync({
        langs: [tsx.default, ts.default, jsx.default, js.default, json.default, css.default, html.default, md.default],
        themes: [theme.default],
        engine,
      }),
    )
  }
  return highlighterPromise
}

export function shikiHighlightPlugin(): Plugin {
  return {
    name: 'axii-site-shiki',
    enforce: 'pre',
    async load(id) {
      if (!id.includes('?shiki')) return null
      const filePath = id.replace(/\?shiki.*$/, '')
      const ext = extname(filePath)
      const lang = (supported as Record<string, string>)[ext]
      if (!lang) return null
      const code = readFileSync(filePath, 'utf8')
      const highlighter = await getHighlighter()
      const html = highlighter.codeToHtml(code, { lang, theme: 'github-dark' })
      // Export as an ESM string so consumers can `import html from './x.tsx?shiki'`.
      return `export default ${JSON.stringify(html)}`
    },
  }
}
