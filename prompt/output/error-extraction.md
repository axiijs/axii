# 错误体系升级提炼记录

## 背景

`feature/error-handling-diagnostics` 分支上混合了两类改动：

1. 错误体系升级（`fix: improve Axii error diagnostics`，方案见 `prompt/error-task-1.md`）。
2. 一系列性能优化（RxList 紧凑 host、inline function children、data0 v2 适配等）。

性能优化尚未准备好合并。本次工作把错误体系升级单独提炼到 main 上，并在提炼过程中做了审查和改进，不是逐行拷贝。

## 提炼范围

来自 feature 分支的错误体系能力全部保留：

- `src/diagnostics.ts`：`AxiiError`（错误码、phase、组件栈、Host 栈、响应式链路、DOM 快照、hints、docsUrl）、`configureDiagnostics`、`reportAxiiError`、`assertRangeReachable`、reactive trace 记录、手动 dev overlay。
- `src/vitePlugin.ts`：`axiiDevtools()` Vite 插件（开启 jsxDev source、注入 code frame endpoint、提供 `/__axii/code-frame` middleware），以 `axii/vite-plugin` 子路径独立发布，node-only 代码不进浏览器 bundle。
- JSX dev source 数据链路：`jsxDEV(type, props, key, isStaticChildren, source, self)` → `ComponentNode.__axiiSource` / `ExtendedElement.__axiiSource` / `UnhandledChildInfo.source` / `UnhandledAttrInfo.source` → `createHost` 写入 `PathContext.debugSource` → 错误报告中的 `source` / code frame。
- 各 Host 的诊断接入：`removeNodesBetween` 的删除前区间校验（StaticHost、StaticArrayHost）、`ReusableHost` 搬移/销毁前的 reusable-range 校验、`RxListHost.applyPatch` 的 trace + reportAxiiError、`AtomHost`/`FunctionHost`/`StaticHost` 动态 attr/`ComponentHost` 的 reactive trace。
- 构建调整：多入口 lib 构建（`axii` + `vite-plugin`），CJS 产物从 `axii.umd.cjs` 变为 `axii.cjs`（多入口不支持 umd），`package.json` 增加 `./vite-plugin` 导出。
- `__tests__/errorHandling.spec.tsx`，diagnostics.ts / vitePlugin.ts 覆盖率 100%（statements/branches/functions/lines）。

## 与 feature 分支实现的差异（改进项）

提炼时逐项 review 了原实现，做了以下修正和加强：

1. **在 main 已修复的 bug 之上重放，而不是覆盖**。feature 分支的错误体系提交基于旧 base，其中 `RxListHost` 的 reorder / explicit key change 还在使用 `parentElement.firstChild` 作为锚点（main 已修复为列表区域内锚点，BUG 4），`ComponentHost.render` / `FunctionHost` 还没有 `root.on('error')` 错误钩子和 collect-frame/destroy-race 修复。本次把 trace/诊断包装应用在 main 的修复后代码之上，逐段核对，未回退任何 main 上的修复。

2. **`configureDiagnostics` 增加 `onError` 钩子**（原方案文档中已设计但 feature 分支未实现）。框架内部无法向上抛、只能 report 的错误（响应式 patch、异步删除）会进入该钩子，可接入 Sentry 等监控；无论 `enabled` 与否都触发（生产环境正是需要上报的环境）；钩子自身抛错会被吞掉，不允许掩盖原始错误。

3. **StaticHost 销毁语义 = feature 分支的同步抛错 + main 的离场动画容忍，二者合并**：
   - `removeElements` 从 `async` 改为「同步或返回 Promise」。无动画路径的 DOM boundary 错误现在同步抛出 `AxiiError`（原来 async 函数会把它变成 unhandled rejection）。
   - 等待离场动画后的异步删除错误交给 `reportAxiiError` 收敛，不产生 unhandled rejection。
   - 保留 main 上「整段区间已被外部整体清理（placeholder 脱离 / 父节点失配）则跳过删除」的容忍行为（improvements 条目 5a），因为这种整体清理无需也无法再按区间删除；真正危险的「同父但兄弟链断了」（盲删会误删别人的节点）仍会被诊断捕获。
   - 无论哪条路径、成功还是失败，styleManager 引用计数都会释放。

4. **`ReusableHost` 的区间校验只在诊断开启时执行**。feature 分支无条件调用 `assertRangeReachable`，生产环境每次搬移都要额外遍历一次区间；现在与 `removeNodesBetween` 的门控保持一致，生产环境零额外成本。

5. **code frame endpoint 增加路径限制**。原实现按请求参数直接读任意文件；现在拒绝含 `..` 的路径，并限制在 Vite `server.config.root` 内（403），防止 dev server 被 DNS rebinding 等方式滥用为任意文件读取。插件同时增加 `apply: 'serve'`，jsxDev/endpoint 注入只影响 dev server，不污染生产构建。

6. **DOM 快照对 SVG 安全**。`SVGElement.className` 是 `SVGAnimatedString` 对象，原实现会把对象放进快照；现在统一读 `class` attribute。

7. **参数摘要有界**。`summarizeArgv` 最多摘要 5 个参数（超出显示 `…(+N more)`），对象只显示构造器名，函数显示函数名，避免把大对象或敏感数据 dump 进错误报告。

8. **诊断系统自身不产生新错误**。code frame 的异步获取全程 try/catch（包括 `location` 不存在的非浏览器环境、fetch 网络失败），诊断路径绝不制造 unhandled rejection。

9. **热路径零分配**。`createHost` 只在节点确实携带更具体的 `__axiiSource` 时才克隆 pathContext（生产构建没有 source，完全不克隆）；reactive trace 历史用 `shift()` 维持上限而不是每次 `slice()` 重新分配。

10. **类型修正**。`ReactiveTraceFrame.key` 类型为 `PropertyKey`（RxList 的 trigger key 可能是 `Symbol(iterate)`，原类型 `string | number` 与运行时不符）。

## 未提炼的内容

以下改动属于性能升级或其前置，不在本次范围：

- RxList 紧凑 element host、reorder 元数据移动、map fast path。
- inline / lazy primitive function children（及其 `inlineFunctionChildren`、`SimpleElementHost` 等结构变化）。
- data0 v2 适配、`getHostPath` 惰性 pathContext。
- 4.0.0 版本号变更（本次不改版本号，交给发布流程）。

## 验证

- `npx vitest run`：17 个文件 172 个测试全部通过（含 19 个错误体系测试）。
- `npx vitest run --config vitest.node.config.ts`：node 环境测试通过。
- 覆盖率：`diagnostics.ts`、`vitePlugin.ts` 100%（statements/branches/functions/lines）。
- `npm run build`：产出 `dist/axii.js|cjs` 与 `dist/vite-plugin.js|cjs`；已验证运行时入口不含 `node:fs`、不泄漏 `axiiDevtools`；生产构建（`__DEV__=false`）下诊断默认关闭、可用 `configureDiagnostics({enabled: true})` 显式开启。
