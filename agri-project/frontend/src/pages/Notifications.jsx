import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icons'
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/operationsService'
import { useLanguage } from '../context/LanguageContext'
import './Bookings.css'
import './Driver.css'
import { formatIndiaDate, formatIndiaDateTime, getIndiaDateTimestamp } from '../utils/dateTime'

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

export default function Notifications() {
  const { isTruckOperator } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('all')
  const [busyId, setBusyId] = useState(null)

  const load = () => {
    setLoading(true)
    setError('')
    getNotifications({ limit: 100 })
      .then(setItems)
      .catch((err) => setError(err.response?.data?.detail || t('notif.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  const unread = items.filter((item) => !item.is_read).length
  const visible = useMemo(
    () => (tab === 'unread' ? items.filter((item) => !item.is_read) : items),
    [items, tab]
  )

  const openItem = async (item) => {
    if (!item.is_read) {
      setBusyId(item.id)
      try {
        const updated = await markNotificationRead(item.id)
        setItems((prev) => prev.map((entry) => (entry.id === item.id ? updated : entry)))
      } catch {
        setError(t('notif.updateError'))
      } finally {
        setBusyId(null)
      }
    }
    if (item.link) navigate(item.link)
  }

  const markAll = async () => {
    try {
      await markAllNotificationsRead()
      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })))
      setNotice(t('notif.allRead'))
    } catch {
      setError(t('notif.updateError'))
    }
  }

  return (
    <div className="ui-page driver-page">
      <div className="ui-toolbar">
        <div>
          <h2>{t('notif.title')}</h2>
          <p>{t('notif.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <button type="button" className="ui-btn ui-btn-outline" onClick={load}>
            <Icon name="refresh" size={14} /> {t('notif.refresh')}
          </button>
          {unread > 0 && (
            <button type="button" className="ui-btn ui-btn-primary" onClick={markAll}>
              <Icon name="check" size={14} /> {t('notif.markAll')}
            </button>
          )}
        </div>
      </div>

      {notice && <div className="ui-alert ui-alert-success">{notice}</div>}
      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      <div className="ui-card">
        <div className="bookings-tabs">
          <button type="button" className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
            {t('notif.all')} ({items.length})
          </button>
          <button type="button" className={tab === 'unread' ? 'active' : ''} onClick={() => setTab('unread')}>
            {t('notif.unreadOnly')} ({unread})
          </button>
        </div>
        <div className="ui-card-body">
          {loading ? (
            <div className="ui-loading"><span className="ui-spinner" />{t('notif.loading')}</div>
          ) : visible.length === 0 ? (
            <div className="ui-empty">
              <span className="ui-empty-icon"><Icon name="bell" size={22} /></span>
              <strong>{tab === 'unread' ? t('notif.emptyUnread') : t('notif.none')}</strong>
              <p>{tab === 'unread' ? t('notif.emptyUnreadSub') : t('notif.noneSub')}</p>
            </div>
          ) : (
            <div className="notif-list">
              {visible.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`notif-item ${item.is_read ? '' : 'unread'}`}
                  disabled={busyId === item.id}
                  onClick={() => openItem(item)}
                >
                  <span className="notif-icon"><Icon name="bell" size={17} /></span>
                  <span className="notif-main">
                    <strong>{item.title}</strong>
                    <p>{item.message}</p>
                    <small>{timeAgo(item.created_at, t, isTruckOperator)}</small>
                  </span>
                  <span className={`notif-state ${item.is_read ? 'read' : ''}`}>
                    {item.is_read ? t('notif.read') : t('notif.open')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="notif-summary">
        <span><Icon name="bell" size={14} /> {t('notif.totalCount', [items.length])}</span>
        <span><Icon name="info" size={14} /> {t('notif.unreadCount', [unread])}</span>
      </div>
    </div>
  )
}
