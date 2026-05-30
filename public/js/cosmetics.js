/**
 * cosmetics.js — Music Spy Cosmetics Renderer
 * Все ID берутся прямо из каталога server.js и нормализуются автоматически.
 */

// ─── НОРМАЛИЗАЦИЯ ID ───────────────────────────────────────────────────────
// nick_solar_flare → solar-flare
// frame_orbit_shards → orbit-shards
function normId(id) {
  if (!id) return '';
  return id
    .replace(/^(nick|frame|banner|chat|lobby|dev_nick|dev_frame|dev_banner|dev_chat|dev_lobby)_/, '')
    .replace(/_/g, '-');
}

// ─── NICKNAME COLORS ──────────────────────────────────────────────────────
const NICKNAME_COLORS = {
  'solar-flare':     { g: 'linear-gradient(135deg,#fde047,#fb7185,#f97316)', glow: '#f97316', sz: '200% 200%' },
  'glacier-hype':    { g: 'linear-gradient(135deg,#67e8f9,#60a5fa,#818cf8)', glow: '#67e8f9', sz: '200% 200%' },
  'synthwave-blaze': { g: 'linear-gradient(135deg,#fb7185,#a855f7,#22d3ee)', glow: '#fb7185', sz: '200% 200%' },
  'blacklight-pulse':{ g: 'linear-gradient(135deg,#7c3aed,#22d3ee,#c77dff)', glow: '#7c3aed', sz: '300% 300%' },
  'vinyl-prism':     { g: 'linear-gradient(135deg,#f59e0b,#f43f5e,#8b5cf6,#06b6d4)', glow: '#f43f5e', sz: '300% 300%' },
  'chrome-wave':     { g: 'linear-gradient(135deg,#f8fafc,#94a3b8,#e2e8f0,#94a3b8)', glow: '#94a3b8', sz: '200% 200%' },
  'quantum-pop':     { g: 'linear-gradient(135deg,#22d3ee,#ec4899,#fde047,#22d3ee)', glow: '#22d3ee', sz: '300% 300%' },
  'hyperion-aura':   { g: 'linear-gradient(135deg,#38bdf8,#a78bfa,#f472b6,#fde68a)', glow: '#a78bfa', sz: '300% 300%' },
  // DEV
  'emerald-sovereign':{ g: 'linear-gradient(135deg,#34d399,#10b981,#6ee7b7,#34d399)', glow: '#34d399', sz: '200% 200%' },
  'jade-flux':       { g: 'linear-gradient(135deg,#22c55e,#86efac,#15803d)', glow: '#22c55e', sz: '200% 200%' },
  'mint-quantum':    { g: 'linear-gradient(135deg,#99f6e4,#14b8a6,#34d399)', glow: '#14b8a6', sz: '200% 200%' },
  'viridian-crown':  { g: 'linear-gradient(135deg,#16a34a,#22c55e,#4ade80)', glow: '#22c55e', sz: '200% 200%' },
};

// ─── AVATAR FRAMES ────────────────────────────────────────────────────────
const AVATAR_FRAMES = {
  'neon-hex':      { color: '#22d3ee', anim: 'frame-pulse 2s ease-in-out infinite' },
  'crystal-ring':  { color: '#67e8f9', anim: 'frame-pulse 2.5s ease-in-out infinite' },
  'orbit-shards':  { color: '#a855f7', anim: 'frame-pulse 2s ease-in-out infinite' },
  'reactor-core':  { color: '#f97316', anim: 'frame-pulse 1.8s ease-in-out infinite' },
  'aurora-circuit':{ color: '#14b8a6', anim: 'frame-pulse 2.2s ease-in-out infinite' },
  'velvet-void':   { color: '#8b5cf6', anim: 'frame-pulse 3s ease-in-out infinite' },
  'solaris-crown': { color: '#f59e0b', anim: 'frame-pulse 2s ease-in-out infinite' },
  'infinity-halo': { color: '#22d3ee', anim: 'frame-rainbow 3s linear infinite', rainbow: true },
  // DEV
  'emerald-matrix':{ color: '#34d399', anim: 'frame-pulse 2s ease-in-out infinite' },
  'jade-reactor':  { color: '#22c55e', anim: 'frame-pulse 2s ease-in-out infinite' },
  'mint-halo':     { color: '#99f6e4', anim: 'frame-pulse 2s ease-in-out infinite' },
  'viridian-pulse':{ color: '#4ade80', anim: 'frame-pulse 1.8s ease-in-out infinite' },
};

