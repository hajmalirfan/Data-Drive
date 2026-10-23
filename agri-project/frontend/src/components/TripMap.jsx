import { useEffect } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useLanguage } from '../context/LanguageContext'

const truckIcon = L.divIcon({
  className: 'trk-truck-marker',
  html: '<span aria-hidden="true">🚚</span>',
  iconSize: [38, 38],
  iconAnchor: [19, 19],
})

function MapCenter({ center }) {
  const map = useMap()
  const [latitude, longitude] = center

  useEffect(() => {
    map.setView([latitude, longitude], map.getZoom())
  }, [latitude, longitude, map])

  return null
}

export default function TripMap({ booking, market }) {
  const { t } = useLanguage()
  const locationAvailable = (
    booking.location_consent
    && ['picked_up', 'in_transit'].includes(booking.status)
    && booking.last_lat !== null
    && booking.last_lng !== null
  )
  const center = locationAvailable
    ? [Number(booking.last_lat), Number(booking.last_lng)]
    : market
      ? [Number(market.latitude), Number(market.longitude)]
      : [20.5937, 78.9629]

  return (
    <MapContainer className="trk-map" center={center} zoom={locationAvailable ? 15 : 8} scrollWheelZoom>
      <MapCenter center={center} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {market && (
        <CircleMarker center={[Number(market.latitude), Number(market.longitude)]} radius={8}>
          <Popup>{market.name} · {t('common.destination')}</Popup>
        </CircleMarker>
      )}
      {locationAvailable ? (
        <Marker position={center} icon={truckIcon}>
          <Popup>{t('tracking.lastReportedLocation')}</Popup>
        </Marker>
      ) : (
        <div className="trk-map-status">
          <span aria-hidden="true">ⓘ</span>{t('tracking.noLocation')}
        </div>
      )}
    </MapContainer>
  )
}
