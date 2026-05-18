import {resolve} from "path";
import dts from 'vite-plugin-dts'

export default {
  esbuild: {
    jsxFactory: 'createElement',
    jsxFragment: 'Fragment',
  },
  define: {
    __DEV__: false
  },
  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: {
        axii: resolve(__dirname, 'src/index.ts'),
        'vite-plugin': resolve(__dirname, 'src/vitePlugin.ts'),
      },
      name: 'axii',
      // the proper extensions will be added
      formats: ['es', 'cjs'],
      fileName: (format: string, entryName: string) => format === 'es' ? `${entryName}.js` : `${entryName}.cjs`,
    },
    sourcemap: true,
    rollupOptions: {
      external: ['data0', 'node:fs/promises'],
    },
  },
  plugins: [dts({
    tsconfigPath: resolve(__dirname, 'tsconfig.prod.json'),
    rollupTypes: true,
    include: ['src/**/*.ts', 'src/**/*.tsx', 'global.d.ts'],
    bundledPackages: ['data0']
  })]
}
