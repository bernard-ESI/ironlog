// IronLog - SPA Router + Views

let currentView = 'workout';
let activeWorkout = null;     // { workout, sets: Map<exerciseId, []> }
let workoutTimer = null;       // elapsed timer interval
let restTimer = null;          // RestTimer instance
let wakeLock = null;
let selectedProgram = null;
let activeRepStrip = null;   // setId with rep strip open

// ── Tracking Type Helpers ─────────────────────────────────
function isTimeBased(exercise) { return exercise?.trackingType === 'time'; }
function isRepsOnly(exercise) { return exercise?.trackingType === 'reps_only'; }
function isWeightBased(exercise) { return !exercise?.trackingType || exercise.trackingType === 'weight'; }

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await DB.init();
  await seedDefaults();

  // Backfill trackingType on existing exercises that lack it
  const allExercises = await DB.getAll('exercises');
  for (const ex of allExercises) {
    if (!ex.trackingType) {
      if (ex.category === 'cardio' || ex.category === 'outdoor') {
        ex.trackingType = 'time';
        ex.defaultDuration = ex.defaultDuration || 30;
      } else if (ex.category === 'bodyweight' && ex.name === 'Plank') {
        ex.trackingType = 'time';
        ex.defaultDuration = 1;
      } else if (ex.category === 'bodyweight') {
        ex.trackingType = 'reps_only';
      } else {
        ex.trackingType = 'weight';
      }
      await DB.put('exercises', ex);
    }
  }
  DB.invalidateExerciseCache();

  restTimer = typeof WorkoutTimer !== 'undefined' ? new WorkoutTimer() : new RestTimer();

  // Load active program
  const programs = await DB.getAll('programs');
  selectedProgram = programs.find(p => p.isDefault) || programs[0];

  // Check for in-progress workout
  const workouts = await DB.getAll('workouts');
  const inProgress = workouts.find(w => w.status === 'in_progress');
  if (inProgress) {
    const sets = await DB.getSetsByWorkout(inProgress.id);
    const setMap = {};
    for (const s of sets) {
      if (!setMap[s.exerciseId]) setMap[s.exerciseId] = [];
      setMap[s.exerciseId].push(s);
    }
    // Restore sections from program day
    let sections = null;
    const prog = programs.find(p => p.id === inProgress.programId);
    if (prog) {
      const day = prog.days.find(d => d.id === inProgress.programDayId);
      if (day) sections = day.sections || null;
    }
    activeWorkout = { workout: inProgress, sets: setMap, sections };
  }

  setupNav();
  navigate(window.location.hash.slice(1) || 'workout');

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js?v=8').catch(() => {});
  }
});

// ── Router ────────────────────────────────────────────────
function navigate(view) {
  currentView = view;
  window.location.hash = view;
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });
  renderView(view);
}

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
}

