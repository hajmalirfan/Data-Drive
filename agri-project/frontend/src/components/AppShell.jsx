import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  searchAll,
} from '../services/operationsService'
import BrandLogo from './BrandLogo'
import Icon from './Icons'
import LiveShareBar from './LiveShareBar'
import LanguageSelector from './LanguageSelector'
import './AppShell.css'
import { useLanguage } from '../context/LanguageContext'
import { formatIndiaDate, formatIndiaDateTime, getIndiaDateTimestamp } from '../utils/dateTime'

const NAV = [
  { to: '/dashboard', label: 'nav.dashboard', icon: 'dashboard' },
  { to: '/crops', label: 'nav.crops', icon: 'crops', roles: ['farmer'] },
  { to: '/market-prices', label: 'nav.marketPrices', icon: 'prices', roles: ['farmer', 'truck_operator', 'market_manager', 'buyer', 'marketer'] },
  { to: '/markets', label: 'nav.markets', icon: 'markets', roles: ['farmer', 'truck_operator', 'market_manager', 'buyer', 'marketer'] },
  { to: '/trucks', label: 'nav.trucks', icon: 'truck', roles: ['farmer', 'truck_operator'] },
  { to: '/tracking', label: 'nav.tracking', icon: 'tracking', roles: ['farmer', 'truck_operator'] },
  { to: '/bookings', label: 'nav.bookings', icon: 'bookings', roles: ['farmer', 'truck_operator'] },
  { to: '/reports', label: 'nav.reports', icon: 'reports', roles: ['farmer', 'admin', 'market_manager'] },
  { to: '/chat', label: 'nav.chat', icon: 'chat' },
  { to: '/profile', label: 'nav.profile', icon: 'profile' },
  { to: '/admin', label: 'nav.admin', icon: 'shield', roles: ['admin'] },
]

const DRIVER_NAV = [
  { to: '/dashboard', label: 'nav.dashboard', icon: 'dashboard' },
  { to: '/booking-requests', label: 'nav.bookingRequests', icon: 'bookings' },
  { to: '/trips', label: 'nav.myTrips', icon: 'tracking' },
  { to: '/trucks', label: 'trucks.myTrucks', icon: 'truck' },
  { to: '/notifications', label: 'nav.notifications', icon: 'bell' },
  { to: '/profile', label: 'nav.profileSettings', icon: 'profile' },
]

const TITLES = {
  '/dashboard': ['title.dashboard', 'subtitle.dashboard'],
  '/crops': ['title.crops', 'subtitle.crops'],
  '/market-prices': ['title.marketPrices', 'subtitle.marketPrices'],
  '/markets': ['title.markets', 'subtitle.markets'],
  '/trucks': ['title.trucks', 'subtitle.trucks'],
  '/tracking': ['title.tracking', 'subtitle.tracking'],
  '/bookings': ['title.bookings', 'subtitle.bookings'],
  '/reports': ['title.reports', 'subtitle.reports'],
  '/profile': ['title.profile', 'subtitle.profile'],
  '/chat': ['title.chat', 'subtitle.chat'],
  '/admin': ['title.admin', 'subtitle.admin'],
  '/booking-requests': ['title.bookingRequests', 'subtitle.bookingRequests'],
  '/trips': ['title.myTrips', 'subtitle.myTrips'],
  '/notifications': ['title.notifications', 'subtitle.notifications'],
}

const pick = (obj, key, fallback = '') => obj?.[key] ?? fallback

function timeAgo(value, t, useLocalTime) {
  if (!value) return ''
  const timestamp = useLocalTime ? new Date(value).getTime() : getIndiaDateTimestamp(value)
  const diff = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('shell.justNow')
  if (minutes < 60) return t('shell.minutesAgo', [minutes])
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('shell.hoursAgo', [hours])
  const days = Math.floor(hours / 24)
  if (days < 7) return t('shell.daysAgo', [days])
  return useLocalTime
    ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : formatIndiaDate(value, { day: 'numeric', month: 'short' })
}

