import { MORNING_LOCK_MIN, PHASES, PROGRAM_DAYS, ZERO_DAY, addDays, capSchedule, dailyCap, programDay, tsForDayTime } from '../plan.js';
import { FLAG_TEXT, planFor, programKeysSoFar, rangeKeys, stats, wakeTs } from '../logic.js';
import { timeChart } from '../charts.js';
import { emptyDay, getState, peekDay, todayKey, update, dayRecord } from '../store.js';
import { scheduleOnce } from '../notify.js';
import { clock, esc, icon, plural, toast } from '../ui.js';
import { bufferCard, cardHead } from './parts.js';
import { SOS, WITHDRAWAL, fmtGap, lastPouchEver, nextWindow, taperProgress, triggerById, triggerStats, withdrawalFor } from '../taper.js';

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
  const plan = planFor(key);
  const w = nextWindow(key, rec, Date.now());
  const pacing = w.reason === 'cap' ? 'Cap reached. Every urge gets the buffer.'
    : w.reason === 'bedtime' ? `Done for today. Last call was ${clock(w.lastCall)}.`
      : w.remaining === 1
        ? `Pacing plan: 1 pouch left. It fits ${w.next === w.lastCall ? `at ${clock(w.next)}, your last call` : `from ${clock(w.next)} until last call at ${clock(w.lastCall)}`}.`
        : `Pacing plan: ${plural(w.remaining, 'pouch', 'pouches')} left, at most one every ${fmtGap(w.spacingMin)}, last call ${clock(w.lastCall)}. Next fits at ${clock(w.next)}.`;
  const items = rec.pouches.map((p, i) => {
    const t = triggerById(p.trigger);
    return `<div class="log-item"><span class="when">${clock(p.ts)}</span>
    <span class="flags">${t ? `<span class="badge">${t.emoji} ${esc(t.label)}</span>` : ''}${p.flags.length ? p.flags.map((f) => `<span class="badge bad" title="${esc(FLAG_TEXT[f])}">${FLAG_SHORT[f]}</span>`).join('') : '<span class="badge good">Within rules</span>'}</span>
    <button class="del" data-action="pouch-del" data-i="${i}" aria-label="Remove pouch logged at ${clock(p.ts)}">${icon('trash')}</button></div>`;
  }).join('');
  return `<section class="card">
    ${cardHead("Today's plan", 'taper', `${rec.pouches.length} of ${plan.cap} · ${rec.saved} beaten`)}
    <div class="note" style="margin-bottom:10px">⏳ ${esc(pacing)}</div>
    ${items || '<div class="empty">No pouches logged today. 🌱</div>'}
    <div class="btn-row" style="margin-top:10px"><button class="btn primary" data-action="craving-start">😮‍💨 I have an urge</button><button class="btn" data-action="pouch-log">${icon('plus')}Log pouch</button></div>
  </section>`;
}

const fmt1 = (v) => String(Math.round(v * 10) / 10);

