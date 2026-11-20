'use strict';
// Economy on the client: Vinyls wallet, level + XP booster, daily reward, promo codes, the rewards panel after a
// Spy game and the "new level" moment. Vinyls and XP come only from Spy; the server owns every number.
(() => {
  const MS = window.MS;
  const { $, esc } = MS;
  const A = MS.account;

  const econ = () => (A.user && A.user.economy) || null;
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  function dur(ms) {
    const m = Math.max(0, Math.ceil(ms / 60000));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  }
  const coin = (cls = '') => `<span class="vinyl-coin ${cls}" aria-hidden="true"></span>`;

  const E = (MS.econ = {
    fmt,
    dur,
    coin,
    vinyls: () => (econ() ? econ().vinyls : 0),
    level: () => (econ() ? econ().level : 1),
    // { level, currentLevelXp, required, left, progress (0-100), totalXp }
    progress: () => (econ() && econ().xpProgress) || { level: 1, currentLevelXp: 0, required: 100, left: 100, progress: 0, totalXp: 0 },
    booster: () => (econ() && econ().xpBooster) || null,
    // the developer has infinite XP: their level and XP read ∞
    isDev: () => Boolean(A.user && A.user.permissions && A.user.permissions.dev),
    daily: null,
  });

  function signInFirst(what) {
    MS.toast(`Sign in to ${what}`);
    A.openAccount();
  }

  // ---------- wallet ----------
  const EARN = [
    ['Civilians win', '100'],
    ['Spy win', '300, perfect spy win 500'],
    ['Correct accusation', '75'],
    ['Win streak', '25 per win in a row, up to 150'],
    ['First game of the day', '100'],
    ['Game MVP', '100'],
    ['Daily reward', '300 to 700'],
    ['Achievements', '300 to 1,500'],
  ];
  E.openWallet = () => {
    if (!A.user) return signInFirst('collect Vinyls');
    const el = MS.sheet.open('wallet', {
      title: 'Vinyls',
      cls: 'narrow',
      body: `
        <div class="sheet-body">
          <div class="wallet-head">${coin('big')}<div><b data-wallet-balance>${fmt(E.vinyls())}</b><small>Vinyls to spend in the shop</small></div></div>
          <p class="section-label">How to earn</p>
          <ul class="earn-list">${EARN.map(([a, b]) => `<li><span>${esc(a)}</span><b>${esc(b)}</b></li>`).join('')}</ul>
          <p class="empty-note">Vinyls and XP come from Spy games. Keep 5 Delete 5 and King of the Hill are just for fun.</p>
          <div class="divider"></div>
          <form class="code-row promo-row" data-form="promo"><input name="code" placeholder="Promo code" autocomplete="off" spellcheck="false" aria-label="Promo code"><button class="btn">Redeem</button></form>
          <div class="row-actions"><button class="btn primary" data-wl="shop">Open the shop</button></div>
        </div>`,
    });
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      E.redeem(e.target.querySelector('input'));
    });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-wl="shop"]')) {
        MS.sheet.close('wallet');
        MS.app.nav('shop');
      }
    });
  };

  E.redeem = async (input) => {
    const code = String(input && input.value || '').trim();
    if (!code) return;
    const r = await MS.emit('promo:redeem', { code });
    if (!MS.okOf(r)) return MS.toast(r.error || 'Promo code not found');
    input.value = '';
    if (MS.sfx) MS.sfx.play('coin');
    MS.toast(r.message || 'Promo code redeemed');
  };

  // ---------- level + XP booster ----------
  E.openLevel = () => {
    if (!A.user) return signInFirst('earn XP and levels');
    MS.sheet.open('level', { title: 'Level', cls: 'narrow', body: '<div class="sheet-body" id="levelBody"></div>' });
    renderLevel();
  };

  function boosterHtml() {
    const b = E.booster();
    if (!b) return '';
    const x = b.displayMultiplier || 2;
    let line;
    let btn = '';
    if (b.active) line = `On: XP x${x} for ${dur(b.remainingActiveMs)} more`;
    else if (!b.canActivate) line = `Recharging. Ready in ${dur(b.remainingCooldownMs)}`;
    else {
      line = `XP x${x} for ${dur(b.durationMs)}. Then it recharges for 6 hours`;
      btn = '<button class="btn primary" data-lv="boost">Turn on</button>';
    }
    return `<div class="booster ${b.active ? 'on' : ''}"><span class="booster-x">x${x}</span><div><b>XP booster</b><small>${esc(line)}</small></div>${btn}</div>`;
  }

  function renderLevel() {
    const box = $('#levelBody');
    if (!box) return;
    const pr = E.progress();
    if (E.isDev()) {
      box.innerHTML = `
        <div class="level-hero">
          <span class="level-ring big inf" style="--p:100"><b>∞</b></span>
          <div><b>Level ∞</b><small>Infinite XP. The developer is past every level</small>
          <span class="xp-bar"><i style="width:100%"></i></span></div>
        </div>`;
      return;
    }
    box.innerHTML = `
      <div class="level-hero">
        <span class="level-ring big" style="--p:${pr.progress}"><b>${pr.level}</b></span>
        <div><b>Level ${pr.level}</b><small>${fmt(pr.currentLevelXp)} of ${fmt(pr.required)} XP · ${fmt(pr.left)} to level ${pr.level + 1}</small>
        <span class="xp-bar"><i style="width:${pr.progress}%"></i></span></div>
      </div>
      ${boosterHtml()}
      <p class="section-label">XP per Spy game</p>
      <ul class="earn-list"><li><span>Win</span><b>100</b></li><li><span>Game played</span><b>50</b></li><li><span>Voted for the spy</span><b>25</b></li></ul>
      <p class="empty-note">Total ${fmt(pr.totalXp)} XP.</p>`;
    box.onclick = async (e) => {
      const b = e.target.closest('[data-lv="boost"]');
      if (!b) return;
      b.disabled = true;
      const r = await MS.emit('xpBooster:activate');
      if (!MS.okOf(r)) { MS.toast(r.error || 'Could not turn the booster on'); b.disabled = false; return; }
      if (r.profile && r.profile.user) { A.user = r.profile.user; }
      if (MS.sfx) MS.sfx.play('up');
      MS.toast('XP booster is on');
      renderLevel();
    };
  }

  // ---------- daily reward ----------
  E.refreshDaily = async () => {
    if (!A.user) { E.daily = null; return null; }
    const r = await MS.emit('dailyReward:get');
    E.daily = MS.okOf(r) ? r : null;
    return E.daily;
  };

  E.dailyCardHtml = () => {
    const sched = (MS.cos.meta.daily && MS.cos.meta.daily.length ? MS.cos.meta.daily : [300, 350, 400, 450, 500, 650, 700]);
    const d = E.daily;
    if (!A.user) {
      return `
        <span class="side-label">Daily reward</span>
        <span class="days">${sched.map((v, i) => `<i title="${v} Vinyls">${i + 1}</i>`).join('')}</span>
        <span class="stub-line">Sign in to collect Vinyls every day</span>`;
    }
    if (!d) return '<span class="side-label">Daily reward</span><span class="days">' + sched.map((_, i) => `<i>${i + 1}</i>`).join('') + '</span>';
    const today = d.cycleDay;
    const days = sched.map((v, i) => {
      const n = i + 1;
      const cls = n <= d.claimedDays ? 'got' : (n === today && d.canClaim ? 'today' : '');
      return `<i class="${cls}" title="Day ${n}: ${v} Vinyls">${n}</i>`;
    }).join('');
    return `
      <span class="side-label">Daily reward ${d.canClaim ? `<span class="tag solid">+${fmt(d.rewardAmount)}</span>` : ''}</span>
      <span class="days">${days}</span>
      ${d.canClaim
        ? `<span class="daily-cta">${coin()}Collect ${fmt(d.rewardAmount)} Vinyls</span>`
        : `<span class="stub-line">Next reward in ${dur(d.remainingMs)}</span>`}`;
  };

  E.claimDaily = async () => {
    if (!A.user) return signInFirst('collect the daily reward');
    if (!E.daily || !E.daily.canClaim) return;
    const r = await MS.emit('dailyReward:claim');
    if (!MS.okOf(r)) return MS.toast(r.error || 'The reward is not ready yet');
    E.daily = r.dailyReward ? { ...r.dailyReward, success: true } : E.daily;
    if (r.profile && r.profile.user) A.user = r.profile.user;
    if (MS.sfx) MS.sfx.play('coin');
    MS.toast(`+${fmt(r.amount)} Vinyls. See you tomorrow`);
    const card = $('#dailyCard');
    if (card) card.innerHTML = E.dailyCardHtml();
    // the balance in the nav and the player card
    document.querySelectorAll('[data-vinyls]').forEach((n) => { n.textContent = fmt(E.vinyls()); });
  };

  // ---------- after a Spy game ----------
  // finalResult.economyRewards / expRewards: one entry per signed-in player.
  E.rewardsHtml = (result, meId) => {
    if (!result || !A.user) return '';
    const mineOf = (list) => (list || []).find((x) => x.accountId === A.user.id || x.playerId === meId) || null;
    const v = mineOf(result.economyRewards);
    const x = mineOf(result.expRewards);
    if (!v && !x) return '';
    const lines = [...((v && v.lines) || []).map((l) => ({ ...l, unit: 'v' })), ...((x && x.lines) || []).map((l) => ({ ...l, unit: 'xp' }))];
    const ach = (v && v.achievements) || [];
    return `
      <div class="rewards">
        <div class="rewards-top">
          ${v ? `<span class="reward-big">${coin()}+${fmt(v.total)}</span>` : ''}
          ${x ? `<span class="reward-big xp">${E.isDev() ? '∞ XP' : `+${fmt(x.total)} XP`}${x.multiplier > 1 && !E.isDev() ? ` <small>booster x${x.multiplier}</small>` : ''}</span>` : ''}
        </div>
        <ul class="reward-lines">${lines.map((l) => `<li><span>${esc(l.label)}</span><b>+${fmt(l.amount)}${l.unit === 'xp' ? ' XP' : ''}</b></li>`).join('')}</ul>
        ${x ? `<p class="reward-level">Level ${E.isDev() ? '∞' : x.level}</p>` : ''}
        ${ach.map((a) => `<p class="reward-ach"><b>Achievement: ${esc(a.label)}</b>${a.vinyls ? ` +${fmt(a.vinyls)} Vinyls` : ''}${a.unlock && MS.cos.item(a.unlock) ? `, unlocked ${esc(MS.cos.item(a.unlock).name)}` : ''}</p>`).join('')}
      </div>`;
  };

  // ---------- level up ----------
  let lastLevel = null;
  let lastUserId = null;
  A.onChange(() => {
    const u = A.user;
    if (!u) { lastLevel = null; lastUserId = null; return; }
    const lvl = u.economy ? u.economy.level : 1;
    if (lastUserId === u.id && lastLevel !== null && lvl > lastLevel && !E.isDev()) {
      if (MS.sfx) MS.sfx.play('level');
      MS.toast(`Level ${lvl}! Keep playing Spy for more`);
    }
    lastLevel = lvl;
    lastUserId = u.id;
    if (MS.sheet.isOpen('level')) renderLevel();
    const bal = document.querySelector('[data-wallet-balance]');
    if (bal) bal.textContent = fmt(E.vinyls());
  });
})();