async function renderView(view) {
  const content = document.getElementById('content');
  const header = document.getElementById('header-title');

  switch (view) {
    case 'workout': header.textContent = 'Workout'; await renderWorkout(content); break;
    case 'history': header.textContent = 'History'; await renderHistory(content); break;
    case 'progress': header.textContent = 'Progress'; await renderProgress(content); break;
    case 'programs': header.textContent = 'Programs'; await renderPrograms(content); break;
    case 'more': header.textContent = 'More'; await renderMore(content); break;
    default: navigate('workout');
  }
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── Wake Lock ─────────────────────────────────────────────
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {}
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// ── WORKOUT VIEW ──────────────────────────────────────────
async function renderWorkout(el) {
  if (activeWorkout) {
    await renderActiveWorkout(el);
    return;
  }

  if (!selectedProgram) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#128170;</div>
      <div class="empty-state-title">No Program Selected</div>
      <p class="text-muted">Go to Programs to select or create one.</p>
    </div>`;
    return;
  }

  const nextDay = await Progression.getNextDay(selectedProgram);
  const exerciseMap = await DB.getExerciseMap();
  const exerciseWeights = {};

  for (const ex of getDayExercises(nextDay)) {
    if (ex.exerciseId) {
      const exercise = exerciseMap[ex.exerciseId];
      if (exercise) {
        exerciseWeights[ex.exerciseId] = await Progression.getNextWeight(ex.exerciseId, exercise, selectedProgram);
      }
    }
  }

  const lastWorkout = await DB.getLastWorkoutForDay(selectedProgram.id, nextDay.id);
  const lastDate = lastWorkout ? new Date(lastWorkout.date).toLocaleDateString() : 'Never';

  el.innerHTML = `
    <div class="workout-status">
      <div class="workout-status-icon">&#127947;</div>
      <div class="workout-status-title">${nextDay.name}</div>
      <div class="workout-status-sub">${selectedProgram.name} &middot; Last: ${lastDate}</div>
    </div>

    ${getDayExercises(nextDay).map(ex => {
      const exercise = exerciseMap[ex.exerciseId];
      if (!exercise) return '';
      const weight = exerciseWeights[ex.exerciseId] || exercise.barbellWeight || 0;
      const timeBased = isTimeBased(exercise);
      const dur = ex.duration || exercise.defaultDuration || 30;
      const targetLabel = timeBased ? `${dur} min` : `${ex.sets}x${ex.reps}`;
      const weightLabel = timeBased ? `${dur} min` : `${weight} lbs`;
      return `<div class="exercise-card">
        <div class="exercise-card-header">
          <div>
            <div class="exercise-name">${exercise.name}</div>
            <div class="exercise-target">${targetLabel}</div>
          </div>
          <div class="exercise-weight">${weightLabel}</div>
        </div>
      </div>`;
    }).join('')}

    <button class="btn btn-primary mt-16" onclick="startWorkout('${nextDay.id}')">
      START WORKOUT
    </button>
  `;
}

async function startWorkout(dayId) {
  const day = selectedProgram.days.find(d => d.id === dayId);
  if (!day) return;

  // Unlock audio on user gesture
  if (restTimer) restTimer.unlockAudio();

  // Show readiness check (optional, skippable)
  showReadinessCheck(dayId);
}

function showReadinessCheck(dayId) {
  showModal(`
    <div class="modal-title">Quick Check-in</div>
    <div class="form-group">
      <label class="form-label">Bodyweight (lbs)</label>
      <input class="form-input" type="number" id="readiness-bw" step="0.1" placeholder="Optional">
    </div>
    <div class="form-group">
      <label class="form-label">How do you feel?</label>
      <div class="chip-group" id="readiness-feel">
        ${[1,2,3,4,5].map(n => `<span class="chip ${n === 3 ? 'active' : ''}" onclick="selectReadiness(this, ${n})">${n === 1 ? '1 Bad' : n === 5 ? '5 Great' : n}</span>`).join('')}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Sleep (hours)</label>
      <input class="form-input" type="number" id="readiness-sleep" step="0.5" placeholder="Optional">
    </div>
    <div class="flex gap-12 mt-16">
      <button class="btn btn-ghost flex-1" onclick="closeModal(); beginWorkout('${dayId}', true)">Skip</button>
      <button class="btn btn-primary flex-1" onclick="closeModal(); beginWorkout('${dayId}', false)">Start</button>
    </div>
  `);
}

function selectReadiness(el, value) {
  el.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

async function beginWorkout(dayId, skipped) {
  const day = selectedProgram.days.find(d => d.id === dayId);
  if (!day) return;

  await requestWakeLock();

  // Gather readiness data
  let readinessData = null;
  if (!skipped) {
    const bw = parseFloat(document.getElementById('readiness-bw')?.value) || null;
    const feelChip = document.querySelector('#readiness-feel .chip.active');
    const feel = feelChip ? parseInt(feelChip.textContent) || 3 : 3;
    const sleep = parseFloat(document.getElementById('readiness-sleep')?.value) || null;
    readinessData = { bodyweight: bw, feel, sleep };

    // Also save bodyweight to body metrics if provided
    if (bw) {
      const today = new Date().toISOString().split('T')[0];
      const existing = await DB.getOneByIndex('bodyMetrics', 'date', today);
      await DB.put('bodyMetrics', { ...(existing || {}), date: today, weight: bw });
    }
  }

  const exerciseMap = await DB.getExerciseMap();
  const now = new Date();
  const workout = {
    programId: selectedProgram.id,
    programDayId: dayId,
    date: now.toISOString().split('T')[0],
    startTime: now.toISOString(),
    endTime: null,
    status: 'in_progress',
    notes: '',
    bodyweight: readinessData?.bodyweight || null,
    readinessScore: readinessData?.feel || null,
    sleepHours: readinessData?.sleep || null,
    totalVolume: 0,
    duration: 0,
    aiAnalysis: null
  };

  const workoutId = await DB.add('workouts', workout);
  workout.id = workoutId;

  const setMap = {};
  let order = 0;

  for (const section of (day.sections || [{ id: 'main', type: 'straight', exercises: getDayExercises(day) }])) {
    for (const programEx of (section.exercises || [])) {
      const exercise = exerciseMap[programEx.exerciseId];
      if (!exercise) continue;

      const workWeight = await Progression.getNextWeight(programEx.exerciseId, exercise, selectedProgram);
      if (!setMap[programEx.exerciseId]) setMap[programEx.exerciseId] = [];

      const timeBased = isTimeBased(exercise);
      const repsOnly = isRepsOnly(exercise);

      // Warmup sets (only for straight sections with weight-based barbell exercises)
      if (section.type === 'straight' && exercise.isBarbell && !timeBased && !repsOnly && setMap[programEx.exerciseId].length === 0) {
        const warmups = generateWarmups(workWeight, exercise.barbellWeight);
        for (const wu of warmups) {
          const s = {
            workoutId, exerciseId: programEx.exerciseId,
            setNumber: 0, targetWeight: wu.weight, targetReps: wu.reps,
            actualWeight: wu.weight, actualReps: 0, rpe: null,
            completed: false, isWarmup: true, isPR: false,
            restTimeSec: 60, notes: wu.label, timestamp: null, order: order++,
            sectionId: section.id || null, roundNumber: null,
            targetDuration: null, actualDuration: null
          };
          s.id = await DB.add('sets', s);
          setMap[programEx.exerciseId].push(s);
        }
      }

      // Work sets (circuits/supersets multiply by rounds)
      const numRounds = (section.type === 'circuit' || section.type === 'superset') ? (section.rounds || 1) : 1;
      const setsPerRound = programEx.sets || 1;
      const totalSets = numRounds * setsPerRound;
      const duration = programEx.duration || exercise.defaultDuration || 30;

      for (let i = 1; i <= totalSets; i++) {
        const roundNum = numRounds > 1 ? Math.ceil(i / setsPerRound) : null;
        const s = {
          workoutId, exerciseId: programEx.exerciseId,
          setNumber: i,
          targetWeight: timeBased ? 0 : workWeight,
          targetReps: timeBased ? 0 : programEx.reps,
          actualWeight: timeBased ? 0 : workWeight,
          actualReps: 0, rpe: null,
          completed: false, isWarmup: false, isPR: false,
          restTimeSec: exercise.defaultRestSec, notes: '', timestamp: null, order: order++,
          sectionId: section.id || null, roundNumber: roundNum,
          targetDuration: timeBased ? duration : null,
          actualDuration: timeBased ? duration : null
        };
        s.id = await DB.add('sets', s);
        setMap[programEx.exerciseId].push(s);
      }
    }
  }

  activeWorkout = { workout, sets: setMap, sections: day.sections || null };
  startWorkoutTimer();
  renderView('workout');
}

function startWorkoutTimer() {
  const start = new Date(activeWorkout.workout.startTime);
  if (workoutTimer) clearInterval(workoutTimer);
  workoutTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start.getTime()) / 1000);
    const timerEl = document.getElementById('workout-elapsed');
    if (timerEl) timerEl.textContent = formatTime(elapsed);
  }, 1000);
}

async function renderActiveWorkout(el) {
  const exerciseMap = await DB.getExerciseMap();

  // Pre-fetch last session data for each exercise
  const lastSessions = {};
  for (const exId of Object.keys(activeWorkout.sets)) {
    lastSessions[exId] = await DB.getLastSetsForExercise(Number(exId));
  }

  const start = new Date(activeWorkout.workout.startTime);
  const elapsed = Math.floor((Date.now() - start.getTime()) / 1000);

  startWorkoutTimer();

  el.innerHTML = `
    <div class="workout-active-bar">
      <span class="text-sm font-bold">IN PROGRESS</span>
      <span class="workout-timer" id="workout-elapsed">${formatTime(elapsed)}</span>
    </div>

    ${renderWorkoutExercises(activeWorkout, exerciseMap, lastSessions)}

    <textarea class="workout-notes" id="workout-notes"
      placeholder="Workout notes..."
      oninput="activeWorkout.workout.notes = this.value"
    >${activeWorkout.workout.notes || ''}</textarea>

    <div class="flex gap-12 mt-16">
      <button class="btn btn-danger flex-1" onclick="cancelWorkout()">Cancel</button>
      <button class="btn btn-success flex-1" onclick="finishWorkout()">Finish</button>
    </div>
  `;
}

function renderWorkoutExercises(aw, exerciseMap, lastSessions) {
  // Build section -> exerciseId mapping
  const sections = aw.sections || null;
  if (!sections) {
    // No sections: flat exercise list (legacy)
    return Object.entries(aw.sets).map(([exId, sets]) =>
      renderExerciseBlock(exId, sets, exerciseMap, lastSessions)
    ).join('');
  }

  // Group exercises by sectionId
  const sectionExercises = {};
  for (const section of sections) {
    sectionExercises[section.id] = [];
    for (const ex of (section.exercises || [])) {
      if (aw.sets[ex.exerciseId]) {
        sectionExercises[section.id].push(ex.exerciseId);
      }
    }
  }

  // Collect exerciseIds that belong to a section
  const assignedExIds = new Set();
  for (const exIds of Object.values(sectionExercises)) {
    for (const id of exIds) assignedExIds.add(String(id));
  }

  let html = '';

  for (const section of sections) {
    const exIds = sectionExercises[section.id] || [];
    if (exIds.length === 0) continue;

    // Section header
    const color = getSectionTypeColor(section.type);
    const roundLabel = (section.type === 'circuit' || section.type === 'superset') && section.rounds > 1
      ? ` &middot; ${section.rounds} rounds`
      : '';
    html += `<div class="workout-section-header" style="border-left-color: ${color}">
      <span class="section-type-badge ${section.type}">${section.type.toUpperCase()}</span>
      <span class="workout-section-name">${section.name}${roundLabel}</span>
    </div>`;

    // Render exercises in this section
    for (const exId of exIds) {
      html += renderExerciseBlock(exId, aw.sets[exId], exerciseMap, lastSessions);
    }
  }

  // Render any exercises not assigned to a section (orphans from old data)
  for (const [exId, sets] of Object.entries(aw.sets)) {
    if (!assignedExIds.has(exId)) {
      html += renderExerciseBlock(exId, sets, exerciseMap, lastSessions);
    }
  }

  return html;
}

function renderExerciseBlock(exId, sets, exerciseMap, lastSessions) {
  const exercise = exerciseMap[exId];
  if (!exercise) return '';
  const workSets = sets.filter(s => !s.isWarmup);
  const warmupSets = sets.filter(s => s.isWarmup);
  const completed = workSets.filter(s => s.completed).length;
  const total = workSets.length;
  const timeBased = isTimeBased(exercise);
  const repsOnly = isRepsOnly(exercise);

  const warmupDone = warmupSets.length > 0 && warmupSets.every(s => s.completed);
  const workWeight = workSets[0]?.targetWeight || 0;
  const workDuration = workSets[0]?.targetDuration || 0;

  // Header display value
  const headerValue = timeBased ? `${workDuration} min` : `${workWeight} lbs`;

  const lastData = lastSessions[exId];
  let lastTimeHtml = '';
  if (lastData) {
    if (timeBased) {
      const lastDur = lastData.sets[0]?.actualDuration || lastData.sets[0]?.targetDuration || 0;
      lastTimeHtml = `<div class="last-time">Last: ${lastDur} min (${formatDate(lastData.date)})</div>`;
    } else {
      lastTimeHtml = `<div class="last-time">Last: ${lastData.sets[0]?.actualWeight || 0} x${lastData.sets.map(s => s.actualReps).join(',')} (${formatDate(lastData.date)})</div>`;
    }
  }

  // Bottom buttons: plate calc + edit weight/duration
  let bottomButtons;
  if (timeBased) {
    bottomButtons = `<div class="flex items-center justify-between mt-8">
      <span></span>
      <button class="btn btn-ghost btn-sm" onclick="editDuration(${exId})">Edit Duration</button>
    </div>`;
  } else {
    bottomButtons = `<div class="flex items-center justify-between mt-8">
      <button class="btn btn-ghost btn-sm" onclick="openPlateCalc(${workWeight})">Plates</button>
      <button class="btn btn-ghost btn-sm" onclick="editWeight(${exId})">Edit Weight</button>
    </div>`;
  }

  return `<div class="exercise-card" id="ex-${exId}">
    <div class="exercise-card-header" onclick="toggleExercise(${exId})">
      <div>
        <div class="exercise-name">${exercise.name}</div>
        <div class="exercise-target">${completed}/${total} sets</div>
        ${lastTimeHtml}
      </div>
      <div class="exercise-weight">${headerValue}</div>
    </div>
    <div class="exercise-card-body">
      ${warmupSets.length > 0 ? `
      <div class="warmup-section ${warmupDone ? 'collapsed' : ''}" id="warmup-${exId}">
        <div class="warmup-header" onclick="toggleWarmup(${exId})">
          <span>WARMUP &middot; ${warmupSets.filter(s => s.completed).length}/${warmupSets.length}</span>
          <span class="warmup-chevron">${warmupDone ? '\u25B6' : '\u25BC'}</span>
        </div>
        <div class="warmup-sets">
          ${warmupSets.map(s => renderSetRow(s, exercise, true, workWeight)).join('')}
        </div>
      </div>
      <div class="warmup-work-divider"></div>
      ` : ''}
      ${workSets.map(s => {
        const roundPrefix = s.roundNumber ? `<span class="set-round-tag">R${s.roundNumber}</span>` : '';
        return roundPrefix + renderSetRow(s, exercise, false, 0);
      }).join('')}
      ${bottomButtons}
    </div>
  </div>`;
}

function renderSetRow(set, exercise, isWarmup, workWeight) {
  const label = isWarmup ? 'W' : set.setNumber;
  const checkClass = set.completed
    ? (isWarmup ? 'set-check warmup-completed' : 'set-check completed')
    : 'set-check';
  const rpeClass = set.rpe >= 9 ? 'high' : '';
  const pct = isWarmup && workWeight > 0
    ? `<span class="warmup-pct">${Math.round((set.targetWeight / workWeight) * 100)}%</span>`
    : '';

  const timeBased = isTimeBased(exercise);

  // Weight/duration cell
  let weightCell;
  if (timeBased) {
    const dur = set.actualDuration || set.targetDuration || 0;
    const isRunning = activeDurationTimer?.setId === set.id;
    const durLabel = isRunning ? 'Running...' : (set.completed ? `${dur} min` : `${dur} min`);
    weightCell = `<span class="set-weight${isRunning ? ' text-primary' : ''}">${durLabel}</span>`;
  } else {
    weightCell = `<span class="set-weight" onclick="openPlateCalc(${set.targetWeight})">${set.actualWeight} lbs</span>`;
  }

  // Reps badge: tappable for partial reps (work sets only), hidden for time-based
  let repsBadge = '';
  if (timeBased) {
    // No reps badge for time-based — just the checkmark
    repsBadge = '';
  } else if (isWarmup) {
    repsBadge = `<span class="set-target">x${set.targetReps}</span>`;
  } else if (set.completed) {
    const isPartial = set.actualReps < set.targetReps;
    const badgeClass = isPartial ? 'reps-badge partial' : 'reps-badge full';
    repsBadge = `<span class="${badgeClass}" onclick="toggleRepStrip(${set.id})">${set.actualReps}/${set.targetReps}</span>`;
  } else {
    repsBadge = `<span class="reps-badge" onclick="toggleRepStrip(${set.id})">x${set.targetReps}</span>`;
  }

  // Number strip for selecting actual reps (not for time-based)
  const stripOpen = activeRepStrip === set.id;
  const strip = (!isWarmup && !timeBased && stripOpen) ? `<div class="reps-strip">
    ${Array.from({length: set.targetReps + 1}, (_, i) =>
      `<button class="reps-strip-btn ${set.actualReps === i && set.completed ? 'active' : ''}" onclick="setActualReps(${set.id}, ${i})">${i}</button>`
    ).join('')}
  </div>` : '';

  return `<div class="set-row ${isWarmup ? 'warmup' : ''}">
    <span class="set-label">${label}</span>
    ${weightCell}
    ${repsBadge}
    ${pct}
    <div class="${checkClass}" onclick="toggleSet(${set.id})">
      ${set.completed ? '\u2713' : ''}
    </div>
    ${!isWarmup && !timeBased ? `<span class="rpe-badge ${rpeClass}" onclick="setRPE(${set.id})">${set.rpe ? `@${set.rpe}` : 'RPE'}</span>` : ''}
  </div>
  ${strip}`;
}

let activeDurationTimer = null; // { setId, interval, startTime, totalSec }

async function toggleSet(setId) {
  // Find the set
  for (const [exId, sets] of Object.entries(activeWorkout.sets)) {
    const set = sets.find(s => s.id === setId);
    if (!set) continue;

    const exercise = (await DB.getExerciseMap())[exId];

    // Time-based exercises: tap starts/stops a countdown timer
    if (isTimeBased(exercise) && !set.isWarmup) {
      if (set.completed) {
        // Uncheck — cancel completion
        set.completed = false;
        set.actualReps = 0;
        set.timestamp = null;
        await DB.put('sets', set);
        renderView('workout');
      } else if (activeDurationTimer?.setId === setId) {
        // Timer running for this set — tap again to finish early
        clearInterval(activeDurationTimer.interval);
        const elapsedSec = Math.floor((Date.now() - activeDurationTimer.startTime) / 1000);
        set.actualDuration = Math.round(elapsedSec / 60 * 10) / 10; // round to 0.1 min
        activeDurationTimer = null;
        set.completed = true;
        set.timestamp = new Date().toISOString();
        if (navigator.vibrate) navigator.vibrate(10);
        await DB.put('sets', set);
        renderView('workout');
      } else {
        // Start countdown timer
        const durationSec = (set.targetDuration || 30) * 60;
        const startTime = Date.now();
        activeDurationTimer = { setId, startTime, totalSec: durationSec };
        showDurationTimer(durationSec, exercise.name, set);
      }
      break;
    }

    if (set.completed) {
      // Uncheck -- mark incomplete
      set.completed = false;
      set.actualReps = 0;
    } else {
      // Check -- mark complete with all target reps hit
      set.completed = true;
      set.actualReps = set.targetReps;
      // Haptic feedback
      if (navigator.vibrate) navigator.vibrate(10);
    }

    set.timestamp = new Date().toISOString();
    await DB.put('sets', set);

    // If set completed, start rest timer (shorter for warmups)
    if (set.completed && exercise) {
      if (set.isWarmup) {
        // Auto-collapse warmups when all done
        autoCollapseWarmup(exId);
      } else {
        // Check if this is a circuit/superset round boundary
        const sectionInfo = getSectionForSet(set);
        if (sectionInfo && (sectionInfo.type === 'circuit' || sectionInfo.type === 'superset') && sectionInfo.restBetweenRounds > 0) {
          // Check if we just completed last exercise in a round
          if (isRoundComplete(set, sectionInfo)) {
            showRestTimer(sectionInfo.restBetweenRounds, sectionInfo.name, set, 'circuit');
          }
          // No per-set rest for circuits (just round rest)
        } else {
          const prevSet = sets.find(s => s.setNumber === set.setNumber - 1 && !s.isWarmup);
          const restSec = calculateRestTime(exercise, set, prevSet);
          showRestTimer(restSec, exercise.name, set);
        }
      }
    }

    renderView('workout');
    break;
  }
}

function showDurationTimer(totalSec, exerciseName, set) {
  const overlay = document.getElementById('timer-overlay');
  overlay.classList.remove('hidden');
  overlay.dataset.mode = 'duration';

  const modeLabel = document.getElementById('timer-mode-label');
  if (modeLabel) modeLabel.textContent = 'DURATION';

  const pauseBtn = document.getElementById('timer-pause-btn');
  if (pauseBtn) pauseBtn.textContent = 'PAUSE';

  const circumference = 2 * Math.PI * 100;
  const ring = document.getElementById('timer-ring-progress');
  ring.style.strokeDasharray = circumference;
  ring.style.stroke = '#3b82f6'; // blue for duration

  const timeDisplay = document.getElementById('timer-time');
  const labelDisplay = document.getElementById('timer-exercise-label');
  labelDisplay.textContent = exerciseName;

  timeDisplay.textContent = formatTime(totalSec);
  ring.style.strokeDashoffset = 0;

  // Use the rest timer for the countdown
  restTimer.onTick = (remaining, total) => {
    timeDisplay.textContent = formatTime(remaining);
    const pct = remaining / total;
    ring.style.strokeDashoffset = circumference * (1 - pct);
  };

  restTimer.onDone = async () => {
    overlay.classList.add('hidden');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

    // Auto-complete the set
    if (activeDurationTimer) {
      set.completed = true;
      set.actualDuration = set.targetDuration;
      set.timestamp = new Date().toISOString();
      activeDurationTimer = null;
      await DB.put('sets', set);
      showToast(`${exerciseName} complete!`, 'success');
      renderView('workout');
    }
  };

  restTimer.start(totalSec);
}

function toggleRepStrip(setId) {
  activeRepStrip = activeRepStrip === setId ? null : setId;
  renderView('workout');
}

async function setActualReps(setId, reps) {
  for (const [exId, sets] of Object.entries(activeWorkout.sets)) {
    const set = sets.find(s => s.id === setId);
    if (!set) continue;

    set.actualReps = reps;
    set.completed = reps > 0;
    set.timestamp = new Date().toISOString();
    await DB.put('sets', set);
    activeRepStrip = null;

    if (set.completed && !set.isWarmup) {
      const exercise = (await DB.getExerciseMap())[exId];
      if (exercise) {
        if (navigator.vibrate) navigator.vibrate(10);
        const prevSet = sets.find(s => s.setNumber === set.setNumber - 1 && !s.isWarmup);
        const restSec = calculateRestTime(exercise, set, prevSet);
        showRestTimer(restSec, exercise.name, set);
      }
    }

    renderView('workout');
    break;
  }
}

async function setRPE(setId) {
  for (const [exId, sets] of Object.entries(activeWorkout.sets)) {
    const set = sets.find(s => s.id === setId);
    if (!set) continue;

    // Cycle through RPE values: none -> 6 -> 7 -> 8 -> 9 -> 10 -> none
    const rpeValues = [null, 6, 7, 8, 9, 10];
    const currentIdx = rpeValues.indexOf(set.rpe);
    set.rpe = rpeValues[(currentIdx + 1) % rpeValues.length];

    await DB.put('sets', set);
    renderView('workout');
    break;
  }
}

async function editWeight(exerciseId) {
  const sets = activeWorkout.sets[exerciseId];
  if (!sets) return;
  const workSets = sets.filter(s => !s.isWarmup);
  const currentWeight = workSets[0]?.targetWeight || 45;
  const exerciseMap = await DB.getExerciseMap();
  const exercise = exerciseMap[exerciseId];
  const settings = await DB.getSettings();

  // Show weight editor bottom sheet
  window._weightEditTarget = { exerciseId, currentWeight };
  const plates = calculatePlates(currentWeight, exercise?.barbellWeight || 45, settings.availablePlates);

  showModal(`
    <div class="modal-title">Edit Weight</div>
    <div class="weight-editor">
      <input type="number" class="weight-editor-input" id="weight-edit-input" value="${currentWeight}"
        min="0" step="2.5" oninput="onWeightInputChange(this.value)">
      <div class="weight-editor-unit">lbs</div>
    </div>
    <div class="weight-editor-controls">
      <button class="weight-btn" onclick="adjustEditWeight(-10)">-10</button>
      <button class="weight-btn" onclick="adjustEditWeight(-5)">-5</button>
      <button class="weight-btn" onclick="adjustEditWeight(-2.5)">-2.5</button>
      <button class="weight-btn" onclick="adjustEditWeight(2.5)">+2.5</button>
      <button class="weight-btn" onclick="adjustEditWeight(5)">+5</button>
      <button class="weight-btn" onclick="adjustEditWeight(10)">+10</button>
    </div>
    <div class="weight-editor-plates" id="weight-edit-plates">${formatPlateBreakdown(plates)}</div>
    <button class="btn btn-primary mt-16" onclick="confirmWeightEdit()">Apply</button>
  `);
}

function adjustEditWeight(delta) {
  if (!window._weightEditTarget) return;
  const newWeight = Math.max(0, window._weightEditTarget.currentWeight + delta);
  window._weightEditTarget.currentWeight = newWeight;
  const input = document.getElementById('weight-edit-input');
  if (input) input.value = newWeight;

  // Update plate display
  DB.getSettings().then(settings => {
    const plates = calculatePlates(newWeight, 45, settings.availablePlates);
    const platesEl = document.getElementById('weight-edit-plates');
    if (platesEl) platesEl.textContent = formatPlateBreakdown(plates);
  });
}

function onWeightInputChange(value) {
  if (!window._weightEditTarget) return;
  const newWeight = Math.max(0, parseFloat(value) || 0);
  window._weightEditTarget.currentWeight = newWeight;

  // Update plate display
  DB.getSettings().then(settings => {
    const plates = calculatePlates(newWeight, 45, settings.availablePlates);
    const platesEl = document.getElementById('weight-edit-plates');
    if (platesEl) platesEl.textContent = formatPlateBreakdown(plates);
  });
}

async function confirmWeightEdit() {
  if (!window._weightEditTarget) return;
  const { exerciseId, currentWeight: w } = window._weightEditTarget;
  window._weightEditTarget = null;
  closeModal();

  if (isNaN(w) || w < 0) return;

  const sets = activeWorkout.sets[exerciseId];
  const workSets = sets.filter(s => !s.isWarmup);
  const oldWarmups = sets.filter(s => s.isWarmup);
  const exerciseMap = await DB.getExerciseMap();
  const exercise = exerciseMap[exerciseId];

  // Update only uncompleted work sets (preserve completed sets' recorded weight)
  for (const s of workSets) {
    if (!s.completed) {
      s.targetWeight = w;
      s.actualWeight = w;
      await DB.put('sets', s);
    }
  }

  // Regenerate warmup sets for new weight
  if (exercise && exercise.isBarbell) {
    for (const s of oldWarmups) {
      await DB.delete('sets', s.id);
    }

    const newWarmups = generateWarmups(w, exercise.barbellWeight || 45);
    const newWarmupSets = [];
    let order = 0;
    for (const wu of newWarmups) {
      const s = {
        workoutId: activeWorkout.workout.id, exerciseId: Number(exerciseId),
        setNumber: 0, targetWeight: wu.weight, targetReps: wu.reps,
        actualWeight: wu.weight, actualReps: 0, rpe: null,
        completed: false, isWarmup: true, isPR: false,
        restTimeSec: 60, notes: wu.label, timestamp: null, order: order++
      };
      s.id = await DB.add('sets', s);
      newWarmupSets.push(s);
    }

    activeWorkout.sets[exerciseId] = [...newWarmupSets, ...workSets];
  }

  renderView('workout');
}

async function editDuration(exerciseId) {
  const sets = activeWorkout.sets[exerciseId];
  if (!sets) return;
  const workSets = sets.filter(s => !s.isWarmup);
  const currentDuration = workSets[0]?.targetDuration || 30;

  window._durationEditTarget = { exerciseId, currentDuration };

  showModal(`
    <div class="modal-title">Edit Duration</div>
    <div class="weight-editor">
      <input type="number" class="weight-editor-input" id="duration-edit-input" value="${currentDuration}"
        min="1" step="1">
      <div class="weight-editor-unit">min</div>
    </div>
    <div class="weight-editor-controls">
      <button class="weight-btn" onclick="adjustEditDuration(-10)">-10</button>
      <button class="weight-btn" onclick="adjustEditDuration(-5)">-5</button>
      <button class="weight-btn" onclick="adjustEditDuration(-1)">-1</button>
      <button class="weight-btn" onclick="adjustEditDuration(1)">+1</button>
      <button class="weight-btn" onclick="adjustEditDuration(5)">+5</button>
      <button class="weight-btn" onclick="adjustEditDuration(10)">+10</button>
    </div>
    <button class="btn btn-primary mt-16" onclick="confirmDurationEdit()">Apply</button>
  `);
}

function adjustEditDuration(delta) {
  if (!window._durationEditTarget) return;
  const newDur = Math.max(1, window._durationEditTarget.currentDuration + delta);
  window._durationEditTarget.currentDuration = newDur;
  const input = document.getElementById('duration-edit-input');
  if (input) input.value = newDur;
}

async function confirmDurationEdit() {
  if (!window._durationEditTarget) return;
  const { exerciseId } = window._durationEditTarget;
  const input = document.getElementById('duration-edit-input');
  const dur = Math.max(1, parseInt(input?.value) || 30);
  window._durationEditTarget = null;
  closeModal();

  const sets = activeWorkout.sets[exerciseId];
  const workSets = sets.filter(s => !s.isWarmup);

  for (const s of workSets) {
    if (!s.completed) {
      s.targetDuration = dur;
      s.actualDuration = dur;
      await DB.put('sets', s);
    }
  }

  renderView('workout');
}

function toggleExercise(exId) {
  const body = document.querySelector(`#ex-${exId} .exercise-card-body`);
  if (body) body.classList.toggle('hidden');
}

function toggleWarmup(exId) {
  const section = document.getElementById(`warmup-${exId}`);
  if (section) section.classList.toggle('collapsed');
}

function autoCollapseWarmup(exId) {
  const sets = activeWorkout.sets[exId];
  if (!sets) return;
  const warmups = sets.filter(s => s.isWarmup);
  if (warmups.length > 0 && warmups.every(s => s.completed)) {
    const section = document.getElementById(`warmup-${exId}`);
    if (section) section.classList.add('collapsed');
  }
}

function getSectionForSet(set) {
  if (!activeWorkout?.sections || !set.sectionId) return null;
  return activeWorkout.sections.find(s => s.id === set.sectionId) || null;
}

function isRoundComplete(completedSet, section) {
  if (!activeWorkout || !section || !completedSet.roundNumber) return false;
  // Check all exercises in this section for this round
  for (const ex of (section.exercises || [])) {
    const sets = activeWorkout.sets[ex.exerciseId];
    if (!sets) continue;
    const roundSets = sets.filter(s => s.sectionId === section.id && s.roundNumber === completedSet.roundNumber && !s.isWarmup);
    if (roundSets.some(s => !s.completed)) return false;
  }
  return true;
}

async function finishWorkout() {
  if (!activeWorkout) return;

  const now = new Date();
  const start = new Date(activeWorkout.workout.startTime);
  const duration = Math.floor((now - start) / 60000);

  // Calculate total volume (skip time-based exercises)
  let totalVolume = 0;
  const exerciseMapForVolume = await DB.getExerciseMap();
  for (const [exId, sets] of Object.entries(activeWorkout.sets)) {
    const ex = exerciseMapForVolume[exId];
    if (isTimeBased(ex)) continue; // Duration doesn't contribute to volume
    for (const s of sets) {
      if (!s.isWarmup && s.completed) {
        totalVolume += s.actualWeight * s.actualReps;
      }
    }
  }

  activeWorkout.workout.endTime = now.toISOString();
  activeWorkout.workout.status = 'completed';
  activeWorkout.workout.duration = duration;
  activeWorkout.workout.totalVolume = totalVolume;

  await DB.put('workouts', activeWorkout.workout);

  // Check for PRs (skip time-based exercises)
  const exerciseMap = await DB.getExerciseMap();
  for (const [exId, sets] of Object.entries(activeWorkout.sets)) {
    const ex = exerciseMap[exId];
    if (isTimeBased(ex)) continue; // No weight PRs for duration exercises
    const workSets = sets.filter(s => !s.isWarmup && s.completed);
    for (const s of workSets) {
      const result = await DB.checkAndUpdatePR(
        Number(exId), `${s.targetReps}rm`,
        s.actualWeight, s.actualReps,
        activeWorkout.workout.id, activeWorkout.workout.date
      );
      if (result.isNewPR) {
        showToast(`PR! ${ex?.name || ''}: ${s.actualWeight}x${s.actualReps}`, 'pr');
      }
    }
  }

  clearInterval(workoutTimer);
  releaseWakeLock();

  // Check for stalls
  const stalls = [];
  for (const [exId, sets] of Object.entries(activeWorkout.sets)) {
    const workSets = sets.filter(s => !s.isWarmup && s.completed);
    if (workSets.length === 0) continue;
    const exercise = exerciseMap[exId];
    if (!exercise) continue;
    const status = await Progression.checkNLPStatus(Number(exId), exercise, selectedProgram);
    if (status.status !== 'progressing') {
      stalls.push(status);
    }
  }

  // Show summary view
  showWorkoutSummary(activeWorkout, stalls);
}

async function cancelWorkout() {
  if (!activeWorkout) return;
  if (!confirm('Cancel this workout? Data will be lost.')) return;

  // Delete all sets for this workout
  for (const sets of Object.values(activeWorkout.sets)) {
    for (const s of sets) await DB.delete('sets', s.id);
  }
  await DB.delete('workouts', activeWorkout.workout.id);

  clearInterval(workoutTimer);
  releaseWakeLock();
  activeWorkout = null;
  showToast('Workout cancelled');
  renderView('workout');
}

// ── WORKOUT SUMMARY ──────────────────────────────────────
async function showWorkoutSummary(workoutData, stalls) {
  const exerciseMap = await DB.getExerciseMap();
  const workout = workoutData.workout;
  const allSets = Object.values(workoutData.sets).flat();
  const workSets = allSets.filter(s => !s.isWarmup);
  const completedSets = workSets.filter(s => s.completed);

  const duration = workout.duration || 0;
  const totalVolume = workout.totalVolume || 0;
  const totalReps = completedSets.reduce((sum, s) => sum + s.actualReps, 0);

  // Per-exercise breakdown
  const byExercise = {};
  for (const s of workSets) {
    if (!byExercise[s.exerciseId]) byExercise[s.exerciseId] = [];
    byExercise[s.exerciseId].push(s);
  }

  const exerciseBreakdown = Object.entries(byExercise).map(([exId, sets]) => {
    const ex = exerciseMap[exId];
    const name = ex?.name || 'Unknown';
    const completed = sets.filter(s => s.completed);
    const timeBased = isTimeBased(ex);
    const prSets = sets.filter(s => s.isPR);

    if (timeBased) {
      const totalDur = completed.reduce((sum, s) => sum + (s.actualDuration || s.targetDuration || 0), 0);
      return `<div class="summary-exercise">
        <div class="summary-exercise-header">
          <span class="summary-exercise-name">${name}</span>
          <span class="text-muted text-sm">${totalDur} min</span>
        </div>
        <div class="summary-exercise-sets">${totalDur} min total</div>
        <div class="summary-exercise-stats">
          <span>${completed.length}/${sets.length} sets</span>
        </div>
      </div>`;
    }

    const maxWeight = Math.max(...sets.map(s => s.actualWeight), 0);
    const volume = completed.reduce((sum, s) => sum + s.actualWeight * s.actualReps, 0);
    const repsStr = sets.map(s => s.completed ? s.actualReps : `${s.actualReps}F`).join(', ');

    return `<div class="summary-exercise">
      <div class="summary-exercise-header">
        <span class="summary-exercise-name">${name}</span>
        <span class="text-muted text-sm">${maxWeight} lbs</span>
      </div>
      <div class="summary-exercise-sets">${sets[0]?.actualWeight}x[${repsStr}]</div>
      <div class="summary-exercise-stats">
        <span>${completed.length}/${sets.length} sets</span>
        <span>${volume.toLocaleString()} lbs vol</span>
        ${prSets.length > 0 ? '<span class="text-warning">PR!</span>' : ''}
      </div>
    </div>`;
  }).join('');

  // Stall alerts
  const stallHtml = stalls.length > 0
    ? `<div class="summary-stalls">
        <div class="summary-stalls-header">Stall Alerts</div>
        ${stalls.map(s => `<div class="summary-stall-item">${s.message}</div>`).join('')}
      </div>`
    : '';

  // Readiness display
  const readinessHtml = workout.readinessScore
    ? `<div class="summary-stat"><span>Feel</span><span>${workout.readinessScore}/5</span></div>` : '';
  const sleepHtml = workout.sleepHours
    ? `<div class="summary-stat"><span>Sleep</span><span>${workout.sleepHours}h</span></div>` : '';

  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="summary-header">
      <div class="summary-header-icon">&#9989;</div>
      <div class="summary-header-title">Workout Complete!</div>
      <div class="summary-header-sub">${formatDate(workout.date)}</div>
    </div>

    <div class="summary-stats-grid">
      <div class="summary-stat"><span>Duration</span><span>${duration} min</span></div>
      <div class="summary-stat"><span>Volume</span><span>${totalVolume.toLocaleString()} lbs</span></div>
      <div class="summary-stat"><span>Sets</span><span>${completedSets.length}/${workSets.length}</span></div>
      <div class="summary-stat"><span>Reps</span><span>${totalReps}</span></div>
      ${readinessHtml}
      ${sleepHtml}
    </div>

    <div class="summary-section-title">Exercises</div>
    ${exerciseBreakdown}

    ${stallHtml}

    <div class="summary-ai-section" id="summary-ai">
      <button class="btn btn-secondary" id="ai-analyze-btn" onclick="requestAIAnalysis()">
        Analyze with AI
      </button>
    </div>

    ${workout.notes ? `<div class="summary-notes">${workout.notes}</div>` : ''}

    <button class="btn btn-primary mt-16 mb-16" onclick="closeSummary()">Done</button>
  `;

  // Store reference for AI analysis
  window._summaryWorkout = workoutData;
}

async function requestAIAnalysis() {
  const btn = document.getElementById('ai-analyze-btn');
  const aiSection = document.getElementById('summary-ai');
  if (!window._summaryWorkout) return;

  const settings = await DB.getSettings();
  if (!settings.aiEnabled && !settings.backendUrl) {
    aiSection.innerHTML = '<div class="text-muted text-sm">Enable AI in Settings to use this feature.</div>';
    return;
  }

  btn.textContent = 'Analyzing...';
  btn.disabled = true;

  try {
    const exerciseMap = await DB.getExerciseMap();
    const workout = window._summaryWorkout.workout;
    const allSets = Object.values(window._summaryWorkout.sets).flat();

    // Get history for exercises in this workout
    const history = [];
    for (const exId of Object.keys(window._summaryWorkout.sets)) {
      const exHistory = await DB.getExerciseHistory(Number(exId), 5);
      history.push(...exHistory);
    }

    const analysis = await analyzeWorkout('post_workout', {
      workout,
      sets: allSets,
      exercises: exerciseMap,
      history
    }, settings);

    // Save to workout
    workout.aiAnalysis = analysis;
    await DB.put('workouts', workout);

    aiSection.innerHTML = `
      <div class="ai-card">
        <div class="ai-card-header">AI Analysis</div>
        <div class="ai-card-body">${analysis}</div>
      </div>`;
  } catch (err) {
    aiSection.innerHTML = `<div class="text-warning text-sm">AI analysis failed: ${err.message}</div>`;
  }
}

function closeSummary() {
  window._summaryWorkout = null;
  activeWorkout = null;
  renderView('workout');
}

// ── REST TIMER ────────────────────────────────────────────
function showRestTimer(seconds, exerciseName, lastSet, mode) {
  const overlay = document.getElementById('timer-overlay');
  overlay.classList.remove('hidden');

  // Set mode styling
  const timerMode = mode || 'rest';
  overlay.dataset.mode = timerMode;
  const modeLabel = document.getElementById('timer-mode-label');
  if (modeLabel) modeLabel.textContent = timerMode === 'rest' ? '' : timerMode.toUpperCase();

  // Reset pause button
  const pauseBtn = document.getElementById('timer-pause-btn');
  if (pauseBtn) pauseBtn.textContent = 'PAUSE';

  const circumference = 2 * Math.PI * 100;
  const ring = document.getElementById('timer-ring-progress');
  ring.style.strokeDasharray = circumference;

  // Color ring by mode
  const modeColors = { rest: '#e94560', circuit: '#fbbf24', emom: '#e94560', amrap: '#4ade80', superset: '#8b5cf6' };
  ring.style.stroke = modeColors[timerMode] || modeColors.rest;

  const timeDisplay = document.getElementById('timer-time');
  const labelDisplay = document.getElementById('timer-exercise-label');
  if (timerMode === 'circuit') {
    labelDisplay.textContent = `Round rest - ${exerciseName}`;
  } else if (timerMode === 'emom') {
    labelDisplay.textContent = `EMOM - ${exerciseName}`;
  } else if (timerMode === 'amrap') {
    labelDisplay.textContent = `AMRAP - ${exerciseName}`;
  } else {
    labelDisplay.textContent = `Rest after ${exerciseName} Set ${lastSet.setNumber}`;
  }

  restTimer.onTick = (remaining, total) => {
    timeDisplay.textContent = formatTime(remaining);
    const pct = remaining / total;
    ring.style.strokeDashoffset = circumference * (1 - pct);
  };

  restTimer.onDone = () => {
    overlay.classList.add('hidden');
  };

  timeDisplay.textContent = formatTime(seconds);
  ring.style.strokeDashoffset = 0;
  restTimer.start(seconds);
}

function timerAdjust(delta) {
  restTimer.adjust(delta);
}

function timerPause() {
  const btn = document.getElementById('timer-pause-btn');
  if (restTimer.running) {
    restTimer.pause();
    if (btn) btn.textContent = 'RESUME';
  } else {
    restTimer.resume();
    if (btn) btn.textContent = 'PAUSE';
  }
}

function timerSkip() {
  restTimer.skip();
  document.getElementById('timer-overlay').classList.add('hidden');
}

// ── PLATE CALCULATOR ──────────────────────────────────────
function openPlateCalc(weight) {
  const overlay = document.getElementById('plate-overlay');
  overlay.classList.remove('hidden');
  const input = document.getElementById('plate-weight-input');
  input.value = weight || '';
  updatePlateCalc();
}

function closePlateCalc() {
  document.getElementById('plate-overlay').classList.add('hidden');
}

async function updatePlateCalc() {
  const input = document.getElementById('plate-weight-input');
  const weight = parseFloat(input.value) || 0;
  const settings = await DB.getSettings();
  const result = calculatePlates(weight, 45, settings.availablePlates);

  document.getElementById('plate-result').innerHTML =
    `<strong>${result.totalWeight} lbs</strong> &mdash; ${formatPlateBreakdown(result)}` +
    (result.remainder > 0 ? `<br><span class="text-warning">Cannot make exact weight (${result.remainder} lbs short per side)</span>` : '');

  document.getElementById('plate-visual-container').innerHTML = renderPlateVisual(result.perSide);
}

// ── HISTORY VIEW ──────────────────────────────────────────
async function renderHistory(el) {
  const workouts = await DB.getRecentWorkouts(50);
  const exerciseMap = await DB.getExerciseMap();
  const programs = await DB.getAll('programs');
  const programMap = {};
  for (const p of programs) programMap[p.id] = p;

  if (workouts.length === 0) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#128196;</div>
      <div class="empty-state-title">No Workouts Yet</div>
      <p class="text-muted">Complete your first workout to see history.</p>
    </div>`;
    return;
  }

  const cards = [];
  for (const w of workouts) {
    if (w.status !== 'completed') continue;
    const program = programMap[w.programId];
    const day = program?.days?.find(d => d.id === w.programDayId);
    const sets = await DB.getSetsByWorkout(w.id);
    const workSets = sets.filter(s => !s.isWarmup);

    // Group sets by exercise for detail
    const byEx = {};
    for (const s of workSets) {
      if (!byEx[s.exerciseId]) byEx[s.exerciseId] = [];
      byEx[s.exerciseId].push(s);
    }

    const exerciseLines = Object.entries(byEx).map(([exId, exSets]) => {
      const ex = exerciseMap[exId];
      const name = ex?.name || 'Unknown';
      if (isTimeBased(ex)) {
        const totalDur = exSets.filter(s => s.completed).reduce((sum, s) => sum + (s.actualDuration || s.targetDuration || 0), 0);
        return `<div class="text-sm">${name}: ${totalDur} min</div>`;
      }
      const reps = exSets.map(s => `${s.actualWeight}x${s.actualReps}${s.completed ? '' : '(F)'}`).join(', ');
      return `<div class="text-sm">${name}: ${reps}</div>`;
    }).join('');

    cards.push(`<div class="history-card" onclick="toggleHistoryDetail(this)">
      <div class="flex items-center justify-between">
        <div>
          <div class="history-date">${formatDate(w.date)}</div>
          <div class="history-program">${day?.name || ''} &middot; ${program?.name || ''}</div>
        </div>
      </div>
      <div class="history-stats">
        <span>&#9201; ${w.duration || 0}min</span>
        <span>&#127947; ${(w.totalVolume || 0).toLocaleString()} lbs</span>
        <span>${workSets.length} sets</span>
      </div>
      <div class="history-detail hidden">
        ${exerciseLines}
        ${w.notes ? `<div class="text-sm text-muted mt-8">${w.notes}</div>` : ''}
        ${w.aiAnalysis ? `<div class="ai-card mt-8"><div class="ai-card-header">AI Analysis</div><div class="ai-card-body">${w.aiAnalysis}</div></div>` : ''}
        <button class="btn btn-danger btn-sm mt-8" onclick="event.stopPropagation(); deleteWorkout(${w.id})">Delete</button>
      </div>
    </div>`);
  }

  el.innerHTML = cards.join('');
}

