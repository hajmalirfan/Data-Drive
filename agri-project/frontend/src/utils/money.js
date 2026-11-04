// Rupee amounts with Indian digit grouping (1,23,456). Blank values show as a dash.
export function rupees(value, { symbol = 'Rs ', minDecimals = 0, maxDecimals = 0 } = {}) {
  if (value === null || value === undefined || value === '') return '—'
  const digits = Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: Math.max(minDecimals, maxDecimals),
  })
  return `${symbol}${digits}`
}
