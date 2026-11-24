<!-- generated-by: cyclic-task-prompt | template-sha256: 6cfe19e4e81c | generated-at: 2026-08-06 -->
# axii

axii 是一个**高性能、无 Virtual DOM 的增量更新前端框架库**。它面向需要构建应用或组件库的前端开发者：以 data0 的响应式结构（atom / RxList / RxMap / RxSet / computed）驱动真实 DOM 更新，组件函数只执行一次，不存在 Virtual DOM diff。本仓库是库本身，不是可独立浏览的应用；可运行的消费端是兄弟仓库 `../benchmark`，官方文档站在 `site/`。

权威工程规则只有 `AGENTS.md`（项目定位、质量门禁、性能约束、bug-fix 纪律）。任何方案不得与其既定原则默默冲突；确需修改原则时，必须在任务要求或设计决策中显式说明。

## 功能目标

1. 用响应式数据直接驱动细粒度 DOM 更新，组件函数不重跑。
2. 保持无 Virtual DOM：`createElement` 构造真实节点；条件、列表与动态结构由 Host 体系表达。
3. 作为可嵌入的库交付（ESM / CJS / 类型声明），并配套路由、Action、状态机、headless UI 等独立基础设施（不在本仓库内实现）。

非目标：改写成 Virtual DOM diff 架构；为兼容历史 API 保留长期分叉（当前为活跃演进阶段）；引入编译期魔法作为默认心智模型。

## 技术目标

性能（速度与常驻内存）是一等约束：

- **热路径必须尽量零分配**：`createHost` 分发、`LightBindingEffect` 属性更新、atom 文本更新、`RxListHost` patch 是热路径。不得在这些路径上增加每实例闭包、每次调用对象分配或常驻检查。遵循源码 CAUTION：可选字段惰性分配、共享/原型函数、单元素列表行用 `CompactElementHost`。
- **诊断仅开发期**：O(n) 或分配型逻辑（trace、range 检查、`AXII_LIST_ORDER_BROKEN` 等）必须在 `isAxiiDiagnosticsEnabled()` / `__DEV__` 之后；生产最多一次布尔检查。
- **内存是性能的一部分**：长列表是设计中心。`retainedObjectDiagnostics.ts` 与 benchmark 仓库的泄漏断言要求清理后计数归零。
- **data0 是响应式核心**（peerDependency `^2.16.0`）。存在兄弟 `../data0/src` 时 Vite alias 优先指向它，否则使用 npm 安装包。依赖 data0 非文档行为时，必须先用 `__tests__/data0Contract.spec.tsx`（或等效契约测试）钉住。
- **活跃演进**：允许直接改到最优形态；不以长期兼容分叉为目标。CSR 既有行为以全量浏览器测试与 benchmark 口径为准。

## 代码职责

| 区域 | 职责 |
|---|---|
| `src/createHost.ts` | Host 创建与类型分发（热路径入口） |
| `src/Host.ts` | `Host` / `PathContext` 契约 |
| `src/AtomHost.ts` / `FunctionHost.ts` / `ComponentHost.ts` / `RxListHost.ts` / `StaticHost.ts` / `StaticArrayHost.ts` | 各类 source 的渲染、更新与销毁 |
| `src/LightBindingEffect.ts` | 响应式属性/样式细粒度绑定（属性更新热路径） |
| `src/DOM.ts` | `createElement`、属性/事件、插入等 DOM 原语；分类谓词（如 `isEventName`）只在唯一处定义 |
| `src/render.ts` | `createRoot().render()` 同步客户端渲染入口 |
| `src/Portal.tsx` / `src/lazy.ts` / `src/ContextProvider.ts` | Portal、懒加载、context |
| `src/reactiveDOMState.ts` | DOM 几何/滚动等响应式包装；模块加载不得触碰浏览器全局 |
| `src/diagnostics.ts` / `src/retainedObjectDiagnostics.ts` | 开发期诊断与保留对象计数 |
| `src/vitePlugin.ts` | Node-only Vite 插件（独立构建入口） |
| `src/index.ts` | 公开导出面 |
| `__tests__/` | 浏览器真实环境回归（Vitest + Playwright chromium） |
| `__tests__/node/` | Node 环境回归（当前覆盖 import 无浏览器副作用、package exports） |
| `site/` | 文档站示例应用，不是框架核心 |
| `prompt/output/` | 历轮深度 review 的索引；作问题模式参考，不是运行时权威 |