function toggleHistoryDetail(card) {
  card.querySelector('.history-detail').classList.toggle('hidden');
}

async function deleteWorkout(id) {
  if (!confirm('Delete this workout?')) return;
  const sets = await DB.getSetsByWorkout(id);
  for (const s of sets) await DB.delete('sets', s.id);
  await DB.delete('workouts', id);
  showToast('Workout deleted');
  renderView('history');
}

// ── PROGRESS VIEW ─────────────────────────────────────────
async function renderProgress(el) {
  const exercises = await DB.getAll('exercises');
  const barbellExercises = exercises.filter(e => e.isBarbell && e.isActive);
  const metrics = await DB.getAll('bodyMetrics');
  const allPRs = await DB.getAll('personalRecords');
  const exerciseMap = await DB.getExerciseMap();

  el.innerHTML = `
    <div class="form-group">
      <select class="form-select" id="progress-exercise" onchange="updateProgressCharts()">
        ${barbellExercises.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}
      </select>
    </div>

    <div class="chart-header">
      <span class="chart-title">Weight Progression</span>
    </div>
    <div class="chart-container"><canvas id="chart-weight"></canvas></div>

    <div class="chart-header">
      <span class="chart-title">Estimated 1RM</span>
    </div>
    <div class="chart-container"><canvas id="chart-e1rm"></canvas></div>

    <div class="chart-header">
      <span class="chart-title">Weekly Volume</span>
    </div>
    <div class="chart-container"><canvas id="chart-volume"></canvas></div>

    <div class="chart-header">
      <span class="chart-title">Bodyweight</span>
    </div>
    <div class="chart-container"><canvas id="chart-bodyweight"></canvas></div>

    <div class="chart-header">
      <span class="chart-title">PR Timeline</span>
    </div>
    <div class="chart-container"><canvas id="chart-prs"></canvas></div>
  `;

  await updateProgressCharts();
}

