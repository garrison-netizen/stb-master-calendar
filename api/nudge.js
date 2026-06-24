// GET/POST /api/nudge — weekly "unfilled cells" nudge.
//
// Triggered by Vercel Cron daily at 13:00 UTC; it only actually sends on
// FRIDAY (America/Chicago), so it works regardless of plan cron granularity.
// Protected by CRON_SECRET (Vercel cron sends it automatically as a Bearer).
//
// Finds blank cells (no entry and no "nothing this week" marker) for active
// categories over the next NUDGE_WEEKS weeks, then emails via Resend:
//   - a full summary to NUDGE_SUMMARY_TO (always)
//   - each owner their own gaps (only when NUDGE_PER_OWNER=on AND the sending
//     domain is verified in Resend)
//
// Query overrides for testing: ?dry=1 (compute only, send nothing),
// ?force=1 (send even if it isn't Friday).
import { getEntries, getStructure } from '../lib/notionCore.js'

const WINDOW_WEEKS = Number(process.env.NUDGE_WEEKS || 4)
const FROM = process.env.NUDGE_FROM || 'STB Calendar <onboarding@resend.dev>'
const SUMMARY_TO = (process.env.NUDGE_SUMMARY_TO || 'garrison@spindletap.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const PER_OWNER = (process.env.NUDGE_PER_OWNER || 'off').toLowerCase() === 'on'

// ---- date helpers (UTC, Monday-start weeks; consistent bucketing) -----------
function mondayOfUTC(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = (x.getUTCDay() + 6) % 7 // Mon=0
  x.setUTCDate(x.getUTCDate() - dow)
  return x
}
const keyOf = (d) => d.toISOString().slice(0, 10)
const addDays = (d, n) => {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}
function isFridayCentral() {
  return (
    new Date().toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
    }) === 'Fri'
  )
}
function fmtRange(weekKey) {
  const start = new Date(weekKey + 'T00:00:00Z')
  const end = addDays(start, 6)
  const m = (d) => d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const day = (d) => d.getUTCDate()
  return `${m(start)} ${day(start)}–${m(end)} ${day(end)}`
}

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html }),
  })
  const data = await resp.json().catch(() => ({}))
  return { ok: resp.ok, status: resp.status, id: data.id, error: data.message || data.name }
}

function listHtml(rows) {
  // rows: [{ category, weeks: [weekKey,...] }]
  const items = rows
    .map(
      (r) =>
        `<li style="margin-bottom:6px"><strong>${r.category}</strong>: ${r.weeks
          .map(fmtRange)
          .join(', ')}</li>`
    )
    .join('')
  return `<ul style="padding-left:18px;margin:8px 0">${items}</ul>`
}

