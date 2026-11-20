'use strict';
// Interface sounds, synthesised with Web Audio (no files): short, quiet, and switchable in the music panel.
//   MS.sfx.play('tap' | 'pick' | 'coin' | 'up' | 'level' | 'win' | 'lose' | 'buy' | 'msg')
(() => {
  const MS = window.MS;
  const KEY = 'ms_sfx';
  let ctx = null;
  let on = MS.store.get(KEY) !== false;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // one soft note: frequency, start offset (s), length (s), wave, peak volume
  function note(a, f, t0, len, type = 'sine', vol = 0.08) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, a.currentTime + t0);
    g.gain.setValueAtTime(0.0001, a.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(vol, a.currentTime + t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t0 + len);
    o.connect(g).connect(a.destination);
    o.start(a.currentTime + t0);
    o.stop(a.currentTime + t0 + len + 0.02);
  }

  const SOUNDS = {
    tap: (a) => note(a, 660, 0, 0.06, 'triangle', 0.04),
    pick: (a) => { note(a, 520, 0, 0.08, 'triangle', 0.06); note(a, 780, 0.05, 0.1, 'triangle', 0.05); },
    msg: (a) => note(a, 880, 0, 0.07, 'sine', 0.035),
    coin: (a) => { note(a, 988, 0, 0.09, 'square', 0.03); note(a, 1319, 0.07, 0.22, 'square', 0.03); },
    buy: (a) => { note(a, 659, 0, 0.08, 'triangle', 0.06); note(a, 988, 0.06, 0.08, 'triangle', 0.06); note(a, 1319, 0.12, 0.2, 'triangle', 0.05); },
    up: (a) => { note(a, 440, 0, 0.1, 'sine', 0.06); note(a, 660, 0.08, 0.16, 'sine', 0.06); },
    level: (a) => [523, 659, 784, 1047].forEach((f, i) => note(a, f, i * 0.09, 0.28, 'triangle', 0.06)),
    win: (a) => [392, 523, 659, 784].forEach((f, i) => note(a, f, i * 0.1, 0.3, 'triangle', 0.06)),
    lose: (a) => { note(a, 392, 0, 0.22, 'sine', 0.06); note(a, 294, 0.16, 0.36, 'sine', 0.06); },
  };

  MS.sfx = {
    get on() { return on; },
    set(v) { on = Boolean(v); MS.store.set(KEY, on); },
    play(name) {
      if (!on || document.hidden) return;
      const fn = SOUNDS[name];
      const a = fn && ac();
      if (!a) return;
      try { fn(a); } catch { /* ignore */ }
    },
  };
})();
