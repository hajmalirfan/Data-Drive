import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useLanguage } from '../context/LanguageContext'

const originIcon = L.divIcon({
  className: 'mf-origin-marker',
  html: '<span aria-hidden="true">🚜</span>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
})

const LAYERS = {
  map: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · routes OSRM',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Esri, Maxar, Earthstar Geographics · routes OSRM',
  },
}

const rupees = (value) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const duration = (minutes, language) => {
  const m = Math.round(minutes)
  const format = (unit, value) =>
    new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'short' }).format(value)
  return m >= 60 ? `${format('hour', Math.floor(m / 60))} ${format('minute', m % 60)}` : format('minute', m)
}

const svgProps = {
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
}
const ExpandIcon = () => <svg {...svgProps}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
const CloseIcon = () => <svg {...svgProps}><path d="M6 6l12 12M18 6L6 18" /></svg>
const LocateIcon = () => <svg {...svgProps}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>

function FitTo({ origin, points, selected }) {
  const map = useMap()
  const key = `${origin.lat},${origin.lng}|${points.length}`
  useEffect(() => {
    // Measure the (lazily mounted) container first, otherwise the fit uses a stale size.
    const timer = setTimeout(() => {
      map.invalidateSize()
      const bounds = L.latLngBounds([[origin.lat, origin.lng], ...points.map((p) => [p.lat, p.lng])])
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 11 })
    }, 80)
    return () => clearTimeout(timer)
  }, [key]) // eslint-disable-line
  useEffect(() => {
    if (selected) map.panTo([selected.lat, selected.lng], { animate: true })
  }, [selected?.key]) // eslint-disable-line
  return null
}

function ClickToSetOrigin({ onPick }) {
  useMapEvents({ click: (event) => onPick(event.latlng.lat, event.latlng.lng) })
  return null
}

/**
 * origin: {lat, lng, label}; markets: located markets (all); options: routed results;
 * picks: {best_profit: key, ...}; route: [[lat, lng]...] to the selected market.
 */
export default function MarketFinderMap({ origin, markets, options, picks, selectedKey, onSelect, route, onPickOrigin }) {
  const { t, lang } = useLanguage()
  const shellRef = useRef(null)
  const [map, setMap] = useState(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [layer, setLayer] = useState('map')
  const routed = Object.fromEntries(options.map((o) => [o.key, o]))
  const selected = routed[selectedKey]

  // Browser Fullscreen API, with a fixed-overlay fallback (e.g. iPhone Safari).
  const enterFullscreen = () => {
    const el = shellRef.current
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => setFullscreen(true))
    else setFullscreen(true)
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

  // Re-measure after the size changes, then frame the pickup point and compared markets.
  useEffect(() => {
    if (!map) return undefined
    const timer = setTimeout(() => {
      map.invalidateSize()
      const bounds = L.latLngBounds([[origin.lat, origin.lng], ...options.map((o) => [o.lat, o.lng])])
      if (bounds.isValid()) map.fitBounds(bounds, { padding: fullscreen ? [90, 60] : [24, 24], maxZoom: 11 })
    }, 120)
    return () => clearTimeout(timer)
  }, [fullscreen, map]) // eslint-disable-line

  const showRoute = () => {
    if (!map) return
    const points = route?.length ? route : [[origin.lat, origin.lng], ...(selected ? [[selected.lat, selected.lng]] : [])]
    map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 12 })
  }
  const otherLayer = layer === 'map' ? 'satellite' : 'map'

  return (
    <div ref={shellRef} className={`mf-map-shell ${fullscreen ? 'is-fullscreen' : ''}`}>
      <MapContainer className="mf-map" center={[origin.lat, origin.lng]} zoom={9} scrollWheelZoom ref={setMap}>
        <TileLayer key={layer} attribution={LAYERS[layer].attribution} url={LAYERS[layer].url} maxZoom={19} />
        <FitTo origin={origin} points={options} selected={selected} />
        <ClickToSetOrigin onPick={onPickOrigin} />

        {route && <Polyline positions={route} pathOptions={{ color: '#1a73e8', weight: 5, opacity: 0.85 }} />}

        {markets.filter((m) => !routed[m.key]).map((m) => (
          <CircleMarker
            key={m.key}
            center={[m.lat, m.lng]}
            radius={4}
            pathOptions={{ color: '#ffffff', weight: 1, fillColor: '#9aa69c', fillOpacity: 0.85 }}
          >
            <Tooltip>{m.market} · {rupees(m.modal_price)}/q</Tooltip>
          </CircleMarker>
        ))}

        {options.map((o) => {
          const isBest = picks?.best_profit === o.key
          const isSelected = o.key === selectedKey
          return (
            <CircleMarker
              key={o.key}
              center={[o.lat, o.lng]}
              radius={isSelected ? 11 : isBest ? 9 : 7}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: isBest ? '#e0a100' : isSelected ? '#1a73e8' : '#2a9d5c',
                fillOpacity: 1,
              }}
              eventHandlers={{ click: () => onSelect(o.key) }}
            >
              <Popup>
                <strong>{o.market}</strong><br />
                {o.district} · {o.road_km} km · {duration(o.drive_minutes, lang)}<br />
                {t('finder.modalLabel')} {rupees(o.modal_price)}/q (₹{o.price_per_kg}/kg)<br />
                {t('finder.netInHand')} <strong>{rupees(o.net)}</strong>
                {o.location_precision === 'district' && <><br /><em>{t('finder.locationApprox')}</em></>}
              </Popup>
            </CircleMarker>
          )
        })}

        <Marker position={[origin.lat, origin.lng]} icon={originIcon}>
          <Popup>{t('finder.pickupLabel')}: {origin.label}</Popup>
        </Marker>
      </MapContainer>

      {fullscreen && selected && (
        <div className="mf-gm-card">
          <span className={`mf-gm-card-icon ${picks?.best_profit === selected.key ? 'best' : ''}`} aria-hidden="true">
            {picks?.best_profit === selected.key ? '★' : '📍'}
          </span>
          <div className="mf-gm-card-main">
            <strong>{selected.market}</strong>
            <span>{selected.district}, {selected.state}</span>
            <small>
              <b>{rupees(selected.net)}</b> {t('finder.inHand')} · {selected.road_km} km · {duration(selected.drive_minutes, lang)} · ₹{selected.price_per_kg}/kg
            </small>
            <small className="mf-gm-muted">From {origin.label}</small>
          </div>
        </div>
      )}

      <button
        type="button"
        className="mf-gm-btn mf-gm-toggle"
        onClick={fullscreen ? exitFullscreen : enterFullscreen}
        title={fullscreen ? t('finder.exitFullScreen') : t('finder.fullScreen')}
        aria-label={fullscreen ? t('finder.exitFullScreen') : t('finder.fullScreen')}
      >
        {fullscreen ? <CloseIcon /> : <ExpandIcon />}
      </button>

      {fullscreen && (
        <>
          <button type="button" className="mf-gm-btn mf-gm-route" onClick={showRoute} title={t('finder.showRoute')} aria-label={t('finder.showRoute')}>
            <LocateIcon />
          </button>
          <button
            type="button"
            className={`mf-gm-layer mf-gm-layer-${otherLayer}`}
            onClick={() => setLayer(otherLayer)}
            aria-label={otherLayer === 'satellite' ? t('finder.satelliteView') : t('finder.mapView')}
          >
            <span>{otherLayer === 'satellite' ? t('finder.satelliteView') : t('finder.mapView')}</span>
          </button>
        </>
      )}
    </div>
  )
}
