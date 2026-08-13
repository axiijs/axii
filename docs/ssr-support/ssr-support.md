status: 已完成
design-round: 15/15
implementation-round: 28/45
current-milestone: M-06
current-milestone-reopens: 7
convergence-mode: milestone-review
next-action: 无

# axii SSR 与客户端激活 — 设计文档

## 1. 背景和现状

### 1.1 事实（有源码/测试证据）

- axii 是无 Virtual DOM 的 CSR 库：`createElement`（`src/DOM.ts`）直接 `document.createElement*`；唯一公开渲染入口是 `createRoot(element).render()`（`src/render.ts`）。
- Host 分发在 `src/createHost.ts`；AtomHost / FunctionHost / ComponentHost / RxListHost / StaticHost / StaticArrayHost / EmptyHost / PrimitiveHost 均以 Comment/Text placeholder 为区域锚点，渲染与更新直接调用 DOM 原语。
- **动态文本占位**：`createElement` 对 `typeof child === 'function'`（含 atom）使用 **`document.createTextNode('')`**，不是 Comment（`src/DOM.ts` ~723–726）。`AtomHost` 在 Text 占位上原地写 `nodeValue`。CSR 此路径**没有**边界注释。
- 样式：`StaticHost.StyleManager` 用 constructable `CSSStyleSheet` + `document.adoptedStyleSheets`；静态 id 由组件 path 生成，动态路径使用 `R${Math.random()...}`（`src/StaticHost.ts`）。
- Portal：`Portal` / `createPortal` 的 `container` 类型为 `HTMLElement`；构造期 `createRoot(container)` 并读 `container.isConnected`（`src/Portal.tsx`、`src/types.ts`）。
- Node 兼容只到 import：`__tests__/node/importInNode.spec.ts`（BUG 7）；模块顶层不得碰 `document`（CompactElementHost CAUTION）。`vitest.node.config.ts` 提供 Node 配置。当前**没有任何** `renderToString` / `hydrate` API。
- `package.json` exports：主入口 + `jsx-runtime` + 独立 `vite-plugin`；SSR 入口尚不存在。
- data0 为 peerDependency `^2.16.0`；本环境存在兄弟 `../data0/src`。抽样：`computed` 创建时即求值；SSR 设计**不**要求修改 data0 内部实现。

### 1.2 设计期验证实验（2026-08-06，证据目录 `docs/ssr-support/experiments/`）

| 命题 | 结果 | 设计含义 |
|---|---|---|
| 纯 Node 无 `document` / `HTMLElement` / `CSSStyleSheet` | 成立（`adjudication-d1-facts` + Node 复验） | 禁止依赖注入式 DOM 垫片作为主路径；SSR 走字符串序列化独立路径；Portal 容器在 Node 侧不得要求真实 `HTMLElement` |
| HTML 注释保留；注释可切开相邻文本 | Chromium 保留 | SSR **可发出**瞬态边界注释防合并；激活后按 §3.2.1 B3 **删除**，不能当 Host 锚长期保留 |
| 相邻纯 Text 节点 HTML 往返合并 | `hello`+`world` → `innerHTML==="helloworld"`，解析后 **1** 个子节点（d1/d2） | CSR 相邻 Text 占位 ↛ HTML 保形；见 §3.2.1 |
| `<!--axii:t-->…<!--axii:/t-->` 切开文本 | 解析后文本分离（d1 曾用闭标记 `/`；d2 契约收窄为 `axii:/t`） | 边界仅服务 HTML 往返 |
| 认领后删除边界 | 相邻 Text **仍分离**；identity 可保留（`adjudication-d2-facts`） | 激活稳态不得保留边界 |
| 仅删 Text、保留边界 | 留下孤儿 Comment（d2） | 保留策略与 Host.destroy 矛盾 |
| 保留边界 + 只搬移 Text（RxList 语义） | 开/闭标记与文本错位（d2） | 保留策略与列表搬移矛盾 |
| `Text + Comment + Text` HTML 往返 | 解析后仍三节点、文本不合并（d2 `listShape`） | 已有 CSR 语义 Comment 分隔时可不强制包边界 |
| 空 Text / `<!--axii:t--><!--axii:/t-->` | 空串不进入 `innerHTML`；开闭对解析后**无**中间 Text（review-d3 / d3） | 禁止用开闭对表达空单元；改用 `<!--axii:0-->` |
| `<!--axii:0-->` 往返与插入 Text | 解析为 1 Comment；hydrate 插入 `Text('')` 后删哨兵可更新/销毁/并列（d3） | 空文本唯一编码 |
| textarea/style 内 `axii:t`/`axii:0` | 成为**字符数据**，不是 Comment（review-d3 / d3） | RCDATA/RAWTEXT **禁止**文本标记 |
| Comment-placeholder 空文本 CSR | DOM=`Text('')`+`Comment`；`innerHTML` **仅**剩结构 Comment（d4） | 空列表行 SSR **只发**结构 Comment；hydrate 插入 Text（对标 AtomHost.replace），**不**用 `axii:0` |
| E4 只认领 Text、不认领结构 Comment 后 reorder | 结构 Comment 与 Text 错位（d4 `wrongE4AfterReorder`） | hydrate 必须 `element=Text`、`placeholder=结构 Comment`；区间搬移含两端 |
| 省略 `axii:0`、仅结构 Comment 的 Comment-ph 空行 hydrate+reorder | 配对保持（d4 `omitAxii0*`） | Comment-ph 空单元契约 |
| RAWTEXT 含字面 `</style>`/`</script>` | 元素提前关闭；`&lt;…>` 不解码（d4） | 转义表分行；终止序列 **SSR 抛错**（§3.6.1） |
| RCDATA textarea 实体 | 解码后可得 `</textarea>` 字面（d4） | textarea 继续 `& < >` 实体转义 |
| `createElement` 拼 table+tr **不**插入 tbody；同 HTML 字符串经解析**会**插入 tbody | 形状不等价 | SSR 必须按「解析后树」发码；机械等价需规范化；hydrate 对着解析后 DOM 认领 |
| table 直接子注释可能被解析挪进 tbody | `tableCommentsDirect` | 列表锚点在 table 场景须落在显式 tbody 内 |
| `p>div` / `table>div` 被修复 | 结构变化 | 非法 HTML 视为用户错误，失配规则覆盖 |
| createElement 树 vs 同构 HTML（comment+text+span） | 形状相等 | 非相邻纯文本、非 table 特殊标签上「字符串 ↔ DOM」可行 |
| `disabled="true"\|""\|presence` | `.disabled===true` | SSR 与 CSR 对齐写出 `disabled="true"` |
| 表单 IDL → HTML（有限表，见 §3.6.2） | input value 属性；textarea **子文本**；option `selected`；checkbox/radio `checked`；**checkbox `value={v}` 双通道** | 见 §3.6.2；**不得**对 checkbox `value` 只发 `checked`；**不得**对 textarea 写 value 属性冒充 |
| checkbox `value={true}` vs 仅 `checked` | CSR outer 含 `value="true" checked="true"`；仅 `checked="true"` 解析后 `.value==="on"` ≠ CSR | d8 / review-d8；§3.6.2 CB 表 |
| checkbox `value`+`checked` 同元素 | deferred 按 props 键序先后应用；后者覆盖 `.checked`；有 `value` 时始终发 value 属性 | d8 `orderWins` |
| FunctionHost Text-ph 结构态 CSR | `[内容…, <!--computed node-->, Text('')]`；`innerHTML` **丢失**尾空 Text | review-d9 / d9 |
| 结构后发 `<!--axii:0-->` 再 hydrate 插入 Text | 与 CSR 同形；`Text===FunctionHost.placeholder`；可切回文本；destroy 无孤儿 | d9 |
| 省略尾 `axii:0` | 解析后无 Text placeholder 位点 | d9 `omitSentinel` |
| Comment-ph 结构（`computed`+`rx list item`）往返 | 形状保持（**不能**代替 Text-ph 结构） | d9 / review-d9 |
| Root 函数结构 `computed`+`root` | HTML 往返 **preserved**；与 FTS（丢尾空 Text）不同 | review-d10 / d10 |
| 省略 `<!--root-->` vs CSR | 形状 **unequal**；含 `<!--root-->` 则等价 | d10 `omitRootVsCsr` / `withRootEqualsCsr` |
| 对 root 误套 FTS（`axii:0`→插入 Text） | 得尾 Text ≠ CSR `<!--root-->` | d10 `wrongFtsOnRoot` |
| StaticArray 函数项结构 | `computed`+`array item`；误发 `rx list item` ≠ CSR | d10 `arrayFnStructure` / `g3LiteralMismatch` |
| Root 上空文本 | `innerHTML` 仅 `<!--root-->`（空 Text 丢失） | d10 `rootFunctionEmptyText` |
| 嵌套 `computed` 作 placeholder | `computed`+`computed` 往返保持 | d10 `nestedComputedAsPlaceholder` |
| `adoptedStyleSheets` vs `<style>` | 等价；迁移无闪变 | SSR 用 `<style>`；hydrate 先挂 adopted 再撤 tag |
| StaticArrayHost 相邻 `directNodes` 文本 | CSR 两 Text + `unhandledChild`；`innerHTML` 合并为 1 Text；`axii:t` 包后 strip 可恢复（review-d5 / d5） | 非 Host 文本须独立子表；假扮 AtomHost 禁止 |
| StaticArrayHost 空 `directNodes` | `['']` / `['','world']`：空 Text 不进 HTML；须 `axii:0`（与 Comment-ph 空「只发结构 Comment」不同）（d5） | DirectNodes 空单元走 `axii:0` |
| 样式值 `}` 逃逸 | `insertRule` 拒绝多规则串；同串写入 `<style>` 得 ≥2 条规则并可改 `body`（review-d5 / d5） | SSR 样式载荷须 per-rule 门闩（§3.6.1），不得只靠 `</style` |
| 门闩后 omit 逃逸规则 | 对偶 `insertRule` 跳过：只保留可单条插入的规则 → HTML 无 `body` 注入（d5 `gatedOmitsBreakout`） | 与 CSR skip 对齐 |
| `createElement` 多参静态文本 | 两 Text、`unhandledCount===0`；**非** DirectNodes、**非** Text-ph（review-d6 / d6） | 第四种：**ElementChildText** |
| 元素子静态相邻 / 空兄弟 | HTML 合并或丢空；A2/`axii:0` 可恢复；认领后仍为元素子 Text（d6） | 禁止并入 DirectNodes 或 Text-ph |
| 单 child 空串 `textContent` | CSR **0** 子节点（d6 `singleEmptyTextContent`） | ElementChildText 单空：不发 `axii:0` |
| M-01 `static-`+atom 无标记 | 合并为 1 Text；包边后静态半侧仍为元素子（d6） | 静态半侧 = ElementChildText |
| RxList 单元素行 Compact | CSR：`span,span,unhandledChild`；**无** `rx list item`；`hostLastNode===element`；reorder 仍无行 Comment（d7） | §3.2.3 Compact-row；禁止误发行 Comment |
| RxList atom 行 Comment-ph | `Text,rx list item,…`（d7） | 非 Compact；仍走 Comment-ph |
| RxList 函数返回元素 | `span,computed node,rx list item,…`（d7） | 非 Compact（item 是 Function） |
| RxList 混 `detachStyledChildren` | 有 flag 的元素 → 有 `rx list item`；无 flag → Compact（d7） | 门闩与 `createChildHost` 对齐 |
| 误对 Compact 发 `rx list item` | 与 CSR 形状不等价（d7 `compactEqualsWrong: false`） | 否决 |
| Solid / Svelte 5（背景） | 注释/标记锚定；失配可重建 | 仅背景；axii 用自身 Host/placeholder + §3.2 文本边界策略 |
| `root.render(null)` / Component→null | `<!--empty--><!--root-->`（EmptyHost.**element**） | ≠ `() => null` 文本空；≠ A1c |
| RxList `[null,null]` | `<!--empty--><!--rx list item-->`×2；无 `computed` | A1c-only / FCS-computed SSR 均 ≠ CSR（d11） |
| RxList 组件行 / Fragment 行 | 无 `computed node`；Fragment 有 `fragment start` | G3 ≠ 一律 FCS |
| RxList 函数返回元素 | 有 `computed node` + `rx list item` | **仅**此为 G3-F / FCS |
| RxList 函数返回 null/false/非空串 | `#text` + `rx list item`；HTML 空时仅结构 Comment；**无** `empty`、**无** `computed` | **G4-F** Comment-ph；≠ G3-E；≠ G3-F（d12） |
| 误套 G3-E / FCS 于 Function→null | `equalCsr===false`（d12 `wrongG3e*` / `wrongFcs*`） | 否决 |
| 外层 `RxList([innerRxList])` | `1<!--rx list item-->2<!--rx list item--><!--rx list item--><!--unhandledChild-->`；**无** computed/empty；splice 内层后外层锚保留（d13 / review-d13） | **G3-RL**；≠ G3-F/G4 |
| `reusable()` 作 RxList 行 | `<div>…</div><!--reusable--><!--rx list item-->`（d13） | **G3-RU**；≠ Compact/FCS |
| Function→atom Text-ph | `world<!--computed node-->` + 尾空 Text；SSR 须 `…computed…<!--axii:0-->`（d14） | **FTS**；≠ Text-ph 文本态；口语「元素/Fragment」闭集否决 |
| Function→string Text-ph | 仅 `#text`；无 computed（d14） | Text-ph |
| Function→atom / →null RxList 行 | G3-F 有 computed；G4-F 无 empty/computed（d14） | 与 §3.2.0 矩阵同侧 |

### 1.3 基线

- Git revision：`ff36af096a938ed66178e61be7de6706ab136daa`
- 工作树：仅未跟踪 `docs/`、`prompt/skill/`、设计期实验/评审规格测试；`src/` 无本任务改动
- `npx vitest run --config vitest.node.config.ts`：2 files / 6 tests **通过**（设计初稿与 d1–d14 裁决轮均复验）
- 全量浏览器门禁与 `npm run build` 在实现里程碑关闭时执行；设计阶段未宣称其基线绿/红以外的结论

### 1.4 裁决轮修订记录

**d1**：采纳评审 P1/P2/P3（类别 1；P2 兼 2；P1 兼 4/5）。驳回项：无。修正：§3.2 文本边界发出策略初稿、§3.3.d Portal 真值表、§3.6 表单序列化有限表、§3.8 API、M-01/M-02/M-05。证据：`experiments/adjudication-d1-facts.json`。

**d2**：采纳评审 P1（类别 2，兼 1 / 里程碑可执行性）。驳回项：无。「SSR 文本边界」同域第二次复审 → 按协议改写为 §3.2.1 **完整有限契约**（发出表 + 生命周期表 + 所有权不变量），废除「保留边界注释作区间锚」。证据：源码 `AtomHost`/`RxListHost`/`DOM.insertBefore` + `experiments/adjudication-d2-facts.json`（Chromium）。

**d3**：采纳评审 P1（类别 1，兼 2）。驳回项：无。「SSR 文本边界」同域第三次 → 将 §3.2.1 扩成父类 × 空/非空 **完整有限契约**：空单元唯一哨兵 `<!--axii:0-->`（禁止空开闭对）；RCDATA/RAWTEXT 禁止一切文本标记并与 §3.6.2 互斥；identity 区分认领 vs 插入。同步 M-01/M-02/M-03。证据：`AtomHost`/`FunctionHost`/`PrimitiveHost` stringValue 空串语义 + `experiments/adjudication-d3-facts.json`（及 review-d3）。

**d4**：采纳评审 P1（类别 1，兼 2/5）、P2（类别 1，兼 4）。驳回项：无。「SSR 文本边界 / Host 区间」同域第四次 → §3.2.1 按 **placeholder 种类**拆成完整有限子表（Text-ph vs Comment-ph）；Comment-ph 空单元只发结构 Comment、hydrate 插入 Text；废除 E4「一律 `placeholder===element===Text`」。§3.6.1 / A3 按 NORMAL/RCDATA/RAWTEXT/`<style>` 载荷分行；RAWTEXT 与 SSR style 载荷对终止序列 **抛错**。同步 M-01/M-03。证据：`AtomHost`/`RxListHost`/`PrimitiveHost`/`FunctionHost`/`StaticArrayHost` + `experiments/adjudication-d4-facts.json`（及 review-d4）。

**d5**：采纳评审 P1（类别 1，兼 2/5）、P2（类别 1，兼 4）。驳回项：无。「SSR 文本边界」同域第五次 → §3.2.1 增补 **DirectNodes** 完整有限子表（发出位点→种类映射；空单元 `axii:0`；禁止假扮 AtomHost）；§3.6.1/§3.5 增补与 CSR `insertRule` 对偶的 **CSS 规则逃逸门闩**（不合格规则 omit，禁止写入 HTML）。同步 M-02/M-04。证据：`StaticArrayHost.ts`/`StaticHost.ts` + `experiments/adjudication-d5-facts.json`（及 review-d5）。

**d6**：采纳评审 P1（类别 1，兼 2/5）。驳回项：无。「SSR 文本边界」同域第六次 → §3.2.1 钉死 **四种**发出种类有限集（Text-ph / Comment-ph / DirectNodes / **ElementChildText**）；废除「JSX 静态 sibling ≡ DirectNodes」；补 ElementChildText 空/非空 A/B/E 与 Identity；修正例 C 与 M-01「静态文本 + atom」。证据：`DOM.ts` createElement 子路径 + `experiments/adjudication-d6-facts.json`（及 review-d6）。

**d7**：采纳评审 P1（类别 1，兼 2/5）。驳回项：无。「RxList 行 Host 发出」同域第一次 → 新增 §3.2.3 **完整有限契约**（Compact-row vs 非 Compact；门闩与 `createChildHost` 逐条件对齐）；修正 §3.2.1 发出表对「RxList 行一律 Comment-ph」的错误穷尽声称与 F12；同步 M-03。证据：`RxListHost.ts`/`CompactElementHost` + `experiments/adjudication-d7-facts.json`（及 review-d7）。

**d8**：采纳评审 P1（类别 1，兼 2）。驳回项：无。「表单 IDL → SSR HTML」同域第二次（d1 引入有限表后）→ 废除 §3.6.2「checkbox `value={truthy}` 同 checked 行」；改写为 **完整有限契约**（通道拆分、CB `value` 矩阵、deferred 组合序、与 radio/text/textarea/select 互斥边界）；同步 M-02。证据：`DOM.ts` setAttribute value/checked + `experiments/adjudication-d8-facts.json`（及 review-d8）。

**d9**：采纳评审 P1（类别 1，兼 2/5）。驳回项：无。「SSR 文本边界」同域第七次 → 新增 §3.2.4 **FunctionHost-TextPh-Structure（FTS）完整有限契约**（发出序、hydrate、identity、与文本态 Text-ph / G3 Comment-ph 互斥）；修正发出位点表；同步 M-02「条件结构」验收。证据：`FunctionHost.ts`/`DOM.ts` + `experiments/adjudication-d9-facts.json`（及 review-d9）。

**d10**：采纳评审 P1（类别 1，兼 2/5）。驳回项：无。「FunctionHost Comment-ph 结构 / Root」同域第一次（FunctionHost 结构矩阵在 d9 FTS 之后的 Comment 半侧）→ 废除 H4「一律 ⇒ G3」；新增 §3.2.5 **FCS** 完整有限契约（发出序 `…computed→<!--{placeholder.data}-->`；禁尾 `axii:0`）；钉死 Root：`renderToString` html **含**尾 `<!--root-->`，`hydrateRoot` **认领**（方案 A）；G3 **仅** RxList；同步发出表 / Identity / M-01 / M-02。证据：`render.ts`/`FunctionHost.ts`/`StaticArrayHost.ts` + `experiments/adjudication-d10-facts.json`（及 review-d10）。

**d11**：采纳评审 P1（类别 1，兼 2/5）。驳回项：无。「RxList 行 Host 发出」同域第二次 → 废除 G3「一律 = FCS」；将非 Compact 结构行拆成 **G3-F/C/Fr/A/E** 完整有限子表；新增 §3.2.6 **EmptyHost** 完整有限契约（`<!--empty-->` 为 element、外层 placeholder 分立；与 A1c / FCS 互斥）；修正 F24（`empty` **不是** FunctionHost placeholder）与 Root「顶层空」分叉；同步 M-01/M-03/M-05。证据：`createHost.ts`/`FunctionHost.ts`/`RxListHost.ts`/`ComponentHost.ts` + `experiments/adjudication-d11-facts.json`（及 review-d11）。

