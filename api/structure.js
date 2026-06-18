// GET /api/structure — Vercel serverless function.
// Returns the owners and categories that define the calendar's shape, plus
// whether the signed-in caller is allowed to use the Manage panel.
import { getStructure } from '../lib/notionCore.js'
import { requireAuth, isAdmin } from '../lib/auth.js'

export default async function handler(req, res) {
  try {
    const email = await requireAuth(req)
    const structure = await getStructure(
      process.env.NOTION_TOKEN,
      process.env.NOTION_OWNERS_DB_ID,
      process.env.NOTION_CATEGORIES_DB_ID
    )
    // email is null in local dev (no gate) — treat that as an admin.
    const admin = email === null ? true : isAdmin(email)
    res.status(200).json({ ok: true, ...structure, isAdmin: admin })
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) })
  }
}
