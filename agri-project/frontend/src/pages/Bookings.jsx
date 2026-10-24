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
import { formatIndiaDateTime } from '../utils/dateTime'

const inr = (value) =>
  value === null || value === undefined ? '—' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
const when = (value) =>
  value
    ? formatIndiaDateTime(value, {
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
  const { t, statusLabel } = useLanguage()
  const { isAdmin, isTruckOperator, isFarmer, isMarketer } = useAuth()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [busyId, setBusyId] = useState(null)
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
    const byTab =
      tab === 'active'
        ? bookings.filter((item) => ACTIVE.has(item.status))
        : tab === 'delivered'
          ? bookings.filter((item) => item.status === 'delivered')
          : tab === 'closed'
            ? bookings.filter((item) => ['cancelled', 'rejected'].includes(item.status))
            : bookings

    const term = search.trim().toLowerCase()
    if (!term) return byTab
    return byTab.filter((item) =>
      [
        `#${item.id}`,
        item.id,
        item.crop_name,
        item.market_name,
        item.pickup_location,
        item.destination,
        item.vehicle_number,
        item.truck_type,
        item.farmer_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    )
  }, [bookings, tab, search])

  const selected = useMemo(
    () => bookings.find((item) => item.id === selectedId) || null,
    [bookings, selectedId]
  )

  useEffect(() => {
    if (loading) return
    if (filtered.length === 0) {
      setSelectedId(null)
      return
    }
    if (!filtered.some((item) => item.id === selectedId)) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, loading, selectedId])

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

  const tabs = [
    ['all', t('common.all'), bookings.length],
    ['active', t('common.active'), stats.active],
    ['delivered', t('common.delivered'), stats.delivered],
    ['closed', t('bookings.tabClosed'), bookings.filter((item) => ['cancelled', 'rejected'].includes(item.status)).length],
  ]

  return (
    <div className="ui-page bookings-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('bookings.title')}</h2>
          <p>{t('bookings.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <Link to="/trucks" className="ui-btn ui-btn-primary">
            <Icon name="plus" size={15} /> {t('bookings.newBooking')}
          </Link>
          <button type="button" className="ui-btn ui-btn-outline" onClick={load}>
            <Icon name="refresh" size={14} /> {t('common.refresh')}
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

      <div className="bookings-workspace">
        <aside className="bookings-pane bookings-list-pane">
          <div className="bookings-pane-head">
            <div className="bookings-search">
              <Icon name="search" size={15} />
              <input
                type="search"
                value={search}
                placeholder={t('bookings.searchPlaceholder')}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={t('bookings.searchPlaceholder')}
              />
            </div>
            <div className="bookings-tabs">
              {tabs.map(([value, label, count]) => (
                <button key={value} type="button" className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>
                  {label}<span className="bookings-tab-count">{count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bookings-list">
            {loading ? (
              <div className="ui-loading"><span className="ui-spinner" />{t('bookings.loading')}</div>
            ) : filtered.length === 0 ? (
              <div className="ui-empty bookings-list-empty">
                <span className="ui-empty-icon"><Icon name="bookings" size={22} /></span>
                <strong>{t('bookings.none')}</strong>
                <p>{search ? t('bookings.noneSearch') : tab === 'all' ? t('bookings.noneAll') : t('bookings.noneStatus')}</p>
                {tab === 'all' && !search && (
                  <Link to="/trucks" className="ui-btn ui-btn-primary ui-btn-sm" style={{ marginTop: 6 }}>
                    <Icon name="truck" size={14} /> {t('bookings.findTruck')}
                  </Link>
                )}
              </div>
            ) : (
              filtered.map((booking) => {
                const active = ACTIVE.has(booking.status)
                return (
                  <button
                    key={booking.id}
                    type="button"
                    className={`booking-card ${selectedId === booking.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(booking.id)}
                  >
                    <span className="booking-card-top">
                      <span className="booking-card-id">#{booking.id}</span>
                      <span className={`ui-badge ui-badge-${STATUS_TONE[booking.status] || 'grey'}`}>
                        {statusLabel(booking.status)}
                      </span>
                    </span>
                    <span className="booking-card-crop">
                      <strong>{booking.crop_name || t('common.generalGoods')}</strong>
                      <span>{kg(booking.quantity_kg)}</span>
                    </span>
                    <span className="booking-card-route">
                      <Icon name="route" size={12} />
                      {booking.market_name}
                    </span>
                    <span className="booking-card-meta">
                      <span><Icon name="truck" size={12} /> {booking.vehicle_number || '—'}</span>
                      <span><Icon name="clock" size={12} /> {when(booking.pickup_at)}</span>
                    </span>
                    <span className={`booking-card-strip ${active ? 'active' : ''}`} />
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <section className="bookings-pane bookings-detail-pane">
          {selected ? (
            <div className="booking-detail">
              <header className="booking-detail-head">
                <div>
                  <div className="booking-detail-status">
                    <span className={`ui-badge ui-badge-${STATUS_TONE[selected.status] || 'grey'}`}>
                      {statusLabel(selected.status)}
                    </span>
                    <span>{ACTIVE.has(selected.status) ? t('bookings.tripActive') : t('bookings.tripClosed')}</span>
                  </div>
                  <h3>{t('bookings.bookingTitle', [selected.id])}</h3>
                  <p>{selected.crop_name || t('common.generalGoods')} · {selected.market_name}</p>
                </div>
                <div className="booking-detail-quick">
                  {ACTIVE.has(selected.status) && (
                    <Link to="/tracking" className="ui-btn ui-btn-outline ui-btn-sm">{t('bookings.openTracking')}</Link>
                  )}
                  {canOwn && selected.status === 'delivered' && (
                    <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => openDelivery(selected)}>
                      {selected.actual_price_per_kg ? t('bookings.editSale') : t('bookings.recordSale')}
                    </button>
                  )}
                </div>
              </header>

              <div className="booking-detail-grid">
                <div><span>{t('role.farmer')}</span><strong>{selected.farmer_name || t('common.you')}</strong></div>
                <div><span>{t('common.truck')}</span><strong>{selected.vehicle_number} · {selected.truck_type}</strong></div>
                <div><span>{t('common.pickup')}</span><strong>{selected.pickup_location}</strong></div>
                <div><span>{t('common.destination')}</span><strong>{selected.destination || selected.market_name}</strong></div>
                <div><span>{t('tracking.pickupTime')}</span><strong>{when(selected.pickup_at)}</strong></div>
                <div><span>{t('bookings.requestedAt')}</span><strong>{when(selected.created_at)}</strong></div>
                <div><span>{t('common.distance')}</span><strong>{Number(selected.distance_km).toFixed(0)} km · {selected.eta_minutes} min</strong></div>
                <div><span>{t('common.quantity')}</span><strong>{kg(selected.quantity_kg)}</strong></div>
                <div><span>{t('tracking.transportCost')}</span><strong>{inr(selected.estimated_transport_cost)}</strong></div>
                <div><span>{t('bookings.estimatedNet')}</span><strong>{inr(selected.estimated_net_proceeds)}</strong></div>
                <div><span>{t('bookings.accompanied')}</span><strong>{selected.accompanied ? t('bookings.yesTravelling') : t('common.no')}</strong></div>
                <div><span>{t('bookings.locationSharing')}</span><strong>{selected.location_consent ? t('bookings.consented') : t('bookings.notShared')}</strong></div>
              </div>

              {selected.notes && (
                <p className="booking-detail-note"><Icon name="info" size={13} /> {selected.notes}</p>
              )}

              {selected.actual_price_per_kg && (
                <div className="booking-actuals">
                  <strong>{t('bookings.recordedSale')}</strong>
                  <div>
                    <span>{t('bookings.soldQuantity')}</span><span>{kg(selected.actual_sold_quantity_kg)}</span>
                  </div>
                  <div>
                    <span>{t('bookings.pricePerKg')}</span><span>{inr(selected.actual_price_per_kg)}</span>
                  </div>
                  <div>
                    <span>{t('bookings.expenses')}</span><span>{inr(selected.actual_expenses)}</span>
                  </div>
                  <div className={t('tracking.total')}>
                    <span>{t('bookings.netRealised')}</span>
                    <span>{inr((selected.actual_sold_quantity_kg || 0) * (selected.actual_price_per_kg || 0) - (selected.actual_expenses || 0))}</span>
                  </div>
                </div>
              )}

              <div className="booking-detail-actions">
                {canOperate && selected.status === 'requested' && (
                  <>
                    <button
                      type="button"
                      className="ui-btn ui-btn-primary ui-btn-sm"
                      disabled={busyId === selected.id}
                      onClick={() => changeStatus(selected, 'accepted')}
                    >
                      {t('bookings.accept')}
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn-danger ui-btn-sm"
                      disabled={busyId === selected.id}
                      onClick={() => changeStatus(selected, 'rejected')}
                    >
                      {t('bookings.rejectBooking')}
                    </button>
                  </>
                )}
                {canOperate && NEXT_STEP[selected.status] && selected.status !== 'requested' && (
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary ui-btn-sm"
                    disabled={busyId === selected.id}
                    onClick={() => changeStatus(selected, NEXT_STEP[selected.status])}
                  >
                    {t('bookings.markStatus', [statusLabel(NEXT_STEP[selected.status])])}
                  </button>
                )}
                {canOwn && ACTIVE.has(selected.status) && selected.status !== 'requested' && (
                  <button
                    type="button"
                    className="ui-btn ui-btn-outline ui-btn-sm"
                    disabled={busyId === selected.id}
                    onClick={() => changeStatus(selected, 'cancelled')}
                  >
                    {t('bookings.cancelBooking')}
                  </button>
                )}
                {canOwn && selected.status === 'delivered' && (
                  <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => openDelivery(selected)}>
                    {selected.actual_price_per_kg ? t('bookings.editSaleDetails') : t('bookings.recordSale')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="ui-empty booking-detail-empty">
              <span className="ui-empty-icon"><Icon name="bookings" size={24} /></span>
              <strong>{t('bookings.selectTitle')}</strong>
              <p>{t('bookings.selectHint')}</p>
            </div>
          )}
        </section>
      </div>

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
