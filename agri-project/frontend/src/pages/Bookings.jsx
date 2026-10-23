import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icons'
import Modal from '../components/Modal'
import {
  getBookings,
  recordDelivery,
  updateBookingStatus,
} from '../services/operationsService'
import './Bookings.css'
import { useLanguage } from '../context/LanguageContext'

const inr = (value) =>
  value === null || value === undefined ? '—' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
const when = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—'

const STATUS_TONE = {
  requested: 'amber',
  accepted: 'blue',
  assigned: 'blue',
  picked_up: 'blue',
  in_transit: 'blue',
  delivered: 'green',
  rejected: 'red',
  cancelled: 'red',
}
const ACTIVE = new Set(['requested', 'accepted', 'assigned', 'picked_up', 'in_transit'])
const NEXT_STEP = {
  requested: 'accepted',
  accepted: 'assigned',
  assigned: 'picked_up',
  picked_up: 'in_transit',
  in_transit: 'delivered',
}
export default function Bookings() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const { isAdmin, isTruckOperator, isFarmer, isMarketer } = useAuth()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('all')
  const [busyId, setBusyId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [deliveryFor, setDeliveryFor] = useState(null)
  const [delivery, setDelivery] = useState({ actual_sold_quantity_kg: '', actual_price_per_kg: '', actual_expenses: '' })
  const [deliveryError, setDeliveryError] = useState('')
  const [saving, setSaving] = useState(false)

  const canOperate = isAdmin || isTruckOperator
  const canOwn = isAdmin || isFarmer || isMarketer

  const load = () => {
    setLoading(true)
    getBookings()
      .then(setBookings)
      .catch((err) => setError(err.response?.data?.detail || t('bookings.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (tab === 'active') return bookings.filter((item) => ACTIVE.has(item.status))
    if (tab === 'delivered') return bookings.filter((item) => item.status === 'delivered')
    if (tab === 'closed') return bookings.filter((item) => ['cancelled', 'rejected'].includes(item.status))
    return bookings
  }, [bookings, tab])

  const stats = useMemo(() => ({
    total: bookings.length,
    active: bookings.filter((item) => ACTIVE.has(item.status)).length,
    delivered: bookings.filter((item) => item.status === 'delivered').length,
    transport: bookings.reduce((sum, item) => sum + Number(item.estimated_transport_cost || 0), 0),
  }), [bookings])

  const changeStatus = async (booking, status, note = '') => {
    setBusyId(booking.id)
    setError('')
    try {
      const updated = await updateBookingStatus(booking.id, { status, note })
      setBookings((prev) => prev.map((item) => (item.id === booking.id ? updated : item)))
      setDetail((prev) => (prev?.id === booking.id ? updated : prev))
      setNotice(t('bookings.updated', [booking.id, statusLabel(status)]))
    } catch (err) {
      setError(err.response?.data?.detail || t('tracking.updateError'))
    } finally {
      setBusyId(null)
    }
  }

  const openDelivery = (booking) => {
    setDelivery({
      actual_sold_quantity_kg: String(booking.actual_sold_quantity_kg ?? booking.quantity_kg ?? ''),
      actual_price_per_kg: String(booking.actual_price_per_kg ?? ''),
      actual_expenses: String(booking.actual_expenses ?? booking.estimated_transport_cost ?? ''),
    })
    setDeliveryError('')
    setDeliveryFor(booking)
  }

  const submitDelivery = async (event) => {
    event.preventDefault()
    setDeliveryError('')
    if (!Number(delivery.actual_sold_quantity_kg)) { setDeliveryError(t('bookings.errSoldQty')); return }
    if (!Number(delivery.actual_price_per_kg)) { setDeliveryError(t('bookings.errRealised')); return }
    setSaving(true)
    try {
      const updated = await recordDelivery(deliveryFor.id, {
        actual_sold_quantity_kg: Number(delivery.actual_sold_quantity_kg),
        actual_price_per_kg: Number(delivery.actual_price_per_kg),
        actual_expenses: Number(delivery.actual_expenses) || 0,
      })
      setBookings((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setDeliveryFor(null)
      setNotice(t('bookings.saleSaved', [updated.id]))
    } catch (err) {
      setDeliveryError(err.response?.data?.detail || t('bookings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const bookingRevenue = deliveryFor
    ? (Number(delivery.actual_sold_quantity_kg) || 0) * (Number(delivery.actual_price_per_kg) || 0) -
      (Number(delivery.actual_expenses) || 0)
    : 0

  return (
    <div className="ui-page bookings-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('bookings.title')}</h2>
          <p>{t('bookings.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <Link to="/trucks" className="ui-btn ui-btn-primary">
            <Icon name="plus" size={15} /> New booking
          </Link>
          <button type="button" className="ui-btn ui-btn-outline" onClick={load}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <div className="bookings-stats">
        <div className="bookings-stat"><span className="green"><Icon name="bookings" size={17} /></span><div><small>{t('bookings.total')}</small><strong>{stats.total}</strong></div></div>
        <div className="bookings-stat"><span className="amber"><Icon name="clock" size={17} /></span><div><small>{t('bookings.activeTrips')}</small><strong>{stats.active}</strong></div></div>
        <div className="bookings-stat"><span className="blue"><Icon name="check" size={17} /></span><div><small>{t('common.delivered')}</small><strong>{stats.delivered}</strong></div></div>
        <div className="bookings-stat"><span className="red"><Icon name="rupee" size={17} /></span><div><small>{t('bookings.transportValue')}</small><strong>{inr(stats.transport)}</strong></div></div>
      </div>

      <div className="ui-card">
        <div className="bookings-tabs">
          {[
            ['all', t('common.all')],
            ['active', t('common.active')],
            ['delivered', t('common.delivered')],
            ['closed', t('bookings.tabClosed')],
          ].map(([value, label]) => (
            <button key={value} type="button" className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>
              {label}
            </button>
          ))}
        </div>

        <div className="ui-card-body bookings-body">
          {loading ? (
            <div className="ui-loading"><span className="ui-spinner" />{t('bookings.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="ui-empty">
              <span className="ui-empty-icon"><Icon name="bookings" size={22} /></span>
              <strong>{t('bookings.none')}</strong>
              <p>{tab === 'all' ? t('bookings.noneAll') : t('bookings.noneStatus')}</p>
              {tab === 'all' && (
                <Link to="/trucks" className="ui-btn ui-btn-primary ui-btn-sm" style={{ marginTop: 6 }}>
                  <Icon name="truck" size={14} /> Find a truck
                </Link>
              )}
            </div>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table bookings-table">
                <thead>
                  <tr>
                    <th>{t('bookings.thBooking')}</th>
                    <th>{t('bookings.thCropLoad')}</th>
                    <th>{t('bookings.thRoute')}</th>
                    <th>{t('common.truck')}</th>
                    <th>{t('common.pickup')}</th>
                    <th className="num">{t('common.quantity')}</th>
                    <th className="num">{t('bookings.thTransport')}</th>
                    <th>{t('common.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((booking) => {
                    const active = ACTIVE.has(booking.status)
                    const next = NEXT_STEP[booking.status]
                    return (
                      <tr key={booking.id}>
                        <td>
                          <button type="button" className="bookings-id" onClick={() => setDetail(booking)}>
                            #{booking.id}
                          </button>
                          <small className="bookings-sub">{booking.farmer_name || t('common.you')}</small>
                        </td>
                        <td>
                          <strong>{booking.crop_name || t('common.generalGoods')}</strong>
                          <small className="bookings-sub">{kg(booking.quantity_kg)}</small>
                        </td>
                        <td>
                          <strong>{booking.market_name}</strong>
                          <small className="bookings-sub">{booking.pickup_location}</small>
                        </td>
                        <td>
                          <strong>{booking.vehicle_number || '—'}</strong>
                          <small className="bookings-sub">{booking.truck_type}</small>
                        </td>
                        <td className="muted">{when(booking.pickup_at)}</td>
                        <td className="num">{kg(booking.quantity_kg)}</td>
                        <td className="num">{inr(booking.estimated_transport_cost)}</td>
                        <td><span className={`ui-badge ui-badge-${STATUS_TONE[booking.status] || 'grey'}`}>{statusLabel(booking.status)}</span></td>
                        <td>
                          <div className="actions">
                            <button type="button" className="ui-icon-btn" title={t('bookings.viewDetails')} onClick={() => setDetail(booking)}>
                              <Icon name="eye" size={14} />
                            </button>
                            {canOperate && booking.status === 'requested' && (
                              <>
                                <button
                                  type="button"
                                  className="ui-btn ui-btn-soft ui-btn-sm"
                                  disabled={busyId === booking.id}
                                  onClick={() => changeStatus(booking, 'accepted')}
                                >
                                  Accept
                                </button>
                                <button
                                  type="button"
                                  className="ui-btn ui-btn-danger ui-btn-sm"
                                  disabled={busyId === booking.id}
                                  onClick={() => changeStatus(booking, 'rejected')}
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {canOperate && next && booking.status !== 'requested' && (
                              <button
                                type="button"
                                className="ui-btn ui-btn-soft ui-btn-sm"
                                disabled={busyId === booking.id}
                                onClick={() => changeStatus(booking, next)}
                              >
                                {statusLabel(next)}
                              </button>
                            )}
                            {canOwn && active && booking.status !== 'requested' && (
                              <button
                                type="button"
                                className="ui-btn ui-btn-outline ui-btn-sm"
                                disabled={busyId === booking.id}
                                onClick={() => changeStatus(booking, 'cancelled')}
                              >
                                {t('bookings.cancel')}
                              </button>
                            )}
                            {canOwn && booking.status === 'delivered' && (
                              <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => openDelivery(booking)}>
                                {booking.actual_price_per_kg ? t('bookings.editSale') : t('bookings.recordSale')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {detail && (
        <Modal
          title={t('bookings.bookingTitle', [detail.id])}
          subtitle={`${detail.crop_name || t('common.generalGoods')} · ${detail.market_name}`}
          onClose={() => setDetail(null)}
          size="lg"
          footer={<button type="button" className="ui-btn ui-btn-outline" onClick={() => setDetail(null)}>{t('common.close')}</button>}
        >
          <div className="booking-detail">
            <div className="booking-detail-status">
              <span className={`ui-badge ui-badge-${STATUS_TONE[detail.status] || 'grey'}`}>{statusLabel(detail.status)}</span>
              <span>{ACTIVE.has(detail.status) ? t('bookings.tripActive') : t('bookings.tripClosed')}</span>
            </div>
            <div className="booking-detail-grid">
              <div><span>{t('role.farmer')}</span><strong>{detail.farmer_name || t('common.you')}</strong></div>
              <div><span>{t('common.truck')}</span><strong>{detail.vehicle_number} · {detail.truck_type}</strong></div>
              <div><span>{t('common.pickup')}</span><strong>{detail.pickup_location}</strong></div>
              <div><span>{t('common.destination')}</span><strong>{detail.destination || detail.market_name}</strong></div>
              <div><span>{t('tracking.pickupTime')}</span><strong>{when(detail.pickup_at)}</strong></div>
              <div><span>{t('bookings.requestedAt')}</span><strong>{when(detail.created_at)}</strong></div>
              <div><span>{t('common.distance')}</span><strong>{Number(detail.distance_km).toFixed(0)} km · {detail.eta_minutes} min</strong></div>
              <div><span>{t('common.quantity')}</span><strong>{kg(detail.quantity_kg)}</strong></div>
              <div><span>{t('tracking.transportCost')}</span><strong>{inr(detail.estimated_transport_cost)}</strong></div>
              <div><span>{t('bookings.estimatedNet')}</span><strong>{inr(detail.estimated_net_proceeds)}</strong></div>
              <div><span>{t('bookings.accompanied')}</span><strong>{detail.accompanied ? t('bookings.yesTravelling') : t('common.no')}</strong></div>
              <div><span>{t('bookings.locationSharing')}</span><strong>{detail.location_consent ? t('bookings.consented') : t('bookings.notShared')}</strong></div>
            </div>
            {detail.notes && <p className="booking-detail-note"><Icon name="info" size={13} /> {detail.notes}</p>}
            {detail.actual_price_per_kg && (
              <div className="booking-actuals">
                <strong>{t('bookings.recordedSale')}</strong>
                <div>
                  <span>{t('bookings.soldQuantity')}</span><span>{kg(detail.actual_sold_quantity_kg)}</span>
                </div>
                <div>
                  <span>{t('bookings.pricePerKg')}</span><span>{inr(detail.actual_price_per_kg)}</span>
                </div>
                <div>
                  <span>{t('bookings.expenses')}</span><span>{inr(detail.actual_expenses)}</span>
                </div>
                <div className={t('tracking.total')}>
                  <span>{t('bookings.netRealised')}</span>
                  <span>{inr((detail.actual_sold_quantity_kg || 0) * (detail.actual_price_per_kg || 0) - (detail.actual_expenses || 0))}</span>
                </div>
              </div>
            )}
            <div className="booking-detail-actions">
              {canOperate && NEXT_STEP[detail.status] && (
                <button
                  type="button"
                  className="ui-btn ui-btn-primary ui-btn-sm"
                  onClick={() => changeStatus(detail, NEXT_STEP[detail.status])}
                >
                  {t('bookings.markStatus', [statusLabel(NEXT_STEP[detail.status])])}
                </button>
              )}
              {canOperate && detail.status === 'requested' && (
                <button type="button" className="ui-btn ui-btn-danger ui-btn-sm" onClick={() => changeStatus(detail, 'rejected')}>
                  {t('bookings.rejectBooking')}
                </button>
              )}
              {canOwn && ACTIVE.has(detail.status) && detail.status !== 'requested' && (
                <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => changeStatus(detail, 'cancelled')}>
                  {t('bookings.cancelBooking')}
                </button>
              )}
              {canOwn && detail.status === 'delivered' && (
                <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => { setDetail(null); openDelivery(detail) }}>
                  {detail.actual_price_per_kg ? t('bookings.editSaleDetails') : t('bookings.recordSale')}
                </button>
              )}
              {ACTIVE.has(detail.status) && (
                <Link to="/tracking" className="ui-btn ui-btn-outline ui-btn-sm">{t('bookings.openTracking')}</Link>
              )}
            </div>
          </div>
        </Modal>
      )}

      {deliveryFor && (
        <Modal
          title={t('bookings.recordSaleTitle', [deliveryFor.id])}
          subtitle={t('bookings.recordSaleSubtitle')}
          onClose={() => setDeliveryFor(null)}
          footer={(
            <>
              <button type="button" className="ui-btn ui-btn-outline" onClick={() => setDeliveryFor(null)}>{t('common.cancel')}</button>
              <button type="submit" form="delivery-form" className="ui-btn ui-btn-primary" disabled={saving}>
                {saving ? t('common.saving') : t('bookings.saveSaleDetails')}
              </button>
            </>
          )}
        >
          <form id="delivery-form" className="ui-form-grid" onSubmit={submitDelivery}>
            <label className="ui-field">
              <span className="ui-label">{t('bookings.soldQuantityKg')}</span>
              <input
                className="ui-input"
                type="number"
                min="0"
                step="0.1"
                value={delivery.actual_sold_quantity_kg}
                onChange={(event) => setDelivery((prev) => ({ ...prev, actual_sold_quantity_kg: event.target.value }))}
                required
              />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('bookings.realisedPrice')}</span>
              <input
                className="ui-input"
                type="number"
                min="0"
                step="0.01"
                value={delivery.actual_price_per_kg}
                onChange={(event) => setDelivery((prev) => ({ ...prev, actual_price_per_kg: event.target.value }))}
                required
              />
            </label>
            <label className="ui-field span-2">
              <span className="ui-label">{t('bookings.actualExpenses')}</span>
              <input
                className="ui-input"
                type="number"
                min="0"
                step="0.01"
                value={delivery.actual_expenses}
                onChange={(event) => setDelivery((prev) => ({ ...prev, actual_expenses: event.target.value }))}
              />
              <span className="ui-hint">{t('bookings.expensesHint')}</span>
            </label>
            <div className="delivery-total span-2">
              <span>{t('bookings.netRealisedValue')}</span>
              <strong>{inr(bookingRevenue)}</strong>
            </div>
            {deliveryError && <div className="ui-alert ui-alert-error span-2">{deliveryError}</div>}
          </form>
        </Modal>
      )}
    </div>
  )
}