不允许的依赖方向：浏览器侧主入口不得混入 Node-only 代码（`vite-plugin` 必须独立入口）；分类谓词与跨层假设不得在多处复制定义。

## 编码与修改原则

1. **先复现再修复**：bug 修复必须带先失败的回归测试。
2. **修一类，不修一例**：假设失效时 grep 全仓同类位点；谓词单点定义。
3. **根因修复**：不做掩盖式妥协。
4. **契约先于消费**：依赖 data0 行为时扩展 `data0Contract`（或 Node 侧等效契约）。
5. **列表/区域逻辑**：改动 `RxListHost`、host 区域或 DOM 锚点后运行 `__tests__/rxListFuzz.spec.tsx`。
6. **静默错误优先用开发期不变量**（见 `src/diagnostics.ts`），而不是散落的临时断言。
7. **改动 `src/` 后**：消费端若走 `dist/`，需 `npm run build`；benchmark 可用 `AXII_BENCHMARK_SOURCE_AXII=true` 直接吃源码。
8. **DOM / 事件 / selection / 布局时序**只信任真实浏览器证据；不得用 jsdom 类模拟结果作为判定依据。

## 调研入口

- 权威规范：`AGENTS.md`
- 渲染入口：`src/render.ts`、`src/createHost.ts`、`src/DOM.ts`
- Host 与样式：`src/StaticHost.ts`、`src/ComponentHost.ts`、`src/RxListHost.ts`、`src/LightBindingEffect.ts`
- 生命周期与挂载：`src/ComponentHost.ts`（effect / layoutEffect / ref）、`src/render.ts`（attach 队列）
- Portal / lazy / context：`src/Portal.tsx`、`src/lazy.ts`、`src/ContextProvider.ts`
- Node 兼容现状：`__tests__/node/importInNode.spec.ts`、`src/reactiveDOMState.ts`、`src/StaticHost.ts` 中模块顶层 CAUTION
- data0 契约：`__tests__/data0Contract.spec.tsx`
- 构建与导出：`package.json` `exports`、`vite.prod.config.ts`
- 历史问题模式：`prompt/output/README.md`
- 性能取证：兄弟仓库 `../benchmark`（`benchmark:real`、`heap:snapshot`）

## 测试与运行环境

- 主质量门禁：`npx vitest run`（默认 `vitest.config.ts`：真实 chromium + coverage）、`npm run build`
- Node 门禁：`npx vitest run --config vitest.node.config.ts`
- 监视模式：`npm test`（vitest watch）；本库 `npm start` 无根 `index.html`，不能当应用预览
- 列表 fuzz：`npx vitest run __tests__/rxListFuzz.spec.tsx`
- `npx tsc --noEmit` 存在既有错误，未接入 build/CI；不以它为门禁
- Playwright chromium 需已安装；系统依赖由环境提供
- 任务开始前已失败的检查：由该任务在基线中实测记录，不得用同名旧失败掩盖新原因


### 共同原则

1. **产品结果优先**：下列规范用于促进任务完成，不得为了完善流程文件而延迟主要工作。
2. **证据优先**：涉及代码现状、运行行为或外部接口的判断，应优先使用源码、现有测试、实际命令或最小验证实验。纯逻辑矛盾可以使用准确引用和具体反例证明。
3. **一次处理同类问题**：评审问题必须说明根因和检查范围，并列出该范围内全部同类问题。裁决或修复时应再次检查同类位置并一次处理完毕。
4. **设计不追求完美**：设计阶段只消除会使实施方向失效、目标受损或里程碑不可执行的问题。验证程序仍可加强、局部表述可改善等事项不得单独延长设计循环。
5. **验证采用项目原有体系**：优先使用项目已有测试、合同、运行脚本和真实环境。只有任务确有需要时才增加专用验证程序。
6. **协议版本固定**：本次运行始终使用本文件中的规则，不得在运行中同步其它版本。
7. **会话自主性**：设计、评审、实现和审计分别在独立会话中完成。各会话不得向用户询问如何继续；遇到未明确规定的事项，应依据任务目标、项目原则和已取得的证据作出合理决定，并记录理由。

