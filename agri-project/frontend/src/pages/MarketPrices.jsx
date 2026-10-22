import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icons'
import Modal from '../components/Modal'
import {
  createPrice,
  getMarkets,
  getPriceCrops,
  getPrices,
} from '../services/operationsService'
import './MarketPrices.css'
import { useLanguage } from '../context/LanguageContext'

const inr = (value) =>
  value === null || value === undefined ? '—' : `₹${Number(value).toFixed(2)}`
const observed = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—'

function Trend({ value }) {
  if (value === null || value === undefined) return <span className="ui-trend-flat">—</span>
  if (Number(value) > 0.05) {
    return <span className="ui-trend-up"><Icon name="arrowUp" size={12} /> {Number(value).toFixed(1)}%</span>
  }
  if (Number(value) < -0.05) {
    return <span className="ui-trend-down"><Icon name="arrowDown" size={12} /> {Math.abs(Number(value)).toFixed(1)}%</span>
  }
  return <span className="ui-trend-flat">0.0%</span>
}

export default function MarketPrices() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const { isAdmin, isPriceManager } = useAuth()
  const [params] = useSearchParams()
  const [prices, setPrices] = useState([])
  const [markets, setMarkets] = useState([])
  const [cropOptions, setCropOptions] = useState([])
  const [crop, setCrop] = useState(params.get('crop') || '')
  const [marketId, setMarketId] = useState(params.get('market') || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    market_id: '',
    crop_name: '',
    price_per_kg: '',
    source: t('prices.sourcePlaceholder'),
    observed_at: '',
  })

  const canPublish = isAdmin || isPriceManager

  useEffect(() => {
    Promise.all([getMarkets(), getPriceCrops()])
      .then(([marketRows, crops]) => {
        setMarkets(marketRows)
        setCropOptions(crops)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    getPrices({
      crop_name: crop || undefined,
      market_id: marketId || undefined,
      limit: 200,
    })
      .then(setPrices)
      .catch((err) => setError(err.response?.data?.detail || t('prices.loadError')))
      .finally(() => setLoading(false))
  }, [crop, marketId])

  const filteredCrops = useMemo(() => {
    const known = new Set(cropOptions)
    const fromPrices = prices.map((item) => item.crop_name)
    return [...new Set([...known, ...fromPrices])].filter(Boolean).sort()
  }, [cropOptions, prices])

  const stats = useMemo(() => {
    if (!prices.length) return { high: null, average: null, markets: 0, stale: 0 }
    const values = prices.map((item) => Number(item.price_per_kg))
    return {
      high: Math.max(...values),
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      markets: new Set(prices.map((item) => item.market_id)).size,
      stale: prices.filter((item) => item.is_stale).length,
    }
  }, [prices])

  const openModal = () => {
    setForm({
      market_id: markets[0]?.id ? String(markets[0].id) : '',
      crop_name: crop || '',
      price_per_kg: '',
      source: t('prices.sourcePlaceholder'),
      observed_at: '',
    })
    setFormError('')
    setModalOpen(true)
  }

  const submit = async (event) => {
    event.preventDefault()
    setFormError('')
    if (!form.market_id) { setFormError(t('prices.errMarket')); return }
    if (!form.crop_name.trim()) { setFormError(t('crops.errName')); return }
    if (!Number(form.price_per_kg) || Number(form.price_per_kg) <= 0) { setFormError(t('prices.errPrice')); return }
    setSaving(true)
    try {
      await createPrice({
        market_id: Number(form.market_id),
        crop_name: form.crop_name.trim(),
        price_per_kg: Number(form.price_per_kg),
        source: form.source.trim() || t('prices.sourcePlaceholder'),
        observed_at: form.observed_at || null,
      })
      setModalOpen(false)
      setNotice(t('prices.published'))
      getPrices({ crop_name: crop || undefined, market_id: marketId || undefined, limit: 200 }).then(setPrices)
      getPriceCrops().then(setCropOptions)
    } catch (err) {
      setFormError(err.response?.data?.detail || t('prices.publishError'))
    } finally {
      setSaving(false)
    }
  }

  const clearFilters = () => {
    setCrop('')
    setMarketId('')
  }

  return (
    <div className="ui-page prices-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('prices.title')}</h2>
          <p>{t('prices.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <Link to="/markets" className="ui-btn ui-btn-outline">
            <Icon name="markets" size={15} /> Compare distance
          </Link>
          {canPublish && (
            <button type="button" className="ui-btn ui-btn-primary" onClick={openModal}>
              <Icon name="plus" size={15} /> Publish price
            </button>
          )}
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <div className="prices-stats">
        <div className="prices-stat">
          <span className="green"><Icon name="prices" size={17} /></span>
          <div><small>{t('prices.highest')}</small><strong>{stats.high === null ? '—' : `${inr(stats.high)}/kg`}</strong></div>
        </div>
        <div className="prices-stat">
          <span className="blue"><Icon name="scale" size={17} /></span>
          <div><small>{t('prices.average')}</small><strong>{stats.average === null ? '—' : `${inr(stats.average)}/kg`}</strong></div>
        </div>
        <div className="prices-stat">
          <span className="amber"><Icon name="markets" size={17} /></span>
          <div><small>{t('prices.marketsCovered')}</small><strong>{stats.markets}</strong></div>
        </div>
        <div className="prices-stat">
          <span className="red"><Icon name="clock" size={17} /></span>
          <div><small>{t('prices.staleRecords')}</small><strong>{stats.stale}</strong></div>
        </div>
      </div>

      <div className="ui-card">
        <div className="prices-filters">
          <label className="ui-field">
            <span className="ui-label">{t('common.crop')}</span>
            <select className="ui-select" value={crop} onChange={(event) => setCrop(event.target.value)}>
              <option value="">{t('prices.allCrops')}</option>
              {filteredCrops.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="ui-field">
            <span className="ui-label">{t('common.market')}</span>
            <select className="ui-select" value={marketId} onChange={(event) => setMarketId(event.target.value)}>
              <option value="">{t('prices.allMarkets')}</option>
              {markets.map((market) => <option key={market.id} value={market.id}>{market.name}</option>)}
            </select>
          </label>
          <div className="prices-filters-foot">
            <span><Icon name="info" size={13} />{t('prices.staleHint')}</span>
            {(crop || marketId) && (
              <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={clearFilters}>
                Clear filters
              </button>
            )}
            <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => getPrices({ crop_name: crop || undefined, market_id: marketId || undefined, limit: 200 }).then(setPrices)}>
              <Icon name="refresh" size={13} /> Refresh
            </button>
          </div>
        </div>

        <div className="ui-card-body prices-table-body">
          {loading ? (
            <div className="ui-loading"><span className="ui-spinner" />{t('prices.loading')}</div>
          ) : prices.length === 0 ? (
            <div className="ui-empty">
              <span className="ui-empty-icon"><Icon name="prices" size={22} /></span>
              <strong>{t('prices.noRecords')}</strong>
              <p>{canPublish ? t('prices.noRecordsPublish') : t('prices.noRecordsFiltered')}</p>
            </div>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>{t('common.crop')}</th>
                    <th>{t('common.market')}</th>
                    <th className="num">{t('common.pricePerKg')}</th>
                    <th>{t('prices.thTrend')}</th>
                    <th>{t('common.source')}</th>
                    <th>{t('common.observed')}</th>
                    <th>{t('prices.thFreshness')}</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map((price) => (
                    <tr key={price.id}>
                      <td>
                        <span className="prices-crop">
                          <span><Icon name="leaf" size={13} /></span>
                          <strong>{price.crop_name}</strong>
                        </span>
                      </td>
                      <td>{price.market_name}</td>
                      <td className="num"><strong>{inr(price.price_per_kg)}</strong></td>
                      <td><Trend value={price.trend_pct} /></td>
                      <td className="muted prices-source" title={price.source}>{price.source}</td>
                      <td className="muted">{observed(price.observed_at)}</td>
                      <td>
                        <span className={`ui-badge ui-badge-${price.is_stale ? 'amber' : 'green'}`}>
                          {price.is_stale ? t('common.stale') : t('common.current')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <Modal
          title={t('prices.publishTitle')}
          subtitle={t('prices.publishSubtitle')}
          onClose={() => setModalOpen(false)}
          footer={(
            <>
              <button type="button" className="ui-btn ui-btn-outline" onClick={() => setModalOpen(false)}>{t('common.cancel')}</button>
              <button type="submit" form="price-form" className="ui-btn ui-btn-primary" disabled={saving}>
                {saving ? t('prices.publishing') : t('prices.publish')}
              </button>
            </>
          )}
        >
          <form id="price-form" className="ui-form-grid" onSubmit={submit}>
            <label className="ui-field">
              <span className="ui-label">{t('common.market')}</span>
              <select className="ui-select" value={form.market_id} onChange={(event) => setForm((prev) => ({ ...prev, market_id: event.target.value }))}>
                <option value="">{t('prices.chooseMarket')}</option>
                {markets.map((market) => <option key={market.id} value={market.id}>{market.name} · {market.district}</option>)}
              </select>
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('crops.cropName')}</span>
              <input
                className="ui-input"
                list="price-crop-options"
                value={form.crop_name}
                onChange={(event) => setForm((prev) => ({ ...prev, crop_name: event.target.value }))}
                placeholder={t('crops.cropNamePlaceholder')}
                required
              />
              <datalist id="price-crop-options">
                {filteredCrops.map((name) => <option key={name} value={name} />)}
              </datalist>
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('prices.pricePerKgRs')}</span>
              <input
                className="ui-input"
                type="number"
                min="0.01"
                step="0.01"
                value={form.price_per_kg}
                onChange={(event) => setForm((prev) => ({ ...prev, price_per_kg: event.target.value }))}
                placeholder="18.50"
                required
              />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('prices.observedAt')}</span>
              <input
                className="ui-input"
                type="datetime-local"
                value={form.observed_at}
                onChange={(event) => setForm((prev) => ({ ...prev, observed_at: event.target.value }))}
              />
              <span className="ui-hint">{t('prices.observedHint')}</span>
            </label>
            <label className="ui-field span-2">
              <span className="ui-label">{t('common.source')}</span>
              <input
                className="ui-input"
                value={form.source}
                onChange={(event) => setForm((prev) => ({ ...prev, source: event.target.value }))}
                placeholder={t('prices.sourcePlaceholder')}
              />
            </label>
            {formError && <div className="ui-alert ui-alert-error span-2">{formError}</div>}
          </form>
        </Modal>
      )}
    </div>
  )
}
