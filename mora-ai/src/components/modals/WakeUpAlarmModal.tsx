import React, { useState } from 'react'
import { AlarmClock, BellRing, Plus, Trash2, Volume2 } from 'lucide-react'
import type { MoraAlarm } from '../../types/mora'
import { playCyberSfx } from '../../utils/speech'
import { CyberModal } from '../CyberModal'

interface WakeUpAlarmModalProps {
  open: boolean
  onClose: () => void
  alarms: MoraAlarm[]
  commanderName: string
  onUpdateAlarms: (alarms: MoraAlarm[]) => void
  onSpeakLine: (line: string) => void
  onSnoozeScold: () => void
}

export const WakeUpAlarmModal: React.FC<WakeUpAlarmModalProps> = ({
  open,
  onClose,
  alarms,
  commanderName,
  onUpdateAlarms,
  onSpeakLine,
  onSnoozeScold,
}) => {
  const [newTime, setNewTime] = useState('07:00')
  const [newLabel, setNewLabel] = useState('Daily Training Wake-Up')
  const [ringingAlarm, setRingingAlarm] = useState<MoraAlarm | null>(null)

  const addAlarm = (e: React.FormEvent) => {
    e.preventDefault()
    const item: MoraAlarm = {
      id: `alarm-${Date.now()}`,
      time: newTime,
      label: newLabel.trim() || 'MIRA Wake-Up Call',
      enabled: true,
      snoozeScold: true,
      days: ['Daily'],
    }
    onUpdateAlarms([...alarms, item])
    onSpeakLine(`Wake-Up Call set for ${newTime}! Don't even think about snoozing, ${commanderName}!`)
  }

  const triggerTestRing = (alarm: MoraAlarm) => {
    playCyberSfx('alarm')
    setRingingAlarm(alarm)
    onSpeakLine(
      `Good morning ${commanderName}! Time for ${alarm.label}! Wake up right now or I'll activate full-volume scold mode!`,
    )
  }

  const handleSnooze = () => {
    setRingingAlarm(null)
    onSnoozeScold()
  }

  return (
    <CyberModal
      open={open}
      onClose={onClose}
      title="MIRA Awakening — Wake-Up Call"
      subtitle="Personalized voice alarms with classic RedMagic Snooze-Scolding AI"
      icon={<AlarmClock className="w-5 h-5" />}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-5">
        {ringingAlarm && (
          <div className="rounded-2xl bg-gradient-to-r from-rose-600/35 to-amber-500/25 border-2 border-rose-400 p-4 flex flex-col sm:flex-row items-center justify-between gap-4 animate-pulse">
            <div className="flex items-center gap-3">
              <BellRing className="w-8 h-8 text-amber-300 animate-bounce" />
              <div>
                <div className="font-cyber text-lg font-black text-white">
                  {ringingAlarm.time} — {ringingAlarm.label}
                </div>
                <div className="text-xs text-rose-200">
                  MIRA is calling you! Hit Snooze to test her famous scolding reaction.
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSnooze}
                className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400"
              >
                Snooze (+5m)
              </button>
              <button
                type="button"
                onClick={() => {
                  setRingingAlarm(null)
                  onSpeakLine(`Awesome energy, ${commanderName}! Let's crush today's missions!`)
                }}
                className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400"
              >
                I’m Awake!
              </button>
            </div>
          </div>
        )}

        {/* Create Alarm */}
        <form
          onSubmit={addAlarm}
          className="rounded-2xl bg-white/5 border border-white/10 p-4 flex flex-wrap items-end gap-3"
        >
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Alarm Time</label>
            <input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] text-slate-400 mb-1">Mission / Label</label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-full bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-sm text-white"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add Alarm
          </button>
        </form>

        {/* Alarm List */}
        <div className="space-y-2.5">
          {alarms.map((a) => (
            <div
              key={a.id}
              className="rounded-2xl bg-white/5 border border-white/10 p-4 flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <div className="font-cyber text-2xl font-bold text-white">{a.time}</div>
                <div className="text-xs text-slate-300">
                  {a.label} · <span className="text-rose-300">Snooze Scolding {a.snoozeScold ? 'ON' : 'OFF'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerTestRing(a)}
                  className="px-3 py-1.5 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-xs text-cyan-200 hover:bg-cyan-500/30 flex items-center gap-1.5"
                >
                  <Volume2 className="w-3.5 h-3.5" /> Ring Now
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateAlarms(
                      alarms.map((item) =>
                        item.id === a.id ? { ...item, enabled: !item.enabled } : item,
                      ),
                    )
                  }
                  className={`px-3.5 py-1.5 rounded-full text-xs font-cyber font-bold ${
                    a.enabled ? 'bg-rose-500 text-white' : 'bg-white/10 text-slate-400'
                  }`}
                >
                  {a.enabled ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateAlarms(alarms.filter((item) => item.id !== a.id))}
                  className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/25 text-slate-400 hover:text-rose-300"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </CyberModal>
  )
}
