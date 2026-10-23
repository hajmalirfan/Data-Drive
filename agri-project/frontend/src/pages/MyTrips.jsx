import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icons'
import Modal from '../components/Modal'
import { getBookings, updateBookingStatus } from '../services/operationsService'
import { useLanguage } from '../context/LanguageContext'
import './Bookings.css'
import './Driver.css'
import { formatIndiaDateTime } from '../utils/dateTime'

const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
const inr = (value) =>
  value === null || value === undefined
    ? '—'
    : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const when = (value, useLocalTime) => {
  if (!value) return '—'
  const options = {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }

  return useLocalTime
    ? new Date(value).toLocaleString('en-IN', options)
    : formatIndiaDateTime(value, options)
}

const GROUPS = {
  upcoming: ['accepted', 'assigned'],
  active: ['picked_up', 'in_transit'],
  completed: ['delivered'],
  closed: ['rejected', 'cancelled'],
}
const NEXT_STEP = {
  accepted: 'assigned',
  assigned: 'picked_up',
  picked_up: 'in_transit',
  in_transit: 'delivered',
}
const TONE = {
  accepted: 'blue',
  assigned: 'blue',
  picked_up: 'blue',
  in_transit: 'amber',
  delivered: 'green',
  rejected: 'red',
  cancelled: 'red',
}

