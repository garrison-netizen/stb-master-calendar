import React, { useMemo, useEffect, useState } from 'react'
import Grid from './Grid.jsx'
import CellEditor from './CellEditor.jsx'
import FilterBar from './FilterBar.jsx'
import ManagePanel from './ManagePanel.jsx'
import { resolveCategoryId } from './calendarConfig.js'
import { mondayOf, keyOf, parseDate, addDays } from './dateUtils.js'
import { authHeader } from './Auth.jsx'

export default function App() {
  const todayMonday = useMemo(() => mondayOf(new Date()), [])
  const todayKey = useMemo(() => keyOf(todayMonday), [todayMonday])

  // Read-only "team" view: open the app with ?view=team. No editing, no gap flags.
  // Owners use the plain URL; general staff get the ?view=team link.
  const readOnly = useMemo(
    () => new URLSearchParams(window.location.search).get('view') === 'team',
    []
  )

  // The current week + the next two — blank cells here get a "needs filling" flag.
  const attentionWeeks = useMemo(() => {
    const s = new Set()
    const m = mondayOf(new Date())
    for (let i = 0; i < 3; i++) {
      const d = new Date(m)
      d.setDate(m.getDate() + i * 7)
      s.add(keyOf(d))
    }
    return s
  }, [])

  // Default window: two weeks back through about thirty weeks ahead.
  const defaultFrom = useMemo(
    () => keyOf(addDays(todayMonday, -14)),
    [todayMonday]
  )
  const defaultTo = useMemo(
    () => keyOf(addDays(todayMonday, 7 * 30)),
    [todayMonday]
  )

  const [conn, setConn] = useState({ state: 'loading' })
  const [allEntries, setAllEntries] = useState([])
  const [owners, setOwners] = useState([])
  const [categories, setCategories] = useState([])
  const [allOwners, setAllOwners] = useState([])
  const [allCategories, setAllCategories] = useState([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [managing, setManaging] = useState(false)
  const [editing, setEditing] = useState(null) // { category, week }
  const [ownerFilter, setOwnerFilter] = useState(null)
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)

  function load() {
    setConn({ state: 'loading' })
    Promise.all([
      fetch('/api/structure', { headers: authHeader() }).then((r) => r.json()),
      fetch('/api/entries', { headers: authHeader() }).then((r) => r.json()),
    ])
      .then(([s, e]) => {
        if (!s.ok) return setConn({ state: 'error', msg: s.error })
        if (!e.ok) return setConn({ state: 'error', msg: e.error })
        const ownerByName = {}
        for (const o of s.owners) ownerByName[o.name] = o
        const noOwner = { id: '_none', name: '', initials: '?', color: '#888', email: '' }
        const cats = s.categories
          .filter((c) => c.active)
          .map((c) => ({ ...c, owner: ownerByName[c.owner] || noOwner }))
        setOwners(s.owners.filter((o) => o.active))
        setCategories(cats)
        setAllOwners(s.owners)
        setAllCategories(s.categories)
        setIsAdmin(!!s.isAdmin)
        setAllEntries(e.entries.filter((x) => x.date))
        setConn({ state: 'live', count: e.entries.length })
      })
      .catch((err) => setConn({ state: 'error', msg: String(err) }))
  }
  useEffect(() => {
    load()
  }, [])

  // Group entries into cells: { "categoryId|weekMondayKey": [entry, ...] }
  const byCell = useMemo(() => {
    const map = {}
    for (const e of allEntries) {
      const catId = resolveCategoryId(e.category, categories)
      if (!catId || !e.date) continue
      const wk = keyOf(mondayOf(parseDate(e.date)))
      const k = `${catId}|${wk}`
      ;(map[k] || (map[k] = [])).push(e)
    }
    for (const k in map) {
      map[k].sort((a, b) => String(a.date).localeCompare(String(b.date)))
    }
    return map
  }, [allEntries, categories])

  // Week columns are generated straight from the date filter, so the filter
  // sets the real range. Capped so an extreme range can't make a runaway table.
  const weeks = useMemo(() => {
    const last = mondayOf(parseDate(to))
    const list = []
    let d = mondayOf(parseDate(from))
    for (let i = 0; i < 130 && d <= last; i++) {
      list.push({ key: keyOf(d), date: d })
      d = addDays(d, 7)
    }
    return list
  }, [from, to])

  const isDefault = !ownerFilter && from === defaultFrom && to === defaultTo

  function resetFilters() {
    setOwnerFilter(null)
    setFrom(defaultFrom)
    setTo(defaultTo)
  }

  function openCell(category, week) {
    if (readOnly) return
    setEditing({ category, week })
  }

  async function apiSave(payload) {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    }).then((r) => r.json())
    if (!res.ok) {
      alert('Could not save: ' + res.error)
      return null
    }
    return res.entry
  }

  async function apiClear(id) {
    await fetch('/api/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ id }),
    })
  }

  async function addEntry({ date, startTime, endTime, headline, details }) {
    const { category, week } = editing
    const cellKey = `${category.id}|${week.key}`
    const marker = (byCell[cellKey] || []).find((e) => e.nothingThisWeek)
    const entry = await apiSave({
      category: category.label,
      owner: category.owner.name,
      date,
      startTime,
      endTime,
      headline,
      details,
      nothingThisWeek: false,
    })
    if (!entry) return
    setAllEntries((a) => {
      let next = [...a, entry]
      if (marker) next = next.filter((e) => e.id !== marker.id)
      return next
    })
    if (marker) apiClear(marker.id)
  }

  async function updateEntry(id, { date, startTime, endTime, headline, details }) {
    const { category } = editing
    const entry = await apiSave({
      id,
      category: category.label,
      owner: category.owner.name,
      date,
      startTime,
      endTime,
      headline,
      details,
      nothingThisWeek: false,
    })
    if (!entry) return
    setAllEntries((a) => a.map((e) => (e.id === id ? entry : e)))
  }

  async function deleteEntry(id) {
    await apiClear(id)
    setAllEntries((a) => a.filter((e) => e.id !== id))
  }

  async function markNothing() {
    const { category, week } = editing
    const entry = await apiSave({
      category: category.label,
      owner: category.owner.name,
      date: week.key,
      headline: '',
      details: '',
      nothingThisWeek: true,
    })
    if (!entry) return
    setAllEntries((a) => [...a, entry])
  }

  const editingEntries = editing
    ? byCell[`${editing.category.id}|${editing.week.key}`] || []
    : []

  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <h1>Master Calendar</h1>
        <ConnDot conn={conn} />
        {readOnly && <span className="view-tag">Team view</span>}
        <span className="tag">
          {readOnly
            ? 'Read-only · the week at a glance'
            : 'Interdepartmental planning · the week at a glance'}
        </span>
        {isAdmin && !readOnly && (
          <button className="manage-btn" onClick={() => setManaging(true)}>
            Manage
          </button>
        )}
      </header>
      <FilterBar
        owners={owners}
        ownerFilter={ownerFilter}
        setOwnerFilter={setOwnerFilter}
        from={from}
        to={to}
        setFrom={setFrom}
        setTo={setTo}
        onReset={resetFilters}
        isDefault={isDefault}
      />
      {conn.state === 'error' ? (
        <div className="grid-state">
          <div className="gs-card gs-error">
            <div className="gs-title">Can't load the calendar</div>
            <p className="gs-msg">
              The calendar data service isn't responding right now. Try again in
              a minute. If it keeps happening, let Garrison know.
            </p>
            <button className="btn btn-save" onClick={load}>
              Try again
            </button>
          </div>
        </div>
      ) : conn.state === 'loading' ? (
        <div className="grid-state">
          <div className="gs-card">
            <div className="gs-spinner" />
            <div className="gs-msg">Loading the calendar…</div>
          </div>
        </div>
      ) : (
        <Grid
          weeks={weeks}
          todayKey={todayKey}
          attentionWeeks={attentionWeeks}
          byCell={byCell}
          categories={categories}
          ownerFilter={ownerFilter}
          onCellClick={openCell}
          readOnly={readOnly}
        />
      )}
      {editing && (
        <CellEditor
          category={editing.category}
          week={editing.week}
          entries={editingEntries}
          onAdd={addEntry}
          onUpdate={updateEntry}
          onDelete={deleteEntry}
          onMarkNothing={markNothing}
          onClose={() => setEditing(null)}
        />
      )}
      {managing && (
        <ManagePanel
          owners={allOwners}
          categories={allCategories}
          onClose={() => {
            setManaging(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function Brand() {
  const [ok, setOk] = useState(true)
  if (!ok) return <span className="brand">SPINDLETAP</span>
  return (
    <img
      src="/logo-mark.png"
      alt="Spindletap Beverages"
      className="brand-logo"
      onError={() => setOk(false)}
    />
  )
}

function ConnDot({ conn }) {
  if (conn.state === 'loading') {
    return <span className="conn conn-loading">● connecting…</span>
  }
  if (conn.state === 'error') {
    return (
      <span className="conn conn-error" title={conn.msg}>
        ● connection error
      </span>
    )
  }
  return (
    <span className="conn conn-live">
      ● live · {conn.count} {conn.count === 1 ? 'entry' : 'entries'}
    </span>
  )
}
