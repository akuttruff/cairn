import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root is missing from index.html')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service workers only register on HTTPS or localhost; over a LAN address
// the app still installs to the home screen, it just won't work offline.
if ('serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js')
}
