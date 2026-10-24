import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { compareMarkets, getDashboard } from '../services/operationsService'
import Icon from '../components/Icons'
import Modal from '../components/Modal'
import DriverDashboard from './DriverDashboard'
import AdminDashboard from './AdminDashboard'
import './Dashboard.css'
import { useLanguage } from '../context/LanguageContext'
import { formatIndiaDate, formatIndiaDateTime } from '../utils/dateTime'

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
const shortDateTime = (value) =>
  value
    ? formatIndiaDateTime(value, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—'

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

function Trend({ value }) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return <span className="ui-trend-flat">—</span>
  }
  if (Number(value) > 0.05) {
    return (
      <span className="ui-trend-up">
        <Icon name="arrowUp" size={12} /> {Number(value).toFixed(1)}%
      </span>
    )
  }
  if (Number(value) < -0.05) {
    return (
      <span className="ui-trend-down">
        <Icon name="arrowDown" size={12} /> {Math.abs(Number(value)).toFixed(1)}%
      </span>
    )
  }
  return <span className="ui-trend-flat">0.0%</span>
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
  const [selectedCropId, setSelectedCropId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [comparison, setComparison] = useState(null)
  const [comparing, setComparing] = useState(false)
  const [comparisonError, setComparisonError] = useState('')
  const [showAssumptions, setShowAssumptions] = useState(false)
  const [driverTruck, setDriverTruck] = useState(null)

  const load = () => {
    setLoading(true)
    setError('')
    setComparisonError('')
    getDashboard()
      .then((payload) => {
        setData(payload)
        const top = [...(payload.crops || [])].sort((a, b) => b.quantity_kg - a.quantity_kg)[0]
        if (top) {
          setSelectedCropId(String(top.id))
          setQuantity(String(top.quantity_kg))
          setComparison(payload.comparison || null)
        } else {
          setSelectedCropId('')
          setQuantity('')
          setComparison(payload.comparison || null)
        }
      })
      .catch((err) => setError(err.response?.data?.detail || t('dash.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  useEffect(() => {
    let active = true
    if (!selectedCropId || !quantity || Number(quantity) <= 0) {
      setComparing(false)
      setComparisonError('')
      return () => { active = false }
    }

    setComparing(true)
    setComparisonError('')
    const timer = setTimeout(() => {
      compareMarkets({ crop_id: Number(selectedCropId), quantity: Number(quantity) })
        .then((payload) => { if (active) setComparison(payload) })
        .catch((err) => {
          if (!active) return
          setComparison(null)
          const detail = err.response?.data?.detail
          setComparisonError(typeof detail === 'string' ? detail : t('dash.loadError'))
        })
        .finally(() => { if (active) setComparing(false) })
    }, 320)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [selectedCropId, quantity, t])

  const stats = data?.stats || {}
  const crops = data?.crops || []
  const markets = data?.markets || []
  const prices = data?.prices || []
  const trucks = data?.trucks || []
  const options = comparison?.options || []
  const best = options.find((option) => option.market_id === comparison?.recommended_market_id) || options[0]
  const nearest = [...options].sort((a, b) => a.distance_km - b.distance_km)[0]
  const extraProfit = best && nearest ? Number(best.breakdown.net_proceeds) - Number(nearest.breakdown.net_proceeds) : 0
  const bestPrice = best?.price_per_kg
  const selectedCrop = crops.find((crop) => String(crop.id) === String(selectedCropId))

  const handleCropChange = (value) => {
    setSelectedCropId(value)
    const crop = crops.find((item) => String(item.id) === value)
    if (crop) setQuantity(String(crop.quantity_kg))
  }

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
            <strong>{bestPrice ? `₹${Number(bestPrice).toFixed(1)}/kg` : '—'}</strong>
            <span>{best?.market_name || stats.best_market || t('dash.addMarketPrices')}</span>
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
        <Link to="/reports" className="dbm-kpi ui-card">
          <span className="dbm-kpi-icon purple"><Icon name="reports" size={19} /></span>
          <span className="dbm-kpi-copy">
            <small>{t('dash.kpiEstimatedProfit')}</small>
            <strong>{inr(stats.estimated_profit)}</strong>
            <span>{stats.profit_crop ? `${stats.profit_crop} · ${kg(stats.profit_quantity_kg)}` : t('dash.noCropSelected')}</span>
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

      <section className="ui-card dbm-compare">
        <div className="dbm-compare-head">
          <div>
            <p>{t('dash.compareSub')}</p>
          </div>
          <div className="dbm-compare-controls">
            <label className="ui-field">
              <span className="ui-label">{t('common.crop')}</span>
              <select className="ui-select" value={selectedCropId} onChange={(e) => handleCropChange(e.target.value)}>
                {crops.map((crop) => (
                  <option key={crop.id} value={crop.id}>{crop.crop_name}{crop.variety ? ` · ${crop.variety}` : ''}</option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('common.quantityKg')}</span>
              <input
                className="ui-input"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
          </div>
        </div>

        {comparisonError && <div className="ui-alert ui-alert-error" role="alert">{comparisonError}</div>}

        <div className="dbm-compare-body">
          <div className="dbm-compare-summary">
            <span className="dbm-best-label"><Icon name="sparkles" size={14} />{t('dash.recommendedMandi')}</span>
            {comparing ? (
              <div className="ui-loading" style={{ padding: '28px 0' }}><span className="ui-spinner" />{t('dash.calculating')}</div>
            ) : best ? (
              <>
                <h4>{best.market_name}</h4>
                <p className="dbm-best-price">₹{Number(best.price_per_kg).toFixed(1)} <small>{t('common.perKg')}</small></p>
                <div className="dbm-best-meta">
                  <span><Icon name="route" size={13} /> {Number(best.distance_km).toFixed(0)} km</span>
                  <span><Icon name="clock" size={13} /> {best.eta_minutes} min</span>
                  <span><Icon name="prices" size={13} /> {best.source}</span>
                </div>
                <div className="dbm-best-net">
                  <span>{t('dash.estimatedNetProceeds')}</span>
                  <strong>{inr(best.breakdown.net_proceeds)}</strong>
                </div>
                {extraProfit > 0 && nearest && Number(nearest.market_id) !== Number(best.market_id) && (
                  <p className="dbm-extra">
                    That is <strong>{inr(extraProfit)}</strong> more than selling at {nearest.market_name}.
                  </p>
                )}
                <Link to="/trucks" className="ui-btn ui-btn-primary ui-btn-block" style={{ marginTop: 4 }}>
                  <Icon name="truck" size={15} /> Book a truck
                </Link>
              </>
            ) : (
              <div className="ui-empty" style={{ padding: '24px 0' }}>
                <strong>{t('dash.noPricesForCrop')}</strong>
                <p>{t('dash.noPricesForCropSub')}</p>
              </div>
            )}
          </div>

          <div className="dbm-compare-table">
            {options.length === 0 ? (
              <div className="ui-empty">
                <span className="ui-empty-icon"><Icon name="scale" size={21} /></span>
                <strong>{t('dash.nothingToCompare')}</strong>
                <p>{t('dash.nothingToCompareSub')}</p>
              </div>
            ) : (
              <>
                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>{t('common.market')}</th>
                        <th className="num">{t('common.pricePerKg')}</th>
                        <th className="num">{t('common.distance')}</th>
                        <th className="num">{t('dash.thTravel')}</th>
                        <th className="num">{t('dash.thNetProceeds')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {options.map((option) => {
                        const recommended = option.market_id === comparison?.recommended_market_id
                        return (
                          <tr key={option.market_id} className={recommended ? 'recommended' : ''}>
                            <td>
                              <span className="dbm-market-name">
                                <strong>{option.market_name}</strong>
                                {recommended && <span className="ui-badge ui-badge-green">{t('dash.bestNet')}</span>}
                                {option.is_stale && <span className="ui-badge ui-badge-amber">{t('dash.oldPrice')}</span>}
                              </span>
                              <small>{option.district}</small>
                            </td>
                            <td className="num">{inr(option.price_per_kg)}</td>
                            <td className="num">{Number(option.distance_km).toFixed(0)} km</td>
                            <td className="num">{option.eta_minutes} min</td>
                            <td className="num"><strong>{inr(option.breakdown.net_proceeds)}</strong></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  className="dbm-assumptions-toggle"
                  onClick={() => setShowAssumptions((value) => !value)}
                >
                  <Icon name="info" size={13} />
                  {showAssumptions ? t('dash.hideAssumptions') : t('dash.showAssumptions')}
                </button>
                {showAssumptions && (
                  <ul className="dbm-assumptions">
                    {(comparison?.assumptions || []).map((item) => <li key={item}>{item}</li>)}
                    {selectedCrop?.cost_per_kg ? (
                      <li>Profit uses your recorded cost of ₹{Number(selectedCrop.cost_per_kg).toFixed(2)} per kg.</li>
                    ) : (
                      <li>{t('dash.addCostHint')}</li>
                    )}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="dbm-bottom">
        <div className="ui-card">
          <div className="ui-card-head">
            <div>
              <p>{t('dash.latestPricesSub')}</p>
            </div>
            <Link to="/market-prices" className="ui-link">{t('dash.allPrices')}</Link>
          </div>
          <div className="ui-card-body">
            {prices.length === 0 ? (
              <div className="ui-empty">
                <span className="ui-empty-icon"><Icon name="prices" size={21} /></span>
                <strong>{t('dash.noPrices')}</strong>
                <p>{t('dash.noPricesSub')}</p>
              </div>
            ) : (
              <div className="dbm-price-list">
                {prices.slice(0, 5).map((price) => (
                  <div key={price.id} className="dbm-price-row">
                    <span className="dbm-price-icon"><Icon name="leaf" size={14} /></span>
                    <span className="dbm-price-crop">
                      <strong>{price.crop_name}</strong>
                      <small>{price.market_name}</small>
                    </span>
                    <span className="dbm-price-value">
                      <strong>₹{Number(price.price_per_kg).toFixed(1)}</strong>
                      <small>{t('common.perKg')}</small>
                    </span>
                    <span className="dbm-price-trend">
                      <Trend value={price.trend_pct} />
                      <small>{shortDateTime(price.observed_at)}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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

      {best && (
        <section className="dbm-insight">
          <span className="dbm-insight-icon"><Icon name="sparkles" size={20} /></span>
          <div>
            <strong>{t('dash.smartInsight')}</strong>
            <p>
              For {selectedCrop?.crop_name || comparison?.crop_name} at {kg(quantity)}, {best.market_name}
              {' '}gives the highest net return of {inr(best.breakdown.net_proceeds)} after all estimated costs.
            </p>
          </div>
          <Link to="/markets" className="ui-btn ui-btn-outline ui-btn-sm">{t('dash.seeMarkets')}</Link>
        </section>
      )}

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
