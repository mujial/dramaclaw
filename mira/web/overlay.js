/* MIRA — the floating strip.
 *
 * Lives inside MiraOverlayService's little WebView. The service owns the wake
 * word and the speech recognition; this page owns the face, the words and the
 * actions. No app window is opened: she is the window.
 */
import { init, setState } from './mira3d.js';

const NATIVE = window.MiraNative || null;
const bubble = document.getElementById('bubble');
const close = document.getElementById('close');

let speakingGen = 0;

function say(text, holdMs = 0) {
  bubble.textContent = text || '';
  bubble.classList.add('show');
  setState('talking');
  if (NATIVE && NATIVE.speak) NATIVE.speak(String(text || ''));
  const gen = ++speakingGen;
  if (holdMs) {
    setTimeout(() => {
      if (gen !== speakingGen) return;
      setState('idle');
      bubble.classList.remove('show');
    }, holdMs);
  }
}

function quiet() {
  setState('idle');
  bubble.classList.remove('show');
}

/* ---------------- device actions ---------------- */

const APP_SEARCH = {
  youtube: q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  spotify: q => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
  maps: q => `geo:0,0?q=${encodeURIComponent(q)}`,
};

function runActions(actions) {
  for (const a of actions || []) {
    try {
      if (!NATIVE) continue;
      if (a.action === 'open_app' && NATIVE.openApp) NATIVE.openApp(a.app);
      else if (a.action === 'app_search' && NATIVE.searchIn) NATIVE.searchIn(a.app, a.query);
      else if (a.action === 'open_url' && NATIVE.openUrl) NATIVE.openUrl(a.url || APP_SEARCH.youtube(a.query || ''));
      else if (a.action === 'phone' && NATIVE.phone) NATIVE.phone(a.kind, a.value || '');
      else if (a.action === 'message' && NATIVE.message) NATIVE.message(a.app || 'whatsapp', a.to || '', a.text || '');
      else if (a.action === 'torch' && NATIVE.torch) NATIVE.torch(!!a.on);
      else if (a.action === 'volume' && NATIVE.volume) NATIVE.volume(String(a.level || ''));
      else if (a.action === 'media' && NATIVE.media) NATIVE.media(a.cmd || 'toggle');
      else if (a.action === 'settings' && NATIVE.phone) NATIVE.phone('settings', '');
    } catch (e) {
      console.warn('action failed', a, e);
    }
  }
}

/* ---------------- commands from the service ---------------- */

window.__miraWake = () => {
  say('Haan?', 0);
  setState('listening');
};

window.__miraPrompt = () => {
  say('Bolo…', 0);
  setState('listening');
};

window.__miraCommand = async (text) => {
  setState('thinking');
  bubble.textContent = '…';
  bubble.classList.add('show');

  try {
    const res = await fetch('api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, stream: false }),
    });
    const data = await res.json();

    const reply = data.reply || 'Kuch samajh nahi aaya.';
    say(reply, 0);
    if (data.actions && data.actions.length) runActions(data.actions);

    // stay a moment, then fold away — the phone is yours again
    setTimeout(() => {
      quiet();
      if (NATIVE && NATIVE.hide) NATIVE.hide();
    }, 4200);
  } catch (e) {
    say('Server se baat nahi ho rahi.', 3000);
  }
};

close.addEventListener('click', () => {
  quiet();
  if (NATIVE && NATIVE.hide) NATIVE.hide();
});

/* ---------------- boot ---------------- */
(async () => {
  document.getElementById('dot').style.background = '#a78bfa';
  try {
    const info = await init('api/model');
    console.log('overlay 3D ready, clips:', info.clips);
  } catch (e) {
    console.warn('overlay has no 3D model:', e && e.message);
    document.getElementById('mira3dWrap').style.display = 'none';
    bubble.classList.add('show');
    bubble.textContent = 'Hey Mira';
  }
})();
