import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createReadStream, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'local-apk-download',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/downloads/AURA-test.apk') return next()
        if (!['GET','HEAD'].includes(req.method)) { res.statusCode = 405; return res.end() }
        const apk = fileURLToPath(new URL('../artifacts/AURA-test.apk', import.meta.url))
        try {
          const stat = statSync(apk)
          res.setHeader('Content-Type','application/vnd.android.package-archive')
          res.setHeader('Content-Disposition','attachment; filename="AURA-test.apk"')
          res.setHeader('Content-Length',stat.size)
          res.setHeader('Cache-Control','no-store')
          if (req.method === 'HEAD') return res.end()
          createReadStream(apk).on('error',()=>res.destroy()).pipe(res)
        } catch { res.statusCode = 404; res.end('APK is not built yet.') }
      })
    },
  }],
  server: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' },
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000' },
      '/socket.io': { target: 'http://127.0.0.1:5000', ws: true },
    },
  },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' } },
})
