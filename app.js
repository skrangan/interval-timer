/* ── Constants ────────────────────────────────────────────────── */
const STORAGE_KEY = 'interval-timer-workouts';
const SETTINGS_KEY = 'interval-timer-settings';
const COUNTDOWN_SECONDS = 3;

/* ── State ────────────────────────────────────────────────────── */
let intervals = [];
let rounds = 8;
let soundEnabled = true;
let defaultWorkSeconds = 20;
let defaultRestSeconds = 10;

let timerState = {
  status: 'idle',
  round: 1,
  intervalIndex: 0,
  remaining: 0,
  tickId: null,
  lastTick: null,
  warnedSeconds: new Set(),
};

let currentWorkout = null;

/* ── DOM Refs ─────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);

const setupView = $('#setup-view');
const timerView = $('#timer-view');
const completeView = $('#complete-view');

/* ── Settings ─────────────────────────────────────────────────── */
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    defaultWorkSeconds = s.defaultWork ?? 20;
    defaultRestSeconds = s.defaultRest ?? 10;
  } catch {
    defaultWorkSeconds = 20;
    defaultRestSeconds = 10;
  }
  $('#default-work-seconds').value = defaultWorkSeconds;
  $('#default-rest-seconds').value = defaultRestSeconds;
}

function saveSettings() {
  defaultWorkSeconds = clampDuration(parseInt($('#default-work-seconds').value, 10) || 20);
  defaultRestSeconds = clampDuration(parseInt($('#default-rest-seconds').value, 10) || 10);
  $('#default-work-seconds').value = defaultWorkSeconds;
  $('#default-rest-seconds').value = defaultRestSeconds;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    defaultWork: defaultWorkSeconds,
    defaultRest: defaultRestSeconds,
  }));
}

function clampDuration(val) {
  return Math.max(1, Math.min(3600, val));
}

function getDefaultWork() {
  return clampDuration(parseInt($('#default-work-seconds').value, 10) || defaultWorkSeconds);
}

function getDefaultRest() {
  return clampDuration(parseInt($('#default-rest-seconds').value, 10) || defaultRestSeconds);
}

/* ── Audio ────────────────────────────────────────────────────── */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playBeep(frequency = 880, duration = 0.12, volume = 0.3) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type = 'sine';
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) { /* audio unavailable */ }
}

function playCountdownBeep(secondsLeft) {
  if (secondsLeft === 0) {
    playBeep(1100, 0.25, 0.4);
  } else {
    playBeep(660, 0.1, 0.25);
  }
}

function playTransitionBeep() {
  playBeep(880, 0.2, 0.35);
  setTimeout(() => playBeep(1100, 0.3, 0.4), 200);
}

