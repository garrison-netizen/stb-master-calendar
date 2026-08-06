// GET /api/sync-tripleseat — project confirmed Triple Seat bookings onto the
// calendar as Origin = TripleSeat entries (ADR-011).
//
// Runs daily via Vercel Cron, an hour after the Apps Script pipeline lands the
// bookings in the Brain (that job runs ~6am America/Chicago). Also hittable by
// hand with the cron secret.
//
// SAFETY: writes require the CRON_SECRET. An unauthenticated caller gets a bare
// {ok:false} and nothing runs — this endpoint creates and archives rows in a
// database the whole team relies on, so it is never open.
//
//   ?dry=1   report exactly what would change, write nothing.
//
// Always dry-run first after any change to the mapping: the summary shows the
// per-category split, so a rule that silently dumps everything into the general
// Private Events row is visible before it lands on the real calendar.

import { syncTripleSeat } from '../lib/tripleseatSync.js'

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || ''
  const trusted = !!secret && auth === `Bearer ${secret}`

  if (!trusted) {
    res.status(401).json({ ok: false, error: 'This endpoint requires the cron secret.' })
    return
  }

  const dryRun = (req.query || {}).dry === '1'

  try {
    const summary = await syncTripleSeat(
      {
        token: process.env.NOTION_TOKEN,
        entriesDbId: process.env.NOTION_DB_ID,
        bookingsDbId: process.env.NOTION_BOOKINGS_DB_ID,
      },
      { dryRun }
    )
    res.status(200).json({ ok: summary.errors.length === 0, ranAt: new Date().toISOString(), ...summary })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
}
