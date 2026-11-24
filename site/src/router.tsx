/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'
import { atom } from 'data0'

// Self-built lightweight history-API router (DR-03, C-22, C-23).
//
// The router is not exported from `src/` (verified — `grep createRouter src/`
// has no hits). Rather than pull in an external package, the site ships a
// minimal router built on `history.pushState` + `popstate`. The current path is
// held in an `atom`; the layout uses a function node that reads it, so a path
// change is a fine-grained DOM update (the component functions do not re-run —
// only the outlet subtree responds). This is itself the correct axii reactive
// pattern and a self-demonstration of the framework.

export const currentPath = atom<string>(normalizePath(window.location.pathname))

function normalizePath(p: string): string {
  if (!p || p === '') return '/'
  // Trailing slash is normalized away except for the root.
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1)
  return p
}

export function navigate(to: string) {
  const next = normalizePath(to)
  if (next === currentPath()) return
  window.history.pushState({}, '', next)
  currentPath(next)
}

export function Router({ children }: { children: any }, { onCleanup }: RenderContext): JSXElement {
  const onPop = () => {
    currentPath(normalizePath(window.location.pathname))
  }
  window.addEventListener('popstate', onPop)
  onCleanup(() => {
    window.removeEventListener('popstate', onPop)
  })
  return children
}

// Helper to test active-link state from the TopNav/sidebar.
export function isActive(prefix: string): boolean {
  const path = currentPath()
  if (prefix === '/') return path === '/'
  return path === prefix || path.startsWith(prefix + '/')
}
