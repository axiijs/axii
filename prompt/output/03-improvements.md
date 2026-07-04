# 03 显著值得改进的地方

以下问题不至于"致命"，但明显值得处理。分为"正确性 / 健壮性"与"设计 / 可维护性"两类。行号基于 commit `4249ef9`（v3.9.2）。

## 正确性 / 健壮性

### 1. `mergeProp` 的 `'classname'` 拼写错误 + `startsWith('on')` 误伤

`src/ComponentHost.ts` L42：

```ts
if(originValue && (key.startsWith('on') || key === 'ref'|| key==='style' || key==='classname' || key==='class')) {
```

- JSX 用的是 `className`（驼峰），小写 `'classname'` 永远匹配不上——AOP 合并 className 时实际是"覆盖"而非注释所暗示的"合并"。
- `key.startsWith('on')` 会误伤 `once`、`onlyIcon` 这类普通 prop，把它们错误地 concat 成数组。应改用 `/^on[A-Z]/`。

### 2. `style={null}` 会崩

`isValidAttribute` 判 `null` 为 unhandled attr（`typeof null === 'object'` 且不是合法 style 对象），走到 `StyleManager.update` 后 `isDynamicProp(null)` 执行 `null['__dynamic']` 抛 TypeError。条件样式 `style={cond ? {...} : null}` 是很自然的写法。

### 3. `checked` 只写 attribute 不写 property

`src/DOM.ts` L208-214：`checked` 分支只 `setAttribute('checked', ...)`。用户点过 checkbox 之后（dirty state），attribute 不再影响显示，响应式 `checked` 会失灵。相邻的 `value` 分支就同时写了 property + attribute，`checked` 应当对齐。

### 4. `FunctionHost` 销毁与微任务重算存在竞态

`src/FunctionHost.ts` L45-52：`queueMicrotask(recompute)` 已入队后若 host 被 destroy，微任务仍会执行 `recompute()`。是否安全完全取决于 data0 对已 stop 的 autorun 的容错。应在回调里检查销毁标志。

### 5. `StaticHost.destroy` 的异步分支没有错误兜底；离场动画标记不透传

- `removeElements()` 是 fire-and-forget 的 async（等待 transition/animation 后才删 DOM）。等待期间若父节点被其他路径清掉，`removeNodesBetween` 会 throw 成 unhandled rejection。
- `RxListHost` 的"整段 `replaceChildren` 快速删除"只检查直接子 host 的 `forceHandleElement`；`ComponentHost` 不会向内层 `StaticHost` 透传这个标记，**包在组件里的离场动画会被静默跳过**。

### 6. `createHTMLOrSVGElement` 里 itemConfig 合并用的是 `rawProps` 而不是 `finalProps`

`src/ComponentHost.ts` L207-211：当某元素同时有 `$self:` / `prop:` 前缀 props 又被外部 AOP 配置（`thisItemConfig.props` 存在）时，`separateProps` 的处理结果被丢弃，`prop:` / `$self:` 键以原始形态混回 props。

### 7. `createRoot(element, parentContext)` 原地改写传入 context 的 `root` 字段

`src/render.ts` L79：`pathContext.root = root`。Portal 传入的是父组件自己的 `pathContext`，被改写后该组件的 `pathContext.root` 指向了内层 root。目前行为碰巧可用，但这是隐蔽的共享可变状态，createRoot 内部应当 clone。

### 8. `Root.render` 可重入无保护

连调两次会往容器追加两棵树，应有 assert 或幂等保护。

## 设计 / 可维护性

### 9. 没有任何错误处理机制

组件 render 抛错会让 Host 树停在半渲染状态；`FunctionHost` 的 autorun 重算抛错后该区域永久失效。作为定位"大型应用基础设施"的框架，至少需要 error boundary 或全局 onError 钩子。

### 10. AOP 字符串 DSL 拼错即静默失效

`$item:prop`、`$item:prop_`、`$self:`、`prop:`、`_use` / `_props` / `_children` 这套机制是框架核心卖点，但没有任何 dev 警告；`parseItemConfigFromProp` 里唯一的 assert 报错信息还用错了变量（打印 `itemName` 而非非法的 `itemProp`）。建议 `__DEV__` 下对未命中的 `as` 名称、未知 config 项给出警告。

### 11. 死代码

- `src/common.ts` 整个文件没有被 `index.ts` 导出，内容与 `reactiveDOMState.ts` 大面积重复（连 `ModalContext` 都定义了两份）；
- `ComponentHost.reusedNodes`（L72）声明后从未使用；
- `StaticHost.parentElement`（L411）声明后从未使用；
- `ComponentHost.render` 里 `this.props` 被连续赋值两次（L439、L444）。

### 12. propTypes 半成品

- `shapeOf.check` 恒返回 `true`；`arrayOf` / `shapeOf` 的 stringify/parse 是空 TODO；
- `normalizePropsByPropTypes` 里 `coerce?.(v) || v` 会把 coerce 的合法 falsy 返回值吞掉；
- `propTypes.ts` 被排除在 coverage 之外。

### 13. `insertBefore` 的区间搬移是逐节点递归

`src/DOM.ts` L476-490：递归深度等于节点数，长列表 reorder 时有栈溢出风险，改成循环即可。

### 14. 测试盲区

- ~~reorder / sort 无任何用例~~（已补：`__tests__/fatalBugs.spec.tsx` 中已有 reorder / sort / explicit key change 用例）；
- `Form.tsx`、`propTypes.ts`、`common.ts` 仍被 coverage 排除（`Form.register` 的 multiple 路径已有测试，但文件整体依旧不计入覆盖率）；
- README 徽章展示的覆盖率因 exclude 配置而虚高。

### 15. 其他小项

- `lazy.ts` 的 `LazyComonent` 拼写错误（cosmetic）；`atom` 直接存组件函数的写法依赖 data0 对函数值的处理语义，值得确认；
- `eventProxy`（`src/DOM.ts` L75-78）对数组 listener 用 `forEach`，吞掉了返回值；
- `assert` 的报错字符串在生产 bundle 里全部保留，可换成 dev-only 详细信息 + 生产短码；
- `package.json` 缺 `sideEffects`、`repository`、`description` 等元数据；
- 动态事件绑定不可能（`isValidAttribute` 对 `on*` 恒真，事件永远不走 autorun），属于设计限制，但值得在文档中明示。
