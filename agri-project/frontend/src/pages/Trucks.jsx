import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icons'
import Modal from '../components/Modal'
import {
  createBooking,
  createTruck,
  deleteTruck,
  getCrops,
  getMarkets,
  getTrucks,
  updateTruck,
} from '../services/operationsService'
import './Trucks.css'
import { useLanguage } from '../context/LanguageContext'
import { formatIndiaDate, getIndiaDateTimeLocal } from '../utils/dateTime'

const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} kg`
const inr = (value) =>
  value === null || value === undefined ? '—' : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const dateText = (value) =>
  value ? formatIndiaDate(value, { day: 'numeric', month: 'short' }) : 'Any day'

const nextPickup = () => {
  return getIndiaDateTimeLocal(1, 8)
}

export default function Trucks() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const { isTruckOperator, isAdmin, isFarmer, isMarketer, user } = useAuth()
  const canBookTrucks = isFarmer || isMarketer || isAdmin
  const navigate = useNavigate()
  const [tab, setTab] = useState(isTruckOperator ? 'mine' : 'market')
  const [trucks, setTrucks] = useState([])
  const [myTrucks, setMyTrucks] = useState([])
  const [crops, setCrops] = useState([])
  const [markets, setMarkets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [minCapacity, setMinCapacity] = useState('')
  const [selectedTruck, setSelectedTruck] = useState(null)
  const [booking, setBooking] = useState({
    crop_id: '',
    market_id: '',
    quantity_kg: '',
    pickup_location: '',
    pickup_at: nextPickup(),
    accompanied: false,
    notes: '',
  })
  const [bookingError, setBookingError] = useState('')
  const [saving, setSaving] = useState(false)
  const [truckModal, setTruckModal] = useState(false)
  const [truckForm, setTruckForm] = useState({
    vehicle_number: '',
    truck_type: 'Open body',
    available_capacity_kg: '',
    available_from: '',
    price_per_km: '28',
    base_fare: '500',
    has_passenger_seat: false,
    last_location: '',
    status: 'available',
  })
  const [truckError, setTruckError] = useState('')

  const loadMarket = () => {
    setLoading(true)
    Promise.all([getTrucks({ status: 'available' }), getCrops(), getMarkets()])
      .then(([truckRows, cropRows, marketRows]) => {
        setTrucks(truckRows)
        setCrops(cropRows.filter((crop) => crop.status === 'available'))
        setMarkets(marketRows)
      })
      .catch((err) => setError(err.response?.data?.detail || t('trucks.loadError')))
      .finally(() => setLoading(false))
  }

  const loadMine = () => {
    setLoading(true)
    getTrucks({ mine: true })
      .then(setMyTrucks)
      .catch((err) => setError(err.response?.data?.detail || t('trucks.loadMineError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (isTruckOperator && tab !== 'mine') {
      setTab('mine')
      return
    }
    if (tab === 'market') loadMarket()
    else loadMine()
  }, [tab, isTruckOperator]) // eslint-disable-line

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return trucks.filter((truck) => {
      if (minCapacity && Number(truck.available_capacity_kg) < Number(minCapacity)) return false
      if (!needle) return true
      return [truck.vehicle_number, truck.truck_type, truck.route_from, truck.route_to, truck.operator_name]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle))
    })
  }, [trucks, query, minCapacity])

  const selectedMarket = markets.find((market) => String(market.id) === String(booking.market_id))
  const selectedCrop = crops.find((crop) => String(crop.id) === String(booking.crop_id))
  const estimate = selectedTruck && selectedMarket
    ? Number(selectedTruck.base_fare) + Number(selectedMarket.distance_km) * Number(selectedTruck.price_per_km)
    : null

  const openBooking = (truck) => {
    if (!canBookTrucks) return
    const crop = crops[0]
    const market = markets[0]
    setSelectedTruck(truck)
    setBooking({
      crop_id: crop ? String(crop.id) : '',
      market_id: market ? String(market.id) : '',
      quantity_kg: crop ? String(Math.min(crop.quantity_kg, truck.available_capacity_kg)) : '',
      pickup_location: crop?.pickup_location || '',
      pickup_at: nextPickup(),
      accompanied: false,
      notes: '',
    })
    setBookingError('')
  }

  const onCropChange = (value) => {
    const crop = crops.find((item) => String(item.id) === value)
    setBooking((prev) => ({
      ...prev,
      crop_id: value,
      quantity_kg: crop && selectedTruck
        ? String(Math.min(crop.quantity_kg, selectedTruck.available_capacity_kg))
        : prev.quantity_kg,
      pickup_location: crop?.pickup_location || prev.pickup_location,
    }))
  }

  const submitBooking = async (event) => {
    event.preventDefault()
    setBookingError('')
    if (!canBookTrucks || !selectedTruck) return
    if (!booking.market_id) { setBookingError(t('trucks.errMarket')); return }
    if (!Number(booking.quantity_kg) || Number(booking.quantity_kg) <= 0) { setBookingError(t('trucks.errQuantity')); return }
    if (Number(booking.quantity_kg) > Number(selectedTruck.available_capacity_kg)) {
      setBookingError(t('trucks.errCapacity', [kg(selectedTruck.available_capacity_kg)]))
      return
    }
    if (!booking.pickup_location.trim()) { setBookingError(t('trucks.errPickup')); return }
    if (!booking.pickup_at) { setBookingError(t('trucks.errPickupTime')); return }
    setSaving(true)
    try {
      await createBooking({
        truck_id: selectedTruck.id,
        crop_id: booking.crop_id ? Number(booking.crop_id) : null,
        market_id: Number(booking.market_id),
        quantity_kg: Number(booking.quantity_kg),
        pickup_location: booking.pickup_location.trim(),
        destination: selectedMarket?.name || t('common.market'),
        pickup_at: booking.pickup_at,
        accompanied: booking.accompanied,
        notes: booking.notes.trim(),
      })
      setSelectedTruck(null)
      setNotice(t('trucks.booked'))
      setTab('market')
      loadMarket()
      setTimeout(() => navigate('/bookings'), 700)
    } catch (err) {
      setBookingError(err.response?.data?.detail || t('trucks.bookingError'))
    } finally {
      setSaving(false)
    }
  }

  const submitTruck = async (event) => {
    event.preventDefault()
    setTruckError('')
    if (truckForm.vehicle_number.trim().length < 3) { setTruckError(t('trucks.errVehicle')); return }
    const capacityKg = Number(user?.vehicle_capacity_kg)
    if (!capacityKg) { setTruckError(t('trucks.profileCapacityRequired')); return }
    setSaving(true)
    try {
      await createTruck({
        vehicle_number: truckForm.vehicle_number.trim(),
        truck_type: truckForm.truck_type.trim() || 'Open body',
        capacity_kg: capacityKg,
        available_capacity_kg: truckForm.available_capacity_kg === '' ? null : Number(truckForm.available_capacity_kg),
        available_from: truckForm.available_from || null,
        price_per_km: Number(truckForm.price_per_km) || 28,
        base_fare: Number(truckForm.base_fare) || 500,
        has_passenger_seat: truckForm.has_passenger_seat,
        last_location: truckForm.last_location.trim(),
        status: truckForm.status,
      })
      setTruckModal(false)
      setNotice(t('trucks.truckAdded'))
      loadMine()
    } catch (err) {
      setTruckError(err.response?.data?.detail || t('trucks.truckAddError'))
    } finally {
      setSaving(false)
    }
  }

  const toggleTruckStatus = async (truck) => {
    const next = truck.status === 'available' ? 'maintenance' : 'available'
    try {
      const updated = await updateTruck(truck.id, { status: next })
      setMyTrucks((prev) => prev.map((item) => (item.id === truck.id ? updated : item)))
      setNotice(t('trucks.marked', [truck.vehicle_number, statusLabel(next)]))
    } catch (err) {
      setError(err.response?.data?.detail || t('trucks.truckStatusError'))
    }
  }

  const removeTruck = async (truck) => {
    if (!window.confirm(t('trucks.removeConfirm', [truck.vehicle_number]))) return
    setError('')
    setNotice('')
    try {
      await deleteTruck(truck.id)
      setMyTrucks((current) => current.filter((item) => item.id !== truck.id))
      setNotice(t('trucks.removed', [truck.vehicle_number]))
    } catch (err) {
      setError(err.response?.data?.detail || t('trucks.removeError'))
    }
  }

  return (
    <div className="ui-page trucks-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('trucks.title')}</h2>
          <p>{t('trucks.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          {isTruckOperator || isAdmin ? (
            <>
              {isAdmin && (
                <div className="trucks-tabs">
                  <button type="button" className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>{t('trucks.marketplace')}</button>
                  <button type="button" className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>{t('trucks.myTrucks')}</button>
                </div>
              )}
              <button type="button" className="ui-btn ui-btn-primary" onClick={() => { setTruckError(''); setTruckModal(true) }}>
                <Icon name="plus" size={15} /> Add truck
              </button>
            </>
          ) : null}
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      {tab === 'market' ? (
        <>
          <div className="ui-card trucks-filter-card">
            <div className="ui-filters">
              <label className="ui-field">
                <span className="ui-label">{t('common.search')}</span>
                <input
                  className="ui-input"
                  placeholder={t('trucks.searchPlaceholder')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label className="ui-field">
                <span className="ui-label">{t('trucks.minCapacity')}</span>
                <input
                  className="ui-input"
                  type="number"
                  min="1"
                  placeholder={t('common.any')}
                  value={minCapacity}
                  onChange={(event) => setMinCapacity(event.target.value)}
                />
              </label>
              <button type="button" className="ui-btn ui-btn-outline" onClick={loadMarket}>
                <Icon name="refresh" size={14} /> Refresh
              </button>
            </div>
            <span className="trucks-count">{visible.length} available</span>
          </div>

          {loading ? (
            <div className="ui-card ui-loading"><span className="ui-spinner" />{t('trucks.loading')}</div>
          ) : visible.length === 0 ? (
            <div className="ui-card ui-empty">
              <span className="ui-empty-icon"><Icon name="truck" size={23} /></span>
              <strong>{t('trucks.noMatch')}</strong>
              <p>{t('trucks.noMatchSub')}</p>
            </div>
          ) : (
            <div className="trucks-grid">
              {visible.map((truck) => (
                <article className="ui-card truck-card" key={truck.id}>
                  <div className="truck-card-top">
                    <span className="truck-art"><Icon name="truck" size={26} /></span>
                    <span className="truck-heading">
                      <strong>{truck.vehicle_number}</strong>
                      <small>{truck.truck_type}</small>
                    </span>
                    <span className="ui-badge ui-badge-green">{statusLabel(truck.status)}</span>
                  </div>
                  <div className="truck-capacity">
                    <div>
                      <small>{t('trucks.freeCapacity')}</small>
                      <strong>{kg(truck.available_capacity_kg)}</strong>
                      <span>of {kg(truck.capacity_kg)}</span>
                    </div>
                    <div className="truck-capacity-bar">
                      <span style={{ width: `${Math.max(4, Math.min(100, (truck.available_capacity_kg / truck.capacity_kg) * 100))}%` }} />
                    </div>
                  </div>
                  <div className="truck-route">
                    <span><Icon name="route" size={12} /> {truck.route_from || t('trucks.localPickup')} → {truck.route_to || t('common.anyMandi')}</span>
                    <span><Icon name="calendar" size={12} /> Available {dateText(truck.available_from)}</span>
                    {truck.has_passenger_seat && (
                      <span className="truck-seat"><Icon name="check" size={11} />{t('trucks.passengerSeat')}</span>
                    )}
                  </div>
                  <div className="truck-operator">
                    <span>{t('trucks.operator')}</span>
                    <strong>{truck.operator_name || t('trucks.notProvided')}</strong>
                    <small><Icon name="phone" size={10} /> {truck.operator_phone || t('trucks.notProvided')}</small>
                    {truck.operator_location && (
                      <small><Icon name="markets" size={10} /> {truck.operator_location}</small>
                    )}
                    {truck.last_location && (
                      <small><Icon name="route" size={10} /> {truck.last_location}</small>
                    )}
                  </div>
                  <div className="truck-card-foot">
                    <div>
                      <strong>{inr(truck.base_fare)}</strong>
                      <small>base + ₹{Number(truck.price_per_km).toFixed(0)}/km</small>
                    </div>
                    {canBookTrucks && (
                      <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => openBooking(truck)}>
                        Book truck <Icon name="arrowRight" size={13} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="trucks-mine">
          {loading ? (
            <div className="ui-card ui-loading"><span className="ui-spinner" />{t('trucks.loadingMine')}</div>
          ) : myTrucks.length === 0 ? (
            <div className="ui-card ui-empty">
              <span className="ui-empty-icon"><Icon name="truck" size={23} /></span>
              <strong>{t('trucks.noTrucks')}</strong>
              <p>{t('trucks.noTrucksSub')}</p>
              <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={() => setTruckModal(true)} style={{ marginTop: 6 }}>
                <Icon name="plus" size={14} /> Add truck
              </button>
            </div>
          ) : (
            <div className="trucks-grid">
              {myTrucks.map((truck) => (
                <article className="ui-card truck-card" key={truck.id}>
                  <div className="truck-card-top">
                    <span className="truck-art"><Icon name="truck" size={26} /></span>
                    <span className="truck-heading">
                      <strong>{truck.vehicle_number}</strong>
                      <small>{truck.truck_type}</small>
                    </span>
                    <span className={`ui-badge ui-badge-${truck.status === 'available' ? 'green' : truck.status === 'maintenance' ? 'red' : 'amber'}`}>
                      {statusLabel(truck.status)}
                    </span>
                  </div>
                  <div className="truck-capacity">
                    <div>
                      <small>{t('trucks.freeCapacity')}</small>
                      <strong>{kg(truck.available_capacity_kg)}</strong>
                      <span>of {kg(truck.capacity_kg)}</span>
                    </div>
                    <div className="truck-capacity-bar">
                      <span style={{ width: `${Math.max(4, Math.min(100, (truck.available_capacity_kg / truck.capacity_kg) * 100))}%` }} />
                    </div>
                  </div>
                  <div className="truck-route">
                    <span><Icon name="route" size={12} /> {truck.route_from || t('trucks.localPickup')} → {truck.route_to || t('common.anyMandi')}</span>
                    <span><Icon name="calendar" size={12} /> Available {dateText(truck.available_from)}</span>
                    {truck.has_passenger_seat && <span className="truck-seat"><Icon name="check" size={11} />{t('trucks.passengerSeat')}</span>}
                  </div>
                  <div className="truck-card-foot">
                    <div>
                      <strong>{inr(truck.base_fare)}</strong>
                      <small>base + ₹{Number(truck.price_per_km).toFixed(0)}/km</small>
                    </div>
                    <div className="truck-card-actions">
                      <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => toggleTruckStatus(truck)}>
                        {truck.status === 'available' ? t('trucks.setMaintenance') : t('trucks.setAvailable')}
                      </button>
                      <button type="button" className="ui-btn ui-btn-outline ui-btn-sm truck-remove-btn" onClick={() => removeTruck(truck)}>
                        <Icon name="trash" size={13} /> {t('trucks.remove')}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedTruck && (
        <Modal
          title={t('trucks.bookTitle', [selectedTruck.vehicle_number])}
          subtitle={t('trucks.bookSubtitle', [selectedTruck.truck_type, kg(selectedTruck.available_capacity_kg), Number(selectedTruck.price_per_km).toFixed(0)])}
          onClose={() => setSelectedTruck(null)}
          size="lg"
          footer={(
            <>
              <button type="button" className="ui-btn ui-btn-outline" onClick={() => setSelectedTruck(null)}>{t('common.cancel')}</button>
              <button type="submit" form="booking-form" className="ui-btn ui-btn-primary" disabled={saving}>
                {saving ? t('trucks.sending') : t('trucks.sendRequest')}
              </button>
            </>
          )}
        >
          <form id="booking-form" className="ui-form-grid" onSubmit={submitBooking}>
            <label className="ui-field">
              <span className="ui-label">{t('trucks.cropStock')}</span>
              <select className="ui-select" value={booking.crop_id} onChange={(event) => onCropChange(event.target.value)}>
                <option value="">{t('trucks.generalGoods')}</option>
                {crops.map((crop) => (
                  <option key={crop.id} value={crop.id}>{crop.crop_name} · {kg(crop.quantity_kg)}</option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('trucks.destinationMarket')}</span>
              <select
                className="ui-select"
                value={booking.market_id}
                onChange={(event) => setBooking((prev) => ({ ...prev, market_id: event.target.value }))}
              >
                <option value="">{t('prices.chooseMarket')}</option>
                {markets.map((market) => (
                  <option key={market.id} value={market.id}>{market.name} · {Number(market.distance_km).toFixed(0)} km</option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('common.quantityKg')}</span>
              <input
                className="ui-input"
                type="number"
                min="1"
                step="0.1"
                value={booking.quantity_kg}
                onChange={(event) => setBooking((prev) => ({ ...prev, quantity_kg: event.target.value }))}
                required
              />
              {selectedCrop && <span className="ui-hint">Crop stock: {kg(selectedCrop.quantity_kg)}</span>}
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('trucks.pickupDateTime')}</span>
              <input
                className="ui-input"
                type="datetime-local"
                value={booking.pickup_at}
                onChange={(event) => setBooking((prev) => ({ ...prev, pickup_at: event.target.value }))}
                required
              />
            </label>
            <label className="ui-field span-2">
              <span className="ui-label">{t('crops.pickupLocation')}</span>
              <input
                className="ui-input"
                value={booking.pickup_location}
                onChange={(event) => setBooking((prev) => ({ ...prev, pickup_location: event.target.value }))}
                placeholder={t('trucks.pickupPlaceholder')}
                required
              />
            </label>
            <label className="ui-field span-2">
              <span className="ui-label">{t('trucks.tripNotes')}</span>
              <textarea
                className="ui-textarea"
                value={booking.notes}
                onChange={(event) => setBooking((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder={t('trucks.tripNotesPlaceholder')}
              />
            </label>
            <label className={`truck-check span-2 ${!selectedTruck.has_passenger_seat ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={booking.accompanied}
                disabled={!selectedTruck.has_passenger_seat}
                onChange={(event) => setBooking((prev) => ({ ...prev, accompanied: event.target.checked }))}
              />
              <span>
                I will travel with the truck
                <small>{selectedTruck.has_passenger_seat ? t('trucks.seatAvailable') : t('trucks.noSeat')}</small>
              </span>
            </label>

            <div className="truck-detail-block span-2">
              <strong className="truck-detail-title"><Icon name="profile" size={14} />{t('trucks.operatorDetails')}</strong>
              <div className="truck-detail-grid">
                <div>
                  <span>{t('trucks.operator')}</span>
                  <strong>{selectedTruck.operator_name || t('trucks.notProvided')}</strong>
                </div>
                <div>
                  <span>{t('trucks.operatorPhone')}</span>
                  <strong>{selectedTruck.operator_phone || t('trucks.notProvided')}</strong>
                </div>
                <div>
                  <span>{t('trucks.operatorLocation')}</span>
                  <strong>{selectedTruck.operator_location || t('trucks.notProvided')}</strong>
                </div>
              </div>
            </div>

            <div className="truck-detail-block span-2">
              <strong className="truck-detail-title"><Icon name="truck" size={14} />{t('trucks.availabilityDetails')}</strong>
              <div className="truck-detail-grid">
                <div>
                  <span>{t('common.status')}</span>
                  <strong>{statusLabel(selectedTruck.status)}</strong>
                </div>
                <div>
                  <span>{t('trucks.availableFromLabel')}</span>
                  <strong>{selectedTruck.available_from ? dateText(selectedTruck.available_from) : '—'}</strong>
                </div>
                <div>
                  <span>{t('trucks.freeCapacity')}</span>
                  <strong>{kg(selectedTruck.available_capacity_kg)}</strong>
                </div>
                <div>
                  <span>{t('trucks.route')}</span>
                  <strong>{selectedTruck.route_from || '—'} → {selectedTruck.route_to || '—'}</strong>
                </div>
                <div>
                  <span>{t('trucks.lastReportedLocation')}</span>
                  <strong>{selectedTruck.last_location || '—'}</strong>
                </div>
                <div>
                  <span>{t('trucks.passengerSeat')}</span>
                  <strong>{selectedTruck.has_passenger_seat ? t('common.yes') : t('common.no')}</strong>
                </div>
              </div>
            </div>

            <div className="truck-estimate span-2">
              <div>
                <span>{t('trucks.estimatedCost')}</span>
                <strong>{estimate === null ? '—' : inr(estimate)}</strong>
              </div>
              <div>
                <span>{t('trucks.distanceTime')}</span>
                <strong>{selectedMarket ? `${Number(selectedMarket.distance_km).toFixed(0)} km · ${selectedMarket.eta_minutes} min` : '—'}</strong>
              </div>
              <div>
                <span>{t('trucks.deliveryTo')}</span>
                <strong>{selectedMarket?.name || t('trucks.chooseMarketPlaceholder')}</strong>
              </div>
            </div>
            {bookingError && <div className="ui-alert ui-alert-error span-2">{bookingError}</div>}
          </form>
        </Modal>
      )}

      {truckModal && (
        <Modal
          title={t('trucks.addTruckTitle')}
          subtitle={t('trucks.addTruckSubtitle')}
          onClose={() => setTruckModal(false)}
          size="lg"
          footer={(
            <>
              <button type="button" className="ui-btn ui-btn-outline" onClick={() => setTruckModal(false)}>{t('common.cancel')}</button>
              <button type="submit" form="truck-form" className="ui-btn ui-btn-primary" disabled={saving}>
                {saving ? t('trucks.adding') : t('trucks.addTruck')}
              </button>
            </>
          )}
        >
          <form id="truck-form" className="ui-form-grid" onSubmit={submitTruck}>
            <label className="ui-field">
              <span className="ui-label">{t('trucks.vehicleNumber')}</span>
              <input className="ui-input" value={truckForm.vehicle_number} onChange={(event) => setTruckForm((prev) => ({ ...prev, vehicle_number: event.target.value }))} placeholder="TN 60 AB 1234" required />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('trucks.truckType')}</span>
              <input className="ui-input" value={truckForm.truck_type} onChange={(event) => setTruckForm((prev) => ({ ...prev, truck_type: event.target.value }))} placeholder="Open body" />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('trucks.freeCapacityKg')}</span>
              <input className="ui-input" type="number" min="0" value={truckForm.available_capacity_kg} onChange={(event) => setTruckForm((prev) => ({ ...prev, available_capacity_kg: event.target.value }))} placeholder={t('trucks.defaultsFull')} />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('trucks.availableFromLabel')}</span>
              <input className="ui-input" type="date" value={truckForm.available_from} onChange={(event) => setTruckForm((prev) => ({ ...prev, available_from: event.target.value }))} />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('common.status')}</span>
              <select className="ui-select" value={truckForm.status} onChange={(event) => setTruckForm((prev) => ({ ...prev, status: event.target.value }))}>
                <option value="available">{t('common.available')}</option>
                <option value="reserved">{t('common.reserved')}</option>
                <option value="on_trip">{t('status.onTrip')}</option>
                <option value="maintenance">{t('status.maintenance')}</option>
              </select>
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('trucks.baseFare')}</span>
              <input className="ui-input" type="number" min="0" value={truckForm.base_fare} onChange={(event) => setTruckForm((prev) => ({ ...prev, base_fare: event.target.value }))} />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('trucks.ratePerKm')}</span>
              <input className="ui-input" type="number" min="0" value={truckForm.price_per_km} onChange={(event) => setTruckForm((prev) => ({ ...prev, price_per_km: event.target.value }))} />
            </label>
            <label className="ui-field span-2">
              <span className="ui-label">{t('trucks.currentLocation')}</span>
              <input className="ui-input" value={truckForm.last_location} onChange={(event) => setTruckForm((prev) => ({ ...prev, last_location: event.target.value }))} placeholder="Theni bus stand" />
            </label>
            <label className="truck-check span-2">
              <input type="checkbox" checked={truckForm.has_passenger_seat} onChange={(event) => setTruckForm((prev) => ({ ...prev, has_passenger_seat: event.target.checked }))} />
              <span>{t('trucks.hasSeat')}<small>{t('trucks.hasSeatSub')}</small></span>
            </label>
            {truckError && <div className="ui-alert ui-alert-error span-2">{truckError}</div>}
          </form>
        </Modal>
      )}
    </div>
  )
}
