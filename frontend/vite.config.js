import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' },
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000' },
      '/socket.io': { target: 'http://127.0.0.1:5000', ws: true },
    },
  },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' } },
})
