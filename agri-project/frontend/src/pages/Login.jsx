import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LanguageSelector from '../components/LanguageSelector'
import BrandLogo from '../components/BrandLogo'
import Icon from '../components/Icons'
import { login as apiLogin, signup as apiSignup } from '../services/authService'
import farmerImage from '../assets/farmer-logo.jpg'
import './Login.css'
import { useLanguage } from '../context/LanguageContext'

const ROLE_CHOICES = [
  { value: 'farmer', labelKey: 'role.farmer', hintKey: 'login.roleFarmerHint', icon: 'crops' },
  { value: 'truck_operator', labelKey: 'role.truckOperator', hintKey: 'login.roleOperatorHint', icon: 'truck' },
  { value: 'market_manager', labelKey: 'login.roleManager', hintKey: 'login.roleManagerHint', icon: 'prices' },
  { value: 'buyer', labelKey: 'login.roleBuyer', hintKey: 'login.roleBuyerHint', icon: 'markets' },
]

export default function Login() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const [mode, setMode] = useState('signin')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('farmer')
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
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
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (fullName.trim().length < 2) {
      setError(t('login.errFullName'))
      return
    }
    if (!emailPattern.test(email.trim())) {
      setError(t('login.errEmail'))
      return
    }
    if (password.length < 6) {
      setError(t('login.errPassword'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('login.errPasswordMismatch'))
      return
    }
    setLoading(true)
    try {
      const data = await apiSignup({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        role,
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
      <img className="auth-page-bg" src={farmerImage} alt="" aria-hidden="true" />
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

          {mode === 'signin' ? (
            <form className="auth-form" onSubmit={handleSignin} noValidate>
              <label className="auth-field">
                <span className="auth-label">{t('login.identifierLabel')}<span className="auth-required">*</span></span>
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
                <span className="auth-label">{t('login.password')}<span className="auth-required">*</span></span>
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
                  onClick={() => navigate('/forgot-password')}
                >
                  {t('login.forgot')}
                </button>
              </div>

              {error && <div className="ui-alert ui-alert-error" role="alert">{error}</div>}
              {success && <div className="ui-alert ui-alert-info" role="status">{success}</div>}

              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? <span className="ui-spinner" style={{ width: 17, height: 17, borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' }} /> : null}
                {loading ? t('login.signingIn') : t('login.login')}
                {!loading && <Icon name="arrowRight" size={16} />}
              </button>

              <div className="auth-switch">
                {t('login.newHere')}{' '}
                <button type="button" onClick={() => switchMode('signup')}>{t('login.createAccountLink')}</button>
              </div>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleSignup} noValidate>
              <label className="auth-field">
                <span className="auth-label">{t('login.fullName')}<span className="auth-required">*</span></span>
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
                <span className="auth-label">{t('login.email')}<span className="auth-required">*</span></span>
                <span className="auth-input">
                  <span className="auth-input-icon"><Icon name="mail" size={16} /></span>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder={t('login.emailPlaceholder')}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </span>
              </label>

              <label className="auth-field">
                <span className="auth-label">{t('login.password')}<span className="auth-required">*</span></span>
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
                <span className="auth-label">{t('login.confirmPassword')}<span className="auth-required">*</span></span>
                <span className="auth-input">
                  <span className="auth-input-icon"><Icon name="lock" size={16} /></span>
                  <input
                    type={showConfirmPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={t('login.confirmPasswordPlaceholder')}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="auth-eye"
                    onClick={() => setShowConfirmPw((value) => !value)}
                    aria-label={showConfirmPw ? t('login.hidePassword') : t('login.showPassword')}
                  >
                    <Icon name={showConfirmPw ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </span>
              </label>

              <div className="auth-role-field">
                <span className="auth-label">{t('login.iAmA')}<span className="auth-required">*</span></span>
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
