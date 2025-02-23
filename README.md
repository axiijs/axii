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

<p align="center">
  <img alt="Axii NPM Package Version" src="https://img.shields.io/npm/v/axii?style=flat-square">
  <img alt="Axii Test Coverage" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fgithub.com%2Faxiijs%2Faxii%2Fraw%2Fmain%2Fcoverage-summary.json&query=%24.total.lines.pct&style=flat-square&label=coverage&color=%2340ba18">
</p>

# 🚀 Axii - An Incremental Reactive Frontend Framework

Axii /ˈæksɪ:/ is a brand-new frontend framework that relies on an "incremental update" reactive data structure to truly build a high-performance data logic layer. 🚀 The official infrastructure provided makes it convenient whether you are creating a component library or developing an application.

## ✨ Feature Overview

- **Simple Mental Model**
  - Uses React-style JSX, but functions execute only once, creating real DOM elements instead of Virtual DOM.
  - Binds updates to elements by recognizing reactive data structures. No special syntax, no framework-specific hooks, no compiler magic.

- **Superior Performance**
  - Precisely updates DOM nodes and attributes. Component functions never re-execute.
  - Reactive data automatically performs incremental computations, resulting in theoretically minimal changes. Significantly reduces computational overhead, especially during complex operations on arrays or collections.
  - Rich reactive structures like `RxList` / `RxMap` / `RxSet` / `RxTime` suitable for various scenarios.

- **Powerful Abstraction Tools**
  - Reactive wrappers for DOM position, size, scroll, and other states commonly used in complex interactions.
  - [Component AOP](https://axii.dev/playground/2-advanced/3-component_AOP) mechanism greatly reduces the workload of maintaining reusable components while providing extremely flexible capabilities.
  - Style-logic separation implemented through Component AOP can maintain logical integrity outside component function scope. Styles with logical capabilities can be quickly generated from design tools like Figma.

- **Infrastructure Ready for Large Applications**
  - Official [routing system](https://axii.dev/playground/3-common_util/1-router), [data request management system](https://axii.dev/playground/3-common_util/2-action), and even a full-featured [state machine system](https://axii.dev/playground/3-common_util/3-statemachine).
  - Official [headless component system](https://ui.axii.dev/list.html?theme=inc), and [interesting theme system](https://ui.axii.dev/forms?theme=fallout).


## 🛠 Installation

Use the following command to create a new project. It comes with sample code to help you get started quickly:

```bash
npx create-axii-app myapp
cd myapp
npm run dev
```

## ⚡ Quick Start Example

Below is a simple example showing how to use reactive atomic data and bind it to a DOM property:

```jsx
/* @jsx createElement */
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

Here, `title` is a mutable atomic data. Any assignment to `title` will automatically update the parts that depend on it, with no manual coordination required.

## 🍃 Reactive Collections Example

If you need frequent operations on lists or structures like Map/Set, you can also use the built-in `RxList`, `RxMap`, `RxSet`, which offer superior performance:

```jsx
/* @jsx createElement */
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

Whenever the `items` list changes, that change will be mapped to the DOM *incrementally* without triggering a complete re-render of the list. 🍀


## 📚 Learn More

Check out [https://axii.dev](https://axii.dev) for detailed documentation in both Chinese and English, covering:

1. Basic concepts: from using `atom` to `RxList`/`RxMap`/`RxSet` with examples  
2. Principles of reactivity and dynamic DOM rendering  
3. Component encapsulation, inter-component data passing, and the component AOP mechanism  
4. Side-effect and destruction logic (`useEffect`, `useLayoutEffect`, `ManualCleanup`, etc.)  
5. How to effectively apply these features in real-world projects  

We provide progressively organized examples and explanations in the documentation, which we believe will help you better understand and utilize the unique ideas of this framework.

## 🤝 Contributing

We welcome you to submit [Issues](https://github.com/axiijs/axii/issues) or [Pull Requests](https://github.com/axiijs/axii/pulls) on GitHub to help polish this new incremental reactive frontend framework. Your ideas and suggestions are extremely important to us!

## 📄 License

This project is licensed under the [MIT License](./LICENSE). You are free to fork and develop upon it, and we look forward to your creative input and feedback!
