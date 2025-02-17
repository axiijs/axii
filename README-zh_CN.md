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

- **增量更新，性能卓越**  
  当依赖变化时，不再进行全量重新计算。无论是在响应式数据中的变化，还是 DOM 更新，都是使用最高效的增量计算方式，仅对最小变动部分进行更新。尤其在对数组或集合进行复杂操作时，可以显著降低计算开销。

- **无 Virtual DOM，无 diff 过程**  
  通过识别响应式数据直接进行 **DOM** 的精准更新，跳过了传统 Virtual DOM 的比对流程，更加高效、简单。

- **丰富的响应式数据结构**  
  - 原子类型的 `atom` 简洁易用  
  - 集合类型的 `RxList` / `RxMap` / `RxSet` 提供近似原生的增删改查 API，并自动保持响应式行为  
  - 针对时间的特殊响应式数据结构 `RxTime`  
  - 动态监听多种 DOM 状态（滚动、大小、位置等）并将其响应式化

- **面向组合与扩展的组件模型**  
  - 组件默认支持原子值、集合类的响应式传递，也可通过 `as="xxx"` 标记对内嵌 DOM 或子组件进行“穿透式”配置  
  - 提供“类似 AOP”机制，可在父组件直接“打补丁”到子组件的内部 DOM 或属性上，免去繁琐的多层级 props 透传

- **灵活的副作用管理**  
  - 原生的 `useEffect`、`useLayoutEffect` 支持  
  - 通过 `ManualCleanup` 实现更优雅的副作用管理，组件销毁时自动调用 `destroy`  
  - 可使用 `autorun`、`once` 等便捷的响应式观察函数

- **简洁的选择与上下文支持**  
  - 内建单选、多选等常见交互的优化，防止因选中状态变化导致大面积的重渲染  
  - Context 机制让数据可在组件树中层层传递而不必显式地一层层传参

- **Portal 渲染**  
  允许将组件内容渲染到不同的根节点下，适合弹窗、对话框等场景

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

## 🔬 更多高阶能力

- **组件 AOP**  
  在父组件中可直接通过 `$child:props` 这样的语法，“穿透”到子组件对应的 DOM 或子组件上进行配置。适合在保持子组件封装的同时，为其注入额外的样式、属性或事件绑定。

- **DOM 状态响应化**  
  内置对 DOM 大小、滚动位置、拖拽位置等的响应式封装，对这些属性的监听与修改将自动触发检测和更新。

- **副作用管理**  
  除了 `useEffect` 与 `useLayoutEffect` 这样的常规 Hooks，框架还提供了 `autorun`、`once` 等函数化接口，以及通过继承 `ManualCleanup` 来实现更灵活的销毁逻辑。

- **Context 机制与 Portal 支持**  
  可以为任何子组件提供上下文，避免多层 props 嵌套；也可将任意组件渲染到任意根节点下，满足更多布局与弹窗需求。

## 📚 学习更多

查看 [https://axii.dev)](https://axii.dev)，内含详细的中英文使用教程，涵盖：

1. 基础概念：从 atom 到 RxList/RxMap/RxSet 的使用与示例
2. 响应式与动态 DOM 渲染原理
3. 组件封装、组件间透传、组件 AOP 机制
4. 副作用与销毁逻辑（`useEffect`, `useLayoutEffect`, `ManualCleanup` 等）
5. 在实际项目中如何高效应用这些特性

我们在文档中准备了由浅入深的示例与说明，相信能帮助你更好地理解与运用本框架的独特理念。

## 🤝 贡献

欢迎在 GitHub 上提交 [Issue](https://github.com/axiijs/axii/issues) 或 [Pull Request](https://github.com/axiijs/axii/pulls)，与我们一起打磨这款新型增量响应式前端框架。你的想法与改进意见对我们非常重要！

## 📄 协议

本项目使用 [MIT License](./LICENSE)。你可以自由地 fork 并基于此进行二次开发，期待你的创意与反馈！
