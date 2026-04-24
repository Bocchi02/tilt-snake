const GRID_SIZE = 18;
const BASE_SPEED = 5.8;
const SPEED_GAIN = 0.1;
const SENSOR_TURN_THRESHOLD = 10;
const INPUT_COOLDOWN = 95;
const STORAGE_KEY = "tilt-snake-high-score";

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const highScoreElement = document.getElementById("high-score");
const sensorStatusElement = document.getElementById("sensor-status");
const sensorDotElement = document.getElementById("sensor-dot");
const finalScoreElement = document.getElementById("final-score");

const startScreen = document.getElementById("start-screen");
const gameOverScreen = document.getElementById("game-over-screen");
const startButton = document.getElementById("start-button");
const restartButton = document.getElementById("restart-button");
const calibrateButton = document.getElementById("calibrate-button");

const directionVectors = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const oppositeDirections = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

const leftTurnMap = {
  up: "left",
  left: "down",
  down: "right",
  right: "up",
};

const rightTurnMap = {
  up: "right",
  right: "down",
  down: "left",
  left: "up",
};

const state = {
  mode: "start",
  snake: [],
  direction: "right",
  pendingDirection: "right",
  food: { x: 0, y: 0 },
  score: 0,
  highScore: Number(localStorage.getItem(STORAGE_KEY)) || 0,
  lastTimestamp: 0,
  stepAccumulator: 0,
  cellSize: 0,
  effects: [],
};

highScoreElement.textContent = state.highScore;

// The sensor controller keeps device tilt code separate from game logic.
// It smooths noisy readings, remembers a neutral "resting" angle, and
// keeps turning while the phone stays leaned left or right past the threshold.
const sensorController = {
  active: false,
  permissionRequired: typeof DeviceOrientationEvent !== "undefined"
    && typeof DeviceOrientationEvent.requestPermission === "function",
  usingFallback: false,
  awaitingCalibration: false,
  hasReading: false,
  currentGamma: 0,
  smoothedGamma: 0,
  neutralGamma: 0,
  hasNeutral: false,
  lastDirectionTime: 0,

  async ensurePermission() {
    if (!this.permissionRequired) {
      return true;
    }

    try {
      const result = await DeviceOrientationEvent.requestPermission();
      return result === "granted";
    } catch (error) {
      console.error("Motion permission request failed:", error);
      return false;
    }
  },

  handleOrientation(event) {
    if (typeof event.gamma !== "number") {
      return;
    }

    this.active = true;
    this.usingFallback = false;
    this.awaitingCalibration = false;
    this.currentGamma = event.gamma;

    // A low-pass filter softens sudden spikes, which makes steering feel
    // more intentional and prevents tiny shakes from whipping the snake around.
    if (!this.hasReading) {
      this.smoothedGamma = this.currentGamma;
      this.hasReading = true;
    } else {
      this.smoothedGamma = this.smoothedGamma * 0.68 + this.currentGamma * 0.32;
    }

    if (!this.hasNeutral) {
      this.setNeutral();
    }

    updateSensorStatus("Steering active", "active");
  },

  setNeutral() {
    this.neutralGamma = this.smoothedGamma;
    this.hasNeutral = true;
  },

  maybeQueueDirection(now) {
    if (!this.active || !this.hasNeutral) {
      return;
    }

    const horizontalTilt = this.smoothedGamma - this.neutralGamma;
    const horizontalStrength = Math.abs(horizontalTilt);

    if (horizontalStrength < SENSOR_TURN_THRESHOLD) {
      return;
    }

    if (now - this.lastDirectionTime < INPUT_COOLDOWN) {
      return;
    }

    const turnSide = horizontalTilt < 0 ? "left" : "right";

    if (queueRelativeTurn(turnSide)) {
      this.lastDirectionTime = now;
    }
  },
};

function updateSensorStatus(message, tone = "warning") {
  sensorStatusElement.textContent = message;
  sensorDotElement.className = `sensor-dot ${tone}`;
}

function resizeCanvas() {
  const size = Math.min(canvas.clientWidth, canvas.clientHeight);
  const pixelRatio = window.devicePixelRatio || 1;

  canvas.width = Math.floor(size * pixelRatio);
  canvas.height = Math.floor(size * pixelRatio);

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  state.cellSize = size / GRID_SIZE;
}

function createInitialSnake() {
  return [
    { x: 4, y: 9 },
    { x: 3, y: 9 },
    { x: 2, y: 9 },
  ];
}

function randomGridPosition() {
  return {
    x: Math.floor(Math.random() * GRID_SIZE),
    y: Math.floor(Math.random() * GRID_SIZE),
  };
}

function spawnFood() {
  let position = randomGridPosition();

  while (state.snake.some((segment) => segment.x === position.x && segment.y === position.y)) {
    position = randomGridPosition();
  }

  state.food = position;
}

function resetGame() {
  state.snake = createInitialSnake();
  state.direction = "right";
  state.pendingDirection = "right";
  state.score = 0;
  state.stepAccumulator = 0;
  state.effects = [];
  scoreElement.textContent = "0";
  spawnFood();
}