export default async function handler(req, res) {
  try {
    const secret = process.env.CRON_SECRET
    const auth = req.headers['authorization'] || ''
    if (!secret || auth !== `Bearer ${secret}`) {
      res.status(401).json({ ok: false, error: 'unauthorized' })
      return
    }
    const q = req.query || {}
    const dry = q.dry === '1' || q.dry === 'true'
    const force = q.force === '1' || q.force === 'true'

    if (!dry && !force && !isFridayCentral()) {
      res.status(200).json({ ok: true, skipped: 'not Friday (Central)' })
      return
    }

    const token = process.env.NOTION_TOKEN
    const [{ owners, categories }, entries] = await Promise.all([
      getStructure(token, process.env.NOTION_OWNERS_DB_ID, process.env.NOTION_CATEGORIES_DB_ID),
      getEntries(token, process.env.NOTION_DB_ID),
    ])

    // Weeks in the window.
    const weeks = []
    let m = mondayOfUTC(new Date())
    for (let i = 0; i < WINDOW_WEEKS; i++) {
      weeks.push(keyOf(m))
      m = addDays(m, 7)
    }

    // Any entry (content OR "nothing this week") counts as addressed.
    const covered = new Set()
    for (const e of entries) {
      if (!e.date) continue
      const wk = keyOf(mondayOfUTC(new Date(e.date.slice(0, 10) + 'T00:00:00Z')))
      covered.add(`${e.category}|${wk}`)
    }

    // Gaps per owner.
    const ownerByName = {}
    for (const o of owners) ownerByName[o.name] = o
    const activeCats = categories.filter((c) => c.active)
    const byOwner = {} // ownerName -> { category -> [weekKey] }
    let gapCount = 0
    for (const c of activeCats) {
      for (const wk of weeks) {
        if (covered.has(`${c.label}|${wk}`)) continue
        gapCount++
        const o = c.owner || '(unassigned)'
        ;(byOwner[o] || (byOwner[o] = {}))
        ;(byOwner[o][c.label] || (byOwner[o][c.label] = [])).push(wk)
      }
    }

    const ownerRows = (ownerName) =>
      Object.entries(byOwner[ownerName] || {}).map(([category, wks]) => ({
        category,
        weeks: wks,
      }))

    // Build the full summary HTML (grouped by owner).
    const ownersWithGaps = Object.keys(byOwner).sort()
    const noEmail = []
    let summaryBody = ''
    for (const ownerName of ownersWithGaps) {
      const o = ownerByName[ownerName]
      if (!o || !o.email) noEmail.push(ownerName)
      summaryBody += `<h3 style="margin:14px 0 2px;color:#16243f">${ownerName}${
        o && o.email ? '' : ' (no email on file)'
      }</h3>${listHtml(ownerRows(ownerName))}`
    }

    const windowLabel = `${fmtRange(weeks[0])} through ${fmtRange(weeks[weeks.length - 1])}`
    const results = { dry, gapCount, weeks, sent: [] }

    if (gapCount === 0) {
      if (!dry) {
        const r = await sendEmail(
          SUMMARY_TO,
          'Master Calendar — all set for the next few weeks ✅',
          `<p>No unfilled cells across the team for ${windowLabel}. Nice.</p>`
        )
        results.sent.push({ to: SUMMARY_TO, ...r })
      }
      res.status(200).json({ ok: true, ...results })
      return
    }

    if (dry) {
      res.status(200).json({ ok: true, ...results, byOwner, noEmail })
      return
    }

    // Summary to admins (always).
    const summaryHtml = `<p>Unfilled Master Calendar cells for <strong>${windowLabel}</strong> (${gapCount} total). Owners are nudged separately${
      PER_OWNER ? '' : ' once per-owner email is enabled'
    }.</p>${summaryBody}${
      noEmail.length
        ? `<p style="color:#a23a37"><strong>No email on file:</strong> ${noEmail.join(
            ', '
          )} — add their email in the calendar's Manage panel so they can be nudged directly.</p>`
        : ''
    }<p style="color:#888;font-size:12px">Open the calendar: https://stb-master-calendar.vercel.app</p>`
    results.sent.push({
      to: SUMMARY_TO,
      ...(await sendEmail(SUMMARY_TO, `Master Calendar — ${gapCount} cells need filling`, summaryHtml)),
    })

    // Per-owner emails (only when enabled + domain verified).
    if (PER_OWNER) {
      for (const ownerName of ownersWithGaps) {
        const o = ownerByName[ownerName]
        if (!o || !o.email) continue
        const html = `<p>Hi ${ownerName.split(' ')[0] || 'there'} — a few Master Calendar cells in your area need filling for <strong>${windowLabel}</strong>. Add an entry, or mark "Nothing this week":</p>${listHtml(
          ownerRows(ownerName)
        )}<p style="color:#888;font-size:12px">Open the calendar: https://stb-master-calendar.vercel.app</p>`
        results.sent.push({
          to: o.email,
          ...(await sendEmail(o.email, 'Master Calendar — your cells need filling', html)),
        })
      }
    }

    res.status(200).json({ ok: true, ...results })
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) })
  }
}
