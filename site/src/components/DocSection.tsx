/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'

// Lightweight docs building blocks: a titled section with prose and an optional
// code block slot. The code slot is a function so the parent can pass either
// a string of code (rendered into a <pre>) or any JSX. The site deliberately
// does NOT re-tokenize code here at runtime — runtime code display uses the
// <CodeBlock> component which receives pre-tokenized HTML from the Shiki plugin.
export function DocSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: any
}, _: RenderContext): JSXElement {
  return (
    <section id={id} style={{ scrollMarginTop: '88px' }}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function ExternalBadge({ package: pkg }: { package: string }, _: RenderContext): JSXElement {
  return <span class="axii-doc-external-badge">external · {pkg}</span>
}
