// IronLog - IndexedDB Wrapper
// All 7 stores: exercises, programs, workouts, sets, bodyMetrics, personalRecords, settings

const DB_NAME = 'ironlog';
const DB_VERSION = 1;
let _db = null;

const STORES = {
  exercises: { keyPath: 'id', autoIncrement: true, indexes: [
    { name: 'name', keyPath: 'name', unique: true },
    { name: 'category', keyPath: 'category', unique: false }
  ]},
  programs: { keyPath: 'id', autoIncrement: true, indexes: [
    { name: 'name', keyPath: 'name', unique: false },
    { name: 'type', keyPath: 'type', unique: false },
    { name: 'isDefault', keyPath: 'isDefault', unique: false }
  ]},
  workouts: { keyPath: 'id', autoIncrement: true, indexes: [
    { name: 'date', keyPath: 'date', unique: false },
    { name: 'programId', keyPath: 'programId', unique: false },
    { name: 'status', keyPath: 'status', unique: false }
  ]},
  sets: { keyPath: 'id', autoIncrement: true, indexes: [
    { name: 'workoutId', keyPath: 'workoutId', unique: false },
    { name: 'exerciseId', keyPath: 'exerciseId', unique: false },
    { name: 'workout_exercise', keyPath: ['workoutId', 'exerciseId'], unique: false }
  ]},
  bodyMetrics: { keyPath: 'id', autoIncrement: true, indexes: [
    { name: 'date', keyPath: 'date', unique: true }
  ]},
  personalRecords: { keyPath: 'id', autoIncrement: true, indexes: [
    { name: 'exerciseId', keyPath: 'exerciseId', unique: false },
    { name: 'exercise_type', keyPath: ['exerciseId', 'type'], unique: false }
  ]},
  settings: { keyPath: 'id' }
};

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const [name, config] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, {
            keyPath: config.keyPath,
            autoIncrement: config.autoIncrement || false
          });
          if (config.indexes) {
            for (const idx of config.indexes) {
              store.createIndex(idx.name, idx.keyPath, { unique: idx.unique });
            }
          }
        }
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
  });
}

