// User actions, wired to elements via data-action="name".
import { BUFFER_MIN, BUFFER_WATER_ML, CIRCUIT_ROUND, GAP_MIN, MORNING_LOCK_MIN } from './plan.js';
import { FLAG_TEXT, bufferEnds, cravingState, planFor, pouchFlags } from './logic.js';
import { cancelOnce, scheduleOnce } from './notify.js';
import { dayRecord, getState, todayKey, update } from './store.js';
import { clock, dialog, esc, toast } from './ui.js';
import { celebrate } from './joy.js';

const MIN = 60000;
const clampAdd = (v, n) => Math.max(0, (v || 0) + n);

export function startCraving() {
  const now = Date.now();
  const endsAt = bufferEnds(now);
  update((s) => { s.craving = { startedAt: now, endsAt, water: false }; });
  scheduleOnce('craving', endsAt);
  toast(`${BUFFER_MIN}-minute buffer started — drink ${BUFFER_WATER_ML} ml of water`);
}

export async function logPouch() {
  const key = todayKey();
  const now = Date.now();
  const crav = cravingState(now);
  const rec = dayRecord(key);
  const flags = pouchFlags(key, rec, now, !!crav?.done);
  if (flags.length) {
    const list = flags.map((f) => `<li>${esc(FLAG_TEXT[f])}</li>`).join('');
    const buttons = [{ label: 'Cancel', value: null }];
    if (!crav) buttons.push({ label: 'Start buffer', value: 'buffer', cls: 'primary' });
    else buttons.push({ label: 'Keep waiting', value: null, cls: 'primary' });
    buttons.push({ label: 'Log anyway', value: 'log', cls: 'danger' });
    const choice = await dialog({
      title: 'This pouch breaks a rule',
      html: `<ul class="bullets">${list}</ul><p class="small muted" style="margin-top:10px">Logging honestly beats not logging. If you can, run the ${BUFFER_MIN}-minute buffer first — most urges pass.</p>`,
      buttons,
    });
    if (choice === 'buffer') return startCraving();
    if (choice !== 'log') return;
  }
  const plan = planFor(key);
  update((s) => {
    dayRecord(key).pouches.push({ ts: now, flags });
    s.craving = null;
  });
  if (crav) cancelOnce('craving');
  const used = dayRecord(key).pouches.length;
  if (plan.gapRule) scheduleOnce('gap', now + GAP_MIN * MIN, { remaining: Math.max(0, plan.cap - used) });
  toast(`Pouch logged · ${used} of ${plan.cap}`);
}

function setDay(fn) {
  update(() => fn(dayRecord(todayKey())));
}

function toggleField(field) {
  setDay((d) => {
    d[field] = !d[field];
    if (field === 'morningWater') d.waterMl = clampAdd(d.waterMl, d[field] ? 500 : -500);
  });
}

function holdField(kind) {
  return kind === 'hang' ? 'hangs' : 'planks';
}

