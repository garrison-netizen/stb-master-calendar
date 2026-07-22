import React, { useState, useEffect, useRef } from 'react'

// Google sign-in gate.
// Production: VITE_GOOGLE_CLIENT_ID is set, so the app is shown only after a
// successful sign-in with a @spindletap.com Google account.
// Local dev: the var is unset, so the gate is skipped entirely.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const ALLOWED_DOMAIN = 'spindletap.com'
const TOKEN_KEY = 'stb_id_token'

// Decode a JWT payload for display only. The server independently verifies it.
function decodeJwt(token) {
  try {
    const part = token.split('.')[1]
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

function domainOk(claims) {
  if (!claims) return false
  const email = String(claims.email || '').toLowerCase()
  const domain = String(claims.hd || email.split('@')[1] || '').toLowerCase()
  return domain === ALLOWED_DOMAIN
}

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || ''
}

// The email of the currently signed-in Google account (for display).
export function currentEmail() {
  const claims = decodeJwt(getToken())
  return claims && claims.email ? String(claims.email) : ''
}

// Drop the session and let the user pick a different Google account.
export function signOut() {
  sessionStorage.removeItem(TOKEN_KEY)
  try {
    window.google?.accounts?.id?.disableAutoSelect?.()
  } catch {
    /* no-op */
  }
  window.location.reload()
}

// Authorization header for API calls — empty when there is no token (local dev).
export function authHeader() {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// Single sign-on intake: the STB Console passes its verified Google token in
// the URL fragment (#sso=...) when opening this app, so staff aren't asked to
// sign in twice. The token shares this app's OAuth client, so the server-side
// verification path is unchanged; we only seed sessionStorage and strip the
// fragment. Expired/garbage tokens fall through to the normal sign-in.
function adoptSsoToken() {
  const m = /[#&]sso=([^&]+)/.exec(window.location.hash || '')
  if (!m) return
  try {
    const token = decodeURIComponent(m[1])
    const claims = decodeJwt(token)
    if (claims && claims.email && claims.exp * 1000 > Date.now()) {
      sessionStorage.setItem(TOKEN_KEY, token)
    }
  } catch {
    /* fall through to normal sign-in */
  }
  history.replaceState(null, '', window.location.pathname + window.location.search)
}
adoptSsoToken()

export default function AuthGate({ children }) {
  // No client id configured (local dev) — no gate.
  if (!CLIENT_ID) return children
  return <SignInFlow>{children}</SignInFlow>
}

function SignInFlow({ children }) {
  const [state, setState] = useState(() => {
    const token = getToken()
    const claims = token ? decodeJwt(token) : null
    if (claims && claims.exp * 1000 > Date.now() && claims.email) {
      return { status: 'in' }
    }
    sessionStorage.removeItem(TOKEN_KEY)
    return { status: 'out' }
  })
  const btnRef = useRef(null)

  function handleCredential(resp) {
    const token = resp && resp.credential
    const claims = token ? decodeJwt(token) : null
    if (!claims || !claims.email) {
      setState({ status: 'error' })
      return
    }
    // Any verified Google account may proceed; the server authorizes the
    // specific account (Spindletap staff by domain, others via the allowlist).
    sessionStorage.setItem(TOKEN_KEY, token)
    setState({ status: 'in' })
  }

  useEffect(() => {
    if (state.status === 'in') return
    let cancelled = false

    function init() {
      if (cancelled || !window.google?.accounts?.id) return
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: handleCredential,
        // Don't silently reuse the browser's default Google account — that
        // signed people in as the wrong account (a personal Gmail not on the
        // list) with no way to choose. Make the account choice deliberate.
        auto_select: false,
      })
      if (btnRef.current) {
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: 'filled_blue',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
        })
      }
      // One Tap: returning staff with an active Google session sign in with no click.
      window.google.accounts.id.prompt()
    }

    if (window.google?.accounts?.id) {
      init()
    } else {
      const timer = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(timer)
          init()
        }
      }, 120)
      return () => {
        cancelled = true
        clearInterval(timer)
      }
    }
    return () => {
      cancelled = true
    }
  }, [state.status])

  if (state.status === 'in') return children

  return (
    <div className="signin-screen">
      <div className="signin-card">
        <img
          src="/logo-mark.png"
          alt="Spindletap Beverages"
          className="signin-logo"
        />
        <h1>Master Calendar</h1>
        {state.status === 'denied' ? (
          <p className="signin-deny">
            <strong>{state.email}</strong> is not a Spindletap account. Please
            sign in with your @spindletap.com Google account.
          </p>
        ) : state.status === 'error' ? (
          <p className="signin-deny">
            Something went wrong signing in. Please try again.
          </p>
        ) : (
          <p className="signin-msg">
            Sign in with your authorized Google account to open the calendar.
          </p>
        )}
        <div ref={btnRef} className="signin-btn" />
        <p className="signin-foot">Spindletap Beverages · Internal planning tool</p>
      </div>
    </div>
  )
}
