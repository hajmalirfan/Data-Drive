import { useEffect, useMemo, useRef, useState } from 'react'

const MARGIN = { top: 14, right: 64, bottom: 26, left: 40 }

const compact = (value) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return String(Math.round(value))
}

// Clean y ticks: 0 .. a 1/2/5 × 10^k step, about four intervals.
function niceTicks(max) {
  if (max <= 0) return [0, 1]
  const rough = max / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough)
  const ticks = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

/**
 * Responsive SVG line chart with a crosshair tooltip and a table view.
 * series: [{ key, label, color, values: number[] }] sharing one y-axis (same unit).
 */
export default function LineChart({ labels, tooltipLabels, series, height = 220, ariaLabel, valueSuffix = '' }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const count = labels.length
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const innerH = height - MARGIN.top - MARGIN.bottom
  const ticks = useMemo(() => niceTicks(Math.max(0, ...series.flatMap((s) => s.values))), [series])
  const yMax = ticks[ticks.length - 1]
  const x = (i) => MARGIN.left + (count <= 1 ? innerW / 2 : (i / (count - 1)) * innerW)
  const y = (v) => MARGIN.top + innerH - (v / yMax) * innerH

  const labelEvery = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(innerW / 64))))
  const single = series.length === 1

  const pointerMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left - MARGIN.left
    setHover(Math.max(0, Math.min(count - 1, Math.round((px / innerW) * (count - 1)))))
  }

  const keyDown = (event) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); setHover((h) => Math.min(count - 1, (h ?? -1) + 1)) }
    if (event.key === 'ArrowLeft') { event.preventDefault(); setHover((h) => Math.max(0, (h ?? count) - 1)) }
    if (event.key === 'Escape') setHover(null)
  }

  // End labels: nudge apart only by drawing them at the line end; skip if two would overlap.
  const endLabels = series.map((s) => ({ ...s, y: y(s.values[count - 1] ?? 0) }))
  const endsCollide = endLabels.length > 1 && Math.abs(endLabels[0].y - endLabels[1].y) < 14

  const tooltipLeft = hover === null ? 0 : x(hover)
  const flip = tooltipLeft > width - 170

  return (
    <div className="lc">
      {!single && (
        <div className="lc-legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
      )}

      <div
        ref={wrapRef}
        className="lc-plot"
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        onKeyDown={keyDown}
        onBlur={() => setHover(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} onPointerMove={pointerMove} onPointerLeave={() => setHover(null)}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={y(tick)} y2={y(tick)} className="lc-grid" />
                <text x={MARGIN.left - 8} y={y(tick)} className="lc-axis" textAnchor="end" dominantBaseline="middle">
                  {compact(tick)}
                </text>
              </g>
            ))}
            {labels.map((label, i) => (i % labelEvery === 0 || i === count - 1) && (
              (i === count - 1 || count - 1 - i >= labelEvery / 2) && (
                <text key={i} x={x(i)} y={height - 6} className="lc-axis" textAnchor="middle">{label}</text>
              )
            ))}

            {series.map((s) => {
              const points = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
              return (
                <g key={s.key}>
                  {single && (
                    <polygon
                      points={`${x(0)},${y(0)} ${points} ${x(count - 1)},${y(0)}`}
                      fill={s.color}
                      opacity="0.1"
                    />
                  )}
                  <polyline points={points} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  <circle cx={x(count - 1)} cy={y(s.values[count - 1] ?? 0)} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />
                </g>
              )
            })}

            {endLabels.map((s, index) => (!endsCollide || index === 0) && (
              <text key={s.key} x={x(count - 1) + 9} y={s.y} className="lc-end" dominantBaseline="middle">
                {compact(s.values[count - 1] ?? 0)}{valueSuffix}
              </text>
            ))}

            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={MARGIN.top + innerH} className="lc-cross" />
                {series.map((s) => (
                  <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4.5" fill={s.color} stroke="#fff" strokeWidth="2" />
                ))}
              </g>
            )}
          </svg>
        )}

        {hover !== null && (
          <div
            className="lc-tip"
            style={{ left: flip ? undefined : tooltipLeft + 12, right: flip ? width - tooltipLeft + 12 : undefined }}
            role="status"
          >
            <small>{(tooltipLabels || labels)[hover]}</small>
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                <strong>{(s.values[hover] ?? 0).toLocaleString('en-IN')}{valueSuffix}</strong>
                <em>{s.label}</em>
              </span>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="lc-table-toggle" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
        {showTable ? 'Hide table' : 'View as table'}
      </button>
      {showTable && (
        <div className="lc-table-wrap">
          <table className="lc-table">
            <thead>
              <tr><th>Period</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr>
            </thead>
            <tbody>
              {labels.map((label, i) => (
                <tr key={i}>
                  <td>{(tooltipLabels || labels)[i]}</td>
                  {series.map((s) => <td key={s.key}>{(s.values[i] ?? 0).toLocaleString('en-IN')}{valueSuffix}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