**d12**：采纳评审 P1（类别 1，兼 2/5）。驳回项：无。「RxList 行 Host 发出」同域第三次 → 废除「G 表穷尽」却遗漏 Function **文本态**行；新增 **G4-F** 完整有限行（Function 非 atom、快照为文本态 → Comment-ph；禁 `computed`/`empty`/Compact）；判定次序改为 Function 先求快照再分 G3-F / G4-F；同步禁止表、等价示例与 M-03。证据：`RxListHost.ts`/`createHost.ts`/`FunctionHost.ts` + `experiments/adjudication-d12-facts.json`（及 review-d12）。

**d13**：采纳评审 P1（类别 1，兼 2/5）。驳回项：无。「RxList 行 Host 发出」同域第四次 → 按协议废除「只补单行再称穷尽」；将 §3.2.3 改写为与 `createHost` **一一对应**的完整有限真值表（Compact 门闩 + createHost 全部分支）；新增 **G3-RL**（`item instanceof RxList`）与 **G3-RU**（`ReusableHost`）；钉死 Function 结构态 = 文本快路径补集；同步禁止表、例 C、Identity、M-03。证据：`createHost.ts`/`RxListHost.ts`/`ComponentHost.ts` + `experiments/adjudication-d13-facts.json`（及 review-d13）。

**d14**：采纳评审 P1（类别 2，兼 1/5）。驳回项：无。「FunctionHost 文本态/结构态判定」同域第二次（d13 已钉 §3.2.3，本轮 FTS/发出位点仍残留口语化）→ 按协议**不得再逐句补丁**：新增 **§3.2.0** 完整有限真值表 + 参考谓词（与 `FunctionHost.ts` L144–145 同构），一次覆盖 Text-ph（H1/H2/FTS）与 Comment-ph（H3/H4/FCS/G3-F/G4-F）；废除 §3.2.4/§3.2.1「元素/Fragment/其它非原始」「原始/null/boolean」操作判定；同步 M-02 FTS Function→atom 验收与 §5.3。证据：`FunctionHost.ts` + `experiments/adjudication-d14-facts.json`（及 review-d13 `fnReturnsAtom_textPh`）。

**d15**：评审结论「通过」；**采纳需要复审的问题：0**；驳回项：无。独立核验：§3.2.0 谓词 ≡ `FunctionHost.ts` L144–145；§3.2.3 ≡ `createChildHost` Compact + `createHost` 全分支（含 G3-RL/G3-RU）；H1–H4/FTS/FCS/EmptyHost/CB/开放点/M-01..M-06 无六类阻塞；设计期命令复验通过（node 6 + adjudication d11–d14 + review-d15）。进入实现：`N = 5 × 6 = 30`。证据：源码 + `experiments/review-d15-facts.json` + 本轮 vitest。

---

## 2. 目标与非目标

### 2.1 目标（对应 Task 要求编号）

| # | 目标 |
|---|---|
| 1 | 纯 Node（无 DOM 全局注入）将组件树渲染为完整 HTML，覆盖静态/属性/样式、atom/computed、RxList/Map/Set、函数节点、组件与 context、Fragment；Portal/lazy 按开放点条款 |
| 2 | 公开激活入口：复用服务端 DOM，绑定事件与响应式 Host；激活后与同树同数据 CSR 行为一致（含 destroy / retained 归零） |
| 3 | 「复用而非重建」可机械验证（节点 identity）；SSR 解析 DOM、激活后 DOM、CSR 首帧 DOM 可机械比对（含规范化条款） |
| 4 | 不匹配行为有定义且可观测；dev 遵循 `isAxiiDiagnosticsEnabled()` / `__DEV__` |
| 5 | 服务端生命周期：无事件绑定执行、无 effect/layoutEffect/ref「可测 DOM」回调、无 reactiveDOMState 订阅；激活侧补齐 CSR 时序；同进程多次/并发渲染无泄漏 |
| 6 | 样式在 SSR HTML 中有等价承载；激活无闪变；激活后样式生命周期回到既有语义 |
| 7 | 文本/属性转义明确；`dangerouslySetInnerHTML` 边界与 CSR 一致；注入类风险有可执行验证 |
| 8 | CSR 热路径零新增每实例闭包/每次分配/常驻检查；benchmark 口径无回归 |
| 9 | 最小公开 API；exports / dist / `.d.ts` 完整；Node import 回归保持通过 |
| 10 | 质量门禁 a–d 在任务完成与各里程碑关闭时不得新增失败 |
| 11 | 开放点 a–d 落为明确条款（见 §3.3） |

### 2.2 非目标

- Virtual DOM / 编译期默认魔法
- 流式 SSR（`renderToStream`）——见开放点 b
- 应用状态 dehydrate/serialize 协议——见开放点 c
- 长期 CSR/SSR 双实现分叉或渐进迁移层
- 修改 data0 内部实现（若实证必须改，冻结为独立前置问题）
- 用 jsdom 等模拟 DOM 作为任何断言证据
- 在 Node 注入 `HTMLElement` / linkedom 等以「假装」Portal 容器

---

## 3. 方案

### 3.1 关键决策（单一方案）

**决策：独立字符串 SSR 路径 + 客户端认领式 hydration；主包不引入 DOM 垫片。**

| 备选 | 否决理由 |
|---|---|
| Node 注入 linkedom/happy-dom 跑现有 Host | 违反「无 DOM 全局注入」；无 `CSSStyleSheet`/`adoptedStyleSheets`；table 形状与浏览器解析不一致；Host 假设过多浏览器 API |
| 在 CSR 热路径上到处 `if (ssr)` | 违反要求 8 |
| 编译期双输出 | 非目标；axii 默认无编译魔法 |
| 统一 CSR 动态文本为 Comment 占位 | 每文本多一节点，长列表内存回归；与要求 8 / 内存一等约束冲突。否决；采用 §3.2 SSR 专用文本边界 |

**服务端**：`renderToString(source, options?)` 走纯字符串序列化与组件执行（同步），求值当前 atom/computed/RxList 快照，输出 HTML 文本 + 样式文本 + portal 旁路结果。不创建 Host 更新订阅的长期生命周期；渲染结束释放全部临时订阅/计算。

**客户端**：`hydrateRoot(container, source)` 在已有子树上建立 Root/Host/绑定：`createElement`/Host 在 hydrating 期间从游标**认领**节点与 placeholder，而不是 `document.create*` 新建。激活完成后 `hydrating` 结束，后续更新与 CSR 同一代码路径。

**CSR 隔离**：SSR 实现放在独立导出 `axii/ssr`（类比已有 `axii/vite-plugin`），不打进浏览器主包。Hydration 认领逻辑仅在 hydrate 入口设置的短生命周期上下文中生效；`LightBindingEffect` / atom 文本更新 / `RxListHost` patch / `createHost` 分发在非 hydrating 稳态下不增加分支成本（允许 hydrate 期间 Host.`render` 上一次布尔读，禁止热更新路径常驻 SSR 分支）。

### 3.2 标记与 DOM 对应

CSR 已用 Comment/Text placeholder。SSR 输出与之对齐的注释标记，并使解析后的子节点序列可被 Host 区间认领：

- 元素节点：输出开/闭标签与属性；无额外 data-hk（避免与 path 样式 class 重复）。
- 结构占位（EmptyHost、列表项、fragment start、RxList 尾锚等）：输出与 CSR 同语义的 Comment。**EmptyHost** 完整契约见 **§3.2.6**（发出 `<!--empty-->` + 外层 placeholder；`empty` 是 Host.**element**，不是 FunctionHost placeholder）。
- **Table/select 等解析敏感父节点**：SSR 必须输出浏览器解析后的稳定结构（例如 `table > tbody > …`）；列表项注释放在 **显式 tbody/适用父节点内部**，禁止依赖「table 直接子注释」在解析后仍位于 table 下。

#### 3.2.0 FunctionHost 快照分类 — 完整有限契约（权威；同域第二次钉死；§3.2.1 / §3.2.3 / §3.2.4 / §3.2.5 共用）

**硬事实**：F23、F26、F28（及 `FunctionHost.ts` ~144–145）。

**参考谓词（唯一操作定义；与源码逐字同构）**

```ts
/** ≡ FunctionHost.renderSourceWithoutTrace 文本快路径门闩 */
function isFunctionHostTextSnapshot(node: unknown): boolean {
  const t = typeof node
  return node == null || t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint'
}
```

| 术语 | 定义（穷尽） |
|---|---|
| **文本态** | `isFunctionHostTextSnapshot(快照) === true` — 即 `null` / `undefined` / `boolean` / `string` / `number` / `bigint` |
| **结构态** | `isFunctionHostTextSnapshot(快照) === false` **且** `createHost` 可接受该值：Element / SVGElement / DocumentFragment / Array / atom / Function / ComponentNode / RxList / ReusableHost / …（= 文本快路径的**显式补集** ∩ createHost 可接受集） |
| **未知** | `createHost` 会 `assert(false)` 的类型 → **SSR 抛错**（可观测） |

**禁止（操作判定）**：把结构态口语化为「元素 / Fragment / 其它非原始」；把文本态口语化为「原始 / null / boolean」而省略 `string`/`number`/`bigint`。上述口语**不是**谓词，不得出现在发出位点表、H1–H4、G3-F/G4-F 判定行中（禁止句中的反例引用除外）。

**placeholder × 快照 → 契约（有限；一次覆盖 Text-ph 与 Comment-ph）**

| # | placeholder | 快照 | 种类 | 适用契约 | RxList 行特例（data=`rx list item`） |
|---|---|---|---|---|---|
| H1 | Text | **文本态** | Text-ph | §3.2.1 A1/A2 / B/E-Text-ph | —（非列表 Text-ph） |
| H2 | Text | **结构态** | **FTS** | §3.2.4（含 Function→**atom** / 嵌套 Function / Element / Fragment / Array / RxList / …） | — |
| H3 | Comment | **文本态** | Comment-ph | §3.2.1 A1c/A2 / BC/EC | **G4-F**（§3.2.3） |
| H4 | Comment | **结构态** | **FCS** | §3.2.5（data = 实际 placeholder.data） | **G3-F**（§3.2.3；data 必须 `'rx list item'`） |
| H⊥ | 任意 | **未知** | — | SSR 抛错 | 同左 |

**结构态内层发出**：按 `createHost(快照, Comment('computed node'))` 递归；**不得**因内层是 atom/Text 就回退成「外层无 computed 的 Text-ph」。例：`createElement` 函数子 `() => atom('world')` → CSR `[Text('world'), computed, Text('')]` → SSR `world<!--computed node--><!--axii:0-->`（d14）。

**与各节关系**：§3.2.1 发出位点表只引用本表「文本态/结构态」术语，**禁止**再括注口语闭集；§3.2.3 G3-F/G4-F 行分派使用本表态定义；§3.2.4 / §3.2.5 的 H1–H4 **就是**本表（不得另立第二套判定）。

#### 3.2.1 SSR 文本边界 — 完整有限契约（同域第七次钉死文本四类；FTS §3.2.4 / Compact §3.2.3 / **FCS+Root §3.2.5** / **EmptyHost §3.2.6** 为正交外壳；**快照分类权威见 §3.2.0**）

**硬事实（不得再凭记忆推翻）**

| # | 事实 | 证据 |
|---|---|---|
| F1 | CSR 动态文本占位是 **Text**，两侧**没有**边界 Comment（`DOM.ts` ~724–726） | 源码 |
| F2 | HTML 往返合并相邻 **非空** Text；Comment 可切开 | d1/d2 |
| F3 | 认领后删除 `axii:t` 边界，相邻非空 Text **仍分离** | d2 |
| F4 | `AtomHost`/`FunctionHost` 文本路径的 Host 区间是 Text（及可选的 CSR Comment placeholder），**不含**两侧额外 `axii:*` Comment；`destroy` 只移除 `element`/`placeholder` | `AtomHost.ts` / `FunctionHost.ts` |
| F5 | `RxListHost` 搬移区间为 `hostFirstNode`…`hostLastNode`（=`placeholder` 或 Compact 的 element） | `RxListHost.ts` + `DOM.insertBefore` |
| F6 | 若 hydrate 后**保留** `axii:t` 边界：destroy 留孤儿；reorder 只搬 Text → 标记错位 | d2 |
| F7 | `Text + CSR语义Comment + Text` 的 `innerHTML` 往返后非空文本仍分离 | d2 `listShape` |
| F8 | `stringValue`：`null`/`undefined`/`boolean` → `''`（AtomHost / FunctionHost / PrimitiveHost）——空文本是一等语义 | 源码 |
| F9 | 空 Text **不**进入 `innerHTML`；`<!--axii:t--><!--axii:/t-->` 解析后仅两 Comment、**无**中间 Text | review-d3 / d3 |
| F10 | `<!--axii:0-->` 往返为单一 Comment；hydrate **插入** `Text('')` 后删除哨兵 → 可更新、销毁无孤儿、可与列表 Comment 并列 | d3 |
| F11 | 在 `textarea`/`style`（RCDATA/RAWTEXT）内，`axii:t` / `axii:0` 语法是**字符数据**，不是 Comment | review-d3 / d3 |
| F12 | **文本 Host 双形态**（与行结构正交）：`createElement` 函数/atom child → Text placeholder（`placeholder===element===Text`）；**非 Compact** 的 `RxListHost` 文本行 / `StaticArrayHost` 非原始项 / `FunctionHost` 结构后回文本 → **Comment** placeholder（`'rx list item'` 等）；`AtomHost`/`FunctionHost`/`PrimitiveHost` 在 Comment-ph 上 `insertBefore(Text)` 且**保留** Comment（`AtomHost.ts` ~49–57 CAUTION）。**例外**：满足 Compact 门闩的单元素行 **无**行级 Comment（F21） | 源码 |
| F13 | Comment-ph 空文本 CSR：`innerHTML` **只**剩结构 Comment；按「只拥有 Text、不认领结构 Comment」搬移 → 错位；按 `element…placeholder` 搬移 → 配对保持 | d4 |
| F14 | Comment-ph 空单元：SSR **只发**结构 Comment、hydrate 插入 `Text('')`（对标 `AtomHost.replace`）即可对齐 CSR；**不需要** `axii:0` | d4 `omitAxii0*` |
| F15 | RAWTEXT **不**解码实体；字面 `</style>`/`</script>`（大小写不敏感匹配结束标签）提前关闭元素；RCDATA textarea **解码**实体 | d4 |
| F16 | `StaticArrayHost` 对 `string\|number\|bigint`（及已是 `Text` 的 item）走 `document.createTextNode`，记入 **`directNodes: Text[]`**，**不**创建文本 Host；数组 Host 尾锚为父传入 Comment（常见 `unhandledChild`） | `StaticArrayHost.ts` |
| F17 | 相邻 DirectNodes 非空文本 HTML 往返合并为一 Text；`axii:t` 包 + strip 可恢复两 Text + 结构 Comment | review-d5 / d5 |
| F18 | DirectNodes 空串不进 HTML；`['']` 的 `innerHTML` **仅**结构 Comment；`['','world']` 丢失前导空 Text — **必须** `axii:0`（不可套用 F14） | d5 |
| F19 | `createElement` 对多 child 中的 `string\|number\|bigint`：`appendChild(createTextNode)`，**不**进 `unhandledChildren`、**不**创建 Host、**不**写入 `directNodes`；仅 **数组** child 才 `Comment('unhandledChild')`→StaticArrayHost（`DOM.ts` ~656–732） | 源码 + review-d6 / d6 |
| F20 | ElementChildText：相邻非空合并；兄弟间空串丢 HTML 需 `axii:0`；**单 child** 空串走 `textContent` → CSR **0** 子节点、不发哨兵；认领后 Text 仍为元素子节点（非 Host / 非 `directNodes`） | d6 |
| F21 | `RxListHost.createChildHost`：`(HTMLElement\|SVGElement) && !detachStyledChildren` → **CompactElementHost**（共享 placeholder **永不**入文档；`hostLastNode===element`；`renderNewHosts` 只 `appendChild(element)`）。否则 → `createHost(item, Comment('rx list item'))` | 源码 + d7 |
| F22 | Compact 元素行 CSR 子序列无 per-row `rx list item`；atom/函数/Fragment 行有；对 Compact 误发 `rx list item` 与 CSR 形状不等价；`detachStyledChildren` 使该元素行走非 Compact | d7 |
| F23 | FunctionHost + **Text** placeholder 走结构路径：`insertBefore(Comment('computed node'), placeholder)` 后 CSR 稳态为 `[…内容…, <!--computed node-->, Text('')]`（`textNode===null`，`element` 来自 `innerHost`，`placeholder` 仍为尾空 Text）。该空 Text **不**进 `innerHTML`；解析后无 placeholder 位点。Comment placeholder 的同结构路径往返形状保持（F7 类），**不能**代替 Text-ph 结构 | 源码 `FunctionHost.ts` ~176–218 + d9 / review-d9 |
| F24 | FunctionHost + **Comment** placeholder 走结构路径：稳态 `[…内容…, <!--computed node-->, <!--{placeholder.data}-->]`，**无**尾空 Text；HTML 往返不丢节点。`createRoot` 固定 `Comment('root')`（`render.ts` ~67）。FunctionHost 可持有的 Comment.data 有限集含：`root` / `rx list item` / `array item` / `computed node`（嵌套）等（见 `rg createComment src`）。**不含** `empty`——`Comment('empty')` 仅由 EmptyHost 作为 **element** 创建（F25）。对非 `rx list item` 套用「必须 `rx list item`」字面量 → 与 CSR 不等价（d10） | 源码 + d10 / review-d10；d11 修正 empty |
| F25 | `createHost(null\|undefined)` → **EmptyHost**：`element = Comment('empty')`，`placeholder` 为外层传入 Comment（`root` / `rx list item` / `array item` / …）。CSR 稳态为 `<!--empty--><!--{outer.data}-->`。FunctionHost 对 `null`/`boolean` 走**文本快速路径**（不创建 EmptyHost）。Component 返回 null → EmptyHost。RxList `item===null` → EmptyHost + `rx list item`，**无** `computed node`。组件行 / Fragment 行亦无 `computed node`（仅 Function 结构行有） | 源码 + d11 / review-d11 |
| F26 | RxList 行 `item` 为 **Function（非 atom）** 且快照为**文本态**（`null`/`undefined`/boolean/string/number/bigint）：`createChildHost` → `FunctionHost` + `Comment('rx list item')`；CSR 为 Comment-ph（空文本 HTML 仅结构 Comment；非空为 Text+结构 Comment）；**无** `<!--empty-->`、**无** `computed node`。与 `item===null`（G3-E）及 Function 结构态（G3-F）**互斥** | 源码 + d12 / review-d12 |
| F27 | `createHost` 在 Array / null 之后有显式 `source instanceof RxList` → `RxListHost`，以及 `source instanceof ReusableHost` → `moveTo` 复用。RxList 行 `item` 为嵌套 `RxList`：稳态为内层各行（Compact 或 G*）+ **外层**一个 `<!--rx list item-->`；**无**外层 `computed node`、**无** `empty`（d13）。`reusable()` 作行：内容 + `<!--reusable-->` + `<!--rx list item-->`（d13）。二者均不在旧 G1–G4-F/G4 命名内 | 源码 `createHost.ts`/`ComponentHost.ts` + d13 / review-d13 |
| F28 | FunctionHost **唯一**文本快路径谓词：`node == null \|\| typeof ∈ {string,number,boolean,bigint}`（`FunctionHost.ts` ~144–145）。**atom / 嵌套 Function / Element / Array / RxList / ReusableHost / ComponentNode** 一律走结构路径（插入 `computed node` + `createHost`）。口语「元素/Fragment/其它非原始」**不是**操作定义：Text-ph 上 `() => atom('x')` 的 CSR 为 `[Text, computed, Text('')]`（FTS），不是裸 Text-ph（d14 / review-d13） | 源码 + d14 / review-d13 |

**父节点分类（有限；发出前必须判定）**

