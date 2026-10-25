import { MORNING_LOCK_MIN, PHASES, PROGRAM_DAYS, ZERO_DAY, addDays, capSchedule, dailyCap, programDay, tsForDayTime } from '../plan.js';
import { FLAG_TEXT, planFor, programKeysSoFar, rangeKeys, stats, wakeTs } from '../logic.js';
import { timeChart } from '../charts.js';
import { emptyDay, getState, peekDay, todayKey, update, dayRecord } from '../store.js';
import { scheduleOnce } from '../notify.js';
import { clock, esc, icon, plural, toast } from '../ui.js';
import { cardHead } from './parts.js';

const FLAG_SHORT = { morning: 'Morning lock', gap: '< 2 h gap', cap: 'Over cap', nobuffer: 'No buffer' };

function phaseCard(plan) {
  const s = getState().settings;
  const caps = capSchedule(s.baseline);
  // [label, rule, cap, from, to]
  const rows = [
    ['Days 1–14', `Baseline ${caps.baseline} − 2`, caps.stabilize, 1, 14],
    ['Days 15–30', 'Cap down 25%', caps.cut1, 15, 30],
    ['Days 31–60', '50% + 2-hour gaps', caps.cut2, 31, 60],
    ...caps.final.map((f) => [`Days ${f.from}–${f.to}`, 'Final taper step', f.cap, f.from, f.to]),
    [`Days ${ZERO_DAY}–90`, 'Zero · mouth replacements', 0, ZERO_DAY, Infinity],
  ];
  const nowRow = rows.findIndex((r) => plan.day >= r[3] && plan.day <= r[4]);
  const bars = PHASES.map((p) => {
    if (plan.day > p.to) return '<div class="done"></div>';
    if (plan.day >= p.from) return `<div class="now"><span style="width:${((plan.day - p.from + 1) / (p.to - p.from + 1)) * 100}%"></span></div>`;
    return '<div></div>';
  }).join('');
  const labels = PHASES.map((p) => `<span class="${plan.phase.id === p.id ? 'now' : ''}">${p.name}</span>`).join('');
  const dayText = plan.day < 1 ? `Starts in ${plural(1 - plan.day, 'day')}` : plan.day > PROGRAM_DAYS ? 'Program complete' : `Day ${plan.day} of ${PROGRAM_DAYS}`;
  return `<section class="card">
    ${cardHead('90-day taper', 'taper', dayText)}
    <div class="phases">${bars}</div><div class="phase-labels">${labels}</div>
    <p class="small" style="margin-top:12px"><b>${esc(plan.phase.name)}:</b> ${esc(plan.phase.rule)}</p>
    <table class="caps" style="margin-top:10px"><thead><tr><th>Block</th><th>Rule</th><th style="text-align:right">Cap</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${i === nowRow && plan.inProgram ? 'now' : ''}"><td>${r[0]}</td><td>${r[1]}</td><td class="num">${r[2]}</td></tr>`).join('')}
    </tbody></table>
    <p class="tiny muted" style="margin-top:8px">Baseline is set in Settings. Caps step down automatically from your start date.</p>
  </section>`;
}

function rulesCard(key, rec) {
  const plan = planFor(key);
  const wake = wakeTs(key, rec);
  return `<section class="card">
    ${cardHead('The three rules', null)}
    <ul class="plain list-rows">
      <li class="list-row">${icon('lock')}<div class="grow"><b>Morning oxygen window</b><span>No pouch for 90 min after waking — hydrate and move first. Today: wake ${rec.wakeAt ? clock(wake) : `${clock(wake)} (planned)`} → lock until ${clock(wake + MORNING_LOCK_MIN * 60000)}.</span></div></li>
      <li class="list-row">${icon('hourglass')}<div class="grow"><b>Step-down rationing</b><span>Cap ${plan.cap} today${plan.gapRule ? ' · strict 2-hour gap between pouches' : ''}.</span></div></li>
      <li class="list-row">${icon('timer')}<div class="grow"><b>15-minute urge buffer</b><span>Start the timer and drink 200 ml water before any log.</span></div></li>
    </ul>
    <div class="row wrap" style="margin-top:6px">
      <label class="field" style="flex:1;min-width:150px"><span>Woke up at</span><input class="input" type="time" id="wake-at" data-change="wake-at" value="${rec.wakeAt ? clock(rec.wakeAt) : ''}"></label>
      ${rec.wakeAt ? '' : '<button class="btn primary" data-action="wake" style="align-self:end">I\'m awake now</button>'}
    </div>
  </section>`;
}

function logCard(key, rec) {
  const items = rec.pouches.map((p, i) => `<div class="log-item"><span class="when">${clock(p.ts)}</span>
    <span class="flags">${p.flags.length ? p.flags.map((f) => `<span class="badge bad" title="${esc(FLAG_TEXT[f])}">${FLAG_SHORT[f]}</span>`).join('') : '<span class="badge good">Within rules</span>'}</span>
    <button class="del" data-action="pouch-del" data-i="${i}" aria-label="Remove pouch logged at ${clock(p.ts)}">${icon('trash')}</button></div>`).join('');
  return `<section class="card">
    ${cardHead("Today's pouches", null, `${rec.pouches.length} of ${planFor(key).cap} · ${rec.saved} saved`)}
    ${items || '<div class="empty">No pouches logged today.</div>'}
    <div class="btn-row" style="margin-top:10px"><button class="btn primary" data-action="craving-start">${icon('timer')}Start buffer</button><button class="btn" data-action="pouch-log">${icon('plus')}Log pouch</button></div>
  </section>`;
}

function replacementsCard(plan) {
  const emphasis = plan.phase.id === 'final' || plan.phase.id === 'free';
  return `<section class="card">
    ${cardHead('Mouth-replacement triggers', null, emphasis ? 'Your phase' : '')}
    <ul class="bullets">
      <li><b>Elaichi (cardamom)</b> — 1–2 pods, chew slowly.</li>
      <li><b>Roasted saunf (fennel)</b> or <b>dhana dal</b> — a small pinch in place of a pouch.</li>
      <li>Keep a tin in the same pocket where the pouches used to live.</li>
      <li>Pair each urge with 200 ml water + a 2-minute walk.</li>
    </ul>
  </section>`;
}

function alcoholCard(key, rec) {
  const s = getState().settings;
  const plan = planFor(key);
  const last30 = rangeKeys(addDays(key, -29), key);
  const zero = last30.filter((k) => !(peekDay(k)?.drinks)).length;
  let zStreak = 0;
  for (let k = key; zStreak < 365 && !(peekDay(k)?.drinks); k = addDays(k, -1)) zStreak++;
  const days = s.alcoholDays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') || 'none';
  return `<section class="card">
    ${cardHead('Alcohol guardrail', 'taper', plan.isAlcoholDay ? 'Designated day' : '')}
    <div class="grid-3">
      <div><div class="small muted">Today</div><b class="big-num" style="font-size:24px">${rec.drinks}</b><span class="muted small"> / ${s.alcoholMax}</span></div>
      <div><div class="small muted">Water ratio</div><b class="big-num" style="font-size:24px">${rec.drinkWater}:${rec.drinks}</b></div>
      <div><div class="small muted">Zero-day run</div><b class="big-num" style="font-size:24px">${zStreak}</b></div>
    </div>
    <p class="small muted" style="margin-top:8px">Designated days: ${esc(days)} · ${zero} of the last 30 days alcohol-free.</p>
    ${rec.drinks > rec.drinkWater ? '<p class="small" style="margin-top:6px"><span class="badge warn">' + icon('alert') + 'Match every drink with water (1:1)</span></p>' : ''}
    <div class="btn-row" style="margin-top:12px"><button class="btn" data-action="drink-add">+1 drink</button><button class="btn" data-action="drink-water">${icon('drop')}Water</button><button class="btn ghost" data-action="drink-undo">Undo</button></div>
  </section>`;
}

function statsCard() {
  const st = stats();
  const n = st.loggedDays || 1;
  return `<div class="tiles">
    <div class="tile"><div class="label">Pouches saved</div><div class="value">${st.saved}</div></div>
    <div class="tile"><div class="label">Days under cap</div><div class="value">${st.underCap}<small> / ${st.loggedDays}</small></div></div>
    <div class="tile"><div class="label">Morning lock kept</div><div class="value">${Math.round((st.lockKept / n) * 100)}<small>%</small></div></div>
  </div>`;
}

export function taperChart(host) {
  const s = getState().settings;
  const keys = rangeKeys(s.startDate, addDays(s.startDate, PROGRAM_DAYS - 1));
  const today = todayKey();
  const cap = {};
  const used = {};
  for (const k of keys) {
    cap[k] = dailyCap(s.baseline, programDay(s.startDate, k));
    const d = peekDay(k);
    if (d && k <= today) used[k] = d.pouches.length;
  }
  timeChart(host, {
    keys,
    label: 'Daily pouches against the 90-day cap',
    xLabel: (k, long) => (long ? `Day ${programDay(s.startDate, k)} · ${k.slice(5).replace('-', '/')}` : `D${programDay(s.startDate, k)}`),
    yTick: (v) => String(v),
    endLabel: false,
    integer: true,
    series: [
      { name: 'Pouches', kind: 'column', color: 'var(--s1)', values: used, colorFor: (v, k) => (v > cap[k] ? 'var(--bad)' : 'var(--s1)'), fmt: (v) => String(v) },
      { name: 'Daily cap', kind: 'step', color: 'var(--ink-3)', values: cap, fmt: (v) => String(v) },
    ],
    tipExtra: (k, tip) => {
      if (used[k] > cap[k]) {
        const row = document.createElement('div');
        row.className = 't-row';
        row.textContent = `⚠ Over cap by ${used[k] - cap[k]}`;
        tip.append(row);
      }
    },
  });
}

export function render() {
  const key = todayKey();
  const rec = peekDay(key) || emptyDay();
  const plan = planFor(key);
  return `<div class="stack">
    ${phaseCard(plan)}
    <section class="card">${cardHead('Pouches vs cap', 'taper', programKeysSoFar().length ? '' : 'Starts on day 1')}
      <div class="legend"><span><i style="background:var(--s1)"></i>Pouches</span><span><i style="background:var(--bad)"></i>Over cap</span><span><i class="line" style="background:var(--ink-3)"></i>Daily cap</span></div>
      <div id="taper-chart"></div></section>
    ${logCard(key, rec)}
    ${rulesCard(key, rec)}
    ${statsCard()}
    ${replacementsCard(plan)}
    ${alcoholCard(key, rec)}
  </div>`;
}

export function mount(root) {
  const host = root.querySelector('#taper-chart');
  if (host) {
    taperChart(host);
    host.querySelector('.legend')?.remove(); // custom legend above covers the over-cap colour too
  }
}

export const changes = {
  'wake-at': (el) => {
    if (!el.value) return;
    const ts = tsForDayTime(todayKey(), el.value);
    update(() => { dayRecord(todayKey()).wakeAt = ts; });
    if (ts + MORNING_LOCK_MIN * 60000 > Date.now()) scheduleOnce('lockEnd', ts + MORNING_LOCK_MIN * 60000);
    toast(`Wake time set to ${el.value}`);
  },
};
