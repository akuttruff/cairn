import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import api from './server/api.ts'

export default defineConfig({
  plugins: [react(), api()],
  server: {
    // Reachable from a phone on the same Wi-Fi, like LM Chat.
    host: true,
    port: 8200,
    strictPort: true,
    // Also reachable over Tailscale, via `tailscale serve`.
    allowedHosts: ['<your-machine>.<your-tailnet>.ts.net'],
    watch: { ignored: ['**/coverage/**', '**/.data/**'] },
  },
  // A separate port from `server` above: this is the persistent, built
  // instance Tailscale points at, so it can run alongside `npm run dev`
  // (unbundled, for local iteration) without a port clash.
  preview: { host: true, port: 8210, strictPort: true, allowedHosts: ['<your-machine>.<your-tailnet>.ts.net'] },
})
