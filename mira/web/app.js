/* ============================================================
   MIRA — companion client
   ============================================================ */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const S = {
  view: 'companion',
  state: 'idle',            // idle | listening | thinking | speaking
  mode: 'chat',             // chat | agent
  settings: {},
  status: null,
  session: localStorage.getItem('mira.session') || (() => {
    const id = 's-' + Date.now().toString(36);
    localStorage.setItem('mira.session', id);
    return id;
  })(),
  ws: null,
  audioCtx: null,
  analyser: null,
  micStream: null,
  playing: null,
  mouthLevel: 0,
  speakingSynthetic: false,
  speechGen: 0,
  recognition: null,
  recogniseWanted: false,
  voiceList: [],
};

/* ------------------------------------------------------------
   tiny helpers
------------------------------------------------------------ */
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms);
}

/* The Android shell loads this UI from file:///android_asset and passes the
   backend address as ?api=http://192.168.x.x:8090. In a browser it stays ''. */
const API_BASE = (() => {
  try {
    const q = new URLSearchParams(location.search).get('api');
    return q ? String(q).replace(/\/+$/, '') : '';
  } catch (e) { return ''; }
})();

function apiUrl(path) {
  const p = String(path).replace(/^\/+/, '');
  return API_BASE ? API_BASE + '/' + p : p;
}

/* Native bridge injected by MainActivity.java (Android only). */
const NATIVE = (typeof window.MiraNative !== 'undefined' && window.MiraNative) ? window.MiraNative : null;

async function api(path, opts = {}) {
  const res = await fetch(apiUrl(path), {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { raw: txt }; }
  if (!res.ok) throw new Error((data && (data.error || data.detail)) || res.statusText);
  return data;
}

const setState = (s) => {
  S.state = s;
  document.body.dataset.state = s;
  const label = { idle: 'ready', listening: 'listening', thinking: 'thinking', speaking: 'speaking' }[s];
  $('#stateText').textContent = label;
};

const setEmotion = (e) => { document.body.dataset.emotion = e || 'neutral'; };

/* ------------------------------------------------------------
   avatar animation
------------------------------------------------------------ */
function startBlink() {
  const blinkImg = $('.avatar .blink');
  const doBlink = () => {
    blinkImg.style.opacity = '1';
    const dur = 110 + Math.random() * 70;
    setTimeout(() => {
      blinkImg.style.opacity = '0';
      // occasional double blink
      if (Math.random() < 0.16) {
        setTimeout(() => {
          blinkImg.style.opacity = '1';
          setTimeout(() => { blinkImg.style.opacity = '0'; }, 90);
        }, 120);
      }
    }, dur);
    setTimeout(doBlink, 2400 + Math.random() * 4200);
  };
  setTimeout(doBlink, 900);
}

function startMouth() {
  const talkImg = $('.avatar .talk');
  const tick = () => {
    let level = S.mouthLevel;

    if (S.analyser) {
      const buf = new Uint8Array(S.analyser.frequencyBinCount);
      S.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      level = Math.min(1, Math.sqrt(sum / buf.length) * 4.2);
    } else if (S.speakingSynthetic) {
      // no analyser (device TTS): synthesise a natural mouth rhythm
      const t = performance.now() / 1000;
      const env = 0.5 + 0.5 * Math.sin(t * 9.1) * Math.sin(t * 3.7);
      level = 0.25 + env * 0.7;
    } else {
      level = 0;
    }

    S.mouthLevel = level;
    const open = level > 0.16;
    talkImg.style.opacity = open ? String(Math.min(1, 0.45 + level)) : '0';
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------
   device voices
------------------------------------------------------------ */
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const grab = () => {
    S.voiceList = speechSynthesis.getVoices() || [];
    const sel = $('#setVoice');
    if (sel && S.voiceList.length) {
      const configured = S.settings.voice_id || '';
      sel.innerHTML = S.voiceList.map(v =>
        `<option value="${v.name}"${v.name === configured ? ' selected' : ''}>${v.name} — ${v.lang}</option>`
      ).join('');
    }
  };
  grab();
  speechSynthesis.onvoiceschanged = grab;
}

function bestDeviceVoice() {
  const v = S.voiceList;
  if (!v.length) return null;
  const tests = [
    x => /female/i.test(x.name) && /(hi|en-IN)/i.test(x.lang),
    x => /(hi-IN|hi_IN)/i.test(x.lang),
    x => /(en-IN)/i.test(x.lang) && /female|neerja|aditi|heera|priya/i.test(x.name),
    x => /female|aria|jenny|zira|samantha|neerja|swara/i.test(x.name),
    x => /^en/i.test(x.lang),
  ];
  for (const t of tests) { const hit = v.find(t); if (hit) return hit; }
  return v[0];
}

/* ------------------------------------------------------------
   speech out
------------------------------------------------------------ */
async function speak(text) {
  if (!text || S.settings.voice_enabled === false) return;
  stopSpeaking();
  setState('speaking');

  const gen = S.speechGen;
  const engine = S.settings.voice_engine || 'auto';

  // ---- device voice: one utterance, no network ----
  if (engine === 'native') { deviceSpeak(text); return; }

  // ---- server voice, pipelined ----
  // Older builds fetched the whole reply before playing a single word, so a
  // 3-sentence answer took several seconds of silence. Now the first sentence
  // is fetched alone (small = fast), playback starts the moment it lands, and
  // the remaining sentences are already in flight.
  const chunks = splitForSpeech(text);
  if (!chunks.length) { deviceSpeak(text); return; }

  const fetchChunk = (t) => fetch(apiUrl('api/tts'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: t, voice_id: S.settings.voice_id, engine }),
  }).then(async (res) => {
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.startsWith('audio')) return await res.blob();
    return null;
  }).catch(() => null);

  let pending = fetchChunk(chunks[0]);
  for (let i = 0; i < chunks.length; i++) {
    if (gen !== S.speechGen) return;
    const current = pending;
    if (i + 1 < chunks.length) pending = fetchChunk(chunks[i + 1]);

    const blob = await current;
    if (gen !== S.speechGen) return;

    if (!blob) {
      // Server had no voice engine — fall back to the device for the rest.
      deviceSpeak(chunks.slice(i).join(' '));
      return;
    }
    await playBlob(blob);
    if (gen !== S.speechGen) return;
  }
}

