const INDIA_TIME_ZONE = 'Asia/Kolkata'

function parseDate(value) {
  if (value instanceof Date) return value
  if (typeof value !== 'string') return new Date(value)

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00Z`)
  }

  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  return new Date(hasTimeZone ? value : `${value}Z`)
}

export function formatIndiaDate(value, options = {}) {
  return parseDate(value).toLocaleDateString('en-IN', {
    ...options,
    timeZone: INDIA_TIME_ZONE,
  })
}

export function formatIndiaDateTime(value, options = {}) {
  return parseDate(value).toLocaleString('en-IN', {
    ...options,
    timeZone: INDIA_TIME_ZONE,
  })
}

export function getIndiaHour() {
  const hour = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date()).find((part) => part.type === 'hour')

  return Number(hour.value)
}

export function getIndiaDateTimeLocal(daysFromNow = 0, hour = 8, minute = 0) {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const date = new Date(Date.UTC(
    Number(dateParts.year),
    Number(dateParts.month) - 1,
    Number(dateParts.day) + daysFromNow,
    hour,
    minute,
  ))

  return date.toISOString().slice(0, 16)
}

export function getIndiaDateTimestamp(value) {
  return parseDate(value).getTime()
}
