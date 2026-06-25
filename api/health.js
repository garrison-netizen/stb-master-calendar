// GET /api/health — configuration & data-source health check.
//
// WHY THIS EXISTS: the calendar's sign-in is gated by a single Notion list, so
// if a required setting (env var) goes blank or wrong, EVERY user is silently
// locked out — exactly what happened on 2026-06-25 when NOTION_ALLOWED_DS was
// empty. This endpoint fails LOUD instead: it verifies every required setting is
// present AND that the Notion token can actually read each data source the app
// depends on, then emails an alert the moment anything is broken — so the
// breakage is caught before the team is.
//
// Runs daily via Vercel Cron (see vercel.json). Also hittable manually.
// Protected by CRON_SECRET (Vercel cron sends it as a Bearer). Full detail and
// alert-sending require that secret; an unauthenticated call gets only {ok}.

const REQUIRED_VARS = [
  'NOTION_TOKEN',
  'NOTION_DB_ID',
  'NOTION_OWNERS_DB_ID',
  'NOTION_CATEGORIES_DB_ID',
  'NOTION_ALLOWED_DS',
  'VITE_GOOGLE_CLIENT_ID',
  'RESEND_API_KEY', // needed so this very alert can be delivered
]

const ALERT_TO = (
  process.env.HEALTH_ALERT_TO ||
  process.env.NUDGE_SUMMARY_TO ||
  'garrison@spindletap.com'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const FROM = process.env.NUDGE_FROM || 'STB Calendar <onboarding@resend.dev>'

// Confirm the token can actually READ a source — a present-but-wrong id is as
// fatal as a blank one. Returns a problem string, or null when healthy.
async function notionReadable(label, url, version) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': version,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 1 }),
    })
    if (r.ok) return null
    return `${label}: Notion returned HTTP ${r.status} — ${(await r.text()).slice(0, 120)}`
  } catch (e) {
    return `${label}: ${e.message}`
  }
}

async function sendAlert(problems) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'RESEND_API_KEY blank — cannot send alert' }
  const html =
    `<p style="color:#a23a37"><strong>The Master Calendar has a configuration problem.</strong> ` +
    `Until it's fixed, the team may be locked out or the calendar may not load.</p>` +
    `<ul>${problems.map((p) => `<li>${p}</li>`).join('')}</ul>` +
    `<p>This is almost always a Vercel environment variable that went blank or wrong. ` +
    `Open the project's <strong>Production</strong> environment variables, fix the listed setting(s), then redeploy.</p>` +
    `<p style="color:#888;font-size:12px">Automated check — https://stb-master-calendar.vercel.app/api/health</p>`
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: ALERT_TO,
      subject: '⚠ Master Calendar is broken — configuration problem',
      html,
    }),
  })
  const data = await resp.json().catch(() => ({}))
  return { ok: resp.ok, id: data.id, error: data.message || data.name }
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || ''
  const trusted = !!secret && auth === `Bearer ${secret}`

  const problems = []
  for (const v of REQUIRED_VARS) {
    if (!process.env[v] || !String(process.env[v]).trim())
      problems.push(`Missing/blank setting: ${v}`)
  }

  // Probe the Notion sources we have ids for (a wrong id fails here too).
  if (process.env.NOTION_TOKEN) {
    const probes = []
    const v22 = '2022-06-28'
    if (process.env.NOTION_ALLOWED_DS)
      probes.push(
        notionReadable(
          'Allowed-Users list (sign-in gate)',
          `https://api.notion.com/v1/data_sources/${process.env.NOTION_ALLOWED_DS}/query`,
          '2025-09-03'
        )
      )
    if (process.env.NOTION_DB_ID)
      probes.push(
        notionReadable('Entries DB', `https://api.notion.com/v1/databases/${process.env.NOTION_DB_ID}/query`, v22)
      )
    if (process.env.NOTION_OWNERS_DB_ID)
      probes.push(
        notionReadable('Owners DB', `https://api.notion.com/v1/databases/${process.env.NOTION_OWNERS_DB_ID}/query`, v22)
      )
    if (process.env.NOTION_CATEGORIES_DB_ID)
      probes.push(
        notionReadable('Categories DB', `https://api.notion.com/v1/databases/${process.env.NOTION_CATEGORIES_DB_ID}/query`, v22)
      )
    for (const p of await Promise.all(probes)) if (p) problems.push(p)
  }

  const ok = problems.length === 0

  // Email an alert when broken — on trusted (cron) runs, or a manual ?alert=1.
  let alerted = false
  if (!ok && (trusted || (req.query || {}).alert === '1')) {
    const r = await sendAlert(problems)
    alerted = r.ok
  }

  // Don't leak which settings are blank to anonymous callers.
  if (!trusted) {
    res.status(200).json({ ok })
    return
  }
  res.status(200).json({ ok, problems, alerted, checkedAt: new Date().toISOString() })
}
