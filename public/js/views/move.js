import { CIRCUIT_ROUND, MICRO_SET, WALK_PHASES, distanceTarget, paceText, walkSegments } from '../plan.js';
import { planFor, stats } from '../logic.js';
import { timeChart } from '../charts.js';
import { emptyDay, getState, peekDay, todayKey, update } from '../store.js';
import { esc, icon, shortDate, toast } from '../ui.js';
import { cardHead, microProgress, walkPhaseLine, walkSummary } from './parts.js';

const ENERGY = ['', 'Drained', 'Low', 'OK', 'Good', 'Strong'];

function walkCard(plan) {
  const st = stats();
  const p = WALK_PHASES[plan.walkMode];
  const target = plan.walkMode === '4:1' ? null : distanceTarget(st.walks);
  const segs = walkSegments(plan.walkMode);
  const structure = plan.walkMode === 'continuous'
    ? 'Continuous high-tempo brisk walk/run for the full 30:00.'
    : `${segs[0].min} min ${segs[0].label.toLowerCase()} + ${segs[1].min} min ${segs[1].label.toLowerCase()} × 6 rounds.`;
  return `<section class="card">
    ${cardHead('30-minute mileage', 'move', p.weeks)}
    <p><b>${esc(p.name)}</b></p>
    <p class="small muted" style="margin-top:2px">${esc(structure)} ${esc(p.note)}</p>
    <div class="tiles" style="margin-top:12px">
      <div class="tile"><div class="label">Best 30-min distance</div><div class="value">${st.bestWalk ? `${st.bestWalk.distanceKm.toFixed(2)}<small> km</small>` : '—'}</div></div>
      <div class="tile"><div class="label">${target ? 'Next block target' : 'This phase'}</div><div class="value">${target ? `${target.low.toFixed(2)}–${target.high.toFixed(2)}<small> km</small>` : '<small>Hold 30:00</small>'}</div></div>
      <div class="tile"><div class="label">Sessions logged</div><div class="value">${st.walks.length}</div></div>
    </div>
    <button class="btn primary block" style="margin-top:12px" data-action="walk-start" data-mode="${plan.walkMode}">${icon('play')}Start 30-min interval timer</button>
  </section>`;
}