function tx(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Generic CRUD
const DB = {
  async init() {
    await openDB();
  },

  async add(storeName, data) {
    await openDB();
    return promisify(tx(storeName, 'readwrite').add(data));
  },

  async put(storeName, data) {
    await openDB();
    return promisify(tx(storeName, 'readwrite').put(data));
  },

  async get(storeName, id) {
    await openDB();
    return promisify(tx(storeName).get(id));
  },

  async getAll(storeName) {
    await openDB();
    return promisify(tx(storeName).getAll());
  },

  async delete(storeName, id) {
    await openDB();
    return promisify(tx(storeName, 'readwrite').delete(id));
  },

  async clear(storeName) {
    await openDB();
    return promisify(tx(storeName, 'readwrite').clear());
  },

  async getByIndex(storeName, indexName, value) {
    await openDB();
    return promisify(tx(storeName).index(indexName).getAll(value));
  },

  async getOneByIndex(storeName, indexName, value) {
    await openDB();
    return promisify(tx(storeName).index(indexName).get(value));
  },

  async count(storeName) {
    await openDB();
    return promisify(tx(storeName).count());
  },

  // Workout-specific helpers
  async getSetsByWorkout(workoutId) {
    const sets = await this.getByIndex('sets', 'workoutId', workoutId);
    return sets.sort((a, b) => a.order - b.order);
  },

  async getSetsForExercise(workoutId, exerciseId) {
    await openDB();
    return promisify(
      tx('sets').index('workout_exercise').getAll([workoutId, exerciseId])
    );
  },

  async getWorkoutsByDate(date) {
    return this.getByIndex('workouts', 'date', date);
  },

  async getRecentWorkouts(limit = 20) {
    const all = await this.getAll('workouts');
    return all.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, limit);
  },

  async getWorkoutsByProgram(programId) {
    return this.getByIndex('workouts', 'programId', programId);
  },

  // PR helpers
  async getPRsForExercise(exerciseId) {
    return this.getByIndex('personalRecords', 'exerciseId', exerciseId);
  },

  async checkAndUpdatePR(exerciseId, type, weight, reps, workoutId, date) {
    const existing = await this.getByIndex('personalRecords', 'exercise_type', [exerciseId, type]);
    const estimated1RM = weight * (1 + reps / 30); // Epley
    const record = existing[0];

    if (!record || weight > record.weight || (weight === record.weight && reps > record.reps)) {
      const pr = {
        exerciseId, type, weight, reps, estimated1RM, workoutId, date,
        ...(record ? { id: record.id } : {})
      };
      await this.put('personalRecords', pr);
      return { isNewPR: true, previous: record, current: pr };
    }
    return { isNewPR: false };
  },

  // Settings (single record with id=1)
  async getSettings() {
    const s = await this.get('settings', 1);
    return s || {
      id: 1,
      units: 'lbs',
      defaultRestSec: 180,
      timerSound: true,
      timerVibrate: true,
      availablePlates: [45, 35, 25, 10, 5, 2.5],
      anthropicApiKey: '',
      aiEnabled: false,
      backendUrl: '',
      darkMode: true
    };
  },

  async saveSettings(settings) {
    settings.id = 1;
    return this.put('settings', settings);
  },

  // Exercise lookup by ID (cached)
  _exerciseCache: null,
  async getExerciseMap() {
    if (this._exerciseCache) return this._exerciseCache;
    const exercises = await this.getAll('exercises');
    this._exerciseCache = {};
    for (const ex of exercises) {
      this._exerciseCache[ex.id] = ex;
    }
    return this._exerciseCache;
  },

  invalidateExerciseCache() {
    this._exerciseCache = null;
  },

  // Bulk export/import
  async exportAll() {
    const data = {};
    for (const store of Object.keys(STORES)) {
      data[store] = await this.getAll(store);
    }
    data._exportDate = new Date().toISOString();
    data._version = DB_VERSION;
    return data;
  },

  async importAll(data) {
    for (const store of Object.keys(STORES)) {
      if (data[store]) {
        await this.clear(store);
        for (const item of data[store]) {
          await this.put(store, item);
        }
      }
    }
    this._exerciseCache = null;
  },

  // Last workout for a program day (for progression)
  async getLastWorkoutForDay(programId, programDayId) {
    const workouts = await this.getByIndex('workouts', 'programId', programId);
    const matching = workouts
      .filter(w => w.programDayId === programDayId && w.status === 'completed')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    return matching[0] || null;
  },

  // Get exercise history (last N sessions)
  async getExerciseHistory(exerciseId, limit = 10) {
    const allSets = await this.getByIndex('sets', 'exerciseId', exerciseId);
    const byWorkout = {};
    for (const s of allSets) {
      if (!byWorkout[s.workoutId]) byWorkout[s.workoutId] = [];
      byWorkout[s.workoutId].push(s);
    }

    const workoutIds = Object.keys(byWorkout).map(Number);
    const workouts = [];
    for (const wid of workoutIds) {
      const w = await this.get('workouts', wid);
      if (w && w.status === 'completed') {
        workouts.push({ workout: w, sets: byWorkout[wid].sort((a, b) => a.setNumber - b.setNumber) });
      }
    }

    return workouts
      .sort((a, b) => new Date(b.workout.date) - new Date(a.workout.date))
      .slice(0, limit);
  },

  // Consecutive failure count for an exercise at a given weight
  async getConsecutiveFailures(exerciseId, weight) {
    const history = await this.getExerciseHistory(exerciseId, 10);
    let count = 0;
    for (const session of history) {
      const atWeight = session.sets.filter(s => s.targetWeight === weight && !s.isWarmup);
      if (atWeight.length === 0) break;
      const anyFailed = atWeight.some(s => !s.completed || s.actualReps < s.targetReps);
      if (anyFailed) count++;
      else break;
    }
    return count;
  },

  // Deload count at a weight zone (within 15% of weight)
  async getDeloadCount(exerciseId, weight) {
    const history = await this.getExerciseHistory(exerciseId, 30);
    let deloads = 0;
    for (let i = 1; i < history.length; i++) {
      const prevMax = Math.max(...history[i].sets.filter(s => !s.isWarmup).map(s => s.targetWeight));
      const currMax = Math.max(...history[i - 1].sets.filter(s => !s.isWarmup).map(s => s.targetWeight));
      if (currMax < prevMax * 0.95 && Math.abs(prevMax - weight) / weight < 0.15) {
        deloads++;
      }
    }
    return deloads;
  }
};

window.DB = DB;