### 文件和状态

本次运行只要求以下流程文件：

- 设计文档：`docs/ssr-support/ssr-support.md`
- 设计评审：`docs/ssr-support/ssr-support-review.md`
- 实现审计：`docs/ssr-support/ssr-support-audit.md`
- 运行记录：`docs/ssr-support/retro.md`

设计评审和实现审计文件每轮覆盖写入，只保留当前结论。`retro.md` 每轮追加一行简要记录，并在任务终止时补充总结。

设计文档开头必须维护：

```text
status: 设计中 | 实现中 | 已完成 | 不可实现 | 协议失败
design-round: d/15
implementation-round: k/N
current-milestone: M-xx
current-milestone-reopens: r
convergence-mode: normal | domain-review | milestone-review
next-action: <下一实现轮首先完成的具体工作；没有时写“无”>
```

计数规则：

- `d` 由设计裁决轮增加，设计评审轮不增加。
- `k` 由实现轮增加，审计轮不增加。
- `r` 是当前里程碑因实现缺陷从 `待审`退回`开放`的累计次数；验证缺口直接加强后产品仍正确、或里程碑本来就是`开放`时不增加。
- 设计完成时，以初始里程碑数量 `M` 计算 `N = 5 × M`。这是所有里程碑共享的总预算，不设单个里程碑预算。
- 实现中可以调整未完成里程碑，但 `N` 不随拆分或合并而改变。

里程碑状态只有：

- `开放`：尚未完成。
- `待审`：实现轮已取得通过证据，等待独立审计。
- `已完成`：审计轮独立复验通过。

实现轮不得将里程碑标记为 `已完成`。

#### Reopen 与收敛

设计文档中每个里程碑还必须维护 `reopen-count` 和按稳定行为领域归组的 `reopen-domains`。审计确认实现缺陷并将该里程碑从`待审`退回`开放`时，同时更新这些计数。同一审计轮的同一领域只计一次；领域名按根因稳定复用，不得通过改名规避升级。旧任务首次采用本机制且缺少计数时，下一审计轮根据 `retro.md` 中该里程碑真实的`待审`→`开放`记录初始化。

触发规则：

- 同一领域第二次 reopen：`convergence-mode: domain-review`。
- 同一里程碑第三次 reopen：`convergence-mode: milestone-review`。
- `milestone-review` 优先级更高；收敛模式一旦触发，直到里程碑关闭前不得恢复为 `normal`。

触发收敛模式的审计轮必须在当前实现审计文件顶部维护 `## Convergence Note`，不得新增流程文件。Note 只记录尚未闭合的差异，不复制 Task、设计正文或完整历史，并固定为四部分：

1. **Remaining closure map**：未闭合行为领域及当前失败证据。
2. **Root cause and scope**：根因、同类检查范围，以及前轮为何漏检。
3. **Next implementation batch**：按依赖顺序给出下一轮应完成的具体工作和完成条件。
4. **Closure gates**：当前应红、完成应绿以及不得退化的命令。

后续审计覆盖写审计文件时必须保留并更新该 Note，直到里程碑关闭。`next-action` 应简短指向 Note 的下一实施批次；`retro.md` 只记录 reopen 次数、触发领域、收敛模式和关闭轮次。

### 设计文档要求

设计文档应包含：

1. **背景和现状**：只写与任务有关的事实，并给出代码、文档或运行证据。
2. **目标与非目标**：逐项对应 Task 的编号要求。
3. **方案**：只保留一个明确方案，说明关键决策及理由。
4. **里程碑**：按依赖顺序编号为 `M-01..M-N`。
5. **风险与验证安排**：区分设计期必须验证的风险和可以在实现期验证的风险。
6. **基线**：记录任务开始时的 Git revision、工作树状态，以及与本任务相关的已有测试结果。