function alcoholCard(key, rec) {
  const s = getState().settings;
  const plan = planFor(key);
  const last30 = rangeKeys(addDays(key, -29), key);
  const zero = last30.filter((k) => !(peekDay(k)?.drinks)).length;
  let zStreak = 0;
  for (let k = key; k >= s.startDate && !(peekDay(k)?.drinks); k = addDays(k, -1)) zStreak++;
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

function progressCard(plan) {
  const st = stats();
  const p = taperProgress();
  const s = getState().settings;
  const n = st.loggedDays || 1;
  const last = lastPouchEver();
  const zeroIn = ZERO_DAY - plan.day;
  const pct = (v) => `${Math.round(Math.abs(v) * 100)}%`;
  return `<section class="card goal-card">
    ${cardHead('Your taper so far', 'taper', plan.day >= 1 ? `Day ${Math.min(plan.day, PROGRAM_DAYS)}` : '')}
    <div class="tiles">
      <div class="tile"><div class="label">Avg / day (7 days)</div><div class="value">${p.weekAvg == null ? '—' : fmt1(p.weekAvg)}</div>
        <div class="delta ${p.weekChange != null && p.weekChange <= 0 ? 'good' : p.weekChange > 0 ? 'bad' : ''}">${p.weekChange == null ? `was ${s.baseline}/day` : `${p.weekChange <= 0 ? '▼' : '▲'} ${pct(p.weekChange)} vs last week`}</div></div>
      <div class="tile"><div class="label">Below your old ${s.baseline}/day</div><div class="value">${p.reduction == null ? '—' : `${Math.round(p.reduction * 100)}<small>%</small>`}</div></div>
      <div class="tile"><div class="label">Under-cap streak</div><div class="value">${p.capStreak}<small> days</small></div></div>
      <div class="tile"><div class="label">Pouch-free for</div><div class="value" style="font-size:22px">${last ? `<span data-since="${last}"></span>` : '—'}</div></div>
      <div class="tile"><div class="label">Urges beaten</div><div class="value">${st.saved}</div></div>
      <div class="tile"><div class="label">Morning lock kept</div><div class="value">${Math.round((st.lockKept / n) * 100)}<small>%</small></div></div>
    </div>
    <p class="small" style="margin-top:12px">${plan.day < 1 ? 'Your plan starts soon.' : zeroIn > 0 ? `🕊️ <b>${plural(zeroIn, 'day')}</b> to your pouch-free day (day ${ZERO_DAY}).` : '🕊️ You are in the pouch-free zone. Protect it.'}</p>
  </section>`;
}

function triggersCard() {
  const { total, list } = triggerStats(14);
  if (!total) {
    return `<section class="card">${cardHead('Your triggers', 'taper', 'Last 14 days')}
      <div class="empty">Tag what set off each urge, in the urge buffer or when you log a pouch. Your top triggers and a plan for each show up here.</div></section>`;
  }
  const max = list[0].total;
  const top = list[0];
  return `<section class="card">
    ${cardHead('Your triggers', 'taper', 'Last 14 days')}
    <div class="trigger-bars">${list.map((t) => `<div class="tb"><span class="e" aria-hidden="true">${t.emoji}</span>
      <div><b class="small">${esc(t.label)}</b><div class="bar"><span class="p" style="width:${(t.pouches / max) * 100}%"></span><span class="b" style="width:${(t.beaten / max) * 100}%"></span></div></div>
      <span class="n">${t.pouches} 🌿 · ${t.beaten} 💪</span></div>`).join('')}</div>
    <div class="legend" style="margin-top:10px"><span><i style="background:var(--s1)"></i>🌿 pouches taken</span><span><i style="background:var(--good)"></i>💪 urges beaten</span></div>
    <div class="note" style="margin-top:12px"><b>${top.emoji} Plan for your #1 trigger (${Math.round(top.share * 100)}%):</b> ${esc(top.tip)}</div>
  </section>`;
}

function sosCard(plan) {
  const emphasis = plan.phase.id === 'final' || plan.phase.id === 'free';
  return `<section class="card">
    ${cardHead('Urge SOS toolkit', 'taper', emphasis ? 'Your phase' : '')}
    <div class="sos">${SOS.map((x) => `<div><span aria-hidden="true">${x.emoji}</span>${esc(x.text)}</div>`).join('')}</div>
    <p class="small muted" style="margin-top:10px">Keep a tin of elaichi, roasted saunf or dhana dal in the pocket where the pouches used to live.</p>
    <button class="btn primary block" style="margin-top:12px" data-action="craving-start">😮‍💨 Start the 15-min buffer</button>
  </section>`;
}

function expectCard(plan) {
  const now = withdrawalFor(Math.max(1, plan.day));
  return `<section class="card">
    ${cardHead('What to expect', 'taper')}
    <div class="timeline-list">${WITHDRAWAL.map((w) => `<div class="tl ${w === now ? 'now' : ''}"><b>${w === now ? '📍 ' : ''}${esc(w.title)}</b><span>${esc(w.text)}</span></div>`).join('')}</div>
    <p class="tiny muted" style="margin-top:8px">General guidance. If withdrawal feels severe, or you notice chest pain or a racing heart, see a doctor.</p>
  </section>`;
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
    ${progressCard(plan)}
    ${bufferCard(Date.now())}
    ${logCard(key, rec)}
    ${triggersCard()}
    ${phaseCard(plan)}
    <section class="card">${cardHead('Pouches vs cap', 'taper', programKeysSoFar().length ? '' : 'Starts on day 1')}
      <div class="legend"><span><i style="background:var(--s1)"></i>Pouches</span><span><i style="background:var(--bad)"></i>Over cap</span><span><i class="line" style="background:var(--ink-3)"></i>Daily cap</span></div>
      <div id="taper-chart"></div></section>
    ${sosCard(plan)}
    ${expectCard(plan)}
    ${rulesCard(key, rec)}
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
