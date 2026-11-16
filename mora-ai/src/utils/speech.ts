import type { VoicePersona } from '../types/mora'
import { isAndroidNative, nativeSpeak, nativeStopSpeech } from './miraNative'

export interface SpeakOptions {
  muted?: boolean
  persona?: VoicePersona
  rate?: number
  pitch?: number
  lang?: string
  geminiApiKey?: string
  geminiVoice?: string
  useGeminiVoice?: boolean
  onStart?: () => void
  onEnd?: () => void
}

let activeAudioCtx: AudioContext | null = null
let activeSource: AudioBufferSourceNode | null = null

export function stopSpeaking() {
  if (isAndroidNative()) {
    void nativeStopSpeech()
  }
  if (activeSource) {
    try {
      activeSource.stop()
    } catch {
      // ignore
    }
    activeSource = null
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

async function speakWithGeminiWeb(
  text: string,
  apiKey: string,
  voiceName: string,
  onStart?: () => void,
  onEnd?: () => void,
): Promise<boolean> {
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(apiKey.trim())}`
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      }),
    })
    if (!res.ok) return false
    const json = await res.json()
    const b64: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    if (!b64) return false

    const bin = atob(b64)
    const sampleCount = Math.floor(bin.length / 2)
    const float32 = new Float32Array(sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      const lo = bin.charCodeAt(i * 2)
      const hi = bin.charCodeAt(i * 2 + 1)
      let sample = (hi << 8) | lo
      if (sample >= 0x8000) sample -= 0x10000
      float32[i] = sample / 32768
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!activeAudioCtx) activeAudioCtx = new AudioCtx({ sampleRate: 24000 })
    if (activeAudioCtx.state === 'suspended') await activeAudioCtx.resume()

    const buffer = activeAudioCtx.createBuffer(1, sampleCount, 24000)
    buffer.copyToChannel(float32, 0)
    const src = activeAudioCtx.createBufferSource()
    src.buffer = buffer
    src.connect(activeAudioCtx.destination)
    activeSource = src
    onStart?.()
    src.onended = () => {
      activeSource = null
      onEnd?.()
    }
    src.start()
    return true
  } catch {
    return false
  }
}

export function speakText(text: string, opts: SpeakOptions = {}): boolean {
  if (opts.muted) {
    opts.onEnd?.()
    return false
  }
  const cleanText = text.replace(/[*_`~#]/g, '').trim()
  if (!cleanText) {
    opts.onEnd?.()
    return false
  }

  stopSpeaking()

  // 1. Inside Android APK: always use MiraVoiceEngine (Gemini Female TTS + hi-IN female TTS fallback)
  if (isAndroidNative()) {
    opts.onStart?.()
    void nativeSpeak(cleanText).finally(() => {
      opts.onEnd?.()
    })
    return true
  }

  // 2. Web browser with Gemini Female Voice enabled
  if (opts.useGeminiVoice !== false && opts.geminiApiKey && opts.geminiApiKey.trim().length > 10) {
    void speakWithGeminiWeb(
      cleanText,
      opts.geminiApiKey,
      opts.geminiVoice || 'Aoede',
      opts.onStart,
      opts.onEnd,
    ).then((ok) => {
      if (!ok) speakWebSpeechFallback(cleanText, opts)
    })
    return true
  }

  return speakWebSpeechFallback(cleanText, opts)
}

export function speakAsMora(text: string, opts: SpeakOptions = {}): boolean {
  const personaPitch =
    opts.persona === 'cheerful' ? 1.25 : opts.persona === 'tactical' ? 1.08 : 1.18
  return speakText(text, { ...opts, pitch: opts.pitch ?? personaPitch })
}

function speakWebSpeechFallback(cleanText: string, opts: SpeakOptions): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    opts.onEnd?.()
    return false
  }
  const utterance = new SpeechSynthesisUtterance(cleanText)
  utterance.rate = opts.rate ?? 1.0
  utterance.pitch = opts.pitch ?? 1.18
  const targetLang = opts.lang || (/[\u0900-\u097F]/.test(cleanText) ? 'hi-IN' : 'en-IN')
  utterance.lang = targetLang

  const voices = window.speechSynthesis.getVoices()
  const preferred =
    voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith(targetLang.split('-')[0].toLowerCase()) &&
        /female|swara|lekha|kalpana|heera|neerja|aditi|samantha|aria|jenny|google/i.test(v.name),
    ) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.split('-')[0].toLowerCase())) ||
    voices.find((v) => /female|samantha|aria|jenny|zira|karen|google/i.test(v.name))

  if (preferred) utterance.voice = preferred
  utterance.onstart = () => opts.onStart?.()
  utterance.onend = () => opts.onEnd?.()
  utterance.onerror = () => opts.onEnd?.()

  window.speechSynthesis.speak(utterance)
  return true
}

