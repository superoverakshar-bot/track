import { ZERO_DAY, addDays, capSteps, dayKeyAt } from '../plan.js';
import { FOCUS_AREAS, KEGEL_SETS, STAMINA_CHOICES, avoidedPouches, coach, cravingHours, fmtDur } from '../coach.js';
import { timeChart } from '../charts.js';
import { AUTO_RUNS_PER_DAY, isBusy, runCoach, setOn, statusText, undoChange } from '../autopilot.js';
import { TUNABLE, formatTunable } from '../reminders.js';
import { getConfig, mode as notifyMode } from '../notify.js';
import { dayRecord, emptyDay, getState, peekDay, todayKey, update } from '../store.js';
import { esc, icon, longDate, shortDate, toast } from '../ui.js';
import { PILLAR_EMOJI, celebrate } from '../joy.js';
import { cardHead } from './parts.js';

const PILLAR_TINT = { taper: 'taper', move: 'move', strength: 'strength', fuel: 'fuel', vitality: 'strength', sleep: 'move', focus: 'move', energy: 'fuel' };
const LEVELS = ['', 'Very low', 'Low', 'OK', 'Good', 'Great'];

// "google/gemini-3.8-flash" → "Gemini 3.8 Flash", "openai/gpt-6-sol" → "GPT-6 Sol"
export function modelName(id) {
  if (!id) return 'AI';
  const words = id.split('/').pop().split(':')[0].split('-');
  if (words[0].toLowerCase() === 'gpt' && words.length > 1) words.splice(0, 2, `GPT-${words[1]}`);
  return words.map((w) => (/^(\d|GPT-)/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

const clockOf = (ts) => new Date(ts).toTimeString().slice(0, 5);

export function changeRow(c, { compact = false } = {}) {
  const what = `${esc(c.label)} ${esc(String(formatTunable(c.target, c.from)))} → <b>${esc(String(formatTunable(c.target, c.to)))}</b>`;
  const undo = c.undone ? '<span class="badge">Undone</span>' : `<button class="btn sm ghost" data-action="ap-undo" data-id="${esc(c.id)}">Undo</button>`;
  return `<li class="${c.undone ? 'undone' : ''}"><div><span>${what}</span>${compact ? '' : `<span class="small muted">${esc(c.reason)}</span><span class="tiny muted">${shortDate(dayKeyAt(c.at))} ${clockOf(c.at)} · ${c.auto ? 'autopilot' : 'when you asked'}</span>`}</div>${undo}</li>`;
}

function actionButton(a, cls = 'btn sm') {
  if (!a) return '';
  const data = Object.entries(a.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<button class="${cls}" data-action="${a.action}" ${data}>${esc(a.label)}</button>`;
}

function dismissed() {
  const d = getState().dismissed;
  return d?.day === todayKey() ? new Set(d.ids) : new Set();
}

export function visibleSuggestions(res) {
  const hidden = dismissed();
  return res.suggestions.filter((x) => !hidden.has(x.id));
}

export function suggestionRow(x, { dismissable = false } = {}) {
  return `<div class="tip">
    <span class="bubble ${PILLAR_TINT[x.pillar] || 'spark'}" aria-hidden="true">${PILLAR_EMOJI[x.pillar] || '✨'}</span>
    <div class="grow"><b>${esc(x.title)}</b><span>${esc(x.body)}</span>
      ${x.action ? `<div style="margin-top:8px">${actionButton(x.action)}</div>` : ''}</div>
    ${dismissable ? `<button class="del" data-action="dismiss" data-id="${esc(x.id)}" aria-label="Hide for today">${icon('x')}</button>` : ''}
  </div>`;
}

function goalCard(res) {
  const s = getState().settings;
  const plan = res.plan;
  const steps = capSteps(s.baseline);
  const zero = addDays(s.startDate, ZERO_DAY - 1);
  const cur = plan.day < 1 ? -1 : steps.indexOf(plan.cap);
  return `<section class="card goal-card">
    ${cardHead('Your goal: quit Tansen', 'taper', plan.day >= 1 ? `Day ${Math.min(plan.day, 90)}/90` : '')}
    <div class="row" style="align-items:baseline;gap:14px"><span class="hero-figure">${s.baseline} → 0</span><span class="muted small">pouches / day</span></div>
    <p class="small muted" style="margin-top:6px">Pouch-free from <b>${esc(longDate(zero))}</b> (day ${ZERO_DAY}). Today's cap: <b>${plan.cap}</b>.</p>
    <div class="steps" aria-label="Cap steps">${steps.map((c, i) => `<span class="${i === cur ? 'now' : i < cur ? 'done' : ''}">${c}</span>`).join('')}</div>
    <div class="tiles" style="margin-top:12px">
      <div class="tile"><div class="label">Pouches avoided</div><div class="value">${avoidedPouches()}</div><div class="delta">vs ${s.baseline}/day</div></div>
      <div class="tile"><div class="label">Urges beaten</div><div class="value">${Object.values(getState().days).reduce((a, d) => a + d.saved, 0)}</div></div>
    </div>
    ${res.wins.length ? `<div class="chips" style="margin-top:12px">${res.wins.map((w) => `<span class="chip win">${icon('check', 'inline')} ${esc(w)}</span>`).join('')}</div>` : ''}
  </section>`;
}

function scale(field, value, label) {
  return `<div class="field"><span>${label}</span><div class="seg" role="group" aria-label="${label}">
    ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-action="checkin" data-field="${field}" data-v="${n}" aria-pressed="${value === n}" title="${LEVELS[n]}">${n}</button>`).join('')}
  </div><small>${value ? `${value} · ${LEVELS[value]}` : '1 = very low · 5 = great'}</small></div>`;
}

export function checkinCard(rec) {
  const c = rec.checkin || {};
  return `<section class="card" id="checkin">
    ${cardHead("Today's check-in", null, c.energy && c.focus && c.sleepHrs ? '<span class="badge good">Done</span>' : '10 sec')}
    <div class="stack" style="gap:12px">
      ${scale('energy', c.energy, 'Energy')}
      ${scale('focus', c.focus, 'Memory & focus')}
      <div class="field"><span>Sleep last night</span><div class="seg" role="group" aria-label="Hours of sleep">
        ${[5, 6, 7, 8, 9].map((h) => `<button type="button" data-action="checkin" data-field="sleepHrs" data-v="${h}" aria-pressed="${c.sleepHrs === h}">${h === 5 ? '≤5' : h === 9 ? '9+' : h} h</button>`).join('')}
      </div></div>
    </div>
  </section>`;
}

function suggestionsCard(res) {
  const list = visibleSuggestions(res).filter((x) => !x.private);
  const top = list.slice(0, 5);
  const rest = list.slice(5);
  return `<section class="card">
    ${cardHead('Do this next', null, `${list.length} for you`)}
    ${top.length ? `<div class="tips">${top.map((x) => suggestionRow(x, { dismissable: true })).join('')}</div>` : '<div class="empty">All caught up. Nice work.</div>'}
    ${rest.length ? `<details class="more"><summary>${rest.length} more</summary><div class="tips">${rest.map((x) => suggestionRow(x, { dismissable: true })).join('')}</div></details>` : ''}
  </section>`;
}

function patternsCard(res) {
  const pats = res.patterns.filter((p) => !p.private);
  const hist = cravingHours(14);
  const total = hist.reduce((a, b) => a + b, 0);
  return `<section class="card">
    ${cardHead('What your data says', null, 'Last 14 days')}
    ${pats.length ? `<ul class="plain insights">${pats.map((p) => `<li>${icon('chart', 'inline')}<span>${esc(p.text)}</span></li>`).join('')}</ul>`
      : '<div class="empty">Keep logging. Patterns appear after about 5 days of pouches, check-ins and walks.</div>'}
    ${total >= 5 ? `<h3 class="small" style="margin:14px 0 4px">When pouches happen (by hour)</h3><div id="crave-chart"></div>` : ''}
  </section>`;
}

function focusCard(s) {
  return `<section class="card">
    ${cardHead('What do you want help with?', null)}
    <div class="chips">${FOCUS_AREAS.map((f) => `<button class="chip-btn ${s.focusAreas.includes(f.id) ? 'on' : ''}" data-action="focus-toggle" data-id="${f.id}" aria-pressed="${s.focusAreas.includes(f.id)}">${esc(f.label)}</button>`).join('')}</div>
    <p class="tiny muted" style="margin-top:8px">The coach ranks suggestions by what you pick.</p>
  </section>`;
}

function vitalityCard(rec, res) {
  const st = getState();
  const logs = st.vitality.slice().sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  const pats = res.patterns.filter((p) => p.private);
  const sets = rec.kegels || 0;
  return `<section class="card" id="vitality">
    ${cardHead('Bedroom stamina', 'strength', '<span class="badge">Private</span>')}
    <div class="row"><div class="grow"><div class="small muted">Pelvic-floor sets today</div><span class="big-num">${sets}<small> / ${KEGEL_SETS}</small></span></div>
      <button class="btn primary" data-action="kegel-add">${icon('plus')}Set done</button></div>
    <div class="meter ${sets >= KEGEL_SETS ? 'good' : ''}" style="margin:10px 0 4px"><span style="width:${Math.min(100, (sets / KEGEL_SETS) * 100)}%"></span></div>
    <p class="tiny muted">Each set: 10 slow squeezes (hold 3 s, relax 3 s), then 10 quick ones. It's the muscle you'd use to stop urinating midstream, but don't practise on the toilet.</p>
    <hr class="divider">
    <div class="small" style="font-weight:600;margin-bottom:8px">Log how long you lasted</div>
    <div class="chips">${STAMINA_CHOICES.map((c) => `<button class="chip-btn" data-action="stamina-log" data-sec="${c.sec}">${c.label}</button>`).join('')}</div>
    ${logs.length ? `<div class="chips" style="margin-top:10px">${logs.slice(-6).reverse().map((v) => `<span class="chip">${esc(shortDate(v.date))} · ${fmtDur(v.sec)}<button data-action="stamina-del" data-ts="${v.ts}" aria-label="Delete log">${icon('x')}</button></span>`).join('')}</div>` : ''}
    ${logs.length >= 3 ? '<div id="stamina-chart" style="margin-top:12px"></div>' : ''}
    ${pats.length ? `<ul class="plain insights" style="margin-top:12px">${pats.map((p) => `<li>${icon('chart', 'inline')}<span>${esc(p.text)}</span></li>`).join('')}</ul>` : ''}
    <details class="more" style="margin-top:12px"><summary>What helps (evidence-based)</summary>
      <ul class="bullets">
        <li><b>Daily pelvic-floor training</b>, ${KEGEL_SETS} sets a day for 12 weeks. In clinical studies it helped many men with early ejaculation gain real control.</li>
        <li><b>Stop-start practice</b> (solo first): stop at about 7/10 arousal, breathe slowly until it settles, then restart. Repeat 3–4 times per session.</li>
        <li><b>Slow exhale and a relaxed pelvic floor</b> during intimacy. Tension speeds things up; long breaths out slow them down.</li>
        <li><b>The taper itself helps.</b> Nicotine and areca narrow blood vessels; alcohol and short sleep weaken control.</li>
        <li><b>It's common and treatable.</b> If you're still under about a minute after 6 weeks, see a urologist or sexual-health doctor. Safe, proven treatments exist.</li>
      </ul>
    </details>
    <p class="tiny muted" style="margin-top:8px">Stays on this device. Never shown on the Today screen or in notifications.</p>
  </section>`;
}

function reviewLine(r) {
  const rv = r.review;
  if (!rv) return '';
  if (rv.error) return `<p class="tiny muted" style="margin-top:8px">🔎 ${esc(rv.error)}</p>`;
  const rej = rv.rejected || [];
  const parts = [`${rv.confirmed} confirmed`, rv.adjusted ? `${rv.adjusted} adjusted` : '', rej.length ? `${rej.length} rejected` : ''].filter(Boolean).join(', ');
  return `<details class="review"><summary class="tiny muted">🔎 Double-checked by ${esc(modelName(rv.model))}: ${esc(parts)}</summary>
    ${rej.length ? `<ul class="bullets tiny">${rej.map((x) => `<li><b>${esc(TUNABLE[x.target]?.label || x.target)} → ${esc(String(x.value))}</b> not applied: ${esc(x.reason)}</li>`).join('')}</ul>` : ''}</details>`;
}

function aiCard() {
  const st = getState();
  const cfg = getConfig() || {};
  const ai = st.ai;
  const ap = st.autopilot;
  const stamina = st.settings.focusAreas.includes('stamina');
  if (!cfg.ai) {
    return `<section class="card">
      ${cardHead('AI coach & autopilot', null, '<span class="badge">Not set up</span>')}
      <p class="small muted">${cfg.unreachable ? 'Needs the online server; this works on your Vercel deployment.' : 'Add an <code>OPENROUTER_API_KEY</code> in Vercel to get a personalised AI plan and an autopilot that moves your reminders to when you really do things. The built-in coach above already works without it.'}</p>
    </section>`;
  }
  const busy = isBusy();
  const r = ai?.result;
  const showPrivate = stamina && st.settings.aiPrivate;
  const changes = ap.log.filter((c) => showPrivate || !TUNABLE[c.target]?.private).slice(-6).reverse();
  const planner = modelName(cfg.aiModel);
  const reviewer = cfg.aiReviewModel ? modelName(cfg.aiReviewModel) : null;
  return `<section class="card" id="ai">
    ${cardHead('AI coach & autopilot', null, `<span class="badge info">${esc(planner)}${reviewer ? ` + ${esc(reviewer)}` : ''}</span>`)}
    <div class="autopilot">
      <div class="row ap-head"><div class="grow"><b>🤖 Autopilot</b><span class="small muted">After you log something or use a timer, ${esc(planner)} re-plans your day and moves reminders to when you really do things.${reviewer ? ` ${esc(reviewer)} double-checks every change first.` : ''} Up to ${AUTO_RUNS_PER_DAY} times a day.</span></div>
        <label class="switch"><input type="checkbox" data-change="ap-on" aria-label="Autopilot" ${ap.on ? 'checked' : ''}><span></span></label></div>
      <p class="small ap-status">${busy ? '⏳ Planning…' : esc(statusText())}</p>
      ${changes.length ? `<h3 class="small" style="margin-top:10px">Recent changes</h3><ul class="changes">${changes.map((c) => changeRow(c)).join('')}</ul>` : ''}
      <p class="tiny muted" style="margin-top:8px">AI cost so far on this device: $${(ap.spend || 0).toFixed(3)}. Times you set yourself in Settings, and changes you undo, are left alone for 7 days.</p>
    </div>
    <hr class="divider">
    <label class="field"><span class="small" style="font-weight:800">Ask the coach</span>
      <input class="input" id="ai-q" type="text" maxlength="500" placeholder="Optional: e.g. why am I tired at 3 PM?" autocomplete="off"></label>
    ${stamina ? `<label class="row small" style="margin-top:10px"><input type="checkbox" data-change="ai-private" ${st.settings.aiPrivate ? 'checked' : ''}> Include private stamina data</label>` : ''}
    <button class="btn primary block" style="margin-top:12px" data-action="ai-ask" ${busy ? 'disabled' : ''}>${busy ? 'Thinking… (up to a minute)' : `${icon('flame')}Plan my next 24 hours`}</button>
    <p class="tiny muted" style="margin-top:6px">Sends numbers and times only (no name or contact details) through OpenRouter, via your server.</p>
    ${r ? `<div class="ai-result">
      ${ai.question ? `<p class="small muted">You asked: “${esc(ai.question)}”</p>` : ai.auto ? '<p class="small muted">🤖 From the autopilot</p>' : ''}
      <p class="ai-headline">${esc(r.headline)}</p>
      <ol class="ai-actions">${(r.actions || []).map((a) => `<li><b>${esc(a.title)}</b>${a.when ? ` <span class="badge">${esc(a.when)}</span>` : ''}<span>${esc(a.detail)}</span></li>`).join('')}</ol>
      ${(r.watch_outs || []).length ? `<div class="note"><b>Watch out</b><ul class="bullets">${r.watch_outs.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      ${r.encouragement ? `<p class="small" style="margin-top:10px">${esc(r.encouragement)}</p>` : ''}
      ${reviewLine(r)}
      <p class="tiny muted" style="margin-top:8px">${esc(new Date(ai.at).toLocaleString())}${ai.day !== todayKey() ? ' · from an earlier day' : ''}</p>
    </div>` : ''}
  </section>`;
}

function healthCard() {
  return `<section class="card">
    ${cardHead('Health checks & help', null)}
    <ul class="bullets">
      <li><b>Low energy or forgetfulness?</b> Ask your doctor for vitamin B12, vitamin D, haemoglobin/iron and thyroid (TSH) tests. B12 deficiency is common on vegetarian diets.</li>
      <li><b>Mouth self-check monthly</b> (areca/tobacco users): a white or red patch, ulcer, or stiffness opening the mouth that lasts over 2 weeks should be seen by a dentist or doctor.</li>
      <li><b>Quitting support (India):</b> National Tobacco Quit Line <a href="tel:18001122356">1800-11-2356</a> (toll-free). A doctor can also advise on nicotine gum or lozenges.</li>
      <li><b>Get help urgently</b> for chest pain, fainting, a racing heart that won't settle, or thoughts of self-harm.</li>
    </ul>
  </section>`;
}

export function render() {
  const key = todayKey();
  const rec = peekDay(key) || emptyDay();
  const s = getState().settings;
  const res = coach(Date.now(), { notifyMode: notifyMode() });
  return `<div class="stack">
    ${goalCard(res)}
    ${checkinCard(rec)}
    ${suggestionsCard(res)}
    ${patternsCard(res)}
    ${aiCard()}
    ${s.focusAreas.includes('stamina') ? vitalityCard(rec, res) : ''}
    ${focusCard(s)}
    ${healthCard()}
  </div>`;
}

export function mount(root) {
  const crave = root.querySelector('#crave-chart');
  if (crave) {
    const hist = cravingHours(14);
    const keys = hist.map((_, h) => String(h).padStart(2, '0'));
    timeChart(crave, {
      keys,
      height: 140,
      integer: true,
      endLabel: false,
      xName: 'Hour',
      label: 'Pouches by hour of day, last 14 days',
      xLabel: (k, long) => {
        const h = Number(k);
        return long ? `${k}:00–${String((h + 1) % 24).padStart(2, '0')}:00` : `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;
      },
      series: [{ name: 'Pouches', kind: 'column', color: 'var(--s1)', values: Object.fromEntries(keys.map((k, i) => [k, hist[i] || null])), fmt: (v) => String(v) }],
    });
  }
  const sc = root.querySelector('#stamina-chart');
  if (sc) {
    const byDate = {};
    for (const v of getState().vitality) (byDate[v.date] ||= []).push(v.sec);
    const keys = Object.keys(byDate).sort();
    timeChart(sc, {
      keys,
      height: 130,
      label: 'Stamina over time',
      yTick: (v) => (v >= 60 ? `${Math.round(v / 60)}m` : `${v}s`),
      series: [{ name: 'Duration', kind: 'line', color: 'var(--s4)', values: Object.fromEntries(keys.map((k) => [k, Math.round(byDate[k].reduce((a, b) => a + b, 0) / byDate[k].length)])), fmt: fmtDur }],
    });
  }
}

