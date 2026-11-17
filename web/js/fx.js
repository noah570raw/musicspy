'use strict';
// Live backdrop: a slowly shifting gradient built from the cover art colours (WebGL, no libraries).
// window.MSFX.setCover(url) takes the palette from a cover; setCover('') returns to the theme palette.
// window.MSFX.setTheme('home' | 'spy' | 'k5') picks the palette used when there is no cover;
// the Spy theme also turns on a slow searchlight.
// window.MSFX.cut() (Spy home): the next surveillance-camera palette; colours ease over like the K5 covers do
// and the searchlight glides to a new spot. Any setCover/setTheme call ends the cuts.
// Without WebGL the blurred cover is shown as an image. Ported from Keep 5 Delete 5.
(() => {
  const root = document.getElementById('backdrop');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NEUTRAL = [[0.11, 0.1, 0.1], [0.17, 0.14, 0.19], [0.21, 0.15, 0.15], [0.14, 0.18, 0.19]];
  const NEUTRAL_HI = [244, 241, 236];
  // Theme palettes (dark, no violet). Spy: ink-teal night with a dim amber lamp. K5D5: warm record-shop tones.
  const THEMES = {
    home: { bg: NEUTRAL, hi: NEUTRAL_HI, spot: 0 },
    spy: { bg: [[0.035, 0.06, 0.07], [0.05, 0.1, 0.11], [0.2, 0.13, 0.05], [0.04, 0.08, 0.1]], hi: [240, 186, 96], spot: 1 },
    k5: { bg: [[0.12, 0.08, 0.07], [0.22, 0.12, 0.09], [0.1, 0.16, 0.14], [0.2, 0.17, 0.09]], hi: [244, 241, 236], spot: 0 },
  };
  let theme = 'home';
  // Spy home cycles through these (all dark): night teal, sodium street lamp, alarm red, night vision, cold steel.
  const SPY_CUTS = [
    THEMES.spy.bg,
    [[0.08, 0.05, 0.02], [0.17, 0.09, 0.03], [0.04, 0.05, 0.05], [0.24, 0.14, 0.04]],
    [[0.07, 0.022, 0.022], [0.17, 0.04, 0.035], [0.035, 0.045, 0.055], [0.21, 0.08, 0.035]],
    [[0.02, 0.06, 0.035], [0.04, 0.14, 0.075], [0.025, 0.045, 0.045], [0.11, 0.17, 0.06]],
    [[0.03, 0.045, 0.08], [0.05, 0.085, 0.16], [0.03, 0.04, 0.05], [0.13, 0.1, 0.06]],
  ];
  let cutIndex = 0;
  let cutting = false;

  // ---------- colour ----------
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
  }

  function hslToRgb(h, s, l) {
    if (!s) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }

  // The cover's four main colours, dimmed to a dark ground, plus a light accent.
  function paletteFrom(data) {
    const bins = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const key = s < 0.14 || l < 0.06 || l > 0.95 ? `g${Math.floor(l * 3)}` : `${Math.floor(h * 10)}:${Math.floor(l * 2)}`;
      const w = 1 + s * 5;
      const b = bins.get(key) || { r: 0, g: 0, b: 0, w: 0, s: 0 };
      b.r += data[i] * w; b.g += data[i + 1] * w; b.b += data[i + 2] * w; b.w += w; b.s += s * w;
      bins.set(key, b);
    }
    const top = [...bins.values()].sort((a, b) => b.w - a.w).slice(0, 4).map((b) => rgbToHsl(b.r / b.w, b.g / b.w, b.b / b.w));
    // Few colours (say, a white cover with black text): fill in with shades of the main colour.
    const main = top[0] || [0, 0, 0.3];
    while (top.length < 4) top.push([main[0], main[1], main[2] * (top.length % 2 ? 0.85 : 1)]);
    const bg = top
      .map(([h, s, l]) => [h, s < 0.15 ? 0 : Math.min(0.8, s * 1.15), Math.min(s < 0.15 ? 0.52 : 0.46, Math.max(0.12, 0.12 + l * 0.42))])
      .sort((a, b) => a[2] - b[2])
      .map(([h, s, l]) => hslToRgb(h, s, l));
    const vivid = [...top].sort((a, b) => b[1] - a[1])[0];
    const hi = vivid[1] < 0.12 ? NEUTRAL_HI : hslToRgb(vivid[0], Math.min(0.9, vivid[1] * 1.1 + 0.15), 0.74).map((v) => Math.round(v * 255));
    return { bg, hi };
  }

  function applyHi(hi) {
    document.documentElement.style.setProperty('--tint-hi', hi.join(','));
  }

  // ---------- WebGL ----------
  function makeGL() {
    const canvas = document.createElement('canvas');
    canvas.className = 'fx';
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return null;
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs = `
      precision mediump float;
      uniform vec2 r; uniform float t; uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform float spot; uniform float seed;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 1.9; a *= 0.5; } return v; }
      void main(){
        vec2 uv = gl_FragCoord.xy / r;
        vec2 p = uv * vec2(r.x / r.y, 1.0) * 1.4;
        float s = t * 0.035;
        vec2 q = vec2(fbm(p + vec2(0.0, s)), fbm(p + vec2(5.2, 1.3) - s));
        vec2 w = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + s * 1.4), fbm(p + 3.0 * q + vec2(8.3, 2.8) - s));
        float n = fbm(p + 2.4 * w);
        vec3 col = mix(c0, c1, smoothstep(0.25, 0.75, n));
        col = mix(col, c2, smoothstep(0.4, 0.9, w.x));
        col = mix(col, c3, smoothstep(0.45, 0.95, q.y) * 0.7);
        col *= 0.86 + 0.22 * uv.y;
        // searchlight (Spy theme): a soft warm pool drifting across the screen
        vec2 aspect = vec2(r.x / r.y, 1.0);
        vec2 sp = vec2(0.5 + 0.38 * sin(t * 0.11 + seed * 2.3), 0.58 + 0.18 * cos(t * 0.083 + seed * 1.9));
        float d = distance(uv * aspect, sp * aspect);
        col += spot * vec3(0.16, 0.12, 0.06) * smoothstep(0.62, 0.0, d);
        col *= 1.0 - spot * 0.18 * smoothstep(0.3, 1.1, d);
        gl_FragColor = vec4(col, 1.0);
      }`;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const v = sh(gl.VERTEX_SHADER, vs);
    const f = sh(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = Object.fromEntries(['r', 't', 'c0', 'c1', 'c2', 'c3', 'spot', 'seed'].map((k) => [k, gl.getUniformLocation(prog, k)]));

    const cur = NEUTRAL.map((c) => c.slice());
    let target = NEUTRAL.map((c) => c.slice());
    let spotCur = 0;
    let spotTarget = 0;
    let seed = 0;
    let seedTarget = 0;
    const t0 = performance.now();
    let last = 0;
    let raf = 0;

    function resize() {
      const scale = 0.3;
      canvas.width = Math.max(64, Math.round(innerWidth * scale));
      canvas.height = Math.max(64, Math.round(innerHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    function draw(now, k) {
      for (let i = 0; i < 4; i += 1) for (let j = 0; j < 3; j += 1) cur[i][j] += (target[i][j] - cur[i][j]) * k;
      spotCur += (spotTarget - spotCur) * k;
      seed += (seedTarget - seed) * k;
      gl.uniform1f(u.spot, spotCur);
      gl.uniform1f(u.seed, seed);
      gl.uniform2f(u.r, canvas.width, canvas.height);
      gl.uniform1f(u.t, reduceMotion ? 20 : (now - t0) / 1000);
      ['c0', 'c1', 'c2', 'c3'].forEach((name, i) => gl.uniform3fv(u[name], cur[i]));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      draw(now, 0.05);
    }
    resize();
    addEventListener('resize', () => { resize(); if (reduceMotion) draw(performance.now(), 1); });
    if (reduceMotion) draw(performance.now(), 1);
    else raf = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', () => {
      if (reduceMotion) return;
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(loop);
    });
    root.appendChild(canvas);
    return {
      setColors(bg) {
        target = bg.map((c) => c.slice());
        if (reduceMotion) draw(performance.now(), 1);
      },
      cut(bg) {
        target = bg.map((c) => c.slice());
        seedTarget += 1;
        if (reduceMotion) draw(performance.now(), 1);
      },
      setSpot(v) {
        spotTarget = v;
        if (reduceMotion) draw(performance.now(), 1);
      },
    };
  }

  const gl = makeGL();
  if (gl) root.classList.add('has-fx');

  // ---------- fallback: blurred cover ----------
  function setImage(url) {
    root.querySelectorAll('img').forEach((el) => {
      el.classList.remove('on');
      setTimeout(() => el.remove(), 1000);
    });
    if (!url) return;
    const img = new Image();
    img.alt = '';
    img.onload = () => {
      if (current !== url) return;
      root.appendChild(img);
      requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('on')));
    };
    img.src = url;
  }

  const cache = new Map();
  let current = null;

  function setCover(url) {
    url = url || '';
    if (url === current && !cutting) return;
    cutting = false;
    current = url;
    if (!gl) setImage(url);
    if (!url) {
      if (gl) gl.setColors(THEMES[theme].bg);
      applyHi(THEMES[theme].hi);
      return;
    }
    if (cache.has(url)) {
      const pal = cache.get(url);
      if (gl) gl.setColors(pal.bg);
      applyHi(pal.hi);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 32;
        c.height = 32;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 32, 32);
        const pal = paletteFrom(ctx.getImageData(0, 0, 32, 32).data);
        cache.set(url, pal);
        if (current !== url) return;
        if (gl) gl.setColors(pal.bg);
        applyHi(pal.hi);
      } catch { /* the cover cannot be read: keep the previous colours */ }
    };
    img.src = /^https?:/.test(url) ? `/api/img?u=${encodeURIComponent(url)}` : url;
  }

  function setTheme(name) {
    theme = THEMES[name] ? name : 'home';
    if (cutting) { cutting = false; current = null; }
    if (gl) gl.setSpot(THEMES[theme].spot);
    if (!current) {
      current = null;
      setCover('');
    }
  }

  function cut() {
    if (!gl || reduceMotion || theme !== 'spy') return;
    cutting = true;
    cutIndex = (cutIndex + 1) % SPY_CUTS.length;
    gl.cut(SPY_CUTS[cutIndex]);
  }

  window.MSFX = { setCover, setTheme, cut };
  setCover('');
})();