export function playCyberSfx(
  kind: 'click' | 'levelup' | 'alert' | 'shutter' | 'alarm' | 'trigger',
) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!activeAudioCtx) activeAudioCtx = new AudioCtx()
    if (activeAudioCtx.state === 'suspended') void activeAudioCtx.resume()

    const osc = activeAudioCtx.createOscillator()
    const gain = activeAudioCtx.createGain()
    osc.connect(gain)
    gain.connect(activeAudioCtx.destination)

    const now = activeAudioCtx.currentTime
    if (kind === 'levelup') {
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(523, now)
      osc.frequency.exponentialRampToValueAtTime(1046, now + 0.25)
      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
      osc.start(now)
      osc.stop(now + 0.3)
    } else if (kind === 'alert' || kind === 'alarm') {
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(880, now)
      osc.frequency.setValueAtTime(660, now + 0.12)
      gain.gain.setValueAtTime(0.07, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28)
      osc.start(now)
      osc.stop(now + 0.28)
    } else if (kind === 'shutter') {
      osc.type = 'square'
      osc.frequency.setValueAtTime(1200, now)
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.08)
      gain.gain.setValueAtTime(0.05, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)
      osc.start(now)
      osc.stop(now + 0.09)
    } else {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(kind === 'trigger' ? 920 : 720, now)
      osc.frequency.exponentialRampToValueAtTime(480, now + 0.06)
      gain.gain.setValueAtTime(0.05, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07)
      osc.start(now)
      osc.stop(now + 0.07)
    }
  } catch {
    // ignore audio block
  }
}

export function startVoiceRecognition(
  onFinalResult: (transcript: string) => void,
  onError?: (message: string) => void,
  lang = 'hi-IN',
): (() => void) | null {
  const win = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
  const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition
  if (!Ctor) {
    onError?.('Speech recognition unavailable — type your command instead.')
    return null
  }

  const recognition = new Ctor()
  recognition.lang = lang
  recognition.interimResults = false
  recognition.continuous = false
  recognition.maxAlternatives = 1

  recognition.onresult = (event: SpeechRecognitionEventLike) => {
    const result = event.results[event.results.length - 1]
    const transcript = result?.[0]?.transcript?.trim() ?? ''
    if (transcript) onFinalResult(transcript)
  }

  recognition.onerror = (event: { error?: string }) => {
    onError?.(event.error ? `Voice error: ${event.error}` : 'Microphone unavailable')
  }

  try {
    recognition.start()
  } catch {
    onError?.('Microphone permission denied')
    return null
  }

  return () => {
    try {
      recognition.stop()
    } catch {
      // ignore
    }
  }
}

export interface SpeechRecController {
  stop: () => void
  supported: boolean
}

export function startSpeechRecognition(
  onResult: (transcript: string, isFinal: boolean) => void,
  onError: (message: string) => void,
  onEnd: () => void,
  lang = 'hi-IN',
): SpeechRecController {
  const win = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
  const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition
  if (!Ctor) {
    onError('Speech recognition is not supported in this browser — type a message below!')
    onEnd()
    return { stop: () => undefined, supported: false }
  }

  const recognition = new Ctor()
  recognition.lang = lang
  recognition.interimResults = true
  recognition.continuous = false
  recognition.maxAlternatives = 1

  recognition.onresult = (event: SpeechRecognitionEventLike) => {
    const result = event.results[event.results.length - 1]
    if (!result) return
    const transcript = result[0]?.transcript ?? ''
    onResult(transcript, result.isFinal)
  }

  recognition.onerror = (event: { error?: string }) => {
    onError(event.error ? `Voice error: ${event.error}` : 'Microphone unavailable')
  }

  recognition.onend = () => onEnd()

  try {
    recognition.start()
  } catch {
    onError('Could not access microphone — check browser permissions.')
    onEnd()
  }

  return {
    stop: () => {
      try {
        recognition.stop()
      } catch {
        // ignore
      }
    },
    supported: true,
  }
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean
    0?: { transcript: string }
  }>
}

interface SpeechRecognitionInstance {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((ev: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
