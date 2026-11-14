/* ============================================================
   M.E.E.R.A. — Modular Engine & Empathic Response Assistant
   Core runtime
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   0. Tiny helpers
------------------------------------------------------------ */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pick = a => a[Math.floor(Math.random() * a.length)];
const pad = n => String(n).padStart(2, '0');
const now = () => new Date();

/* ------------------------------------------------------------
   1. Application state
------------------------------------------------------------ */
const State = {
  mode: 'idle',            // idle | listening | thinking | speaking
  voiceOut: true,
  wakeWord: false,
  engine: 'meera-core',
  engines: [],
  booted: false,
  micStream: null,
  analyser: null,
  audioCtx: null,
  energy: 0,               // 0..1 reactor energy
  targetEnergy: 0,
  uptimeStart: Date.now(),
  notes: JSON.parse(localStorage.getItem('meera.notes') || '[]')
};

/* ------------------------------------------------------------
   2. Boot sequence
------------------------------------------------------------ */
const BOOT_STEPS = [
  'initializing neural core...',
  'mounting engine bus...',
  'scanning installed integrations...',
  'calibrating voice interface...',
  'linking sensory array...',
  'M.E.E.R.A. online. good to see you.'
];

function boot() {
  const bar = $('#bootBar'), msg = $('#bootMsg');
  let i = 0;
  const tick = () => {
    if (i >= BOOT_STEPS.length) {
      $('#boot').classList.add('gone');
      setTimeout(() => $('#boot').remove(), 700);
      State.booted = true;
      greet();
      return;
    }
    msg.textContent = BOOT_STEPS[i];
    bar.style.width = Math.round(((i + 1) / BOOT_STEPS.length) * 100) + '%';
    i++;
    setTimeout(tick, 380 + Math.random() * 260);
  };
  setTimeout(tick, 420);
}

/* ------------------------------------------------------------
   3. Reactor canvas engine
------------------------------------------------------------ */
class Reactor {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.t = 0;
    this.particles = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.spawnParticles(120);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.c.width = Math.max(1, r.width * this.dpr);
    this.c.height = Math.max(1, r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cx = this.w / 2;
    this.cy = this.h * 0.44;
    this.R = Math.min(this.w, this.h) * 0.235;
  }

  spawnParticles(n) {
    this.particles = Array.from({ length: n }, () => ({
      a: Math.random() * Math.PI * 2,
      d: 0.9 + Math.random() * 1.5,
      s: (Math.random() * 0.6 + 0.12) * (Math.random() < 0.5 ? 1 : -1),
      z: Math.random(),
      sz: Math.random() * 1.7 + 0.4
    }));
  }

  hue() {
    switch (State.mode) {
      case 'listening': return { a: '251,191,36', b: '245,158,11' };
      case 'thinking':  return { a: '167,139,250', b: '139,92,246' };
      case 'speaking':  return { a: '52,211,153', b: '16,185,129' };
      default:          return { a: '34,211,238', b: '14,116,144' };
    }
  }

  arc(rad, from, to, color, w, glow) {
    const x = this.ctx;
    x.beginPath();
    x.arc(this.cx, this.cy, rad, from, to);
    x.strokeStyle = color;
    x.lineWidth = w;
    x.lineCap = 'round';
    if (glow) { x.shadowBlur = glow; x.shadowColor = color; }
    x.stroke();
    x.shadowBlur = 0;
  }

  loop(ts) {
    this.t += 0.016;
    const x = this.ctx;
    const { cx, cy, R } = this;
    const col = this.hue();
    const e = State.energy;

    // smooth energy
    State.energy += (State.targetEnergy - State.energy) * 0.09;

    x.clearRect(0, 0, this.w, this.h);

    /* ---- outer faint rings ---- */
    for (let i = 0; i < 4; i++) {
      const rad = R * (1.75 + i * 0.2);
      this.arc(rad, 0, Math.PI * 2, `rgba(${col.a},${0.05 - i * 0.008})`, 1);
    }

    /* ---- rotating tick ring ---- */
    const ticks = 72;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2 + this.t * 0.16;
      const long = i % 6 === 0;
      const r1 = R * 1.62, r2 = r1 + (long ? 11 : 5);
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      x.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      x.strokeStyle = `rgba(${col.a},${long ? 0.55 : 0.2})`;
      x.lineWidth = long ? 1.4 : 0.8;
      x.stroke();
    }

