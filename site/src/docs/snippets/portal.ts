// Portal: render a subtree into a different DOM container (modals, tooltips,
// popovers). The subtree is a real axii tree, with reactive graph intact.
// CAUTION Portal reads the `content` prop, NOT children — passing children
//  leaves content=undefined and throws "Invalid value used in weak set" at
//  renderedStaticContent.has(undefined) (src/Portal.tsx). Use `content` with a
//  function (for reactive subtrees) or a static JSX element.
import { createElement, Portal } from 'axii'

function ModalContent({}, { createElement }: any) {
  return <div>Modal body</div>
}

function Modal({}, { createElement }: any) {
  // container is any HTMLElement — usually document.body or a portal root.
  // content is a function returning JSX so reactive parts inside stay live.
  return <Portal container={document.body} content={() => <ModalContent />} />
}
