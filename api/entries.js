// GET /api/entries — Vercel serverless function. Lists all calendar entries.
import { getEntries } from '../lib/notionCore.js'
import { requireAuth } from '../lib/auth.js'

export default async function handler(req, res) {
  try {
    await requireAuth(req)
    const entries = await getEntries(
      process.env.NOTION_TOKEN,
      process.env.NOTION_DB_ID
    )
    res.status(200).json({ ok: true, entries })
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) })
  }
}
