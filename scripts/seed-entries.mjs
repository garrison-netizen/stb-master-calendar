// Seed this-week-onward entries into the Master Calendar app from the
// historical Brain "Master Calendar" database (the ~1,052-row archive).
//
//   node scripts/seed-entries.mjs            dry run — reports, writes nothing
//   node scripts/seed-entries.mjs --commit   creates the entries
//   node scripts/seed-entries.mjs --reset    archives previously-seeded entries
//   node scripts/seed-entries.mjs --reformat pulls dates/times out of headlines
//   node scripts/seed-entries.mjs --dump     prints the raw archive rows
//
// The archive holds one cell per category per week. A cell often bundles
// several things — multiple demos in one Details field, or a whole week of
// daily activations as day-by-day lines. This script splits every cell into
// individual entries (one demo, one day, one release each) and dates each on
// its own day wherever the text gives one.
//
// To re-seed cleanly: run --reset first (archives the prior "Historical"
// entries), then --commit. Safe to repeat.
import 'dotenv/config'

const TOKEN = process.env.NOTION_TOKEN
const ENTRIES_DB = process.env.NOTION_DB_ID
const HISTORICAL_DB = '1ed1a27c-bee2-43ae-a0da-28e94086fe6b'
const API = 'https://api.notion.com/v1'
const V = '2022-06-28'
const YEAR = 2026
const SEED_FROM = '2026-05-18' // Monday of the current week.

const COMMIT = process.argv.includes('--commit')
const RESET = process.argv.includes('--reset')
const REFORMAT = process.argv.includes('--reformat')
const DUMP = process.argv.includes('--dump')

// Historical owner initials -> the app owner's full name.
const OWNER_MAP = {
  JO: 'Johnnyo',
  MS: 'Marin Slanina',
  BC: 'Brody Chapman',
  AH: 'Amy Ha',
  CC: 'Carlos Cortez',
  AG: 'Anthony Gorrity',
}

// Historical (ALL CAPS) category name -> the app's category label.
const CATEGORY_MAP = {
  'CAMPAIGN': 'Campaign',
  'PRIMARY MESSAGING': 'Primary Messaging',
  'PRIVATE EVENTS': 'Private Events',
  'LEAD PRODUCTS': 'Lead Products',
  'DISCOUNT/PROMO': 'Discount / Promo',
  'RADIO AD MESSAGING': 'Radio Ad Messaging',
  'BRAND HOLIDAY': 'Brand Holiday',
  'EXTERNAL HOLIDAY': 'External Holiday',
  'CONTENT CAPTURE | A - BTS | B - LFS': 'Content Capture',
  'DRAFT RELEASE': 'Draft Release',
  'PACKAGING TAPROOM RELEASE': 'Packaging - Taproom Release',
  'PACKAGING DISTRO AVAILABILITY': 'Packaging - Distro Availability',
  'SEASONAL': 'Seasonal',
  'KEY CHAIN (Grocery & National) INFORMATION': 'Key Chain Info',
  'TAPROOM HOURS |  | BLANK = BUSINESS AS USUAL': 'Taproom Hours',
  'FOOD SERVICE PROVIDER/MENU': 'Food Service / Menu',
  'DAILY TAPROOM ACTIVATION': 'Daily Taproom Activation',
  'LOCAL MARKET EVENTS': 'Local Market Events',
  'EXTERNAL - NON-LOCAL MARKET EVENTS': 'External / Non-Local Market Events',
  'DEMOS/SAMPLINGS': 'Demos / Samplings',
  'PAVILION RENTALS': 'SpindleBarn Rental',
  'FULL PRIVATE EVENT RENTALS': 'Full Facility Rental',
  'SEMIPRIVATE RENTALS (BREWERY ROOM)': 'Production Room Rental',
  'BEER GARDEN RENTALS': 'Beer Garden Rentals',
  'EMAIL': 'Email',
  'SOCIAL ORGANIC': 'Social Organic',
  'SOCIAL GIVEAWAYS': 'Social Giveaways',
}

// These archive categories pack a week's schedule into one cell, one line per
// day. They are split per day; every other category is split per bulleted item.
const DAY_LINE_CATEGORIES = new Set([
  'Daily Taproom Activation',
  'Food Service / Menu',
])

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}
// Day name (first 3 letters) -> offset in days from the week-ending Saturday.
const DAY_OFFSET = { sun: -6, mon: -5, tue: -4, wed: -3, thu: -2, fri: -1, sat: 0 }
const DAY_RE = /^\s*(sun|mon|tues|tue|weds|wed|thurs|thur|thu|fri|satr|sat)\b/i

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Notion-Version': V,
    'Content-Type': 'application/json',
  }
}

