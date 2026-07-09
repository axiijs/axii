# 09 深度 review 第五轮（2026-07，已全部修复）

本轮 review 在前四轮（见 [05](./05-review-2026-07.md)、[06](./06-review-2026-07-round2.md)、
[07](./07-review-2026-07-round3.md)、[08](./08-review-2026-07-round4.md)）修复完成后的 `main`
上进行，再次通读 `src/` 全部源码。对每个疑点先写运行时复现测试（真实 Chromium）确认，
证实的逐项修复，证伪的直接排除；每个测试都先在未修复代码上确认失败再转为回归测试。
本轮问题集中在 **StyleManager 的 CSS 生成**（selector 作用域化 / at-rule 内容拼接）和
**error 钩子对生命周期回调与 Portal 的覆盖** 上。

回归测试：致命问题在 `__tests__/fatalBugs6.spec.tsx`（F20-F21），改进项在
`__tests__/improvements6.spec.tsx`（I26-I27），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F20 | `generateStyleContent` 的 at-rule 分支把递归结果（`string[]`）直接内插进模板字符串，多条规则被数组默认的 `','` 连接：`@media`/`@container`/`@supports` 里第一条之后的所有规则（嵌套 selector、`@keyframes`/`animation`）全部变成非法 CSS 被浏览器静默丢弃——响应式布局里最常见的「媒体查询 + 悬停/子元素样式」组合静默失效 | at-rule 内容显式 `join('\n')`（`src/StaticHost.ts`） |
| F21 | 嵌套样式 key 的 `&` 只替换第一个（`String.replace` 单次替换）：多 selector 写法（`'&:hover, &:focus'` / `'& > .a, & > .b'`）里第二个 selector 的 `&` 残留在顶层 stylesheet，永远不匹配目标元素；实测残留的顶层 `&` 还会让整条规则（包括合法的第一个 selector）的匹配在 Chromium 下不稳定。不含 `&` 的逗号列表（`'.a, .b'`）则只有第一个被作用域化，第二个变成**全局 selector 污染组件外元素**；`'.wrapper &'`（`&` 不在开头）也不被替换 | 新增 `scopeNestedSelector`：按顶层逗号切分 selector 列表（跳过 `()`/`[]`/引号内部的逗号，`:is(.a, .b)`、`[data-x="1,2"]` 不受影响），每个部分含 `&` 时 `replaceAll` 替换、不含时统一加 `${selector} ` 前缀作用域化（`src/StaticHost.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I26 | `root.on('error')` 覆盖组件 render / 属性绑定 / atom 文本 / RxList patch（O1），但 `useEffect`/`useLayoutEffect`/`onCleanup`（含 effect 返回的清理函数）抛错不经过该钩子：初次渲染时一个抛错的 useEffect 让 `root.render` 中断、**已渲染好的树永远挂不上容器（白屏）**；layoutEffect 抛错打断同批其他 layoutEffect/ref；destroy 时抛错的清理函数中断兄弟清理与剩余销毁流程（泄漏） | `ComponentHost` 新增统一出口 `runWithErrorHook`：effects / layoutEffects / layoutEffectDestroyHandles / destroyCallback 逐个回调包裹，注册了钩子时报告错误并继续执行其余回调，未注册时保持向上抛出的旧行为（`src/ComponentHost.ts`） |
| I27 | Portal 内容运行在框架私有创建的内层 root 上（`createRoot(container, pathContext)`），用户无法在它上面注册监听：portal 内容里的错误永远到不了用户的 `root.on('error')` 钩子，函数节点重算等异步路径下直接变成 unhandled rejection（同步路径下则绕过钩子向上抛） | 带 `parentContext` 创建的 root 把**未被本地消费的 `error` 事件**冒泡到父 root（只冒泡 error；attach/detach 是每个 root 自己的生命周期事件，不转发）（`src/render.ts`） |

## 复现后被证伪 / 有意不改的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O7 | 列表行组件体内直接读 atom（不经函数节点）时，依赖是否会泄漏进 `RxListHost` 的 computed（初始行渲染发生在 computed 的 computation 里） | **证伪**：实测 atom 变化不触发 list patch、不报错，后续 splice 行为正常（data0 的 manualTrack computed 不响应普通依赖触发） |
| O8 | `atom(HTMLElement)` 作为 child 会经 `AtomHost` 字符串化成 `"[object HTMLDivElement]"` | 属 API 设计边界：atom child 是文本绑定，结构内容应使用函数 child（`() => elAtom()`，走 FunctionHost 支持结构重建）。不改，避免让最热的文本路径背上类型分支 |
| O9 | automatic JSX runtime（`axii/jsx-runtime` 的 `jsx`/`jsxDEV`）绕过组件实例的 `createElement`，`as=`/AOP（`$name:*`）/`prop:` 等组件配置能力在该链路下不可用 | 框架的既定用法是 classic transform + 从 `RenderContext` 解构 `createElement`（README 与全部测试如此）；jsx-runtime 导出主要服务 jsxDEV 的 source 采集。属文档层面的已知限制，不在运行时修复 |
| O10 | `PropTypes.atom().default(...)` 的 defaultValue 不做 coerce，传原始值会导致组件拿到非 atom | 现约定是 `default(() => atom(0))`（测试与现有组件库均按此约定书写），default 工厂负责构造正确类型。不改 |

运行方式：

```bash
npx vitest run __tests__/fatalBugs6.spec.tsx __tests__/improvements6.spec.tsx --coverage.enabled=false
```
