import Icon from './Icons'

export default function BrandLogo({ light = false, compact = false }) {
  return (
    <div className={`sa-brand ${light ? 'sa-brand-light' : ''} ${compact ? 'sa-brand-compact' : ''}`}>
      <span className="sa-brand-mark">
        <Icon name="leaf" size={22} strokeWidth={1.9} />
      </span>
      <span className="sa-brand-text">
        <strong>SmartAg</strong>
        {!compact && <span>Ops Advisor</span>}
      </span>
    </div>
  )
}