/**
 * Split a reply into speakable pieces. The first piece is deliberately short so
 * audio starts almost immediately; later pieces are bigger (fewer round trips).
 */
function splitForSpeech(text, firstLimit = 90, restLimit = 200) {
  const clean = String(text)
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/[*_#>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];

  const sentences = clean.match(/[^.!?।]+[.!?।]*/g) || [clean];
  const out = [];
  let cur = '', limit = firstLimit;

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if ((cur + ' ' + sentence).trim().length <= limit) {
      cur = (cur + ' ' + sentence).trim();
      continue;
    }
    if (cur) { out.push(cur); limit = restLimit; }
    // a single monster sentence still has to be broken up
    let rest = sentence;
    while (rest.length > limit) {
      let cut = rest.lastIndexOf(' ', limit);
      if (cut < limit * 0.5) cut = limit;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
      limit = restLimit;
    }
    cur = rest;
  }
  if (cur) out.push(cur);
  return out.filter(Boolean);
}

function playBlob(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    S.playing = audio;

    try {
      if (!S.audioCtx) S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
      const src = S.audioCtx.createMediaElementSource(audio);
      const an = S.audioCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      an.connect(S.audioCtx.destination);
      S.analyser = an;
    } catch (e) { S.analyser = null; }

    const done = () => {
      S.analyser = null;
      S.mouthLevel = 0;
      URL.revokeObjectURL(url);
      if (S.playing === audio) S.playing = null;
      if (S.state === 'speaking') setState('idle');
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

function deviceSpeak(text) {
  if (NATIVE && NATIVE.speak) {
    S.speakingSynthetic = true;
    setState('speaking');
    try {
      NATIVE.speak(text, Number(S.settings.voice_rate || 1), Number(S.settings.voice_pitch || 1));
    } catch (e) {
      S.speakingSynthetic = false;
      setState('idle');
    }
    return;
  }
  if (!('speechSynthesis' in window)) {
    setState('idle');
    toast('No voice engine available on this device');
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = bestDeviceVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = Number(S.settings.voice_rate || 1);
  u.pitch = Number(S.settings.voice_pitch || 1);
  u.volume = Number(S.settings.voice_volume != null ? S.settings.voice_volume : 1);

  S.speakingSynthetic = true;
  u.onend = u.onerror = () => {
    S.speakingSynthetic = false;
    S.mouthLevel = 0;
    if (S.state === 'speaking') setState('idle');
    maybeRestartRecognition();
  };
  speechSynthesis.speak(u);
}

function stopSpeaking() {
  S.speechGen = (S.speechGen || 0) + 1;
  if (NATIVE && NATIVE.stopSpeaking) { try { NATIVE.stopSpeaking(); } catch (e) {} }
  if (S.playing) { try { S.playing.pause(); } catch (e) {} S.playing = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  S.speakingSynthetic = false;
  S.analyser = null;
  S.mouthLevel = 0;
  if (S.state === 'speaking') setState('idle');
}

/* ------------------------------------------------------------
   microphone + VAD
------------------------------------------------------------ */
async function ensureMic() {
  if (S.micStream) return true;
  try {
    S.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (!S.audioCtx) S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = S.audioCtx.createMediaStreamSource(S.micStream);
    const an = S.audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    S.micAnalyser = an;
    startVAD();
    return true;
  } catch (e) {
    toast('Microphone permission needed');
    return false;
  }
}

let vadLoudFrames = 0;

function startVAD() {
  const tick = () => {
    if (S.micAnalyser) {
      const buf = new Uint8Array(S.micAnalyser.frequencyBinCount);
      S.micAnalyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const loud = rms > 0.055;
      vadLoudFrames = loud ? vadLoudFrames + 1 : Math.max(0, vadLoudFrames - 1);

      if (S.settings.interrupt_enabled !== false && S.state === 'speaking' && vadLoudFrames > 4) {
        interrupt();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function interrupt() {
  stopSpeaking();
  vadLoudFrames = 0;
  setState('idle');
  toast('Suno, main sun rahi hoon…', 1400);
  if (!S.recognition) startRecognition();
}

/* ------------------------------------------------------------
   speech in (Web Speech API)
------------------------------------------------------------ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/* callbacks MainActivity.java calls back into */
window.__miraSpeechEnd = function () {
  S.speakingSynthetic = false;
  S.mouthLevel = 0;
  if (S.state === 'speaking') setState('idle');
  maybeRestartRecognition();
};
window.__miraSpeechResult = function (text) {
  S.recogniseWanted = false;
  if (S.state === 'listening') setState('idle');
  const t = (text || '').trim();
  if (t) submit(t);
  else maybeRestartRecognition();
};
window.__miraSpeechError = function (msg) {
  if (S.state === 'listening') setState('idle');
  toast(msg || 'Speech recognition failed', 3500);
};
window.__miraSpeechPartial = function (text) {
  if (text) {
    $('#caption').textContent = text;
    $('#captionMeta').textContent = 'you · ' + nowTime();
  }
};

function startRecognition() {
  if (NATIVE && NATIVE.listen) {
    S.recogniseWanted = true;
    try {
      NATIVE.listen();
      setState('listening');
      $('#caption').textContent = 'Sun rahi hoon…';
      $('#captionMeta').textContent = 'listening';
      return true;
    } catch (e) {
      toast('Mic error: ' + e.message, 3500);
      return false;
    }
  }
  if (!SR) { toast('Voice input needs Chrome or the Android app'); return false; }
  if (S.recognition) return true;

  const rec = new SR();
  rec.lang = 'hi-IN';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = '';
  let silenceTimer = null;

  const resetSilence = () => {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (finalText.trim()) {
        const t = finalText.trim();
        finalText = '';
        submit(t);
      }
    }, 1250);
  };

  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    $('#caption').textContent = (finalText + interim).trim() || '…';
    if (interim) resetSilence();
    if (finalText.trim()) resetSilence();
  };

  rec.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      toast('Microphone permission denied');
      stopRecognition();
    } else if (ev.error === 'no-speech') {
      /* benign */
    }
  };

  rec.onend = () => {
    if (S.recogniseWanted) {
      setTimeout(() => { try { rec.start(); } catch (e) {} }, 220);
    }
  };

  try {
    rec.start();
  } catch (e) { return false; }

  S.recognition = rec;
  S.recogniseWanted = true;
  setState('listening');
  return true;
}

function stopRecognition() {
  S.recogniseWanted = false;
  if (NATIVE && NATIVE.stopListening) { try { NATIVE.stopListening(); } catch (e) {} }
  if (S.recognition) {
    try { S.recognition.stop(); } catch (e) {}
    S.recognition = null;
  }
  if (S.state === 'listening') setState('idle');
}

function maybeRestartRecognition() {
  if (S.settings.continuous_conversation !== false && S.recogniseWanted) {
    if (!S.recognition) startRecognition();
  }
}

/* ------------------------------------------------------------
   conversation
------------------------------------------------------------ */
async function submit(text, opts) {
  opts = opts || {};
  text = (text || '').trim();
  if (!text) return;

  stopSpeaking();
  if (opts.echo !== false) addChat('user', text);
  $('#caption').textContent = text;
  $('#captionMeta').textContent = 'you · ' + nowTime();
  setState('thinking');

  try {
    const body = {
      text,
      session: S.session,
      mode: S.mode,
      auto_confirm: !!opts.autoConfirm,
    };
    const res = await api('api/chat', { method: 'POST', body: JSON.stringify(body) });
    handleReply(res);
  } catch (e) {
    setState('idle');
    $('#caption').textContent = 'Connection problem — server se baat nahi ho rahi.';
    $('#captionMeta').textContent = String(e.message || e);
    toast('Server error: ' + e.message, 4000);
  }
}

function handleReply(res) {
  const reply = res.reply || '(no reply)';
  setEmotion(res.emotion);
  addChat('mira', reply);

  $('#caption').textContent = reply;
  const bits = [];
  if (res.provider) bits.push(res.provider + (res.fallback ? ' (fallback)' : ''));
  if (res.memories_added && res.memories_added.length) bits.push('+' + res.memories_added.length + ' memory');
  if (res.memories_used && res.memories_used.length) bits.push(res.memories_used.length + ' recalled');
  $('#captionMeta').textContent = bits.join(' · ') || nowTime();

  if (res.error) toast(String(res.error).slice(0, 160), 4200);

  setState('idle');
  speak(reply);

  const actions = res.actions || (res.agent && res.agent.actions) || [];
  if (actions.length) runActions(actions);

  if (res.agent) {
    renderAgentTrace(res.agent);
    showConfirm(res.agent);
  }
}

/* ------------------------------------------------------------
   device actions — the phone opens things, the brain only asks
------------------------------------------------------------ */
function runActions(actions) {
  for (const a of actions || []) {
    try {
      if (a.action === 'open_app') {
        if (NATIVE && NATIVE.openApp) NATIVE.openApp(a.app);
        else toast(`"${a.app}" sirf Android app me khulta hai`, 4000);
      } else if (a.action === 'open_url') {
        if (NATIVE && NATIVE.openUrl) NATIVE.openUrl(a.url);
        else window.open(a.url, '_blank', 'noopener');
      } else if (a.action === 'phone') {
        if (NATIVE && NATIVE.phone) NATIVE.phone(a.kind, a.value || '');
        else toast(`Phone action (${a.kind}) sirf Android app me chalta hai`, 4000);
      }
    } catch (e) {
      toast('Action fail: ' + e.message, 3500);
    }
  }
}

/* ------------------------------------------------------------
   confirmation gate for consequential actions
------------------------------------------------------------ */
let pendingGoal = null;

function showConfirm(report) {
  const bar = $('#confirmBar');
  const pend = report && report.pending_confirmation;
  if (!report || report.status !== 'needs_confirmation' || !pend) {
    bar.hidden = true;
    pendingGoal = null;
    return;
  }
  pendingGoal = report.goal;
  $('#confirmText').textContent =
    `${pend.tool} chalane ki permission chahiye — allow karun?`;
  bar.hidden = false;
}

function addChat(who, text) {
  const log = $('#chatLog');
  const el = document.createElement('div');
  el.className = 'msg ' + who;
  el.innerHTML = `<span class="who">${who === 'mira' ? 'MIRA' : 'YOU'}</span>`;
  el.appendChild(document.createTextNode(text));
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function renderAgentTrace(report) {
  const steps = (report.steps || [])
    .map(s => `• ${s.status === 'ok' ? '✓' : s.status === 'failed' ? '✗' : '·'} ${s.step}${s.summary ? ' — ' + s.summary : ''}`)
    .join('\n');
  if (!steps) return;
  addChat('mira', `[task trace]\n${steps}\n${report.verify && report.verify.verified ? '✓ verified' : '⚠ ' + ((report.verify && report.verify.reason) || '')}`);
}

/* ------------------------------------------------------------
   views
------------------------------------------------------------ */
function go(view) {
  S.view = view;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.go === view));
  document.body.dataset.view = view;
  if (view === 'memory') loadMemory();
  if (view === 'skills') loadSkills();
  if (view === 'settings') loadSettingsUI();
  if (view === 'chat') $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
}

/* ------------------------------------------------------------
   memory UI
------------------------------------------------------------ */
async function loadMemory() {
  const q = ($('#memSearch').value || '').trim();
  try {
    const data = q
      ? await api('api/memory/search?q=' + encodeURIComponent(q))
      : await api('api/memory');
    const items = q ? data.results : data.memories;
    const stats = (await api('api/status')).memory;

    $('#memStats').innerHTML = `
      <div class="stat"><b>${stats.memories}</b><span>memories</span></div>
      <div class="stat"><b>${stats.episodes}</b><span>turns</span></div>
      <div class="stat"><b>${stats.sessions}</b><span>sessions</span></div>`;

    const list = $('#memList');
    if (!items.length) {
      list.innerHTML = '<div class="empty">Nothing here yet. Talk to MIRA — she picks things up.</div>';
      return;
    }
    list.innerHTML = '';
    items.forEach(m => {
      const el = document.createElement('div');
      el.className = 'mem-item';
      const when = new Date((m.updated || m.created) * 1000).toLocaleDateString();
      el.innerHTML = `
        <span class="cat">${m.category || 'fact'}</span>
        <div class="body">
          <div class="txt"></div>
          <div class="meta">${when} · ${m.source || 'conversation'} · conf ${Number(m.confidence || 0).toFixed(1)}</div>
        </div>
        <button title="Delete">✕</button>`;
      el.querySelector('.txt').textContent = m.content;
      el.querySelector('button').onclick = async () => {
        await api('api/memory/' + m.id, { method: 'DELETE' });
        loadMemory();
      };
      list.appendChild(el);
    });
  } catch (e) {
    $('#memList').innerHTML = `<div class="empty">Could not load memory: ${e.message}</div>`;
  }
}

/* ------------------------------------------------------------
   skills UI
----------------------------------------------------------- */
async function loadSkills() {
  try {
    const data = await api('api/skills');
    const grid = $('#skillGrid');
    grid.innerHTML = '';
    data.skills.forEach(sk => {
      const el = document.createElement('div');
      el.className = 'skill-card';
      el.innerHTML = `
        <h4>${sk.skill}</h4>
        <div class="perms">${sk.permissions.map(p => `<span class="perm ${p}">${p}</span>`).join('')}</div>
        <div class="tools">${sk.tools.join(', ')}</div>
        <div class="foot">
          <label class="switch"><input type="checkbox" ${sk.enabled ? 'checked' : ''}><span></span></label>
          <span class="note">${sk.enabled ? 'enabled' : 'disabled'}</span>
        </div>`;
      el.querySelector('input').onchange = async (e) => {
        await api(`api/skills/${encodeURIComponent(sk.skill)}/toggle?enabled=${e.target.checked}`, { method: 'POST' });
        toast(`${sk.skill} ${e.target.checked ? 'enabled' : 'disabled'}`);
        loadSkills();
      };
      grid.appendChild(el);
    });

    const eng = await api('api/status');
    const list = $('#engineList');
    list.innerHTML = '';
    (eng.engines || []).forEach(e => {
      const el = document.createElement('div');
      el.className = 'engine ' + (e.ready ? 'ready' : e.installed ? 'installed' : '');
      el.innerHTML = `<i></i><span class="nm">${e.name}</span>
        <span class="rp">${e.kind || ''}<br>${e.ready ? 'ready' : e.installed ? 'installed' : 'not installed'}</span>`;
      list.appendChild(el);
    });
  } catch (e) {
    $('#skillGrid').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

/* ------------------------------------------------------------
   settings UI
------------------------------------------------------------ */
async function loadSettingsUI() {
  try {
    const data = await api('api/settings');
    S.settings = data.settings || {};
    const st = await api('api/status');
    S.status = st;

    $('#setProvider').value = S.settings.provider || 'local';
    $('#setModel').value = S.settings.model || '';
    $('#setBaseUrl').value = S.settings.base_url || '';
    $('#setVoiceEnabled').checked = S.settings.voice_enabled !== false;
    $('#setInterrupt').checked = S.settings.interrupt_enabled !== false;
    $('#setContinuous').checked = S.settings.continuous_conversation !== false;
    $('#setMemory').checked = S.settings.memory_enabled !== false;
    $('#setAutoExtract').checked = S.settings.auto_extract_memory !== false;
    $('#setUserName').value = S.settings.user_name || '';
    $('#setRate').value = S.settings.voice_rate || 1;
    $('#setPitch').value = S.settings.voice_pitch || 1;
    $('#lblRate').textContent = Number($('#setRate').value).toFixed(2);
    $('#lblPitch').textContent = Number($('#setPitch').value).toFixed(2);

    const v = st.voice || {};
    const sel = $('#setVoice');
    const gem = (v.gemini_catalogue || []).map(x => ({
      id: 'gemini:' + x.id, label: '★ ' + x.label,
    }));
    const edge = (v.catalogue || []).map(x => ({ id: x.id, label: x.label }));
    const cur = S.settings.voice_id || v.voice_id || '';
    const tag = (arr, name) => arr.length
      ? `<optgroup label="${name}">` + arr.map(x =>
          `<option value="${x.id}"${x.id === cur ? ' selected' : ''}>${x.label}</option>`
        ).join('') + '</optgroup>'
      : '';
    sel.innerHTML = tag(gem, 'Gemini — her own voice (needs a Gemini key)')
                  + tag(edge, 'edge-tts — free neural fallback');

    $('#keyNote').textContent = (st.secrets && st.secrets.encrypted)
      ? 'Keys are encrypted with AES-GCM on this device and never sent anywhere except the provider you chose.'
      : 'cryptography module missing — keys fall back to file permissions (0600).';

    const vn = [];
    vn.push(v.gemini && v.gemini.configured ? 'Gemini voice: ready (her own voice)' : 'Gemini voice: needs a Gemini key');
    vn.push(v.elevenlabs && v.elevenlabs.configured ? 'ElevenLabs: ready (premium)' : 'ElevenLabs: needs a key');
    vn.push(v.edge_tts && v.edge_tts.installed ? 'edge-tts: installed (free neural voice)' : 'edge-tts: not installed');
    vn.push('Device voice: always available');
    $('#voiceNote').textContent = vn.join(' · ');

    $('#aboutText').textContent =
      `MIRA ${st.version} · provider: ${st.provider.active} · ` +
      `secrets: ${st.secrets.encrypted ? 'encrypted' : 'unencrypted'} · ` +
      `memory: ${st.memory.memories} facts, ${st.memory.episodes} turns · ` +
      `uptime ${Math.round(st.uptime_sec)}s`;

    loadVoices();
  } catch (e) {
    toast('Settings failed to load: ' + e.message, 4000);
  }
}

async function saveSetting(patch) {
  Object.assign(S.settings, patch);
  try {
    const res = await api('api/settings', { method: 'PUT', body: JSON.stringify({ settings: patch }) });
    S.settings = res.settings;
  } catch (e) { toast('Could not save: ' + e.message); }
}

/* ------------------------------------------------------------
   wiring
------------------------------------------------------------ */
function wire() {
  $$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.go));

  // mic
  $('#btnMic').onclick = async () => {
    if (S.state === 'listening') {
      stopRecognition();
      return;
    }
    stopSpeaking();
    await ensureMic();
    if (!startRecognition()) return;
    $('#hint').textContent = 'Listening… bolo';
    setTimeout(() => { $('#hint').textContent = 'Tap the circle and speak — or type below'; }, 4000);
  };

  // mode toggle
  $('#btnMode').onclick = () => {
    S.mode = S.mode === 'chat' ? 'agent' : 'chat';
    $('#modeIcon').textContent = S.mode === 'chat' ? '💬' : '⚡';
    toast(S.mode === 'chat' ? 'Chat mode — MIRA talks.' : 'Task mode — MIRA acts, then reports.');
  };

  // mute
  $('#btnMute').onclick = async () => {
    const on = S.settings.voice_enabled === false;
    await saveSetting({ voice_enabled: on });
    $('#muteIcon').textContent = on ? '🔊' : '🔇';
    if (!on) stopSpeaking();
    toast(on ? 'Voice on' : 'Voice muted');
  };

  // type
  $('#typeForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#typeInput').value.trim();
    if (!v) return;
    $('#typeInput').value = '';
    stopRecognition();
    submit(v);
  };

  // agent confirmation
  $('#confirmYes').onclick = () => {
    if (!pendingGoal) return;
    const goal = pendingGoal;
    $('#confirmBar').hidden = true;
    pendingGoal = null;
    addChat('user', 'Allow.');
    submit(goal, { autoConfirm: true, echo: false });
  };
  $('#confirmNo').onclick = () => {
    const goal = pendingGoal;
    $('#confirmBar').hidden = true;
    pendingGoal = null;
    addChat('mira', 'Theek hai, nahi karti. Kuch aur bolo.');
    speak('Theek hai, nahi karti.');
    void goal;
  };

  // chat
  $('#btnClearChat').onclick = async () => {
    await api('api/history?session=' + encodeURIComponent(S.session), { method: 'DELETE' });
    $('#chatLog').innerHTML = '';
    toast('Conversation cleared');
  };

  // memory
  $('#btnRefreshMem').onclick = loadMemory;
  $('#memSearch').oninput = debounce(loadMemory, 320);
  $('#memForm').onsubmit = async (e) => {
    e.preventDefault();
    const content = $('#memInput').value.trim();
    if (!content) return;
    try {
      await api('api/memory', { method: 'POST', body: JSON.stringify({ content, category: $('#memCategory').value }) });
      $('#memInput').value = '';
      loadMemory();
      toast('Remembered');
    } catch (err) { toast(err.message, 4000); }
  };
  $('#btnExport').onclick = () => { window.location.href = 'api/memory/export'; };

  // skills
  $('#btnRefreshSkills').onclick = loadSkills;

  // settings
  $('#setProvider').onchange = (e) => { saveSetting({ provider: e.target.value }); refreshPill(); };
  $('#setModel').onchange = (e) => saveSetting({ model: e.target.value.trim() });
  $('#setBaseUrl').onchange = (e) => saveSetting({ base_url: e.target.value.trim() });
  $('#setVoice').onchange = (e) => saveSetting({ voice_id: e.target.value });
  $('#setRate').oninput = (e) => { $('#lblRate').textContent = Number(e.target.value).toFixed(2); };
  $('#setRate').onchange = (e) => saveSetting({ voice_rate: Number(e.target.value) });
  $('#setPitch').oninput = (e) => { $('#lblPitch').textContent = Number(e.target.value).toFixed(2); };
  $('#setPitch').onchange = (e) => saveSetting({ voice_pitch: Number(e.target.value) });
  $('#setVoiceEnabled').onchange = (e) => saveSetting({ voice_enabled: e.target.checked });
  $('#setInterrupt').onchange = (e) => saveSetting({ interrupt_enabled: e.target.checked });
  $('#setContinuous').onchange = (e) => saveSetting({ continuous_conversation: e.target.checked });
  $('#setMemory').onchange = (e) => saveSetting({ memory_enabled: e.target.checked });
  $('#setAutoExtract').onchange = (e) => saveSetting({ auto_extract_memory: e.target.checked });
  $('#setUserName').onchange = (e) => saveSetting({ user_name: e.target.value.trim() });

  $$('[data-save-key]').forEach(btn => {
    btn.onclick = async () => {
      const p = btn.dataset.saveKey;
      const input = { gemini: '#keyGemini', openai: '#keyOpenai', elevenlabs: '#keyEleven' }[p];
      const key = $(input).value.trim();
      if (!key) return toast('Key khali hai');
      try {
        await api('api/keys', { method: 'POST', body: JSON.stringify({ provider: p, key }) });
        $(input).value = '';
        toast(p + ' key saved (encrypted)');
        refreshPill();
      } catch (e) { toast(e.message, 4000); }
    };
  });

  $$('[data-test-key]').forEach(btn => {
    btn.onclick = async () => {
      const p = btn.dataset.testKey;
      btn.textContent = '…';
      try {
        const res = await api('api/keys/test', { method: 'POST', body: JSON.stringify({ provider: p, key: '' }) });
        btn.textContent = 'Test';
        toast(res.ok ? `${p}: OK (${res.latency_ms}ms)` : `${p}: ${res.error || 'failed'}`, 4500);
      } catch (e) { btn.textContent = 'Test'; toast(e.message, 4000); }
    };
  });

  $('#btnVoiceTest').onclick = () => {
    speak('Namaste. Main MIRA hoon. Aap kaise ho?');
  };
  $('#btnVoiceFallback').onclick = async () => {
    await saveSetting({ voice_engine: 'native' });
    toast('Using the device voice');
    deviceSpeak('Namaste. Ye device ki awaaz hai.');
  };

  $('#btnWipe').onclick = async () => {
    if (!confirm('Delete ALL conversations and memories? This cannot be undone.')) return;
    await api('api/privacy/wipe', { method: 'POST', body: JSON.stringify({ confirm: true }) });
    $('#chatLog').innerHTML = '';
    loadMemory();
    toast('Everything deleted');
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { stopSpeaking(); stopRecognition(); }
    if (e.key === ' ' && e.target.tagName === 'BODY') { e.preventDefault(); $('#btnMic').click(); }
  });

  window.addEventListener('beforeunload', stopSpeaking);
}