每个里程碑必须包含：

- 可独立观察的结果。
- 覆盖的 Task 要求编号。
- 前置里程碑。
- `reopen-count` 与 `reopen-domains`，初始分别为 `0` 与空集合。
- 验收命令；如果命令尚不存在，应准确说明实现阶段需要新增的测试或运行入口。
- 最新证据。

里程碑应当是可以运行和验证的阶段性系统状态。第一个里程碑应尽早消除最大的技术不确定性；对于跨组件任务，通常应建立最小端到端链路。

设计阶段采用精简的可执行验收：

- 每个里程碑至少有一个可执行验收入口或明确的待建测试。
- 并发、崩溃、切换、删除、权限和不可逆数据变更等高风险行为，至少提供一个能区分错误实现的负向对照或最小验证实验。
- 不要求为每个断言建立专用 schema、夹具集合或通用断言框架。

### 设计复审条件

只有以下六类问题可以要求下一轮设计评审：

1. **关键事实错误**：方案依赖的技术、接口、代码行为或运行条件与实际不符，可能使方案整体失效。
2. **内部逻辑矛盾**：两项要求不能同时满足、关键路径不可达，或里程碑按设计无法通过验收。
3. **违反项目原则**：方案违反项目权威规则中的架构职责、数据原则或工程约束。
4. **违反任务目标**：方案偏离 Task 的目标、范围或硬性约束。
5. **里程碑不可执行**：里程碑过大、依赖顺序错误、验收不明确，或明显不能在合理实现轮次内完成。
6. **必须提前验证的重大风险**：该风险无法在实现环境中及时验证，若推迟会使后续实现整体失效。

验证还可以更严格、测试还可以增加、资料性说明可以改进、局部命名可以优化等问题，均不得单独触发下一轮设计评审。

若同一设计领域第二次出现需要复审的问题，裁决轮不得继续逐句补充说明。应根据问题性质，将完整行为整理为状态表、真值表、参考函数、结构化清单或最小契约测试，并一次检查全部输入情况。

### 运行记录

任务终止时，`retro.md` 只记录可核对事实：

- 终止状态和原因。
- 设计轮数、实现轮数及各里程碑最终状态。
- 设计阶段采纳的问题类别。
- 审计发现的实现缺陷数与验证缺口数。
- 各里程碑 reopen 次数、重复领域、收敛模式及关闭轮次。
- 自动调整里程碑的次数和原因。
- 是否发生人工介入；按本文件正常运行时应为 0。
- 预算是否满足，以及未完成任务的明确阻塞。
- 对协议的改进建议，最多三项，并说明对应证据。

---

## Task 1 axii 服务端渲染（SSR）与客户端激活（hydration）

axii 目前是纯浏览器框架：`createElement`（`src/DOM.ts`）直接构造真实 DOM，`createRoot(element).render()`（`src/render.ts`）是唯一渲染入口，全部 Host（`src/createHost.ts` 分发，AtomHost / ComponentHost / FunctionHost / RxListHost / StaticHost / StaticArrayHost）在渲染与更新中直接调用 `document.*` 原语并以 Comment/Text placeholder 作区域锚点。既有的 Node 兼容约定只到「import 不崩」为止：模块顶层不得触碰浏览器全局（BUG 7 回归 `__tests__/node/importInNode.spec.ts`；`src/StaticHost.ts` 中 CAUTION「模块顶层不能碰 document……SSR/工具链场景」），`vitest.node.config.ts` 提供 Node 环境测试配置；但任何渲染动作在无 DOM 的 Node 进程中都无法执行，框架没有任何服务端渲染或激活能力。

本任务为 axii 增加 SSR 支持：服务端把组件树渲染为 HTML 文本，客户端在该 HTML 上原地激活，接管为与纯 CSR 行为一致的完全体应用。

### 要求

