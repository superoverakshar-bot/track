import { PROGRAM_DAYS, addDays, programDay } from '../plan.js';
import { checklist, planFor, programKeysSoFar, rangeKeys, scoreFor, stats, streak, totalReps } from '../logic.js';
import { heatmap, timeChart } from '../charts.js';
import { getState, peekDay, todayKey } from '../store.js';
import { esc, plural, shortDate } from '../ui.js';
import { cardHead } from './parts.js';
import { badges } from '../achievements.js';
import { taperChart } from './taper.js';

function tiles() {
  const st = stats();
  const plan = planFor();
  const sk = streak();
  const waistDelta = st.waistFirst && st.waistLast && st.waistFirst !== st.waistLast ? st.waistLast.inches - st.waistFirst.inches : null;
  const dayVal = plan.day < 1 ? '—' : Math.min(plan.day, PROGRAM_DAYS);
  return `<div class="tiles">
    <div class="tile"><div class="label">Program day</div><div class="value">${dayVal}<small> / ${PROGRAM_DAYS}</small></div><div class="delta">${esc(plan.phase.name)}</div></div>
    <div class="tile"><div class="label">Pouches saved</div><div class="value">${st.saved}</div><div class="delta">urges beaten</div></div>
    <div class="tile"><div class="label">5/5 streak</div><div class="value">${sk.current}<small> days</small></div><div class="delta">best ${sk.best}</div></div>
    <div class="tile"><div class="label">Best 30-min distance</div><div class="value">${st.bestWalk ? st.bestWalk.distanceKm.toFixed(2) : '—'}<small> km</small></div><div class="delta">${plural(st.walks.length, 'session')}</div></div>
    <div class="tile"><div class="label">Longest plank</div><div class="value">${st.plankBest || '—'}<small> s</small></div></div>
    <div class="tile"><div class="label">Waist change</div><div class="value">${waistDelta == null ? '—' : `${waistDelta > 0 ? '+' : ''}${waistDelta.toFixed(1)}`}<small> in</small></div>
      ${waistDelta == null ? '<div class="delta">log 2+ weeks</div>' : `<div class="delta ${waistDelta <= 0 ? 'good' : 'bad'}">${waistDelta <= 0 ? '▼ shrinking' : '▲ up'}</div>`}</div>
  </div>`;
}

function medalsCard() {
  const list = badges();
  const got = list.filter((b) => b.unlocked).length;
  return `<section class="card">
    ${cardHead('Achievements', null, `<span class="score ${got === list.length ? 'full' : ''}">${got}/${list.length}</span>`)}
    <div class="meter" style="margin:-4px 0 14px"><span style="width:${(got / list.length) * 100}%"></span></div>
    <div class="medals">${list.map((b) => `<div class="medal ${b.unlocked ? '' : 'locked'}" aria-label="${esc(b.name)}: ${esc(b.desc)}${b.unlocked ? ', unlocked' : ', locked'}">
      <div class="m" aria-hidden="true">${b.emoji}</div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span></div>`).join('')}</div>
  </section>`;
}

export function render() {
  const anyDays = programKeysSoFar().length > 0;
  return `<div class="stack">
    ${tiles()}
    ${medalsCard()}
    <section class="card">${cardHead('Pouches vs cap', 'taper', '90 days')}
      <div class="legend"><span><i style="background:var(--s1)"></i>Pouches</span><span><i style="background:var(--bad)"></i>Over cap</span><span><i class="line" style="background:var(--ink-3)"></i>Daily cap</span></div>
      <div id="p-taper"></div></section>
    <section class="card">${cardHead('Stamina rises as pouches fall', 'move', 'Last 30 days')}
      <p class="small muted" style="margin-bottom:10px">Same dates, two charts — watch the distance line climb while the pouch columns shrink.</p>
      <h3 class="small" style="margin-bottom:4px">30-min distance (km)</h3><div id="p-dist"></div>
      <h3 class="small" style="margin:14px 0 4px">Pouches per day</h3><div id="p-pouch"></div>
    </section>
    <section class="card">${cardHead('Daily reps', 'strength', 'Last 30 days')}<div id="p-reps"></div></section>
    <section class="card">${cardHead('Non-negotiables', null, '90-day calendar')}
      ${anyDays ? '<div id="p-heat"></div>' : '<div class="empty">Your calendar fills in from day 1.</div>'}</section>
    <section class="card">${cardHead('Waist', 'strength')}<div id="p-waist">${stats().waist.length > 1 ? '' : '<div class="empty">Log your waist weekly to see the trend.</div>'}</div></section>
  </div>`;
}