async function updateProgressCharts() {
  const select = document.getElementById('progress-exercise');
  if (!select) return;
  const exerciseId = Number(select.value);
  const exerciseMap = await DB.getExerciseMap();
  const exercise = exerciseMap[exerciseId];
  if (!exercise) return;

  const history = await DB.getExerciseHistory(exerciseId, 50);
  IronCharts.renderWeightChart('chart-weight', history, exercise.name);
  IronCharts.renderE1RMChart('chart-e1rm', history, exercise.name);

  // Volume: get all workout data
  const allWorkouts = await DB.getRecentWorkouts(100);
  const workoutData = [];
  for (const w of allWorkouts) {
    if (w.status !== 'completed') continue;
    const sets = await DB.getSetsByWorkout(w.id);
    workoutData.push({ workout: w, sets });
  }
  IronCharts.renderVolumeChart('chart-volume', workoutData, exerciseMap);

  // Bodyweight
  const metrics = await DB.getAll('bodyMetrics');
  IronCharts.renderBodyweightChart('chart-bodyweight', metrics);

  // PR Timeline
  const allPRs = await DB.getAll('personalRecords');
  IronCharts.renderPRChart('chart-prs', allPRs, exerciseMap);
}

// ── PROGRAMS VIEW ─────────────────────────────────────────
async function renderPrograms(el) {
  const programs = await DB.getAll('programs');

  el.innerHTML = `
    <div class="section-title">Your Programs</div>
    ${programs.map(p => `
      <div class="list-item" onclick="viewProgram(${p.id})">
        <div class="list-item-icon">${p.type === 'strength' ? '&#127947;' : p.type === 'cardio' ? '&#127939;' : '&#9968;'}</div>
        <div class="list-item-text">
          <div class="list-item-title">${p.name}</div>
          <div class="list-item-sub">${p.days.length} days &middot; ${p.days.reduce((n, d) => n + getDayExercises(d).length, 0)} exercises &middot; ${p.type}</div>
        </div>
        <span class="list-item-badge ${selectedProgram?.id === p.id ? 'active' : ''}">${selectedProgram?.id === p.id ? 'Active' : 'Select'}</span>
      </div>
    `).join('')}

    <button class="btn btn-secondary mt-16" onclick="showCreateProgram()">Create Program</button>
  `;
}