export const coachActions = {
  checkin: (el) => update(() => {
    const d = dayRecord(todayKey());
    d.checkin = { ...(d.checkin || {}), [el.dataset.field]: Number(el.dataset.v) };
  }),
  'kegel-add': () => {
    update(() => { dayRecord(todayKey()).kegels = (dayRecord(todayKey()).kegels || 0) + 1; });
    const n = dayRecord(todayKey()).kegels;
    if (n === KEGEL_SETS) celebrate(`All ${KEGEL_SETS} pelvic-floor sets done 🧘`);
    else toast(n > KEGEL_SETS ? 'Extra set logged 💪' : `Set ${n} of ${KEGEL_SETS} done`);
  },
  'stamina-log': (el) => {
    update((s) => { s.vitality.push({ date: todayKey(), sec: Number(el.dataset.sec), ts: Date.now() }); });
    toast('Logged privately');
  },
  'stamina-del': (el) => update((s) => { s.vitality = s.vitality.filter((v) => String(v.ts) !== el.dataset.ts); }),
  'focus-toggle': (el) => update((s) => {
    const set = new Set(s.settings.focusAreas);
    set.has(el.dataset.id) ? set.delete(el.dataset.id) : set.add(el.dataset.id);
    set.add('quit');
    s.settings.focusAreas = FOCUS_AREAS.map((f) => f.id).filter((id) => set.has(id));
  }),
  dismiss: (el) => update((s) => {
    const d = s.dismissed?.day === todayKey() ? s.dismissed : { day: todayKey(), ids: [] };
    s.dismissed = { day: d.day, ids: [...new Set([...d.ids, el.dataset.id])] };
  }),
  'ai-ask': async () => {
    const question = document.getElementById('ai-q')?.value.trim() || '';
    try {
      await runCoach({ question });
      document.getElementById('ai')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (err) {
      toast(err.message);
    }
  },
  'ap-undo': (el) => {
    toast(undoChange(el.dataset.id) ? 'Change undone. Autopilot will leave it alone for 7 days.' : 'Marked as undone. You had already changed it.');
  },
};

export const coachChanges = {
  'ai-private': (el) => update((s) => { s.settings.aiPrivate = el.checked; }),
  'ap-on': (el) => setOn(el.checked),
};
