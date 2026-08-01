// RxDOM* state wrappers: DOM measurements & interactions as reactive values.
// Each attaches to an element via its `ref` and updates an atom on changes.
// The reactive value is on the wrapper's `.value` field (an atom); the wrapper
// itself is an object, not a function.
import { createElement } from 'axii'
import { atom } from 'data0'
import {
  RxDOMRect,
  RxDOMSize,
  RxDOMScrollPosition,
  RxDOMFocused,
  RxDOMHovered,
} from 'axii'

function Measured({}, { createElement }: any) {
  const size = new RxDOMSize()
  const rectValue = atom(null)
  const rect = new RxDOMRect(rectValue, 'requestAnimationFrame')
  const scroll = new RxDOMScrollPosition()
  const focused = new RxDOMFocused()
  const hovered = new RxDOMHovered()
  return (
    <div ref={size.ref}>
      {() => `${size.value()?.width ?? 0}×${size.value()?.height ?? 0}`}
      {() => focused.value() ? 'focused' : 'blurred'}
      {() => hovered.value() ? 'hover' : 'no-hover'}
    </div>
  )
}
