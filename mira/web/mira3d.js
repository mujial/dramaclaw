/* MIRA — 3D body.
 *
 * Loads a real glTF/GLB model (the user's own file) and animates it.
 * Nothing here is hard-coded to one asset: whatever arrives is measured,
 * centred and framed, its animation clips are played, and if it has no clips
 * it gets a gentle idle so she still looks alive.
 *
 *   window.Mira3D.ready        -> model is on screen
 *   window.Mira3D.setState(s)  -> 'idle' | 'listening' | 'thinking' | 'talking'
 *   window.Mira3D.dispose()
 */
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const canvas = document.getElementById('mira3d');
const holder = document.getElementById('mira3dWrap');

let renderer, scene, camera, clock, mixer, root, actions = [], active = null;
let state = 'idle';
let baseY = 0, sway = 0, energy = 0;
let baseHeight = 1.9, lookAtY = 1.0;
let fitDims = { h: 2, w: 1, mid: 1 };
let running = false;

function measure(rootObj) {
  // skinned meshes report their bind-pose box, which can be far bigger than
  // what you actually see — so measure every mesh in world space and union it
  rootObj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let any = false;
  rootObj.traverse((o) => {
    if (!(o.isMesh || o.isSkinnedMesh) || !o.geometry) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) return;
    const b = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
    if (!isFinite(b.min.x) || !isFinite(b.max.y)) return;
    box.union(b);
    any = true;
  });
  if (!any || box.isEmpty()) box.setFromObject(rootObj);
  return box;
}

function fit(rootObj) {
  // 1. put the model's feet on the floor and its middle on the centre line
  let box = measure(rootObj);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  // if the measurement is nonsense, fall back to a plain bounding box
  if (!isFinite(size.y) || size.y <= 0) {
    box = new THREE.Box3().setFromObject(rootObj);
    box.getSize(size);
    box.getCenter(centre);
  }

  rootObj.position.x -= centre.x;
  rootObj.position.z -= centre.z;
  rootObj.position.y -= box.min.y;

  // 2. frame it with the camera rather than rescaling the asset: scaling a
  //    rigged mesh is what made only the legs visible
  rootObj.updateMatrixWorld(true);
  const b2 = measure(rootObj);
  const h = Math.max(0.0001, b2.max.y - b2.min.y);
  const w = Math.max(0.0001, b2.max.x - b2.min.x);
  baseHeight = h;

  const mid = b2.min.y + h * 0.55;              // look at the chest, not the feet
  fitDims = { h, w, mid };
  applyCamera();

  const dist = camera.position.z;
  camera.near = Math.max(0.01, dist * 0.02);
  camera.far = dist * 8;
  camera.updateProjectionMatrix();
  lookAtY = mid;
}

/** Place the camera so the whole body fits, for the current aspect ratio. */
function applyCamera(explicitDist) {
  const { h, w, mid } = fitDims;
  const fov = camera.fov * Math.PI / 180;
  const distH = (h / 2) / Math.tan(fov / 2);
  const distW = (w / 2) / Math.tan(fov / 2) / Math.max(0.3, camera.aspect);
  const dist = explicitDist || Math.max(distH, distW) * 1.22;
  camera.position.set(0, mid, dist);
  camera.lookAt(0, mid, 0);
  camera.updateProjectionMatrix();
}

function pickClip() {
  if (!actions.length) return null;
  // prefer an idle-ish clip, otherwise the first one
  const named = actions.find(a => /idle|breath|stand|wait|loop/i.test(a._clip.name || ''));
  const chosen = named || actions[0];
  chosen.reset().play();
  chosen.setLoop(THREE.LoopRepeat, Infinity);
  return chosen;
}

export function init(url = 'api/model') {
  if (!canvas || !holder) return Promise.reject(new Error('no canvas'));

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 1.15, 4.4);
  camera.lookAt(0, 1.0, 0);

  // studio-ish environment so skin, cloth and metal all sit right
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  } catch (e) {
    console.warn('no environment map:', e && e.message);
  }

  scene.add(new THREE.HemisphereLight(0xffe3f4, 0x16102a, 1.35));
  const key = new THREE.DirectionalLight(0xfff4e8, 2.9);
  key.position.set(2.6, 4.2, 3.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd3ff, 1.05);
  fill.position.set(-3.2, 2.2, 1.6);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xb388ff, 2.4);
  rim.position.set(-2.4, 3.0, -3.0);
  scene.add(rim);

  clock = new THREE.Clock();

  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url + '?t=' + Date.now(),
      (gltf) => {
        root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh || o.isSkinnedMesh) {
            o.frustumCulled = false;
            if (o.material) o.material.side = THREE.FrontSide;
          }
        });
        fit(root);
        baseY = root.position.y;
        scene.add(root);

        if (gltf.animations && gltf.animations.length) {
          mixer = new THREE.AnimationMixer(root);
          actions = gltf.animations.map((clip) => {
            const a = mixer.clipAction(clip);
            a._clip = clip;
            return a;
          });
          active = pickClip();
        }

        holder.classList.add('ready');
        document.body.dataset.avatar = '3d';
        resize();
        start();
        resolve({ clips: (gltf.animations || []).length });
      },
      undefined,
      (err) => { reject(err); }
    );
  });
}

function resize() {
  if (!renderer || !holder) return;
  const r = holder.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (root) applyCamera();   // re-frame for the new shape
}

function start() {
  if (running) return;
  running = true;
  const loop = () => {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    if (mixer) mixer.update(dt);

    if (root) {
      // idle life: breathing + a slow sway that leans in when she speaks
      const talking = state === 'talking';
      energy += ((talking ? 1 : 0) - energy) * Math.min(1, dt * 4);
      sway = Math.sin(t * 1.4) * 0.02;
      root.rotation.y = sway * (0.6 + energy * 2.2);
      root.rotation.z = Math.sin(t * 0.9) * 0.006;
      const amp = Math.max(0.0015, baseHeight * 0.004);
      root.position.y = baseY + Math.sin(t * 1.7) * (amp + energy * amp * 0.6);

      // when she talks, nod with the words so it reads as speech
      if (talking) {
        root.rotation.x = Math.sin(t * 11) * 0.012 * energy;
      } else {
        root.rotation.x += (0 - root.rotation.x) * Math.min(1, dt * 6);
      }
      // thinking: a small tilt
      if (state === 'thinking') root.rotation.z += 0.05;
    }

    renderer.render(scene, camera);
  };
  loop();
}

export function setState(s) {
  state = s || 'idle';
  document.body.dataset.mira3dState = state;
}

export function dispose() {
  running = false;
}

window.addEventListener('resize', resize);

window.Mira3D = {
  init,
  refit: () => { if (root) { fit(root); resize(); } },
  setState,
  dispose,
  get ready() { return !!root; },
  get clips() { return actions.map(a => a._clip.name); },
};
