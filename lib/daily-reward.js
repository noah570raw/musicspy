const DAILY_REWARD_STREAK_AMOUNTS = Object.freeze([300, 350, 400, 450, 500, 650, 700]);

function utcDayStamp(input) {
  const date = input ? new Date(input) : new Date();
  return date.toISOString().slice(0, 10);
}

function dayDiffUtc(fromInput, toInput) {
  if (!fromInput || !toInput) return null;
  const from = new Date(`${utcDayStamp(fromInput)}T00:00:00.000Z`).getTime();
  const to = new Date(`${utcDayStamp(toInput)}T00:00:00.000Z`).getTime();
  return Math.floor((to - from) / 86400000);
}

function buildDailyRewardState(economy, now = new Date()) {
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const schedule = DAILY_REWARD_STREAK_AMOUNTS;
  const lastClaimAt = economy?.lastDailyRewardAt || null;
  const diffDays = dayDiffUtc(lastClaimAt, nowIso);
  const canClaim = !lastClaimAt || diffDays >= 1;

  const storedStreak = Math.max(0, Math.floor(Number(economy?.dailyRewardStreak || 0)));
  const normalizedStreak = Math.min(schedule.length, storedStreak);

  let nextStreak = 1;
  if (lastClaimAt && diffDays === 1) nextStreak = normalizedStreak + 1;
  else if (lastClaimAt && diffDays <= 0) nextStreak = normalizedStreak || 1;

  const cycleDay = Math.max(1, Math.min(schedule.length, ((nextStreak - 1) % schedule.length) + 1));
  const claimedDays = canClaim ? cycleDay - 1 : cycleDay;
  const rewardAmount = schedule[cycleDay - 1] || schedule[0];

  const nextClaimAt = canClaim
    ? nowIso
    : new Date(`${utcDayStamp(nowIso)}T00:00:00.000Z`).getTime() + 86400000;

  return {
    canClaim,
    rewardAmount,
    rewardSchedule: schedule,
    cycleDay,
    claimedDays,
    streak: Math.max(0, canClaim ? cycleDay - 1 : cycleDay),
    lastClaimAt,
    nextClaimAt: typeof nextClaimAt === "string" ? nextClaimAt : new Date(nextClaimAt).toISOString(),
    remainingMs: canClaim ? 0 : Math.max(0, nextClaimAt - new Date(nowIso).getTime())
  };
}

function applyDailyClaim(economy, now = new Date()) {
  const state = buildDailyRewardState(economy, now);
  if (!state.canClaim) return { success: false, state };
  economy.lastDailyRewardAt = (now instanceof Date ? now : new Date(now)).toISOString();
  economy.dailyRewardStreak = state.cycleDay;
  if (!Array.isArray(economy.dailyRewardClaimedDays)) economy.dailyRewardClaimedDays = [];
  economy.dailyRewardClaimedDays = Array.from(new Set([...(economy.dailyRewardClaimedDays || []), state.cycleDay])).sort((a, b) => a - b);
  return { success: true, claimedState: state };
}

module.exports = { DAILY_REWARD_STREAK_AMOUNTS, buildDailyRewardState, applyDailyClaim, utcDayStamp };
