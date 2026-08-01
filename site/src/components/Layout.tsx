/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'
import { TopNav } from './TopNav.js'
import { navigate } from '../router.js'

export function Layout({ children }: { children: any }, {}: RenderContext): JSXElement {
  return (
    <div>
      <TopNav />
      <main>{children}</main>
      <footer class="axii-footer">
        <div class="axii-footer-inner">
          <div>
            <a href="https://github.com/axiijs/axii" target="_blank" rel="noreferrer">
              GitHub
            </a>{' '}
            ·{' '}
            <a href="https://www.npmjs.com/package/axii" target="_blank" rel="noreferrer">
              npm
            </a>
          </div>
          <div>MIT · built with axii</div>
        </div>
      </footer>
    </div>
  )
}
