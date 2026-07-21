import { HandLandmarker, FilesetResolver } from "../vendor/mediapipe/vision_bundle.mjs";

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const fpsEl = document.getElementById("fps");
const pinchDebugEl = document.getElementById("pinchDebug");
const statusEl = document.getElementById("status");
const instructionHint = document.getElementById("instructionHint");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const promptDisplay = document.getElementById("promptDisplay");
const promptThumb = document.getElementById("promptThumb");
const cameraSwitchBtn = document.getElementById("cameraSwitchBtn");
const exitBtn = document.getElementById("exitBtn");
const stage = document.getElementById("stage");
const submitBtn = document.getElementById("submitBtn");
const resultOverlay = document.getElementById("resultOverlay");
const resultText = document.getElementById("resultText");
const resultWord = document.getElementById("resultWord");
const nextBtn = document.getElementById("nextBtn");

// Hysteresis: grabbing needs a tighter pinch than releasing needs, so a
// finger held near the threshold doesn't flicker grab/release every frame.
const PINCH_ENTER_RATIO = 0.42;
const PINCH_EXIT_RATIO = 0.58;
let isPinchingState = false;

// Word themes rendered directly in code — no image assets needed.
const SHAPE_PATHS = {
  circle: '<circle cx="50" cy="50" r="45"/>',
  square: '<rect x="8" y="8" width="84" height="84" rx="8"/>',
  triangle: '<polygon points="50,8 94,90 6,90"/>',
  star: '<polygon points="50,4 61,37 96,37 68,58 79,92 50,71 21,92 32,58 4,37 39,37"/>',
  heart:
    '<path d="M50,88 12,52 A20,20 0 0 1 50,28 A20,20 0 0 1 88,52 Z"/>',
  diamond: '<polygon points="50,4 92,50 50,96 8,50"/>',
};

const THEMES = {
  colors: [
    "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown", "black", "white",
  ].map((word) => ({ word, type: "color", value: COLOR_HEX(word) })),
  shapes: Object.keys(SHAPE_PATHS).map((word) => ({ word, type: "shape", value: word })),
};

function COLOR_HEX(name) {
  const map = {
    red: "#e53935",
    blue: "#1e88e5",
    green: "#43a047",
    yellow: "#fdd835",
    orange: "#fb8c00",
    purple: "#8e24aa",
    pink: "#ec407a",
    brown: "#6d4c41",
    black: "#212121",
    white: "#f5f5f5",
  };
  return map[name];
}

// Colors only for now — shapes theme re-enables once its own visual prompts are ready.
const ALL_ROUNDS = [...THEMES.colors];

function renderVisual(container, round) {
  container.innerHTML = "";
  if (round.type === "color") {
    const block = document.createElement("div");
    block.className = "visual-color";
    block.style.background = round.value;
    container.appendChild(block);
  } else {
    container.innerHTML = `<svg viewBox="0 0 100 100" fill="#29b6f6">${SHAPE_PATHS[round.value]}</svg>`;
  }
}

let handLandmarker = null;
let currentStream = null;
let facingMode = "user";
let running = false;

let lastFrameTime = performance.now();
let fpsSmoothed = 0;

// --- Board state ---------------------------------------------------------
let currentRound = null; // { word, type, value }
let slots = []; // { index, el, cardId }
let cards = []; // { id, letter, el, currentSlot, homeX, homeY, x, y }
let grabbedCardId = null;
let grabOffset = { x: 0, y: 0 };
let grabOriginSlot = null; // slot index the grabbed card came from, or null (tray)
let lastRoundWord = "";
let cameraStarted = false;
let grabRadiusPx = 55;
let prevIsPinching = false;

