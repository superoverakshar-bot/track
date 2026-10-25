# Track · 90-Day Reset

An installable web app (PWA) for a 90-day health reset, with reminders that arrive even when the app is closed. Built to deploy on Vercel with no build step.

| Pillar | What the app does |
|---|---|
| **1. Habit tapering** | Daily cap computed from your start date and baseline, a 90-minute morning lock, the 2-hour gap rule from day 31, a 15-minute urge buffer with a 200 ml water check, and honest rule-break logging. Also counts urges beaten ("pouches saved") and has an alcohol guardrail: designated days, a drink cap, 1:1 water and zero-day runs. |
| **2. Stamina & mileage** | Full-screen 30-minute interval timer for 4:1, 3:2 or continuous sessions, with beeps, vibration and screen wake-lock. The phase switches automatically by week. Logs distance, pace and energy, tracks your personal best and suggests the next +100–150 m target. |
| **3. Calisthenics & core** | Quick-tap counters for push-ups, squats, pull-ups and core reps. Plank and dead-hang stopwatch. Morning micro-set detection, a Mon/Wed/Fri circuit round tracker and a weekly waist log. |
| **4. Vegetarian nutrition** | Morning 500 ml water, a water meter, sprouts/protein/vascular-booster checkboxes, the 4 PM Energy Shield, and the 2.5-hour dinner cutoff countdown. |
| **Daily non-negotiables** | Five checks scored 0–5 each day, a streak and a 90-day calendar heatmap. |
| **Progress** | Pouches vs. the 90-day cap, 30-minute distance next to pouches per day (same dates, two charts), daily reps, waist trend. |

All logs stay on your device (`localStorage`). Use **Settings → Export** for backups or to move to a new phone.

---

## Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import this GitHub repository.
2. Keep the defaults. `vercel.json` already sets the framework to *Other* and the output directory to `public`; there is no build command.
3. Click **Deploy**. The app works right away, with in-app reminders.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsuperoverakshar-bot%2Ftrack)

Open the production URL on your phone and **install it**:
- **Android (Chrome):** menu → *Install app* (or use the in-app *Install* banner).
- **iPhone (Safari):** Share → *Add to Home Screen*. iOS only allows push for installed web apps (iOS 16.4+).

## Push notifications (reminders when the app is closed)

Without this setup, reminders only show while the app is open or in the background. To get them when it's closed, add two free services. This takes about 5 minutes.

**How it works:** when you turn on reminders, the app sends your schedule to `/api/push/sync`. That creates one [Upstash QStash](https://upstash.com/docs/qstash) cron schedule per reminder, in your time zone. At each reminder time QStash calls `/api/push/deliver`, which checks QStash's signature and sends a Web Push to your phone. One-off alerts (craving buffer done, morning lock over, 2-hour gap over) are delayed QStash messages. No database is needed.

> Vercel's own cron jobs only run once a day on the free Hobby plan, which is why QStash does the scheduling. A full day of reminders uses about 15 QStash messages; the free tier allows 1,000 a day.

### 1. Create VAPID keys (identifies your server to push services)

```bash
npm install
npm run vapid
```

In **Vercel → Project → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | the *Public Key* printed above |
| `VAPID_PRIVATE_KEY` | the *Private Key* printed above (keep it secret) |
| `VAPID_SUBJECT` | `mailto:you@example.com` (your email) |

### 2. Connect Upstash QStash

In **Vercel → Project → Storage** (or **Integrations → Marketplace**), add **Upstash → QStash** and connect it to this project. That adds `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` for you. If you create QStash directly at [console.upstash.com](https://console.upstash.com), copy those three values in by hand.

### 3. Redeploy and turn it on

Redeploy the **production** deployment. QStash calls back to your production URL, because preview URLs are behind Vercel login. Then open the app → **Settings → Notifications → Enable notifications**. The status should read **On · push**. Tap **Send test** to confirm.

### Optional

| Variable | Purpose |
|---|---|
| `PUSH_ACCESS_CODE` | If set, the app must enter this code (Settings → Notifications) before it can create schedules. This stops strangers who find your URL from using your QStash quota. |
| `APP_URL` | Overrides the public base URL QStash calls back to (defaults to the Vercel production URL). Set it when you use a custom domain. |

If something isn't set, **Settings → Notifications** lists the missing variables.

## Reminders

Every reminder can be switched on or off in Settings. Times tied to your schedule move automatically when you change your wake time or bedtime.

| Reminder | When |
|---|---|
| Wake-up hydration + 90-min lock | wake time |
| Morning micro-set | wake + 20 min |
| Hydration checks | 11:00, 18:00 (editable) |
| Sprouts + protein before lunch | 12:45 (editable) |
| 4:00 PM Energy Shield | 16:00 (editable) |
| 30-min mileage session | walk time |
| Calisthenics circuit | circuit days at circuit time |
| Alcohol guardrail | designated days, 19:00 |
| Kitchen closing soon | bedtime − 3 h (30 min before the cutoff) |
| Weekly waist log | waist day, 08:30 |
| Evening check-in | bedtime − 1 h |
| One-off alerts | 15-min buffer done · morning lock over · 2-hour gap over |

## Taper math

Caps come from your **baseline** (pouches/day before day 1). Each block is at least one pouch lower than the one before, so small baselines still taper.

| Days | Rule | Baseline 10 → cap |
|---|---|---|
| 1–14 | Stabilize: baseline − 2 | 8 |
| 15–30 | Cut 1: 75% of baseline | 7 |
| 31–60 | Cut 2: 50% of baseline + strict 2-hour gaps | 5 |
| 61–72 | Final taper: max 2 | 2 |
| 73–84 | Final taper: max 1 | 1 |
| 85–90+ | Zero, with mouth replacements (elaichi, saunf, dhana dal) | 0 |

A tracking day runs from 04:00 to 03:59, so a late night counts toward the day you started.

## Local development

```bash
npm install
npm run dev      # http://localhost:3000 (serves public/ and runs api/ like Vercel)
npm test         # plan logic, reminder copy and push handlers
```

Put env vars in `.env.local` (see `.env.example`) to test push locally. QStash can't call `localhost`, so set `APP_URL` to a public tunnel URL for end-to-end tests.

## Project layout

```
public/              static PWA (no build step)
  index.html, sw.js, manifest.webmanifest, css/, icons/
  js/plan.js         taper caps, phases, walk intervals (shared with the server)
  js/reminders.js    reminder catalogue + notification copy (shared with the server)
  js/store.js        localStorage state
  js/logic.js        rules, checklist, streaks, stats
  js/notify.js       permission, push subscription, local fallback timers
  js/charts.js       SVG charts with tooltips and data tables
  js/views/*.js      Today, Taper, Move, Fuel, Progress, Settings
api/push/*.js        Vercel functions: config, sync, once, cancel, unsubscribe, test, deliver
lib/server.js        validation, QStash + web-push helpers
scripts/dev.mjs      zero-dependency local server
test/                node:test suites
```

---

*Track is a personal habit tool, not medical advice. If you have heart, liver or blood-pressure conditions, or severe withdrawal symptoms, talk to a doctor before changing your routine.*