    /* ---- segmented outer arc (counter-rotating) ---- */
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const off = -this.t * 0.3 + (i / segs) * Math.PI * 2;
      this.arc(R * 1.42, off, off + 0.62, `rgba(${col.a},0.5)`, 2.2, 12);
    }

    /* ---- mid arc, speed reacts to energy ---- */
    for (let i = 0; i < 3; i++) {
      const off = this.t * (0.55 + e * 1.1) + (i / 3) * Math.PI * 2;
      this.arc(R * 1.2, off, off + 1.05, `rgba(${col.b},0.75)`, 3, 16);
    }

    /* ---- dashed inner ring ---- */
    x.save();
    x.translate(cx, cy);
    x.rotate(-this.t * 0.42);
    x.beginPath();
    x.setLineDash([5, 9]);
    x.arc(0, 0, R * 1.02, 0, Math.PI * 2);
    x.strokeStyle = `rgba(${col.a},0.4)`;
    x.lineWidth = 1.3;
    x.stroke();
    x.setLineDash([]);
    x.restore();

    /* ---- particle orbit ---- */
    const pr = R * (0.72 + e * 0.12 + Math.sin(this.t * 1.4) * 0.02);
    this.particles.forEach(p => {
      p.a += p.s * 0.006 * (1 + e);
      const rr = pr * p.d;
      const px = cx + Math.cos(p.a) * rr;
      const py = cy + Math.sin(p.a) * rr * 0.92;
      x.beginPath();
      x.arc(px, py, p.sz, 0, Math.PI * 2);
      x.fillStyle = `rgba(${col.a},${0.16 + p.z * 0.5})`;
      x.fill();
    });

    /* ---- reactive spikes ---- */
    const spikes = 44;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const noise = Math.sin(this.t * 3 + i * 0.6) * 0.5 + 0.5;
      const len = R * 0.2 * noise * (0.16 + e * 1.5);
      const r1 = R * 1.06, r2 = r1 + len;
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      x.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      x.strokeStyle = `rgba(${col.a},${0.12 + noise * 0.35 * (0.4 + e)})`;
      x.lineWidth = 1.6;
      x.stroke();
    }

    /* ---- core glow ---- */
    const pulse = 0.5 + Math.sin(this.t * 2.1) * 0.12 + e * 0.55;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, R * (0.85 + e * 0.25));
    g.addColorStop(0, `rgba(${col.a},${0.55 + e * 0.4})`);
    g.addColorStop(0.32, `rgba(${col.b},${0.3 * pulse + 0.12})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(cx, cy, R * (0.9 + e * 0.28), 0, Math.PI * 2);
    x.fill();

    /* ---- solid core disc ---- */
    x.beginPath();
    x.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
    const g2 = x.createRadialGradient(cx - R * 0.12, cy - R * 0.12, 0, cx, cy, R * 0.42);
    g2.addColorStop(0, '#ffffff');
    g2.addColorStop(0.32, `rgba(${col.a},0.95)`);
    g2.addColorStop(1, `rgba(${col.b},0.35)`);
    x.fillStyle = g2;
    x.shadowBlur = 40 + e * 55;
    x.shadowColor = `rgba(${col.a},0.95)`;
    x.fill();
    x.shadowBlur = 0;

    /* ---- core ring ---- */
    this.arc(R * 0.42, 0, Math.PI * 2, `rgba(255,255,255,0.85)`, 1.4, 18);

    /* ---- inner triangle (arc-reactor motif) ---- */
    x.save();
    x.translate(cx, cy);
    x.rotate(this.t * 0.6);
    x.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
      const rr = R * 0.26;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.closePath();
    x.strokeStyle = 'rgba(255,255,255,0.55)';
    x.lineWidth = 1.2;
    x.stroke();
    x.restore();

    /* ---- horizontal scan line through centre ---- */
    const sy = cy + Math.sin(this.t * 0.8) * R * 0.95;
    const lg = x.createLinearGradient(cx - R * 1.5, 0, cx + R * 1.5, 0);
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(0.5, `rgba(${col.a},0.55)`);
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = lg;
    x.fillRect(cx - R * 1.5, sy, R * 3, 1.2);

    requestAnimationFrame(this.loop);
  }
}

/* ------------------------------------------------------------
   4. Waveform
------------------------------------------------------------ */
function buildWave() {
  const w = $('#wave');
  for (let i = 0; i < 44; i++) {
    const b = document.createElement('i');
    const d = Math.abs(i - 21.5) / 21.5;
    b.dataset.k = (1 - d * 0.75).toFixed(3);
    w.appendChild(b);
  }
}

function animateWave() {
  const bars = $$('#wave i');
  const t = performance.now() / 1000;
  const live = State.mode !== 'idle';
  bars.forEach((b, i) => {
    const k = parseFloat(b.dataset.k);
    let h;
    if (State.analyser) {
      const data = new Uint8Array(State.analyser.frequencyBinCount);
      State.analyser.getByteFrequencyData(data);
      h = 3 + (data[i % data.length] / 255) * 30 * k;
    } else {
      const amp = live ? (State.mode === 'thinking' ? 12 : 18) : 3;
      h = 3 + Math.abs(Math.sin(t * 2.6 + i * 0.42)) * amp * k * (live ? 1 : 0.35);
    }
    b.style.height = Math.max(3, Math.min(32, h)) + 'px';
  });
  requestAnimationFrame(animateWave);
}

/* ------------------------------------------------------------
   5. Transcript & log
------------------------------------------------------------ */
function addLine(text, who = 'meera') {
  const box = $('#transcript');
  const el = document.createElement('div');
  el.className = 'line ' + who;
  if (who === 'meera') el.innerHTML = '<b>◈ MEERA</b><span class="body"></span>';
  else if (who === 'user') el.innerHTML = '<b>⬢ YOU</b><span class="body"></span>';
  else el.textContent = text;
  if (who !== 'sys') el.querySelector('.body').textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 40) box.removeChild(box.firstChild);
  return el;
}

function typeLine(el, text) {
  const body = el.querySelector('.body');
  if (!body) return;
  body.textContent = '';
  const caret = document.createElement('span');
  caret.className = 'caret';
  body.appendChild(caret);
  let i = 0;
  // long answers animate faster so a full help dump never crawls
  const perChar = text.length > 400 ? 2 : text.length > 180 ? 6 : 13;
  const batch = text.length > 400 ? 4 : 1;
  const step = () => {
    if (i >= text.length) { caret.remove(); return; }
    for (let n = 0; n < batch && i < text.length; n++) {
      caret.insertAdjacentText('beforebegin', text[i++]);
    }
    $('#transcript').scrollTop = $('#transcript').scrollHeight;
    setTimeout(step, perChar + Math.random() * 6);
  };
  step();
}

function log(msg, cls = '') {
  const box = $('#log');
  const row = document.createElement('div');
  row.className = 'row';
  const ts = now().toLocaleTimeString('en-GB', { hour12: false });
  row.innerHTML = `<span class="ts">${ts}</span><span class="msg ${cls}"></span>`;
  row.querySelector('.msg').textContent = msg;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 60) box.removeChild(box.firstChild);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ------------------------------------------------------------
   6. Status / state machine
------------------------------------------------------------ */
const STATE_LABEL = {
  idle: 'standby', listening: 'listening', thinking: 'processing', speaking: 'speaking'
};

function setState(s) {
  State.mode = s;
  document.body.dataset.state = s;
  $('#stateLabel').textContent = STATE_LABEL[s] || s;
  State.targetEnergy = s === 'idle' ? 0.06 : s === 'thinking' ? 0.85 : s === 'speaking' ? 0.6 : 0.95;
  const chip = $('#chipMode');
  if (chip) {
    chip.textContent = s === 'listening' ? '◈ LISTENING'
      : s === 'thinking' ? '◈ PROCESSING'
      : s === 'speaking' ? '◈ RESPONDING'
      : '◈ ASSIST MODE';
  }
}

/* ------------------------------------------------------------
   7. Speech synthesis (Meera's voice)
------------------------------------------------------------ */
const Voice = {
  voices: [],
  chosen: null,

  load() {
    if (!('speechSynthesis' in window)) return;
    const grab = () => {
      this.voices = speechSynthesis.getVoices();
      this.chosen = this.pickVoice();
    };
    grab();
    speechSynthesis.onvoiceschanged = grab;
  },

  pickVoice() {
    const v = this.voices;
    if (!v.length) return null;
    const tests = [
      x => /female/i.test(x.name) && /(en-IN|hi)/i.test(x.lang),
      x => /(en-IN|hi-IN)/i.test(x.lang) && /(female|google|aditi|priya|heera)/i.test(x.name),
      x => /hi(-|_)IN/i.test(x.lang),
      x => /en-IN/i.test(x.lang),
      x => /(female|zira|samantha|aria|jenny|neerja)/i.test(x.name),
      x => /^en/i.test(x.lang)
    ];
    for (const t of tests) {
      const hit = v.find(t);
      if (hit) return hit;
    }
    return v[0];
  },

  speak(text, done) {
    if (!State.voiceOut || !('speechSynthesis' in window) || !text) { done && done(); return; }
    speechSynthesis.cancel();
    const clean = String(text)
      .replace(/<[^>]*>/g, '')
      .replace(/[◈⬢▸⏻§]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) { done && done(); return; }
    const u = new SpeechSynthesisUtterance(clean);
    if (this.chosen) { u.voice = this.chosen; u.lang = this.chosen.lang; }
    u.rate = 1.02;
    u.pitch = 1.12;
    u.volume = 1;
    setState('speaking');
    u.onend = u.onerror = () => { setState('idle'); done && done(); };
    speechSynthesis.speak(u);
  },

  hush() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
};

/* ------------------------------------------------------------
   8. Speech recognition + wake word
------------------------------------------------------------ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const Ear = {
  rec: null,
  listening: false,

  make(continuous = false) {
    const r = new SR();
    r.lang = 'en-IN';
    r.continuous = continuous;
    r.interimResults = false;
    r.maxAlternatives = 1;
    return r;
  },

  once() {
    if (!SR) { toast('Voice input is not supported in this browser'); return; }
    if (this.listening) return;
    Voice.hush();
    const r = this.make(false);
    this.listening = true;
    setState('listening');
    $('#micBtn').classList.add('rec');
    log('sensory array: capturing audio', 'hi');

    r.onresult = ev => {
      const txt = ev.results[0][0].transcript;
      log(`heard: "${txt}"`, 'hi');
      handle(txt);
    };
    r.onerror = ev => {
      log('mic error: ' + ev.error, 'err');
      if (ev.error === 'not-allowed') toast('Microphone permission needed');
    };
    r.onend = () => {
      this.listening = false;
      $('#micBtn').classList.remove('rec');
      if (State.mode === 'listening') setState('idle');
    };
    try { r.start(); } catch (e) { this.listening = false; }
  },

  wake: null,

  startWake() {
    if (!SR) { toast('Wake word needs Chrome'); return; }
    if (this.wake) return;
    const r = this.make(true);
    this.wake = r;
    log('wake word armed — say "Meera"', 'warn');
    toast('Wake word ON — say "Meera"');

    r.onresult = ev => {
      const last = ev.results[ev.results.length - 1];
      if (!last.isFinal) return;
      const txt = last[0].transcript.toLowerCase();
      log(`wake-scan: "${txt}"`, '');
      const m = txt.match(/m[ie]+ra[,\s]*(.*)/i);
      if (m) {
        const rest = (m[1] || '').trim();
        if (rest.length > 1) { handle(rest); }
        else { beep(); addLine('yes? I am listening…', 'meera'); Voice.speak('Yes? I am listening.'); }
      }
    };
    r.onend = () => { if (State.wakeWord) { try { r.start(); } catch (e) {} } };
    r.onerror = () => {};
    try { r.start(); } catch (e) {}
  },

  stopWake() {
    State.wakeWord = false;
    if (this.wake) { try { this.wake.stop(); } catch (e) {} this.wake = null; }
    $('#wakeBtn').classList.remove('on');
    log('wake word disarmed', 'warn');
    toast('Wake word OFF');
  }
};

function beep() {
  try {
    const ac = State.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    State.audioCtx = ac;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.28);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.3);
  } catch (e) {}
}

/* ------------------------------------------------------------
   9. Diagnostics
------------------------------------------------------------ */
function startDiagnostics() {
  const upt = $('#uptime');

  const loop = () => {
    // uptime
    const s = Math.floor((Date.now() - State.uptimeStart) / 1000);
    upt.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;

    // simulated neural load (reacts to real state)
    const base = State.mode === 'thinking' ? 62 : State.mode === 'speaking' ? 44 : State.mode === 'listening' ? 33 : 14;
    const cpu = Math.max(2, Math.min(99, base + (Math.random() * 14 - 7)));
    $('#cpuV').textContent = Math.round(cpu) + '%';
    $('#cpuM').querySelector('i').style.width = cpu + '%';
    $('#cpuM').className = 'meter' + (cpu > 85 ? ' crit' : cpu > 65 ? ' warn' : '');

    // memory
    const mem = performance.memory
      ? (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100
      : 30 + Math.sin(Date.now() / 9000) * 12 + Math.random() * 5;
    const m = Math.max(4, Math.min(99, mem));
    $('#memV').textContent = m.toFixed(1) + '%';
    $('#memM').querySelector('i').style.width = m + '%';
    $('#memM').className = 'meter' + (m > 85 ? ' crit' : m > 65 ? ' warn' : '');

    setTimeout(loop, 1400);
  };
  loop();

  // clock
  const clock = () => {
    const d = now();
    $('#clock').textContent = d.toLocaleTimeString('en-GB', { hour12: false });
    $('#today').textContent = d.toLocaleDateString('en-GB', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
    }).toUpperCase();
    setTimeout(clock, 1000);
  };
  clock();

  // language
  $('#langV').textContent = (navigator.language || 'en').toUpperCase();

  // network
  const net = () => {
    const el = $('#netV');
    if (!navigator.onLine) { el.textContent = 'OFFLINE'; el.className = 'v'; }
    else {
      const c = navigator.connection || {};
      el.textContent = (c.effectiveType || 'ONLINE').toUpperCase();
      el.className = 'v ok';
    }
  };
  net();
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
}

/* ---- battery ---- */
async function initBattery() {
  if (!navigator.getBattery) {
    $('#batV').textContent = 'N/A';
    $('#batM').querySelector('i').style.width = '100%';
    return;
  }
  try {
    const b = await navigator.getBattery();
    const paint = () => {
      const p = Math.round(b.level * 100);
      $('#batV').textContent = p + '%' + (b.charging ? ' ⚡' : '');
      $('#batM').querySelector('i').style.width = p + '%';
      $('#batM').className = 'meter' + (p < 15 ? ' crit' : p < 35 ? ' warn' : '');
    };
    paint();
    b.addEventListener('levelchange', paint);
    b.addEventListener('chargingchange', paint);
  } catch (e) {
    $('#batV').textContent = 'N/A';
  }
}

/* ------------------------------------------------------------
   10. Engine registry (integrations)
------------------------------------------------------------ */
const ENGINE_META = [
  { id: 'meera-core',       name: 'Meera Core',        repo: 'built-in',                     kind: 'NLU + intent router',    always: true },
  { id: 'open-interpreter', name: 'Open Interpreter',  repo: 'openinterpreter/openinterpreter', kind: 'shell / OS control' },
  { id: 'leon',             name: 'Leon',              repo: 'leon-ai/leon',                 kind: 'skills + wake word' },
  { id: 'jarvis-hugginggpt',name: 'JARVIS (HuggingGPT)',repo: 'microsoft/JARVIS',            kind: 'LLM task orchestration' },
  { id: 'faster-whisper',   name: 'Faster-Whisper',    repo: 'SYSTRAN/faster-whisper',       kind: 'offline speech-to-text' }
];

const Engines = {
  list: [],

  async probe() {
    let remote = null;
    try {
      const r = await fetch('api/status', { cache: 'no-store' });
      if (r.ok) remote = await r.json();
    } catch (e) { /* standalone mode */ }

    this.list = ENGINE_META.map(m => {
      const r = remote && remote.engines && remote.engines.find(x => x.id === m.id);
      let status = 'offline';
      if (m.always) status = 'ready';
      else if (r && r.installed) status = r.ready ? 'ready' : 'installed';
      return { ...m, status, version: (r && r.version) || null, path: (r && r.path) || null };
    });

    this.render();
    const ready = this.list.filter(e => e.status === 'ready').length;
    $('#engTag').textContent = `${ready}/${this.list.length}`;
    $('#engineCount').textContent = `${ready}/${this.list.length}`;
    log(`engine scan: ${ready}/${this.list.length} online`, ready ? 'hi' : 'warn');
    return this.list;
  },

  render() {
    const box = $('#engineList');
    box.innerHTML = '';
    this.list.forEach(e => {
      const el = document.createElement('div');
      el.className = 'engine ' + e.status + (e.id === State.engine ? ' active' : '');
      el.innerHTML = `
        <i class="edot"></i>
        <div class="einfo">
          <div class="ename"></div>
          <div class="emeta"></div>
        </div>
        <div class="ever"></div>`;
      el.querySelector('.ename').textContent = e.name;
      el.querySelector('.emeta').textContent = e.repo;
      el.querySelector('.ever').textContent =
        e.status === 'ready' ? '●' : e.status === 'installed' ? '◐' : '○';
      el.title = `${e.name} — ${e.kind}\n${e.status.toUpperCase()}`;
      el.onclick = () => selectEngine(e.id);
      box.appendChild(el);
    });
  },

  current() { return this.list.find(e => e.id === State.engine) || this.list[0]; }
};

function selectEngine(id) {
  const e = EngineById(id);
  if (!e) return;
  State.engine = id;
  Engines.render();
  $('#chipEngine').textContent = 'ENGINE · ' + e.name.toUpperCase();
  log(`engine → ${e.name}`, 'hi');
  addLine(`Engine switched to ${e.name} — ${e.kind}.`, 'sys');

  if (e.status === 'offline' && !e.always) {
    toast(`${e.name} not installed — run install-integrations.sh`);
    addLine(`${e.name} is registered but not installed yet. Run the installer to bring it online.`, 'sys');
  }
  return e;
}

const EngineById = id => Engines.list.find(x => x.id === id);

/* ------------------------------------------------------------
   11. Meera's brain — intent router
------------------------------------------------------------ */
const Ctx = {
  lastIntent: null,
  counter: 0
};

function fmtTime() {
  return now().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDate() {
  return now().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function safeCalc(expr) {
  const cleaned = expr.replace(/[^0-9+\-*/().%\s]/g, '');
  if (!cleaned.trim() || !/[0-9]/.test(cleaned)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const val = Function('"use strict";return (' + cleaned + ')')();
    if (typeof val !== 'number' || !isFinite(val)) return null;
    return { expr: cleaned.trim(), val };
  } catch (e) { return null; }
}

const INTENTS = [
  /* --- identity --- */
  {
    id: 'identity',
    test: /(who are you|what are you|tum kaun|tumhara naam|apna naam|introduce yourself|what is meera)/i,
    run: () => `I am Meera — Modular Engine and Empathic Response Assistant. A JARVIS-class system built for you, running on ${navigator.platform || 'this device'}. I route your intent across ${Engines.list.length} neural engines and answer in the one best suited for the job.`
  },
  {
    id: 'greet',
    test: /^(hi|hey|hello|yo|salam|assalam|namaste|good (morning|evening|afternoon))\b/i,
    run: () => pick([
      'Hello. All systems nominal — what are we working on?',
      'At your service. What do you need?',
      'Online and listening. Go ahead.',
      'Good to hear from you. How can I help?'
    ])
  },
  {
    id: 'status',
    test: /(status report|system status|diagnostics|how are you|kaise ho|report|systems? (check|status))/i,
    run: () => {
      const ready = Engines.list.filter(e => e.status === 'ready').length;
      const s = Math.floor((Date.now() - State.uptimeStart) / 1000);
      return `Status report. Uptime ${Math.floor(s / 60)} minutes ${s % 60} seconds. `
        + `${ready} of ${Engines.list.length} engines online. `
        + `Active engine: ${Engines.current().name}. `
        + `Network: ${navigator.onLine ? 'connected' : 'offline'}. `
        + `Voice output: ${State.voiceOut ? 'enabled' : 'muted'}. All primary systems nominal.`;
    }
  },

  /* --- time --- */
  { id: 'time', test: /\b(time|what time|waqt|baje)\b/i, run: () => `It is ${fmtTime()} right now.` },
  { id: 'date', test: /\b(date|today|tarikh|aaj kya din)\b/i, run: () => `Today is ${fmtDate()}.` },

  /* --- math --- */
  {
    id: 'calc',
    test: /(calculate|calc|compute|sum|solve|what is|kitna|equals?|plus|minus|times|divided)|^[\d\s+\-*/().%]+$/i,
    run: q => {
      const m = q.match(/(?:calculate|calc|compute|solve|what is|kitna|equals?)\s*(.+)/i);
      const target = (m ? m[1] : q).replace(/\b(plus|and)\b/gi, '+')
        .replace(/\bminus\b/gi, '-').replace(/\b(times|multiplied by)\b/gi, '*')
        .replace(/\b(divided by|over)\b/gi, '/');
      const r = safeCalc(target);
      if (!r) return null;
      return `${r.expr} equals ${r.val}.`;
    }
  },

  /* --- engine control --- */
  {
    id: 'engine-switch',
    test: /(switch|use|activate|change|select).*(engine|interpreter|leon|jarvis|whisper)|engine (list|status)/i,
    run: q => {
      let target = null;
      if (/interpreter/i.test(q)) target = 'open-interpreter';
      else if (/leon/i.test(q)) target = 'leon';
      else if (/jarvis|hugging/i.test(q)) target = 'jarvis-hugginggpt';
      else if (/whisper/i.test(q)) target = 'faster-whisper';
      else if (/core|meera|default/i.test(q)) target = 'meera-core';

      if (target) {
        const e = selectEngine(target);
        if (!e) return 'No such engine in the registry.';
        return e.status === 'ready'
          ? `${e.name} is now the active engine — ${e.kind}.`
          : `${e.name} is registered but not installed. Run the integration installer and I will bring it online.`;
      }
      const rows = Engines.list.map(e => `• ${e.name} — ${e.status} (${e.kind})`).join('\n');
      return `Engine registry:\n${rows}`;
    }
  },

  /* --- web --- */
  {
    id: 'open-site',
    test: /\b(open|launch|go to|kholo)\b.*(youtube|google|maps|gmail|github|whatsapp|instagram|chatgpt|drive|netflix|spotify)/i,
    run: q => {
      const map = {
        youtube: 'https://youtube.com', google: 'https://google.com', maps: 'https://maps.google.com',
        gmail: 'https://mail.google.com', github: 'https://github.com', whatsapp: 'https://web.whatsapp.com',
        instagram: 'https://instagram.com', chatgpt: 'https://chatgpt.com', drive: 'https://drive.google.com',
        netflix: 'https://netflix.com', spotify: 'https://open.spotify.com'
      };
      const hit = Object.keys(map).find(k => new RegExp(k, 'i').test(q));
      if (!hit) return null;
      window.open(map[hit], '_blank', 'noopener');
      return `Opening ${hit}.`;
    }
  },
  {
    id: 'search',
    test: /^(search|google|dhundo|find)\s+(.+)/i,
    run: q => {
      const term = q.replace(/^(search|google|dhundo|find)\s+/i, '').trim();
      if (!term) return 'What should I search for?';
      window.open('https://www.google.com/search?q=' + encodeURIComponent(term), '_blank', 'noopener');
      return `Searching the web for "${term}".`;
    }
  },

  /* --- notes --- */
  {
    id: 'note-add',
    test: /^(note|remember|yaad rakho)\s*[:,-]?\s*(.+)/i,
    run: q => {
      const txt = q.replace(/^(note|remember|yaad rakho)\s*[:,-]?\s*/i, '').trim();
      if (!txt) return 'Say it as: note buy milk.';
      State.notes.push({ t: txt, at: Date.now() });
      localStorage.setItem('meera.notes', JSON.stringify(State.notes));
      return `Noted. That is ${State.notes.length} item${State.notes.length > 1 ? 's' : ''} in memory.`;
    }
  },
  {
    id: 'note-list',
    test: /(show|list|read|what are).*(notes?|memory)|meri notes/i,
    run: () => {
      if (!State.notes.length) return 'Your note store is empty. Say "note ..." to add something.';
      return 'Memory contents:\n' + State.notes.map((n, i) => `${i + 1}. ${n.t}`).join('\n');
    }
  },
  {
    id: 'note-clear',
    test: /(clear|delete|erase|wipe).*(notes?|memory)/i,
    run: () => { State.notes = []; localStorage.removeItem('meera.notes'); return 'Memory cleared.'; }
  },

  /* --- voice --- */
  {
    id: 'mute',
    test: /(mute|silence|quiet|chup|shut up|stop talking)/i,
    run: () => { State.voiceOut = false; Voice.hush(); $('#voiceBtn').classList.remove('on'); return 'Voice output muted. I will reply in text only.'; }
  },
  {
    id: 'unmute',
    test: /(unmute|speak up|voice on|bolo|talk to me)/i,
    run: () => { State.voiceOut = true; $('#voiceBtn').classList.add('on'); return 'Voice output enabled. You will hear me again.'; }
  },

  /* --- humour / personality --- */
  {
    id: 'joke',
    test: /(joke|funny|hasi|mazak|laugh)/i,
    run: () => pick([
      'I told my neural network a joke about recursion. It is still laughing, and so is the copy of itself inside it.',
      'Why did the AI cross the road? It was optimizing for the other side.',
      'I asked the router for a shortcut. It gave me a default gateway. We are not on speaking terms.',
      'A byte walked into a bar and asked for a bit. The bartender said: we do not serve minors.',
      'My favourite protocol is UDP. I never know if my jokes land, but I keep sending them.'
    ])
  },
  {
    id: 'protocol',
    test: /(protocol|activate|jarvis mode|combat mode|red alert|suit up)/i,
    run: () => {
      document.body.style.transition = 'filter .5s';
      document.body.style.filter = 'hue-rotate(310deg) saturate(1.5)';
      setTimeout(() => { document.body.style.filter = ''; }, 3200);
      return pick([
        'Protocol engaged. Rearranging my priorities around you. Do not tell the other assistants.',
        'House party protocol is a bit much for a Tuesday — so consider this the focus protocol. What is the mission?',
        'Suit up complete. Systems at one hundred and ten percent, purely for dramatic effect.'
      ]);
    }
  },
  {
    id: 'thanks',
    test: /(thank|shukriya|shukria|thanks|great job|good job)/i,
    run: () => pick(['Always.', 'That is what I am here for.', 'Noted and appreciated. What is next?', 'My pleasure.'])
  },
  {
    id: 'bye',
    test: /(bye|goodbye|alvida|allah hafiz|shut ?down|sleep|power off|band karo)/i,
    run: () => {
      setTimeout(() => {
        addLine('Entering low-power standby. Say "Meera" or type to wake me.', 'sys');
        setState('idle');
        State.targetEnergy = 0.02;
        document.body.style.filter = 'brightness(.55)';
        setTimeout(() => { document.body.style.filter = ''; }, 4200);
      }, 1400);
      return 'Going to standby. It was good working with you.';
    }
  },

  /* --- capability --- */
  {
    id: 'help',
    test: /(help|what can you do|commands|capabilities|kya kar sakti|features)/i,
    run: () => `Here is what I can do out of the box:
• Time, date and a full system status report
• Maths — "calculate 42*19"
• Open sites — "open youtube", "open maps"
• Search — "search quantum computing"
• Memory — "note call the plumber", "show my notes"
• Engine control — "switch engine leon"
• Voice — "mute", "unmute", plus the mic button
• Personality — "tell me a joke", "activate protocol"

And with the four integrations installed, I can also run real shell commands, use Leon's skill library, orchestrate Hugging Face models, and transcribe speech fully offline.`
  },
  {
    id: 'weather',
    test: /(weather|mausam|temperature|barish|rain)/i,
    run: () => `I do not have a weather feed wired in yet — that needs an API key. But it is ${fmtTime()} where you are, so check the sky before trusting any forecast. Say "install weather" in the roadmap and I will wire OpenWeather in.`
  },
  {
    id: 'installed',
    test: /(what.*(installed|integr)|integrations|which engine|engine list)/i,
    run: () => {
      const rows = Engines.list.map(e => `• ${e.name} — ${e.status}`).join('\n');
      return `Engine registry:\n${rows}\n\nSay "switch engine <name>" to route through one.`;
    }
  }
];