function resizeCanvasToVideo() {
  overlay.width = overlay.clientWidth;
  overlay.height = overlay.clientHeight;
}
window.addEventListener("resize", () => {
  resizeCanvasToVideo();
  layoutBoard();
});
document.addEventListener("fullscreenchange", () => {
  resizeCanvasToVideo();
  layoutBoard();
});

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRound() {
  let round;
  do {
    round = ALL_ROUNDS[Math.floor(Math.random() * ALL_ROUNDS.length)];
  } while (round.word === lastRoundWord && ALL_ROUNDS.length > 1);
  lastRoundWord = round.word;
  return round;
}

function clearBoard() {
  for (const s of slots) s.el.remove();
  for (const c of cards) c.el.remove();
  slots = [];
  cards = [];
  grabbedCardId = null;
  grabOriginSlot = null;
}

function setupRound(round) {
  clearBoard();
  currentRound = round;

  const word = round.word;
  const letters = shuffle(word.split(""));

  slots = word.split("").map((_, index) => {
    const el = document.createElement("div");
    el.className = "slot";
    el.dataset.filled = "false";
    stage.appendChild(el);
    return { index, el, cardId: null };
  });

  cards = letters.map((letter, i) => {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.grabbed = "false";
    el.textContent = letter.toUpperCase();
    el.style.setProperty("--tilt", `${(Math.random() * 10 - 5).toFixed(1)}deg`);
    stage.appendChild(el);
    return {
      id: `card-${i}`,
      letter,
      el,
      currentSlot: null,
      homeX: 0,
      homeY: 0,
      x: 0,
      y: 0,
    };
  });

  layoutBoard();
  resultOverlay.classList.add("hidden");
}

// Spacing grows with available width and shrinks the card/slot size (never
// the gap between them) so items stay clearly separated even for long words
// on narrow screens.
function computeMetrics() {
  const rect = stage.getBoundingClientRect();
  const count = Math.max(slots.length, 1);
  const spacing = (rect.width * 0.94) / count;
  // Cap relative to screen height, not a fixed pixel value, so cards scale
  // up on a big desktop monitor instead of staying phone-sized.
  const maxSize = rect.height * 0.16;
  const size = Math.max(32, Math.min(maxSize, spacing * 0.62));
  return { rect, spacing, size };
}

function slotPosition(index, metrics) {
  const m = metrics || computeMetrics();
  return {
    x: m.rect.width / 2 + (index - (slots.length - 1) / 2) * m.spacing,
    y: m.rect.height * 0.3,
  };
}

function layoutBoard() {
  const m = computeMetrics();
  const trayY = m.rect.height * 0.75;
  const grabRadius = m.size * 0.85;

  slots.forEach((s, i) => {
    const pos = slotPosition(i, m);
    s.el.style.left = `${pos.x}px`;
    s.el.style.top = `${pos.y}px`;
    s.el.style.width = `${m.size + 6}px`;
    s.el.style.height = `${m.size + 6}px`;
  });

  cards.forEach((c, i) => {
    c.homeX = m.rect.width / 2 + (i - (cards.length - 1) / 2) * m.spacing;
    c.homeY = trayY;
    c.el.style.width = `${m.size}px`;
    c.el.style.height = `${m.size}px`;
    c.el.style.fontSize = `${Math.max(16, m.size * 0.45)}px`;
    if (c.currentSlot === null) {
      c.x = c.homeX;
      c.y = c.homeY;
    } else {
      const pos = slotPosition(c.currentSlot, m);
      c.x = pos.x;
      c.y = pos.y;
    }
    renderCard(c);
  });

  grabRadiusPx = grabRadius;
  updateSubmitButton();
}

function renderCard(card) {
  card.el.style.left = `${card.x}px`;
  card.el.style.top = `${card.y}px`;
}

