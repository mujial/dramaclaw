import React, { useEffect, useRef, useState } from 'react'
import {
  Crosshair,
  Fan,
  Flame,
  Gamepad2,
  Mic,
  Plus,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Volume2,
} from 'lucide-react'
import { SUPPORTED_GAMES } from '../../data/moraData'
import type { MoraReminder, MoraState, PerformanceMode, VoiceMacro } from '../../types/mora'
import { playCyberSfx, startVoiceRecognition } from '../../utils/speech'
import { localCoachAnalysis } from '../../utils/moraBrain'
import { CyberModal } from '../CyberModal'

interface GameSpaceModalProps {
  open: boolean
  onClose: () => void
  state: MoraState
  onUpdate: (patch: Partial<MoraState>) => void
  onAddReminder: (title: string, delaySeconds: number, game: string) => void
  onSpeakLine: (line: string) => void
  onUnlockAchievement: (id: string) => void
}

type TabId = 'coach' | 'mouthpiece' | 'voice' | 'arena'

export const GameSpaceModal: React.FC<GameSpaceModalProps> = ({
  open,
  onClose,
  state,
  onUpdate,
  onAddReminder,
  onSpeakLine,
  onUnlockAchievement,
}) => {
  const [tab, setTab] = useState<TabId>('coach')
  const [kills, setKills] = useState(6)
  const [deaths, setDeaths] = useState(2)
  const [assists, setAssists] = useState(4)
  const [winProb, setWinProb] = useState(74)
  const [coachTip, setCoachTip] = useState(
    'High-ground rotation favored: hug ridge cover before Zone 4 shrinks and enable 520Hz shoulder triggers.',
  )
  const [thermalText, setThermalText] = useState('36.4°C Optimal (AquaCore + 24,000 RPM Fan)')

  // Mouthpiece & Reminders
  const [mouthText, setMouthText] = useState('Enemy flanking left warehouse! Cover me!')
  const [remTitle, setRemTitle] = useState('Boss Raid / Lord Spawn')
  const [remSecs, setRemSecs] = useState(20)

  // Voice Control Ripples
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; label: string }[]>([])
  const [listeningMacro, setListeningMacro] = useState(false)
  const stopMacroRef = useRef<(() => void) | null>(null)

  // Esports Training Arena Mini-game
  const [arenaRunning, setArenaRunning] = useState(false)
  const [targetPos, setTargetPos] = useState({ x: 50, y: 50 })
  const [targetSpawnedAt, setTargetSpawnedAt] = useState(0)
  const [hits, setHits] = useState(0)
  const [avgMs, setAvgMs] = useState<number | null>(null)
  const [reactionHistory, setReactionHistory] = useState<number[]>([])

  const [, setTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setTick((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [open])

  const refreshCoach = async () => {
    playCyberSfx('click')
    onUnlockAchievement('tactical-ace')
    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game: state.activeGame,
          kills,
          deaths,
          assists,
        }),
      })
      const data = await res.json()
      setWinProb(data.winProbability)
      setCoachTip(data.tip)
      setThermalText(data.thermalStatus)
      onSpeakLine(`Win rate predicted at ${data.winProbability} percent. ${data.tip}`)
    } catch {
      const data = localCoachAnalysis(state.activeGame, kills, deaths, assists)
      setWinProb(data.winProbability)
      setCoachTip(data.tip)
      setThermalText(data.thermalStatus)
      onSpeakLine(`Win rate predicted at ${data.winProbability} percent. ${data.tip}`)
    }
  }

  const fireMacro = (macro: VoiceMacro) => {
    playCyberSfx('trigger')
    onUnlockAchievement('voice-commander')
    const id = Date.now() + Math.random()
    setRipples((prev) => [...prev.slice(-4), { id, x: macro.tapX, y: macro.tapY, label: macro.actionLabel }])
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id))
    }, 900)
    onSpeakLine(`Executing ${macro.actionLabel}!`)
  }

  const listenForMacro = () => {
    if (listeningMacro) {
      stopMacroRef.current?.()
      setListeningMacro(false)
      return
    }
    setListeningMacro(true)
    const stop = startVoiceRecognition(
      (spoken) => {
        setListeningMacro(false)
        const found = state.voiceMacros.find((m) =>
          spoken.toLowerCase().includes(m.keyword.toLowerCase()),
        )
        if (found) {
          fireMacro(found)
        } else {
          onSpeakLine(`Heard "${spoken}". Say Reload, Prone, Heal, or Ult to trigger screen taps!`)
        }
      },
      () => setListeningMacro(false),
    )
    if (!stop) setListeningMacro(false)
    else stopMacroRef.current = stop
  }

  const spawnTarget = () => {
    setTargetPos({
      x: 15 + Math.random() * 70,
      y: 20 + Math.random() * 60,
    })
    setTargetSpawnedAt(performance.now())
  }

  const startArena = () => {
    setHits(0)
    setReactionHistory([])
    setAvgMs(null)
    setArenaRunning(true)
    spawnTarget()
    onSpeakLine('Esports Training Arena active! Tap the crimson targets as fast as possible!')
  }

  const hitTarget = () => {
    playCyberSfx('trigger')
    const dt = Math.round(performance.now() - targetSpawnedAt)
    const nextHist = [...reactionHistory, dt]
    setReactionHistory(nextHist)
    const mean = Math.round(nextHist.reduce((a, b) => a + b, 0) / nextHist.length)
    setAvgMs(mean)
    const nextHits = hits + 1
    setHits(nextHits)
    if (nextHits >= 8) {
      setArenaRunning(false)
      onUnlockAchievement('tactical-ace')
      onSpeakLine(`Training complete! Average reaction speed ${mean} milliseconds! Pro tier reflexes, ${state.commanderName}!`)
    } else {
      spawnTarget()
    }
  }

  return (
    <CyberModal
      open={open}
      onClose={onClose}
      title="REDMAGIC Game Space — MIRA 2.0 & 3.0"
      subtitle="Personal AI Tactical Coach, Win Predictor, MIRA Mouthpiece, Voice Control & Training Arena"
      icon={<Gamepad2 className="w-5 h-5" />}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-4">
        {/* Game Launcher Strip */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SUPPORTED_GAMES.map((g) => {
            const active = state.activeGame === g.id
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  onUpdate({ activeGame: g.id })
                  onSpeakLine(`${g.id} profile loaded! ${g.fpsTarget} ready.`)
                }}
                className={`shrink-0 px-3.5 py-2 rounded-xl border text-left transition-all bg-gradient-to-br ${g.color} ${
                  active ? 'border-rose-400 shadow-[0_0_20px_rgba(255,42,75,0.3)]' : 'border-white/10 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="font-bold text-xs text-white">{g.id}</div>
                <div className="text-[10px] text-cyan-200">{g.fpsTarget}</div>
              </button>
            )
          })}
        </div>

        {/* RedCore Hardware Bar */}
        <div className="rounded-2xl bg-black/45 border border-white/10 p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {(['balance', 'rise', 'diablo'] as PerformanceMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onUpdate({ performanceMode: mode })}
                className={`px-3 py-1 rounded-lg text-xs font-cyber uppercase transition-all ${
                  state.performanceMode === mode
                    ? mode === 'diablo'
                      ? 'bg-rose-600 text-white shadow-[0_0_16px_rgba(255,42,75,0.6)]'
                      : 'bg-cyan-500 text-slate-950 font-bold'
                    : 'bg-white/5 text-slate-400'
                }`}
              >
                {mode} Mode
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => onUpdate({ fanSpeedRpm: state.fanSpeedRpm > 0 ? 0 : 24000 })}
              className={`px-3 py-1 rounded-lg border flex items-center gap-1.5 ${
                state.fanSpeedRpm > 0
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                  : 'bg-white/5 border-white/10 text-slate-400'
              }`}
            >
              <Fan className={`w-3.5 h-3.5 ${state.fanSpeedRpm > 0 ? 'animate-spin' : ''}`} />
              24K Fan
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ shoulderTriggersEnabled: !state.shoulderTriggersEnabled })}
              className={`px-3 py-1 rounded-lg border ${
                state.shoulderTriggersEnabled
                  ? 'bg-rose-500/20 border-rose-400 text-rose-200'
                  : 'bg-white/5 border-white/10 text-slate-400'
              }`}
            >
              520Hz Triggers: {state.shoulderTriggersEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Sub-feature Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { id: 'coach', label: 'AI Coach & Win Rate', icon: TrendingUp },
            { id: 'mouthpiece', label: 'MIRA Mouthpiece', icon: Volume2 },
            { id: 'voice', label: 'Voice Control Macros', icon: Mic },
            { id: 'arena', label: 'Training Arena (OS 12)', icon: Crosshair },
          ].map((t) => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id as TabId)}
                className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  active
                    ? 'bg-rose-500/25 border-rose-400 text-white'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                <Icon className="w-3.5 h-3.5 text-rose-400" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* TAB 1: Tactical Coach & Win Rate Predictor */}
        {tab === 'coach' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-cyber text-xs text-cyan-300 uppercase">
                  Win Rate Predictor ({state.activeGame})
                </span>
                <span className="font-cyber text-2xl font-black text-emerald-400">{winProb}%</span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 transition-all duration-500"
                  style={{ width: `${winProb}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Kills: {kills}</label>
                  <input
                    type="range"
                    min={0}
                    max={25}
                    value={kills}
                    onChange={(e) => setKills(Number(e.target.value))}
                    className="w-full accent-rose-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Deaths: {deaths}</label>
                  <input
                    type="range"
                    min={0}
                    max={15}
                    value={deaths}
                    onChange={(e) => setDeaths(Number(e.target.value))}
                    className="w-full accent-amber-400"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Assists: {assists}</label>
                  <input
                    type="range"
                    min={0}
                    max={25}
                    value={assists}
                    onChange={(e) => setAssists(Number(e.target.value))}
                    className="w-full accent-cyan-400"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={refreshCoach}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 text-white font-cyber text-xs font-bold flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" /> ANALYZE MATCH & VOICE TIP
              </button>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-rose-500/15 to-cyan-500/10 border border-rose-400/30 p-4 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-cyber text-rose-300 uppercase mb-2">
                  <ShieldAlert className="w-4 h-4" /> Personal AI Tactical Coach Broadcast
                </div>
                <p className="text-sm text-white leading-relaxed font-medium">“{coachTip}”</p>
              </div>
              <div className="pt-3 border-t border-white/10 text-[11px] text-cyan-300 flex items-center justify-between">
                <span>{thermalText}</span>
                <span className="font-cyber">144 FPS LOCK</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: MIRA Mouthpiece & Raid Reminders */}
        {tab === 'mouthpiece' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
              <div className="text-xs font-cyber text-rose-400 uppercase">
                MIRA Mouthpiece — In-Game Voice Proxy
              </div>
              <p className="text-xs text-slate-400">
                Communicate in-game using MIRA’s voice so your squad hears tactical callouts cleanly!
              </p>
              <textarea
                rows={3}
                value={mouthText}
                onChange={(e) => setMouthText(e.target.value)}
                className="w-full bg-black/40 border border-white/15 rounded-xl p-2.5 text-sm text-white"
              />
              <button
                type="button"
                onClick={() => {
                  onUnlockAchievement('voice-commander')
                  onSpeakLine(mouthText)
                }}
                className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center justify-center gap-2"
              >
                <Volume2 className="w-4 h-4" /> Broadcast in MIRA’s Voice
              </button>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
              <div className="text-xs font-cyber text-cyan-400 uppercase">
                In-Game Raid & Buff Reminders
              </div>
              <div className="flex gap-2">
                <input
                  value={remTitle}
                  onChange={(e) => setRemTitle(e.target.value)}
                  placeholder="Reminder (e.g. Genshin Boss / Lord)"
                  className="flex-1 bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-xs text-white"
                />
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={remSecs}
                  onChange={(e) => setRemSecs(Number(e.target.value))}
                  className="w-20 bg-black/40 border border-white/15 rounded-xl px-2.5 py-2 text-xs text-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    onAddReminder(remTitle, remSecs, state.activeGame)
                    onUnlockAchievement('voice-commander')
                  }}
                  className="px-3 py-2 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Set
                </button>
              </div>

              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {state.reminders.length === 0 ? (
                  <p className="text-xs text-slate-400">No active raid timers.</p>
                ) : (
                  state.reminders.map((r: MoraReminder) => {
                    const left = Math.max(0, Math.round((r.triggerAt - Date.now()) / 1000))
                    return (
                      <div
                        key={r.id}
                        className="px-3 py-2 rounded-xl bg-black/35 border border-white/10 flex items-center justify-between text-xs"
                      >
                        <span className="text-white font-medium">{r.title}</span>
                        <span className="font-cyber text-amber-300">
                          {r.completed ? 'TRIGGERED' : `${left}s`}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Voice Control Macros */}
        {tab === 'voice' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-cyber text-rose-400 uppercase">
                  Hands-Free Voice Trigger Map
                </span>
                <button
                  type="button"
                  onClick={listenForMacro}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
                    listeningMacro
                      ? 'bg-rose-600 text-white animate-pulse'
                      : 'bg-cyan-500/20 border border-cyan-400/50 text-cyan-200'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  {listeningMacro ? 'Listening...' : 'Speak Keyword'}
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Say or click a keyword to simulate instantaneous screen tap execution at mapped HUD coordinates:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {state.voiceMacros.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => fireMacro(m)}
                    className="p-2.5 rounded-xl bg-black/35 hover:bg-rose-500/20 border border-white/15 hover:border-rose-400 text-left transition-all"
                  >
                    <div className="font-cyber text-xs text-rose-300">“{m.keyword}”</div>
                    <div className="text-[11px] text-slate-300">
                      {m.actionLabel} ({m.tapX}%, {m.tapY}%)
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="relative aspect-video rounded-2xl overflow-hidden border border-cyan-400/40 bg-slate-950">
              <img
                src="/assets/bg-neon-arena.png"
                alt="Game HUD Canvas"
                className="w-full h-full object-cover opacity-55"
              />
              <div className="absolute top-2 left-2 text-[10px] font-cyber text-cyan-300">
                SIMULATED GAME HUD TAP OVERLAY
              </div>
              {state.voiceMacros.map((m) => (
                <div
                  key={m.id}
                  style={{ left: `${m.tapX}%`, top: `${m.tapY}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full border border-white/40 bg-black/50 flex items-center justify-center text-[9px] font-cyber text-white"
                >
                  {m.keyword}
                </div>
              ))}
              {ripples.map((r) => (
                <div
                  key={r.id}
                  style={{ left: `${r.x}%`, top: `${r.y}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                >
                  <span className="block w-14 h-14 rounded-full border-2 border-rose-400 animate-ping" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: Esports Training Arena (OS 12) */}
        {tab === 'arena' && (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-cyber text-xs text-rose-400 uppercase flex items-center gap-1.5">
                  <Flame className="w-4 h-4" /> REDMAGIC OS 12 Esports Training Arena
                </div>
                <div className="text-xs text-slate-400">
                  Test your 144Hz touch reaction speed (8 targets)
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs font-cyber">
                <span className="text-cyan-300">HITS: {hits}/8</span>
                <span className="text-emerald-400">
                  AVG REACTION: {avgMs !== null ? `${avgMs} ms` : '--'}
                </span>
                <button
                  type="button"
                  onClick={startArena}
                  className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white"
                >
                  {arenaRunning ? 'Restart' : 'Start Drill'}
                </button>
              </div>
            </div>

            <div className="relative h-64 rounded-2xl bg-[#060912] border border-cyan-500/30 overflow-hidden rm-grid-bg">
              {!arenaRunning ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-4">
                  <Target className="w-10 h-10 text-rose-400 mb-2" />
                  <p className="text-sm text-white font-semibold">
                    {avgMs !== null
                      ? `Drill Complete! Average Reflex: ${avgMs} ms`
                      : 'Press "Start Drill" to calibrate your pro gaming reflexes'}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={hitTarget}
                  style={{ left: `${targetPos.x}%`, top: `${targetPos.y}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-rose-500/30 border-2 border-rose-400 shadow-[0_0_24px_rgba(255,42,75,0.8)] flex items-center justify-center hover:scale-110 transition-transform cursor-crosshair"
                >
                  <span className="w-4 h-4 rounded-full bg-cyan-300" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </CyberModal>
  )
}
