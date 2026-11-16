import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

export type MiraAnimName = 'idle' | 'talk' | 'wave' | 'dance' | 'robot' | 'cheer'

// Mapping from Mixamo FBX bone names -> WizRIG GLB bone names (from wiz_-_konosuba.glb)
const MIXAMO_TO_WIZ_BONE_MAP: Record<string, string> = {
  mixamorigHips: 'spine_01',
  mixamorigSpine: 'spine.001_02',
  mixamorigSpine1: 'spine.002_03',
  mixamorigSpine2: 'spine.003_04',
  mixamorigNeck: 'spine.004_05',
  mixamorigHead: 'face_06',
  mixamorigLeftShoulder: 'shoulder.L_027',
  mixamorigLeftArm: 'upper_arm.L_028',
  mixamorigLeftForeArm: 'forearm.L_029',
  mixamorigLeftHand: 'hand.L_030',
  mixamorigRightShoulder: 'shoulder.R_046',
  mixamorigRightArm: 'upper_arm.R_047',
  mixamorigRightForeArm: 'forearm.R_048',
  mixamorigRightHand: 'hand.R_049',
  mixamorigLeftUpLeg: 'thigh.L_068',
  mixamorigLeftLeg: 'shin.L_069',
  mixamorigLeftFoot: 'foot.L_070',
  mixamorigLeftToeBase: 'toe.L_071',
  mixamorigRightUpLeg: 'thigh.R_072',
  mixamorigRightLeg: 'shin.R_073',
  mixamorigRightFoot: 'foot.R_074',
  mixamorigRightToeBase: 'toe.R_075',
}

const FBX_URL_MAP: Partial<Record<MiraAnimName, string>> = {
  idle: '/animations/idle.fbx',
  talk: '/animations/talking-happy.fbx',
  dance: '/animations/dancing.fbx',
  robot: '/animations/robot-dance.fbx',
}

const fbxLoader = new FBXLoader()
const clipCache = new Map<string, THREE.AnimationClip>()

/**
 * Adapted from dexvdev/svelte-vrm-live (remapMixamoAnimationToVrm.ts)
 * Retargets Mixamo FBX tracks onto the WizRIG GLB skeleton with rest-pose delta preservation.
 */
export async function loadRetargetedMixamoClip(
  animName: MiraAnimName,
  targetRoot: THREE.Object3D,
): Promise<THREE.AnimationClip | null> {
  const url = FBX_URL_MAP[animName]
  if (!url) return null

  const cacheKey = `${animName}:${url}`
  if (clipCache.has(cacheKey)) {
    return clipCache.get(cacheKey)!.clone()
  }

  try {
    const fbx = await fbxLoader.loadAsync(url)
    const srcClip =
      THREE.AnimationClip.findByName(fbx.animations, 'mixamo.com') || fbx.animations[0]
    if (!srcClip) return null

    const tracks: THREE.KeyframeTrack[] = []
    const srcRestInv = new THREE.Quaternion()
    const srcParentWorld = new THREE.Quaternion()
    const tgtRest = new THREE.Quaternion()
    const tgtParentWorldInv = new THREE.Quaternion()
    const q = new THREE.Quaternion()

    fbx.updateMatrixWorld(true)
    targetRoot.updateMatrixWorld(true)

    for (const track of srcClip.tracks) {
      const dotIdx = track.name.indexOf('.')
      if (dotIdx < 0) continue
      const mixamoName = track.name.slice(0, dotIdx)
      const propName = track.name.slice(dotIdx + 1)

      const targetBoneName = MIXAMO_TO_WIZ_BONE_MAP[mixamoName]
      if (!targetBoneName) continue
      const srcNode = fbx.getObjectByName(mixamoName)
      const tgtNode = targetRoot.getObjectByName(targetBoneName)
      if (!srcNode || !tgtNode) continue

      if (track instanceof THREE.QuaternionKeyframeTrack && propName === 'quaternion') {
        srcNode.getWorldQuaternion(srcRestInv).invert()
        if (srcNode.parent) srcNode.parent.getWorldQuaternion(srcParentWorld)
        else srcParentWorld.identity()

        tgtNode.getWorldQuaternion(tgtRest)
        if (tgtNode.parent) tgtNode.parent.getWorldQuaternion(tgtParentWorldInv).invert()
        else tgtParentWorldInv.identity()

        const vals = Float32Array.from(track.values)
        for (let i = 0; i < vals.length; i += 4) {
          q.set(vals[i], vals[i + 1], vals[i + 2], vals[i + 3])
          // Delta from source rest pose -> applied in target bone local space
          q.premultiply(srcParentWorld).multiply(srcRestInv)
          q.premultiply(tgtParentWorldInv).multiply(tgtRest)
          q.normalize()
          vals[i] = q.x
          vals[i + 1] = q.y
          vals[i + 2] = q.z
          vals[i + 3] = q.w
        }
        tracks.push(
          new THREE.QuaternionKeyframeTrack(
            `${targetBoneName}.quaternion`,
            Array.from(track.times),
            Array.from(vals),
          ),
        )
      }
    }

    if (tracks.length === 0) return null
    const finalClip = new THREE.AnimationClip(`mira-${animName}`, srcClip.duration, tracks)
    clipCache.set(cacheKey, finalClip)
    return finalClip.clone()
  } catch {
    return null
  }
}