async function api(method, path, body, attempt = 1) {
  let r
  try {
    r = await fetch(`${API}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    if (attempt < 4) {
      await sleep(900 * attempt)
      return api(method, path, body, attempt + 1)
    }
    throw new Error(`${method} ${path} -> network error: ${e.message}`)
  }
  const text = await r.text()
  let j
  try {
    j = JSON.parse(text)
  } catch {
    if (attempt < 4) {
      await sleep(1000 * attempt)
      return api(method, path, body, attempt + 1)
    }
    throw new Error(`${method} ${path} -> HTTP ${r.status}, non-JSON: ${text.slice(0, 200)}`)
  }
  if (!r.ok) {
    if ((r.status >= 500 || r.status === 429) && attempt < 4) {
      await sleep(1200 * attempt)
      return api(method, path, body, attempt + 1)
    }
    throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j).slice(0, 400)}`)
  }
  return j
}

function txt(rich) {
  return (rich || []).map((t) => t.plain_text || '').join('').trim()
}

async function queryAll(dbId, body) {
  const pages = []
  let cursor
  do {
    const b = { page_size: 100, ...body }
    if (cursor) b.start_cursor = cursor
    const data = await api('POST', `/databases/${dbId}/query`, b)
    pages.push(...(data.results || []))
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return pages
}

function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function addDaysISO(isoStr, n) {
  const [y, m, d] = isoStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

// Collapse whitespace, drop a trailing "..." artifact from the old sheet.
function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/\s*\.{2,}\s*$/, '').trim()
}

// First date found in free text: "5/17", "10/3", or a month name like "Oct 8".
function dateInText(text) {
  const md = text.match(/(\d{1,2})\/(\d{1,2})/)
  if (md) return iso(YEAR, Number(md[1]), Number(md[2]))
  const mn = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})/i)
  if (mn) return iso(YEAR, MONTHS[mn[1].toLowerCase()], Number(mn[2]))
  return null
}

// A bulleted / multi-item cell -> individual item strings.
function splitItems(content) {
  return content
    .split(/[•\n]+/)
    .map(clean)
    .filter((s) => s.length > 1)
}

// A weekly day-by-day cell -> { text, date } for each non-empty day.
function splitDayLines(content, weekEndSaturday) {
  const out = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const dayM = line.match(DAY_RE)
    const mdM = line.match(/(\d{1,2})\/(\d{1,2})/)
    let text = line
    if (dayM) text = text.replace(DAY_RE, '')
    if (mdM) text = text.replace(mdM[0], '')
    text = clean(text.replace(/^[\s:]+/, '').replace(/[\s:]+$/, ''))
    if (text.length <= 1) continue
    let date
    if (mdM) {
      date = iso(YEAR, Number(mdM[1]), Number(mdM[2]))
    } else if (dayM) {
      date = addDaysISO(weekEndSaturday, DAY_OFFSET[dayM[1].toLowerCase().slice(0, 3)] ?? 0)
    } else {
      date = weekEndSaturday
    }
    out.push({ text, date })
  }
  return out
}

// ---- Re-formatting: dates and times out of headlines into the date field ---

const DAY = '(?:sun|mon|tues|tue|weds|wed|thurs|thur|thu|fri|satr|sat)'
const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)'

// Whole-token tests — true when a comma-separated part is purely a date/time.
const RE_DAY_DATE = new RegExp(`^${DAY}\\.?\\s+\\d{1,2}/\\d{1,2}$`, 'i')
const RE_MON_DATE = new RegExp(`^${MON}[a-z]*\\.?\\s+\\d{1,2}(?:\\s*-\\s*\\d{1,2})?$`, 'i')
const RE_BARE_MD = /^\d{1,2}\/\d{1,2}$/
const RE_TIME_RANGE_FULL = /^\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?$/i
const RE_TIME_ONE_FULL = /^@?\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m?\.?$/i