| 类 | 标签（HTML） | 文本子内容语义 |
|---|---|---|
| **NORMAL** | 上表以外的元素、Fragment 序列化后的普通父 | 子节点可为 Element / Comment / Text |
| **RCDATA** | `textarea`、`title` | 子内容为字符数据；注释语法不产生 Comment |
| **RAWTEXT** | `style`、`script`、`xmp`、`iframe`、`noembed`、`noframes`、`plaintext`；SSR 将 `noscript` **一律**按 RAWTEXT | 同上 |

**发出位点 → 种类（文本单元有限且穷尽；SSR 无运行时 Host 时按位点推导；hydrate 与 CSR 同形）**

| 发出位点（创建路径） | 种类 | CSR 形态 |
|---|---|---|
| `createElement` 对 `function`/atom child（`DOM.ts` Text placeholder）且快照为**文本态**（§3.2.0） | **Text-ph** | `placeholder === element === Text`（FunctionHost 上 `textNode===placeholder`） |
| FunctionHost 文本态且 placeholder 为 Text | **Text-ph** | 同上 |
| `createElement` 函数 child（Text placeholder）且快照为**结构态**（§3.2.0；含 atom / 嵌套 Function / Element / Fragment / …） | **FTS**（§3.2.4） | `[…内容…, Comment('computed node'), Text('')]`；`textNode===null`；`element===innerHost.element`；`placeholder===` 尾空 Text |
| FunctionHost 结构态且 placeholder 为 Text（同上路径） | **FTS**（§3.2.4） | 同上；Fragment 时内容前另有 `<!--fragment start-->` 等内层结构 Comment；atom 时内容为 Text |
| **非 Compact** 的 `RxListHost` 文本行（`'rx list item'`）；`StaticArrayHost` **非**原始项（`'array item'`）；FunctionHost **文本态**且 placeholder 为 Comment；`PrimitiveHost` 且 placeholder 为 Comment | **Comment-ph** | `element === Text`，`placeholder ===` 结构 Comment |
| FunctionHost **结构态**且 placeholder 为 Comment（含 Root / StaticArray 函数项 / RxList **G3-F** / 嵌套 computed） | **FCS**（§3.2.5；非本表文本种类） | 内容 + `computed node` + `<!--{placeholder.data}-->`；**无**尾空 Text；**仅当** data===`'rx list item'` 时与 §3.2.3 **G3-F** 字面量重合 |
| `StaticArrayHost` 的 `string\|number\|bigint` 或已是 `Text` 的 item（**仅**数组 child → StaticArrayHost 路径） | **DirectNodes** | 文本在 `directNodes[]`；**无** per-item Host；数组 Host.`placeholder` 为尾部结构 Comment |
| `createElement` 多 child 中的 `string\|number\|bigint`（`DOM.ts` `appendChild(createTextNode)`）；以及单 child 非空走 `textContent` 产生的唯一 Text | **ElementChildText** | 文本为元素 `childNodes` 成员；**无** per-text Host；**无** `directNodes`；**无**结构 Comment 尾锚 |
| 单 child 空串走 `textContent`（`DOM.ts` ~656–657） | **ElementChildText（单空快路径）** | CSR **0** 子节点；见 A1e |

**RxList 行结构**（与上表文本种类正交；完整契约见 **§3.2.3**）：满足 Compact 门闩的单元素行是 **Compact-row**（无行级 Comment）；其余行按与 `createHost` **一一对应**的 G2 / **G3-*** / **G4-F** / G4 分派——**禁止**声称「所有非 Compact 结构行 = FCS」或「所有 Function 行 = G3-F」或「所有 RxListHost 行 = Comment-ph」或「G 表已穷尽却缺 `RxList`/`ReusableHost` 分支」。

**FunctionHost 结构外壳**（与文本四类正交）：Text placeholder 结构态 = **FTS**（§3.2.4）；Comment placeholder 结构态 = **FCS**（§3.2.5）。二者互斥；**G3-F** 是 FCS 在 RxList 函数结构行上的字面量特例（data===`'rx list item'`），**不得**把 Component / Fragment / null / 数组 / Root / `array item` / **嵌套 RxList（G3-RL）** / **ReusableHost（G3-RU）** 一律推进 FCS；**不得**把 Function **文本态**行（**G4-F**）推进 FCS。**Function 结构态**定义见 §3.2.3（文本快路径补集）。**G4-F** 是 Comment-ph（§3.2.1），不是 FCS/EmptyHost。**EmptyHost**（§3.2.6）与 A1c / FCS / FTS / **G4-F** **互斥**（`item===null` ≠ `() => null`）。**禁止**用 G3-F 或 A1 冒充 FTS；**禁止**用 FTS（尾 `axii:0`）冒充 FCS/Root；**禁止**用 A1c 或 FCS 冒充 EmptyHost；**禁止**用 G3-E/FCS 冒充 G4-F；**禁止**用 G3-F/G4 冒充 G3-RL；**禁止**把 G3-RU 当成 Compact 或 FCS。

**禁止**：把 ElementChildText 假扮成 DirectNodes / Text-ph / Comment-ph；把 DirectNodes 文本假扮成 AtomHost / FunctionHost / PrimitiveHost 认领目标；把 Compact-row 假扮成 Comment-ph（误发/认领 `rx list item`）；把 FTS 假扮成 G3-F / 单独 A1 / 文本态 Text-ph；把 EmptyHost 假扮成 A1c（插 Text）或 FCS（发 `computed node`）。

**四种种类判别（实现与验收必须可机械区分；FTS / Compact-row 不是第五种文本种类）**

| 种类 | 有文本 Host？ | 写入 `directNodes`？ | 有 CSR 结构 Comment 尾锚？ | 文本所有权 |
|---|---|---|---|---|
| Text-ph | 是（Atom/Function/**文本态**/Primitive） | 否 | 否（placeholder===Text） | Host.`element` |
| Comment-ph | 是 | 否 | 是（= Host.`placeholder`） | Host.`element`…`placeholder` |
| DirectNodes | 否 | 是 | 是（数组 Host.`placeholder`） | `StaticArrayHost.directNodes` |
| ElementChildText | 否 | 否 | 否 | 父元素 `childNodes`（随元素销毁） |
| **FTS**（对照） | FunctionHost 结构态；`textNode===null` | 否 | `computed node` 是 **内层** Host placeholder，不是 FunctionHost.`placeholder`；FunctionHost.`placeholder` 为尾空 Text | 尾 Text = FunctionHost.`placeholder`；内容 = `innerHost` |
| **FCS**（对照） | FunctionHost 结构态；`textNode===null` | 否 | `computed node` 是内层 Host placeholder；FunctionHost.`placeholder` 为 **结构 Comment**（`root` / `rx list item` / `array item` / …） | 结构 Comment = FunctionHost.`placeholder`；**无**尾空 Text；内容 = `innerHost` |
| **EmptyHost**（对照） | EmptyHost；**非**文本 Host | 否 | `empty` 是 Host.**element**（Comment）；外层传入 Comment 是 `placeholder` | 区间 `element…placeholder`；**无** Text、**无** `computed node` |

**标记字面量（唯一；全部）**

```text
<!--axii:t-->…转义后的非空文本…<!--axii:/t-->   （仅 NORMAL + 非空文本单元；按 A2）
<!--axii:0-->                                      （仅 NORMAL + Text-ph 空 / DirectNodes 空 / ElementChildText 兄弟间空 / **FTS 尾 placeholder**）
```

- 开：Comment.`data === 'axii:t'`；闭：`data === 'axii:/t'`（**禁止**裸 `'/'`）
- 空哨兵：Comment.`data === 'axii:0'`
- **禁止**发出 `<!--axii:t--><!--axii:/t-->`（空开闭对）：解析无 Text，B1 不可达（F9）
- 上述 Comment **永远不是** Host.`placeholder` / `hostFirstNode` / `hostLastNode` / `directNodes` 成员；只是 HTML 往返瞬态工件。**例外说明**：FTS 中 `axii:0` 编码的是 FunctionHost.`placeholder` 位点，hydrate **插入** Text 后该 Text 才成为 placeholder——哨兵本身仍不是 Host 锚
- CSR 结构 Comment（`'rx list item'` / `'array item'` / `'unhandledChild'` / `'computed node'` / `'empty'` / `'fragment start'` / `'reusable'` / …）**是** Host 锚点；hydrate **认领、不得当 `axii:*` 删除**

**文本单元定义**

将独立认领/插入的一段字符内容——AtomHost 快照、FunctionHost 文本态快照、`string|number|bigint` 静态片段（含 ElementChildText 与 StaticArrayHost DirectNodes）、PrimitiveHost 文本。元素、CSR 结构 Comment、Portal 旁路结果不是文本单元。

**序列化长度** `len(U)`：对快照应用与 CSR 相同的 `stringValue`（null/undefined/boolean → `''`，其余 `String(...)`；ElementChildText / DirectNodes 对 number/bigint 用 `toString()`）后的字符长度。

##### A. 发出决策表

**A1. NORMAL + Text-ph — 空单元（`len(U)=0`）**

| 条件 | 必须发出 | 禁止 |
|---|---|---|
| 任意 L/R | **恰好**一个 `<!--axii:0-->` | 省略；空开闭对；`axii:t` 包空串；把结构 Comment 冒充空哨兵 |

**A1c. NORMAL + Comment-ph — 空单元（`len(U)=0`）**

| 条件 | 必须发出 | 禁止 |
|---|---|---|
| 任意 | **恰好**该 Host 的 CSR 结构 Comment（字面量与 CSR 一致，如 `<!--rx list item-->`） | `<!--axii:0-->`（多余；CSR `innerHTML` 本无空 Text，F13/F14）；空开闭对；省略结构 Comment |

**A1d. NORMAL + DirectNodes — 空单元（`len(U)=0`）**

| 条件 | 必须发出 | 禁止 |
|---|---|---|
| 任意 L/R | **恰好**一个 `<!--axii:0-->`（每位空 DirectNodes 项各一） | 省略（F18：无认领位点）；空开闭对；把**数组**尾结构 Comment 冒充本项空哨兵（与 F14 Comment-ph 不同：尾 Comment 属 StaticArrayHost，不是本项 placeholder）；假扮 AtomHost |

**A1e. NORMAL + ElementChildText — 空单元（`len(U)=0`）**

| 条件 | 必须发出 | 禁止 |
|---|---|---|
| **单 child** 空串（CSR `textContent` 快路径，F20） | **不发出**任何节点（与 CSR 0 子节点对齐） | `axii:0`；空开闭对；假扮 Text-ph/DirectNodes |
| **≥2 children 中的空兄弟**（CSR 有 `Text('')`） | **恰好**一个 `<!--axii:0-->` | 省略（HTML 丢空，F20）；空开闭对；套用 A1c/F14；写入 `directNodes` |

**A2. NORMAL — 非空单元（`len(U)>0`）**（适用 Text-ph、Comment-ph 文本部分、DirectNodes、**ElementChildText**）

对每个非空 U，令 L/R 为左右最近兄弟产出。**仅非空文本产出**计为「文本邻接」；`axii:0`、CSR 结构 Comment、元素、空缺 **不计**为文本邻接。

| L | U | R | 必须包 `axii:t`…`axii:/t`？ | 理由 |
|---|---|---|---|---|
| 非空文本产出 | 非空 | * | **是** | 与左非空文本会合并 |
| * | 非空 | 非空文本产出 | **是** | 与右对称 |
| 非文本邻接 | 非空 | 非文本邻接 | **否**（可省略） | 含：夹在元素/`axii:0`/CSR Comment 之间（F7）；**单 child 非空** ElementChildText |
| （实现简化）任意 | 非空 | 任意 | **允许始终包** | 必须配合 B 条删除 |

**Comment-ph 非空附加**：在文本（及可选 `axii:t` 包）**之后**必须紧跟该 Host 的 CSR 结构 Comment。顺序：`[axii:t?] Text [axii:/t?] Comment(structure)`。

**DirectNodes 非空附加**：各位点文本按上表；**整个** StaticArrayHost 序列化末尾必须发出数组 Host 的 CSR 结构 Comment（常见 `<!--unhandledChild-->`，字面量与 CSR 一致）。顺序示例：`[axii:0|axii:t…]* … Comment(array placeholder)`。

**ElementChildText 非空附加**：各位点文本按上表；**不得**尾随结构 Comment；**不得**创建 Host 或写入 `directNodes`。

「相邻两个静态非空文本」：`createElement('div', null, 'hello', 'world')` → 两个 **ElementChildText**；`createElement('div', null, ['hello','world'])` → **DirectNodes** + 尾 Comment。JSX 若已合并为一次 createText，则一个 ElementChildText 单元。

**A3. RCDATA / RAWTEXT 父**

| 父类 | `len(U)` | 发出 | 禁止 |
|---|---|---|---|
| RCDATA | 0 | **不发出**任何节点（见 d3 `textareaEmpty`） | `axii:*` |
| RCDATA | >0 | **按 §3.6.1 RCDATA 行**转义后的字符数据 | `axii:*`；≥2 文本单元见 R3 |
| RAWTEXT | 0 | **不发出** | `axii:*` |
| RAWTEXT | >0 | **按 §3.6.1 RAWTEXT 行**：原文写入（不做 `& < >` 实体转义）；若命中终止序列门闩 → **SSR 抛错** | `axii:*`；用实体「假装」安全同时保留字面 `</style>`（F15：不可能） |

**同一 RCDATA/RAWTEXT 父下的文本单元数量（有限）**

| # | 情况 | 行为 |
|---|---|---|
| R1 | 0 个文本单元 | 无子文本 |
| R2 | 恰好 1 个文本单元 | 按 A3 发出；与 §3.6.2 textarea `value`→子文本路径一致（属性绑定序列化优先走 §3.6.2；若同时存在 value 绑定与子文本单元且内容冲突 → **抛错**） |
| R3 | ≥2 个文本单元 | **SSR 抛错**（可观测）：HTML 字符数据无法往返为多个独立 Text / Host，禁止静默合并 |

`textarea` 的作者主路径是元素 `value` / IDL（§3.6.2），不是多个子 Host。

**禁止**：为满足本表而修改 CSR `createElement` Text 占位热路径（要求 8）。

##### B. Hydrate 生命周期表（按发出种类；唯一）

**B-Text-ph — NORMAL 非空（`axii:t` 或可省略的裸 Text）**

| 步骤 | 行为 | 完成后 |
|---|---|---|
| B1 | 游标匹配 `axii:t` + Text + `axii:/t`（或按 A2 省略时的裸 Text） | 节点仍在 |
| B2 | 将该 Text 交给 AtomHost / FunctionHost 文本路径 / PrimitiveHost；`placeholder === element === Text` | Host 拥有该 Text |
| B3 | 若有边界：**立即** `remove()` 开、闭 Comment | 无 `axii:t`/`axii:/t` |
| B4–B6 | 稳态无标记；`nodeValue` 更新；destroy/move 只操 Host 区间（F4/F5） | 无边界残留 |

**B-Comment-ph — NORMAL 非空**

| 步骤 | 行为 | 完成后 |
|---|---|---|
| BC1 | 游标匹配 Text（及可选 `axii:t`/`axii:/t`）+ **紧随** CSR 结构 Comment | 边界可暂存 |
| BC2 | Text → `element`；结构 Comment → `placeholder`（**认领 identity**，不得新建替代） | CSR 同形：`element !== placeholder` |
| BC3 | 若有 `axii:t`/`axii:/t`：**立即**删除；**不得**删除结构 Comment | 无 `axii:*`；结构 Comment 仍在 |
| BC4–BC6 | 更新只改 `element.nodeValue`；destroy/move 区间为 `element…placeholder`（F5） | 与 CSR 列表行一致 |

**E-Text-ph — NORMAL 空（`axii:0`）**

| 步骤 | 行为 | 完成后 |
|---|---|---|
| E1 | 游标匹配单一 Comment `data==='axii:0'` | 哨兵在 |
| E2 | `document.createTextNode('')`，`insertBefore(text, sentinel)` | 新 Text 在哨兵前 |
| E3 | `sentinel.remove()` | 无 `axii:0` |
| E4 | Host 拥有该 **新** Text；`placeholder === element === Text` | 与 CSR Text-ph 空占位同形 |
| E5–E6 | 更新 `nodeValue`；destroy/move 只操该 Text | 无哨兵残留（d3） |

**E-Comment-ph — NORMAL 空（仅结构 Comment）**

| 步骤 | 行为 | 完成后 |
|---|---|---|
| EC1 | 游标匹配 CSR 结构 Comment（**无**前置 `axii:0` 要求） | 结构 Comment 在 |
| EC2 | `document.createTextNode('')`，`insertBefore(text, structureComment)`（对标 `AtomHost.replace`） | Text 在 Comment 前 |
| EC3 | 结构 Comment → `placeholder`（认领）；新 Text → `element` | CSR 同形；**无** `axii:0` 可删 |
| EC4–EC6 | 更新 / destroy / move 区间 `element…placeholder` | 与 F13/F14、d4 `omitAxii0*` 一致 |

**禁止**：对 Comment-ph 空单元使用 E-Text-ph 的 E4 全称命题（「所有空文本 Host 均为 `placeholder===element===Text`」）——**已否决**（评审 P1 / d4）。

**B-DirectNodes — NORMAL 非空**

| 步骤 | 行为 | 完成后 |
|---|---|---|
| BD1 | 游标按序匹配各位点 Text（及可选 `axii:t`/`axii:/t`） | 边界可暂存 |
| BD2 | 每个认领的 Text **push 入** `StaticArrayHost.directNodes`（**不是** AtomHost） | identity 保留 |
| BD3 | 若有 `axii:*`：**立即**删除 | 无 `axii:t`/`axii:/t` |
| BD4 | 认领数组尾结构 Comment → StaticArrayHost.`placeholder` | 与 CSR 同形 |
| BD5 | destroy：与 CSR 一致（`removeNodesBetween(element, placeholder)` 或 `forceHandleElement` 路径下 `directNodes.forEach(n => n.remove())` + `placeholder.remove()`） | 无残留 |

**E-DirectNodes — NORMAL 空（`axii:0`）**

| 步骤 | 行为 | 完成后 |
|---|---|---|
| ED1 | 游标匹配单一 Comment `data==='axii:0'`（每位空项） | 哨兵在 |
| ED2 | `document.createTextNode('')`，`insertBefore(text, sentinel)` | 新 Text 在哨兵前 |
| ED3 | `sentinel.remove()` | 无 `axii:0` |
| ED4 | 新 Text **push 入** `directNodes`（非 Host） | 与 CSR 空 DirectNodes 同形 |
| ED5 | 数组尾结构 Comment 仍按 BD4 认领（在所有 DirectNodes 项处理完后） | 尾锚身份保留 |

**B-ElementChildText — NORMAL 非空**

| 步骤 | 行为 | 完成后 |
|---|---|---|
| BE1 | 游标按序匹配各位点 Text（及可选 `axii:t`/`axii:/t`） | 边界可暂存 |
| BE2 | 每个认领的 Text **留在父元素 `childNodes`**；**不**创建 AtomHost；**不**写入 `directNodes` | identity 保留；所有权=元素 |
| BE3 | 若有 `axii:*`：**立即**删除 | 无 `axii:t`/`axii:/t` |
| BE4 | destroy：无独立 Host；随父元素移除（兄弟 AtomHost.destroy 只删其自身 Text，静态半侧保留，d6） | 与 CSR 同 |

**E-ElementChildText — NORMAL 空**

| 步骤 | 行为 | 完成后 |
|---|---|---|
| EE0 | **单 child 空串快路径**：游标处无节点、无哨兵；**不**插入 Text（对齐 CSR 0 子节点） | 与 F20 |
| EE1 | **兄弟间空**：游标匹配单一 Comment `data==='axii:0'` | 哨兵在 |
| EE2 | `document.createTextNode('')`，`insertBefore(text, sentinel)` | 新 Text 在哨兵前 |
| EE3 | `sentinel.remove()` | 无 `axii:0` |
| EE4 | 新 Text 为元素子节点（非 Host / 非 `directNodes`） | 与 CSR 兄弟间空 Text 同形 |

**B-RCDATA/RAWTEXT**

