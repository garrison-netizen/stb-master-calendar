import React, { useState } from 'react'
import {
  fmtLongDate,
  fmtDay,
  fmtTimeRange,
  timeOf,
  addDays,
  keyOf,
} from './dateUtils.js'

export default function CellEditor({
  category,
  week,
  entries,
  onAdd,
  onUpdate,
  onDelete,
  onMarkNothing,
  onClose,
}) {
  const owner = category.owner
  const content = entries.filter((e) => !e.nothingThisWeek)
  const minDate = keyOf(week.date)
  const maxDate = keyOf(addDays(week.date, 6))

  const blankForm = {
    id: null,
    date: minDate,
    startTime: '',
    endTime: '',
    headline: '',
    details: '',
  }
  const [form, setForm] = useState(blankForm)
  const [busy, setBusy] = useState(false)

  function editEntry(e) {
    setForm({
      id: e.id,
      date: (e.date || minDate).slice(0, 10),
      startTime: timeOf(e.date),
      endTime: timeOf(e.dateEnd),
      headline: e.headline || '',
      details: e.details || '',
    })
  }

  async function submit() {
    if (!form.headline.trim()) return
    setBusy(true)
    const payload = {
      date: form.date,
      startTime: form.startTime,
      endTime: form.startTime ? form.endTime : '',
      headline: form.headline.trim(),
      details: form.details.trim(),
    }
    if (form.id) await onUpdate(form.id, payload)
    else await onAdd(payload)
    setBusy(false)
    setForm(blankForm)
  }

  async function remove(id) {
    setBusy(true)
    await onDelete(id)
    setBusy(false)
    if (form.id === id) setForm(blankForm)
  }

  async function nothing() {
    setBusy(true)
    await onMarkNothing()
    setBusy(false)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-cat">{category.label}</div>
            <div className="modal-week">Week of {fmtLongDate(week.date)}</div>
          </div>
          <span
            className="owner-chip"
            style={{ background: owner?.color || '#888' }}
            title={owner?.name}
          >
            {owner?.initials}
          </span>
        </div>

        {content.length > 0 && (
          <div className="entry-list">
            <div className="section-label">
              {content.length} {content.length === 1 ? 'entry' : 'entries'} this week
            </div>
            {content.map((e) => (
              <div
                key={e.id}
                className={'entry-item' + (form.id === e.id ? ' editing' : '')}
              >
                <span className="ei-date">{fmtDay(e.date)}</span>
                <span className="ei-text">
                  <span className="ei-headline">{e.headline}</span>
                  {timeOf(e.date) && (
                    <span className="ei-time">
                      {fmtTimeRange(timeOf(e.date), timeOf(e.dateEnd))}
                    </span>
                  )}
                  {e.details && <span className="ei-details">{e.details}</span>}
                </span>
                <button
                  className="ei-btn"
                  disabled={busy}
                  onClick={() => editEntry(e)}
                >
                  Edit
                </button>
                <button
                  className="ei-btn ei-del"
                  disabled={busy}
                  onClick={() => remove(e.id)}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="entry-form">
          <div className="section-label">
            {form.id ? 'Edit entry' : 'Add an entry'}
          </div>
          <label className="fld">
            <span>Date</span>
            <input
              type="date"
              value={form.date}
              min={minDate}
              max={maxDate}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </label>
          <label className="fld">
            <span>
              Time <em>(optional — leave blank for an all-day item)</em>
            </span>
            <div className="time-row">
              <input
                type="time"
                value={form.startTime}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    startTime: e.target.value,
                    endTime: e.target.value ? f.endTime : '',
                  }))
                }
              />
              <span className="time-dash">to</span>
              <input
                type="time"
                value={form.endTime}
                disabled={!form.startTime}
                title={
                  form.startTime ? '' : 'Set a start time first'
                }
                onChange={(e) =>
                  setForm((f) => ({ ...f, endTime: e.target.value }))
                }
              />
            </div>
          </label>
          <label className="fld">
            <span>Headline</span>
            <input
              value={form.headline}
              onChange={(e) =>
                setForm((f) => ({ ...f, headline: e.target.value }))
              }
              placeholder="Short summary of the plan"
              autoFocus
            />
          </label>
          <label className="fld">
            <span>
              Details <em>(optional)</em>
            </span>
            <textarea
              rows={3}
              value={form.details}
              onChange={(e) =>
                setForm((f) => ({ ...f, details: e.target.value }))
              }
              placeholder="Anything else the team should know"
            />
          </label>
          <div className="entry-form-actions">
            {form.id && (
              <button
                className="btn btn-cancel"
                disabled={busy}
                onClick={() => setForm(blankForm)}
              >
                Cancel edit
              </button>
            )}
            <button
              className="btn btn-save"
              disabled={busy || !form.headline.trim()}
              onClick={submit}
            >
              {form.id ? 'Save changes' : 'Add entry'}
            </button>
          </div>
        </div>

        <div className="modal-foot">
          {content.length === 0 && (
            <button className="btn btn-ghost" disabled={busy} onClick={nothing}>
              Nothing this week
            </button>
          )}
          <button
            className="btn btn-cancel modal-done"
            disabled={busy}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