async function viewProgram(id) {
  const program = await DB.get('programs', id);
  if (!program) return;

  // Toggle active
  if (selectedProgram?.id !== id) {
    if (selectedProgram) {
      selectedProgram.isDefault = false;
      await DB.put('programs', selectedProgram);
    }
    program.isDefault = true;
    await DB.put('programs', program);
    selectedProgram = program;
    showToast(`${program.name} activated`, 'success');
    renderView('programs');
    return;
  }

  // Open editor for active program
  editProgramView(id);
}

async function deleteProgram(id) {
  if (!confirm('Delete this program?')) return;
  await DB.delete('programs', id);
  if (selectedProgram?.id === id) {
    const programs = await DB.getAll('programs');
    selectedProgram = programs[0] || null;
    if (selectedProgram) {
      selectedProgram.isDefault = true;
      await DB.put('programs', selectedProgram);
    }
  }
  closeModal();
  showToast('Program deleted');
  renderView('programs');
}

function showCreateProgram() {
  editProgramView(null);
}

// ── PROGRAM EDITOR ───────────────────────────────────────
let editingProgram = null;

async function editProgramView(id) {
  const program = id ? await DB.get('programs', id) : null;
  editingProgram = program ? JSON.parse(JSON.stringify(program)) : {
    name: '',
    type: 'strength',
    isDefault: false,
    daysPerWeek: 1,
    alternating: true,
    days: [{
      id: `day1_${Date.now()}`,
      name: 'Day 1',
      sections: [{
        id: `sec_${Date.now()}`,
        name: 'Main',
        type: 'straight',
        exercises: [],
        rounds: 1,
        restBetweenRounds: 0,
        timer: null
      }]
    }],
    progression: { upperIncrement: 5, lowerIncrement: 5, deadliftIncrement: 10, failureRetries: 3, deloadPercent: 10, maxDeloads: 3 },
    isCustom: true
  };
  renderProgramEditor();
}

