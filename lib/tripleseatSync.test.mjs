// Exercises the Triple Seat -> calendar projection against a mocked Notion.
// Covers every branch that can touch a real row: create, update, unchanged,
// human-adopted (must be left alone), and cancelled (must be archived).

import assert from 'node:assert/strict'
import {
  categoryForBooking,
  detailsForBooking,
  entryPropertiesForBooking,
  syncTripleSeat,
} from './tripleseatSync.js'

// ---- 1. Facility routing, on REAL booking titles from the Brain -------------
const realTitles = [
  ['SpindleBarn Reservation - Pastor Phillips', 'SpindleBarn Rental'],
  ['Full Venue - JTL Company Picnic', 'Full Facility Rental'],
  ['Full Venue Rental - DPC Houston Family Day 2026', 'Full Facility Rental'],
  ['Indoor Production Room - Wedding reception', 'Production Room Rental'],
  ['Corporate Event. A Hands on Lab.', 'Private Events'],
  ['Oddities Market', 'Private Events'],
  ['Celebrate my 60th birthday.', 'Private Events'],
  ['Bates AC & Service Holiday Party', 'Private Events'],
]
for (const [title, want] of realTitles) {
  assert.equal(categoryForBooking(title), want, `category for ${title}`)
}
assert.equal(categoryForBooking(''), 'Private Events', 'empty title falls back')
assert.equal(categoryForBooking(null), 'Private Events', 'null title falls back')
console.log('PASS  facility routing (8 real titles + 2 degenerate)')

// ---- 2. Details line — must not leak revenue -------------------------------
const d = detailsForBooking({ rep: 'Taylor Beasley', headcount: 80, status: 'Confirmed' })
assert.equal(d, 'Taylor Beasley'.length ? 'Rep: Taylor Beasley · 80 guests · via Triple Seat' : '')
assert.ok(!/\$|\d{4,}/.test(d), 'details must not contain revenue')
assert.equal(detailsForBooking({}), 'via Triple Seat')
console.log('PASS  details line')

// ---- 3. Property payload ---------------------------------------------------
const props = entryPropertiesForBooking({
  sourceId: '123', title: 'Full Venue - Acme', eventDate: '2026-09-01',
  status: 'Confirmed', rep: 'Marin', headcount: 40,
})
assert.equal(props.Origin.select.name, 'TripleSeat')
assert.equal(props.Owner.select.name, 'Taylor Beasley')
assert.equal(props.Business.select.name, 'Brewery')
assert.equal(props.Category.select.name, 'Full Facility Rental')
assert.equal(props.Date.date.start, '2026-09-01')
assert.equal(props['Source ID'].rich_text[0].text.content, '123')
assert.equal(props['Nothing this week'].checkbox, false)
console.log('PASS  property payload')

// ---- 4. Full projection against a mocked Notion ----------------------------
const rt = (s) => [{ plain_text: s, text: { content: s } }]

const bookings = [
  // new -> create
  { id: 'bk-new', properties: {
      'Booking ID (Triple Seat)': { rich_text: rt('1001') },
      'Booking title': { title: rt('SpindleBarn Reservation - Ruiz') },
      'Event date': { date: { start: '2026-09-06' } },
      Status: { select: { name: 'Confirmed' } },
      'Assigned rep': { select: { name: 'Taylor Beasley' } },
      'Final headcount': { number: 30 } } },
  // exists, date moved -> update
  { id: 'bk-moved', properties: {
      'Booking ID (Triple Seat)': { rich_text: rt('1002') },
      'Booking title': { title: rt('Company Event') },
      'Event date': { date: { start: '2026-11-22' } },
      Status: { select: { name: 'Confirmed' } },
      'Assigned rep': { select: { name: 'Marin' } },
      'Final headcount': { number: null } } },
  // exists, identical -> unchanged
  { id: 'bk-same', properties: {
      'Booking ID (Triple Seat)': { rich_text: rt('1003') },
      'Booking title': { title: rt('Oddities Market') },
      'Event date': { date: { start: '2026-10-11' } },
      Status: { select: { name: 'Confirmed' } },
      'Assigned rep': { select: { name: 'Other' } },
      'Final headcount': { number: null } } },
  // exists but a human adopted it -> must NOT be touched
  { id: 'bk-adopted', properties: {
      'Booking ID (Triple Seat)': { rich_text: rt('1004') },
      'Booking title': { title: rt('J\'s House') },
      'Event date': { date: { start: '2026-10-24' } },
      Status: { select: { name: 'Confirmed' } },
      'Assigned rep': { select: { name: 'Taylor Beasley' } },
      'Final headcount': { number: null } } },
  // cancelled -> filtered out; its existing row must be archived
  { id: 'bk-cancelled', properties: {
      'Booking ID (Triple Seat)': { rich_text: rt('1005') },
      'Booking title': { title: rt('Cancelled Thing') },
      'Event date': { date: { start: '2026-12-01' } },
      Status: { select: { name: 'Cancelled' } },
      'Assigned rep': { select: { name: 'Marin' } },
      'Final headcount': { number: null } } },
  // no event date -> skipped, counted
  { id: 'bk-nodate', properties: {
      'Booking ID (Triple Seat)': { rich_text: rt('1006') },
      'Booking title': { title: rt('Undated') },
      'Event date': { date: null },
      Status: { select: { name: 'Confirmed' } } } },
  // predates the calendar -> skipped, counted (history lives in the Brain)
  { id: 'bk-old', properties: {
      'Booking ID (Triple Seat)': { rich_text: rt('1007') },
      'Booking title': { title: rt('Full Venue - 2024 holiday party') },
      'Event date': { date: { start: '2024-12-14' } },
      Status: { select: { name: 'Completed' } } } },
  // the day the calendar starts is INSIDE the window, not outside it
  { id: 'bk-edge', properties: {
      'Booking ID (Triple Seat)': { rich_text: rt('1008') },
      'Booking title': { title: rt('Beer Garden - edge case') },
      'Event date': { date: { start: '2026-05-17' } },
      Status: { select: { name: 'Completed' } } } },
]

