import {fileURLToPath, URL } from 'url'
import {existsSync} from 'fs'
import tsconfigPaths from 'vite-tsconfig-paths'

// Use the sibling data0 checkout when available (original dev setup),
// otherwise fall back to the npm-installed data0 so the repo is self-contained.
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
  server: {
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..'],
    },
  },
  plugins: [tsconfigPaths()],
  test: {
    // node-environment specs (run via vitest.node.config.ts) can't run in the browser
    exclude: ['**/node_modules/**', '__tests__/node/**'],
    pool:'threads',
    poolOptions: {
      threads: {
        maxThreads:1
        // Threads related options here
      }
    },
    browser: {
      enabled: true,
      name: 'chromium',
      provider: 'playwright',
      headless: true,
    },
    coverage: {
      enabled: true,
      all: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: ['src'],
      exclude: ['src/util.ts', 'src/Form.tsx', 'src/common.ts', 'src/Host.ts', 'src/types.ts', 'src/propTypes.ts']
    },
  },
}
