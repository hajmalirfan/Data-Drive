import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icons'
import {
  getBookings,
  getNotifications,
  getTrucks,
  updateBookingStatus,
} from '../services/operationsService'
import { useLanguage } from '../context/LanguageContext'
import './Driver.css'

const ACTIVE_STATUSES = ['accepted', 'assigned', 'picked_up', 'in_transit']

const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
const inr = (value) =>
  value === null || value === undefined
    ? '—'
    : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const when = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—'

const TONE = {
  requested: 'amber',
  accepted: 'blue',
  assigned: 'blue',
  picked_up: 'blue',
  in_transit: 'blue',
  delivered: 'green',
  rejected: 'red',
  cancelled: 'red',
}

export default function DriverDashboard() {
  const { t, statusLabel } = useLanguage()
  const { user } = useAuth()
  const [bookings, setBookings] = useState([])
  const [trucks, setTrucks] = useState([])
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = () => {
    setLoading(true)
    setError('')
    Promise.all([getBookings(), getTrucks({ mine: true }), getNotifications({ limit: 5 })])
      .then(([bookingRows, truckRows, notificationRows]) => {
        setBookings(bookingRows)
        setTrucks(truckRows)
        setNotifications(notificationRows)
      })
      .catch((err) => setError(err.response?.data?.detail || t('driver.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const pending = useMemo(
    () => bookings.filter((item) => item.status === 'requested'),
    [bookings]
  )
  const active = useMemo(
    () => bookings.filter((item) => ACTIVE_STATUSES.includes(item.status)),
    [bookings]
  )
  const completed = useMemo(
    () => bookings.filter((item) => item.status === 'delivered'),
    [bookings]
  )
  const availableTrucks = trucks.filter((item) => item.status === 'available')
  const freeCapacity = availableTrucks.reduce(
    (sum, item) => sum + Number(item.available_capacity_kg || 0),
    0
  )
  const firstName = (user?.full_name || t('shell.defaultUser')).split(' ')[0]

  const changeRequest = async (booking, status) => {
    setBusyId(booking.id)
    setError('')
    try {
      const updated = await updateBookingStatus(booking.id, { status })
      setBookings((prev) => prev.map((item) => (item.id === booking.id ? updated : item)))
      setNotice(t('driver.updated', [booking.id, statusLabel(status)]))
    } catch (err) {
      setError(err.response?.data?.detail || t('requests.error'))
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="ui-page driver-page">
        <div className="ui-skeleton" style={{ height: 128, borderRadius: 16 }} />
        <div className="driver-kpis">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="ui-skeleton" style={{ height: 104 }} />
          ))}
        </div>
        <div className="ui-skeleton" style={{ height: 300, borderRadius: 16 }} />
      </div>
    )
  }

  return (
    <div className="ui-page driver-page">
      <section className="driver-hero">
        <div className="driver-hero-copy">
          <span className="driver-eyebrow">{t('driver.eyebrow')}</span>
          <h2>{t('driver.heroTitle')}</h2>
          <p>{t('driver.heroSubtitle')}</p>
          <small>{firstName} · {notifications.length ? t('driver.notificationsSub') : t('driver.noNotifications')}</small>
        </div>
        <div className="driver-hero-actions">
          <Link to="/booking-requests" className="ui-btn ui-btn-primary">
            <Icon name="bookings" size={15} /> {t('driver.reviewRequests')}
          </Link>
          <Link to="/trips" className="ui-btn ui-btn-outline">
            <Icon name="tracking" size={15} /> {t('driver.viewTrips')}
          </Link>
        </div>
      </section>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <section className="driver-kpis" aria-label={t('dash.keyNumbers')}>
        <Link to="/booking-requests" className="driver-kpi ui-card">
          <span className="driver-kpi-icon amber"><Icon name="bookings" size={20} /></span>
          <span className="driver-kpi-copy">
            <small>{t('driver.pendingRequests')}</small>
            <strong>{pending.length}</strong>
            <span>{t('driver.pendingRequestsSub')}</span>
          </span>
          <span className="driver-kpi-go"><Icon name="arrowRight" size={14} /></span>
        </Link>
        <Link to="/trips" className="driver-kpi ui-card">
          <span className="driver-kpi-icon blue"><Icon name="truck" size={20} /></span>
          <span className="driver-kpi-copy">
            <small>{t('driver.activeTrips')}</small>
            <strong>{active.length}</strong>
            <span>{t('driver.activeTripsSub')}</span>
          </span>
          <span className="driver-kpi-go"><Icon name="arrowRight" size={14} /></span>
        </Link>
        <Link to="/trucks" className="driver-kpi ui-card">
          <span className="driver-kpi-icon green"><Icon name="route" size={20} /></span>
          <span className="driver-kpi-copy">
            <small>{t('driver.availableTrucks')}</small>
            <strong>{availableTrucks.length} / {trucks.length}</strong>
            <span>{t('driver.freeCapacity', [kg(freeCapacity)])}</span>
          </span>
          <span className="driver-kpi-go"><Icon name="arrowRight" size={14} /></span>
        </Link>
        <Link to="/trips" className="driver-kpi ui-card">
          <span className="driver-kpi-icon purple"><Icon name="check" size={20} /></span>
          <span className="driver-kpi-copy">
            <small>{t('driver.completedTrips')}</small>
            <strong>{completed.length}</strong>
            <span>{t('driver.completedTripsSub')}</span>
          </span>
          <span className="driver-kpi-go"><Icon name="arrowRight" size={14} /></span>
        </Link>
      </section>

      <section className="driver-columns">
        <div className="ui-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="bookings" size={16} />{t('driver.requestsCard')}</h3>
              <p>{t('driver.requestsCardSub')}</p>
            </div>
            <Link to="/booking-requests" className="ui-link">{t('common.viewAll')}</Link>
          </div>
          <div className="ui-card-body">
            {pending.length === 0 ? (
              <div className="driver-empty">
                <span className="ui-empty-icon"><Icon name="bookings" size={21} /></span>
                <strong>{t('driver.requestsEmpty')}</strong>
                <p>{t('driver.requestsEmptySub')}</p>
              </div>
            ) : (
              <div className="driver-list">
                {pending.slice(0, 4).map((booking) => (
                  <div className="driver-request" key={booking.id}>
                    <span className="driver-request-icon"><Icon name="leaf" size={16} /></span>
                    <span className="driver-request-main">
                      <strong>{booking.farmer_name || t('common.you')}</strong>
                      <small>
                        {booking.crop_name || t('common.generalGoods')} · {kg(booking.quantity_kg)}
                      </small>
                      <span>{booking.pickup_location} → {booking.market_name}</span>
                    </span>
                    <span className="driver-request-meta">
                      <strong>{inr(booking.estimated_transport_cost)}</strong>
                      <small>{when(booking.pickup_at)}</small>
                    </span>
                    <span className="driver-request-actions">
                      <button
                        type="button"
                        className="ui-btn ui-btn-soft ui-btn-sm"
                        disabled={busyId === booking.id}
                        onClick={() => changeRequest(booking, 'accepted')}
                      >
                        {t('driver.accept')}
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-danger ui-btn-sm"
                        disabled={busyId === booking.id}
                        onClick={() => changeRequest(booking, 'rejected')}
                      >
                        {t('driver.reject')}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </section>

      <section className="driver-lower">
        <div className="ui-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="tracking" size={16} />{t('driver.tripsCard')}</h3>
              <p>{t('driver.tripsCardSub')}</p>
            </div>
            <Link to="/trips" className="ui-link">{t('common.viewAll')}</Link>
          </div>
          <div className="ui-card-body">
            {active.length === 0 ? (
              <div className="driver-empty">
                <span className="ui-empty-icon"><Icon name="tracking" size={21} /></span>
                <strong>{t('driver.tripsEmpty')}</strong>
                <p>{t('driver.tripsEmptySub')}</p>
              </div>
            ) : (
              <div className="driver-mini-list">
                {active.slice(0, 5).map((booking) => (
                  <Link to="/trips" className="driver-mini-item" key={booking.id}>
                    <span className="driver-mini-icon"><Icon name="truck" size={15} /></span>
                    <span>
                      <strong>{booking.crop_name || t('common.generalGoods')} · {kg(booking.quantity_kg)}</strong>
                      <small>{booking.vehicle_number} · {booking.pickup_location} → {booking.market_name}</small>
                    </span>
                    <span className={`ui-badge ui-badge-${TONE[booking.status] || 'grey'}`}>
                      {statusLabel(booking.status)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="ui-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="bell" size={16} />{t('driver.notifications')}</h3>
              <p>{t('driver.notificationsSub')}</p>
            </div>
            <Link to="/notifications" className="ui-link">{t('driver.viewAll')}</Link>
          </div>
          <div className="ui-card-body">
            {notifications.length === 0 ? (
              <div className="driver-empty">
                <span className="ui-empty-icon"><Icon name="bell" size={21} /></span>
                <strong>{t('driver.noNotifications')}</strong>
              </div>
            ) : (
              <div className="driver-mini-list">
                {notifications.slice(0, 5).map((item) => (
                  <Link to={item.link || '/notifications'} className="driver-mini-item" key={item.id}>
                    <span className="driver-mini-icon"><Icon name="bell" size={15} /></span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.message}</small>
                    </span>
                    {!item.is_read && <span className="driver-unread-dot" />}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
