import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icons'
import { getCrops } from '../services/operationsService'
import { findMarkets, getFinderCommodities, getFinderRoute } from '../services/mandiService'
import { formatIndiaDate } from '../utils/dateTime'
import './Markets.css'
import { useLanguage } from '../context/LanguageContext'

const MarketFinderMap = lazy(() => import('../components/MarketFinderMap'))

const rupees = (value, digits = 0) =>
  value === null || value === undefined
    ? '—'
    : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`
const duration = (minutes, language) => {
  const m = Math.round(minutes)
  const format = (unit, value) =>
    new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'short' }).format(value)
  return m >= 60 ? `${format('hour', Math.floor(m / 60))} ${format('minute', m % 60)}` : format('minute', m)
}

const PICKS = [
  { id: 'best_profit', icon: 'sparkles', titleKey: 'finder.bestProfit', tone: 'gold' },
  { id: 'best_price', icon: 'prices', titleKey: 'finder.bestPrice', tone: 'green' },
  { id: 'nearest', icon: 'route', titleKey: 'finder.nearest', tone: 'blue' },
  { id: 'quickest', icon: 'clock', titleKey: 'finder.quickest', tone: 'purple' },
]
const SORTS = {
  net: (a, b) => b.net - a.net,
  price: (a, b) => b.modal_price - a.modal_price,
  distance: (a, b) => a.road_km - b.road_km,
  time: (a, b) => a.drive_minutes - b.drive_minutes,
}

export default function Markets() {
  const { t, lang } = useLanguage()
  const [commodities, setCommodities] = useState([])
  const [crops, setCrops] = useState([])
  const [form, setForm] = useState({ commodity: '', quantity: '', cropId: '', costPerKg: '', place: '' })
  const [gps, setGps] = useState(null) // {lat, lng, label}
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)
  const [route, setRoute] = useState(null)
  const [sort, setSort] = useState('net')

  const search = (overrides = {}) => {
    const next = { ...form, ...overrides.form }
    const point = overrides.gps !== undefined ? overrides.gps : gps
    if (!next.commodity || !(Number(next.quantity) > 0)) {
      setError(t('finder.errInput'))
      return
    }
    setLoading(true)
    setError('')
    setRoute(null)
    findMarkets({
      commodity: next.commodity,
      quantity_kg: Number(next.quantity),
      crop_id: next.cropId || undefined,
      cost_per_kg: next.costPerKg !== '' ? Number(next.costPerKg) : undefined,
      lat: point?.lat,
      lng: point?.lng,
      place: point ? point.label : next.place.trim() || undefined,
    })
      .then((result) => {
        setData(result)
        setSelectedKey(result.picks?.best_profit || result.options[0]?.key || null)
      })
      .catch((err) => setError(err.response?.data?.detail || t('finder.errLoad')))
      .finally(() => setLoading(false))
  }

  // Start from the farmer's own crop when it has government prices.
  useEffect(() => {
    Promise.all([getFinderCommodities(), getCrops().catch(() => [])]).then(([list, myCrops]) => {
      setCommodities(list.commodities)
      const stock = (myCrops || []).filter((c) => ['available', 'reserved', 'partially_sold'].includes(c.status))
      setCrops(stock)
      const names = new Map(list.commodities.map((name) => [name.toLowerCase(), name]))
      const crop = stock.find((c) => names.has(c.crop_name.toLowerCase()))
      const initial = crop
        ? { commodity: names.get(crop.crop_name.toLowerCase()), quantity: String(crop.quantity_kg), cropId: String(crop.id), costPerKg: crop.cost_per_kg ?? '' }
        : { commodity: list.commodities[0] || '', quantity: '1000' }
      setForm((prev) => ({ ...prev, ...initial }))
      if (initial.commodity) search({ form: initial })
    }).catch(() => setError(t('finder.errLoad')))
  }, []) // eslint-disable-line

  // Draw the real road route to the selected market.
  useEffect(() => {
    const target = data?.options.find((o) => o.key === selectedKey)
    if (!target) return undefined
    let cancelled = false
    setRoute(null)
    getFinderRoute({ o_lat: data.origin.lat, o_lng: data.origin.lng, d_lat: target.lat, d_lng: target.lng })
      .then((r) => { if (!cancelled) setRoute(r.path) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedKey, data])

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError(t('finder.errNoGps')); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: t('finder.myLocation') }
        setGps(point)
        setLocating(false)
        search({ gps: point })
      },
      () => { setLocating(false); setError(t('finder.errGpsDenied')) },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const pickOnMap = (lat, lng) => {
    const point = { lat, lng, label: t('finder.pinnedPoint') }
    setGps(point)
    search({ gps: point })
  }

  const chooseCrop = (cropId) => {
    const crop = crops.find((c) => String(c.id) === cropId)
    const match = crop && commodities.find((name) => name.toLowerCase() === crop.crop_name.toLowerCase())
    setForm((prev) => ({
      ...prev,
      cropId,
      ...(crop ? { quantity: String(crop.quantity_kg), costPerKg: crop.cost_per_kg ?? '' } : {}),
      ...(match ? { commodity: match } : {}),
    }))
  }

  const options = useMemo(() => (data ? [...data.options].sort(SORTS[sort]) : []), [data, sort])
  const byKey = useMemo(() => Object.fromEntries((data?.options || []).map((o) => [o.key, o])), [data])
  const selected = byKey[selectedKey]

  return (
    <div className="ui-page markets-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('finder.title')}</h2>
          <p>{t('finder.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <Link to="/market-prices" className="ui-btn ui-btn-outline"><Icon name="prices" size={14} />{t('finder.allPrices')}</Link>
        </div>
      </div>

      <form className="ui-card mf-controls" onSubmit={(e) => { e.preventDefault(); setGps(null); search({ gps: null }) }}>
        {crops.length > 0 && (
          <label className="ui-field">
            <span className="ui-label">{t('finder.myCrop')}</span>
            <select className="ui-select" value={form.cropId} onChange={(e) => chooseCrop(e.target.value)}>
              <option value="">{t('finder.noCrop')}</option>
              {crops.map((c) => <option key={c.id} value={c.id}>{c.crop_name}{c.variety ? ` · ${c.variety}` : ''} ({c.quantity_kg} kg)</option>)}
            </select>
          </label>
        )}
        <label className="ui-field">
          <span className="ui-label">{t('common.crop')}</span>
          <select className="ui-select" value={form.commodity} onChange={(e) => setForm((p) => ({ ...p, commodity: e.target.value }))}>
            {commodities.length === 0 && <option value="">{t('finder.noPrices')}</option>}
            {commodities.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="ui-field mf-qty">
          <span className="ui-label">{t('common.quantityKg')}</span>
          <input className="ui-input" type="number" min="1" value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))} />
        </label>
        <label className="ui-field mf-qty">
          <span className="ui-label">{t('finder.costPerKg')}</span>
          <input className="ui-input" type="number" min="0" step="0.01" placeholder={t('finder.optional')} value={form.costPerKg} onChange={(e) => setForm((p) => ({ ...p, costPerKg: e.target.value }))} />
        </label>
        <label className="ui-field mf-place">
          <span className="ui-label">{t('finder.pickupFrom')}</span>
          <input className="ui-input" placeholder={t('finder.placePlaceholder')} value={form.place} onChange={(e) => setForm((p) => ({ ...p, place: e.target.value }))} />
        </label>
        <div className="mf-actions">
          <button type="button" className="ui-btn ui-btn-outline" onClick={useMyLocation} disabled={locating || loading}>
            <Icon name="tracking" size={14} />{locating ? t('finder.locating') : t('finder.myLocation')}
          </button>
          <button type="submit" className="ui-btn ui-btn-primary" disabled={loading}>
            <Icon name="search" size={14} />{loading ? t('finder.calculating') : t('finder.find')}
          </button>
        </div>
      </form>

      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      {data && (
        <div className="mf-origin-note">
          <Icon name="markets" size={13} />
          <span>
            {t('finder.from')} <b>{data.origin.label}</b> · {data.commodity} · {Number(data.quantity_kg).toLocaleString('en-IN')} kg ·{' '}
            {t('finder.pricesOf', [formatIndiaDate(`${data.arrival_date}T00:00:00+05:30`, { day: 'numeric', month: 'short', year: 'numeric' })])}
            {' · '}{t('finder.tapMap')}
          </span>
        </div>
      )}
      {(data?.markets_locating > 0 || data?.routes_pending > 0) && (
        <div className="ui-alert ui-alert-info">
          {data.markets_locating > 0
            ? t('finder.stillLocating', [data.markets_locating])
            : t('finder.stillRouting', [data.routes_pending])}{' '}
          <button type="button" className="mf-linkbtn" onClick={() => search()}>{t('common.refresh')}</button>
        </div>
      )}

      {data && data.options.length > 0 && (
        <div className="mf-picks">
          {PICKS.map((pick) => {
            const o = byKey[data.picks[pick.id]]
            if (!o) return null
            return (
              <button
                key={pick.id}
                type="button"
                className={`mf-pick ${pick.tone} ${selectedKey === o.key ? 'active' : ''}`}
                onClick={() => setSelectedKey(o.key)}
              >
                <span className="mf-pick-head">
                  <span className="mf-pick-icon"><Icon name={pick.icon} size={15} /></span>
                  <small>{t(pick.titleKey)}</small>
                  {pick.id === 'best_profit' && <em>{t('finder.recommended')}</em>}
                </span>
                <strong>{o.market}</strong>
                <span className="mf-pick-sub">{o.district}</span>
                <span className="mf-pick-figures">
                  <b>{rupees(o.net)}</b> {t('finder.inHand')}
                </span>
                <span className="mf-pick-meta">
                  {o.road_km} km · {duration(o.drive_minutes, lang)} · {rupees(o.price_per_kg, 2)}/kg
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="mf-layout">
        <div className="ui-card mf-map-card">
          {data ? (
            <Suspense fallback={<div className="mf-map mf-map-loading"><span className="ui-spinner" /></div>}>
              <MarketFinderMap
                origin={data.origin}
                markets={data.map_markets}
                options={data.options}
                picks={data.picks}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                route={route}
                onPickOrigin={pickOnMap}
              />
            </Suspense>
          ) : (
            <div className="mf-map mf-map-loading">{loading ? <><span className="ui-spinner" />{t('finder.calculating')}</> : t('finder.mapHint')}</div>
          )}
          <div className="mf-legend">
            <span><i className="gold" />{t('finder.bestProfit')}</span>
            <span><i className="blue" />{t('finder.selected')}</span>
            <span><i className="green" />{t('finder.compared')}</span>
            <span><i className="grey" />{t('finder.otherMarkets')}</span>
          </div>
        </div>

        <div className="ui-card mf-list-card">
          <div className="mf-list-head">
            <strong>{t('finder.compareTitle', [options.length])}</strong>
            <select className="ui-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('mandi.sortBy')}>
              <option value="net">{t('finder.sortNet')}</option>
              <option value="price">{t('finder.sortPrice')}</option>
              <option value="distance">{t('finder.sortDistance')}</option>
              <option value="time">{t('finder.sortTime')}</option>
            </select>
          </div>
          <div className={`mf-list ${loading && data ? 'is-refreshing' : ''}`}>
            {!data && !loading && <p className="mf-empty">{t('finder.mapHint')}</p>}
            {data && options.length === 0 && (
              <div className="ui-empty">
                <span className="ui-empty-icon"><Icon name="markets" size={21} /></span>
                <strong>{t('finder.noneTitle')}</strong>
                <p>{t('finder.noneSub')}</p>
              </div>
            )}
            {options.map((o, index) => (
              <button
                key={o.key}
                type="button"
                className={`mf-item ${o.key === selectedKey ? 'selected' : ''}`}
                onClick={() => setSelectedKey(o.key)}
              >
                <span className="mf-rank">{index + 1}</span>
                <span className="mf-item-main">
                  <strong>{o.market}</strong>
                  <small>{o.district}{o.location_precision === 'district' ? ` · ${t('finder.approxLocation')}` : ''}</small>
                  <span className="mf-item-meta">
                    <span><Icon name="route" size={11} /> {o.road_km} km</span>
                    <span><Icon name="clock" size={11} /> {duration(o.drive_minutes, lang)}</span>
                    <span><Icon name="prices" size={11} /> {rupees(o.price_per_kg, 2)}/kg</span>
                  </span>
                </span>
                <span className="mf-item-net">
                  <strong>{rupees(o.net)}</strong>
                  <small>{t('finder.inHand')}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {selected && data && (
        <div className="ui-card mf-detail">
          <div className="ui-card-head">
            <div>
              <h3><Icon name="scale" size={16} />{selected.market}</h3>
              <p>
                {selected.district}, {selected.state} · {selected.variety} · {selected.grade} ·{' '}
                {t('finder.published', [rupees(selected.min_price), rupees(selected.max_price), rupees(selected.modal_price)])}
              </p>
            </div>
            <Link to="/trucks" className="ui-btn ui-btn-primary ui-btn-sm"><Icon name="truck" size={13} />{t('finder.bookTruck')}</Link>
          </div>
          <div className="ui-card-body mf-breakdown">
            <dl>
              <div><dt>{t('finder.saleable', [data.assumptions.market_loss_pct])}</dt><dd>{selected.saleable_kg} kg</dd></div>
              <div><dt>{t('finder.gross', [rupees(selected.price_per_kg, 2)])}</dt><dd>{rupees(selected.gross)}</dd></div>
              <div className="minus">
                <dt>
                  {t('finder.transport', [selected.road_km])}
                  <small>
                    {data.transport.source === 'truck'
                      ? t('finder.truckRate', [data.transport.vehicle_number, rupees(data.transport.base_fare), data.transport.price_per_km])
                      : t('finder.standardRate', [rupees(data.transport.base_fare), data.transport.price_per_km])}
                  </small>
                </dt>
                <dd>− {rupees(selected.transport)}</dd>
              </div>
              <div className="minus"><dt>{t('finder.labour', [data.assumptions.labour_per_kg])}</dt><dd>− {rupees(selected.labour)}</dd></div>
              <div className="minus"><dt>{t('finder.commission', [data.assumptions.commission_pct])}</dt><dd>− {rupees(selected.commission)}</dd></div>
              <div className="minus"><dt>{t('finder.packaging', [data.assumptions.packaging_per_kg])}</dt><dd>− {rupees(selected.packaging)}</dd></div>
              <div className="total"><dt>{t('finder.netInHand')}<small>{rupees(selected.net_per_kg, 2)}/kg</small></dt><dd>{rupees(selected.net)}</dd></div>
              {selected.profit !== null && (
                <div className={`total ${selected.profit >= 0 ? 'good' : 'bad'}`}>
                  <dt>
                    {t('finder.profit')}
                    <small>{t('finder.afterProduction', [rupees(selected.production_cost)])}</small>
                  </dt>
                  <dd>
                    {rupees(selected.profit)}
                    {selected.profit_margin_pct !== null && <small> ({selected.profit_margin_pct}%)</small>}
                  </dd>
                </div>
              )}
            </dl>
            <p className="mf-sources">
              {t('finder.sources')} {data.sources.prices} · {data.sources.locations} · {data.sources.routes}.
              {selected.location_precision === 'district' && ` ${t('finder.districtNote')}`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
