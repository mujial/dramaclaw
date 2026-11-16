import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlarmClock,
  Atom,
  Award,
  BatteryCharging,
  Bot,
  Camera,
  Crop,
  Gamepad2,
  Heart,
  Layers,
  MessageSquare,
  Palette,
  Settings,
  Shirt,
  Sparkles,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { AiMagicIsland } from './components/AiMagicIsland'
import { FloatingMoraWidget } from './components/FloatingMoraWidget'
import { MoraAvatarStage } from './components/MoraAvatarStage'
import { MoraChatDrawer } from './components/MoraChatDrawer'
import { AchievementsModal } from './components/modals/AchievementsModal'
import { ArCameraModal } from './components/modals/ArCameraModal'
import { ChargingPodModal } from './components/modals/ChargingPodModal'
import { DressUpModal } from './components/modals/DressUpModal'
import { GameSpaceModal } from './components/modals/GameSpaceModal'
import { MoraCareModal } from './components/modals/MoraCareModal'
import { MoraLiveModal } from './components/modals/MoraLiveModal'
import { ScienceTechModal } from './components/modals/ScienceTechModal'
import { WakeUpAlarmModal } from './components/modals/WakeUpAlarmModal'
import {
  ACHIEVEMENTS,
  DEFAULT_MORA_STATE,
  MORA_OUTFITS,
  MORA_STAGES,
  TOUCH_REACTIONS,
} from './data/moraData'
import type { ArPhotoItem, ModalId, MoraReminder, MoraState, StageId } from './types/mora'
import { playCyberSfx, speakAsMora } from './utils/speech'
import { localMoraReply } from './utils/moraBrain'

const STORAGE_KEY = 'redmagic_mora_ai_state_v3'

function loadInitialState(): MoraState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return { ...DEFAULT_MORA_STATE, ...JSON.parse(raw) }
    }
  } catch {
    // ignore
  }
  return DEFAULT_MORA_STATE
}

