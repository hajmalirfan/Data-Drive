import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LanguageSelector from '../components/LanguageSelector'
import BrandLogo from '../components/BrandLogo'
import Icon from '../components/Icons'
import { useLanguage } from '../context/LanguageContext'
import { forgotPassword, verifyResetOtp, resetPassword } from '../services/authService'
import farmerImage from '../assets/farmer-logo.jpg'
import { meetsPasswordPolicy } from '../utils/passwordPolicy'
import './Login.css'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STEPS = ['email', 'otp', 'reset']

export default function ForgotPassword() {
  const { t } = useLanguage()
  const navigate = useNavigate()

  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [resetToken, setResetToken] = useState('')
  const [debugOtp, setDebugOtp] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [otpExpiry, setOtpExpiry] = useState(10)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const resetMessages = () => {
    setError('')
    setInfo('')
  }

  const sendCode = async (event, resend = false) => {
    event?.preventDefault()
    resetMessages()
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError(t('login.errEmailRequired'))
      return
    }
    setLoading(true)
    try {
      const data = await forgotPassword(email.trim())
      setStep('otp')
      setOtp('')
      setDebugOtp(data.debug_otp || '')
      setCooldown(data.resend_in || 60)
      setOtpExpiry(Math.max(1, Math.round((data.expires_in || 600) / 60)))
      if (resend) setInfo(t('login.resendSent'))
    } catch (err) {
      setError(err.response?.data?.detail || t('login.errForgot'))
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (event) => {
    event.preventDefault()
    resetMessages()
    if (!/^\d{4,8}$/.test(otp.trim())) {
      setError(t('login.errOtp'))
      return
    }
    setLoading(true)
    try {
      const data = await verifyResetOtp(email.trim(), otp.trim())
      setResetToken(data.reset_token)
      setDebugOtp('')
      setNewPassword('')
      setConfirmPassword('')
      setStep('reset')
    } catch (err) {
      setError(err.response?.data?.detail || t('login.errVerify'))
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (event) => {
    event.preventDefault()
    resetMessages()
    if (!meetsPasswordPolicy(newPassword)) {
      setError(t('login.errPasswordPolicy'))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t('login.errPasswordMismatch'))
      return
    }
    setLoading(true)
    try {
      await resetPassword(resetToken, newPassword)
      setStep('done')
    } catch (err) {
      setError(err.response?.data?.detail || t('login.errReset'))
    } finally {
      setLoading(false)
    }
  }

  const stepIndex = STEPS.indexOf(step)

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
          <p>{t('login.heroText')}</p>

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

          {step !== 'done' && (
            <div className="auth-steps" aria-hidden="true">
              {STEPS.map((name, index) => (
                <span
                  key={name}
                  className={`auth-step ${index === stepIndex ? 'active' : ''} ${index < stepIndex ? 'done' : ''}`}
                >
                  <b>{index < stepIndex ? <Icon name="check" size={11} /> : index + 1}</b>
                  <small>{t(`login.step.${name}`)}</small>
                </span>
              ))}
            </div>
          )}

          {step === 'email' && (
            <>
              <div className="auth-heading">
                <h2>{t('login.forgotTitle')}</h2>
                <p>{t('login.forgotSub')}</p>
              </div>
              <form className="auth-form" onSubmit={sendCode} noValidate>
                <label className="auth-field">
                  <span className="auth-label">{t('login.forgotEmailLabel')}<span className="auth-required">*</span></span>
                  <span className="auth-input">
                    <span className="auth-input-icon"><Icon name="mail" size={16} /></span>
                    <input
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder={t('login.forgotEmailPlaceholder')}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </span>
                </label>

                {error && <div className="ui-alert ui-alert-error" role="alert">{error}</div>}

                <button type="submit" className="auth-submit" disabled={loading}>
                  {loading && <span className="ui-spinner" style={{ width: 17, height: 17, borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' }} />}
                  {loading ? t('login.sendingOtp') : t('login.sendOtp')}
                  {!loading && <Icon name="arrowRight" size={16} />}
                </button>

                <p className="auth-switch">
                  <button type="button" onClick={() => navigate('/login')}>{t('login.backToSignIn')}</button>
                </p>
              </form>
            </>
          )}

          {step === 'otp' && (
            <>
              <div className="auth-heading">
                <h2>{t('login.otpTitle')}</h2>
                <p>{t('login.otpSub', [email.trim(), otpExpiry])}</p>
              </div>
              <form className="auth-form" onSubmit={handleVerify} noValidate>
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

                {debugOtp && (
                  <div className="ui-alert ui-alert-info" role="status">
                    {t('login.devOtp', [debugOtp])}
                  </div>
                )}
                {info && <div className="ui-alert ui-alert-info" role="status">{info}</div>}
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
                    onClick={(event) => sendCode(event, true)}
                  >
                    {cooldown > 0 ? t('login.resendIn', [cooldown]) : t('login.resendOtp')}
                  </button>
                </div>

                <p className="auth-switch">
                  <button type="button" onClick={() => { resetMessages(); setDebugOtp(''); setStep('email') }}>
                    {t('login.changeEmail')}
                  </button>
                  <span className="auth-switch-sep">·</span>
                  <button type="button" onClick={() => navigate('/login')}>{t('login.backToSignIn')}</button>
                </p>
              </form>
            </>
          )}

          {step === 'reset' && (
            <>
              <div className="auth-heading">
                <h2>{t('login.resetTitle')}</h2>
                <p>{t('login.resetSub')}</p>
              </div>
              <form className="auth-form" onSubmit={handleReset} noValidate>
                <label className="auth-field">
                  <span className="auth-label">{t('login.newPassword')}<span className="auth-required">*</span></span>
                  <span className="auth-input">
                    <span className="auth-input-icon"><Icon name="lock" size={16} /></span>
                    <input
                      type={showPw ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder={t('login.passwordPolicyPlaceholder')}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
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
                  <span className="auth-label">{t('login.confirmNewPassword')}<span className="auth-required">*</span></span>
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

                {error && <div className="ui-alert ui-alert-error" role="alert">{error}</div>}

                <button type="submit" className="auth-submit" disabled={loading}>
                  {loading && <span className="ui-spinner" style={{ width: 17, height: 17, borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' }} />}
                  {loading ? t('login.resetting') : t('login.resetBtn')}
                  {!loading && <Icon name="arrowRight" size={16} />}
                </button>

                <p className="auth-switch">
                  <button type="button" onClick={() => navigate('/login')}>{t('login.backToSignIn')}</button>
                </p>
              </form>
            </>
          )}

          {step === 'done' && (
            <div className="auth-done">
              <span className="auth-done-mark"><Icon name="check" size={26} /></span>
              <div className="auth-heading">
                <h2>{t('login.forgotDoneTitle')}</h2>
                <p>{t('login.forgotDoneSub')}</p>
              </div>
              <button type="button" className="auth-submit" onClick={() => navigate('/login', { replace: true })}>
                {t('login.forgotDoneBtn')}
                <Icon name="arrowRight" size={16} />
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
