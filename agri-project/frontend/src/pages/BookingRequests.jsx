import { useEffect, useMemo, useState } from 'react'
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

export default function BookingRequests() {
  const { isTruckOperator } = useAuth()
  const { t, statusLabel } = useLanguage()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [detail, setDetail] = useState(null)

  const load = () => {
    setLoading(true)
    setError('')
    getBookings()
      .then(setBookings)
      .catch((err) => setError(err.response?.data?.detail || t('requests.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const pending = useMemo(
    () => bookings.filter((item) => item.status === 'requested'),
    [bookings]
  )
  const handled = useMemo(
    () => bookings.filter((item) => ['accepted', 'rejected'].includes(item.status)).slice(0, 6),
    [bookings]
  )

  const stats = useMemo(() => ({
    total: bookings.length,
    pending: pending.length,
    accepted: bookings.filter((item) => item.status === 'accepted').length,
    rejected: bookings.filter((item) => item.status === 'rejected').length,
  }), [bookings, pending])

  const changeStatus = async (booking, status) => {
    setBusyId(booking.id)
    setError('')
    try {
      const updated = await updateBookingStatus(booking.id, { status })
      setBookings((prev) => prev.map((item) => (item.id === booking.id ? updated : item)))
      setDetail((prev) => (prev?.id === booking.id ? updated : prev))
      setNotice(
        status === 'accepted'
          ? t('requests.accepted', [booking.id])
          : t('requests.rejected', [booking.id])
      )
    } catch (err) {
      setError(err.response?.data?.detail || t('requests.error'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ui-page driver-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('requests.title')}</h2>
          <p>{t('requests.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <button type="button" className="ui-btn ui-btn-outline" onClick={load}>
            <Icon name="refresh" size={14} /> {t('requests.refresh')}
          </button>
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <div className="bookings-stats">
        <div className="bookings-stat">
          <span className="green"><Icon name="bookings" size={17} /></span>
          <div><small>{t('requests.total')}</small><strong>{stats.total}</strong></div>
        </div>
        <div className="bookings-stat">
          <span className="amber"><Icon name="clock" size={17} /></span>
          <div><small>{t('requests.pending')}</small><strong>{stats.pending}</strong></div>
        </div>
        <div className="bookings-stat">
          <span className="blue"><Icon name="check" size={17} /></span>
          <div><small>{t('status.accepted')}</small><strong>{stats.accepted}</strong></div>
        </div>
        <div className="bookings-stat">
          <span className="red"><Icon name="close" size={17} /></span>
          <div><small>{t('status.rejected')}</small><strong>{stats.rejected}</strong></div>
        </div>
      </div>

      <div className="ui-card">
        <div className="ui-card-head">
          <div>
            <h3><Icon name="bookings" size={16} />{t('requests.pending')} ({pending.length})</h3>
            <p>{t('requests.subtitle')}</p>
          </div>
        </div>
        <div className="ui-card-body">
          {loading ? (
            <div className="ui-loading"><span className="ui-spinner" />{t('requests.loading')}</div>
          ) : pending.length === 0 ? (
            <div className="ui-empty">
              <span className="ui-empty-icon"><Icon name="bookings" size={22} /></span>
              <strong>{t('requests.none')}</strong>
              <p>{t('requests.noneSub')}</p>
            </div>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>{t('requests.farmer')}</th>
                    <th>{t('requests.load')}</th>
                    <th>{t('requests.route')}</th>
                    <th>{t('common.truck')}</th>
                    <th>{t('requests.pickupAt')}</th>
                    <th className="num">{t('requests.transport')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pending.map((booking) => (
                    <tr key={booking.id}>
                      <td>
                        <strong>{booking.farmer_name || t('common.you')}</strong>
                        <small className="bookings-sub">#{booking.id} · {when(booking.created_at, isTruckOperator)}</small>
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
                      <td className="num">
                        <strong>{inr(booking.estimated_transport_cost)}</strong>
                        <small className="bookings-sub">{Number(booking.distance_km || 0).toFixed(0)} km</small>
                      </td>
                      <td>
                        <div className="actions">
                          <button
                            type="button"
                            className="ui-icon-btn"
                            title={t('bookings.viewDetails')}
                            onClick={() => setDetail(booking)}
                          >
                            <Icon name="eye" size={14} />
                          </button>
                          <button
                            type="button"
                            className="ui-btn ui-btn-soft ui-btn-sm"
                            disabled={busyId === booking.id}
                            onClick={() => changeStatus(booking, 'accepted')}
                          >
                            {t('requests.accept')}
                          </button>
                          <button
                            type="button"
                            className="ui-btn ui-btn-danger ui-btn-sm"
                            disabled={busyId === booking.id}
                            onClick={() => changeStatus(booking, 'rejected')}
                          >
                            {t('requests.reject')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {handled.length > 0 && (
        <div className="ui-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="check" size={16} />{t('requests.recentlyHandled')}</h3>
              <p>{t('bookings.subtitle')}</p>
            </div>
          </div>
          <div className="ui-card-body">
            <div className="driver-mini-list">
              {handled.map((booking) => (
                <button
                  type="button"
                  className="driver-mini-item"
                  key={booking.id}
                  onClick={() => setDetail(booking)}
                >
                  <span className="driver-mini-icon"><Icon name="truck" size={15} /></span>
                  <span>
                    <strong>#{booking.id} · {booking.farmer_name || t('common.you')}</strong>
                    <small>{booking.crop_name || t('common.generalGoods')} · {booking.pickup_location} → {booking.market_name}</small>
                  </span>
                  <span className={`ui-badge ui-badge-${booking.status === 'accepted' ? 'blue' : 'red'}`}>
                    {statusLabel(booking.status)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {detail && (
        <Modal
          title={t('bookings.bookingTitle', [detail.id])}
          subtitle={`${detail.crop_name || t('common.generalGoods')} · ${detail.market_name}`}
          onClose={() => setDetail(null)}
          size="lg"
          footer={<button type="button" className="ui-btn ui-btn-outline" onClick={() => setDetail(null)}>{t('common.close')}</button>}
        >
          <div className="booking-detail">
            <div className="booking-detail-status">
              <span className={`ui-badge ui-badge-${detail.status === 'rejected' ? 'red' : detail.status === 'accepted' ? 'blue' : 'amber'}`}>
                {statusLabel(detail.status)}
              </span>
              <span>{detail.status === 'requested' ? t('requests.pending') : statusLabel(detail.status)}</span>
            </div>
            <div className="booking-detail-grid">
              <div><span>{t('role.farmer')}</span><strong>{detail.farmer_name || t('common.you')}</strong></div>
              <div><span>{t('common.truck')}</span><strong>{detail.vehicle_number} · {detail.truck_type}</strong></div>
              <div><span>{t('common.pickup')}</span><strong>{detail.pickup_location}</strong></div>
              <div><span>{t('common.destination')}</span><strong>{detail.destination || detail.market_name}</strong></div>
              <div><span>{t('tracking.pickupTime')}</span><strong>{when(detail.pickup_at, isTruckOperator)}</strong></div>
              <div><span>{t('bookings.requestedAt')}</span><strong>{when(detail.created_at, isTruckOperator)}</strong></div>
              <div><span>{t('common.distance')}</span><strong>{Number(detail.distance_km).toFixed(0)} km · {detail.eta_minutes} min</strong></div>
              <div><span>{t('common.quantity')}</span><strong>{kg(detail.quantity_kg)}</strong></div>
              <div><span>{t('tracking.transportCost')}</span><strong>{inr(detail.estimated_transport_cost)}</strong></div>
              <div><span>{t('bookings.accompanied')}</span><strong>{detail.accompanied ? t('bookings.yesTravelling') : t('common.no')}</strong></div>
            </div>
            {detail.notes && <p className="booking-detail-note"><Icon name="info" size={13} /> {detail.notes}</p>}
            {detail.status === 'requested' && (
              <div className="booking-detail-actions">
                <button
                  type="button"
                  className="ui-btn ui-btn-primary ui-btn-sm"
                  disabled={busyId === detail.id}
                  onClick={() => changeStatus(detail, 'accepted')}
                >
                  {t('requests.accept')}
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-danger ui-btn-sm"
                  disabled={busyId === detail.id}
                  onClick={() => changeStatus(detail, 'rejected')}
                >
                  {t('requests.reject')}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
