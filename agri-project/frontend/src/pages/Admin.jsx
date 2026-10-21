import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icons'
import { fetchUsers, ROLES, updateUserRole } from '../services/authService'
import './Admin.css'
import { useLanguage } from '../context/LanguageContext'

export default function Admin() {
  const { t, statusLabel, roleLabel } = useLanguage()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [busyId, setBusyId] = useState(null)

  const load = () => {
    setLoading(true)
    setError('')
    fetchUsers()
      .then(setUsers)
      .catch((err) => setError(err.response?.data?.detail || t('admin.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users.filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false
      if (!needle) return true
      return [user.full_name, user.email, user.phone, user.location]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle))
    })
  }, [users, query, roleFilter])

  const roleCounts = useMemo(() => {
    const counts = {}
    users.forEach((user) => { counts[user.role] = (counts[user.role] || 0) + 1 })
    return counts
  }, [users])

  const changeRole = async (user, role) => {
    if (role === user.role) return
    setBusyId(user.id)
    setError('')
    try {
      const updated = await updateUserRole(user.id, role)
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setNotice(t('admin.roleUpdated', [updated.full_name || updated.email, roleLabel(role)]))
    } catch (err) {
      setError(err.response?.data?.detail || t('admin.roleError'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ui-page admin-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('admin.title')}</h2>
          <p>{t('admin.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <button type="button" className="ui-btn ui-btn-outline" onClick={load}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <div className="admin-summary">
        <div className="admin-summary-card">
          <span><Icon name="profile" size={17} /></span>
          <div><small>{t('admin.totalAccounts')}</small><strong>{users.length}</strong></div>
        </div>
        {ROLES.filter((role) => roleCounts[role]).map((role) => (
          <div className="admin-summary-card" key={role}>
            <span><Icon name={role === 'truck_operator' ? 'truck' : role === 'market_manager' ? 'prices' : role === 'farmer' ? 'crops' : 'profile'} size={17} /></span>
            <div><small>{roleLabel(role)}</small><strong>{roleCounts[role]}</strong></div>
          </div>
        ))}
      </div>

      <div className="ui-card">
        <div className="admin-filters">
          <div className="ui-filters">
            <label className="ui-field">
              <span className="ui-label">{t('common.search')}</span>
              <input
                className="ui-input"
                placeholder={t('admin.searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t('profile.role')}</span>
              <select className="ui-select" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="all">{t('admin.allRoles')}</option>
                          {ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
              </select>
            </label>
          </div>
          <span className="admin-count">{t('admin.shown', [filtered.length])}</span>
        </div>

        <div className="ui-card-body admin-table-body">
          {loading ? (
            <div className="ui-loading"><span className="ui-spinner" />{t('admin.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="ui-empty">
              <span className="ui-empty-icon"><Icon name="profile" size={22} /></span>
              <strong>{t('admin.noMatches')}</strong>
              <p>{t('admin.noMatchesSub')}</p>
            </div>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table admin-table">
                <thead>
                  <tr>
                    <th>{t('admin.thUser')}</th>
                    <th>{t('admin.thContact')}</th>
                    <th>{t('common.location')}</th>
                    <th>{t('profile.role')}</th>
                    <th>{t('admin.thChangeRole')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <span className="admin-user">
                          <span className="admin-avatar">
                            {(user.full_name || user.email || 'SA').slice(0, 2).toUpperCase()}
                          </span>
                          <span>
                            <strong>{user.full_name || t('admin.unnamed')}</strong>
                            <small>SA-{String(user.id).padStart(5, '0')}</small>
                          </span>
                        </span>
                      </td>
                      <td>
                        <strong className="admin-email">{user.email}</strong>
                        <small className="admin-sub">{user.phone || t('admin.noMobile')}</small>
                      </td>
                      <td>{user.location || <span className="muted">{t('common.notSet')}</span>}</td>
                      <td><span className={`role-badge role-${user.role}`}>{roleLabel(user.role)}</span></td>
                      <td>
                        <select
                          className="ui-select admin-role-select"
                          value={user.role}
                          disabled={busyId === user.id}
                          onChange={(event) => changeRole(user, event.target.value)}
                          aria-label={t('admin.changeRoleFor', [user.email])}
                        >
                {ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <p className="admin-note">
        <Icon name="info" size={13} />
        Role changes take effect the next time that user opens a protected page or signs in again.
      </p>
    </div>
  )
}
