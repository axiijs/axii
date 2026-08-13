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
// portals[key].html 需在 hydrate 前写入对应容器
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
- **lazy**：服务端只同步输出 fallback（或 `null`），不 await `load()`；客户端 hydrate 后再加载。
- 非目标：流式 SSR（`renderToStream`）、应用状态序列化协议。
- 完整契约见 `docs/ssr-support/`。

## 📚 学习更多

查看 [https://axii.dev](https://axii.dev)，内含详细的中英文使用教程，涵盖：

1. 基础概念：从 atom 到 RxList/RxMap/RxSet 的使用与示例
2. 响应式与动态 DOM 渲染原理
3. 组件封装、组件间透传、组件 AOP 机制
4. 副作用与销毁逻辑（`useEffect`, `useLayoutEffect`, `ManualCleanup` 等）
5. 服务端渲染：`renderToString` / `hydrateRoot`、Portal 与 lazy 约定
6. 在实际项目中如何高效应用这些特性

我们在文档中准备了由浅入深的示例与说明，相信能帮助你更好地理解与运用本框架的独特理念。

### 设计说明 / 限制

- **事件处理器只绑定一次，不是响应式的。** `on*` 属性在元素创建时通过 `addEventListener` 绑定，传入 atom 或返回 handler 的函数并不会让绑定本身变成响应式。如果需要条件行为，请把条件写在 handler *内部*（例如 `onClick={(e) => enabled() && doSomething(e)}`），而不是试图动态替换 handler。

## 🤝 贡献

欢迎在 GitHub 上提交 [Issue](https://github.com/axiijs/axii/issues) 或 [Pull Request](https://github.com/axiijs/axii/pulls)，与我们一起打磨这款新型增量响应式前端框架。你的想法与改进意见对我们非常重要！

## 📄 协议

本项目使用 [MIT License](./LICENSE)。你可以自由地 fork 并基于此进行二次开发，期待你的创意与反馈！
