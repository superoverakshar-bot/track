// Little moments of joy: confetti, celebrations, greetings and a daily line of inspiration.
import { toast, vibrate } from './ui.js';

const COLORS = ['#7c3aed', '#db2777', '#f97316', '#facc15', '#10b981', '#0ea5e9'];

export function confetti({ count = 150, duration = 2600 } = {}) {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const bits = Array.from({ length: count }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.4,
    y: h * 0.38,
    vx: (Math.random() - 0.5) * 13,
    vy: -Math.random() * 13 - 5,
    size: 6 + Math.random() * 7,
    spin: Math.random() * Math.PI,
    vspin: (Math.random() - 0.5) * 0.35,
    round: Math.random() < 0.3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - duration * 0.6) / (duration * 0.4));
    for (const b of bits) {
      b.vy += 0.34;
      b.vx *= 0.985;
      b.x += b.vx;
      b.y += b.vy;
      b.spin += b.vspin;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.spin);
      ctx.fillStyle = b.color;
      if (b.round) {
        ctx.beginPath();
        ctx.arc(0, 0, b.size / 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-b.size / 2, -b.size / 3.2, b.size, b.size / 1.6);
      }
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

export function celebrate(text) {
  confetti();
  toast(text, 'party');
  vibrate([30, 40, 30, 40, 90]);
}

export function partOfDay(date = new Date()) {
  const h = date.getHours();
  if (h >= 4 && h < 12) return { key: 'morning', hello: 'Good morning', emoji: '☀️' };
  if (h >= 12 && h < 17) return { key: 'afternoon', hello: 'Good afternoon', emoji: '🌤️' };
  return { key: 'evening', hello: 'Good evening', emoji: '🌙' };
}

const PHASE_HEADLINE = {
  pre: 'Ready to begin',
  stabilize: 'Building momentum',
  cut1: 'Cutting deeper',
  cut2: 'Halfway hero',
  final: 'Final stretch!',
  free: 'Living pouch-free',
};

export function headline(phaseId) {
  return PHASE_HEADLINE[phaseId] || "You've got this";
}

const LINES = [
  'Every urge you ride out makes the next one weaker.',
  "You're not giving something up. You're getting your energy back.",
  'Cravings last minutes. Your health lasts a lifetime.',
  'Small wins, every day. That is how 20 becomes 0.',
  'Discipline today, freedom tomorrow.',
  'One pouch skipped is one victory banked.',
  'Strong body, clear mind, steady energy, one choice at a time.',
  "You've done hard things before. This is one more.",
  'Breathe in calm. Breathe out the urge.',
  'Progress, not perfection. A slip is just information.',
  "Today's water, walk and sprouts are building tomorrow's you.",
  'The best time to quit was yesterday. The next best is right now.',
  'Every step on your walk is a step away from the pouch.',
  'Your future self is already cheering for you.',
  'Clearer mind, more stamina, better sleep. That is the prize.',
  "Let's make today a 5/5 day.",
  "Urges are waves. You're learning to surf.",
  'Strength is built one rep, one glass, one choice at a time.',
  "You're rewiring a habit. Be patient, and be proud.",
  'Nothing tastes as good as freedom feels.',
  'Show up for the 30 minutes. The rest follows.',
  'Your why is bigger than any craving.',
  'Every day under the cap is a promise kept to yourself.',
  'Light body, bright mind. Keep going.',
  'Fall down seven times, stand up eight.',
  'Celebrate the tiny wins. They add up fast.',
  "You're writing a comeback story. Today is a great chapter.",
  'More breath, more energy, more you.',
  'Hard now, easy later. Easy now, hard later. Choose your hard.',
  'The urge is loud but short. You are quiet and strong.',
];

// Same line all day, a new one tomorrow.
export function lineOfTheDay(key) {
  const n = key.split('-').reduce((a, v) => a * 31 + Number(v), 7);
  return LINES[Math.abs(n) % LINES.length];
}

export const PILLAR_EMOJI = { taper: '🌱', move: '⚡', strength: '💪', fuel: '🥗', vitality: '🧘', sleep: '🌙', focus: '🧠', energy: '🔋', general: '✨' };
