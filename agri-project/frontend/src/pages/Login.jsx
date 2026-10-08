import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import LanguageSelector from '../components/LanguageSelector'
import { login as apiLogin, signup as apiSignup } from '../services/authService'
import './Login.css'

export default function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const { saveAuth } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()

  const emailValid = /.+@.+\..+/.test(email.trim())
  const pwValid = password.length >= 6

  const switchMode = (m) => {
    setMode(m)
    setError('')
    setSuccess('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!emailValid) { setError(t('invalidEmail')); return }
    if (!pwValid) { setError(t('shortPw')); return }
    setLoading(true)
    try {
      if (mode === 'signup') {
        const data = await apiSignup(email.trim(), password)
        saveAuth(data)
        setSuccess(t('created'))
        setTimeout(() => navigate('/dashboard'), 800)
      } else {
        const data = await apiLogin(email.trim(), password)
        saveAuth(data)
        navigate('/dashboard')
      }
    } catch (err) {
      setError(err.response?.data?.detail || t('fail'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      {/* LEFT */}
      <section className="auth-left">
        <header className="auth-topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">◣</span>
            <span className="brand-name">{t('brand')}</span>
          </div>
          <LanguageSelector compact />
        </header>

        <main className="auth-main">
          <div className="auth-card">
            <h1 className="auth-title">
              {mode === 'signin' ? t('welcomeBack') : t('createAccount')}
            </h1>
            <p className="auth-subtitle">
              {mode === 'signin' ? t('welcomeBackSub') : t('signupSub')}
            </p>

            <div className="seg" role="tablist" aria-label="Auth mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                className={`seg-btn ${mode === 'signin' ? 'is-active' : ''}`}
                onClick={() => switchMode('signin')}
              >
                {t('signIn')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                className={`seg-btn ${mode === 'signup' ? 'is-active' : ''}`}
                onClick={() => switchMode('signup')}
              >
                {t('signup')}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="auth-form" noValidate>
              <div className={`input-row ${email && !emailValid ? 'has-error' : ''}`}>
                <span className="input-ico" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
                </span>
                <span className="input-divider" aria-hidden="true" />
                <label className="input-body">
                  <span className="input-label">{t('email')}</span>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder={t('emailPh')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <span className="input-action">
                  {emailValid && <span className="valid-badge" title="Valid email">✓</span>}
                </span>
              </div>

              <div className="input-row">
                <span className="input-ico" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
                </span>
                <span className="input-divider" aria-hidden="true" />
                <label className="input-body">
                  <span className="input-label">{t('password')}</span>
                  <input
                    type={showPw ? 'text' : 'password'}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    placeholder={t('passwordPh')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </label>
                <span className="input-action">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? t('hide') : t('show')}
                  >
                    {showPw ? t('hide') : t('show')}
                  </button>
                </span>
              </div>

              <div className="alert-slot" aria-live="polite">
                {error && <div className="alert alert-error">{error}</div>}
                {success && <div className="alert alert-success">{success}</div>}
              </div>

              <button className="btn-primary" disabled={loading} type="submit">
                {loading ? t('wait') : mode === 'signin' ? t('continue') : t('signupContinue')}
              </button>
            </form>

            <p className="auth-switch">
              {mode === 'signin' ? (
                <>{t('noAccount')} <Link to="#" onClick={(e) => { e.preventDefault(); switchMode('signup') }}>{t('createOne')}</Link></>
              ) : (
                <>{t('haveAccount')} <Link to="#" onClick={(e) => { e.preventDefault(); switchMode('signin') }}>{t('signIn')}</Link></>
              )}
            </p>
          </div>
        </main>

        <footer className="auth-footer">
          <p>{t('footerNote')}</p>
        </footer>
      </section>

      {/* RIGHT */}
      <aside className="auth-right" aria-hidden="true">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="glass-card">
          <div className="safe">
            <div className="safe-door">
              <div className="safe-dial" />
              <div className="safe-handle"><i /><i /><i /></div>
            </div>
          </div>
          <div className="glass-meta">
            <strong>{t('secureTitle')}</strong>
            <span>{t('secureSub')}</span>
          </div>
        </div>
      </aside>
    </div>
  )
}
