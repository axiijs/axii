<p style="text-align: center;background: #000;padding: 20px;">
  <img src="https://axii.dev/logos/axii-logo-white.svg" height="100" alt="Axii" />
</p>

<p style="text-align: center;">
  <a href="https://axii.dev">
    https://axii.dev
  </a>
  <span>|</span>
  <a href="https://github.com/axiijs/axii/README.md">
    English
  </a>
  <span>|</span>
  <a href="https://github.com/axiijs/axii/README.zh_cn.md">
    中文
  </a>
</p>

# An Incremental Reactive Frontend Framework

This is a brand-new frontend framework that relies on an "incremental update" reactive data structure to truly build a high-performance data logic layer. The official infrastructure provided makes it convenient whether you are creating a component library or developing an application.

## Feature Overview

- **Incremental updates for excellent performance**  
  When dependencies change, a full recalculation is no longer performed. Whether the change is in reactive data or DOM updates, it uses the most efficient incremental computation, updating only the minimal part that changed. This is particularly notable for complex operations on arrays or collections, significantly reducing the computational overhead.

- **No Virtual DOM, no diff process**  
  By recognizing reactive data to make precise updates directly to the **DOM**, it bypasses the traditional Virtual DOM comparison process, making it more efficient and straightforward.

- **Rich reactive data structures**  
  - An `atom` for atomic types that is simple to use  
  - Collection types like `RxList` / `RxMap` / `RxSet` provide near-native insert, delete, update, and query APIs, and automatically maintain reactive behavior  
  - A special reactive data structure `RxTime` for time-based operations  
  - Dynamically monitor various DOM states (scroll, size, position, etc.) and make them reactive  

- **Component model oriented toward composition and extension**  
  - By default, components support reactive passing of atomic values and collection types; you can also use the `as="xxx"` notation for "penetrating" configuration of the DOM or child components  
  - Provides an "AOP-like" mechanism that allows the parent component to directly "patch" the internal DOM or properties of the child component, eliminating the hassle of multiple levels of props passing  

- **Flexible side-effect management**  
  - Native support for `useEffect` and `useLayoutEffect`  
  - More elegant side-effect management via `ManualCleanup`, which automatically calls `destroy` when the component is unmounted  
  - Convenient reactive observation functions such as `autorun`, `once`, etc.  

- **Simple selection and context support**  
  - Built-in optimization for common interactions like single-select or multi-select, preventing widespread re-rendering caused by changes in selection state  
  - A Context mechanism enables data to be passed down the component tree without explicit props at each level  

- **Portal Rendering**  
  Allows component content to be rendered under different root nodes, ideal for scenarios such as modals and dialogs.

## Installation

Use the following command to create a new project. It comes with sample code to help you get started quickly:

```bash
npx create-axii-app myapp
cd myapp
npm run dev
```

## Quick Start Example

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

## Reactive Collections Example

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

Whenever the `items` list changes, that change will be mapped to the DOM *incrementally* without triggering a complete re-render of the list.

## More Advanced Capabilities

- **Component AOP**  
  In the parent component, you can directly use syntax like `$child:props` to "penetrate" the corresponding DOM or subcomponent in the child component for configuration. This approach allows you to maintain the encapsulation of child components while injecting additional styles, properties, or event bindings.

- **DOM State Reactivity**  
  Built-in reactive wrappers for DOM measurements, scroll position, drag position, etc. Monitoring and modifying these properties will automatically trigger detection and updates.

- **Side-effect Management**  
  In addition to common hooks such as `useEffect` and `useLayoutEffect`, the framework also provides `autorun`, `once`, and other function-based interfaces, as well as inheritance from `ManualCleanup` to achieve more flexible cleanup logic.

- **Context Mechanism & Portal Support**  
  You can provide context to any child component, avoiding deeply nested props. You can also render any component under any root node, accommodating various layout and modal needs.

## Learn More

Check out [https://axii.dev](https://axii.dev) for detailed documentation in both Chinese and English, covering:

1. Basic concepts: from using `atom` to `RxList`/`RxMap`/`RxSet` with examples  
2. Principles of reactivity and dynamic DOM rendering  
3. Component encapsulation, inter-component data passing, and the component AOP mechanism  
4. Side-effect and destruction logic (`useEffect`, `useLayoutEffect`, `ManualCleanup`, etc.)  
5. How to effectively apply these features in real-world projects  

We provide progressively organized examples and explanations in the documentation, which we believe will help you better understand and utilize the unique ideas of this framework.

## Contributing

We welcome you to submit [Issues](https://github.com/axiijs/axii/issues) or [Pull Requests](https://github.com/axiijs/axii/pulls) on GitHub to help polish this new incremental reactive frontend framework. Your ideas and suggestions are extremely important to us!

## License

This project is licensed under the [MIT License](./LICENSE). You are free to fork and develop upon it, and we look forward to your creative input and feedback!
