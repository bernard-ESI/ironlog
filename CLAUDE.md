# IronLog — CLAUDE.md

## What This Is
Offline-first PWA for strength training (Starting Strength NLP focus). Vanilla JS, IndexedDB, Chart.js. No framework, no build step.

**Live:** https://ironlog.bernard-0f6.workers.dev/
**Repo:** github.com/bernard-ESI/ironlog
**Deploys:** Cloudflare Pages, auto-deploy on `git push` to master

---

## Architecture

Single-page app. All state in IndexedDB. Service worker for offline caching (stale-while-revalidate).

### Files
| File | Purpose |
|---|---|
| `public/index.html` | Entry point, nav, timer overlay, plate calc overlay, modals |
| `public/js/app.js` | Main SPA: router, views, workout engine, all UI logic (~2500 lines) |
| `public/js/db.js` | IndexedDB wrapper (DB object), all data access |
| `public/js/timer.js` | RestTimer + WorkoutTimer classes (Web Worker-based countdown) |
| `public/js/programs.js` | DEFAULT_EXERCISES, Starting Strength program template, Progression engine |
| `public/js/plates.js` | Plate calculator logic |
| `public/js/charts.js` | Chart.js wrappers for progress view |
| `public/js/ai.js` | AI workout analysis (optional, needs API key) |
| `public/sw.js` | Service worker — cache-first with stale-while-revalidate |
| `public/css/app.css` | All styles, dark theme, responsive |
| `public/manifest.json` | PWA manifest |
| `server.js` | Local dev server (Node, port 3000) + AI proxy (port 5000) |

### IndexedDB Stores
- `exercises` — Exercise definitions (name, category, trackingType, tracksDistance, etc.)
- `programs` — Program templates (days, sections, exercises, progression rules)
- `workouts` — Workout sessions (date, status, duration, volume, readiness)
- `sets` — Individual sets (weight/reps/duration/distance, completed, RPE, PR flag)
- `personalRecords` — PR history per exercise
- `bodyMetrics` — Body weight, measurements by date
- `settings` — App config (units, timer prefs, API keys, plates)

### Exercise Tracking Types
- `weight` — Barbell, dumbbell, machine. Tracks weight x reps. Has warmups, plate calc, RPE.
- `time` — Cardio, outdoor, plank. Tracks duration (minutes). Countdown timer on checkmark tap.
- `reps_only` — Bodyweight (pull-up, dip, push-up). Tracks reps only, no weight display.

### Distance Tracking
Exercises with `tracksDistance: true` (cardio/outdoor) show a blue distance badge on set rows. Tap to enter miles. Shows in header, history, summary.

---

## Key Patterns

### Cache Busting
All script/link tags in index.html use `?v=N` query strings. Service worker uses `ignoreSearch: true` in cache matching. **When changing any file, bump the version number** in:
1. `sw.js` — `CACHE_NAME = 'ironlog-vN'`
2. `index.html` — all `?v=N` on script/link tags
3. `app.js` — `navigator.serviceWorker.register('/sw.js?v=N')`

Current version: **v14**

### Backfill Pattern
New fields on exercises are backfilled in `DOMContentLoaded` init (app.js lines 22-45). Check `if (field === undefined)` to avoid re-running. Always call `DB.invalidateExerciseCache()` after.

### Window Exports
All functions called from inline `onclick` handlers must be assigned to `window` at bottom of app.js. If adding a new function that's called from HTML templates, add `window.myFunction = myFunction`.

### Timer System
`RestTimer` (timer.js) uses a Web Worker for accurate countdown even when tab is backgrounded. `showRestTimer()` and `showDurationTimer()` both reuse the same `#timer-overlay` element. The `data-mode` attribute controls ring color.

### Program Structure
Programs have days, each day has sections (straight/circuit/superset), each section has exercises with sets/reps/duration config. `getDayExercises(day)` flattens sections for backward compat.

---

## Development

```bash
# Start local dev server
node server.js
# Opens at http://localhost:3000

# AI proxy (optional, needs ANTHROPIC_API_KEY in .env)
# Auto-starts on port 5000 alongside main server

# Deploy
git add . && git commit -m "message" && git push
# Cloudflare Pages auto-deploys from master
```

---

## Current State (v14, Mar 2026)

### Recently Added (v14)
- Section/day reordering in program builder (up/down arrows)
- Weight edit fix: tapping work weight opens weight editor (not plate calc)
- Weight editor button text: "Save Weight"

### Previous (v13)
- StrongLifts 5x5 program template
- Adaptive rest timer (adjusts by RPE)
- Workout counter on home screen
- Calendar view for workout history

### Older
- Time-based tracking (duration for cardio/outdoor/plank)
- Duration countdown timer (blue ring overlay, beeps at 5/3/1s, triple beep on done)
- Mileage tracker (distance in miles for cardio/outdoor)
- Weight editor with typeable input (preserves completed sets on weight change)
- Copy Day feature in program editor
- Multi-section programs (straight/circuit/superset with per-section timers)

### Known Issues
- Duration countdown timer may not trigger on first load after update (service worker cache). Hard refresh fixes it.
- Belt-and-suspenders detection: `toggleSet` checks both `exercise.trackingType` AND `set.targetDuration` for time-based detection.

### Open Items
- Plank should use a shorter countdown (1 min default, currently works)
- No weekly/monthly mileage summary chart yet
- No distance tracking in progress charts yet
