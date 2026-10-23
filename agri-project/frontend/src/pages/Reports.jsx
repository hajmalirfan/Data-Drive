import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icons'
import { getReports } from '../services/operationsService'
import './Reports.css'
import { useLanguage } from '../context/LanguageContext'
import { formatIndiaDate, formatIndiaDateTime } from '../utils/dateTime'

const inr = (value) =>
  value === null || value === undefined
    ? '—'
    : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} kg`
const when = (value) =>
  value
    ? formatIndiaDateTime(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '—'

const STATUS_TONE = {
  requested: 'amber',
  accepted: 'blue',
  assigned: 'blue',
  picked_up: 'blue',
  in_transit: 'blue',
  delivered: 'green',
  cancelled: 'red',
  rejected: 'red',
}

export default function Reports() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    getReports()
      .then(setData)
      .catch((err) => setError(err.response?.data?.detail || t('reports.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const maxCrop = useMemo(() => {
    const rows = data?.stock?.by_crop || []
    return rows.reduce((max, row) => Math.max(max, Number(row.quantity_kg || 0)), 0) || 1
  }, [data])

  if (loading) {
    return (
      <div className="reports-loading">
        <div className="ui-skeleton" style={{ height: 92 }} />
        <div className="reports-loading-grid">
          {[0, 1, 2, 3].map((item) => <div key={item} className="ui-skeleton" style={{ height: 92 }} />)}
        </div>
        <div className="ui-skeleton" style={{ height: 300 }} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="ui-card ui-empty">
        <span className="ui-empty-icon"><Icon name="reports" size={22} /></span>
        <strong>{t('reports.unavailable')}</strong>
        <p>{error || t('reports.noData')}</p>
        <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={load} style={{ marginTop: 6 }}>
          <Icon name="refresh" size={14} /> Try again
        </button>
      </div>
    )
  }

  const stock = data.stock || {}
  const bookings = data.bookings || {}
  const financials = data.financials || {}
  const markets = data.markets || {}
  const byCrop = stock.by_crop || []
  const prices = markets.prices || []
  const recent = data.recent_bookings || []
  const bookingTotal = bookings.total || 0

  return (
    <div className="ui-page reports-page">
      <div className="ui-toolbar reports-toolbar">
        <div>
          <h2>{t('reports.title')}</h2>
          <p>{t('reports.generated', [formatIndiaDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' })])}</p>
        </div>
        <div className="ui-toolbar-actions">
          <button type="button" className="ui-btn ui-btn-outline" onClick={() => window.print()}>
            <Icon name="reports" size={14} /> Print report
          </button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={load}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="reports-stats">
        <div className="reports-stat">
          <span className="green"><Icon name="package" size={18} /></span>
          <div><small>{t('crops.totalStock')}</small><strong>{kg(stock.total_kg)}</strong><em>{stock.listings ?? 0} listings</em></div>
        </div>
        <div className="reports-stat">
          <span className="blue"><Icon name="prices" size={18} /></span>
          <div><small>{t('dash.estimatedNetProceeds')}</small><strong>{inr(financials.estimated_net_proceeds)}</strong><em>{t('reports.acrossBookings')}</em></div>
        </div>
        <div className="reports-stat">
          <span className="amber"><Icon name="rupee" size={18} /></span>
          <div><small>{t('reports.actualNet')}</small><strong>{inr(financials.actual_net)}</strong><em>{inr(financials.actual_revenue)} revenue</em></div>
        </div>
        <div className="reports-stat">
          <span className="red"><Icon name="truck" size={18} /></span>
          <div><small>{t('tracking.transportCost')}</small><strong>{inr(bookings.estimated_transport_cost)}</strong><em>{bookings.total ?? 0} bookings</em></div>
        </div>
      </div>

      <div className="reports-grid">
        <section className="ui-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="crops" size={16} />{t('reports.stockByCrop')}</h3>
              <p>{kg(stock.available_kg)} currently available for sale</p>
            </div>
            <Link to="/crops" className="ui-link">{t('reports.manageStock')}</Link>
          </div>
          <div className="ui-card-body">
            {byCrop.length === 0 ? (
              <div className="ui-empty">
                <span className="ui-empty-icon"><Icon name="crops" size={21} /></span>
                <strong>{t('reports.noStock')}</strong>
                <p>{t('reports.noStockSub')}</p>
              </div>
            ) : (
              <div className="reports-bars">
                {byCrop.map((row) => (
                  <div className="reports-bar-row" key={row.crop_name}>
                    <div className="reports-bar-label">
                      <span className="reports-bar-icon"><Icon name="leaf" size={13} /></span>
                      <strong>{row.crop_name}</strong>
                      <small>{row.listings} listing{row.listings === 1 ? '' : 's'}</small>
                    </div>
                    <div className="reports-bar-track">
                      <span style={{ width: `${Math.max(4, (Number(row.quantity_kg) / maxCrop) * 100)}%` }} />
                    </div>
                    <span className="reports-bar-value">{kg(row.quantity_kg)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="ui-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="rupee" size={16} />{t('reports.financialSummary')}</h3>
              <p>{t('reports.estimatesActuals')}</p>
            </div>
          </div>
          <div className="ui-card-body reports-financials">
            <div>
              <span>{t('dash.estimatedNetProceeds')}</span>
              <strong>{inr(financials.estimated_net_proceeds)}</strong>
            </div>
            <div>
              <span>{t('reports.actualRevenue')}</span>
              <strong>{inr(financials.actual_revenue)}</strong>
            </div>
            <div>
              <span>{t('reports.actualExpenses')}</span>
              <strong className="negative">{inr(financials.actual_expenses)}</strong>
            </div>
            <div className="net">
              <span>{t('reports.actualNet')}</span>
              <strong>{inr(financials.actual_net)}</strong>
            </div>
            <div className="reports-financials-note">
              <Icon name="info" size={13} />
              Actuals come from sale details recorded after delivery. Estimates use current market prices and trip costs.
            </div>
          </div>
        </section>
      </div>

      <div className="reports-grid">
        <section className="ui-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="bookings" size={16} />{t('reports.bookingPerformance')}</h3>
              <p>{t('reports.bookingPerformanceSub')}</p>
            </div>
            <Link to="/bookings" className="ui-link">{t('reports.allBookings')}</Link>
          </div>
          <div className="ui-card-body">
            <div className="reports-booking-bar">
              {[
                ['active', bookings.active || 0, 'active'],
                ['delivered', bookings.delivered || 0, 'delivered'],
                ['cancelled', bookings.cancelled || 0, 'cancelled'],
                ['rejected', bookings.rejected || 0, 'rejected'],
              ].map(([key, value, tone]) => {
                const pct = bookingTotal ? (value / bookingTotal) * 100 : 0
                return pct > 0 ? <span key={key} className={tone} style={{ width: `${pct}%` }} title={`${key}: ${value}`} /> : null
              })}
            </div>
            <div className="reports-booking-legend">
              <span><i className="active" />{t('common.active')}<strong>{bookings.active || 0}</strong></span>
              <span><i className="delivered" />{t('common.delivered')}<strong>{bookings.delivered || 0}</strong></span>
              <span><i className="cancelled" />{t('common.cancelled')}<strong>{bookings.cancelled || 0}</strong></span>
              <span><i className="rejected" />{t('common.rejected')}<strong>{bookings.rejected || 0}</strong></span>
            </div>
            <div className="reports-booking-counts">
              <div><span>{t('bookings.total')}</span><strong>{bookings.total || 0}</strong></div>
              <div><span>{t('reports.successfulDeliveries')}</span><strong>{bookings.delivered || 0}</strong></div>
            </div>
          </div>
        </section>

        <section className="ui-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="markets" size={16} />{t('reports.marketCoverage')}</h3>
              <p>{markets.count ?? 0} markets with {markets.price_records ?? 0} price records</p>
            </div>
            <Link to="/market-prices" className="ui-link">{t('markets.priceBoard')}</Link>
          </div>
          <div className="ui-card-body">
            <div className="reports-market-stats">
              <div><small>{t('common.markets')}</small><strong>{markets.count ?? 0}</strong></div>
              <div><small>{t('reports.priceRecords')}</small><strong>{markets.price_records ?? 0}</strong></div>
              <div><small>{t('reports.stalePrices')}</small><strong>{markets.stale_prices ?? 0}</strong></div>
            </div>
            {prices.length === 0 ? (
              <div className="ui-empty" style={{ padding: '22px 10px' }}>
                <strong>{t('reports.noPrices')}</strong>
                <p>{t('reports.noPricesSub')}</p>
              </div>
            ) : (
              <div className="ui-table-wrap reports-price-table">
                <table className="ui-table">
                  <thead>
                    <tr><th>{t('common.crop')}</th><th>{t('common.market')}</th><th className="num">{t('common.pricePerKg')}</th><th>{t('common.observed')}</th></tr>
                  </thead>
                  <tbody>
                    {prices.slice(0, 6).map((price) => (
                      <tr key={price.id}>
                        <td><strong>{price.crop_name}</strong></td>
                        <td>{price.market_name}</td>
                        <td className="num">₹{Number(price.price_per_kg).toFixed(2)}</td>
                        <td className="muted">{when(price.observed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="ui-card">
        <div className="ui-card-head">
          <div>
            <h3><Icon name="clock" size={16} />{t('reports.recentBookings')}</h3>
            <p>{t('reports.recentBookingsSub')}</p>
          </div>
          <Link to="/bookings" className="ui-link">{t('reports.openBookings')}</Link>
        </div>
        <div className="ui-card-body">
          {recent.length === 0 ? (
            <div className="ui-empty">
              <span className="ui-empty-icon"><Icon name="bookings" size={21} /></span>
              <strong>{t('reports.noBookings')}</strong>
              <p>{t('reports.noBookingsSub')}</p>
            </div>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr><th>{t('bookings.thBooking')}</th><th>{t('common.crop')}</th><th>{t('common.market')}</th><th>{t('common.truck')}</th><th>{t('common.pickup')}</th><th className="num">{t('common.quantity')}</th><th className="num">{t('bookings.thTransport')}</th><th>{t('common.status')}</th></tr>
                </thead>
                <tbody>
                  {recent.map((booking) => (
                    <tr key={booking.id}>
                      <td><strong>#{booking.id}</strong></td>
                      <td>{booking.crop_name || t('common.generalGoods')}</td>
                      <td>{booking.market_name}</td>
                      <td>{booking.vehicle_number}</td>
                      <td className="muted">{when(booking.pickup_at)}</td>
                      <td className="num">{kg(booking.quantity_kg)}</td>
                      <td className="num">{inr(booking.estimated_transport_cost)}</td>
                      <td><span className={`ui-badge ui-badge-${STATUS_TONE[booking.status] || 'grey'}`}>{statusLabel(booking.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
