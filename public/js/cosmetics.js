/**
 * cosmetics.js — Music Spy Cosmetics Renderer
 * Подключи в HTML: <script src="/js/cosmetics.js"></script>
 * 
 * Использование:
 *   CosmeticsRenderer.applyAll(playerData, elements);
 *   CosmeticsRenderer.applyNickname(el, 'blacklight-pulse');
 */

// ─── ДАННЫЕ ПРЕДМЕТОВ ──────────────────────────────────────────────────────

const NICKNAME_COLORS = {
  "solar-flare": {
    gradient: "linear-gradient(135deg, #ff6b35 0%, #ffbe0b 50%, #ff6b35 100%)",
    glow: "#ff8c42",
    animationBg: "cosmetic-bg-shift 3s ease-in-out infinite",
    filter: "drop-shadow(0 0 8px #ff8c42aa)",
    bgSize: "200% 200%"
  },
  "glacier-hype": {
    gradient: "linear-gradient(135deg, #00d4ff 0%, #7b2fff 50%, #00fff5 100%)",
    glow: "#00d4ff",
    animationBg: "cosmetic-bg-shift 2.5s ease-in-out infinite",
    filter: "drop-shadow(0 0 10px #00d4ffaa)",
    bgSize: "200% 200%"
  },
  "synthwave-blaze": {
    gradient: "linear-gradient(135deg, #ff006e 0%, #8338ec 50%, #ff006e 100%)",
    glow: "#ff006e",
    animationBg: "cosmetic-bg-shift 2s ease-in-out infinite",
    filter: "drop-shadow(0 0 10px #ff006eaa)",
    bgSize: "200% 200%"
  },
  "blacklight-pulse": {
    gradient: "linear-gradient(135deg, #9d4edd 0%, #00d4ff 40%, #c77dff 70%, #9d4edd 100%)",
    glow: "#9d4edd",
    animationBg: "cosmetic-bg-shift 1.8s ease-in-out infinite",
    filter: "drop-shadow(0 0 12px #9d4eddcc) drop-shadow(0 0 4px #00d4ffaa)",
    bgSize: "300% 300%"
  }
};

const CHAT_EFFECTS = {
  "neon-mist": {
    background: "linear-gradient(135deg, #0a0f2e 0%, #0d2b4e 100%)",
    borderColor: "#00d4ff55",
    boxShadow: "0 0 12px #00d4ff33, inset 0 0 20px #00d4ff11"
  },
  "emoji-rain": {
    background: "linear-gradient(135deg, #2d1200 0%, #4a1f00 100%)",
    borderColor: "#ff8c0055",
    boxShadow: "0 0 12px #ff8c0033, inset 0 0 20px #ff8c0011",
    pseudo: true
  },
  "pixel-pop": {
    background: `repeating-linear-gradient(
      0deg,
      #0e0027 0px, #0e0027 3px,
      #1a0040 3px, #1a0040 6px
    ), linear-gradient(135deg, #1a0040, #2d0060)`,
    borderColor: "#cc00ff55",
    boxShadow: "0 0 12px #cc00ff33, inset 0 0 20px #cc00ff11"
  },
  "waveform-glow": {
    background: "linear-gradient(135deg, #001a0e 0%, #003320 100%)",
    borderColor: "#00ff8855",
    boxShadow: "0 0 12px #00ff8833, inset 0 0 20px #00ff8811"
  }
};

const LOBBY_EFFECTS = {
  "solar-burst": {
    background: "linear-gradient(135deg, #1a0a00 0%, #2d1800 50%, #1a0a00 100%)",
    borderColor: "#ff8c0055",
    boxShadow: "0 0 20px #ff8c0033",
    animationBg: "cosmetic-bg-shift 4s ease-in-out infinite",
    bgSize: "200% 200%"
  },
  "arctic-aura": {
    background: "linear-gradient(135deg, #001428 0%, #002240 100%)",
    borderColor: "#00d4ff55",
    boxShadow: "0 0 20px #00d4ff33",
    animationBg: "cosmetic-bg-shift 3s ease-in-out infinite",
    bgSize: "200% 200%"
  },
  "neon-grid": {
    background: `
      repeating-linear-gradient(0deg, transparent, transparent 24px, #cc00ff18 24px, #cc00ff18 25px),
      repeating-linear-gradient(90deg, transparent, transparent 24px, #cc00ff18 24px, #cc00ff18 25px),
      linear-gradient(135deg, #0e0022, #1a0040)
    `,
    borderColor: "#cc00ff55",
    boxShadow: "0 0 20px #cc00ff33"
  },
  "emerald-haze": {
    background: "linear-gradient(135deg, #001a0e 0%, #003320 100%)",
    borderColor: "#00ff8855",
    boxShadow: "0 0 20px #00ff8833"
  }
};

