import { useEffect } from 'react'
import Icon from './Icons'
import { useLanguage } from '../context/LanguageContext'

export default function Modal({ title, subtitle, onClose, children, footer, size = 'md' }) {
  const { t, statusLabel, roleLabel } = useLanguage()
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="ui-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={`ui-modal ui-modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="ui-modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="ui-icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}
