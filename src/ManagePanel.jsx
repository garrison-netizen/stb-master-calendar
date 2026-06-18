import React, { useState, useMemo } from 'react'
import { SECTIONS } from './calendarConfig.js'
import { authHeader } from './Auth.jsx'

// Admin-only panel for editing the calendar's structure: the owners and the
// categories. Every change is written straight to Notion and is live for the
// whole team. A rename cascades server-side so existing entries stay attached.

const byOrder = (a, b) => a.order - b.order
const SECTION_SWATCHES = SECTIONS.map((s) => s.color)
const KNOWN_SECTIONS = new Set(SECTIONS.map((s) => s.id))

// Lay out every category with a clean global Order: sections in fixed order,
// categories within a section sorted by `cmp`. Keeps section blocks contiguous.
function renumberAll(cats, cmp) {
  const out = []
  let n = 0
  for (const sec of SECTIONS) {
    const inSec = cats.filter((c) => c.section === sec.id).sort(cmp)
    for (const c of inSec) out.push({ ...c, order: n++ })
  }
  for (const c of cats.filter((c) => !KNOWN_SECTIONS.has(c.section)).sort(byOrder)) {
    out.push({ ...c, order: n++ })
  }
  return out
}

function okMessage(base, cascaded) {
  if (!cascaded) return base
  const bits = []
  if (cascaded.categories)
    bits.push(
      `${cascaded.categories} categor${cascaded.categories === 1 ? 'y' : 'ies'}`
    )
  if (cascaded.entries)
    bits.push(`${cascaded.entries} entr${cascaded.entries === 1 ? 'y' : 'ies'}`)
  return bits.length ? `${base}. Also updated ${bits.join(' and ')}.` : base + '.'
}

