// IronLog - Chart.js Wrappers

const CHART_COLORS = {
  primary: '#e94560',
  secondary: '#3b82f6',
  success: '#4ade80',
  warning: '#f59e0b',
  purple: '#8b5cf6',
  grid: 'rgba(255,255,255,0.06)',
  text: '#aaa',
  tooltip: '#1a1a2e'
};

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: CHART_COLORS.tooltip,
      titleColor: '#eee',
      bodyColor: '#ccc',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      cornerRadius: 8,
      padding: 10
    }
  },
  scales: {
    x: {
      grid: { color: CHART_COLORS.grid },
      ticks: { color: CHART_COLORS.text, maxRotation: 45 }
    },
    y: {
      grid: { color: CHART_COLORS.grid },
      ticks: { color: CHART_COLORS.text }
    }
  }
};

// Active chart instances (for cleanup)
const _charts = {};

function destroyChart(id) {
  if (_charts[id]) {
    _charts[id].destroy();
    delete _charts[id];
  }
}

// Weight progression line chart
function renderWeightChart(canvasId, history, exerciseName) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const data = history.map(h => {
    const workSets = h.sets.filter(s => !s.isWarmup);
    const maxWeight = workSets.length > 0 ? Math.max(...workSets.map(s => s.actualWeight)) : 0;
    return { date: h.workout.date, weight: maxWeight };
  }).reverse();

  _charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: data.map(d => formatChartDate(d.date)),
      datasets: [{
        label: `${exerciseName} (lbs)`,
        data: data.map(d => d.weight),
        borderColor: CHART_COLORS.primary,
        backgroundColor: 'rgba(233,69,96,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS.primary
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: true, labels: { color: '#eee' } }
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, title: { display: true, text: 'Weight (lbs)', color: CHART_COLORS.text } }
      }
    }
  });
}

// Estimated 1RM chart
function renderE1RMChart(canvasId, history, exerciseName) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const data = history.map(h => {
    const workSets = h.sets.filter(s => !s.isWarmup && s.completed);
    let best1RM = 0;
    for (const s of workSets) {
      const e1rm = Progression.estimated1RM(s.actualWeight, s.actualReps);
      if (e1rm > best1RM) best1RM = e1rm;
    }
    return { date: h.workout.date, e1rm: best1RM };
  }).reverse();

  _charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: data.map(d => formatChartDate(d.date)),
      datasets: [{
        label: `Est. 1RM (lbs)`,
        data: data.map(d => d.e1rm),
        borderColor: CHART_COLORS.purple,
        backgroundColor: 'rgba(139,92,246,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS.purple
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: true, labels: { color: '#eee' } }
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, title: { display: true, text: 'Est. 1RM (lbs)', color: CHART_COLORS.text } }
      }
    }
  });
}

// Weekly volume bar chart
function renderVolumeChart(canvasId, workouts, exerciseMap) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Group by week
  const weeks = {};
  for (const w of workouts) {
    const weekStart = getWeekStart(w.workout.date);
    if (!weeks[weekStart]) weeks[weekStart] = 0;
    for (const s of w.sets) {
      if (!s.isWarmup && s.completed) {
        weeks[weekStart] += (s.actualWeight || 0) * (s.actualReps || 0);
      }
    }
  }

  const sorted = Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b));

  _charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: sorted.map(([d]) => formatChartDate(d)),
      datasets: [{
        label: 'Volume (lbs)',
        data: sorted.map(([, v]) => v),
        backgroundColor: 'rgba(59,130,246,0.6)',
        borderColor: CHART_COLORS.secondary,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: true, labels: { color: '#eee' } }
      }
    }
  });
}

// Bodyweight trend
function renderBodyweightChart(canvasId, metrics) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || metrics.length === 0) return;

  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));

  _charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: sorted.map(m => formatChartDate(m.date)),
      datasets: [{
        label: 'Bodyweight (lbs)',
        data: sorted.map(m => m.weight),
        borderColor: CHART_COLORS.success,
        backgroundColor: 'rgba(74,222,128,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS.success
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: true, labels: { color: '#eee' } }
      }
    }
  });
}

// PR timeline chart (grouped by exercise)
function renderPRChart(canvasId, prs, exerciseMap) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || prs.length === 0) return;

  const sorted = [...prs].sort((a, b) => a.date.localeCompare(b.date));
  const colors = [CHART_COLORS.primary, CHART_COLORS.secondary, CHART_COLORS.success, CHART_COLORS.warning, CHART_COLORS.purple];

  // Group by exercise
  const byExercise = {};
  for (const pr of sorted) {
    const name = exerciseMap[pr.exerciseId]?.name || 'Unknown';
    if (!byExercise[name]) byExercise[name] = [];
    byExercise[name].push(pr);
  }

  const datasets = Object.entries(byExercise).map(([name, exPrs], i) => ({
    label: name,
    data: exPrs.map(pr => pr.weight),
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length] + '33',
    fill: false,
    tension: 0.3,
    pointRadius: 6,
    pointBackgroundColor: colors[i % colors.length]
  }));

  // Use dates from the longest series for labels
  const allDates = sorted.map(pr => formatChartDate(pr.date));
  const uniqueDates = [...new Set(allDates)];

  _charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: uniqueDates,
      datasets
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: true, labels: { color: '#eee', boxWidth: 12 } }
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, title: { display: true, text: 'PR Weight (lbs)', color: CHART_COLORS.text } }
      }
    }
  });
}

// Helpers
function formatChartDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().split('T')[0];
}

window.IronCharts = {
  renderWeightChart,
  renderE1RMChart,
  renderVolumeChart,
  renderBodyweightChart,
  renderPRChart,
  destroyChart,
  destroyAll: () => Object.keys(_charts).forEach(destroyChart)
};