export const actions = {
  nav: (el) => { location.hash = el.dataset.to; },

  wake: () => {
    const now = Date.now();
    setDay((d) => { d.wakeAt = now; });
    scheduleOnce('lockEnd', now + MORNING_LOCK_MIN * MIN);
    toast(`Good morning ☀️ Pouch lock until ${clock(now + MORNING_LOCK_MIN * MIN)} — 500 ml water first`);
  },

  'craving-start': startCraving,
  'craving-water': () => update((s) => {
    if (!s.craving) return;
    s.craving.water = !s.craving.water;
    const d = dayRecord(todayKey());
    d.waterMl = clampAdd(d.waterMl, s.craving.water ? BUFFER_WATER_ML : -BUFFER_WATER_ML);
  }),
  'craving-saved': () => {
    update((s) => {
      dayRecord(todayKey()).saved += 1;
      s.craving = null;
    });
    cancelOnce('craving');
    const n = dayRecord(todayKey()).saved;
    celebrate(n > 1 ? `Urge beaten! 💪 ${n} saved today` : 'Urge beaten! 💪 One pouch saved');
  },
  'craving-cancel': () => {
    update((s) => { s.craving = null; });
    cancelOnce('craving');
  },
  'pouch-log': logPouch,
  'pouch-del': async (el) => {
    const i = Number(el.dataset.i);
    const ok = await dialog({ title: 'Remove this pouch log?', buttons: [{ label: 'Keep', value: false }, { label: 'Remove', value: true, cls: 'danger' }] });
    if (ok) setDay((d) => d.pouches.splice(i, 1));
  },

  'water-add': (el) => setDay((d) => { d.waterMl = clampAdd(d.waterMl, Number(el.dataset.ml)); }),
  toggle: (el) => toggleField(el.dataset.field),

  check: (el) => {
    const id = el.dataset.id;
    if (id === 'morning') toggleField('morningWater');
    else if (id === 'microset') toggleField('microManual');
    else if (id === 'snack') toggleField('snack');
    else if (id === 'protein') setDay((d) => { const on = !(d.sprouts && d.protein); d.sprouts = on; d.protein = on; });
    else if (id === 'dinner') setDay((d) => { d.dinnerAt = d.dinnerAt ? null : Date.now(); });
  },

  'dinner-now': () => setDay((d) => { d.dinnerAt = Date.now(); }),
  'dinner-clear': () => setDay((d) => { d.dinnerAt = null; }),

  'rep-add': (el) => setDay((d) => { d.reps[el.dataset.field] = clampAdd(d.reps[el.dataset.field], Number(el.dataset.n)); }),

  'hold-start': (el) => update((s) => { s.hold = { kind: el.dataset.kind, startedAt: Date.now() }; }),
  'hold-stop': () => {
    const h = getState().hold;
    if (!h) return;
    const sec = Math.round((Date.now() - h.startedAt) / 1000);
    update((s) => {
      if (sec >= 3) dayRecord(todayKey())[holdField(h.kind)].push(sec);
      s.hold = null;
    });
    if (sec >= 3) toast(`${h.kind === 'hang' ? 'Hang' : 'Plank'} logged · ${sec}s`);
  },
  'hold-cancel': () => update((s) => { s.hold = null; }),
  'hold-add': (el) => setDay((d) => d[holdField(el.dataset.kind)].push(Number(el.dataset.sec))),
  'hold-del': (el) => setDay((d) => d[holdField(el.dataset.kind)].splice(Number(el.dataset.i), 1)),

  'round-done': () => {
    setDay((d) => {
      d.rounds += 1;
      for (const k of ['pushups', 'squats', 'core']) d.reps[k] += CIRCUIT_ROUND[k];
      d.hangs.push(CIRCUIT_ROUND.hangSec);
      d.planks.push(CIRCUIT_ROUND.plankSec);
    });
    toast(`Round logged: +${CIRCUIT_ROUND.pushups} push-ups, +${CIRCUIT_ROUND.squats} squats, ${CIRCUIT_ROUND.hangSec}s hang, ${CIRCUIT_ROUND.plankSec}s plank, +${CIRCUIT_ROUND.core} core`);
  },
  'round-undo': () => setDay((d) => {
    if (!d.rounds) return;
    d.rounds -= 1;
    for (const k of ['pushups', 'squats', 'core']) d.reps[k] = clampAdd(d.reps[k], -CIRCUIT_ROUND[k]);
    const hi = d.hangs.lastIndexOf(CIRCUIT_ROUND.hangSec);
    if (hi >= 0) d.hangs.splice(hi, 1);
    const pi = d.planks.lastIndexOf(CIRCUIT_ROUND.plankSec);
    if (pi >= 0) d.planks.splice(pi, 1);
  }),

  'drink-add': () => {
    const plan = planFor(todayKey());
    setDay((d) => { d.drinks += 1; });
    const d = dayRecord(todayKey());
    const max = getState().settings.alcoholMax;
    if (!plan.isAlcoholDay) toast('Not a designated day — logged honestly. Water next 💧');
    else if (d.drinks > max) toast(`Over your ${max}-drink guardrail`);
    else toast('Logged. Match it with a glass of water 💧');
  },
  'drink-water': () => setDay((d) => { d.drinkWater += 1; d.waterMl += 250; }),
  'drink-undo': () => setDay((d) => { d.drinks = clampAdd(d.drinks, -1); }),

  'walk-start': (el) => {
    update((s) => { s.walkTimer = { startedAt: Date.now(), mode: el.dataset.mode, pausedAt: null, pausedMs: 0 }; });
  },
  'walk-pause': () => update((s) => { if (s.walkTimer && !s.walkTimer.pausedAt) s.walkTimer.pausedAt = Date.now(); }),
  'walk-resume': () => update((s) => {
    const t = s.walkTimer;
    if (t?.pausedAt) {
      t.pausedMs += Date.now() - t.pausedAt;
      t.pausedAt = null;
    }
  }),
  'walk-end': async () => {
    const t = getState().walkTimer;
    if (!t) return;
    const elapsed = ((t.pausedAt || Date.now()) - t.startedAt - t.pausedMs) / MIN;
    if (elapsed < 29.5) {
      const ok = await dialog({ title: 'End the session early?', html: `<p class="muted">You're at ${Math.floor(elapsed)} min of 30.</p>`, buttons: [{ label: 'Keep going', value: false, cls: 'primary' }, { label: 'End', value: true, cls: 'danger' }] });
      if (!ok) return;
    }
    update((s) => {
      s.walkTimer = null;
      s.walkDraft = { mode: t.mode, durationMin: Math.min(30, Math.max(1, Math.round(elapsed))) };
    });
    location.hash = '#move';
    toast('Session done — log your distance');
  },
  'walk-del': async (el) => {
    const ok = await dialog({ title: 'Delete this session?', buttons: [{ label: 'Keep', value: false }, { label: 'Delete', value: true, cls: 'danger' }] });
    if (ok) update((s) => { s.walks = s.walks.filter((w) => w.id !== el.dataset.id); });
  },
};

