// Derives calendar entries from confirmed Triple Seat bookings.
//
// WHY THIS EXISTS: Triple Seat is where private events are actually sold, but
// the team plans the week off the Master Calendar. Until now a booked event only
// appeared on the calendar if somebody retyped it, so the calendar routinely
// showed an empty Saturday that was in fact a full-facility rental.
//
// SHAPE (ADR-011, "origin-split hub"): this is a ONE-WAY PROJECTION, not a sync.
// The booking in the Brain stays canonical; the calendar row is a derived copy
// tagged Origin = TripleSeat. Nothing here ever writes back to the Brain, and
// the Triple Seat API is never called — the daily Apps Script pipeline already
// landed the bookings in Notion, and this reads them from there.
//
// HUMAN WINS: saving an entry through the calendar UI stamps Origin = Manual
// (see buildProperties in notionCore.js). That is the adoption signal — once a
// person has touched a derived row it stops being ours and we leave it alone
// forever after. Without that rule the next run would silently revert their edit.

const NOTION_VERSION = '2022-06-28'
const API = 'https://api.notion.com/v1'

// Booking states that belong on the calendar. Triple Seat's own vocabulary is
// PROSPECT/TENTATIVE/DEFINITE/CLOSED/LOST; the pipeline has already collapsed
// that to these three, and only definite-and-beyond reach the Brain at all.
// Cancelled is deliberately absent — a cancelled booking is REMOVED from the
// calendar (see reconcile below), not shown struck through.
const LIVE_STATUSES = new Set(['Confirmed', 'Completed'])

const ORIGIN = 'TripleSeat'

// Don't project events from before the calendar existed. The first entry on
// this calendar is 2026-05-17; the ~500 completed bookings that predate it are
// history, and dropping 500 past events onto a forward-planning surface would
// bury the weeks people actually use. Nothing is lost — every booking stays in
// the Brain's Bookings DB, which is the canonical record either way.
//
// Note the frozen historical Master Calendar is NOT a substitute for that: it
// holds ~115 rental rows for 2023-06 to 2025-07, the marketing team's weekly
// planning view, not a complete booking ledger.
const EARLIEST_EVENT_DATE = '2026-05-17'

// Every derived row is Brewery — private events are the brewery side of the
// house. Revisit only if the coffee shop starts taking bookings.
const BUSINESS = 'Brewery'

// ADR-011 field mapping: Owner <- Taylor Beasley (Private Event Sales
// Coordinator per the 2026-06-22 FOH restructure), regardless of which rep
// Triple Seat has on the booking. The rep is preserved in Details instead, so
// nothing is lost. Owner drives edit permission in this app, so a single
// consistent owner is deliberate — see editGuard.
const OWNER = 'Taylor Beasley'

// Which calendar row a booking lands in. Triple Seat exposes the room/facility
// on its Events endpoint, which the pipeline does not pull, so the booking TITLE
// is the only facility signal we have. Titles like "Full Venue Rental - DPC
// Houston Family Day" or "Indoor Production Room - Wedding reception" name it
// outright; most do not, and those fall back to the general Private Events row
// exactly as ADR-011 specifies. Order matters — first match wins.
const FACILITY_RULES = [
  [/\bspindle\s?barn\b/i, 'SpindleBarn Rental'],
  [/\b(full\s+(venue|facility)|whole\s+venue|entire\s+venue)\b/i, 'Full Facility Rental'],
  [/\bproduction\s+room\b/i, 'Production Room Rental'],
  [/\bbeer\s+garden\b/i, 'Beer Garden Rentals'],
]

const FALLBACK_CATEGORY = 'Private Events'

export function categoryForBooking(title) {
  const t = String(title || '')
  for (const [re, category] of FACILITY_RULES) if (re.test(t)) return category
  return FALLBACK_CATEGORY
}

// A short, human-readable line under the headline. Deliberately excludes
// revenue: the calendar is a shared planning surface visible to every signed-in
// owner, and per-event pricing is not something to broadcast there.
export function detailsForBooking(b) {
  const bits = []
  if (b.rep) bits.push(`Rep: ${b.rep}`)
  if (b.headcount) bits.push(`${b.headcount} guests`)
  if (b.status === 'Completed') bits.push('Completed')
  bits.push('via Triple Seat')
  return bits.join(' · ')
}

