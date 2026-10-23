import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icons'
import { getMarkets, getPriceCrops, getPrices } from '../services/operationsService'
import './Markets.css'
import { useLanguage } from '../context/LanguageContext'
import { formatIndiaDateTime } from '../utils/dateTime'

const inr = (value) =>
  value === null || value === undefined ? '—' : `₹${Number(value).toFixed(2)}`
const observed = (value) =>
  value
    ? formatIndiaDateTime(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '—'

function MarketsMap({ markets, priceByMarket, selectedId, onSelect }) {
  const { t } = useLanguage()
  const points = useMemo(() => {
    if (!markets.length) return []
    const lats = markets.map((market) => Number(market.latitude) || 0)
    const lngs = markets.map((market) => Number(market.longitude) || 0)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const latSpan = maxLat - minLat || 1
    const lngSpan = maxLng - minLng || 1
    return markets.map((market) => ({
      ...market,
      x: 13 + ((Number(market.longitude) - minLng) / lngSpan) * 74,
      y: 84 - ((Number(market.latitude) - minLat) / latSpan) * 66,
    }))
  }, [markets])

  return (
    <div className="mk-map">
      <span className="mk-road mk-road-a" />
      <span className="mk-road mk-road-b" />
      <span className="mk-river" />
      {points.map((market) => {
        const price = priceByMarket[market.id]
        return (
          <button
            type="button"
            key={market.id}
            className={`mk-pin ${selectedId === market.id ? 'selected' : ''}`}
            style={{ left: `${market.x}%`, top: `${market.y}%` }}
            onClick={() => onSelect(market.id)}
            title={`${market.name} · ${market.distance_km} km`}
          >
            <span className="mk-pin-dot"><Icon name="markets" size={13} /></span>
            <span className="mk-pin-card">
              <strong>{market.name}</strong>
              <small>{Number(market.distance_km).toFixed(0)} km · {price ? `${inr(price.price_per_kg)}/kg` : t('common.noPrice')}</small>
            </span>
          </button>
        )
      })}
      <span className="mk-map-you">
        <span className="mk-you-pulse" />
        <span className="mk-you-dot" />
      </span>
      <span className="mk-map-label">
          <Icon name="info" size={12} /> {t('markets.tapPin')}
      </span>
    </div>
  )
}

export default function Markets() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const [params] = useSearchParams()
  const [markets, setMarkets] = useState([])
  const [cropOptions, setCropOptions] = useState([])
  const [selectedCrop, setSelectedCrop] = useState('')
  const [prices, setPrices] = useState([])
  const [query, setQuery] = useState(params.get('q') || '')
  const [sort, setSort] = useState('distance')
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [priceLoading, setPriceLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setQuery(params.get('q') || '')
    Promise.all([getMarkets(), getPriceCrops()])
      .then(([marketRows, crops]) => {
        setMarkets(marketRows)
        setCropOptions(crops)
        if (crops.length) setSelectedCrop((current) => current || crops[0])
        setSelectedId(marketRows[0]?.id || null)
      })
      .catch((err) => setError(err.response?.data?.detail || t('markets.loadError')))
      .finally(() => setLoading(false))
  }, [params])

  useEffect(() => {
    if (!selectedCrop) return
    setPriceLoading(true)
    getPrices({ crop_name: selectedCrop, limit: 200 })
      .then(setPrices)
      .catch(() => setPrices([]))
      .finally(() => setPriceLoading(false))
  }, [selectedCrop])

  const priceByMarket = useMemo(() => {
    const mapping = {}
    prices.forEach((price) => {
      if (!mapping[price.market_id]) mapping[price.market_id] = price
    })
    return mapping
  }, [prices])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = markets.filter((market) => {
      if (!needle) return true
      return [market.name, market.district, market.state]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle))
    })
    return [...list].sort((a, b) => {
      if (sort === 'distance') return a.distance_km - b.distance_km
      if (sort === 'eta') return a.eta_minutes - b.eta_minutes
      if (sort === 'price') {
        return (priceByMarket[b.id]?.price_per_kg || 0) - (priceByMarket[a.id]?.price_per_kg || 0)
      }
      return a.name.localeCompare(b.name)
    })
  }, [markets, query, sort, priceByMarket])

  const nearest = visible.length ? [...visible].sort((a, b) => a.distance_km - b.distance_km)[0] : null
  const bestPrice = visible.length
    ? visible
        .map((market) => ({ market, price: priceByMarket[market.id] }))
        .filter((item) => item.price)
        .sort((a, b) => b.price.price_per_kg - a.price.price_per_kg)[0]
    : null

  return (
    <div className="ui-page markets-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('markets.title')}</h2>
          <p>{t('markets.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <label className="ui-field mk-crop-select">
            <span className="ui-label">{t('markets.pricedCrop')}</span>
            <select className="ui-select" value={selectedCrop} onChange={(event) => setSelectedCrop(event.target.value)}>
              {cropOptions.length === 0 && <option value="">{t('markets.noCropPrices')}</option>}
              {cropOptions.map((crop) => <option key={crop} value={crop}>{crop}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <div className="mk-stats">
        <div className="mk-stat">
          <span><Icon name="markets" size={17} /></span>
          <div><small>{t('common.markets')}</small><strong>{visible.length}</strong></div>
        </div>
        <div className="mk-stat">
          <span><Icon name="route" size={17} /></span>
          <div><small>{t('markets.nearest')}</small><strong>{nearest ? `${nearest.name} · ${Number(nearest.distance_km).toFixed(0)} km` : '—'}</strong></div>
        </div>
        <div className="mk-stat">
          <span><Icon name="clock" size={17} /></span>
          <div><small>{t('markets.quickest')}</small><strong>{nearest ? `${nearest.eta_minutes} min` : '—'}</strong></div>
        </div>
        <div className="mk-stat">
          <span><Icon name="prices" size={17} /></span>
          <div>
            <small>Best {selectedCrop || 'crop'} price</small>
            <strong>{bestPrice ? `${inr(bestPrice.price.price_per_kg)} · ${bestPrice.market.name}` : '—'}</strong>
          </div>
        </div>
      </div>

      <div className="mk-layout">
        <div className="ui-card mk-map-card">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="tracking" size={16} />{t('markets.mapTitle')}</h3>
              <p>{priceLoading ? t('markets.updating') : t('markets.showingPrices', [selectedCrop || t('common.crop')])}</p>
            </div>
            <Link to="/market-prices" className="ui-link">{t('markets.priceBoard')}</Link>
          </div>
          <div className="ui-card-body">
            {loading ? (
              <div className="ui-loading"><span className="ui-spinner" />{t('markets.loading')}</div>
            ) : (
              <MarketsMap
                markets={visible}
                priceByMarket={priceByMarket}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </div>
        </div>

        <div className="ui-card mk-list-card">
          <div className="mk-list-head">
            <div className="ui-filters">
              <input
                className="ui-input mk-search"
                placeholder={t('markets.searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select className="ui-select" value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="distance">{t('markets.sortDistance')}</option>
                <option value="eta">{t('markets.sortEta')}</option>
                <option value="price">{t('prices.highest')}</option>
                <option value="name">{t('markets.sortName')}</option>
              </select>
            </div>
          </div>
          <div className="mk-list">
            {loading ? (
              <div className="ui-loading"><span className="ui-spinner" />{t('common.loading')}</div>
            ) : visible.length === 0 ? (
              <div className="ui-empty">
                <span className="ui-empty-icon"><Icon name="markets" size={21} /></span>
                <strong>{t('markets.noMatch')}</strong>
                <p>{t('markets.noMatchSub')}</p>
              </div>
            ) : (
              visible.map((market) => {
                const price = priceByMarket[market.id]
                return (
                  <div
                    key={market.id}
                    role="button"
                    tabIndex={0}
                    className={`mk-item ${selectedId === market.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(market.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedId(market.id)
                      }
                    }}
                  >
                    <span className="mk-item-icon"><Icon name="markets" size={17} /></span>
                    <span className="mk-item-main">
                      <strong>{market.name}</strong>
                      <small>{market.district}, {market.state}</small>
                      <span className="mk-item-meta">
                        <span><Icon name="route" size={11} /> {Number(market.distance_km).toFixed(0)} km</span>
                        <span><Icon name="clock" size={11} /> {market.eta_minutes} min</span>
                      </span>
                    </span>
                    <span className="mk-item-price">
                      {priceLoading ? (
                        <small>...</small>
                      ) : price ? (
                        <>
                          <strong>{inr(price.price_per_kg)}</strong>
                          <small>{selectedCrop} / kg</small>
                          <span className={`ui-badge ui-badge-${price.is_stale ? 'amber' : 'green'}`}>
                            {price.is_stale ? t('common.stale') : t('common.current')}
                          </span>
                        </>
                      ) : (
                        <small>{t('common.noPrice')}</small>
                      )}
                    </span>
                    <Link
                      to={`/market-prices?market=${market.id}${selectedCrop ? `&crop=${encodeURIComponent(selectedCrop)}` : ''}`}
                      className="mk-item-link"
                      onClick={(event) => event.stopPropagation()}
                      title={t('markets.seePriceRecords')}
                    >
                      <Icon name="arrowRight" size={14} />
                    </Link>
                  </div>
                )
              })
            )}
          </div>
          {selectedId && visible.find((market) => market.id === selectedId) && (
            <div className="mk-selected">
              <span>
                <strong>{visible.find((market) => market.id === selectedId).name}</strong>
                <small>
                  Latest {selectedCrop || 'crop'} price recorded {priceByMarket[selectedId] ? observed(priceByMarket[selectedId].observed_at) : t('markets.notYet')}
                </small>
              </span>
              <Link
                to={`/market-prices?market=${selectedId}${selectedCrop ? `&crop=${encodeURIComponent(selectedCrop)}` : ''}`}
                className="ui-btn ui-btn-soft ui-btn-sm"
              >
                View prices
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
