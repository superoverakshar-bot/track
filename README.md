# Track · 90-Day Reset

**Live:** https://track-delta-ten.vercel.app

An installable web app (PWA) for a 90-day health reset, with reminders that arrive even when the app is closed. Built to deploy on Vercel with no build step.

| Pillar | What the app does |
|---|---|
| **1. Tansen taper** (the main focus) | The Today screen opens on the taper: pouches left, a live "next pouch fits at…" countdown, and one-tap **I have an urge** / **Log pouch**. The daily cap comes from your start date and baseline; the app spreads what's left evenly until an hour before bed, never inside the 90-minute morning lock or (from day 31) the 2-hour gap rule. The 15-minute urge buffer has a breathing guide (and if you forget to tap *Urge passed*, it counts as beaten 15 minutes after it ends, as long as you didn't log a pouch), a 200 ml water check, your "why" and a counter-move for the trigger you tag. Each pouch and beaten urge is tagged with its trigger (after a meal, chai, stress, boredom, …), and the **Taper** tab shows your top triggers with a plan for the #1, weekly progress (avg/day, % below baseline, under-cap streak, time pouch-free), an urge SOS toolkit, what to expect from withdrawal by phase, and the alcohol guardrail. |
| **2. Stamina & mileage** | Full-screen 30-minute interval timer for 4:1, 3:2 or continuous sessions, with beeps, vibration and screen wake-lock. The phase switches automatically by week. Logs distance, pace and energy, tracks your personal best and suggests the next +100–150 m target. |
| **3. Calisthenics & core** | Quick-tap counters for push-ups, squats, pull-ups and core reps. Plank and dead-hang stopwatch. Morning micro-set detection, a Mon/Wed/Fri circuit round tracker and a weekly waist log. |
| **4. Vegetarian nutrition** | Morning 500 ml water, a water meter, sprouts/protein/vascular-booster checkboxes, the 4 PM Energy Shield, and the 2.5-hour dinner cutoff countdown. |
| **Daily non-negotiables** | Five checks scored 0–5 each day, a streak and a 90-day calendar heatmap. |
| **Smart coach** | Turns your logs into ranked, time-aware next actions: taper first (craving-peak warnings, cap pacing such as "the next one fits at 15:40", your #1 trigger and its counter-move), then water behind pace, and the habits that actually lift *your* energy and focus. Also a daily energy/focus/sleep check-in and a "what your data says" panel. |
| **AI coach + autopilot (optional)** | Gemini 3.8 Flash (via OpenRouter) reads a numbers-and-times summary of your last 14 days and writes a 24-hour plan, or answers your question. The **autopilot** runs it on its own after you log something or use a timer (up to 4 times a day, 2 hours apart) and moves your reminders, wake/bed and walk times to when you really do things. A second model from another company, OpenAI GPT-6 Sol, double-checks every change before it's applied; anything it rejects is left as is, and you can undo any change. |
| **Bedroom stamina (private)** | Pelvic-floor training (3 sets/day), a private duration log with trend, and evidence-based techniques. Never shown on the Today screen or in notifications. |
| **Motivation** | A sunrise-themed Today hero with a daily inspiration line, your personal "why", pouches avoided, money saved (₹) and streak. A breathing animation during the urge buffer, confetti for wins (urge beaten, perfect day, personal bests), and 18 achievement badges (including Trigger detective, Trending down and Lock keeper). Pouch-free stretches of 24 h, 48 h, 72 h, 1 week, 2 weeks and 30 days get their own celebration. |
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
| `PUSH_ACCESS_CODE` | If set, the app must enter this code (Settings → Notifications) before it can create schedules or use the AI coach. This stops strangers who find your URL from spending your QStash quota or OpenRouter credits. Recommended once the AI coach is on. |
| `APP_URL` | Overrides the public base URL QStash calls back to (defaults to the Vercel production URL). Set it when you use a custom domain. |

If something isn't set, **Settings → Notifications** lists the missing variables.

## AI coach and autopilot (optional)

The built-in coach works with no setup. To also get AI-written plans and the autopilot:

1. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys), add a few dollars of credit, and set a spending limit on the key.
2. Add `OPENROUTER_API_KEY` in Vercel → Settings → Environment Variables, then redeploy.
3. Open **Coach → AI coach & autopilot**. The autopilot is on by default; *Plan my next 24 hours* asks right away (optionally type a question).

