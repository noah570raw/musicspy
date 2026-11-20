'use strict';
// Cosmetics: how the 61 shop items look in the new interface and where they show up.
//   nicknameColor  gradient on the player's name (lobbies, chat, profile, leaderboard)
//   avatarFrame    ring around the avatar (MS.avatar reads it, core.js)
//   profileBanner  the banner of the profile and the home player card
//   chatEffect     style of the player's messages in room and global chat
//   lobbyEffect    the player's card in lobby player lists and on the profile
//   playerTitle    a line under the name on the profile
// Item IDs and names come from the server catalog (/api/shop/catalog); the looks are redrawn here:
// flat gradients and patterns, no glow, no violet (DESIGN.md, section 18).
(() => {
  const MS = window.MS;
  const { esc } = MS;

  // c: colour stops; p: pattern (linear | conic | stripe | dots | grid | radial)
  const VIS = {
    nick_solar_flare: { c: ['#ffd36b', '#ff9a5c', '#ff6b6b'] },
    nick_glacier_hype: { c: ['#c8f4ff', '#6cc6ff', '#3d8bff'] },
    nick_synthwave_blaze: { c: ['#ff7aa2', '#ffa36b', '#5ce1e6'] },
    nick_blacklight_pulse: { c: ['#5ce1e6', '#3b82f6', '#ff5fa2'] },
    nick_vinyl_prism: { c: ['#ffb84d', '#ff5e7e', '#3ec9ff', '#7ef0b8'] },
    nick_chrome_wave: { c: ['#ffffff', '#a9b4c2', '#eef2f6', '#8794a6'] },
    nick_quantum_pop: { c: ['#4fe3ff', '#ff5fa2', '#ffe066'] },
    nick_hyperion_aura: { c: ['#7cf5ff', '#59a8ff', '#ff8fc7', '#ffe39a'] },
    nick_mint_cassette: { c: ['#c8f7e0', '#5fd3a8', '#2fb08a'] },
    nick_ember_tape: { c: ['#ffd59a', '#ff7a45', '#e0413a'] },
    nick_ocean_static: { c: ['#a8f4ff', '#2bb4e8', '#1d6fd8', '#a8f4ff'] },
    nick_aurora_crown: { c: ['#a7ffcf', '#4fe3ff', '#ffd36b', '#ff8fb1'] },

    frame_neon_hex: { c: ['#5ce1e6', '#16323a'], p: 'stripe' },
    frame_crystal_ring: { c: ['#e9fdff', '#8ee8f5', '#3a7f90', '#e9fdff'], p: 'conic' },
    frame_orbit_shards: { c: ['#5cc8ff', '#ff7aa2', '#ffd36b', '#5cc8ff'], p: 'conic' },
    frame_reactor_core: { c: ['#ffe066', '#ff8f3d', '#b4441c', '#ffe066'], p: 'conic' },
    frame_aurora_circuit: { c: ['#3ee0b5', '#3cc3ff', '#2f6bff', '#3ee0b5'], p: 'conic' },
    frame_velvet_void: { c: ['#2a3c66', '#8aa0cc', '#2a3c66', '#5b6f9c'], p: 'conic' },
    frame_solaris_crown: { c: ['#ffe9a6', '#ffb13b', '#ff7a7a', '#ffe9a6'], p: 'conic' },
    frame_infinity_halo: { c: ['#5ce1e6', '#4f8bff', '#ff6fae', '#ffd36b', '#5ce1e6'], p: 'conic' },
    frame_vinyl_groove: { c: ['#202020', '#5a5a5a'], p: 'rconic' },
    frame_ticket_stub: { c: ['#ffd36b', '#ff7a45'], p: 'stripe' },
    frame_sunset_bezel: { c: ['#ffb13b', '#ff5e7e', '#3b82f6', '#ffb13b'], p: 'conic' },
    frame_prism_eclipse: { c: ['#0b0f19', '#4fe3ff', '#ffe066', '#ff5fa2', '#0b0f19'], p: 'conic' },

    banner_city_afterglow: { c: ['#141a24', '#3a4658', '#ff8a3d'] },
    banner_cosmic_studio: { c: ['#0c1424', '#1f4fa8', '#41d6e6'], p: 'dots' },
    banner_aurora_drift: { c: ['#0f3d3a', '#2bbf9b', '#9be8ff'] },
    banner_luxe_signal: { c: ['#ffb13b', '#ff5e7e', '#7a2441'] },
    banner_quantum_lounge: { c: ['#101827', '#1d4ed8', '#67e8f9'], p: 'radial' },
    banner_ultraviolet_core: { c: ['#0a0f1c', '#1e3a8a', '#f43f5e'], p: 'grid' },
    banner_golden_stage: { c: ['#fff1c7', '#f5a524', '#9a4b0b'] },
    banner_hologram_royale: { c: ['#5ce1e6', '#7fb2ff', '#ff9ccc', '#ffe39a'], p: 'stripe' },
    banner_mint_tape: { c: ['#c9f7e4', '#5fd3a8'] },
    banner_soundwave_sea: { c: ['#06182c', '#0f4c8a', '#7fd8ff'] },
    banner_topo_pulse: { c: ['#08201c', '#155e4f', '#c9f7e4'] },
    banner_solar_vinyl: { c: ['#1a0f0c', '#e0413a', '#ffe066'] },

    chat_neon_mist: { c: ['#5ce1e6', '#3b82f6'] },
    chat_emoji_rain: { c: ['#ffb13b', '#ff5e7e'] },
    chat_pixel_pop: { c: ['#5ce1e6', '#38bdf8', '#ff7aa2'], p: 'stripe' },
    chat_waveform_glow: { c: ['#34d399', '#22b8e6'] },
    chat_starlight_box: { c: ['#f8fafc', '#6f9bff'], p: 'dots' },
    chat_laser_tape: { c: ['#ff4d6d', '#4fe3ff', '#ff4d6d'] },
    chat_midnight_frost: { c: ['#2b4161', '#2ba6e6', '#e2e8f0'] },
    chat_hypernova: { c: ['#4fe3ff', '#ff5fa2', '#ffe066', '#4fe3ff'], p: 'conic' },
    chat_paper_note: { c: ['#f4efe4', '#d9cdb4'] },
    chat_bass_drop: { c: ['#3b82f6', '#22d3ee'], p: 'stripe' },
    chat_sunburst: { c: ['#ffe066', '#ff9a3d', '#ff5e7e'] },
    chat_aurora_ink: { c: ['#a7ffcf', '#4fe3ff', '#ff8fb1', '#ffe066', '#a7ffcf'], p: 'conic' },

    lobby_glass_flux: { c: ['#38bdf8', '#0f2133'] },
    lobby_plasma_mesh: { c: ['#06b6d4', '#1e40af', '#111827'], p: 'grid' },
    lobby_night_radar: { c: ['#0a1a1f', '#22d3ee'], p: 'radial' },
    lobby_firefly_lane: { c: ['#ffb13b', '#ff5e7e', '#1d4ed8'], p: 'dots' },
    lobby_quantum_glow: { c: ['#22d3ee', '#2563eb', '#0f172a', '#22d3ee'], p: 'conic' },
    lobby_royal_chamber: { c: ['#9f1239', '#111827', '#f472b6'] },
    lobby_sunrise_core: { c: ['#fde68a', '#fb7185', '#be123c'] },
    lobby_horizon_mirage: { c: ['#22d3ee', '#60a5fa', '#f9a8d4', '#fde68a'], p: 'stripe' },
    lobby_tape_deck: { c: ['#4a505a', '#1c1f24'], p: 'grid' },
    lobby_neon_alley: { c: ['#0f172a', '#ff4d6d', '#22d3ee'] },
    lobby_ocean_floor: { c: ['#032c3a', '#0e7490', '#67e8f9'], p: 'radial' },
    lobby_crown_hall: { c: ['#1a1205', '#f5a524', '#fff1c7'], p: 'dots' },

    dev_nick_emerald_sovereign: { c: ['#6ee7b7', '#10b981', '#a7f3d0'] },
    dev_nick_jade_flux: { c: ['#86efac', '#22c55e', '#bbf7d0'] },
    dev_nick_mint_quantum: { c: ['#ccfbf1', '#2dd4bf', '#6ee7b7'] },
    dev_nick_viridian_crown: { c: ['#4ade80', '#16a34a', '#bef264'] },
    dev_frame_emerald_matrix: { c: ['#34d399', '#065f46', '#6ee7b7', '#34d399'], p: 'conic' },
    dev_frame_jade_reactor: { c: ['#bbf7d0', '#22c55e', '#14532d', '#bbf7d0'], p: 'conic' },
    dev_frame_mint_halo: { c: ['#99f6e4', '#34d399', '#065f46', '#99f6e4'], p: 'conic' },
    dev_frame_viridian_pulse: { c: ['#4ade80', '#12331f'], p: 'stripe' },
    dev_banner_emerald_throne: { c: ['#052e16', '#10b981', '#6ee7b7'], p: 'grid' },
    dev_banner_jade_nebula: { c: ['#14532d', '#22c55e', '#bbf7d0'], p: 'dots' },
    dev_banner_mint_core: { c: ['#064e3b', '#34d399', '#99f6e4'], p: 'radial' },
    dev_banner_viridian_infinite: { c: ['#15803d', '#34d399', '#d9f99d'], p: 'stripe' },
    dev_chat_emerald_mist: { c: ['#34d399', '#065f46'] },
    dev_chat_jade_symbols: { c: ['#22c55e', '#86efac', '#15803d'], p: 'stripe' },
    dev_chat_mint_echo: { c: ['#bbf7d0', '#2dd4bf'] },
    dev_chat_viridian_lux: { c: ['#4ade80', '#bef264', '#10b981', '#4ade80'], p: 'conic' },
    dev_lobby_emerald_grid: { c: ['#02150a', '#047857'], p: 'grid' },
    dev_lobby_jade_hall: { c: ['#052e16', '#166534', '#65a30d'] },
    dev_lobby_mint_realm: { c: ['#022c22', '#0f766e', '#5eead4'], p: 'radial' },
    dev_lobby_viridian_prestige: { c: ['#052e16', '#15803d', '#4d7c0f', '#052e16'], p: 'conic' },

    title_perfect_manipulator: { c: ['#facc15', '#ef4444'] },
  };

  const RARITY = {
    common: { label: 'Common', color: '#b9b3aa' },
    rare: { label: 'Rare', color: '#6cc6ff' },
    epic: { label: 'Epic', color: '#ff7aa2' },
    legendary: { label: 'Legendary', color: '#ffb13b' },
    mythic: { label: 'Mythic', color: '#7ef0b8' },
    developer: { label: 'Developer', color: '#34d399' },
  };
  const SLOTS = ['nicknameColor', 'avatarFrame', 'profileBanner', 'chatEffect', 'lobbyEffect', 'playerTitle'];

  function stops(c) {
    return c.join(', ');
  }

  // A CSS background for an item. angle applies to linear looks.
  function grad(id, angle = 90) {
    const v = VIS[id];
    if (!v) return '';
    const c = v.c;
    if (v.p === 'conic') return `conic-gradient(from 210deg, ${stops(c)})`;
    if (v.p === 'rconic') return `repeating-conic-gradient(${c[0]} 0 10deg, ${c[1]} 10deg 20deg)`;
    if (v.p === 'stripe') {
      const step = 9;
      return `repeating-linear-gradient(${angle + 45}deg, ${c.map((col, i) => `${col} ${i * step}px ${(i + 1) * step}px`).join(', ')})`;
    }
    return `linear-gradient(${angle}deg, ${stops(c)})`;
  }

  // Wide surfaces (banners, lobby cards) also get the pattern on top of the gradient.
  function surface(id) {
    if (MS.banners && MS.banners.has(id)) return MS.banners.css(id);
    const v = VIS[id];
    if (!v) return '';
    const base = v.p === 'conic' || v.p === 'stripe' ? grad(id, 135) : `linear-gradient(135deg, ${stops(v.c)})`;
    const hi = v.c[v.c.length - 1];
    if (v.p === 'dots') return `radial-gradient(circle, rgba(255,255,255,0.22) 1.2px, transparent 1.6px) 0 0 / 14px 14px, ${base}`;
    if (v.p === 'grid') return `linear-gradient(rgba(255,255,255,0.09) 1px, transparent 1px) 0 0 / 18px 18px, linear-gradient(90deg, rgba(255,255,255,0.09) 1px, transparent 1px) 0 0 / 18px 18px, ${base}`;
    if (v.p === 'radial') return `radial-gradient(circle at 18% 30%, ${hi} 0, transparent 46%), linear-gradient(135deg, ${stops(v.c.slice(0, -1).length ? v.c.slice(0, -1) : v.c)})`;
    return base;
  }

  // Equipped items of anything that carries them: a room player, a chat message, a user, a leaderboard row.
  function equippedOf(p) {
    if (!p) return {};
    return p.cosmetics || p.equippedCosmetics || p.equipped || (p.economy && p.economy.equipped) || {};
  }

  const C = (MS.cos = {
    items: new Map(),
    categories: [],
    achievements: [],
    meta: {},
    loaded: false,
    VIS,
    RARITY,
    SLOTS,
    grad,
    surface,
    equippedOf,
    item: (id) => C.items.get(id) || null,
    rarity: (r) => RARITY[r] || RARITY.common,
    // the player's name, painted with their nickname colour
    isDev(p) {
      return Boolean(p && (p.dev || (p.permissions && p.permissions.dev) || (Array.isArray(p.roles) && p.roles.includes('dev'))));
    },
    nick(name, p) {
      const id = equippedOf(p).nicknameColor;
      const g = id && grad(id);
      const tag = C.isDev(p) ? '<span class="dev-tag" title="MusicSpy developer">DEV</span>' : '';
      return `${tag}${g ? `<span class="nick" style="--nick:${g}">${esc(name)}</span>` : esc(name)}`;
    },
    frame(p) {
      const id = equippedOf(p).avatarFrame;
      return id ? grad(id) : '';
    },
    banner(p) {
      const id = equippedOf(p).profileBanner;
      return id ? surface(id) : '';
    },
    // attribute string for a chat message: class + style
    chatAttrs(p) {
      const id = equippedOf(p).chatEffect;
      return id && VIS[id] ? { cls: 'fx', style: `--fx:${grad(id)}` } : { cls: '', style: '' };
    },
    lobbyAttrs(p) {
      const id = equippedOf(p).lobbyEffect;
      return id && VIS[id] ? { cls: 'lfx', style: `--lfx:${surface(id)}` } : { cls: '', style: '' };
    },
    // avatar + painted name + level, linking to the profile for signed-in players (lobby lists, faces)
    who(p, extra = '', size = 'sm') {
      const name = `${C.nick(p.name, p)}${p.level ? `<small class="lvl" title="Level ${p.level}">${p.level}</small>` : ''}${extra}`;
      return p.accountId
        ? `<button class="who" data-act="viewProfile" data-id="${esc(p.accountId)}" title="${esc(p.name)}'s profile">${MS.avatar(p, size)}<span>${name}</span></button>`
        : `${MS.avatar(p, size)}<span>${name}</span>`;
    },
    title(p) {
      const id = equippedOf(p).playerTitle;
      const it = id && C.item(id);
      if (!id) return '';
      return `<span class="p-title" style="--nick:${grad(id)}">${esc(it ? it.name : id.replace(/^title_/, '').replace(/_/g, ' '))}</span>`;
    },
    // a small preview tile for the shop and the collection
    preview(id, category) {
      const it = C.item(id);
      const cat = category || (it && it.category);
      const g = grad(id);
      if (cat === 'nicknameColor' || cat === 'playerTitle') return `<span class="pv pv-nick"><b style="--nick:${g}" class="nick">${esc(it ? it.name.replace(/^DEV /, '') : 'Name')}</b></span>`;
      if (cat === 'avatarFrame') return `<span class="pv pv-frame"><span class="avatar-frame lg" style="--frame:${g}"><span class="avatar lg" style="--c:#4a4f57">A</span></span></span>`;
      if (cat === 'profileBanner') return `<span class="pv pv-banner" style="background:${surface(id)}"></span>`;
      if (cat === 'chatEffect') return `<span class="pv pv-chat"><span class="msg fx" style="--fx:${g}"><p><b>You</b>gg, that was the spy</p></span></span>`;
      if (cat === 'lobbyEffect') return `<span class="pv pv-lobby"><span class="lfx-card" style="--lfx:${surface(id)}"><span class="avatar sm" style="--c:#4a4f57">A</span><b>Player</b></span></span>`;
      return `<span class="pv" style="background:${surface(id)}"></span>`;
    },
    async load() {
      try {
        const r = await (await fetch('/api/shop/catalog', { cache: 'no-cache' })).json();
        if (!r || !r.ok) return;
        C.items = new Map(r.items.map((it) => [it.id, it]));
        C.categories = r.categories || [];
        C.achievements = r.achievements || [];
        C.meta = { daily: r.daily || [], booster: r.booster || {}, levels: r.levels || {} };
        C.loaded = true;
        listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
      } catch { /* the shop shows an error state */ }
    },
    onLoad(fn) { listeners.add(fn); if (C.loaded) fn(); },
  });
  const listeners = new Set();
  C.load();
})();
