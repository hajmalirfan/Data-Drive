import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import LanguageSelector from '../components/LanguageSelector'
import { fetchUsers, updateUserRole, ROLES } from '../services/authService'
import './Dashboard.css'

export default function Admin() {
  const { user, isAdmin } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdmin) return
    fetchUsers()
      .then(setUsers)
      .catch((e) => setError(e.response?.data?.detail || t('fail')))
      .finally(() => setLoading(false))
  }, [isAdmin]) // eslint-disable-line

  if (!isAdmin) {
    return (
      <div style={{ padding: 32 }}>
        <h2>{t('adminDenied')}</h2>
        <p>{t('adminDeniedD')}</p>
        <Link to="/dashboard">{t('backToDash')}</Link>
      </div>
    )
  }

  const handleRoleChange = async (id, newRole) => {
    try {
      const updated = await updateUserRole(id, newRole)
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)))
    } catch (e) {
      setError(e.response?.data?.detail || t('fail'))
    }
  }

  return (
    <div className="dash">
      <header className="dash-topbar">
        <div className="dash-topbar-inner">
          <div className="dash-left">
            <button className="btn-ghost" onClick={() => navigate('/dashboard')}>{t('back')}</button>
            <span className="dash-brand">▲ {t('brand')} · {t('adminPanel')}</span>
          </div>
          <div className="dash-right">
            <LanguageSelector compact />
            <span className="dash-user">{user?.email}</span>
            <span className="role-badge role-admin">{t('roleAdmin')}</span>
          </div>
        </div>
      </header>
      <main className="dash-main">
        <div className="dash-container">
          <h1 className="dash-title">{t('adminPanel')}</h1>
          <p className="dash-sub">{t('adminPanelSub')}</p>
          {error && <div className="alert alert-error">{error}</div>}
          {loading ? (
            <p>{t('wait')}</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{t('email')}</th>
                    <th>{t('role')}</th>
                    <th>{t('changeRole')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.id}</td>
                      <td>{u.email}</td>
                      <td><span className={`role-badge role-${u.role}`}>{u.role}</span></td>
                      <td>
                        <select value={u.role} onChange={(e) => handleRoleChange(u.id, e.target.value)}>
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