// One booking -> the exact Notion property payload for its calendar row.
// Pure: no I/O, so the mapping is testable on fixtures without credentials.
export function entryPropertiesForBooking(b) {
  return {
    Headline: { title: b.title ? [{ text: { content: b.title } }] : [] },
    Date: { date: { start: b.eventDate } },
    Category: { select: { name: categoryForBooking(b.title) } },
    Owner: { select: { name: OWNER } },
    Business: { select: { name: BUSINESS } },
    Origin: { select: { name: ORIGIN } },
    Details: { rich_text: [{ text: { content: detailsForBooking(b) } }] },
    'Source ID': { rich_text: [{ text: { content: b.sourceId } }] },
    'Nothing this week': { checkbox: false },
  }
}

// ---- Notion plumbing --------------------------------------------------------

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Read a rich-text/title value. Accepts both shapes a property can take: what
// the API returns (plain_text) and what we send (text.content). One reader for
// both keeps reading and change-detection from ever disagreeing about whether a
// row's Source ID is set — a disagreement there would re-create every row.
const txt = (rich) =>
  (rich || []).map((t) => t.plain_text || t.text?.content || '').join('')

// Retry transient failures. READS ONLY — a retried create would duplicate a row.
async function fetchRead(url, options, maxRetries = 3) {
  let lastErr
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let resp
    try {
      resp = await fetch(url, options)
    } catch (e) {
      lastErr = e
      await sleep(250 * Math.pow(2, attempt))
      continue
    }
    if (resp.ok || (resp.status !== 429 && resp.status < 500)) return resp
    lastErr = new Error(`Notion API ${resp.status}`)
    const ra = Number(resp.headers.get('retry-after'))
    await sleep(ra > 0 ? ra * 1000 : 250 * Math.pow(2, attempt))
  }
  throw lastErr || new Error('Notion read failed')
}

async function queryAll(token, dbId, label) {
  const pages = []
  let cursor
  do {
    const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }
    const resp = await fetchRead(`${API}/databases/${dbId}/query`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 300)
      // A 404 here almost always means the integration was never shared on the
      // database, not that the id is wrong — say so, because the fix differs.
      const hint =
        resp.status === 404
          ? ` — check that the calendar's Notion integration is connected to ${label} (Notion → the database → ••• → Connections)`
          : ''
      throw new Error(`${label}: Notion API ${resp.status} — ${detail}${hint}`)
    }
    const data = await resp.json()
    pages.push(...(data.results || []))
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return pages
}

// Brain Bookings page -> the minimal shape this module needs.
function normalizeBooking(page) {
  const p = page.properties || {}
  return {
    sourceId: txt(p['Booking ID (Triple Seat)']?.rich_text),
    title: txt(p['Booking title']?.title),
    eventDate: p['Event date']?.date?.start ? p['Event date'].date.start.slice(0, 10) : null,
    status: p.Status?.select?.name || null,
    rep: p['Assigned rep']?.select?.name || null,
    headcount: p['Final headcount']?.number ?? null,
  }
}

function normalizeEntry(page) {
  const p = page.properties || {}
  return {
    id: page.id,
    sourceId: txt(p['Source ID']?.rich_text),
    origin: p.Origin?.select?.name || null,
    props: p,
  }
}

// Has anything we manage actually changed? Avoids rewriting ~500 unchanged rows
// on every daily run, which would burn the rate limit for no reason.
function needsUpdate(existingProps, nextProps) {
  for (const key of Object.keys(nextProps)) {
    if (scalar(nextProps[key]) !== scalar(existingProps[key])) return true
  }
  return false
}

function scalar(prop) {
  if (!prop) return ''
  if ('title' in prop) return txt(prop.title)
  if ('rich_text' in prop) return txt(prop.rich_text)
  if ('select' in prop) return prop.select?.name || ''
  if ('checkbox' in prop) return prop.checkbox ? '1' : '0'
  if ('date' in prop) return prop.date?.start ? String(prop.date.start).slice(0, 10) : ''
  return ''
}

// ---- The projection ---------------------------------------------------------

