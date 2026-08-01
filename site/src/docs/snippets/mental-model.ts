// Mental model: component functions run exactly once.
// The function below executes a single time when <Counter/> mounts.
// The atom drives every subsequent DOM update — the function never re-runs.
import { createElement } from 'axii'
import { atom } from 'data0'

function Counter() {
  const count = atom(0)
  return (
    <button onClick={() => count(count() + 1)}>
      clicked {count} times
    </button>
  )
}
