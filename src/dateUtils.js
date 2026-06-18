// Shared date helpers. Local-time only — no UTC drift.

export function mondayOf(date) {
  const d = new Date(date)
  const day = d.getDay() // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function keyOf(d) {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  )
}

export function parseDate(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function fmtLongDate(d) {
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function fmtDay(s) {
  return parseDate(s).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
  })
}

// "May 4–10" within a month, or "Jun 29 – Jul 5" across months.
export function fmtRange(monday) {
  const sun = addDays(monday, 6)
  const m1 = monday.toLocaleDateString('en-US', { month: 'short' })
  const m2 = sun.toLocaleDateString('en-US', { month: 'short' })
  const d1 = monday.getDate()
  const d2 = sun.getDate()
  return m1 === m2 ? `${m1} ${d1}–${d2}` : `${m1} ${d1} – ${m2} ${d2}`
}

// "18:00" -> "6:00 PM"
export function fmtTime(hhmm) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// A start time, plus an optional end: "6:00 PM – 9:00 PM" or just "6:00 PM".
export function fmtTimeRange(start, end) {
  if (!start) return ''
  return end ? `${fmtTime(start)} – ${fmtTime(end)}` : fmtTime(start)
}

// Pull "HH:MM" out of a Notion date value that may carry a time.
// "2026-05-25" -> "" ; "2026-05-25T18:00:00.000-05:00" -> "18:00"
export function timeOf(iso) {
  const s = String(iso || '')
  return s.length > 10 ? s.slice(11, 16) : ''
}