1. **服务端渲染**：在纯 Node 进程（无浏览器、无任何 DOM 全局注入）中把组件树渲染为完整 HTML 文本。覆盖框架公开渲染能力全集：静态元素与属性/样式、atom/computed 驱动的文本与属性、RxList/RxMap/RxSet 驱动的列表、函数节点（条件渲染）、组件嵌套与 context（`createContext`/`ContextProvider`）、Fragment，以及 `Portal` 与 `lazy`（两者的服务端语义按第 11 条开放点裁定后纳入覆盖面）。输出必须反映渲染时刻全部响应式数据的当前值。
2. **客户端激活（hydration）**：提供在服务端 HTML 上激活的公开入口——复用服务端产出的 DOM 节点（禁止整树丢弃重建）、绑定事件、建立全部响应式绑定与 Host 树。激活完成后与同一组件树、同一数据的纯 CSR 渲染行为完全一致：后续 atom 更新、列表增删移、组件销毁/重建、`root.destroy()` 清理、retained-object 计数归零（`src/retainedObjectDiagnostics.ts` 口径）等既有语义全部保持。
3. **可机械验证的复用与等价**：「复用而非重建」必须可机械验证（节点 identity 级证据）；SSR 输出经浏览器解析后的 DOM 与激活后 DOM、以及与纯 CSR 首帧 DOM 的等价性必须可机械比对。
4. **不匹配行为有定义**：服务端 HTML 与客户端组件树/数据不一致（版本漂移、数据漂移、HTML 被篡改）时的行为必须显式定义且可观测；dev 期诊断遵循 `isAxiiDiagnosticsEnabled()` / `__DEV__` 零生产成本约定，不得静默产出错误 DOM。
5. **服务端生命周期语义**：明确定义并实现浏览器专属能力在服务端渲染期的行为——事件绑定、effect / layoutEffect / ref（「可以测量 DOM」语义的回调在服务端不得执行）、`reactiveDOMState`（RxDOMSize 等）、Portal、样式系统；激活侧按既有语义补齐（attach / layoutEffect 时序与 CSR 一致）。服务端一次渲染结束后不得遗留活跃的响应式订阅、计时器或跨请求全局累积（同进程多次渲染无泄漏、可并发）。
6. **样式等价**：StaticHost 的样式能力（style 对象、伪类/嵌套/@规则经 `document.adoptedStyleSheets` 承载的部分，见 `src/StaticHost.ts`）在 SSR 输出中必须有等价承载；激活后样式效果与纯 CSR 一致、激活过程无样式闪变，且激活后的样式生命周期（复用计数、卸载清理）回到既有语义。
7. **HTML 生成安全**：SSR 的文本与属性输出必须有明确的转义条款（含 `dangerouslySetInnerHTML` 的边界语义，见 `src/DOM.ts`），注入类风险必须以可执行验证覆盖。
8. **CSR 性能硬约束**：SSR 支持不得在 CSR 热路径（`createHost` 分发、`LightBindingEffect` 属性更新、atom 文本更新、`RxListHost` patch）引入每实例闭包、每次调用分配或常驻检查；纯 CSR 的性能与常驻内存以 sibling `../benchmark` 仓库口径无回归。
9. **API 与产物**：SSR 与激活以最小公开 API 交付（入口命名与形态由设计裁定，逐项审视必要性）；`package.json` exports、dist 构建产物与类型声明完整覆盖新入口；`__tests__/node/importInNode.spec.ts` 回归保持通过。
10. **质量门禁**（任务完成与各实现里程碑关闭时不得新增失败）：
    a. `npx vitest run`（真实浏览器全量回归）；
    b. `npm run build`（构建与类型产物）；
    c. `npx vitest run --config vitest.node.config.ts`（Node 环境回归）；
    d. `npx vitest run __tests__/rxListFuzz.spec.tsx`（本任务若触及 host 区域 / DOM 锚点逻辑，fuzz 为必跑门禁）。
11. **开放点**（交设计循环裁定并落为明确条款，不得含糊带过）：
    a. `lazy` / 异步内容在服务端的边界语义（同步渲染 fallback、等待加载完成、或显式不支持及其报错语义）；
    b. 流式输出（renderToStream 类能力）是否纳入本任务范围；
    c. 服务端到客户端的应用状态传递（dehydrate / serialize 约定）纳入范围还是明确为非目标；
    d. SSR 场景下 `Portal`（目标容器不在被序列化的树内）的语义。