// ─── PROFILE BANNERS ─────────────────────────────────────────────────────
const PROFILE_BANNERS = {
  'city-afterglow':    { bg: 'linear-gradient(135deg,#111827,#334155,#f97316)', sz: '200% 200%' },
  'cosmic-studio':     { bg: 'linear-gradient(135deg,#0f172a,#7c3aed,#22d3ee)', sz: '200% 200%' },
  'aurora-drift':      { bg: 'linear-gradient(135deg,#14b8a6,#8b5cf6,#f0abfc)', sz: '200% 200%' },
  'luxe-signal':       { bg: 'linear-gradient(135deg,#f59e0b,#ec4899,#7c3aed)', sz: '200% 200%' },
  'quantum-lounge':    { bg: 'radial-gradient(circle at 15% 20%,#67e8f9,transparent 34%),linear-gradient(135deg,#111827,#1d4ed8)', sz: '200% 200%' },
  'ultraviolet-core':  { bg: 'linear-gradient(135deg,#020617,#7c3aed,#f43f5e)', sz: '200% 200%' },
  'golden-stage':      { bg: 'linear-gradient(135deg,#fef3c7,#f59e0b,#b45309)', sz: '200% 200%' },
  'hologram-royale':   { bg: 'linear-gradient(135deg,#22d3ee,#a78bfa,#f472b6,#fde68a)', sz: '300% 300%' },
  // DEV
  'emerald-throne':    { bg: 'linear-gradient(135deg,#052e16,#10b981,#34d399)', sz: '200% 200%' },
  'jade-nebula':       { bg: 'linear-gradient(135deg,#14532d,#22c55e,#6ee7b7)', sz: '200% 200%' },
  'mint-core':         { bg: 'radial-gradient(circle,#99f6e4,#34d399,#064e3b)', sz: '200% 200%' },
  'viridian-infinite': { bg: 'linear-gradient(135deg,#16a34a,#15803d,#34d399,#86efac)', sz: '300% 300%' },
};

// ─── CHAT EFFECTS ─────────────────────────────────────────────────────────
const CHAT_EFFECTS = {
  'neon-mist':      { bg: 'linear-gradient(135deg,#0a0f2e,#0d2b4e)', border: 'rgba(0,212,255,0.35)', shadow: '0 0 14px rgba(0,212,255,0.3),inset 0 0 20px rgba(0,212,255,0.08)' },
  'emoji-rain':     { bg: 'linear-gradient(135deg,#2d1200,#4a1f00)', border: 'rgba(255,140,0,0.35)', shadow: '0 0 14px rgba(255,140,0,0.3),inset 0 0 20px rgba(255,140,0,0.08)' },
  'pixel-pop':      { bg: 'repeating-linear-gradient(0deg,#0e0027 0,#0e0027 3px,#1a0040 3px,#1a0040 6px)', border: 'rgba(204,0,255,0.35)', shadow: '0 0 14px rgba(204,0,255,0.3)' },
  'waveform-glow':  { bg: 'linear-gradient(135deg,#001a0e,#003320)', border: 'rgba(0,255,136,0.35)', shadow: '0 0 14px rgba(0,255,136,0.3),inset 0 0 20px rgba(0,255,136,0.08)' },
  'starlight-box':  { bg: 'radial-gradient(circle at 30% 40%,#312e81,#020617)', border: 'rgba(99,102,241,0.4)', shadow: '0 0 16px rgba(99,102,241,0.35)' },
  'laser-tape':     { bg: 'linear-gradient(135deg,#1a0010,#001a1a)', border: 'rgba(244,63,94,0.4)', shadow: '0 0 14px rgba(244,63,94,0.3),0 0 14px rgba(34,211,238,0.2)' },
  'midnight-frost': { bg: 'linear-gradient(135deg,#0f172a,#0c2340)', border: 'rgba(14,165,233,0.35)', shadow: '0 0 14px rgba(14,165,233,0.25)' },
  'hypernova':      { bg: 'linear-gradient(135deg,#0d0020,#200040)', border: 'rgba(236,72,153,0.4)', shadow: '0 0 16px rgba(34,211,238,0.25),0 0 16px rgba(236,72,153,0.25)' },
  // DEV
  'emerald-mist':   { bg: 'linear-gradient(135deg,#052e16,#064e3b)', border: 'rgba(52,211,153,0.4)', shadow: '0 0 14px rgba(52,211,153,0.3)' },
  'jade-symbols':   { bg: 'repeating-linear-gradient(90deg,#052e16 0,#052e16 10px,#064e3b 10px,#064e3b 20px)', border: 'rgba(34,197,94,0.4)', shadow: '0 0 14px rgba(34,197,94,0.3)' },
};

