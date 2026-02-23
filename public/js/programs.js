// IronLog - Starting Strength NLP + Program Engine

// Default exercise library
const DEFAULT_EXERCISES = [
  // Barbell compounds
  { name: 'Squat', category: 'barbell', muscleGroups: ['quads', 'glutes', 'hamstrings', 'core'], isBarbell: true, barbellWeight: 45, defaultSets: 3, defaultReps: 5, defaultRestSec: 180, incrementLbs: 5, isCustom: false, isActive: true },
  { name: 'Bench Press', category: 'barbell', muscleGroups: ['chest', 'shoulders', 'triceps'], isBarbell: true, barbellWeight: 45, defaultSets: 3, defaultReps: 5, defaultRestSec: 180, incrementLbs: 5, isCustom: false, isActive: true },
  { name: 'Overhead Press', category: 'barbell', muscleGroups: ['shoulders', 'triceps', 'core'], isBarbell: true, barbellWeight: 45, defaultSets: 3, defaultReps: 5, defaultRestSec: 180, incrementLbs: 5, isCustom: false, isActive: true },
  { name: 'Deadlift', category: 'barbell', muscleGroups: ['back', 'hamstrings', 'glutes', 'core'], isBarbell: true, barbellWeight: 45, defaultSets: 1, defaultReps: 5, defaultRestSec: 300, incrementLbs: 10, isCustom: false, isActive: true },
  { name: 'Barbell Row', category: 'barbell', muscleGroups: ['back', 'biceps', 'core'], isBarbell: true, barbellWeight: 45, defaultSets: 3, defaultReps: 5, defaultRestSec: 180, incrementLbs: 5, isCustom: false, isActive: true },
  { name: 'Power Clean', category: 'barbell', muscleGroups: ['back', 'shoulders', 'hamstrings', 'traps'], isBarbell: true, barbellWeight: 45, defaultSets: 5, defaultReps: 3, defaultRestSec: 180, incrementLbs: 5, isCustom: false, isActive: true },
  { name: 'Front Squat', category: 'barbell', muscleGroups: ['quads', 'core', 'shoulders'], isBarbell: true, barbellWeight: 45, defaultSets: 3, defaultReps: 5, defaultRestSec: 180, incrementLbs: 5, isCustom: false, isActive: true },
  { name: 'Romanian Deadlift', category: 'barbell', muscleGroups: ['hamstrings', 'glutes', 'back'], isBarbell: true, barbellWeight: 45, defaultSets: 3, defaultReps: 8, defaultRestSec: 120, incrementLbs: 5, isCustom: false, isActive: true },

  // Dumbbell
  { name: 'Dumbbell Curl', category: 'dumbbell', muscleGroups: ['biceps'], isBarbell: false, barbellWeight: 0, defaultSets: 3, defaultReps: 10, defaultRestSec: 90, incrementLbs: 5, isCustom: false, isActive: true },
  { name: 'Dumbbell Lateral Raise', category: 'dumbbell', muscleGroups: ['shoulders'], isBarbell: false, barbellWeight: 0, defaultSets: 3, defaultReps: 12, defaultRestSec: 60, incrementLbs: 2.5, isCustom: false, isActive: true },
  { name: 'Dumbbell Bench Press', category: 'dumbbell', muscleGroups: ['chest', 'shoulders', 'triceps'], isBarbell: false, barbellWeight: 0, defaultSets: 3, defaultReps: 10, defaultRestSec: 90, incrementLbs: 5, isCustom: false, isActive: true },

  // Bodyweight
  { name: 'Pull-up', category: 'bodyweight', muscleGroups: ['back', 'biceps'], isBarbell: false, barbellWeight: 0, defaultSets: 3, defaultReps: 8, defaultRestSec: 120, incrementLbs: 0, isCustom: false, isActive: true },
  { name: 'Dip', category: 'bodyweight', muscleGroups: ['chest', 'triceps', 'shoulders'], isBarbell: false, barbellWeight: 0, defaultSets: 3, defaultReps: 10, defaultRestSec: 90, incrementLbs: 0, isCustom: false, isActive: true },
  { name: 'Push-up', category: 'bodyweight', muscleGroups: ['chest', 'shoulders', 'triceps'], isBarbell: false, barbellWeight: 0, defaultSets: 3, defaultReps: 15, defaultRestSec: 60, incrementLbs: 0, isCustom: false, isActive: true },
  { name: 'Plank', category: 'bodyweight', muscleGroups: ['core'], isBarbell: false, barbellWeight: 0, defaultSets: 3, defaultReps: 60, defaultRestSec: 60, incrementLbs: 0, isCustom: false, isActive: true },

  // Machine
  { name: 'Leg Press', category: 'machine', muscleGroups: ['quads', 'glutes'], isBarbell: false, barbellWeight: 0, defaultSets: 3, defaultReps: 10, defaultRestSec: 120, incrementLbs: 10, isCustom: false, isActive: true },
  { name: 'Lat Pulldown', category: 'machine', muscleGroups: ['back', 'biceps'], isBarbell: false, barbellWeight: 0, defaultSets: 3, defaultReps: 10, defaultRestSec: 90, incrementLbs: 5, isCustom: false, isActive: true },
  { name: 'Cable Row', category: 'machine', muscleGroups: ['back', 'biceps'], isBarbell: false, barbellWeight: 0, defaultSets: 3, defaultReps: 10, defaultRestSec: 90, incrementLbs: 5, isCustom: false, isActive: true },

  // Cardio
  { name: 'Treadmill Run', category: 'cardio', muscleGroups: ['cardio'], isBarbell: false, barbellWeight: 0, defaultSets: 1, defaultReps: 1, defaultRestSec: 0, incrementLbs: 0, isCustom: false, isActive: true },
  { name: 'Stationary Bike', category: 'cardio', muscleGroups: ['cardio'], isBarbell: false, barbellWeight: 0, defaultSets: 1, defaultReps: 1, defaultRestSec: 0, incrementLbs: 0, isCustom: false, isActive: true },

  // Outdoor
  { name: 'Hiking', category: 'outdoor', muscleGroups: ['cardio', 'legs'], isBarbell: false, barbellWeight: 0, defaultSets: 1, defaultReps: 1, defaultRestSec: 0, incrementLbs: 0, isCustom: false, isActive: true },
  { name: 'Trail Run', category: 'outdoor', muscleGroups: ['cardio', 'legs'], isBarbell: false, barbellWeight: 0, defaultSets: 1, defaultReps: 1, defaultRestSec: 0, incrementLbs: 0, isCustom: false, isActive: true },
];

