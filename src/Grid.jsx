import React from 'react'
import { SECTIONS } from './calendarConfig.js'
import { fmtRange, fmtDay, fmtTime, timeOf } from './dateUtils.js'

export default function Grid({
  weeks,
  todayKey,
  attentionWeeks,
  byCell,
  categories,
  ownerFilter,
  onCellClick,
  readOnly,
}) {
  const cats = ownerFilter
    ? categories.filter((c) => c.owner.id === ownerFilter)
    : categories
  const sections = SECTIONS.filter((s) => cats.some((c) => c.section === s.id))

  return (
    <div className={'grid-wrap' + (readOnly ? ' grid-ro' : '')}>
      {weeks.length === 0 ? (
        <div className="grid-empty">No weeks in that date range — widen it or reset.</div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th className="corner">
                Category
                <em>weeks run Mon–Sun</em>
              </th>
              {weeks.map((w) => (
                <th
                  key={w.key}
                  className={'wk' + (w.key === todayKey ? ' wk-today' : '')}
                >
                  <div className="wk-date">{fmtRange(w.date)}</div>
                  <div className="wk-year">
                    {w.key === todayKey ? 'this week' : w.date.getFullYear()}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => {
              const rows = cats.filter((c) => c.section === section.id)
              return (
                <React.Fragment key={section.id}>
                  <tr className="band">
                    <td
                      style={{ background: section.color }}
                      colSpan={weeks.length + 1}
                    >
                      <span className="band-label">{section.label}</span>
                    </td>
                  </tr>
                  {rows.map((cat) => (
                    <tr key={cat.id} className="cat-row">
                      <th
                        className="cat-label"
                        style={{ borderLeftColor: section.color }}
                      >
                        <span
                          className="owner-chip"
                          style={{ background: cat.owner.color }}
                          title={cat.owner.name}
                        >
                          {cat.owner.initials}
                        </span>
                        <span className="cat-name">
                          {cat.label}
                          {cat.sublabel && <em>{cat.sublabel}</em>}
                        </span>
                      </th>
                      {weeks.map((w) => {
                        const list = byCell[`${cat.id}|${w.key}`] || []
                        const content = list.filter((e) => !e.nothingThisWeek)
                        const state =
                          content.length > 0
                            ? 'filled'
                            : list.some((e) => e.nothingThisWeek)
                              ? 'nothing'
                              : 'blank'
                        const flagged =
                          !readOnly &&
                          state === 'blank' &&
                          attentionWeeks.has(w.key)
                        return (
                          <td
                            key={w.key}
                            data-cat={cat.id}
                            data-week={w.key}
                            className={
                              'cell cell-' +
                              state +
                              (flagged ? ' cell-flag' : '') +
                              (w.key === todayKey ? ' col-today' : '')
                            }
                            onClick={() => onCellClick(cat, w)}
                            title={
                              readOnly
                                ? ''
                                : flagged
                                  ? 'Needs filling — click to add'
                                  : 'Click to edit'
                            }
                          >
                            {state === 'filled' && (
                              <div className="cell-entries">
                                {content.map((e) => (
                                  <div key={e.id} className="cell-entry">
                                    <span className="ce-date">
                                      {fmtDay(e.date)}
                                      {timeOf(e.date) && (
                                        <span className="ce-time">
                                          {' · ' + fmtTime(timeOf(e.date))}
                                        </span>
                                      )}
                                    </span>
                                    <span className="ce-headline">
                                      {e.headline}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {state === 'nothing' && (
                              <span className="cell-nothing">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
