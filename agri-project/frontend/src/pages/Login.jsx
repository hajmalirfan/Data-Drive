import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LanguageSelector from '../components/LanguageSelector'
import BrandLogo from '../components/BrandLogo'
import Icon from '../components/Icons'
import { login as apiLogin, signup as apiSignup } from '../services/authService'
import './Login.css'
import { useLanguage } from '../context/LanguageContext'

const ROLE_CHOICES = [
  { value: 'farmer', labelKey: 'role.farmer', hintKey: 'login.roleFarmerHint', icon: 'crops' },
  { value: 'truck_operator', labelKey: 'role.truckOperator', hintKey: 'login.roleOperatorHint', icon: 'truck' },
  { value: 'fpo', labelKey: 'role.fpo', hintKey: 'login.roleFpoHint', icon: 'profile' },
  { value: 'market_manager', labelKey: 'login.roleManager', hintKey: 'login.roleManagerHint', icon: 'prices' },
  { value: 'buyer', labelKey: 'login.roleBuyer', hintKey: 'login.roleBuyerHint', icon: 'markets' },
]

const DEMOS = [
  { role: 'farmer', labelKey: 'role.farmer', icon: 'crops', identifier: 'farmer@smartag.in', password: 'Farmer123' },
  { role: 'truck_operator', labelKey: 'login.demoOperator', icon: 'truck', identifier: 'operator@smartag.in', password: 'Operator123' },
  { role: 'fpo', labelKey: 'role.fpo', icon: 'profile', identifier: 'fpo@smartag.in', password: 'Fpo12345' },
  { role: 'market_manager', labelKey: 'login.demoManager', icon: 'prices', identifier: 'manager@smartag.in', password: 'Manager123' },
]

