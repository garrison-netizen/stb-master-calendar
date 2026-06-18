// POST /api/clear — Vercel serverless function. Archives (removes) an entry.
import { archiveEntry } from '../lib/notionCore.js'
import { requireAuth } from '../lib/auth.js'

export default async function handler(req, res) {
  try {
    await requireAuth(req)
    const { id } = req.body || {}
    if (id) await archiveEntry(process.env.NOTION_TOKEN, id)
    res.status(200).json({ ok: true })
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) })
  }
}
