import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Sparkles, Volume2 } from 'lucide-react'
import { AURA_THEMES, MORA_OUTFITS, MORA_STAGES } from '../data/moraData'
import type { AuraColorId, OutfitId, StageId } from '../types/mora'
import {
  applyProceduralPose,
  collectWizRig,
  loadRetargetedMixamoClip,
  type MiraAnimName,
  type WizBoneRig,
} from '../utils/miraAnimator'

interface Mira3DStageProps {
  stageRef: React.RefObject<HTMLDivElement | null>
  outfit: OutfitId
  stage: StageId
  customStageUrl: string
  aura: AuraColorId
  zoomLevel: number
  isSpeaking: boolean
  bubbleText: string
  chatBubbleVisible: boolean
  activeAnim: MiraAnimName
  onChangeAnim: (anim: MiraAnimName) => void
  onTouchZone: (zone: 'head' | 'face' | 'outfit' | 'hands') => void
}

const ANIM_OPTIONS: { id: MiraAnimName; label: string }[] = [
  { id: 'idle', label: 'Idle' },
  { id: 'wave', label: 'Wave' },
  { id: 'talk', label: 'Talk' },
  { id: 'dance', label: 'Dance' },
  { id: 'robot', label: 'Robot' },
  { id: 'cheer', label: 'Cheer' },
]

