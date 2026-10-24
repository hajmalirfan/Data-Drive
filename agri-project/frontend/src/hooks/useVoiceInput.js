import { useCallback, useEffect, useRef, useState } from 'react'

export const MAX_RECORD_SECONDS = 60
const TARGET_RATE = 16000

// Encode mono Float32 PCM as a 16-bit WAV file (format every speech model accepts).
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (offset, text) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  write(36, 'data'); view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => {
    const s = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  })
  return new Blob([view], { type: 'audio/wav' })
}

// Decode whatever the browser recorded (webm/ogg/mp4) and downsample to 16 kHz mono WAV.
async function toWav(blob) {
  const raw = await blob.arrayBuffer()
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const ctx = new AudioCtx()
  try {
    const decoded = await ctx.decodeAudioData(raw)
    const frames = Math.ceil(decoded.duration * TARGET_RATE)
    const offline = new OfflineAudioContext(1, frames, TARGET_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return encodeWav(rendered.getChannelData(0), TARGET_RATE)
  } finally {
    ctx.close()
  }
}

/**
 * Microphone recording for voice input.
 * state: 'idle' | 'recording' | 'processing'
 * onAudio(wavBlob) is awaited while state is 'processing'.
 */
export default function useVoiceInput(onAudio) {
  const [state, setState] = useState('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const cancelledRef = useRef(false)
  const onAudioRef = useRef(onAudio)
  onAudioRef.current = onAudio

  const supported = typeof window !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof window.MediaRecorder !== 'undefined'

  const cleanup = () => {
    clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  useEffect(() => () => { cancelledRef.current = true; recorderRef.current?.state === 'recording' && recorderRef.current.stop(); cleanup() }, [])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    stop()
  }, [stop])

  const start = useCallback(async () => {
    setError('')
    if (!supported) { setError('unsupported'); return }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (err) {
      setError(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'nomic')
      return
    }
    streamRef.current = stream
    cancelledRef.current = false
    const chunks = []
    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    recorder.onstop = async () => {
      cleanup()
      if (cancelledRef.current || !chunks.length) { setState('idle'); return }
      setState('processing')
      try {
        const wav = await toWav(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        await onAudioRef.current(wav)
      } catch (err) {
        setError(err?.message || 'failed')
      } finally {
        setState('idle')
      }
    }
    recorder.start(250)
    setSeconds(0)
    setState('recording')
    const startedAt = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setSeconds(elapsed)
      if (elapsed >= MAX_RECORD_SECONDS) recorder.state === 'recording' && recorder.stop()
    }, 250)
  }, [supported])

  return { state, seconds, error, setError, supported, start, stop, cancel }
}
