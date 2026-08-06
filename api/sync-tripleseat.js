// GET /api/sync-tripleseat — project confirmed Triple Seat bookings onto the
// calendar as Origin = TripleSeat entries (ADR-011).
//
// Runs daily via Vercel Cron, an hour after the Apps Script pipeline lands the
// bookings in the Brain (that job runs ~6am America/Chicago). Also hittable by
// hand with the cron secret.
//
// WHO MAY CALL IT: the Vercel cron (Bearer CRON_SECRET), or a signed-in
// calendar administrator from the Manage panel. Nobody else — this creates and
// archives rows in a database the whole team relies on, so it is never open.
// The admin path exists because Vercel's manual "run this cron now" button is a
// paid feature, and waiting a day to see what a mapping change does is how
// mapping changes go unreviewed.
//
// WRITING IS OPT-IN. Set TRIPLESEAT_SYNC_LIVE=1 in the Vercel environment to
// let it write; without that it reports and does nothing, every time. ?dry=1
// forces report-only even when live is enabled.
//
// Always dry-run first after any change to the mapping: the summary shows the
// per-category split, so a rule that silently dumps everything into the general
// Private Events row is visible before it lands on the real calendar.

import { syncTripleSeat, purgeTripleSeat } from '../lib/tripleseatSync.js'
import { requireAdmin } from '../lib/auth.js'

// FEED HALTED 2026-08-06 at Garrison's request. The projection put 45 of 49
// bookings in the generic "Private Events" row, which is a marketing-campaigns
// row, not where events belong — the ADR-011 field mapping was wrong about
// that, and settling the right destination was not worth his time today.
//
// The daily cron is removed from vercel.json, so nothing runs on its own. This
// endpoint stays so the work is recoverable and so the entries can be taken
// back off the calendar. To restart it later: fix the category mapping in
// lib/tripleseatSync.js, set HALTED to false, restore the cron, and dry-run it.
const HALTED = true

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
  const isCron = !!secret && auth === `Bearer ${secret}`

  // The same Authorization header carries either the cron secret or a Google
  // sign-in token, so try the cron match first and fall through to the admin
  // gate. A failed admin check is the caller's real error — surface its message
  // rather than a generic 401, or "you're not an admin" reads as "server down".
  if (!isCron) {
    try {
      await requireAdmin(req)
    } catch (e) {
      res
        .status(e.status || 401)
        .json({ ok: false, error: e.message || 'Not authorized to run this.' })
      return
    }
  }

  // FAIL SAFE: writing is opt-in. Without TRIPLESEAT_SYNC_LIVE=1 this only ever
  // reports what it would do. Deliberately NOT keyed off a ?dry=1 query string
  // alone — a cron path's query string is one config detail away from being
  // dropped, and the failure mode of that mistake is writing to the live
  // calendar unreviewed. The safe state is the default state.
  const liveEnabled = String(process.env.TRIPLESEAT_SYNC_LIVE || '').trim() === '1'
  const dryRun = !liveEnabled || (req.query || {}).dry === '1'

  // Removal stays available while the feed is halted — that is the whole point
  // of keeping this endpoint alive.
  if ((req.query || {}).purge === '1') {
    try {
      const summary = await purgeTripleSeat({
        token: process.env.NOTION_TOKEN,
        entriesDbId: process.env.NOTION_DB_ID,
      })
      res.status(200).json({ ok: summary.errors.length === 0, purged: true, ...summary })
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message })
    }
    return
  }

  if (HALTED) {
    res.status(200).json({
      ok: true,
      halted: true,
      error: 'The Triple Seat feed is switched off. Nothing was changed.',
    })
    return
  }

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
