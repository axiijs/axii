// Component AOP: bindProps / mergeProps / mergeProp compose components
// declaratively without re-running the component function.
import { createElement, bindProps, mergeProps } from 'axii'

function Button({}, { createElement }: any) {
  return <button style={{ padding: '8px 16px', borderRadius: 6 }} />
}

// bindProps: pre-bind props at definition time. Returns a new Component.
const PrimaryButton = bindProps(Button, {
  style: { background: '#0070f3', color: '#fff' },
})

// mergeProps: inside a component, merge caller props with defaults.
function SizedButton(props: any, { createElement }: any) {
  const merged = mergeProps({ size: 'md' }, props)
  return <button data-size={merged.size} />
}
