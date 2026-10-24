import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import Icon from '../components/Icons'
import LineChart from '../components/LineChart'
import { getAdminOverview } from '../services/adminService'
import './AdminDashboard.css'

const RANGES = [
  { key: '24h', labelKey: 'adminDash.range24h' },
  { key: '7d', labelKey: 'adminDash.range7d' },
  { key: '30d', labelKey: 'adminDash.range30d' },
]

// Validated pair (CVD-safe on white): requests blue, server errors red. Single series use brand green.
const COLORS = { primary: '#2a9d5c', requests: '#2f6fd6', errors: '#d93025' }

const TZ = 'Asia/Kolkata'
const fmt = (options) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...options })
const hourLabel = fmt({ hour: '2-digit', minute: '2-digit', hour12: false })
const dayLabel = fmt({ day: 'numeric', month: 'short' })
const hourTip = fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const dayTip = fmt({ weekday: 'short', day: 'numeric', month: 'short' })

const num = (value) => (value ?? 0).toLocaleString('en-IN')

function StatTile({ label, value, sub, icon, tone = 'green' }) {
  return (
    <div className="adm-tile ui-card">
      <span className={`adm-tile-icon ${tone}`}><Icon name={icon} size={17} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {sub && <span>{sub}</span>}
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const { t, roleLabel } = useLanguage()
  const { user } = useAuth()
  const [range, setRange] = useState('7d')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = (nextRange = range) => {
    setLoading(true)
    setError('')
    getAdminOverview(nextRange)
      .then(setData)
      .catch((err) => setError(err.response?.data?.detail || t('adminDash.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(range) }, [range]) // eslint-disable-line

  const { labels, tips } = useMemo(() => {
    if (!data) return { labels: [], tips: [] }
    const dates = data.buckets.map((iso) => new Date(iso))
    return data.unit === 'hour'
      ? { labels: dates.map((d) => hourLabel.format(d)), tips: dates.map((d) => hourTip.format(d)) }
      : { labels: dates.map((d) => dayLabel.format(d)), tips: dates.map((d) => dayTip.format(d)) }
  }, [data])

  const roles = data ? Object.entries(data.users.by_role).sort((a, b) => b[1] - a[1]) : []
  const roleMax = Math.max(1, ...roles.map(([, count]) => count))
  const rangeName = t(RANGES.find((item) => item.key === range).labelKey).toLowerCase()
  const req = data?.requests
  const errorRate = req?.total ? ((req.total_server_errors / req.total) * 100).toFixed(1) : '0.0'

  return (
    <div className="ui-page adm">
      <div className="ui-toolbar">
        <div>
          <h2>{t('adminDash.title', [user?.full_name?.split(' ')[0] || 'Admin'])}</h2>
          <p>{t('adminDash.subtitle')}</p>
        </div>
        <div className="ui-toolbar-actions">
          <Link to="/admin" className="ui-btn ui-btn-outline"><Icon name="shield" size={14} />{t('adminDash.manageUsers')}</Link>
        </div>
      </div>

      <div className="adm-filters" role="group" aria-label={t('adminDash.rangeLabel')}>
        {RANGES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`adm-range ${range === item.key ? 'active' : ''}`}
            aria-pressed={range === item.key}
            onClick={() => setRange(item.key)}
          >
            {range === item.key && <Icon name="check" size={13} />}{t(item.labelKey)}
          </button>
        ))}
        <button type="button" className="adm-refresh" onClick={() => load()} disabled={loading} aria-label={t('common.refresh')}>
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {error && <div className="ui-alert ui-alert-error">{error}</div>}

      {!data ? (
        <div className="ui-loading"><span className="ui-spinner" />{t('common.loading')}</div>
      ) : (
        <div className={`adm-body ${loading ? 'is-loading' : ''}`}>
          {/* Users */}
          <section className="adm-users">
            <div className="adm-hero ui-card">
              <small>{t('adminDash.totalUsers')}</small>
              <strong>{num(data.users.total)}</strong>
              <span>{t('adminDash.newUsers', [num(data.users.new_in_range), rangeName])}</span>
            </div>
            <StatTile label={roleLabel('farmer')} value={num(data.users.by_role.farmer)} icon="crops" />
            <StatTile label={roleLabel('truck_operator')} value={num(data.users.by_role.truck_operator)} icon="truck" tone="blue" />
            <StatTile label={t('adminDash.aiActiveUsers')} value={num(data.ai.active_users)} sub={rangeName} icon="chat" tone="purple" />
          </section>

          <div className="adm-grid">
            <section className="ui-card adm-card">
              <div className="ui-card-head">
                <div>
                  <h3><Icon name="profile" size={16} />{t('adminDash.usersByRole')}</h3>
                  <p>{t('adminDash.usersByRoleSub')}</p>
                </div>
              </div>
              <div className="ui-card-body">
                <ul className="adm-bars">
                  {roles.map(([role, count]) => (
                    <li key={role} title={`${roleLabel(role)}: ${count}`}>
                      <span className="adm-bar-label">{roleLabel(role)}</span>
                      <span className="adm-bar-track">
                        <span className="adm-bar" style={{ width: `${(count / roleMax) * 100}%`, background: COLORS.primary }} />
                        <b>{num(count)}</b>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="ui-card adm-card">
              <div className="ui-card-head">
                <div>
                  <h3><Icon name="chat" size={16} />{t('adminDash.aiUsage')}</h3>
                  <p>{t('adminDash.aiUsageSub')}</p>
                </div>
              </div>
              <div className="ui-card-body">
                <div className="adm-mini-stats">
                  <div><small>{t('adminDash.aiQuestions')}</small><strong>{num(data.ai.total_questions)}</strong></div>
                  <div><small>{t('adminDash.aiReplies')}</small><strong>{num(data.ai.replies)}</strong></div>
                  <div><small>{t('adminDash.aiConversations')}</small><strong>{num(data.ai.conversations)}</strong></div>
                </div>
                <LineChart
                  labels={labels}
                  tooltipLabels={tips}
                  series={[{ key: 'questions', label: t('adminDash.aiQuestions'), color: COLORS.primary, values: data.ai.questions }]}
                  ariaLabel={t('adminDash.aiUsage')}
                />
                {data.ai.total_questions === 0 && <p className="adm-empty-note">{t('adminDash.aiEmpty')}</p>}
              </div>
            </section>
          </div>

          <section className="ui-card adm-card">
            <div className="ui-card-head">
              <div>
                <h3><Icon name="reports" size={16} />{t('adminDash.requests')}</h3>
                <p>{t('adminDash.requestsSub')}</p>
              </div>
            </div>
            <div className="ui-card-body">
              <div className="adm-mini-stats four">
                <div><small>{t('adminDash.reqTotal')}</small><strong>{num(req.total)}</strong></div>
                <div><small>{t('adminDash.reqAvg')}</small><strong>{req.avg_ms == null ? '—' : `${num(Math.round(req.avg_ms))} ms`}</strong></div>
                <div><small>{t('adminDash.reqServerErrors')}</small><strong>{num(req.total_server_errors)}<em>{errorRate}%</em></strong></div>
                <div><small>{t('adminDash.reqClientErrors')}</small><strong>{num(req.total_client_errors)}</strong></div>
              </div>
              <LineChart
                labels={labels}
                tooltipLabels={tips}
                height={240}
                series={[
                  { key: 'requests', label: t('adminDash.reqSeries'), color: COLORS.requests, values: req.requests },
                  { key: 'errors', label: t('adminDash.reqErrorSeries'), color: COLORS.errors, values: req.server_errors },
                ]}
                ariaLabel={t('adminDash.requests')}
              />
              <p className="adm-empty-note">{t('adminDash.requestsNote')}</p>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
