import { Suspense, lazy, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLiveShare } from '../context/LiveShareContext'
import Icon from '../components/Icons'
const TripMap = lazy(() => import('../components/TripMap'))
import {
  getBookingTrack,
  getBookings,
  getMarkets,
  updateBookingLocation,
  updateBookingStatus,
} from '../services/operationsService'
import './Tracking.css'
import { useLanguage } from '../context/LanguageContext'
import { formatIndiaDateTime } from '../utils/dateTime'

const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} kg`
const when = (value, useLocalTime) =>
  value
    ? (useLocalTime
      ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
      : formatIndiaDateTime(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))
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

export default function Tracking() {
  const { t, statusLabel } = useLanguage()
  const { isAdmin, isTruckOperator } = useAuth()
  const [bookings, setBookings] = useState([])
  const [markets, setMarkets] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loc, setLoc] = useState({ lat: '', lng: '', location: '', consent: false })
  const [locError, setLocError] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [trail, setTrail] = useState({ bookingId: null, points: [] })
  const live = useLiveShare()

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
    const timer = setInterval(() => {
      getBookings()
        .then(setBookings)
        .catch((err) => setError(err.response?.data?.detail || t('tracking.loadError')))
    }, 5000)
    return () => clearInterval(timer)
  }, []) // eslint-disable-line

  const selected = bookings.find((item) => item.id === selectedId)
  const market = selected ? markets.find((item) => item.id === selected.market_id) : null
  const visible = showClosed ? bookings : bookings.filter((item) => ACTIVE.has(item.status) || item.status === 'delivered')
  const statusIndex = selected ? STEPS.findIndex(([value]) => value === selected.status) : -1
  const isActive = selected ? ACTIVE.has(selected.status) : false
  useEffect(() => {
    setLoc((prev) => ({ ...prev, consent: Boolean(selected?.location_consent) }))
  }, [selectedId, selected?.location_consent])

  const canLiveShare = (
    canShare && selected && ['picked_up', 'in_transit'].includes(selected.status)
  )

  const gpsSharing = Boolean(selected && live?.bookingId === selected.id)
  const sharingOther = Boolean(live?.bookingId && selected && live.bookingId !== selected.id)

  // Live trail: re-read every 5 s so a fix sent every 15 s shows on the map within seconds.
  const trackable = Boolean(selected && ['picked_up', 'in_transit'].includes(selected.status))
  useEffect(() => {
    setTrail({ bookingId: null, points: [] })
    if (!trackable) return undefined
    let cancelled = false
    const pull = () => getBookingTrack(selectedId)
      .then((data) => { if (!cancelled) setTrail({ bookingId: selectedId, ...data }) })
      .catch(() => {})
    pull()
    const timer = setInterval(pull, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [selectedId, trackable])
  const selectedTrail = trail.bookingId === selectedId ? trail : null

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
    if (loc.consent && (loc.lat === '' || loc.lng === '')) {
      setLocError(t('tracking.errCoords'))
      return
    }
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

  const startGpsSharing = (consentGiven = loc.consent) => {
    setLocError('')
    if (!selected || !canLiveShare) { setLocError(t('tracking.startAfterTrip')); return }
    if (!consentGiven) { setLocError(t('tracking.consentRequired')); return }
    if (!navigator.geolocation) { setLocError(t('tracking.geoUnavailable')); return }
    if (sharingOther) { setLocError(t('live.sharingOther', [live.bookingId])); return }
    live.start(selected.id)
  }

  const stopGpsSharing = async () => {
    setLocError('')
    setBusy(true)
    try {
      const updated = await live.stop()
      if (updated) setBookings((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setLoc((prev) => ({ ...prev, lat: '', lng: '', consent: false }))
    } catch (err) {
      setLocError(err.response?.data?.detail || t('tracking.locationError'))
    } finally {
      setBusy(false)
    }
  }

  const changeLocationConsent = (consent) => {
    setLoc((prev) => ({ ...prev, consent }))
    if (consent) startGpsSharing(true)
    else if (gpsSharing) stopGpsSharing()
  }

  const liveErrorKey = {
    geoPermissionDenied: 'tracking.geoPermissionDenied',
    geoUnavailable: 'tracking.geoUnavailable',
  }[live?.stoppedReason]

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
              <span className="trk-live"><i />{t('tracking.liveUpdates')}</span>
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
                    <span>{booking.vehicle_number} · {when(booking.pickup_at, isTruckOperator)}</span>
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
                    <Suspense fallback={<div className="trk-map trk-map-loading">{t('tracking.loading')}</div>}>
                      <TripMap booking={selected} market={market} trail={selectedTrail} />
                    </Suspense>
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
                      <div><span>{t('tracking.pickupTime')}</span><strong>{when(selected.pickup_at, isTruckOperator)}</strong></div>
                      <div><span>{t('common.quantity')}</span><strong>{kg(selected.quantity_kg)}</strong></div>
                      <div><span>{t('tracking.transportCost')}</span><strong>₹{Number(selected.estimated_transport_cost).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong></div>
                      <div><span>{t('tracking.lastReported')}</span><strong>{when(selected.last_reported_at, isTruckOperator)}</strong></div>
                    </div>

                    {canLiveShare && canShare && (
                      <form className="trk-share" onSubmit={shareLocation}>
                        <div className="trk-share-head">
                          <strong><Icon name="tracking" size={14} />{t('tracking.shareLocation')}</strong>
                          {canLiveShare && (
                            <div className="trk-share-actions">
                              {gpsSharing ? (
                                <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={stopGpsSharing} disabled={busy}>
                                  {t('tracking.pauseGps')}
                                </button>
                              ) : (
                                <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={startGpsSharing} disabled={busy}>
                                  {t('tracking.startGps')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="trk-share-grid">
                          <div className="trk-share-wide trk-gps-help">
                            {canLiveShare ? t('tracking.gpsBrowserNote') : t('tracking.startAfterTrip')}
                          </div>
                          <button type="button" className="ui-btn ui-btn-outline ui-btn-sm trk-share-wide" onClick={useMyLocation}>
                            {t('tracking.useMyLocation')}
                          </button>
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
                        {gpsSharing && live.lastFix && (
                          <div className="trk-live-fix">
                            <span className="live-share-dot" aria-hidden="true" />
                            {live.lastFix.lat.toFixed(6)}, {live.lastFix.lng.toFixed(6)}
                            {Number.isFinite(live.lastFix.accuracy) && ` · ±${Math.round(live.lastFix.accuracy)} m`}
                            {' · '}{t('live.trailPoints', [live.sentCount])}
                          </div>
                        )}
                        {!gpsSharing && live?.stoppedReason && (
                          <div className="ui-alert ui-alert-error">
                            {t('live.stopped', [liveErrorKey ? t(liveErrorKey) : live.stoppedReason])}
                          </div>
                        )}
                        {locError && <div className="ui-alert ui-alert-error">{locError}</div>}
                        <div className="trk-share-actions">
                          <button type="submit" className="ui-btn ui-btn-outline ui-btn-sm" disabled={busy}>
                            {busy ? t('tracking.sharing') : t('tracking.shareUpdate')}
                          </button>
                        </div>
                        <label className="trk-consent">
                          <input
                            type="checkbox"
                            checked={loc.consent || gpsSharing}
                            onChange={(event) => changeLocationConsent(event.target.checked)}
                          />
                          <span>{t('tracking.consent')}</span>
                        </label>
                      </form>
                    )}

                    {isActive && canShare && !canLiveShare && (
                      <p className="trk-note">
                        <Icon name="info" size={13} />
                        {t('tracking.startAfterTrip')}
                      </p>
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
                        <Icon name="check" size={13} /> Delivered {when(selected.delivered_at, isTruckOperator)}. Record the sale from My Bookings.
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