// Submit sits out of the way in a corner normally, then pops front-and-
// center once every slot is filled so it's easy to find/reach on a big
// desktop screen without hunting for a corner button.
function updateSubmitButton() {
  const rect = stage.getBoundingClientRect();
  const allFilled = slots.length > 0 && slots.every((s) => s.cardId !== null);
  submitBtn.classList.toggle("ready", allFilled);
  if (allFilled) {
    submitBtn.style.left = `${rect.width / 2}px`;
    submitBtn.style.top = `${rect.height * 0.62}px`;
  } else {
    submitBtn.style.left = `${rect.width - 70}px`;
    submitBtn.style.top = `${rect.height - 50}px`;
  }
}

function placeCardInSlot(card, slotIndex) {
  const s = slots[slotIndex];
  const pos = slotPosition(slotIndex);
  card.currentSlot = slotIndex;
  card.x = pos.x;
  card.y = pos.y;
  s.cardId = card.id;
  s.el.dataset.filled = "true";
  renderCard(card);
  updateSubmitButton();
}

function sendCardHome(card) {
  card.currentSlot = null;
  card.x = card.homeX;
  card.y = card.homeY;
  renderCard(card);
  updateSubmitButton();
}

async function createHandLandmarker() {
  statusEl.textContent = "Loading model…";
  const vision = await FilesetResolver.forVisionTasks("vendor/mediapipe/wasm");
  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "models/hand_landmarker.task", delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
    });
    statusEl.textContent = "Model ready (GPU)";
  } catch (err) {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "models/hand_landmarker.task", delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 1,
    });
    statusEl.textContent = "Model ready (CPU fallback)";
  }
}

async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
  }
  const constraints = {
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  };
  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = currentStream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });
  video.play();
  resizeCanvasToVideo();
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Map an x coordinate from the (unmirrored) source video to match the
// on-screen video element, which is CSS-mirrored (scaleX(-1)) only in
// front-camera ("user") mode.
function mapX(xNorm, width) {
  return facingMode === "user" ? (1 - xNorm) * width : xNorm * width;
}

function processResult(result) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (!result.landmarks || result.landmarks.length === 0) {
    pinchDebugEl.textContent = "pinch: no hand";
    isPinchingState = false;
    if (grabbedCardId !== null) {
      const card = cards.find((c) => c.id === grabbedCardId);
      card.el.dataset.grabbed = "false";
      dropCard(card);
      grabbedCardId = null;
      grabOriginSlot = null;
    }
    return;
  }

  const landmarks = result.landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];

  const palmScale = distance(wrist, middleMcp) || 0.0001;
  const pinchDist = distance(thumbTip, indexTip);
  const pinchRatio = pinchDist / palmScale;

  if (!isPinchingState && pinchRatio < PINCH_ENTER_RATIO) {
    isPinchingState = true;
  } else if (isPinchingState && pinchRatio > PINCH_EXIT_RATIO) {
    isPinchingState = false;
  }
  const isPinching = isPinchingState;
  pinchDebugEl.textContent = `pinch: ${pinchRatio.toFixed(2)} ${isPinching ? "🤏" : ""}`;

  const pinchPoint = {
    x: mapX((thumbTip.x + indexTip.x) / 2, overlay.width),
    y: ((thumbTip.y + indexTip.y) / 2) * overlay.height,
  };

  ctx.fillStyle = "#00e5ff";
  for (const lm of landmarks) {
    const x = mapX(lm.x, overlay.width);
    const y = lm.y * overlay.height;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = isPinching ? "#4caf50" : "#ff5252";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(pinchPoint.x, pinchPoint.y, 14, 0, Math.PI * 2);
  ctx.stroke();

  handleGesture(isPinching, pinchPoint);
}

// Stage-relative hit test: pinchPoint is in the same pixel space as card
// positions (both anchored to #stage's top-left), so button rects need the
// same conversion from viewport coordinates before comparing. A tolerance
// pad is added because hand-tracked pointing is far less precise than a
// mouse/finger tap, especially on a large, high-resolution monitor where
// the same landmark jitter covers more screen pixels.
const PINCH_HIT_PAD = 28;