// ─── LOBBY EFFECTS ────────────────────────────────────────────────────────
const LOBBY_EFFECTS = {
  'glass-flux':      { bg: 'linear-gradient(135deg,#001428,#002240)', border: 'rgba(56,189,248,0.3)', shadow: '0 0 20px rgba(56,189,248,0.2)', sz: '200% 200%' },
  'plasma-mesh':     { bg: 'linear-gradient(135deg,#070025,#0d003a)', border: 'rgba(168,85,247,0.3)', shadow: '0 0 20px rgba(6,182,212,0.2)', sz: '200% 200%' },
  'night-radar':     { bg: 'radial-gradient(circle at 50% 50%,rgba(34,211,238,0.12),transparent 70%),linear-gradient(135deg,#020617,#0a0a20)', border: 'rgba(34,211,238,0.25)', shadow: '0 0 20px rgba(34,211,238,0.15)' },
  'firefly-lane':    { bg: 'linear-gradient(135deg,#1a0800,#2d1000)', border: 'rgba(245,158,11,0.3)', shadow: '0 0 20px rgba(245,158,11,0.2)', sz: '200% 200%' },
  'quantum-glow':    { bg: 'linear-gradient(135deg,#010d1a,#001a2e)', border: 'rgba(34,211,238,0.3)', shadow: '0 0 24px rgba(34,211,238,0.2)', sz: '200% 200%' },
  'royal-chamber':   { bg: 'linear-gradient(135deg,#0d0020,#200040)', border: 'rgba(124,58,237,0.35)', shadow: '0 0 20px rgba(236,72,153,0.15)', sz: '200% 200%' },
  'sunrise-core':    { bg: 'linear-gradient(135deg,#1a0a00,#2a1500)', border: 'rgba(253,230,138,0.3)', shadow: '0 0 20px rgba(251,113,133,0.2)', sz: '300% 300%' },
  'horizon-mirage':  { bg: 'linear-gradient(135deg,#001020,#002030)', border: 'rgba(167,139,250,0.3)', shadow: '0 0 24px rgba(34,211,238,0.15)', sz: '300% 300%' },
  // DEV
  'emerald-grid':   { bg: 'linear-gradient(135deg,#052e16,#10b981,#6ee7b7)', border: 'rgba(52,211,153,0.45)', shadow: '0 0 26px rgba(52,211,153,0.28), inset 0 0 28px rgba(16,185,129,0.12)', sz: '200% 200%' },
  'jade-hall':      { bg: 'linear-gradient(135deg,#14532d,#22c55e,#bbf7d0)', border: 'rgba(34,197,94,0.45)', shadow: '0 0 26px rgba(34,197,94,0.28), inset 0 0 28px rgba(187,247,208,0.1)', sz: '200% 200%' },
  'mint-realm':     { bg: 'radial-gradient(circle at 25% 20%,#99f6e4,transparent 34%),linear-gradient(135deg,#064e3b,#34d399,#052e16)', border: 'rgba(153,246,228,0.45)', shadow: '0 0 28px rgba(153,246,228,0.25), inset 0 0 30px rgba(52,211,153,0.12)', sz: '220% 220%' },
  'viridian-prestige': { bg: 'conic-gradient(from 140deg,#16a34a,#22c55e,#86efac,#16a34a)', border: 'rgba(134,239,172,0.48)', shadow: '0 0 30px rgba(34,197,94,0.3), inset 0 0 28px rgba(134,239,172,0.1)', sz: '240% 240%' },
};

