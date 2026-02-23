// IronLog - Claude AI Client

const AI_SYSTEM_PROMPT = `You are a Starting Strength coach and strength training analyst. You analyze workout data and provide brief, actionable feedback.

Key principles:
- Starting Strength NLP uses linear progression (add weight every session)
- Compounds: Squat, Bench, Press, Deadlift, Power Clean
- Form and consistency matter more than ego lifting
- Recovery (sleep, food, stress) is half the equation
- When lifts stall: retry -> deload 10% -> work back up -> switch to 3x3 -> intermediate program

Keep responses concise (2-3 observations, 1-2 suggestions). No fluff. Use lbs unless user specifies kg.`;

const ANALYSIS_TYPES = {
  post_workout: {
    prompt: (data) => `Analyze this workout session:

${formatWorkoutForAI(data.workout, data.sets, data.exercises)}

Last 5 sessions for these exercises:
${formatHistoryForAI(data.history)}

Give 2-3 observations and 1-2 suggestions. ~150 words max.`
  },

  stall_detection: {
    prompt: (data) => `This lifter has failed ${data.exercise.name} at ${data.weight} lbs for ${data.failures} consecutive sessions.

Recent history:
${formatHistoryForAI(data.history)}

Confirm the stall and recommend a specific deload weight. Be direct.`
  },

  deload_suggestion: {
    prompt: (data) => `Lifter deloaded ${data.exercise.name} from ${data.previousWeight} to ${data.newWeight} lbs after ${data.failures} failures.

Provide a brief timeline to return to the previous weight and any form cues to focus on. 3-4 sentences.`
  },

  weekly_review: {
    prompt: (data) => `Weekly training summary (past 7 days):

${data.workouts.map(w => formatWorkoutForAI(w.workout, w.sets, data.exercises)).join('\n---\n')}

Bodyweight trend: ${data.bodyweight || 'not tracked'}
Sessions completed: ${data.workouts.length}
Sessions missed: ${data.missed}

Brief weekly review: volume trends, PRs hit, consistency, one suggestion.`
  },

  trend_analysis: {
    prompt: (data) => `Monthly training analysis:

Exercise progression rates (lbs/week):
${data.progressionRates.map(p => `${p.name}: ${p.rate > 0 ? '+' : ''}${p.rate.toFixed(1)}`).join('\n')}

Total sessions: ${data.totalSessions}
Completion rate: ${data.completionRate}%
PRs this month: ${data.prCount}
Deloads: ${data.deloadCount}

Identify plateaus, suggest program adjustments if needed, and note any concerning patterns. ~200 words.`
  }
};

function formatWorkoutForAI(workout, sets, exercises) {
  const lines = [`Date: ${workout.date} | Duration: ${workout.duration || '?'}min`];
  const byExercise = {};
  for (const s of sets) {
    if (!byExercise[s.exerciseId]) byExercise[s.exerciseId] = [];
    byExercise[s.exerciseId].push(s);
  }
  for (const [exId, exSets] of Object.entries(byExercise)) {
    const ex = exercises[exId];
    const name = ex ? ex.name : `Exercise ${exId}`;
    const setStrs = exSets
      .filter(s => !s.isWarmup)
      .map(s => `${s.actualWeight}x${s.actualReps}${s.completed ? '' : ' (F)'}${s.rpe ? ` @${s.rpe}` : ''}`)
      .join(', ');
    lines.push(`${name}: ${setStrs}`);
  }
  if (workout.notes) lines.push(`Notes: ${workout.notes}`);
  return lines.join('\n');
}

function formatHistoryForAI(history) {
  if (!history || history.length === 0) return 'No previous data';
  return history.map(h => {
    const date = h.workout.date;
    const setStrs = h.sets
      .filter(s => !s.isWarmup)
      .map(s => `${s.actualWeight}x${s.actualReps}${s.completed ? '' : '(F)'}`)
      .join(', ');
    return `${date}: ${setStrs}`;
  }).join('\n');
}

async function analyzeWorkout(type, data, settings) {
  const analysisType = ANALYSIS_TYPES[type];
  if (!analysisType) throw new Error(`Unknown analysis type: ${type}`);

  const userPrompt = analysisType.prompt(data);

  // Try direct API call first (user's own key)
  if (settings.anthropicApiKey) {
    return callAnthropicDirect(userPrompt, settings.anthropicApiKey);
  }

  // Fall back to backend proxy (explicit URL or auto-detect same-origin)
  const proxyUrl = settings.backendUrl || window.location.origin;
  return callBackendProxy(userPrompt, proxyUrl);
}

async function callAnthropicDirect(prompt, apiKey) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: AI_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${resp.status}`);
  }

  const result = await resp.json();
  return result.content[0].text;
}

async function callBackendProxy(prompt, backendUrl) {
  const url = backendUrl.replace(/\/$/, '') + '/api/analyze';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, system: AI_SYSTEM_PROMPT })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Backend error ${resp.status}`);
  }

  const result = await resp.json();
  return result.analysis;
}

window.analyzeWorkout = analyzeWorkout;
window.ANALYSIS_TYPES = ANALYSIS_TYPES;
