# IronLog -- Plan

## Current State (v14)

Working features:
- Full workout engine (start, track sets, complete, history)
- Starting Strength NLP + StrongLifts 5x5 built-in templates
- Custom program builder (multi-day, multi-section, reorderable)
- Three tracking types: weight (barbell/DB/machine), time (cardio/plank), reps-only (bodyweight)
- Distance/mileage tracking for cardio exercises
- Plate calculator with configurable plate inventory
- Warmup generator with editable weights
- Rest timer + duration countdown timer (Web Worker, works backgrounded)
- Adaptive rest timer (adjusts by RPE)
- Calendar view of workout history
- Progress charts (Chart.js)
- AI workout analysis (optional, Anthropic API)
- Offline-first (IndexedDB + service worker)
- PWA installable
- Dark theme, responsive

## Known Issues

- Duration countdown timer may not trigger on first load after update (service worker cache). Hard refresh fixes it.
- Belt-and-suspenders detection in `toggleSet`: checks both `exercise.trackingType` AND `set.targetDuration` for time-based. Redundant but safe.
- Plank default countdown works but could use a shorter preset (1 min).

## Missing Features

- No weekly/monthly mileage summary chart
- No distance tracking in progress charts
- No data export/import (backup)
- No body weight chart (bodyMetrics store exists but no UI)
- No exercise-level notes or workout notes
- No PR notifications/celebrations beyond the flag

## Future Ideas

- Export to JSON/CSV for backup
- Body weight tracking view
- Mileage charts (weekly, monthly totals)
- Distance in progress chart overlays
- Workout notes / exercise notes
- Deload week auto-detection
- Share workout summary
- Multi-unit support (kg toggle exists in settings but not fully wired)