const PROFILE_BANNERS = {
  "aurora-wave": {
    background: "linear-gradient(135deg, #0a0a2e, #1a0040, #002240, #0a0a2e)",
    animationBg: "cosmetic-bg-shift 5s ease-in-out infinite",
    bgSize: "300% 300%"
  },
  "lava-flow": {
    background: "linear-gradient(135deg, #1a0500, #3d0f00, #ff4400, #1a0500)",
    animationBg: "cosmetic-bg-shift 4s ease-in-out infinite",
    bgSize: "300% 300%"
  },
  "galaxy-drift": {
    background: "linear-gradient(135deg, #050010, #0a0028, #1a0040, #050010)",
    animationBg: "cosmetic-bg-shift 6s ease-in-out infinite",
    bgSize: "300% 300%"
  }
};

const AVATAR_FRAMES = {
  "golden-halo": {
    outline: "2px solid #ffd700",
    boxShadow: "0 0 8px #ffd700, 0 0 16px #ffd70066, inset 0 0 8px #ffd70033",
    animation: "frame-pulse-gold 2s ease-in-out infinite"
  },
  "neon-circuit": {
    outline: "2px solid #00ff88",
    boxShadow: "0 0 8px #00ff88, 0 0 16px #00ff8866",
    animation: "frame-flicker 1.5s linear infinite"
  },
  "shadow-void": {
    outline: "2px solid #9d4edd",
    boxShadow: "0 0 10px #9d4edd, 0 0 20px #9d4edd44, 0 0 40px #9d4edd22",
    animation: "frame-pulse-purple 3s ease-in-out infinite"
  }
};

// ─── RENDERER ──────────────────────────────────────────────────────────────

window.CosmeticsRenderer = {
  applyNickname(el, id) {
    if (!el || !id) return;
    const cfg = NICKNAME_COLORS[id];
    if (!cfg) return;
    el.style.background = cfg.gradient;
    el.style.backgroundSize = cfg.bgSize || "100% 100%";
    el.style.webkitBackgroundClip = "text";
    el.style.backgroundClip = "text";
    el.style.webkitTextFillColor = "transparent";
    el.style.color = "transparent";
    el.style.filter = cfg.filter;
    if (cfg.animationBg) el.style.animation = cfg.animationBg;
    el.dataset.cosmeticNick = id;
  },

  applyChatBubble(el, id) {
    if (!el || !id) return;
    const cfg = CHAT_EFFECTS[id];
    if (!cfg) return;
    el.style.background = cfg.background;
    el.style.borderColor = cfg.borderColor;
    el.style.boxShadow = cfg.boxShadow;
    el.dataset.cosmeticChat = id;
    el.classList.add("cosmetic-chat-active");
  },

  applyLobbyCard(el, id) {
    if (!el || !id) return;
    const cfg = LOBBY_EFFECTS[id];
    if (!cfg) return;
    el.style.background = cfg.background;
    el.style.borderColor = cfg.borderColor || "";
    el.style.boxShadow = cfg.boxShadow || "";
    if (cfg.animationBg) {
      el.style.backgroundSize = cfg.bgSize;
      el.style.animation = cfg.animationBg;
    }
    el.dataset.cosmeticLobby = id;
  },

  applyProfileBanner(el, id) {
    if (!el || !id) return;
    const cfg = PROFILE_BANNERS[id];
    if (!cfg) return;
    el.style.background = cfg.background;
    if (cfg.animationBg) {
      el.style.backgroundSize = cfg.bgSize;
      el.style.animation = cfg.animationBg;
    }
    el.dataset.cosmeticBanner = id;
  },

  applyAvatarFrame(el, id) {
    if (!el || !id) return;
    const cfg = AVATAR_FRAMES[id];
    if (!cfg) return;
    el.style.outline = cfg.outline;
    el.style.boxShadow = cfg.boxShadow;
    if (cfg.animation) el.style.animation = cfg.animation;
    el.dataset.cosmeticFrame = id;
  },

  applyAll(player, elements = {}) {
    const c = player?.equippedCosmetics || {};
    if (elements.nickname && c.nicknameColor) this.applyNickname(elements.nickname, c.nicknameColor);
    if (elements.avatar && c.avatarFrame) this.applyAvatarFrame(elements.avatar, c.avatarFrame);
    if (elements.chatBubble && c.chatEffect) this.applyChatBubble(elements.chatBubble, c.chatEffect);
    if (elements.lobbyCard && c.lobbyEffect) this.applyLobbyCard(elements.lobbyCard, c.lobbyEffect);
    if (elements.profileBanner && c.profileBanner) this.applyProfileBanner(elements.profileBanner, c.profileBanner);
  },

  reset(el) {
    if (!el) return;
    el.style.removeProperty("background");
    el.style.removeProperty("background-size");
    el.style.removeProperty("-webkit-background-clip");
    el.style.removeProperty("background-clip");
    el.style.removeProperty("-webkit-text-fill-color");
    el.style.removeProperty("color");
    el.style.removeProperty("filter");
    el.style.removeProperty("animation");
    el.style.removeProperty("box-shadow");
    el.style.removeProperty("outline");
    el.style.removeProperty("border-color");
    delete el.dataset.cosmeticNick;
    delete el.dataset.cosmeticChat;
    delete el.dataset.cosmeticLobby;
    delete el.dataset.cosmeticBanner;
    delete el.dataset.cosmeticFrame;
    el.classList.remove("cosmetic-chat-active");
  }
};
