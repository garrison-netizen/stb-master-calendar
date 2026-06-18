// Create the two structure databases (Owners, Categories) in Notion and seed
// them from the current hardcoded calendarConfig.js.
// Safe to re-run: it reuses existing databases and only seeds when they are empty.
//   node scripts/seed-structure.mjs
import 'dotenv/config'
import { SECTIONS, OWNERS, CATEGORIES } from '../src/calendarConfig.js'

const TOKEN = process.env.NOTION_TOKEN
const ENTRIES_DB = process.env.NOTION_DB_ID
const API = 'https://api.notion.com/v1'
const V = '2022-06-28'

const OWNERS_TITLE = 'Master Calendar — Owners'
const CATS_TITLE = 'Master Calendar — Categories'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function headers() {
  return { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': V, 'Content-Type': 'application/json' }
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
      console.log(`  retry ${attempt} (${method} ${path} -> HTTP ${r.status}, non-JSON)`)
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

// Walk a Notion parent reference up to the nearest real page id.
async function resolvePageId(parent) {
  let cur = parent
  for (let i = 0; i < 12; i++) {
    if (!cur) break
    if (cur.type === 'page_id') return cur.page_id
    if (cur.type === 'workspace') throw new Error('reached workspace root - no page parent')
    if (cur.type === 'database_id') {
      cur = (await api('GET', `/databases/${cur.database_id}`)).parent
      continue
    }
    if (cur.type === 'block_id') {
      const blk = await api('GET', `/blocks/${cur.block_id}`)
      if (blk.type === 'child_page') return blk.id
      cur = blk.parent
      continue
    }
    throw new Error(`unknown parent type: ${cur.type}`)
  }
  throw new Error('could not resolve a page parent')
}

// Find an existing child database by title under a page, else null.
async function findChildDb(pageId, title) {
  let cursor
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : `?page_size=100`
    const res = await api('GET', `/blocks/${pageId}/children${q}`)
    for (const b of res.results || []) {
      if (b.type === 'child_database' && b.child_database?.title === title) return b.id
    }
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return null
}

async function createDb(pageId, title, properties) {
  const db = await api('POST', '/databases', {
    parent: { type: 'page_id', page_id: pageId },
    title: [{ type: 'text', text: { content: title } }],
    properties,
  })
  return db.id
}

async function rowCount(dbId) {
  return (await api('POST', `/databases/${dbId}/query`, { page_size: 100 })).results.length
}

async function main() {
  if (!TOKEN || !ENTRIES_DB) throw new Error('NOTION_TOKEN / NOTION_DB_ID missing from .env')

  // Parent page: explicit id as the first CLI argument, else resolved from the entries DB.
  let parentPage = (process.argv[2] || '').replace(/-/g, '').trim()
  if (parentPage) {
    console.log('parent page (from argument):', parentPage)
  } else {
    const entriesDb = await api('GET', `/databases/${ENTRIES_DB}`)
    parentPage = await resolvePageId(entriesDb.parent)
    console.log('parent page (resolved):', parentPage)
  }

  // Owners database - find or create.
  let ownersId = await findChildDb(parentPage, OWNERS_TITLE)
  if (ownersId) {
    console.log('Owners DB already exists:', ownersId)
  } else {
    ownersId = await createDb(parentPage, OWNERS_TITLE, {
      Name: { title: {} },
      Initials: { rich_text: {} },
      Color: { rich_text: {} },
      Email: { email: {} },
      Order: { number: {} },
      Active: { checkbox: {} },
    })
    console.log('Owners DB created:', ownersId)
  }

  // Categories database - find or create.
  let catsId = await findChildDb(parentPage, CATS_TITLE)
  if (catsId) {
    console.log('Categories DB already exists:', catsId)
  } else {
    catsId = await createDb(parentPage, CATS_TITLE, {
      Name: { title: {} },
      Section: { select: { options: SECTIONS.map((s) => ({ name: s.id })) } },
      Owner: { rich_text: {} },
      Sublabel: { rich_text: {} },
      Order: { number: {} },
      Active: { checkbox: {} },
    })
    console.log('Categories DB created:', catsId)
  }

  // Seed owners only if empty.
  if ((await rowCount(ownersId)) === 0) {
    const keys = Object.keys(OWNERS)
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const o = OWNERS[k]
      await api('POST', '/pages', {
        parent: { database_id: ownersId },
        properties: {
          Name: { title: [{ text: { content: o.name } }] },
          Initials: { rich_text: [{ text: { content: k } }] },
          Color: { rich_text: [{ text: { content: o.color } }] },
          Order: { number: i },
          Active: { checkbox: true },
        },
      })
      console.log('  owner +', o.name)
      await sleep(350)
    }
  } else {
    console.log('Owners DB already has rows - skipping seed')
  }

  // Seed categories only if empty.
  if ((await rowCount(catsId)) === 0) {
    for (let i = 0; i < CATEGORIES.length; i++) {
      const c = CATEGORIES[i]
      const props = {
        Name: { title: [{ text: { content: c.label } }] },
        Section: { select: { name: c.section } },
        Owner: { rich_text: [{ text: { content: OWNERS[c.owner]?.name || '' } }] },
        Order: { number: i },
        Active: { checkbox: true },
      }
      if (c.sublabel) props.Sublabel = { rich_text: [{ text: { content: c.sublabel } }] }
      await api('POST', '/pages', { parent: { database_id: catsId }, properties: props })
      console.log('  category +', c.label)
      await sleep(350)
    }
  } else {
    console.log('Categories DB already has rows - skipping seed')
  }

  console.log(
    `\nDONE - Owners rows: ${await rowCount(ownersId)} (expect 6), ` +
      `Categories rows: ${await rowCount(catsId)} (expect 27)`
  )
  console.log('\n--- add to .env and Vercel ---')
  console.log(`NOTION_OWNERS_DB_ID=${ownersId}`)
  console.log(`NOTION_CATEGORIES_DB_ID=${catsId}`)
}

main().catch((e) => {
  console.error('SEED FAILED:', e.message)
  process.exitCode = 1
})
