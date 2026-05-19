import React from "react";
import { motion } from "framer-motion";

const themes = {
  neon: {
    shell: "from-[#0B1020]/90 via-[#111827]/80 to-[#05070F]/90",
    accent: "from-cyan-400 via-fuchsia-500 to-emerald-400",
    glow: "shadow-[0_0_40px_rgba(34,211,238,.2)]",
    ring: "ring-cyan-400/30"
  },
  valorant: {
    shell: "from-[#0f1118]/90 via-[#171a24]/80 to-[#090b12]/95",
    accent: "from-rose-500 via-red-400 to-orange-400",
    glow: "shadow-[0_0_40px_rgba(244,63,94,.22)]",
    ring: "ring-rose-400/30"
  },
  discord: {
    shell: "from-[#101320]/90 via-[#181b2e]/80 to-[#0d1020]/95",
    accent: "from-indigo-400 via-violet-500 to-sky-400",
    glow: "shadow-[0_0_40px_rgba(99,102,241,.22)]",
    ring: "ring-indigo-400/30"
  },
  spotify: {
    shell: "from-[#0a160f]/90 via-[#0e2016]/80 to-[#050b07]/95",
    accent: "from-emerald-400 via-lime-400 to-green-300",
    glow: "shadow-[0_0_40px_rgba(74,222,128,.2)]",
    ring: "ring-emerald-400/30"
  }
};

const levelFromXp = (xp = 0) => Math.max(1, Math.floor(xp / 1000) + 1);
const xpForLevel = (level = 1) => level * 1000;

function ProgressBar({ xp = 0, accent }) {
  const level = levelFromXp(xp);
  const currentLevelXp = xp - (level - 1) * 1000;
  const required = xpForLevel(level) - xpForLevel(level - 1);
  const progress = Math.min(100, Math.max(0, (currentLevelXp / required) * 100));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-zinc-300/80">
        <span>XP Progress</span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/10 backdrop-blur-sm">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${accent}`}
        />
        <div className="pointer-events-none absolute inset-0 opacity-50 [background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent)]" />
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>LVL {level}</span>
        <span>{currentLevelXp.toLocaleString()} / {required.toLocaleString()} XP</span>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-md">
      <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-400">{label}</p>
      <p className="mt-1 text-base font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

export default function ProfileCard({ player, selectedTheme = "neon", onThemeChange }) {
  const theme = themes[selectedTheme] || themes.neon;
  const {
    displayName,
    username,
    avatar,
    status = "In Queue",
    rank = "Diamond",
    country = "EU",
    economy = {},
    stats = {}
  } = player;

  return (
    <motion.article
      whileHover={{ y: -4, scale: 1.005 }}
      transition={{ type: "spring", stiffness: 220, damping: 18 }}
      className={`group relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br ${theme.shell} p-5 sm:p-6 ${theme.glow}`}
    >
      <div className="pointer-events-none absolute -left-24 -top-24 h-52 w-52 rounded-full bg-fuchsia-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-52 w-52 rounded-full bg-cyan-400/15 blur-3xl" />

      <div className="relative z-10 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <motion.div
              whileHover={{ rotate: -2, scale: 1.03 }}
              className={`h-16 w-16 overflow-hidden rounded-2xl ring-2 ${theme.ring} bg-white/10 sm:h-20 sm:w-20`}
            >
              {avatar ? (
                <img src={avatar} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center text-xl font-bold text-zinc-100">
                  {(displayName || "?")[0]}
                </div>
              )}
            </motion.div>

            <div>
              <h2 className="text-xl font-semibold leading-tight text-zinc-50 sm:text-2xl">{displayName}</h2>
              <p className="text-sm text-zinc-400">@{username}</p>
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] uppercase tracking-wider text-zinc-300">
                <span className={`h-1.5 w-1.5 rounded-full bg-gradient-to-r ${theme.accent}`} />
                {status}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <span className="rounded-lg border border-white/15 bg-black/20 px-2.5 py-1 text-xs text-zinc-300">{rank}</span>
            <span className="text-xs uppercase tracking-widest text-zinc-500">{country}</span>
          </div>
        </div>

        <ProgressBar xp={economy.xp || 0} accent={theme.accent} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Vinyls" value={(economy.vinyls || 0).toLocaleString()} />
          <Stat label="Matches" value={stats.matches || 0} />
          <Stat label="Winrate" value={`${stats.winrate || 0}%`} />
          <Stat label="MVP" value={stats.mvp || 0} />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {Object.keys(themes).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onThemeChange?.(key)}
              className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-wider transition-all duration-300 ${
                selectedTheme === key
                  ? "border-white/40 bg-white/15 text-white"
                  : "border-white/15 bg-white/[0.03] text-zinc-400 hover:border-white/30 hover:text-zinc-200"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
    </motion.article>
  );
}
