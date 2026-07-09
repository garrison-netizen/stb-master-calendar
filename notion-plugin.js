// Notion connector for the Vite DEV server (npm run dev).
// In production the same operations run as Vercel serverless functions (api/*.js).
// Both sides share lib/notionCore.js — one source of truth for the Notion logic.
// With no NOTION_TOKEN in the environment (fresh clone, no .env), the dev server
// serves generated sample data instead so the UI is workable without credentials.
import 'dotenv/config'
import {
  getEntries,
  saveEntry,
  archiveEntry,
  getStructure,
  applyManageOp,
} from './lib/notionCore.js'
import { SECTIONS, OWNERS, CATEGORIES } from './src/calendarConfig.js'

function mondayOf(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}
function isoDay(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

function mockStructure() {
  const owners = Object.entries(OWNERS).map(([initials, o], i) => ({
    id: 'own_' + initials,
    name: o.name,
    initials,
    color: o.color,
    email: '',
    active: true,
    supervises: [],
    order: i,
  }))
  const categories = CATEGORIES.map((c, i) => ({
    id: c.id,
    label: c.label,
    sublabel: c.sublabel || '',
    section: c.section,
    owner: OWNERS[c.owner].name,
    active: true,
    order: i,
  }))
  return { owners, categories }
}

function mockEntries() {
  const monday = mondayOf(new Date())
  const wk = (w, d = 0) => {
    const x = new Date(monday)
    x.setDate(x.getDate() + w * 7 + d)
    return isoDay(x)
  }
  const e = (category, date, headline, details = '', time = '') => ({
    id: 'mock_' + Math.random().toString(36).slice(2, 9),
    category,
    date: time ? date + 'T' + time + ':00.000-05:00' : date,
    headline,
    details,
    nothingThisWeek: false,
  })
  const nothing = (category, w) => ({
    id: 'mock_' + Math.random().toString(36).slice(2, 9),
    category,
    date: wk(w),
    headline: '',
    details: '',
    nothingThisWeek: true,
  })
  return [
    e('Campaign', wk(0), 'Summer Series launch week', 'Hero creative live across channels'),
    e('Campaign', wk(2, 2), 'Mid-summer push', ''),
    e('Primary Messaging', wk(0), '“Brewed for Texas heat”'),
    e('Private Events', wk(0, 4), 'Salinas wedding — SpindleBarn', '150 guests', '17:00'),
    e('Private Events', wk(1, 5), 'Corporate mixer — Taproom', '80 guests', '18:30'),
    e('Lead Products', wk(0), 'Hazy Daze 6-packs'),
    e('Discount / Promo', wk(1), 'BOGO crowlers Thu–Sun'),
    e('Radio Ad Messaging', wk(0), 'KTX drive-time spots'),
    e('Brand Holiday', wk(3, 3), 'Anniversary Party', 'All hands'),
    e('External Holiday', wk(1, 4), 'July 4th weekend', 'Extended hours'),
    e('Content Capture', wk(0, 1), 'BTS: canning line run', '', '09:00'),
    e('Email', wk(0, 2), 'Newsletter: summer lineup'),
    e('Email', wk(2, 2), 'Newsletter: events roundup'),
    e('Social Organic', wk(0), 'Daily stories + 3 reels'),
    e('Draft Release', wk(1, 3), 'Peach Sour on draft', '', '12:00'),
    e('Packaging - Taproom Release', wk(2, 4), 'Barrel-aged stout bottles'),
    e('Seasonal', wk(0), 'Summer shandy in market'),
    e('Key Chain Info', wk(1), 'HEB reset week'),
    e('Daily Taproom Activation', wk(0, 3), 'Trivia night', '', '19:00'),
    e('Daily Taproom Activation', wk(0, 5), 'Live music: The Wailers', '', '20:00'),
    e('Food Service / Menu', wk(0), 'Smash burger pop-up Fri–Sat'),
    e('SpindleBarn Rental', wk(2, 5), 'Quinceañera', '', '16:00'),
    e('Local Market Events', wk(1, 5), 'Farmers market booth', '', '08:00'),
    e('Demos / Samplings', wk(0, 4), 'Spec’s tasting — Katy', '', '16:00'),
    nothing('Social Giveaways', 0),
    nothing('Taproom Hours', 0),
    nothing('Full Facility Rental', 0),
    nothing('Beer Garden Rentals', 1),
  ]
}

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

      if (!process.env.NOTION_TOKEN) {
        console.log('[notion] NOTION_TOKEN not set — dev server is serving SAMPLE data (nothing is saved)')
        server.middlewares.use('/api/structure', (req, res) =>
          sendJson(res, { ok: true, ...mockStructure(), isAdmin: true })
        )
        server.middlewares.use('/api/entries', (req, res) =>
          sendJson(res, { ok: true, entries: mockEntries() })
        )
        server.middlewares.use('/api/save', async (req, res) => {
          const payload = await readBody(req)
          sendJson(res, {
            ok: true,
            entry: {
              id: 'mock_' + Math.random().toString(36).slice(2, 9),
              ...payload,
              date:
                payload.startTime && payload.date
                  ? payload.date + 'T' + payload.startTime + ':00.000-05:00'
                  : payload.date,
            },
          })
        })
        server.middlewares.use('/api/save-bulk', async (req, res) => {
          const { entries = [] } = await readBody(req)
          sendJson(res, {
            ok: true,
            entries: entries.map((p) => ({
              id: 'mock_' + Math.random().toString(36).slice(2, 9),
              ...p,
            })),
          })
        })
        server.middlewares.use('/api/clear', (req, res) => sendJson(res, { ok: true }))
        server.middlewares.use('/api/manage', (req, res) => sendJson(res, { ok: true }))
        return
      }

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
