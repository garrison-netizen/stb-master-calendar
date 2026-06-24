// Shared Notion data layer.
// Used by the Vite dev middleware (notion-plugin.js, for `npm run dev`) AND by
// the Vercel serverless functions (api/*.js, in production). One source of truth.

const NOTION_VERSION = '2022-06-28'
const API = 'https://api.notion.com/v1'

function txt(rich) {
  return (rich || []).map((t) => t.plain_text).join('')
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}

function normalizePage(page) {
  const p = page.properties || {}
  return {
    id: page.id,
    headline: txt(p.Headline?.title),
    date: p.Date?.date?.start || null,
    dateEnd: p.Date?.date?.end || null,
    category: p.Category?.select?.name || null,
    owner: p.Owner?.select?.name || null,
    details: txt(p.Details?.rich_text),
    nothingThisWeek: p['Nothing this week']?.checkbox || false,
  }
}

// A plain day, or a timed value / window. Times are wall-clock America/Chicago;
// the offset-free string + time_zone keeps it correct regardless of server zone.
function buildDate(payload) {
  const day = payload.date
  const st = payload.startTime
  if (!st) return { date: { start: day } }
  const date = { start: `${day}T${st}:00`, time_zone: 'America/Chicago' }
  if (payload.endTime) date.end = `${day}T${payload.endTime}:00`
  return { date }
}

function buildProperties(payload) {
  const props = {
    Headline: {
      title: payload.headline ? [{ text: { content: payload.headline } }] : [],
    },
    Date: buildDate(payload),
    Category: { select: { name: payload.category } },
    Details: {
      rich_text: payload.details ? [{ text: { content: payload.details } }] : [],
    },
    'Nothing this week': { checkbox: !!payload.nothingThisWeek },
    Origin: { select: { name: 'Manual' } },
  }
  if (payload.owner) props.Owner = { select: { name: payload.owner } }
  return props
}

function assertConfig(token, dbId) {
  if (!token || token === 'PASTE_YOUR_KEY_HERE')
    throw new Error('NOTION_TOKEN is not set')
  if (!dbId) throw new Error('NOTION_DB_ID is not set')
}

export async function getEntries(token, dbId) {
  assertConfig(token, dbId)
  const entries = []
  let cursor
  do {
    const resp = await fetch(`${API}/databases/${dbId}/query`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(
        cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }
      ),
    })
    if (!resp.ok) {
      throw new Error(`Notion API ${resp.status} — ${(await resp.text()).slice(0, 300)}`)
    }
    const data = await resp.json()
    for (const page of data.results || []) entries.push(normalizePage(page))
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return entries
}

export async function saveEntry(token, dbId, payload) {
  assertConfig(token, dbId)
  const properties = buildProperties(payload)
  let resp
  if (payload.id) {
    resp = await fetch(`${API}/pages/${payload.id}`, {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ properties }),
    })
  } else {
    resp = await fetch(`${API}/pages`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ parent: { database_id: dbId }, properties }),
    })
  }
  if (!resp.ok) {
    throw new Error(`Notion API ${resp.status} — ${(await resp.text()).slice(0, 300)}`)
  }
  return normalizePage(await resp.json())
}