| 步骤 | 行为 |
|---|---|
| C1 | **不得**匹配 `axii:t` / `axii:0`（若 DOM 中出现字面量，视为内容或 §3.7 失配，不是标记） |
| C2 | `len>0`：认领唯一 Text 子节点（identity ===） |
| C3 | `len=0`：解析后通常 0 子节点；若 Host 需要 Text 占位则 **插入** `Text('')`（同 E2 无哨兵）；若路径仅为元素 `value` IDL 绑定（§3.6.2）则可不创建子 Text，以元素绑定为准 |
| C4 | textarea 激活后 value 更新与 CSR 一致 |

**禁止（显式否决）**

| 方案 | 否决理由 |
|---|---|
| 保留 `axii:t`/`axii:0` 作区间锚 | 与 F4–F6 矛盾；不是 placeholder |
| 空单元用 `axii:t`…`axii:/t` | F9：无 Text 可认领 |
| Text-ph / DirectNodes / ElementChildText（兄弟间）空单元省略标记 | 无节点；无法 hydrate 插入位点（d3/d5/d6） |
| Comment-ph 空单元发 `axii:0` 并当作唯一锚、不认领结构 Comment | F13：reorder/destroy 与 CSR 矛盾 |
| DirectNodes 空单元套用 F14（只发数组尾 Comment、不发 `axii:0`） | F18：多项/前导空丢失；尾 Comment 不是 per-item 锚 |
| ElementChildText 并入 DirectNodes（假 `directNodes` / 假尾 Comment） | F19：无 StaticArrayHost；destroy/ownership 错 |
| ElementChildText 并入 Text-ph（为静态半侧建 AtomHost） | F19：无 Host；兄弟 AtomHost.destroy 会误删静态 Text |
| ElementChildText 单空快路径发 `axii:0` | F20：CSR 0 节点；哨兵会多出 Text |
| 把 DirectNodes Text 认领为 AtomHost | F16：无 Host；destroy/ownership 错 |
| 只认领 Text、把结构 Comment 留作「无主」兄弟 | d4 `wrongE4AfterReorder` |
| RCDATA/RAWTEXT 内发 `axii:*` | F11：变成 value 字符 |
| 把开/闭/哨兵纳入 AtomHost 区间并改 CSR destroy/move | 要求 8 / 偏离 CSR |
| RAWTEXT 用 `&lt;` 既当转义又保留作者字面 `</style>` | F15：RAWTEXT 不解码实体 |
| 对 Compact-row 发 `<!--rx list item-->`（含「发出后 hydrate 再删」） | F21/F22：CSR 无该节点；解析树与 Compact 区间语义冲突（§3.2.3） |
| 把 Compact 共享 placeholder 写入文档或当行锚认领 | F21：共享 Comment 永不入文档 |
| FunctionHost Text-ph 结构态省略尾 `axii:0` | F23：解析无 placeholder；无法 hydrate（d9） |
| FunctionHost Text-ph 结构态只发 `<!--axii:0-->`（A1 单独空） | 丢失内容与 `computed node`（d9 `wrongTreatAsA1Alone`） |
| 用 §3.2.3 G3-F / FCS / Comment-ph 冒充 createElement 函数子的结构态（FTS） | F23：无尾空 Text；往返形状不同 |
| 把 Function→atom Text-ph 当 Text-ph 文本态（省略 `computed`/`axii:0`） | F28 / d14：CSR 为 FTS |
| 把 FTS 尾哨兵插入的 Text 认领为 AtomHost.`element` 或 FunctionHost.`textNode`（结构态） | CSR 结构态 `textNode===null`；尾 Text 仅 `placeholder` |
| 凡 FunctionHost Comment+结构一律发 `rx list item`（含 Root / array item） | F24 / §3.2.5：字面量必须等于实际 placeholder.data |
| 对 Root / FCS 套 FTS（尾 `axii:0`） | d10：得尾 Text ≠ CSR 结构 Comment |
| `renderToString` 主树省略 `<!--root-->` | d10：与 CSR `createRoot` 容器形状 unequal；§3.2.5 方案 A |
| 空源（null）套用 A1c 或 FCS | F25 / §3.2.6：须发 `<!--empty-->`+outer |
| 组件/Fragment 行套用「一律 computed node」 | d11：仅 G3-F 有 computed |
| Function 文本态行（含 `() => null`）套用 G3-F/FCS | F26 / d12：无 `computed node`；是 Comment-ph |
| Function→null 行套用 G3-E EmptyHost | F26 / d12：无 `<!--empty-->`；≠ `item===null` |
| 嵌套 `RxList` 行套用 G3-F/FCS 或扁平 G4 | F27 / d13：无外层 `computed`；须内层行锚 + 外层 `rx list item` |
| `ReusableHost` 行省略 `<!--reusable-->` 或当 Compact | F27 / d13：CSR 有 `reusable` Comment |

##### C. 端到端形状例

| 阶段 | 例：`static + atom`（均非空；**ElementChildText + Text-ph**） |
|---|---|
| SSR | `<!--axii:t-->static-<!--axii:/t--><!--axii:t-->atomVal<!--axii:/t-->` |
| 解析后 | 6 节点（标记+Text×2） |
| hydrate 后 | Text(`static-`)（元素子，**非** Host）、Text(`atomVal`)（Text-ph Host） |
| AtomHost.destroy | 仅删 atom Text；`static-` **仍在**（d6） |

| 阶段 | 例：`atom('')` 单独（NORMAL，Text-ph） |
|---|---|
| SSR | `<!--axii:0-->` |
| 解析后 | Comment(`axii:0`) |
| hydrate 后 | Text(``)（**新插入**；非解析树 identity） |
| 更新为 `'x'` | 同一 Text.`nodeValue==='x'` |

| 阶段 | 例：RxList 行 `atom('')`（NORMAL，Comment-ph） |
|---|---|
| SSR | `<!--rx list item-->`（**无** `axii:0`） |
| 解析后 | Comment(`rx list item`) |
| hydrate 后 | Text(``), Comment(`rx list item`)；`element`/`placeholder` 如上 |
| reorder | 搬移 `[element…placeholder]` 配对保持 |

| 阶段 | 例：RxList 行 `atom('a')`（Comment-ph） |
|---|---|
| SSR | `a<!--rx list item-->`（邻接需包时再加 `axii:t`） |
| hydrate 后 | Text(`a`), Comment(`rx list item`) |

| 阶段 | 例：`createElement('div', null, 'hello', 'world')`（**ElementChildText**×2） |
|---|---|
| SSR | `<!--axii:t-->hello<!--axii:/t--><!--axii:t-->world<!--axii:/t-->`（**无**尾 Comment） |
| 解析后 | 标记+两 Text |
| hydrate 后 | Text(`hello`), Text(`world`)；均为元素子；**无** `directNodes`、**无** Host |

| 阶段 | 例：StaticArrayHost `['hello','world']`（DirectNodes；**对照**） |
|---|---|
| SSR | `<!--axii:t-->hello<!--axii:/t--><!--axii:t-->world<!--axii:/t--><!--unhandledChild-->` |
| 解析后 | 标记+两 Text+结构 Comment（若未包则合并为 1 Text — **禁止**省略当相邻） |
| hydrate 后 | Text(`hello`), Text(`world`), Comment(`unhandledChild`)；`directNodes` 持有两 Text |

| 阶段 | 例：StaticArrayHost `['']` / `['','world']`（DirectNodes 空） |
|---|---|
| SSR（alone） | `<!--axii:0--><!--unhandledChild-->` |
| SSR（空+world） | `<!--axii:0--><!--axii:t-->world<!--axii:/t--><!--unhandledChild-->` |
| hydrate 后 | 插入的空 Text（及 world Text）在 `directNodes`；尾 Comment 为数组 `placeholder` |

| 阶段 | 例：ElementChildText 兄弟间空 `('', 'world')` |
|---|---|
| SSR | `<!--axii:0--><!--axii:t-->world<!--axii:/t-->`（**无**尾 Comment） |
| hydrate 后 | Text(``), Text(`world`)；均为元素子 |

| 阶段 | 例：ElementChildText 单 child `''`（`textContent` 快路径） |
|---|---|
| SSR | （空；无标记、无子节点） |
| hydrate | 无节点、无插入（EE0） |

| 阶段 | 例：FunctionHost Text-ph 结构 `() => <span>x</span>`（§3.2.4 FTS） |
|---|---|
| SSR | `<span>x</span><!--computed node--><!--axii:0-->` |
| 解析后 | span, Comment(`computed node`), Comment(`axii:0`)（**无** Text） |
| hydrate 后 | span, Comment(`computed node`), Text(``)；Text === FunctionHost.`placeholder`；`textNode===null` |
| 切回文本 `'hi'` | 清结构；同一 Text.`nodeValue==='hi'`；`textNode===placeholder` |

| 阶段 | 例：FunctionHost Text-ph 结构 `() => atom('world')`（§3.2.0 H2 / §3.2.4 FTS；**非** Text-ph 文本态） |
|---|---|
| SSR | `world<!--computed node--><!--axii:0-->`（邻接需包时再加 `axii:t`） |
| 解析后 | Text(`world`), Comment(`computed node`), Comment(`axii:0`) |
| hydrate 后 | Text(`world`), Comment(`computed node`), Text(``)；尾 Text === FunctionHost.`placeholder`；`textNode===null`；内层 AtomHost 拥有 `world` Text |
| 误当 H1 文本态 | SSR 仅 `world` 或 `axii:t` 包 → **无** `computed` / **无**尾 `axii:0` → ≠ CSR（d14） |

| 阶段 | 例：FunctionHost Text-ph 结构返回 Fragment（§3.2.4） |
|---|---|
| SSR | `<!--fragment start-->…<!--computed node--><!--axii:0-->` |
| hydrate 后 | 内层结构 Comment 认领 + 尾空 Text placeholder |

| 阶段 | 例：Root 函数结构（§3.2.5 FCS，data=`root`） |
|---|---|
| SSR | `<span>x</span><!--computed node--><!--root-->` |
| 解析后 | span, Comment(`computed node`), Comment(`root`)（**preserved**） |
| hydrate 后 | 同上；Comment(`root`) === root Host.`placeholder`；**无**尾 Text |
| 误套 FTS | `…<!--axii:0-->` → 插入 Text ≠ CSR（d10） |

| 阶段 | 例：StaticArrayHost 函数项结构（FCS，data=`array item`） |
|---|---|
| SSR | `<span>x</span><!--computed node--><!--array item--><!--unhandledChild-->` |
| hydrate 后 | 认领 `array item` 为项 FunctionHost.`placeholder`；**禁止**写成 `rx list item` |

| 阶段 | 例：Root 上 `atom('')` / `() => null`（Comment-ph 文本空 + root；**非** EmptyHost） |
|---|---|
| SSR | `<!--root-->`（空 Text 不进 HTML） |
| hydrate 后 | Text(``), Comment(`root`) |

| 阶段 | 例：`root.render(null)` / 顶层 Component→null（§3.2.6 EmptyHost） |
|---|---|
| SSR | `<!--empty--><!--root-->` |
| 解析后 | Comment(`empty`), Comment(`root`) |
| hydrate 后 | 同上；`empty`===EmptyHost.element；`root`===placeholder；**无** Text |
| 误套 A1c | 仅 `<!--root-->` + 插 Text ≠ CSR（d11） |

| 阶段 | 例：RxList 行 `null`（G3-E / EmptyHost） |
|---|---|
| SSR | `<!--empty--><!--rx list item-->` |
| hydrate 后 | 双 Comment 认领；**禁止** A1c / FCS |
| 对照 atom('') 行 | HTML 仅 `<!--rx list item-->`（A1c）——与 null 行 **不等价** |

| 阶段 | 例：RxList 行 `() => null`（**G4-F** / Comment-ph 空；§3.2.3） |
|---|---|
| SSR | `<!--rx list item-->`（**无** `empty`、**无** `computed`、**无** `axii:0`） |
| 解析后 | Comment(`rx list item`) |
| hydrate 后 | Text(``), Comment(`rx list item`)；按 EC |
| 对照 G3-E `null` 行 | HTML `<!--empty--><!--rx list item-->`——与 G4-F **不等价**（d12） |
| 对照误套 FCS | HTML 含 `computed node` → `equalCsr===false`（d12） |

| 阶段 | 例：外层 `RxList([innerRxList])`，inner=`RxList([1,2])`（**G3-RL**；§3.2.3） |
|---|---|
| SSR | `1<!--rx list item-->2<!--rx list item--><!--rx list item-->`（+ 列表尾锚如 `<!--unhandledChild-->`） |
| 解析后 | Text, Comment, Text, Comment, Comment（外层）, … |
| hydrate 后 | 内层两行 Comment-ph + 外层嵌套 RxListHost.`placeholder`===末 `rx list item`；**无** `computed`/`empty` |
| 内层 splice | 外层行尾 Comment 保留；形状与 CSR 对照（d13） |
| 误套 G3-F | 外层/内层加 `computed node` → ≠ CSR（d13） |

| 阶段 | 例：`reusable(<div>R</div>)` 作 RxList 行（**G3-RU**；§3.2.3） |
|---|---|
| SSR | `<div id="reused">R</div><!--reusable--><!--rx list item-->`（+ 列表尾锚） |
| hydrate 后 | 认领 div + Comment(`reusable`) + Comment(`rx list item`)；ReusableHost 首帧同 CSR |
| 禁止 | 省略 `reusable`；当 Compact；外层套 FCS |

| 阶段 | 例：RxList Compact-row `<span>1</span><span>2</span>`（§3.2.3） |
|---|---|
| SSR | `<span>1</span><span>2</span>` + 列表尾结构 Comment（常见 `<!--unhandledChild-->`）；**无** per-row `rx list item` |
| 解析后 | span, span, Comment(list placeholder) |
| hydrate 后 | 两 span identity 认领为 CompactElementHost.element；无行级 Comment |
| reorder | 只搬移各 span（`hostLastNode===element`） |

| 阶段 | 例：`<textarea value="">` / 空 value |
|---|---|
| SSR | `<textarea></textarea>`（无标记、无子节点） |
| hydrate | 按 §3.6.2 / C3；无 `axii:0` |

##### D. Identity 与比对

| 单元种类 | Identity 规则 |
|---|---|
| Text-ph 非空（经 `axii:t` 或可省略的裸 Text） | 认领的 Text 在 B2 前后 `===`；边界不参与 |
| Text-ph 空（`axii:0`） | **无**解析态 Text；identity 断言为「E2 插入的 Text 为 Host 所有」——**不**要求与解析前某节点 `===` |
| Comment-ph 非空 | 认领的 Text `===`；结构 Comment `===`（作 `placeholder`） |
| Comment-ph 空 | 结构 Comment `===`；Text 为 EC2 **新插入**（与 Text-ph 空同属「HTML 无法编码空 Text」例外） |
| DirectNodes 非空 | 认领的各 Text `===` 且顺序写入 `directNodes`；数组尾结构 Comment `===` |
| DirectNodes 空 | 各 `axii:0` → ED2 **新插入** Text 入 `directNodes`；尾结构 Comment `===` |
| ElementChildText 非空 | 认领的各 Text `===` 且仍为父元素子节点；**断言**非 Host、非 `directNodes` |
| ElementChildText 兄弟间空 | `axii:0` → EE2 **新插入** Text 为元素子；**断言**非 Host、非 `directNodes` |
| ElementChildText 单空快路径 | 无节点；identity 不适用（无 Text） |
| Compact-row | 行元素 `===`；**断言**激活后该行区间无 `rx list item`；列表尾结构 Comment（若有）按列表 Host.`placeholder` 认领 |
| FTS（FunctionHost Text-ph 结构） | 内容子树 / `computed node` /（Fragment 时）`fragment start` 等 **认领 `===`**；尾 Text 为哨兵后 **新插入**（与空 Text HTML 例外同类）；**断言** `placeholder===` 该 Text、`textNode===null`、该 Text **不是** AtomHost |
| FCS（FunctionHost Comment-ph 结构） | 内容 / `computed node` / FunctionHost.`placeholder` Comment **全部认领 `===`**；**无**尾 Text 插入；**断言** placeholder.data 与 CSR 一致 |
| EmptyHost | Comment(`empty`) 与 outer placeholder Comment **全部认领 `===`**；**无** Text 插入；**断言**无 `computed node`、无 `axii:*` |
| G3-RL（嵌套 RxList 行） | 内层各行按本表递归 identity；外层 `rx list item` **认领 `===`** 为嵌套 RxListHost.`placeholder`；**断言**无外层 `computed`/`empty` |
| G3-RU（ReusableHost 行） | 内容子树 / Comment(`reusable`) / 行尾 `rx list item` **全部认领 `===`**；**断言**非 Compact、非误套 FCS（除非内层本身 Function 结构） |
| Root 锚 | Comment(`root`) **认领 `===`**（方案 A；非插入例外）；激活后容器形状含该锚，与同数据 `createRoot` 对照 |
| RCDATA/RAWTEXT 非空 | 认领唯一 Text `===` |
| RCDATA/RAWTEXT 空 | 同 C3；无解析 Text 时可插入 |

- 激活后 vs 纯 CSR：规范化后形状等价；激活树 **断言无** `axii:t` / `axii:/t` / `axii:0` 残留；Comment-ph 行断言 `placeholder` 仍为结构 Comment 且位于区间末；Compact-row 断言无多余 `rx list item` 且 `hostLastNode===element`；FTS 断言 `placeholder` 为尾空 Text、`computed node` 仍在、`textNode===null`；FCS 断言 `placeholder` 为结构 Comment（正确 data）、`computed node` 仍在、无尾空 Text；EmptyHost 断言 `empty`+outer 双 Comment、无 Text、无 `computed`；**G3-RL** 断言外层 `rx list item` 为嵌套列表 placeholder、无外层 `computed`；**G3-RU** 断言存在认领的 `<!--reusable-->`；Root 断言容器末（或约定位点）存在认领的 `<!--root-->`；DirectNodes 断言 `directNodes` 长度/内容与 CSR 对照且尾 Comment 为数组 `placeholder`；ElementChildText 断言文本为元素子且无多余结构 Comment。
- 正确匹配的**元素**节点仍须 identity 复用（要求 3）；空文本插入例外仅限文本占位的 Text 节点（含 DirectNodes / ElementChildText 兄弟间空 / **FTS 尾 placeholder**）；**Root Comment、FCS placeholder Comment、EmptyHost `empty` Comment 不是插入例外**（方案 A / EH 认领）。

### 3.2.2 机械等价规范化 `normalizeDomForCompare(node)`

（测试工具，非生产热路径）

1. 忽略仅由 HTML 解析插入、且 CSR `createElement` 路径不会创建的包装差异时，按白名单折叠（首版：**隐式/显式 tbody** 在「仅含 tr/注释/空白」时视为透明）。
2. **仅当**比对「尚未跑完 B3/BC3/BD3/BE3/E3/ED3/EE3/FS4 的解析树」或 SSR 字符串中间态时：成对剥离 `data==='axii:t'` 与紧随文本后的 `data==='axii:/t'`；将孤立 `data==='axii:0'` 规范为「空 Text 占位」语义（比对工具可映射为 `Text('')` 槽，**不得**在生产 DOM 上留下哨兵）。Comment-ph 空行的结构 Comment **不是** `axii:0`，比对时保留为 Comment。FTS 解析树上 `computed node` 后的 `axii:0` 映射为 FunctionHost 尾 placeholder 槽。FCS / Root / EmptyHost / **G3-RL 外层** / **G3-RU `reusable`** 的结构 Comment（`root` / `rx list item` / `array item` / `computed node` / `empty` / `fragment start` / `reusable` 等）**保留**，**不得**剥离或改写 data。**不得**忽略任意 `data==='/'` 或未配对注释。Compact-row **不得**被规范工具「补」`rx list item`；非 G3-F FCS **不得**被规范工具改成 `rx list item`；EmptyHost **不得**被规范工具改成「仅 outer + 空 Text」；嵌套 RxList **不得**被规范工具扁平掉外层行锚。
3. 属性：按序列化规范比较（布尔属性统一为出现且值为 `"true"`）。
4. 不计事件监听与 JS 属性（只比 DOM 树形状与 attribute/text）。