export default function AppShell({ children }) {
  const { t, statusLabel, roleLabel } = useLanguage()
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const searchRef = useRef(null)
  const notifRef = useRef(null)

  const isDriver = role === 'truck_operator'
  const items = isDriver ? DRIVER_NAV : NAV.filter((item) => !item.roles || item.roles.includes(role))
  let [titleKey, subtitleKey] = TITLES[location.pathname] || ['brand', 'appTagline']
  if (isDriver && location.pathname === '/dashboard') {
    titleKey = 'title.driverDashboard'
    subtitleKey = 'subtitle.driverDashboard'
  }
  if (role === 'admin' && location.pathname === '/dashboard') {
    subtitleKey = 'subtitle.adminDashboard'
  }
  if (isDriver && location.pathname === '/profile') {
    titleKey = 'title.profileSettings'
    subtitleKey = 'subtitle.profileSettings'
  }
  const title = t(titleKey)
  const subtitle = t(subtitleKey)
  const unread = notifications.filter((item) => !item.is_read).length
  const initials = (user?.full_name || user?.email || 'SA')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  useEffect(() => {
    setSidebarOpen(false)
    setNotifOpen(false)
    setResults(null)
    setQuery('')
  }, [location.pathname])

  useEffect(() => {
    getNotifications({ limit: 12 }).then(setNotifications).catch(() => {})
  }, [])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      searchAll(query.trim())
        .then((data) => setResults(data))
        .catch(() => setResults(null))
        .finally(() => setSearching(false))
    }, 280)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const onDown = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) setResults(null)
      if (notifRef.current && !notifRef.current.contains(event.target)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const suggestions = results
    ? [
        ...(results.markets || []).map((item) => ({ ...item, kind: t('common.market'), icon: 'markets' })),
        ...(results.crops || []).map((item) => ({ ...item, kind: t('common.crop'), icon: 'crops' })),
        ...(results.trucks || []).map((item) => ({ ...item, kind: t('common.truck'), icon: 'truck' })),
      ]
    : []

  const go = (link) => {
    setResults(null)
    setQuery('')
    navigate(link)
  }

  const openNotification = async (item) => {
    if (!item.is_read) {
      try {
        await markNotificationRead(item.id)
        setNotifications((prev) =>
          prev.map((entry) => (entry.id === item.id ? { ...entry, is_read: true } : entry))
        )
      } catch {
        // Keep the notification if it could not be marked as read.
      }
    }
    setNotifOpen(false)
    if (item.link) navigate(item.link)
  }

  const readAll = async () => {
    try {
      await markAllNotificationsRead()
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })))
    } catch {
      // Ignore failures, the next fetch will retry.
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="sa-shell">
      <div
        className={`sa-sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sa-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sa-sidebar-head">
          <NavLink to="/dashboard" className="sa-brand-link" aria-label={t('brand')}>
            <BrandLogo />
          </NavLink>
          <button
            type="button"
            className="sa-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('shell.closeMenu')}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="sa-nav" aria-label={t('nav.workspace')}>
          <p className="sa-nav-label">{t('nav.workspace')}</p>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `sa-nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="sa-nav-icon"><Icon name={item.icon} size={19} /></span>
              <span>{t(item.label)}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sa-sidebar-foot">
          <div className="sa-profile-chip">
            <span className="sa-avatar">{initials || 'SA'}</span>
            <span className="sa-profile-meta">
              <strong>{pick(user, 'full_name', t('shell.defaultUser'))}</strong>
              <small>{roleLabel(role)}</small>
            </span>
          </div>
          <button type="button" className="sa-logout" onClick={handleLogout}>
            <Icon name="logout" size={18} />
            {t('logout')}
          </button>
        </div>
      </aside>

      <div className="sa-main">
        <header className="sa-topbar">
          <div className="sa-topbar-left">
            <button
              type="button"
              className="sa-menu-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label={t('shell.openMenu')}
            >
              <Icon name="menu" size={20} />
            </button>
            <div className="sa-page-heading">
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
          </div>

          <div className="sa-topbar-actions">
            <div className="sa-search" ref={searchRef}>
              <span className="sa-search-icon"><Icon name="search" size={17} /></span>
              <input
                type="search"
                value={query}
                placeholder={t('shell.searchPlaceholder')}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => query.trim().length >= 2 && setResults(results)}
                aria-label={t('common.search')}
              />
              {query && (
                <button
                  type="button"
                  className="sa-search-clear"
                  onClick={() => { setQuery(''); setResults(null) }}
                  aria-label={t('shell.clearSearch')}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
              {query.trim().length >= 2 && (
                <div className="sa-search-panel">
                  {searching && <p className="sa-search-state">{t('shell.searching')}</p>}
                  {!searching && suggestions.length === 0 && (
                    <p className="sa-search-state">{t('shell.noMatches')}</p>
                  )}
                  {!searching && suggestions.map((item) => (
                    <button
                      type="button"
                      key={`${item.kind}-${item.id}`}
                      className="sa-search-result"
                      onClick={() => go(item.link)}
                    >
                      <span className="sa-search-kind"><Icon name={item.icon} size={16} /></span>
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.kind}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="sa-lang"><LanguageSelector compact /></div>

            <div className="sa-notif" ref={notifRef}>
              <button
                type="button"
                className="sa-icon-btn sa-bell"
                onClick={() => {
                  setNotifOpen((value) => !value)
                  getNotifications({ limit: 12 }).then(setNotifications).catch(() => {})
                }}
                aria-label={t('shell.notifications')}
                aria-expanded={notifOpen}
              >
                <Icon name="bell" size={20} />
                {unread > 0 && <span className="sa-bell-dot">{unread > 9 ? '9+' : unread}</span>}
              </button>
              {notifOpen && (
                <div className="sa-notif-panel">
                  <div className="sa-notif-head">
                    <div>
                      <strong>{t('shell.notifications')}</strong>
                      <small>{t('shell.unread', [unread])}</small>
                    </div>
                    {unread > 0 && (
                      <button type="button" onClick={readAll}>{t('shell.markAllRead')}</button>
                    )}
                  </div>
                  <div className="sa-notif-list">
                    {notifications.length === 0 && (
                      <p className="sa-search-state">{t('shell.noNotifications')}</p>
                    )}
                    {notifications.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={`sa-notif-item ${item.is_read ? '' : 'unread'}`}
                        onClick={() => openNotification(item)}
                      >
                        <span className="sa-notif-dot" />
                        <span>
                          <strong>{item.title}</strong>
                          <p>{item.message}</p>
                          <small>{timeAgo(item.created_at, t, role === 'truck_operator')}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <NavLink to="/profile" className="sa-user" title={t('shell.openProfile')}>
              <span className="sa-avatar">{initials || 'SA'}</span>
              <span className="sa-user-meta">
                <strong>{pick(user, 'full_name', t('shell.defaultUser'))}</strong>
                <small>{roleLabel(role)}</small>
              </span>
              <Icon name="chevronDown" size={15} />
            </NavLink>
          </div>
        </header>

        <main className="sa-content"><LiveShareBar />{children}</main>

        <footer className="sa-footer">
          <span>{t('brand')} {t('appTagline')}</span>
          <span>{t('shell.footer')}</span>
        </footer>
      </div>
    </div>
  )
}