function pinchOverElement(pinchPoint, el, pad = PINCH_HIT_PAD) {
  const stageRect = stage.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const left = elRect.left - stageRect.left - pad;
  const top = elRect.top - stageRect.top - pad;
  return (
    pinchPoint.x >= left &&
    pinchPoint.x <= left + elRect.width + pad * 2 &&
    pinchPoint.y >= top &&
    pinchPoint.y <= top + elRect.height + pad * 2
  );
}

// The round-intro screen (startBtn, relabeled "Next Round" after the first
// round) only responds to pinch once the camera is already running — before
// that there's no hand tracking yet, so it still needs a real tap.
function roundIntroPinchable() {
  return cameraStarted && !startOverlay.classList.contains("hidden");
}

function updateButtonAffordance(pinchPoint) {
  submitBtn.classList.toggle("hover", pinchOverElement(pinchPoint, submitBtn));
  if (!resultOverlay.classList.contains("hidden")) {
    nextBtn.classList.toggle("hover", pinchOverElement(pinchPoint, nextBtn));
  }
  if (roundIntroPinchable()) {
    startBtn.classList.toggle("hover", pinchOverElement(pinchPoint, startBtn));
  }
}

function handleGesture(isPinching, pinchPoint) {
  updateButtonAffordance(pinchPoint);

  const pinchRisingEdge = isPinching && !prevIsPinching;
  prevIsPinching = isPinching;

  if (pinchRisingEdge && grabbedCardId === null) {
    if (roundIntroPinchable() && pinchOverElement(pinchPoint, startBtn)) {
      startBtn.click();
      return;
    }
    if (pinchOverElement(pinchPoint, submitBtn)) {
      submitBtn.click();
      return;
    }
    if (!resultOverlay.classList.contains("hidden") && pinchOverElement(pinchPoint, nextBtn)) {
      nextBtn.click();
      return;
    }
  }

  if (isPinching && grabbedCardId === null) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const card of cards) {
      const d = Math.hypot(pinchPoint.x - card.x, pinchPoint.y - card.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = card;
      }
    }
    if (nearest && nearestDist < grabRadiusPx) {
      grabbedCardId = nearest.id;
      grabOriginSlot = nearest.currentSlot;
      nearest.el.dataset.grabbed = "true";
      grabOffset = { x: nearest.x - pinchPoint.x, y: nearest.y - pinchPoint.y };
      if (nearest.currentSlot !== null) {
        slots[nearest.currentSlot].cardId = null;
        slots[nearest.currentSlot].el.dataset.filled = "false";
        updateSubmitButton();
      }
    }
  }

  if (grabbedCardId !== null) {
    const card = cards.find((c) => c.id === grabbedCardId);
    if (isPinching) {
      card.x = pinchPoint.x + grabOffset.x;
      card.y = pinchPoint.y + grabOffset.y;
      renderCard(card);
    } else {
      card.el.dataset.grabbed = "false";
      dropCard(card);
      grabbedCardId = null;
      grabOriginSlot = null;
    }
  }
}

function dropCard(card) {
  const cardRect = card.el.getBoundingClientRect();
  let targetSlot = null;
  for (const s of slots) {
    const slotRect = s.el.getBoundingClientRect();
    const overlaps =
      cardRect.left < slotRect.right &&
      cardRect.right > slotRect.left &&
      cardRect.top < slotRect.bottom &&
      cardRect.bottom > slotRect.top;
    if (overlaps) {
      targetSlot = s;
      break;
    }
  }

  if (!targetSlot) {
    if (grabOriginSlot !== null) {
      placeCardInSlot(card, grabOriginSlot);
    } else {
      sendCardHome(card);
    }
    return;
  }

  const occupantId = targetSlot.cardId;
  if (occupantId && occupantId !== card.id) {
    const occupant = cards.find((c) => c.id === occupantId);
    if (grabOriginSlot !== null) {
      placeCardInSlot(occupant, grabOriginSlot);
    } else {
      sendCardHome(occupant);
    }
  }
  placeCardInSlot(card, targetSlot.index);
}

