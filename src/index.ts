export * from './DOM'
export { default as PropTypes, type TypeChecker } from './propTypes.js'
export { createRoot } from './render.js'
export { hydrateRoot } from './hydrateRoot.js'
// 激活期间 JSX 的结果是延迟描述，不是 DOM 节点（#55 设计 C4）：需要按节点类型判断 JSX 结果时用它一并判断
export { isHydrationElement } from './hydrationElement.js'
export { createHost } from './createHost.js'
export * from './eventAlias.js'
export * from './Host.js'
export * from './types.js'
export * from './ref.js'
export * from './Portal.js'
export * from './Form.js'
export * from './ComponentHost.js'
export * from './StaticHost.js'
export * from './reactiveDOMState.js'
export * from './diagnostics.js'
// 样式对象 → CSS 规则文本（与 StyleManager 建表用的同一个函数）。给想在模块顶层自己登记共享 class 的
//  调用方用，规则文本、单位补全、`&` 展开、@media、@keyframes 与 axii 逐字相同。
export {generateStyleContent} from './styleSerialize.js'
export {ContextProvider, type ContextProviderProps, createContext} from "./ContextProvider.js";

export * from 'data0'
export { ManualCleanup as AutoCleanup } from 'data0'
export * from './lazy.js'
export {
    enableAxiiRetainedObjectDiagnostics,
    disableAxiiRetainedObjectDiagnostics,
    resetAxiiRetainedObjectDiagnostics,
    isAxiiRetainedObjectDiagnosticsEnabled,
    getAxiiRetainedObjectDiagnosticsSnapshot,
    type AxiiRetainedObjectDiagnosticsSnapshot,
} from './retainedObjectDiagnostics.js'