function queueDirection(nextDirection) {
  const referenceDirection = state.pendingDirection || state.direction;

  if (nextDirection === referenceDirection) {
    return false;
  }

  // The snake cannot instantly reverse into itself.
  if (state.snake.length > 1 && oppositeDirections[referenceDirection] === nextDirection) {
    return false;
  }

  state.pendingDirection = nextDirection;
  return true;
}

function queueRelativeTurn(turnSide) {
  const referenceDirection = state.pendingDirection || state.direction;
  const nextDirection = turnSide === "left"
    ? leftTurnMap[referenceDirection]
    : rightTurnMap[referenceDirection];

  return queueDirection(nextDirection);
}

function startGame() {
  resetGame();
  state.mode = "running";
  state.lastTimestamp = 0;
  startScreen.classList.remove("overlay-visible");
  gameOverScreen.classList.remove("overlay-visible");
  if (sensorController.active) {
    sensorController.setNeutral();
    updateSensorStatus("Steering active", "active");
  } else if (sensorController.awaitingCalibration) {
    updateSensorStatus("Awaiting tilt data...", "warning");
  } else {
    updateSensorStatus("Keyboard steering ready", "warning");
  }
}

function endGame() {
  state.mode = "gameover";
  finalScoreElement.textContent = state.score;
  gameOverScreen.classList.add("overlay-visible");
  soundEngine.playGameOver();
  updateHighScore();
}

function updateHighScore() {
  if (state.score <= state.highScore) {
    return;
  }

  state.highScore = state.score;
  highScoreElement.textContent = state.highScore;
  localStorage.setItem(STORAGE_KEY, String(state.highScore));
}

function stepGame() {
  state.direction = state.pendingDirection;
  const velocity = directionVectors[state.direction];
  const head = state.snake[0];
  const nextHead = {
    x: head.x + velocity.x,
    y: head.y + velocity.y,
  };
  const isGrowing = nextHead.x === state.food.x && nextHead.y === state.food.y;
  const bodyToCheck = isGrowing ? state.snake : state.snake.slice(0, -1);

  if (
    nextHead.x < 0 ||
    nextHead.x >= GRID_SIZE ||
    nextHead.y < 0 ||
    nextHead.y >= GRID_SIZE ||
    bodyToCheck.some((segment) => segment.x === nextHead.x && segment.y === nextHead.y)
  ) {
    endGame();
    return;
  }

  state.snake.unshift(nextHead);

  if (isGrowing) {
    state.score += 1;
    scoreElement.textContent = state.score;
    spawnFood();
    createFoodEffect(nextHead);
    soundEngine.playEat();
    updateHighScore();
  } else {
    state.snake.pop();
  }
}

function createFoodEffect(position) {
  for (let index = 0; index < 12; index += 1) {
    const angle = (Math.PI * 2 * index) / 12;
    state.effects.push({
      x: (position.x + 0.5) * state.cellSize,
      y: (position.y + 0.5) * state.cellSize,
      vx: Math.cos(angle) * 1.6,
      vy: Math.sin(angle) * 1.6,
      radius: 2 + Math.random() * 2,
      life: 1,
    });
  }
}

function updateEffects() {
  state.effects = state.effects
    .map((effect) => ({
      ...effect,
      x: effect.x + effect.vx,
      y: effect.y + effect.vy,
      life: effect.life - 0.045,
    }))
    .filter((effect) => effect.life > 0);
}

function drawBackground() {
  const size = state.cellSize * GRID_SIZE;

  ctx.clearRect(0, 0, size, size);

  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#07111f");
  gradient.addColorStop(1, "#030812");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = getCssVariable("--grid");
  ctx.lineWidth = 1;

  for (let line = 0; line <= GRID_SIZE; line += 1) {
    const offset = line * state.cellSize;

    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, offset);
    ctx.lineTo(size, offset);
    ctx.stroke();
  }
}

function drawSnake() {
  state.snake.forEach((segment, index) => {
    const x = segment.x * state.cellSize;
    const y = segment.y * state.cellSize;
    const inset = index === 0 ? 2 : 3;
    const width = state.cellSize - inset * 2;
    const height = state.cellSize - inset * 2;

    ctx.save();
    ctx.shadowBlur = index === 0 ? 18 : 12;
    ctx.shadowColor = index === 0 ? "#4df7ff" : "#16c6ff";
    ctx.fillStyle = index === 0 ? "#8dfffb" : "#2fd9ff";
    roundRect(ctx, x + inset, y + inset, width, height, 8);
    ctx.fill();
    ctx.restore();
  });
}

