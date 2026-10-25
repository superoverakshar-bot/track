import { PROGRAM_DAYS, dayKeyAt } from '../plan.js';
import { TUNABLE } from '../reminders.js';
import { avoidedPouches, coach } from '../coach.js';
import { lineOfTheDay, partOfDay } from '../joy.js';
import { gapEnd, morningLockEnd, planFor } from '../logic.js';
import { nextWindow, taperProgress } from '../taper.js';
import { mode as notifyMode } from '../notify.js';
import { emptyDay, getState, peekDay, todayKey } from '../store.js';
import { clock, esc, icon } from '../ui.js';
import { changeRow, suggestionRow, visibleSuggestions } from './coach.js';
import { bufferCard, cardHead, checklistCard, microProgress, walkPhaseLine, walkSummary, waterCard } from './parts.js';

// What the taper says right now, with a time to count down to.
function taperStatus(key, rec, plan, now) {
  const used = rec.pouches.length;
  const lockEnd = morningLockEnd(key, rec);
  const g = gapEnd(key, rec);
  const w = nextWindow(key, rec, now);
  if (plan.cap === 0 && used === 0 && plan.day >= 1) return { icon: '🕊️', text: 'Pouch-free day. Every urge gets the buffer.' };
  if (w.reason === 'cap') return used > plan.cap ? { icon: '⚠️', text: `${used - plan.cap} over cap. Buffer every urge now.` } : { icon: '🛑', text: 'Cap reached. Buffer every urge from here.' };
  if (now < lockEnd) return { icon: '🔒', text: `Morning lock until ${clock(lockEnd)}`, until: lockEnd };
  if (g && now < g) return { icon: '⏳', text: `2-hour gap until ${clock(g)}`, until: g };
  if (w.reason === 'bedtime') return { icon: '🌙', text: `Done for today. Last call was ${clock(w.lastCall)}.` };
  if (w.next && now < w.next) return { icon: '⏳', text: `Next pouch fits at ${clock(w.next)}`, until: w.next };
  return { icon: '✅', text: 'Window open. Or ride it out and bank a save.' };
}

function heroCard(key, rec, now) {
  const st = getState();
  const s = st.settings;
  const plan = planFor(key);
  const pod = partOfDay();
  const used = rec.pouches.length;
  const left = plan.cap - used;
  const avoided = avoidedPouches();
  const rupees = s.pricePerPouch > 0 ? Math.round(avoided * s.pricePerPouch) : null;
  const beaten = Object.values(st.days).reduce((a, d) => a + d.saved, 0);
  const status = taperStatus(key, rec, plan, now);
  const { capStreak } = taperProgress();
  const r = 50;
  const c = 2 * Math.PI * r;
  const frac = plan.cap > 0 ? Math.max(0, left) / plan.cap : used ? 0 : 1;
  const title = left > 0 ? `${left} left today` : left === 0 ? (plan.cap ? 'Cap reached' : 'Pouch-free day') : `${-left} over cap`;
  const dayText = plan.day < 1 ? 'Plan starts soon' : plan.day > PROGRAM_DAYS ? 'Program complete' : `Day ${plan.day} · ${plan.phase.name}`;
  return `<section class="hero taper ${pod.key}">
    <p class="hello">${pod.hello} ${pod.emoji} · ${esc(dayText)}</p>
    <div class="tp-grid">
      <div class="left-ring" role="img" aria-label="${used} of ${plan.cap} pouches used today">
        <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="11"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}"/></svg>
        <div class="lbl"><b>${used}</b><span>of ${plan.cap} used</span></div></div>
      <div>
        <h2>${esc(title)}</h2>
        <span class="status">${status.icon} ${esc(status.text)}${status.until ? ` · <span data-until="${status.until}"></span><span data-countdown="${status.until}" data-rerender hidden></span>` : ''}</span>
      </div>
    </div>
    <div class="hero-actions">
      <button class="btn white" data-action="craving-start" ${st.craving ? 'disabled' : ''}>😮‍💨 I have an urge</button>
      <button class="btn glass" data-action="pouch-log">${icon('plus')}Log pouch</button>
    </div>
    ${s.why ? `<p class="why">💜 <b>My why:</b> ${esc(s.why)}</p>` : '<p class="why">💜 <a href="#settings">Add your “why”</a>. It keeps you going when an urge hits.</p>'}
    <div class="hero-stats">
      <div><b>${avoided}</b><span>pouches avoided</span></div>
      <div>${rupees != null ? `<b>₹${rupees.toLocaleString('en-IN')}</b><span>money saved</span>` : `<b>${beaten}</b><span>urges beaten</span>`}</div>
      <div><b>${capStreak}${capStreak ? '🔥' : ''}</b><span>days under cap</span></div>
    </div>
    <p class="quote small">“${esc(lineOfTheDay(key))}”</p>
  </section>`;
}

