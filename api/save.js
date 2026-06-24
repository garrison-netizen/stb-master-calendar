// POST /api/save — Vercel serverless function. Creates or updates an entry.
import { saveEntry } from '../lib/notionCore.js'
import { editGuard } from '../lib/auth.js'

export default async function handler(req, res) {
  try {
    const guard = await editGuard(req)
    const payload = req.body || {}
    if (!guard.canEdit(payload.category))
      throw new Error('You can only edit cells in your own categories.')
    const entry = await saveEntry(
      process.env.NOTION_TOKEN,
      process.env.NOTION_DB_ID,
      payload
    )
    res.status(200).json({ ok: true, entry })
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) })
  }
}
