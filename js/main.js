import { HandLandmarker, FilesetResolver } from "../vendor/mediapipe/vision_bundle.mjs";

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const fpsEl = document.getElementById("fps");
const statusEl = document.getElementById("status");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const cameraSwitchBtn = document.getElementById("cameraSwitchBtn");
const stage = document.getElementById("stage");
const submitBtn = document.getElementById("submitBtn");
const resultOverlay = document.getElementById("resultOverlay");
const resultText = document.getElementById("resultText");
const resultWord = document.getElementById("resultWord");
const nextBtn = document.getElementById("nextBtn");

const PINCH_RATIO_THRESHOLD = 0.45; // pinch distance / palm-scale distance

// Placeholder word list for board-logic testing. Phase 3 replaces this with
// real prompt themes (colors/shapes) driving word selection.
const WORD_LIST = ["cat", "dog", "sun", "red", "big", "top", "map", "pen"];

let handLandmarker = null;
let currentStream = null;
let facingMode = "user";
let running = false;

let lastFrameTime = performance.now();
let fpsSmoothed = 0;

// --- Board state ---------------------------------------------------------
let currentWord = "";
let slots = []; // { index, el, cardId }
let cards = []; // { id, letter, el, currentSlot, homeX, homeY, x, y }
let grabbedCardId = null;
let grabOffset = { x: 0, y: 0 };
let grabOriginSlot = null; // slot index the grabbed card came from, or null (tray)
let lastWord = "";

function resizeCanvasToVideo() {
  overlay.width = overlay.clientWidth;
  overlay.height = overlay.clientHeight;
}
window.addEventListener("resize", () => {
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

function pickWord() {
  let word;
  do {
    word = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  } while (word === lastWord && WORD_LIST.length > 1);
  lastWord = word;
  return word;
}

function clearBoard() {
  for (const s of slots) s.el.remove();
  for (const c of cards) c.el.remove();
  slots = [];
  cards = [];
  grabbedCardId = null;
  grabOriginSlot = null;
}

function setupRound(word) {
  clearBoard();
  currentWord = word;

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

function slotPosition(index) {
  const rect = stage.getBoundingClientRect();
  const slotSpacing = Math.min(90, rect.width / (slots.length + 1));
  return {
    x: rect.width / 2 + (index - (slots.length - 1) / 2) * slotSpacing,
    y: rect.height * 0.3,
  };
}

function layoutBoard() {
  const rect = stage.getBoundingClientRect();
  const traySpacing = Math.min(90, rect.width / (cards.length + 1));
  const trayY = rect.height * 0.75;

  slots.forEach((s, i) => {
    const pos = slotPosition(i);
    s.el.style.left = `${pos.x}px`;
    s.el.style.top = `${pos.y}px`;
  });

  cards.forEach((c, i) => {
    c.homeX = rect.width / 2 + (i - (cards.length - 1) / 2) * traySpacing;
    c.homeY = trayY;
    if (c.currentSlot === null) {
      c.x = c.homeX;
      c.y = c.homeY;
    } else {
      const pos = slotPosition(c.currentSlot);
      c.x = pos.x;
      c.y = pos.y;
    }
    renderCard(c);
  });
}

function renderCard(card) {
  card.el.style.left = `${card.x}px`;
  card.el.style.top = `${card.y}px`;
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
}

function sendCardHome(card) {
  card.currentSlot = null;
  card.x = card.homeX;
  card.y = card.homeY;
  renderCard(card);
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
  const isPinching = pinchRatio < PINCH_RATIO_THRESHOLD;

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

function handleGesture(isPinching, pinchPoint) {
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
    const grabRadius = 55;
    if (nearest && nearestDist < grabRadius) {
      grabbedCardId = nearest.id;
      grabOriginSlot = nearest.currentSlot;
      nearest.el.dataset.grabbed = "true";
      grabOffset = { x: nearest.x - pinchPoint.x, y: nearest.y - pinchPoint.y };
      if (nearest.currentSlot !== null) {
        slots[nearest.currentSlot].cardId = null;
        slots[nearest.currentSlot].el.dataset.filled = "false";
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
    if (card.letter !== currentWord[i]) {
      correct = false;
      break;
    }
  }

  resultText.textContent = correct ? "Correct! 🎉" : "Not quite!";
  resultText.style.color = correct ? "#4caf50" : "#ff5252";
  resultWord.textContent = currentWord.toUpperCase();
  resultOverlay.classList.remove("hidden");
}

submitBtn.addEventListener("click", checkSubmit);
nextBtn.addEventListener("click", () => setupRound(pickWord()));

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

async function start() {
  startBtn.disabled = true;
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

  setupRound(pickWord());
  startOverlay.classList.add("hidden");
  running = true;
  loop();
}

startBtn.addEventListener("click", start);

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

createHandLandmarker().catch((err) => {
  statusEl.textContent = `Model load error: ${err.message}`;
});