/* ── Formatting ───────────────────────────────────────────────── */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDurationShort(seconds) {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${seconds}s`;
}

function totalWorkoutSeconds() {
  const cycle = intervals.reduce((sum, i) => sum + i.duration, 0);
  return cycle * rounds;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function createInterval(name, duration, type) {
  return { id: crypto.randomUUID(), name, duration, type };
}

/* ── Exercise Library ───────────────────────────────────────────── */
function collectExerciseLibrary() {
  const map = new Map();

  function addFromIntervals(list) {
    list.forEach(iv => {
      if (iv.type === 'work' && iv.name.trim()) {
        const key = iv.name.trim().toLowerCase();
        map.set(key, { name: iv.name.trim(), duration: iv.duration });
      }
    });
  }

  getSavedWorkouts().forEach(w => addFromIntervals(w.intervals));
  addFromIntervals(intervals);

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function renderExerciseLibrary() {
  const exercises = collectExerciseLibrary();
  const card = $('#exercise-library-card');
  const container = $('#exercise-library');

  if (exercises.length === 0) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  container.innerHTML = exercises.map(ex => `
    <button type="button" class="exercise-chip" data-exercise="${escapeHtml(ex.name)}" data-duration="${ex.duration}">
      ${escapeHtml(ex.name)}
      <span class="exercise-chip-duration">${ex.duration}s</span>
    </button>
  `).join('');
}

/* ── Setup View ───────────────────────────────────────────────── */
function renderIntervalsList() {
  const list = $('#intervals-list');
  list.innerHTML = intervals.map((interval, idx) => `
    <div class="interval-row ${interval.type}" data-id="${interval.id}">
      <div class="interval-reorder">
        <button type="button" class="btn-reorder" data-move="up" data-id="${interval.id}"
          aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="btn-reorder" data-move="down" data-id="${interval.id}"
          aria-label="Move down" ${idx === intervals.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <span class="interval-type-badge ${interval.type}">${interval.type}</span>
      <input type="text" class="interval-name-input" value="${escapeHtml(interval.name)}"
        data-field="name" data-id="${interval.id}" placeholder="Interval name"
        ${interval.type === 'rest' ? 'readonly' : ''}>
      <div class="interval-duration-group">
        <input type="number" class="interval-duration-input" value="${interval.duration}"
          min="1" max="3600" data-field="duration" data-id="${interval.id}">
        <span class="duration-unit">sec</span>
      </div>
      <button type="button" class="btn-remove-interval" data-remove="${interval.id}"
        aria-label="Remove interval" ${intervals.length <= 1 ? 'disabled' : ''}>×</button>
    </div>
  `).join('');

  $('#total-duration').textContent =
    `Total: ${formatDurationShort(totalWorkoutSeconds())} · ${rounds} round${rounds !== 1 ? 's' : ''} · ${intervals.length} interval${intervals.length !== 1 ? 's' : ''}`;

  renderExerciseLibrary();
}

function moveInterval(id, direction) {
  const idx = intervals.findIndex(i => i.id === id);
  if (idx < 0) return;
  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= intervals.length) return;
  [intervals[idx], intervals[newIdx]] = [intervals[newIdx], intervals[idx]];
  renderIntervalsList();
}

function addExercisePair(name, workDuration, restDuration) {
  const workDur = workDuration ?? getDefaultWork();
  const restDur = restDuration ?? getDefaultRest();
  intervals.push(createInterval(name, workDur, 'work'));
  intervals.push(createInterval('Rest', restDur, 'rest'));
  renderIntervalsList();
}

function promptAddExercise() {
  $('#new-exercise-name').value = '';
  $('#exercise-modal').showModal();
  setTimeout(() => $('#new-exercise-name').focus(), 100);
}

function confirmAddExercise() {
  const name = $('#new-exercise-name').value.trim() || 'Work';
  $('#exercise-modal').close();
  addExercisePair(name);
  saveSettings();
}

function addExerciseFromLibrary(name, duration) {
  addExercisePair(name, duration, getDefaultRest());
  saveSettings();
  showToast(`Added ${name}`);
}

function removeInterval(id) {
  if (intervals.length <= 1) return;
  intervals = intervals.filter(i => i.id !== id);
  renderIntervalsList();
}

function buildWorkoutFromSetup() {
  saveSettings();
  return {
    id: crypto.randomUUID(),
    name: $('#workout-name').value.trim() || 'My Workout',
    rounds: parseInt($('#rounds-count').value, 10) || 8,
    soundEnabled: $('#sound-enabled').checked,
    intervals: intervals.map(i => ({ ...i })),
    createdAt: Date.now(),
  };
}

function loadWorkoutToSetup(workout) {
  $('#workout-name').value = workout.name;
  $('#rounds-count').value = workout.rounds;
  $('#sound-enabled').checked = workout.soundEnabled;
  rounds = workout.rounds;
  soundEnabled = workout.soundEnabled;
  intervals = workout.intervals.map(i => ({ ...i, id: crypto.randomUUID() }));
  renderIntervalsList();
  showToast('Workout loaded');
}

function initEmptyWorkout() {
  intervals = [
    createInterval('Work', getDefaultWork(), 'work'),
    createInterval('Rest', getDefaultRest(), 'rest'),
  ];
}

/* ── Saved Workouts ───────────────────────────────────────────── */
function getSavedWorkouts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveWorkoutToStorage(workout) {
  const saved = getSavedWorkouts();
  const existing = saved.findIndex(w => w.name === workout.name);
  const entry = {
    ...workout,
    id: existing >= 0 ? saved[existing].id : workout.id,
    savedAt: Date.now(),
  };
  if (existing >= 0) {
    saved[existing] = entry;
  } else {
    saved.unshift(entry);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  renderSavedList();
  renderExerciseLibrary();
  showToast('Workout saved!');
}

function deleteSavedWorkout(id) {
  const saved = getSavedWorkouts().filter(w => w.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  renderSavedList();
  renderExerciseLibrary();
}

function moveSavedWorkout(id, direction) {
  const saved = getSavedWorkouts();
  const idx = saved.findIndex(w => w.id === id);
  if (idx < 0) return;
  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= saved.length) return;
  [saved[idx], saved[newIdx]] = [saved[newIdx], saved[idx]];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  renderSavedList();
}

function renderSavedList() {
  const saved = getSavedWorkouts();
  const list = $('#saved-list');
  if (saved.length === 0) {
    list.innerHTML = '<p class="empty-state">No saved workouts yet.</p>';
    return;
  }
  list.innerHTML = saved.map((w, idx) => {
    const cycle = w.intervals.reduce((s, i) => s + i.duration, 0);
    const total = cycle * w.rounds;
    return `
      <div class="saved-item" data-id="${w.id}">
        <div class="saved-item-reorder">
          <button type="button" class="btn-reorder" data-saved-move="up" data-id="${w.id}"
            aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="btn-reorder" data-saved-move="down" data-id="${w.id}"
            aria-label="Move down" ${idx === saved.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <div class="saved-item-info">
          <div class="saved-item-name">${escapeHtml(w.name)}</div>
          <div class="saved-item-meta">${w.rounds} rounds · ${formatDurationShort(total)} · ${w.intervals.length} intervals</div>
        </div>
        <div class="saved-item-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-load="${w.id}">Load</button>
          <button type="button" class="btn btn-ghost btn-sm" data-share="${w.id}">Share</button>
          <button type="button" class="btn btn-ghost btn-sm" data-delete="${w.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

/* ── Sharing ──────────────────────────────────────────────────── */
function encodeWorkoutForUrl(workout) {
  const payload = {
    n: workout.name,
    r: workout.rounds,
    s: workout.soundEnabled ? 1 : 0,
    i: workout.intervals.map(iv => [iv.name, iv.duration, iv.type === 'rest' ? 0 : 1]),
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeWorkoutFromUrl(encoded) {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(padded)));
    const p = JSON.parse(json);
    return {
      id: crypto.randomUUID(),
      name: p.n || 'Shared Workout',
      rounds: p.r || 8,
      soundEnabled: p.s !== 0,
      intervals: (p.i || []).map(([name, duration, typeFlag]) => ({
        id: crypto.randomUUID(),
        name,
        duration,
        type: typeFlag === 0 ? 'rest' : 'work',
      })),
      createdAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function getShareUrl(workout) {
  const encoded = encodeWorkoutForUrl(workout);
  const base = window.location.origin + window.location.pathname;
  return `${base}?w=${encoded}`;
}

function openShareModal(workout) {
  $('#share-url').value = getShareUrl(workout);
  $('#share-modal').showModal();
}

function checkUrlForSharedWorkout() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('w');
  if (!encoded) return;
  const workout = decodeWorkoutFromUrl(encoded);
  if (workout) {
    loadWorkoutToSetup(workout);
    showToast('Shared workout loaded!');
    window.history.replaceState({}, '', window.location.pathname);
  }
}

/* ── Timer Engine ─────────────────────────────────────────────── */
function getCurrentInterval() {
  return currentWorkout.intervals[timerState.intervalIndex];
}

function getNextIntervalInfo() {
  const { round, intervalIndex } = timerState;
  const totalIntervals = currentWorkout.intervals.length;
  const totalRounds = currentWorkout.rounds;

  if (intervalIndex + 1 < totalIntervals) {
    return { interval: currentWorkout.intervals[intervalIndex + 1], round };
  }
  if (round < totalRounds) {
    return { interval: currentWorkout.intervals[0], round: round + 1 };
  }
  return null;
}

function showView(view) {
  [setupView, timerView, completeView].forEach(v => v.classList.remove('active'));
  view.classList.add('active');
}

function initTimer(workout) {
  currentWorkout = workout;
  soundEnabled = workout.soundEnabled;
  timerState = {
    status: 'idle',
    round: 1,
    intervalIndex: 0,
    remaining: workout.intervals[0].duration,
    tickId: null,
    lastTick: null,
    warnedSeconds: new Set(),
  };
  showView(timerView);
  updateTimerUI();
}

function startTimer() {
  if (timerState.status === 'complete') return;
  timerState.status = 'running';
  timerState.lastTick = performance.now();
  timerState.warnedSeconds = new Set();
  timerState.tickId = requestAnimationFrame(tick);
  updatePlayPauseButton();
}

function pauseTimer() {
  timerState.status = 'paused';
  if (timerState.tickId) {
    cancelAnimationFrame(timerState.tickId);
    timerState.tickId = null;
  }
  updatePlayPauseButton();
}

function restartTimer() {
  pauseTimer();
  timerState = {
    status: 'idle',
    round: 1,
    intervalIndex: 0,
    remaining: currentWorkout.intervals[0].duration,
    tickId: null,
    lastTick: null,
    warnedSeconds: new Set(),
  };
  updateTimerUI();
  updatePlayPauseButton();
}

function exitTimer() {
  pauseTimer();
  showView(setupView);
}

function tick(now) {
  if (timerState.status !== 'running') return;

  const elapsed = (now - timerState.lastTick) / 1000;
  if (elapsed >= 1) {
    const steps = Math.floor(elapsed);
    timerState.lastTick = now - ((elapsed - steps) * 1000);

    for (let s = 0; s < steps; s++) {
      if (timerState.remaining > 0) {
        timerState.remaining--;

        if (timerState.remaining <= COUNTDOWN_SECONDS && timerState.remaining >= 0) {
          if (!timerState.warnedSeconds.has(timerState.remaining)) {
            timerState.warnedSeconds.add(timerState.remaining);
            playCountdownBeep(timerState.remaining);
          }
        }
      }

      if (timerState.remaining <= 0) {
        advanceInterval();
        if (timerState.status === 'complete') {
          updateTimerUI();
          return;
        }
        timerState.warnedSeconds = new Set();
      }
    }
    updateTimerUI();
  }

  timerState.tickId = requestAnimationFrame(tick);
}

function advanceInterval() {
  playTransitionBeep();

  if (timerState.intervalIndex + 1 < currentWorkout.intervals.length) {
    timerState.intervalIndex++;
  } else if (timerState.round < currentWorkout.rounds) {
    timerState.round++;
    timerState.intervalIndex = 0;
  } else {
    timerState.status = 'complete';
    pauseTimer();
    showCompleteView();
    return;
  }

  timerState.remaining = getCurrentInterval().duration;
}

function showCompleteView() {
  const cycle = currentWorkout.intervals.reduce((s, i) => s + i.duration, 0);
  const total = cycle * currentWorkout.rounds;
  $('#complete-summary').textContent =
    `You completed ${currentWorkout.name} — ${currentWorkout.rounds} rounds, ${formatDurationShort(total)} total.`;
  showView(completeView);
}

function updatePlayPauseButton() {
  const isRunning = timerState.status === 'running';
  $('#play-pause-icon').textContent = isRunning ? '⏸' : '▶';
  $('#play-pause-label').textContent = isRunning ? 'Pause' : (timerState.status === 'idle' ? 'Start' : 'Resume');
}

function updateTimerUI() {
  const interval = getCurrentInterval();
  const display = $('#timer-display');

  display.className = `timer-display phase-${interval.type}`;

  $('#timer-phase').textContent = interval.type.toUpperCase();
  $('#timer-clock').textContent = formatTime(timerState.remaining);
  $('#timer-interval-name').textContent = interval.name;
  $('#timer-round').textContent = `Round ${timerState.round}/${currentWorkout.rounds}`;
  $('#timer-interval-index').textContent =
    `Interval ${timerState.intervalIndex + 1}/${currentWorkout.intervals.length}`;

  const clock = $('#timer-clock');
  if (timerState.remaining <= COUNTDOWN_SECONDS && timerState.remaining > 0 && timerState.status === 'running') {
    clock.classList.add('countdown-warning');
  } else {
    clock.classList.remove('countdown-warning');
  }

  const nextUpCard = $('#next-up-card');
  const next = getNextIntervalInfo();
  if (interval.type === 'rest' && next && timerState.status !== 'complete') {
    nextUpCard.hidden = false;
    $('#next-up-name').textContent = next.interval.name;
    $('#next-up-duration').textContent = formatDurationShort(next.interval.duration);
  } else {
    nextUpCard.hidden = true;
  }

  renderTimeline();
  updatePlayPauseButton();
}

function renderTimeline() {
  const timeline = $('#interval-timeline');
  const segments = [];

  for (let r = 1; r <= currentWorkout.rounds; r++) {
    currentWorkout.intervals.forEach((iv, idx) => {
      const globalIdx = (r - 1) * currentWorkout.intervals.length + idx;
      const currentGlobal = (timerState.round - 1) * currentWorkout.intervals.length + timerState.intervalIndex;
      let state = 'upcoming';
      if (globalIdx < currentGlobal) state = 'done';
      else if (globalIdx === currentGlobal) state = 'active';
      segments.push({ type: iv.type, state });
    });
  }

  const maxSegments = 40;
  let visible = segments;
  if (segments.length > maxSegments) {
    const currentGlobal = (timerState.round - 1) * currentWorkout.intervals.length + timerState.intervalIndex;
    const start = Math.max(0, currentGlobal - 10);
    visible = segments.slice(start, start + maxSegments);
  }

  timeline.innerHTML = visible.map(s =>
    `<div class="timeline-segment ${s.state} ${s.type}"></div>`
  ).join('');
}

/* ── Toast ────────────────────────────────────────────────────── */
let toastTimeout = null;

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 2500);
}

/* ── Event Listeners ──────────────────────────────────────────── */
function bindEvents() {
  $('#rounds-decrease').addEventListener('click', () => {
    const input = $('#rounds-count');
    const val = Math.max(1, parseInt(input.value, 10) - 1);
    input.value = val;
    rounds = val;
    renderIntervalsList();
  });

  $('#rounds-increase').addEventListener('click', () => {
    const input = $('#rounds-count');
    const val = Math.min(99, parseInt(input.value, 10) + 1);
    input.value = val;
    rounds = val;
    renderIntervalsList();
  });

  $('#rounds-count').addEventListener('change', (e) => {
    rounds = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1));
    e.target.value = rounds;
    renderIntervalsList();
  });

  $('#sound-enabled').addEventListener('change', (e) => {
    soundEnabled = e.target.checked;
  });

  $('#default-work-seconds').addEventListener('change', saveSettings);
  $('#default-rest-seconds').addEventListener('change', saveSettings);

  $('#add-interval').addEventListener('click', promptAddExercise);

  $('#confirm-exercise-modal').addEventListener('click', confirmAddExercise);
  $('#cancel-exercise-modal').addEventListener('click', () => $('#exercise-modal').close());
  $('#new-exercise-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmAddExercise();
  });

  $('#exercise-library').addEventListener('click', (e) => {
    const chip = e.target.closest('.exercise-chip');
    if (!chip) return;
    addExerciseFromLibrary(chip.dataset.exercise, parseInt(chip.dataset.duration, 10));
  });

  $('#intervals-list').addEventListener('input', (e) => {
    const id = e.target.dataset.id;
    const field = e.target.dataset.field;
    if (!id || !field) return;
    const interval = intervals.find(i => i.id === id);
    if (!interval) return;
    if (field === 'name') interval.name = e.target.value;
    if (field === 'duration') {
      interval.duration = clampDuration(parseInt(e.target.value, 10) || 1);
      e.target.value = interval.duration;
      $('#total-duration').textContent =
        `Total: ${formatDurationShort(totalWorkoutSeconds())} · ${rounds} round${rounds !== 1 ? 's' : ''} · ${intervals.length} interval${intervals.length !== 1 ? 's' : ''}`;
      renderExerciseLibrary();
    }
  });

  $('#intervals-list').addEventListener('click', (e) => {
    const removeId = e.target.dataset.remove;
    const moveDir = e.target.dataset.move;
    const moveId = e.target.dataset.id;

    if (removeId) removeInterval(removeId);
    if (moveDir && moveId) moveInterval(moveId, moveDir);
  });

  $('#start-workout').addEventListener('click', () => {
    initTimer(buildWorkoutFromSetup());
  });

  $('#save-workout').addEventListener('click', () => {
    saveWorkoutToStorage(buildWorkoutFromSetup());
  });

  $('#share-workout').addEventListener('click', () => {
    openShareModal(buildWorkoutFromSetup());
  });

  $('#saved-list').addEventListener('click', (e) => {
    const loadId = e.target.dataset.load;
    const shareId = e.target.dataset.share;
    const deleteId = e.target.dataset.delete;
    const savedMove = e.target.dataset.savedMove;
    const savedId = e.target.dataset.id;

    if (loadId) {
      const workout = getSavedWorkouts().find(w => w.id === loadId);
      if (workout) loadWorkoutToSetup(workout);
    }
    if (shareId) {
      const workout = getSavedWorkouts().find(w => w.id === shareId);
      if (workout) openShareModal(workout);
    }
    if (deleteId) {
      deleteSavedWorkout(deleteId);
      showToast('Workout deleted');
    }
    if (savedMove && savedId) moveSavedWorkout(savedId, savedMove);
  });

  $('#timer-play-pause').addEventListener('click', () => {
    if (timerState.status === 'running') pauseTimer();
    else startTimer();
  });

  $('#timer-restart').addEventListener('click', restartTimer);
  $('#timer-stop').addEventListener('click', exitTimer);

  $('#complete-restart').addEventListener('click', () => {
    initTimer(currentWorkout);
    startTimer();
  });

  $('#complete-exit').addEventListener('click', () => showView(setupView));

  $('#copy-share-url').addEventListener('click', async () => {
    const url = $('#share-url').value;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied!');
    } catch {
      $('#share-url').select();
      document.execCommand('copy');
      showToast('Link copied!');
    }
  });

  $('#close-share-modal').addEventListener('click', () => $('#share-modal').close());

  document.addEventListener('click', () => {
    if (audioCtx?.state === 'suspended') audioCtx.resume();
  }, { once: true });

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
    } catch (_) { /* not supported */ }
  }

  $('#start-workout').addEventListener('click', requestWakeLock);
  $('#timer-play-pause').addEventListener('click', () => {
    if (timerState.status === 'running') requestWakeLock();
  });
}

/* ── Init ─────────────────────────────────────────────────────── */
function init() {
  loadSettings();
  initEmptyWorkout();
  renderIntervalsList();
  renderSavedList();
  bindEvents();
  checkUrlForSharedWorkout();
}

init();
