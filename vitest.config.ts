import {fileURLToPath, URL } from 'url'
import {existsSync} from 'fs'
import tsconfigPaths from 'vite-tsconfig-paths'

// Use the sibling data0 checkout when available (original dev setup),
// otherwise fall back to the npm-installed data0 so the repo is self-contained.
// AXII_DATA0_FORCE_NPM=1 forces npm (same as site/vite.config.ts) for gate runs
// when an outdated sibling checkout would otherwise fail contract tests.
const siblingData0 = fileURLToPath(new URL('../data0/src/index.ts', import.meta.url))
const forceNpmData0 = process.env.AXII_DATA0_FORCE_NPM === '1'
const useSiblingData0 = !forceNpmData0 && existsSync(siblingData0)

// #55（设计 docs/ssr-support/hydration-top-down.md §7.2）：调用激活的 spec 文件都经 __tests__/helpers/hydrate.ts 激活。
//  下面的「top-down」项目把它们再跑一遍，走不导出的内部入口（新模型）；「default」项目照旧跑全部用例、走公开的 hydrateRoot。
//  一条 `npx vitest run` 跑完两遍，门禁命令不变。新增调用激活的 spec 文件时加进这张表；#55 S 删除入口切换时一并删除它。
const TOP_DOWN_HYDRATE_SPECS = [
  '__tests__/auditSsrCsrAttributeParity.spec.tsx',
  '__tests__/auditSsrHydrate.spec.tsx',
  '__tests__/auditStylesFormsState.spec.tsx',
  '__tests__/contentAddressedStyles.spec.tsx',
  '__tests__/lifecycleCorners.spec.tsx',
  '__tests__/ssrCompactRow.spec.tsx',
  '__tests__/ssrHydrate.attrs-components.spec.tsx',
  '__tests__/ssrHydrate.claimCorners.spec.tsx',
  '__tests__/ssrHydrate.functionValues.spec.tsx',
  '__tests__/ssrHydrate.lifecycle.spec.tsx',
  '__tests__/ssrHydrate.lists.spec.tsx',
  '__tests__/ssrHydrate.mismatch.spec.tsx',
  '__tests__/ssrHydrate.mismatchRebuild.spec.tsx',
  '__tests__/ssrHydrate.shapes.spec.tsx',
  '__tests__/ssrHydrate.smoke.spec.tsx',
  '__tests__/ssrHydrate.sparseArrays.spec.tsx',
  '__tests__/ssrStyles.spec.tsx',
  '__tests__/styleContentCascade.spec.tsx',
  '__tests__/styleContentIdentity.spec.tsx',
  '__tests__/styleContentLifecycle.spec.tsx',
  '__tests__/styleContentSsrActivation.spec.tsx',
  '__tests__/styleStringEntries.spec.tsx',
]

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
      ...(useSiblingData0 ? {'data0': siblingData0} : {})
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
    projects: [
      {extends: true, test: {name: 'default'}},
      {
        extends: true,
        define: {__AXII_HYDRATE_TOP_DOWN__: true},
        test: {name: 'top-down', include: TOP_DOWN_HYDRATE_SPECS},
      },
    ],
    coverage: {
      enabled: true,
      all: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'json-summary'],
      include: ['src'],
      // 只排除纯类型声明文件。Form.tsx / propTypes.ts / util.ts 等运行时代码必须计入覆盖率，
      // 否则覆盖率数字虚高，且这些文件里的 bug 会一直落在测试盲区（历史上 Form 的 ASI bug 正因此漏网）。
      exclude: ['src/Host.ts', 'src/types.ts']
    },
  },
}
