import React from 'react'
import { Atom, BatteryCharging, Cpu, Fan, LayoutGrid, Sparkles } from 'lucide-react'
import type { ChargeStyle, MoraState } from '../../types/mora'
import { CyberModal } from '../CyberModal'

interface ScienceTechModalProps {
  open: boolean
  onClose: () => void
  state: MoraState
  onUpdate: (patch: Partial<MoraState>) => void
  onOpenCharging: () => void
}

export const ScienceTechModal: React.FC<ScienceTechModalProps> = ({
  open,
  onClose,
  state,
  onUpdate,
  onOpenCharging,
}) => {
  return (
    <CyberModal
      open={open}
      onClose={onClose}
      title="Science & Technology Center"
      subtitle="Interactive Home Screen MIRA, Energy Replenishment, AI Magic Island & RedCore R4"
      icon={<Atom className="w-5 h-5" />}
    >
      <div className="space-y-5">
        {/* Interactive Home Screen MIRA */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <LayoutGrid className="w-5 h-5 text-rose-400 shrink-0" />
              <div>
                <div className="font-bold text-sm text-white">Home Screen Interactive MIRA</div>
                <div className="text-xs text-slate-400">
                  Floating draggable MIRA widget that stays active across your screen
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onUpdate({ interactiveDesktopEnabled: !state.interactiveDesktopEnabled })}
              className={`px-4 py-1.5 rounded-full text-xs font-cyber font-bold transition-all ${
                state.interactiveDesktopEnabled
                  ? 'bg-rose-500 text-white shadow-[0_0_16px_rgba(255,42,75,0.6)]'
                  : 'bg-white/10 text-slate-300'
              }`}
            >
              {state.interactiveDesktopEnabled ? 'ENABLED' : 'OFF'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/10">
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Desktop Size</span>
                <span className="font-cyber text-cyan-300">{state.desktopSize}px</span>
              </div>
              <input
                type="range"
                min={80}
                max={210}
                value={state.desktopSize}
                onChange={(e) => onUpdate({ desktopSize: Number(e.target.value) })}
                className="w-full accent-rose-500"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Transparency / Opacity</span>
                <span className="font-cyber text-cyan-300">{state.desktopOpacity}%</span>
              </div>
              <input
                type="range"
                min={35}
                max={100}
                value={state.desktopOpacity}
                onChange={(e) => onUpdate({ desktopOpacity: Number(e.target.value) })}
                className="w-full accent-cyan-400"
              />
            </div>
          </div>
        </div>

        {/* Energy Replenishment Compartment */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BatteryCharging className="w-5 h-5 text-cyan-400 shrink-0" />
              <div>
                <div className="font-bold text-sm text-white">Energy Replenishment Compartment</div>
                <div className="text-xs text-slate-400">
                  Interactive Always-On charging pod animation (Sleeping or Floating MIRA)
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenCharging()
                }}
                className="px-3 py-1.5 rounded-xl bg-cyan-500/20 border border-cyan-400/50 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30"
              >
                Launch Charging Pod
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdate({ energyReplenishmentEnabled: !state.energyReplenishmentEnabled })
                }
                className={`px-3.5 py-1.5 rounded-full text-xs font-cyber font-bold ${
                  state.energyReplenishmentEnabled ? 'bg-cyan-500 text-slate-950' : 'bg-white/10 text-slate-300'
                }`}
              >
                {state.energyReplenishmentEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-2">
            {(['sleeping', 'floating'] as ChargeStyle[]).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => onUpdate({ chargeStyle: style })}
                className={`p-2.5 rounded-xl border text-xs font-semibold capitalize ${
                  state.chargeStyle === style
                    ? 'bg-cyan-500/20 border-cyan-400 text-white'
                    : 'bg-black/25 border-white/10 text-slate-400'
                }`}
              >
                {style === 'sleeping' ? 'Sleeping Energy Pod (AOD)' : 'Floating Cyber Recharge'}
              </button>
            ))}
          </div>
        </div>

        {/* AI Magic Island & Cooling Fan */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-pink-400" />
              <div>
                <div className="font-bold text-sm text-white">AI Magic Island (OS 12)</div>
                <div className="text-xs text-slate-400">Status-bar live pill & alerts</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onUpdate({ magicIslandEnabled: !state.magicIslandEnabled })}
              className={`px-3.5 py-1.5 rounded-full text-xs font-cyber font-bold ${
                state.magicIslandEnabled ? 'bg-rose-500 text-white' : 'bg-white/10 text-slate-300'
              }`}
            >
              {state.magicIslandEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Fan
                className={`w-5 h-5 text-cyan-400 ${state.fanSpeedRpm > 0 ? 'animate-spin' : ''}`}
              />
              <div>
                <div className="font-bold text-sm text-white">Turbo Cooling Fan</div>
                <div className="text-xs text-slate-400">
                  {state.fanSpeedRpm > 0 ? '24,000 RPM Active · AquaCore' : 'Standby (0 RPM)'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onUpdate({ fanSpeedRpm: state.fanSpeedRpm > 0 ? 0 : 24000 })}
              className={`px-3.5 py-1.5 rounded-full text-xs font-cyber font-bold ${
                state.fanSpeedRpm > 0 ? 'bg-cyan-500 text-slate-950' : 'bg-white/10 text-slate-300'
              }`}
            >
              {state.fanSpeedRpm > 0 ? '24K' : 'OFF'}
            </button>
          </div>
        </div>

        {/* RedCore Telemetry Bar */}
        <div className="rounded-2xl bg-black/40 border border-white/10 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <Cpu className="w-4 h-4 text-rose-400" />
            <span>Snapdragon 8 Elite + RedCore R4 Neural Engine</span>
          </div>
          <div className="flex gap-4 font-cyber text-[11px]">
            <span className="text-emerald-400">THERMAL: {state.fanSpeedRpm > 0 ? '35.8°C' : '41.2°C'}</span>
            <span className="text-cyan-400">LATENCY: 0.1ms</span>
            <span className="text-rose-400">MIRA OS: v3.0</span>
          </div>
        </div>
      </div>
    </CyberModal>
  )
}