function smartCard() {
  const res = coach(Date.now(), { notifyMode: notifyMode() });
  const list = visibleSuggestions(res).filter((x) => !x.private).slice(0, 3);
  const wins = res.wins.filter((w) => !/fewer pouches/.test(w)); // the hero already shows pouches avoided
  return `<section class="card smart">
    ${cardHead('Smart actions', null, '<a class="small" href="#coach">Coach →</a>')}
    ${list.length ? `<div class="tips">${list.map((x) => suggestionRow(x, { dismissable: true })).join('')}</div>` : '<div class="empty">All caught up. Nice work.</div>'}
    ${wins.length ? `<div class="chips" style="margin-top:10px">${wins.slice(0, 2).map((w) => `<span class="chip win">${icon('check', 'inline')} ${esc(w)}</span>`).join('')}</div>` : ''}
  </section>`;
}

// Private stamina topics must never reach the Today screen.
const PRIVATE_WORDS = /pelvic|kegel|ejaculat|bedroom|sexual|\bsex\b|intima|stamina log|vitality/i;
const safe = (...texts) => !texts.some((t) => PRIVATE_WORDS.test(t || ''));

// The latest AI plan for today, plus what the autopilot moved. If the plan saw
// private data, anything that mentions it is left for the Coach tab.
function planCard(key) {
  const st = getState();
  const ai = st.ai;
  const changes = st.autopilot.log.filter((c) => !TUNABLE[c.target]?.private && dayKeyAt(c.at) === key);
  if ((!ai?.result || ai.day !== key) && !changes.length) return '';
  const r = ai?.day === key ? ai.result : null;
  const acts = (r?.actions || []).filter((a) => a.pillar !== 'vitality' && safe(a.title, a.detail, a.when)).slice(0, 3);
  return `<section class="card plan-today">
    ${cardHead('Your plan today', null, `<a class="small" href="#coach">${ai?.auto ? '🤖 Autopilot' : 'Coach'} →</a>`)}
    ${r && safe(r.headline) ? `<p class="ai-headline">${esc(r.headline)}</p>` : ''}
    ${acts.length ? `<ol class="ai-actions">${acts.map((a) => `<li><b>${esc(a.title)}</b>${a.when ? ` <span class="badge">${esc(a.when)}</span>` : ''}<span>${esc(a.detail)}</span></li>`).join('')}</ol>` : ''}
    ${changes.length ? `<h3 class="small" style="margin-top:12px">🤖 Moved today</h3><ul class="changes">${changes.slice(-3).reverse().map((c) => changeRow(c, { compact: true })).join('')}</ul>` : ''}
  </section>`;
}

function moveCard(key, rec) {
  const plan = planFor(key);
  const walk = getState().walks.filter((w) => w.date === key).pop();
  return `<section class="card">
    ${cardHead('Move', 'move', plan.isCircuitDay ? 'Circuit day' : '')}
    <p class="small muted">${esc(walkPhaseLine(plan.walkMode))}</p>
    ${walk ? `<p style="margin-top:6px"><span class="badge good">✓ ${esc(walkSummary(walk))}</span></p>` : ''}
    <div class="btn-row" style="margin-top:12px">
      <button class="btn primary" data-action="walk-start" data-mode="${plan.walkMode}">${icon('play')}30-min timer</button>
      <button class="btn" data-action="nav" data-to="#move">Log walk</button>
    </div>
    <hr class="divider">
    <div class="row" style="margin-bottom:8px"><b class="small">Morning micro-set</b><span class="spacer"></span><button class="btn sm ghost" data-action="nav" data-to="#move">Log reps →</button></div>
    ${microProgress(rec)}
    ${plan.isCircuitDay ? `<hr class="divider"><div class="row"><span class="badge info">${icon('dumbbell')}Circuit · ${rec.rounds}/${plan.rounds} rounds</span><span class="spacer"></span><button class="btn sm" data-action="nav" data-to="#move">Open</button></div>` : ''}
  </section>`;
}

function alcoholCard(key, rec) {
  const plan = planFor(key);
  if (!plan.isAlcoholDay && !rec.drinks) return '';
  const max = getState().settings.alcoholMax;
  const ratioOk = rec.drinkWater >= rec.drinks;
  return `<section class="card">
    ${cardHead('Alcohol guardrail', 'taper', plan.isAlcoholDay ? 'Designated day' : 'Not a designated day')}
    <div class="row"><span class="big-num">${rec.drinks} <small>/ ${max} drinks</small></span><span class="spacer"></span>
    <span class="badge ${ratioOk ? 'good' : 'warn'}">${icon('glass')}Water ${rec.drinkWater}:${rec.drinks}</span></div>
    <div class="btn-row" style="margin-top:12px"><button class="btn" data-action="drink-add">+1 drink</button><button class="btn" data-action="drink-water">${icon('drop')}Water</button></div>
  </section>`;
}

export function render() {
  const key = todayKey();
  const rec = peekDay(key) || emptyDay();
  const now = Date.now();
  return `<div class="stack">
    ${heroCard(key, rec, now)}
    ${bufferCard(now)}
    ${smartCard()}
    ${planCard(key)}
    ${checklistCard(key, rec)}
    ${waterCard(rec, true)}
    ${moveCard(key, rec)}
    ${alcoholCard(key, rec)}
  </div>`;
}
