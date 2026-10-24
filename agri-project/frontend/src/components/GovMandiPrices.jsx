import { useEffect, useState } from 'react'
import Icon from './Icons'
import { useLanguage } from '../context/LanguageContext'
import { getMandiFilters, getMandiPrices } from '../services/mandiService'
import { formatIndiaDate } from '../utils/dateTime'

const PAGE_SIZE = 50
const rupees = (value) =>
  value === null || value === undefined ? '—' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const perKg = (quintal) => (quintal === null || quintal === undefined ? null : quintal / 100)
const dayLabel = (iso) => (iso ? formatIndiaDate(`${iso}T00:00:00+05:30`, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

/** Government mandi prices exactly as published (Agmarknet via data.gov.in). */
export default function GovMandiPrices() {
  const { t } = useLanguage()
  const [filters, setFilters] = useState({ state: '', district: '', commodity: '', q: '', sort: 'commodity' })
  const [options, setOptions] = useState({ states: [], districts: [], commodities: [] })
  const [page, setPage] = useState(0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getMandiFilters({ state: filters.state || undefined, district: filters.district || undefined })
      .then(setOptions)
      .catch(() => {})
  }, [filters.state, filters.district])

  useEffect(() => {
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      getMandiPrices({
        state: filters.state || undefined,
        district: filters.district || undefined,
        commodity: filters.commodity || undefined,
        q: filters.q.trim() || undefined,
        sort: filters.sort,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
        .then(setData)
        .catch((err) => setError(err.response?.data?.detail || t('mandi.loadError')))
        .finally(() => setLoading(false))
    }, filters.q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [filters, page]) // eslint-disable-line

  const update = (key, value) => {
    setPage(0)
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'state' ? { district: '', commodity: '' } : {}),
      ...(key === 'district' ? { commodity: '' } : {}),
    }))
  }

  const total = data?.total || 0
  const from = total ? page * PAGE_SIZE + 1 : 0
  const to = Math.min(total, (page + 1) * PAGE_SIZE)

  return (
    <div className="mandi">
      <div className="mandi-source">
        <Icon name="shield" size={14} />
        <span>
          <b>{t('mandi.sourceLabel')}</b> {data?.source || '—'}
          {' · '}{t('mandi.pricesFor', [dayLabel(data?.arrival_date)])}
          {' · '}{t('mandi.unitNote')}
        </span>
      </div>

      <div className="prices-stats">
        <div className="prices-stat">
          <span className="green"><Icon name="prices" size={17} /></span>
          <div><small>{t('mandi.records')}</small><strong>{total.toLocaleString('en-IN')}</strong></div>
        </div>
        <div className="prices-stat">
          <span className="amber"><Icon name="markets" size={17} /></span>
          <div><small>{t('mandi.markets')}</small><strong>{(data?.markets || 0).toLocaleString('en-IN')}</strong></div>
        </div>
        <div className="prices-stat">
          <span className="blue"><Icon name="arrowUp" size={17} /></span>
          <div>
            <small>{t('mandi.highestModal')}</small>
            <strong>{rupees(data?.max_modal)}<em>/q</em></strong>
          </div>
        </div>
        <div className="prices-stat">
          <span className="red"><Icon name="scale" size={17} /></span>
          <div>
            <small>{t('mandi.averageModal')}</small>
            <strong>{rupees(data?.avg_modal)}<em>/q</em></strong>
          </div>
        </div>
      </div>

      <div className="ui-card">
        <div className="prices-filters">
          <label className="ui-field">
            <span className="ui-label">{t('mandi.state')}</span>
            <select className="ui-select" value={filters.state} onChange={(e) => update('state', e.target.value)}>
              <option value="">{t('mandi.allStates')}</option>
              {options.states.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="ui-field">
            <span className="ui-label">{t('mandi.district')}</span>
            <select className="ui-select" value={filters.district} onChange={(e) => update('district', e.target.value)} disabled={!filters.state}>
              <option value="">{t('mandi.allDistricts')}</option>
              {options.districts.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="ui-field">
            <span className="ui-label">{t('common.crop')}</span>
            <select className="ui-select" value={filters.commodity} onChange={(e) => update('commodity', e.target.value)}>
              <option value="">{t('prices.allCrops')}</option>
              {options.commodities.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="ui-field mandi-search">
            <span className="ui-label">{t('common.search')}</span>
            <input className="ui-input" value={filters.q} placeholder={t('mandi.searchPlaceholder')} onChange={(e) => update('q', e.target.value)} />
          </label>
          <label className="ui-field">
            <span className="ui-label">{t('mandi.sortBy')}</span>
            <select className="ui-select" value={filters.sort} onChange={(e) => update('sort', e.target.value)}>
              <option value="commodity">{t('mandi.sortCommodity')}</option>
              <option value="market">{t('mandi.sortMarket')}</option>
              <option value="modal_desc">{t('mandi.sortHigh')}</option>
              <option value="modal_asc">{t('mandi.sortLow')}</option>
            </select>
          </label>
        </div>

        {error && <div className="ui-card-body"><div className="ui-alert ui-alert-error">{error}</div></div>}

        <div className={`ui-card-body prices-table-body ${loading && data ? 'mandi-refreshing' : ''}`}>
          {loading && !data ? (
            <div className="ui-loading"><span className="ui-spinner" />{t('common.loading')}</div>
          ) : total === 0 ? (
            <div className="ui-empty">
              <span className="ui-empty-icon"><Icon name="prices" size={22} /></span>
              <strong>{t('mandi.emptyTitle')}</strong>
              <p>{t('mandi.emptySub')}</p>
            </div>
          ) : (
            <>
              <div className="ui-table-wrap">
                <table className="ui-table mandi-table">
                  <thead>
                    <tr>
                      <th>{t('common.market')}</th>
                      <th>{t('common.crop')}</th>
                      <th className="num">{t('mandi.min')}</th>
                      <th className="num">{t('mandi.max')}</th>
                      <th className="num">{t('mandi.modal')}</th>
                      <th className="num">{t('mandi.modalPerKg')}</th>
                      <th>{t('mandi.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong className="mandi-market">{row.market}</strong>
                          <small className="mandi-sub">{row.district}, {row.state}</small>
                        </td>
                        <td>
                          <strong>{row.commodity}</strong>
                          <small className="mandi-sub">{[row.variety, row.grade].filter(Boolean).join(' · ')}</small>
                        </td>
                        <td className="num">{rupees(row.min_price)}</td>
                        <td className="num">{rupees(row.max_price)}</td>
                        <td className="num"><strong>{rupees(row.modal_price)}</strong></td>
                        <td className="num">{rupees(perKg(row.modal_price))}</td>
                        <td>{dayLabel(row.arrival_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mandi-pager">
                <span>{t('mandi.showing', [from, to, total.toLocaleString('en-IN')])}</span>
                <div>
                  <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
                    {t('mandi.prev')}
                  </button>
                  <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" disabled={to >= total || loading} onClick={() => setPage((p) => p + 1)}>
                    {t('mandi.next')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