function logForm(plan) {
  const draft = getState().walkDraft || {};
  const mode = draft.mode || plan.walkMode;
  const dur = draft.durationMin || 30;
  return `<section class="card" id="walk-log">
    ${cardHead('Log a session', 'move')}
    <form class="form-grid" data-submit="walk-save">
      <label class="field"><span>Distance (km)</span><input class="input" id="w-dist" name="distance" type="number" inputmode="decimal" step="0.01" min="0.1" max="20" required placeholder="e.g. 2.85"></label>
      <label class="field"><span>Duration (min)</span><input class="input" id="w-dur" name="duration" type="number" inputmode="numeric" min="1" max="120" value="${dur}" required></label>
      <label class="field"><span>Mode</span><select class="input" name="mode">
        ${['4:1', '3:2', 'continuous'].map((m) => `<option value="${m}" ${m === mode ? 'selected' : ''}>${m === 'continuous' ? 'Continuous' : `${m} intervals`}</option>`).join('')}
      </select></label>
      <label class="field"><span>Date</span><input class="input" name="date" type="date" value="${todayKey()}" max="${todayKey()}" required></label>
      <div class="field full"><span>Energy (RPE feel)</span><div class="seg" role="group" aria-label="Energy rating">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-action="energy" data-n="${n}" aria-pressed="${n === 3}">${n}</button>`).join('')}
      </div><small id="energy-label">3 · ${ENERGY[3]}</small><input type="hidden" name="energy" value="3"></div>
      <div class="full row"><span class="small muted">Pace: <b id="w-pace">—</b></span><span class="spacer"></span><button class="btn primary" type="submit">Save session</button></div>
    </form>
  </section>`;
}

function historyCard() {
  const walks = stats().walks.slice(-8).reverse();
  return `<section class="card">
    ${cardHead('Recent sessions', 'move')}
    ${walks.length ? walks.map((w) => `<div class="log-item"><span class="when" style="width:64px">${shortDate(w.date)}</span>
      <span class="flags"><span>${esc(walkSummary(w))}</span><span class="badge">${w.mode === 'continuous' ? 'Cont.' : w.mode}</span><span class="badge">E${w.energy}</span></span>
      <button class="del" data-action="walk-del" data-id="${esc(w.id)}" aria-label="Delete session">${icon('trash')}</button></div>`).join('') : '<div class="empty">No sessions yet — start the timer above.</div>'}
    <div id="walk-chart" style="margin-top:12px"></div>
  </section>`;
}

function counter(name, field, value, target, steps) {
  return `<div class="counter"><div class="top"><span class="name">${name}</span><span class="val">${value}</span></div>
    <div class="target">${target}</div>
    <div class="btns">${steps.map((n) => `<button class="chip-btn" data-action="rep-add" data-field="${field}" data-n="${n}">+${n}</button>`).join('')}
    <button class="chip-btn" data-action="rep-add" data-field="${field}" data-n="-${steps[0]}" aria-label="Remove ${steps[0]} ${name}">−</button></div></div>`;
}

function holdCounter(kind, label, list, target, quick) {
  const hold = getState().hold;
  const live = hold && hold.kind === kind;
  const best = list.length ? Math.max(...list) : 0;
  return `<div class="counter"><div class="top"><span class="name">${label}</span><span class="val">${best ? `${best}s` : '—'}</span></div>
    <div class="target">${target} · best hold today</div>
    ${live ? `<div class="hold-live" data-since-sec="${hold.startedAt}">0s</div>
      <div class="btns"><button class="btn good" data-action="hold-stop">${icon('stop')}Stop & log</button><button class="btn ghost" data-action="hold-cancel">Cancel</button></div>`
    : `<div class="btns"><button class="chip-btn" data-action="hold-start" data-kind="${kind}" ${hold ? 'disabled' : ''} aria-label="Start ${label.toLowerCase()} stopwatch">${icon('timer', 'inline')} Start</button>
      ${quick.map((s) => `<button class="chip-btn" data-action="hold-add" data-kind="${kind}" data-sec="${s}">+${s}s</button>`).join('')}</div>`}
    ${list.length ? `<div class="chips">${list.map((s, i) => `<span class="chip">${s}s<button data-action="hold-del" data-kind="${kind}" data-i="${i}" aria-label="Remove ${s} second hold">${icon('x')}</button></span>`).join('')}</div>` : ''}
  </div>`;
}

function strengthCard(rec) {
  return `<section class="card">
    ${cardHead('Calisthenics & core', 'strength', 'Today')}
    <div class="note" style="margin-bottom:12px"><b>Morning ignition</b> (before your shower): ${MICRO_SET.pushups}–15 push-ups (stop 2–3 shy of failure) · ${MICRO_SET.squats}–20 squats · ${MICRO_SET.plankSec}–45 s plank, glutes tight.</div>
    ${microProgress(rec)}
    <div class="counters" style="margin-top:12px">
      ${counter('Push-ups', 'pushups', rec.reps.pushups, 'Micro 10–15 · circuit 12–20', [5, 10, 15])}
      ${counter('Squats / lunges', 'squats', rec.reps.squats, 'Micro 15–20 · circuit 20', [10, 15, 20])}
      ${counter('Pull-ups', 'pullups', rec.reps.pullups, 'Max clean reps', [1, 3, 5])}
      ${counter('Dead bugs / leg raises', 'core', rec.reps.core, '12 controlled reps', [6, 12])}
      ${holdCounter('plank', 'Plank', rec.planks, 'Micro 30–45 s · circuit 45–60 s', [30, 45, 60])}
      ${holdCounter('hang', 'Dead hang', rec.hangs, '30–45 s', [15, 30, 45])}
    </div>
  </section>`;
}

function circuitCard(plan, rec) {
  const days = getState().settings.circuitDays.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(' / ') || 'none set';
  const pct = Math.min(100, (rec.rounds / plan.rounds) * 100);
  return `<section class="card">
    ${cardHead('Structured circuit', 'strength', plan.isCircuitDay ? 'Today' : days)}
    <ul class="bullets">
      <li>Push-ups 12–20</li><li>Squats or reverse lunges 20</li><li>Pull-ups (max clean) or 30–45 s dead hang</li><li>45–60 s plank + 12 dead bugs / leg raises</li>
    </ul>
    <div class="row" style="margin-top:12px"><span class="big-num">${rec.rounds}<small> / ${plan.rounds} rounds</small></span></div>
    <div class="meter ${pct >= 100 ? 'good' : ''}" style="margin:8px 0 12px"><span style="width:${pct}%"></span></div>
    <div class="btn-row"><button class="btn primary" data-action="round-done">${icon('check')}Round done</button><button class="btn ghost" data-action="round-undo" ${rec.rounds ? '' : 'disabled'}>Undo round</button></div>
    <p class="tiny muted" style="margin-top:8px">“Round done” adds ${CIRCUIT_ROUND.pushups} push-ups, ${CIRCUIT_ROUND.squats} squats, ${CIRCUIT_ROUND.hangSec}s hang, ${CIRCUIT_ROUND.plankSec}s plank and ${CIRCUIT_ROUND.core} core reps — adjust above if you did more.</p>
  </section>`;
}

function waistCard() {
  const st = stats();
  const first = st.waistFirst;
  const last = st.waistLast;
  const change = first && last && first !== last ? last.inches - first.inches : null;
  return `<section class="card">
    ${cardHead('Waist', 'strength', planFor().isWaistDay ? 'Log today' : 'Weekly')}
    <div class="row wrap" style="align-items:flex-end">
      <div><div class="small muted">Latest</div><span class="big-num">${last ? `${last.inches.toFixed(1)}<small> in</small>` : '—'}</span>
      ${change != null ? `<div class="small" style="color:${change <= 0 ? 'var(--good-ink)' : 'var(--bad-ink)'};font-weight:600">${change <= 0 ? '▼' : '▲'} ${Math.abs(change).toFixed(1)} in since ${shortDate(first.date)}</div>` : ''}</div>
      <span class="spacer"></span>
      <form class="row" data-submit="waist-save"><input class="input" style="width:110px" name="inches" type="number" inputmode="decimal" step="0.1" min="15" max="80" placeholder="inches" required aria-label="Waist in inches"><button class="btn primary" type="submit">Save</button></form>
    </div>
    <p class="tiny muted" style="margin-top:8px">Measure at the navel, standing, after a relaxed exhale. Same time each week.</p>
    <div id="waist-chart" style="margin-top:12px"></div>
  </section>`;
}

export function render() {
  const key = todayKey();
  const rec = peekDay(key) || emptyDay();
  const plan = planFor(key);
  return `<div class="stack">
    <p class="small muted">${esc(walkPhaseLine(plan.walkMode))}</p>
    ${walkCard(plan)}
    ${logForm(plan)}
    ${historyCard()}
    ${plan.isCircuitDay ? circuitCard(plan, rec) + strengthCard(rec) : strengthCard(rec) + circuitCard(plan, rec)}
    ${waistCard()}
  </div>`;
}

export function mount(root) {
  const st = stats();
  const w = root.querySelector('#walk-chart');
  if (w && st.walks.length) {
    const byDate = {};
    for (const x of st.walks) byDate[x.date] = Math.max(byDate[x.date] || 0, x.distanceKm);
    timeChart(w, {
      keys: Object.keys(byDate).sort(),
      label: '30-minute session distance over time',
      height: 150,
      yMaxMin: 1,
      yTick: (v) => `${v}`,
      series: [{ name: 'Distance (km)', kind: 'line', color: 'var(--s2)', values: byDate, fmt: (v) => `${v.toFixed(2)} km` }],
    });
  }
  const wc = root.querySelector('#waist-chart');
  if (wc && st.waist.length > 1) {
    const vals = Object.fromEntries(st.waist.map((x) => [x.date, x.inches]));
    const nums = st.waist.map((x) => x.inches);
    timeChart(wc, {
      keys: st.waist.map((x) => x.date),
      label: 'Waist circumference over time',
      height: 140,
      yMin: Math.floor(Math.min(...nums) - 1),
      yMax: Math.ceil(Math.max(...nums) + 1),
      series: [{ name: 'Waist (in)', kind: 'line', color: 'var(--s3)', values: vals, fmt: (v) => `${v.toFixed(1)} in` }],
    });
  }
  // Live pace preview on the walk form.
  const dist = root.querySelector('#w-dist');
  const dur = root.querySelector('#w-dur');
  const pace = root.querySelector('#w-pace');
  const upd = () => { pace.textContent = paceText(Number(dur.value), Number(dist.value)); };
  dist?.addEventListener('input', upd);
  dur?.addEventListener('input', upd);
  if (getState().walkDraft && location.hash === '#move') {
    root.querySelector('#walk-log')?.scrollIntoView({ block: 'center' });
    dist?.focus({ preventScroll: true });
  }
}

export const moveActions = {
  energy: (el) => {
    const form = el.closest('form');
    form.querySelectorAll('[data-action="energy"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    form.elements.energy.value = el.dataset.n;
    form.querySelector('#energy-label').textContent = `${el.dataset.n} · ${ENERGY[el.dataset.n]}`;
  },
};

export const submits = {
  'walk-save': (form) => {
    const f = form.elements;
    const distanceKm = Math.round(Number(f.distance.value) * 100) / 100;
    const durationMin = Math.round(Number(f.duration.value));
    if (!(distanceKm > 0) || !(durationMin > 0)) return;
    const walk = {
      id: `w${Date.now().toString(36)}`,
      date: f.date.value || todayKey(),
      durationMin,
      distanceKm,
      mode: f.mode.value,
      energy: Number(f.energy.value) || 3,
      ts: Date.now(),
    };
    const prevBest = stats().bestWalk?.distanceKm || 0;
    update((s) => {
      s.walks.push(walk);
      s.walkDraft = null;
    });
    toast(distanceKm > prevBest && prevBest ? `New personal best: ${distanceKm.toFixed(2)} km 🏆` : `Saved · ${paceText(durationMin, distanceKm)}`);
  },
  'waist-save': (form) => {
    const inches = Math.round(Number(form.elements.inches.value) * 10) / 10;
    if (!(inches > 0)) return;
    const date = todayKey();
    update((s) => {
      s.waist = s.waist.filter((w) => w.date !== date);
      s.waist.push({ date, inches });
    });
    toast(`Waist logged · ${inches.toFixed(1)} in`);
  },
};
