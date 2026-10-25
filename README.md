# Track · 90-Day Reset

An installable web app (PWA) for a 90-day health reset, with reminders that arrive even when the app is closed. Built to deploy on Vercel with no build step.

| Pillar | What the app does |
|---|---|
| **1. Habit tapering** | Daily cap computed from your start date and baseline, a 90-minute morning lock, the 2-hour gap rule from day 31, a 15-minute urge buffer with a 200 ml water check, and honest rule-break logging. Also counts urges beaten ("pouches saved") and has an alcohol guardrail: designated days, a drink cap, 1:1 water and zero-day runs. |
| **2. Stamina & mileage** | Full-screen 30-minute interval timer for 4:1, 3:2 or continuous sessions, with beeps, vibration and screen wake-lock. The phase switches automatically by week. Logs distance, pace and energy, tracks your personal best and suggests the next +100–150 m target. |
| **3. Calisthenics & core** | Quick-tap counters for push-ups, squats, pull-ups and core reps. Plank and dead-hang stopwatch. Morning micro-set detection, a Mon/Wed/Fri circuit round tracker and a weekly waist log. |
| **4. Vegetarian nutrition** | Morning 500 ml water, a water meter, sprouts/protein/vascular-booster checkboxes, the 4 PM Energy Shield, and the 2.5-hour dinner cutoff countdown. |
| **Daily non-negotiables** | Five checks scored 0–5 each day, a streak and a 90-day calendar heatmap. |
| **Smart coach** | Turns your logs into ranked, time-aware next actions: craving-peak warnings, cap pacing ("one every 70 min at most"), water behind pace, and the habits that actually lift *your* energy and focus. Also a daily energy/focus/sleep check-in and a "what your data says" panel. |
| **AI coach (optional)** | Gemini 3.8 Flash (via OpenRouter) reads a numbers-only summary of your last 14 days and writes a 24-hour plan, or answers your question. |
| **Bedroom stamina (private)** | Pelvic-floor training (3 sets/day), a private duration log with trend, and evidence-based techniques. Never shown on the Today screen or in notifications. |
| **Progress** | Pouches vs. the 90-day cap, 30-minute distance next to pouches per day (same dates, two charts), daily reps, waist trend. |

Reminders adapt to what you've logged. If you already had the 4 PM snack, the 4 PM push says "Shield done ✓"; if you're behind on water it tells you by how much; the wake-up push recaps yesterday.

All logs stay on your device (`localStorage`). Use **Settings → Export** for backups or to move to a new phone.

---

