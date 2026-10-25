import { capSteps, isValidKey, isValidTime } from '../plan.js';
import { getState, update } from '../store.js';
import { esc } from '../ui.js';
import { celebrate } from '../joy.js';

export function render() {
  const s = getState().settings;
  return `<main class="onboard">
    <section class="welcome">
      <img class="logo" src="/icons/icon-192.png" alt="">
      <h1>Your 90-day comeback starts now ✨</h1>
      <p>Quit Tansen, rebuild stamina, tighten the waist and wake up with energy, one small win at a time.</p>
    </section>
    <div class="pillars">
      <div><b>🌱 Taper</b>Daily cap, 90-min morning lock, 15-min urge buffer</div>
      <div><b>⚡ Mileage</b>Max distance in a fixed 30 minutes</div>
      <div><b>💪 Strength</b>Micro-sets, M/W/F circuits, waist log</div>
      <div><b>🥗 Fuel</b>Sprouts, paneer, 4 PM shield, 2.5-h cutoff</div>
    </div>
    <form class="card form-grid" data-submit="onboard">
      <label class="field"><span>Start date</span><input class="input" name="startDate" type="date" value="${esc(s.startDate)}" required></label>
      <label class="field"><span>Pouches / day now</span><input class="input" name="baseline" type="number" min="0" max="100" inputmode="numeric" value="${s.baseline}" required></label>
      <label class="field"><span>Usual wake time</span><input class="input" name="wakeTime" type="time" value="${s.wakeTime}" required></label>
      <label class="field"><span>Usual bedtime</span><input class="input" name="sleepTime" type="time" value="${s.sleepTime}" required></label>
      <label class="field"><span>Daily 30-min walk at</span><input class="input" name="walkTime" type="time" value="${s.walkTime}" required></label>
      <label class="field"><span>Price per pouch (₹)</span><input class="input" name="pricePerPouch" type="number" min="0" max="1000" step="0.5" inputmode="decimal" placeholder="optional" value="${s.pricePerPouch || ''}"></label>
      <label class="field full"><span>Why are you doing this? 💜</span><textarea class="input" name="why" maxlength="140" rows="2" placeholder="e.g. More energy for my family, a clear head, feeling strong again">${esc(s.why)}</textarea></label>
      <p class="full small muted" id="cap-preview">Your caps: ${capSteps(s.baseline).join(' → ')} over 90 days.</p>
      <button class="btn primary block full" type="submit">Start my 90 days 🚀</button>
    </form>
    <p class="tiny muted">Data stays on this device. Not medical advice — check with a doctor if you have heart, liver or blood-pressure concerns.</p>
  </main>`;
}

export function mount(root) {
  const input = root.querySelector('[name="baseline"]');
  const preview = root.querySelector('#cap-preview');
  input?.addEventListener('input', () => {
    preview.textContent = `Your caps: ${capSteps(Number(input.value) || 0).join(' → ')} over 90 days.`;
  });
}

export const submits = {
  onboard: (form) => {
    const f = form.elements;
    if (!isValidKey(f.startDate.value) || !isValidTime(f.wakeTime.value) || !isValidTime(f.sleepTime.value) || !isValidTime(f.walkTime.value)) return;
    update((s) => {
      Object.assign(s.settings, {
        startDate: f.startDate.value,
        baseline: Math.max(0, Math.min(100, Math.round(Number(f.baseline.value) || 0))),
        wakeTime: f.wakeTime.value,
        sleepTime: f.sleepTime.value,
        walkTime: f.walkTime.value,
        pricePerPouch: Math.max(0, Math.min(1000, Number(f.pricePerPouch.value) || 0)),
        why: f.why.value.trim().slice(0, 140),
        onboarded: true,
      });
    });
    location.hash = '#today';
    celebrate("Day one. Let's do this! 🌱");
  },
};
