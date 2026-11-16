import { useState } from 'react'
import {
  Bot,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Flashlight,
  Image as ImageIcon,
  KeyRound,
  Mic,
  Play,
  Sparkles,
  Terminal,
  Trash2,
  Wallpaper,
  Zap,
} from 'lucide-react'
import type { MoraState } from '../../types/mora'
import {
  isAndroidNative,
  nativeSetLiveWallpaper,
  nativeSetStaticWallpaper,
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

  const handleSaveKey = () => {
    onUpdate({ geminiApiKey: keyInput.trim() })
    onNotify(keyInput.trim() ? 'Gemini API Key saved locally!' : 'Gemini API Key cleared.')
  }

  const handleTestGemini = async () => {
    const k = keyInput.trim()
    if (!k) {
      setTestResult('Please paste a Gemini API key first.')
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

  const handleSetLiveWallpaper = async () => {
    const res = await nativeSetLiveWallpaper(state.outfit, state.stage, state.commanderName)
    onNotify(res.message)
  }

  const handleSetStaticWallpaper = async () => {
    const res = await nativeSetStaticWallpaper(state.outfit, state.stage, state.commanderName)
    onNotify(res.message)
  }

  const quickCommands = [
    'Open YouTube',
    'Open WhatsApp',
    'Open Spotify',
    state.flashlightOn ? 'Turn off flashlight' : 'Turn on flashlight',
    'Check battery',
    'What is the time',
    'Tell me a joke',
    'Check weather',
    'Set timer for 1 minute',
    'Set alarm 7:30 AM',
  ]

  return (
    <div className="space-y-4">
      {/* 1. MOBILE WALLPAPER STUDIO */}
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
        <p className="mt-1 text-xs text-slate-300">
          Set <strong>MIRA</strong> directly as your phone&apos;s wallpaper — choose Live Animated Wallpaper (interactive touch ripples, floating MIRA, cyber particles, clock &amp; battery HUD) or Static Home/Lock screen!
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            onClick={handleSetLiveWallpaper}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-600 px-3 py-2.5 text-xs font-bold text-white shadow-lg shadow-cyan-500/20 hover:brightness-110"
          >
            <Sparkles className="h-4 w-4" />
            Set MIRA Live Wallpaper
          </button>
          <button
            onClick={handleSetStaticWallpaper}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-xs font-bold text-white hover:bg-white/15"
          >
            <ImageIcon className="h-4 w-4 text-pink-300" />
            Set Static Home/Lock Wallpaper
          </button>
        </div>
      </div>

      {/* 2. GEMINI API KEY CONFIGURATION */}
      <div className="rounded-2xl border border-fuchsia-500/35 bg-slate-900/80 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-fuchsia-300" />
            <h3 className="text-sm font-bold text-white">Google Gemini API Key (Real AI Brain)</h3>
          </div>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:underline"
          >
            Get Free Key <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Paste your Google Gemini API key so MIRA can answer any question and automatically execute real Jarvis-AI commands on your phone. Stored only on your device.
        </p>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="AIzaSy... (paste your Gemini API Key)"
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
            Save Key
          </button>
          <button
            onClick={handleTestGemini}
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
              Clear
            </button>
          )}
          <span className="ml-auto text-[11px] font-semibold text-emerald-300">
            {state.geminiApiKey ? '● Key Active' : '○ Offline Jarvis Mode'}
          </span>
        </div>

        {testResult && (
          <div className="mt-2 rounded-xl border border-white/10 bg-black/40 p-2 text-xs text-cyan-200">
            {testResult}
          </div>
        )}
      </div>

      {/* 3. JARVIS-AI CORE & COMMAND EXECUTION */}
      <div className="rounded-2xl border border-white/15 bg-slate-900/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-emerald-300" />
            <h3 className="text-sm font-bold text-white">Jarvis-AI Core (Aryan-0001/Jarvis-AI)</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onUpdate({ wakeWordEnabled: !state.wakeWordEnabled })}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                state.wakeWordEnabled
                  ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40'
                  : 'bg-white/10 text-slate-300'
              }`}
            >
              <Mic className="h-3 w-3" />
              Wake: &ldquo;Hey MIRA&rdquo; {state.wakeWordEnabled ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => onUpdate({ continuousConvoEnabled: !state.continuousConvoEnabled })}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                state.continuousConvoEnabled
                  ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                  : 'bg-white/10 text-slate-300'
              }`}
            >
              <Bot className="h-3 w-3" />
              Auto-Listen {state.continuousConvoEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
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
            placeholder='Try: "Open YouTube", "Turn on flashlight", "Set alarm 7:00 AM", or ask Gemini anything...'
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
              No commands executed yet. Tap any quick command above or ask MIRA!
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