function drawFood() {
  const x = state.food.x * state.cellSize + state.cellSize / 2;
  const y = state.food.y * state.cellSize + state.cellSize / 2;
  const radius = state.cellSize * 0.22;
  const pulse = 0.85 + Math.sin(performance.now() * 0.012) * 0.1;

  ctx.save();
  ctx.shadowBlur = 18;
  ctx.shadowColor = "#ffd34d";
  ctx.fillStyle = "#ffd34d";
  ctx.beginPath();
  ctx.arc(x, y, radius * pulse + 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fff6c9";
  ctx.beginPath();
  ctx.arc(x, y, radius * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEffects() {
  state.effects.forEach((effect) => {
    ctx.save();
    ctx.globalAlpha = effect.life;
    ctx.fillStyle = "#ff4dd8";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#ff4dd8";
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function render() {
  drawBackground();
  drawFood();
  drawSnake();
  drawEffects();
}

function getCurrentStepDuration() {
  const speed = BASE_SPEED + state.score * SPEED_GAIN;
  return 1000 / speed;
}

function gameLoop(timestamp) {
  if (!state.lastTimestamp) {
    state.lastTimestamp = timestamp;
  }

  const deltaTime = timestamp - state.lastTimestamp;
  state.lastTimestamp = timestamp;

  if (state.mode === "running") {
    sensorController.maybeQueueDirection(timestamp);
    state.stepAccumulator += deltaTime;

    const stepDuration = getCurrentStepDuration();
    while (state.stepAccumulator >= stepDuration && state.mode === "running") {
      stepGame();
      state.stepAccumulator -= stepDuration;
    }
  }

  updateEffects();
  render();
  requestAnimationFrame(gameLoop);
}

function handleKeyboard(event) {
  const turnKeyMap = {
    ArrowLeft: "left",
    a: "left",
    A: "left",
    ArrowRight: "right",
    d: "right",
    D: "right",
  };

  const turnSide = turnKeyMap[event.key];

  if (!turnSide) {
    return;
  }

  event.preventDefault();
  queueRelativeTurn(turnSide);

  if (!sensorController.active) {
    sensorController.usingFallback = true;
    updateSensorStatus("Keyboard steering active", "warning");
  }
}

function isMobileLandscape() {
  return window.matchMedia("(pointer: coarse)").matches
    && window.matchMedia("(orientation: landscape)").matches;
}

async function requestMobileFullscreen() {
  if (!isMobileLandscape() || document.fullscreenElement) {
    return;
  }

  const target = document.documentElement;

  if (!target.requestFullscreen) {
    return;
  }

  try {
    await target.requestFullscreen({ navigationUI: "hide" });
  } catch (error) {
    console.warn("Fullscreen request was not granted:", error);
  }

  if (screen.orientation?.lock) {
    try {
      await screen.orientation.lock("landscape");
    } catch (error) {
      console.warn("Orientation lock was not granted:", error);
    }
  }
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function getCssVariable(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Tiny synth-style sound effects generated with the Web Audio API.
// This avoids external audio files while still giving the game some feedback.
const soundEngine = {
  audioContext: null,

  ensureContext() {
    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return null;
      }

      this.audioContext = new AudioContextClass();
    }

    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }

    return this.audioContext;
  },

  playTone({ frequency, duration, type = "sine", gain = 0.04, slideTo = frequency }) {
    const audioContext = this.ensureContext();

    if (!audioContext) {
      return;
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.linearRampToValueAtTime(slideTo, now + duration);

    gainNode.gain.setValueAtTime(0.001, now);
    gainNode.gain.exponentialRampToValueAtTime(gain, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + duration);
  },

  playEat() {
    this.playTone({ frequency: 540, slideTo: 760, duration: 0.11, type: "triangle", gain: 0.06 });
  },

  playGameOver() {
    this.playTone({ frequency: 280, slideTo: 120, duration: 0.42, type: "sawtooth", gain: 0.05 });
  },
};

async function prepareAndStartGame() {
  requestMobileFullscreen();
  soundEngine.ensureContext();
  sensorController.usingFallback = false;

  if (sensorController.permissionRequired) {
    const granted = await sensorController.ensurePermission();

    if (!granted) {
      updateSensorStatus("Motion permission denied. Use keyboard steering.", "error");
      sensorController.active = false;
      startGame();
      return;
    }
  }

  if (!("DeviceOrientationEvent" in window)) {
    updateSensorStatus("Motion sensors unavailable. Use keyboard steering.", "error");
    sensorController.active = false;
    startGame();
    return;
  }

  updateSensorStatus("Hold still for calibration...", "warning");
  sensorController.hasNeutral = false;
  sensorController.awaitingCalibration = true;
  startGame();
}

window.addEventListener("deviceorientation", (event) => {
  sensorController.handleOrientation(event);
});

window.addEventListener("keydown", handleKeyboard, { passive: false });
window.addEventListener("resize", () => {
  resizeCanvas();
  if (sensorController.active) {
    sensorController.setNeutral();
  }
});

startButton.addEventListener("click", prepareAndStartGame);
restartButton.addEventListener("click", prepareAndStartGame);
calibrateButton.addEventListener("click", () => {
  sensorController.setNeutral();
  updateSensorStatus(sensorController.active ? "Steering recentered" : "No motion data yet", sensorController.active ? "active" : "warning");
});

resizeCanvas();
resetGame();
render();
updateSensorStatus("Tap Start to enable controls", "warning");
requestAnimationFrame(gameLoop);
