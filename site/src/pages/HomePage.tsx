/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'
import { FeatureCard } from '../components/FeatureCard.js'
import { Button } from '../components/Button.js'
import { navigate } from '../router.js'
import { siteVersion } from '../version.js'

// C-15, C-25, C-26: Hero (H1 + subtitle + primary CTA to docs + secondary CTA to GitHub)
// and feature cards covering axii's core value props (C-26).
export function HomePage(_: {}, {}: RenderContext): JSXElement {
  return (
    <div>
      <section class="axii-hero">
        <div class="axii-container">
          <h1>axii</h1>
          <p class="axii-hero-subtitle">
            A high-performance incremental-update frontend framework without Virtual DOM.
            Reactive data drives rendering; component functions run once; updates are
            fine-grained DOM writes — never a re-render.
          </p>
          <div class="axii-hero-cta">
            <Button onClick={() => navigate('/docs')}>Read the docs →</Button>
            <Button
              variant="secondary"
              href="https://github.com/axiijs/axii"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </Button>
          </div>
          <div style={{ marginTop: '24px', color: 'var(--axii-fg-muted)', fontSize: '13px', fontFamily: 'var(--axii-font-mono)' }}>
            v{siteVersion} · MIT · npm i axii
          </div>
        </div>
      </section>

      <section class="axii-container">
        <div class="axii-features">
          <FeatureCard
            icon="◆"
            title="No Virtual DOM"
            description="createElement returns real DOM. There is no diff pass — updates are direct attribute writes computed from reactive data."
          />
          <FeatureCard
            icon="⚡"
            title="Functions run once"
            description="A component function executes a single time. Reactive data structures (atom / RxList / computed) carry every subsequent update."
          />
          <FeatureCard
            icon="◐"
            title="Reactive collections"
            description="RxList / RxMap / RxSet / RxTime mirror native collections while staying reactive end-to-end, including incremental list patches."
          />
          <FeatureCard
            icon="⇄"
            title="Component AOP"
            description="bindProps / mergeProps compose components declaratively. Reusable subtrees survive parent re-renders without identity churn."
          />
          <FeatureCard
            icon="▢"
            title="RxDOM state"
            description="RxDOMRect / RxDOMSize / RxDOMScrollPosition / RxDOMFocused / RxDOMHovered wrap DOM measurements and interactions as reactive values."
          />
          <FeatureCard
            icon="⚙"
            title="Dev diagnostics"
            description="enableAxiiRetainedObjectDiagnostics catches leaked hosts and broken list order in development. Production pays only a boolean check."
          />
        </div>
      </section>

      <section class="axii-container" style={{ padding: '40px 24px 80px' }}>
        <div
          style={{
            border: '1px solid var(--axii-border)',
            borderRadius: 'var(--axii-radius-lg)',
            padding: '32px',
            background: 'linear-gradient(180deg, #fafafa 0%, #ffffff 100%)',
          }}
        >
          <h2 style={{ margin: '0 0 12px', fontSize: '24px', fontWeight: 600 }}>
            See it in motion
          </h2>
          <p style={{ margin: '0 0 20px', color: 'var(--axii-fg-muted)' }}>
            Every example is a live axii subtree — type in the input, click the buttons,
            watch the DOM update without a single re-render.
          </p>
          <Button onClick={() => navigate('/examples')}>Browse examples →</Button>
        </div>
      </section>
    </div>
  )
}
