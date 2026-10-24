import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import api from './server/api.ts'

// Any name on the tailnet, not one machine's: `tailscale serve` is what
// actually limits who can reach this, so a rename shouldn't break it.
const TAILNET = '.ts.net'

export default defineConfig(({ isPreview }) => {
  // `vite preview` is the one real instance (local and, via Tailscale,
  // remote). `vite dev` runs against a separate scratch database, so trying
  // something out while developing never lands in the real food log. A build
  // opens no database at all (the plugin starts the API with a server).
  const usingRealData = isPreview
  const dir = usingRealData ? undefined : path.resolve(process.cwd(), '.data-dev')

  return {
    plugins: [react(), api({ dir })],
    server: {
      // Loopback only: the API has no login, so it must not answer anything
      // on the Wi-Fi. A phone reaches it through `tailscale serve`, which
      // proxies to 127.0.0.1.
      host: '127.0.0.1',
      port: 8200,
      strictPort: true,
      allowedHosts: [TAILNET],
      watch: { ignored: ['**/coverage/**', '**/.data/**', '**/.data-dev/**'] },
    },
    // A separate port from `server` above: the persistent, built instance
    // Tailscale points at, so it can run alongside `npm run dev`. Loopback
    // only, as above.
    preview: { host: '127.0.0.1', port: 8210, strictPort: true, allowedHosts: [TAILNET] },
  }
})