## Deploy to Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub (the free Hobby plan is enough).
2. Go to [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → pick `superoverakshar-bot/track`. If it isn't listed, choose *Adjust GitHub App Permissions* and give Vercel access to the repo.
3. Keep every default. `vercel.json` already sets the framework to *Other*, the output directory to `public` and a 60 s limit for the AI coach; there is no build command.
4. Click **Deploy**. In about a minute you get a URL like `track-xxxx.vercel.app`, and the app works right away with in-app reminders.

Vercel deploys production from the repo's default branch. Every later push redeploys automatically, and environment variable changes take effect after **Deployments → ⋯ → Redeploy**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsuperoverakshar-bot%2Ftrack)

Open the production URL on your phone and **install it**:
- **Android (Chrome):** menu → *Install app* (or use the in-app *Install* banner).
- **iPhone (Safari):** Share → *Add to Home Screen*. iOS only allows push for installed web apps (iOS 16.4+).

## Push notifications (reminders when the app is closed)

Without this setup, reminders only show while the app is open or in the background. To get them when it's closed, add two free services. This takes about 5 minutes.

**How it works:** when you turn on reminders, the app sends your schedule to `/api/push/sync`. That creates one [Upstash QStash](https://upstash.com/docs/qstash) cron schedule per reminder, in your time zone. At each reminder time QStash calls `/api/push/deliver`, which checks QStash's signature and sends a Web Push to your phone. One-off alerts (craving buffer done, morning lock over, 2-hour gap over) are delayed QStash messages. No database is needed.

> Vercel's own cron jobs only run once a day on the free Hobby plan, which is why QStash does the scheduling. A full day of reminders uses about 15 QStash messages; the free tier allows 1,000 a day.

### 1. Create VAPID keys (identifies your server to push services)

Easiest: open your deployed app → **Settings → Notifications → Generate VAPID keys**. The keys are made in your browser and never leave the device. Or, on a computer with Node: `npm install && npm run vapid`.

In **Vercel → Project → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | the public key |
| `VAPID_PRIVATE_KEY` | the private key (keep it secret) |
| `VAPID_SUBJECT` | `mailto:you@example.com` (your email) |

### 2. Connect Upstash QStash

In **Vercel → Project → Storage** (or **Integrations → Marketplace**), add **Upstash → QStash** and connect it to this project. That adds `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` for you. If you create QStash directly at [console.upstash.com](https://console.upstash.com), copy those three values in by hand.

### 3. Redeploy and turn it on

Redeploy the **production** deployment. QStash calls back to your production URL, because preview URLs are behind Vercel login. Then open the app → **Settings → Notifications → Enable notifications**. The status should read **On · push**. Tap **Send test** to confirm.

### Optional

| Variable | Purpose |
|---|---|
| `PUSH_ACCESS_CODE` | If set, the app must enter this code (Settings → Notifications) before it can create schedules or use the AI coach. This stops strangers who find your URL from spending your QStash or Anthropic quota. Recommended once the AI coach is on. |
| `APP_URL` | Overrides the public base URL QStash calls back to (defaults to the Vercel production URL). Set it when you use a custom domain. |

If something isn't set, **Settings → Notifications** lists the missing variables.

## AI coach (optional)

The built-in coach works with no setup. To also get AI-written plans from **Google Gemini 3.8 Flash via [OpenRouter](https://openrouter.ai)**:

1. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys) and add a few dollars of credit.
2. Add `OPENROUTER_API_KEY` in Vercel → Settings → Environment Variables, then redeploy.
3. Open **Coach → AI coach → Get my AI plan** (optionally type a question).

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Required for the AI coach. |
| `OPENROUTER_MODEL` | Optional. Any OpenRouter model ID that supports structured outputs. The default is `google/gemini-3.8-flash`; `~google/gemini-flash-latest` always tracks the newest Gemini Flash. |

The app sends a numbers-only summary (no name or contact details): today, the last 14 days, recent walks and waist, and the patterns the built-in coach found. Private stamina data is included only while *Include private stamina data* is ticked. The request asks for a strict JSON schema and tells OpenRouter to route only to providers that support it (`provider.require_parameters`). A plan costs about a cent or less. Because the summary is health data, review which providers OpenRouter may use in its privacy settings, and set `PUSH_ACCESS_CODE` so only you can spend your credits.

## Reminders

Every reminder can be switched on or off in Settings. Times tied to your schedule move automatically when you change your wake time or bedtime.

| Reminder | When |
|---|---|
| Wake-up hydration + 90-min lock | wake time |
| Morning micro-set | wake + 20 min |
| Hydration checks | 11:00, 18:00 (editable) |
| Pelvic-floor set | 14:00 (editable; on when *Bedroom stamina* is a focus area) |
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

Caps come from your **baseline** (pouches/day before day 1; default 20). Each block is at least one pouch lower than the one before. The final taper steps down every week by at most ~40%, ending 2 → 1 → 0, so a high baseline never faces a cliff.

| Days | Rule | Baseline 20 → cap |
|---|---|---|
| 1–14 | Stabilize: baseline − 2 | 18 |
| 15–30 | Cut 1: 75% of baseline | 15 |
| 31–60 | Cut 2: 50% of baseline + strict 2-hour gaps | 10 |
| 61–66 | Final taper | 6 |
| 67–72 | Final taper | 4 |
| 73–78 | Final taper | 2 |
| 79–84 | Final taper | 1 |
| 85–90+ | Zero, with mouth replacements (elaichi, saunf, dhana dal) | 0 |

A tracking day runs from 04:00 to 03:59, so a late night counts toward the day you started.

## Local development

```bash
npm install
npm run dev      # http://localhost:3000 (serves public/ and runs api/ like Vercel)
npm test         # plan logic, coach rules, reminder copy, push + AI handlers
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
  js/coach.js        smart coach: suggestions, patterns, adaptive reminder text, AI summary
  js/notify.js       permission, push subscription, local fallback timers
  js/charts.js       SVG charts with tooltips and data tables
  js/views/*.js      Today, Coach, Taper, Move, Fuel, Progress, Settings
api/push/*.js        Vercel functions: config, sync, once, cancel, unsubscribe, test, deliver
api/coach.js         AI coach (OpenRouter → Gemini 3.8 Flash)
lib/server.js        validation, QStash + web-push helpers
scripts/dev.mjs      zero-dependency local server
test/                node:test suites
```

---

*Track is a personal habit tool, not medical advice. If you have heart, liver or blood-pressure conditions, or severe withdrawal symptoms, talk to a doctor before changing your routine.*