激活完成后 vs 解析认领前：元素与**非空**被认领文本 **identity 相等**；Comment-ph 的结构 Comment identity 相等；Compact-row 元素 identity 相等；空文本按 §3.2.1 D；激活完成后 vs CSR：无 `axii:*` 残留前提下比形状（Comment-ph 含结构 Comment；Compact-row 无行级 `rx list item`）。

### 3.2.3 RxList 行 Host 发出 — 与 `createHost` 一一对应的完整有限契约（同域第四次；与 §3.2.1 文本种类 / §3.2.6 EmptyHost 正交）

**硬事实**：F21、F22、F25、F26、**F27**（及 F5：`hostLastNode` 对 Compact 为 element）。

**权威闭合规则（d13；禁止再「只补单行」）**：行分派表必须与下列两层 **一一对应、闭合**：

1. `RxListHost.createChildHost` 的 Compact 门闩（仅 Element±`detachStyledChildren`）；
2. 非 Compact 时调用的 `createHost(item, Comment('rx list item'))` 的**全部分支**（`src/createHost.ts` 源码序）。

凡声称「与 createChildHost/createHost 对齐且穷尽」的表述，**仅**当本表行集合覆盖上述闭合时成立。**废除** d7–d12 期间任何「已穷尽」却未列 `RxList` / `ReusableHost` 的声称。

**与文本四类 / FCS / EmptyHost 的关系**：Compact-row **不是**第五种文本发出种类。行内若有文本子树，仍递归适用 §3.2.1。本节只裁定 **行 Host 外壳**。仅 **G3-F**（Function 结构态）走 FCS；**G4-F**（Function 文本态）走 Comment-ph；**G3-RL** / **G3-RU** / Component / Fragment / Array / null / atom / 原始各有独立发出形。

**Function 文本态 / 结构态（有限；穷尽相对 FunctionHost；权威定义见 §3.2.0）**

| 快照类型 | 态 | 行分派 |
|---|---|---|
| `null` / `undefined` / `boolean` / `string` / `number` / `bigint`（`isFunctionHostTextSnapshot`） | **文本态** | **G4-F** |
| §3.2.0 结构态（含 Element / SVGElement / DocumentFragment / Array / atom / Function / ComponentNode / RxList / ReusableHost / …） | **结构态** | **G3-F**（FCS；内层再递归） |
| `createHost` 会 `assert(false)` 的未知类型 | — | **SSR 抛错**（可观测；与 CSR assert 对偶） |

**禁止**把结构态口语化为「元素/Fragment/其它非原始」而不对照 §3.2.0——atom / 嵌套 Function / 返回 RxList 均属结构态（d13/d14：`fnRowReturnsAtom` / `fnReturnsAtom_textPh_FTS` 有 `computed node`）。

##### 行分派真值表（闭合；唯一）

对列表每一行，在得到 `item` 之后（SSR：与 CSR `createElement`/`createHost` 输入同形的描述，含 `detachStyledChildren`）。

**层 A — `createChildHost` Compact 门闩（先于 createHost）**

| # | 条件 | 行种类 | CSR Host | SSR 必须发出 | SSR 禁止 |
|---|---|---|---|---|---|
| G1 | 单根 **Element**（`HTMLElement\|SVGElement`）且 **无** `detachStyledChildren` | **Compact-row** | `CompactElementHost` | 仅该行元素（及元素内递归）；列表级尾锚仍由列表 Host.`placeholder` 发出（常见 `<!--unhandledChild-->`，**不是**行级） | 任何行级结构 Comment；共享 compact placeholder 入文档 |
| G2 | 单根 Element 且 **有** `detachStyledChildren` | **非 Compact** + StaticHost | `createHost`→StaticHost + `Comment('rx list item')` | 行元素（递归）+ **紧随** `<!--rx list item-->` | 省略行级 Comment；套用 G1 |

**层 B — 非 Compact：与 `createHost` 分支一一对应**（`placeholder` 固定为 `Comment('rx list item')`）

| # | `createHost` 分支（源码条件） | 行种类 | CSR Host | SSR 必须发出 | SSR 禁止 |
|---|---|---|---|---|---|
| G4 | `isAtom(item)` | **Comment-ph** | `AtomHost` | A1c/A2/BC/EC；尾 `'rx list item'` | Compact；当 G3-E |
| **G4-F** | `typeof==='function'` 且非 atom，快照为**文本态** | **Comment-ph** | `FunctionHost` | A1c/A2/BC/EC；空快照 HTML **仅** `<!--rx list item-->`（无 empty/computed/axii:0） | Compact；G3-F/FCS；G3-E；当 `item===null` |
| **G3-F** | `typeof==='function'` 且非 atom，快照为**结构态** | **FCS** | `FunctionHost` | §3.2.5：内容 + `<!--computed node-->` + `<!--rx list item-->`；内层按快照类型再分派（可含嵌套 RxList / atom / Function） | 套用 G1；省略 `computed`；套用 G4-F/G3-E；把字面量改成 Root/`array item` |
| G2′ | `HTMLElement\|SVGElement`（仅经层 A 的 G2 到达） | （见 G2） | StaticHost | （见 G2） | — |
| G3-Fr | `DocumentFragment` | **非 Compact** + StaticHost(fragment) | `StaticHost` | `<!--fragment start-->` + 内容递归 + `<!--rx list item-->`（**无** `computed`） | 套用 G3-F；省略 `fragment start` |
| G4′ | `string\|number\|boolean\|bigint` | **Comment-ph** | `PrimitiveHost` | A1c/A2/BC/EC；尾 `'rx list item'` | Compact；把 Function 文本态漏进本行；把 `null` 当本行 |
| G3-A | `Array.isArray` | **非 Compact** + StaticArrayHost | `StaticArrayHost` | DirectNodes/内层项递归 + 数组语义 Comment + **行尾** `<!--rx list item-->` | Compact；行尾写成 `unhandledChild` 冒充行 placeholder |
| G3-E | `null\|undefined` | **EmptyHost**（§3.2.6） | `EmptyHost` | **恰好** `<!--empty--><!--rx list item-->` | A1c；FCS；省略 `empty`；把 `() => null` 当成本行 |
| **G3-RL** | `item instanceof RxList` | **嵌套 RxListHost** | `RxListHost` + 外层 `Comment('rx list item')` | **递归**对本节真值表序列化内层各行（Compact/G*）+ **行尾**外层 `<!--rx list item-->`；**无**外层 `computed node`；**无**外层 `empty` | 套用 G3-F/FCS；扁平为单一 G4 文本；省略外层行尾 Comment；把内层行锚当成外层唯一锚 |
| **G3-RU** | `item instanceof ReusableHost` | **ReusableHost** | `ReusableHost`（`moveTo` 行 placeholder） | 递归序列化 `ReusableHost` 内层内容 + `<!--reusable-->`（innerPlaceholder）+ **行尾** `<!--rx list item-->`（reusePlaceholder）；**无** `computed node`（除非内层本身是 Function 结构） | Compact；省略 `<!--reusable-->`；套用 FCS；SSR 静默丢弃 |
| G3-C | `object` 且 `typeof source.type==='function'`（ComponentNode） | **ComponentHost** | `ComponentHost` | 递归序列化组件产出 + **紧随** `<!--rx list item-->`；返回元素时 **无** 外层 `computed`；返回 null/undefined → 内层按 **G3-E** | 一律发 `computed`；套用 G1 |
| G-⊥ | `createHost` else 分支 | — | CSR `assert` | **SSR 抛错**（可观测） | 静默跳过或冒充其它行 |

**判定次序（与源码对齐；唯一）**

1. 层 A：G1 / G2（单根 Element ± detach）。
2. 否则进入层 B，按 `createHost` **同一**分支序：function（atom→G4；非 atom 先求快照→G3-F 或 G4-F）→ Fragment（G3-Fr）→ primitive（G4′）→ Array（G3-A）→ null（G3-E）→ **RxList（G3-RL）** → **ReusableHost（G3-RU）** → ComponentNode（G3-C）→ 否则 G-⊥。
3. StaticArrayHost **无** Compact 分叉。非列表位点的 EmptyHost / ReusableHost 见 §3.2.6 与下方 G3-RU 注。

**SSR 无 `HTMLElement` 时的等价**：不得注入 DOM。G1/G2 的「单根 Element」指与 CSR `createElement` 单元素同形的节点描述（含 `detachStyledChildren`）。示例：`list.map(i => <span>{i}</span>)`→G1；`() => <span/>`→G3-F；`() => null`→G4-F；`<Comp/>`→G3-C；Fragment→G3-Fr；`null` item→G3-E；atom→G4；**`new RxList([innerRxList])`→G3-RL**；**`reusable(…)` 入列→G3-RU**。

**G3-RU 非列表位点**：`reusable()` 作为普通 child（非 RxList 行）时，SSR 仍发内容 + `<!--reusable-->`，外层 placeholder 为父传入（如 `unhandledChild` / `root` 等），**无**强制 `rx list item`。首帧语义 = CSR 首次 `render`（内容在位）；跨请求「搬移复用」不在 SSR 范围——激活后按既有 ReusableHost 语义。

##### Compact-row — Hydrate / Identity / 搬移

| 步骤 | 行为 | 完成后 |
|---|---|---|
| CK1 | 游标匹配行元素（标签/类型与期望一致） | 元素在 |
| CK2 | 认领该元素为 `CompactElementHost.element`（**identity ===**）；**不**新建、**不**期望行级 Comment | 与 CSR 同形 |
| CK3 | `hostFirstNode`/`hostLastNode` 均为该元素；`move`/`destroy`/`splice` 只操作该元素 | 无行 Comment 可错位 |
| CK4 | 列表 Host.`placeholder`（尾锚）按非 Compact 列表逻辑认领；与行无关 | 尾锚 identity 保留 |

| Identity | 规则 |
|---|---|
| Compact-row 元素 | 认领前后 `===`；激活后 vs CSR：同位置无多余 `rx list item` |
| 误发路径 | 若 DOM 出现本不应存在的行级 `rx list item` → §3.7 失配 |

##### 非 Compact 行 — 指针

- **G4 / G4′ / G4-F**：§3.2.1 Comment-ph（A1c/A2/BC/EC）。
- **G3-F**：§3.2.5 FCS（data=`rx list item`）；内层可再含 RxList/atom/Function 等。
- **G3-C**：递归 + 行尾 `rx list item`；返回 null → G3-E；无外层 `computed`。
- **G3-Fr**：`fragment start` + 内容 + 行尾；无 `computed`。
- **G3-A**：StaticArrayHost + 行尾 `rx list item`。
- **G3-E**：§3.2.6；`<!--empty--><!--rx list item-->`。
- **G3-RL**：内层按本表递归 hydrate 为嵌套 `RxListHost`；外层 `rx list item` 为嵌套列表 Host.`placeholder`（identity ===）；区间搬移含内层全部子行 + 外层 placeholder。
- **G3-RU**：认领内层内容子树 + Comment(`reusable`) 为 ReusableHost.innerPlaceholder；行尾 Comment(`rx list item`) 为 reusePlaceholder / Host.`placeholder`；`forceHandleElement` 语义与 CSR 一致。
- G2：行元素 + `rx list item`；无 `computed`。

##### 禁止（显式否决）

| 方案 | 否决理由 |
|---|---|
| 所有 RxList 行一律发 `rx list item` | 与 G1/F21 矛盾（d7） |
| Compact 发行 Comment，hydrate 再删除 | 解析树已与 CSR 不等价 |
| 将 Compact 共享 placeholder 插入文档 | F21 |
| 忽略 `detachStyledChildren` 仍走 Compact | d7 mixed |
| StaticArrayHost 套用 Compact | 源码无此分叉 |
| **凡非 Compact 结构行一律 FCS** | F25/d11：仅 G3-F |
| **凡 Function 行一律 G3-F** | F26/d12：文本态是 G4-F |
| null 行套用 A1c / FCS | d11 |
| Function→null 套用 G3-E / FCS | d12 |
| 把 `null` 当 G4 | EmptyHost |
| **声称 G 表穷尽却遗漏 `instanceof RxList` / `ReusableHost`** | F27 / d13；违反闭合规则 |
| 嵌套 RxList 套用 G3-F（外层 `computed`）或扁平 G4 | d13 `wrongG3FEqualsCsr` / `wrongG4FlattenEqualsCsr` |
| ReusableHost 行省略 `<!--reusable-->` 或当 Compact | d13 `reusableHostAsRxListRow` |
| 结构态定义不含 atom/Function/RxList 等补集项 | review-d13；实现会再次漏进 G4-F |

### 3.2.4 FunctionHost Text-ph 结构态（FTS）— 完整有限契约（「FunctionHost 文本态/结构态」同域第二次钉死于 §3.2.0；与文本四类 / FCS §3.2.5 / Compact / EmptyHost 正交）

**硬事实**：F9、F23、**F28**（及 F1：函数 child 用 Text placeholder；`FunctionHost.ts` 结构路径保留尾空 Text）。

**与文本四类 / FCS / G3-F 的关系**：FTS **不是**第五种文本发出种类，也 **不是** Comment-ph/FCS/EmptyHost。它是 FunctionHost 在 **Text placeholder** 上走结构路径时的外壳编码：内容与 `computed node` 按内层 Host CSR 语义发出；尾空 Text placeholder 因 HTML 无法编码而用 `<!--axii:0-->` 占位（hydrate 后插入 Text，哨兵删除）。Comment placeholder 的结构态见 **§3.2.5 FCS**；**G3-F** 只是 FCS 在 RxList 函数结构行上的字面量特例——**都不能**代替 FTS。

**判定（有限且穷尽；相对 FunctionHost；权威表 = §3.2.0；本节不另立口语闭集）**

| # | placeholder | 当前快照 | 种类 | 适用契约 |
|---|---|---|---|---|
| H1 | Text | **文本态**（§3.2.0） | Text-ph | §3.2.1 A1/A2 / B/E-Text-ph |
| H2 | Text | **结构态**（§3.2.0；含 atom / 嵌套 Function / Element / Fragment / Array / RxList / …） | **FTS** | 本节省出 + hydrate |
| H3 | Comment | **文本态** | Comment-ph | §3.2.1 A1c/A2 / BC/EC |
| H4 | Comment | **结构态**（含 Root / array item / RxList **G3-F** 函数行 / 嵌套 computed） | **FCS** | **§3.2.5**（若且仅若 placeholder.data===`'rx list item'`，同时满足 §3.2.3 **G3-F**） |

**废除**：任何以「元素 / Fragment / 其它非原始」或「原始 / null / boolean」作为 H1/H2 **操作**定义的表述（d14）。

**SSR 发出序（H2；唯一）**

```text
[递归序列化结构产物（含内层 fragment start / 子 Host 结构 Comment / 文本边界 / 内层 atom Text）]
<!--computed node-->
<!--axii:0-->
```

| 规则 | 必须 | 禁止 |
|---|---|---|
| 顺序 | `computed node` **紧邻**在尾哨兵之前；内容在 `computed node` 之前 | 哨兵在 `computed node` 之前；哨兵夹在内容中间 |
| 尾锚 | **恰好**一个 `<!--axii:0-->` 编码 FunctionHost.`placeholder` | 省略；空开闭对；把 `computed node` 当 FunctionHost.`placeholder` |
| 内层 | Fragment → 保留 `<!--fragment start-->` 等与 CSR 一致的内层 Comment；**atom → 发出 AtomHost 文本（A1/A2）再接 computed** | 把内层结构 Comment 当 `axii:*` 删除；把 Function→atom 当成 H1 文本态 |
| 互斥 | — | 套用 H1/A1（只发 `axii:0` 或裸文本）；套用 H4/FCS（发结构 Comment、不发尾空 Text 编码） |

**父类**：仅 **NORMAL**。RCDATA/RAWTEXT 父下若出现 FunctionHost 结构 → 与 §3.2.1 R3 / 非法嵌套同类，按失配或抛错（实现不得在 RAWTEXT 内发 `axii:*`）。

##### FTS — Hydrate / Identity / 切换 / destroy

| 步骤 | 行为 | 完成后 |
|---|---|---|
| FS1 | 游标认领结构产物子树（按内层 Host：Element / Fragment 内容 / **Atom Text** / 嵌套 Host 等；identity ===） | 内容在 |
| FS2 | 认领紧随的 Comment `data==='computed node'` 为 **内层** Host 的 placeholder（identity ===） | 与 CSR `createHost(node, computed)` 同形 |
| FS3 | 游标匹配单一 Comment `data==='axii:0'`（须在 `computed node` **之后**） | 哨兵在 |
| FS4 | `document.createTextNode('')`，`insertBefore(text, sentinel)`；`sentinel.remove()` | 无 `axii:0` |
| FS5 | 该 Text → FunctionHost.`placeholder`；**保持** `textNode===null`；**不得**写入 AtomHost / 当作文本态 `element` | CSR 结构态同形：`element===innerHost.element` |
| FS6 | 稳态无 `axii:*`；destroy：对标 CSR——`placeholder.remove()` + `innerHost.destroy`；无孤儿哨兵 | d9 `destroyLeavesNoOrphans` |
| FS7 | 结构→文本切换：清 `innerHost` / `computed`；**复用**同一 Text 为 `textNode===placeholder` 写 `nodeValue`（d9 `structureToTextReusePlaceholder`） | 与 CSR `renderSourceWithoutTrace` 文本路径一致 |
| FS8 | 文本→结构切换：对标 CSR——清空/保留 Text 为 placeholder 后插入新 `computed node`；SSR 再 hydrate 仍按 FS1–FS5 | — |

| Identity | 规则 |
|---|---|
| 结构子树 / `computed node` / 内层 `fragment start` 等 | 认领前后 `===` |
| 尾空 Text | **新插入**（HTML 无法编码例外）；断言 === FunctionHost.`placeholder` |
| 误路径 | DOM 缺尾哨兵、或仅有 `axii:0` 无结构、或 Function→atom 缺 `computed` → §3.7 失配（不得静默当文本态 A1） |

##### 禁止（显式否决）

| 方案 | 否决理由 |
|---|---|
| 省略 `<!--axii:0-->` | F23 / d9：无 placeholder 位点 |
| 只发 `<!--axii:0-->`（冒充 A1） | 丢失结构（d9） |
| 用 FCS / G3-F / 任意结构 Comment 代替 FTS | Comment-ph 无尾空 Text；createElement 函数子不是该路径 |
| 把插入的尾 Text 设为 `textNode` 或 AtomHost.`element`（结构态） | CSR `textNode===null` |
| 保留 `axii:0` 作长期锚 | 与 §3.2.1 瞬态标记纪律冲突；destroy 孤儿 |
| 修改 CSR 使函数 child 改用 Comment placeholder 以避免本契约 | 要求 8 / 每函数多一节点内存 |
| 以「元素/Fragment」闭集判定 H2，把 Function→atom 当 Text-ph 文本 | F28 / d14：CSR 有 `computed`；裸 `world` HTML ≠ FTS |


### 3.2.5 FunctionHost Comment-ph 结构态（FCS）与 Root placeholder — 完整有限契约（「FunctionHost Comment-ph 结构 / Root」同域第一次；与 FTS / 文本四类 / EmptyHost 正交；**G3-F** 为其 RxList 函数结构特例）

**硬事实**：F24、F7、F9、F25（及 `render.ts` createComment(`'root'`)；FunctionHost 结构路径对任意 placeholder 插入 `computed node`）。

**与 FTS / G3-F / EmptyHost 的关系**：FCS 是 FunctionHost 在 **Comment placeholder** 上走结构路径时的外壳编码。与 FTS 互斥（FTS 要尾空 Text / `axii:0`；FCS **禁止**尾 `axii:0`）。与 EmptyHost 互斥（EmptyHost **无** FunctionHost、**无** `computed node`）。§3.2.3 **G3-F** **不是**独立的第三种 FunctionHost 结构外壳——它只规定 RxList **函数结构**行 FCS 的 placeholder.data **必须**为 `'rx list item'`。Root / StaticArrayHost 函数项 / 嵌套 `computed node` 走 FCS，但 data 分别为 `'root'` / `'array item'` / `'computed node'`。Component / Fragment / null **不是** FCS。

**Comment.data 有限集（FunctionHost 可作 placeholder；实现与验收须按实际 data 发出，不得改写字面量）**