请先完成设计，不要实施生产代码。任务特定说明：

1. data0 是兄弟系统（peerDependency，响应式核心）：凡依赖其非文档行为（computed 求值时机、依赖收集与 rerun 时序、triggerInfo 形状、销毁后是否仍被源持有等），先在 `__tests__/data0Contract.spec.tsx` 或 `__tests__/node/` 下的契约用例中实验求证。若 SSR 需要 data0 自身语义变更，应把该变更冻结为独立前置问题并给出证据，禁止在本设计中规定 data0 内部实现。
2. HTML/DOM 经验性事实一律先实验求证、不凭记忆断言：HTML 解析器对注释与空白文本的保留/合并规则、特殊嵌套（table / select / optgroup 等）的规范化、浏览器解析 SSR HTML 所得 DOM 与 `createElement` 构造树的差异、布尔属性与属性值转义、constructable stylesheet（`document.adoptedStyleSheets`）与 `<style>` 的等价性。hydration 相关行为与时序只信真实浏览器（Vitest browser mode + Playwright chromium）；jsdom 类模拟环境的结果不得作为任何断言的证据。
3. 写方案前应调研同类无 Virtual DOM 框架（如 SolidJS、Svelte 5）公开的 SSR / hydration 语义与已知坑（锚点、标记、不匹配处置、流式边界），仅作背景输入，不预设 axii 采用相同方案。
4. 证据环境：SSR 侧证据必须来自真实 Node 进程；端到端（服务端产出 HTML → 浏览器解析并激活 → 响应式更新生效）必须在「独立 Node 进程 + 真实浏览器」链路上取证。优先扩展既有 Vitest 浏览器 / Node 配置；只有现有体系不足时才新增专用验证入口。
5. 本任务在既有源码上直接演进：不保留兼容分叉、不做渐进迁移方案。为 SSR 调整 Host / DOM 层内部形态时，CSR 既有行为以全量浏览器测试与 benchmark 口径为准。
6. 第一个里程碑应尽早消除最大技术不确定性，通常是「纯 Node 产出可解析 HTML + 浏览器激活后与 CSR 行为对齐」的最小端到端链路；后续里程碑按依赖切开覆盖样式、列表、失配、生命周期与泄漏等。
7. 设计阶段只消除会使实施方向失效或里程碑不可执行的问题；不要为了完善通用断言库、夹具框架或资料性附录而延长设计循环。


执行本 Task 时：

1. 调研任务要求、项目规则、相关源码和测试。
2. 对会影响整体方案的未知事实执行最小验证实验。
3. 创建设计文档，初始化状态为 `设计中`、`design-round: 0/15`、`implementation-round: 0/0`、`current-milestone-reopens: 0`、`convergence-mode: normal`。
4. 建立里程碑，状态全部为 `开放`，`reopen-count: 0`、`reopen-domains` 为空。
5. 只完成设计和必要的验证实验，不编写生产实现。
6. 覆盖写入 `retro.md` 的运行标题和生成印记。
7. 不要执行下面任何 additional task。使用 `Please execute docs/ssr-support/ssr-support-task.md Task 1 additional task 1.` 作为 prompt 启动一个新的 chat，只要启动你自己就可以结束了，不需要等待。**使用 `prompt/skill/new-cursor-agent-session.md` 中的方法来启动新的 chat。**

### additional task 1

你是独立设计评审者。完整阅读 Task 1、当前设计、项目规则和必要的代码；在形成全部结论前，不读取旧版评审内容或归档运行。遵守「设计复审条件」及以下流程：

1. 逐项检查「设计复审条件」的六类问题。
2. 涉及可验证事实时，亲自读取代码、运行现有测试，或编写最小验证实验。不得仅以概括性文字代替可以执行的证明。
3. 每个问题按根因归组，写明：
   - 类别；
   - 设计位置；
   - 被违反的要求或项目原则；
   - 证据；
   - 同类检查范围和全部命中；
   - 必须完成的修正；
   - 修正完成的验证方式。
