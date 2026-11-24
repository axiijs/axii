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

// #55（设计 docs/ssr-support/hydration-top-down.md §3.4、§7.2）：调用激活的 spec 文件都经 __tests__/helpers/hydrate.ts 激活。
//  下面的「hydrate-diag-on」「hydrate-diag-off」项目把它们跑两遍，激活期间诊断分别开、关（开发期 Proxy 与裸描述两种对象）；
//  「default」项目跑其余文件。一条 `npx vitest run` 跑完，门禁命令不变。新增调用激活（经 helpers/hydrate）的 spec 文件时加进这张表。
const HYDRATE_SPECS = [
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
      {extends: true, test: {name: 'default', exclude: ['**/node_modules/**', '__tests__/node/**', ...HYDRATE_SPECS]}},
      // §3.4 两遍验收（B4 起，S 之后保留）：激活期间诊断开启（开发期 Proxy 与开发期报告）、关闭（裸描述，≡ 生产）各一遍
      {
        extends: true,
        define: {__AXII_HYDRATE_DIAGNOSTICS__: true},
        test: {name: 'hydrate-diag-on', include: HYDRATE_SPECS},
      },
      {
        extends: true,
        define: {__AXII_HYDRATE_DIAGNOSTICS__: false},
        test: {name: 'hydrate-diag-off', include: HYDRATE_SPECS},
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
