import { useEffect, useState } from 'react'
import {
  Accessibility,
  Bot,
  CheckCircle2,
  CircleDot,
  Cpu,
  ExternalLink,
  Flashlight,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Mic,
  Phone,
  Play,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Volume2,
  Wallpaper,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react'
import type { GeminiVoiceName, MoraState } from '../../types/mora'
import {
  isAndroidNative,
  nativeCheckPermissions,
  nativeHideMiniMiraOverlay,
  nativeOpenAssistantSettings,
  nativeRequestAccessibilityPermission,
  nativeRequestOverlayPermission,
  nativeRequestRuntimePermissions,
  nativeRequestWriteSettingsPermission,
  nativeSetLiveWallpaper,
  nativeSetStaticWallpaper,
  nativeShowFloatingOrb,
  nativeShowMiniMiraOverlay,
  nativeStartWakeWordService,
  nativeStopWakeWordService,
  type PermissionsStatus,
} from '../../utils/miraNative'
import { speakText } from '../../utils/speech'

interface JarvisGeminiModalProps {
  state: MoraState
  onUpdate: (patch: Partial<MoraState>) => void
  onExecuteCommand: (command: string) => Promise<void>
  onNotify: (msg: string) => void
}

const GEMINI_FEMALE_VOICES: Array<{ id: GeminiVoiceName; label: string; desc: string }> = [
  { id: 'Aoede', label: 'Aoede (Warm Female)', desc: 'Sweet, expressive Hindi & English female voice' },
  { id: 'Kore', label: 'Kore (Calm Female)', desc: 'Clear, soothing assistant tone' },
  { id: 'Leda', label: 'Leda (Youthful Female)', desc: 'Anime-inspired energetic female tone' },
  { id: 'Zephyr', label: 'Zephyr (Bright Female)', desc: 'Crisp, upbeat conversational voice' },
]

export function JarvisGeminiModal({
  state,
  onUpdate,
  onExecuteCommand,
  onNotify,
}: JarvisGeminiModalProps) {
  const [keyInput, setKeyInput] = useState(state.geminiApiKey)
  const [cmdInput, setCmdInput] = useState('')
  const [testingGemini, setTestingGemini] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [runningCmd, setRunningCmd] = useState(false)
  const [perms, setPerms] = useState<PermissionsStatus | null>(null)

  const refreshPerms = async () => {
    const p = await nativeCheckPermissions()
    if (p) setPerms(p)
  }

  useEffect(() => {
    void refreshPerms()
  }, [])

  const handleToggleWakeWord = async () => {
    const next = !state.wakeWordEnabled
    if (next) {
      if (isAndroidNative()) {
        await nativeRequestRuntimePermissions()
        const res = await nativeStartWakeWordService()
        onNotify(res.message)
      } else {
        onNotify('Wake-word "Hey MIRA" enabled in browser!')
      }
    } else {
      if (isAndroidNative()) await nativeStopWakeWordService()
      onNotify('Background Wake-Word paused.')
    }
    onUpdate({ wakeWordEnabled: next })
    void refreshPerms()
  }

  const handleSummonMiniOverlay = async () => {
    const res = await nativeShowMiniMiraOverlay()
    onNotify(res.message)
  }

  const handleEnableOrb = async () => {
    const res = await nativeShowFloatingOrb()
    onNotify(res.message)
    void refreshPerms()
  }

  const handleCloseMiniOverlay = async () => {
    await nativeHideMiniMiraOverlay()
    onNotify('Mini MIRA & Floating Orb closed!')
    void refreshPerms()
  }

  const handleSaveKey = () => {
    onUpdate({ geminiApiKey: keyInput.trim() })
    onNotify(
      keyInput.trim()
        ? `Saved Gemini Key + ${state.geminiVoice} Female Voice!`
        : 'Using 100% Free Built-in AI + Hindi Female TTS!',
    )
  }

  const handleTestVoice = () => {
    const sample =
      state.voiceLang === 'hi-IN'
        ? `नमस्ते ${state.commanderName}! मैं मीरा हूँ, आपकी 3D पर्सनल असिस्टेंट। अब मैं हिंदी और इंग्लिश दोनों में बात कर सकती हूँ!`
        : `Hello ${state.commanderName}! I am MIRA, your personal 3D assistant, ready to control your phone hands-free!`
    speakText(sample, {
      lang: state.voiceLang,
      geminiApiKey: state.geminiApiKey,
      geminiVoice: state.geminiVoice,
      useGeminiVoice: state.useGeminiVoice,
    })
    onNotify(`Testing ${state.useGeminiVoice && state.geminiApiKey ? `Gemini ${state.geminiVoice}` : state.voiceLang} female voice...`)
  }

  const handleTestGemini = async () => {
    const k = keyInput.trim()
    if (!k) {
      setTestResult('Built-in Free AI is already active (no key required). Paste a Gemini key only if you want Gemini AI + Gemini Female Voice.')
      return
    }
    setTestingGemini(true)
    setTestResult(null)
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(state.geminiModel)}:generateContent?key=${encodeURIComponent(k)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Say "नमस्ते! MIRA Gemini link active!" in 6 words.' }] }],
          }),
        },
      )
      if (!res.ok) {
        const t = await res.text()
        setTestResult(`Error ${res.status}: ${t.slice(0, 120)}`)
      } else {
        const j = await res.json()
        const reply = j?.candidates?.[0]?.content?.parts?.[0]?.text || 'Connected!'
        onUpdate({ geminiApiKey: k })
        setTestResult(`Connected! Gemini says: "${reply.trim()}"`)
      }
    } catch (err) {
      setTestResult(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTestingGemini(false)
    }
  }

  const handleRunCmd = async (cmd: string) => {
    if (!cmd.trim() || runningCmd) return
    setRunningCmd(true)
    try {
      await onExecuteCommand(cmd.trim())
      setCmdInput('')
    } finally {
      setRunningCmd(false)
    }
  }

  const quickCommands = [
    'Next reel',
    'Auto scroll',
    'Stop scroll',
    'Like karo',
    'Open YouTube',
    'Open Instagram',
    'Call Mom',
    'Wi-Fi settings',
    'Volume up',
    state.flashlightOn ? 'Turn off flashlight' : 'Turn on flashlight',
    'Take screenshot',
    'Dance MIRA',
    'Check battery',
  ]

  return (
    <div className="space-y-4">
      {/* 1. MINI MIRA GOOGLE-ASSISTANT OVERLAY, GESTURE ORB & WAKE WORD */}
      <div className="rounded-2xl border border-rose-500/40 bg-gradient-to-br from-rose-950/50 via-slate-900/90 to-cyan-950/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-rose-400" />
            <h3 className="text-sm font-bold text-white">
              &ldquo;Hey MIRA&rdquo; Hands-Free &amp; Floating Orb (Over Reels/Apps)
            </h3>
          </div>
          <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2.5 py-0.5 text-[10px] font-bold text-emerald-200">
            100% FREE · NO APP OPEN NEEDED
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-300">
          Say <strong>&ldquo;Hey MIRA&rdquo;</strong>, press your <strong>Gesture/Assistant Button</strong>, or tap the <strong>Floating MIRA Orb</strong> while scrolling Instagram Reels or YouTube Shorts — Mini MIRA pops right over your video, speaks in Hindi, and scrolls/controls hands-free!
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void handleToggleWakeWord()}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
              state.wakeWordEnabled
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                : 'bg-rose-600 text-white hover:bg-rose-500'
            }`}
          >
            <Mic className="h-4 w-4" />
            {state.wakeWordEnabled ? 'Hey MIRA Wake-Word: ACTIVE' : 'Enable "Hey MIRA" Wake-Word'}
          </button>

          <button
            onClick={() => void handleEnableOrb()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/20 px-3.5 py-2 text-xs font-bold text-fuchsia-100 hover:bg-fuchsia-500/30"
          >
            <CircleDot className="h-4 w-4 text-fuchsia-300" />
            Dock Floating Gesture Orb
          </button>

          <button
            onClick={() => void handleSummonMiniOverlay()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-3.5 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25"
          >
            <Layers className="h-4 w-4" />
            Wake Mini MIRA Now
          </button>

          <button
            onClick={() => void handleCloseMiniOverlay()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-500/25"
          >
            <XCircle className="h-4 w-4" />
            Close Mini MIRA
          </button>

          <button
            onClick={() => onUpdate({ continuousConvoEnabled: !state.continuousConvoEnabled })}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
              state.continuousConvoEnabled
                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-200'
                : 'border-white/15 bg-white/5 text-slate-300'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            Continuous Chat: {state.continuousConvoEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Android Full Phone Control & Gesture Button Setup */}
        <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
              <ShieldCheck className="h-3.5 w-3.5" /> Full Phone &amp; Gesture Setup (Tap to Grant)
            </span>
            <button
              onClick={() => void refreshPerms()}
              className="text-[10px] text-cyan-300 hover:underline"
            >
              Refresh Status
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <button
              onClick={() => void nativeRequestRuntimePermissions().then(refreshPerms)}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] text-slate-200 hover:border-cyan-400/40"
            >
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-cyan-300" /> Mic, Calls &amp; Contacts
              </span>
              <span className={perms?.microphone && perms?.callPhone ? 'text-emerald-300 font-bold' : 'text-amber-300'}>
                {perms ? (perms.microphone && perms.callPhone ? 'GRANTED' : 'TAP TO ALLOW') : 'ANDROID'}
              </span>
            </button>

            <button
              onClick={() => void nativeRequestOverlayPermission().then(refreshPerms)}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] text-slate-200 hover:border-cyan-400/40"
            >
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-rose-300" /> Mini MIRA Overlay (Draw Over Apps)
              </span>
              <span className={perms?.overlay ? 'text-emerald-300 font-bold' : 'text-amber-300'}>
                {perms ? (perms.overlay ? 'GRANTED' : 'TAP TO ALLOW') : 'ANDROID'}
              </span>
            </button>

            <button
              onClick={() => void nativeRequestAccessibilityPermission().then(refreshPerms)}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] text-slate-200 hover:border-cyan-400/40"
            >
              <span className="flex items-center gap-1.5">
                <Accessibility className="h-3.5 w-3.5 text-emerald-300" /> Accessibility (Reels Scroll, Tap, Back)
              </span>
              <span className={perms?.accessibility ? 'text-emerald-300 font-bold' : 'text-amber-300'}>
                {perms ? (perms.accessibility ? 'ACTIVE' : 'ENABLE IN SETTINGS') : 'ANDROID'}
              </span>
            </button>

            <button
              onClick={() => void nativeOpenAssistantSettings()}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] text-slate-200 hover:border-cyan-400/40"
            >
              <span className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-300" /> Default Assistant (Gesture Button)
              </span>
              <span className="font-bold text-cyan-300">SET MIRA</span>
            </button>

            <button
              onClick={() => void nativeRequestWriteSettingsPermission().then(refreshPerms)}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] text-slate-200 hover:border-cyan-400/40 sm:col-span-2"
            >
              <span className="flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5 text-purple-300" /> System Brightness Control
              </span>
              <span className={perms?.writeSettings ? 'text-emerald-300 font-bold' : 'text-amber-300'}>
                {perms ? (perms.writeSettings ? 'GRANTED' : 'TAP TO ALLOW') : 'ANDROID'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. HINDI + GEMINI FEMALE VOICE STUDIO */}
      <div className="rounded-2xl border border-pink-500/35 bg-gradient-to-br from-pink-950/40 via-slate-900/90 to-purple-950/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-pink-300" />
            <h3 className="text-sm font-bold text-white">Hindi + Gemini Female Voice Studio</h3>
          </div>
          <button
            onClick={handleTestVoice}
            className="inline-flex items-center gap-1.5 rounded-xl bg-pink-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-pink-500"
          >
            <Play className="h-3.5 w-3.5" />
            Test Female Voice
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-300">
              Reply &amp; Speech Language
            </label>
            <div className="flex gap-1.5">
              <button
                onClick={() => onUpdate({ voiceLang: 'hi-IN' })}
                className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold ${
                  state.voiceLang === 'hi-IN'
                    ? 'border-pink-400 bg-pink-500/25 text-white'
                    : 'border-white/10 bg-black/40 text-slate-300'
                }`}
              >
                🇮🇳 हिंदी / Hinglish
              </button>
              <button
                onClick={() => onUpdate({ voiceLang: 'en-IN' })}
                className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold ${
                  state.voiceLang === 'en-IN'
                    ? 'border-cyan-400 bg-cyan-500/25 text-white'
                    : 'border-white/10 bg-black/40 text-slate-300'
                }`}
              >
                🇬🇧 English (India)
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-300">
              Gemini Female Voice (uses Gemini API Key)
            </label>
            <select
              value={state.geminiVoice}
              onChange={(e) => onUpdate({ geminiVoice: e.target.value as GeminiVoiceName })}
              className="w-full rounded-xl border border-white/15 bg-black/60 px-3 py-2 text-xs text-white focus:outline-none"
            >
              {GEMINI_FEMALE_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} — {v.desc}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="mt-2.5 flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={state.useGeminiVoice}
            onChange={(e) => onUpdate({ useGeminiVoice: e.target.checked })}
            className="h-4 w-4 accent-pink-500"
          />
          Use realistic <strong>Gemini Neural Female Voice ({state.geminiVoice})</strong> when Gemini Key is set (falls back to free Indian Female TTS anytime)
        </label>
      </div>

      {/* 3. MOBILE WALLPAPER STUDIO */}
      <div className="rounded-2xl border border-cyan-500/35 bg-gradient-to-br from-cyan-950/50 via-slate-900/80 to-fuchsia-950/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wallpaper className="h-4 w-4 text-cyan-300" />
            <h3 className="text-sm font-bold text-white">MIRA Mobile Wallpaper Engine</h3>
          </div>
          <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">
            {isAndroidNative() ? 'ANDROID NATIVE READY' : 'ANDROID APK FEATURE'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            onClick={() => void nativeSetLiveWallpaper(state.outfit, state.stage, state.commanderName).then((r) => onNotify(r.message))}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-600 px-3 py-2.5 text-xs font-bold text-white shadow-lg shadow-cyan-500/20 hover:brightness-110"
          >
            <Sparkles className="h-4 w-4" />
            Set MIRA Live Wallpaper
          </button>
          <button
            onClick={() => void nativeSetStaticWallpaper(state.outfit, state.stage, state.commanderName).then((r) => onNotify(r.message))}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-xs font-bold text-white hover:bg-white/15"
          >
            <ImageIcon className="h-4 w-4 text-pink-300" />
            Set Static Home/Lock Wallpaper
          </button>
        </div>
      </div>

      {/* 4. 100% FREE AI ENGINE + OPTIONAL GEMINI API KEY */}
      <div className="rounded-2xl border border-fuchsia-500/35 bg-slate-900/80 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-fuchsia-300" />
            <h3 className="text-sm font-bold text-white">100% Free MIRA AI Brain (+ Optional Gemini Key)</h3>
          </div>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:underline"
          >
            Optional Gemini Key <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <p className="mt-1 text-xs text-emerald-300">
          MIRA is <strong>100% FREE out-of-the-box</strong> — ANY random command works without an API key! Add a Gemini key below to also unlock Gemini&apos;s ultra-realistic <strong>{state.geminiVoice}</strong> female voice.
        </p>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Optional: AIzaSy... (for Gemini AI + Gemini Female Voice)"
            className="flex-1 rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-fuchsia-400 focus:outline-none"
          />
          <select
            value={state.geminiModel}
            onChange={(e) =>
              onUpdate({ geminiModel: e.target.value as MoraState['geminiModel'] })
            }
            className="rounded-xl border border-white/15 bg-black/60 px-2.5 py-2 text-xs text-white focus:outline-none"
          >
            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash</option>
            <option value="gemini-1.5-flash">gemini-1.5-flash</option>
          </select>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            onClick={handleSaveKey}
            className="inline-flex items-center gap-1.5 rounded-xl bg-fuchsia-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-fuchsia-500"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Save
          </button>
          <button
            onClick={() => void handleTestGemini()}
            disabled={testingGemini}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            <Zap className="h-3.5 w-3.5" />
            {testingGemini ? 'Testing...' : 'Test Gemini Link'}
          </button>
          {state.geminiApiKey && (
            <button
              onClick={() => {
                setKeyInput('')
                onUpdate({ geminiApiKey: '' })
                setTestResult(null)
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Use Free AI
            </button>
          )}
          <span className="ml-auto text-[11px] font-semibold text-emerald-300">
            {state.geminiApiKey ? `● Gemini + ${state.geminiVoice} Voice` : '● 100% Free AI Active'}
          </span>
        </div>

        {testResult && (
          <div className="mt-2 rounded-xl border border-white/10 bg-black/40 p-2 text-xs text-cyan-200">
            {testResult}
          </div>
        )}
      </div>

      {/* 5. UNIVERSAL PHONE & 3D COMMAND RUNNER */}
      <div className="rounded-2xl border border-white/15 bg-slate-900/80 p-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-emerald-300" />
          <h3 className="text-sm font-bold text-white">
            Universal Phone &amp; Reels Control (Any Random Command Works!)
          </h3>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleRunCmd(cmdInput)
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={cmdInput}
            onChange={(e) => setCmdInput(e.target.value)}
            placeholder='Kuch bhi bolo: "Instagram kholo aur reels scroll karo", "Arijit Singh chalao", "Call Mom"...'
            className="flex-1 rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={runningCmd}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {runningCmd ? 'Running' : 'Run'}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {quickCommands.map((qc) => (
            <button
              key={qc}
              onClick={() => void handleRunCmd(qc)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 hover:border-cyan-400/40 hover:bg-cyan-500/10"
            >
              {qc.toLowerCase().includes('flashlight') && <Flashlight className="h-3 w-3 text-amber-300" />}
              {qc.toLowerCase().includes('wi-fi') && <Wifi className="h-3 w-3 text-cyan-300" />}
              {qc}
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-black/50 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <Terminal className="h-3.5 w-3.5 text-cyan-300" />
            Live Command Execution Log
          </div>
          {state.commandLogs.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              No commands executed yet. Tap any quick command above or say &ldquo;Hey MIRA&rdquo;!
            </p>
          ) : (
            <div className="max-h-32 space-y-1 overflow-y-auto text-[11px]">
              {state.commandLogs.slice(0, 8).map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2 py-1"
                >
                  <span className="truncate font-mono text-cyan-200">
                    [{log.time}] {log.action}
                  </span>
                  <span className="shrink-0 text-emerald-300">{log.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