export async function archiveEntry(token, id) {
  if (!token) throw new Error('NOTION_TOKEN is not set')
  const resp = await fetch(`${API}/pages/${id}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ archived: true }),
  })
  if (!resp.ok) {
    throw new Error(`Notion API ${resp.status} — ${(await resp.text()).slice(0, 300)}`)
  }
}

// Fetch a single entry (used to check who owns it before editing/removing).
export async function getEntry(token, id) {
  if (!token) throw new Error('NOTION_TOKEN is not set')
  const resp = await fetch(`${API}/pages/${id}`, { headers: headers(token) })
  if (!resp.ok) {
    throw new Error(`Notion API ${resp.status} — ${(await resp.text()).slice(0, 300)}`)
  }
  return normalizePage(await resp.json())
}

// ---- Structure: the owners and categories that define the calendar's shape ----

function ownerFromPage(page) {
  const p = page.properties || {}
  return {
    id: page.id,
    name: txt(p.Name?.title),
    initials: txt(p.Initials?.rich_text),
    color: txt(p.Color?.rich_text) || '#888',
    email: (p.Email?.email || '').toLowerCase(),
    // Where nudge emails go (falls back to Email). Lets notices route to a
    // manager even when the editing login is a shared/unmonitored account.
    notifyEmail: (p['Notify email']?.email || '').toLowerCase(),
    // Other owners whose cells this person may also edit (e.g. a supervisor).
    // Stored as a comma-separated list of owner names.
    supervises: txt(p.Supervises?.rich_text)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    order: p.Order?.number ?? 0,
    active: p.Active?.checkbox !== false,
  }
}

function categoryFromPage(page) {
  const p = page.properties || {}
  return {
    id: page.id,
    label: txt(p.Name?.title),
    section: p.Section?.select?.name || '',
    owner: txt(p.Owner?.rich_text),
    sublabel: txt(p.Sublabel?.rich_text),
    order: p.Order?.number ?? 0,
    active: p.Active?.checkbox !== false,
  }
}

async function queryAllPages(token, dbId) {
  const pages = []
  let cursor
  do {
    const resp = await fetch(`${API}/databases/${dbId}/query`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(
        cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }
      ),
    })
    if (!resp.ok) {
      throw new Error(`Notion API ${resp.status} — ${(await resp.text()).slice(0, 300)}`)
    }
    const data = await resp.json()
    pages.push(...(data.results || []))
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return pages
}

export async function getStructure(token, ownersDbId, catsDbId) {
  if (!token) throw new Error('NOTION_TOKEN is not set')
  if (!ownersDbId || !catsDbId)
    throw new Error('Structure database IDs are not set')
  const [ownerPages, catPages] = await Promise.all([
    queryAllPages(token, ownersDbId),
    queryAllPages(token, catsDbId),
  ])
  const owners = ownerPages.map(ownerFromPage).sort((a, b) => a.order - b.order)
  const categories = catPages
    .map(categoryFromPage)
    .sort((a, b) => a.order - b.order)
  return { owners, categories }
}

// ---- Structure mutations: owners & categories -------------------------------
// The Manage panel edits the two structure databases. A rename cascades: the
// new name is written through to every category and entry that referenced the
// old one, so an existing entry is never orphaned from its row.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

const richText = (s) => (s ? [{ text: { content: String(s) } }] : [])

async function notionRequest(token, method, path, body) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) {
    throw new Error(`Notion API ${resp.status} — ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

function ownerProperties(data) {
  const props = {}
  if (data.name !== undefined) props.Name = { title: richText(data.name) }
  if (data.initials !== undefined)
    props.Initials = { rich_text: richText(data.initials) }
  if (data.color !== undefined) props.Color = { rich_text: richText(data.color) }
  if (data.email !== undefined)
    props.Email = { email: data.email ? String(data.email) : null }
  if (data.notifyEmail !== undefined)
    props['Notify email'] = { email: data.notifyEmail ? String(data.notifyEmail) : null }
  if (data.supervises !== undefined)
    props.Supervises = {
      rich_text: richText(
        Array.isArray(data.supervises) ? data.supervises.join(', ') : data.supervises
      ),
    }
  if (data.order !== undefined) props.Order = { number: Number(data.order) || 0 }
  if (data.active !== undefined) props.Active = { checkbox: !!data.active }
  return props
}

function categoryProperties(data) {
  const props = {}
  if (data.label !== undefined) props.Name = { title: richText(data.label) }
  if (data.section !== undefined)
    props.Section = { select: data.section ? { name: data.section } : null }
  if (data.owner !== undefined) props.Owner = { rich_text: richText(data.owner) }
  if (data.sublabel !== undefined)
    props.Sublabel = { rich_text: richText(data.sublabel) }
  if (data.order !== undefined) props.Order = { number: Number(data.order) || 0 }
  if (data.active !== undefined) props.Active = { checkbox: !!data.active }
  return props
}

// Re-tag every entry whose `propName` select equals oldName with newName.
async function cascadeEntryRename(token, entriesDbId, propName, oldName, newName) {
  if (!entriesDbId || !oldName || !newName || oldName === newName) return 0
  const pages = []
  let cursor
  do {
    const body = {
      page_size: 100,
      filter: { property: propName, select: { equals: oldName } },
    }
    if (cursor) body.start_cursor = cursor
    const data = await notionRequest(
      token,
      'POST',
      `/databases/${entriesDbId}/query`,
      body
    )
    pages.push(...(data.results || []))
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  for (const pg of pages) {
    await notionRequest(token, 'PATCH', `/pages/${pg.id}`, {
      properties: { [propName]: { select: { name: newName } } },
    })
    await sleep(180)
  }
  return pages.length
}

// Create (no id) or update (with id) one owner. A name change cascades to every
// category that points at this owner and every entry that carries the name.
export async function saveOwner(token, ownersDbId, catsDbId, entriesDbId, data) {
  if (!token) throw new Error('NOTION_TOKEN is not set')
  if (!ownersDbId) throw new Error('Owners database ID is not set')
  const cascaded = { categories: 0, entries: 0 }

  if (data.id) {
    const current = await notionRequest(token, 'GET', `/pages/${data.id}`)
    const oldName = txt(current.properties?.Name?.title)
    const newName = data.name
    if (newName && oldName && newName !== oldName) {
      if (catsDbId) {
        const cats = await queryAllPages(token, catsDbId)
        for (const cp of cats) {
          if (txt(cp.properties?.Owner?.rich_text) === oldName) {
            await notionRequest(token, 'PATCH', `/pages/${cp.id}`, {
              properties: { Owner: { rich_text: richText(newName) } },
            })
            cascaded.categories++
            await sleep(180)
          }
        }
      }
      cascaded.entries = await cascadeEntryRename(
        token,
        entriesDbId,
        'Owner',
        oldName,
        newName
      )
    }
    const page = await notionRequest(token, 'PATCH', `/pages/${data.id}`, {
      properties: ownerProperties(data),
    })
    return { owner: ownerFromPage(page), cascaded }
  }

  const page = await notionRequest(token, 'POST', '/pages', {
    parent: { database_id: ownersDbId },
    properties: ownerProperties(data),
  })
  return { owner: ownerFromPage(page), cascaded }
}

// Create (no id) or update (with id) one category. A label change cascades to
// every entry filed under the old label.
export async function saveCategory(token, catsDbId, entriesDbId, data) {
  if (!token) throw new Error('NOTION_TOKEN is not set')
  if (!catsDbId) throw new Error('Categories database ID is not set')
  const cascaded = { entries: 0 }

  if (data.id) {
    const current = await notionRequest(token, 'GET', `/pages/${data.id}`)
    const oldName = txt(current.properties?.Name?.title)
    const newName = data.label
    if (newName && oldName && newName !== oldName) {
      cascaded.entries = await cascadeEntryRename(
        token,
        entriesDbId,
        'Category',
        oldName,
        newName
      )
    }
    const page = await notionRequest(token, 'PATCH', `/pages/${data.id}`, {
      properties: categoryProperties(data),
    })
    return { category: categoryFromPage(page), cascaded }
  }

  const page = await notionRequest(token, 'POST', '/pages', {
    parent: { database_id: catsDbId },
    properties: categoryProperties(data),
  })
  return { category: categoryFromPage(page), cascaded }
}

// Apply a batch of Order changes — only the rows that actually moved.
export async function reorderStructure(token, items) {
  if (!token) throw new Error('NOTION_TOKEN is not set')
  let count = 0
  for (const it of items || []) {
    if (!it || !it.id) continue
    await notionRequest(token, 'PATCH', `/pages/${it.id}`, {
      properties: { Order: { number: Number(it.order) || 0 } },
    })
    count++
    await sleep(150)
  }
  return { count }
}

// Single dispatch used by both the dev middleware and the Vercel function.
export async function applyManageOp(env, body) {
  const { token, ownersDbId, catsDbId, entriesDbId } = env
  switch (body && body.op) {
    case 'owner.save':
      return saveOwner(token, ownersDbId, catsDbId, entriesDbId, body.data || {})
    case 'category.save':
      return saveCategory(token, catsDbId, entriesDbId, body.data || {})
    case 'reorder':
      return reorderStructure(token, body.items || [])
    default:
      throw new Error(`Unknown manage operation: ${body && body.op}`)
  }
}
