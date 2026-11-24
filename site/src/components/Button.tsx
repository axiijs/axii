/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'

export function Button({
  variant = 'primary',
  href,
  onClick,
  children,
  target,
  rel,
}: {
  variant?: 'primary' | 'secondary'
  href?: string
  onClick?: (e: MouseEvent) => void
  target?: string
  rel?: string
  children: any
}, _: RenderContext): JSXElement {
  const cls = variant === 'primary' ? 'axii-btn axii-btn-primary' : 'axii-btn axii-btn-secondary'
  if (href) {
    return (
      <a class={cls} href={href} target={target} rel={rel} onClick={onClick}>
        {children}
      </a>
    )
  }
  return (
    <button class={cls} onClick={onClick}>
      {children}
    </button>
  )
}
