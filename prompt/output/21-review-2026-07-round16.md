# 21 深度 review 第十六轮（2026-07，已全部修复）

本轮 review 在前十五轮之后的 `main`（v4.4.5，data0 2.4.0）上进行，再次通读 `src/`
全部源码，并对照 data0 的 notify/computed/RxList 实现核对跨层假设。本轮重点扫描：

- **「用户可控标识符流进受限命名空间」**：组件名（JS 函数名，几乎任意字符串）被用作
  stylesheet 的 CSS class——JS 命名空间远宽于 CSS identifier，对象字面量 key 推断的
  名字（`{'ns.card': fn}` 注册表写法）、工厂/HOC 返回的匿名箭头函数都是自然形态；
- **「数组 prop 的 falsy 条件项」全形态空间**：style/className 的条件项（F36）之后，
  事件 handler 数组、元素/组件 ref 数组、detachStyle 的函数求值结果是否同语义；
- **文本 primitive 的形态空间 × 渲染入口**：bigint（后端 bigint id 是自然输入）在
  静态 child / 静态数组 / 函数 child / RxList 行 / atom 五个入口的行为是否一致；
- **绑定更新路径的错误钩子完整性**（I43/I51/I55 之后的残留）：AtomHost/
  ReactiveAttributeEffect/RxListHost patch 都有错误钩子语义，FunctionHost 呢；
- **F49 的残留**：`value` 分支里是否还有绕过 `setProperty` try/catch 的裸 property 赋值。

对每个疑点先写运行时复现测试（真实 Chromium）确认；证实的逐项修复，每个测试都先在
未修复代码上确认失败再转为回归测试（本轮探针覆盖 40+ 组合场景，最终 2 个致命问题 +
9 个改进项落地）。另有若干疑点复现后判定为设计边界/正确行为（见文末）。

回归测试：致命问题在 `__tests__/fatalBugs16.spec.tsx`（F54-F55），改进项在
`__tests__/improvements16.spec.tsx`（I58-I66），编号与下表一致。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F54 | **组件名作为 stylesheet 的 CSS class，但 JS 函数名远宽于 CSS identifier**：对象字面量 key 推断的名字可以带 `.`（`{'ns.card': fn}` 的注册表写法）——selector 变成复合选择器（`.ns.card0P...` 要求元素同时具有两个 class），**永远匹配不上，嵌套样式/boundProps 样式静默丢失且没有任何报错**（insertRule 成功、classList.add 也成功）；工厂/HOC 返回的箭头函数 name 是 `''`——id 以 typeId 数字开头，`.3P...` 是非法 selector，**整张 stylesheet 被 insertRule 整条拒绝**（I57 的 dev 提示会出现但文案指向 `}` 注入，误导排查）。旧的名字清洗只处理了空白和 `$`（压缩器形态） | `toCssSafeComponentName`：CSS ident 之外的字符归一成 `_`（unicode 名字是合法 ident 保留，旧的 `\s`/`$` 替换被该规则覆盖），首字符不能作为 ident 起始（空名/数字/`-` 开头）时补 `C` 前缀。唯一性由 typeId 保证，归一化不会让两个组件冲突。只影响 stylesheet id 生成路径，不在属性/文本更新热路径上（`src/StaticHost.ts`） |
| F55 | **条件离场动画的 falsy 求值结果会让节点永久残留在文档里**：`detachStyle={() => cond() ? {opacity: 0} : null}`（prefers-reduced-motion 开关、按状态启停动画是自然写法）翻转为 falsy 后销毁——`removeElements` 对求值结果直接 `Object.keys(null)` **TypeError，destroy 被中断，节点永远留在 DOM**（诊断开关都一样；有 error 钩子时钩子收到一个与 detachStyle 无关的 TypeError，没有钩子时中断兄弟销毁）。静态 falsy 在注册时（`if (value)`）就被 guard 掉，函数/atom 的 falsy 求值结果是唯一会走到这里的形态 | falsy 求值结果按「无离场样式」处理：等待集合不加入该元素、样式不应用（**不能**把 falsy 交给 setAttribute 的 style 分支——那是「清空 inline style」语义，会把移除前一帧的样式整体抹掉）、节点走常规兜底 deadline 移除（`src/StaticHost.ts`） |