// Starting Strength NLP program template
function createSSNLP(exerciseMap) {
  const find = (name) => {
    for (const [id, ex] of Object.entries(exerciseMap)) {
      if (ex.name === name) return Number(id);
    }
    return null;
  };

  return {
    name: 'Starting Strength NLP',
    type: 'strength',
    isDefault: true,
    daysPerWeek: 3,
    alternating: true,
    days: [
      {
        id: 'A',
        name: 'Workout A',
        exercises: [
          { exerciseId: find('Squat'), sets: 3, reps: 5, order: 1 },
          { exerciseId: find('Bench Press'), sets: 3, reps: 5, order: 2 },
          { exerciseId: find('Deadlift'), sets: 1, reps: 5, order: 3 }
        ]
      },
      {
        id: 'B',
        name: 'Workout B',
        exercises: [
          { exerciseId: find('Squat'), sets: 3, reps: 5, order: 1 },
          { exerciseId: find('Overhead Press'), sets: 3, reps: 5, order: 2 },
          { exerciseId: find('Barbell Row'), sets: 3, reps: 5, order: 3 }
        ]
      }
    ],
    progression: {
      upperIncrement: 5,
      lowerIncrement: 5,
      deadliftIncrement: 10,
      failureRetries: 3,
      deloadPercent: 10,
      maxDeloads: 3
    },
    isCustom: false
  };
}

