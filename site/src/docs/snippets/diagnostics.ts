// Diagnostics: enable in development to catch leaked hosts and broken list
// order. Production pays only a single boolean check per gate.
import { enableAxiiRetainedObjectDiagnostics } from 'axii'

if (import.meta.env.DEV) {
  enableAxiiRetainedObjectDiagnostics({
    onLeak: (snapshot) => {
      console.warn('[axii] retained objects after clear:', snapshot)
    },
  })
}
