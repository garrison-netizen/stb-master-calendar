// POST /api/manage — Vercel serverless function.
// Structure edits for the Manage panel: add/edit owners and categories, and
// reorder rows. Administrators only (see lib/auth.js requireAdmin).
import { applyManageOp } from '../lib/notionCore.js'
import { requireAdmin } from '../lib/auth.js'

export default async function handler(req, res) {
  try {
    await requireAdmin(req)
    const result = await applyManageOp(
      {
        token: process.env.NOTION_TOKEN,
        ownersDbId: process.env.NOTION_OWNERS_DB_ID,
        catsDbId: process.env.NOTION_CATEGORIES_DB_ID,
        entriesDbId: process.env.NOTION_DB_ID,
      },
      req.body || {}
    )
    res.status(200).json({ ok: true, ...result })
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) })
  }
}