// Progression engine
const Progression = {
  // Calculate next weight for an exercise based on history
  async getNextWeight(exerciseId, exercise, program) {
    const history = await DB.getExerciseHistory(exerciseId, 5);
    if (history.length === 0) return exercise.barbellWeight || 45; // Start with empty bar

    const lastSession = history[0];
    const workSets = lastSession.sets.filter(s => !s.isWarmup);
    if (workSets.length === 0) return exercise.barbellWeight || 45;

    const lastWeight = workSets[0].targetWeight;
    const allCompleted = workSets.every(s => s.completed && s.actualReps >= s.targetReps);

    if (allCompleted) {
      // Success -> increment
      const increment = this.getIncrement(exercise, program);
      return lastWeight + increment;
    }

    // Failed -> check consecutive failures
    const failures = await DB.getConsecutiveFailures(exerciseId, lastWeight);

    if (failures < (program.progression?.failureRetries || 3)) {
      // Retry same weight
      return lastWeight;
    }

    // Deload
    const deloadPct = program.progression?.deloadPercent || 10;
    const deloaded = roundToNearest(lastWeight * (1 - deloadPct / 100), 5);
    return Math.max(deloaded, exercise.barbellWeight || 45);
  },

  getIncrement(exercise, program) {
    if (!program.progression) return exercise.incrementLbs || 5;

    const name = exercise.name.toLowerCase();
    if (name.includes('deadlift')) return program.progression.deadliftIncrement || 10;
    if (name.includes('squat')) return program.progression.lowerIncrement || 5;
    return program.progression.upperIncrement || 5;
  },

  // Determine next workout day (alternating A/B)
  async getNextDay(program) {
    if (!program.alternating || program.days.length < 2) {
      return program.days[0];
    }

    const workouts = await DB.getWorkoutsByProgram(program.id);
    const completed = workouts
      .filter(w => w.status === 'completed')
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (completed.length === 0) return program.days[0];

    const lastDayId = completed[0].programDayId;
    const lastIdx = program.days.findIndex(d => d.id === lastDayId);
    const nextIdx = (lastIdx + 1) % program.days.length;
    return program.days[nextIdx];
  },

  // Check if NLP is exhausted (suggest intermediate)
  async checkNLPStatus(exerciseId, exercise, program) {
    const deloads = await DB.getDeloadCount(exerciseId, 0);
    const maxDeloads = program.progression?.maxDeloads || 3;

    if (deloads >= maxDeloads) {
      return {
        status: 'nlp_complete',
        message: `${exercise.name} has stalled after ${deloads} deloads. Consider switching to an intermediate program (Texas Method, HLM, or 531).`
      };
    }

    if (deloads >= 2) {
      return {
        status: 'consider_3x3',
        message: `${exercise.name} has deloaded ${deloads} times at this weight zone. Consider switching to 3x3 before moving to intermediate.`
      };
    }

    return { status: 'progressing', message: null };
  },

  // Calculate estimated 1RM (Epley formula)
  estimated1RM(weight, reps) {
    if (reps <= 0 || weight <= 0) return 0;
    if (reps === 1) return weight;
    return Math.round(weight * (1 + reps / 30));
  }
};

// Seed database with defaults if empty
async function seedDefaults() {
  const exerciseCount = await DB.count('exercises');
  if (exerciseCount > 0) return; // Already seeded

  // Add exercises
  for (const ex of DEFAULT_EXERCISES) {
    await DB.add('exercises', ex);
  }

  // Build exercise map
  DB.invalidateExerciseCache();
  const exerciseMap = await DB.getExerciseMap();

  // Add Starting Strength program
  const ssProgram = createSSNLP(exerciseMap);
  await DB.add('programs', ssProgram);

  // Set default settings
  await DB.saveSettings({
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
  });
}

window.DEFAULT_EXERCISES = DEFAULT_EXERCISES;
window.Progression = Progression;
window.seedDefaults = seedDefaults;
window.createSSNLP = createSSNLP;
