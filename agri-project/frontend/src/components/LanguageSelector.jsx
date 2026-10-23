import { useLanguage } from '../context/LanguageContext'
import Icon from './Icons'
import './LanguageSelector.css'

export default function LanguageSelector({ compact = false }) {
  const { lang, setLang, languages, t } = useLanguage()

  return (
    <label className={`lang-select ${compact ? 'is-compact' : ''}`} title={t('language')}>
      <span className="lang-globe" aria-hidden="true"><Icon name="globe" size={15} /></span>
      {!compact && <span className="lang-label">{t('language')}</span>}
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        aria-label={t('language')}
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native} ({l.label})
          </option>
        ))}
      </select>
    </label>
  )
}