/**
 * Project confirmed Triple Seat bookings onto the calendar.
 *
 * Resumable by construction: if the function times out mid-backfill, the rows
 * already created are recognised by their Source ID next run and the rest are
 * picked up. A partial run is never a corrupt run.
 *
 * @param {object} env  { token, entriesDbId, bookingsDbId }
 * @param {object} opts { dryRun }  dryRun reports the plan without writing.
 * @returns a summary: created / updated / unchanged / removed / adopted / skipped
 */
export async function syncTripleSeat(env, opts = {}) {
  const { token, entriesDbId, bookingsDbId } = env
  const dryRun = !!opts.dryRun
  if (!token) throw new Error('NOTION_TOKEN is not set')
  if (!entriesDbId) throw new Error('NOTION_DB_ID (calendar entries) is not set')
  if (!bookingsDbId) throw new Error('NOTION_BOOKINGS_DB_ID (Brain bookings) is not set')

  const [bookingPages, entryPages] = await Promise.all([
    queryAll(token, bookingsDbId, 'Brain Bookings DB'),
    queryAll(token, entriesDbId, 'Calendar Entries DB'),
  ])

  const skipped = { noDate: 0, noId: 0, notLive: 0, beforeCalendar: 0 }
  const bookings = []
  for (const page of bookingPages) {
    const b = normalizeBooking(page)
    if (!b.sourceId) { skipped.noId++; continue }
    if (!LIVE_STATUSES.has(b.status)) { skipped.notLive++; continue }
    // No event date means nothing to place on a calendar. Counted, not silent.
    if (!b.eventDate) { skipped.noDate++; continue }
    if (b.eventDate < EARLIEST_EVENT_DATE) { skipped.beforeCalendar++; continue }
    bookings.push(b)
  }

  // Index existing derived rows by their booking id. Rows a human has adopted
  // (Origin flipped to Manual) are indexed too, so we can recognise and respect
  // them rather than creating a duplicate alongside.
  const bySourceId = new Map()
  for (const page of entryPages) {
    const e = normalizeEntry(page)
    if (e.sourceId) bySourceId.set(e.sourceId, e)
  }

  const summary = {
    bookingsConsidered: bookings.length,
    created: 0, updated: 0, unchanged: 0, adopted: 0, removed: 0,
    skipped,
    categoryCounts: {},
    errors: [],
    dryRun,
  }

  const seen = new Set()

  for (const b of bookings) {
    seen.add(b.sourceId)
    const nextProps = entryPropertiesForBooking(b)
    const category = nextProps.Category.select.name
    summary.categoryCounts[category] = (summary.categoryCounts[category] || 0) + 1

    const existing = bySourceId.get(b.sourceId)
    try {
      if (!existing) {
        if (!dryRun) await createPage(token, entriesDbId, nextProps)
        summary.created++
      } else if (existing.origin !== ORIGIN) {
        // A person edited this row through the UI. It is theirs now.
        summary.adopted++
      } else if (needsUpdate(existing.props, nextProps)) {
        if (!dryRun) await patchPage(token, existing.id, { properties: nextProps })
        summary.updated++
      } else {
        summary.unchanged++
      }
    } catch (e) {
      summary.errors.push(`booking ${b.sourceId}: ${e.message}`)
    }
    if (!dryRun) await sleep(120)
  }

  // Anything we previously derived that no longer corresponds to a live booking
  // was cancelled or deleted upstream — take it off the calendar. Scoped hard to
  // rows still tagged TripleSeat so an adopted row is never archived.
  for (const [sourceId, e] of bySourceId) {
    if (seen.has(sourceId) || e.origin !== ORIGIN) continue
    try {
      if (!dryRun) await patchPage(token, e.id, { archived: true })
      summary.removed++
    } catch (err) {
      summary.errors.push(`archive ${sourceId}: ${err.message}`)
    }
    if (!dryRun) await sleep(120)
  }

  return summary
}

async function createPage(token, dbId, properties) {
  const resp = await fetch(`${API}/pages`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ parent: { database_id: dbId }, properties }),
  })
  if (!resp.ok) throw new Error(`create ${resp.status} — ${(await resp.text()).slice(0, 200)}`)
  return resp.json()
}

async function patchPage(token, pageId, body) {
  const resp = await fetch(`${API}/pages/${pageId}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`update ${resp.status} — ${(await resp.text()).slice(0, 200)}`)
  return resp.json()
}
