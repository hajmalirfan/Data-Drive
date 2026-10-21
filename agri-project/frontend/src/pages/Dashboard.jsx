import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { compareMarkets, getDashboard } from '../services/operationsService'
import Icon from '../components/Icons'
import './Dashboard.css'
import { useLanguage } from '../context/LanguageContext'

const inr = (value) =>
  value === null || value === undefined
    ? '—'
    : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const kg = (value) =>
  value === null || value === undefined
    ? '—'
    : `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
const shortDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'
const shortDateTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', {
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

function HeroArt() {
  return (
    <svg viewBox="0 0 440 210" className="dbm-hero-art" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7fbf1" />
          <stop offset="100%" stopColor="#e2f0d8" />
        </linearGradient>
        <linearGradient id="field" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9bce81" />
          <stop offset="100%" stopColor="#69ae5a" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="424" height="194" rx="26" fill="url(#sky)" />
      <circle cx="345" cy="55" r="28" fill="#f7d47b" opacity="0.92" />
      <circle cx="345" cy="55" r="40" fill="#f7d47b" opacity="0.16" />
      <path d="M8 130c52-36 92-36 139-3 36 25 75 25 110-1 48-37 98-37 175 7v69H8z" fill="#cfe5bd" />
      <path d="M8 153c60-27 110-20 152 1 44 22 82 18 119-4 36-21 72-21 161 16v36H8z" fill="url(#field)" />
      <path d="M42 210c35-33 78-52 123-63M96 210c30-26 65-41 103-50M150 210c29-21 62-33 97-39M206 210c29-16 63-24 98-25" stroke="#4b9645" strokeWidth="2.4" strokeLinecap="round" opacity="0.42" fill="none" />
      <path d="M8 112c31-19 58-23 84-12 26 11 44 9 66-4" stroke="#bbd9a7" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.6" />
      <g transform="translate(108 98)">
        <rect x="0" y="14" width="72" height="36" rx="7" fill="#fff" />
        <rect x="8" y="21" width="26" height="16" rx="4" fill="#a9d3b4" />
        <path d="M72 26h20l14 13v11H72z" fill="#2f8d53" />
        <rect x="78" y="30" width="15" height="9" rx="2.5" fill="#cbe7d5" />
        <circle cx="22" cy="52" r="9" fill="#234434" />
        <circle cx="22" cy="52" r="3.6" fill="#d7e7da" />
        <circle cx="88" cy="52" r="9" fill="#234434" />
        <circle cx="88" cy="52" r="3.6" fill="#d7e7da" />
        <rect x="6" y="32" width="5" height="9" rx="2" fill="#f2c96b" />
      </g>
      <g fill="#2f7b45">
        <path d="M290 148c0-16 10-27 25-30-2 17-11 28-25 30z" />
        <path d="M290 148c-10-9-12-20-6-32 11 9 13 21 6 32z" />
        <path d="M290 148c15-2 25-10 28-24-14 1-23 9-28 24z" opacity="0.8" />
      </g>
      <path d="M290 150v22" stroke="#2f7b45" strokeWidth="2.4" strokeLinecap="round" />
      <g fill="#ffffff" opacity="0.8">
        <circle cx="52" cy="48" r="2" />
        <circle cx="68" cy="38" r="1.5" />
        <circle cx="86" cy="54" r="1.5" />
        <circle cx="180" cy="42" r="2" />
        <circle cx="205" cy="60" r="1.4" />
      </g>
    </svg>
  )
}

function MarketMap({ markets }) {
  const { t } = useLanguage()
  const points = useMemo(() => {
    if (!markets?.length) return []
    const lats = markets.map((m) => Number(m.latitude) || 0)
    const lngs = markets.map((m) => Number(m.longitude) || 0)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const latSpan = maxLat - minLat || 1
    const lngSpan = maxLng - minLng || 1
    const nearestId = [...markets].sort((a, b) => a.distance_km - b.distance_km)[0]?.id
    return markets.map((market) => ({
      ...market,
      x: 12 + ((Number(market.longitude) - minLng) / lngSpan) * 76,
      y: 86 - ((Number(market.latitude) - minLat) / latSpan) * 68,
      nearest: market.id === nearestId,
    }))
  }, [markets])

  return (
    <div className="dbm-map" role="img" aria-label={t('dash.mapLabel')}>
      <span className="dbm-map-road dbm-road-a" />
      <span className="dbm-map-road dbm-road-b" />
      <span className="dbm-map-river" />
      {points.map((market) => (
        <span
          key={market.id}
          className={`dbm-map-pin ${market.nearest ? 'nearest' : ''}`}
          style={{ left: `${market.x}%`, top: `${market.y}%` }}
          title={`${market.name} · ${market.distance_km} km`}
        >
          <span className="dbm-pin-dot"><Icon name="markets" size={13} /></span>
          <span className="dbm-pin-label">
            <strong>{market.name.replace(/ (Market|Mandi|Central Market)$/i, '')}</strong>
            <small>{Number(market.distance_km).toFixed(0)} km</small>
          </span>
        </span>
      ))}
      <span className="dbm-map-you" title={t('dash.yourLocation')}>
        <span className="dbm-you-pulse" />
        <span className="dbm-you-dot" />
      </span>
      <span className="dbm-map-legend">
        <span><i className="dot nearest" />{t('dash.nearestMandi')}</span>
        <span><i className="dot" />{t('dash.otherMandis')}</span>
      </span>
    </div>
  )
}

export default function Dashboard() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCropId, setSelectedCropId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [comparison, setComparison] = useState(null)
  const [comparing, setComparing] = useState(false)
  const [showAssumptions, setShowAssumptions] = useState(false)

  const load = () => {
    setLoading(true)
    setError('')
    getDashboard()
      .then((payload) => {
        setData(payload)
        const top = [...(payload.crops || [])].sort((a, b) => b.quantity_kg - a.quantity_kg)[0]
        if (top) {
          setSelectedCropId(String(top.id))
          setQuantity(String(top.quantity_kg))
          setComparison(payload.comparison)
        }
      })
      .catch((err) => setError(err.response?.data?.detail || t('dash.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  useEffect(() => {
    if (!selectedCropId || !quantity || Number(quantity) <= 0) return
    let active = true
    setComparing(true)
    const timer = setTimeout(() => {
      compareMarkets({ crop_id: Number(selectedCropId), quantity: Number(quantity) })
        .then((payload) => { if (active) setComparison(payload) })
        .catch(() => {})
        .finally(() => { if (active) setComparing(false) })
    }, 320)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [selectedCropId, quantity])

  const greeting = (() => {
    const hour = new Date().getHours()
    if (hour < 12) return t('dash.greetingMorning')
    if (hour < 17) return t('dash.greetingAfternoon')
    return t('dash.greetingEvening')
  })()

  const firstName = (user?.full_name || 'farmer').split(' ')[0]
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
      <section className="dbm-hero">
        <div className="dbm-hero-copy">
          <span className="dbm-eyebrow">{greeting}, {firstName}</span>
          <h2>{t('dash.heroTitle1')}<br /><em>{t('dash.heroTitle2')}</em></h2>
          <p>
            Compare mandis, book a truck and track every kilogram from your field to the market.
            All prices below are live records entered by market managers.
          </p>
          <div className="dbm-hero-actions">
            <Link to="/markets" className="dbm-hero-btn">
              Find best market <Icon name="arrowRight" size={15} />
            </Link>
            <Link to="/trucks" className="dbm-hero-link">{t('dash.bookTruck')}</Link>
          </div>
        </div>
        <div className="dbm-hero-visual">
          <HeroArt />
          <span className="dbm-hero-chip chip-a"><Icon name="prices" size={13} />{t('login.benefitPrices')}</span>
          <span className="dbm-hero-chip chip-b"><Icon name="truck" size={13} />{t('dash.chipTransport')}</span>
        </div>
      </section>

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
            <h3><Icon name="scale" size={17} />{t('dash.compareMarkets')}</h3>
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
              <h3><Icon name="prices" size={16} />{t('dash.latestPrices')}</h3>
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
          <div className="ui-card-head">
            <div>
              <h3><Icon name="truck" size={16} />{t('dash.availableTrucks')}</h3>
              <p>{t('dash.availableTrucksSub')}</p>
            </div>
            <Link to="/trucks" className="ui-link">{t('dash.bookTruck')}</Link>
          </div>
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
                  <Link key={truck.id} to="/trucks" className="dbm-truck-card">
                    <span className="dbm-truck-art"><Icon name="truck" size={21} /></span>
                    <span className="dbm-truck-info">
                      <strong>{truck.vehicle_number}</strong>
                      <small>{truck.truck_type} · {kg(truck.available_capacity_kg)} free</small>
                      <small>{truck.route_from || t('common.local')} → {truck.route_to || t('common.anyMandi')}</small>
                    </span>
                    <span className="dbm-truck-rate">
                      <strong>₹{Number(truck.price_per_km).toFixed(0)}</strong>
                      <small>{t('dash.perKm')}</small>
                    </span>
                  </Link>
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
    </div>
  )
}
