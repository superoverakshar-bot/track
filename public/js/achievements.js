// Achievement badges, unlocked from logged data.
import { avoidedPouches } from './coach.js';
import { planFor, programKeysSoFar, scoreFor, stats, streak } from './logic.js';
import { getState, peekDay, todayKey } from './store.js';
import { taperProgress } from './taper.js';

export const BADGES = [
  { id: 'start', emoji: '🌱', name: 'Day one', desc: 'Started your 90 days', test: (c) => c.day >= 1 },
  { id: 'urge1', emoji: '💪', name: 'Urge crusher', desc: 'Beat your first urge', test: (c) => c.saved >= 1 },
  { id: 'perfect', emoji: '⭐', name: 'Perfect day', desc: 'All 5 non-negotiables', test: (c) => c.perfectDays >= 1 },
  { id: 'walk1', emoji: '👟', name: 'First 30', desc: 'Logged a 30-min session', test: (c) => c.walks >= 1 },
  { id: 'water5', emoji: '💧', name: 'Hydration hero', desc: 'Hit water target 5 days', test: (c) => c.waterDays >= 5 },
  { id: 'streak3', emoji: '🔥', name: 'On fire', desc: '3 perfect days in a row', test: (c) => c.bestStreak >= 3 },
  { id: 'cap7', emoji: '🎯', name: 'Cap keeper', desc: '7 days under the cap', test: (c) => c.underCap >= 7 },
  { id: 'tag10', emoji: '🕵️', name: 'Trigger detective', desc: 'Tagged 10 triggers', test: (c) => c.tagged >= 10 },
  { id: 'trend', emoji: '📉', name: 'Trending down', desc: 'A lower week than the last', test: (c) => c.weekDown },
  { id: 'lock7', emoji: '🔒', name: 'Lock keeper', desc: 'Morning lock kept 7 days', test: (c) => c.lockDays >= 7 },
  { id: 'urge25', emoji: '🛡️', name: 'Urge master', desc: '25 urges beaten', test: (c) => c.saved >= 25 },
  { id: 'avoid100', emoji: '💯', name: '100 avoided', desc: '100 fewer pouches', test: (c) => c.avoided >= 100 },
  { id: 'walk10', emoji: '⚡', name: 'Ten sessions', desc: '10 walks logged', test: (c) => c.walks >= 10 },
  { id: 'streak7', emoji: '🏆', name: 'Unstoppable', desc: '7-day perfect streak', test: (c) => c.bestStreak >= 7 },
  { id: 'half', emoji: '🌗', name: 'Halfway hero', desc: 'Reached day 31', test: (c) => c.day >= 31 },
  { id: 'avoid500', emoji: '🚀', name: '500 avoided', desc: '500 fewer pouches', test: (c) => c.avoided >= 500 },
  { id: 'zero', emoji: '🕊️', name: 'Pouch-free day', desc: 'A full day at zero', test: (c) => c.zeroDays >= 1 },
  { id: 'free', emoji: '👑', name: 'Free for good', desc: 'Finished all 90 days', test: (c) => c.day > 90 },
];

export function badgeStats() {
  const st = getState();
  const today = todayKey();
  const keys = programKeysSoFar();
  const target = st.settings.waterTargetL * 1000;
  let perfectDays = 0;
  let waterDays = 0;
  let zeroDays = 0;
  let lockDays = 0;
  for (const k of keys) {
    const d = peekDay(k);
    if (!d) continue;
    if (scoreFor(k) === 5) perfectDays++;
    if (d.pouches.length && !d.pouches.some((p) => p.flags.includes('morning'))) lockDays++;
    if (d.waterMl >= target) waterDays++;
    if (k < today && d.pouches.length === 0 && (d.waterMl > 0 || d.checkin || d.saved)) zeroDays++;
  }
  const s = stats();
  const all = Object.values(st.days);
  const tp = taperProgress();
  return {
    tagged: all.reduce((a, d) => a + d.pouches.filter((p) => p.trigger).length + (d.urges || []).filter((u) => u.trigger).length, 0),
    lockDays,
    weekDown: tp.weekChange != null && tp.weekChange < 0,
    day: planFor(today).day,
    saved: Object.values(st.days).reduce((a, d) => a + d.saved, 0),
    perfectDays,
    bestStreak: streak().best,
    underCap: s.underCap,
    avoided: avoidedPouches(),
    walks: st.walks.length,
    waterDays,
    zeroDays,
  };
}

export function badges() {
  const c = badgeStats();
  return BADGES.map((b) => ({ ...b, unlocked: b.test(c) }));
}
