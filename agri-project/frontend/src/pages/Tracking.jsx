import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icons'
import {
  getBookings,
  getMarkets,
  updateBookingLocation,
  updateBookingStatus,
} from '../services/operationsService'
import './Tracking.css'
import { useLanguage } from '../context/LanguageContext'

const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} kg`
const when = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '—'

const STEPS = [
  ['requested', 'status.requested'],
  ['accepted', 'status.accepted'],
  ['assigned', 'tracking.stepAssigned'],
  ['picked_up', 'status.pickedUp'],
  ['in_transit', 'status.inTransit'],
  ['delivered', 'common.delivered'],
]
const ACTIVE = new Set(['requested', 'accepted', 'assigned', 'picked_up', 'in_transit'])
const NEXT = {
  requested: 'accepted',
  accepted: 'assigned',
  assigned: 'picked_up',
  picked_up: 'in_transit',
  in_transit: 'delivered',
}

function TripMap({ markets, booking, market }) {
  const { t } = useLanguage()
  const points = useMemo(() => {
    if (!markets.length) return []
    const lats = markets.map((item) => Number(item.latitude) || 0)
    const lngs = markets.map((item) => Number(item.longitude) || 0)
    if (booking?.last_lat !== null && booking?.last_lat !== undefined) lats.push(Number(booking.last_lat))
    if (booking?.last_lng !== null && booking?.last_lng !== undefined) lngs.push(Number(booking.last_lng))
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const latSpan = maxLat - minLat || 1
    const lngSpan = maxLng - minLng || 1
    return markets.map((item) => ({
      ...item,
      x: 12 + ((Number(item.longitude) - minLng) / lngSpan) * 76,
      y: 84 - ((Number(item.latitude) - minLat) / latSpan) * 68,
      destination: market && item.id === market.id,
    }))
  }, [markets, market, booking?.last_lat, booking?.last_lng])

  const truckPoint = useMemo(() => {
    if (!booking || booking.last_lat === null || booking.last_lat === undefined) return null
    if (booking.last_lng === null || booking.last_lng === undefined) return null
    const lats = markets.map((item) => Number(item.latitude) || 0)
    const lngs = markets.map((item) => Number(item.longitude) || 0)
    lats.push(Number(booking.last_lat))
    lngs.push(Number(booking.last_lng))
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    return {
      x: 12 + ((Number(booking.last_lng) - minLng) / (maxLng - minLng || 1)) * 76,
      y: 84 - ((Number(booking.last_lat) - minLat) / (maxLat - minLat || 1)) * 68,
    }
  }, [markets, booking])

  return (
    <div className="trk-map">
      <span className="trk-road trk-road-a" />
      <span className="trk-road trk-road-b" />
      <span className="trk-river" />
      {points.map((item) => (
        <span
          key={item.id}
          className={`trk-market-pin ${item.destination ? 'destination' : ''}`}
          style={{ left: `${item.x}%`, top: `${item.y}%` }}
          title={item.name}
        >
          <span className="trk-market-dot"><Icon name="markets" size={12} /></span>
          <span className="trk-market-label">
            <strong>{item.name}</strong>
            {item.destination && <small>{t('common.destination')}</small>}
          </span>
        </span>
      ))}
      {truckPoint ? (
        <span className="trk-truck-pin" style={{ left: `${truckPoint.x}%`, top: `${truckPoint.y}%` }} title={t('tracking.lastReportedLocation')}>
          <span className="trk-truck-pulse" />
          <span className="trk-truck-dot"><Icon name="truck" size={14} /></span>
          <span className="trk-truck-label">{t('tracking.lastReported')}</span>
        </span>
      ) : (
        <span className="trk-no-location"><Icon name="info" size={12} />{t('tracking.noLocation')}</span>
      )}
      <span className="trk-legend">
        <span><i className="dot dest" />{t('common.destination')}</span>
        <span><i className="dot muted" />{t('dash.otherMandis')}</span>
        <span><i className="dot truck" />{t('common.truck')}</span>
      </span>
    </div>
  )
}

export default function Tracking() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const { isAdmin, isTruckOperator } = useAuth()
  const [bookings, setBookings] = useState([])
  const [markets, setMarkets] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loc, setLoc] = useState({ lat: '', lng: '', location: '', consent: true })
  const [locError, setLocError] = useState('')
  const [showClosed, setShowClosed] = useState(false)

  const canShare = isAdmin || isTruckOperator

  const load = (silent = false) => {
    if (!silent) setLoading(true)
    Promise.all([getBookings(), getMarkets()])
      .then(([rows, marketRows]) => {
        setBookings(rows)
        setMarkets(marketRows)
        setSelectedId((current) => {
          if (current && rows.some((item) => item.id === current)) return current
          const active = rows.find((item) => ACTIVE.has(item.status))
          return active?.id ?? rows[0]?.id ?? null
        })
      })
      .catch((err) => setError(err.response?.data?.detail || t('tracking.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const timer = setInterval(() => load(true), 20000)
    return () => clearInterval(timer)
  }, []) // eslint-disable-line

  const selected = bookings.find((item) => item.id === selectedId)
  const market = selected ? markets.find((item) => item.id === selected.market_id) : null
  const visible = showClosed ? bookings : bookings.filter((item) => ACTIVE.has(item.status) || item.status === 'delivered')
  const statusIndex = selected ? STEPS.findIndex(([value]) => value === selected.status) : -1
  const isActive = selected ? ACTIVE.has(selected.status) : false

  const advance = async () => {
    if (!selected) return
    const next = NEXT[selected.status]
    if (!next) return
    setBusy(true)
    setError('')
    try {
      const updated = await updateBookingStatus(selected.id, { status: next })
      setBookings((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setNotice(t('tracking.updated', [updated.id, statusLabel(next)]))
    } catch (err) {
      setError(err.response?.data?.detail || t('tracking.updateError'))
    } finally {
      setBusy(false)
    }
  }

  const useMyLocation = () => {
    setLocError('')
    if (!navigator.geolocation) { setLocError(t('tracking.geoUnavailable')); return }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLoc((prev) => ({
          ...prev,
          lat: position.coords.latitude.toFixed(6),
          lng: position.coords.longitude.toFixed(6),
          location: prev.location || t('tracking.liveGps'),
        }))
      },
      () => setLocError(t('tracking.geoError')),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const shareLocation = async (event) => {
    event.preventDefault()
    setLocError('')
    if (!selected) return
    if (loc.lat === '' || loc.lng === '') { setLocError(t('tracking.errCoords')); return }
    setBusy(true)
    try {
      const updated = await updateBookingLocation(selected.id, {
        lat: Number(loc.lat),
        lng: Number(loc.lng),
        location: loc.location.trim(),
        consent: loc.consent,
      })
      setBookings((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setNotice(t('tracking.locationShared'))
    } catch (err) {
      setLocError(err.response?.data?.detail || t('tracking.locationError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ui-page tracking-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('tracking.title')}</h2>
          <p>{t('tracking.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <label className="trk-toggle">
            <input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} />
            <span>{t('tracking.showClosed')}</span>
          </label>
          <button type="button" className="ui-btn ui-btn-outline" onClick={() => load()}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      {loading ? (
        <div className="ui-card ui-loading"><span className="ui-spinner" />{t('tracking.loading')}</div>
      ) : visible.length === 0 ? (
        <div className="ui-card ui-empty">
          <span className="ui-empty-icon"><Icon name="tracking" size={24} /></span>
          <strong>{t('tracking.noTrips')}</strong>
          <p>{t('tracking.noTripsSub')}</p>
          <Link to="/trucks" className="ui-btn ui-btn-primary ui-btn-sm" style={{ marginTop: 6 }}>
            <Icon name="truck" size={14} /> Book a truck
          </Link>
        </div>
      ) : (
        <div className="trk-layout">
          <div className="ui-card trk-list-card">
            <div className="ui-card-head">
              <div>
                <h3><Icon name="tracking" size={16} />{t('tracking.trips')}</h3>
                <p>{visible.length} {showClosed ? t('tracking.total') : t('tracking.activeCompleted')}</p>
              </div>
              <span className="trk-live"><i />{t('tracking.autoRefresh')}</span>
            </div>
            <div className="trk-list">
              {visible.map((booking) => (
                <button
                  type="button"
                  key={booking.id}
                  className={`trk-item ${selectedId === booking.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(booking.id)}
                >
                  <span className="trk-item-icon"><Icon name="truck" size={16} /></span>
                  <span className="trk-item-main">
                    <strong>{booking.crop_name || t('common.generalGoods')} · {kg(booking.quantity_kg)}</strong>
                    <small>{booking.pickup_location} → {booking.market_name}</small>
                    <span>{booking.vehicle_number} · {when(booking.pickup_at)}</span>
                  </span>
                  <span className={`ui-badge ui-badge-${isActiveTrip(booking.status) ? 'blue' : booking.status === 'delivered' ? 'green' : 'red'}`}>
                    {statusLabel(booking.status)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="trk-main">
            {selected && (
              <>
                <div className="ui-card trk-map-card">
                  <div className="ui-card-head">
                    <div>
                      <h3><Icon name="route" size={16} />{t('tracking.tripMap')}</h3>
                      <p>{t('tracking.estimatedTravel', [selected.distance_km, selected.eta_minutes])}</p>
                    </div>
                    <span className={`ui-badge ui-badge-${isActive ? 'blue' : selected.status === 'delivered' ? 'green' : 'red'}`}>
                      {statusLabel(selected.status)}
                    </span>
                  </div>
                  <div className="ui-card-body">
                    <TripMap markets={markets} booking={selected} market={market} />
                  </div>
                </div>

                <div className="ui-card trk-detail-card">
                  <div className="ui-card-head">
                    <div>
                      <h3><Icon name="truck" size={16} /> {selected.vehicle_number} · {selected.truck_type}</h3>
                      <p>{selected.crop_name || t('common.generalGoods')} → {selected.market_name}</p>
                    </div>
                    {isActive && canShare && NEXT[selected.status] && (
                      <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={advance} disabled={busy}>
                        {t('tracking.markStatus', [statusLabel(NEXT[selected.status])])}
                      </button>
                    )}
                  </div>
                  <div className="ui-card-body trk-detail-body">
                    <div className="trk-timeline">
                      {STEPS.map(([value, label], index) => {
                        const done = statusIndex >= index && isActive
                        const current = selected.status === value
                        return (
                          <div key={value} className={`trk-step ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                            <span className="trk-step-dot">{done ? <Icon name="check" size={11} /> : index + 1}</span>
                            <span className="trk-step-label">{t(label)}</span>
                          </div>
                        )
                      })}
                    </div>

                    <div className="trk-info">
                      <div><span>{t('role.farmer')}</span><strong>{selected.farmer_name || t('common.you')}</strong></div>
                      <div><span>{t('common.pickup')}</span><strong>{selected.pickup_location}</strong></div>
                      <div><span>{t('tracking.pickupTime')}</span><strong>{when(selected.pickup_at)}</strong></div>
                      <div><span>{t('common.quantity')}</span><strong>{kg(selected.quantity_kg)}</strong></div>
                      <div><span>{t('tracking.transportCost')}</span><strong>₹{Number(selected.estimated_transport_cost).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong></div>
                      <div><span>{t('tracking.lastReported')}</span><strong>{when(selected.last_reported_at)}</strong></div>
                    </div>

                    {isActive && canShare && (
                      <form className="trk-share" onSubmit={shareLocation}>
                        <div className="trk-share-head">
                          <strong><Icon name="tracking" size={14} />{t('tracking.shareLocation')}</strong>
                          <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={useMyLocation}>
                            Use my location
                          </button>
                        </div>
                        <div className="trk-share-grid">
                          <label className="ui-field">
                            <span className="ui-label">{t('tracking.latitude')}</span>
                            <input className="ui-input" type="number" step="0.000001" value={loc.lat} onChange={(event) => setLoc((prev) => ({ ...prev, lat: event.target.value }))} placeholder="9.9312" />
                          </label>
                          <label className="ui-field">
                            <span className="ui-label">{t('tracking.longitude')}</span>
                            <input className="ui-input" type="number" step="0.000001" value={loc.lng} onChange={(event) => setLoc((prev) => ({ ...prev, lng: event.target.value }))} placeholder="77.5018" />
                          </label>
                          <label className="ui-field trk-share-wide">
                            <span className="ui-label">{t('tracking.locationLabel')}</span>
                            <input className="ui-input" value={loc.location} onChange={(event) => setLoc((prev) => ({ ...prev, location: event.target.value }))} placeholder={t('tracking.locationPlaceholder')} />
                          </label>
                        </div>
                        <label className="trk-consent">
                          <input type="checkbox" checked={loc.consent} onChange={(event) => setLoc((prev) => ({ ...prev, consent: event.target.checked }))} />
                          <span>{t('tracking.consent')}</span>
                        </label>
                        {locError && <div className="ui-alert ui-alert-error">{locError}</div>}
                        <div className="trk-share-actions">
                          <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy}>
                            {busy ? t('tracking.sharing') : t('tracking.shareUpdate')}
                          </button>
                        </div>
                      </form>
                    )}

                    {isActive && !canShare && (
                      <p className="trk-note">
                        <Icon name="info" size={13} />
                        {selected.location_consent
                          ? t('tracking.consentYes')
                          : t('tracking.consentNo')}
                      </p>
                    )}
                    {selected.status === 'delivered' && (
                      <p className="trk-note success">
                        <Icon name="check" size={13} /> Delivered {when(selected.delivered_at)}. Record the sale from My Bookings.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function isActiveTrip(status) {
  return ACTIVE.has(status)
}
