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
    watch: { ignored: ['**/coverage/**', '**/.data/**'] },
  },
  preview: { host: true, port: 8200, strictPort: true },
})
