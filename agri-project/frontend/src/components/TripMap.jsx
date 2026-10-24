import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useLanguage } from '../context/LanguageContext'

const truckIcon = L.divIcon({
  className: 'trk-truck-marker',
  html: '<span aria-hidden="true">🚚</span>',
  iconSize: [38, 38],
  iconAnchor: [19, 19],
})

const LAYERS = {
  map: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics',
  },
}

const svgProps = {
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
}
const ExpandIcon = () => <svg {...svgProps}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
const CloseIcon = () => <svg {...svgProps}><path d="M6 6l12 12M18 6L6 18" /></svg>
const PlusIcon = () => <svg {...svgProps}><path d="M12 5v14M5 12h14" /></svg>
const MinusIcon = () => <svg {...svgProps}><path d="M5 12h14" /></svg>
const LocateIcon = () => (
  <svg {...svgProps}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
)

// A fix is "live" while it is younger than three missed 15 s updates.
const STALE_AFTER_MS = 45000

function MapCenter({ center, follow }) {
  const map = useMap()
  const [latitude, longitude] = center

  useEffect(() => {
    // Follow the moving truck smoothly; jump only when the view is first placed.
    if (follow) map.panTo([latitude, longitude], { animate: true, duration: 0.8 })
    else map.setView([latitude, longitude], map.getZoom())
  }, [latitude, longitude, map]) // eslint-disable-line

  return null
}

function useNow(active) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

const timeOf = (value) => (value ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime() : null)

