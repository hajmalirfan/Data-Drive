import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import LanguageSelector from '../components/LanguageSelector'
import './Dashboard.css'

const ROLE_CONTENT = {
  farmer: { titleKey: 'roleFarmerPanelT', descKey: 'roleFarmerPanelD' },
  fpo: { titleKey: 'roleFpoPanelT', descKey: 'roleFpoPanelD' },
  marketer: { titleKey: 'roleMarketerPanelT', descKey: 'roleMarketerPanelD' },
  admin: { titleKey: 'roleAdminPanelT', descKey: 'roleAdminPanelD' },
}

export default function Dashboard() {
  const { user, role, isAdmin, logout } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const roleInfo = ROLE_CONTENT[role] || ROLE_CONTENT.farmer
  const roleLabel = role === 'farmer' ? t('roleFarmer') : role === 'fpo' ? t('roleFpo') : role === 'marketer' ? t('roleMarketer') : role === 'admin' ? t('roleAdmin') : role

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
            <span className={`role-badge role-${role}`}>{roleLabel}</span>
            <button className="btn-secondary" onClick={handleLogout}>{t('logout')}</button>
          </div>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-container">
          <h1 className="dash-title">{t('dashTitle')}</h1>
          <p className="dash-sub">{t('dashWelcome')} <strong>{user?.email}</strong> · {t('role')}: <strong>{roleLabel}</strong></p>

          {isAdmin && (
            <div className="dash-admin-link">
              <Link to="/admin">{t('adminPanelLink')} →</Link>
            </div>
          )}

          <div className="dash-grid">
            <div className="dash-card role-card">
              <h3>{t(roleInfo.titleKey)}</h3>
              <p>{t(roleInfo.descKey)}</p>
            </div>
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
