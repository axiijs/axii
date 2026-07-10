# 17 深度 review 第十二轮（2026-07，已全部修复，补记索引）

本轮 review 的修复与回归测试早于本文档落库（见 git 历史 `0077cf2`…`e740ff7`），
当时缺少 prompt/output 索引文档，这里按测试文件与提交记录补记，编号 F42-F48。

回归测试：`__tests__/fatalBugs13.spec.tsx`。

## 致命问题修复索引

| # | 问题 | 修复 |
| --- | --- | --- |
| F42 | SVG 工厂/automatic runtime 的 namespace 与 children 结构（createSVGElement 展开 children、叶子元素不产生多余子节点；jsx/jsxs/jsxDEV 对常见 SVG 标签进入 SVG namespace，双义标签 a/script/style/title 留在 HTML 路径） | `src/DOM.ts`（svgOnlyElementNames + runtime 路由，commit `35adc04`） |
| F43 | FunctionHost 的 onCleanup 抛错会中断兄弟 cleanup、函数节点重算与整棵 root 的销毁 | cleanup 错误走 root error 钩子，兄弟 cleanup/重算/销毁照常（`src/FunctionHost.ts`，commit `1849753`） |
| F44 | 组件 render 抛错被 error 钩子消费后，effects/layoutEffect/ref 仍会执行、render 期资源不释放 | render 失败不提交 effects/ref；已注册的 cleanup/computed/reusable 立即释放（`src/ComponentHost.ts`，commit `1849753`） |
| F45 | 组件返回非法 child（unknown child type）时错误击穿 root.render，留下已占用的 root.host | 非法输出同样走 error 钩子，区域渲染为 EmptyHost 保持可销毁（`src/ComponentHost.ts`，commit `1849753`） |
| F46 | range 的 min/max/step 约束更新后，浏览器已就地 sanitize 的 value 不会按声明值重放（约束放宽后永久停留在旧截断值）；用户拖动过的值不能被覆盖 | 记录 `__axiiInputAppliedValue__`，约束更新且 DOM 值仍等于框架最后写入值时重放声明值（`src/DOM.ts`，commit `6fc6580`） |
| F47 | 契约外的稀疏 `RxList.set`（越界 index）先污染 hosts 数组再在锚点查找处以原生 TypeError 崩溃 | 在销毁旧行/写入 hosts 之前拒绝，抛结构化 `AXII_LIST_ORDER_BROKEN`（`src/RxListHost.ts`，commit `43156e7`） |
| F48 | async effect（返回 Promise 的 useEffect/useLayoutEffect）的 rejection 不经过 root error 钩子，组件销毁后还会产生 unhandled rejection | `observeAsyncEffect` 桥接到 error 钩子；销毁后静默失活（`src/ComponentHost.ts`，commit `8297c9b`/`e740ff7`） |

## 收尾（commit `e740ff7`）

恢复生命周期的边角：render 失败后 destroy 的幂等、`__axiiInputValue__` 存值与
text/password 互切的不重放边界等（详见 commit diff 与 `fatalBugs13.spec.tsx` 断言）。
