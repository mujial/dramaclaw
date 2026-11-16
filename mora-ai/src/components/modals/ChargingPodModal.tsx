import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BatteryCharging, Flame, Pause, Play, Sparkles, X, Zap } from 'lucide-react'
import type { ChargeStyle } from '../../types/mora'

interface ChargingPodModalProps {
  open: boolean
  onClose: () => void
  battery: number
  chargeStyle: ChargeStyle
  onBatteryChange: (val: number) => void
  onSpeakLine: (line: string) => void
}

export const ChargingPodModal: React.FC<ChargingPodModalProps> = ({
  open,
  onClose,
  battery,
  chargeStyle,
  onBatteryChange,
  onSpeakLine,
}) => {
  const [chargingActive, setChargingActive] = useState(true)
  const [wattage, setWattage] = useState(120)

  useEffect(() => {
    if (!open || !chargingActive) return
    const timer = setInterval(() => {
      onBatteryChange(battery >= 100 ? 100 : battery + 1)
    }, 900)
    return () => clearInterval(timer)
  }, [open, chargingActive, battery, onBatteryChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-[#04070e] flex flex-col items-center justify-between p-5 overflow-hidden">
      {/* Background art */}
      <img
        src={chargeStyle === 'sleeping' ? '/assets/mora-charging.png' : '/assets/bg-space-bridge.png'}
        alt="Energy Replenishment Pod"
        className="absolute inset-0 w-full h-full object-cover opacity-55"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#04070e] via-[#04070e]/40 to-[#04070e]/85" />

      {/* Top HUD */}
      <div className="relative z-10 w-full max-w-4xl flex items-center justify-between">
        <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full rm-glass border border-cyan-400/40">
          <BatteryCharging className="w-4 h-4 text-cyan-400 animate-pulse" />
          <span className="font-cyber text-xs tracking-widest text-cyan-200">
            ENERGY REPLENISHMENT COMPARTMENT
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2.5 rounded-full rm-glass border border-white/20 text-white hover:border-rose-400"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Center Interactive Pod */}
      <div className="relative z-10 flex flex-col items-center text-center my-auto">
        {chargeStyle === 'floating' && (
          <motion.img
            src="/assets/mora-cyber-cutout.png"
            alt="Floating Mora Recharge"
            animate={{ y: [-10, 10, -10] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="h-56 sm:h-64 object-contain mb-3 drop-shadow-[0_0_28px_rgba(0,240,255,0.65)]"
          />
        )}

        <div className="relative w-44 h-44 sm:w-52 sm:h-52 rounded-full flex flex-col items-center justify-center rm-glass border-2 border-cyan-400/60 shadow-[0_0_55px_rgba(0,240,255,0.35)]">
          <div className="text-[11px] font-cyber tracking-widest text-cyan-300 uppercase">
            {battery >= 100 ? 'FULLY CHARGED' : 'TURBO RECHARGE'}
          </div>
          <div className="font-cyber text-5xl font-black text-white my-1">
            {battery}
            <span className="text-2xl text-cyan-400">%</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-rose-300 font-tech font-bold">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            {chargingActive && battery < 100 ? `${wattage}W MAX CHARGE` : 'TRICKLE HOLD'}
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            onSpeakLine(
              battery >= 100
                ? 'Energy core at 100%! Ready to dominate the battlefield, Commander!'
                : `Recharging at ${wattage} watts inside the pod... just resting my eyes until we queue up!`,
            )
          }
          className="mt-5 px-4 py-2 rounded-full rm-glass border border-rose-400/40 text-xs text-rose-200 hover:bg-rose-500/20 flex items-center gap-2"
        >
          <Sparkles className="w-3.5 h-3.5 text-rose-400" />
          Tap Pod to Wake / Hear Mora
        </button>
      </div>

      {/* Bottom Telemetry & Controls */}
      <div className="relative z-10 w-full max-w-2xl rm-glass rounded-2xl p-4 border border-white/15 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-slate-300">
          <span className="flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-cyan-400" /> AquaCore 34.2°C
          </span>
          <span>Mode: {chargeStyle === 'sleeping' ? 'Sleeping Pod' : 'Floating Aura'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWattage((w) => (w === 120 ? 80 : 120))}
            className="px-3 py-1.5 rounded-xl bg-white/10 text-xs text-white hover:bg-white/20"
          >
            {wattage}W Charger
          </button>
          <button
            type="button"
            onClick={() => onBatteryChange(18)}
            className="px-3 py-1.5 rounded-xl bg-white/10 text-xs text-amber-300 hover:bg-white/20"
          >
            Reset 18%
          </button>
          <button
            type="button"
            onClick={() => setChargingActive((v) => !v)}
            className="px-3.5 py-1.5 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1.5"
          >
            {chargingActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {chargingActive ? 'Pause' : 'Resume'}
          </button>
        </div>
      </div>
    </div>
  )
}