4. 只把符合六类复审条件的问题列为「需要复审的问题」。其它有价值的意见列为「实现注意事项」，不得影响评审结论。
5. 覆盖写入 `docs/ssr-support/ssr-support-review.md`，结论只能是：
   - `通过`
   - `需要修订`
   - `目标不可实现`
6. 不修改设计文档。
7. 使用 `Please execute docs/ssr-support/ssr-support-task.md Task 1 additional task 2.` 作为 prompt 启动一个新的 chat，只要启动你自己就可以结束了，不需要等待。**使用 `prompt/skill/new-cursor-agent-session.md` 中的方法来启动新的 chat。**

### additional task 2

你是设计裁决者。深度理解 Task 1 和原设计 `docs/ssr-support/ssr-support.md`，然后逐条核验 `docs/ssr-support/ssr-support-review.md` 中的问题，不得直接接受评审结论。遵守「设计复审条件」及以下流程：

1. 对每个问题复核证据和复审类别。
2. 采纳问题时，按同一根因检查相关设计和代码范围，并一次修正全部同类位置。
3. 驳回问题时，给出源码、测试、项目规则或逻辑推演证据。
4. 对第二次出现问题的同一设计领域，按「设计复审条件」的要求改用完整、有限的表达形式。
5. 更新设计文档，并执行所有设计期验收命令和最小验证实验。
6. `d` 增加 1；向 `retro.md` 追加一行：轮次、评审结论、采纳的问题类别、主要证据和下一步。
7. 按顺序评估并执行（只走命中的第一条分支）：
  - 若有充分证据证明 Task 的核心目标在当前技术、权限或运行环境下不可实现：设置 `status: 不可实现`，在 `retro.md` 写明证据后终止，不启动新的 chat。
  - 若本轮没有采纳任何「需要复审的问题」：设计通过。设置 `status: 实现中`，以初始里程碑数计算 `N = 5 × M`，然后使用 `Please execute docs/ssr-support/ssr-support-task.md Task 1 additional task 3.` 作为 prompt 启动一个新的 chat，只要启动你自己就可以结束了，不需要等待。**使用 `prompt/skill/new-cursor-agent-session.md` 中的方法来启动新的 chat。**
  - 若有采纳问题且 `d < 15`：使用 `Please execute docs/ssr-support/ssr-support-task.md Task 1 additional task 1.` 作为 prompt 启动一个新的 chat，只要启动你自己就可以结束了，不需要等待。**使用 `prompt/skill/new-cursor-agent-session.md` 中的方法来启动新的 chat。**
  - 若 `d = 15`：完成一次全局修订和六类条件自检。不存在已知阻塞问题时按上面的设计通过分支进入实现；仍存在已知阻塞问题时设置 `status: 协议失败`，记录原因并终止，不启动新的 chat。不得自行提高预算或要求用户选择方案。

### additional task 3

你是实现者。深度理解并实施 `docs/ssr-support/ssr-support.md`。你是实现循环中的**实现轮**，与 additional task 4 的**审计轮**交替执行。严格遵守以下流程：

1. 首先读取 `next-action`。内容不是「无」时，必须先完成该项工作；只有证据证明它不再适用时才可改写。若 `convergence-mode` 不是 `normal`，还必须先读取当前审计文件的 `Convergence Note`，按其 `Next implementation batch` 顺序推进。
2. 只推进编号最小的未完成里程碑。完成该里程碑所必需的测试、脚本、环境配置和缺陷修复均属于本轮范围。
3. 优先复用项目测试体系。修复真实缺陷时，先建立能够失败的复现，再修复并运行通过。
4. 实现中发现设计事实错误时，可以修订当前及后续未完成里程碑、拆分或重排工作，但不得删除 Task 要求，不得增加总预算 `N`。
5. 执行当前里程碑的验收。通过时标记为 `待审`并记录命令、结果和证据；未通过时保持 `开放`并记录具体阻塞。收敛模式下必须先通过 `Convergence Note` 的全部 Closure gates，不能以只完成部分批次为由标记`待审`。
6. 执行受本轮修改影响的项目基础检查。任务开始前已经失败的检查以基线记录为准；不得新增失败，也不得以同名旧失败掩盖不同的新原因。
7. `k` 增加 1，更新 `implementation-round: k/N`。
8. 不得把里程碑标记为 `已完成`。
9. 本轮结束时**一律**使用 `Please execute docs/ssr-support/ssr-support-task.md Task 1 additional task 4.` 作为 prompt 启动新的 chat（无论你认为完成与否，都交给审计轮判定，不再自行连续启动 additional task 3）。只要启动就可以结束，不需要等待。**使用 `prompt/skill/new-cursor-agent-session.md` 中的方法来启动新的 chat。**

