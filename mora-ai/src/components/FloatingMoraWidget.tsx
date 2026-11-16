import React, { useRef, useState } from 'react'
import { MORA_OUTFITS } from '../data/moraData'
import type { OutfitId } from '../types/mora'
import { MessageCircle, X } from 'lucide-react'

interface FloatingMoraWidgetProps {
  enabled: boolean
  outfit: OutfitId
  size: number
  opacity: number
  pos: { x: number; y: number }
  onPosChange: (pos: { x: number; y: number }) => void
  onTap: () => string
  onDisable: () => void
}

export const FloatingMoraWidget: React.FC<FloatingMoraWidgetProps> = ({
  enabled,
  outfit,
  size,
  opacity,
  pos,
  onPosChange,
  onTap,
  onDisable,
}) => {
  const [miniBubble, setMiniBubble] = useState('')
  const dragging = useRef(false)
  const moved = useRef(false)

  if (!enabled) return null

  const outfitMeta = MORA_OUTFITS.find((o) => o.id === outfit) || MORA_OUTFITS[0]

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    moved.current = false
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    moved.current = true
    const nx = Math.min(92, Math.max(8, (e.clientX / window.innerWidth) * 100))
    const ny = Math.min(88, Math.max(12, (e.clientY / window.innerHeight) * 100))
    onPosChange({ x: nx, y: ny })
  }

  const onPointerUp = () => {
    if (dragging.current && !moved.current) {
      const line = onTap()
      setMiniBubble(line)
      setTimeout(() => setMiniBubble(''), 3400)
    }
    dragging.current = false
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        opacity: opacity / 100,
        transform: 'translate(-50%, -50%)',
      }}
      className="fixed z-50 cursor-grab active:cursor-grabbing select-none group"
    >
      {miniBubble && (
        <div className="absolute -top-14 left-1/2 -translate-x-1/2 w-48 rm-glass rounded-xl px-2.5 py-1.5 text-[11px] text-white border border-rose-500/40 pointer-events-none shadow-lg">
          <div className="flex items-center gap-1 text-rose-400 font-cyber text-[9px] mb-0.5">
            <MessageCircle className="w-2.5 h-2.5" /> DESKTOP MORA
          </div>
          <p className="line-clamp-2 leading-tight">{miniBubble}</p>
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDisable()
        }}
        title="Hide Interactive Desktop Mora"
        className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-2 -right-2 z-10 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center shadow"
      >
        <X className="w-3 h-3" />
      </button>

      <div className="relative animate-mora-float" style={{ width: size, height: size * 1.45 }}>
        <img
          src={outfitMeta.image}
          alt="Interactive Desktop Mora"
          draggable={false}
          className="w-full h-full object-contain drop-shadow-[0_8px_18px_rgba(255,42,75,0.45)]"
        />
      </div>
    </div>
  )
}
