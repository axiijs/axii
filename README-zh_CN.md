<p align="center">
  <img src="https://axii.dev/logos/axii-logo-bg-black.svg" height="220" alt="Axii" />
</p>

<p align="center">
  <a href="https://axii.dev">
    https://axii.dev
  </a>
  <span>|</span>
  <a href="https://github.com/axiijs/axii/blob/main/README.md">
    English
  </a>
  <span>|</span>
  <a href="https://github.com/axiijs/axii/blob/main/README-zh_CN.md">
    中文
  </a>
</p>

# 🚀 Axii - 全新增量响应式前端框架

Axii /ˈæksɪ:/ 是一款全新的前端框架，依托"增量更新"的响应式数据结构，能真正构建高性能的数据逻辑层。
官方提供的大量基础设施，让你不管是在创建组件库、还是开发应用，都能获得便捷的体验。

## 🌟 特性一览

- **心智模型简单**
  - 使用 React-style JSX，但函数只执行一次，直接创建真实元素而非 Virtual DOM。
  - 通过识别响应式数据结构来绑定需要更新的元素。无需特殊语法，无需框架限定的 hooks，无需编译器魔法。

- **性能卓越** 
  - 精确更新 DOM 节点和属性。组件函数不会重复执行。
  - 响应式数据会自动做增量计算，仅发生理论上最小的变化。尤其在对数组或集合进行复杂操作时，可以显著降低计算开销。
  - `RxList` / `RxMap` / `RxSet` / `RxTime` 等丰富的响应式结构适用于各种场景。