export function App() {
  const [state, setState] = useState<MoraState>(loadInitialState)
  const [activeModal, setActiveModal] = useState<ModalId>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [quickChatInput, setQuickChatInput] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [bubbleText, setBubbleText] = useState(
    'Neural link ready! Tap my horns, try Mora Dress Up, or launch Game Space, Commander!',
  )
  const [toast, setToast] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr))
    }, 3200)
  }, [])

  // Hydrate from server on mount if available
  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((data) => {
        if (data?.state && typeof data.state === 'object') {
          setState((prev) => ({ ...prev, ...data.state }))
        }
      })
      .catch(() => {})
  }, [])

  // Persist to localStorage & server
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ignore quota
    }
    const t = setTimeout(() => {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      }).catch(() => {})
    }, 350)
    return () => clearTimeout(t)
  }, [state])

  const updateState = useCallback((patch: Partial<MoraState>) => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const grantXp = useCallback((amount: number) => {
    setState((prev) => {
      const nextXp = prev.bondXp + amount
      const nextLevel = Math.floor(nextXp / 100) + 1
      return { ...prev, bondXp: nextXp, bondLevel: nextLevel }
    })
  }, [])

  const unlockAchievement = useCallback(
    (id: string) => {
      setState((prev) => {
        if (prev.unlockedAchievements.includes(id)) return prev
        const def = ACHIEVEMENTS.find((a) => a.id === id)
        if (def) {
          playCyberSfx('levelup')
          showToast(`Achievement Unlocked: ${def.title} (+${def.xp} XP)`)
        }
        const nextXp = prev.bondXp + (def?.xp ?? 50)
        return {
          ...prev,
          unlockedAchievements: [...prev.unlockedAchievements, id],
          bondXp: nextXp,
          bondLevel: Math.floor(nextXp / 100) + 1,
        }
      })
    },
    [showToast],
  )

  const speakLine = useCallback(
    (line: string) => {
      setBubbleText(line)
      speakAsMora(line, {
        muted: state.muted,
        persona: state.voicePersona,
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
      })
    },
    [state.muted, state.voicePersona],
  )

  // Live Reminder Countdown Monitor
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      const due = state.reminders.find((r) => !r.completed && r.triggerAt <= now)
      if (due) {
        playCyberSfx('alert')
        setState((prev) => ({
          ...prev,
          reminders: prev.reminders.map((r) =>
            r.id === due.id ? { ...r, completed: true } : r,
          ),
        }))
        const msg = `Mora Mouthpiece Alert for ${due.game}: ${due.title}! It's time, ${state.commanderName}!`
        showToast(msg)
        speakLine(msg)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [state.reminders, state.commanderName, showToast, speakLine])

  const handleTouchZone = (zone: 'head' | 'face' | 'outfit' | 'hands') => {
    playCyberSfx('click')
    const pool = TOUCH_REACTIONS[zone].lines
    const line = pool[Math.floor(Math.random() * pool.length)]
    speakLine(line)
    grantXp(8)
    if (zone === 'head') unlockAchievement('headpat')
  }

  const handleAddReminder = useCallback(
    (title: string, delaySeconds: number, game: string) => {
      const item: MoraReminder = {
        id: `rem-${Date.now()}`,
        title,
        game,
        triggerAt: Date.now() + delaySeconds * 1000,
        completed: false,
      }
      setState((prev) => ({ ...prev, reminders: [item, ...prev.reminders.slice(0, 9)] }))
      const msg = `Reminder locked: "${title}" in ${delaySeconds} seconds.`
      showToast(msg)
      speakLine(msg)
    },
    [showToast, speakLine],
  )

  const handleSendChat = async (text: string) => {
    playCyberSfx('click')
    const userMsg = {
      id: `u-${Date.now()}`,
      sender: 'user' as const,
      text,
      timestamp: new Date().toISOString(),
    }
    setState((prev) => ({ ...prev, chatHistory: [...prev.chatHistory, userMsg] }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          commanderName: state.commanderName,
          outfit: state.outfit,
          bondLevel: state.bondLevel,
          battery: state.simulatedBattery,
          activeGame: state.activeGame,
          language: state.language,
        }),
      })
      const data = await res.json()
      const moraMsg = {
        id: `m-${Date.now()}`,
        sender: 'mora' as const,
        text: data.reply,
        mood: data.mood,
        timestamp: data.timestamp || new Date().toISOString(),
      }
      setState((prev) => ({ ...prev, chatHistory: [...prev.chatHistory, moraMsg] }))
      grantXp(data.xpGain || 15)
      speakLine(data.reply)
      if (data.createdReminder) {
        handleAddReminder(
          data.createdReminder.title,
          data.createdReminder.delaySeconds,
          state.activeGame,
        )
      }
    } catch {
      const data = localMoraReply({
        message: text,
        commanderName: state.commanderName,
        outfit: state.outfit,
        bondLevel: state.bondLevel,
        battery: state.simulatedBattery,
        activeGame: state.activeGame,
      })
      const moraMsg = {
        id: `m-${Date.now()}`,
        sender: 'mora' as const,
        text: data.reply,
        mood: data.mood,
        timestamp: data.timestamp,
      }
      setState((prev) => ({ ...prev, chatHistory: [...prev.chatHistory, moraMsg] }))
      grantXp(data.xpGain)
      speakLine(data.reply)
      if (data.createdReminder) {
        handleAddReminder(
          data.createdReminder.title,
          data.createdReminder.delaySeconds,
          state.activeGame,
        )
      }
    }
  }

  const cycleStage = () => {
    playCyberSfx('click')
    const ids: Exclude<StageId, 'custom'>[] = ['space', 'lab', 'arena']
    const idx = ids.indexOf(state.stage === 'custom' ? 'space' : state.stage)
    const next = ids[(idx + 1) % ids.length]
    const stageMeta = MORA_STAGES.find((s) => s.id === next)!
    updateState({ stage: next })
    speakLine(`Stage shifted to ${stageMeta.name}!`)
  }

  const cycleZoom = () => {
    playCyberSfx('click')
    const nextZoom = state.zoomLevel === 1 ? 1.5 : state.zoomLevel === 1.5 ? 0.75 : 1
    updateState({ zoomLevel: nextZoom })
  }

  const captureStageSnapshot = async () => {
    playCyberSfx('shutter')
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const stageUrl =
      state.stage === 'custom' && state.customStageUrl
        ? state.customStageUrl
        : (MORA_STAGES.find((s) => s.id === state.stage) || MORA_STAGES[0]).image
    const outfitUrl = (MORA_OUTFITS.find((o) => o.id === state.outfit) || MORA_OUTFITS[0]).image

    const bg = new Image()
    bg.src = stageUrl
    await new Promise<void>((res) => {
      bg.onload = () => res()
      bg.onerror = () => res()
    })
    ctx.drawImage(bg, 0, 0, canvas.width, canvas.height)

    const charImg = new Image()
    charImg.src = outfitUrl
    await new Promise<void>((res) => {
      charImg.onload = () => res()
      charImg.onerror = () => res()
    })
    const drawH = 620
    const drawW = (charImg.width / Math.max(1, charImg.height)) * drawH
    ctx.drawImage(charImg, (canvas.width - drawW) / 2, canvas.height - drawH - 20, drawW, drawH)

    ctx.fillStyle = 'rgba(7, 9, 15, 0.75)'
    ctx.fillRect(24, 24, 350, 42)
    ctx.fillStyle = '#ff2a4b'
    ctx.font = 'bold 18px Orbitron, sans-serif'
    ctx.fillText(`REDMAGIC MORA · ${state.commanderName}`, 38, 51)

    const link = document.createElement('a')
    link.download = `redmagic-mora-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    showToast('Stage snapshot downloaded!')
    speakLine('Snapshot saved! Looking sharp together, Commander!')
  }

  const openModal = (id: ModalId) => {
    playCyberSfx('click')
    setActiveModal(id)
    if (id === 'charging') unlockAchievement('recharge-pod')
    if (id === 'live') unlockAchievement('vtuber-debut')
    if (id === 'gamespace') unlockAchievement('tactical-ace')
  }

  const activeReminder = state.reminders.find((r) => !r.completed)

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#05070d] text-slate-100 select-none">
      {/* Star Shield Eye Comfort Blue-Light Filter */}
      {state.eyeComfortFilter && (
        <div className="fixed inset-0 z-[70] bg-amber-500/15 mix-blend-multiply pointer-events-none" />
      )}

      {/* REDMAGIC OS 12 AI Magic Island */}
      <AiMagicIsland
        enabled={state.magicIslandEnabled}
        isSpeaking={isSpeaking}
        battery={state.simulatedBattery}
        fanSpeedRpm={state.fanSpeedRpm}
        activeGame={state.activeGame}
        nextReminder={activeReminder}
        onOpenCharging={() => openModal('charging')}
        onOpenGameSpace={() => openModal('gamespace')}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full rm-glass-red text-xs font-tech font-bold text-white shadow-xl flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-amber-300" />
          {toast}
        </div>
      )}

      {/* TOP BAR (Exact RedMagic Mora App Header Layout) */}
      <header className="fixed top-0 left-0 right-0 z-30 px-3 sm:px-6 pt-3 flex items-start justify-between pointer-events-none">
        {/* Top-Left: Achievements & Commander Badge */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={() => openModal('achievements')}
            className="rm-skew px-3.5 py-2 rm-glass border border-white/20 hover:border-rose-400 transition-all flex items-center gap-2 shadow-lg"
          >
            <span className="rm-unskew flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" />
              <span className="font-cyber text-[11px] font-bold tracking-wider text-white">
                ACHIEVEMENTS
              </span>
              <span className="px-1.5 py-0.5 rounded bg-rose-500/30 text-[10px] font-cyber text-rose-200">
                {state.unlockedAchievements.length}/{ACHIEVEMENTS.length}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => openModal('achievements')}
            className="hidden md:flex rm-skew px-3 py-2 rm-glass border border-cyan-400/30 text-xs items-center gap-2"
          >
            <span className="rm-unskew flex items-center gap-1.5 font-tech font-bold text-cyan-300">
              <span>{state.commanderName}</span>
              <span className="text-slate-500">·</span>
              <span className="text-rose-300">Bond Lv.{state.bondLevel}</span>
            </span>
          </button>
        </div>

        {/* Top-Right: OS Quick Launchers + Sound + Settings */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={() => openModal('gamespace')}
            title="REDMAGIC Game Space (Mora 2.0/3.0)"
            className="px-2.5 py-2 rounded-xl rm-glass-red hover:scale-105 transition-transform flex items-center gap-1.5 text-xs font-cyber text-white"
          >
            <Gamepad2 className="w-4 h-4 text-rose-300" />
            <span className="hidden sm:inline">GAME SPACE</span>
          </button>

          <button
            type="button"
            onClick={() => openModal('charging')}
            title="Energy Replenishment Charging Pod"
            className="p-2 rounded-xl rm-glass border border-cyan-400/30 hover:border-cyan-300 text-cyan-300"
          >
            <BatteryCharging className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => openModal('alarm')}
            title="Mora Wake-Up Call Alarm"
            className="p-2 rounded-xl rm-glass border border-amber-400/30 hover:border-amber-300 text-amber-300"
          >
            <AlarmClock className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              const nextMuted = !state.muted
              updateState({ muted: nextMuted })
              if (nextMuted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel()
              }
            }}
            title={state.muted ? 'Unmute Mora Voice' : 'Mute Mora Voice'}
            className="p-2 rounded-xl rm-glass border border-white/15 hover:border-rose-400 text-white"
          >
            {state.muted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-cyan-300" />}
          </button>

          <button
            type="button"
            onClick={() => openModal('achievements')}
            title="Settings & Complete Mora Analysis"
            className="p-2 rounded-xl rm-glass border border-white/15 hover:border-white/40 text-slate-200"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* MAIN INTERACTIVE CHARACTER STAGE */}
      <main className="w-full h-full">
        <MoraAvatarStage
          stageRef={stageRef}
          outfit={state.outfit}
          stage={state.stage}
          customStageUrl={state.customStageUrl}
          aura={state.aura}
          zoomLevel={state.zoomLevel}
          isSpeaking={isSpeaking}
          bubbleText={bubbleText}
          chatBubbleVisible={state.chatBubbleVisible}
          onTouchZone={handleTouchZone}
        />
      </main>

      {/* LEFT FLOATING VERTICAL TOOLBAR (Palette, Interactive Desktop, 1X Zoom, Snapshot) */}
      <aside className="fixed left-3 sm:left-5 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2 rm-glass rounded-2xl p-1.5 border border-white/15">
        <button
          type="button"
          onClick={cycleStage}
          title="Switch Stage Background"
          className="w-10 h-10 rounded-xl hover:bg-rose-500/25 flex items-center justify-center text-slate-200 hover:text-white transition-colors"
        >
          <Palette className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !state.interactiveDesktopEnabled
            updateState({ interactiveDesktopEnabled: next })
            if (next) unlockAchievement('desktop-buddy')
            speakLine(
              next
                ? 'Home Screen Interactive Mora enabled! Drag me anywhere on your screen!'
                : 'Returning to full stage mode!',
            )
          }}
          title="Toggle Home Screen Interactive Mora Widget"
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
            state.interactiveDesktopEnabled
              ? 'bg-rose-500 text-white shadow-[0_0_15px_rgba(255,42,75,0.6)]'
              : 'hover:bg-cyan-500/25 text-slate-200'
          }`}
        >
          <Layers className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={cycleZoom}
          title="Cycle Camera Zoom (0.75X / 1X / 1.5X)"
          className="w-10 h-10 rounded-xl hover:bg-white/15 flex items-center justify-center font-cyber text-[11px] font-bold text-cyan-300"
        >
          {state.zoomLevel}X
        </button>
        <button
          type="button"
          onClick={captureStageSnapshot}
          title="Capture Stage Snapshot PNG"
          className="w-10 h-10 rounded-xl hover:bg-rose-500/25 flex items-center justify-center text-slate-200 hover:text-white transition-colors"
        >
          <Crop className="w-5 h-5" />
        </button>
      </aside>

      {/* RIGHT FLOATING SKEWED CARD: MORA DRESS UP (Matches RedMagic Mora UI!) */}
      <div className="fixed right-3 sm:right-6 bottom-28 sm:bottom-32 z-30 flex flex-col gap-2.5 items-end">
        <button
          type="button"
          onClick={() => openModal('dressup')}
          className="group rm-skew px-4 py-3 sm:px-5 sm:py-3.5 rm-glass-red hover:scale-105 transition-all shadow-[0_0_30px_rgba(255,42,75,0.3)]"
        >
          <div className="rm-unskew flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-500/30 border border-rose-300/50 flex items-center justify-center text-white">
              <Shirt className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div className="font-cyber text-xs sm:text-sm font-black text-white leading-tight">
                Mora
                <br />
                Dress up
              </div>
            </div>
          </div>
        </button>

        {/* AI Chat Launcher Pill */}
        <button
          type="button"
          onClick={() => {
            playCyberSfx('click')
            setChatOpen(true)
          }}
          className="rm-skew px-4 py-2 rm-glass border border-cyan-400/50 hover:border-cyan-300 hover:scale-105 transition-all"
        >
          <span className="rm-unskew flex items-center gap-2 text-xs font-cyber font-bold text-cyan-200">
            <Bot className="w-4 h-4 text-cyan-400" />
            AI CHAT
          </span>
        </button>
      </div>

      {/* BOTTOM NAVIGATION: Quick Chat Strip + 4 Iconic RedMagic Mora Skewed Cards */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 pb-3 pt-2 px-3 bg-gradient-to-t from-[#04060c] via-[#04060c]/85 to-transparent">
        <div className="max-w-4xl mx-auto space-y-2.5">
          {/* Quick inline prompt bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!quickChatInput.trim()) return
              const msg = quickChatInput
              setQuickChatInput('')
              handleSendChat(msg)
            }}
            className="max-w-lg mx-auto flex items-center gap-2 rm-glass rounded-full px-3 py-1.5 border border-white/15"
          >
            <MessageSquare className="w-4 h-4 text-rose-400 ml-1 shrink-0" />
            <input
              value={quickChatInput}
              onChange={(e) => setQuickChatInput(e.target.value)}
              placeholder={`Talk to Mora (${state.commanderName})... or ask "2122 lore"`}
              className="flex-1 bg-transparent text-xs sm:text-sm text-white placeholder:text-slate-400 focus:outline-none"
            />
            <button
              type="submit"
              className="px-3 py-1 rounded-full bg-rose-600 hover:bg-rose-500 text-[11px] font-cyber font-bold text-white"
            >
              SEND
            </button>
          </form>

          {/* 4 Main Skewed Navigation Cards (Mora Care · Science & Tech · Mora Live · AR Camera) */}
          <div className="grid grid-cols-4 gap-2 sm:gap-3.5 max-w-3xl mx-auto">
            {[
              { id: 'care' as ModalId, label: 'Mora Care', icon: Heart, accent: 'text-rose-400' },
              { id: 'tech' as ModalId, label: 'Science & Tech', icon: Atom, accent: 'text-cyan-400' },
              { id: 'live' as ModalId, label: 'Mora Live', icon: Video, accent: 'text-pink-400' },
              { id: 'ar' as ModalId, label: 'AR Camera', icon: Camera, accent: 'text-amber-300' },
            ].map((nav) => {
              const Icon = nav.icon
              const active = activeModal === nav.id
              return (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => openModal(nav.id)}
                  className={`rm-skew py-2 sm:py-2.5 px-2 rounded-xl transition-all border ${
                    active
                      ? 'rm-glass-red border-rose-400 scale-[1.03]'
                      : 'rm-glass border-white/15 hover:border-rose-400/60 hover:-translate-y-0.5'
                  }`}
                >
                  <div className="rm-unskew flex flex-col items-center justify-center gap-1">
                    <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${nav.accent}`} />
                    <span className="font-tech font-bold text-[11px] sm:text-xs text-white truncate max-w-full">
                      {nav.label}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </footer>

      {/* HOME SCREEN INTERACTIVE MORA FLOATING WIDGET */}
      <FloatingMoraWidget
        enabled={state.interactiveDesktopEnabled}
        outfit={state.outfit}
        size={state.desktopSize}
        opacity={state.desktopOpacity}
        pos={state.desktopPos}
        onPosChange={(pos) => updateState({ desktopPos: pos })}
        onDisable={() => updateState({ interactiveDesktopEnabled: false })}
        onTap={() => {
          const line = `Desktop Mora reporting in! Battery ${state.simulatedBattery}% · ${state.activeGame} ready!`
          speakLine(line)
          return line
        }}
      />

      {/* AI CHAT DRAWER */}
      <MoraChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={state.chatHistory}
        onSend={handleSendChat}
        commanderName={state.commanderName}
      />

      {/* FEATURE MODALS */}
      <DressUpModal
        open={activeModal === 'dressup'}
        onClose={() => setActiveModal(null)}
        state={state}
        onSelectOutfit={(id) => {
          playCyberSfx('click')
          updateState({ outfit: id })
          unlockAchievement('fashionista')
          const meta = MORA_OUTFITS.find((o) => o.id === id)
          if (meta) speakLine(`Switched to ${meta.name}! How do I look, ${state.commanderName}?`)
        }}
        onSelectStage={(id, customUrl) => {
          playCyberSfx('click')
          updateState({
            stage: id,
            ...(customUrl ? { customStageUrl: customUrl } : {}),
          })
          speakLine('Stage backdrop updated!')
        }}
        onSelectAura={(id) => {
          playCyberSfx('click')
          updateState({ aura: id })
        }}
      />

      <MoraCareModal
        open={activeModal === 'care'}
        onClose={() => setActiveModal(null)}
        state={state}
        onUpdate={updateState}
        onSpeakLine={speakLine}
      />

      <ScienceTechModal
        open={activeModal === 'tech'}
        onClose={() => setActiveModal(null)}
        state={state}
        onUpdate={(patch) => {
          if (patch.interactiveDesktopEnabled) unlockAchievement('desktop-buddy')
          updateState(patch)
        }}
        onOpenCharging={() => openModal('charging')}
      />

      <MoraLiveModal
        open={activeModal === 'live'}
        onClose={() => setActiveModal(null)}
        outfit={state.outfit}
        onSpeakLine={speakLine}
      />

      <ArCameraModal
        open={activeModal === 'ar'}
        onClose={() => setActiveModal(null)}
        outfit={state.outfit}
        gallery={state.arGallery}
        onSavePhoto={(photo: ArPhotoItem) => {
          unlockAchievement('ar-snap')
          setState((prev) => ({
            ...prev,
            arGallery: [photo, ...prev.arGallery.slice(0, 11)],
          }))
        }}
        onSpeakLine={speakLine}
      />

      <GameSpaceModal
        open={activeModal === 'gamespace'}
        onClose={() => setActiveModal(null)}
        state={state}
        onUpdate={updateState}
        onAddReminder={handleAddReminder}
        onSpeakLine={speakLine}
        onUnlockAchievement={unlockAchievement}
      />

      <ChargingPodModal
        open={activeModal === 'charging'}
        onClose={() => setActiveModal(null)}
        battery={state.simulatedBattery}
        chargeStyle={state.chargeStyle}
        onBatteryChange={(val) => updateState({ simulatedBattery: val })}
        onSpeakLine={speakLine}
      />

      <WakeUpAlarmModal
        open={activeModal === 'alarm'}
        onClose={() => setActiveModal(null)}
        alarms={state.alarms}
        commanderName={state.commanderName}
        onUpdateAlarms={(alarms) => updateState({ alarms })}
        onSpeakLine={speakLine}
        onSnoozeScold={() => {
          unlockAchievement('snooze-scolded')
          speakLine(
            `HEY ${state.commanderName}! Did you seriously just hit Snooze?! Time travelers from 2122 NEVER oversleep! Get up right now!`,
          )
        }}
      />

      <AchievementsModal
        open={activeModal === 'achievements'}
        onClose={() => setActiveModal(null)}
        state={state}
        onUpdate={updateState}
        onSpeakLine={speakLine}
      />
    </div>
  )
}

export default App
