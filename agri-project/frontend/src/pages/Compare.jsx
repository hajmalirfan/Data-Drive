import { useEffect, useMemo, useRef, useState } from 'react'
import { compareMarkets, getDecisionOptions } from '../services/decisionService'
import './Compare.css'

// Guest selling-decision page (PRD v4.2 section 5). Every rule is decided by the API;
// this page only collects inputs and shows the result in the PRD's top-to-bottom order.

const STATE_LABELS = {
  RANKED: 'Ranked',
  TOO_CLOSE: 'Too close to call',
  NEEDS_INPUT: 'Needs input',
  INSUFFICIENT_MARKETS: 'Not enough comparable markets',
  NO_FRESH_DATA: 'No fresh prices',
  SOURCE_ERROR: 'Data unavailable',
  EMPTY: 'No records',
}
const STATE_TONE = { RANKED: 'good', TOO_CLOSE: 'warn', NEEDS_INPUT: 'warn' }
const SOURCE_ERROR_MESSAGE = 'Could not retrieve data. Try again later.'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const EMPTY_MARKET = { trip_cost: '', no_cost: false, commission_pct: '', loading: '', handling: '' }

const wholeRupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const paise = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const rs = (value) => (value === null || value === undefined ? '—' : `Rs ${wholeRupees.format(value)}`)
const rsExact = (value) => (value === null || value === undefined ? '—' : `Rs ${paise.format(value)}`)
const blankToNull = (value) => (String(value).trim() === '' ? null : String(value).trim())

