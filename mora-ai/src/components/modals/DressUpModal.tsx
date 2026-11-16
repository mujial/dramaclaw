import React from 'react'
import { Check, Image as ImageIcon, ImagePlus, Palette, Shirt, Sparkles, Wallpaper } from 'lucide-react'
import { AURA_THEMES, MORA_OUTFITS, MORA_STAGES } from '../../data/moraData'
import type { AuraColorId, MoraState, OutfitId, StageId } from '../../types/mora'
import { nativeSetLiveWallpaper, nativeSetStaticWallpaper } from '../../utils/miraNative'
import { CyberModal } from '../CyberModal'

interface DressUpModalProps {
  open: boolean
  onClose: () => void
  state: MoraState
  onSelectOutfit: (id: OutfitId) => void
  onSelectStage: (id: StageId, customUrl?: string) => void
  onSelectAura: (id: AuraColorId) => void
}

export const DressUpModal: React.FC<DressUpModalProps> = ({
  open,
  onClose,
  state,
  onSelectOutfit,
  onSelectStage,
  onSelectAura,
}) => {
  const handleCustomBg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onSelectStage('custom', reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <CyberModal
      open={open}
      onClose={onClose}
      title="MIRA Dress Up Studio"
      subtitle="Customize 3D/2D skins, Chibi Magic Buddy, holographic aura, and stage environment"
      icon={<Shirt className="w-5 h-5" />}
    >
      <div className="space-y-6">
        {/* Outfits Grid */}
        <div>
          <h3 className="font-cyber text-xs uppercase tracking-widest text-rose-400 mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Character Skins & Outfits
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {MORA_OUTFITS.map((item) => {
              const active = state.outfit === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectOutfit(item.id)}
                  className={`group relative rounded-2xl p-3 text-left border transition-all ${
                    active
                      ? 'bg-rose-500/15 border-rose-400 shadow-[0_0_25px_rgba(255,42,75,0.28)]'
                      : 'bg-white/5 border-white/10 hover:border-white/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-cyber px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-200">
                      {item.badge}
                    </span>
                    {active && (
                      <span className="w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <div className="h-44 flex items-center justify-center bg-black/30 rounded-xl p-2 mb-2.5 overflow-hidden">
                    <img
                      src={item.image}
                      alt={item.name}
                      className="h-full object-contain group-hover:scale-105 transition-transform"
                    />
                  </div>
                  <div className="font-tech font-bold text-sm text-white">{item.name}</div>
                  <div className="text-[11px] text-cyan-300 mb-1">{item.era}</div>
                  <p className="text-[11px] text-slate-400 leading-snug">{item.lore}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Stage Wallpapers */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-cyber text-xs uppercase tracking-widest text-cyan-400 flex items-center gap-2">
              <Palette className="w-4 h-4" /> Stage Backgrounds & Wallpapers
            </h3>
            <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white transition-colors">
              <ImagePlus className="w-3.5 h-3.5 text-cyan-300" />
              Upload Custom BG
              <input type="file" accept="image/*" onChange={handleCustomBg} className="hidden" />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {MORA_STAGES.map((st) => {
              const active = state.stage === st.id
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onSelectStage(st.id)}
                  className={`relative rounded-xl overflow-hidden border text-left transition-all ${
                    active
                      ? 'border-cyan-400 shadow-[0_0_20px_rgba(0,240,255,0.3)]'
                      : 'border-white/10 hover:border-white/30'
                  }`}
                >
                  <img src={st.image} alt={st.name} className="w-full h-28 object-cover" />
                  <div className="p-2.5 bg-slate-900/90 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-white">{st.name}</div>
                      <div className="text-[11px] text-slate-400">{st.subtitle}</div>
                    </div>
                    {active && <Check className="w-4 h-4 text-cyan-400" />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Holographic Aura */}
        <div>
          <h3 className="font-cyber text-xs uppercase tracking-widest text-amber-300 mb-3">
            Holographic Stage Aura
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {(Object.keys(AURA_THEMES) as AuraColorId[]).map((key) => {
              const theme = AURA_THEMES[key]
              const active = state.aura === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectAura(key)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${
                    active ? 'border-white bg-white/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: theme.primary, boxShadow: `0 0 12px ${theme.primary}` }}
                  />
                  <span className="text-xs font-medium text-white truncate">{theme.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Apply Current Look as Phone Wallpaper */}
        <div className="rounded-2xl border border-cyan-400/35 bg-cyan-950/30 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Wallpaper className="w-5 h-5 text-cyan-300 shrink-0" />
            <div>
              <div className="text-xs font-bold text-white">Apply This MIRA Look to Mobile Wallpaper</div>
              <div className="text-[11px] text-slate-400">
                Uses your selected outfit &amp; stage on your Android Home/Lock screen!
              </div>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void nativeSetLiveWallpaper(state.outfit, state.stage, state.commanderName)}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-600 text-xs font-bold text-white"
            >
              Live Wallpaper
            </button>
            <button
              type="button"
              onClick={() => void nativeSetStaticWallpaper(state.outfit, state.stage, state.commanderName)}
              className="px-3 py-1.5 rounded-xl border border-white/20 bg-white/10 text-xs font-bold text-white flex items-center gap-1"
            >
              <ImageIcon className="w-3.5 h-3.5" /> Static
            </button>
          </div>
        </div>
      </div>
    </CyberModal>
  )
}