**How the autopilot works.** Every meaningful tap is saved with its time on your device: wake, water, snack, sprouts, timers started and stopped, urges, check-ins, app opens. From these the app works out your *typical times* (the median over 14 days). After you've used the app and things go quiet for 90 seconds, it sends the summary to the planner model, which refreshes your plan and may propose up to 3 schedule changes. The server then asks the review model to confirm, adjust or reject each one. The app applies only what passes both, within fixed limits:

- Only reminder times, wake time, bedtime, walk and circuit times, and the water target can change. The taper (caps, morning lock, gap rule, buffer) never does.
- Each setting has an allowed window (for example, the Energy Shield stays between 15:00 and 17:00). Out-of-range requests are refused, a change moves at most 60 minutes (or 0.5 L) at a time, and changes under 10 minutes are skipped.
- Anything you set yourself in Settings, and any change you undo, is left alone for 7 days.
- It runs at most 4 times a day, at least 2 hours apart, and only after new activity. Push schedules re-sync automatically after a change.

Each run costs about $0.01–0.02 (planner plus review), so a 90-day program costs a few dollars. The Coach card shows the running total.

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Required for the AI coach and autopilot. |
| `OPENROUTER_MODEL` | Optional planner. Any OpenRouter model ID that supports structured outputs. The default is `google/gemini-3.8-flash`; `~google/gemini-flash-latest` always tracks the newest Gemini Flash. |
| `OPENROUTER_REVIEW_MODEL` | Optional reviewer for schedule changes. The default is `openai/gpt-6-sol`; `openai/gpt-6-astra` is stricter but about 5× the cost per check. Set `off` to apply the planner's changes unchecked. |

The app sends numbers and times only (no name or contact details): today, the last 14 days, recent walks and waist, your typical times, and the patterns the built-in coach found. Private stamina data is included only while *Include private stamina data* is ticked, and it is never shown on the Today screen. Each request asks for a strict JSON schema and tells OpenRouter to route only to providers that support it (`provider.require_parameters`). Because the summary is health data, review which providers OpenRouter may use in its privacy settings, and set `PUSH_ACCESS_CODE` so only you can spend your credits.

## Reminders

Every reminder can be switched on or off in Settings. Times tied to your schedule move automatically when you change your wake time or bedtime.

| Reminder | When |
|---|---|
| Wake-up hydration + 90-min lock | wake time |
| Morning micro-set | wake + 20 min |
| Hydration checks | 11:00, 18:00 (editable) |
| Pelvic-floor set | 14:00 (editable; on when *Bedroom stamina* is a focus area) |
| Sprouts + protein before lunch | 12:45 (editable) |
| Afternoon taper check | 15:30 (editable): pouches used vs cap, pacing and your craving peak |
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

**Pacing within a day:** the pouches left are spread evenly from your last pouch (or the end of the morning lock) until last call, one hour before bed, at least 30 minutes apart and at least 2 hours apart from day 31. If you log one early, the app asks you to run the buffer first, and the next window moves later so the cap still lasts the day.

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
  js/taper.js        taper engine: pacing windows, triggers, weekly progress, SOS, withdrawal guide
  js/logic.js        rules, checklist, streaks, stats
  js/coach.js        smart coach: suggestions, patterns, adaptive reminder text, AI summary
  js/achievements.js badges unlocked from your logs
  js/autopilot.js    autopilot: when to run, applying checked changes, undo
  js/notify.js       permission, push subscription, local fallback timers
  js/charts.js       SVG charts with tooltips and data tables
  js/views/*.js      Today, Coach, Taper, Move, Fuel, Progress, Settings
api/push/*.js        Vercel functions: config, sync, once, cancel, unsubscribe, test, deliver
api/coach.js         AI coach: Gemini 3.8 Flash plans, GPT-6 Sol double-checks schedule changes (OpenRouter)
lib/server.js        validation, QStash + web-push helpers
scripts/dev.mjs      zero-dependency local server
test/                node:test suites
```

---

*Track is a personal habit tool, not medical advice. If you have heart, liver or blood-pressure conditions, or severe withdrawal symptoms, talk to a doctor before changing your routine.*
