# 02 致命问题（8 项）

以下问题会在真实场景中直接崩溃或产生错误行为。**全部 8 项都已经过测试验证确实存在**，复现细节见 [04-reproduction-report.md](./04-reproduction-report.md)。

行号基于 commit `4249ef9`（v3.9.2）。

---

## BUG 1：`attach` 事件的退订句柄从未被赋值 → 已销毁组件的 layoutEffect / ref 仍会执行

**位置**：`src/ComponentHost.ts`、`src/StaticHost.ts`

`ComponentHost` 和 `StaticHost` 都定义了退订字段，`destroy()` 里也调用了它们，但**两处都没有保存 `root.on()` 的返回值**：

```ts
// src/ComponentHost.ts L467-471
if (this.pathContext.root.attached) {
    this.runLayoutEffect()
} else {
    this.pathContext.root.on('attach', this.runLayoutEffect, {once: true})   // 返回值被丢弃
}
```

- `ComponentHost.deleteLayoutEffectCallback`（L91 声明，L507 调用）全仓库没有任何赋值语句；
- `StaticHost.removeAttachListener`（L412 声明，L539 调用）同样从未赋值（注册点在 L453）。

**后果**：把树渲染到 detached 容器（或 Portal 到未连接节点）时，若某组件在 root attach 之前被销毁（例如 `FunctionHost` 的一次微任务重渲染把它换掉了），attach 触发时：

- 已销毁组件的 `runLayoutEffect` 仍会运行——对已移除的 DOM 执行 layoutEffect；
- 已销毁元素会被重新附加到 ref 上（且该元素 `isConnected === false`）；
- root 永不 attach 时监听器永久泄漏。

**修复**：一行改动，`this.deleteLayoutEffectCallback = this.pathContext.root.on(...)`（StaticHost 同理）。

---

## BUG 2：`Root.destroy()` 先清空回调再派发 `detach` → detach 事件永远不会触发

**位置**：`src/render.ts` L52-57

```ts
destroy() {
    eventCallbacks.clear()          // 先清空了所有监听器
    root.dispatch('detach')         // 派发时已经没有任何监听器了
    root.host?.destroy()
    root.attached = false
},
```

**后果**：任何依赖 `detach` 事件做清理的下游代码（组件库、路由、Portal 内容）都会静默失效。

**修复**：两行顺序对调。

---

## BUG 3：`Form` 多值注册路径必然抛 TypeError（ASI 陷阱）

**位置**：`src/Form.tsx` L53-54

```ts
values.get(name).push(instance.value)
(instances[name] as Array<FormItemInstance>).push(instance)
```

第二行以 `(` 开头，JS 不会自动插入分号，这两行被解析为一个表达式：

```ts
values.get(name).push(instance.value)(instances[name] ...).push(instance)
```

`push` 的返回值（数字）被当作函数调用，**任何 `multiple: true` 的 FormItem 注册时直接抛 `TypeError: ... is not a function`**。

因为 `values` 是 `RxMap<string, any>`，`get` 返回 `any`，TypeScript 检查不出来；`Form.tsx` 又恰好被排除在 coverage 之外（`vitest.config.ts` coverage.exclude），所以一直没被测出来。

**修复**：补一个分号（或把两行写法改掉）。

---

## BUG 4：`RxListHost` 的 reorder / 显式 key 变更假设列表独占父元素

**位置**：`src/RxListHost.ts`

两处都用 `host.placeholder.parentElement!.firstChild` 作为插入锚点：

```ts
// L86-92，reorder 分支
} else if(method === 'reorder') {
    const placeholders = ...
    insertBefore(placeholderFragment, host.placeholder.parentElement!.firstChild! as HTMLElement)
```

```ts
// L109-113，EXPLICIT_KEY_CHANGE 分支，index === 0 时
if (index === 0) {
    insertBefore(host.hosts!.raw.at(index)!.placeholder, host.placeholder.parentElement!.firstChild! as HTMLElement)
```

**后果**：只要列表**不是父元素的第一个孩子**——`<div><h1/>{list.map(...)}</div>` 这种再常见不过的结构——

- `list.sortSelf(...)`（reorder）会把**所有列表项搬到 `<h1>` 前面**；
- `list.set(0, ...)`（explicit key change）会把新的第 0 项插到 `<h1>` 前面。

正确的锚点应该是列表自身区域的起点（当前第一个 item 的 element / 原有 placeholder 位置），而不是父元素的 firstChild。测试里没有任何 reorder/sort 用例，这条路径完全没被覆盖。

---

