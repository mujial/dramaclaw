/* Boots her 3D body. Kept separate so a missing model or an old WebView can
   never break the rest of the UI: everything here fails soft. */
import { init, setState } from './mira3d.js';

(async () => {
  const wrap = document.getElementById('mira3dWrap');
  const avatar = document.getElementById('avatar');
  if (!wrap || !avatar) return;

  try {
    const info = await init('api/model');
    avatar.classList.add('ready-3d');
    console.log('MIRA 3D ready, clips:', info.clips);
  } catch (e) {
    console.warn('3D model unavailable, using the still avatar:', e && e.message);
    wrap.remove();
  }

  // let the rest of the app drive her expressions
  window.setMira3dState = setState;
})();