function debounce(fn, ms) {
  let h;
  return function (...a) { clearTimeout(h); h = setTimeout(() => fn.apply(this, a), ms); };
}

async function refreshPill() {
  try {
    const st = await api('api/status');
    S.status = st;
    const p = st.provider;
    let label = 'local core';
    if (p.active === 'gemini' && p.gemini_configured) label = 'gemini';
    else if (p.active === 'openai' && p.openai_configured) label = 'openai-compat';
    else if (p.active !== 'local' && !p.gemini_configured && !p.openai_configured) label = st.provider.active + ' (no key)';
    $('#providerLabel').textContent = label;

    const pill = $('#statePill');
    pill.classList.toggle('bad', p.telemetry && p.telemetry.errors > 0 && S.state === 'idle' && p.active !== 'local');
  } catch (e) {
    $('#providerLabel').textContent = 'offline';
    $('#statePill').classList.add('bad');
    $('#stateText').textContent = 'offline';
  }
}

async function loadHistory() {
  try {
    const data = await api('api/history?session=' + encodeURIComponent(S.session));
    (data.messages || []).forEach(m => {
      addChat(m.role === 'user' ? 'user' : 'mira', m.content);
    });
    if (data.messages && data.messages.length) {
      const last = data.messages[data.messages.length - 1];
      $('#caption').textContent = last.content;
    }
  } catch (e) { /* first run */ }
}

