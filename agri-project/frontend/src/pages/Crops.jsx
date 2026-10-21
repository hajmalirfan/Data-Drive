import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icons'
import Modal from '../components/Modal'
import {
  createCrop,
  deleteCrop,
  getCrops,
  updateCrop,
} from '../services/operationsService'
import './Crops.css'
import { useLanguage } from '../context/LanguageContext'

const EMPTY = {
  crop_name: '',
  variety: '',
  quantity_kg: '',
  unit: 'kg',
  grade: 'A',
  harvest_date: '',
  pickup_location: '',
  notes: '',
  cost_per_kg: '',
  status: 'available',
}

const inr = (value) =>
  value === null || value === undefined || value === ''
    ? '—'
    : `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const kg = (value) => `${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`
const dateText = (value) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const tone = { available: 'green', reserved: 'amber', sold: 'blue', closed: 'grey' }

export default function Crops() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const [crops, setCrops] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [query, setQuery] = useState('')

  const load = () => {
    setLoading(true)
    getCrops()
      .then(setCrops)
      .catch((err) => setError(err.response?.data?.detail || t('crops.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return crops.filter((crop) => {
      if (statusFilter !== 'all' && crop.status !== statusFilter) return false
      if (!needle) return true
      return [crop.crop_name, crop.variety, crop.pickup_location]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle))
    })
  }, [crops, statusFilter, query])

  const totalKg = filtered.reduce((sum, crop) => sum + Number(crop.quantity_kg || 0), 0)
  const availableKg = filtered
    .filter((crop) => crop.status === 'available')
    .reduce((sum, crop) => sum + Number(crop.quantity_kg || 0), 0)

  const openAdd = () => {
    setEditing(null)
    setForm(EMPTY)
    setFormError('')
    setModalOpen(true)
  }

  const openEdit = (crop) => {
    setEditing(crop)
    setForm({
      crop_name: crop.crop_name || '',
      variety: crop.variety || '',
      quantity_kg: String(crop.quantity_kg ?? ''),
      unit: crop.unit || 'kg',
      grade: crop.grade || 'A',
      harvest_date: crop.harvest_date ? String(crop.harvest_date).slice(0, 10) : '',
      pickup_location: crop.pickup_location || '',
      notes: crop.notes || '',
      cost_per_kg: crop.cost_per_kg === null || crop.cost_per_kg === undefined ? '' : String(crop.cost_per_kg),
      status: crop.status || 'available',
    })
    setFormError('')
    setModalOpen(true)
  }

  const change = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setFormError('')
    if (!form.crop_name.trim()) { setFormError(t('crops.errName')); return }
    if (!Number(form.quantity_kg) || Number(form.quantity_kg) <= 0) { setFormError(t('crops.errQuantity')); return }
    if (form.pickup_location.trim().length < 2) { setFormError(t('crops.errPickup')); return }

    const payload = {
      crop_name: form.crop_name.trim(),
      variety: form.variety.trim(),
      quantity_kg: Number(form.quantity_kg),
      unit: form.unit || 'kg',
      grade: form.grade || 'A',
      harvest_date: form.harvest_date || null,
      pickup_location: form.pickup_location.trim(),
      notes: form.notes.trim(),
      cost_per_kg: form.cost_per_kg === '' ? null : Number(form.cost_per_kg),
      status: form.status || 'available',
    }

    setSaving(true)
    try {
      if (editing) {
        await updateCrop(editing.id, payload)
        setNotice(t('crops.updated'))
      } else {
        await createCrop(payload)
        setNotice(t('crops.added'))
      }
      setModalOpen(false)
      load()
    } catch (err) {
      setFormError(err.response?.data?.detail || t('crops.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (crop) => {
    if (!window.confirm(t('crops.deleteConfirm', [crop.crop_name]))) return
    try {
      await deleteCrop(crop.id)
      setNotice(t('crops.removed', [crop.crop_name]))
      load()
    } catch (err) {
      setError(err.response?.data?.detail || t('crops.deleteError'))
    }
  }

  const quickStatus = async (crop, status) => {
    try {
      await updateCrop(crop.id, { status })
      setNotice(t('crops.marked', [crop.crop_name, statusLabel(status)]))
      load()
    } catch (err) {
      setError(err.response?.data?.detail || t('crops.updateError'))
    }
  }

  return (
    <div className="ui-page crops-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('crops.title')}</h2>
          <p>{t('crops.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <button type="button" className="ui-btn ui-btn-primary" onClick={openAdd}>
            <Icon name="plus" size={15} /> Add crop stock
          </button>
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <div className="crops-summary">
        <div className="crops-stat">
          <span><Icon name="package" size={17} /></span>
          <div><small>{t('crops.totalStock')}</small><strong>{kg(totalKg)}</strong></div>
        </div>
        <div className="crops-stat">
          <span><Icon name="crops" size={17} /></span>
          <div><small>{t('common.available')}</small><strong>{kg(availableKg)}</strong></div>
        </div>
        <div className="crops-stat">
          <span><Icon name="leaf" size={17} /></span>
          <div><small>{t('crops.listings')}</small><strong>{filtered.length}</strong></div>
        </div>
        <div className="crops-stat">
          <span><Icon name="scale" size={17} /></span>
          <div>
            <small>{t('crops.avgCost')}</small>
            <strong>
              {inr(
                crops.filter((crop) => crop.cost_per_kg !== null).length
                  ? crops.filter((crop) => crop.cost_per_kg !== null).reduce((sum, crop) => sum + Number(crop.cost_per_kg), 0) /
                    crops.filter((crop) => crop.cost_per_kg !== null).length
                  : null
              )}
              {crops.some((crop) => crop.cost_per_kg !== null) ? <em>/kg</em> : null}
            </strong>
          </div>
        </div>
      </div>

      <div className="ui-card">
        <div className="crops-table-head">
          <div className="ui-filters">
            <label className="ui-field">
              <span className="ui-label">{t('common.status')}</span>
              <select className="ui-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">{t('crops.allStatuses')}</option>
                <option value="available">{t('common.available')}</option>
                <option value="reserved">{t('common.reserved')}</option>
                <option value="sold">{t('common.sold')}</option>
              </select>
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('common.search')}</span>
              <input
                className="ui-input"
                placeholder={t('crops.searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={load}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>

        <div className="ui-card-body crops-table-body">
          {loading ? (
            <div className="ui-loading"><span className="ui-spinner" />{t('crops.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="ui-empty">
              <span className="ui-empty-icon"><Icon name="crops" size={23} /></span>
              <strong>{t('crops.noStock')}</strong>
              <p>{crops.length ? t('crops.noStockFiltered') : t('crops.noStockEmpty')}</p>
              {!crops.length && (
                <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" onClick={openAdd} style={{ marginTop: 6 }}>
                  <Icon name="plus" size={14} /> Add crop
                </button>
              )}
            </div>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>{t('common.crop')}</th>
                    <th>{t('common.quantity')}</th>
                    <th>{t('dash.thGrade')}</th>
                    <th>{t('dash.thHarvest')}</th>
                    <th>{t('common.pickup')}</th>
                    <th className="num">{t('crops.costPerKgHeader')}</th>
                    <th>{t('common.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((crop) => (
                    <tr key={crop.id}>
                      <td>
                        <span className="crops-name">
                          <span><Icon name="leaf" size={14} /></span>
                          <span>
                            <strong>{crop.crop_name}</strong>
                            <small>{crop.variety || t('crops.noVariety')}</small>
                          </span>
                        </span>
                      </td>
                      <td>{kg(crop.quantity_kg)}</td>
                      <td>{crop.grade || '—'}</td>
                      <td className="muted">{dateText(crop.harvest_date)}</td>
                      <td className="muted">{crop.pickup_location || '—'}</td>
                      <td className="num">{inr(crop.cost_per_kg)}</td>
                      <td><span className={`ui-badge ui-badge-${tone[crop.status] || 'grey'}`}>{statusLabel(crop.status)}</span></td>
                      <td>
                        <div className="actions">
                          <Link
                            to={`/market-prices?crop=${encodeURIComponent(crop.crop_name)}`}
                            className="ui-icon-btn"
                            title={t('crops.seePrices')}
                          >
                            <Icon name="prices" size={14} />
                          </Link>
                          <button type="button" className="ui-icon-btn" title={t('crops.edit')} onClick={() => openEdit(crop)}>
                            <Icon name="edit" size={14} />
                          </button>
                          {crop.status === 'available' && (
                            <button type="button" className="ui-icon-btn" title={t('crops.markSold')} onClick={() => quickStatus(crop, 'sold')}>
                              <Icon name="check" size={14} />
                            </button>
                          )}
                          <button type="button" className="ui-icon-btn crops-delete" title={t('crops.delete')} onClick={() => remove(crop)}>
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
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
          title={editing ? t('crops.editTitle') : t('crops.addStock')}
          subtitle={editing ? t('crops.editSubtitle') : t('crops.addSubtitle')}
          onClose={() => setModalOpen(false)}
          size="lg"
          footer={(
            <>
              <button type="button" className="ui-btn ui-btn-outline" onClick={() => setModalOpen(false)}>{t('common.cancel')}</button>
              <button type="submit" form="crop-form" className="ui-btn ui-btn-primary" disabled={saving}>
                {saving ? t('common.saving') : editing ? t('common.saveChanges') : t('dash.addCrop')}
              </button>
            </>
          )}
        >
          <form id="crop-form" className="ui-form-grid" onSubmit={submit}>
            <label className="ui-field">
              <span className="ui-label">{t('crops.cropName')}</span>
              <input className="ui-input" value={form.crop_name} onChange={change('crop_name')} placeholder={t('crops.cropNamePlaceholder')} required />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('crops.variety')}</span>
              <input className="ui-input" value={form.variety} onChange={change('variety')} placeholder={t('crops.varietyPlaceholder')} />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('common.quantityKg')}</span>
              <input className="ui-input" type="number" min="1" step="0.1" value={form.quantity_kg} onChange={change('quantity_kg')} required />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('dash.thGrade')}</span>
              <select className="ui-select" value={form.grade} onChange={change('grade')}>
                <option value="A">{t('crops.gradeA')}</option>
                <option value="B">{t('crops.gradeB')}</option>
                <option value="C">{t('crops.gradeC')}</option>
              </select>
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('crops.harvestDate')}</span>
              <input className="ui-input" type="date" value={form.harvest_date} onChange={change('harvest_date')} />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('common.status')}</span>
              <select className="ui-select" value={form.status} onChange={change('status')}>
                <option value="available">{t('common.available')}</option>
                <option value="reserved">{t('common.reserved')}</option>
                <option value="sold">{t('common.sold')}</option>
              </select>
            </label>
            <label className="ui-field span-2">
              <span className="ui-label">{t('crops.pickupLocation')}</span>
              <input className="ui-input" value={form.pickup_location} onChange={change('pickup_location')} placeholder={t('crops.pickupPlaceholder')} required />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('crops.costPerKg')}</span>
              <input className="ui-input" type="number" min="0" step="0.01" value={form.cost_per_kg} onChange={change('cost_per_kg')} placeholder={t('crops.costPlaceholder')} />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('crops.unit')}</span>
              <input className="ui-input" value={form.unit} onChange={change('unit')} placeholder="kg" />
            </label>
            <label className="ui-field span-2">
              <span className="ui-label">{t('common.notes')}</span>
              <textarea className="ui-textarea" value={form.notes} onChange={change('notes')} placeholder={t('crops.notesPlaceholder')} />
            </label>
            {formError && <div className="ui-alert ui-alert-error span-2">{formError}</div>}
          </form>
        </Modal>
      )}
    </div>
  )
}
