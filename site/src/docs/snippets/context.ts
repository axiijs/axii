// createContext / ContextProvider: typed dependency injection through the
// component tree. Consumers read via context.get(MyContext).
import { createElement, createContext, ContextProvider } from 'axii'

const ThemeContext = createContext<'light' | 'dark'>('Theme')

function App({}, { createElement, context }: any) {
  const theme = context.get(ThemeContext)
  return <div data-theme={theme} />
}

function Root({}, { createElement }: any) {
  return (
    <ContextProvider contextType={ThemeContext} value="light">
      <App />
    </ContextProvider>
  )
}