export default function MyTrips() {
  const { isTruckOperator } = useAuth()
  const { t, statusLabel } = useLanguage()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('upcoming')
  const [busyId, setBusyId] = useState(null)
  const [detail, setDetail] = useState(null)

  const load = () => {
    setLoading(true)
    setError('')
    getBookings()
      .then(setBookings)
      .catch((err) => setError(err.response?.data?.detail || t('trips.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const grouped = useMemo(() => {
    const result = { upcoming: [], active: [], completed: [], closed: [] }
    bookings.forEach((booking) => {
      Object.entries(GROUPS).forEach(([group, statuses]) => {
        if (statuses.includes(booking.status)) result[group].push(booking)
      })
    })
    result.upcoming.sort((a, b) => new Date(a.pickup_at) - new Date(b.pickup_at))
    return result
  }, [bookings])

  const visible = grouped[tab] || []

  const tabs = [
    ['upcoming', t('trips.upcoming'), grouped.upcoming.length],
    ['active', t('trips.active'), grouped.active.length],
    ['completed', t('trips.completed'), grouped.completed.length],
    ['closed', t('trips.closed'), grouped.closed.length],
  ]

  const advance = async (booking) => {
    const next = NEXT_STEP[booking.status]
    if (!next) return
    setBusyId(booking.id)
    setError('')
    try {
      const updated = await updateBookingStatus(booking.id, { status: next })
      setBookings((prev) => prev.map((item) => (item.id === booking.id ? updated : item)))
      setDetail((prev) => (prev?.id === booking.id ? updated : prev))
      setNotice(t('trips.updated', [booking.id, statusLabel(next)]))
    } catch (err) {
      setError(err.response?.data?.detail || t('trips.error'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ui-page driver-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('trips.title')}</h2>
          <p>{t('trips.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <button type="button" className="ui-btn ui-btn-outline" onClick={load}>
            <Icon name="refresh" size={14} /> {t('requests.refresh')}
          </button>
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <div className="ui-card">
        <div className="bookings-tabs">
          {tabs.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              className={tab === value ? 'active' : ''}
              onClick={() => setTab(value)}
            >
              {label} ({count})
            </button>
          ))}
        </div>

        <div className="ui-card-body bookings-body">
          {loading ? (
            <div className="ui-loading"><span className="ui-spinner" />{t('trips.loading')}</div>
          ) : visible.length === 0 ? (
            <div className="ui-empty">
              <span className="ui-empty-icon"><Icon name="truck" size={22} /></span>
              <strong>{t('trips.none')}</strong>
              <p>{t('trips.noneSub')}</p>
              {tab === 'upcoming' && (
                <Link to="/booking-requests" className="ui-btn ui-btn-primary ui-btn-sm" style={{ marginTop: 6 }}>
                  <Icon name="bookings" size={14} /> {t('driver.reviewRequests')}
                </Link>
              )}
            </div>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>{t('trips.booking')}</th>
                    <th>{t('trips.trip')}</th>
                    <th>{t('trips.route')}</th>
                    <th>{t('trips.truck')}</th>
                    <th>{t('trips.pickupAt')}</th>
                    <th className="num">{t('trips.transportCost')}</th>
                    <th>{t('trips.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((booking) => {
                    const next = NEXT_STEP[booking.status]
                    return (
                      <tr key={booking.id}>
                        <td>
                          <button type="button" className="bookings-id" onClick={() => setDetail(booking)}>
                            #{booking.id}
                          </button>
                          <small className="bookings-sub">{booking.farmer_name || t('common.you')}</small>
                        </td>
                        <td>
                          <strong>{booking.crop_name || t('common.generalGoods')}</strong>
                          <small className="bookings-sub">{kg(booking.quantity_kg)}</small>
                        </td>
                        <td>
                          <strong>{booking.pickup_location}</strong>
                          <small className="bookings-sub">→ {booking.market_name}</small>
                        </td>
                        <td>
                          <strong>{booking.vehicle_number || '—'}</strong>
                          <small className="bookings-sub">{booking.truck_type}</small>
                        </td>
                        <td className="muted">{when(booking.pickup_at, isTruckOperator)}</td>
                        <td className="num">{inr(booking.estimated_transport_cost)}</td>
                        <td>
                          <span className={`ui-badge ui-badge-${TONE[booking.status] || 'grey'}`}>
                            {statusLabel(booking.status)}
                          </span>
                        </td>
                        <td>
                          <div className="actions">
                            <button
                              type="button"
                              className="ui-icon-btn"
                              title={t('trips.view')}
                              onClick={() => setDetail(booking)}
                            >
                              <Icon name="eye" size={14} />
                            </button>
                            {next && (
                              <button
                                type="button"
                                className="ui-btn ui-btn-soft ui-btn-sm"
                                disabled={busyId === booking.id}
                                onClick={() => advance(booking)}
                              >
                                {t('trips.mark', [statusLabel(next)])}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {detail && (
        <Modal
          title={t('trips.detailTitle', [detail.id])}
          subtitle={`${detail.crop_name || t('common.generalGoods')} · ${detail.market_name}`}
          onClose={() => setDetail(null)}
          size="lg"
          footer={(
            <>
              <button type="button" className="ui-btn ui-btn-outline" onClick={() => setDetail(null)}>{t('trips.close')}</button>
              {NEXT_STEP[detail.status] && (
                <button
                  type="button"
                  className="ui-btn ui-btn-primary"
                  disabled={busyId === detail.id}
                  onClick={() => advance(detail)}
                >
                  {t('trips.mark', [statusLabel(NEXT_STEP[detail.status])])}
                </button>
              )}
              {['picked_up', 'in_transit', 'delivered'].includes(detail.status) && (
                <Link to="/tracking" className="ui-btn ui-btn-outline">{t('trips.tracking')}</Link>
              )}
            </>
          )}
        >
          <div className="booking-detail">
            <div className="booking-detail-status">
              <span className={`ui-badge ui-badge-${TONE[detail.status] || 'grey'}`}>{statusLabel(detail.status)}</span>
              <span>{detail.status === 'delivered' ? t('bookings.tripClosed') : t('bookings.tripActive')}</span>
            </div>
            <div className="booking-detail-grid">
              <div><span>{t('trips.farmer')}</span><strong>{detail.farmer_name || t('common.you')}</strong></div>
              <div><span>{t('trips.truck')}</span><strong>{detail.vehicle_number} · {detail.truck_type}</strong></div>
              <div><span>{t('common.pickup')}</span><strong>{detail.pickup_location}</strong></div>
              <div><span>{t('trips.destination')}</span><strong>{detail.destination || detail.market_name}</strong></div>
              <div><span>{t('trips.pickupAt')}</span><strong>{when(detail.pickup_at, isTruckOperator)}</strong></div>
              <div><span>{t('trips.requestedAt')}</span><strong>{when(detail.created_at, isTruckOperator)}</strong></div>
              <div><span>{t('trips.distance')}</span><strong>{Number(detail.distance_km).toFixed(0)} km · {detail.eta_minutes} min</strong></div>
              <div><span>{t('trips.quantity')}</span><strong>{kg(detail.quantity_kg)}</strong></div>
              <div><span>{t('trips.transportCost')}</span><strong>{inr(detail.estimated_transport_cost)}</strong></div>
              <div><span>{t('bookings.accompanied')}</span><strong>{detail.accompanied ? t('bookings.yesTravelling') : t('common.no')}</strong></div>
            </div>
            {detail.notes && <p className="booking-detail-note"><Icon name="info" size={13} /> {detail.notes}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