export default function ManagePanel({ owners, categories, onClose }) {
  const [ownerList, setOwnerList] = useState(() => owners.map((o) => ({ ...o })))
  const [catList, setCatList] = useState(() => categories.map((c) => ({ ...c })))
  const [editor, setEditor] = useState(null) // { kind, draft }
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null) // { type: 'ok' | 'err', msg }

  const ownerByName = useMemo(() => {
    const m = {}
    for (const o of ownerList) m[o.name] = o
    return m
  }, [ownerList])

  const sortedOwners = useMemo(() => [...ownerList].sort(byOrder), [ownerList])
  const orphanCats = useMemo(
    () => catList.filter((c) => !KNOWN_SECTIONS.has(c.section)).sort(byOrder),
    [catList]
  )

  const editorOtherNames = useMemo(() => {
    if (!editor) return new Set()
    if (editor.kind === 'owner') {
      return new Set(
        ownerList
          .filter((o) => o.id !== editor.draft.id)
          .map((o) => o.name.toLowerCase())
      )
    }
    return new Set(
      catList
        .filter((c) => c.id !== editor.draft.id)
        .map((c) => c.label.toLowerCase())
    )
  }, [editor, ownerList, catList])

  async function callManage(op, payload) {
    try {
      return await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ op, ...payload }),
      }).then((r) => r.json())
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  // ---- Reordering ----------------------------------------------------------

  async function commitOrders(kind, renum, list, setList) {
    const changed = []
    for (const row of renum) {
      const cur = list.find((x) => x.id === row.id)
      if (!cur || cur.order !== row.order)
        changed.push({ id: row.id, order: row.order })
    }
    setList(renum)
    if (!changed.length) return
    setBusy(true)
    setNote(null)
    const res = await callManage('reorder', { items: changed })
    setBusy(false)
    if (!res.ok) setNote({ type: 'err', msg: res.error || 'Could not reorder' })
  }

  function moveOwner(id, dir) {
    const sorted = [...ownerList].sort(byOrder)
    const i = sorted.findIndex((o) => o.id === id)
    if (i < 0 || i + dir < 0 || i + dir >= sorted.length) return
    const neighbour = sorted[i + dir]
    const bumped = ownerList.map((o) =>
      o.id === id ? { ...o, order: neighbour.order + dir * 0.5 } : o
    )
    const renum = [...bumped]
      .sort(byOrder)
      .map((o, idx) => ({ ...o, order: idx }))
    commitOrders('owner', renum, ownerList, setOwnerList)
  }

  function moveCategory(id, dir) {
    const cat = catList.find((c) => c.id === id)
    if (!cat) return
    const sameSection = catList
      .filter((c) => c.section === cat.section)
      .sort(byOrder)
    const i = sameSection.findIndex((c) => c.id === id)
    if (i < 0 || i + dir < 0 || i + dir >= sameSection.length) return
    const neighbour = sameSection[i + dir]
    const bumped = catList.map((c) =>
      c.id === id ? { ...c, order: neighbour.order + dir * 0.5 } : c
    )
    commitOrders('category', renumberAll(bumped, byOrder), catList, setCatList)
  }

  function groupByOwner() {
    if (
      !window.confirm(
        'Reorder every section so each owner’s rows sit together? ' +
          'You can still fine-tune the order afterwards.'
      )
    )
      return
    const orderOf = {}
    ownerList.forEach((o) => {
      orderOf[o.name] = o.order
    })
    const cmp = (a, b) => {
      const oa = a.owner in orderOf ? orderOf[a.owner] : 9999
      const ob = b.owner in orderOf ? orderOf[b.owner] : 9999
      return oa - ob || a.order - b.order
    }
    commitOrders('category', renumberAll(catList, cmp), catList, setCatList)
  }

  // ---- Hide / show ---------------------------------------------------------

  async function toggleActive(kind, row) {
    setBusy(true)
    setNote(null)
    const op = kind === 'owner' ? 'owner.save' : 'category.save'
    const res = await callManage(op, { data: { id: row.id, active: !row.active } })
    setBusy(false)
    if (!res.ok) {
      setNote({ type: 'err', msg: res.error || 'Could not save' })
      return
    }
    if (kind === 'owner') {
      setOwnerList((l) => l.map((o) => (o.id === row.id ? res.owner : o)))
    } else {
      setCatList((l) => l.map((c) => (c.id === row.id ? res.category : c)))
    }
  }

  // ---- Editor save ---------------------------------------------------------

  async function onEditorSave(kind, data) {
    setBusy(true)
    setNote(null)
    const op = kind === 'owner' ? 'owner.save' : 'category.save'
    const res = await callManage(op, { data })
    if (!res.ok) {
      setBusy(false)
      return { ok: false, error: res.error || 'Save failed' }
    }

    if (kind === 'owner') {
      const prev = data.id ? ownerList.find((o) => o.id === data.id) : null
      setOwnerList((l) => {
        const i = l.findIndex((o) => o.id === res.owner.id)
        return i >= 0
          ? l.map((o, j) => (j === i ? res.owner : o))
          : [...l, res.owner]
      })
      // A rename cascades to categories server-side — mirror it locally.
      if (prev && prev.name !== res.owner.name) {
        setCatList((l) =>
          l.map((c) =>
            c.owner === prev.name ? { ...c, owner: res.owner.name } : c
          )
        )
      }
    } else {
      const isNew = !data.id
      const i = catList.findIndex((c) => c.id === res.category.id)
      const nextList =
        i >= 0
          ? catList.map((c, j) => (j === i ? res.category : c))
          : [...catList, res.category]
      if (isNew) {
        // Slot the new category at the foot of its section, orders kept tidy.
        await commitOrders(
          'category',
          renumberAll(nextList, byOrder),
          catList,
          setCatList
        )
      } else {
        setCatList(nextList)
      }
    }

    setBusy(false)
    setEditor(null)
    setNote({
      type: 'ok',
      msg: okMessage(kind === 'owner' ? 'Owner saved' : 'Category saved', res.cascaded),
    })
    return { ok: true }
  }

  // ---- Open the editor -----------------------------------------------------

  function addOwner() {
    const maxOrder = ownerList.reduce((m, o) => Math.max(m, o.order), -1)
    setEditor({
      kind: 'owner',
      draft: {
        name: '',
        initials: '',
        color: '#3f9b5c',
        email: '',
        order: maxOrder + 1,
      },
    })
  }

  function addCategory(sectionId) {
    const maxOrder = catList.reduce((m, c) => Math.max(m, c.order), -1)
    setEditor({
      kind: 'category',
      draft: {
        label: '',
        section: sectionId,
        owner: '',
        sublabel: '',
        order: maxOrder + 1,
      },
    })
  }

  function renderCategoryRow(c, idx, count) {
    const ow = ownerByName[c.owner]
    return (
      <div key={c.id} className={'mrow' + (c.active ? '' : ' mrow-off')}>
        <span className="mrow-grip">
          <button
            className="mbtn-icon"
            disabled={busy || idx === 0 || count == null}
            onClick={() => moveCategory(c.id, -1)}
            title="Move up"
          >
            ↑
          </button>
          <button
            className="mbtn-icon"
            disabled={busy || count == null || idx === count - 1}
            onClick={() => moveCategory(c.id, 1)}
            title="Move down"
          >
            ↓
          </button>
        </span>
        <span
          className="owner-chip"
          style={{ background: ow?.color || '#888' }}
          title={ow?.name || 'No owner'}
        >
          {ow?.initials || '?'}
        </span>
        <span className="mrow-main">
          <span className="mrow-name">
            {c.label}
            {!c.active && <em className="mrow-tag">hidden</em>}
          </span>
          {c.sublabel && <span className="mrow-meta">{c.sublabel}</span>}
        </span>
        <span className="mrow-actions">
          <button className="mbtn" disabled={busy} onClick={() => setEditor({ kind: 'category', draft: { ...c } })}>
            Edit
          </button>
          <button className="mbtn" disabled={busy} onClick={() => toggleActive('category', c)}>
            {c.active ? 'Hide' : 'Show'}
          </button>
        </span>
      </div>
    )
  }

  return (
    <div className="manage-overlay">
      <div className="manage-panel">
        <div className="manage-head">
          <div>
            <div className="manage-title">Manage calendar structure</div>
            <div className="manage-sub">
              Owners and categories. Every change is live for the whole team.
            </div>
          </div>
          <button className="btn btn-cancel" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>

        {note && (
          <div className={'manage-note manage-note-' + note.type}>{note.msg}</div>
        )}

        <div className="manage-body">
          {/* ---- Owners ---- */}
          <div className="manage-block">
            <div className="manage-block-head">
              <span className="manage-block-title">
                Owners <em>{sortedOwners.length}</em>
              </span>
              <button className="mbtn mbtn-add" onClick={addOwner} disabled={busy}>
                + Add owner
              </button>
            </div>
            {sortedOwners.map((o, idx) => (
              <div key={o.id} className={'mrow' + (o.active ? '' : ' mrow-off')}>
                <span className="mrow-grip">
                  <button
                    className="mbtn-icon"
                    disabled={busy || idx === 0}
                    onClick={() => moveOwner(o.id, -1)}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className="mbtn-icon"
                    disabled={busy || idx === sortedOwners.length - 1}
                    onClick={() => moveOwner(o.id, 1)}
                    title="Move down"
                  >
                    ↓
                  </button>
                </span>
                <span
                  className="owner-chip"
                  style={{ background: o.color || '#888' }}
                >
                  {o.initials}
                </span>
                <span className="mrow-main">
                  <span className="mrow-name">
                    {o.name}
                    {!o.active && <em className="mrow-tag">removed</em>}
                  </span>
                  <span className="mrow-meta">
                    {o.email || 'no email — view-only on the calendar'}
                  </span>
                </span>
                <span className="mrow-actions">
                  <button
                    className="mbtn"
                    disabled={busy}
                    onClick={() => setEditor({ kind: 'owner', draft: { ...o } })}
                  >
                    Edit
                  </button>
                  <button
                    className="mbtn"
                    disabled={busy}
                    onClick={() => toggleActive('owner', o)}
                  >
                    {o.active ? 'Remove' : 'Restore'}
                  </button>
                </span>
              </div>
            ))}
          </div>

          {/* ---- Categories ---- */}
          <div className="manage-block">
            <div className="manage-block-head">
              <span className="manage-block-title">
                Categories <em>{catList.length}</em>
              </span>
              <button className="mbtn" onClick={groupByOwner} disabled={busy}>
                Group rows by owner
              </button>
            </div>
            {SECTIONS.map((sec) => {
              const rows = catList
                .filter((c) => c.section === sec.id)
                .sort(byOrder)
              return (
                <div key={sec.id} className="msec">
                  <div className="msec-head" style={{ background: sec.color }}>
                    <span>{sec.label}</span>
                    <button
                      className="mbtn mbtn-ghost"
                      onClick={() => addCategory(sec.id)}
                      disabled={busy}
                    >
                      + Add category
                    </button>
                  </div>
                  {rows.length === 0 && (
                    <div className="msec-empty">
                      No categories in this section yet.
                    </div>
                  )}
                  {rows.map((c, idx) => renderCategoryRow(c, idx, rows.length))}
                </div>
              )
            })}
            {orphanCats.length > 0 && (
              <div className="msec">
                <div className="msec-head" style={{ background: '#7d8aa0' }}>
                  <span>UNASSIGNED SECTION</span>
                </div>
                {orphanCats.map((c) => renderCategoryRow(c, 0, null))}
              </div>
            )}
          </div>
        </div>
      </div>

      {editor && (
        <RowEditor
          kind={editor.kind}
          draft={editor.draft}
          owners={sortedOwners}
          otherNames={editorOtherNames}
          busy={busy}
          onCancel={() => setEditor(null)}
          onSave={(data) => onEditorSave(editor.kind, data)}
        />
      )}
    </div>
  )
}

