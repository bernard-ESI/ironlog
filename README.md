# IronLog

Offline-first PWA for strength training. Built around Starting Strength Novice Linear Progression but supports custom programs with multi-section days (straight sets, circuits, supersets).

Vanilla JS. No framework. No build step. IndexedDB for all data. Service worker for offline caching.

**Live:** https://ironlog.bernard-0f6.workers.dev/

## Tech Stack

- Vanilla JavaScript (ES6+)
- IndexedDB (via custom db.js wrapper)
- Chart.js for progress charts
- Web Workers for background timers
- Service Worker (stale-while-revalidate caching)
- Cloudflare Pages (deployment)
- Node.js dev server (port 3000)

## File Structure

```
stronglifts-app/
├── public/
│   ├── index.html          Single-page app entry point
│   ├── manifest.json       PWA manifest
│   ├── favicon.svg         App icon
│   ├── sw.js               Service worker (cache v14)
│   ├── css/
│   │   └── app.css         All styles, dark theme, responsive
│   ├── js/
│   │   ├── app.js          Main SPA: router, views, workout engine (~2500 lines)
│   │   ├── db.js           IndexedDB wrapper, all data access
│   │   ├── timer.js        RestTimer + WorkoutTimer (Web Worker countdown)
│   │   ├── programs.js     Default exercises, SS template, progression engine
│   │   ├── plates.js       Plate calculator logic
│   │   ├── charts.js       Chart.js wrappers for progress view
│   │   └── ai.js           AI workout analysis (optional, needs API key)
│   └── audio/              Timer alert sounds
├── server.js               Local dev server (port 3000) + AI proxy (port 5000)
├── CLAUDE.md               Agent instructions
├── PLAN.md                 Roadmap and known issues
└── UPDATE.md               Changelog
```

## Run Locally

```bash
node server.js
# http://localhost:3000
```

AI analysis proxy (optional) starts on port 5000. Requires `ANTHROPIC_API_KEY` in `.env`.

## Deploy

```bash
git add . && git commit -m "message" && git push
```

Cloudflare Pages auto-deploys from `master` branch.

**Cache busting:** When changing any file, bump the version number in three places:
1. `sw.js` -- `CACHE_NAME = 'ironlog-vN'`
2. `index.html` -- all `?v=N` on script/link tags
3. `app.js` -- `navigator.serviceWorker.register('/sw.js?v=N')`

## Current Version

v14. See UPDATE.md for full changelog.
