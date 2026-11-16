import React, { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Flame, Monitor, Radio, Smartphone, Sparkles, Video } from 'lucide-react'
import { MORA_OUTFITS } from '../../data/moraData'
import type { OutfitId } from '../../types/mora'
import { CyberModal } from '../CyberModal'

interface MoraLiveModalProps {
  open: boolean
  onClose: () => void
  outfit: OutfitId
  onSpeakLine: (line: string) => void
}

const STREAM_CHAT_POOL = [
  { user: 'RedMagicFan99', msg: 'Mora VTuber mode looks insane!!' },
  { user: 'CyberNinja_NP', msg: '144Hz zero lag lets gooo 🔥' },
  { user: 'KuroGaming', msg: 'Drop that PUBG clutch tip Mora!' },
  { user: 'Sora2122', msg: 'Chibi Magic Buddy next match pls!' },
  { user: 'ApexBlaze', msg: 'REDMAGIC 11 Pro cooling fan OP!' },
]

export const MoraLiveModal: React.FC<MoraLiveModalProps> = ({
  open,
  onClose,
  outfit,
  onSpeakLine,
}) => {
  const [streamMode, setStreamMode] = useState<'pc' | 'mobile'>('pc')
  const [cameraOn, setCameraOn] = useState(false)
  const [chromaGreen, setChromaGreen] = useState(false)
  const [avatarScale, setAvatarScale] = useState(100)
  const [avatarOpacity, setAvatarOpacity] = useState(100)
  const [avatarSide, setAvatarSide] = useState<'left' | 'right'>('right')
  const [liveOn, setLiveOn] = useState(false)
  const [viewers, setViewers] = useState(1248)
  const [chatFeed, setChatFeed] = useState(STREAM_CHAT_POOL.slice(0, 3))
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const outfitMeta = MORA_OUTFITS.find((o) => o.id === outfit) || MORA_OUTFITS[0]

  useEffect(() => {
    if (!open && streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setCameraOn(false)
    }
  }, [open])

  useEffect(() => {
    if (!open || !liveOn) return
    const timer = setInterval(() => {
      setViewers((v) => v + Math.floor(Math.random() * 19 - 5))
      const pick = STREAM_CHAT_POOL[Math.floor(Math.random() * STREAM_CHAT_POOL.length)]
      setChatFeed((prev) => [...prev.slice(-4), pick])
    }, 3200)
    return () => clearInterval(timer)
  }, [open, liveOn])

  const toggleCamera = async () => {
    if (cameraOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setCameraOn(false)
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      streamRef.current = s
      if (videoRef.current) videoRef.current.srcObject = s
      setCameraOn(true)
    } catch {
      setCameraOn(false)
      onSpeakLine('Camera permission unavailable — using cyber virtual stream feed instead!')
    }
  }

  const triggerHype = () => {
    onSpeakLine('ELIMINATION CONFIRMED! Chat, drop those RedMagic flames in the stream!')
    setChatFeed((prev) => [
      ...prev.slice(-4),
      { user: 'MORA BOT', msg: '🔥🔥 UNSTOPPABLE CLUTCH BY COMMANDER! 🔥🔥' },
    ])
  }

  return (
    <CyberModal
      open={open}
      onClose={onClose}
      title="Mora Live — VTuber & Streaming Studio"
      subtitle="PC & Mobile livestream avatar overlay, webcam PiP, chroma key & live chat"
      icon={<Video className="w-5 h-5" />}
      maxWidth="max-w-5xl"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Preview Stage */}
        <div className="lg:col-span-2 space-y-3">
          <div
            className={`relative mx-auto overflow-hidden rounded-2xl border border-rose-500/40 ${
              streamMode === 'pc' ? 'aspect-video w-full' : 'aspect-[9/16] max-h-[430px]'
            } ${chromaGreen ? 'bg-[#00b140]' : 'bg-[#090d18]'}`}
          >
            {!chromaGreen && (
              <div
                className="absolute inset-0 bg-cover bg-center opacity-50"
                style={{ backgroundImage: 'url(/assets/bg-neon-arena.png)' }}
              />
            )}

            {/* Top Live Stream HUD */}
            <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-cyber font-bold flex items-center gap-1.5 ${
                    liveOn ? 'bg-rose-600 text-white animate-pulse' : 'bg-black/60 text-slate-300'
                  }`}
                >
                  <Radio className="w-3 h-3" />
                  {liveOn ? 'LIVE ON AIR' : 'PREVIEW'}
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-black/60 text-[11px] text-cyan-300 font-tech font-bold">
                  {viewers.toLocaleString()} watching
                </span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-black/60 text-[10px] font-cyber text-rose-300">
                REDMAGIC MORA LIVE
              </span>
            </div>

            {/* Webcam / Facecam PiP */}
            <div className="absolute top-12 left-3 z-20 w-28 h-20 rounded-xl overflow-hidden border border-cyan-400/50 bg-slate-900/90 flex items-center justify-center">
              {cameraOn ? (
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              ) : (
                <div className="text-center text-[10px] text-slate-400 px-1">
                  <CameraOff className="w-4 h-4 mx-auto mb-0.5 text-slate-500" />
                  Cam PiP Off
                </div>
              )}
            </div>

            {/* Live Chat Overlay */}
            <div className="absolute bottom-3 left-3 z-20 w-56 space-y-1 pointer-events-none">
              {chatFeed.map((c, idx) => (
                <div
                  key={idx}
                  className="px-2.5 py-1 rounded-lg bg-black/65 backdrop-blur-sm text-[11px] text-white border border-white/10"
                >
                  <span className="font-bold text-rose-400 mr-1.5">{c.user}:</span>
                  <span>{c.msg}</span>
                </div>
              ))}
            </div>

            {/* Mora VTuber Avatar */}
            <div
              style={{
                opacity: avatarOpacity / 100,
                transform: `scale(${avatarScale / 100})`,
              }}
              className={`absolute bottom-0 z-10 h-[82%] transition-all duration-300 pointer-events-none ${
                avatarSide === 'right' ? 'right-3' : 'left-28'
              }`}
            >
              <img
                src={outfitMeta.image}
                alt="Mora VTuber"
                className="h-full object-contain animate-mora-float drop-shadow-[0_10px_25px_rgba(0,0,0,0.85)]"
              />
            </div>
          </div>
        </div>

        {/* Stream Controls */}
        <div className="space-y-3.5">
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3.5 space-y-3">
            <div className="text-xs font-cyber uppercase tracking-widest text-rose-400">
              Stream Output Target
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStreamMode('pc')}
                className={`p-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  streamMode === 'pc'
                    ? 'bg-rose-500/25 border-rose-400 text-white'
                    : 'bg-black/30 border-white/10 text-slate-400'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" /> PC 16:9
              </button>
              <button
                type="button"
                onClick={() => setStreamMode('mobile')}
                className={`p-2 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  streamMode === 'mobile'
                    ? 'bg-rose-500/25 border-rose-400 text-white'
                    : 'bg-black/30 border-white/10 text-slate-400'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" /> Mobile 9:16
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-white/5 border border-white/10 p-3.5 space-y-3">
            <div className="flex justify-between text-xs text-slate-300">
              <span>Avatar Scale</span>
              <span className="font-cyber text-cyan-300">{avatarScale}%</span>
            </div>
            <input
              type="range"
              min={60}
              max={130}
              value={avatarScale}
              onChange={(e) => setAvatarScale(Number(e.target.value))}
              className="w-full accent-rose-500"
            />

            <div className="flex justify-between text-xs text-slate-300">
              <span>Transparency</span>
              <span className="font-cyber text-cyan-300">{avatarOpacity}%</span>
            </div>
            <input
              type="range"
              min={30}
              max={100}
              value={avatarOpacity}
              onChange={(e) => setAvatarOpacity(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setAvatarSide((s) => (s === 'right' ? 'left' : 'right'))}
                className="px-2.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white"
              >
                Position: {avatarSide.toUpperCase()}
              </button>
              <button
                type="button"
                onClick={() => setChromaGreen((v) => !v)}
                className={`px-2.5 py-2 rounded-xl text-xs font-semibold ${
                  chromaGreen ? 'bg-emerald-500 text-slate-950' : 'bg-white/10 text-white'
                }`}
              >
                Chroma Key: {chromaGreen ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={toggleCamera}
              className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-bold text-white flex items-center justify-center gap-2"
            >
              <Camera className="w-4 h-4 text-cyan-400" />
              {cameraOn ? 'Disable Facecam PiP' : 'Enable Real Webcam PiP'}
            </button>

            <button
              type="button"
              onClick={triggerHype}
              className="w-full py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-xs font-bold text-amber-200 flex items-center justify-center gap-2"
            >
              <Flame className="w-4 h-4" /> Trigger Kill / Victory Hype
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !liveOn
                setLiveOn(next)
                onSpeakLine(
                  next
                    ? 'Mora Live broadcast started! Welcome to our stream, chat!'
                    : 'Broadcast paused. Great stream today, Commander!',
                )
              }}
              className={`w-full py-3 rounded-xl font-cyber text-xs font-bold tracking-wider flex items-center justify-center gap-2 ${
                liveOn
                  ? 'bg-rose-600 text-white shadow-[0_0_24px_rgba(255,42,75,0.6)]'
                  : 'bg-gradient-to-r from-rose-600 to-pink-600 text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              {liveOn ? 'STOP STREAM BROADCAST' : 'GO LIVE WITH MORA'}
            </button>
          </div>
        </div>
      </div>
    </CyberModal>
  )
}
