import React from 'react'

export default function FilterBar({
  owners,
  ownerFilter,
  setOwnerFilter,
  businessFilter,
  setBusinessFilter,
  from,
  to,
  setFrom,
  setTo,
  onReset,
  isDefault,
}) {
  return (
    <div className="filterbar">
      <div className="filter-group">
        <span className="filter-label">Business</span>
        <button
          className={'chip' + (!businessFilter ? ' chip-on' : '')}
          onClick={() => setBusinessFilter(null)}
        >
          Both
        </button>
        {['Brewery', 'Coffee'].map((b) => (
          <button
            key={b}
            className={
              'chip chip-biz chip-biz-' +
              b.toLowerCase() +
              (businessFilter === b ? ' chip-on' : '')
            }
            onClick={() => setBusinessFilter(b)}
          >
            {b}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">Owner</span>
        <button
          className={'chip' + (!ownerFilter ? ' chip-on' : '')}
          onClick={() => setOwnerFilter(null)}
        >
          All
        </button>
        {owners.map((o) => (
          <button
            key={o.id}
            className={'chip' + (ownerFilter === o.id ? ' chip-on' : '')}
            style={
              ownerFilter === o.id
                ? { background: o.color, borderColor: o.color, color: '#fff' }
                : {}
            }
            onClick={() => setOwnerFilter(o.id)}
            title={o.name}
          >
            {o.initials}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">Weeks</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="filter-dash">→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {!isDefault && (
        <button className="chip chip-reset" onClick={onReset}>
          Reset filters
        </button>
      )}
    </div>
  )
}
