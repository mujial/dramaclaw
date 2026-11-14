/* ============================================================
   M.E.E.R.A. — native voice bridge
   ============================================================
   Android WebView implements neither `speechSynthesis` nor
   `webkitSpeechRecognition`. This file fills both in using the
   `AndroidBridge` object that MainActivity injects, so the HUD's
   existing code path works with no changes.

   Load order matters: this must come BEFORE meera.js, because the
   HUD reads `window.SpeechRecognition` at module scope.
   ============================================================ */
(function () {
  'use strict';

  if (typeof window.AndroidBridge === 'undefined') return;

  var pendingUtterance = null;

  /* ---------- text to speech ---------- */
  function Utterance(text) {
    this.text = text == null ? '' : String(text);
    this.lang = 'en-IN';
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onpause = null;
    this.onresume = null;
    this.onboundary = null;
  }

  var synth = {
    speaking: false,
    pending: false,
    paused: false,

    speak: function (u) {
      var text = (u && u.text) || '';
      pendingUtterance = u;
      synth.speaking = true;
      if (u && typeof u.onstart === 'function') {
        try { u.onstart({ type: 'start' }); } catch (e) {}
      }
      try {
        window.AndroidBridge.speak(text);
      } catch (e) {
        synth._finish();
      }
    },

    cancel: function () {
      try { window.AndroidBridge.stopSpeaking(); } catch (e) {}
      synth._finish();
    },

    pause: function () { synth.paused = true; },
    resume: function () { synth.paused = false; },

    getVoices: function () { return []; },

    _finish: function () {
      var u = pendingUtterance;
      pendingUtterance = null;
      var was = synth.speaking;
      synth.speaking = false;
      if (was && u && typeof u.onend === 'function') {
        try { u.onend({ type: 'end' }); } catch (e) {}
      }
    }
  };

  // Android calls these back over the JS bridge
  window.__meeraSpeechEnd = function () { synth._finish(); };

  try {
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: Utterance, writable: true, configurable: true
    });
  } catch (e) { window.SpeechSynthesisUtterance = Utterance; }

  try {
    Object.defineProperty(window, 'speechSynthesis', {
      value: synth, writable: true, configurable: true
    });
  } catch (e) { window.speechSynthesis = synth; }

  /* ---------- speech to text ---------- */
  function Recognition() {
    this.lang = 'en-IN';
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.onresult = null;
    this.onend = null;
    this.onerror = null;
    this.onstart = null;
    this._active = false;
  }

  Recognition.prototype.start = function () {
    var self = this;

    // Continuous mode (the "wake word" listener) cannot run on Android:
    // the platform recogniser is a one-shot system dialog. Refuse politely
    // instead of reopening the dialog in a loop.
    if (this.continuous) {
      try { window.AndroidBridge.toast('Wake word needs a cloud voice service — use the mic button'); } catch (e) {}
      throw new Error('continuous recognition unsupported on Android');
    }

    this._active = true;
    if (typeof this.onstart === 'function') {
      try { this.onstart({}); } catch (e) {}
    }

    window.__meeraSpeechResult = function (text) {
      if (!self._active) return;
      var clean = String(text || '').trim();
      self._active = false;
      if (!clean) {
        self._fail('no-speech');
        return;
      }
      if (typeof self.onresult === 'function') {
        try {
          self.onresult({
            resultIndex: 0,
            results: [[{ transcript: clean, confidence: 1 }]]
          });
        } catch (e) {}
      }
      self._end();
    };

    window.__meeraSpeechFail = function (why) {
      if (!self._active) return;
      self._active = false;
      self._fail(why || 'no-speech');
      self._end();
    };

    try {
      window.AndroidBridge.listen();
    } catch (e) {
      this._active = false;
      this._fail('not-allowed');
    }
  };

  Recognition.prototype._fail = function (why) {
    if (typeof this.onerror === 'function') {
      try { this.onerror({ error: why }); } catch (e) {}
    }
  };

  Recognition.prototype._end = function () {
    if (typeof this.onend === 'function') {
      try { this.onend({}); } catch (e) {}
    }
  };

  Recognition.prototype.stop = function () { this._active = false; };
  Recognition.prototype.abort = function () { this._active = false; };

  window.SpeechRecognition = Recognition;
  window.webkitSpeechRecognition = Recognition;

  /* ---------- small niceties ---------- */
  // haptics for taps, if the page asks for it
  window.__meeraVibrate = function (ms) {
    try { window.AndroidBridge.vibrate(ms || 18); } catch (e) {}
  };

  // stop reading when the user leaves the app
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      try { window.AndroidBridge.stopSpeaking(); } catch (e) {}
    }
  });

  document.documentElement.classList.add('is-android-native');
})();
