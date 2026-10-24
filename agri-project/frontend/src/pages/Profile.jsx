import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icons'
import {
  fetchMe,
  updateProfile,
  fetchMyDocuments,
  fetchMyDocumentImage,
  uploadMyDocument,
  deleteMyDocument,
} from '../services/authService'
import './Profile.css'
import { useLanguage } from '../context/LanguageContext'

const DOCUMENT_SLOTS = [
  { type: 'permit', labelKey: 'profile.docPermit', hintKey: 'profile.docPermitHint' },
  { type: 'license_front', labelKey: 'profile.docLicenseFront', hintKey: 'profile.docLicenseFrontHint' },
  { type: 'license_back', labelKey: 'profile.docLicenseBack', hintKey: 'profile.docLicenseBackHint' },
]
const MAX_DOCUMENT_MB = 5
const ACCEPTED_IMAGES = 'image/jpeg,image/png,image/webp'

// pending: undefined (no change) | { file, url } (new image to upload) | 'remove'
function DocumentSlot({ slot, doc, pending, required, disabled, onPick, onRemove }) {
  const { t } = useLanguage()
  const inputRef = useRef(null)
  const [savedPreview, setSavedPreview] = useState('')
  const [error, setError] = useState('')

  // Load the stored image whenever the uploaded version changes.
  useEffect(() => {
    if (!doc) { setSavedPreview(''); return undefined }
    let url = ''
    let cancelled = false
    fetchMyDocumentImage(slot.type)
      .then((objectUrl) => {
        url = objectUrl
        if (cancelled) URL.revokeObjectURL(objectUrl)
        else setSavedPreview(objectUrl)
      })
      .catch(() => !cancelled && setSavedPreview(''))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [doc?.uploaded_at, slot.type])

  const pick = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    if (!ACCEPTED_IMAGES.split(',').includes(file.type)) { setError(t('profile.docErrType')); return }
    if (file.size > MAX_DOCUMENT_MB * 1024 * 1024) { setError(t('profile.docErrSize', [MAX_DOCUMENT_MB])); return }
    onPick(file)
  }

  const removed = pending === 'remove'
  const preview = pending?.url || (removed ? '' : savedPreview)
  const hasImage = Boolean(pending?.file) || (Boolean(doc) && !removed)
  // A required image can be replaced, but a saved one cannot be removed.
  const canRemove = Boolean(pending?.file) || (hasImage && !required)
  const state = pending ? 'pending' : doc ? 'ok' : ''

  return (
    <div className={`doc-slot ${hasImage ? 'has-doc' : ''} ${pending ? 'is-pending' : ''}`}>
      <div className="doc-slot-head">
        <strong>{t(slot.labelKey)}{required && <span className="ui-required" aria-hidden="true">*</span>}</strong>
        <span className={`doc-slot-state ${state}`}>
          {pending
            ? (removed ? t('profile.docWillRemove') : t('profile.docUnsaved'))
            : doc ? <><Icon name="check" size={11} />{t('profile.docUploaded')}</> : t('profile.docMissing')}
        </span>
      </div>

      <button
        type="button"
        className="doc-slot-preview"
        onClick={() => (preview ? window.open(preview, '_blank', 'noopener') : inputRef.current?.click())}
        disabled={disabled}
        aria-label={preview ? t('profile.docView') : t('profile.docUpload')}
      >
        {preview ? (
          <img src={preview} alt={t(slot.labelKey)} />
        ) : (
          <span className="doc-slot-empty">
            <Icon name="arrowUp" size={18} />
            <span>{t(slot.hintKey)}</span>
            <small>{t('profile.docFormats', [MAX_DOCUMENT_MB])}</small>
          </span>
        )}
      </button>

      {error && <p className="doc-slot-error" role="alert">{error}</p>}

      <div className="doc-slot-actions">
        <input ref={inputRef} type="file" accept={ACCEPTED_IMAGES} hidden onChange={pick} />
        <button type="button" className="ui-btn ui-btn-outline ui-btn-sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
          <Icon name="arrowUp" size={13} />{hasImage ? t('profile.docReplace') : t('profile.docUpload')}
        </button>
        {canRemove && (
          <button type="button" className="ui-btn ui-btn-soft ui-btn-sm doc-slot-remove" onClick={onRemove} disabled={disabled}>
            <Icon name="trash" size={13} />{t('profile.docRemove')}
          </button>
        )}
      </div>
    </div>
  )
}

