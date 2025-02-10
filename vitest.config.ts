import {fileURLToPath, URL } from 'url'
import tsconfigPaths from 'vite-tsconfig-paths'

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
      // 'data0': fileURLToPath(new URL('../data0/src/index.ts', import.meta.url))
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
    browser: {
      enabled: true,
      name: 'chromium',
      provider: 'playwright',
      headless: true
    },
    coverage: {
      enabled: true,
      all: true,
      reporter: ['text', 'json', 'html'],
      include: ['src'],
    },
  },
}