/* ------------------------------------------------------------
   boot
------------------------------------------------------------ */
async function boot() {
  setState('idle');
  startBlink();
  startMouth();
  wire();

  const st = await api('api/status').catch(() => null);
  if (st) {
    S.settings = st.settings || {};
    $('#muteIcon').textContent = S.settings.voice_enabled === false ? '🔇' : '🔊';
  }
  await refreshPill();
  loadVoices();
  await loadHistory();

  // WebSocket gives us a `thinking` signal before the answer
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsBase = API_BASE ? API_BASE.replace(/^http/, 'ws') : `${proto}://${location.host}`;
    S.ws = new WebSocket(`${wsBase}/ws`);
    S.ws.onopen = () => { /* reserved for streaming */ };
    S.ws.onclose = () => { S.ws = null; };
  } catch (e) { /* REST still works */ }

  // ---- Android shell: server address ----
  if (NATIVE) {
    const card = $('#serverCard');
    if (card) {
      card.hidden = false;
      $('#serverNow').textContent = API_BASE || 'not set (local only)';
      $('#btnServerSet').onclick = () => {
        if (NATIVE.promptServer) NATIVE.promptServer();
      };
      $('#btnServerPing').onclick = async () => {
        try {
          const r = await api('api/health');
          toast('Server OK · uptime ' + Math.round(r.uptime_sec || 0) + 's');
        } catch (e) { toast('Server nahi mila: ' + e.message, 4500); }
      };
    }
  }

  // first-run reachability check (never blocks the UI)
  api('api/health').catch(() => {
    if (NATIVE) toast('Server se connect nahi hua — Settings me address daalo', 6000);
  });

  setInterval(refreshPill, 30000);
}

document.addEventListener('DOMContentLoaded', boot);