export const Mira3DStage: React.FC<Mira3DStageProps> = ({
  stageRef,
  outfit,
  stage,
  customStageUrl,
  aura,
  zoomLevel,
  isSpeaking,
  bubbleText,
  chatBubbleVisible,
  activeAnim,
  onChangeAnim,
  onTouchZone,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [modelLoaded, setModelLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const activeAnimRef = useRef<MiraAnimName>(activeAnim)
  const isSpeakingRef = useRef(isSpeaking)
  const zoomRef = useRef(zoomLevel)

  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const currentActionRef = useRef<THREE.AnimationAction | null>(null)
  const modelRootRef = useRef<THREE.Object3D | null>(null)
  const hasFbxClipRef = useRef(false)

  useEffect(() => {
    activeAnimRef.current = activeAnim
  }, [activeAnim])

  useEffect(() => {
    isSpeakingRef.current = isSpeaking
  }, [isSpeaking])

  useEffect(() => {
    zoomRef.current = zoomLevel
  }, [zoomLevel])

  // Switch Mixamo animation clip smoothly when activeAnim changes
  useEffect(() => {
    const root = modelRootRef.current
    const mixer = mixerRef.current
    if (!root || !mixer) return

    let cancelled = false
    const effectiveAnim: MiraAnimName =
      isSpeaking && activeAnim === 'idle' ? 'talk' : activeAnim

    if (effectiveAnim === 'wave' || effectiveAnim === 'cheer') {
      if (currentActionRef.current) {
        currentActionRef.current.fadeOut(0.25)
        currentActionRef.current = null
      }
      hasFbxClipRef.current = false
      return
    }

    void loadRetargetedMixamoClip(effectiveAnim, root).then((clip) => {
      if (cancelled || !mixerRef.current) return
      if (!clip) {
        hasFbxClipRef.current = false
        return
      }
      const nextAction = mixerRef.current.clipAction(clip)
      nextAction.reset()
      nextAction.setLoop(THREE.LoopRepeat, Infinity)
      nextAction.fadeIn(0.35).play()
      if (currentActionRef.current && currentActionRef.current !== nextAction) {
        currentActionRef.current.fadeOut(0.35)
      }
      currentActionRef.current = nextAction
      hasFbxClipRef.current = true
    })

    return () => {
      cancelled = true
    }
  }, [activeAnim, isSpeaking, modelLoaded])

  // Main Three.js Scene setup for mira-model.glb
  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      setLoadError(true)
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.18
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      36,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      50,
    )
    camera.position.set(0, 1.35, 3.1)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.enablePan = false
    controls.target.set(0, 1.05, 0)
    controls.minDistance = 1.6
    controls.maxDistance = 5.2
    controls.maxPolarAngle = Math.PI * 0.56
    controls.minPolarAngle = Math.PI * 0.25

    // Studio & Cyber Rim Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 1.45))
    const keyLight = new THREE.DirectionalLight(0xfff5f8, 2.2)
    keyLight.position.set(2.5, 4, 3.5)
    scene.add(keyLight)

    const cyanRim = new THREE.DirectionalLight(0x00f0ff, 1.6)
    cyanRim.position.set(-3, 2.5, -2)
    scene.add(cyanRim)

    const crimsonRim = new THREE.DirectionalLight(0xff2a4b, 1.35)
    crimsonRim.position.set(3, 1.5, -2.5)
    scene.add(crimsonRim)

    // Holographic Floor Ring
    const ringGeo = new THREE.RingGeometry(0.68, 0.78, 64)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    })
    const floorRing = new THREE.Mesh(ringGeo, ringMat)
    floorRing.rotation.x = -Math.PI / 2
    floorRing.position.y = 0.01
    scene.add(floorRing)

    const innerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.68, 64),
      new THREE.MeshBasicMaterial({ color: 0xff2a4b, transparent: true, opacity: 0.14 }),
    )
    innerDisc.rotation.x = -Math.PI / 2
    innerDisc.position.y = 0.005
    scene.add(innerDisc)

    let rig: WizBoneRig | null = null
    let disposed = false
    const clock = new THREE.Clock()

    const gltfLoader = new GLTFLoader()
    gltfLoader.load(
      '/assets/mira-model.glb',
      (gltf) => {
        if (disposed) return
        const model = gltf.scene
        // Normalize bounding box to ~1.72m tall grounded at y=0
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const scale = 1.72 / Math.max(0.01, size.y)
        model.scale.setScalar(scale)
        model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)

        model.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            obj.frustumCulled = false
          }
        })

        scene.add(model)
        modelRootRef.current = model
        mixerRef.current = new THREE.AnimationMixer(model)
        rig = collectWizRig(model)
        setModelLoaded(true)
      },
      undefined,
      () => {
        if (!disposed) setLoadError(true)
      },
    )

    let rafId = 0
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const dt = clock.getDelta()
      const elapsed = clock.getElapsedTime()

      if (mixerRef.current && hasFbxClipRef.current) {
        mixerRef.current.update(dt)
      }
      if (rig) {
        const mode: MiraAnimName =
          isSpeakingRef.current && activeAnimRef.current === 'idle'
            ? 'talk'
            : activeAnimRef.current
        applyProceduralPose(rig, mode, elapsed, isSpeakingRef.current, hasFbxClipRef.current)
      }

      // Smoothly adjust camera distance with zoomLevel
      const desiredDist = 3.15 / Math.max(0.65, zoomRef.current)
      const dir = camera.position.clone().sub(controls.target).normalize()
      const currDist = camera.position.distanceTo(controls.target)
      const nextDist = THREE.MathUtils.lerp(currDist, desiredDist, 0.06)
      camera.position.copy(controls.target).addScaledVector(dir, nextDist)

      floorRing.rotation.z = elapsed * 0.45
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      if (!container) return
      const w = Math.max(1, container.clientWidth)
      const h = Math.max(1, container.clientHeight)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      mixerRef.current = null
      modelRootRef.current = null
    }
  }, [])

  const stageMeta = MORA_STAGES.find((s) => s.id === stage) || MORA_STAGES[0]
  const stageBgUrl = stage === 'custom' && customStageUrl ? customStageUrl : stageMeta.image
  const outfitMeta = MORA_OUTFITS.find((o) => o.id === outfit) || MORA_OUTFITS[0]
  const auraTheme = AURA_THEMES[aura]

  return (
    <div ref={stageRef} className="relative w-full h-full overflow-hidden select-none">
      {/* Stage Backdrop */}
      <img
        src={stageBgUrl}
        alt={stageMeta.name}
        className="absolute inset-0 w-full h-full object-cover scale-105 opacity-90 transition-all duration-700"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#05070d] via-[#05070d]/25 to-[#05070d]/70 pointer-events-none" />
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-500"
        style={{
          background: `radial-gradient(circle at 50% 62%, ${auraTheme.glow} 0%, transparent 56%)`,
        }}
      />

      {/* Three.js 3D Character Canvas */}
      <div ref={mountRef} className="relative z-10 w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Fallback 2D if WebGL fails */}
      {loadError && (
        <div className="absolute inset-0 z-10 flex items-end justify-center pb-28 pointer-events-none">
          <img src={outfitMeta.image} alt="MIRA 3D Fallback" className="h-[68vh] object-contain" />
        </div>
      )}

      {/* Loading Indicator */}
      {!modelLoaded && !loadError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="rm-glass px-4 py-2 rounded-full border border-cyan-400/50 text-xs font-cyber text-cyan-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 animate-spin text-rose-400" />
            LOADING MIRA 3D MODEL...
          </div>
        </div>
      )}

      {/* MIRA Speech Bubble */}
      {chatBubbleVisible && bubbleText && (
        <div className="absolute top-[104px] sm:top-24 left-1/2 -translate-x-1/2 z-20 w-[86vw] max-w-md pointer-events-none">
          <div className="rm-glass rounded-2xl px-4 py-2.5 border border-rose-400/45 shadow-2xl">
            <div className="flex items-center gap-2 mb-0.5">
              <Volume2
                className={`w-3.5 h-3.5 ${isSpeaking ? 'text-cyan-300 animate-pulse' : 'text-rose-400'}`}
              />
              <span className="text-[10px] font-cyber uppercase tracking-widest text-rose-300">
                MIRA 3D · {activeAnim.toUpperCase()}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-white leading-snug">{bubbleText}</p>
          </div>
        </div>
      )}

      {/* 3D Touch / Quick Gesture Strip + Animation Switcher */}
      <div className="absolute bottom-[132px] sm:bottom-[142px] left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rm-glass px-2.5 py-1.5 rounded-full border border-white/15 max-w-[94vw] overflow-x-auto">
        {ANIM_OPTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              onChangeAnim(a.id)
              if (a.id === 'wave') onTouchZone('hands')
              if (a.id === 'cheer') onTouchZone('head')
            }}
            className={`px-2.5 py-1 rounded-full text-[10px] font-cyber font-bold whitespace-nowrap transition-all ${
              activeAnim === a.id
                ? 'bg-rose-500 text-white shadow-[0_0_12px_rgba(255,42,75,0.6)]'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
