import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createReadStream, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'local-artifact-downloads',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const files = {
          '/downloads/AURA-test.apk': ['../artifacts/AURA-test.apk','application/vnd.android.package-archive','AURA-test.apk'],
          '/downloads/AURA-promo.mp4': ['../artifacts/aura-promo/AURA-vertical-promo.mp4','video/mp4','AURA-promo.mp4'],
          '/media/AURA-promo.mp4': ['../artifacts/aura-promo/AURA-vertical-promo.mp4','video/mp4',null],
          '/media/AURA-promo-poster.jpg': ['../artifacts/aura-promo/poster.jpg','image/jpeg',null],
          '/preview/aura-promo': ['../artifacts/aura-promo/preview.html','text/html; charset=utf-8',null],
        }
        const file = files[req.url?.split('?')[0]]
        if (!file) return next()
        if (!['GET','HEAD'].includes(req.method)) { res.statusCode = 405; return res.end() }
        const artifact = fileURLToPath(new URL(file[0], import.meta.url))
        try {
          const stat = statSync(artifact)
          res.setHeader('Content-Type',file[1])
          if (file[2]) res.setHeader('Content-Disposition',`attachment; filename="${file[2]}"`)
          res.setHeader('Cache-Control','no-store')
          res.setHeader('Accept-Ranges','bytes')
          if (req.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
            let start = range?.[1] ? Number(range[1]) : 0
            let end = range?.[2] ? Number(range[2]) : stat.size - 1
            if (range && !range[1] && range[2]) { start = Math.max(0,stat.size - Number(range[2])); end = stat.size - 1 }
            if (!range || (!range[1] && !range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) {
              res.statusCode = 416; res.setHeader('Content-Range',`bytes */${stat.size}`); return res.end()
            }
            end = Math.min(end,stat.size - 1)
            res.statusCode = 206
            res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`)
            res.setHeader('Content-Length',end-start+1)
            if (req.method === 'HEAD') return res.end()
            return createReadStream(artifact,{start,end}).on('error',()=>res.destroy()).pipe(res)
          }
          res.setHeader('Content-Length',stat.size)
          if (req.method === 'HEAD') return res.end()
          createReadStream(artifact).on('error',()=>res.destroy()).pipe(res)
        } catch { res.statusCode = 404; res.end('This artifact is not available yet.') }
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