## 改进项修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| I58 | **FunctionHost 是唯一没有错误钩子语义的绑定更新路径**：`renderSource` 内部对 source() 抛错/结构重建抛错都有钩子处理，但文本↔结构切换的 DOM 锚点操作（区间被外部清空后 `placeholder.parentNode!.insertBefore` 等）会抛裸 TypeError——重算在微任务里，**错误变成 uncaught error**；AtomHost/ReactiveAttributeEffect 的 update 对同类失败都走 `root.on('error')`（外部清空容器在 destroy 路径有明确容忍语义，update 路径至少要可上报） | `update()` 以与 AtomHost 相同的语义包裹 `renderSource`：注册钩子时报告并跳过本次重算（effect 保持活跃），未注册时保持向上抛出；内部已消费的错误不会到达外层（`src/FunctionHost.ts`） |
| I59 | **事件 handler 数组中的 falsy 条件项每次触发都 TypeError**：`onClick={[a, cond && b]}` 翻转为 false 后，`listener[i]?.()` 的 `?.` 拦得住 null/undefined 拦不住 false——每次点击都抛（I55 的隔离让兄弟仍执行、错误批末重抛，但错误本身不该发生）。style/className 数组的 falsy 条件项、单个 falsy handler（解绑）都是「条件不满足」语义，唯独数组项会崩 | 数组项为 null/undefined/boolean 时跳过，返回值槽位保持 undefined（与 nullish 项的既有行为一致）（`src/DOM.ts`） |
| I60 | **ref 数组中的 falsy 条件项崩溃渲染**（I59 同类）：`ref={[r, cond && r2]}`——元素 ref 走到 `assert`（无钩子时中断渲染），组件 ref 直接 `Cannot create property 'current' on boolean` TypeError。单个 falsy ref 在登记时（`if (value)`）就被跳过，数组项是唯一形态 | `createElement.attachRef/detachRef`、`ComponentHost.attachRef/detachRef` 四处对 null/undefined/boolean 项跳过（`src/DOM.ts`、`src/ComponentHost.ts`） |
| I61 | **bigint child 的行为按入口分叉**（后端 bigint id 直接渲染是自然输入）：静态 child / 静态数组 / RxList 行直接 **`unknown child type` 崩溃渲染**，函数 child 渲染为空 + 错误报告，atom 入口（stringValue 走 toString）**碰巧可用**——同一个值换个位置就崩 | bigint 全入口按文本 primitive 处理：createElement 的两条文本路径、createHost 的 primitive 分支（PrimitiveHost 的 toString 本来就支持）、StaticArrayHost 的数组项、FunctionHost 的文本快速路径（`src/DOM.ts`、`src/createHost.ts`、`src/StaticArrayHost.ts`、`src/FunctionHost.ts`） |
| I62 | **value 的非数字字符串在 progress/meter 上崩溃渲染**（F49 同类残留）：value 分支的最终赋值仍是「绕过 setProperty try/catch 的裸 property 赋值」，PROGRESS/METER 的 value 是 WebIDL double，`'abc'`（后端垃圾数据）直接 TypeError 崩掉渲染树；同元素的 max/min（通用分支）对同样的垃圾值经 setProperty 优雅降级——同一元素的兄弟 prop 容错不一致 | 最终赋值改走 `setProperty`（抛错时回退 setAttribute，浏览器按属性语义处理为 0）；INPUT/TEXTAREA/OPTION 等 DOMString 类 value 的赋值永不抛错，行为不变（`src/DOM.ts`） |
| I63 | **`lazy(load)` 不传 fallback 时加载期间每次渲染都 TypeError**：React.lazy 根本没有 fallback 参数，省略是自然写法——`fallback is not a function` 有钩子时是噪音、无钩子直接崩 | fallback 可选：不传时加载期间渲染为空（null）（`src/lazy.ts`） |
| I64 | **`is` prop（customized built-in element）静默不生效**：元素升级只发生在创建时刻，事后 `setAttribute('is')` 不触发升级——`<button is="my-button">` 创建出来的是普通 button，自定义行为静默缺失 | `rawProps.is` 为字符串时以 `document.createElement(type, {is})` 创建；attribute 本身仍由 props 循环写上（序列化/CSS 选择器语义）。热路径成本：rawProps 存在时多一次属性读（`src/DOM.ts`） |
| I65 | **atom 被直接绑定为事件 handler 时事件对象被静默写进 atom**：atom 本身是 function，`onClick={handlerAtom}` 能通过校验并绑定；事件分发以「写入」形态调用它（`atom(event)`）——handler 不执行、atom 的值被替换成 PointerEvent，**状态损坏且没有任何报错**。事件按设计非响应式（README），这个写法永远是错的 | 绑定时（只发生一次）诊断开启下检查 handler（含数组项）是否为 atom，console.error 指出正确写法 `onClick={(e) => handlerAtom()(e)}`；生产只付一个布尔检查（`src/DOM.ts`） |
| I66 | **`dangerouslySetInnerHTML` 与 children 并存时 children 被静默抹掉**：innerHTML 赋值在 children append 之后执行，静态内容消失；响应式 child 的**占位符也一起被抹掉**，此后 atom/函数 child 的更新全部写进脱离文档的节点——「更新不生效」且没有任何报错。React 对这个组合直接抛错 | 渲染语义保持（innerHTML 胜出），开发期给出明确警告；判断顺序 childrenLength → 诊断开关 → 属性读，生产环境每个带 children 的元素只多一次数字检查 + 一次廉价调用（`src/DOM.ts`） |

## 同类假设猎杀（本轮）

