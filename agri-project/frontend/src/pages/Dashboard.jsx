import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getDashboard } from '../services/operationsService'
import Icon from '../components/Icons'
import Modal from '../components/Modal'
import DriverDashboard from './DriverDashboard'
import AdminDashboard from './AdminDashboard'
import './Dashboard.css'
import { useLanguage } from '../context/LanguageContext'
import { formatIndiaDate } from '../utils/dateTime'

const inr = (value) =>
  value === null || value === undefined
    ? '—'
    : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const kg = (value) =>
  value === null || value === undefined
    ? '—'
    : `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
const shortDate = (value) =>
  value ? formatIndiaDate(value, { day: 'numeric', month: 'short' }) : '—'
const STATUS_STYLES = {
  available: 'green',
  sold: 'blue',
  reserved: 'amber',
  in_transit: 'amber',
  requested: 'amber',
  delivered: 'green',
  cancelled: 'red',
}

function statusTone(status) {
  return STATUS_STYLES[(status || '').toLowerCase()] || 'grey'
}

function RevenueChart({ history }) {
  const { t, lang } = useLanguage()
  const values = history.map((entry) => Number(entry.revenue) || 0)
  const max = Math.max(...values, 1)
  const points = history.map((entry, index) => {
    const x = history.length > 1 ? 36 + (index * 628) / (history.length - 1) : 350
    const y = 174 - ((Number(entry.revenue) || 0) / max) * 142
    return { ...entry, x, y }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = points.length ? `36,174 ${line} 664,174` : ''
  const total = values.reduce((sum, value) => sum + value, 0)
  const monthLabel = (value) => {
    const [year, month] = value.split('-').map(Number)
    return new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, 1)))
  }

  return (
    <section className="ui-card dbm-revenue-card">
      <div className="ui-card-head">
        <div>
          <h3><Icon name="prices" size={16} />{t('dash.revenueTitle')}</h3>
          <p>{t('dash.revenueSub')}</p>
        </div>
        <div className="dbm-revenue-total">
          <small>{t('dash.revenueSixMonths')}</small>
          <strong>{inr(total)}</strong>
        </div>
      </div>
      <div className="ui-card-body">
        {total <= 0 ? (
          <div className="ui-empty dbm-revenue-empty">
            <span className="ui-empty-icon"><Icon name="prices" size={21} /></span>
            <strong>{t('dash.revenueEmpty')}</strong>
            <p>{t('dash.revenueEmptySub')}</p>
          </div>
        ) : (
          <div className="dbm-revenue-chart">
            <svg viewBox="0 0 700 216" role="img" aria-label={t('dash.revenueTitle')}>
              <defs>
                <linearGradient id="revenue-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#2e9654" stopOpacity=".22" />
                  <stop offset="100%" stopColor="#2e9654" stopOpacity=".02" />
                </linearGradient>
              </defs>
              {[32, 79, 126, 174].map((y) => (
                <line key={y} x1="36" x2="664" y1={y} y2={y} className="dbm-revenue-gridline" />
              ))}
              <polygon points={area} fill="url(#revenue-fill)" />
              <polyline points={line} className="dbm-revenue-line" />
              {points.map((point) => (
                <g key={point.month}>
                  <circle cx={point.x} cy={point.y} r="4" className="dbm-revenue-point">
                    <title>{`${monthLabel(point.month)}: ${inr(point.revenue)}`}</title>
                  </circle>
                  <text x={point.x} y="204" textAnchor="middle" className="dbm-revenue-label">
                    {monthLabel(point.month)}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>
    </section>
  )
}

function MarketMap({ markets }) {
  const { t } = useLanguage()
  const locatedMarkets = useMemo(() => markets.filter((market) => {
    const latitude = Number(market.latitude)
    const longitude = Number(market.longitude)
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= -90 && latitude <= 90
      && longitude >= -180 && longitude <= 180
      && (latitude !== 0 || longitude !== 0)
  }), [markets])

  const center = locatedMarkets.length
    ? [Number(locatedMarkets[0].latitude), Number(locatedMarkets[0].longitude)]
    : [11, 78]
  const nearestId = [...locatedMarkets].sort((a, b) => a.distance_km - b.distance_km)[0]?.id
  return (
    <MapContainer
      className="dbm-map"
      center={center}
      zoom={locatedMarkets.length ? 8 : 6}
      scrollWheelZoom={false}
      aria-label={t('dash.mapLabel')}
    >
      <TileLayer
        attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}
        url={'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'}
        maxZoom={19}
      />
      {locatedMarkets.map((market) => (
        <CircleMarker
          key={market.id}
          center={[Number(market.latitude), Number(market.longitude)]}
          radius={market.id === nearestId ? 9 : 7}
          pathOptions={{
            color: '#ffffff',
            weight: 2,
            fillColor: market.id === nearestId ? '#218a4d' : '#668b71',
            fillOpacity: 1,
          }}
        >
          <Popup>
            <strong>{market.name}</strong><br />
            {market.district}, {market.state}<br />
            {Number(market.distance_km).toFixed(0)} km · {market.eta_minutes} min
          </Popup>
        </CircleMarker>
      ))}
      <MarketMapViewport markets={locatedMarkets} />
    </MapContainer>
  )
}

function MarketMapViewport({ markets }) {
  const map = useMap()
  const marketKey = markets
    .map((market) => `${market.id}:${market.latitude}:${market.longitude}`)
    .join('|')

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize()
      if (markets.length === 1) {
        map.setView([Number(markets[0].latitude), Number(markets[0].longitude)], 10)
      } else if (markets.length > 1) {
        const bounds = L.latLngBounds(
          markets.map((market) => [Number(market.latitude), Number(market.longitude)]),
        )
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 11 })
      }
    }, 80)
    return () => clearTimeout(timer)
  }, [map, marketKey]) // eslint-disable-line

  return null
}

function FarmerDashboard() {
  const { t, statusLabel } = useLanguage()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [driverTruck, setDriverTruck] = useState(null)

  const load = () => {
    setLoading(true)
    setError('')
    getDashboard()
      .then((payload) => {
        setData(payload)
      })
      .catch((err) => setError(err.response?.data?.detail || t('dash.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const stats = data?.stats || {}
  const crops = data?.crops || []
  const markets = data?.markets || []
  const trucks = data?.trucks || []
  const revenueHistory = data?.revenue_history || []
  const bestPrice = stats.best_price

  if (loading) {
    return (
      <div className="dbm-skeleton">
        <div className="ui-skeleton" style={{ height: 176, borderRadius: 18 }} />
        <div className="dbm-skeleton-kpis">
          {[0, 1, 2, 3].map((item) => <div key={item} className="ui-skeleton" style={{ height: 108 }} />)}
        </div>
        <div className="dbm-skeleton-kpis">
          <div className="ui-skeleton" style={{ height: 320, gridColumn: 'span 2' }} />
          <div className="ui-skeleton" style={{ height: 320 }} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ui-card ui-empty">
        <span className="ui-empty-icon"><Icon name="info" size={22} /></span>
        <strong>{t('dash.unavailable')}</strong>
        <p>{error}</p>
        <button type="button" className="ui-btn ui-btn-primary" onClick={load} style={{ marginTop: 8 }}>
          <Icon name="refresh" size={15} /> Try again
        </button>
      </div>
    )
  }

  return (
    <div className="dbm ui-page">
      <section className="dbm-kpis" aria-label={t('dash.keyNumbers')}>
        <Link to="/crops" className="dbm-kpi ui-card">
          <span className="dbm-kpi-icon green"><Icon name="package" size={19} /></span>
          <span className="dbm-kpi-copy">
            <small>{t('dash.kpiTotalStock')}</small>
            <strong>{kg(stats.total_stock_kg)}</strong>
            <span>{stats.crop_count ?? 0} crop listings</span>
          </span>
          <span className="dbm-kpi-go"><Icon name="arrowRight" size={14} /></span>
        </Link>
        <Link to="/market-prices" className="dbm-kpi ui-card">
          <span className="dbm-kpi-icon amber"><Icon name="prices" size={19} /></span>
          <span className="dbm-kpi-copy">
            <small>{t('dash.kpiBestPrice')}</small>
            <strong>{bestPrice ? `₹${Number(bestPrice.price_per_kg).toFixed(1)}/kg` : '—'}</strong>
            <span>
              {bestPrice
                ? `${bestPrice.crop_name} · ${bestPrice.market_name}`
                : t('dash.addMarketPrices')}
            </span>
          </span>
          <span className="dbm-kpi-go"><Icon name="arrowRight" size={14} /></span>
        </Link>
        <Link to="/trucks" className="dbm-kpi ui-card">
          <span className="dbm-kpi-icon blue"><Icon name="truck" size={19} /></span>
          <span className="dbm-kpi-copy">
            <small>{t('dash.kpiAvailableTrucks')}</small>
            <strong>{stats.available_trucks ?? 0}</strong>
            <span>{stats.active_bookings ?? 0} active bookings</span>
          </span>
          <span className="dbm-kpi-go"><Icon name="arrowRight" size={14} /></span>
        </Link>
      </section>

      <section className="dbm-stock-map">
        <div className="ui-card dbm-stock-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="crops" size={16} />{t('dash.myCropStock')}</h3>
              <p>{t('dash.cropStockSub')}</p>
            </div>
            <Link to="/crops" className="ui-link">{t('common.viewAll')}</Link>
          </div>
          <div className="ui-card-body">
            {crops.length === 0 ? (
              <div className="ui-empty">
                <span className="ui-empty-icon"><Icon name="crops" size={22} /></span>
                <strong>{t('dash.noCropStock')}</strong>
                <p>{t('dash.noCropStockSub')}</p>
                <Link to="/crops" className="ui-btn ui-btn-primary ui-btn-sm" style={{ marginTop: 6 }}>
                  <Icon name="plus" size={14} /> Add crop
                </Link>
              </div>
            ) : (
              <div className="ui-table-wrap">
                <table className="ui-table dbm-stock-table">
                  <thead>
                    <tr>
                      <th>{t('common.crop')}</th>
                      <th>{t('common.quantity')}</th>
                      <th>{t('dash.thGrade')}</th>
                      <th>{t('dash.thHarvest')}</th>
                      <th>{t('common.status')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {crops.slice(0, 4).map((crop) => (
                      <tr key={crop.id}>
                        <td>
                          <span className="dbm-crop-cell">
                            <span className="dbm-crop-icon"><Icon name="leaf" size={14} /></span>
                            <span>
                              <strong>{crop.crop_name}</strong>
                              <small>{crop.variety || crop.pickup_location}</small>
                            </span>
                          </span>
                        </td>
                        <td>{kg(crop.quantity_kg)}</td>
                        <td>{crop.grade || '—'}</td>
                        <td className="muted">{shortDate(crop.harvest_date)}</td>
                        <td><span className={`ui-badge ui-badge-${statusTone(crop.status)}`}>{statusLabel(crop.status)}</span></td>
                        <td>
                          <Link to="/crops" className="dbm-row-link" aria-label={t('dash.openCrop', [crop.crop_name])}>
                            <Icon name="arrowRight" size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="ui-card dbm-map-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="markets" size={16} />{t('dash.nearbyMarkets')}</h3>
              <p>{markets.length} mandis with recorded prices</p>
            </div>
            <Link to="/markets" className="ui-link">{t('dash.explore')}</Link>
          </div>
          <div className="ui-card-body dbm-map-body">
            {markets.length === 0 ? (
              <div className="ui-empty"><strong>{t('dash.noMarkets')}</strong></div>
            ) : (
              <>
                <MarketMap markets={markets} />
                <div className="dbm-nearest-list">
                  {[...markets].sort((a, b) => a.distance_km - b.distance_km).slice(0, 3).map((market) => (
                    <Link key={market.id} to="/markets" className="dbm-nearest-item">
                      <span>
                        <strong>{market.name}</strong>
                        <small>{market.district}</small>
                      </span>
                      <span>
                        <strong>{Number(market.distance_km).toFixed(0)} km</strong>
                        <small>{market.eta_minutes} min</small>
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="dbm-bottom">
        <RevenueChart history={revenueHistory} />
        <div className="ui-card">
          <div className="ui-card-body">
            {trucks.length === 0 ? (
              <div className="ui-empty">
                <span className="ui-empty-icon"><Icon name="truck" size={21} /></span>
                <strong>{t('dash.noTrucks')}</strong>
                <p>{t('dash.noTrucksSub')}</p>
              </div>
            ) : (
              <div className="dbm-truck-list">
                {trucks.slice(0, 4).map((truck) => (
                  <div key={truck.id} className="dbm-truck-card">
                    <span className="dbm-truck-art"><Icon name="truck" size={21} /></span>
                    <div className="dbm-truck-info">
                      <div className="dbm-truck-top-line" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong>{truck.vehicle_number}</strong>
                        <span className="ui-badge ui-badge-green" style={{ fontSize: '8px', padding: '1px 5px' }}>
                          <Icon name="check" size={8} /> Verified
                        </span>
                      </div>
                      <small>{truck.truck_type} · {kg(truck.available_capacity_kg)} free</small>
                      <small>{truck.route_from || t('common.local')} → {truck.route_to || t('common.anyMandi')}</small>
                      <div className="dbm-truck-driver-bar" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '9.5px', color: '#274b34', fontWeight: 700 }}>
                          <Icon name="profile" size={10} /> {truck.operator_name || 'Transport Operator'}
                        </span>
                        {truck.operator_phone && (
                          <a
                            href={`tel:${truck.operator_phone}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '9px', color: '#1a6f3b', fontWeight: 700, textDecoration: 'none' }}
                            title="Call driver"
                          >
                            <Icon name="phone" size={9} /> {truck.operator_phone}
                          </a>
                        )}
                        {(truck.operator_location || truck.last_location) && (
                          <small style={{ fontSize: '9px', color: '#748679' }}>
                            <Icon name="markets" size={9} /> {truck.operator_location || truck.last_location}
                          </small>
                        )}
                      </div>
                    </div>
                    <div className="dbm-truck-side-action" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span className="dbm-truck-rate">
                        <strong>₹{Number(truck.price_per_km).toFixed(0)}</strong>
                        <small>{t('dash.perKm')}</small>
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          type="button"
                          className="ui-btn ui-btn-outline ui-btn-sm"
                          style={{ fontSize: '9px', padding: '2px 6px' }}
                          onClick={() => setDriverTruck(truck)}
                        >
                          <Icon name="profile" size={10} /> Driver
                        </button>
                        <Link
                          to="/trucks"
                          className="ui-btn ui-btn-primary ui-btn-sm"
                          style={{ fontSize: '9px', padding: '2px 6px' }}
                        >
                          Book <Icon name="arrowRight" size={9} />
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {driverTruck && (
        <Modal
          title={driverTruck.operator_name || 'Driver Details'}
          subtitle={`${driverTruck.vehicle_number} · ${driverTruck.truck_type}`}
          onClose={() => setDriverTruck(null)}
          size="md"
          footer={(
            <>
              {driverTruck.operator_phone && (
                <a href={`tel:${driverTruck.operator_phone}`} className="ui-btn ui-btn-outline">
                  <Icon name="phone" size={13} /> Call {driverTruck.operator_phone}
                </a>
              )}
              <Link to="/trucks" className="ui-btn ui-btn-primary" onClick={() => setDriverTruck(null)}>
                Book this truck <Icon name="arrowRight" size={13} />
              </Link>
            </>
          )}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#edf6ec', borderRadius: 10, border: '1px solid #dce8d8' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#25663d', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="profile" size={24} />
              </div>
              <div>
                <strong style={{ fontSize: '14px', color: '#1a3423', display: 'block' }}>{driverTruck.operator_name || 'Verified Transport Driver'}</strong>
                <span style={{ fontSize: '10.5px', color: '#617768' }}>Transport Operator · ID #{driverTruck.operator_id || driverTruck.id}</span>
                {driverTruck.operator_phone && (
                  <div style={{ marginTop: 3 }}>
                    <a href={`tel:${driverTruck.operator_phone}`} style={{ fontSize: '11px', color: '#19703d', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon name="phone" size={11} /> {driverTruck.operator_phone}
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, padding: 10, background: '#f9fbf7', borderRadius: 8, border: '1px solid #e8eee5' }}>
              <div><span style={{ fontSize: '8.5px', color: '#909f94', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>Vehicle</span><strong style={{ fontSize: '11px', color: '#273c2e' }}>{driverTruck.vehicle_number} ({driverTruck.truck_type})</strong></div>
              <div><span style={{ fontSize: '8.5px', color: '#909f94', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>Free Capacity</span><strong style={{ fontSize: '11px', color: '#273c2e' }}>{kg(driverTruck.available_capacity_kg)}</strong></div>
              <div><span style={{ fontSize: '8.5px', color: '#909f94', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>Base Location</span><strong style={{ fontSize: '11px', color: '#273c2e' }}>{driverTruck.operator_location || driverTruck.route_from || 'Tamil Nadu'}</strong></div>
              <div><span style={{ fontSize: '8.5px', color: '#909f94', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>Route</span><strong style={{ fontSize: '11px', color: '#273c2e' }}>{driverTruck.route_from || 'Local'} → {driverTruck.route_to || 'Any Mandi'}</strong></div>
              <div><span style={{ fontSize: '8.5px', color: '#909f94', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>Fare Rate</span><strong style={{ fontSize: '11px', color: '#273c2e' }}>₹{inr(driverTruck.base_fare)} + ₹{Number(driverTruck.price_per_km).toFixed(0)}/km</strong></div>
              <div><span style={{ fontSize: '8.5px', color: '#909f94', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>Passenger Travel</span><strong style={{ fontSize: '11px', color: '#273c2e' }}>{driverTruck.has_passenger_seat ? 'Seat Available' : 'Cargo Only'}</strong></div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { isTruckOperator, isAdmin } = useAuth()
  if (isAdmin) return <AdminDashboard />
  return isTruckOperator ? <DriverDashboard /> : <FarmerDashboard />
}
