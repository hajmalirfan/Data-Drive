import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useLiveShare } from '../context/LiveShareContext'
import { useLanguage } from '../context/LanguageContext'

// Shown on every page while the operator is sending live GPS, so it is never left running unseen.
export default function LiveShareBar() {
  const { t } = useLanguage()
  const live = useLiveShare()
  const { pathname } = useLocation()
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!live?.bookingId) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [live?.bookingId])

  if (!live?.bookingId) return null
  const seconds = live.lastSentAt ? Math.max(0, Math.round((now - live.lastSentAt) / 1000)) : null
  const errorKey = { sendFailed: 'live.sendFailed', geoError: 'tracking.geoError' }[live.error]

  return (
    <div className={`live-share-bar ${errorKey ? 'has-error' : ''}`} role="status">
      <span className="live-share-dot" aria-hidden="true" />
      <span className="live-share-text">
        <strong>{t('live.sharingBanner')}</strong>
        <small>
          {errorKey ? t(errorKey) : seconds === null ? t('live.waitingFix') : t('live.sentAgo', [seconds])}
          {' · '}{t('live.every15')}
        </small>
      </span>
      {pathname !== '/tracking' && (
        <Link to="/tracking" className="ui-btn ui-btn-outline ui-btn-sm">{t('live.open')}</Link>
      )}
      <button type="button" className="ui-btn ui-btn-sm live-share-stop" onClick={() => live.stop().catch(() => {})}>
        {t('live.stop')}
      </button>
    </div>
  )
}
