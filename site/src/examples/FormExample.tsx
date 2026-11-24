/** @jsx createElement */
// Example: Form — reactive form container. Items register themselves via the
// FormContext; values live in an RxMap so the whole form state is reactive.
// submit / reset / clear are exposed on the FormContext.
import { createElement, createRoot, Form, FormContext, type RenderContext } from 'axii'
import { RxMap, atom, type Atom } from 'data0'

function Field({
  name,
  label,
  type = 'text',
}: {
  name: string
  label: string
  type?: string
}, { createElement, context }: RenderContext) {
  const formContext = context.get(FormContext)!
  // Each field keeps its own atom; it registers itself once on mount.
  const value: Atom<string> = atom('')
  const instance = {
    value,
    reset: () => value(''),
    clear: () => value(''),
  }
  formContext.register(name, instance)

  return (
    <div class="axii-demo-row">
      <label style={{ minWidth: '100px', color: 'var(--axii-fg-muted)' }}>{label}:</label>
      <input
        class="axii-demo-input"
        type={type}
        value={value()}
        onInput={(e: InputEvent) => {
          value((e.target as HTMLInputElement).value)
          formContext.onChange()
        }}
      />
    </div>
  )
}

export function render(container: HTMLElement): () => void {
  const values = new RxMap<string, any>({})
  const submitted = atom<null | Record<string, any>>(null)

  function App({}, { createElement, context }: RenderContext) {
    const formContext = context.get(FormContext)
    return (
      <div>
        <Form
          name="signup"
          values={values}
          onSubmit={(v) => {
            const snapshot: Record<string, any> = {}
            for (const [k, val] of v.entries()) snapshot[k] = val
            submitted(snapshot)
          }}
        >
          <Field name="email" label="Email" type="email" />
          <Field name="name" label="Name" />
        </Form>
        <div class="axii-demo-row" style={{ marginTop: '12px' }}>
          <button class="axii-btn axii-btn-primary" onClick={() => formContext.submit()}>
            Submit
          </button>
          <button class="axii-btn axii-btn-secondary" onClick={() => formContext.reset()}>
            Reset
          </button>
        </div>
        {() =>
          submitted() ? (
            <pre
              style={{
                marginTop: '12px',
                padding: '12px',
                background: '#fafafa',
                border: '1px solid var(--axii-border)',
                borderRadius: 'var(--axii-radius)',
                fontFamily: 'var(--axii-font-mono)',
                fontSize: '13px',
                overflow: 'auto',
              }}
            >
              {JSON.stringify(submitted(), null, 2)}
            </pre>
          ) : null
        }
      </div>
    )
  }

  const root = createRoot(container)
  root.render(<App />)
  // Return the destroy handle so <Example> can tear down the inner reactive
  // graph + DOM when the example is unmounted (e.g. on route change). axii
  // roots are not GC'd — destroy() must be called explicitly.
  return () => root.destroy()
}
