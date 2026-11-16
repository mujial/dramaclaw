import React from 'react'
import { BatteryWarning, Eye, HeartHandshake, MessageSquare, Wifi, WifiOff } from 'lucide-react'
import type { CareFrequency, MoraState } from '../../types/mora'
import { CyberModal } from '../CyberModal'

interface MoraCareModalProps {
  open: boolean
  onClose: () => void
  state: MoraState
  onUpdate: (patch: Partial<MoraState>) => void
  onSpeakLine: (line: string) => void
}

const FREQS: { id: CareFrequency; label: string; desc: string }[] = [
  { id: 'off', label: 'Off', desc: 'Silent' },
  { id: 'low', label: 'Low', desc: 'Essential alerts only' },
  { id: 'medium', label: 'Medium', desc: 'Balanced daily care' },
  { id: 'high', label: 'High', desc: 'Active companion' },
]

export const MoraCareModal: React.FC<MoraCareModalProps> = ({
  open,
  onClose,
  state,
  onUpdate,
  onSpeakLine,
}) => {
  const triggerBatteryAlert = () => {
    onUpdate({ simulatedBattery: Math.max(8, state.lowBatteryThreshold - 4) })
    onSpeakLine(
      `Warning ${state.commanderName}! Battery dropped below ${state.lowBatteryThreshold}%! Plug into the Energy Replenishment Compartment before ranked combat!`,
    )
  }

  const triggerPingAlert = () => {
    onUpdate({ simulatedPingMs: 215 })
    onSpeakLine(
      `Signal alert, ${state.commanderName}! Network latency spiked to 215 milliseconds. Switching RedMagic dual-WLAN acceleration!`,
    )
  }

  const triggerMoodCheck = (mood: string) => {
    if (mood === 'tired') {
      onSpeakLine(
        `Take a breather, ${state.commanderName}! Enabling Star Shield Eye Comfort mode. Drink some water and rest your eyes for two minutes!`,
      )
      onUpdate({ eyeComfortFilter: true })
    } else if (mood === 'hyped') {
      onSpeakLine(
        `That's the RedMagic spirit! Let's jump into Game Space and push that win rate past 90 percent!`,
      )
    } else {
      onSpeakLine(
        `Steady and focused! I'm monitoring system thermals and your wellness right beside you.`,
      )
    }
  }

  return (
    <CyberModal
      open={open}
      onClose={onClose}
      title="MIRA Care"
      subtitle="System & life inquiries, low-battery & signal alerts, Star Shield eye comfort"
      icon={<HeartHandshake className="w-5 h-5" />}
    >
      <div className="space-y-5">
        {/* Check-in Frequency */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="text-xs font-cyber uppercase tracking-widest text-rose-400 mb-3">
            System & Life Inquiry Frequency
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {FREQS.map((f) => {
              const active = state.careFrequency === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    onUpdate({ careFrequency: f.id })
                    onSpeakLine(`MIRA Care frequency set to ${f.label}.`)
                  }}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    active
                      ? 'bg-rose-500/20 border-rose-400 text-white'
                      : 'bg-black/25 border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <div className="font-bold text-sm">{f.label}</div>
                  <div className="text-[11px] text-slate-400">{f.desc}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Battery & Signal Alerts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-bold text-sm text-white">
                <BatteryWarning className="w-4 h-4 text-amber-400" />
                Low Battery Alert
              </span>
              <span className="font-cyber text-xs text-rose-300">
                Alert &lt; {state.lowBatteryThreshold}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={40}
              value={state.lowBatteryThreshold}
              onChange={(e) => onUpdate({ lowBatteryThreshold: Number(e.target.value) })}
              className="w-full accent-rose-500"
            />
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Simulated Battery: {state.simulatedBattery}%</span>
              <button
                type="button"
                onClick={triggerBatteryAlert}
                className="px-3 py-1 rounded-lg bg-amber-500/20 border border-amber-400/40 text-amber-200 hover:bg-amber-500/30"
              >
                Test Low Battery Voice
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-bold text-sm text-white">
                <Wifi className="w-4 h-4 text-cyan-400" />
                Low Signal & Ping Monitor
              </span>
              <span className="font-cyber text-xs text-cyan-300">{state.simulatedPingMs} ms</span>
            </div>
            <input
              type="range"
              min={15}
              max={250}
              value={state.simulatedPingMs}
              onChange={(e) => onUpdate({ simulatedPingMs: Number(e.target.value) })}
              className="w-full accent-cyan-400"
            />
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Threshold: 150ms spike</span>
              <button
                type="button"
                onClick={triggerPingAlert}
                className="px-3 py-1 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/30"
              >
                Simulate Signal Alert
              </button>
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => onUpdate({ eyeComfortFilter: !state.eyeComfortFilter })}
            className={`p-3.5 rounded-xl border text-left transition-all ${
              state.eyeComfortFilter
                ? 'bg-amber-500/20 border-amber-400'
                : 'bg-white/5 border-white/10'
            }`}
          >
            <Eye className="w-4 h-4 text-amber-300 mb-1.5" />
            <div className="font-bold text-xs text-white">Star Shield Eye Comfort</div>
            <div className="text-[11px] text-slate-400">
              {state.eyeComfortFilter ? 'ON — Blue-light warmth active' : 'OFF — Standard AMOLED'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onUpdate({ chatBubbleVisible: !state.chatBubbleVisible })}
            className={`p-3.5 rounded-xl border text-left transition-all ${
              state.chatBubbleVisible
                ? 'bg-rose-500/20 border-rose-400'
                : 'bg-white/5 border-white/10'
            }`}
          >
            <MessageSquare className="w-4 h-4 text-rose-300 mb-1.5" />
            <div className="font-bold text-xs text-white">Dialogue Chat Bubbles</div>
            <div className="text-[11px] text-slate-400">
              {state.chatBubbleVisible ? 'Shown on stage' : 'Hidden'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onUpdate({ muteOnWifi: !state.muteOnWifi })}
            className={`p-3.5 rounded-xl border text-left transition-all ${
              state.muteOnWifi
                ? 'bg-cyan-500/20 border-cyan-400'
                : 'bg-white/5 border-white/10'
            }`}
          >
            <WifiOff className="w-4 h-4 text-cyan-300 mb-1.5" />
            <div className="font-bold text-xs text-white">Mute on Public Wi-Fi</div>
            <div className="text-[11px] text-slate-400">
              {state.muteOnWifi ? 'Auto-silenced on Wi-Fi' : 'Voice active on Wi-Fi'}
            </div>
          </button>
        </div>

        {/* Life Check-in */}
        <div className="rounded-2xl bg-gradient-to-r from-rose-500/15 to-cyan-500/10 border border-rose-400/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-white">
              “Hey {state.commanderName}, how are you feeling right now?”
            </div>
            <div className="text-xs text-slate-300">
              MIRA Care logs your daily vibe and adjusts eye comfort & cheer lines.
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => triggerMoodCheck('hyped')}
              className="px-3 py-1.5 rounded-xl bg-rose-500/25 border border-rose-400/50 text-xs font-semibold text-white hover:bg-rose-500/40"
            >
              Hyped!
            </button>
            <button
              type="button"
              onClick={() => triggerMoodCheck('chill')}
              className="px-3 py-1.5 rounded-xl bg-cyan-500/25 border border-cyan-400/50 text-xs font-semibold text-white hover:bg-cyan-500/40"
            >
              Focused
            </button>
            <button
              type="button"
              onClick={() => triggerMoodCheck('tired')}
              className="px-3 py-1.5 rounded-xl bg-amber-500/25 border border-amber-400/50 text-xs font-semibold text-white hover:bg-amber-500/40"
            >
              Tired
            </button>
          </div>
        </div>
      </div>
    </CyberModal>
  )
}
