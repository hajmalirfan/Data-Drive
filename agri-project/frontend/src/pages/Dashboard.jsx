import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import LanguageSelector from '../components/LanguageSelector'
import './Dashboard.css'

export default function Dashboard() {
  const { user, logout } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="dash">
      <header className="dash-topbar">
        <div className="dash-topbar-inner">
          <div className="dash-left">
            <button className="btn-ghost" onClick={() => navigate(-1)}>{t('back')}</button>
            <span className="dash-brand">▲ {t('brand')}</span>
          </div>
          <div className="dash-right">
            <LanguageSelector compact />
            <span className="dash-user">{user?.email}</span>
            <button className="btn-secondary" onClick={handleLogout}>{t('logout')}</button>
          </div>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-container">
          <h1 className="dash-title">{t('dashTitle')}</h1>
          <p className="dash-sub">{t('dashWelcome')} <strong>{user?.email}</strong></p>

          <div className="dash-grid">
            <div className="dash-card">
              <h3>{t('cardAccountT')}</h3>
              <p>{t('cardAccountD')}</p>
            </div>
            <div className="dash-card">
              <h3>{t('cardNextT')}</h3>
              <p>{t('cardNextD')}</p>
            </div>
            <div className="dash-card">
              <h3>{t('cardSessionT')}</h3>
              <p>{t('cardSessionD')}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
