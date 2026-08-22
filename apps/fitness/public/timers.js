const timerState = {
  sessionSeconds: 0,
  sessionRunning: false,
  restSeconds: 90,
  restRunning: false,
  sessionInterval: null,
  restInterval: null,
};

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = Math.max(0, seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function renderTimers() {
  document.querySelector("#sessionTimer").textContent = formatTimer(timerState.sessionSeconds);
  document.querySelector("#restTimer").textContent = formatTimer(timerState.restSeconds);
  document.querySelector("#startSessionTimer").textContent = timerState.sessionRunning
    ? "Running"
    : "Start";
  document.querySelector("#startRestTimer").textContent = timerState.restRunning
    ? "Resting"
    : "Start rest";
}

function startSessionTimer() {
  if (timerState.sessionRunning) return;
  timerState.sessionRunning = true;
  timerState.sessionInterval = setInterval(() => {
    timerState.sessionSeconds += 1;
    renderTimers();
  }, 1000);
  renderTimers();
}

function pauseSessionTimer() {
  timerState.sessionRunning = false;
  clearInterval(timerState.sessionInterval);
  renderTimers();
}

function resetSessionTimer() {
  pauseSessionTimer();
  timerState.sessionSeconds = 0;
  renderTimers();
}

function startRestTimer() {
  if (timerState.restRunning) return;
  timerState.restRunning = true;
  timerState.restInterval = setInterval(() => {
    timerState.restSeconds = Math.max(0, timerState.restSeconds - 1);
    renderTimers();
    if (timerState.restSeconds === 0) {
      clearInterval(timerState.restInterval);
      timerState.restRunning = false;
      showToast("Rest complete");
      renderTimers();
    }
  }, 1000);
  renderTimers();
}

function resetRestTimer() {
  timerState.restRunning = false;
  clearInterval(timerState.restInterval);
  timerState.restSeconds = 90;
  renderTimers();
}

function addRestTime(seconds) {
  timerState.restSeconds += seconds;
  renderTimers();
}