| data | 典型创建位点 | FCS 适用 |
|---|---|---|
| `root` | `createRoot` / `hydrateRoot`（§ Root） | 是（顶层 Function 结构） |
| `rx list item` | `RxListHost.createChildHost` 非 Compact **且** item 为 Function 结构（G3-F） | 是；同时满足 G3-F |
| `array item` | `StaticArrayHost` 非原始项且为 Function 结构 | 是 |
| `computed node` | 外层 FunctionHost 结构插入的内层 placeholder | 是（嵌套） |
| `unhandledChild` / `fragment start` | 数组尾锚 / Fragment | 通常为**其它** Host 的 placeholder，不是 FunctionHost 自身；序列化按所属 Host CSR 语义保留 |
| `compact host shared placeholder` | Compact 共享 | **永不入文档**（F21）；不是 FCS 发出目标 |
| `empty` | **仅** EmptyHost.**element**（§3.2.6） | **否**——不是 FunctionHost placeholder；禁止列入本表作 FCS 尾锚 |

**判定（相对 FunctionHost；接续 §3.2.0 / §3.2.4 H1–H4；不得另立口语闭集）**

| # | placeholder | 快照 | 种类 | 契约 |
|---|---|---|---|---|
| H1 | Text | **文本态**（§3.2.0） | Text-ph | §3.2.1 |
| H2 | Text | **结构态**（§3.2.0） | FTS | §3.2.4 |
| H3 | Comment | **文本态** | Comment-ph | §3.2.1 A1c/A2/BC/EC |
| H4 | Comment | **结构态** | **FCS** | 本节 |

**SSR 发出序（H4；唯一）**

```text
[递归序列化结构产物（含内层 fragment start / 子 Host 结构 Comment / 文本边界 / 嵌套 FCS|FTS）]
<!--computed node-->
<!--{placeholder.data}-->
```

| 规则 | 必须 | 禁止 |
|---|---|---|
| 顺序 | `computed node` **紧邻**在 FunctionHost.`placeholder` Comment 之前；内容在 `computed node` 之前 | 哨兵/`axii:0` 夹在中间；placeholder Comment 在 `computed node` 之前 |
| 尾锚 | **恰好**一个 Comment，`data` **等于** CSR FunctionHost.`placeholder.data`（逐字） | 省略；改写为其它字面量（如把 `root`/`array item` 写成 `rx list item`）；尾 `<!--axii:0-->` |
| 内层 | 保留与 CSR 一致的内层结构 Comment | 把内层结构 Comment 当 `axii:*` 删除 |
| 互斥 | — | 套用 H2/FTS；套用 H1/A1；在非 G3-F 位点套用「必须 `rx list item` + computed」的 FCS 全称；套用 EmptyHost |

**父类**：仅 **NORMAL**（同 FTS）。

##### FCS — Hydrate / Identity / 切换 / destroy

| 步骤 | 行为 | 完成后 |
|---|---|---|
| FC1 | 游标认领结构产物子树（identity ===） | 内容在 |
| FC2 | 认领紧随的 Comment `data==='computed node'` 为内层 Host placeholder（identity ===） | 与 CSR 同形 |
| FC3 | 认领紧随的 Comment，`data ===` 期望的 FunctionHost.`placeholder.data`（identity ===） | **无** Text 插入 |
| FC4 | 该 Comment → FunctionHost.`placeholder`；`textNode===null`；`element===innerHost.element` | CSR Comment-ph 结构同形 |
| FC5 | 稳态无 `axii:*`；destroy / 区间搬移以 `placeholder` Comment 为末端（对标 CSR） | 无孤儿 `axii:0` |
| FC6 | 结构↔文本：文本态按 Comment-ph（§3.2.1 BC/EC）；再回结构按 FC1–FC4 | 与 CSR 一致 |

| Identity | 规则 |
|---|---|
| 结构子树 / `computed node` / FunctionHost.`placeholder` Comment | 全部 **认领 `===`**（无尾 Text 插入例外） |
| 误路径 | DOM 出现尾 `axii:0`/尾空 Text、或 placeholder.data 字面量错误 → §3.7 失配（不得静默当 FTS 或改写 data） |

##### Root placeholder 契约（方案 A；唯一）

与 CSR `createRoot().render` 对称：`hydrateRoot` **必须**使用 `Comment` 且 `data === 'root'` 作为顶层 Host placeholder。

| 阶段 | 行为 |
|---|---|
| `renderToString` | 返回的 `html`（主树）在内容序列化之后 **必须包含**尾部 `<!--root-->`（与 CSR 容器子序列末端同形）。Portal 旁路 html **不含**该 root 锚（各 Portal 有自身 root 语义时按 Portal 子树独立约定；首版 Portal 内容树若经独立 `createRoot` 对称，则该旁路片段同样以 `<!--root-->` 结尾——实现与 M-05 对齐 CSR Portal）。 |
| 解析后 | 容器（或将注入的主 html）末子节点为 Comment(`root`) |
| `hydrateRoot` | **认领**该 Comment 为 root Host placeholder（identity ===）；**禁止**新建替代、**禁止**省略后靠插入伪装却不在比对中声明 |
| 顶层文本空 | **仅**文本 Host 路径（`() => null` / `atom('')` / boolean→`''` 等）：按 A1c——SSR 可仅 `<!--root-->`；hydrate 在 Comment 前插入 `Text('')`（Comment-ph 空） |
| 顶层 EmptyHost | `render(null)` / 顶层 Component→null：按 **§3.2.6**——SSR `<!--empty--><!--root-->`；hydrate 双 Comment 认领；**禁止**套用「顶层文本空」A1c |
| 顶层静态元素 / 组件（非 null） | SSR：`…元素…<!--root-->`；hydrate 认领元素 + root Comment |
| 顶层 Function 结构 | SSR / hydrate 按 **FCS**，data=`root`（例 C） |
| 禁止 | 对 root 套 FTS；省略 `<!--root-->` 且不认领（d10 `omitRootVsCsr`）；把 root 写成 `rx list item`；把 EmptyHost 顶层当成文本空 |

**否决方案 B**（SSR 省略 root、hydrate 插入）：会在激活前解析树与 CSR 首帧形状不等价，迫使 Identity/规范化引入「root 插入例外」。方案 A 使 SSR 解析树在 root 锚上与 CSR 对齐，验收更简单。若实现发现调用方 HTML 片段惯例冲突，仍须在拼进 `hydrateRoot` 容器前补上 `<!--root-->`（框架 `renderToString` 默认已包含）。

##### 禁止（显式否决）

| 方案 | 否决理由 |
|---|---|
| 「凡 Comment+结构 ⇒ G3 / 一律 `rx list item`」 | F24 / d10：`root`/`array item`/嵌套 `computed` 字面量错误 |
| 「凡非 Compact 行 ⇒ FCS」 | F25 / d11：仅 G3-F；Component/Fragment/null 不是 FCS |
| 对 FCS/Root 发尾 `axii:0` 或插入尾 Text | d10 `wrongFtsOnRoot`：≠ CSR |
| 省略 `<!--root-->` | d10：与 CSR 容器形状 unequal |
| 修改 CSR 去掉 root Comment 或统一改 Text placeholder | 要求 8 / 偏离既有 Host 区间 |
| StaticArray 函数项发 `rx list item` | d10 `g3LiteralMismatch` |
| 将 `empty` 当作 FunctionHost placeholder 或 A1c 空内容 | F25：`empty` 是 EmptyHost.element |

### 3.2.6 EmptyHost — 完整有限契约（「EmptyHost / 空源」同域第一次；与 A1c / FCS / FTS / Comment-ph 文本空互斥）

**硬事实**：F25（及 `createHost.ts` EmptyHost；`FunctionHost` null→文本路径；`ComponentHost`/`RxListHost` 经 `createHost(null)`）。

**定义**：当 `createHost` 源为 `null` 或 `undefined` 时创建的 Host。`element = Comment('empty')`；`placeholder` 为调用方传入的外层结构 Comment（`root` / `rx list item` / `array item` / Portal 子树 root 等）。**不是**文本单元；**不是** FunctionHost。

**与相近路径的互斥表（有限；穷尽对照）**

| 场景 | CSR Host | CSR 稳态形状（HTML 可见） | SSR 必须 | 禁止套用 |
|---|---|---|---|---|
| `createHost(null)` / Component→null / `render(null)` | EmptyHost | `<!--empty--><!--{outer}-->` | § EH 发出 | A1c；FCS；插 Text |
| `() => null` / FunctionHost 文本态 null | FunctionHost 文本 | `#text:""` + outer；HTML 常仅 outer Comment | A1c / Text-ph 空（按 placeholder 种类）；**RxList 行**见 **G4-F** | EmptyHost / G3-E |
| `atom('')` / `atom(null)` Comment-ph | AtomHost | `#text:""` + structure Comment；HTML 仅 structure | A1c | EmptyHost |
| `atom('')` Text-ph | AtomHost | Text；HTML 无节点 → `axii:0` | A1 | EmptyHost |
| boolean `false` 子 / PrimitiveHost | PrimitiveHost | 同文本空 | A1 / A1c | EmptyHost（`createHost(false)` ≠ EmptyHost） |
| Function 结构返回元素 | FunctionHost FCS/FTS | 含 `computed node` | FCS/FTS | EmptyHost |

##### EH — 发出 / Hydrate / Identity / destroy

**发出（唯一）**

```text
<!--empty-->
<!--{outerPlaceholder.data}-->
```

| 规则 | 必须 | 禁止 |
|---|---|---|
| 双 Comment | `empty` **紧邻**在外层 placeholder **之前** | 省略 `empty`；只发 outer（A1c）；在两者间插 Text/`computed node`/`axii:*` |
| `empty` 角色 | EmptyHost.**element**（认领） | 当作 FunctionHost placeholder；当作 `axii:0`；当作可删瞬态标记 |
| outer | data **等于** CSR 传入 placeholder（`root` / `rx list item` / `array item` / …） | 改写字面量 |

**Hydrate**

| 步骤 | 行为 | 完成后 |
|---|---|---|
| EH1 | 游标匹配 Comment `data==='empty'` | element 位点在 |
| EH2 | 认领该 Comment 为 EmptyHost.`element`（identity ===） | — |
| EH3 | 认领紧随 Comment 为 EmptyHost.`placeholder`（identity ===；data 匹配期望） | CSR 同形 |
| EH4 | **不**插入 Text；**不**期望 `computed node` | 与 F25 |
| EH5 | destroy/move 区间 `element…placeholder`（对标 EmptyHost.destroy / RxList hostFirst/Last） | 无孤儿 |

| Identity | 规则 |
|---|---|
| `empty` Comment / outer placeholder Comment | 全部 **认领 `===`**（无插入例外） |
| 误路径 | 缺 `empty`、多 `computed node`、或 hydrate 插 Text → §3.7 失配 |

**典型位点**

| 位点 | outer.data | SSR 例 |
|---|---|---|
| Root `render(null)` | `root` | `<!--empty--><!--root-->` |
| 顶层 Component→null | `root` | 同上 |
| RxList 行 null（G3-E） | `rx list item` | `<!--empty--><!--rx list item-->` |
| StaticArray 项 null | `array item` | `<!--empty--><!--array item-->`（+ 可能的数组尾锚） |
| Portal 主树 `null` | EmptyHost（Portal 内容在旁路）；主树位点按 EmptyHost + 该树 placeholder | 与 §3.3.d「主树 null→EmptyHost」一致 |

##### 禁止（显式否决）

| 方案 | 否决理由 |
|---|---|
| 空源只发 outer Comment（A1c） | d11：CSR 有 `<!--empty-->`；reorder/认领缺 element |
| 空源发 FCS `computed node` | d11 `wrongFcs*`；EmptyHost 不是 FunctionHost |
| hydrate 对 EmptyHost 插入 Text | ≠ CSR；破坏双 Comment 区间 |
| 把 `() => null` 当 EmptyHost | FunctionHost 文本路径（F25）；RxList 上为 **G4-F**（F26） |
| 把 `empty` 列入 FunctionHost placeholder 集 | 源码仅 EmptyHost.element |
| 修改 CSR 合并 empty 进 placeholder | 要求 8 / 偏离区间语义 |

### 3.3 开放点裁定

| 点 | 裁定 |
|---|---|
| **a. lazy** | 服务端**同步**渲染：不调用/不等待 `load()` 的 resolved 组件。输出 `fallback(error?)` 若提供，否则 `null`（与当前客户端加载中语义一致）。不支持「服务端等待懒加载完成」。客户端激活后按既有 `lazy` 语义启动 `load()` 并替换。实现须绕开 `lazy.ts` 在渲染时无条件 `startLoad()` 的模块级状态，避免污染后续客户端加载（实现纪律，见评审注意事项）。 |
| **b. 流式** | **不在本任务范围**。不提供 `renderToStream`。 |
| **c. 状态传递** | **非目标**。框架不提供 dehydrate/serialize。调用方须保证激活时组件树与响应式数据与 SSR 时刻一致；否则走失配条款。 |
| **d. Portal** | 见下方真值表。主树位置仍为 `null`（**EmptyHost**，§3.2.6：`<!--empty-->` + 该树 placeholder）。**禁止**在 Node 注入 DOM 以实现 `HTMLElement`。 |

#### 3.3.d Portal SSR / hydrate 契约（有限表）

**键导出**：`portalKey` prop（若提供）优先；否则使用 `container.id`（字符串，非空）；得到 `portals` 的键。

| # | SSR 期 `container` / 输入形态 | `portalKey` prop | 结果 |
|---|---|---|---|
| 1 | `{ id: string }`（duck，**非** `HTMLElement`） | 缺省 | `portals[id] = { html, styles }`；合法 Node 主路径 |
| 2 | `{ id: string }` | 非空字符串 `k` | `portals[k] = …`（prop 优先） |
| 3 | 字符串 `idOrKey`（`createPortal` / 放宽后的 container 联合类型） | — | 视为键；`portals[idOrKey] = …` |
| 4 | 真实 `HTMLElement` 且 `id` 非空 | 缺省 | 与行 1 相同键规则（浏览器侧偶发 SSR）；**不**作为 Node 要求 |
| 5 | 真实 `HTMLElement` 且无 id | 非空 `k` | `portals[k] = …` |
| 6 | 无合法键：缺 id、空 id、非 `{id}`/string/HTMLElement、或 HTMLElement 无 id 且无 `portalKey` | — | **抛错**（可观测；非静默丢弃） |
| 7 | 两 Portal 导出同一键 | — | **抛错** |

`createPortal(content, container)` 与 `<Portal container={…} portalKey? content={…} />` 共用上表。类型放宽为：

```ts
type PortalContainerRef = HTMLElement | string | { id: string }
```

（CSR 既有 `HTMLElement` 调用保持有效；Node SSR 使用 `string | { id: string }`。）

**`renderToString` 返回**：`portals: Record<string, { html: string, styles: string }>`。不提供无实现的 `portalContainers` options 占位。

**`hydrateRoot` 解析容器**：

| 优先级 | 行为 |
|---|---|
| 1 | `options.portals[key]` 若提供 |
| 2 | 否则 `document.getElementById(key)`（仅当 key 亦为元素 id） |
| 3 | 仍缺失 | **抛错**（dev 可附加诊断） |

激活后 `destroyOnUnmount` 等按 CSR。Portal 内容树递归适用同一 SSR/hydrate 规则（含文本边界与表单表）。

### 3.4 服务端生命周期

| 能力 | 服务端 | 激活后 |
|---|---|---|
| 事件 prop | 不输出 listener；可忽略函数值 | 按 CSR 绑定 |
| `useEffect` | 不执行 | 按 CSR（attach 后） |
| `useLayoutEffect` / 可测 DOM 的 ref | 不执行 | 与 CSR 相同的 attach / `flushAttachQueue` 时序 |
| `reactiveDOMState` | 不订阅、不读 layout | 激活后按 CSR |
| StyleManager 嵌套/@ 规则 | 序列进 styles 字符串 | 迁入 `adoptedStyleSheets` + 记账 |
| Portal | 见 §3.3.d | 见上 |
| 响应式订阅 | 渲染期允许临时读/依赖收集；**结束时必须全部断开** | 正常 CSR 订阅 |

同进程：连续两次 `renderToString`、以及并发两次（Promise 并行）不得互相污染全局样式表登记或残留订阅；用 Node 测试证明。

### 3.5 样式

1. SSR：复用 StyleManager 的规则生成逻辑（`stringifyStyleObject` / `generateStyleContent` / path 静态 id），写出 CSS 文本；**禁止** SSR 路径使用 `Math.random` id——动态样式改用确定性后缀（path + 内容签名 + 稳定序号），并写入元素 class，供 hydrate 复用同一 id。实现期一并处理 `animationName` 等其它 `Math.random` 派生名（CSR 稳态行为以样式相关全量测试为准）。
2. **发出前**对 `generateStyleContent` 返回的**每一条**规则字符串施加 §3.6.1 **CSS 规则逃逸门闩**；不合格规则 **omit**（与 CSR `insertRule` catch 跳过对齐），**禁止**把会被 `insertRule` 拒绝的多规则/逃逸串写入 HTML。主树 `styles` 与 Portal `portals[k].styles` **同一门闩**。
3. 返回：`styles` 字符串；调用方负责放入 document（或 `renderToString` 提供拼好的完整片段选项）。推荐默认：主 HTML 前/旁带 `<style data-axii-ssr="…">`。写入前另适用 §3.6.1 `</style` 终止序列门闩。
4. Hydrate：根据 DOM 上已有 axii style class 重建 `StyleManager` 映射与 refcount；创建等价 `CSSStyleSheet` 并入 `adoptedStyleSheets`（仍逐条 `insertRule`）；**在 adopted 生效后再移除** SSR `<style>`，避免闪变（实验：`noFlashMigrate.stable`）。
5. 之后卸载/更新与 CSR 同一 `unmount`/`collect` 语义。

### 3.6 HTML 安全与表单序列化

#### 3.6.1 转义（按通道；有限表）

| 通道 | 规则 |
|---|---|
| NORMAL 文本节点 | 转义 `& < >` |
| 属性值 | 转义 `& < > "`；按双引号属性输出 |
| 布尔属性 | 真：`name="true"`；假：不输出 |
| RCDATA 子文本（`textarea`/`title`） | 转义 `& < >`（实体会被解码；可安全承载字面 `</textarea>` 等，d4）；**禁止**暗示与 RAWTEXT 相同 |
| RAWTEXT 子文本（`style`/`script`/…） | **不做** `& < >` 实体转义（F15：不解码）。序列化前做**终止序列门闩**（见下）；命中则 **SSR 抛错**，禁止静默截断 DOM |
| §3.5 `styles` → `<style data-axii-ssr>` 载荷（及 Portal `styles`） | ① **CSS 规则逃逸门闩**（见下）：对 `generateStyleContent` 每条规则，不合格则 **omit**，不得进入载荷；② 不对作者 CSS 做 HTML 级 `& < >` 转义（以免破坏 CSS）；③ 适用**同一** `</style` 终止序列门闩，命中则 **抛错**。**禁止**仅依赖 `</style` 门闩声称注入面已覆盖（d5） |
| `dangerouslySetInnerHTML` | **不转义**，原样嵌入（与 CSR `innerHTML` 一致）；与 children 并存时与 CSR 相同（innerHTML 胜出）；测试覆盖脚本/事件处理器注入字符串仍按「作者信任输入」语义，并文档化为调用方责任 |

**CSS 规则逃逸门闩（SSR 样式载荷；有限；与 CSR `insertRule` 对偶）**

源码依据：`StaticHost.createStyleSheet` CAUTION（~269–276）——值中的 `}` 可闭合当前规则并注入后续全局规则；CSR 用**逐条** `insertRule`，多规则串被整条拒绝并 **skip**。

对 `generateStyleContent`（及任何写入 §3.5 / Portal `styles` 的规则串）的每一条 `R`：

| # | 检查 | 合格 | 不合格处置 |
|---|---|---|---|
| S1 | `R` 可作为**单条** CSS 规则被接受（与 Chromium `CSSStyleSheet.insertRule(R)` 同一拒绝类：多规则串、非法 at-rule 等） | 纳入载荷（规则间 `\n` 拼接） | **omit**（不写入 HTML；dev 可 log，对标 CSR `console.error`）；**禁止**静默保留逃逸段 |
| S2 | 合法带引号值（如 `content:"a}b"`）——引号内 `}` 不闭合规则 | 保留（d5 `quotedBraceAcceptedByInsertRule`） | — |

