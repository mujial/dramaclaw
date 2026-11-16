import React, { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, Sparkles, Volume2, Zap } from 'lucide-react'
import { AURA_THEMES, MORA_OUTFITS, MORA_STAGES } from '../data/moraData'
import type { AuraColorId, OutfitId, StageId } from '../types/mora'

interface FloatingTapFx {
  id: number
  x: number
  y: number
  zone: 'head' | 'face' | 'outfit' | 'hands'
}

interface MoraAvatarStageProps {
  outfit: OutfitId
  stage: StageId
  customStageUrl: string
  aura: AuraColorId
  zoomLevel: 0.75 | 1 | 1.5
  isSpeaking: boolean
  bubbleText: string
  chatBubbleVisible: boolean
  onTouchZone: (zone: 'head' | 'face' | 'outfit' | 'hands') => void
  stageRef?: React.RefObject<HTMLDivElement | null>
}

export const MoraAvatarStage: React.FC<MoraAvatarStageProps> = ({
  outfit,
  stage,
  customStageUrl,
  aura,
  zoomLevel,
  isSpeaking,
  bubbleText,
  chatBubbleVisible,
  onTouchZone,
  stageRef,
}) => {
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [tapFx, setTapFx] = useState<FloatingTapFx[]>([])
  const fxCounter = useRef(0)

  const outfitMeta = MORA_OUTFITS.find((o) => o.id === outfit) || MORA_OUTFITS[0]
  const stageImage =
    stage === 'custom' && customStageUrl
      ? customStageUrl
      : (MORA_STAGES.find((s) => s.id === stage) || MORA_STAGES[0]).image
  const auraTheme = AURA_THEMES[aura]

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width - 0.5
    const ny = (e.clientY - rect.top) / rect.height - 0.5
    setTilt({ x: nx * 10, y: ny * -8 })
  }

  const triggerZone = (
    zone: 'head' | 'face' | 'outfit' | 'hands',
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation()
    const rect = e.currentTarget.closest('[data-stage-root]')?.getBoundingClientRect()
    const x = rect ? e.clientX - rect.left : 200
    const y = rect ? e.clientY - rect.top : 200
    const id = ++fxCounter.current
    setTapFx((prev) => [...prev.slice(-6), { id, x, y, zone }])
    setTimeout(() => {
      setTapFx((prev) => prev.filter((item) => item.id !== id))
    }, 950)
    onTouchZone(zone)
  }

  const scaleVal = zoomLevel === 1.5 ? 1.38 : zoomLevel === 0.75 ? 0.8 : 1
  const translateYVal = zoomLevel === 1.5 ? '13%' : '0%'

  return (
    <div
      ref={stageRef}
      data-stage-root
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
      className="relative w-full h-full overflow-hidden select-none flex items-center justify-center"
    >
      {/* Stage Background */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-all duration-700 scale-105"
        style={{
          backgroundImage: `url(${stageImage})`,
          transform: `scale(1.06) translate3d(${tilt.x * -0.5}px, ${tilt.y * 0.5}px, 0)`,
        }}
      />

      {/* Atmospheric Vignette & Scanlines */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#05070d] via-transparent to-[#05070d]/60 pointer-events-none" />
      <div className="absolute inset-0 rm-scanlines opacity-40 pointer-events-none" />

      {/* Floor Holographic Ring */}
      <div
        className="absolute bottom-[8%] w-[320px] sm:w-[440px] h-[72px] rounded-full blur-md opacity-70 pointer-events-none animate-mora-ring"
        style={{
          background: `radial-gradient(circle, ${auraTheme.glow} 0%, transparent 72%)`,
        }}
      />

      {/* Floating Particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(10)].map((_, i) => (
          <motion.span
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: i % 2 === 0 ? auraTheme.primary : '#00f0ff',
              left: `${12 + i * 8.5}%`,
              bottom: `${14 + (i % 4) * 14}%`,
              boxShadow: `0 0 10px ${auraTheme.primary}`,
            }}
            animate={{
              y: [-10, -70, -10],
              opacity: [0.2, 0.85, 0.2],
              scale: [0.8, 1.3, 0.8],
            }}
            transition={{
              duration: 3.5 + (i % 3),
              repeat: Infinity,
              delay: i * 0.35,
            }}
          />
        ))}
      </div>

      {/* Speech Bubble */}
      <AnimatePresence>
        {chatBubbleVisible && bubbleText && (
          <motion.div
            key={bubbleText}
            initial={{ opacity: 0, y: 12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            className="absolute top-[13%] sm:top-[11%] left-1/2 -translate-x-1/2 z-20 max-w-[86%] sm:max-w-[430px] pointer-events-none"
          >
            <div className="rm-glass rounded-2xl px-4 py-2.5 border border-rose-500/40 shadow-[0_0_30px_rgba(255,42,75,0.2)]">
              <div className="flex items-center gap-1.5 mb-0.5 text-[10px] font-cyber tracking-widest uppercase text-rose-400">
                <Volume2 className={`w-3 h-3 ${isSpeaking ? 'animate-pulse text-cyan-300' : ''}`} />
                <span>MORA · 2122 LINK</span>
                {isSpeaking && (
                  <span className="ml-auto flex gap-0.5 items-end h-3">
                    <span className="w-0.5 h-2 bg-cyan-400 animate-bounce" />
                    <span className="w-0.5 h-3 bg-rose-400 animate-bounce [animation-delay:0.1s]" />
                    <span className="w-0.5 h-1.5 bg-cyan-400 animate-bounce [animation-delay:0.2s]" />
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-100 leading-snug font-medium">
                {bubbleText}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Character Container with Zoom + Parallax + Breathing */}
      <motion.div
        animate={{
          scale: scaleVal,
          y: translateYVal,
          rotateY: tilt.x * 0.6,
          rotateX: tilt.y * 0.4,
        }}
        transition={{ type: 'spring', stiffness: 120, damping: 18 }}
        className="relative z-10 flex items-center justify-center h-[74vh] max-h-[650px] mt-10"
      >
        <div className="relative h-full flex items-center justify-center animate-mora-float">
          {/* Aura Backlight */}
          <div
            className={`absolute inset-6 rounded-full blur-3xl opacity-35 transition-all duration-500 pointer-events-none ${
              isSpeaking ? 'opacity-60 scale-105' : ''
            }`}
            style={{ backgroundColor: auraTheme.primary }}
          />

          <img
            src={outfitMeta.image}
            alt={outfitMeta.name}
            draggable={false}
            className="relative h-full w-auto max-w-[82vw] object-contain drop-shadow-[0_14px_34px_rgba(0,0,0,0.85)] transition-all duration-300"
          />

          {/* Interactive Touch Zones */}
          <button
            type="button"
            aria-label="Headpat Mora"
            title="Tap horns / head for headpat"
            onClick={(e) => triggerZone('head', e)}
            className="absolute top-[2%] left-[25%] w-[50%] h-[15%] rounded-full cursor-pointer hover:bg-rose-400/10 transition-colors"
          />
          <button
            type="button"
            aria-label="Interact with Mora face"
            title="Tap face to greet Mora"
            onClick={(e) => triggerZone('face', e)}
            className="absolute top-[17%] left-[32%] w-[36%] h-[12%] rounded-full cursor-pointer hover:bg-cyan-400/10 transition-colors"
          />
          <button
            type="button"
            aria-label="Tap Mora outfit"
            title="Tap outfit to inspect skin"
            onClick={(e) => triggerZone('outfit', e)}
            className="absolute top-[30%] left-[26%] w-[48%] h-[32%] rounded-2xl cursor-pointer hover:bg-rose-400/10 transition-colors"
          />
          <button
            type="button"
            aria-label="High five Mora"
            title="Tap hands for high-five"
            onClick={(e) => triggerZone('hands', e)}
            className="absolute top-[42%] left-[12%] w-[76%] h-[18%] rounded-full cursor-pointer hover:bg-amber-400/10 transition-colors opacity-60"
          />
        </div>
      </motion.div>

      {/* Tap Reaction Floating Particles */}
      <AnimatePresence>
        {tapFx.map((fx) => (
          <motion.div
            key={fx.id}
            initial={{ opacity: 1, y: 0, scale: 0.6 }}
            animate={{ opacity: 0, y: -64, scale: 1.35 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: 'easeOut' }}
            style={{ left: fx.x - 16, top: fx.y - 16 }}
            className="absolute z-30 pointer-events-none flex items-center gap-1 text-rose-400 drop-shadow-[0_0_10px_rgba(255,42,75,0.8)]"
          >
            {fx.zone === 'head' ? (
              <Heart className="w-7 h-7 fill-rose-500 text-rose-300" />
            ) : fx.zone === 'hands' ? (
              <Zap className="w-7 h-7 fill-cyan-400 text-cyan-200" />
            ) : (
              <Sparkles className="w-7 h-7 text-pink-300" />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
