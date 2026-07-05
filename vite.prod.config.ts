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
      // CAUTION vite-plugin 是 node-only 代码（依赖 node:fs/promises），必须独立入口打包，
      //  不能混进浏览器侧的主入口。多入口 lib 模式不支持 umd，所以 cjs 产物从 axii.umd.cjs 变成 axii.cjs。
      entry: {
        axii: resolve(__dirname, 'src/index.ts'),
        'vite-plugin': resolve(__dirname, 'src/vitePlugin.ts'),
      },
      name: 'axii',
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