- Node 无 CSSOM：实现纯函数 `isAcceptableSingleCssRule(R)`；**契约**：凡 Chromium `insertRule` 拒绝的输入必须判定不合格。用配对测试钉死（浏览器 oracle + Node 同输入）。
- 最终载荷仍过 `</style` 终止序列门闩（下表）；两门闩独立、都要满足。
- 负向验收：逃逸串（d5 `styleBreakout.rule`）经门闩后，解析所得 `<style>` **不得**出现注入的全局选择器（如 `body`）；与 CSR skip 后 `cssRules` 不含该注入对齐。

**终止序列门闩（RAWTEXT 元素与 SSR `<style>` 载荷；有限）**

对目标结束标签名 `T`（`style`→`style`，`script`→`script`，其余 RAWTEXT 标签同理），若载荷/子文本中存在满足下列条件的子串则 **SSR 抛错**（可观测）：

1. 大小写不敏感匹配 `` `</` + T ``；且
2. 紧随字符为 ASCII 空白、`/`、`>` 或字符串结束（与 HTML 结束标签状态机一致；d4 `styleBreakCaseInsensitive`：`</STYLE>` 同样关闭）。

**禁止**：用 `&lt;/T>`「转义」同时声称保留作者字面 `</T>`（RAWTEXT 不解码）。若作者内容必须包含该字面序列，本任务不提供 HTML 序列化通道——抛错优于错误 DOM。

#### 3.6.2 表单 / IDL 状态 → SSR HTML（完整有限契约；同域第二次复审后钉死）

CSR 多处写 IDL/`__axiiSelectValue__` 而不反映到 `outerHTML`。SSR **必须**使**解析后 IDL**与渲染时刻数据一致（不得复制 CSR `outerHTML` 缺属性的表象）。源码权威：`src/DOM.ts` `setAttribute` / `createElement` deferred form props。

**硬事实**

| # | 事实 | 证据 |
|---|---|---|
| F-F1 | 一般 `input`/`textarea`/`option` 的 `value`：`setProperty('value', v == null ? '' : v)`；text 等类型的 `.value` **常不**进入 content attribute | 源码；d1 |
| F-F2 | `INPUT type=checkbox` 且 prop `value`：先 F-F1 的 value 写入，再按**原始** `v` 的 truthiness 写/清 `checked` 属性与 property（`DOM.ts` ~452–460）——**双通道**，不是「仅 checked」 | 源码；d8 / review-d8 |
| F-F3 | 仅 `checked="true"`、无 `value` 属性的 checkbox：解析后 `.value === 'on'`（缺省），与 `value={true}` 的 CSR `.value === 'true'` **不等** | d8 `idlMismatchIfFollowDesign` |
| F-F4 | `value={true}` 正确 SSR：`value="true" checked="true"` → 解析 IDL 与 CSR 对齐 | d8 `idlMatchIfBoth` |
| F-F5 | `checked` 专用分支**仅** checkbox（~462–471）；radio 的 `checked` 走通用 property 路径；radio 的 `value` **不**触发 checked 语义 | 源码；d8 `radioValueTrue.checked===false` |
| F-F6 | `createElement` 将 `value`/`checked` **延后**到其余 prop（含 `type`）之后，并按 `rawProps` **键枚举序**依次 `setAttribute`（~752–802） | 源码；d8 `orderWins` |
| F-F7 | `textarea`：CSR `.value` 不进入 `outerHTML` 子节点；解析后 `.value` 来自**子文本**；仅 `value` 属性 → `.value===''` | d1 |
| F-F8 | `select`/`option`：CSR 设 `select.value` 后 option 可无 `selected` attr；解析需 `selected="true"` | d1 |

**通道定义（有限；互斥边界写清）**

| 通道 ID | 触发（props 快照） | SSR 必须 | 禁止 |
|---|---|---|---|
| **IV** | `input`（`type` 不是 checkbox 的 value→checked 双通道语义；含 text/password/hidden/number/radio 的 value 等）上的 `value` | `value="{escape(String(applied))}"`，`applied = v == null ? '' : v` | 省略导致解析 `.value` 与数据不符；把 radio/text 的 value 当成 checked |
| **CK** | `input` 上**仅** `checked` prop（无同元素 `value` prop），`type` 为 checkbox 或 radio | 真：`checked="true"`；假：不输出 `checked`；**不**输出 `value` 属性（保留浏览器缺省 `.value==='on'` 等） | 因 checked 而误写 `value="true"`；checkbox 假时残留 `checked` |
| **CB** | `input type=checkbox` 上存在 `value` prop（无论是否另有 `checked`） | 见下方 **CB 发出算法**与矩阵 | 「同 CK 行」只发 checked；省略 value 属性 |
| **TA** | `textarea` 的 value | **子文本**按 §3.6.1 RCDATA 转义；**禁止** `value` 属性冒充；**禁止** `axii:*`（§3.2.1 A3） | 只靠 value 属性；发文本标记 |
| **SO** | `select` 的 value / multiple 数组，或独立 `option selected` | 对应 `option` 上 `selected="true"`（多选多个）；假/未选不输出 | 依赖 CSR 无 attr 的 outerHTML |

字面量与 CSR 布尔约定对齐：`checked="true"`、`selected="true"`、`disabled="true"`。属性值转义一律 §3.6.1。

##### CB — checkbox `value` 通道（完整有限）

**Applied value 字符串**：`applied = (v == null ? '' : v)`，HTML 属性值为 `String(applied)`（经属性转义）。`null`/`undefined` → `value=""`。

**仅 `value`、无 `checked` prop 时的发出矩阵**（与 d8 `matrix` / review-d8 对齐；穷尽常见标量）：

| `v` | 必须发出的属性片段 | 解析后 `.value` | 解析后 `.checked` |
|---|---|---|---|
| `true` | `value="true" checked="true"` | `'true'` | `true` |
| `false` | `value="false"`（无 checked） | `'false'` | `false` |
| `null` / `undefined` | `value=""`（无 checked） | `''` | `false` |
| `''` | `value=""`（无 checked） | `''` | `false` |
| `0` | `value="0"`（无 checked） | `'0'` | `false` |
| `1` | `value="1" checked="true"` | `'1'` | `true` |
| 非空字符串 `s`（如 `'hello'`） | `value="{escape(s)}" checked="true"` | `s` | `true` |

通则：`checked` 属性 **当且仅当** 原始 `v` 为 truthy；`value` 属性 **始终**发出（含空串）。

**`value` 与 `checked` 同元素（组合；有限）**

1. 若存在 `value` prop：按 CB **始终**发出 `value="{escape(String(applied))}"`（与是否另有 `checked` 无关）。
2. 最终是否发出 `checked="true"`：按 CSR deferred 序模拟——对 `rawProps` 中键序遍历，仅处理 `value` 与 `checked`：
   - 遇 `value`：令 `finalChecked = !!v`（原始 value 的 truthiness）；
   - 遇 `checked`：令 `finalChecked = !!checkedProp`；
   - **后者覆盖前者**（d8：`value` 后 `checked={false}` → 未选中但仍有 `value="true"`；`checked={false}` 后 `value={true}` → 选中）。
3. 若 `finalChecked`：发 `checked="true"`；否则不输出 `checked`。
4. **禁止**在「仅 CK、无 value prop」时套用本表去写 `value="true"`。

**否决**：把 CB 折叠为「同 CK 行」（仅 `checked="true"`）——F-F3，已否决（评审 P1 / d8）。

##### 其它通道摘要表

| 控件 | CSR 典型写入 | SSR HTML 必须产出 | 解析后期望 |
|---|---|---|---|
| IV：非 CB 的 input `value` | `setProperty('value')` | `value="…"`（转义） | `.value` 匹配 |
| CK：仅 `checked`（checkbox/radio） | property ± attr | `checked="true"` 或省略 | `.checked` 匹配；checkbox 无 value 属性时 `.value==='on'` 可接受 |
| CB：checkbox `value`（± `checked`） | 双通道 ± deferred 覆盖 | 上表 / 组合算法 | `.value` **与** `.checked` 均匹配 |
| radio 的 `value` | 仅 value（F-F5） | 按 IV；**不**因 value 发 checked | `.checked` 不被 value 置位 |
| TA：textarea value | `setProperty('value')` | 子文本（RCDATA）；禁 value 属性冒充；禁 `axii:*` | `.value` 来自子文本 |
| SO：select / option | IDL / `__axiiSelectValue__` | `selected="true"` 于对应 option | `.value` / `selectedOptions` / `.selected` 匹配 |

### 3.7 不匹配行为

**定义**：激活游标期望的节点类型/标签/标记与实际 DOM 不一致，或关键属性/文本与客户端首帧快照在可比规范下不一致。

| 环境 | 行为 |
|---|---|
| diagnostics / `__DEV__` | 结构化报告（`reportAxiiError` 或专用 hydration 诊断），包含期望 vs 实际；**不得**静默留下错误绑定 |
| 生产 | 对失配**子树**丢弃该区间既有 DOM 并改为 CSR 创建（局部重建）；不整页无声失败 |
| 观测 | 测试可断言：诊断被触发；失配子树节点 identity 与解析前不同；匹配子树 identity 保持 |

版本/数据漂移与 HTML 篡改均落入本条款。正确匹配路径禁止重建（identity 断言）。

### 3.8 公开 API 与产物

```ts
// axii/ssr（Node / 任意无 DOM 环境）
type PortalContainerRef = HTMLElement | string | { id: string }

function renderToString(
  source: JSX.Element | ComponentNode | Function | string | number | ...,
  options?: {
    // 预留扩展；首版可为空对象。禁止 unused 假字段。
  }
): {
  html: string
  styles: string
  portals: Record<string, { html: string, styles: string }>
}

// axii 主包（浏览器）
function hydrateRoot(
  container: HTMLElement,
  source: /* 同 render */,
  options?: { portals?: Record<string, HTMLElement> }
): Root  // 与 createRoot 结果同形：destroy / on / 已 attached
// 契约：container 子树须已含 renderToString 产出（主 html 含尾 <!--root-->）；
// hydrateRoot 认领 Comment(data==='root') 为顶层 placeholder（§3.2.5 方案 A）

// Portal / createPortal（类型放宽，CSR 行为不变）
// container: PortalContainerRef
// Portal 可选 portalKey?: string
```

- `createRoot().render` 保持 CSR-only；不在 `render` 上增加隐式 hydrate。
- `renderToString().html` **包含**尾部 `<!--root-->`（与 CSR `createRoot` 容器末端对齐）；`hydrateRoot` **认领**而非新建该锚。
- `package.json` exports 增加 `./ssr`（types + import + require），独立 rollup 入口（外部化浏览器主包对称于 vite-plugin）。
- 主包 export `hydrateRoot`；确保 `__tests__/node/importInNode.spec.ts` 仍通过；另加 Node 测试：`renderToString` 可调用，含 Portal duck/`string` 容器用例（无 `document`）；并断言主 html 含 `<!--root-->`。

### 3.9 验证体系

- Node：`vitest.node.config.ts` 扩展 `renderToString`、转义、无泄漏/并发、lazy/Portal 服务端语义（duck container）。
- 浏览器：Vitest + Playwright——注入 Node 产出的 HTML 字符串到容器，`hydrateRoot`，断言 identity、更新、失配、样式无闪变、retained 归零、相邻文本认领。
- 端到端链路：允许 Node 测产生 HTML fixture + 浏览器测消费；或单测内用 Playwright 的 Node 侧拼串（不引入 jsdom 断言）。
- 触及 Host 区域/锚点时跑 `__tests__/rxListFuzz.spec.tsx`。
- 性能：改动后 sibling `../benchmark` 关键路径口径无回归（实现后期里程碑记录命令与结果）。

---

## 4. 里程碑

### M-01 最小端到端链路（消除最大不确定性）

- **结果**：纯 Node `renderToString` 对「静态元素 + atom 文本」产出 HTML；浏览器解析后 `hydrateRoot` **复用**文本/元素节点；atom 更新反映到同一文本节点；与同数据 CSR 首帧在规范化后形状等价。**显式覆盖**：
  1. 相邻非空动态/静态文本（两 atom，或**静态文本 + atom**）：按 §3.2.1 A2 发出 `axii:t`/`axii:/t`；hydrate 认领后删除边界；稳态无 `axii:*` 残留；两 Text 可分别更新（atom 侧）且 identity 保持。**种类**：静态半侧 = **ElementChildText**（元素子 Text，非 Host、非 `directNodes`）；atom 半侧 = **Text-ph**。禁止把静态半侧认领为 AtomHost 或写入 `directNodes`。
  2. **空 atom**（`atom(null)` / `atom('')` / boolean→`''`；**Text-ph**）：SSR 发出 `<!--axii:0-->`；hydrate **插入** `Text('')` 后删哨兵；可更新为非空；稳态无 `axii:0`；identity 按 §3.2.1 D（插入例外）。
  3. **Root 锚（§3.2.5 方案 A）**：`renderToString` 主 `html` **含**尾部 `<!--root-->`；`hydrateRoot` **认领**该 Comment（identity ===）；激活后容器与同数据 `createRoot().render` 对照含 root 锚；**禁止**省略 root 或对顶层结构套 FTS。
  4. **EmptyHost（§3.2.6）**：至少一条 `render(null)` **或** 顶层 Component→null —— SSR `<!--empty--><!--root-->`；hydrate 双 Comment 认领（`empty`===element）；**禁止**套用 A1c（仅 root + 插 Text）或 FCS。
- **覆盖要求**：1（子集）、2（子集）、3（子集）、9（API 雏形可测即可）
- **前置**：无
- **状态**：已完成
- **reopen-count**：0
- **reopen-domains**：∅
- **验收命令**（实现阶段新增）：
  - `npx vitest run --config vitest.node.config.ts __tests__/node/ssrRenderToString.spec.ts`
  - `npx vitest run __tests__/ssrHydrate.smoke.spec.tsx`（含相邻非空文本 identity / **空 atom 插入** / 分更新 / **无 axii:t|axii:/t|axii:0 残留** / **静态半侧为元素子非 Host** / **认领 `<!--root-->` 与 CSR createRoot 对照** / **EmptyHost `<!--empty--><!--root-->` 认领**）
- **最新证据**：k=1 实现通过；审计轮复验通过并加强 smoke（AtomHost.destroy 后 static 仍在；两 atom identity/分更新；缺陷注入：错误 destroy 所有权 / 空哨兵残留 / 省略 root → 红，还原后绿）。`src/ssr.ts` / `hydration.ts` / `hydrateRoot` / DOM+EmptyHost 认领路径；exports `./ssr` 雏形（dist 核验 M-06）

### M-02 属性、事件、转义、组件、context、函数节点、Fragment

- **结果**：属性/布尔/class/style 对象简单项、事件绑定（仅客户端）、文本与属性转义、`dangerouslySetInnerHTML` 边界、ComponentHost 嵌套、`createContext`/`ContextProvider`、FunctionHost 条件结构、Fragment 标记均可 SSR+hydrate，行为与 CSR 对齐。**表单**：§3.6.2 各通道至少一条「SSR 字符串 → 解析后 IDL」用例——含 **CB** `value={true}` → `.value==='true'` **且** `.checked===true`（禁止只断言 checked 而放过 `.value==='on'`）；至少一条 CB falsy（如 `false`/`0`）→ value 属性存在且未选中；至少一条 CK-only（无 value prop）→ `checked="true"` 且无误写的 `value="true"`；textarea 子文本；select/option `selected="true"`；checkbox/radio 的 CK。**显式**：FunctionHost 文本态 `false`/空串在 **Text-ph** 走 `axii:0`；**FunctionHost Text-ph 结构态（§3.2.4 FTS / §3.2.0 H2）**：至少一条**元素子函数**条件返回元素（`createElement` 函数 child，非 RxList Comment-ph）——SSR 为 `…<!--computed node--><!--axii:0-->` → hydrate 后 `placeholder` 为插入的空 Text、`computed node` identity 保留、`textNode===null`；可切换回文本；destroy 无孤儿；**不得**仅用 RxList G3 用例冒充；至少一条返回 Fragment 的 FTS（含 `fragment start`）；**至少一条 createElement 函数 child → 返回 atom**（Text-ph / FTS）：SSR 含 `computed node` + 尾 `axii:0`（例 `world<!--computed node--><!--axii:0-->`）；hydrate 后 `textNode===null`、尾 Text 为 FunctionHost.`placeholder`、内层 AtomHost 认领内容 Text；与「误当 Text-ph 文本态（无 computed）」负向对照。**FunctionHost Comment-ph 结构（§3.2.5 FCS）**：至少一条**非 RxList** 路径——（a）Root 上函数返回元素：`…<!--computed node--><!--root-->`，hydrate 认领 `root`、无尾 Text；或（b）StaticArrayHost 函数项：`…<!--computed node--><!--array item-->`，**禁止**写成 `rx list item`；**不得**仅用 G3/`rx list item` 冒充 FCS 覆盖面。textarea value **无** `axii:*` 标记（§3.2.1 A3 / §3.6.2 TA）；§3.6.1 RAWTEXT/`<style>` 终止序列门闩至少一条负向（含 `</style>` 的载荷 → SSR 抛错）与一条 textarea 实体正向。**ElementChildText**：至少一条多参静态 sibling（`createElement` 多字符串 child，**非**数组）——SSR 按 A2 包边界、**无**尾结构 Comment → hydrate 后两 Text 为元素子（非 `directNodes`、非 Host）；至少一条兄弟间空（`''`+非空）走 `axii:0`；至少一条单 child 空串快路径（无哨兵、0 节点）。**StaticArrayHost DirectNodes**（对照）：至少一条相邻静态数组成员文本（`['hello','world']` 或等价）——SSR 按 A2 包边界 + 尾 `unhandledChild` → hydrate 后两 Text 入 `directNodes`；至少一条空 DirectNodes（`['']` 或 `['','x']`）走 `axii:0`。
- **覆盖要求**：1、2、7、部分 5
- **前置**：M-01
- **状态**：已完成
- **reopen-count**：2
- **reopen-domains**：{ form-idl-so: 2 }
- **验收命令**：扩展 node SSR 用例 + `__tests__/ssrHydrate.attrs-components.spec.tsx`（名称以实现为准；须含空函数文本 + **FTS 元素子函数结构** + **FTS Function→atom（Text-ph）** + **FCS 非 RxList（root 或 array item）** + textarea + 转义门闩 + **CB value 双通道 / CK-only** + **ElementChildText 相邻/空/单空** + **DirectNodes 相邻/空** + **SO：select value→option selected / multiple 数组** + **SO：数组 map/Function/Component 子路径下 option**）
- **最新证据**：k=4 实现 + k4-audit：Closure gates 全绿；`selectSo` 贯穿 StaticArray/Function/Structure/Component/serialize；domain-review `form-idl-so` 闭合。审计加强：Fragment / fn→array / arr→comp / ContextProvider SO 一次列全锁入 node 用例；缺陷注入（StaticArray 丢 SO）验收红后还原绿。ssrRenderToString 29、attrs-components 14、smoke 5、node 35、CSR 23。

### M-03 列表与 HTML 解析角落

