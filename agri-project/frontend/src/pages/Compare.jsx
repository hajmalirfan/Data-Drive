import { useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import { compareMarkets, getDecisionOptions } from '../services/decisionService'
import { rupees } from '../utils/money'
import './Compare.css'

// Guest selling-decision page (PRD v4.2 section 5). Every rule is decided by the API;
// this page only collects inputs and shows the result in the PRD's top-to-bottom order.
// Page text comes from the compare.* catalogue keys; the API's result messages, reasons
// and assumptions stay in English as the PRD words them.

const STATE_KEYS = {
  RANKED: 'compare.stateRanked',
  TOO_CLOSE: 'compare.stateTooClose',
  NEEDS_INPUT: 'compare.stateNeedsInput',
  INSUFFICIENT_MARKETS: 'compare.stateInsufficient',
  NO_FRESH_DATA: 'compare.stateNoFresh',
  SOURCE_ERROR: 'compare.stateSourceError',
  EMPTY: 'compare.stateEmpty',
}
const STATE_TONE = { RANKED: 'good', TOO_CLOSE: 'warn', NEEDS_INPUT: 'warn' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const EMPTY_MARKET = { trip_cost: '', no_cost: false, commission_pct: '', loading: '', handling: '' }

const rs = (value) => rupees(value)
const rsExact = (value) => rupees(value, { minDecimals: 2 })
const blankToNull = (value) => (String(value).trim() === '' ? null : String(value).trim())

function shortDate(iso, t) {
  if (!iso) return t('compare.dateUnknown')
  const [year, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

function cropLabel(crop) {
  return crop.charAt(0).toUpperCase() + crop.slice(1)
}

// Distinguish "too many requests" and "no connection" from a data-source failure (MR-10).
function requestFailure(error, t) {
  const status = error.response?.status
  if (status === 429) return error.response.data?.detail || t('compare.tooMany')
  if (!error.response) return t('compare.offline')
  return t('compare.sourceError')
}

function DataBadge({ data, t }) {
  if (!data?.label) return null
  return (
    <p className={`cmp-badge ${data.mode === 'sample' ? 'is-sample' : ''}`} role="status">
      {data.mode === 'sample' ? `${t('compare.sampleNotice')} ` : ''}
      {data.label}
    </p>
  )
}

function FieldError({ message }) {
  return message ? <span className="cmp-field-error">{message}</span> : null
}

function NumberField({ id, label, value, onChange, error, hint, step = 'any', min = '0', suffix }) {
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <div className="cmp-input-wrap">
        <input
          id={id}
          className={`ui-input ${error ? 'is-invalid' : ''}`}
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
        />
        {suffix && <span className="cmp-suffix">{suffix}</span>}
      </div>
      {hint && <span className="ui-hint">{hint}</span>}
      <FieldError message={error} />
    </div>
  )
}

function DecisionBox({ result, names, t }) {
  const tone = STATE_TONE[result.state] || 'neutral'
  return (
    <section className={`cmp-decision tone-${tone}`} aria-live="polite">
      <p className="cmp-state">{STATE_KEYS[result.state] ? t(STATE_KEYS[result.state]) : result.state}</p>
      <p className="cmp-message">{result.message}</p>
      {result.state === 'RANKED' && (
        <p className="cmp-sub">{t('compare.rankedSub', [rs(result.lead), rs(result.tie_band)])}</p>
      )}
      {result.state === 'TOO_CLOSE' && (
        <p className="cmp-sub">
          {t('compare.tooCloseSub', [
            rs(result.tie_band),
            result.cards.filter((c) => c.eligible).map((c) => names[c.market_id] || c.market_name).join(', '),
          ])}
        </p>
      )}
    </section>
  )
}

function HarvestCover({ result, pickingEntered, t }) {
  const rows = result.cards.filter((c) => c.eligible && c.left_per_crate !== null && c.left_per_crate !== undefined)
  return (
    <section className="ui-card cmp-section">
      <div className="ui-card-head">
        <h3>{t('compare.harvestTitle')}</h3>
      </div>
      <div className="ui-card-body">
        {!pickingEntered && <p className="cmp-muted">{t('compare.harvestNeedPicking')}</p>}
        {pickingEntered && rows.length === 0 && <p className="cmp-muted">{t('compare.harvestNeedPrice')}</p>}
        {result.harvest_message && <p className="ui-alert ui-alert-warning">{result.harvest_message}</p>}
        {rows.length > 0 && (
          <ul className="cmp-cover-list">
            {rows.map((c) => (
              <li key={c.market_id}>
                <strong>{c.market_name}</strong>
                <span>
                  {t('compare.leftPerCrate', [rs(c.left_per_crate), t(c.covers ? 'compare.covers' : 'compare.doesNotCover')])}
                </span>
                <span>{t('compare.coverPrice', [rs(c.cover_price_per_crate)])}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function PriceLine({ card, t }) {
  const hasRange = card.min_price !== null && card.max_price !== null && !(card.min_price === card.price && card.max_price === card.price)
  const range = hasRange ? ` (${rupees(card.min_price, { symbol: '' })}–${rupees(card.max_price, { symbol: '' })})` : ''
  const price = card.price === null ? t('compare.notReported') : rs(card.price)
  return (
    <p className="cmp-price-line">
      {t('compare.modalLine', [price, range, card.unit || t('compare.unitNotReported')])}
    </p>
  )
}

function Provenance({ card, t }) {
  return (
    <p className="cmp-provenance">
      {card.market_type_label} · {t('compare.source')} {card.source || t('compare.notReported')} ·{' '}
      {shortDate(card.report_date, t)} · {card.freshness_text}
    </p>
  )
}

function MarketCard({ card, isWinner, t }) {
  const trips = card.trips === 1 ? t('compare.oneTrip') : t('compare.trips', [card.trips])
  return (
    <article className={`ui-card cmp-market ${isWinner ? 'is-winner' : ''}`}>
      <div className="ui-card-body">
        <div className="cmp-market-head">
          <h4>{card.market_name}</h4>
          {isWinner && <span className="ui-badge ui-badge-green">{t('compare.estimatedBest')}</span>}
        </div>
        <Provenance card={card} t={t} />
        <PriceLine card={card} t={t} />
        <dl className="cmp-figures">
          <div><dt>{t('compare.perKg')}</dt><dd>{rsExact(card.price_per_kg)}</dd></div>
          <div><dt>{t('compare.perCrate')}</dt><dd>{rsExact(card.price_per_crate)}</dd></div>
          <div><dt>{t('compare.gross')}</dt><dd>{rs(card.gross)}</dd></div>
          <div>
            <dt>{t('compare.transport')}</dt>
            <dd>{card.transport === null ? t('compare.tripNeeded') : `${rs(card.transport)} (${trips})`}</dd>
          </div>
          <div><dt>{t('compare.otherCosts')}</dt><dd>{rs(card.other)}</dd></div>
          <div><dt>{t('compare.loadFill')}</dt><dd>{card.load_fill === null || card.load_fill === undefined ? '—' : `${Math.round(card.load_fill * 100)}%`}</dd></div>
          <div className="cmp-estimate"><dt>{t('compare.estimate')}</dt><dd>{rs(card.estimate)}</dd></div>
        </dl>
      </div>
    </article>
  )
}

function Excluded({ cards, t }) {
  if (cards.length === 0) return null
  return (
    <section className="ui-card cmp-section">
      <div className="ui-card-head">
        <h3>{t('compare.notRanked')}</h3>
      </div>
      <div className="ui-card-body">
        <ul className="cmp-excluded">
          {cards.map((c) => (
            <li key={c.market_id}>
              <strong>{c.market_name}</strong>: {c.reason_text}
              <Provenance card={c} t={t} />
              <PriceLine card={c} t={t} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Assumptions({ result, t }) {
  return (
    <section className="cmp-assumptions">
      <h3>{t('compare.assumptions')}</h3>
      <ul>
        {result.assumptions.map((line) => <li key={line}>{line}</li>)}
        {result.not_included.length > 0 && <li>{t('compare.notIncluded', [result.not_included.join(', ')])}</li>}
        <li>{t('compare.judgedAgainst', [shortDate(result.as_of, t)])}</li>
      </ul>
    </section>
  )
}

export default function Compare() {
  const { t } = useLanguage()
  const [options, setOptions] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [regionId, setRegionId] = useState('')
  const [crop, setCrop] = useState('')
  const [selected, setSelected] = useState([])
  const [perMarket, setPerMarket] = useState({})
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('kg')
  const [capacity, setCapacity] = useState('')
  const [picking, setPicking] = useState('')
  const [packing, setPacking] = useState('')
  const [result, setResult] = useState(null)
  const [errors, setErrors] = useState({})
  const [requestError, setRequestError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const resultRef = useRef(null)

  useEffect(() => {
    document.title = t('compare.pageTitle')
  }, [t])

  // A result only describes the inputs it was computed from: drop it as soon as any input changes.
  useEffect(() => {
    setResult(null)
  }, [regionId, crop, selected, perMarket, quantity, unit, capacity, picking, packing])

  const loadOptions = () => {
    setLoadError('')
    getDecisionOptions()
      .then((data) => {
        setOptions(data)
        const region = data.regions[0]
        if (region) {
          setRegionId(String(region.id))
          setCrop(region.crops[0]?.crop || '')
        }
      })
      .catch((error) => setLoadError(requestFailure(error, t)))
  }
  useEffect(loadOptions, [])

  const region = options?.regions.find((r) => String(r.id) === regionId)
  const markets = useMemo(() => region?.crops.find((c) => c.crop === crop)?.markets || [], [region, crop])
  const names = useMemo(() => Object.fromEntries(markets.map((m) => [m.id, m.name])), [markets])
  const maxMarkets = options?.max_markets || 3

  const toggleMarket = (id) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((m) => m !== id)
      if (current.length >= maxMarkets) return current
      return [...current, id]
    })
    setPerMarket((current) => (current[id] ? current : { ...current, [id]: { ...EMPTY_MARKET } }))
  }

  const setMarketField = (id, field, value) =>
    setPerMarket((current) => ({ ...current, [id]: { ...current[id], [field]: value } }))

  const marketError = (id, field) => errors[`markets[${selected.indexOf(id)}].${field}`]

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setRequestError('')
    setErrors({})
    const payload = {
      region_id: region ? region.id : null,
      crop,
      quantity: blankToNull(quantity),
      unit,
      vehicle_capacity_kg: blankToNull(capacity),
      picking_per_crate: blankToNull(picking),
      packing_per_crate: blankToNull(packing),
      markets: selected.map((id) => {
        const m = perMarket[id] || EMPTY_MARKET
        return {
          market_id: id,
          trip_cost: m.no_cost ? null : blankToNull(m.trip_cost),
          no_cost: m.no_cost,
          commission_pct: blankToNull(m.commission_pct),
          loading: blankToNull(m.loading),
          handling: blankToNull(m.handling),
        }
      }),
    }
    try {
      const data = await compareMarkets(payload)
      setResult(data)
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (error) {
      const detail = error.response?.data?.detail
      setResult(null)
      if (error.response?.status === 422 && detail?.errors) {
        setErrors(detail.errors)
        setRequestError(detail.message || t('compare.checkFields'))
      } else if (error.response?.status === 422) {
        setRequestError(t('compare.checkNumbers'))
      } else {
        setRequestError(requestFailure(error, t))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const eligible = result ? result.cards.filter((c) => c.eligible) : []
  const excluded = result ? result.cards.filter((c) => !c.eligible) : []

  return (
    <div className="cmp-page">
      <header className="cmp-header">
        <p className="cmp-brand">SmartAg Ops Advisor</p>
        <h1>{t('compare.heading')}</h1>
        <DataBadge data={result?.data?.label ? result.data : options?.data} t={t} />
      </header>

      {loadError && (
        <div className="ui-alert ui-alert-error cmp-load-error" role="alert">
          {loadError}{' '}
          <button type="button" className="ui-btn ui-btn-sm ui-btn-outline" onClick={loadOptions}>{t('compare.tryAgain')}</button>
        </div>
      )}
      {!options && !loadError && <div className="ui-loading"><span className="ui-spinner" /></div>}

      {options && (
        <form className="ui-card cmp-section" onSubmit={submit} noValidate>
          <div className="ui-card-body cmp-form">
            <div className="cmp-row">
              <div className="ui-field">
                <label htmlFor="cmp-region">{t('compare.place')}</label>
                <select id="cmp-region" className="ui-input" value={regionId} onChange={(e) => { setRegionId(e.target.value); setSelected([]) }}>
                  {options.regions.map((r) => <option key={r.id} value={r.id}>{r.name}, {r.state}</option>)}
                </select>
              </div>
              <div className="ui-field">
                <label htmlFor="cmp-crop">{t('compare.crop')}</label>
                <select id="cmp-crop" className="ui-input" value={crop} onChange={(e) => { setCrop(e.target.value); setSelected([]) }}>
                  {(region?.crops || []).map((c) => <option key={c.crop} value={c.crop}>{cropLabel(c.crop)}</option>)}
                </select>
                <FieldError message={errors.crop} />
              </div>
            </div>

            <fieldset className="cmp-fieldset">
              <legend>{t('compare.marketsLegend', [maxMarkets])}</legend>
              <div className="cmp-market-picks">
                {markets.map((m) => (
                  <label key={m.id} className={`cmp-pick ${selected.includes(m.id) ? 'is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected.includes(m.id)}
                      disabled={!selected.includes(m.id) && selected.length >= maxMarkets}
                      onChange={() => toggleMarket(m.id)}
                    />
                    <span>{m.name}</span>
                    <small>{m.market_type_label}</small>
                  </label>
                ))}
              </div>
              <FieldError message={errors.markets} />
            </fieldset>

            <div className="cmp-row">
              <NumberField id="cmp-qty" label={t('compare.quantity')} value={quantity} onChange={setQuantity} error={errors.quantity} />
              <div className="ui-field">
                <label htmlFor="cmp-unit">{t('compare.unit')}</label>
                <select id="cmp-unit" className="ui-input" value={unit} onChange={(e) => setUnit(e.target.value)}>
                  {options.units.map((u) => <option key={u} value={u}>{u === 'crate' ? t('compare.crateUnit') : u}</option>)}
                </select>
                <FieldError message={errors.unit} />
              </div>
              <NumberField id="cmp-cap" label={t('compare.capacity')} suffix="kg" value={capacity} onChange={setCapacity} error={errors.vehicle_capacity_kg} />
            </div>

            <div className="cmp-row">
              <NumberField id="cmp-pick" label={t('compare.picking')} suffix="Rs" value={picking} onChange={setPicking} error={errors.picking_per_crate} />
              <NumberField id="cmp-pack" label={t('compare.packing')} suffix="Rs" value={packing} onChange={setPacking} error={errors.packing_per_crate} />
            </div>

            {selected.map((id, i) => {
              const m = perMarket[id] || EMPTY_MARKET
              return (
                <fieldset key={id} className="cmp-fieldset cmp-market-costs">
                  <legend>{t('compare.costsFor', [names[id] || id])}</legend>
                  <div className="cmp-row">
                    <div className="ui-field">
                      <NumberField
                        id={`cmp-trip-${i}`}
                        label={t('compare.tripCost')}
                        suffix="Rs"
                        value={m.no_cost ? '' : m.trip_cost}
                        onChange={(v) => setMarketField(id, 'trip_cost', v)}
                        error={marketError(id, 'trip_cost')}
                      />
                      <label className="cmp-check">
                        <input type="checkbox" checked={m.no_cost} onChange={(e) => setMarketField(id, 'no_cost', e.target.checked)} />
                        {t('compare.noTransportCost')}
                      </label>
                    </div>
                    <NumberField id={`cmp-comm-${i}`} label={t('compare.commission')} suffix="%" value={m.commission_pct} onChange={(v) => setMarketField(id, 'commission_pct', v)} error={marketError(id, 'commission_pct')} />
                    <NumberField id={`cmp-load-${i}`} label={t('compare.loading')} suffix="Rs" value={m.loading} onChange={(v) => setMarketField(id, 'loading', v)} error={marketError(id, 'loading')} />
                    <NumberField id={`cmp-hand-${i}`} label={t('compare.handling')} suffix="Rs" value={m.handling} onChange={(v) => setMarketField(id, 'handling', v)} error={marketError(id, 'handling')} />
                  </div>
                  <FieldError message={errors[`markets[${i}].market_id`]} />
                </fieldset>
              )
            })}

            {requestError && <p className="ui-alert ui-alert-error" role="alert">{requestError}</p>}
            <button type="submit" className="ui-btn ui-btn-primary ui-btn-block" disabled={submitting}>
              {submitting ? t('compare.comparing') : t('compare.submit')}
            </button>
          </div>
        </form>
      )}

      {result && (
        <div ref={resultRef} className="cmp-result">
          <DecisionBox result={result} names={names} t={t} />
          <HarvestCover result={result} pickingEntered={blankToNull(picking) !== null} t={t} />
          {eligible.length > 0 && (
            <section className="cmp-cards">
              {eligible.map((c) => <MarketCard key={c.market_id} card={c} isWinner={c.market_id === result.winner_market_id} t={t} />)}
            </section>
          )}
          <Excluded cards={excluded} t={t} />
          <Assumptions result={result} t={t} />
        </div>
      )}
    </div>
  )
}