export default function TripMap({ booking, market, trail }) {
  const { t, statusLabel } = useLanguage()
  const shellRef = useRef(null)
  const [map, setMap] = useState(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [layer, setLayer] = useState('map')

  const points = trail?.sharing ? trail.points.map((point) => [Number(point.lat), Number(point.lng)]) : []
  const latestPoint = trail?.sharing ? trail.points[trail.points.length - 1] : null
  const locationAvailable = Boolean(latestPoint) || (
    booking.location_consent
    && ['picked_up', 'in_transit'].includes(booking.status)
    && booking.last_lat !== null
    && booking.last_lng !== null
  )
  const truckAt = latestPoint
    ? [Number(latestPoint.lat), Number(latestPoint.lng)]
    : [Number(booking.last_lat), Number(booking.last_lng)]
  const reportedAt = timeOf(latestPoint?.recorded_at || trail?.last_reported_at || booking.last_reported_at)
  const now = useNow(locationAvailable)
  const ageMs = reportedAt ? Math.max(0, now - reportedAt) : null
  const stale = ageMs !== null && ageMs > STALE_AFTER_MS
  const center = locationAvailable
    ? truckAt
    : market
      ? [Number(market.latitude), Number(market.longitude)]
      : [20.5937, 78.9629]
  const defaultZoom = locationAvailable ? 15 : 8

  // Prefer the browser Fullscreen API; fall back to a fixed overlay (e.g. iPhone Safari).
  const enterFullscreen = () => {
    const el = shellRef.current
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => setFullscreen(true))
    } else {
      setFullscreen(true)
    }
  }

  const exitFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    setFullscreen(false)
  }

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === shellRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  useEffect(() => {
    if (!fullscreen) return undefined
    const onKey = (event) => { if (event.key === 'Escape') exitFullscreen() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [fullscreen])

  // Leaflet must re-measure after the container size changes.
  useEffect(() => {
    if (!map) return undefined
    const timer = setTimeout(() => map.invalidateSize(), 60)
    return () => clearTimeout(timer)
  }, [fullscreen, map])

  const recenter = () => map?.flyTo(center, Math.max(map.getZoom(), defaultZoom), { duration: 0.6 })
  const otherLayer = layer === 'map' ? 'satellite' : 'map'

  return (
    <div ref={shellRef} className={`trk-map-shell ${fullscreen ? 'is-fullscreen' : ''}`}>
      <MapContainer
        className="trk-map"
        center={center}
        zoom={defaultZoom}
        scrollWheelZoom={fullscreen}
        zoomControl={false}
        ref={setMap}
      >
        <MapCenter center={center} follow={locationAvailable} />
        <TileLayer key={layer} attribution={LAYERS[layer].attribution} url={LAYERS[layer].url} maxZoom={19} />
        {market && (
          <CircleMarker center={[Number(market.latitude), Number(market.longitude)]} radius={8}>
            <Popup>{market.name} · {t('common.destination')}</Popup>
          </CircleMarker>
        )}
        {points.length > 1 && (
          <Polyline positions={points} pathOptions={{ color: '#1a73e8', weight: 5, opacity: 0.8 }} />
        )}
        {points.length > 1 && (
          <CircleMarker center={points[0]} radius={5} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1 }}>
            <Popup>{t('common.pickup')}</Popup>
          </CircleMarker>
        )}
        {locationAvailable && (
          <Marker position={truckAt} icon={truckIcon}>
            <Popup>
              {t('tracking.lastReportedLocation')}<br />
              {truckAt[0].toFixed(5)}, {truckAt[1].toFixed(5)}
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {locationAvailable && ageMs !== null && (
        <div className={`trk-live-pill ${stale ? 'stale' : ''}`} role="status">
          <span className="live-share-dot" aria-hidden="true" />
          {stale
            ? t('live.staleMin', [Math.max(1, Math.round(ageMs / 60000))])
            : t('live.liveAgo', [Math.round(ageMs / 1000)])}
        </div>
      )}
      {trail?.sharing && !latestPoint && !locationAvailable && (
        <div className="trk-live-pill" role="status">{t('live.waitingFirst')}</div>
      )}

      {fullscreen ? (
        <div className="trk-gm-card">
          <div className="trk-gm-card-icon" aria-hidden="true">🚚</div>
          <div className="trk-gm-card-main">
            <strong>{booking.vehicle_number}{booking.truck_type ? ` · ${booking.truck_type}` : ''}</strong>
            <span>{booking.crop_name || t('common.generalGoods')} → {booking.market_name || market?.name}</span>
            <small>
              <b className={`trk-gm-status trk-gm-status-${booking.status}`}>{statusLabel(booking.status)}</b>
              {booking.distance_km != null && ` · ${t('tracking.estimatedTravel', [booking.distance_km, booking.eta_minutes])}`}
            </small>
            {!locationAvailable && <small className="trk-gm-muted">ⓘ {t('tracking.noLocation')}</small>}
          </div>
        </div>
      ) : (
        !locationAvailable && (
          <div className="trk-map-status">
            <span aria-hidden="true">ⓘ</span>{t('tracking.noLocation')}
          </div>
        )
      )}

      <button
        type="button"
        className="trk-gm-btn trk-gm-toggle"
        onClick={fullscreen ? exitFullscreen : enterFullscreen}
        title={fullscreen ? t('tracking.exitFullscreen') : t('tracking.fullscreen')}
        aria-label={fullscreen ? t('tracking.exitFullscreen') : t('tracking.fullscreen')}
      >
        {fullscreen ? <CloseIcon /> : <ExpandIcon />}
      </button>

      <div className="trk-gm-controls">
        {fullscreen && (
          <button type="button" className="trk-gm-btn" onClick={recenter} title={t('tracking.recenter')} aria-label={t('tracking.recenter')}>
            <LocateIcon />
          </button>
        )}
        <div className="trk-gm-zoom">
          <button type="button" onClick={() => map?.zoomIn()} title={t('tracking.zoomIn')} aria-label={t('tracking.zoomIn')}><PlusIcon /></button>
          <button type="button" onClick={() => map?.zoomOut()} title={t('tracking.zoomOut')} aria-label={t('tracking.zoomOut')}><MinusIcon /></button>
        </div>
      </div>

      {fullscreen && (
        <button
          type="button"
          className={`trk-gm-layer trk-gm-layer-${otherLayer}`}
          onClick={() => setLayer(otherLayer)}
          aria-label={t(otherLayer === 'satellite' ? 'tracking.satelliteView' : 'tracking.mapView')}
        >
          <span>{t(otherLayer === 'satellite' ? 'tracking.satelliteView' : 'tracking.mapView')}</span>
        </button>
      )}
    </div>
  )
}
