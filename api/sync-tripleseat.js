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
// WRITING IS OPT-IN. Set TRIPLESEAT_SYNC_LIVE=1 in the Vercel environment to
// let it write; without that it reports and does nothing, every time. ?dry=1
// forces report-only even when live is enabled.
//
// Always dry-run first after any change to the mapping: the summary shows the
// per-category split, so a rule that silently dumps everything into the general
// Private Events row is visible before it lands on the real calendar.

import { syncTripleSeat } from '../lib/tripleseatSync.js'

const MAIL_TO = (
  process.env.HEALTH_ALERT_TO ||
  process.env.NUDGE_SUMMARY_TO ||
  'garrison@spindletap.com'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const FROM = process.env.NUDGE_FROM || 'STB Calendar <onboarding@resend.dev>'

// WHY EMAIL: this job runs unattended behind a secret, so without a report
// nobody can see what it did — a feed that quietly stopped looks exactly like a
// quiet month. Deliberately NOT a daily digest: it only writes when something
// actually happened, or when it is a dry run being reviewed before go-live.
function worthReporting(s) {
  return s.dryRun || s.created > 0 || s.removed > 0 || s.errors.length > 0
}

async function mailSummary(s) {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  const split = Object.entries(s.categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<li>${k}: <strong>${v}</strong></li>`)
    .join('')
  const html =
    (s.dryRun
      ? `<p><strong>DRY RUN — nothing was written.</strong> This is what the Triple Seat feed would do to the calendar.</p>`
      : `<p>The Triple Seat feed updated the Master Calendar.</p>`) +
    `<ul>` +
    `<li>Added: <strong>${s.created}</strong></li>` +
    `<li>Updated: <strong>${s.updated}</strong></li>` +
    `<li>Removed (cancelled upstream): <strong>${s.removed}</strong></li>` +
    `<li>Unchanged: ${s.unchanged}</li>` +
    `<li>Left alone (edited by a person): ${s.adopted}</li>` +
    `</ul>` +
    `<p>Bookings considered: ${s.bookingsConsidered}. Skipped — not confirmed: ${s.skipped.notLive}, no event date: ${s.skipped.noDate}.</p>` +
    `<p>Which calendar row they landed in:</p><ul>${split}</ul>` +
    (s.errors.length
      ? `<p style="color:#a23a37"><strong>${s.errors.length} problem(s):</strong></p><ul>` +
        s.errors.map((e) => `<li>${e}</li>`).join('') +
        `</ul>`
      : '') +
    `<p style="color:#888;font-size:12px">Automated — Triple Seat → Master Calendar (ADR-011)</p>`
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: MAIL_TO,
      subject: s.dryRun
        ? 'Triple Seat → Calendar: dry run, nothing written'
        : `Triple Seat → Calendar: ${s.created} added, ${s.removed} removed`,
      html,
    }),
  })
  return resp.ok
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || ''
  const trusted = !!secret && auth === `Bearer ${secret}`

  if (!trusted) {
    res.status(401).json({ ok: false, error: 'This endpoint requires the cron secret.' })
    return
  }

  // FAIL SAFE: writing is opt-in. Without TRIPLESEAT_SYNC_LIVE=1 this only ever
  // reports what it would do. Deliberately NOT keyed off a ?dry=1 query string
  // alone — a cron path's query string is one config detail away from being
  // dropped, and the failure mode of that mistake is writing to the live
  // calendar unreviewed. The safe state is the default state.
  const liveEnabled = String(process.env.TRIPLESEAT_SYNC_LIVE || '').trim() === '1'
  const dryRun = !liveEnabled || (req.query || {}).dry === '1'

  try {
    const summary = await syncTripleSeat(
      {
        token: process.env.NOTION_TOKEN,
        entriesDbId: process.env.NOTION_DB_ID,
        bookingsDbId: process.env.NOTION_BOOKINGS_DB_ID,
      },
      { dryRun }
    )
    let emailed = false
    if (worthReporting(summary)) {
      try {
        emailed = await mailSummary(summary)
      } catch {
        // A failed report must never fail the sync that already succeeded.
      }
    }
    res.status(200).json({
      ok: summary.errors.length === 0,
      ranAt: new Date().toISOString(),
      emailed,
      ...summary,
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
}