function getSectionTypeColor(type) {
  const colors = {
    straight: '#3b82f6', circuit: '#fbbf24', superset: '#8b5cf6',
    emom: '#e94560', amrap: '#4ade80', warmup: '#fb923c', cooldown: '#22d3ee'
  };
  return colors[type] || '#3b82f6';
}

async function renderProgramEditor() {
  const el = document.getElementById('content');
  const exerciseMap = await DB.getExerciseMap();
  const p = editingProgram;

  el.innerHTML = `
    <button class="btn btn-ghost" onclick="exitProgramEditor()">&larr; Back</button>

    <div class="form-group mt-16">
      <label class="form-label">Program Name</label>
      <input class="form-input" id="prog-edit-name" value="${p.name}" placeholder="My Program">
    </div>

    <div class="form-group">
      <label class="form-label">Type</label>
      <select class="form-select" id="prog-edit-type">
        ${['strength', 'cardio', 'hybrid', 'outdoor'].map(t =>
          `<option value="${t}" ${p.type === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
        ).join('')}
      </select>
    </div>

    <div class="flex items-center justify-between mt-24">
      <div class="section-title" style="margin:0">Workout Days</div>
    </div>

    ${p.days.map((day, di) => `
      <div class="day-card">
        <div class="day-card-header">
          <input class="day-card-name" value="${day.name}"
            onchange="editingProgram.days[${di}].name = this.value">
          <div class="flex items-center gap-8">
            <button class="btn btn-ghost btn-sm" onclick="editorCopyDay(${di})" title="Copy day">&#128203;</button>
            ${p.days.length > 1 ? `<button class="btn btn-ghost btn-sm" onclick="editorRemoveDay(${di})">&#10005;</button>` : ''}
          </div>
        </div>

        ${(day.sections || []).map((sec, si) => `
          <div class="section-card" style="border-left-color: ${getSectionTypeColor(sec.type)}">
            <div class="section-card-header">
              <div class="flex items-center gap-8">
                <span class="section-type-badge ${sec.type}">${sec.type.toUpperCase()}</span>
                <span class="section-card-name">${sec.name}</span>
              </div>
              <div class="flex items-center gap-8">
                <button class="btn btn-ghost btn-sm" onclick="editSection(${di}, ${si})">&#9998;</button>
                ${(day.sections || []).length > 1 ? `<button class="btn btn-ghost btn-sm" onclick="editorRemoveSection(${di}, ${si})">&#10005;</button>` : ''}
              </div>
            </div>
            ${sec.type !== 'straight' && sec.rounds > 1 ? `<div class="section-meta">${sec.rounds} rounds &middot; ${sec.restBetweenRounds}s rest</div>` : ''}
            <div class="section-exercises">
              ${(sec.exercises || []).map((ex, ei) => {
                const exercise = exerciseMap[ex.exerciseId];
                const configLabel = isTimeBased(exercise)
                  ? `${ex.duration || exercise?.defaultDuration || 30} min`
                  : `${ex.sets}x${ex.reps}`;
                return `<div class="section-exercise-row">
                  <span class="section-exercise-name">${exercise?.name || 'Unknown'}</span>
                  <div class="flex items-center gap-8">
                    <span class="section-exercise-config">${configLabel}</span>
                    <button class="btn btn-ghost btn-sm" onclick="editorRemoveExercise(${di}, ${si}, ${ei})">&#10005;</button>
                  </div>
                </div>`;
              }).join('')}
            </div>
            <button class="btn btn-ghost btn-sm" style="color:var(--primary)" onclick="editorAddExercise(${di}, ${si})">+ Add Exercise</button>
          </div>
        `).join('')}

        <button class="btn btn-ghost btn-sm mt-8" style="color:var(--secondary)" onclick="editorAddSection(${di})">+ Add Section</button>
      </div>
    `).join('')}

    <button class="btn btn-secondary mt-16" onclick="editorAddDay()">+ Add Day</button>

    ${editingProgram.id ? `<button class="btn btn-danger mt-8" onclick="editorDeleteProgram()">Delete Program</button>` : ''}

    <div class="flex gap-12 mt-24 mb-16">
      <button class="btn btn-ghost flex-1" onclick="exitProgramEditor()">Cancel</button>
      <button class="btn btn-primary flex-1" onclick="saveProgramEditor()">Save</button>
    </div>
  `;
}

function exitProgramEditor() {
  editingProgram = null;
  renderView('programs');
}

async function saveProgramEditor() {
  if (!editingProgram) return;
  const name = document.getElementById('prog-edit-name')?.value?.trim();
  const type = document.getElementById('prog-edit-type')?.value;
  if (name) editingProgram.name = name;
  if (type) editingProgram.type = type;
  if (!editingProgram.name) { showToast('Enter a program name', 'error'); return; }

  editingProgram.daysPerWeek = editingProgram.days.length;
  editingProgram.alternating = editingProgram.days.length <= 3;

  if (editingProgram.id) {
    await DB.put('programs', editingProgram);
  } else {
    editingProgram.id = await DB.add('programs', editingProgram);
  }

  if (editingProgram.isDefault) selectedProgram = JSON.parse(JSON.stringify(editingProgram));
  editingProgram = null;
  showToast('Program saved', 'success');
  renderView('programs');
}

async function editorDeleteProgram() {
  if (!editingProgram?.id) return;
  if (!confirm('Delete this program?')) return;
  await DB.delete('programs', editingProgram.id);
  if (selectedProgram?.id === editingProgram.id) {
    const programs = await DB.getAll('programs');
    selectedProgram = programs[0] || null;
    if (selectedProgram) { selectedProgram.isDefault = true; await DB.put('programs', selectedProgram); }
  }
  editingProgram = null;
  showToast('Program deleted');
  renderView('programs');
}

function editorAddDay() {
  const n = editingProgram.days.length + 1;
  editingProgram.days.push({
    id: `day${n}_${Date.now()}`,
    name: `Day ${n}`,
    sections: [{ id: `sec_${Date.now()}`, name: 'Main', type: 'straight', exercises: [], rounds: 1, restBetweenRounds: 0, timer: null }]
  });
  renderProgramEditor();
}

function editorCopyDay(dayIdx) {
  const source = editingProgram.days[dayIdx];
  const n = editingProgram.days.length + 1;
  const copy = JSON.parse(JSON.stringify(source));
  copy.id = `day${n}_${Date.now()}`;
  copy.name = `${source.name} (Copy)`;
  // Give new IDs to sections
  for (const sec of (copy.sections || [])) {
    sec.id = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }
  editingProgram.days.splice(dayIdx + 1, 0, copy);
  renderProgramEditor();
  showToast('Day copied', 'success');
}

function editorRemoveDay(dayIdx) {
  if (editingProgram.days.length <= 1) return;
  editingProgram.days.splice(dayIdx, 1);
  renderProgramEditor();
}

function editorAddSection(dayIdx) {
  editingProgram.days[dayIdx].sections.push({
    id: `sec_${Date.now()}`,
    name: 'New Section',
    type: 'straight',
    exercises: [],
    rounds: 1,
    restBetweenRounds: 0,
    timer: null
  });
  renderProgramEditor();
}

function editorRemoveSection(dayIdx, secIdx) {
  const sections = editingProgram.days[dayIdx].sections;
  if (sections.length <= 1) return;
  sections.splice(secIdx, 1);
  renderProgramEditor();
}

function editorRemoveExercise(dayIdx, secIdx, exIdx) {
  editingProgram.days[dayIdx].sections[secIdx].exercises.splice(exIdx, 1);
  renderProgramEditor();
}

function editSection(dayIdx, secIdx) {
  const sec = editingProgram.days[dayIdx].sections[secIdx];
  const showRounds = sec.type !== 'straight';
  showModal(`
    <div class="modal-title">Edit Section</div>
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-input" id="sec-edit-name" value="${sec.name}">
    </div>
    <div class="form-group">
      <label class="form-label">Type</label>
      <div class="chip-group" id="sec-type-chips">
        ${['straight', 'circuit', 'superset', 'emom', 'amrap', 'warmup', 'cooldown'].map(t =>
          `<span class="chip ${sec.type === t ? 'active' : ''}" onclick="selectSectionType('${t}')">${t}</span>`
        ).join('')}
      </div>
    </div>
    <div class="form-group" id="sec-rounds-group" style="${showRounds ? '' : 'display:none'}">
      <label class="form-label">Rounds</label>
      <input class="form-input" type="number" id="sec-edit-rounds" value="${sec.rounds || 1}" min="1" max="20">
    </div>
    <div class="form-group" id="sec-rest-group" style="${showRounds ? '' : 'display:none'}">
      <label class="form-label">Rest Between Rounds (sec)</label>
      <input class="form-input" type="number" id="sec-edit-rest" value="${sec.restBetweenRounds || 0}" min="0" step="15">
    </div>
    <button class="btn btn-primary mt-16" onclick="saveSectionEdit(${dayIdx}, ${secIdx})">Done</button>
  `);
}

function selectSectionType(type) {
  document.querySelectorAll('#sec-type-chips .chip').forEach(c => {
    c.classList.toggle('active', c.textContent.toLowerCase() === type);
  });
  const show = type !== 'straight';
  document.getElementById('sec-rounds-group').style.display = show ? '' : 'none';
  document.getElementById('sec-rest-group').style.display = show ? '' : 'none';
}

function saveSectionEdit(dayIdx, secIdx) {
  const sec = editingProgram.days[dayIdx].sections[secIdx];
  sec.name = document.getElementById('sec-edit-name').value.trim() || sec.name;
  const activeChip = document.querySelector('#sec-type-chips .chip.active');
  if (activeChip) sec.type = activeChip.textContent.toLowerCase();
  sec.rounds = parseInt(document.getElementById('sec-edit-rounds').value) || 1;
  sec.restBetweenRounds = parseInt(document.getElementById('sec-edit-rest').value) || 0;
  closeModal();
  renderProgramEditor();
}

async function editorAddExercise(dayIdx, secIdx) {
  const exercises = await DB.getAll('exercises');
  const active = exercises.filter(e => e.isActive);
  window._pickerTarget = { dayIdx, secIdx };

  const categories = {};
  for (const e of active) {
    if (!categories[e.category]) categories[e.category] = [];
    categories[e.category].push(e);
  }

  showModal(`
    <div class="modal-title">Add Exercise</div>
    <input class="search-input" placeholder="Search exercises..." oninput="filterPickerExercises(this.value)">
    <div id="picker-exercise-list">
      ${Object.entries(categories).map(([cat, exs]) => `
        <div class="section-title picker-cat">${cat.toUpperCase()}</div>
        ${exs.map(e => {
          const subLabel = e.trackingType === 'time'
            ? `${e.defaultDuration || 30} min`
            : `${e.defaultSets}x${e.defaultReps}`;
          return `
          <div class="picker-item" data-name="${e.name.toLowerCase()}" onclick="pickExercise(${e.id}, ${e.defaultSets}, ${e.defaultReps})">
            <div class="picker-item-name">${e.name}</div>
            <div class="picker-item-sub">${subLabel} &middot; ${e.muscleGroups.join(', ')}</div>
          </div>`;
        }).join('')}
      `).join('')}
    </div>
  `);
}

function filterPickerExercises(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('#picker-exercise-list .picker-item').forEach(item => {
    item.style.display = item.dataset.name.includes(q) ? '' : 'none';
  });
  document.querySelectorAll('#picker-exercise-list .picker-cat').forEach(title => {
    let next = title.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains('picker-cat') && !next.classList.contains('section-title')) {
      if (next.style.display !== 'none' && next.classList.contains('picker-item')) hasVisible = true;
      next = next.nextElementSibling;
    }
    title.style.display = hasVisible ? '' : 'none';
  });
}

async function pickExercise(exerciseId, defaultSets, defaultReps) {
  const exerciseMap = await DB.getExerciseMap();
  const exercise = exerciseMap[exerciseId];
  const timeBased = isTimeBased(exercise);
  const dur = exercise?.defaultDuration || 30;
  const modal = document.querySelector('.modal-sheet');

  if (timeBased) {
    modal.innerHTML = `
      <div class="modal-handle"></div>
      <div class="modal-title">Configure Exercise</div>
      <div class="form-group">
        <label class="form-label">Duration (min)</label>
        <input class="form-input" type="number" id="picker-duration" value="${dur}" min="1" max="999">
      </div>
      <input type="hidden" id="picker-sets" value="${defaultSets}">
      <input type="hidden" id="picker-reps" value="0">
      <button class="btn btn-primary mt-16" onclick="confirmExercisePick(${exerciseId})">Add</button>
    `;
  } else {
    modal.innerHTML = `
      <div class="modal-handle"></div>
      <div class="modal-title">Configure Exercise</div>
      <div class="flex gap-12">
        <div class="form-group flex-1">
          <label class="form-label">Sets</label>
          <input class="form-input" type="number" id="picker-sets" value="${defaultSets}" min="1" max="20">
        </div>
        <div class="form-group flex-1">
          <label class="form-label">Reps</label>
          <input class="form-input" type="number" id="picker-reps" value="${defaultReps}" min="1" max="100">
        </div>
      </div>
      <button class="btn btn-primary mt-16" onclick="confirmExercisePick(${exerciseId})">Add</button>
    `;
  }
}

function confirmExercisePick(exerciseId) {
  const sets = parseInt(document.getElementById('picker-sets').value) || 3;
  const reps = parseInt(document.getElementById('picker-reps').value) || 5;
  const durationEl = document.getElementById('picker-duration');
  const duration = durationEl ? parseInt(durationEl.value) || 30 : null;
  const { dayIdx, secIdx } = window._pickerTarget;
  const section = editingProgram.days[dayIdx].sections[secIdx];
  const entry = { exerciseId, sets, reps, order: section.exercises.length + 1 };
  if (duration !== null) entry.duration = duration;
  section.exercises.push(entry);
  closeModal();
  renderProgramEditor();
}

// ── MORE VIEW ─────────────────────────────────────────────
async function renderMore(el) {
  el.innerHTML = `
    <div class="list-item" onclick="showBodyTracking()">
      <div class="list-item-icon">&#9878;</div>
      <div class="list-item-text">
        <div class="list-item-title">Body Tracking</div>
        <div class="list-item-sub">Weight, measurements, photos</div>
      </div>
    </div>

    <div class="list-item" onclick="showExerciseLibrary()">
      <div class="list-item-icon">&#128170;</div>
      <div class="list-item-text">
        <div class="list-item-title">Exercise Library</div>
        <div class="list-item-sub">View and create exercises</div>
      </div>
    </div>

    <div class="list-item" onclick="showSettings()">
      <div class="list-item-icon">&#9881;</div>
      <div class="list-item-text">
        <div class="list-item-title">Settings</div>
        <div class="list-item-sub">Units, timer, plates, AI, backup</div>
      </div>
    </div>

    <div class="list-item" onclick="showPersonalRecords()">
      <div class="list-item-icon">&#127942;</div>
      <div class="list-item-text">
        <div class="list-item-title">Personal Records</div>
        <div class="list-item-sub">View all PRs</div>
      </div>
    </div>

    <div class="list-item" onclick="exportData()">
      <div class="list-item-icon">&#128229;</div>
      <div class="list-item-text">
        <div class="list-item-title">Export Data</div>
        <div class="list-item-sub">Download all data as JSON</div>
      </div>
    </div>

    <div class="list-item" onclick="importData()">
      <div class="list-item-icon">&#128228;</div>
      <div class="list-item-text">
        <div class="list-item-title">Import Data</div>
        <div class="list-item-sub">Restore from JSON backup</div>
      </div>
    </div>

    <div class="text-center mt-24 text-muted text-sm">
      IronLog v2.1.0<br>
      Built for the iron.
    </div>
  `;
}

// ── Body Tracking ─────────────────────────────────────────
async function showBodyTracking() {
  const metrics = await DB.getAll('bodyMetrics');
  const sorted = [...metrics].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];

  const content = document.getElementById('content');
  content.innerHTML = `
    <button class="btn btn-ghost" onclick="renderView('more')">&larr; Back</button>

    <div class="card mt-16">
      <div class="card-title">Log Body Metrics</div>
      <div class="form-group mt-8">
        <label class="form-label">Date</label>
        <input class="form-input" type="date" id="body-date" value="${new Date().toISOString().split('T')[0]}">
      </div>
      <div class="form-group">
        <label class="form-label">Weight (lbs)</label>
        <input class="form-input" type="number" id="body-weight" step="0.1" value="${latest?.weight || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Body Fat %</label>
        <input class="form-input" type="number" id="body-bf" step="0.1" value="${latest?.bodyFatPct || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-textarea" id="body-notes"></textarea>
      </div>
      <button class="btn btn-primary" onclick="saveBodyMetrics()">Save</button>
    </div>

    <div class="section-title">History</div>
    ${sorted.length === 0 ? '<p class="text-muted">No entries yet.</p>' :
      sorted.slice(0, 20).map(m => `
        <div class="list-item">
          <div class="list-item-text">
            <div class="list-item-title">${formatDate(m.date)}</div>
            <div class="list-item-sub">${m.weight ? m.weight + ' lbs' : ''} ${m.bodyFatPct ? '/ ' + m.bodyFatPct + '% BF' : ''}</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); deleteBodyMetric(${m.id})">&#10005;</button>
        </div>
      `).join('')}
  `;
}

async function saveBodyMetrics() {
  const date = document.getElementById('body-date').value;
  const weight = parseFloat(document.getElementById('body-weight').value);
  const bodyFatPct = parseFloat(document.getElementById('body-bf').value) || null;
  const notes = document.getElementById('body-notes').value;

  if (!date || isNaN(weight)) { showToast('Enter date and weight', 'error'); return; }

  // Check if entry exists for date
  const existing = await DB.getOneByIndex('bodyMetrics', 'date', date);
  const entry = {
    ...(existing || {}),
    date, weight, bodyFatPct, notes,
    measurements: existing?.measurements || {}
  };

  await DB.put('bodyMetrics', entry);
  showToast('Saved', 'success');
  showBodyTracking();
}

async function deleteBodyMetric(id) {
  await DB.delete('bodyMetrics', id);
  showBodyTracking();
}

// ── Exercise Library ──────────────────────────────────────
async function showExerciseLibrary() {
  const exercises = await DB.getAll('exercises');
  const content = document.getElementById('content');

  content.innerHTML = `
    <button class="btn btn-ghost" onclick="renderView('more')">&larr; Back</button>
    <input class="search-input" placeholder="Search exercises..." oninput="filterExercises(this.value)">

    <div id="exercise-list">
      ${renderExerciseList(exercises)}
    </div>

    <button class="btn btn-secondary mt-16" onclick="showCreateExercise()">Add Exercise</button>
  `;
}

function renderExerciseList(exercises) {
  const categories = {};
  for (const e of exercises) {
    if (!e.isActive) continue;
    if (!categories[e.category]) categories[e.category] = [];
    categories[e.category].push(e);
  }

  return Object.entries(categories).map(([cat, exs]) => `
    <div class="section-title">${cat.toUpperCase()}</div>
    ${exs.map(e => {
      const configLabel = e.trackingType === 'time'
        ? `${e.defaultDuration || 30} min`
        : `${e.defaultSets}x${e.defaultReps}`;
      return `
      <div class="list-item" data-name="${e.name.toLowerCase()}">
        <div class="list-item-text">
          <div class="list-item-title">${e.name} ${e.isCustom ? '<span class="text-muted text-sm">(custom)</span>' : ''}</div>
          <div class="list-item-sub">${configLabel} &middot; ${e.muscleGroups.join(', ')}</div>
        </div>
      </div>`;
    }).join('')}
  `).join('');
}

function filterExercises(query) {
  const items = document.querySelectorAll('#exercise-list .list-item');
  const q = query.toLowerCase();
  items.forEach(item => {
    item.style.display = item.dataset.name.includes(q) ? '' : 'none';
  });
}

function showCreateExercise() {
  showModal(`
    <div class="modal-title">Create Exercise</div>
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-input" id="new-ex-name" placeholder="Exercise name">
    </div>
    <div class="form-group">
      <label class="form-label">Category</label>
      <select class="form-select" id="new-ex-cat">
        <option value="barbell">Barbell</option>
        <option value="dumbbell">Dumbbell</option>
        <option value="bodyweight">Bodyweight</option>
        <option value="machine">Machine</option>
        <option value="cardio">Cardio</option>
        <option value="outdoor">Outdoor</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Default Sets</label>
      <input class="form-input" id="new-ex-sets" type="number" value="3">
    </div>
    <div class="form-group">
      <label class="form-label">Default Reps</label>
      <input class="form-input" id="new-ex-reps" type="number" value="10">
    </div>
    <button class="btn btn-primary mt-16" onclick="createExercise()">Create</button>
  `);
}

async function createExercise() {
  const name = document.getElementById('new-ex-name').value.trim();
  const category = document.getElementById('new-ex-cat').value;
  const defaultSets = parseInt(document.getElementById('new-ex-sets').value) || 3;
  const defaultReps = parseInt(document.getElementById('new-ex-reps').value) || 10;

  if (!name) { showToast('Enter a name', 'error'); return; }

  const trackingType = (category === 'cardio' || category === 'outdoor') ? 'time'
    : category === 'bodyweight' ? 'reps_only' : 'weight';
  const exData = {
    name, category, muscleGroups: [],
    isBarbell: category === 'barbell',
    barbellWeight: category === 'barbell' ? 45 : 0,
    defaultSets, defaultReps,
    defaultRestSec: category === 'barbell' ? 180 : 90,
    incrementLbs: trackingType === 'weight' ? 5 : 0,
    trackingType, isCustom: true, isActive: true
  };
  if (trackingType === 'time') exData.defaultDuration = 30;
  await DB.add('exercises', exData);

  DB.invalidateExerciseCache();
  closeModal();
  showToast('Exercise created', 'success');
  showExerciseLibrary();
}

// ── Settings ──────────────────────────────────────────────
async function showSettings() {
  const settings = await DB.getSettings();
  const content = document.getElementById('content');

  content.innerHTML = `
    <button class="btn btn-ghost" onclick="renderView('more')">&larr; Back</button>

    <div class="section-title">General</div>

    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">Units</div>
      </div>
      <select class="form-select" style="width:auto" onchange="updateSetting('units', this.value)">
        <option value="lbs" ${settings.units === 'lbs' ? 'selected' : ''}>lbs</option>
        <option value="kg" ${settings.units === 'kg' ? 'selected' : ''}>kg</option>
      </select>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">Default Rest (sec)</div>
      </div>
      <input class="form-input" style="width:80px" type="number" value="${settings.defaultRestSec}"
        onchange="updateSetting('defaultRestSec', parseInt(this.value))">
    </div>

    <div class="section-title">Timer</div>

    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">Sound</div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${settings.timerSound ? 'checked' : ''} onchange="updateSetting('timerSound', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">Vibration</div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${settings.timerVibrate ? 'checked' : ''} onchange="updateSetting('timerVibrate', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>

    <div class="section-title">Plates</div>
    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">Available Plates</div>
        <div class="setting-desc">Tap to toggle</div>
      </div>
    </div>
    <div class="chip-group" id="plate-chips">
      ${[45, 35, 25, 10, 5, 2.5].map(p =>
        `<span class="chip ${settings.availablePlates.includes(p) ? 'active' : ''}" onclick="togglePlate(${p})">${p}</span>`
      ).join('')}
    </div>

    <div class="section-title">AI Analysis</div>

    <div class="setting-row">
      <div class="setting-info">
        <div class="setting-label">Enable AI</div>
        <div class="setting-desc">Analyze workouts with Claude</div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${settings.aiEnabled ? 'checked' : ''} onchange="updateSetting('aiEnabled', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>

    <div class="form-group">
      <label class="form-label">Anthropic API Key</label>
      <input class="form-input" type="password" value="${settings.anthropicApiKey || ''}"
        placeholder="sk-ant-..."
        onchange="updateSetting('anthropicApiKey', this.value)">
    </div>

    <div class="form-group">
      <label class="form-label">Backend URL (optional)</label>
      <input class="form-input" value="${settings.backendUrl || ''}"
        placeholder="http://100.125.69.117:5000"
        onchange="updateSetting('backendUrl', this.value)">
    </div>

    <div class="section-title">Data</div>
    <button class="btn btn-danger mt-8" onclick="resetAllData()">Reset All Data</button>
  `;
}

async function updateSetting(key, value) {
  const settings = await DB.getSettings();
  settings[key] = value;
  await DB.saveSettings(settings);
}

async function togglePlate(weight) {
  const settings = await DB.getSettings();
  const idx = settings.availablePlates.indexOf(weight);
  if (idx >= 0) settings.availablePlates.splice(idx, 1);
  else settings.availablePlates.push(weight);
  settings.availablePlates.sort((a, b) => b - a);
  await DB.saveSettings(settings);
  showSettings();
}

async function resetAllData() {
  if (!confirm('Delete ALL data? This cannot be undone.')) return;
  if (!confirm('Are you sure? ALL workouts, PRs, and settings will be lost.')) return;

  for (const store of ['exercises', 'programs', 'workouts', 'sets', 'bodyMetrics', 'personalRecords', 'settings']) {
    await DB.clear(store);
  }
  DB.invalidateExerciseCache();
  activeWorkout = null;
  selectedProgram = null;
  await seedDefaults();

  const programs = await DB.getAll('programs');
  selectedProgram = programs[0];

  showToast('All data reset', 'success');
  renderView('more');
}

// ── Personal Records ──────────────────────────────────────
async function showPersonalRecords() {
  const prs = await DB.getAll('personalRecords');
  const exerciseMap = await DB.getExerciseMap();
  const content = document.getElementById('content');

  const byExercise = {};
  for (const pr of prs) {
    if (!byExercise[pr.exerciseId]) byExercise[pr.exerciseId] = [];
    byExercise[pr.exerciseId].push(pr);
  }

  if (prs.length === 0) {
    content.innerHTML = `
      <button class="btn btn-ghost" onclick="renderView('more')">&larr; Back</button>
      <div class="empty-state">
        <div class="empty-state-icon">&#127942;</div>
        <div class="empty-state-title">No PRs Yet</div>
        <p class="text-muted">Complete workouts to start tracking PRs.</p>
      </div>`;
    return;
  }

  content.innerHTML = `
    <button class="btn btn-ghost" onclick="renderView('more')">&larr; Back</button>
    <div class="section-title">Personal Records</div>
    ${Object.entries(byExercise).map(([exId, exPRs]) => {
      const ex = exerciseMap[exId];
      return `<div class="card">
        <div class="card-title">${ex?.name || 'Unknown'}</div>
        ${exPRs.sort((a, b) => b.weight - a.weight).map(pr => `
          <div class="flex items-center justify-between mt-8">
            <span class="text-sm">${pr.type}: ${pr.weight} x ${pr.reps}</span>
            <span class="text-sm text-muted">E1RM: ${pr.estimated1RM} lbs &middot; ${formatDate(pr.date)}</span>
          </div>
        `).join('')}
      </div>`;
    }).join('')}`;
}

// ── Export / Import ───────────────────────────────────────
async function exportData() {
  const data = await DB.exportAll();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ironlog-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data exported', 'success');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data._version) { showToast('Invalid backup file', 'error'); return; }
      if (!confirm(`Import backup from ${data._exportDate}? This will replace all current data.`)) return;
      await DB.importAll(data);
      const programs = await DB.getAll('programs');
      selectedProgram = programs.find(p => p.isDefault) || programs[0];
      showToast('Data imported', 'success');
      renderView('workout');
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    }
  };
  input.click();
}

// ── Modal ─────────────────────────────────────────────────
function showModal(html) {
  const backdrop = document.getElementById('modal-backdrop');
  backdrop.innerHTML = `<div class="modal-sheet">
    <div class="modal-handle"></div>
    ${html}
  </div>`;
  backdrop.classList.remove('hidden');
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeModal();
  };
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
}

// ── Helpers ───────────────────────────────────────────────
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Expose globals
window.navigate = navigate;
window.startWorkout = startWorkout;
window.toggleSet = toggleSet;
window.toggleWarmup = toggleWarmup;
window.setRPE = setRPE;
window.editWeight = editWeight;
window.toggleExercise = toggleExercise;
window.finishWorkout = finishWorkout;
window.cancelWorkout = cancelWorkout;
window.timerAdjust = timerAdjust;
window.timerSkip = timerSkip;
window.openPlateCalc = openPlateCalc;
window.closePlateCalc = closePlateCalc;
window.updatePlateCalc = updatePlateCalc;
window.toggleHistoryDetail = toggleHistoryDetail;
window.deleteWorkout = deleteWorkout;
window.updateProgressCharts = updateProgressCharts;
window.viewProgram = viewProgram;
window.deleteProgram = deleteProgram;
window.showCreateProgram = showCreateProgram;
window.editProgramView = editProgramView;
window.renderProgramEditor = renderProgramEditor;
window.exitProgramEditor = exitProgramEditor;
window.saveProgramEditor = saveProgramEditor;
window.editorDeleteProgram = editorDeleteProgram;
window.editorAddDay = editorAddDay;
window.editorCopyDay = editorCopyDay;
window.editorRemoveDay = editorRemoveDay;
window.editorAddSection = editorAddSection;
window.editorRemoveSection = editorRemoveSection;
window.editorRemoveExercise = editorRemoveExercise;
window.editorAddExercise = editorAddExercise;
window.editSection = editSection;
window.selectSectionType = selectSectionType;
window.saveSectionEdit = saveSectionEdit;
window.filterPickerExercises = filterPickerExercises;
window.pickExercise = pickExercise;
window.confirmExercisePick = confirmExercisePick;
window.showBodyTracking = showBodyTracking;
window.saveBodyMetrics = saveBodyMetrics;
window.deleteBodyMetric = deleteBodyMetric;
window.showExerciseLibrary = showExerciseLibrary;
window.filterExercises = filterExercises;
window.showCreateExercise = showCreateExercise;
window.createExercise = createExercise;
window.showSettings = showSettings;
window.updateSetting = updateSetting;
window.togglePlate = togglePlate;
window.resetAllData = resetAllData;
window.showPersonalRecords = showPersonalRecords;
window.exportData = exportData;
window.importData = importData;
window.showModal = showModal;
window.closeModal = closeModal;
window.toggleRepStrip = toggleRepStrip;
window.setActualReps = setActualReps;
window.timerPause = timerPause;
window.beginWorkout = beginWorkout;
window.selectReadiness = selectReadiness;
window.showWorkoutSummary = showWorkoutSummary;
window.requestAIAnalysis = requestAIAnalysis;
window.closeSummary = closeSummary;
window.adjustEditWeight = adjustEditWeight;
window.onWeightInputChange = onWeightInputChange;
window.confirmWeightEdit = confirmWeightEdit;
window.editDuration = editDuration;
window.adjustEditDuration = adjustEditDuration;
window.confirmDurationEdit = confirmDurationEdit;
window.showDurationTimer = showDurationTimer;
