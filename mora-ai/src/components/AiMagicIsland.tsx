import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BatteryCharging, Bell, Cpu, Fan, Volume2 } from 'lucide-react'
import type { MoraReminder } from '../types/mora'

interface AiMagicIslandProps {
  enabled: boolean
  isSpeaking: boolean
  battery: number
  fanSpeedRpm: number
  activeGame: string
  nextReminder?: MoraReminder
  onOpenCharging: () => void
  onOpenGameSpace: () => void
}

export const AiMagicIsland: React.FC<AiMagicIslandProps> = ({
  enabled,
  isSpeaking,
  battery,
  fanSpeedRpm,
  activeGame,
  nextReminder,
  onOpenCharging,
  onOpenGameSpace,
}) => {
  const [expanded, setExpanded] = useState(false)

  if (!enabled) return null

  const secsLeft = nextReminder
    ? Math.max(0, Math.round((nextReminder.triggerAt - Date.now()) / 1000))
    : null

  return (
    <div className="fixed top-2.5 left-1/2 -translate-x-1/2 z-40">
      <motion.div
        layout
        onClick={() => setExpanded((v) => !v)}
        className="cursor-pointer rounded-full bg-[#090d18]/95 border border-rose-500/45 shadow-[0_0_25px_rgba(255,42,75,0.28)] px-3.5 py-1.5 backdrop-blur-xl transition-all"
      >
        <div className="flex items-center gap-2.5 text-[11px] font-tech tracking-wide">
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isSpeaking ? 'bg-cyan-400' : 'bg-rose-500'
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isSpeaking ? 'bg-cyan-400' : 'bg-rose-500'
              }`}
            />
          </span>

          <span className="font-cyber text-[10px] tracking-widest text-white">
            AI MAGIC ISLAND
          </span>

          {isSpeaking ? (
            <span className="flex items-center gap-1 text-cyan-300">
              <Volume2 className="w-3.5 h-3.5 animate-pulse" />
              Mora Speaking
            </span>
          ) : nextReminder && secsLeft !== null ? (
            <span className="flex items-center gap-1 text-amber-300">
              <Bell className="w-3.5 h-3.5 animate-bounce" />
              {nextReminder.title} ({secsLeft}s)
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-slate-300">
              <BatteryCharging
                className={`w-3.5 h-3.5 ${battery <= 20 ? 'text-rose-400 animate-pulse' : 'text-emerald-400'}`}
              />
              {battery}%
              <span className="text-slate-600">|</span>
              <Fan className={`w-3.5 h-3.5 text-cyan-400 ${fanSpeedRpm > 0 ? 'animate-spin' : ''}`} />
              {fanSpeedRpm > 0 ? '24K RPM' : 'Silent'}
            </span>
          )}
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden pt-2 mt-2 border-t border-white/10"
            >
              <div className="flex items-center justify-between gap-4 text-[11px] text-slate-300 pb-1">
                <div className="flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-rose-400" />
                  <span>RedCore R4 · {activeGame}</span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenCharging()
                    }}
                    className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/30"
                  >
                    Pod Charge
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenGameSpace()
                    }}
                    className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-400/40 text-rose-200 hover:bg-rose-500/30"
                  >
                    Game Space
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
