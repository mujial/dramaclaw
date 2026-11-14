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

const canvas = document.getElementById('mira3d');
const holder = document.getElementById('mira3dWrap');

let renderer, scene, camera, clock, mixer, root, actions = [], active = null;
let state = 'idle';
let baseY = 0, sway = 0, energy = 0;
let running = false;

function fit(rootObj) {
  // centre whatever arrived and scale it to roughly 1.9 units tall
  const box = new THREE.Box3().setFromObject(rootObj);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  const height = Math.max(size.y, 0.0001);
  const scale = 1.9 / height;
  rootObj.scale.setScalar(scale);

  // re-measure after scaling so the feet sit on y=0 and the body is on x/z=0
  const box2 = new THREE.Box3().setFromObject(rootObj);
  const centre2 = new THREE.Vector3();
  box2.getCenter(centre2);
  rootObj.position.x -= centre2.x;
  rootObj.position.z -= centre2.z;
  rootObj.position.y -= box2.min.y;
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

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 1.15, 4.4);
  camera.lookAt(0, 1.0, 0);

  scene.add(new THREE.HemisphereLight(0xffd9f0, 0x1a0f2a, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2.4, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa78bfa, 2.0);
  rim.position.set(-3, 2, -2.5);
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
      root.position.y = baseY + Math.sin(t * 1.7) * (0.008 + energy * 0.006);

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
  setState,
  dispose,
  get ready() { return !!root; },
  get clips() { return actions.map(a => a._clip.name); },
};