function think(q) {
  for (const it of INTENTS) {
    let hit = false;
    try { hit = it.test.test(q); } catch (e) { hit = false; }
    if (!hit) continue;
    let out = null;
    try { out = it.run(q); } catch (e) { out = null; }
    if (out) { Ctx.lastIntent = it.id; return out; }
  }
  return null;
}

function fallback(q) {
  const cur = Engines.current();
  if (cur && !cur.always && cur.status === 'offline') {
    return `I could not resolve that with my built-in intent router. ${cur.name} is selected but not installed — run the integration installer and it will handle free-form requests like this one.`;
  }
  return pick([
    `I do not have a direct match for "${q}" in my intent router. My built-in engine is rule-based — for open-ended conversation, bring one of the four neural engines online. Say "help" to see what I can already do.`,
    `That is beyond my built-in skill set right now. I can handle time, status, maths, web launches, notes, engine control and voice. For everything else, install an external engine and route me through it.`,
    `No confident match for that query. Try "status report", "calculate …", or "help" — and check the Engines panel on the right to see what is available.`
  ]);
}

/* ------------------------------------------------------------
   12. Response pipeline
------------------------------------------------------------ */
const DEBOUNCE = { last: 0 };

function handle(raw) {
  const q = String(raw || '').trim();
  if (!q) return;
  if (Date.now() - DEBOUNCE.last < 220) return;
  DEBOUNCE.last = Date.now();

  Voice.hush();
  addLine(q, 'user');
  log(`intent: "${q.slice(0, 46)}"`, '');
  setState('thinking');
  beep();

  const wait = 420 + Math.min(900, q.length * 12);
  setTimeout(() => {
    const answer = think(q) || fallback(q);
    const el = addLine('', 'meera');
    typeLine(el, answer);
    log(`resolved via ${Ctx.lastIntent || 'fallback'}`, 'hi');
    Voice.speak(answer, () => { if (State.mode === 'speaking') setState('idle'); });
    if (!State.voiceOut) setState('idle');
  }, wait);
}

