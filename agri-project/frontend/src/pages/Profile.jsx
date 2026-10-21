import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icons'
import { fetchMe, updateProfile } from '../services/authService'
import './Profile.css'
import { useLanguage } from '../context/LanguageContext'

const ROLE_HINTS = {
  farmer: 'profile.hintFarmer',
  fpo: 'profile.hintFpo',
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
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    fetchMe()
      .then((data) => {
        setProfile(data)
        setForm({
          full_name: data.full_name || '',
          phone: data.phone || '',
          location: data.location || '',
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
    setSaving(true)
    try {
      const updated = await updateProfile({
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        location: form.location.trim(),
      })
      setProfile(updated)
      updateUser(updated)
      setNotice(t('profile.profileSaved'))
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
          <h2>{t('profile.title')}</h2>
          <p>{t('profile.subtitle')}</p>
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
            <div className="ui-card-head">
              <div>
                <h3><Icon name="edit" size={16} />{t('profile.editProfile')}</h3>
                <p>{t('profile.editSubtitle')}</p>
              </div>
            </div>
            <div className="ui-card-body">
              <form className="profile-form" onSubmit={submit}>
                <label className="ui-field">
                  <span className="ui-label">{t('profile.fullName')}</span>
                  <input
                    className="ui-input"
                    value={form.full_name}
                    onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
                    placeholder={t('profile.fullNamePlaceholder')}
                    required
                  />
                </label>
                <label className="ui-field">
                  <span className="ui-label">{t('profile.mobileNumber')}</span>
                  <input
                    className="ui-input"
                    type="tel"
                    value={form.phone}
                    onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                    placeholder="98765 43210"
                  />
                  <span className="ui-hint">{t('profile.mobileHint')}</span>
                </label>
                <label className="ui-field">
                  <span className="ui-label">{t('profile.villageTown')}</span>
                  <input
                    className="ui-input"
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
                <div className="profile-form-actions">
                  <button
                    type="button"
                    className="ui-btn ui-btn-outline"
                    onClick={() => setForm({
                      full_name: profile?.full_name || '',
                      phone: profile?.phone || '',
                      location: profile?.location || '',
                    })}
                  >
                    Reset
                  </button>
                  <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
                    {saving ? t('common.saving') : t('common.saveChanges')}
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section className="ui-card profile-shortcuts">
            <div className="ui-card-head">
              <div>
                <h3><Icon name="sparkles" size={16} />{t('profile.quickAccess')}</h3>
                <p>{t('profile.quickAccessSub')}</p>
              </div>
            </div>
            <div className="ui-card-body">
              <div className="profile-shortcut-grid">
                <Link to="/crops" className="profile-shortcut">
                  <span><Icon name="crops" size={18} /></span>
                  <strong>{t('nav.crops')}</strong>
                  <small>{t('profile.manageStock')}</small>
                </Link>
                <Link to="/market-prices" className="profile-shortcut">
                  <span><Icon name="prices" size={18} /></span>
                  <strong>{t('nav.marketPrices')}</strong>
                  <small>{t('profile.compareRates')}</small>
                </Link>
                <Link to="/bookings" className="profile-shortcut">
                  <span><Icon name="bookings" size={18} /></span>
                  <strong>{t('nav.bookings')}</strong>
                  <small>{t('profile.reviewTransport')}</small>
                </Link>
                <Link to="/chat" className="profile-shortcut">
                  <span><Icon name="chat" size={18} /></span>
                  <strong>{t('nav.chat')}</strong>
                  <small>{t('profile.askFarm')}</small>
                </Link>
              </div>
            </div>
          </section>

          <section className="ui-card profile-security">
            <div className="ui-card-head">
              <div>
                <h3><Icon name="lock" size={16} />{t('profile.accountSecurity')}</h3>
                <p>{t('profile.securitySub')}</p>
              </div>
            </div>
            <div className="ui-card-body">
              <div className="profile-security-row">
                <span><Icon name="shield" size={16} /></span>
                <div>
                  <strong>{t('profile.sessionActive')}</strong>
                  <p>{t('profile.sessionActiveSub')}</p>
                </div>
              </div>
              <div className="profile-security-row">
                <span><Icon name="phone" size={16} /></span>
                <div>
                  <strong>{t('profile.mobileSignin')}</strong>
                  <p>{t('profile.mobileSigninSub')}</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
