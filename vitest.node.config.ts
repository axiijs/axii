import {fileURLToPath, URL} from 'url'
import {existsSync} from 'fs'
import tsconfigPaths from 'vite-tsconfig-paths'

// Node-environment test config, used to reproduce bugs that the browser-based
// default config cannot expose (e.g. module-load-time usage of browser-only APIs).
// Run with: npx vitest run --config vitest.node.config.ts
const siblingData0 = fileURLToPath(new URL('../data0/src/index.ts', import.meta.url))

export default {
  esbuild: {
    jsxFactory: 'createElement',
    jsxFragment: 'Fragment',
  },
  define: {
    __DEV__: true,
  },
  resolve: {
    alias: {
      '@framework': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      ...(existsSync(siblingData0) ? {'data0': siblingData0} : {})
    }
  },
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['__tests__/node/**/*.spec.ts'],
  },
}