- **结果**：RxList 及经 `keys()`/映射投影的 RxMap/RxSet 驱动列表 SSR+hydrate；增删移与 CSR 一致；**含**：
  - **Compact-row**（§3.2.3 G1；最常见单元素行）：SSR **不**发行级 `rx list item`；hydrate 认领元素 identity 为 `CompactElementHost.element`；`hostLastNode===element`；reorder/splice 与同数据 CSR 对照（无多余行 Comment、无标记残留）。至少一条带 `detachStyledChildren` 的非 Compact 元素行对照（G2）。
  - **Comment-ph**（非 Compact 文本行）：
    - **G4**（atom/原始/布尔）：空行 SSR **仅**结构 Comment（无 `axii:0`）；非空行为 Text(+可选 `axii:t`)+结构 Comment；hydrate 后 `element===Text`、`placeholder===` 结构 Comment；reorder/splice 搬移 `element…placeholder` 与同数据 CSR 一致、**无标记错位**、无 `axii:*` 残留。
    - **G4-F**（Function 文本态，§3.2.3）：至少一条 `() => null` **或** `() => false` / boolean→'' —— SSR **仅** `<!--rx list item-->`（**无** `empty`、**无** `computed`、**无** `axii:0`）；hydrate 后 Comment-ph 空文本可更新/搬移；与 **G3-E**（`<!--empty--><!--rx list item-->`）及 **G3-F**（含 `computed node`）对照不等价；**禁止**按 `typeof === 'function'` 一律发 FCS。
  - **G3-E EmptyHost 空源行**：SSR `<!--empty--><!--rx list item-->`；hydrate 双 Comment 认领；与 G4/G4-F atom/Function 空文本行形状 **对照不等价**；**禁止** A1c-only / FCS-computed。
  - **G3-F**（函数返回元素 **或** 其它结构态补集，含返回 atom）：保留 `computed node` + 行尾 `rx list item`（FCS）；至少一条 Function→atom 对照 **不得**并入 G4-F。
  - **G3-C**（组件行返回元素）：行元素 + `rx list item`；**无** `computed node`。
  - **G3-Fr**（Fragment 行）：`fragment start` + 内容 + `rx list item`；**无** `computed node`。
  - **G3-RL**（`item instanceof RxList` 嵌套列表行，§3.2.3）：至少一条 `RxList([innerRxList])` —— SSR 为内层各行（按本表）+ **外层** `<!--rx list item-->`；**无**外层 `computed`/`empty`；hydrate 后嵌套 RxListHost + 外层 placeholder 认领；内层 splice/reorder 与 CSR 对照；**禁止**仅用 flat map 到元素冒充；**禁止**套用 G3-F/G4 扁平。
  - **G3-RU**（`ReusableHost` 行，§3.2.3）：至少一条 `reusable(…)` 入列 —— SSR `…<!--reusable--><!--rx list item-->`；hydrate 认领；与 Compact/FCS 对照。
  - **不得**套用 Compact 到上述非 Compact 行；**不得**用「一律 FCS」冒充 G3-C/Fr/E/RL/RU/**G4-F**；行分派表须与 `createHost` 分支闭合（§3.2.3 权威闭合规则）。
  - **Text-ph** 文本行若出现在列表相关结构中：仍按 A1/A2/E-Text-ph。
  - table/select/optgroup 等按 §3.2 稳定结构；相关 fuzz 通过。
- **覆盖要求**：1、2、3、10.d
- **前置**：M-02
- **状态**：已完成
- **reopen-count**：6
- **reopen-domains**：{g3a-row-hydrate: 1, g3a-array-item-ssr: 1, fragment-hydrate-under-cursor: 4}
- **验收命令**：
  - 列表 SSR/hydrate 规格测试（须含：**Compact 元素行** SSR→hydrate→reorder/splice 与 CSR 对照；Comment-ph 空/非空文本行 move/delete；**G4-F Function 文本态空行**；**null 行 EmptyHost**；**组件行无 computed**；**Fragment 行有 fragment start**；**函数结构行有 computed（G3-F）**；**嵌套 RxList 行（G3-RL）**；**ReusableHost 行（G3-RU）**；**G3-A DirectNodes 字符串/数字行**；**G3-A multi-atom 行独立更新**；**G3-A mixed DirectNodes+element**；**G3-A nested Array 项无嵌套 unhandledChild**；**G3-A Fragment 项有 fragment start**；**G3-A Component/RxList 项无 orphan unhandledChild**；**G3-A Component→Fragment / Function→Fragment 项**；**G3-C/G3-F Component|Function→Fragment 行**（active list/array cursor 下 Fragment createElement 不得误认领文本）；**Fragment 内 atom / nested function / array 子**；**element-child Component→Fragment+atom**；**嵌套 Fragment + atom（更新≡CSR）**；**Fragment + boolean false（SSR+hydrate≡CSR Comment-ph）**；**element-child Fragment flatten（无 fragment start）+ atom/nested/boolean/function/array/Component/RxList/static**；**RxMap.keys() Compact**；断言 Compact 无行级 `rx list item`、Comment-ph/G4-F 的 placeholder 为结构 Comment、EmptyHost 为 `empty`+`rx list item`、G4-F 无 `empty`/无 `computed`、G3-RL 有外层行锚无外层 computed、G3-RU 有 `reusable`）
  - `npx vitest run __tests__/rxListFuzz.spec.tsx`（若改锚点/区域）
- **最新证据**：k=11 实现 + k11-audit：路径 B flatten reconcile；milestone-review 闭合 `fragment-hydrate-under-cursor`。审计加强 lists→45；缺陷注入短路 flatten reconcile→路径 B 红后还原。Closure：lists 45、ssr 53、smoke+attrs 19、fuzz 2、node 59、CSR 23。`convergence-mode→normal`。

### M-04 样式等价与无闪变

- **结果**：嵌套伪类/@ 规则进入 SSR `styles`；hydrate 迁入 `adoptedStyleSheets`；无计算样式闪变；卸载后 StyleManager/retained styles 计数归零。**显式**：§3.6.1 CSS 规则逃逸门闩——与 CSR `insertRule` 拒绝用例对偶：含 `}` 逃逸的规则串不得出现在 SSR `<style>` 可解析出的注入全局规则中（omit 后 `cssRules` 无注入选择器）；Portal `styles` 同门闩；`</style` 终止序列门闩不退化；合法引号内 `}` 仍可发出。
- **覆盖要求**：6、部分 2、部分 7
- **前置**：M-02（可与 M-03 并行依赖上仅需 M-02；实现顺序建议 M-03 后以降低标记干扰）
- **状态**：已完成
- **reopen-count**：2
- **reopen-domains**：{ssr-style-id: 2, ssr-style-atom-inline: 1}
- **验收命令**：`__tests__/ssrStyles.spec.tsx`（浏览器；含逃逸负向 + 无闪变 + F30 StaticArray 分歧 + FunctionHost path reclaim + Chromium insertRule oracle + F31 reactive stylesheet rolling + simple atom inline 快照 + bound+reactive / array / function / CSR↔SSR I0）+ node 样式隔离快照
- **最新证据**：k=14 实现 + k14-audit：domain-review 闭合 `ssr-style-id` / `ssr-style-atom-inline`。审计加强 ssrStyles→16、node→62；缺陷注入短路 `containsReactiveStyleValue`→F31 红后还原。Closure：ssrStyles 16、hydrate 64、fuzz 2、CSR 23、node 62。`convergence-mode→normal`；`current-milestone→M-05`。

### M-05 生命周期、Portal、lazy、服务端隔离

- **结果**：§3.3–3.4 全条款落地；Portal 按 §3.3.d 真值表（Node 侧 duck/`string` 容器无 `document`）；主树 `null` 位点按 **§3.2.6 EmptyHost**（与旁路 portals html 分立）；lazy 同步 fallback；同进程多次与并发 `renderToString` 无泄漏；激活后 effect/layoutEffect/ref 时序与 CSR 一致；`reactiveDOMState` 仅客户端。
- **覆盖要求**：5、11.a、11.d、部分 1–2
- **前置**：M-02
- **状态**：已完成
- **reopen-count**：5
- **reopen-domains**：{portal-static-content-hydrate: 3, portal-fragment-content: 3}
- **验收命令**：node 泄漏/并发/lazy/Portal（含表行 1/3/6；**主树 EmptyHost 与 §3.2.6 一致**）+ 浏览器 lifecycle hydrate 规格（含 **eager HTML Portal content** identity；含 **后置同标签主树 sibling 不得误认领**；含 **Array/ComponentNode/RxList-only 子**；含 **Fragment 根 Portal 内容 `fragment start`**；含 **Fragment 根 + Array/ComponentNode/RxList 子**；含 **嵌套 Fragment Portal 根**；含 **嵌套 Fragment + Array/ComponentNode/RxList（portal + 主树 SSR hydrate）**；含 **元素 Portal 根 + 嵌套 Fragment 子**；含 **元素 Portal 根 + 嵌套 Fragment + Array/ComponentNode/RxList**）
- **最新证据**：k=20 实现 + k20-audit：milestone-review 闭合 `portal-fragment-content` / `portal-static-content-hydrate`。Closure 复验绿；验证加强 lifecycle→35（element portal×nested F×Array/CN/RxList）；缺陷注入 push-then-lift / skip deferred ensure 判别力确认后还原。`convergence-mode→normal`；`current-milestone→M-06`。

### M-06 失配、公开产物、全量门禁与 retained

- **结果**：§3.7 失配可观测且可测；`package.json` exports / dist / `.d.ts` 完整；`importInNode` 通过；retained-object 在 hydrate+destroy 后归零；全量门禁 a–c（及触及的 d）通过；benchmark 口径无回归记录在案。
- **覆盖要求**：3、4、8、9、10、11.b/c（文档化非目标）
- **前置**：M-03、M-04、M-05
- **状态**：已完成
- **reopen-count**：7
- **reopen-domains**：{hydration-mismatch-rebuild: 7}
- **验收命令**：
  - `AXII_DATA0_FORCE_NPM=1 npx vitest run`（833 passed；本机 sibling `../data0` 过旧时需 FORCE_NPM，与 site 同旗标）
  - `npm run build`（`dist/ssr.{js,cjs,d.ts}` + `hydrateRoot` in `axii.d.ts`）
  - `npx vitest run --config vitest.node.config.ts`（78 passed；含 `hydrateRoot` / SSR import / `./ssr` exports）
  - `npx vitest run __tests__/ssrHydrate.mismatch.spec.tsx`（§3.7 + retained；含错标签 / id 漂移 / 缺 `axii:0` / 同标签 sibling 错标签不得偷领 / **异标签 interstitial 不得留孤儿** / **交换异标签不得 wrongIdMiss 错角色** / **同标签 interstitial 不得留孤儿** / **交换同标签 id 不得跨序错线** / **元素子尾部同标签/异标签/文本孤儿不得残留** / **hydrate-root 容器 `<!--root-->` 前后孤儿不得残留** / **Comment-ph 文本值漂移须报告+重建** / **容器 leading 非 SSR STYLE/SCRIPT/LINK 不得残留** / **G4-F/PrimitiveHost Comment-ph 同类** / **portal leading STYLE** / **matched Comment-ph identity**）
  - `npx vitest run __tests__/rxListFuzz.spec.tsx`（2 passed）
  - benchmark：`../benchmark` `npm run benchmark:real` vs `dist/`（2026-08-07；k21 记录 create-5000 无回归、afterClear 0）
- **最新证据**：k=28 实现 + k28-audit：D12/D13 Closure 复验绿；验证加强 mismatch→33（SCRIPT/LINK/G4-F/PrimitiveHost/portal leading STYLE/matched）；缺陷注入 D12×3 + D13×4 判别力确认后还原。最终核验：全量 833、node 78、fuzz 2、build、`./ssr` exports。`hydration-mismatch-rebuild` 闭合；全部里程碑已完成。
**初始里程碑数 M = 6 ⇒ 初始实现预算 N₀ = 5 × 6 = 30**（设计通过进入实现时写入 `implementation-round: 0/30`）。

**预算修订（人工）**：2026-08-07 用户授权提高实现预算。依据：M-02 耗 3 轮并触发 `domain-review`，M-03 已 reopen 1 次；剩余 M-04/M-05/M-06 同属跨层角落。在 N₀ 上为这 3 个未完成里程碑各追加一整份 `5` 轮缓冲（+15），**N = 45**。`k` 不变；协议默认「不得自行增 N」由本次人工覆盖。

---

## 5. 风险与验证安排

### 5.1 设计期已验证（不得再凭记忆推翻）

- Node 无原生 CSSOM / HTMLElement → 字符串样式路径必要；Portal 须 duck/`string` 容器契约
- 注释标记可行；相邻非空纯文本会合并 → SSR 发出 `axii:t`/`axii:/t`；**hydrate 后必须删除**（保留则 destroy 孤儿 + 列表搬移错位，d2）
- Text-ph 空 Text 不进 HTML；空开闭对无中间 Text → **Text-ph 空单元唯一** `<!--axii:0-->`，hydrate 插入 Text（d3）；省略则无认领位点
- Comment-ph 空单元：CSR/`innerHTML` 仅结构 Comment；SSR 只发结构 Comment；hydrate 插入 Text 并认领 Comment 为 `placeholder`（d4）；E4「一律 Text-only」会 reorder 错位
- DirectNodes（StaticArrayHost 原始文本）：相邻合并须 A2 包边界；空单元须 `axii:0`（不可套用 Comment-ph F14）；认领目标为 `directNodes` 非 AtomHost（d5）
- ElementChildText（`createElement` 元素子静态文本）：与 DirectNodes **互斥**（无 Host、无 `directNodes`、无尾 Comment）；相邻合并须 A2；兄弟间空须 `axii:0`；单 child 空串不发哨兵（d6）；禁止并入其它三种
- **RxList Compact-row**：单元素且无 `detachStyledChildren` → 无行级 `rx list item`；`hostLastNode===element`；误发与 CSR 不等价；`detachStyledChildren` / Function / Fragment 走非 Compact（d7 / §3.2.3）
- **非 Compact 行分派（与 `createHost` 一一对应）**：Compact 门闩 + createHost 全部分支闭合（§3.2.3 / d13）；仅 Function 结构行发 `computed node`（G3-F/FCS）；Function 文本态行走 **G4-F** Comment-ph（d12）；**嵌套 RxList 行 = G3-RL**（内层递归 + 外层 `rx list item`；无外层 computed；d13）；**ReusableHost 行 = G3-RU**（`reusable`+行尾；d13）；Component/Fragment/null **无**外层 computed；null **item** → EmptyHost 双 Comment（d11）
- **EmptyHost**：`Comment('empty')` 为 element、外层 placeholder 分立；≠ `() => null` 文本空（G4-F）；≠ A1c；≠ FCS（d11/d12）
- **Function 结构态**：= `isFunctionHostTextSnapshot` 的显式补集（null/undefined/boolean/string/number/bigint 以外）；含 atom / 嵌套 Function / RxList / Element / …（§3.2.0 / d13/d14）
- **FunctionHost Text-ph 结构态（FTS）**：CSR `[内容, computed node, Text('')]`；空 Text 不进 HTML → SSR 须在 `computed node` 后发 `axii:0`；hydrate 插入 Text 为 FunctionHost.`placeholder`（`textNode===null`）；G3-F/FCS **不能**代替；省略哨兵或只发 A1 均失败（d9 / §3.2.4）；**Function→atom 同属 FTS**（d14），不得口语化为「仅元素/Fragment」
- **FunctionHost Comment-ph 结构（FCS）+ Root**：CSR `[内容, computed node, <!--{data}-->]`（无尾空 Text）；`createRoot` data=`root`；SSR 主 html **含** `<!--root-->` 并认领（方案 A）；data 必须等于实际 placeholder（`array item` ≠ `rx list item`）；对 root 套 FTS 失败（d10 / §3.2.5）；**G3-F** **仅** RxList 函数结构行
- RCDATA/RAWTEXT 内标记是字符数据 → 禁止 `axii:*`；textarea 走 §3.6.2 子文本 + RCDATA 实体转义（d3/d4）
- RAWTEXT / SSR `<style>`：终止序列提前关闭；实体不解码 → **抛错门闩**，禁止「文本节点 `& < >`」套用到 RAWTEXT（d4）
- SSR `<style>` 载荷：`insertRule` 拒绝的多规则逃逸串写入 textContent 会注入全局规则 → **per-rule omit 门闩**（d5）；不得只靠 `</style`
- `Text+Comment+Text` 往返不合并 → 已有 CSR 结构 Comment 或 `axii:0` 分隔处可省略非空边界（发出表 A2）
- table 注释位置敏感；createElement vs 解析树在 table 上不等价 → 规范化 + SSR 显式 tbody
- 表单 IDL 完整有限契约（§3.6.2）：IV/CK/CB/TA/SO 通道拆分；checkbox `value` **双通道**（禁「同 checked 行」）；deferred `value`+`checked` 键序覆盖；textarea 必须子文本；select/option 必须 selected 属性（d1/d8）
- 样式 tag ↔ adopted 可无闪变迁移

### 5.2 实现期验证

- Host 认领游标与 CompactElementHost（§3.2.3 CK）/ ReusableHost / FunctionHost 结构切换的交叉；Text-ph **B/E**、Comment-ph **BC/EC**、DirectNodes **BD/ED**、ElementChildText **BE/EE**、**FTS FS1–FS8**、**FCS FC1–FC6**、**Root 认领** 与 AtomHost/StaticArrayHost/StaticHost 稳态
- StyleManager 动态 id / animationName 改为确定性后对 CSR 行为与缓存的影响（须全量样式相关测试）
- `isAcceptableSingleCssRule` 与 Chromium `insertRule` oracle 配对；Portal styles 同门闩
- 并发 `renderToString` 是否误用任何模块级可变缓冲（实现时禁止模块级可变输出缓冲，或按调用隔离）
- lazy 模块级 `started` / `LazyComponent` 在 SSR 路径下不泄漏到客户端
- EmptyHost 认领双 Comment（不得「先新建再丢弃」、不得插 Text）；Compact **不得**为行新建/插入 `rx list item` 或共享 placeholder
- RCDATA 父下误发标记的负向测试；≥2 文本单元 SSR 抛错；RAWTEXT/`</style>` 门闩负向
- Compact-row 与 Comment-ph / **G4-F Function 文本态** / **EmptyHost(G3-E)** / **G3-C/Fr/F/RL/RU** 列表行 move/delete 与 CSR 区间对照（M-03）；DirectNodes 相邻/空（M-02）；ElementChildText 相邻/空/单空与 M-01 静态+atom（M-01/M-02）；**FTS 元素子函数 / Fragment / Function→atom / 文本↔结构切换**（M-02）；**FCS Root / array item（非仅 G3-F）**（M-01/M-02）；**EmptyHost root/null 行**（M-01/M-03）；**嵌套 RxList / reusable 行**（M-03）
- `detachStyledChildren` 列表行回归（G2）
- benchmark 热路径无回归
- data0 若出现「SSR 结束后源仍持有 computed」等非文档行为：先扩 `__tests__/data0Contract` / node 契约，再消费

### 5.3 不单独延长设计循环的事项

- 通用断言库/夹具框架完善
- 资料性附录扩写
- RxMap/RxSet 经列表投影的表述润色（M-03 已写明）
- 发出表上「始终包 vs 按需包」的实现偏好（契约已允许两者，只要 B3/BC3/BD3/BE3 删除）
- `noscript` 按 RAWTEXT 的保守归类（实现可用更细浏览器矩阵，但不改契约结论）
- Portal HTML 由调用方在 hydrate 前写入目标容器（API 叙事实现期写清即可）
- 结构 Comment 字面量表钉死为测试常量（§3.2 已授权）
- CSS 门闩纯函数的具体扫描算法（字符串/注释状态机）——契约以 insertRule 拒绝类为准，实现可选
- FunctionHost 结构行内层 `computed node` 的测试夹具细节（§3.2.3 G3-F / 实现注意事项已指向）
- FTS 与 G3-F/FCS 对照夹具的命名润色（契约已互斥；M-02 已要求元素子函数路径与非 RxList FCS）
- Portal 旁路片段是否统一以 `<!--root-->` 结尾的叙事细节（§3.2.5 已指向 M-05 与 CSR Portal 对齐）
- CB 矩阵中未列出的稀有对象/`toString` 怪值——实现按 `String(applied)` + `!!v` 通则即可；验收以标量矩阵为准
- StaticArray 项为 null 的夹具细节（§3.2.6 已列 `array item` 位点；M-02/M-03 可择一覆盖）
- Fragment 内相邻 ElementChildText 的 A2 包边（review-d12；种类仍是 ElementChildText）
- `createElement` 跳过 null/undefined、不跳过 false（review-d12；实现纪律）
- option 内 `axii:*` 为 NORMAL（review-d12；M-03 select 角落回归即可）
- Function→atom / 嵌套 Function 的 M-03（G3-F）夹具命名润色（§3.2.0/§3.2.3 已钉死；**M-02 已显式要求 Text-ph FTS Function→atom**，不得再声称「仅命名润色」掩盖 FTS 验收）
- G3-RU 非列表位点的外层 placeholder 字面量细节（契约已指向父传入；M-03 以列表行为主验收）