// Global versions — strip leftover tokens anywhere in a string.
const RE_DAY_DATE_G = new RegExp(`\\b${DAY}\\.?\\s+\\d{1,2}/\\d{1,2}\\b`, 'ig')
const RE_MON_DATE_G = new RegExp(`\\b${MON}[a-z]*\\.?\\s+\\d{1,2}(?:\\s*-\\s*\\d{1,2})?\\b`, 'ig')
const RE_BARE_MD_G = /\b\d{1,2}\/\d{1,2}\b/g
const RE_TIME_RANGE_G = /\b\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?\b/gi
const RE_TIME_ONE_G = /@?\s*\b\d{1,2}(?::\d{2})?\s*[ap]\.?m?\.?\b/gi

const RE_RANGE = /\b(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i
const RE_ONE = /(?:@\s*)?\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?\b/i

function isDateOrTimePart(s) {
  return (
    RE_DAY_DATE.test(s) || RE_MON_DATE.test(s) || RE_BARE_MD.test(s) ||
    RE_TIME_RANGE_FULL.test(s) || RE_TIME_ONE_FULL.test(s)
  )
}

function hhmm(totalMin) {
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function to24min(h, m, ap) {
  let hr = h % 12
  if (ap === 'p') hr += 12
  return hr * 60 + (m || 0)
}

// Pull a start (and optional end) time out of free text. Returns null if none.
function extractTime(text) {
  const r = text.match(RE_RANGE)
  if (r) {
    const A = +r[1], Am = +(r[2] || 0), B = +r[3], Bm = +(r[4] || 0)
    const ap = r[5].toLowerCase()
    const bMin = to24min(B, Bm, ap)
    let aMin = to24min(A, Am, ap)
    // The trailing am/pm applies to the end time; pick the start's half-day.
    if (aMin > bMin) aMin = to24min(A, Am, ap === 'p' ? 'a' : 'p')
    return { start: hhmm(aMin), end: hhmm(bMin) }
  }
  const o = text.match(RE_ONE)
  if (o) {
    return { start: hhmm(to24min(+o[1], +(o[2] || 0), o[3].toLowerCase())), end: '' }
  }
  return null
}

// Drop date and time tokens from a headline, leaving the descriptive text.
function cleanHeadline(h) {
  let s = h
  const pm = s.match(/\(([^)]*)\)/)
  if (pm) {
    const kept = pm[1]
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((part) => !isDateOrTimePart(part))
    const rebuilt = kept.length ? `(${kept.join(', ')})` : ''
    s = s.slice(0, pm.index) + rebuilt + s.slice(pm.index + pm[0].length)
  }
  s = s.replace(RE_TIME_RANGE_G, ' ').replace(RE_TIME_ONE_G, ' ')
  s = s.replace(RE_DAY_DATE_G, ' ').replace(RE_MON_DATE_G, ' ').replace(RE_BARE_MD_G, ' ')
  s = s.replace(/\(\s*\)/g, ' ').replace(/\s+\)/g, ')').replace(/\(\s+/g, '(')
  s = s.replace(/(\S)\(/g, '$1 (')
  s = s.replace(/\s+/g, ' ').replace(/^[\s,\-]+/, '').replace(/[\s,\-]+$/, '')
  return s.trim()
}

function dateObj(day, start, end) {
  if (!start) return { start: day }
  const d = { start: `${day}T${start}:00`, time_zone: 'America/Chicago' }
  if (end) d.end = `${day}T${end}:00`
  return d
}

// Re-format the seeded entries: date/time moved out of the headline into the
// Date field, the headline cleaned to descriptive text. Only touches entries
// still tagged "Historical" — anything you have edited is left alone.
async function runReformat() {
  const rows = await queryAll(ENTRIES_DB, {
    filter: { property: 'Origin', select: { equals: 'Historical' } },
  })
  console.log(`Seeded ("Historical") entries scanned: ${rows.length}\n`)

  const patches = []
  const creates = []
  let unchanged = 0

  for (const pg of rows) {
    const p = pg.properties || {}
    const headline = txt(p.Headline?.title)
    const day = (p.Date?.date?.start || '').slice(0, 10)
    const category = p.Category?.select?.name || ''
    const owner = p.Owner?.select?.name || ''

    // One activation cell held two timed events — split it in two.
    if (/helloToti/i.test(headline) && /Femme Fetal/i.test(headline)) {
      patches.push({
        id: pg.id,
        old: headline,
        headline: 'Cake deocrating class w/ @helloToti',
        date: dateObj(day, '14:30', ''),
        when: `${day} 14:30`,
      })
      creates.push({
        headline: 'Live Podcas: The Femme Fetal',
        date: dateObj(day, '15:00', ''),
        category,
        owner,
        when: `${day} 15:00`,
      })
      continue
    }

    const time = extractTime(headline)
    const cleaned = cleanHeadline(headline)
    const patch = { id: pg.id, old: headline }
    let changed = false
    if (cleaned && cleaned !== headline) {
      patch.headline = cleaned
      changed = true
    }
    if (time) {
      patch.date = dateObj(day, time.start, time.end)
      patch.when = `${day} ${time.start}${time.end ? '-' + time.end : ''}`
      changed = true
    }
    if (changed) patches.push(patch)
    else unchanged++
  }

  console.log(`Entries to update:  ${patches.length}`)
  console.log(`Entries unchanged:  ${unchanged}`)
  console.log(`New entries to add: ${creates.length}\n`)

  for (const p of patches) {
    console.log(`  ${p.old}`)
    console.log(
      `   -> ${p.headline || '(headline unchanged)'}` +
        (p.when ? `   [${p.when}]` : '   [date unchanged]')
    )
  }
  if (creates.length) {
    console.log('\nNew entries:')
    for (const c of creates)
      console.log(`  + ${c.headline}   [${c.when}]  ${c.category}`)
  }

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --reformat --commit to apply.')
    return
  }

  console.log('\nApplying...')
  let done = 0
  for (const p of patches) {
    const props = {}
    if (p.headline)
      props.Headline = { title: [{ text: { content: p.headline.slice(0, 1900) } }] }
    if (p.date) props.Date = { date: p.date }
    await api('PATCH', `/pages/${p.id}`, { properties: props })
    done++
    if (done % 25 === 0) console.log(`  ${done}/${patches.length}`)
    await sleep(260)
  }
  for (const c of creates) {
    const props = {
      Headline: { title: [{ text: { content: c.headline } }] },
      Date: { date: c.date },
      Category: { select: { name: c.category } },
      Details: { rich_text: [] },
      'Nothing this week': { checkbox: false },
      Origin: { select: { name: 'Historical' } },
    }
    if (c.owner) props.Owner = { select: { name: c.owner } }
    await api('POST', '/pages', { parent: { database_id: ENTRIES_DB }, properties: props })
    await sleep(260)
  }
  console.log(`\nDONE — updated ${patches.length}, added ${creates.length}.`)
}

async function runReset() {
  const rows = await queryAll(ENTRIES_DB, {
    filter: { property: 'Origin', select: { equals: 'Historical' } },
  })
  console.log(`Previously-seeded ("Historical") entries found: ${rows.length}`)
  if (!rows.length) return
  if (!COMMIT) {
    console.log('Add --commit to archive them. (--reset --commit)')
    return
  }
  let n = 0
  for (const pg of rows) {
    await api('PATCH', `/pages/${pg.id}`, { archived: true })
    n++
    await sleep(200)
  }
  console.log(`Archived ${n} entries.`)
}

async function main() {
  if (!TOKEN || !ENTRIES_DB)
    throw new Error('NOTION_TOKEN / NOTION_DB_ID missing from .env')

  if (RESET) {
    console.log('== RESET ==')
    await runReset()
    return
  }

  if (REFORMAT) {
    console.log(COMMIT ? '== REFORMAT — entries will be updated ==' : '== REFORMAT DRY RUN ==')
    await runReformat()
    return
  }

  console.log(COMMIT ? '== COMMIT — entries will be created ==' : '== DRY RUN — nothing will be written ==')

  // 1. Read the archive for this-week-onward rows.
  let historical
  try {
    historical = await queryAll(HISTORICAL_DB, {
      filter: { property: 'Week of', date: { on_or_after: SEED_FROM } },
      sorts: [{ property: 'Week of', direction: 'ascending' }],
    })
  } catch (e) {
    if (/\b40[34]\b/.test(e.message)) {
      throw new Error(
        'Cannot read the historical Master Calendar database — it is not shared ' +
          'with this integration. In Notion, open that database, use the "..." ' +
          `menu -> Connections, and add the calendar app's integration.\n(${e.message})`
      )
    }
    throw e
  }
  console.log(`Historical rows in range: ${historical.length}`)

  if (DUMP) {
    for (const pg of historical) {
      const p = pg.properties || {}
      console.log('\n────────────')
      console.log('Category :', p.Category?.select?.name)
      console.log('Week of  :', p['Week of']?.date?.start)
      console.log('Owner    :', p.Owner?.select?.name)
      console.log('Headline :', JSON.stringify(txt(p.Headline?.title)))
      console.log('Details  :', JSON.stringify(txt(p.Details?.rich_text)))
    }
    return
  }

  // 2. Read current entries, to skip anything already there.
  const existing = await queryAll(ENTRIES_DB)
  const existingKeys = new Set()
  for (const pg of existing) {
    const p = pg.properties || {}
    const cat = p.Category?.select?.name || ''
    const date = (p.Date?.date?.start || '').slice(0, 10)
    const headline = txt(p.Headline?.title)
    if (cat && date) existingKeys.add(`${cat} ${date} ${headline.toLowerCase()}`)
  }
  console.log(`Entries already in the calendar: ${existing.length}\n`)

  // 3. Split every archive cell into individual, dated entries.
  const toCreate = []
  const unmapped = {}
  const seenKeys = new Set()
  let noDate = 0
  let empty = 0
  let already = 0
  let bundledCells = 0

  for (const pg of historical) {
    const p = pg.properties || {}
    const weekOf = p['Week of']?.date?.start
    if (!weekOf) {
      noDate++
      continue
    }
    const histCat = p.Category?.select?.name || ''
    const appCat = CATEGORY_MAP[histCat]
    if (!appCat) {
      unmapped[histCat] = (unmapped[histCat] || 0) + 1
      continue
    }
    const owner = OWNER_MAP[p.Owner?.select?.name] || ''
    const rawHeadline = txt(p.Headline?.title)
    const rawDetails = txt(p.Details?.rich_text)
    // Details holds the full list when a cell bundles several items;
    // a single-item cell leaves Details empty and carries it in the Headline.
    const content = rawDetails ? rawDetails : rawHeadline
    if (!content) {
      empty++
      continue
    }

    const items = DAY_LINE_CATEGORIES.has(appCat)
      ? splitDayLines(content, weekOf.slice(0, 10))
      : splitItems(content).map((t) => ({ text: t, date: dateInText(t) || weekOf.slice(0, 10) }))

    if (items.length > 1) bundledCells++

    for (const it of items) {
      const headline = it.text
      if (headline.length <= 1) continue
      const key = `${appCat} ${it.date} ${headline.toLowerCase()}`
      if (existingKeys.has(key) || seenKeys.has(key)) {
        already++
        continue
      }
      seenKeys.add(key)
      toCreate.push({ headline, date: it.date, category: appCat, owner })
    }
  }

  // 4. Report.
  console.log('--- split summary ---')
  console.log(`Archive cells skipped, no date:   ${noDate}`)
  console.log(`Archive cells skipped, empty:     ${empty}`)
  console.log(`Cells that held multiple items:   ${bundledCells}`)
  console.log(`Entries skipped, already present: ${already}`)
  if (Object.keys(unmapped).length) {
    console.log('UNMAPPED categories (skipped):')
    for (const [name, n] of Object.entries(unmapped)) console.log(`  "${name}" x${n}`)
  }
  console.log(`\nIndividual entries to create: ${toCreate.length}`)

  const byCat = {}
  for (const e of toCreate) byCat[e.category] = (byCat[e.category] || 0) + 1
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(3)}  ${cat}`)

  console.log('\nEvery entry to create:')
  for (const e of toCreate.slice().sort((a, b) => a.date.localeCompare(b.date)))
    console.log(`  ${e.date}  [${e.category}]  ${(e.owner || '-').padEnd(14)}  ${e.headline.slice(0, 64)}`)

  if (!COMMIT) {
    console.log('\nDRY RUN complete. Re-run with --commit to create these entries.')
    return
  }

  // 5. Create.
  console.log(`\nCreating ${toCreate.length} entries...`)
  let created = 0
  for (const e of toCreate) {
    const properties = {
      Headline: { title: [{ text: { content: e.headline.slice(0, 1900) } }] },
      Date: { date: { start: e.date } },
      Category: { select: { name: e.category } },
      Details: { rich_text: [] },
      'Nothing this week': { checkbox: false },
      Origin: { select: { name: 'Historical' } },
    }
    if (e.owner) properties.Owner = { select: { name: e.owner } }
    await api('POST', '/pages', { parent: { database_id: ENTRIES_DB }, properties })
    created++
    if (created % 25 === 0) console.log(`  ${created}/${toCreate.length}`)
    await sleep(280)
  }
  console.log(`\nDONE — created ${created} entries.`)
}

main().catch((e) => {
  console.error('\nSEED FAILED:', e.message)
  process.exitCode = 1
})
