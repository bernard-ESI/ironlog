// IronLog - Plate Calculator

const DEFAULT_PLATES = [45, 35, 25, 10, 5, 2.5];
const DEFAULT_BAR_WEIGHT = 45;

function calculatePlates(targetWeight, barWeight = DEFAULT_BAR_WEIGHT, availablePlates = DEFAULT_PLATES) {
  if (targetWeight <= barWeight) {
    return { perSide: [], totalWeight: barWeight, remainder: 0 };
  }

  const perSide = (targetWeight - barWeight) / 2;
  const sorted = [...availablePlates].sort((a, b) => b - a);
  const plates = [];
  let remaining = perSide;

  for (const plate of sorted) {
    while (remaining >= plate) {
      plates.push(plate);
      remaining -= plate;
      remaining = Math.round(remaining * 10) / 10; // fix float
    }
  }

  return {
    perSide: plates,
    totalWeight: barWeight + (perSide - remaining) * 2,
    remainder: Math.round(remaining * 10) / 10
  };
}

// Plate colors (standard gym colors)
const PLATE_COLORS = {
  45: '#e94560',  // red
  35: '#3b82f6',  // blue
  25: '#22c55e',  // green
  10: '#f59e0b',  // yellow
  5: '#8b5cf6',   // purple
  2.5: '#6b7280'  // gray
};

function renderPlateVisual(plates, barWeight = DEFAULT_BAR_WEIGHT) {
  if (plates.length === 0) {
    return `<div class="plate-visual">
      <div class="plate-bar-only">
        <div class="plate-bar-end"></div>
        <div class="plate-bar-shaft"></div>
        <div class="plate-bar-end"></div>
      </div>
      <div class="plate-label">${barWeight} lbs (empty bar)</div>
    </div>`;
  }

  const leftPlates = plates.map(p =>
    `<div class="plate" style="background:${PLATE_COLORS[p] || '#888'};height:${20 + p * 1.2}px" title="${p} lbs">${p}</div>`
  ).join('');

  const rightPlates = [...plates].reverse().map(p =>
    `<div class="plate" style="background:${PLATE_COLORS[p] || '#888'};height:${20 + p * 1.2}px" title="${p} lbs">${p}</div>`
  ).join('');

  return `<div class="plate-visual">
    <div class="plate-barbell">
      <div class="plate-side plate-left">${leftPlates}</div>
      <div class="plate-bar-shaft"></div>
      <div class="plate-side plate-right">${rightPlates}</div>
    </div>
  </div>`;
}

function formatPlateBreakdown(result) {
  if (result.perSide.length === 0) return 'Empty bar';
  const counts = {};
  for (const p of result.perSide) {
    counts[p] = (counts[p] || 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort(([a], [b]) => b - a)
    .map(([plate, count]) => `${count}x${plate}`);
  return parts.join(' + ') + ' per side';
}

// Generate warmup scheme for Starting Strength
function generateWarmups(workWeight, barWeight = 45) {
  const warmups = [];

  // Always start with empty bar x5
  warmups.push({ weight: barWeight, reps: 5, label: 'Empty bar' });

  // Only add intermediate warmups if work weight is above the bar
  if (workWeight > barWeight) {
    if (workWeight > barWeight * 1.5) {
      // 40% x5
      const w40 = roundToNearest(workWeight * 0.4, 5);
      if (w40 > barWeight) warmups.push({ weight: w40, reps: 5, label: '40%' });
    }

    if (workWeight > barWeight * 2) {
      // 60% x3
      const w60 = roundToNearest(workWeight * 0.6, 5);
      warmups.push({ weight: w60, reps: 3, label: '60%' });
    }

    if (workWeight > barWeight * 2.5) {
      // 80% x2
      const w80 = roundToNearest(workWeight * 0.8, 5);
      warmups.push({ weight: w80, reps: 2, label: '80%' });
    }
  }

  return warmups;
}

function roundToNearest(weight, increment = 5) {
  return Math.round(weight / increment) * increment;
}

window.calculatePlates = calculatePlates;
window.renderPlateVisual = renderPlateVisual;
window.formatPlateBreakdown = formatPlateBreakdown;
window.generateWarmups = generateWarmups;
window.roundToNearest = roundToNearest;
window.PLATE_COLORS = PLATE_COLORS;
