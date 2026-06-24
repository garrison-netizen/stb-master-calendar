// Google sign-in verification for the API functions.
// Confirms the caller signed in with a verified @spindletap.com Google account.
//
// Behaviour:
//  - If VITE_GOOGLE_CLIENT_ID is set (production on Vercel), every API call must
//    carry a valid Google ID token for a @spindletap.com account.
//  - If it is not set (local `npm run dev`), the gate is skipped — but never on
//    Vercel, where a missing client id fails closed.

import { getStructure } from './notionCore.js'

const ALLOWED_DOMAIN = 'spindletap.com'

function fail(message, status) {
  return Object.assign(new Error(message), { status })
}

// Shared "STB Allowed Users" list (Notion). Staff are allowed by domain;
// anyone else (outside collaborators) must appear on this list tagged for the
// Calendar. Read with the same NOTION_TOKEN the app already uses.
const ALLOWED_DS = process.env.NOTION_ALLOWED_DS
const ALLOWED_TOOL = (process.env.ALLOWED_TOOL || 'Calendar').trim()

async function onAllowlist(email) {
  const token = process.env.NOTION_TOKEN
  if (!token || !ALLOWED_DS) return false
  const filters = [{ property: 'Active', checkbox: { equals: true } }]
  if (ALLOWED_TOOL) filters.push({ property: 'Tools', multi_select: { contains: ALLOWED_TOOL } })
  let cursor
  try {
    do {
      const body = { page_size: 100, filter: { and: filters } }
      if (cursor) body.start_cursor = cursor
      const resp = await fetch('https://api.notion.com/v1/data_sources/' + ALLOWED_DS + '/query', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Notion-Version': '2025-09-03',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok) return false
      const data = await resp.json()
      for (const row of data.results || []) {
        const p = row.properties && row.properties.Email
        let e = null
        if (p) {
          if (p.type === 'email') e = p.email
          else if (p.type === 'rich_text') e = (p.rich_text || []).map((t) => t.plain_text).join('')
        }
        if (e && e.trim().toLowerCase() === email) return true
      }
      cursor = data.has_more ? data.next_cursor : null
    } while (cursor)
  } catch {
    return false
  }
  return false
}

// Returns the verified email address, or throws. Returns null when the gate is
// intentionally skipped (local dev with no client id configured).
export async function requireAuth(req) {
  const clientId = process.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    if (process.env.VERCEL) throw fail('Sign-in is not configured', 500)
    return null // local dev — no gate
  }

  const header = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw fail('Please sign in', 401)

  const resp = await fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token)
  )
  if (!resp.ok) throw fail('Your sign-in has expired — please sign in again', 401)
  const info = await resp.json()

  if (info.aud !== clientId) throw fail('Sign-in token was not issued for this app', 401)
  if (String(info.email_verified) !== 'true')
    throw fail('Your Google email is not verified', 403)

  const email = String(info.email || '').toLowerCase()

  // The shared "STB Allowed Users" Notion list is the single source of truth
  // for who can use the calendar — staff included. Add/remove there; no redeploy.
  if (await onAllowlist(email)) return email
  throw fail('You are not authorized for this calendar. Contact Garrison to be added.', 403)
}

// ---- Admin gate -------------------------------------------------------------
// The Manage panel (structure edits) is limited to named administrators.
// ADMIN_EMAILS is a comma-separated allowlist; when it is unset the list
// defaults to Garrison, so the panel works on first deploy with no extra setup.

const DEFAULT_ADMINS = 'garrison@spindletap.com'

function adminList() {
  return (process.env.ADMIN_EMAILS || DEFAULT_ADMINS)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

// Is this email a calendar administrator?
export function isAdmin(email) {
  return adminList().includes(String(email || '').toLowerCase())
}

// Like requireAuth, but also requires the caller to be an administrator.
// Returns the verified email, or null when the gate is skipped (local dev).
export async function requireAdmin(req) {
  const email = await requireAuth(req)
  if (email === null) return null // local dev — no gate
  if (!isAdmin(email))
    throw fail('The Manage panel is for calendar administrators only', 403)
  return email
}

// ---- Per-cell edit permission ----------------------------------------------
// A user may edit a category's cells only if their email matches that
// category's owner (the Owner record's Email) — or they're an admin.
// Returns { email, unrestricted, canEdit(categoryLabel) }.
export async function editGuard(req) {
  const email = await requireAuth(req)
  if (email === null || isAdmin(email)) {
    return { email, unrestricted: true, canEdit: () => true }
  }
  const { owners, categories } = await getStructure(
    process.env.NOTION_TOKEN,
    process.env.NOTION_OWNERS_DB_ID,
    process.env.NOTION_CATEGORIES_DB_ID
  )
  // Owner names this person may edit: their own, plus anyone they supervise.
  const editableOwners = new Set()
  for (const o of owners) {
    if ((o.email || '').toLowerCase() === email) {
      editableOwners.add(o.name)
      for (const s of o.supervises || []) editableOwners.add(s)
    }
  }
  const ownerByCat = {}
  for (const c of categories) ownerByCat[c.label] = c.owner
  return {
    email,
    unrestricted: false,
    canEdit: (categoryLabel) => editableOwners.has(ownerByCat[categoryLabel]),
  }
}
