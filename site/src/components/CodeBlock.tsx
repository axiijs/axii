/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'
import { atom } from 'data0'

// CodeBlock (C-17): terminal-style code block with copy button.
// C-24: the showcase components themselves are rendered with axii.
//
// The `highlightedHtml` prop is produced at build time by the Shiki Vite plugin
// (`?shiki` import suffix) per C-43. Shiki grammar/theme modules never enter
// the client bundle — the client only receives the pre-tokenized HTML string.
// The copy button is the only runtime interaction here (C-43 allows that).
export function CodeBlock({
  highlightedHtml,
  rawCode,
  language = 'tsx',
}: {
  highlightedHtml: string
  rawCode: string
  language?: string
}, { }: RenderContext): JSXElement {
  const copied = atom(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined

  const onCopy = () => {
    // navigator.clipboard may be unavailable in non-secure contexts; fall back
    // to a textarea hack so the copy button works under `vite preview` on http.
    const text = rawCode
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try { document.execCommand('copy') } catch { /* noop */ }
        document.body.removeChild(ta)
      }
      copied(true)
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => copied(false), 1500)
    } catch {
      /* noop — copy failure is non-fatal */
    }
  }

  return (
    <div class="axii-code">
      <div class="axii-code-header">
        <span class="axii-code-lang">{language}</span>
        <button class="axii-code-copy" data-copied={() => (copied() ? 'true' : 'false')} onClick={onCopy}>
          {() => (copied() ? '✓ Copied' : 'Copy')}
        </button>
      </div>
      <pre dangerouslySetInnerHTML={highlightedHtml} />
    </div>
  )
}