function AuthArt() {
  return (
    <svg viewBox="0 0 520 300" className="auth-art" aria-hidden="true">
      <defs>
        <linearGradient id="authfield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7cc07a" />
          <stop offset="100%" stopColor="#3f8d4f" />
        </linearGradient>
        <linearGradient id="authsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="520" height="300" rx="24" fill="url(#authsky)" />
      <circle cx="420" cy="68" r="34" fill="#f6d27a" opacity="0.92" />
      <circle cx="420" cy="68" r="52" fill="#f6d27a" opacity="0.14" />
      <path d="M0 172c64-44 121-43 176-7 42 28 84 27 128-3 56-38 126-39 216 12v126H0z" fill="#84b46f" opacity="0.55" />
      <path d="M0 208c84-37 149-27 202 1 54 29 103 23 153-5 53-30 106-26 165 10v86H0z" fill="url(#authfield)" />
      <path d="M36 300c40-45 91-73 152-88M104 300c35-36 78-58 128-70M178 300c33-29 70-46 112-55M256 300c35-22 74-33 117-36M336 300c31-14 66-21 104-22" stroke="#2f743e" strokeWidth="3" strokeLinecap="round" opacity="0.35" fill="none" />
      <path d="M0 146c30-18 57-19 82-5" stroke="#a9d09f" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.4" />
      <g transform="translate(148 130)">
        <rect x="0" y="20" width="94" height="48" rx="9" fill="#ffffff" />
        <rect x="11" y="30" width="34" height="20" rx="5" fill="#a9d3b4" />
        <path d="M94 37h26l18 17v14H94z" fill="#216a3d" />
        <rect x="101" y="43" width="19" height="11" rx="3" fill="#c9e7d3" />
        <circle cx="30" cy="70" r="12" fill="#183a26" />
        <circle cx="30" cy="70" r="4.7" fill="#d7e7da" />
        <circle cx="116" cy="70" r="12" fill="#183a26" />
        <circle cx="116" cy="70" r="4.7" fill="#d7e7da" />
        <rect x="5" y="44" width="7" height="11" rx="3" fill="#f2c96b" />
      </g>
      <g fill="#ffffff" opacity="0.55">
        <circle cx="63" cy="62" r="2.4" />
        <circle cx="88" cy="48" r="1.8" />
        <circle cx="116" cy="70" r="1.6" />
        <circle cx="250" cy="54" r="2" />
        <circle cx="282" cy="74" r="1.6" />
      </g>
      <g transform="translate(388 178)">
        <path d="M0 34c0-24 15-40 37-44-3 25-16 41-37 44z" fill="#e9f4e2" opacity="0.9" />
        <path d="M0 34c-15-13-18-30-9-47 16 13 19 31 9 47z" fill="#d3ead1" opacity="0.9" />
        <path d="M0 36v48" stroke="#e4f0dd" strokeWidth="3.5" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export default function Login() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const [mode, setMode] = useState('signin')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [role, setRole] = useState('farmer')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const { saveAuth } = useAuth()
  const navigate = useNavigate()

  const switchMode = (next) => {
    setMode(next)
    setError('')
    setSuccess('')
  }

  const fillDemo = (demo) => {
    setMode('signin')
    setIdentifier(demo.identifier)
    setPassword(demo.password)
    setError('')
    setSuccess(t('login.demoFilled', [t(demo.labelKey)]))
  }

  const handleSignin = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!identifier.trim()) {
      setError(t('login.errIdentifier'))
      return
    }
    if (password.length < 6) {
      setError(t('login.errPassword'))
      return
    }
    setLoading(true)
    try {
      const data = await apiLogin(identifier.trim(), password)
      saveAuth(data)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || t('login.errSignin'))
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    const digits = phone.replace(/\D/g, '')
    if (fullName.trim().length < 2) {
      setError(t('login.errFullName'))
      return
    }
    if (digits.length < 7) {
      setError(t('login.errMobile'))
      return
    }
    if (password.length < 6) {
      setError(t('login.errPassword'))
      return
    }
    setLoading(true)
    try {
      const data = await apiSignup({
        full_name: fullName.trim(),
        phone: phone.trim(),
        password,
        role,
        location: location.trim(),
      })
      saveAuth(data)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || t('login.errSignup'))
    } finally {
      setLoading(false)
    }
  }

  const activeRole = ROLE_CHOICES.find((item) => item.value === role)

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <header className="auth-hero-top">
          <BrandLogo light />
          <LanguageSelector compact />
        </header>

        <div className="auth-hero-copy">
          <span className="auth-kicker">{t('login.heroKicker')}</span>
          <h1>{t('login.heroTitle1')}<br /><em>{t('login.heroTitle2')}</em></h1>
          <p>
            Compare mandi prices after real transport costs, book shared trucks and
            track every kilogram from farm to market.
          </p>

          <div className="auth-benefits">
            <span><i><Icon name="prices" size={14} /></i>{t('login.benefitPrices')}</span>
            <span><i><Icon name="truck" size={14} /></i>{t('login.benefitTrucks')}</span>
            <span><i><Icon name="tracking" size={14} /></i>{t('login.benefitTracking')}</span>
          </div>
        </div>

        <div className="auth-hero-art"><AuthArt /></div>

        <div className="auth-hero-foot">
          <span className="auth-foot-dot" />
          <span>{t('login.heroFoot')}</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-head">
            <span className="auth-card-mark"><Icon name="leaf" size={19} /></span>
            <span className="auth-card-brand">{t('brand')}<small>{t('appTagline')}</small></span>
          </div>

          <div className="auth-heading">
            <h2>{mode === 'signin' ? t('login.welcomeBack') : t('login.createAccountTitle')}</h2>
            <p>{mode === 'signin' ? t('login.signinSub') : t('login.signupSub')}</p>
          </div>

          <div className="auth-seg" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={mode === 'signin' ? 'active' : ''}
              onClick={() => switchMode('signin')}
            >
              {t('login.signIn')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => switchMode('signup')}
            >
              {t('login.register')}
            </button>
          </div>

          {mode === 'signin' ? (
            <form className="auth-form" onSubmit={handleSignin} noValidate>
              <label className="auth-field">
                <span className="auth-label">{t('login.identifierLabel')}</span>
                <span className="auth-input">
                  <span className="auth-input-icon"><Icon name="phone" size={16} /></span>
                  <input
                    type="text"
                    inputMode="tel"
                    autoComplete="username"
                    placeholder={t('login.identifierPlaceholder')}
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                  />
                </span>
              </label>

              <label className="auth-field">
                <span className="auth-label">{t('login.password')}</span>
                <span className="auth-input">
                  <span className="auth-input-icon"><Icon name="lock" size={16} /></span>
                  <input
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder={t('login.passwordPlaceholder')}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="auth-eye"
                    onClick={() => setShowPw((value) => !value)}
                    aria-label={showPw ? t('login.hidePassword') : t('login.showPassword')}
                  >
                    <Icon name={showPw ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </span>
              </label>

              <div className="auth-row">
                <label className="auth-check">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                  <span>{t('login.rememberMe')}</span>
                </label>
                <button
                  type="button"
                  className="auth-forgot"
                  onClick={() => setSuccess(t('login.forgotMessage'))}
                >
                  Forgot Password?
                </button>
              </div>

              {error && <div className="ui-alert ui-alert-error" role="alert">{error}</div>}
              {success && <div className="ui-alert ui-alert-info" role="status">{success}</div>}

              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? <span className="ui-spinner" style={{ width: 17, height: 17, borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' }} /> : null}
                {loading ? t('login.signingIn') : t('login.login')}
                {!loading && <Icon name="arrowRight" size={16} />}
              </button>

              <div className="auth-divider"><span>{t('login.orLoginAs')}</span></div>
              <div className="auth-demos">
                {DEMOS.map((demo) => (
                  <button
                    key={demo.role}
                    type="button"
                    className="auth-demo"
                    onClick={() => fillDemo(demo)}
                    title={`${demo.identifier} / ${demo.password}`}
                  >
                    <Icon name={demo.icon} size={15} />
                    {t(demo.labelKey)}
                  </button>
                ))}
              </div>

              <p className="auth-note">
                {t('login.demoNote')}
              </p>

              <p className="auth-switch">
                {t('login.newHere')}{' '}
                <button type="button" onClick={() => switchMode('signup')}>{t('login.createAccountLink')}</button>
              </p>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleSignup} noValidate>
              <label className="auth-field">
                <span className="auth-label">{t('login.fullName')}</span>
                <span className="auth-input">
                  <span className="auth-input-icon"><Icon name="profile" size={16} /></span>
                  <input
                    type="text"
                    autoComplete="name"
                    placeholder={t('login.fullNamePlaceholder')}
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                  />
                </span>
              </label>

              <label className="auth-field">
                <span className="auth-label">{t('login.mobile')}</span>
                <span className="auth-input">
                  <span className="auth-input-icon"><Icon name="phone" size={16} /></span>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="98765 43210"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </span>
              </label>

              <label className="auth-field">
                <span className="auth-label">{t('login.password')}</span>
                <span className="auth-input">
                  <span className="auth-input-icon"><Icon name="lock" size={16} /></span>
                  <input
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={t('login.passwordNewPlaceholder')}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="auth-eye"
                    onClick={() => setShowPw((value) => !value)}
                    aria-label={showPw ? t('login.hidePassword') : t('login.showPassword')}
                  >
                    <Icon name={showPw ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </span>
              </label>

              <label className="auth-field">
                <span className="auth-label">{t('login.villageTown')}<small>{t('common.optional')}</small></span>
                <span className="auth-input">
                  <span className="auth-input-icon"><Icon name="markets" size={16} /></span>
                  <input
                    type="text"
                    autoComplete="address-level2"
                    placeholder={t('login.villagePlaceholder')}
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                  />
                </span>
              </label>

              <div className="auth-role-field">
                <span className="auth-label">{t('login.iAmA')}</span>
                <div className="auth-roles">
                  {ROLE_CHOICES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={`auth-role ${role === item.value ? 'active' : ''}`}
                      onClick={() => setRole(item.value)}
                    >
                      <Icon name={item.icon} size={15} />
                      <span>{t(item.labelKey)}</span>
                    </button>
                  ))}
                </div>
                <p className="auth-role-hint">{activeRole ? t(activeRole.hintKey) : ''}</p>
              </div>

              {error && <div className="ui-alert ui-alert-error" role="alert">{error}</div>}
              {success && <div className="ui-alert ui-alert-info" role="status">{success}</div>}

              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? <span className="ui-spinner" style={{ width: 17, height: 17, borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' }} /> : null}
                {loading ? t('login.creatingAccount') : t('login.createAccountBtn')}
                {!loading && <Icon name="arrowRight" size={16} />}
              </button>

              <p className="auth-note auth-note-center">
                {t('login.termsNote')}
              </p>

              <p className="auth-switch">
                {t('login.alreadyHave')}{' '}
                <button type="button" onClick={() => switchMode('signin')}>{t('login.signInLink')}</button>
              </p>
            </form>
          )}
        </div>
      </section>
    </div>
  )
}
