'use strict';
// Profile banners: small illustrated scenes drawn as SVG (600x200, cropped to fit), one per banner item.
// MS.banners.css(id) -> a CSS background, or '' when the item has no scene. Flat shapes, no glow, no violet.
(() => {
  const MS = window.MS;
  const cache = new Map();

  // deterministic "random" so a banner looks the same every time
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;
  const lin = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  const bg = (id) => `<rect width="600" height="200" fill="url(#${id})"/>`;
  function stars(seed, n, color = '#ffffff', maxY = 200) {
    const r = rng(seed);
    let out = '';
    for (let i = 0; i < n; i += 1) out += `<circle cx="${(r() * 600).toFixed(1)}" cy="${(r() * maxY).toFixed(1)}" r="${(0.6 + r() * 1.4).toFixed(2)}" fill="${color}" opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`;
    return out;
  }
  function vinyl(cx, cy, r, label, grooveColor = '#ffffff') {
    let g = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#0b0d12"/>`;
    for (let k = r * 0.36; k < r - 3; k += 6) g += `<circle cx="${cx}" cy="${cy}" r="${k.toFixed(1)}" fill="none" stroke="${grooveColor}" stroke-opacity="0.07" stroke-width="1.2"/>`;
    g += `<path d="M${cx - r * 0.7} ${cy - r * 0.45} A${r * 0.82} ${r * 0.82} 0 0 1 ${cx + r * 0.1} ${cy - r * 0.8}" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="5" stroke-linecap="round"/>`;
    g += `<circle cx="${cx}" cy="${cy}" r="${r * 0.3}" fill="${label}"/><circle cx="${cx}" cy="${cy}" r="4" fill="#0b0d12"/>`;
    return g;
  }

  // scene builders, each takes a palette so DEV banners can reuse them in green
  const SCENES = {
    skyline(p) {
      const r = rng(7);
      let city = '';
      let x = 0;
      while (x < 600) {
        const w = 26 + r() * 44;
        const h = 40 + r() * 90;
        city += `<rect x="${x.toFixed(1)}" y="${(200 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${p.city}"/>`;
        for (let wy = 200 - h + 10; wy < 190; wy += 14) {
          for (let wx = x + 6; wx < x + w - 8; wx += 11) if (r() > 0.72) city += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="5" height="6" fill="${p.win}" opacity="0.7"/>`;
        }
        x += w + 2;
      }
      return svg(lin('s', p.sky), `${bg('s')}<circle cx="430" cy="150" r="64" fill="${p.sun}"/>${city}`);
    },
    studio(p) {
      return svg(lin('s', p.sky, 1, 1), `${bg('s')}${stars(11, 70, p.star)}${vinyl(500, 100, 150, p.label)}`);
    },
    aurora(p) {
      return svg(lin('s', p.sky) + lin('a', p.band, 1, 0), `${bg('s')}${stars(3, 45, '#ffffff', 120)}
        <path d="M0 95 C120 30 240 140 360 70 S540 30 600 70 L600 120 C470 90 360 170 240 120 S70 130 0 150Z" fill="url(#a)" opacity="0.55"/>
        <path d="M0 60 C140 10 260 100 380 40 S560 20 600 40 L600 70 C470 60 380 120 250 80 S80 90 0 100Z" fill="url(#a)" opacity="0.3"/>
        <path d="M0 170 C100 150 200 165 300 155 S500 150 600 165 L600 200 L0 200Z" fill="${p.ground}"/>`);
    },
    equalizer(p) {
      let bars = '';
      for (let i = 0; i < 40; i += 1) {
        const h = 22 + Math.abs(Math.sin(i * 0.55) * 70 + Math.sin(i * 1.7) * 26);
        bars += `<rect x="${i * 15 + 3}" y="${(196 - h).toFixed(1)}" width="10" height="${h.toFixed(1)}" rx="3" fill="#ffffff" opacity="${(0.12 + (i % 5) * 0.03).toFixed(2)}"/>`;
      }
      return svg(lin('s', p.sky, 1, 0.4), `${bg('s')}${bars}<rect y="196" width="600" height="4" fill="#ffffff" opacity="0.25"/>`);
    },
    ripples(p) {
      let rings = '';
      for (let k = 18, i = 0; k < 520; k += 22, i += 1) rings += `<circle cx="110" cy="100" r="${k}" fill="none" stroke="${p.ring}" stroke-width="2" opacity="${Math.max(0.03, 0.42 - i * 0.017).toFixed(3)}"/>`;
      return svg(lin('s', p.sky, 1, 1), `${bg('s')}${rings}<circle cx="110" cy="100" r="10" fill="${p.ring}"/>`);
    },
    synth(p) {
      let grid = '';
      [146, 152, 160, 172, 188].forEach((y) => { grid += `<line x1="0" y1="${y}" x2="600" y2="${y}" stroke="${p.grid}" stroke-width="1.5" opacity="0.6"/>`; });
      for (let x = -300; x <= 900; x += 70) grid += `<line x1="300" y1="140" x2="${x}" y2="200" stroke="${p.grid}" stroke-width="1.5" opacity="0.6"/>`;
      return svg(lin('s', p.sky) + lin('u', p.sun),
        `${bg('s')}${stars(5, 30, '#ffffff', 110)}<circle cx="300" cy="118" r="72" fill="url(#u)"/>
        <rect x="200" y="122" width="200" height="4" fill="${p.cut}"/><rect x="200" y="132" width="200" height="6" fill="${p.cut}"/>
        <rect y="140" width="600" height="60" fill="${p.ground}"/>${grid}`);
    },
    stage(p) {
      const beam = (x, sx) => `<polygon points="${x - 8},0 ${x + 8},0 ${sx + 90},200 ${sx - 90},200" fill="url(#b)"/>`;
      return svg(lin('s', p.sky) + `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.beam}" stop-opacity="0.55"/><stop offset="1" stop-color="${p.beam}" stop-opacity="0"/></linearGradient>`,
        `${bg('s')}${beam(140, 220)}${beam(300, 300)}${beam(460, 380)}
        <rect y="168" width="600" height="32" fill="${p.floor}"/><rect y="166" width="600" height="3" fill="${p.beam}" opacity="0.6"/>
        <path d="M0 0 H60 C50 60 70 120 40 200 H0Z" fill="${p.curtain}"/><path d="M600 0 H540 C550 60 530 120 560 200 H600Z" fill="${p.curtain}"/>`);
    },
    holo(p) {
      const spark = (x, y, s) => `<path d="M${x} ${y - s} L${x + s * 0.25} ${y - s * 0.25} L${x + s} ${y} L${x + s * 0.25} ${y + s * 0.25} L${x} ${y + s} L${x - s * 0.25} ${y + s * 0.25} L${x - s} ${y} L${x - s * 0.25} ${y - s * 0.25}Z" fill="#ffffff" opacity="0.85"/>`;
      let bands = '';
      for (let i = -4; i < 12; i += 1) bands += `<rect x="${i * 70}" y="-100" width="26" height="420" fill="#ffffff" opacity="0.13" transform="rotate(28 300 100)"/>`;
      return svg(lin('s', p.sky, 1, 0.3), `${bg('s')}${bands}${spark(90, 60, 14)}${spark(470, 52, 10)}${spark(380, 140, 16)}${spark(200, 150, 8)}${spark(540, 120, 7)}`);
    },
    cassette(p) {
      const reel = (cx) => `<circle cx="${cx}" cy="100" r="20" fill="${p.reel}"/><circle cx="${cx}" cy="100" r="7" fill="${p.body}"/>${[0, 60, 120].map((a) => `<rect x="${cx - 2}" y="83" width="4" height="10" fill="${p.body}" transform="rotate(${a} ${cx} 100)"/>`).join('')}`;
      return svg(lin('s', p.sky, 1, 1), `${bg('s')}${stars(9, 0)}
        <rect x="320" y="34" width="240" height="140" rx="12" fill="${p.body}"/>
        <rect x="338" y="48" width="204" height="40" rx="4" fill="${p.label}"/>
        <rect x="352" y="60" width="120" height="4" rx="2" fill="${p.body}" opacity="0.35"/><rect x="352" y="70" width="80" height="4" rx="2" fill="${p.body}" opacity="0.25"/>
        <rect x="370" y="80" width="140" height="42" rx="21" fill="${p.window}"/>${reel(400)}${reel(480)}
        <path d="M360 174 L380 146 H500 L520 174Z" fill="${p.reel}" opacity="0.5"/>
        <circle cx="70" cy="150" r="90" fill="#ffffff" opacity="0.12"/><circle cx="170" cy="40" r="50" fill="#ffffff" opacity="0.1"/>`);
    },
    waves(p) {
      let w = '';
      for (let i = 0; i < 7; i += 1) {
        const y = 40 + i * 22;
        const a = 10 + i * 4;
        let d = `M0 ${y}`;
        for (let x = 0; x <= 600; x += 20) d += ` L${x} ${(y + Math.sin((x / 600) * Math.PI * (3 + i * 0.4) + i) * a).toFixed(1)}`;
        w += `<path d="${d}" fill="none" stroke="${p.line}" stroke-width="${2 + (i % 3)}" opacity="${(0.2 + i * 0.09).toFixed(2)}" stroke-linecap="round"/>`;
      }
      return svg(lin('s', p.sky), `${bg('s')}${w}`);
    },
    topo(p) {
      let lines = '';
      [[150, 120, 0], [470, 70, 25]].forEach(([cx, cy, rot]) => {
        for (let k = 1; k < 16; k += 1) lines += `<ellipse cx="${cx + k * 2}" cy="${cy - k}" rx="${k * 20}" ry="${(k * 20 * 0.58).toFixed(1)}" fill="none" stroke="${p.line}" stroke-width="1.4" opacity="0.28" transform="rotate(${rot + k * 2} ${cx} ${cy})"/>`;
      });
      return svg(lin('s', p.sky, 1, 1), `${bg('s')}${lines}<circle cx="150" cy="120" r="5" fill="${p.line}"/><circle cx="470" cy="70" r="5" fill="${p.line}"/>`);
    },
    solar(p) {
      let rays = '';
      for (let i = 0; i < 24; i += 1) rays += `<polygon points="420,100 ${420 + Math.cos(i * 0.2618) * 700},${100 + Math.sin(i * 0.2618) * 700} ${420 + Math.cos(i * 0.2618 + 0.1) * 700},${100 + Math.sin(i * 0.2618 + 0.1) * 700}" fill="${p.ray}" opacity="0.1"/>`;
      return svg(lin('s', p.sky, 1, 1) + lin('l', p.label, 1, 1), `${bg('s')}${rays}${vinyl(420, 100, 112, 'url(#l)')}`);
    },
  };

  // two scenes for the DEV collection: code rain and a circuit board
  SCENES.matrix = (p) => {
    const r = rng(21);
    let g = '';
    for (let x = 6; x < 600; x += 18) {
      let y = -r() * 120;
      while (y < 200) {
        const len = 3 + Math.floor(r() * 9);
        for (let k = 0; k < len; k += 1) {
          const yy = y + k * 12;
          const head = k === len - 1;
          g += `<rect x="${x}" y="${yy.toFixed(1)}" width="7" height="8" rx="1.5" fill="${head ? p.head : p.glyph}" opacity="${head ? 0.9 : (0.12 + (k / len) * 0.55).toFixed(2)}"/>`;
        }
        y += len * 12 + 20 + r() * 60;
      }
    }
    return svg(lin('s', p.sky), `${bg('s')}${g}`);
  };
  SCENES.circuit = (p) => {
    const r = rng(33);
    let g = '';
    for (let i = 0; i < 14; i += 1) {
      const y = 16 + i * 13;
      const fromLeft = i % 2 === 0;
      const a = 60 + r() * 140;
      const dy = (r() > 0.5 ? 1 : -1) * 13;
      const b = a + 40 + r() * 120;
      const pts = fromLeft ? `0,${y} ${a},${y} ${a + 13},${y + dy} ${b},${y + dy}` : `600,${y} ${600 - a},${y} ${587 - a},${y + dy} ${600 - b},${y + dy}`;
      const end = fromLeft ? b : 600 - b;
      g += `<polyline points="${pts}" fill="none" stroke="${p.line}" stroke-width="2" opacity="0.45"/><circle cx="${end.toFixed(1)}" cy="${y + dy}" r="4" fill="none" stroke="${p.line}" stroke-width="2" opacity="0.8"/>`;
    }
    let pins = '';
    for (let k = 0; k < 6; k += 1) pins += `<rect x="${262 + k * 13}" y="52" width="5" height="10" fill="${p.line}" opacity="0.7"/><rect x="${262 + k * 13}" y="138" width="5" height="10" fill="${p.line}" opacity="0.7"/>`;
    return svg(lin('s', p.sky, 1, 1), `${bg('s')}${g}${pins}<rect x="255" y="60" width="90" height="80" rx="8" fill="${p.chip}" stroke="${p.line}" stroke-width="2"/><circle cx="270" cy="75" r="4" fill="${p.line}"/>`);
  };

  const BANNERS = {
    banner_city_afterglow: ['skyline', { sky: ['#1b2338', '#5a3550', '#ff8a3d'], sun: '#ffb35c', city: '#121722', win: '#ffcf8a' }],
    banner_cosmic_studio: ['studio', { sky: ['#060b18', '#123a7a'], star: '#cfe8ff', label: '#41d6e6' }],
    banner_aurora_drift: ['aurora', { sky: ['#041615', '#0d3b3a'], band: ['#2bbf9b', '#9be8ff', '#7ef0b8'], ground: '#03100f' }],
    banner_luxe_signal: ['equalizer', { sky: ['#ffb13b', '#ff5e7e', '#7a2441'] }],
    banner_quantum_lounge: ['ripples', { sky: ['#081330', '#1d4ed8'], ring: '#67e8f9' }],
    banner_ultraviolet_core: ['synth', { sky: ['#080b18', '#3a0d24'], sun: ['#ffd36b', '#f43f5e'], cut: '#2a0c1f', ground: '#12060f', grid: '#f43f5e' }],
    banner_golden_stage: ['stage', { sky: ['#0e0904', '#2a1a08'], beam: '#ffe9a6', floor: '#3a240b', curtain: '#5a1414' }],
    banner_hologram_royale: ['holo', { sky: ['#5ce1e6', '#7fb2ff', '#ff9ccc', '#ffe39a'] }],
    banner_mint_tape: ['cassette', { sky: ['#c9f7e4', '#5fd3a8'], body: '#1f2a2a', label: '#f4efe4', window: '#3c4a4a', reel: '#e9fff5' }],
    banner_soundwave_sea: ['waves', { sky: ['#06182c', '#0f4c8a'], line: '#7fd8ff' }],
    banner_topo_pulse: ['topo', { sky: ['#08201c', '#155e4f'], line: '#c9f7e4' }],
    banner_solar_vinyl: ['solar', { sky: ['#1a0f0c', '#4a1f10'], ray: '#ffb13b', label: ['#ffe066', '#e0413a'] }],
    dev_banner_emerald_throne: ['synth', { sky: ['#020c06', '#063d22'], sun: ['#d9f99d', '#10b981'], cut: '#04261a', ground: '#020c06', grid: '#34d399' }],
    dev_banner_jade_nebula: ['studio', { sky: ['#03140a', '#14532d'], star: '#bbf7d0', label: '#22c55e' }],
    dev_banner_mint_core: ['ripples', { sky: ['#022c22', '#065f46'], ring: '#99f6e4' }],
    dev_banner_viridian_infinite: ['waves', { sky: ['#03140a', '#15803d'], line: '#d9f99d' }],
    dev_banner_obsidian_gold: ['stage', { sky: ['#050403', '#1a1205'], beam: '#ffe9a6', floor: '#2a1a08', curtain: '#0b0806' }],
    dev_banner_ghost_chrome: ['ripples', { sky: ['#0b1220', '#475569'], ring: '#e2e8f0' }],
    dev_banner_matrix_rain: ['matrix', { sky: ['#010a05', '#032412'], glyph: '#22c55e', head: '#d9ffe9' }],
    dev_banner_solar_core: ['solar', { sky: ['#1a0603', '#4a120a'], ray: '#ffb13b', label: ['#fff7cc', '#ff4d4d'] }],
    dev_banner_ice_circuit: ['circuit', { sky: ['#03131f', '#0c4a6e'], line: '#67e8f9', chip: '#0a2a3d' }],
  };

  MS.banners = {
    has: (id) => Boolean(BANNERS[id]),
    css(id) {
      if (cache.has(id)) return cache.get(id);
      const def = BANNERS[id];
      if (!def) return '';
      const art = SCENES[def[0]](def[1]);
      const fallback = (def[1].sky || ['#222'])[0];
      // single quotes around the URL: these strings go into style="..." attributes
      const css = `url('data:image/svg+xml,${encodeURIComponent(art)}') center / cover no-repeat, ${fallback}`;
      cache.set(id, css);
      return css;
    },
  };
})();
