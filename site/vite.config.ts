import { fileURLToPath, URL } from 'url'
import { existsSync } from 'fs'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vite'
import { shikiHighlightPlugin } from './vite-shiki-plugin.js'

// Sibling data0 checkout resolution (aligned with the library vitest.config.ts):
// when a sibling data0 checkout exists, consume it directly; otherwise fall back
// to the npm-installed data0. AXII_DATA0_FORCE_NPM=1 forces the npm branch — this
// is used only by the D-21 gate script (check-data0-fallback.mjs) to verify the
// fallback branch resolves in environments without a sibling checkout. It must
// not be set by normal dev/build workflows.
//
// The library's vitest.config.ts uses `../data0/src/index.ts` relative to the
// repo root. This config lives in site/, so the sibling is two levels up.
const siblingData0 = fileURLToPath(new URL('../../data0/src/index.ts', import.meta.url))
const forceNpmData0 = process.env.AXII_DATA0_FORCE_NPM === '1'
const useSiblingData0 = !forceNpmData0 && existsSync(siblingData0)

// C-44: __DEV__ must be injected with a runtime value because src/ references it
// bare (src/util.ts:65, src/StaticHost.ts:284/528). global.d.ts only declares the
// type. The library uses two configs (vite.config.ts __DEV__:true, vite.prod.config.ts
// __DEV__:false); the site has a single config serving both dev and build, so the
// value is chosen by Vite mode: dev=true (so the debugger/diagnostics are live
// during development), production=false (so the production bundle is dead-code
// eliminated of debugger statements and dev diagnostic branches).
export default defineConfig(({ mode }) => ({
  esbuild: {
    jsxFactory: 'createElement',
    jsxFragment: 'Fragment',
  },
  define: {
    __DEV__: mode === 'production' ? false : true,
  },
  resolve: {
    alias: {
      // C-04: consume the library source directly during development so the site
      // always reflects the current src/. Using 'axii' as the alias name lets
      // examples self-document the public package name (`from 'axii'`).
      axii: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      ...(useSiblingData0 ? { data0: siblingData0 } : {}),
    },
    // Force data0 to resolve to a single instance. When the sibling data0 is
    // aliased, both src/ (loaded via the axii alias) and site/ code import from
    // "data0" and the alias makes them share one module. When the npm fallback
    // is used, Vite might otherwise resolve data0's ESM/CJS/development
    // conditions differently for src/ vs site/ contexts, producing two RxList
    // classes whose instanceof checks fail (C-45). dedupe forces a single
    // resolution from the root.
    dedupe: ['data0'],
  },
  server: {
    fs: {
      // Allow serving files from one level up (the library src/ and sibling data0).
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  // C-23: do not override appType — Vite's default 'spa' provides history API
  // fallback to index.html under `vite preview`, which is what the self-built
  // history router relies on for deep links.
  plugins: [tsconfigPaths(), shikiHighlightPlugin()],
}))