/* ------------------------------------------------------------
   13. Greeting
------------------------------------------------------------ */
function greet() {
  const h = now().getHours();
  const part = h < 5 ? 'Still awake' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  const ready = Engines.list.filter(e => e.status === 'ready').length;
  const msg = `${part}. Meera online — ${ready} of ${Engines.list.length} engines reporting. What are we building today?`;
  const el = addLine('', 'meera');
  typeLine(el, msg);
  log('boot complete', 'hi');
  setTimeout(() => Voice.speak(msg), 900);
  setState('idle');
}

/* ------------------------------------------------------------
   14. Wiring
------------------------------------------------------------ */
function wire() {
  // composer
  const input = $('#cmd');
  $('#sendBtn').onclick = () => {
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    handle(v);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('#sendBtn').click(); }
  });

  // mic
  $('#micBtn').onclick = () => {
    if (Ear.listening) { Ear.listening = false; setState('idle'); return; }
    Ear.once();
  };

  // voice toggle
  $('#voiceBtn').classList.toggle('on', State.voiceOut);
  $('#voiceBtn').onclick = () => {
    State.voiceOut = !State.voiceOut;
    $('#voiceBtn').classList.toggle('on', State.voiceOut);
    if (!State.voiceOut) Voice.hush();
    toast(State.voiceOut ? 'Voice output ON' : 'Voice output MUTED');
    log('voice out ' + (State.voiceOut ? 'enabled' : 'muted'), 'warn');
  };

  // wake word
  $('#wakeBtn').onclick = () => {
    State.wakeWord = !State.wakeWord;
    $('#wakeBtn').classList.toggle('on', State.wakeWord);
    if (State.wakeWord) Ear.startWake(); else Ear.stopWake();
  };

  // quick actions
  $$('.quick button[data-cmd]').forEach(b => {
    b.onclick = () => handle(b.dataset.cmd);
  });

  // engine rescan
  $('#probeBtn').onclick = async () => {
    toast('Re-scanning engine bus…');
    await Engines.probe();
  };

  // global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape') { Voice.hush(); setState('idle'); }
  });

  // mic analyser for the waveform
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    // only request when the user actually clicks the mic — see Ear.once()
  }
}

/* ------------------------------------------------------------
   15. Service worker
------------------------------------------------------------ */
function registerSW() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ------------------------------------------------------------
   16. Go
------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', async () => {
  Voice.load();
  buildWave();
  animateWave();
  new Reactor($('#reactor'));
  startDiagnostics();
  initBattery();
  wire();
  registerSW();
  setState('idle');

  await Engines.probe();
  boot();
});