## BUG 5：同一元素上 `onChange` + `onInput` 直接抛错，且生产构建同样会抛

**位置**：`src/DOM.ts` L110-127

```ts
if (eventName === 'change') eventName = 'input'   // onChange 被别名成 input
...
assert(listeners?.[eventName] === undefined, `${name} already listened`);
```

`onChange` 别名成 `input` 后与用户同时写的 `onInput` 在 `_listeners` 上撞 key，`assert` 直接 throw。

两个加重因素：

1. `util.ts` 的 `assert` 只有 `debugger` 受 `__DEV__` 控制，**throw 在生产构建同样生效**——生产环境一样崩；
2. 同理，想通过再次 `setAttribute` 把事件置空来解绑也会命中这个 assert（先 `removeEventListener` 再撞 assert）。

---

## BUG 6：仓库无法独立构建 / 测试；`package.json` 的 `main` 指向不存在的文件

**位置**：`vitest.config.ts`（原 `vite.config.ts` 同源配置）、`package.json`

1. 测试配置把 `data0` alias 到 `../data0/src/index.ts`（**兄弟目录的源码 checkout**），而 `data0` 只在 `peerDependencies` 里、不在 `devDependencies`。新 clone 下来 `npm install && npm test` 必挂——本次 review 环境中实测确认（无 `node_modules`、无 `../data0` 时测试完全无法运行）。CI / 外部贡献者的门槛直接被挡死。
2. `"main": "index.js"` 指向根目录不存在的文件。现代打包器走 `exports` 字段没事，但老工具链（旧版 Jest / metro / node 解析）会解析 `main` 而失败。应指向 `./dist/axii.umd.cjs`，并顺手补 `sideEffects` 声明。

**本 review 分支已附带部分修复**：`data0@1.13.0` 加入 devDependencies（在 peer 范围 `^1.10.0` 内）；alias 改为"兄弟目录存在则用源码、否则回退到 npm 安装的包"。`main` 字段未改动（留给维护者决策）。

---

## BUG 7：模块加载即执行浏览器 API → 在 Node / SSR 环境 `import 'axii'` 直接崩

**位置**：`src/reactiveDOMState.ts` L196-197

```ts
export class RxDOMSize extends RxDOMState<HTMLElement|Window, SizeObject>{
    static resizeTargetToState= new WeakMap<HTMLElement, Atom<SizeObject|null>>()
    static globalResizeObserver = new ResizeObserver(entries => { ... })   // 类定义时即执行
```

`index.ts` 会 `export * from './reactiveDOMState.js'`，因此 **import 框架入口的瞬间**就会执行 `new ResizeObserver(...)`——Node 里不存在这个全局，直接 `ReferenceError: ResizeObserver is not defined`。

**后果**：即使不做 SSR，任何非浏览器环境（node 单测、工具脚本、构建期预渲染）都无法引入 axii。

**修复**：惰性初始化（首次 `listen()` 时创建 observer）。

---

## BUG 8：动态样式的 StyleSheet 无上限累积（代码内 TODO 自认）

**位置**：`src/StaticHost.ts` `StyleManager.update`，L268-277

```ts
if (shouldUseRollingStyleId) {
    const lastStyleSheetId = `${so.styleSheetIdWithIndex}I${styleItorNum - 1}`
    el.classList.remove(lastStyleSheetId)
    // 更新引用计数，但归零时并不会立即清除 stylesheet，因为它可能还被 cloneNode 用到
    // 如果现在清除，cloneNode 的样式会瞬间失效
    // TODO: 如果一个组件一直不 destroy，这里就会一直不清除 stylesheet
    // 后面可以考虑加上一个长度为 2 的 buffer
    this.updateRefCount(lastStyleSheetId, -1)
}
```

每次动态样式（atom / 函数 style，且包含嵌套 selector 而必须走 stylesheet）更新，都会以新的滚动 id 生成一个新 `CSSStyleSheet` 追加进 `document.adoptedStyleSheets`；旧的只减引用计数、**不从 adoptedStyleSheets 中移除**，要等 host destroy 才批量清理。

**后果**：一个长期存活、样式高频变化的组件（拖拽、动画驱动、鼠标跟随）会让 adoptedStyleSheets 涨到成千上万，样式匹配开销线性恶化直至页面卡死。实测每更新一次泄漏恰好一个 stylesheet（20 次更新 → +20）。这是框架"高性能增量更新"卖点路径上的性能定时炸弹。

**修复方向**：按 TODO 所说加长度为 2 的双缓冲；或对同一 el 复用同一个 sheet 做 `replaceSync`。
