import { VOICE_PERSONAS } from '../data/moraData'
import type { VoicePersonaId } from '../types/mora'

let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (Ctx) audioCtx = new Ctx()
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

export function playCyberSfx(type: 'click' | 'alert' | 'levelup' | 'trigger' | 'alarm' | 'shutter') {
  const ctx = getAudioCtx()
  if (!ctx) return
  const now = ctx.currentTime

  const tone = (freq: number, dur: number, delay = 0, oscType: OscillatorType = 'sine', gainVal = 0.08) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = oscType
    osc.frequency.setValueAtTime(freq, now + delay)
    gain.gain.setValueAtTime(0.001, now + delay)
    gain.gain.exponentialRampToValueAtTime(gainVal, now + delay + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now + delay)
    osc.stop(now + delay + dur + 0.02)
  }

  switch (type) {
    case 'click':
      tone(920, 0.06, 0, 'triangle', 0.05)
      tone(1320, 0.05, 0.03, 'sine', 0.04)
      break
    case 'trigger':
      tone(580, 0.07, 0, 'sawtooth', 0.06)
      tone(1180, 0.1, 0.04, 'triangle', 0.07)
      break
    case 'alert':
      tone(660, 0.12, 0, 'square', 0.05)
      tone(880, 0.14, 0.13, 'square', 0.06)
      break
    case 'levelup':
      tone(523.25, 0.11, 0, 'triangle', 0.07)
      tone(659.25, 0.11, 0.09, 'triangle', 0.07)
      tone(783.99, 0.14, 0.18, 'triangle', 0.08)
      tone(1046.5, 0.24, 0.28, 'sine', 0.09)
      break
    case 'shutter':
      tone(1400, 0.04, 0, 'square', 0.06)
      tone(420, 0.07, 0.04, 'triangle', 0.05)
      break
    case 'alarm':
      tone(880, 0.18, 0, 'triangle', 0.1)
      tone(1174, 0.18, 0.2, 'triangle', 0.1)
      tone(880, 0.18, 0.42, 'triangle', 0.1)
      tone(1318, 0.26, 0.64, 'sine', 0.11)
      break
  }
}

function cleanSpeechText(raw: string): string {
  // Unlike the real RedMagic bug that reads "~" out loud as "tilde", clean symbols gracefully!
  return raw
    .replace(/~+/g, '')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function speakAsMora(
  text: string,
  options: {
    muted: boolean
    persona: VoicePersonaId
    onStart?: () => void
    onEnd?: () => void
  },
) {
  if (options.muted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return
  }

  const cleaned = cleanSpeechText(text)
  if (!cleaned) return

  try {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(cleaned)
    const p = VOICE_PERSONAS[options.persona] || VOICE_PERSONAS['mora-warm']
    utter.pitch = p.pitch
    utter.rate = p.rate
    utter.volume = 0.95

    const voices = window.speechSynthesis.getVoices()
    const preferred =
      voices.find((v) => /female|samantha|victoria|karen|zira|aria|jenny|nanami|google us english/i.test(v.name) && /en/i.test(v.lang)) ||
      voices.find((v) => /en/i.test(v.lang))
    if (preferred) utter.voice = preferred

    utter.onstart = () => options.onStart?.()
    utter.onend = () => options.onEnd?.()
    utter.onerror = () => options.onEnd?.()

    window.speechSynthesis.speak(utter)
  } catch {
    options.onEnd?.()
  }
}

export function startVoiceRecognition(
  onResult: (transcript: string) => void,
  onError?: (err: string) => void,
): (() => void) | null {
  if (typeof window === 'undefined') return null
  const SR =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition

  if (!SR) {
    onError?.('Speech recognition is not supported in this browser.')
    return null
  }

  const rec = new SR()
  rec.lang = 'en-US'
  rec.interimResults = false
  rec.maxAlternatives = 1
  rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
    const t = e.results?.[0]?.[0]?.transcript
    if (t) onResult(t)
  }
  rec.onerror = (e: { error?: string }) => {
    onError?.(e.error || 'Mic capture failed')
  }
  rec.start()
  return () => {
    try {
      rec.stop()
    } catch {
      // ignore
    }
  }
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start: () => void
  stop: () => void
}