| 发现 | 处理 |
| --- | --- |
| F54 的「组件名流进 CSS」全库排查：`generateComponentElementStaticId` 是唯一入口（getStyleSheetId 的静态/rolling id、StyleManager.update 的 sharedStaticBaseId 都经过它）；`generateGlobalElementStaticId` 只用于 data-testid（非 CSS）；`bindProps` 的 "bound Foo"（空格）被旧规则覆盖、新规则继续覆盖 | 已收敛到 `toCssSafeComponentName` 一处 |
| I59/I60 的「数组 prop 的 falsy 条件项」全形态空间盘点：style ✓（F36）、className ✓、事件 handler 数组（本轮）、元素 ref 数组（本轮）、组件 ref 数组（本轮）、detachStyle 数组项 ✓（`Object.assign({}, false)` 是 no-op，对照测试 F55c）、detachStyle 函数/atom 的**整体** falsy 求值结果（本轮 F55） | 已闭环 |
| I58 的「绑定更新路径错误钩子」盘点：AtomHost.update ✓（O1）、ReactiveAttributeEffect.update ✓（O1）、RxListHost applyPatch ✓（逐 info）、FunctionHost.update（本轮）——四条路径语义一致 | 已闭环 |
| I61 的「bigint 形态」全库排查：五个渲染入口（本轮统一）；属性值 bigint 走 dataset/setProperty 的字符串化本来就正确；style 值 bigint 经 autoUnit 模板字符串化正确 | 已闭环 |
| I62 的「绕过 setProperty 的裸 property 赋值」复查（F49 清单之上）：value 分支的最终赋值是最后一个残留（checked/multiple 是 boolean 赋值、innerHTML 有 `?? ''`、className 有 typeof 守卫、dataset 有 delete 分支） | 已闭环 |

## 复现后判定为设计边界 / 正确行为的观察项

| # | 疑点 | 结论 |
| --- | --- | --- |
| O46 | `value` 写在无 value property 的普通元素（`<div value="x">`）上时走 property 赋值（expando），attribute 不出现（React 渲染为 attribute） | 保持现状：value 分支对「有 value 语义的元素」全部正确；custom element 的 value accessor 恰恰需要 property 赋值（探针确认可用）。普通元素上的 value 本就无语义，为它区分「有无 property」会给最热的表单路径加成本 |
| O47 | 元素上误写的 `$xxx:yyy` 静态 key 会被 setAttribute 落成字面 attribute（`<div $icon:size="12">`） | 浏览器允许 `$`/`:` 出现在 attribute 名中（不抛错），与 round-14 对 `prop:` 前缀的结论一致：仅噪音、无功能损失，AOP 前缀的语义只在组件包装时存在，维持现状 |
| O48 | FunctionHost 的 context 分配依赖 `source.length > 0`：`(ctx = {}) => ...`（默认参数）或 `(...args)`（rest 参数）的 length 为 0，拿不到 onCleanup | 默认参数/rest 参数形态的函数 child 不是自然写法（context 只有 onCleanup 一个能力，解构声明 `({onCleanup}) =>` 的 length 为 1 正常工作）；为极端形态放弃「零参函数不分配 context」的优化不值得 |
| O49 | 同一个 RxList 实例直接（不经 map）挂在两个位置：两个 RxListHost 订阅同一 source，push 后两处都正确更新 | 正确行为（探针确认）；行内容是同一批 atom 实例时同样正确（一处一个 AtomHost，各自订阅） |
| O50 | `dangerouslySetInnerHTML` 响应式更新会抹掉静态 children | I66 的警告已覆盖该组合的所有形态（静态/响应式 innerHTML × 静态/响应式 children） |

## 性能验证

改动涉及的路径盘点：F54 只在 stylesheet id 生成时执行（不在属性/文本/patch 热路径），
短名字上一次正则替换；F55 在带 detachStyle 的销毁路径上多两次廉价判断；I58 的 try/catch
在 V8 无抛出时零成本（AtomHost 的 update 早已同款）；I59/I60 只在事件分发/ref 附加时
多一次 nullish+typeof 判断（不在渲染热路径）；I61 的 typeof 结果先存局部再比较，
分支数与原实现持平（单文本 child 快速路径从两次 typeof 求值变为一次）；I62 的赋值
从内联改为经 setProperty（一层调用 + 零成本 try/catch，受控输入每键一次，相对 DOM
写入可忽略）；I64 在 rawProps 存在时多一次属性读；I65/I66 都在诊断开关之后，生产
只付布尔检查。每实例内存：全部改动无新增实例字段、无新增闭包。

`__tests__/matrix.spec.tsx` 的时间敏感用例全部通过；全量 669 browser tests + 6 node
tests 通过；`npm run build` 产物正常；coverage 徽章数据已按新口径刷新（94.38% lines）。

## 运行方式

```bash
npx vitest run __tests__/fatalBugs16.spec.tsx __tests__/improvements16.spec.tsx --coverage.enabled=false
```
