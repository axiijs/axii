# 18 深度 review 第十三轮（2026-07，已全部修复）

本轮 review 在前十二轮之后的 `main`（v4.4.2，data0 2.4.0）上进行，再次通读 `src/` 全部源码。
本轮重点扫描的输入形态角落与跨层假设：

- **`value` prop 的 null/undefined 形态空间 × 元素种类**（value 分支绕过了 `setProperty`
  的 try/catch，而不同元素的 value property 的 WebIDL 类型不同）；
- **renderContext 能力闭包的 pathContext 完整性**（`reusable` 是否把 owner 组件算进 hostPath）；
- **同一份 JSX 在不同编译入口下的行为一致性**（classic pragma / automatic runtime /
  组件 renderContext 三条链路的 SVG namespace 路由）；
- **用户回调（error 监听器、ref、layoutEffect）抛错时框架自身流程的鲁棒性**；
- **style 值的字面形态**（`[number, keyword]` 简写、animation 数组、空字符串）。

对每个疑点先写运行时复现测试（真实 Chromium）确认，证实的逐项修复，
每个测试都先在未修复代码上确认失败再转为回归测试（本轮 24 个新测试，
未修复代码上 18 失败 / 6 为对照通过项）。

回归测试：致命问题在 `__tests__/fatalBugs14.spec.tsx`（F49-F51），改进项在
`__tests__/improvements13.spec.tsx`（I43-I49），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F49 | **`value` 的 null/undefined 直接 property 赋值对不同元素并不安全，而该分支绕过了 `setProperty` 的 try/catch**：`<progress value={undefined}/>`、`<meter value={undefined}/>`（以及响应式 `value={() => cond() ? n : undefined}` 翻转）直接 **TypeError 崩溃渲染**（value 是 WebIDL double，NaN 非法）；`<option value={null}>` 的 value property 反射 attribute，字符串化成字面 `"null"`——option 永远匹配不上 select 存值，**选中静默丢失**；`<button value={undefined}>` 等提交值元素同样残留 `"undefined"`；checkbox 的 value property（表单提交值）残留 `"null"` | value 分支统一处理 nullish：SELECT 维持存空串语义；INPUT/TEXTAREA 维持 `''`（受控清空，且 property 赋值改为 `value == null ? '' : value`，不再先写入 `"null"` 再修正）；**其余元素一律 `removeAttribute('value')`**（progress 回到不确定态、option 回退文本 value 并触发 select 存值恢复、button 等不残留字面量）（`src/DOM.ts`） |
| F50 | **`reusable()` 子树的 pathContext 不含 owner 组件自身**：直接传了 `this.pathContext`（父级路径），`DataContext.get` 沿 hostPath 静默跳过本组件——组件内 `context.set` 的值（Form/ContextProvider 场景）对 reusable 内容**不可见且没有任何报错**（同一内容不包 reusable 时一切正常，行为分叉极难排查） | reusable 的子 context 与普通 innerHost 对齐：`{...this.pathContext, hostPath: createLinkedNode(this, ...)}`，owner 组件进入查找链；祖先 context 依旧可见（`src/ComponentHost.ts`） |
| F51 | **svg-only 标签的 namespace 路由只做在 jsx/jsxs/jsxDEV runtime 上**：classic pragma（`/* @jsx createElement */`，README 首页示例的写法）和组件 renderContext 解构的 `createElement` 都不经过 runtime factory，`<svg>`/`<circle>` 被创建成 **HTMLUnknownElement，整个图形静默不显示**——同一份 JSX 换个编译模式行为分叉 | 路由统一收敛进 `createElement` 内部（显式 `_isSVG` 优先，未指定时按 `svgOnlyElementNames` 兜底）；jsx/jsxs/jsxDEV 不再二次路由（同一次创建只查一遍 Set，automatic 路径成本不变，classic 路径多一次 Set.has）；双义标签（a/script/style/title）维持 HTML 路径（`src/DOM.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I43 | **用户回调抛错会破坏框架自身流程**：① `root.dispatch` 的监听器抛错中断兄弟监听器，且 `dispatch('error')` 的调用点都在 catch 块里——error 监听器自己抛错会把新错误传播回错误恢复路径，覆盖原始错误、把 fail-stop 变成二次崩溃；② `once` 监听器抛错时不退订，下次事件重复执行；③ `flushAttachQueue` 的条目（ref/layoutEffect）抛错中断同批其他组件的条目，且队列快照已取走、剩余条目**永久丢失**；④ 组件 ref 的 attach/detach、元素 ref 的 detach 抛错中断组件自己的 layoutEffects / 兄弟 ref / 后续 DOM 拆除（子树泄漏在文档里） | ① dispatch 的监听器逐个 try/catch，监听器自身错误收敛到 `reportAxiiError`；② once 的退订放 finally；③ flushAttachQueue 逐条隔离：错误交给 error 钩子，未消费时保留第一个错误批末抛出（其余 reportAxiiError），兄弟条目全部执行；④ ComponentHost 的 attachRef/detachRef、StaticHost/CompactElementHost 的 detachRefs 走 error 钩子语义（`src/render.ts`、`src/ComponentHost.ts`、`src/StaticHost.ts`） |
| I44 | style 数组简写 `[number, string]` 无条件解释成 `[值, 单位]`：`margin: [0, 'auto']`（水平居中的自然写法）拼出 `"0auto"`，整条声明非法被浏览器**静默丢弃** | 只有第二项是真正的 CSS 单位（白名单 `px/em/rem/%/vw/…/dvh`）才走 `[值, 单位]` 简写，否则落到空格 join 分支（`[0,'auto']` → `"0px auto"`）（`src/DOM.ts`） |
| I45 | `animation: [a, b]` 数组用空格 join（CSS 多动画的分隔符是逗号），整条声明非法静默丢弃；`@self` 替换无 `/g`，数组第二项引用不到生成的 keyframes 名 | `join(', ')` + `replace(/@self/g)`（`src/StaticHost.ts`） |
| I46 | style 值空字符串被 `v\|\|0` 塞成 `"0px"`：`{width: cond ? 100 : ''}` 翻转后宽度静默变 0 而不是恢复默认（React 里 `''` 是清除语义） | `v === ''` 直接 return ''（清除该 key）；`\|\|0` 移除——到达该处的值不可能是 null/undefined，数组项的 undefined→0 兜底另有 `i ?? 0` 负责，语义不变（`src/DOM.ts`） |
| I47 | `withPreventDefault`/`withStopPropagation`/`withCurrentRange` 吞掉 handler 返回值（`eventAlias` 透传、这三个不透传），`$eventTarget` 转发等消费返回值的场景静默丢结果 | 补 return（`src/eventAlias.ts`） |
| I48 | **缓存元素跨渲染复用是静默错误**：`const cached = <div>{() => text()}</div>` 在条件分支间复用（React 用户的常见优化直觉）——绑定元数据（unhandledChildren/unhandledAttr/refHandles）在第一次渲染时被一次性消费，第二次渲染绑定全部失效、内容停在旧值，**没有任何报错**（纯静态元素的复用则碰巧可用，更难发现规律） | 开发期检测：消费过响应式元数据的元素登记进 WeakSet，再次进入 StaticHost/CompactElementHost 渲染时 console.error 明确指出「绑定不会工作，用函数重建或 reusable()」；纯静态元素不受影响；诊断关闭（生产）时零开销（`src/StaticHost.ts`） |
| I49 | `<Form name="x">` 不传 `values` 时（只想托管状态、不消费 values 是自然用法）register 里 `values.set` 直接 **TypeError 崩掉整棵渲染树**，报错信息与 Form 无关 | `Form.propTypes.values` 声明默认值 `() => new RxMap({})`（`src/Form.tsx`） |

## 同类假设猎杀（本轮）

| 发现 | 处理 |
| --- | --- |
| F49 的「绕过 try/catch 的直接 property 赋值」全库排查：`checked`/`multiple` 是 boolean 赋值（安全）；`innerHTML` 已有 `?? ''`；`className` 字符串快速路径有 typeof 守卫；`dataset` 赋值有 null delete 分支；通用属性分支本就走 `setProperty`（内置 try/catch + nullish removeAttribute 兜底，`<progress max={undefined}/>`、`<video volume={undefined}/>` 等 double 类 property 由此幸免）——只有 value 分支独走裸赋值 | 已修复（F49） |
| F50 的「pathContext 漏掉 self」同类排查：render 的 childContext ✓；Portal 走正常 ComponentHost 链（其 pathContext 含外层组件）✓；`renderContext.pathContext` getter 暴露父路径，唯一下游消费者 Portal 语义正确 | 仅 reusable 中招，已修复 |
| F51 的「按入口分叉」同类排查：jsx 的「无 children 不传 undefined 占位」在 jsx/jsxDEV 两处一致；`__source/__self` 收敛在 createElement 一处；SVG 路由收敛后三条链路（classic/automatic/renderContext）行为一致 | 已收敛 |
| I43 的「用户回调抛错中断框架流程」全库排查：组件 effects/layoutEffects/cleanup ✓（已有 runWithErrorHook）；FunctionHost cleanups ✓（F43）；事件 handler 抛错传播给 DOM 事件循环（浏览器语义，符合预期）；detachStyle 求值抛错在 destroy 同步路径向上抛（可观测，保持）；Form 的 reset/clear 是用户主动调用链（保持） | dispatch/flush/refs 已修复，其余判定为正确语义 |
| I44 的「[number, string] 消费点」排查：仅 `stringifyStyleValue` 一处 | 已修复 |
| I46 的「空字符串 style 值」在 stylesheet 路径（`stringifyStyleObject`）产出 `width:;` 非法声明被浏览器忽略、stylesheet 整体重建无残留问题 | 行为已正确，无需修改 |

## 复现后被证伪 / 有意不改的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O33 | propTypes 声明的 `children` 的 coerce/default 永远不生效（render 里 `normalizedProps.children = this.children` 无条件覆盖，无 children 时收到 `[]`） | children 是结构性输入而非普通 prop，「空数组」语义清晰；维持现状 |
| O34 | `internalCheckPropTypes` 是空函数：propTypes 的运行时类型校验从未实现，`isRequired` 只是类型层标记 | propTypes 当前的真实职责是 coerce/default/类型推导；运行时校验是独立特性，超出本轮范围，记录待办 |
| O35 | `<textarea>{() => text()}</textarea>` 在用户输入过后文本更新不再反映到显示（浏览器 dirty value 语义） | 受控输入应使用 `value` prop；与原生行为一致，不改 |
| O36 | SVG 内的双义标签（`<svg><a>…`）在所有入口都走 HTML 路径 | 与 automatic runtime 既有声明一致（需要时用 `createSVGElement`）；F51 保持该边界 |
| O37 | `RxDOMDragState` 的 `boundary.current.addEventListener` 在 boundary ref 指向已卸载元素时会 TypeError | 读取都发生在 mousedown 之后（交互时 refs 必已挂载）；boundary 默认 document.body；维持第十一轮结论 |
| O38 | `attachQueue` 中「未取消且永不连通」的条目（host 泄漏场景）会留在队列被反复重扫 | 前提本身是 host 泄漏（用户 bug），队列条目只是泄漏的伴生物；不为异常前提加常驻成本 |

## 性能验证

改动涉及的热路径：`createElement` 的 SVG 判断从 jsx runtime 移入函数内部——automatic
路径每元素仍是一次 Set 查找（原 `getJSXRuntimeFactory` 同款成本），classic 路径多一次
Set.has；`setAttribute` 的 value 分支多一次 `value == null` 比较；`stringifyStyleValue`
多一次 `v === ''` 比较（单位白名单正则只在罕见的 `[number, string]` 形态执行）；
dispatch/flushAttachQueue 多一层 try/catch（V8 下无抛出时零成本）；I48 检测只在
诊断开启时执行 WeakSet 操作，生产环境是一次布尔检查。

本机 real-browser 对比（create-1000 行表格，20 轮取中位数，修复前后各三轮）：
修复前 8.8 / 8.9 / 8.4ms，修复后 8.9 / 8.3 / 9.2ms，差异在轮间噪声内。
`__tests__/matrix.spec.tsx` 的时间敏感用例（226 个）全部通过。

## 运行方式

```bash
npx vitest run __tests__/fatalBugs14.spec.tsx __tests__/improvements13.spec.tsx --coverage.enabled=false
```
