import { HandLandmarker, FilesetResolver } from "../vendor/mediapipe/vision_bundle.mjs";

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const fpsEl = document.getElementById("fps");
const statusEl = document.getElementById("status");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const cameraSwitchBtn = document.getElementById("cameraSwitchBtn");
const cardEl = document.getElementById("card");
const slotEl = document.getElementById("slot");

const PINCH_RATIO_THRESHOLD = 0.45; // pinch distance / palm-scale distance
let handLandmarker = null;
let currentStream = null;
let facingMode = "user";
let running = false;

let cardPos = { x: 0, y: 0 };
let grabbed = false;
let grabOffset = { x: 0, y: 0 };
let placedInSlot = false;

let lastFrameTime = performance.now();
let fpsSmoothed = 0;

function resizeCanvasToVideo() {
  overlay.width = overlay.clientWidth;
  overlay.height = overlay.clientHeight;
}
window.addEventListener("resize", resizeCanvasToVideo);

function initCardPosition() {
  const stageRect = document.getElementById("stage").getBoundingClientRect();
  cardPos.x = stageRect.width * 0.25;
  cardPos.y = stageRect.height * 0.5;
  renderCard();
}

function renderCard() {
  cardEl.style.left = `${cardPos.x}px`;
  cardEl.style.top = `${cardPos.y}px`;
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
  const rect = overlay.getBoundingClientRect();
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

  // Draw landmarks (mapped to match video orientation)
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
  const cardRect = cardEl.getBoundingClientRect();
  const stageRect = document.getElementById("stage").getBoundingClientRect();
  const cardCenter = {
    x: cardRect.left - stageRect.left + cardRect.width / 2,
    y: cardRect.top - stageRect.top + cardRect.height / 2,
  };

  if (isPinching && !grabbed) {
    const d = Math.hypot(pinchPoint.x - cardCenter.x, pinchPoint.y - cardCenter.y);
    const grabRadius = Math.max(cardRect.width, cardRect.height) * 0.75;
    if (d < grabRadius) {
      grabbed = true;
      placedInSlot = false;
      cardEl.dataset.grabbed = "true";
      grabOffset = { x: cardCenter.x - pinchPoint.x, y: cardCenter.y - pinchPoint.y };
    }
  }

  if (grabbed) {
    if (isPinching) {
      cardPos.x = pinchPoint.x + grabOffset.x;
      cardPos.y = pinchPoint.y + grabOffset.y;
      renderCard();
    } else {
      grabbed = false;
      cardEl.dataset.grabbed = "false";
      checkDrop();
    }
  }
}

function checkDrop() {
  const cardRect = cardEl.getBoundingClientRect();
  const slotRect = slotEl.getBoundingClientRect();
  const stageRect = document.getElementById("stage").getBoundingClientRect();

  const overlaps =
    cardRect.left < slotRect.right &&
    cardRect.right > slotRect.left &&
    cardRect.top < slotRect.bottom &&
    cardRect.bottom > slotRect.top;

  if (overlaps) {
    cardPos.x = slotRect.left - stageRect.left + slotRect.width / 2;
    cardPos.y = slotRect.top - stageRect.top + slotRect.height / 2;
    placedInSlot = true;
    slotEl.dataset.filled = "true";
  } else {
    placedInSlot = false;
    slotEl.dataset.filled = "false";
  }
  renderCard();
}

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

  initCardPosition();
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
