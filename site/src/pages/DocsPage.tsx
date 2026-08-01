/** @jsx createElement */
import { createElement, type JSXElement, type RenderContext } from 'axii'
import { docGroups, externalPackages } from '../docs/docSections.js'
import { CodeBlock } from '../components/CodeBlock.js'
import { navigate, isActive } from '../router.js'

// Docs page (C-14, C-27, C-28, C-29, C-30, C-34, C-35). Three-column layout:
// left sidebar (concept navigation), center content (prose + code snippets),
// right TOC (section anchors). All content is rendered with axii.
export function DocsPage(_: {}, {}: RenderContext): JSXElement {
  const allSections = docGroups.flatMap((g) => g.sections)

  return (
    <div class="axii-doc-container">
      <aside class="axii-doc-sidebar">
        {docGroups.map((group) => (
          <div class="axii-doc-sidebar-section">
            <div class="axii-doc-sidebar-title">{group.title}</div>
            {group.sections.map((section) => (
              <a
                class="axii-doc-sidebar-link"
                href={`#${section.id}`}
                onClick={(e: MouseEvent) => {
                  e.preventDefault()
                  document
                    .getElementById(section.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  history.replaceState({}, '', `#${section.id}`)
                }}
              >
                {section.title}
              </a>
            ))}
          </div>
        ))}
      </aside>

      <article class="axii-doc-content">
        <h1>Documentation</h1>
        <p style={{ color: 'var(--axii-fg-muted)', fontSize: '17px' }}>
          axii is a high-performance incremental-update frontend framework without
          Virtual DOM. This page documents the core concepts that ship from{' '}
          <code>src/index.ts</code>.
        </p>

        {docGroups.map((group) =>
          group.sections.map((section) => (
            <section id={section.id} style={{ scrollMarginTop: '88px', marginBottom: 'var(--axii-space-8)' }}>
              <h2>{section.title}</h2>
              <p>{section.prose}</p>
              {section.html && section.raw ? (
                <CodeBlock
                  highlightedHtml={section.html}
                  rawCode={section.raw}
                  language={section.language ?? 'tsx'}
                />
              ) : null}

              {section.id === 'external-packages' ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
                  {externalPackages.map((pkg) => (
                    <li
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        padding: '12px 16px',
                        border: '1px solid var(--axii-border)',
                        borderRadius: 'var(--axii-radius)',
                        marginBottom: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ fontFamily: 'var(--axii-font-mono)' }}>{pkg.capability}</strong>
                        <span class="axii-doc-external-badge">external · {pkg.packageName}</span>
                      </div>
                      <div style={{ color: 'var(--axii-fg-muted)', fontSize: '14px' }}>{pkg.source}</div>
                      <a
                        href={pkg.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--axii-accent)', fontSize: '14px' }}
                      >
                        {pkg.url} ↗
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )),
        )}
      </article>

      <aside class="axii-doc-toc">
        <div class="axii-doc-toc-title">On this page</div>
        {allSections.map((section) => (
          <a
            class="axii-doc-toc-link"
            href={`#${section.id}`}
            onClick={(e: MouseEvent) => {
              e.preventDefault()
              document
                .getElementById(section.id)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              history.replaceState({}, '', `#${section.id}`)
            }}
          >
            {section.title}
          </a>
        ))}
      </aside>
    </div>
  )
}
