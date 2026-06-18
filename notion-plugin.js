// Notion connector for the Vite DEV server (npm run dev).
// In production the same operations run as Vercel serverless functions (api/*.js).
// Both sides share lib/notionCore.js — one source of truth for the Notion logic.
import 'dotenv/config'
import {
  getEntries,
  saveEntry,
  archiveEntry,
  getStructure,
  applyManageOp,
} from './lib/notionCore.js'

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, obj) {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}

export function notionApiPlugin() {
  return {
    name: 'notion-api',
    configureServer(server) {
      const token = () => process.env.NOTION_TOKEN
      const dbId = () => process.env.NOTION_DB_ID
      const ownersDb = () => process.env.NOTION_OWNERS_DB_ID
      const catsDb = () => process.env.NOTION_CATEGORIES_DB_ID

      server.middlewares.use('/api/structure', async (req, res) => {
        try {
          const structure = await getStructure(token(), ownersDb(), catsDb())
          console.log(
            `[notion] GET structure -> ${structure.owners.length} owners, ` +
              `${structure.categories.length} categories`
          )
          // Local dev has no sign-in gate, so the dev user is always an admin.
          sendJson(res, { ok: true, ...structure, isAdmin: true })
        } catch (err) {
          console.error(`[notion] structure error: ${err.message || err}`)
          sendJson(res, { ok: false, error: String(err.message || err) })
        }
      })

      server.middlewares.use('/api/entries', async (req, res) => {
        try {
          const entries = await getEntries(token(), dbId())
          console.log(`[notion] GET entries -> ${entries.length}`)
          sendJson(res, { ok: true, entries })
        } catch (err) {
          console.error(`[notion] entries error: ${err.message || err}`)
          sendJson(res, { ok: false, error: String(err.message || err) })
        }
      })

      server.middlewares.use('/api/save', async (req, res) => {
        try {
          const payload = await readBody(req)
          const entry = await saveEntry(token(), dbId(), payload)
          console.log(`[notion] SAVE ${payload.category} / ${payload.date} -> ${entry.id}`)
          sendJson(res, { ok: true, entry })
        } catch (err) {
          console.error(`[notion] save error: ${err.message || err}`)
          sendJson(res, { ok: false, error: String(err.message || err) })
        }
      })

      server.middlewares.use('/api/clear', async (req, res) => {
        try {
          const { id } = await readBody(req)
          if (id) await archiveEntry(token(), id)
          console.log(`[notion] CLEAR ${id}`)
          sendJson(res, { ok: true })
        } catch (err) {
          console.error(`[notion] clear error: ${err.message || err}`)
          sendJson(res, { ok: false, error: String(err.message || err) })
        }
      })

      server.middlewares.use('/api/manage', async (req, res) => {
        try {
          const body = await readBody(req)
          const result = await applyManageOp(
            {
              token: token(),
              ownersDbId: ownersDb(),
              catsDbId: catsDb(),
              entriesDbId: dbId(),
            },
            body
          )
          console.log(`[notion] MANAGE ${body.op}`)
          sendJson(res, { ok: true, ...result })
        } catch (err) {
          console.error(`[notion] manage error: ${err.message || err}`)
          sendJson(res, { ok: false, error: String(err.message || err) })
        }
      })
    },
  }
}