### additional task 4

你是独立实现审计者。深度理解 `docs/ssr-support/ssr-support.md` 并对实现进行对抗性 review。你是实现循环中的**审计轮**，与 additional task 3 的**实现轮**交替执行。不得信任里程碑状态或实现者的结论。按以下顺序执行：

1. 复验当前里程碑的验收命令，并复验本轮修改可能影响的已完成里程碑。
2. 对照 Task 要求、设计和代码差异审查真实实现。阻塞性问题必须附可复现失败、测试输出或明确的代码证据。
3. 对每个真实缺陷执行同类检查，列出相关范围内全部同类位置。
4. 区分两类问题：
   - **实现缺陷**：产品行为不符合设计或 Task。建立失败复现，将里程碑恢复为 `开放`。
   - **验证缺口**：现有验收可能放过错误实现，但当前产品实现未被证明错误。审计轮应直接加强测试或验收，完全还原临时缺陷注入，再立即复验。复验通过时里程碑继续关闭，不得仅因验证加强而退回实现轮。
5. 对高风险行为可以使用缺陷注入检验，但只应移除、短路或替换生产路径以验证测试的判别能力；不得制造虚假的生产副作用来满足测试。
6. 同一验证领域连续两轮出现缺口时，停止逐项增加条件：有限领域应一次列全并对照权威来源；开放行为领域应改用实际执行和因果观测。
7. 对实现缺陷使用稳定的行为领域名归组；若本轮将里程碑从`待审`退回`开放`，`reopen-count` 增加 1，本轮每个命中的 `reopen-domains` 各增加 1，再按「Reopen 与收敛」判断是否触发收敛模式。纯验证缺口和原本就是`开放`的里程碑不计。
8. 处于收敛模式时，不得只审最新 diff；`domain-review` 检查完整领域，`milestone-review` 检查整个里程碑，并创建或更新四段式 `Convergence Note`。
9. 覆盖写入 `docs/ssr-support/ssr-support-audit.md`。
10. 按审计结论更新状态：
  - 验收通过且没有实现缺陷：将 `待审`里程碑标记为 `已完成`，`next-action` 写「无」。
  - 存在实现缺陷：将里程碑标记为 `开放`；若原状态为`待审`则增加 reopen 计数。普通模式在 `next-action` 写明具体修改、失败命令、涉及位置和完成条件；收敛模式则令 `next-action` 指向 `Convergence Note` 的下一实施批次。
  - 当前里程碑原本为 `开放`且实现轮未取得通过：给出明确诊断和下一步，不得只写一般性建议。
11. 按顺序评估并执行（只走命中的第一条分支）：
  - 全部里程碑已完成：执行一次最终核验（全部里程碑验收命令、Task 要求逐项检查以及项目要求的基础测试）。全部通过后设置 `status: 已完成`，按「运行记录」完成 `retro.md` 并终止，不启动新的 chat。
  - 未完成且 `k < N`：使用 `Please execute docs/ssr-support/ssr-support-task.md Task 1 additional task 3.` 作为 prompt 启动一个新的 chat，只要启动你自己就可以结束了，不需要等待。**使用 `prompt/skill/new-cursor-agent-session.md` 中的方法来启动新的 chat。**
  - 未完成且 `k >= N`：若有证据证明核心目标不可实现，设置 `status: 不可实现`；否则设置 `status: 协议失败`。按「运行记录」完成 `retro.md` 后终止，不启动新的 chat。不得自行增加预算或要求用户决定下一步。
