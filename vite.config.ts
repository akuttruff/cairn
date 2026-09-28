import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import api from './server/api.ts'

// Any name on the tailnet, not one machine's: `tailscale serve` is what
// actually limits who can reach this, so a rename shouldn't break it.
const TAILNET = '.ts.net'

export default defineConfig(({ command, isPreview }) => {
  // `vite preview` is the one real instance (local and, via Tailscale,
  // remote). `vite dev` runs against a separate scratch database, so trying
  // something out while developing never lands in the real food log.
  const usingRealData = command === 'build' || isPreview
  const dir = usingRealData ? undefined : path.resolve(process.cwd(), '.data-dev')

  return {
    plugins: [react(), api({ dir })],
    server: {
      // Reachable from a phone on the same Wi-Fi, like LM Chat.
      host: true,
      port: 8200,
      strictPort: true,
      allowedHosts: [TAILNET],
      watch: { ignored: ['**/coverage/**', '**/.data/**', '**/.data-dev/**'] },
    },
    // A separate port from `server` above: the persistent, built instance
    // Tailscale points at, so it can run alongside `npm run dev`.
    preview: { host: true, port: 8210, strictPort: true, allowedHosts: [TAILNET] },
  }
})
