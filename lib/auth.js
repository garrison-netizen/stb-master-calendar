// Google sign-in verification for the API functions.
// Confirms the caller signed in with a verified @spindletap.com Google account.
//
// Behaviour:
//  - If VITE_GOOGLE_CLIENT_ID is set (production on Vercel), every API call must
//    carry a valid Google ID token for a @spindletap.com account.
//  - If it is not set (local `npm run dev`), the gate is skipped — but never on
//    Vercel, where a missing client id fails closed.

const ALLOWED_DOMAIN = 'spindletap.com'

function fail(message, status) {
  return Object.assign(new Error(message), { status })
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
  const domain = String(info.hd || email.split('@')[1] || '').toLowerCase()
  if (domain !== ALLOWED_DOMAIN)
    throw fail('This calendar is for Spindletap Beverages staff only', 403)

  return email
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
