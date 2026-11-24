/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'
import { navigate, isActive, currentPath } from '../router.js'

// C-14: minimal top navigation (logo + main nav + command-palette-style search entry).
export function TopNav(_: {}, {}: RenderContext): JSXElement {
  return (
    <header class="axii-topnav">
      <div class="axii-topnav-inner">
        <a
          class="axii-topnav-logo"
          href="/"
          onClick={(e: MouseEvent) => {
            e.preventDefault()
            navigate('/')
          }}
        >
          <span class="axii-topnav-logo-mark">α</span>
          <span>axii</span>
        </a>
        <nav class="axii-topnav-links">
          <a
            class="axii-topnav-link"
            href="/docs"
            data-active={() => (isActive('/docs') ? 'true' : 'false')}
            onClick={(e: MouseEvent) => {
              e.preventDefault()
              navigate('/docs')
            }}
          >
            Docs
          </a>
          <a
            class="axii-topnav-link"
            href="/examples"
            data-active={() => (isActive('/examples') ? 'true' : 'false')}
            onClick={(e: MouseEvent) => {
              e.preventDefault()
              navigate('/examples')
            }}
          >
            Examples
          </a>
          <a
            class="axii-topnav-link"
            href="https://github.com/axiijs/axii"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
      </div>
    </header>
  )
}