const sameProps = entryPropertiesForBooking({
  sourceId: '1003', title: 'Oddities Market', eventDate: '2026-10-11',
  status: 'Confirmed', rep: 'Other', headcount: null,
})

const entries = [
  { id: 'pg-moved', properties: {
      ...entryPropertiesForBooking({ sourceId: '1002', title: 'Company Event',
        eventDate: '2026-11-21', status: 'Confirmed', rep: 'Marin', headcount: null }) } },
  { id: 'pg-same', properties: { ...sameProps } },
  { id: 'pg-adopted', properties: {
      ...entryPropertiesForBooking({ sourceId: '1004', title: "J's House",
        eventDate: '2026-10-24', status: 'Confirmed', rep: 'Taylor Beasley', headcount: null }),
      Origin: { select: { name: 'Manual' } } } },
  { id: 'pg-cancelled', properties: {
      ...entryPropertiesForBooking({ sourceId: '1005', title: 'Cancelled Thing',
        eventDate: '2026-12-01', status: 'Confirmed', rep: 'Marin', headcount: null }) } },
  // a hand-authored row with no Source ID — must be invisible to the projector
  { id: 'pg-human', properties: {
      Headline: { title: rt('Taproom trivia') },
      Origin: { select: { name: 'Manual' } } } },
]

const writes = []
globalThis.fetch = async (url, options) => {
  const body = options?.body ? JSON.parse(options.body) : {}
  if (url.includes('/databases/BOOKINGS/query'))
    return { ok: true, status: 200, json: async () => ({ results: bookings, has_more: false }) }
  if (url.includes('/databases/ENTRIES/query'))
    return { ok: true, status: 200, json: async () => ({ results: entries, has_more: false }) }
  if (url.endsWith('/pages') && options.method === 'POST') {
    writes.push({ op: 'create', sourceId: body.properties['Source ID'].rich_text[0].text.content })
    return { ok: true, status: 200, json: async () => ({ id: 'new' }) }
  }
  if (url.includes('/pages/') && options.method === 'PATCH') {
    const id = url.split('/pages/')[1]
    writes.push({ op: body.archived ? 'archive' : 'update', id })
    return { ok: true, status: 200, json: async () => ({ id }) }
  }
  throw new Error('unexpected fetch ' + url)
}

const env = { token: 'T', entriesDbId: 'ENTRIES', bookingsDbId: 'BOOKINGS' }

// --- dry run must write nothing but report the same plan ---
const dry = await syncTripleSeat(env, { dryRun: true })
assert.equal(writes.length, 0, 'dry run must not write')
assert.equal(dry.created, 2, 'the new booking + the boundary-date one')
assert.equal(dry.updated, 1)
assert.equal(dry.unchanged, 1)
assert.equal(dry.adopted, 1)
assert.equal(dry.removed, 1)
assert.equal(dry.skipped.notLive, 1)
assert.equal(dry.skipped.noDate, 1)
assert.equal(dry.skipped.beforeCalendar, 1, 'pre-calendar history is not projected')
console.log('PASS  dry run: plans correctly, writes nothing')
console.log('PASS  history cutoff: 2024 booking skipped, 2026-05-17 boundary included')

// --- live run ---
const live = await syncTripleSeat(env, {})
assert.deepEqual(
  { c: live.created, u: live.updated, n: live.unchanged, a: live.adopted, r: live.removed },
  { c: 2, u: 1, n: 1, a: 1, r: 1 }
)
assert.equal(live.errors.length, 0, 'no errors')

const created = writes.filter((w) => w.op === 'create')
const updated = writes.filter((w) => w.op === 'update')
const archived = writes.filter((w) => w.op === 'archive')
assert.deepEqual(created.map((w) => w.sourceId), ['1001', '1008'])
assert.ok(!created.some((w) => w.sourceId === '1007'), 'pre-calendar booking must never be created')
assert.deepEqual(updated.map((w) => w.id), ['pg-moved'])
assert.deepEqual(archived.map((w) => w.id), ['pg-cancelled'])
assert.ok(!writes.some((w) => w.id === 'pg-adopted'), 'adopted row must never be written')
assert.ok(!writes.some((w) => w.id === 'pg-human'), 'hand-authored row must never be touched')
assert.ok(!writes.some((w) => w.id === 'pg-same'), 'unchanged row must not be rewritten')
console.log('PASS  live run: 1 created, 1 updated, 1 archived; adopted + manual rows untouched')

console.log('\nCategory split:', JSON.stringify(live.categoryCounts))
console.log('\nALL TESTS PASSED')
