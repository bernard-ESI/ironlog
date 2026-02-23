// IronLog - SPA Router + Views

let currentView = 'workout';
let activeWorkout = null;     // { workout, sets: Map<exerciseId, []> }
let workoutTimer = null;       // elapsed timer interval
let restTimer = null;          // RestTimer instance
let wakeLock = null;
let selectedProgram = null;

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await DB.init();
  await seedDefaults();
  restTimer = new RestTimer();

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
    activeWorkout = { workout: inProgress, sets: setMap };
  }

  setupNav();
  navigate(window.location.hash.slice(1) || 'workout');

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js?v=3').catch(() => {});
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

  for (const ex of nextDay.exercises) {
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

    ${nextDay.exercises.map(ex => {
      const exercise = exerciseMap[ex.exerciseId];
      if (!exercise) return '';
      const weight = exerciseWeights[ex.exerciseId] || exercise.barbellWeight || 0;
      return `<div class="exercise-card">
        <div class="exercise-card-header">
          <div>
            <div class="exercise-name">${exercise.name}</div>
            <div class="exercise-target">${ex.sets}x${ex.reps}</div>
          </div>
          <div class="exercise-weight">${weight} lbs</div>
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
  await requestWakeLock();

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
    bodyweight: null,
    totalVolume: 0,
    duration: 0,
    aiAnalysis: null
  };

  const workoutId = await DB.add('workouts', workout);
  workout.id = workoutId;

  const setMap = {};
  let order = 0;

  for (const programEx of day.exercises) {
    const exercise = exerciseMap[programEx.exerciseId];
    if (!exercise) continue;

    const workWeight = await Progression.getNextWeight(programEx.exerciseId, exercise, selectedProgram);
    setMap[programEx.exerciseId] = [];

    // Warmup sets
    if (exercise.isBarbell) {
      const warmups = generateWarmups(workWeight, exercise.barbellWeight);
      for (const wu of warmups) {
        const s = {
          workoutId, exerciseId: programEx.exerciseId,
          setNumber: 0, targetWeight: wu.weight, targetReps: wu.reps,
          actualWeight: wu.weight, actualReps: 0, rpe: null,
          completed: false, isWarmup: true, isPR: false,
          restTimeSec: 60, notes: wu.label, timestamp: null, order: order++
        };
        s.id = await DB.add('sets', s);
        setMap[programEx.exerciseId].push(s);
      }
    }

    // Work sets
    for (let i = 1; i <= programEx.sets; i++) {
      const s = {
        workoutId, exerciseId: programEx.exerciseId,
        setNumber: i, targetWeight: workWeight, targetReps: programEx.reps,
        actualWeight: workWeight, actualReps: 0, rpe: null,
        completed: false, isWarmup: false, isPR: false,
        restTimeSec: exercise.defaultRestSec, notes: '', timestamp: null, order: order++
      };
      s.id = await DB.add('sets', s);
      setMap[programEx.exerciseId].push(s);
    }
  }

  activeWorkout = { workout, sets: setMap };
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
  const start = new Date(activeWorkout.workout.startTime);
  const elapsed = Math.floor((Date.now() - start.getTime()) / 1000);

  startWorkoutTimer();

  el.innerHTML = `
    <div class="workout-active-bar">
      <span class="text-sm font-bold">IN PROGRESS</span>
      <span class="workout-timer" id="workout-elapsed">${formatTime(elapsed)}</span>
    </div>

    ${Object.entries(activeWorkout.sets).map(([exId, sets]) => {
      const exercise = exerciseMap[exId];
      if (!exercise) return '';
      const workSets = sets.filter(s => !s.isWarmup);
      const warmupSets = sets.filter(s => s.isWarmup);
      const completed = workSets.filter(s => s.completed).length;
      const total = workSets.length;

      const warmupDone = warmupSets.length > 0 && warmupSets.every(s => s.completed);
      const workWeight = workSets[0]?.targetWeight || 0;

      return `<div class="exercise-card" id="ex-${exId}">
        <div class="exercise-card-header" onclick="toggleExercise(${exId})">
          <div>
            <div class="exercise-name">${exercise.name}</div>
            <div class="exercise-target">${completed}/${total} sets</div>
          </div>
          <div class="exercise-weight">${workWeight} lbs</div>
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
          ${workSets.map(s => renderSetRow(s, exercise, false, 0)).join('')}
          <div class="flex items-center justify-between mt-8">
            <button class="btn btn-ghost btn-sm" onclick="openPlateCalc(${workWeight})">
              Plates
            </button>
            <button class="btn btn-ghost btn-sm" onclick="editWeight(${exId})">
              Edit Weight
            </button>
          </div>
        </div>
      </div>`;
    }).join('')}

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

function renderSetRow(set, exercise, isWarmup, workWeight) {
  const label = isWarmup ? 'W' : set.setNumber;
  const checkClass = set.completed
    ? (isWarmup ? 'set-check warmup-completed' : 'set-check completed')
    : 'set-check';
  const rpeClass = set.rpe >= 9 ? 'high' : '';
  const pct = isWarmup && workWeight > 0
    ? `<span class="warmup-pct">${Math.round((set.targetWeight / workWeight) * 100)}%</span>`
    : '';

  return `<div class="set-row ${isWarmup ? 'warmup' : ''}">
    <span class="set-label">${label}</span>
    <span class="set-weight" onclick="openPlateCalc(${set.targetWeight})">${set.actualWeight} lbs</span>
    <span class="set-target">x${set.targetReps}</span>
    ${pct}
    <div class="${checkClass}" onclick="toggleSet(${set.id})">
      ${set.completed ? '\u2713' : ''}
    </div>
    ${!isWarmup ? `<span class="rpe-badge ${rpeClass}" onclick="setRPE(${set.id})">${set.rpe ? `@${set.rpe}` : 'RPE'}</span>` : ''}
  </div>`;
}

async function toggleSet(setId) {
  // Find the set
  for (const [exId, sets] of Object.entries(activeWorkout.sets)) {
    const set = sets.find(s => s.id === setId);
    if (!set) continue;

    const exercise = (await DB.getExerciseMap())[exId];

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

  const newWeight = prompt('Enter weight (lbs):', currentWeight);
  if (newWeight === null) return;
  const w = parseFloat(newWeight);
  if (isNaN(w) || w < 0) return;

  for (const s of workSets) {
    s.targetWeight = w;
    s.actualWeight = w;
    await DB.put('sets', s);
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

async function finishWorkout() {
  if (!activeWorkout) return;

  const now = new Date();
  const start = new Date(activeWorkout.workout.startTime);
  const duration = Math.floor((now - start) / 60000);

  // Calculate total volume
  let totalVolume = 0;
  for (const sets of Object.values(activeWorkout.sets)) {
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

  // Check for PRs
  const exerciseMap = await DB.getExerciseMap();
  for (const [exId, sets] of Object.entries(activeWorkout.sets)) {
    const workSets = sets.filter(s => !s.isWarmup && s.completed);
    for (const s of workSets) {
      const result = await DB.checkAndUpdatePR(
        Number(exId), `${s.targetReps}rm`,
        s.actualWeight, s.actualReps,
        activeWorkout.workout.id, activeWorkout.workout.date
      );
      if (result.isNewPR) {
        const ex = exerciseMap[exId];
        showToast(`PR! ${ex?.name || ''}: ${s.actualWeight}x${s.actualReps}`, 'pr');
      }
    }
  }

  clearInterval(workoutTimer);
  releaseWakeLock();
  activeWorkout = null;
  showToast('Workout complete!', 'success');
  renderView('workout');
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

// ── REST TIMER ────────────────────────────────────────────
function showRestTimer(seconds, exerciseName, lastSet) {
  const overlay = document.getElementById('timer-overlay');
  overlay.classList.remove('hidden');

  const circumference = 2 * Math.PI * 100;
  const ring = document.getElementById('timer-ring-progress');
  ring.style.strokeDasharray = circumference;

  const timeDisplay = document.getElementById('timer-time');
  const labelDisplay = document.getElementById('timer-exercise-label');
  labelDisplay.textContent = `Rest after ${exerciseName} Set ${lastSet.setNumber}`;

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
          <div class="list-item-sub">${p.days.length} days &middot; ${p.type}</div>
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

  const exerciseMap = await DB.getExerciseMap();

  // Toggle active
  if (selectedProgram?.id !== id) {
    // Deactivate current
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

  // Show program detail in modal
  showModal(`
    <div class="modal-title">${program.name}</div>
    ${program.days.map(day => `
      <div class="card">
        <div class="card-title">${day.name}</div>
        ${day.exercises.map(ex => {
          const exercise = exerciseMap[ex.exerciseId];
          return `<div class="text-sm mt-8">${exercise?.name || '?'} - ${ex.sets}x${ex.reps}</div>`;
        }).join('')}
      </div>
    `).join('')}
    ${program.isCustom ? `<button class="btn btn-danger btn-sm mt-16" onclick="deleteProgram(${id})">Delete Program</button>` : ''}
  `);
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
  showModal(`
    <div class="modal-title">Create Program</div>
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-input" id="new-prog-name" placeholder="My Program">
    </div>
    <div class="form-group">
      <label class="form-label">Type</label>
      <select class="form-select" id="new-prog-type">
        <option value="strength">Strength</option>
        <option value="cardio">Cardio</option>
        <option value="hybrid">Hybrid</option>
        <option value="outdoor">Outdoor</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Days Per Week</label>
      <input class="form-input" id="new-prog-days" type="number" value="3" min="1" max="7">
    </div>
    <button class="btn btn-primary mt-16" onclick="createProgram()">Create</button>
  `);
}

async function createProgram() {
  const name = document.getElementById('new-prog-name').value.trim();
  const type = document.getElementById('new-prog-type').value;
  const daysPerWeek = parseInt(document.getElementById('new-prog-days').value) || 3;

  if (!name) { showToast('Enter a name', 'error'); return; }

  const days = [];
  for (let i = 1; i <= daysPerWeek; i++) {
    days.push({ id: `day${i}`, name: `Day ${i}`, exercises: [] });
  }

  const program = {
    name, type, isDefault: false, daysPerWeek,
    alternating: daysPerWeek <= 3,
    days,
    progression: { upperIncrement: 5, lowerIncrement: 5, deadliftIncrement: 10, failureRetries: 3, deloadPercent: 10, maxDeloads: 3 },
    isCustom: true
  };

  await DB.add('programs', program);
  closeModal();
  showToast('Program created', 'success');
  renderView('programs');
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
      IronLog v1.1.0<br>
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
    ${exs.map(e => `
      <div class="list-item" data-name="${e.name.toLowerCase()}">
        <div class="list-item-text">
          <div class="list-item-title">${e.name} ${e.isCustom ? '<span class="text-muted text-sm">(custom)</span>' : ''}</div>
          <div class="list-item-sub">${e.defaultSets}x${e.defaultReps} &middot; ${e.muscleGroups.join(', ')}</div>
        </div>
      </div>
    `).join('')}
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

  await DB.add('exercises', {
    name, category, muscleGroups: [],
    isBarbell: category === 'barbell',
    barbellWeight: category === 'barbell' ? 45 : 0,
    defaultSets, defaultReps,
    defaultRestSec: category === 'barbell' ? 180 : 90,
    incrementLbs: 5, isCustom: true, isActive: true
  });

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
window.createProgram = createProgram;
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