export function mount(root) {
  const s = getState().settings;
  const today = todayKey();
  const st = stats();

  const taperHost = root.querySelector('#p-taper');
  taperChart(taperHost);
  taperHost.querySelector('.legend')?.remove();

  const last30 = rangeKeys(addDays(today, -29), today);
  const dist = {};
  for (const w of st.walks) if (w.date >= last30[0]) dist[w.date] = Math.max(dist[w.date] || 0, w.distanceKm);
  const pouches = {};
  const reps = {};
  for (const k of last30) {
    const d = peekDay(k);
    if (d) {
      pouches[k] = d.pouches.length;
      const r = totalReps(d);
      if (r) reps[k] = r;
    }
  }
  timeChart(root.querySelector('#p-dist'), {
    keys: last30, height: 130, label: '30-minute distance, last 30 days',
    series: [{ name: 'Distance', kind: 'line', color: 'var(--s2)', values: dist, fmt: (v) => `${v.toFixed(2)} km` }],
  });
  timeChart(root.querySelector('#p-pouch'), {
    keys: last30, height: 110, label: 'Pouches per day, last 30 days', endLabel: false, integer: true, yMaxMin: 4,
    series: [{ name: 'Pouches', kind: 'column', color: 'var(--s1)', values: pouches, fmt: (v) => String(v) }],
  });
  timeChart(root.querySelector('#p-reps'), {
    keys: last30, height: 140, label: 'Total push-ups, squats, pull-ups and core reps per day', endLabel: false,
    yMaxMin: 10,
    integer: true,
    series: [{ name: 'Reps', kind: 'column', color: 'var(--s4)', values: reps, fmt: (v) => `${v} reps` }],
  });

  const heatHost = root.querySelector('#p-heat');
  if (heatHost) {
    const keys = rangeKeys(s.startDate, addDays(s.startDate, PROGRAM_DAYS - 1));
    const values = {};
    for (const k of keys) if (k <= today && peekDay(k)) values[k] = scoreFor(k);
    heatmap(heatHost, {
      keys,
      values,
      todayKey: today,
      describe: (k, v, future) => {
        const day = programDay(s.startDate, k);
        if (future) return `${shortDate(k)} · Day ${day} — upcoming`;
        if (v == null) return `${shortDate(k)} · Day ${day} — nothing logged`;
        const missed = checklist(k, peekDay(k)).filter((c) => !c.done).map((c) => c.label.split(' ').slice(0, 2).join(' '));
        return `${shortDate(k)} · Day ${day} — ${v}/5${missed.length ? ` (missed: ${missed.join(', ')})` : ' ✓'}`;
      },
    });
  }

  const waistHost = root.querySelector('#p-waist');
  if (st.waist.length > 1) {
    const nums = st.waist.map((x) => x.inches);
    timeChart(waistHost, {
      keys: st.waist.map((x) => x.date), height: 140, label: 'Waist over time',
      yMin: Math.floor(Math.min(...nums) - 1), yMax: Math.ceil(Math.max(...nums) + 1),
      series: [{ name: 'Waist', kind: 'line', color: 'var(--s3)', values: Object.fromEntries(st.waist.map((x) => [x.date, x.inches])), fmt: (v) => `${v.toFixed(1)} in` }],
    });
  }
}
