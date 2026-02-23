// IronLog - Smart Rest Timer with Web Worker

// Web Worker code as inline blob
const WORKER_CODE = `
let timerId = null;
let remaining = 0;
let running = false;

self.onmessage = function(e) {
  const { cmd, seconds } = e.data;
  switch (cmd) {
    case 'start':
      remaining = seconds;
      running = true;
      clearInterval(timerId);
      timerId = setInterval(() => {
        if (!running) return;
        remaining--;
        self.postMessage({ type: 'tick', remaining });
        if (remaining <= 0) {
          clearInterval(timerId);
          running = false;
          self.postMessage({ type: 'done' });
        }
      }, 1000);
      break;
    case 'pause':
      running = false;
      break;
    case 'resume':
      running = true;
      break;
    case 'stop':
      clearInterval(timerId);
      running = false;
      remaining = 0;
      break;
    case 'adjust':
      remaining = Math.max(0, remaining + seconds);
      self.postMessage({ type: 'tick', remaining });
      break;
  }
};
`;

class RestTimer {
  constructor() {
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    this.totalSeconds = 0;
    this.remaining = 0;
    this.running = false;
    this.onTick = null;
    this.onDone = null;
    this.audioCtx = null;

    this.worker.onmessage = (e) => {
      const { type, remaining } = e.data;
      if (type === 'tick') {
        this.remaining = remaining;
        if (this.onTick) this.onTick(remaining, this.totalSeconds);
        // Warning beep at 5 seconds
        if (remaining === 5) this._beep(440, 0.1);
        if (remaining === 3) this._beep(523, 0.1);
        if (remaining === 1) this._beep(659, 0.1);
      } else if (type === 'done') {
        this.running = false;
        this._completionAlert();
        if (this.onDone) this.onDone();
      }
    };
  }

  start(seconds) {
    this.totalSeconds = seconds;
    this.remaining = seconds;
    this.running = true;
    this.worker.postMessage({ cmd: 'start', seconds });
  }

  pause() {
    this.running = false;
    this.worker.postMessage({ cmd: 'pause' });
  }

  resume() {
    this.running = true;
    this.worker.postMessage({ cmd: 'resume' });
  }

  stop() {
    this.running = false;
    this.worker.postMessage({ cmd: 'stop' });
  }

  adjust(seconds) {
    this.totalSeconds = Math.max(0, this.totalSeconds + seconds);
    this.worker.postMessage({ cmd: 'adjust', seconds });
  }

  skip() {
    this.stop();
    if (this.onDone) this.onDone();
  }

  _getAudioCtx() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.audioCtx;
  }

  _beep(freq, duration) {
    try {
      const ctx = this._getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.value = 0.3;
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch (e) { /* audio not available */ }
  }

  async _completionAlert() {
    // Triple beep
    const ctx = this._getAudioCtx();
    for (let i = 0; i < 3; i++) {
      this._beep(880, 0.2);
      await new Promise(r => setTimeout(r, 250));
    }

    // Vibrate
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 400]);
    }
  }

  // Ensure audio context is resumed (must be called from user gesture)
  unlockAudio() {
    try {
      const ctx = this._getAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }
}

// Extended timer modes for section types
class WorkoutTimer extends RestTimer {
  constructor() {
    super();
    this.mode = 'rest'; // rest | emom | amrap | countdown | interval
    this.currentRound = 0;
    this.totalRounds = 0;
    this.onRoundComplete = null;
  }

  startEMOM(intervalSec, totalRounds) {
    this.mode = 'emom';
    this.currentRound = 1;
    this.totalRounds = totalRounds;
    this._emomInterval = intervalSec;

    const runRound = () => {
      if (this.currentRound > this.totalRounds) {
        this.mode = 'rest';
        this._completionAlert();
        if (this.onDone) this.onDone();
        return;
      }
      this.totalSeconds = intervalSec;
      this.remaining = intervalSec;
      this.running = true;

      const origOnDone = this.onDone;
      this.onDone = () => {
        if (this.onRoundComplete) this.onRoundComplete(this.currentRound, this.totalRounds);
        this.currentRound++;
        this._beep(660, 0.15);
        runRound();
      };
      this.worker.postMessage({ cmd: 'start', seconds: intervalSec });
    };

    runRound();
  }

  startCountdown(totalSec) {
    this.mode = 'amrap';
    this.start(totalSec);
  }

  startInterval(workSec, restSec, rounds) {
    this.mode = 'interval';
    this.currentRound = 1;
    this.totalRounds = rounds;

    const runWork = () => {
      if (this.currentRound > this.totalRounds) {
        this.mode = 'rest';
        this._completionAlert();
        if (this.onDone) this.onDone();
        return;
      }
      this.totalSeconds = workSec;
      this.start(workSec);
      this.onDone = () => {
        this._beep(440, 0.15);
        runRest();
      };
    };

    const runRest = () => {
      this.totalSeconds = restSec;
      this.start(restSec);
      this.onDone = () => {
        if (this.onRoundComplete) this.onRoundComplete(this.currentRound, this.totalRounds);
        this.currentRound++;
        this._beep(660, 0.15);
        runWork();
      };
    };

    runWork();
  }
}

// Smart rest time calculator
function calculateRestTime(exercise, setData, previousSetData) {
  let base = exercise.defaultRestSec || 180;

  // Compound vs isolation base
  if (exercise.category === 'barbell') {
    base = 180; // 3 min for compounds
  } else if (exercise.category === 'dumbbell' || exercise.category === 'machine') {
    base = 90;
  } else if (exercise.category === 'bodyweight') {
    base = 60;
  }

  // RPE adjustment
  if (setData.rpe) {
    if (setData.rpe <= 7) base *= 0.7;
    else if (setData.rpe === 8) { /* no change */ }
    else if (setData.rpe === 9) base *= 1.3;
    else if (setData.rpe >= 10) base *= 1.6;
  }

  // Missed reps
  if (setData.targetReps && setData.actualReps < setData.targetReps) {
    const missed = setData.targetReps - setData.actualReps;
    base += missed * 30;
  }

  // Later sets need more rest
  if (exercise.category === 'barbell' && setData.setNumber > 3) {
    base += (setData.setNumber - 3) * 15;
  }

  // Previous set also failed
  if (previousSetData && previousSetData.actualReps < previousSetData.targetReps) {
    base += 30;
  }

  // Clamp
  return Math.max(30, Math.min(600, Math.round(base)));
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

window.RestTimer = RestTimer;
window.WorkoutTimer = WorkoutTimer;
window.calculateRestTime = calculateRestTime;
window.formatTime = formatTime;
