import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { updateBookingLocation } from '../services/operationsService'

// The truck operator's phone sends one GPS fix to the farmer every SEND_EVERY_MS while sharing.
export const SEND_EVERY_MS = 15000
const STORAGE_KEY = 'liveShareBookingId'
// A watched fix older than this is refreshed with a one-off reading before sending.
const MAX_FIX_AGE_MS = 20000

const LiveShareContext = createContext(null)

const readStoredId = () => {
  try { return Number(localStorage.getItem(STORAGE_KEY)) || null } catch { return null }
}
const storeId = (id) => {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, String(id))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage blocked: sharing still runs for this tab */ }
}

const currentPosition = () => new Promise((resolve, reject) => {
  navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 })
})

/**
 * Keeps location sharing running while the operator moves around the app (and resumes it after a
 * reload), instead of tying it to one page. Stops only when the operator stops it, the trip ends
 * or the server refuses the update.
 */
export function LiveShareProvider({ children }) {
  const { isAuth, role, isTruckOperator, isAdmin } = useAuth()
  const canShare = isTruckOperator || isAdmin
  // Resume after a reload; the role may still be loading, so only drop it once the role is known.
  const [bookingId, setBookingId] = useState(readStoredId)
  const [lastSentAt, setLastSentAt] = useState(null)
  const [lastFix, setLastFix] = useState(null)
  const [sentCount, setSentCount] = useState(0)
  const [error, setError] = useState('')
  const [stoppedReason, setStoppedReason] = useState('')
  const latest = useRef(null)
  const inFlight = useRef(false)

  const end = useCallback((reason = '') => {
    storeId(null)
    setBookingId(null)
    setStoppedReason(reason)
  }, [])

  useEffect(() => {
    if (bookingId && (!isAuth || (role && !canShare))) end()
  }, [isAuth, role, canShare]) // eslint-disable-line

  useEffect(() => {
    if (!bookingId || !canShare) return undefined
    if (!navigator.geolocation) { setError('geoUnavailable'); end('geoUnavailable'); return undefined }
    let cancelled = false
    let wakeLock = null
    latest.current = null
    setSentCount(0)

    // Keep the freshest fix as the phone moves; the timer below decides when to send.
    const watchId = navigator.geolocation.watchPosition(
      (position) => { latest.current = position },
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) { setError('geoPermissionDenied'); end('geoPermissionDenied') }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )

    const send = async () => {
      if (cancelled || inFlight.current) return
      inFlight.current = true
      try {
        let position = latest.current
        if (!position || Date.now() - position.timestamp > MAX_FIX_AGE_MS) {
          position = await currentPosition().catch(() => latest.current)
        }
        if (cancelled) return
        if (!position) { setError('geoError'); return }
        const { latitude, longitude, accuracy } = position.coords
        await updateBookingLocation(bookingId, {
          lat: latitude,
          lng: longitude,
          accuracy_m: Number.isFinite(accuracy) ? accuracy : null,
          location: 'Live GPS',
          consent: true,
        })
        if (cancelled) return
        setLastFix({ lat: latitude, lng: longitude, accuracy })
        setLastSentAt(Date.now())
        setSentCount((count) => count + 1)
        setError('')
      } catch (err) {
        if (cancelled) return
        const status = err.response?.status
        // Trip finished, not allowed or signed out: stop instead of retrying forever.
        if ([400, 401, 403, 404].includes(status)) { setError(''); end(err.response?.data?.detail || 'stopped') }
        else setError('sendFailed')
      } finally {
        inFlight.current = false
      }
    }

    // Phones throttle timers when the screen sleeps; a wake lock keeps the 15 s cadence.
    const lockScreen = async () => {
      try { if (document.visibilityState === 'visible') wakeLock = await navigator.wakeLock?.request('screen') } catch { /* optional */ }
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      lockScreen()
      send() // catch up straight away after the tab was in the background
    }

    send()
    const timer = setInterval(send, SEND_EVERY_MS)
    lockScreen()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      navigator.geolocation.clearWatch(watchId)
      document.removeEventListener('visibilitychange', onVisible)
      wakeLock?.release?.().catch(() => {})
    }
  }, [bookingId, canShare, end])

  const start = useCallback((id) => {
    setError('')
    setStoppedReason('')
    setLastSentAt(null)
    setLastFix(null)
    storeId(id)
    setBookingId(id)
  }, [])

  // Stop sharing and tell the server, which hides the truck and clears its trail for the farmer.
  const stop = useCallback(async () => {
    const id = bookingId
    end()
    setLastSentAt(null)
    if (!id) return null
    return updateBookingLocation(id, { lat: null, lng: null, consent: false })
  }, [bookingId, end])

  return (
    <LiveShareContext.Provider value={{ bookingId, lastSentAt, lastFix, sentCount, error, stoppedReason, start, stop }}>
      {children}
    </LiveShareContext.Provider>
  )
}

export const useLiveShare = () => useContext(LiveShareContext)