export interface WizBoneRig {
  rest: Map<string, THREE.Euler>
  nodes: Map<string, THREE.Object3D>
  hairNodes: THREE.Object3D[]
}

export function collectWizRig(root: THREE.Object3D): WizBoneRig {
  const rest = new Map<string, THREE.Euler>()
  const nodes = new Map<string, THREE.Object3D>()
  const hairNodes: THREE.Object3D[] = []

  root.traverse((obj) => {
    if (!obj.name) return
    nodes.set(obj.name, obj)
    rest.set(obj.name, obj.rotation.clone())
    if (obj.name.startsWith('Hair') && !obj.name.includes('_end_')) {
      hairNodes.push(obj)
    }
  })

  return { rest, nodes, hairNodes }
}

/**
 * Smooth procedural anime bone motion (natural arm posture, breathing, hair physics, eye blink, wave, cheer, talk).
 * Runs seamlessly even when Mixamo FBX is blending or for procedural gestures like wave/cheer!
 */
export function applyProceduralPose(
  rig: WizBoneRig,
  mode: MiraAnimName,
  t: number,
  isSpeaking: boolean,
  hasActiveFbxClip: boolean,
) {
  const setOffset = (name: string, rx: number, ry: number, rz: number, blend = 1) => {
    const node = rig.nodes.get(name)
    const r = rig.rest.get(name)
    if (!node || !r) return
    node.rotation.x = THREE.MathUtils.lerp(node.rotation.x, r.x + rx, blend)
    node.rotation.y = THREE.MathUtils.lerp(node.rotation.y, r.y + ry, blend)
    node.rotation.z = THREE.MathUtils.lerp(node.rotation.z, r.z + rz, blend)
  }

  // Always animate hair physics gently
  rig.hairNodes.forEach((hn, idx) => {
    const r = rig.rest.get(hn.name)
    if (!r) return
    const phase = idx * 0.45
    hn.rotation.x = r.x + Math.sin(t * 2.1 + phase) * 0.035
    hn.rotation.z = r.z + Math.cos(t * 1.7 + phase) * 0.045
  })

  // Eye blink every ~3.8s
  const blinkCycle = t % 3.8
  const blinkScale = blinkCycle > 3.65 ? Math.max(0.15, Math.abs(Math.sin((blinkCycle - 3.65) * 20))) : 1
  const eyeL = rig.nodes.get('Eye.L_00')
  const eyeR = rig.nodes.get('Eye.R_026')
  if (eyeL) eyeL.scale.y = blinkScale
  if (eyeR) eyeR.scale.y = blinkScale

  // If FBX Mixamo clip is driving full body, only add subtle speaking head nod + hair
  if (hasActiveFbxClip && (mode === 'dance' || mode === 'robot' || mode === 'idle' || mode === 'talk')) {
    if (isSpeaking) {
      const head = rig.nodes.get('face_06')
      if (head) head.rotation.x += Math.sin(t * 9) * 0.04
    }
    return
  }

  const breathe = Math.sin(t * 2.0) * 0.03
  setOffset('spine.002_03', breathe, 0, 0, 0.25)

  if (mode === 'wave') {
    // Friendly right-hand wave + relaxed left arm
    setOffset('upper_arm.L_028', 0.05, 0, 0.52 + breathe * 0.5, 0.2)
    setOffset('forearm.L_029', -0.15, 0, 0.08, 0.2)
    setOffset('upper_arm.R_047', -0.25, 0.2, -1.75, 0.2)
    setOffset('forearm.R_048', -0.6, 0, -0.5 + Math.sin(t * 7.5) * 0.32, 0.3)
    setOffset('face_06', Math.sin(t * 2.5) * 0.04, 0.08, -0.06, 0.2)
  } else if (mode === 'cheer') {
    const bounce = Math.abs(Math.sin(t * 6.0)) * 0.08
    setOffset('spine_01', bounce * 0.3, Math.sin(t * 3) * 0.06, 0, 0.25)
    setOffset('upper_arm.L_028', -0.2, 0, -1.6 + Math.sin(t * 6) * 0.25, 0.25)
    setOffset('upper_arm.R_047', -0.2, 0, 1.6 - Math.sin(t * 6) * 0.25, 0.25)
    setOffset('face_06', -0.06, Math.sin(t * 4) * 0.08, 0, 0.25)
  } else {
    // Relaxed natural anime idle + speaking gestures
    const speakNod = isSpeaking ? Math.sin(t * 9.5) * 0.065 : Math.sin(t * 1.4) * 0.025
    const speakArm = isSpeaking ? Math.sin(t * 5.2) * 0.14 : 0
    setOffset('spine_01', 0, Math.sin(t * 0.9) * 0.04, 0, 0.15)
    setOffset('face_06', speakNod, Math.sin(t * 0.8) * 0.06, Math.cos(t * 1.1) * 0.03, 0.2)
    setOffset('upper_arm.L_028', 0.06 + speakArm * 0.5, 0, 0.52 + Math.sin(t * 1.6) * 0.03, 0.18)
    setOffset('forearm.L_029', -0.18 - Math.abs(speakArm) * 0.4, 0, 0.12, 0.18)
    setOffset('upper_arm.R_047', 0.06 - speakArm * 0.5, 0, -0.52 - Math.sin(t * 1.6) * 0.03, 0.18)
    setOffset('forearm.R_048', -0.18 - Math.abs(speakArm) * 0.4, 0, -0.12, 0.18)
  }
}