// ---- Add / edit form for one owner or one category -------------------------

function RowEditor({ kind, draft, owners, otherNames, busy, onCancel, onSave }) {
  const [d, setD] = useState(draft)
  const [err, setErr] = useState('')
  const isNew = !draft.id
  const set = (k, v) => {
    setD((x) => ({ ...x, [k]: v }))
    setErr('')
  }

  const ownerNames = new Set(owners.map((o) => o.name))

  async function submit() {
    let data
    if (kind === 'owner') {
      const name = (d.name || '').trim()
      const initials = (d.initials || '').trim()
      if (!name) return setErr('A full name is required.')
      if (!initials)
        return setErr('Initials are required — they show on the calendar.')
      if (otherNames.has(name.toLowerCase()))
        return setErr('Another owner already has that name.')
      if (
        !isNew &&
        name !== draft.name &&
        !window.confirm(
          'Renaming this owner updates every category and calendar entry ' +
            'that uses the old name. Continue?'
        )
      )
        return
      data = {
        id: d.id || undefined,
        name,
        initials,
        color: d.color || '#888888',
        email: (d.email || '').trim(),
        ...(isNew ? { order: d.order, active: true } : {}),
      }
    } else {
      const label = (d.label || '').trim()
      if (!label) return setErr('A category name is required.')
      if (!d.section) return setErr('Pick a section.')
      if (otherNames.has(label.toLowerCase()))
        return setErr('Another category already has that name.')
      if (
        !isNew &&
        label !== draft.label &&
        !window.confirm(
          'Renaming this category updates every calendar entry filed ' +
            'under the old name. Continue?'
        )
      )
        return
      data = {
        id: d.id || undefined,
        label,
        section: d.section,
        owner: d.owner || '',
        sublabel: (d.sublabel || '').trim(),
        ...(isNew ? { order: d.order, active: true } : {}),
      }
    }
    const result = await onSave(data)
    if (result && !result.ok) setErr(result.error)
  }

  return (
    <div className="row-editor-overlay" onClick={onCancel}>
      <div className="modal row-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-cat">
            {isNew
              ? kind === 'owner'
                ? 'Add owner'
                : 'Add category'
              : kind === 'owner'
                ? 'Edit owner'
                : 'Edit category'}
          </div>
        </div>

        <div className="row-editor-body">
          {kind === 'owner' ? (
            <>
              <label className="fld">
                <span>Full name</span>
                <input
                  value={d.name || ''}
                  autoFocus
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Marin Slanina"
                />
              </label>
              <label className="fld">
                <span>
                  Initials <em>(shown on the calendar)</em>
                </span>
                <input
                  value={d.initials || ''}
                  maxLength={4}
                  onChange={(e) => set('initials', e.target.value.toUpperCase())}
                  placeholder="e.g. MS"
                />
              </label>
              <label className="fld">
                <span>Colour</span>
                <div className="color-row">
                  <input
                    type="color"
                    value={d.color || '#888888'}
                    onChange={(e) => set('color', e.target.value)}
                  />
                  {SECTION_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="swatch"
                      style={{ background: c }}
                      title={c}
                      onClick={() => set('color', c)}
                    />
                  ))}
                </div>
              </label>
              <label className="fld">
                <span>
                  Email <em>(optional — an email gives this owner edit access)</em>
                </span>
                <input
                  type="email"
                  value={d.email || ''}
                  onChange={(e) => set('email', e.target.value)}
                  placeholder="name@spindletap.com"
                />
              </label>
            </>
          ) : (
            <>
              <label className="fld">
                <span>Category name</span>
                <input
                  value={d.label || ''}
                  autoFocus
                  onChange={(e) => set('label', e.target.value)}
                  placeholder="e.g. Draft Release"
                />
              </label>
              <label className="fld">
                <span>Section</span>
                <select
                  value={d.section || ''}
                  onChange={(e) => set('section', e.target.value)}
                >
                  <option value="">— pick a section —</option>
                  {SECTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fld">
                <span>Owner</span>
                <select
                  value={d.owner || ''}
                  onChange={(e) => set('owner', e.target.value)}
                >
                  <option value="">— no owner —</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.name}>
                      {o.name}
                      {o.active ? '' : ' (removed)'}
                    </option>
                  ))}
                  {d.owner && !ownerNames.has(d.owner) && (
                    <option value={d.owner}>{d.owner} (unknown)</option>
                  )}
                </select>
              </label>
              <label className="fld">
                <span>
                  Sub-label <em>(optional helper text under the name)</em>
                </span>
                <input
                  value={d.sublabel || ''}
                  onChange={(e) => set('sublabel', e.target.value)}
                  placeholder="e.g. Grocery & National"
                />
              </label>
            </>
          )}
          {err && <div className="row-editor-err">{err}</div>}
        </div>

        <div className="row-editor-foot">
          <button className="btn btn-cancel" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-save" disabled={busy} onClick={submit}>
            {busy ? 'Saving…' : isNew ? 'Add' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
