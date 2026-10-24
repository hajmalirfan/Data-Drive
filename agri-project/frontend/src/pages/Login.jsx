import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LanguageSelector from '../components/LanguageSelector'
import BrandLogo from '../components/BrandLogo'
import Icon from '../components/Icons'
import {
  login as apiLogin,
  signup as apiSignup,
  verifyAdminLoginOtp,
  resendAdminLoginOtp,
} from '../services/authService'
import farmerImage from '../assets/farmer-logo.jpg'
import { meetsPasswordPolicy } from '../utils/passwordPolicy'
import './Login.css'
import { useLanguage } from '../context/LanguageContext'

const SIGNUP_ROLES = [
  { value: 'farmer', labelKey: 'role.farmer', hintKey: 'login.roleFarmerHint', icon: 'crops' },
  { value: 'truck_operator', labelKey: 'role.truckOperator', hintKey: 'login.roleOperatorHint', icon: 'truck' },
]

export default function Login() {
  const { t } = useLanguage()
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
  // Admin sign-in second step: { login_token, otp_email, expires_in, resend_in, debug_otp }
  const [otpChallenge, setOtpChallenge] = useState(null)
  const [otp, setOtp] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const { saveAuth } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const switchMode = (next) => {
    setMode(next)
    setError('')
    setSuccess('')
  }

  const startOtpStep = (data) => {
    setOtpChallenge(data)
    setOtp('')
    setCooldown(data.resend_in || 60)
  }

  const cancelOtpStep = () => {
    setOtpChallenge(null)
    setOtp('')
    setPassword('')
    setError('')
    setSuccess('')
  }

  const handleVerifyOtp = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!/^\d{4,8}$/.test(otp.trim())) {
      setError(t('login.errOtp'))
      return
    }
    setLoading(true)
    try {
      const data = await verifyAdminLoginOtp(otpChallenge.login_token, otp.trim())
      saveAuth(data)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || t('login.errVerify'))
    } finally {
      setLoading(false)
    }
  }

  const handleResendOtp = async () => {
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      startOtpStep(await resendAdminLoginOtp(otpChallenge.login_token))
      setSuccess(t('login.resendSent'))
    } catch (err) {
      setError(err.response?.data?.detail || t('login.errForgot'))
    } finally {
      setLoading(false)
    }
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
      if (data.otp_required) {
        startOtpStep(data)
        return
      }
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
    if (!meetsPasswordPolicy(password)) {
      setError(t('login.errPasswordPolicy'))
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

          {otpChallenge ? (
            <>
              <div className="auth-heading">
                <h2>{t('login.adminOtpTitle')}</h2>
                <p>{t('login.otpSub', [otpChallenge.otp_email, Math.max(1, Math.round((otpChallenge.expires_in || 600) / 60))])}</p>
              </div>
              <form className="auth-form" onSubmit={handleVerifyOtp} noValidate>
                <label className="auth-field">
                  <span className="auth-label">{t('login.otpLabel')}<span className="auth-required">*</span></span>
                  <span className="auth-input auth-otp-input">
                    <span className="auth-input-icon"><Icon name="shield" size={16} /></span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      maxLength={6}
                      placeholder={t('login.otpPlaceholder')}
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                    />
                  </span>
                </label>

                {otpChallenge.debug_otp && (
                  <div className="ui-alert ui-alert-info" role="status">
                    {t('login.devOtp', [otpChallenge.debug_otp])}
                  </div>
                )}
                {success && <div className="ui-alert ui-alert-info" role="status">{success}</div>}
                {error && <div className="ui-alert ui-alert-error" role="alert">{error}</div>}

                <button type="submit" className="auth-submit" disabled={loading}>
                  {loading && <span className="ui-spinner" style={{ width: 17, height: 17, borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' }} />}
                  {loading ? t('login.verifying') : t('login.verifyOtp')}
                  {!loading && <Icon name="arrowRight" size={16} />}
                </button>

                <div className="auth-resend">
                  <span>{t('login.noCode')}</span>
                  <button
                    type="button"
                    className="auth-forgot"
                    disabled={cooldown > 0 || loading}
                    onClick={handleResendOtp}
                  >
                    {cooldown > 0 ? t('login.resendIn', [cooldown]) : t('login.resendOtp')}
                  </button>
                </div>

                <p className="auth-switch">
                  <button type="button" onClick={cancelOtpStep}>{t('login.backToSignIn')}</button>
                </p>
              </form>
            </>
          ) : (
          <>
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
                    placeholder={t('login.passwordPolicyPlaceholder')}
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
                  {SIGNUP_ROLES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={`auth-role ${role === item.value ? 'active' : ''}`}
                      onClick={() => setRole(item.value)}
                      aria-pressed={role === item.value}
                    >
                      <Icon name={item.icon} size={15} />
                      <span>{t(item.labelKey)}</span>
                    </button>
                  ))}
                </div>
                <p className="auth-role-hint">
                  {t(SIGNUP_ROLES.find((item) => item.value === role).hintKey)}
                </p>
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
          </>
          )}
        </div>
      </section>
    </div>
  )
}