function shortDate(iso) {
  if (!iso) return 'date unknown'
  const [year, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

function cropLabel(crop) {
  return crop.charAt(0).toUpperCase() + crop.slice(1)
}

function DataBadge({ data }) {
  if (!data?.label) return null
  return (
    <p className={`cmp-badge ${data.mode === 'sample' ? 'is-sample' : ''}`} role="status">
      {data.mode === 'sample' ? 'Sample data — not reported prices. ' : ''}
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

function DecisionBox({ result, names }) {
  const tone = STATE_TONE[result.state] || 'neutral'
  return (
    <section className={`cmp-decision tone-${tone}`} aria-live="polite">
      <p className="cmp-state">{STATE_LABELS[result.state] || result.state}</p>
      <p className="cmp-message">{result.message}</p>
      {result.state === 'RANKED' && (
        <p className="cmp-sub">
          Ahead by {rs(result.lead)}; markets closer than {rs(result.tie_band)} would be too close to call.
        </p>
      )}
      {result.state === 'TOO_CLOSE' && (
        <p className="cmp-sub">
          The difference is below {rs(result.tie_band)}, so no market is named as best. Order by estimate:{' '}
          {result.cards.filter((c) => c.eligible).map((c) => names[c.market_id] || c.market_name).join(', ')}.
        </p>
      )}
    </section>
  )
}

function HarvestCover({ result, pickingEntered }) {
  const rows = result.cards.filter((c) => c.eligible && c.left_per_crate !== null && c.left_per_crate !== undefined)
  return (
    <section className="ui-card cmp-section">
      <div className="ui-card-head">
        <h3>Harvest Cover Check (per 14 kg crate)</h3>
      </div>
      <div className="ui-card-body">
        {!pickingEntered && <p className="cmp-muted">Enter the picking cost per crate to see what each market leaves per crate.</p>}
        {pickingEntered && rows.length === 0 && (
          <p className="cmp-muted">Shown once at least one market has a usable price and a trip cost.</p>
        )}
        {result.harvest_message && <p className="ui-alert ui-alert-warning">{result.harvest_message}</p>}
        {rows.length > 0 && (
          <ul className="cmp-cover-list">
            {rows.map((c) => (
              <li key={c.market_id}>
                <strong>{c.market_name}</strong>
                <span>
                  Left per crate: {rs(c.left_per_crate)} ({c.covers ? 'covers costs' : 'does not cover costs'})
                </span>
                <span>Price needed to cover costs: {rs(c.cover_price_per_crate)} per crate</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function PriceLine({ card }) {
  const hasRange = card.min_price !== null && card.max_price !== null && !(card.min_price === card.price && card.max_price === card.price)
  const range = hasRange ? ` (${wholeRupees.format(card.min_price)}–${wholeRupees.format(card.max_price)})` : ''
  return (
    <p className="cmp-price-line">
      Modal {card.price === null ? 'not reported' : `Rs ${wholeRupees.format(card.price)}`}
      {range} per {card.unit || 'unit not reported'}
    </p>
  )
}

function Provenance({ card }) {
  return (
    <p className="cmp-provenance">
      {card.market_type_label} · Source: {card.source || 'not reported'} · {shortDate(card.report_date)} ·{' '}
      {card.freshness_text}
    </p>
  )
}

function MarketCard({ card, isWinner }) {
  return (
    <article className={`ui-card cmp-market ${isWinner ? 'is-winner' : ''}`}>
      <div className="ui-card-body">
        <div className="cmp-market-head">
          <h4>{card.market_name}</h4>
          {isWinner && <span className="ui-badge ui-badge-green">Estimated best</span>}
        </div>
        <Provenance card={card} />
        <PriceLine card={card} />
        <dl className="cmp-figures">
          <div><dt>Per kg</dt><dd>{rsExact(card.price_per_kg)}</dd></div>
          <div><dt>Per crate</dt><dd>{rsExact(card.price_per_crate)}</dd></div>
          <div><dt>Gross value</dt><dd>{rs(card.gross)}</dd></div>
          <div>
            <dt>Transport</dt>
            <dd>{card.transport === null ? 'Trip cost needed' : `${rs(card.transport)} (${card.trips} trip${card.trips === 1 ? '' : 's'})`}</dd>
          </div>
          <div><dt>Other selling costs</dt><dd>{rs(card.other)}</dd></div>
          <div><dt>Load fill</dt><dd>{card.load_fill === null || card.load_fill === undefined ? '—' : `${Math.round(card.load_fill * 100)}%`}</dd></div>
          <div className="cmp-estimate"><dt>Estimate after entered costs</dt><dd>{rs(card.estimate)}</dd></div>
        </dl>
      </div>
    </article>
  )
}

function Excluded({ cards }) {
  if (cards.length === 0) return null
  return (
    <section className="ui-card cmp-section">
      <div className="ui-card-head">
        <h3>Not ranked</h3>
      </div>
      <div className="ui-card-body">
        <ul className="cmp-excluded">
          {cards.map((c) => (
            <li key={c.market_id}>
              <strong>{c.market_name}</strong>: {c.reason_text}
              <Provenance card={c} />
              <PriceLine card={c} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Assumptions({ result }) {
  return (
    <section className="cmp-assumptions">
      <h3>Assumptions</h3>
      <ul>
        {result.assumptions.map((line) => <li key={line}>{line}</li>)}
        {result.not_included.length > 0 && <li>Costs not included: {result.not_included.join(', ')}.</li>}
        <li>Prices judged against {shortDate(result.as_of)}.</li>
      </ul>
    </section>
  )
}

export default function Compare() {
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
      .catch(() => setLoadError(SOURCE_ERROR_MESSAGE))
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
        setRequestError(detail.message || 'Check the highlighted fields.')
      } else if (error.response?.status === 422) {
        setRequestError('Check that every number is entered correctly.')
      } else if (error.response?.status === 429) {
        setRequestError(detail || 'Too many requests. Please wait a minute and try again.')
      } else {
        setRequestError(SOURCE_ERROR_MESSAGE)
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
        <h1>Which market leaves you the most per crate?</h1>
        <DataBadge data={result?.data?.label ? result.data : options?.data} />
      </header>

      {loadError && (
        <div className="ui-alert ui-alert-error cmp-load-error" role="alert">
          {loadError}{' '}
          <button type="button" className="ui-btn ui-btn-sm ui-btn-outline" onClick={loadOptions}>Try again</button>
        </div>
      )}
      {!options && !loadError && <div className="ui-loading"><span className="ui-spinner" /></div>}

      {options && (
        <form className="ui-card cmp-section" onSubmit={submit} noValidate>
          <div className="ui-card-body cmp-form">
            <div className="cmp-row">
              <div className="ui-field">
                <label htmlFor="cmp-region">Place</label>
                <select id="cmp-region" className="ui-input" value={regionId} onChange={(e) => { setRegionId(e.target.value); setSelected([]) }}>
                  {options.regions.map((r) => <option key={r.id} value={r.id}>{r.name}, {r.state}</option>)}
                </select>
              </div>
              <div className="ui-field">
                <label htmlFor="cmp-crop">Crop</label>
                <select id="cmp-crop" className="ui-input" value={crop} onChange={(e) => { setCrop(e.target.value); setSelected([]) }}>
                  {(region?.crops || []).map((c) => <option key={c.crop} value={c.crop}>{cropLabel(c.crop)}</option>)}
                </select>
                <FieldError message={errors.crop} />
              </div>
            </div>

            <fieldset className="cmp-fieldset">
              <legend>Markets to compare (choose 2 to {maxMarkets})</legend>
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
              <NumberField id="cmp-qty" label="Quantity" value={quantity} onChange={setQuantity} error={errors.quantity} />
              <div className="ui-field">
                <label htmlFor="cmp-unit">Unit</label>
                <select id="cmp-unit" className="ui-input" value={unit} onChange={(e) => setUnit(e.target.value)}>
                  {options.units.map((u) => <option key={u} value={u}>{u === 'crate' ? 'crate (14 kg)' : u}</option>)}
                </select>
                <FieldError message={errors.unit} />
              </div>
              <NumberField id="cmp-cap" label="Vehicle capacity" suffix="kg" value={capacity} onChange={setCapacity} error={errors.vehicle_capacity_kg} />
            </div>

            <div className="cmp-row">
              <NumberField id="cmp-pick" label="Picking per crate (optional)" suffix="Rs" value={picking} onChange={setPicking} error={errors.picking_per_crate} />
              <NumberField id="cmp-pack" label="Packing per crate (optional)" suffix="Rs" value={packing} onChange={setPacking} error={errors.packing_per_crate} />
            </div>

            {selected.map((id, i) => {
              const m = perMarket[id] || EMPTY_MARKET
              return (
                <fieldset key={id} className="cmp-fieldset cmp-market-costs">
                  <legend>Costs for {names[id] || id}</legend>
                  <div className="cmp-row">
                    <div className="ui-field">
                      <NumberField
                        id={`cmp-trip-${i}`}
                        label="Trip cost (one trip)"
                        suffix="Rs"
                        value={m.no_cost ? '' : m.trip_cost}
                        onChange={(v) => setMarketField(id, 'trip_cost', v)}
                        error={marketError(id, 'trip_cost')}
                      />
                      <label className="cmp-check">
                        <input type="checkbox" checked={m.no_cost} onChange={(e) => setMarketField(id, 'no_cost', e.target.checked)} />
                        No transport cost
                      </label>
                    </div>
                    <NumberField id={`cmp-comm-${i}`} label="Commission (optional)" suffix="%" value={m.commission_pct} onChange={(v) => setMarketField(id, 'commission_pct', v)} error={marketError(id, 'commission_pct')} />
                    <NumberField id={`cmp-load-${i}`} label="Loading (optional)" suffix="Rs" value={m.loading} onChange={(v) => setMarketField(id, 'loading', v)} error={marketError(id, 'loading')} />
                    <NumberField id={`cmp-hand-${i}`} label="Handling (optional)" suffix="Rs" value={m.handling} onChange={(v) => setMarketField(id, 'handling', v)} error={marketError(id, 'handling')} />
                  </div>
                  <FieldError message={errors[`markets[${i}].market_id`]} />
                </fieldset>
              )
            })}

            {requestError && <p className="ui-alert ui-alert-error" role="alert">{requestError}</p>}
            <button type="submit" className="ui-btn ui-btn-primary ui-btn-block" disabled={submitting}>
              {submitting ? 'Comparing…' : 'Compare markets'}
            </button>
          </div>
        </form>
      )}

      {result && (
        <div ref={resultRef} className="cmp-result">
          <DecisionBox result={result} names={names} />
          <HarvestCover result={result} pickingEntered={blankToNull(picking) !== null} />
          {eligible.length > 0 && (
            <section className="cmp-cards">
              {eligible.map((c) => <MarketCard key={c.market_id} card={c} isWinner={c.market_id === result.winner_market_id} />)}
            </section>
          )}
          <Excluded cards={excluded} />
          <Assumptions result={result} />
        </div>
      )}
    </div>
  )
}
