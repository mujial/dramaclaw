import React, { useEffect, useState } from 'react'
import { Award, CheckCircle2, Download, ExternalLink, FileText, Lock, Shield, Smartphone, Sparkles, User, Volume2 } from 'lucide-react'
import { ACHIEVEMENTS, VOICE_PERSONAS } from '../../data/moraData'
import type { MoraState, VoicePersonaId } from '../../types/mora'
import { CyberModal } from '../CyberModal'

interface AchievementsModalProps {
  open: boolean
  onClose: () => void
  state: MoraState
  onUpdate: (patch: Partial<MoraState>) => void
  onSpeakLine: (line: string) => void
}

export const AchievementsModal: React.FC<AchievementsModalProps> = ({
  open,
  onClose,
  state,
  onUpdate,
  onSpeakLine,
}) => {
  const [tab, setTab] = useState<'dossier' | 'analysis'>('dossier')
  const [nameInput, setNameInput] = useState(state.commanderName)
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void> } | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as unknown as { prompt: () => Promise<void> })
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const xpProgress = state.bondXp % 100

  return (
    <CyberModal
      open={open}
      onClose={onClose}
      title="Commander Dossier & RedMagic Mora Analysis"
      subtitle="Bond progression, 2122 achievements, voice calibration & complete feature breakdown"
      icon={<Award className="w-5 h-5" />}
      maxWidth="max-w-4xl"
    >
      <div className="space-y-5">
        {/* Tabs */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('dossier')}
            className={`px-4 py-2 rounded-xl text-xs font-cyber font-bold border flex items-center gap-2 ${
              tab === 'dossier'
                ? 'bg-rose-500/25 border-rose-400 text-white'
                : 'bg-white/5 border-white/10 text-slate-300'
            }`}
          >
            <Shield className="w-4 h-4 text-rose-400" /> Commander & Achievements
          </button>
          <button
            type="button"
            onClick={() => setTab('analysis')}
            className={`px-4 py-2 rounded-xl text-xs font-cyber font-bold border flex items-center gap-2 ${
              tab === 'analysis'
                ? 'bg-cyan-500/25 border-cyan-400 text-white'
                : 'bg-white/5 border-white/10 text-slate-300'
            }`}
          >
            <FileText className="w-4 h-4 text-cyan-400" /> Full RedMagic Mora Analysis
          </button>
        </div>

        {tab === 'dossier' ? (
          <div className="space-y-5">
            {/* Commander Identity & Bond */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-cyber text-rose-400 uppercase flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Commander Identity
                </label>
                <div className="flex gap-2">
                  <input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="flex-1 bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-sm text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = nameInput.trim() || 'Commander'
                      onUpdate({ commanderName: clean })
                      onSpeakLine(`Commander identity updated! Nice to link with you, ${clean}!`)
                    }}
                    className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="font-cyber text-cyan-300 uppercase flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> 2122 Bond Level {state.bondLevel}
                  </span>
                  <span className="text-slate-300">{xpProgress} / 100 XP</span>
                </div>
                <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-rose-500 to-cyan-400 transition-all"
                    style={{ width: `${xpProgress}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Chat, headpat Mora, capture AR photos, and train in Game Space to level up your Bond!
                </p>
              </div>
            </div>

            {/* Voice Calibration */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2.5">
              <div className="text-xs font-cyber text-cyan-400 uppercase flex items-center gap-1.5">
                <Volume2 className="w-4 h-4" /> Mora Voice Core Selector
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {(Object.keys(VOICE_PERSONAS) as VoicePersonaId[]).map((vid) => {
                  const p = VOICE_PERSONAS[vid]
                  const active = state.voicePersona === vid
                  return (
                    <button
                      key={vid}
                      type="button"
                      onClick={() => {
                        onUpdate({ voicePersona: vid })
                        onSpeakLine(`Voice calibration switched to ${p.label}!`)
                      }}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        active
                          ? 'bg-cyan-500/20 border-cyan-400 text-white'
                          : 'bg-black/25 border-white/10 text-slate-300'
                      }`}
                    >
                      <div className="font-bold text-xs">{p.label}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{p.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Android APK & Installable App */}
            <div className="rounded-2xl bg-gradient-to-r from-rose-500/15 via-slate-900/70 to-cyan-500/15 border border-rose-400/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/50 flex items-center justify-center text-rose-300 shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-cyber text-xs font-bold text-white uppercase">
                    Android APK &amp; Installable App
                  </div>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Compiled via Capacitor Android (<code className="text-cyan-300">com.redmagic.mora.mirror</code>) or install directly as a fullscreen Android PWA.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {installPrompt && (
                  <button
                    type="button"
                    onClick={() => installPrompt.prompt()}
                    className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" /> Install App
                  </button>
                )}
                <a
                  href="https://github.com/mujial/dramaclaw/actions/workflows/build-mora-apk.yml"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Download APK Build
                </a>
              </div>
            </div>

            {/* Achievements Grid */}
            <div>
              <div className="text-xs font-cyber text-amber-300 uppercase mb-2.5">
                Achievements Unlocked ({state.unlockedAchievements.length} / {ACHIEVEMENTS.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {ACHIEVEMENTS.map((ach) => {
                  const unlocked = state.unlockedAchievements.includes(ach.id)
                  return (
                    <div
                      key={ach.id}
                      className={`p-3 rounded-xl border flex items-center gap-3 ${
                        unlocked
                          ? 'bg-emerald-500/10 border-emerald-400/40'
                          : 'bg-white/5 border-white/10 opacity-60'
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          unlocked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {unlocked ? <CheckCircle2 className="w-5 h-5" /> : <Lock className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-xs text-white truncate">{ach.title}</span>
                          <span className="text-[10px] font-cyber text-amber-300">+{ach.xp} XP</span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate">{ach.description}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          /* Complete RedMagic Mora Research Analysis */
          <div className="space-y-4 text-xs sm:text-sm text-slate-200 leading-relaxed">
            <div className="rounded-2xl bg-rose-500/10 border border-rose-400/35 p-4">
              <h3 className="font-cyber text-sm font-bold text-rose-300 mb-1">
                REDMAGIC MORA AI — Complete Research & Mirror Architecture
              </h3>
              <p className="text-slate-300 text-xs">
                Synthesized from official REDMAGIC 8 Pro, 9 Pro, 10S Pro (Mora 2.0), 11 Pro/Air (Mora 3.0), and REDMAGIC OS 12 specifications.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/5 border border-white/10 p-3.5">
                <div className="font-cyber text-xs text-cyan-300 mb-1.5">1. Identity & Lore (2122)</div>
                <p className="text-xs text-slate-300">
                  Pink-haired cybernetic anime mascot with red horn clips who traveled back in time from 2122 to be REDMAGIC’s esports victory guide & companion.
                </p>
              </div>
              <div className="rounded-xl bg-white/5 border border-white/10 p-3.5">
                <div className="font-cyber text-xs text-cyan-300 mb-1.5">2. Core App Navigation</div>
                <p className="text-xs text-slate-300">
                  Skewed HUD cards for Mora Dress Up (Cyber, Academy, Esports, Chibi Magic Buddy), Mora Care, Science & Tech Center, Mora Live, and AR Camera.
                </p>
              </div>
              <div className="rounded-xl bg-white/5 border border-white/10 p-3.5">
                <div className="font-cyber text-xs text-cyan-300 mb-1.5">3. OS-Level Integrations</div>
                <p className="text-xs text-slate-300">
                  Home Screen Interactive Mora (size/opacity/drag), Energy Replenishment Pod charging animation, Wake-Up Call with Snooze Scolding, and OS 12 AI Magic Island.
                </p>
              </div>
              <div className="rounded-xl bg-white/5 border border-white/10 p-3.5">
                <div className="font-cyber text-xs text-cyan-300 mb-1.5">4. Game Space (Mora 2.0 & 3.0)</div>
                <p className="text-xs text-slate-300">
                  Personal AI Tactical Coach, Win Rate Predictor (PUBG, Free Fire, MLBB), Mora Mouthpiece in-game voice/reminders (Genshin), Voice Control tap macros, and Esports Training Arena.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </CyberModal>
  )
}
