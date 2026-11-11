import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { registerAppShell } from './lib/appShell.ts'
import { listenForChimeUnlock } from './lib/chime.ts'

// Taps keep the "done" chime allowed to play later; see lib/chime.ts.
listenForChimeUnlock()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root is missing from index.html')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The page from the cache on later launches, so it paints before the network answers.
registerAppShell()
