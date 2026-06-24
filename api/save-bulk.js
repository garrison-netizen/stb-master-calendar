// POST /api/save-bulk — creates many entries in one call. Used for bulk
// "Nothing this week": one nothingThisWeek entry per selected empty cell.
import { saveEntry } from '../lib/notionCore.js'
import { requireAuth } from '../lib/auth.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async function handler(req, res) {
  try {
    await requireAuth(req)
    const list = Array.isArray(req.body && req.body.entries) ? req.body.entries : []
    if (list.length > 120)
      throw new Error('Too many cells at once — select 120 or fewer.')

    const entries = []
    for (const payload of list) {
      let attempt = 0
      for (;;) {
        try {
          entries.push(
            await saveEntry(process.env.NOTION_TOKEN, process.env.NOTION_DB_ID, payload)
          )
          break
        } catch (err) {
          const msg = String(err.message || err)
          // Back off and retry on Notion rate-limit / transient errors.
          if (attempt < 2 && /\b(409|429|5\d\d)\b/.test(msg)) {
            attempt++
            await sleep(700 * attempt)
            continue
          }
          throw err
        }
      }
      await sleep(120) // gentle pacing under Notion's rate limit
    }

    res.status(200).json({ ok: true, entries })
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) })
  }
}