function checkSubmit() {
  const allFilled = slots.every((s) => s.cardId !== null);
  if (!allFilled) {
    resultText.textContent = "Fill every slot first!";
    resultText.style.color = "#ffb74d";
    resultWord.textContent = "";
    resultOverlay.classList.remove("hidden");
    return;
  }

  let correct = true;
  for (let i = 0; i < slots.length; i++) {
    const card = cards.find((c) => c.id === slots[i].cardId);
    if (card.letter !== currentRound.word[i]) {
      correct = false;
      break;
    }
  }

  resultText.textContent = correct ? "Correct! 🎉" : "Not quite!";
  resultText.style.color = correct ? "#4caf50" : "#ff5252";
  resultWord.textContent = currentRound.word.toUpperCase();
  resultOverlay.classList.remove("hidden");
}

submitBtn.addEventListener("click", checkSubmit);
nextBtn.addEventListener("click", () => {
  resultOverlay.classList.add("hidden");
  showRoundIntro(pickRound());
});

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);

  if (video.readyState < 2) return;

  const now = performance.now();
  const result = handLandmarker.detectForVideo(video, now);

  const dt = now - lastFrameTime;
  lastFrameTime = now;
  const instFps = 1000 / dt;
  fpsSmoothed = fpsSmoothed ? fpsSmoothed * 0.9 + instFps * 0.1 : instFps;
  fpsEl.textContent = `FPS: ${fpsSmoothed.toFixed(1)}`;

  processResult(result);
}

// Full-screen prompt shown before a round begins. On the very first round
// this is also where the camera gets requested; on later rounds the camera
// is already running and this is just a "next round" breather screen.
function showRoundIntro(round) {
  currentRound = round;
  renderVisual(promptDisplay, round);
  startBtn.textContent = cameraStarted ? "Next Round" : "Start Camera";
  startOverlay.classList.remove("hidden");
}

function beginRound() {
  setupRound(currentRound);
  renderVisual(promptThumb, currentRound);
  promptThumb.classList.remove("hidden");
  instructionHint.classList.remove("hidden");
  startOverlay.classList.add("hidden");
}

function requestFullscreenSafe() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) return;
  const result = request.call(el);
  if (result && typeof result.catch === "function") {
    result.catch(() => {});
  }
}

async function start() {
  // Must fire synchronously inside the click handler (before any await) or
  // browsers drop the user-gesture and refuse the fullscreen request.
  requestFullscreenSafe();

  startBtn.disabled = true;

  if (!cameraStarted) {
    statusEl.textContent = "Requesting camera…";
    try {
      await startCamera();
    } catch (err) {
      statusEl.textContent = `Camera error: ${err.message}`;
      startBtn.disabled = false;
      return;
    }

    if (!handLandmarker) {
      await createHandLandmarker();
    }
    cameraStarted = true;
    running = true;
    loop();
  }

  beginRound();
  startBtn.disabled = false;
}

startBtn.addEventListener("click", start);
showRoundIntro(pickRound());

cameraSwitchBtn.addEventListener("click", async () => {
  facingMode = facingMode === "user" ? "environment" : "user";
  video.style.transform = facingMode === "user" ? "scaleX(-1)" : "none";
  if (currentStream) {
    try {
      await startCamera();
    } catch (err) {
      statusEl.textContent = `Camera error: ${err.message}`;
    }
  }
});

function exitGame() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    const result = exit.call(document);
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  }

  running = false;
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
  cameraStarted = false;

  clearBoard();
  resultOverlay.classList.add("hidden");
  promptThumb.classList.add("hidden");
  instructionHint.classList.add("hidden");

  showRoundIntro(pickRound());
}

exitBtn.addEventListener("click", exitGame);

createHandLandmarker().catch((err) => {
  statusEl.textContent = `Model load error: ${err.message}`;
});
