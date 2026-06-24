// POST /api/clear — Vercel serverless function. Archives (removes) an entry.
import { archiveEntry, getEntry } from '../lib/notionCore.js'
import { editGuard } from '../lib/auth.js'

export default async function handler(req, res) {
  try {
    const guard = await editGuard(req)
    const { id } = req.body || {}
    if (id) {
      if (!guard.unrestricted) {
        const entry = await getEntry(process.env.NOTION_TOKEN, id)
        if (!guard.canEdit(entry.category))
          throw new Error('You can only remove cells in your own categories.')
      }
      await archiveEntry(process.env.NOTION_TOKEN, id)
    }
    res.status(200).json({ ok: true })
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) })
  }
}