- **完善的抽象工具**
  - 为复杂交互中常用的 DOM 位置、大小、滚动等状态提供响应式封装。
  - 提供 [Component AOP](https://axii.dev/playground/2-advanced/3-component_AOP) 机制，极大减轻维护复用组件的工作量。同时为使用者提供了极为灵活的能力。
  - 基于 Component AOP 实现的样式逻辑分离，可独立于组件函数作用域之外并仍保持逻辑完整。可从 Figma 等设计工具快速生成具备逻辑能力的样式。

- **为大型应用准备的基础设施**
  - 官方提供的[路由系统](https://axii.dev/playground/3-common_util/1-router)、[数据请求管理系统](https://axii.dev/playground/3-common_util/2-action)、甚至功能完善的[状态机系统](https://axii.dev/playground/3-common_util/3-statemachine)。
  - 官方提供的 headless [组件系统](https://ui.axii.dev/list.html?theme=inc)，以及有趣的[主题系统](https://ui.axii.dev/forms?theme=fallout)。


## 🛠 安装

你可以使用以下命令创建新项目，预置了示例代码让你快速上手：

```bash
npx create-axii-app myapp
cd myapp
npm run dev
```

从旧版本升级？每个版本的行为变化与迁移方式见 [CHANGELOG.md](./CHANGELOG.md)（英文）。

## ⚡ 快速上手示例

以下是一个简单示例，展示如何使用响应式原子数据并绑定到 DOM 属性中:
```jsx
/ @jsx createElement /
import { createRoot, atom } from 'axii'
function App({}, {createElement}) {
  const title = atom('Hello, Reactive World!')
  return (
    <div>
      <input
        value={title}
        onInput={(e) => title(e.target.value)}
      />
      <h1>{() => title()}</h1>
    </div>
  )
}

const root = document.getElementById('root')
createRoot(root).render(<App />)
```
这里的 `title` 是一个可变的原子数据，任何对 `title` 的赋值都会引起依赖它的部分自动更新，无需手工协调。

## 🍃 响应式集合示例

如果你需要在列表或 Map/Set 等结构上进行频繁操作，还可以使用内置的 `RxList`、`RxMap`、`RxSet`，它们在性能上更具优势：

```jsx
/ @jsx createElement /
import { createRoot, RxList } from 'axii'

function ListApp({}, {createElement}) {
  const items = new RxList([ 'Apple', 'Banana', 'Cherry' ])
  function addItem() {
    items.push(`Random-${Math.random().toFixed(2)}`)
  }
  return (
    <div>
      <ul>
       {items.map(item => <li>{item}</li>)}
      </ul>
      <button onClick={addItem}>Add Random</button>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<ListApp />)
```


只要 `items` 列表发生变化，该变化会以*增量更新*的方式映射到 DOM 上，不会触发整个列表的重渲染。🍀


## 📚 学习更多

查看 [https://axii.dev](https://axii.dev)，内含详细的中英文使用教程，涵盖：

1. 基础概念：从 atom 到 RxList/RxMap/RxSet 的使用与示例
2. 响应式与动态 DOM 渲染原理
3. 组件封装、组件间透传、组件 AOP 机制
4. 副作用与销毁逻辑（`useEffect`, `useLayoutEffect`, `ManualCleanup` 等）
5. 服务端渲染：`renderToString` / `hydrateRoot`、Portal 与 lazy 约定
6. 在实际项目中如何高效应用这些特性

我们在文档中准备了由浅入深的示例与说明，相信能帮助你更好地理解与运用本框架的独特理念。

## 🌐 服务端渲染（SSR）

axii 可在服务端输出 HTML 字符串，并在浏览器中**认领**同一份 DOM 完成激活（无需 Virtual DOM）。

| API | 包入口 | 作用 |
|---|---|---|
| `renderToString(source)` | `axii/ssr` | Node 安全的字符串序列化，**不依赖 DOM 全局** |
| `hydrateRoot(container, source, options?)` | `axii` | 认领已有节点，绑定事件与响应式 Host |

```jsx
/* @jsx createElement */
// 服务端（Node）
import { createElement, atom } from 'axii'
import { renderToString } from 'axii/ssr'

function App() {
  const title = atom('Hello')
  return <h1>{title}</h1>
}

const { html, styles, portals } = renderToString(<App />)
// html 以 <!--root--> 结尾；styles 放入 <style data-axii-ssr>
// hydrate 前将每个 Portal 的 html 及其独立的 <style data-axii-ssr> 写入对应容器
```

```jsx
/* @jsx createElement */
// 浏览器
import { createElement, hydrateRoot, atom } from 'axii'

function App() {
  const title = atom('Hello')
  return <h1>{title}</h1>
}

const root = document.getElementById('root')
root.innerHTML = /* 服务端 html */
hydrateRoot(root, <App />)
// 匹配节点保持 identity；之后的更新与 createRoot().render() 同一路径
```

**简要约定：**

- `renderToString` 与 `hydrateRoot` 时刻的组件树与响应式数据必须一致；框架**不**提供应用状态 dehydrate。
- **Portal** 在 SSR 中使用 `string | { id }`（或 `portalKey`）作为容器键；内容在 `portals[key]`，经 `hydrateRoot(..., { portals })` 激活。
- `style` 数组中靠后的条目在样式表顺序中靠后。条目序号相同时，含直接声明的表排在仅含嵌套规则的表之前，各组按序列化后的 CSS 稳定排序。CSS 选择器优先级和 `!important` 仍由浏览器决定。
- **lazy**：服务端只同步输出 fallback（或 `null`），不 await `load()`；客户端 hydrate 后再加载。
- 非目标：流式 SSR（`renderToStream`）、应用状态序列化协议。
- 完整契约见 `docs/ssr-support/`。

### 激活怎样认领节点

`hydrateRoot` 按 `renderToString` 写出的顺序把服务端输出读回来：每个组件、函数子节点和列表按文档顺序取走自己的服务端节点，再取走结束它们的标记。因此元素不会拿走属于别的位置的节点，激活耗时随页面大小线性增长。匹配的节点保持 identity。服务端 HTML 里的标记与以前相同，旧版服务端写出的 HTML 仍然可以激活；它与当前客户端渲染结果不同的地方按[失配](#失配)处理。

### hydration 的契约变化

`hydrateRoot` 运行期间，组件里的 JSX 返回的是**激活描述**（hydration description），不是 DOM 节点。这个描述永远不会变成节点，激活结束之后也不会。激活进行到描述所在的位置时，axii 为它认领服务端节点。把 JSX 结果存下来当节点用的代码，要改为经 `ref` 拿节点：

```jsx
/* @jsx createElement */
// 改写前：createRoot().render() 下正常，hydrateRoot 之后出错
function Search({}, { createElement }) {
  const input = <input />
  return <div>
    {input}
    <button onClick={() => input.focus()}>搜索</button>
  </div>
}

// 改写后：两种方式下都正常
function Search({}, { createElement, createRef }) {
  const input = createRef()
  return <div>
    <input ref={input} />
    <button onClick={() => input.current.focus()}>搜索</button>
  </div>
}
```

`hydrateRoot` 之后，改写前的版本能渲染，按钮也有响应，但点击时 `input.focus()` 抛 `TypeError`，这可能发生在页面加载之后很久。`ref` 拿到的是认领到的节点。需要在挂载后立即操作节点的代码，放在 ref 回调（`ref={el => …}`）或 `useLayoutEffect` 里。

把描述当节点用，诊断开启与关闭时失败的方式相同；诊断开启时，能检测到的访问会先被报告（见[开发期检测与诊断开关](#开发期检测与诊断开关)）：

| 用法 | 例子 | 结果 |
|---|---|---|
| 读属性 | `input.value`、`el.textContent` | `undefined`；错误出现在后面使用这个值的地方 |
| 写属性 | `el.className = 'x'` | 严格模式代码（ES module、TypeScript 编译产物）里抛 `TypeError` |
| 调方法 | `input.focus()`、`el.addEventListener(…)` | `TypeError` |
| 传给 DOM API | `parent.appendChild(el)`、`observer.observe(el)` | `TypeError`，不会事先报告 |
| 比较身份或类型 | `el === ref.current`、`el instanceof HTMLElement` | `false`，不会报告 |

有变化的写法：

- **把 JSX 结果当节点用**：在组件函数体、effect、事件处理器或定时器里，如上例。改用 `ref`，属性与监听器写成 JSX props。
- **判断 JSX 结果是不是节点**，例如对 `children` 做 `child instanceof HTMLElement`。激活期间结果是 `false`，代码会走与客户端渲染不同的分支。不要按节点类型分支，或者同时判断 `isHydrationElement(child)`（从 `axii` 导出）。
- **`RxList.map` 的行与普通数组的项**在激活期间是描述。一行被认领后，`list.data[i]`（或 `array[i]`）换成认领到的节点，所以激活之后它们与客户端渲染之后一样保存节点。只有在组件函数体或 `map` 回调里把行当节点用的代码需要改用 `ref`。
- **激活期间创建、激活之后才渲染的 JSX**，例如只在 `() => open() ? panel : null` 里显示的 `const panel = <div/>`，或者只在关着的标签页里显示的列表的行。它在第一次渲染时按客户端渲染的方式创建，功能正常，但每个这样的元素会留下一个小的描述对象（这样的列表每行一个）。要避免它，把 JSX 的创建放进渲染它的函数里：`() => open() ? <div/> : null`。
- **激活之外创建的节点作为 child**：按客户端渲染的方式插入，替换它所在位置的服务端节点，不复用。想复用服务端节点，就把元素写成 JSX。直接传给 `hydrateRoot` 的元素也属于这种情况：`hydrateRoot(root, <main>…</main>)` 里的 JSX 在激活开始之前求值。请改为传组件 `hydrateRoot(root, <App />)`，如上面的示例。
- **`$name:_use` 覆写**接受元素或描述。

不变的：

- `createRoot().render()`。
- **存下来、认领之后再次渲染的 JSX**，渲染的是认领到的节点，与客户端渲染里再次渲染同一个元素相同。
- Portal 的内容，以及 `ref` 回调、`useLayoutEffect`、`useEffect` 的执行时机。
- **你的回调里的代码**——`ref` 回调、`useLayoutEffect`、`useEffect`、`root.on(…)` 监听器和 `onError`——即使在 `hydrateRoot` 运行期间，也在激活之外执行：其中的 JSX 返回真实节点，`createRoot().render()` 照常渲染。

### 失配

服务端 HTML 与客户端渲染结果不同时（例如数据不同，或者 HTML 来自旧版服务端），`hydrateRoot` 报告每一处差别，在发现它的位置修复，然后继续：

- 修复之后，节点结构（节点类型、标签、命名空间与顺序）、文本，以及客户端 props 写下的属性，都与客户端渲染相同；位置匹配的节点保持 identity。容器末尾缺少 `<!--root-->` 时同样修复。
- 只由服务端写的属性，在修复路径上认领的元素上会被删除；没有差别、干净认领的元素保留它们，差别在同一个父节点里稍后才出现时就会这样。诊断开启时，这种残留报告为 `AXII_HYDRATION_ATTRIBUTE_RESIDUE`。
- 每条报告是一个 `code: 'AXII_HYDRATION_MISMATCH'` 的错误（`name` 为 `HydrationMismatchError`），带 `expected` / `actual` 字符串。无论诊断是否开启，它都交给 `configureDiagnostics({ onError })`，并输出到 `console.error`。
- 失配会被修复，不会抛出。找不到 Portal 容器时 `hydrateRoot` 仍然抛错；激活函数子节点的内容时抛出的错误会中止激活，并从 `hydrateRoot` 抛出，即使注册了 `root.on('error')` 监听器。

### 开发期检测与诊断开关

发布的包里诊断默认关闭。开发时在调用 `hydrateRoot` 之前打开；激活是否检查描述，在它开始时决定：

```js
import { configureDiagnostics } from 'axii'

// configureDiagnostics 整体替换配置：onError 要在同一次调用里传入
configureDiagnostics({
  enabled: process.env.NODE_ENV !== 'production', // 或者构建工具提供的开发期标志
  onError: (error) => reportToMonitoring(error),  // 可选；诊断开启或关闭都会调用
})
```

诊断开启时，每个描述都包在一个 `Proxy` 里，报告当作节点的访问，并运行下表的检查。每条报告是一个带 `code` 的错误，交给 `onError` 并输出到 `console.error`；它们都不改动 DOM。

| `code` | 报告时机 |
|---|---|
| `AXII_HYDRATION_ELEMENT_ACCESS` | 描述被当作节点读或写（调用方法时先读到它）。消息里有属性名；使用开发期 JSX 转换（`jsxDEV`）时，还有 JSX 所在的文件、行和列。同一个 JSX 位置上的同一种访问只报告一次。 |
| `AXII_HYDRATION_ELEMENT_LATE_RENDER` | 激活期间创建的 JSX 在激活之后才第一次渲染。 |
| `AXII_HYDRATION_LIVE_NODE` | 激活之外创建的节点替换了它所在位置的服务端节点。 |
| `AXII_HYDRATION_ATTRIBUTE_RESIDUE` | 干净认领的元素上有只由服务端写的属性。 |
| `AXII_HYDRATION_INVARIANT` | 激活之后，某个组件、函数子节点或列表的节点不再是文档里一段连续的区间，或者留下了激活用的标记。未经改动的服务端输出不会触发它，除非同一个元素被渲染了两次。 |

这些检查有局限：把描述传给 DOM API、比较身份或类型都检测不到；只在用户操作时执行的代码（例如点击处理器）要真的执行到才会报告，所以开发时也要把这些交互走一遍。诊断关闭时，这些检查都不运行，描述是普通对象，失败方式见上面的表。

### 设计说明 / 限制

- **事件处理器只绑定一次，不是响应式的。** `on*` 属性在元素创建时通过 `addEventListener` 绑定，传入 atom 或返回 handler 的函数并不会让绑定本身变成响应式。如果需要条件行为，请把条件写在 handler *内部*（例如 `onClick={(e) => enabled() && doSomething(e)}`），而不是试图动态替换 handler。
- **只有 `on` 加大写字母、值为函数的 prop 才是事件处理器。** 其余名字以 `on` 开头（任意大小写）的 prop（`onclick`、`ONCLICK`、`oNclick`、`once`、`online`），在客户端和 `renderToString` 的输出里都不会写到元素上。这与 React 对未知 `on*` prop 的规则相同，适用于所有元素，包括 SVG 与自定义元素。属性名不区分大小写，写出这样的名字可能创建一个可执行的内联处理器，例如展开一个不可信的对象（`<div {...untrusted}/>`）时。诊断开启时（见[开发期检测与诊断开关](#开发期检测与诊断开关)），axii 对每个 prop 名输出一次警告。单独的 `on` 属性（例如 AMP 的 `on="tap:…"`）仍然会写出。
- **`<svg>` 里的 `<a>`、`<title>`、`<style>`、`<script>`。** 这几个标签名在 HTML 和 SVG 里都有。直接写在 SVG 元素的 JSX 里（不在 `<foreignObject>`、`<desc>`、`<title>` 里面）时，它们是 SVG 元素，与 HTML 解析器处理服务端输出的方式相同：SVG 父元素创建时把它们改建到 SVG 命名空间。在父元素创建之前拿到的子元素引用（`const t = <title/>; <svg>{t}</svg>`）指向被丢弃的 HTML 元素，直接加在它上面的监听器也不会带过去，请用 `ref`。由函数子节点、组件或列表稍后渲染时，它们仍是 HTML 元素，这种位置请用 `createSVGElement`。

#### style 数组

`style` 可以是由多个条目（对象、字符串、函数、atom）组成的数组，靠后的条目应当胜出。普通条目写成行内样式。需要样式表的条目（嵌套选择器如 `'&:hover'`、at-rule、`animation` / `@keyframes`，或者 `bindProps` 传入的样式）会得到一个生成的 class，并把它自己声明的顶层属性从前面条目写下的行内值那里收回。之后的普通条目再次写成行内样式。

- **靠后条目里的嵌套规则胜不过靠前条目写下的行内值。** `style={[{color: 'red'}, {'&:hover': {color: 'blue'}}]}` 里，hover 的颜色永远不生效。行内声明总是胜过样式表规则，而 axii 有意把普通条目保留为行内样式：把它们挪进样式表，会为每个不同的值（每个列表行、每一帧动画）各建一张样式表，还会让应用自己的 CSS 覆盖它们。请改用下面的写法之一。这几种写法里，基础值都是样式表规则的一部分，应用的 CSS 可以像覆盖其他样式表条目一样覆盖它：
  - 把基础值和嵌套规则写在同一个条目里：`style={{color: 'red', '&:hover': {color: 'blue'}}}`。
  - 从外部覆写组件内部的样式（`$name:style`、`bindProps`）时，在你的条目顶层再写一次基础属性：`{color: 'red', '&:hover': {color: 'blue'}}`。它顶层的 `color` 会把内部的行内值收回。
  - 基础值每行不同或者每帧都变时，把它作为自定义属性留在行内，在需要样式表的条目里引用它，所有行因此共用一张样式表：`style={[{'--c': color}, {color: 'var(--c)', '&:hover': {color: 'blue'}}]}`。
- **嵌套 key 里的选择器列表逐个展开。** `{'&.a, &.b': {'& span': {…}}}` 展开为 `.x.a span, .x.b span`，每个选择器保留自己的优先级。原生 CSS 嵌套把父级列表包在 `:is()` 里，列表中每个选择器都取列表里最高的优先级。两者匹配的元素相同；如果有与之竞争的规则胜出，请自己提高嵌套选择器的优先级。
- **样式表规则和 `renderToString` 的行内样式，只保留浏览器读作恰好一条声明的值。** 这两处的值会写进 CSS 文本，所以浏览器会把它读成多条声明或一条嵌套规则时，axii 丢弃这条声明：顶层的 `;` 或 `!important`、格式错误的无引号 `url(…)`（例如 `url(a(b)`）、引号字符串里未转义的换行，或者自定义属性以外的值里的顶层 `{}` 块。客户端的行内样式拒绝同样的值。
- **未闭合的括号只在客户端的行内样式里有效。** 浏览器会补上行内值末尾没有闭合的括号，所以 `backgroundImage: 'url(a.png'` 作为普通行内样式可以生效；在样式表规则和 `renderToString` 的行内样式里，这条声明会被丢弃。请自己闭合括号。
- **字符串条目只设置它声明的属性。** `style={[{color: 'blue', paddingTop: 1}, 'margin-top: 3px']}` 中，元素保留 `color` 和 `padding-top`，并得到 `margin-top`。无论是字符串还是对象，靠后的条目都逐个属性胜出，与服务端相同。响应式的字符串条目变化时，它不再声明的属性会被删除，其他条目写下的属性保留。同一个字符串内部按浏览器的规则：后面的普通声明不会替换同一字符串里前面的 `!important` 声明。跨条目时靠后的条目胜出，包括胜过前面字符串条目里的 `!important` 声明。字符串形式的 `detachStyle` 同样不动其他行内属性。（早期版本在客户端会替换整个行内样式，前面条目的属性在激活之后消失。）
- **自定义属性的值与其他值遵循相同的规则。** 客户端和 `renderToString` 都把 `{'--gap': [4, 8]}` 写成 `4 8`，把 `{'--t': [300, 'ms']}` 写成 `300ms`（客户端以前写成 `4,8` 和 `300,ms`）。数字不加单位。
- **`renderToString` 与字符串条目。** 服务端用与客户端相同的拆分器把字符串条目拆成声明，靠后的条目因此能像在客户端一样从它那里收回属性。服务端无法可靠拆分的字符串（转义、花括号、属性名前的注释、未结束的引号或注释、格式错误的 `url(…)`）原样写出，由 `hydrateRoot` 重写行内样式：客户端按浏览器的解析结果，把它应用在已有的行内样式之上。在激活之前，这种字符串里未结束的引号、注释或 `url(` 还会吞掉后面条目的声明，靠后的单项属性条目也不会从前面字符串里带 `!important` 的简写属性中取出自己那一部分（`['margin: 1px !important', {marginTop: 5}]`）。

## 🤝 贡献

欢迎在 GitHub 上提交 [Issue](https://github.com/axiijs/axii/issues) 或 [Pull Request](https://github.com/axiijs/axii/pulls)，与我们一起打磨这款新型增量响应式前端框架。你的想法与改进意见对我们非常重要！

## 📄 协议

本项目使用 [MIT License](./LICENSE)。你可以自由地 fork 并基于此进行二次开发，期待你的创意与反馈！
