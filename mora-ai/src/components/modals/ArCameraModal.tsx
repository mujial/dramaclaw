import React, { useEffect, useRef, useState } from 'react'
import { Camera, Download, FlipHorizontal2, Image, Move, RefreshCw } from 'lucide-react'
import { MORA_OUTFITS, MORA_STAGES } from '../../data/moraData'
import type { ArPhotoItem, OutfitId } from '../../types/mora'
import { playCyberSfx } from '../../utils/speech'
import { CyberModal } from '../CyberModal'

interface ArCameraModalProps {
  open: boolean
  onClose: () => void
  outfit: OutfitId
  gallery: ArPhotoItem[]
  onSavePhoto: (photo: ArPhotoItem) => void
  onSpeakLine: (line: string) => void
}

export const ArCameraModal: React.FC<ArCameraModalProps> = ({
  open,
  onClose,
  outfit,
  gallery,
  onSavePhoto,
  onSpeakLine,
}) => {
  const [selectedOutfit, setSelectedOutfit] = useState<OutfitId>(outfit)
  const [useWebcam, setUseWebcam] = useState(false)
  const [virtualBgIdx, setVirtualBgIdx] = useState(0)
  const [pos, setPos] = useState({ x: 50, y: 55 })
  const [scale, setScale] = useState(1)
  const [flipped, setFlipped] = useState(false)
  const [flash, setFlash] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stageBoxRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    setSelectedOutfit(outfit)
  }, [outfit])

  useEffect(() => {
    if (!open && streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setUseWebcam(false)
    }
  }, [open])

  const startWebcam = async () => {
    if (useWebcam) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setUseWebcam(false)
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = s
      if (videoRef.current) videoRef.current.srcObject = s
      setUseWebcam(true)
      onSpeakLine('AR Lens active! Drag and scale me anywhere in your real room!')
    } catch {
      onSpeakLine('Webcam unavailable — using virtual AR studio backdrop!')
    }
  }

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !stageBoxRef.current) return
    const rect = stageBoxRef.current.getBoundingClientRect()
    const x = Math.min(90, Math.max(10, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.min(90, Math.max(15, ((e.clientY - rect.top) / rect.height) * 100))
    setPos({ x, y })
  }

  const captureArPhoto = async () => {
    playCyberSfx('shutter')
    setFlash(true)
    setTimeout(() => setFlash(false), 220)

    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Draw background
    if (useWebcam && videoRef.current && videoRef.current.readyState >= 2) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)
    } else {
      const bgImg = new window.Image()
      bgImg.crossOrigin = 'anonymous'
      bgImg.src = MORA_STAGES[virtualBgIdx].image
      await new Promise<void>((res) => {
        bgImg.onload = () => res()
        bgImg.onerror = () => res()
      })
      ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height)
    }

    // Draw MIRA cutout
    const outfitObj = MORA_OUTFITS.find((o) => o.id === selectedOutfit) || MORA_OUTFITS[0]
    const moraImg = new window.Image()
    moraImg.crossOrigin = 'anonymous'
    moraImg.src = outfitObj.image
    await new Promise<void>((res) => {
      moraImg.onload = () => res()
      moraImg.onerror = () => res()
    })

    const drawH = 520 * scale
    const drawW = (moraImg.width / Math.max(1, moraImg.height)) * drawH
    const cx = (pos.x / 100) * canvas.width
    const cy = (pos.y / 100) * canvas.height

    ctx.save()
    ctx.translate(cx, cy)
    if (flipped) ctx.scale(-1, 1)
    ctx.drawImage(moraImg, -drawW / 2, -drawH / 2, drawW, drawH)
    ctx.restore()

    // Watermark stamp
    ctx.fillStyle = 'rgba(7, 9, 15, 0.72)'
    ctx.fillRect(28, 650, 390, 44)
    ctx.fillStyle = '#ff2a4b'
    ctx.font = 'bold 20px Orbitron, sans-serif'
    ctx.fillText('MIRA AI AR · 2122', 44, 679)

    const dataUrl = canvas.toDataURL('image/png')
    onSavePhoto({
      id: `ar-${Date.now()}`,
      dataUrl,
      caption: `${outfitObj.name} · AR Snapshot`,
      createdAt: new Date().toLocaleTimeString(),
    })
    onSpeakLine('Say cheese! AR photo captured and saved to your gallery!')
  }

  const currentOutfit = MORA_OUTFITS.find((o) => o.id === selectedOutfit) || MORA_OUTFITS[0]

  return (
    <CyberModal
      open={open}
      onClose={onClose}
      title="AR Camera — Photograph with MIRA"
      subtitle="Place, drag & scale MIRA in AR space using your camera or virtual stage"
      icon={<Camera className="w-5 h-5" />}
      maxWidth="max-w-5xl"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div
            ref={stageBoxRef}
            onPointerMove={handleDragMove}
            onPointerUp={() => {
              dragging.current = false
            }}
            className="relative aspect-video w-full rounded-2xl overflow-hidden border border-cyan-400/40 bg-slate-950 select-none"
          >
            {useWebcam ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            ) : (
              <img
                src={MORA_STAGES[virtualBgIdx].image}
                alt="AR Virtual Room"
                className="w-full h-full object-cover"
              />
            )}

            {/* AR Grid Reticle */}
            <div className="absolute inset-4 border border-dashed border-cyan-400/30 rounded-xl pointer-events-none flex items-end justify-between p-2 text-[10px] font-cyber text-cyan-300">
              <span>AR PLANE TRACKING: LOCKED</span>
              <span>DRAG MIRA TO POSITION</span>
            </div>

            {/* Draggable MIRA */}
            <div
              onPointerDown={(e) => {
                dragging.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              style={{
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                transform: `translate(-50%, -50%) scale(${scale}) scaleX(${flipped ? -1 : 1})`,
              }}
              className="absolute h-[76%] cursor-grab active:cursor-grabbing"
            >
              <img
                src={currentOutfit.image}
                alt="AR MIRA"
                draggable={false}
                className="h-full object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.85)]"
              />
            </div>

            {flash && <div className="absolute inset-0 bg-white/90 pointer-events-none" />}
          </div>
        </div>

        {/* Controls & Gallery */}
        <div className="space-y-3.5">
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3.5 space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={startWebcam}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border ${
                  useWebcam
                    ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                    : 'bg-white/10 text-white border-white/15'
                }`}
              >
                {useWebcam ? 'Stop Webcam' : 'Use Real Camera'}
              </button>
              {!useWebcam && (
                <button
                  type="button"
                  onClick={() => setVirtualBgIdx((i) => (i + 1) % MORA_STAGES.length)}
                  className="px-3 py-2 rounded-xl bg-white/10 text-xs text-white flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Scene
                </button>
              )}
            </div>

            <div>
              <div className="text-xs text-slate-300 mb-1.5">Pose / Outfit</div>
              <div className="grid grid-cols-2 gap-1.5">
                {MORA_OUTFITS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelectedOutfit(o.id)}
                    className={`px-2 py-1.5 rounded-lg text-[11px] border truncate ${
                      selectedOutfit === o.id
                        ? 'bg-rose-500/25 border-rose-400 text-white'
                        : 'bg-black/25 border-white/10 text-slate-300'
                    }`}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>AR Scale</span>
                <span className="font-cyber text-cyan-300">{Math.round(scale * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1.4}
                step={0.05}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                className="flex-1 py-2 rounded-xl bg-white/10 text-xs text-white flex items-center justify-center gap-1.5"
              >
                <FlipHorizontal2 className="w-3.5 h-3.5" /> Flip
              </button>
              <button
                type="button"
                onClick={() => setPos({ x: 50, y: 55 })}
                className="flex-1 py-2 rounded-xl bg-white/10 text-xs text-white flex items-center justify-center gap-1.5"
              >
                <Move className="w-3.5 h-3.5" /> Center
              </button>
            </div>

            <button
              type="button"
              onClick={captureArPhoto}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white font-cyber text-xs font-bold tracking-wider flex items-center justify-center gap-2 shadow-lg"
            >
              <Camera className="w-4 h-4" /> SNAP AR PHOTO
            </button>
          </div>

          {/* Saved Gallery */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
            <div className="text-xs font-cyber text-cyan-300 mb-2 flex items-center gap-1.5">
              <Image className="w-3.5 h-3.5" /> AR Gallery ({gallery.length})
            </div>
            {gallery.length === 0 ? (
              <p className="text-[11px] text-slate-400">Snap a photo with MIRA to save it here.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                {gallery.map((item) => (
                  <a
                    key={item.id}
                    href={item.dataUrl}
                    download={`${item.id}.png`}
                    className="group relative rounded-lg overflow-hidden border border-white/15"
                  >
                    <img src={item.dataUrl} alt={item.caption} className="w-full h-16 object-cover" />
                    <span className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white gap-1 transition-opacity">
                      <Download className="w-3 h-3" /> Save
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </CyberModal>
  )
}
