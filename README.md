# Axii

A high-performance frontend framework powered by intelligent reactive data structures.

## 🚀 Key Features

### Efficient Reactive Data Structures
- **Smart Incremental Updates**: When reactive data changes, Axii performs intelligent incremental computations instead of full recalculations, significantly improving performance for array operations
- **No Virtual DOM**: Direct and precise DOM updates based on reactive data changes, eliminating the need for diffing processes
- **Rich Data Types**: Built-in support for reactive collections including `RxList`, `RxMap`, `RxSet`, and specialized `RxTime` for time-based reactivity

### Performance-First Design
- **Automatic Optimization**: High performance by default without requiring extra developer effort
- **Efficient Selection Management**: Built-in tools for single and multiple selections that maintain high performance by avoiding unnecessary recalculations
- **Smart DOM Updates**: Direct attribute updates through atomic reactive data bindings

### Advanced Features
- **Flexible Component Configuration**: Easy exposure of child components and DOM nodes using the `as` syntax
- **Portal Support**: Render components under different root nodes, perfect for modals and popups
- **Context System**: Built-in context support for efficient data passing between components
- **Side Effects Management**: 
  - Support for `useEffect` and `useLayoutEffect`
  - Elegant cleanup handling through `ManualCleanup` class inheritance
  - Automatic cleanup on component destruction

### DOM Integration
- **Reactive DOM State Wrappers**: Built-in reactive wrappers for common DOM states:
  - Element size
  - Position tracking
  - Drag position
  - Scroll position
- **Custom State Wrappers**: Create custom DOM state reactive wrappers using `createStateFromRef`

## 🔧 Installation

```bash
npm install axii
```

## 📚 Quick Start

```javascript
/* @jsx createElement */
import { createRoot, createElement, atom } from 'axii'

function App({}, { createElement }) {
  const name = atom('world')
  const onInput = (e) => name(e.target.value)

  return (
    <div>
      <input value={name} onInput={onInput} />
      <div>Hello, {name}!</div>
    </div>
  )
}

const root = document.getElementById('root')!
const appRoot = createRoot(root)
appRoot.render(<App />)
```

## 📖 Documentation

For detailed documentation and examples, visit our [documentation site](https://axiijs.github.io/site/).

## 🧪 Testing

For detailed examples of using reactive data structures, check out our test cases:
- [RxList Tests](https://github.com/sskyy/data0/blob/main/__tests__/rxList.spec.ts)
- [RxMap Tests](https://github.com/sskyy/data0/blob/main/__tests__/rxMap.spec.ts)
- [RxSet Tests](https://github.com/sskyy/data0/blob/main/__tests__/rxSet.spec.ts)

## 💡 Why Axii?

Axii stands out by providing exceptional performance through its intelligent reactive system. While other frameworks often require manual optimization, Axii is designed to be efficient by default, allowing developers to focus on building features rather than optimizing performance.

## 📄 License

[MIT License](LICENSE)
