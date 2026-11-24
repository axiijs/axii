/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'

// C-26: feature card with icon slot + title + one-line description.
export function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}, _: RenderContext): JSXElement {
  return (
    <div class="axii-feature-card">
      <div class="axii-feature-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}
