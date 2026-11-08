import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_FILE_PATH = path.resolve(__dirname, '..', '.local-sync-db.json')

function readSyncDb(): Record<string, any> {
  try {
    if (!fs.existsSync(DB_FILE_PATH)) return {}
    const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeSyncDb(data: Record<string, any>): void {
  try {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to write .local-sync-db.json:', err)
  }
}

function adunLocalSyncPlugin(): Plugin {
  return {
    name: 'adun-local-sync-plugin',
    configureServer(server) {
      server.middlewares.use('/api/local-sync', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method === 'GET') {
          const db = readSyncDb()
          res.statusCode = 200
          res.end(JSON.stringify(db))
          return
        }

        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => {
            body += chunk.toString()
          })
          req.on('end', () => {
            try {
              const incoming = body ? JSON.parse(body) : {}
              const current = readSyncDb()
              const merged = { ...current, ...incoming }
              writeSyncDb(merged)
              res.statusCode = 200
              res.end(JSON.stringify({ ok: true }))
            } catch (err: any) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: err?.message }))
            }
          })
          return
        }

        res.statusCode = 405
        res.end(JSON.stringify({ error: 'Method not allowed' }))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    adunLocalSyncPlugin(),
  ],
  server: {
    port: 5174,
  },
})