const ROLE_HINTS = {
  farmer: 'profile.hintFarmer',
  truck_operator: 'profile.hintTruckOperator',
  market_manager: 'profile.hintMarketManager',
  buyer: 'profile.hintBuyer',
  admin: 'profile.hintAdmin',
  marketer: 'profile.hintMarketer',
}

export default function Profile() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const { user, updateUser } = useAuth()
  const [profile, setProfile] = useState(user)
  const [form, setForm] = useState({
    full_name: user?.full_name || '',
    phone: user?.phone || '',
    location: user?.location || '',
    vehicle_type: user?.vehicle_type || '',
    vehicle_number: user?.vehicle_number || '',
    vehicle_capacity_kg: user?.vehicle_capacity_kg?.toString() || '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [docs, setDocs] = useState({})
  const [docsLoading, setDocsLoading] = useState(false)
  const [pendingDocs, setPendingDocs] = useState({})
  const [editing, setEditing] = useState(false)
  const isOperator = (profile?.role || user?.role) === 'truck_operator'

  useEffect(() => {
    if (!isOperator) return
    setDocsLoading(true)
    fetchMyDocuments()
      .then((list) => setDocs(Object.fromEntries(list.map((doc) => [doc.doc_type, doc]))))
      .catch((err) => setError(err.response?.data?.detail || t('profile.docErrLoad')))
      .finally(() => setDocsLoading(false))
  }, [isOperator])

  const setPendingDoc = (type, value) => setPendingDocs((prev) => {
    if (prev[type]?.url) URL.revokeObjectURL(prev[type].url)
    const next = { ...prev }
    // Removing a picked-but-unsaved image just undoes the pick.
    if (value === 'remove' && !docs[type]) delete next[type]
    else next[type] = value
    return next
  })

  const clearPendingDocs = () => setPendingDocs((prev) => {
    Object.values(prev).forEach((value) => value?.url && URL.revokeObjectURL(value.url))
    return {}
  })

  // Upload/delete staged documents; returns the number that failed.
  const savePendingDocs = async () => {
    let failed = 0
    const next = { ...docs }
    const remaining = {}
    for (const [type, value] of Object.entries(pendingDocs)) {
      try {
        if (value === 'remove') {
          await deleteMyDocument(type)
          delete next[type]
        } else {
          next[type] = await uploadMyDocument(type, value.file)
          URL.revokeObjectURL(value.url)
        }
      } catch {
        failed += 1
        remaining[type] = value
      }
    }
    setDocs(next)
    setPendingDocs(remaining)
    return failed
  }

  useEffect(() => {
    fetchMe()
      .then((data) => {
        setProfile(data)
        setForm({
          full_name: data.full_name || '',
          phone: data.phone || '',
          location: data.location || '',
          vehicle_type: data.vehicle_type || '',
          vehicle_number: data.vehicle_number || '',
          vehicle_capacity_kg: data.vehicle_capacity_kg?.toString() || '',
        })
      })
      .catch((err) => setError(err.response?.data?.detail || t('profile.loadError')))
      .finally(() => setLoading(false))
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (form.full_name.trim().length < 2) { setError(t('login.errFullName')); return }
    if (role === 'truck_operator') {
      const blank = ['phone', 'location', 'vehicle_type', 'vehicle_number', 'vehicle_capacity_kg']
        .some((field) => !form[field].trim())
      if (blank) { setError(t('profile.errRequired')); return }
      if (form.vehicle_number.trim().length < 3) { setError(t('trucks.errVehicle')); return }
      if (!(Number(form.vehicle_capacity_kg) > 0)) { setError(t('profile.errCapacity')); return }
      const missingDoc = DOCUMENT_SLOTS.some(({ type }) => {
        const pending = pendingDocs[type]
        return pending ? pending === 'remove' : !docs[type]
      })
      if (missingDoc) { setError(t('profile.docRequired')); return }
    }
    setSaving(true)
    try {
      const updated = await updateProfile({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        location: form.location.trim(),
        ...(role === 'truck_operator' && {
          vehicle_type: form.vehicle_type.trim() || null,
          vehicle_number: form.vehicle_number.trim() || null,
          vehicle_capacity_kg: form.vehicle_capacity_kg.trim()
            ? Number(form.vehicle_capacity_kg)
            : null,
        }),
      })
      setProfile(updated)
      updateUser(updated)
      const failedDocs = role === 'truck_operator' ? await savePendingDocs() : 0
      if (failedDocs) {
        setError(t('profile.docErrUpload'))
      } else {
        setNotice(t('profile.profileSaved'))
        setEditing(false)
      }
    } catch (err) {
      setError(err.response?.data?.detail || t('profile.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const initials = (profile?.full_name || profile?.email || 'SA')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  const phoneOnly = profile?.email?.endsWith('@phone.smartag.local')
  const role = profile?.role || 'farmer'

  return (
    <div className="ui-page profile-page">
      <div className="ui-toolbar">
        <div>
          <h2>{role === 'truck_operator' ? t('profile.settingsTitle') : t('profile.title')}</h2>
          <p>{role === 'truck_operator' ? t('profile.settingsSubtitle') : t('profile.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <Link to="/dashboard" className="ui-btn ui-btn-outline">
            <Icon name="dashboard" size={14} /> Back to dashboard
          </Link>
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <div className="profile-layout">
        <aside className="ui-card profile-card">
          <div className="profile-banner" />
          <div className="profile-identity">
            <span className="profile-avatar">{initials || 'SA'}</span>
            <h3>{loading ? t('common.loading') : profile?.full_name || t('shell.defaultUser')}</h3>
            <p>{roleLabel(role)}</p>
            <span className={`role-badge role-${role}`}>{roleLabel(role)}</span>
          </div>
          <div className="profile-meta">
            <div>
              <span><Icon name="mail" size={13} />{t('profile.email')}</span>
              <strong>{phoneOnly ? t('profile.mobileOnly') : profile?.email || '—'}</strong>
            </div>
            <div>
              <span><Icon name="phone" size={13} />{t('profile.mobile')}</span>
              <strong>{profile?.phone || t('profile.notAdded')}</strong>
            </div>
            <div>
              <span><Icon name="markets" size={13} />{t('common.location')}</span>
              <strong>{profile?.location || t('common.notSet')}</strong>
            </div>
            <div>
              <span><Icon name="profile" size={13} />{t('profile.accountId')}</span>
              <strong>SA-{String(profile?.id || 0).padStart(5, '0')}</strong>
            </div>
          </div>
          <div className="profile-role-note">
            <Icon name="shield" size={15} />
            <p>{t(ROLE_HINTS[role] || 'profile.hintDefault')}</p>
          </div>
        </aside>

        <div className="profile-main">
          <section className="ui-card">
            <button
              type="button"
              className={`ui-card-head profile-edit-toggle ${editing ? 'open' : ''}`}
              onClick={() => { setEditing((open) => !open); setNotice('') }}
              aria-expanded={editing}
              aria-controls="profile-edit-body"
            >
              <div>
                <h3><Icon name="edit" size={16} />{t('profile.editProfile')}</h3>
                <p>{t('profile.editSubtitle')}</p>
              </div>
              <span className="profile-edit-chevron"><Icon name="chevronDown" size={16} /></span>
            </button>
            {editing && (
            <div className="ui-card-body" id="profile-edit-body">
              <form className="profile-form" onSubmit={submit}>
                {isOperator && <p className="ui-required-note profile-required-note">{t('common.requiredNote')}</p>}
                <label className="ui-field">
                  <span className="ui-label">{t('profile.fullName')}<span className="ui-required" aria-hidden="true">*</span></span>
                  <input
                    className="ui-input"
                    value={form.full_name}
                    onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
                    placeholder={t('profile.fullNamePlaceholder')}
                    required
                  />
                </label>
                <label className="ui-field">
                  <span className="ui-label">{t('profile.mobileNumber')}{isOperator && <span className="ui-required" aria-hidden="true">*</span>}</span>
                  <input
                    className="ui-input"
                    type="tel"
                    required={isOperator}
                    value={form.phone}
                    onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                    placeholder="98765 43210"
                  />
                  <span className="ui-hint">{t('profile.mobileHint')}</span>
                </label>
                <label className="ui-field">
                  <span className="ui-label">{t('profile.villageTown')}{isOperator && <span className="ui-required" aria-hidden="true">*</span>}</span>
                  <input
                    className="ui-input"
                    required={isOperator}
                    value={form.location}
                    onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
                    placeholder={t('login.villagePlaceholder')}
                  />
                </label>
                <label className="ui-field">
                  <span className="ui-label">{t('profile.email')}</span>
                  <input className="ui-input" value={phoneOnly ? t('profile.managedByMobile') : profile?.email || ''} disabled />
                </label>
                <label className="ui-field">
                  <span className="ui-label">{t('profile.role')}</span>
                  <input className="ui-input" value={roleLabel(role)} disabled />
                  <span className="ui-hint">{t('profile.roleHint')}</span>
                </label>
                {role === 'truck_operator' && (
                  <>
                    <label className="ui-field">
                      <span className="ui-label">{t('profile.vehicleType')}<span className="ui-required" aria-hidden="true">*</span></span>
                      <input
                        className="ui-input"
                        required
                        value={form.vehicle_type}
                        onChange={(event) => setForm((prev) => ({ ...prev, vehicle_type: event.target.value }))}
                        maxLength={80}
                      />
                    </label>
                    <label className="ui-field">
                      <span className="ui-label">{t('profile.vehicleNumber')}<span className="ui-required" aria-hidden="true">*</span></span>
                      <input
                        className="ui-input"
                        required
                        minLength={3}
                        value={form.vehicle_number}
                        onChange={(event) => setForm((prev) => ({ ...prev, vehicle_number: event.target.value }))}
                        maxLength={40}
                      />
                    </label>
                    <label className="ui-field">
                      <span className="ui-label">{t('profile.vehicleCapacity')}<span className="ui-required" aria-hidden="true">*</span></span>
                      <input
                        className="ui-input"
                        required
                        type="number"
                        min="0.01"
                        step="any"
                        value={form.vehicle_capacity_kg}
                        onChange={(event) => setForm((prev) => ({ ...prev, vehicle_capacity_kg: event.target.value }))}
                      />
                      <span className="ui-hint">{t('common.quantityKg')}</span>
                    </label>
                    <div className="profile-docs">
                      <div className="profile-docs-head">
                        <strong><Icon name="shield" size={14} />{t('profile.docTitle')}</strong>
                        <span>{t('profile.docSubtitle')}</span>
                      </div>
                      {docsLoading ? (
                        <p className="ui-hint">{t('common.loading')}</p>
                      ) : (
                        <div className="doc-grid">
                          {DOCUMENT_SLOTS.map((slot) => (
                            <DocumentSlot
                              key={slot.type}
                              slot={slot}
                              doc={docs[slot.type]}
                              pending={pendingDocs[slot.type]}
                              required
                              disabled={saving}
                              onPick={(file) => setPendingDoc(slot.type, { file, url: URL.createObjectURL(file) })}
                              onRemove={() => setPendingDoc(slot.type, 'remove')}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
                <div className="profile-form-actions">
                  <button
                    type="button"
                    className="ui-btn ui-btn-outline"
                    onClick={() => {
                      setForm({
                        full_name: profile?.full_name || '',
                        phone: profile?.phone || '',
                        location: profile?.location || '',
                        vehicle_type: profile?.vehicle_type || '',
                        vehicle_number: profile?.vehicle_number || '',
                        vehicle_capacity_kg: profile?.vehicle_capacity_kg?.toString() || '',
                      })
                      clearPendingDocs()
                      setError('')
                      setNotice('')
                      setEditing(false)
                    }}
                    disabled={saving}
                  >
                    Reset
                  </button>
                  <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
                    {saving ? t('common.saving') : t('common.saveChanges')}
                  </button>
                </div>
              </form>
            </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