// ─── CSS-АНИМАЦИИ (инжектируем один раз) ─────────────────────────────────
(function injectCosmeticsCSS() {
  if (document.getElementById('cosmetics-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'cosmetics-keyframes';
  style.textContent = `
    @keyframes cosmetic-nick-shift {
      0%   { background-position: 0% 50%; }
      50%  { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    @keyframes frame-pulse {
      0%,100% { box-shadow: 0 0 6px var(--fc,#22d3ee), 0 0 14px var(--fc,#22d3ee); }
      50%      { box-shadow: 0 0 14px var(--fc,#22d3ee), 0 0 28px var(--fc,#22d3ee); }
    }
    @keyframes frame-rainbow {
      0%   { outline-color: #22d3ee; box-shadow: 0 0 10px #22d3ee; }
      25%  { outline-color: #a855f7; box-shadow: 0 0 10px #a855f7; }
      50%  { outline-color: #ec4899; box-shadow: 0 0 10px #ec4899; }
      75%  { outline-color: #fde047; box-shadow: 0 0 10px #fde047; }
      100% { outline-color: #22d3ee; box-shadow: 0 0 10px #22d3ee; }
    }
    @keyframes lobby-bg-shift {
      0%   { background-position: 0% 50%; }
      50%  { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    @keyframes banner-shift {
      0%   { background-position: 0% 50%; }
      50%  { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
  `;
  document.head.appendChild(style);
})();

// ─── RENDERER ─────────────────────────────────────────────────────────────
window.CosmeticsRenderer = {

  _norm(id) { return normId(id); },

  applyNickname(el, id) {
    if (!el || !id) return;
    const cfg = NICKNAME_COLORS[normId(id)];
    if (!cfg) return;
    el.style.background = cfg.g;
    el.style.backgroundSize = cfg.sz || '200% 200%';
    el.style.webkitBackgroundClip = 'text';
    el.style.backgroundClip = 'text';
    el.style.webkitTextFillColor = 'transparent';
    el.style.color = 'transparent';
    el.style.filter = `drop-shadow(0 0 8px ${cfg.glow}99)`;
    el.style.animation = `cosmetic-nick-shift 2.5s ease-in-out infinite`;
    el.dataset.cosmeticNick = id;
  },

  applyAvatarFrame(el, id) {
    if (!el || !id) return;
    const cfg = AVATAR_FRAMES[normId(id)];
    if (!cfg) return;
    el.style.setProperty('--fc', cfg.color);
    el.style.outline = `2.5px solid ${cfg.color}`;
    el.style.outlineOffset = '2px';
    el.style.borderRadius = '50%';
    if (cfg.rainbow) {
      el.style.animation = cfg.anim;
    } else {
      el.style.boxShadow = `0 0 8px ${cfg.color}, 0 0 18px ${cfg.color}66`;
      el.style.animation = cfg.anim;
    }
    el.dataset.cosmeticFrame = id;
  },

  applyChatBubble(el, id) {
    if (!el || !id) return;
    const cfg = CHAT_EFFECTS[normId(id)];
    if (!cfg) return;
    el.style.background = cfg.bg;
    el.style.border = `1px solid ${cfg.border}`;
    el.style.boxShadow = cfg.shadow;
    el.style.borderRadius = '10px';
    el.style.padding = '10px 14px';
    el.dataset.cosmeticChat = id;
  },

  applyLobbyCard(el, id) {
    if (!el || !id) return;
    const cfg = LOBBY_EFFECTS[normId(id)];
    if (!cfg) return;
    el.style.background = cfg.bg;
    el.style.borderColor = cfg.border;
    el.style.boxShadow = cfg.shadow;
    if (cfg.sz) {
      el.style.backgroundSize = cfg.sz;
      el.style.animation = 'lobby-bg-shift 4s ease-in-out infinite';
    }
    el.dataset.cosmeticLobby = id;
  },

  applyProfileBanner(el, id) {
    if (!el || !id) return;
    const cfg = PROFILE_BANNERS[normId(id)];
    if (!cfg) return;
    el.style.background = cfg.bg;
    el.style.backgroundSize = cfg.sz || '200% 200%';
    el.style.animation = 'banner-shift 5s ease-in-out infinite';
    el.dataset.cosmeticBanner = id;
    const card = el.closest?.('.profile-command-card');
    if (card) {
      const glow = String(cfg.bg).match(/#[0-9a-f]{3,8}/i)?.[0] || '#22d3ee';
      card.style.setProperty('--profile-history-button-bg', cfg.bg);
      card.style.setProperty('--profile-history-button-glow', glow);
    }
  },

  applyAll(player, elements = {}) {
    const c = player?.equippedCosmetics || {};
    if (elements.nickname  && c.nicknameColor) this.applyNickname(elements.nickname, c.nicknameColor);
    if (elements.avatar    && c.avatarFrame)   this.applyAvatarFrame(elements.avatar, c.avatarFrame);
    if (elements.chatBubble && c.chatEffect)   this.applyChatBubble(elements.chatBubble, c.chatEffect);
    if (elements.lobbyCard && c.lobbyEffect)   this.applyLobbyCard(elements.lobbyCard, c.lobbyEffect);
    if (elements.profileBanner && c.profileBanner) this.applyProfileBanner(elements.profileBanner, c.profileBanner);
  },

  reset(el) {
    if (!el) return;
    const props = ['background','background-size','-webkit-background-clip','background-clip',
      '-webkit-text-fill-color','color','filter','animation','box-shadow','outline',
      'outline-offset','border-color','border'];
    props.forEach(p => el.style.removeProperty(p));
    delete el.dataset.cosmeticNick;
    delete el.dataset.cosmeticChat;
    delete el.dataset.cosmeticLobby;
    delete el.dataset.cosmeticBanner;
    delete el.dataset.cosmeticFrame;
  }
};
