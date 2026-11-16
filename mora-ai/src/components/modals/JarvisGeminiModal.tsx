import { useEffect, useState } from 'react'
import {
  Accessibility,
  Bot,
  CheckCircle2,
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
  Zap,
} from 'lucide-react'
import type { MoraState } from '../../types/mora'
import {
  isAndroidNative,
  nativeCheckPermissions,
  nativeRequestAccessibilityPermission,
  nativeRequestOverlayPermission,
  nativeRequestRuntimePermissions,
  nativeRequestWriteSettingsPermission,
  nativeSetLiveWallpaper,
  nativeSetStaticWallpaper,
  nativeShowMiniMiraOverlay,
  nativeStartWakeWordService,
  nativeStopWakeWordService,
  type PermissionsStatus,
} from '../../utils/miraNative'

interface JarvisGeminiModalProps {
  state: MoraState
  onUpdate: (patch: Partial<MoraState>) => void
  onExecuteCommand: (command: string) => Promise<void>
  onNotify: (msg: string) => void
}

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

  const handleSaveKey = () => {
    onUpdate({ geminiApiKey: keyInput.trim() })
    onNotify(keyInput.trim() ? 'Optional Gemini API Key saved!' : 'Switched to 100% Free Built-in AI!')
  }

  const handleTestGemini = async () => {
    const k = keyInput.trim()
    if (!k) {
      setTestResult('Built-in Free AI is already active (no key required). Paste a Gemini key only if you want Gemini too.')
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
            contents: [{ role: 'user', parts: [{ text: 'Say "MIRA Gemini link active!" in 5 words.' }] }],
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
    'Open YouTube',
    'Open WhatsApp',
    'Call Mom',
    'Wi-Fi settings',
    'Bluetooth settings',
    'Volume up',
    state.flashlightOn ? 'Turn off flashlight' : 'Turn on flashlight',
    'Take screenshot',
    'Scroll down',
    'Dance MIRA',
    'Wave MIRA',
    'Check battery',
    'Tell me a joke',
    'Set timer for 1 minute',
  ]

  return (
    <div className="space-y-4">
      {/* 1. MINI MIRA GOOGLE-ASSISTANT OVERLAY & WAKE WORD */}
      <div className="rounded-2xl border border-rose-500/40 bg-gradient-to-br from-rose-950/50 via-slate-900/90 to-cyan-950/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-rose-400" />
            <h3 className="text-sm font-bold text-white">
              &ldquo;Hey MIRA&rdquo; Mini Overlay (Google Assistant Mode)
            </h3>
          </div>
          <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2.5 py-0.5 text-[10px] font-bold text-emerald-200">
            100% FREE · NO APP OPEN NEEDED
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-300">
          Say <strong>&ldquo;Hey MIRA&rdquo;</strong> from your Home screen or any app — <strong>Mini MIRA</strong> pops up right over your screen like Google Assistant without opening the full app, listens, runs any phone command, and speaks back!
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
            {state.wakeWordEnabled ? 'Hey MIRA Wake-Word: ACTIVE' : 'Enable "Hey MIRA" Background Wake-Word'}
          </button>

          <button
            onClick={() => void handleSummonMiniOverlay()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-3.5 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25"
          >
            <Layers className="h-4 w-4" />
            Test Mini MIRA Popup
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

        {/* Android Full Phone Control Permissions */}
        <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
              <ShieldCheck className="h-3.5 w-3.5" /> Full Phone Control Permissions (Tap to Grant)
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
                <Accessibility className="h-3.5 w-3.5 text-emerald-300" /> Accessibility (Back, Scroll, Tap, Type)
              </span>
              <span className={perms?.accessibility ? 'text-emerald-300 font-bold' : 'text-amber-300'}>
                {perms ? (perms.accessibility ? 'ACTIVE' : 'ENABLE IN SETTINGS') : 'ANDROID'}
              </span>
            </button>

            <button
              onClick={() => void nativeRequestWriteSettingsPermission().then(refreshPerms)}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] text-slate-200 hover:border-cyan-400/40"
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

      {/* 2. MOBILE WALLPAPER STUDIO */}
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

      {/* 3. 100% FREE AI ENGINE + OPTIONAL GEMINI API KEY */}
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
          MIRA is <strong>100% FREE out-of-the-box</strong> — no API key needed! She understands and executes all commands using her built-in Free AI + 5 integrated GitHub automation cores. (Optionally add a Gemini key below if you prefer.)
        </p>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Optional: AIzaSy... (leave empty to use 100% Free AI)"
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
            {testingGemini ? 'Testing...' : 'Test AI Link'}
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
            {state.geminiApiKey ? '● Gemini + Free Fallback' : '● 100% Free AI Active'}
          </span>
        </div>

        {testResult && (
          <div className="mt-2 rounded-xl border border-white/10 bg-black/40 p-2 text-xs text-cyan-200">
            {testResult}
          </div>
        )}
      </div>

      {/* 4. UNIVERSAL PHONE & 3D COMMAND RUNNER */}
      <div className="rounded-2xl border border-white/15 bg-slate-900/80 p-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-emerald-300" />
          <h3 className="text-sm font-bold text-white">
            Universal Phone Control (Jarvis-AI · Open-Jarvis · Droy · JAVIS-Android)
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
            placeholder='Try: "Call Mom", "Send WhatsApp to Rahul", "Wi-Fi on", "Take screenshot", "Dance MIRA"...'
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

        {/* Command Execution Log */}
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
