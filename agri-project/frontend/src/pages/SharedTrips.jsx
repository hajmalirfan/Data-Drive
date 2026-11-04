import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import Icon from '../components/Icons'
import { getCrops } from '../services/operationsService'
import {
  closeSharedTrip,
  getSharedTrip,
  getSharedTrips,
  getTripQuote,
  joinSharedTrip,
} from '../services/sharedTripService'
import { formatIndiaDateTime } from '../utils/dateTime'
import './SharedTrips.css'

const inr = (value) =>
  value === null || value === undefined ? '—' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
const when = (value) =>
  formatIndiaDateTime(value, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const detailOf = (error, fallback) => {
  const detail = error?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

function TripFacts({ trip, t }) {
  const used = trip.capacity_kg ? Math.min(100, ((trip.capacity_kg - trip.kg_free) / trip.capacity_kg) * 100) : 0
  return (
    <>
      <div className="st-facts">
        <span><Icon name="calendar" size={13} /> {when(trip.pickup_at)}</span>
        <span><Icon name="route" size={13} /> {t('sharedTrips.pickup', [trip.pickup_point])}</span>
        <span><Icon name="user" size={13} /> {t('sharedTrips.farmers', [trip.member_count])}</span>
        <span><Icon name="rupee" size={13} /> {t('sharedTrips.fare', [inr(trip.trip_fare)])}</span>
      </div>
      <div className="st-space" aria-label={t('sharedTrips.free', [kg(trip.kg_free), kg(trip.capacity_kg)])}>
        <div className="st-space-bar"><span style={{ width: `${used}%` }} /></div>
        <small>{t('sharedTrips.free', [kg(trip.kg_free), kg(trip.capacity_kg)])}</small>
      </div>
    </>
  )
}

export default function SharedTrips() {
  const { t } = useLanguage()
  const { user } = useAuth()
  const [trips, setTrips] = useState([])
  const [mine, setMine] = useState([])
  const [crops, setCrops] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [joinFor, setJoinFor] = useState(null)
  const [form, setForm] = useState({ quantity_kg: '', crop_id: '' })
  const [quote, setQuote] = useState(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [closingId, setClosingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [open, myTrips, myCrops] = await Promise.all([
        getSharedTrips(),
        getSharedTrips({ mine: true }),
        getCrops().catch(() => []),
      ])
      setTrips(open)
      setMine(await Promise.all(myTrips.map((trip) => getSharedTrip(trip.id))))
      setCrops(myCrops)
    } catch {
      setError(t('sharedTrips.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  // Live quote, fetched 400 ms after the farmer stops typing.
  useEffect(() => {
    const amount = Number(form.quantity_kg)
    setQuote(null)
    setFormError('')
    if (!joinFor || !(amount > 0)) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      getTripQuote(joinFor, amount)
        .then((result) => { if (!cancelled) setQuote(result) })
        .catch((err) => { if (!cancelled) setFormError(detailOf(err, t('sharedTrips.loadError'))) })
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [joinFor, form.quantity_kg, t])

  const startJoin = (tripId) => {
    setJoinFor(tripId)
    setForm({ quantity_kg: '', crop_id: '' })
    setNotice('')
  }

  const submitJoin = async (event) => {
    event.preventDefault()
    if (!(Number(form.quantity_kg) > 0)) return
    setSaving(true)
    setFormError('')
    try {
      await joinSharedTrip(joinFor, {
        quantity_kg: Number(form.quantity_kg),
        crop_id: form.crop_id ? Number(form.crop_id) : null,
      })
      setJoinFor(null)
      setNotice(t('sharedTrips.joined'))
      await load()
    } catch (err) {
      setFormError(detailOf(err, t('sharedTrips.loadError')))
    } finally {
      setSaving(false)
    }
  }

  const closeTrip = async (tripId) => {
    setClosingId(tripId)
    try {
      await closeSharedTrip(tripId)
      await load()
    } catch (err) {
      setError(detailOf(err, t('sharedTrips.loadError')))
    } finally {
      setClosingId(null)
    }
  }

  return (
    <div className="ui-page st-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('sharedTrips.heading')}</h2>
          <p>{t('sharedTrips.sub')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <button type="button" className="ui-btn ui-btn-outline" onClick={load}>
            <Icon name="refresh" size={14} /> {t('common.refresh')}
          </button>
          <Link to="/trucks" className="ui-btn ui-btn-primary">
            <Icon name="truck" size={14} /> {t('nav.trucks')}
          </Link>
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <section className="ui-card">
        <div className="ui-card-head"><h3>{t('sharedTrips.open')}</h3></div>
        <div className="ui-card-body">
          {loading ? (
            <div className="ui-loading"><span className="ui-spinner" />{t('common.loading')}</div>
          ) : trips.length === 0 ? (
            <div className="ui-empty">
              <span className="ui-empty-icon"><Icon name="truck" size={22} /></span>
              <strong>{t('sharedTrips.none')}</strong>
            </div>
          ) : (
            <div className="st-list">
              {trips.map((trip) => (
                <article key={trip.id} className="st-trip">
                  <div className="st-trip-head">
                    <strong>{trip.market_name}</strong>
                    {trip.is_member
                      ? <span className="ui-badge ui-badge-green">{t('sharedTrips.onTrip')}</span>
                      : joinFor !== trip.id && (
                        <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => startJoin(trip.id)}>
                          {t('sharedTrips.join')}
                        </button>
                      )}
                  </div>
                  <TripFacts trip={trip} t={t} />
                  {joinFor === trip.id && (
                    <form className="st-join" onSubmit={submitJoin}>
                      <label className="ui-field">
                        <span className="ui-label">{t('sharedTrips.kg')}</span>
                        <input
                          className="ui-input"
                          type="number"
                          min="1"
                          step="0.1"
                          max={trip.kg_free}
                          value={form.quantity_kg}
                          onChange={(event) => setForm((prev) => ({ ...prev, quantity_kg: event.target.value }))}
                          autoFocus
                          required
                        />
                      </label>
                      <label className="ui-field">
                        <span className="ui-label">{t('sharedTrips.crop')}</span>
                        <select
                          className="ui-select"
                          value={form.crop_id}
                          onChange={(event) => setForm((prev) => ({ ...prev, crop_id: event.target.value }))}
                        >
                          <option value="">{t('trucks.generalGoods')}</option>
                          {crops.map((crop) => (
                            <option key={crop.id} value={crop.id}>{crop.crop_name} · {kg(crop.quantity_kg)}</option>
                          ))}
                        </select>
                      </label>
                      {quote && (
                        <p className="st-quote">
                          {t('sharedTrips.quote', [inr(quote.share), inr(quote.alone), inr(quote.saving)])}
                        </p>
                      )}
                      {formError && <p className="st-error" role="alert">{formError}</p>}
                      <div className="st-join-actions">
                        <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => setJoinFor(null)}>
                          {t('common.cancel')}
                        </button>
                        <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={saving || !quote}>
                          {saving ? t('common.saving') : t('sharedTrips.join')}
                        </button>
                      </div>
                    </form>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="ui-card">
        <div className="ui-card-head"><h3>{t('sharedTrips.mine')}</h3></div>
        <div className="ui-card-body">
          {loading ? (
            <div className="ui-loading"><span className="ui-spinner" />{t('common.loading')}</div>
          ) : mine.length === 0 ? (
            <div className="ui-empty"><strong>{t('sharedTrips.noneMine')}</strong></div>
          ) : (
            <div className="st-list">
              {mine.map((trip) => {
                const onTrip = trip.members.filter((member) => member.status !== 'cancelled' && member.status !== 'rejected')
                return (
                  <article key={trip.id} className="st-trip">
                    <div className="st-trip-head">
                      <strong>{trip.market_name}</strong>
                      {trip.status === 'open'
                        ? trip.opener_id === user?.id && (
                          <button
                            type="button"
                            className="ui-btn ui-btn-outline ui-btn-sm"
                            disabled={closingId === trip.id}
                            onClick={() => closeTrip(trip.id)}
                          >
                            {t('sharedTrips.close')}
                          </button>
                        )
                        : <span className="ui-badge ui-badge-grey">{t('sharedTrips.closed')}</span>}
                    </div>
                    <TripFacts trip={trip} t={t} />
                    <ul className="st-members">
                      {onTrip.map((member) => (
                        <li key={member.booking_id}>
                          <span>{member.first_name}</span>
                          <span>{kg(member.quantity_kg)}</span>
                          <strong>{inr(member.share)}</strong>
                        </li>
                      ))}
                    </ul>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
