// Form: a form container that registers its items and exposes submit/reset/clear.
// Values are stored in an RxMap so the whole form state is reactive.
import { createElement, Form } from 'axii'
import { RxMap } from 'data0'

function FormExample({}, { createElement }: any) {
  const values = new RxMap<string, any>({})
  return (
    <Form
      name="signup"
      values={values}
      onSubmit={(v) => console.log('submit', v.get('email'))}
    >
      <input
        ref={(el: HTMLInputElement) => el && values.set('email', el.value)}
        placeholder="email"
      />
    </Form>
  )
}
