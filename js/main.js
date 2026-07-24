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
const zoomOverlay = document.getElementById("zoomOverlay");
const zoomVisual = document.getElementById("zoomVisual");
const categoryOverlay = document.getElementById("categoryOverlay");
const categoryList = document.getElementById("categoryList");
const categoryPlayBtn = document.getElementById("categoryPlayBtn");
const categoriesBtn = document.getElementById("categoriesBtn");

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

const ANIMAL_EMOJI = {
  cat: "🐱", dog: "🐶", pig: "🐷", cow: "🐮", hen: "🐔", owl: "🦉",
  fox: "🦊", bee: "🐝", ant: "🐜", bat: "🦇", bear: "🐻", lion: "🦁",
  frog: "🐸", duck: "🦆", fish: "🐟", crab: "🦀", goat: "🐐", deer: "🦌",
  wolf: "🐺", mouse: "🐭", snake: "🐍", horse: "🐴", sheep: "🐑",
  tiger: "🐯", zebra: "🦓", camel: "🐫", koala: "🐨", panda: "🐼",
  shark: "🦈", whale: "🐳", eagle: "🦅", snail: "🐌", turtle: "🐢",
  monkey: "🐵", rabbit: "🐰", parrot: "🦜", elephant: "🐘", giraffe: "🦒",
  penguin: "🐧", chick: "🐥", spider: "🕷️", ladybug: "🐞", octopus: "🐙",
  kangaroo: "🦘", hamster: "🐹", squirrel: "🐿️", peacock: "🦚", flamingo: "🦩",
  swan: "🦢", gorilla: "🦍", hippo: "🦛", rhino: "🦏", otter: "🦦",
  seal: "🦭", dolphin: "🐬", buffalo: "🐃",
};

const FRUIT_EMOJI = {
  apple: "🍎", banana: "🍌", grape: "🍇", mango: "🥭", melon: "🍈",
  cherry: "🍒", peach: "🍑", lemon: "🍋", pear: "🍐", kiwi: "🥝",
  pineapple: "🍍", coconut: "🥥", strawberry: "🍓", watermelon: "🍉",
  avocado: "🥑", tomato: "🍅",
};

const VEHICLE_EMOJI = {
  car: "🚗", bus: "🚌", bike: "🚲", boat: "⛵", train: "🚆",
  plane: "✈️", truck: "🚚", ship: "🚢", taxi: "🚕", tram: "🚊",
  rocket: "🚀", scooter: "🛴", tractor: "🚜",
};

const FOOD_EMOJI = {
  cake: "🍰", bread: "🍞", candy: "🍬", pizza: "🍕", taco: "🌮",
  egg: "🥚", rice: "🍚", soup: "🍲", milk: "🥛", juice: "🧃",
  donut: "🍩", cookie: "🍪", burger: "🍔", popcorn: "🍿",
};

function emojiTheme(map) {
  return Object.entries(map).map(([word, emoji]) => ({ word, type: "emoji", value: emoji }));
}

const THEMES = {
  colors: [
    "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown",
    "black", "white", "gray", "gold", "teal", "cyan", "lime", "navy",
  ].map((word) => ({ word, type: "color", value: COLOR_HEX(word) })),
  shapes: Object.keys(SHAPE_PATHS).map((word) => ({ word, type: "shape", value: word })),
  animals: emojiTheme(ANIMAL_EMOJI),
  fruits: emojiTheme(FRUIT_EMOJI),
  vehicles: emojiTheme(VEHICLE_EMOJI),
  food: emojiTheme(FOOD_EMOJI),
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
    gray: "#757575",
    gold: "#c9a227",
    teal: "#00897b",
    cyan: "#00bcd4",
    lime: "#c0d92e",
    navy: "#1a237e",
  };
  return map[name];
}

// Shapes stay disabled until their own visual prompts are ready; every other
// theme is code-rendered (color swatch or emoji) so all are safe to combine.
// The player narrows this down to one or more categories via the picker.
const CATEGORIES = [
  { id: "colors", label: "🎨 Colors", rounds: THEMES.colors },
  { id: "animals", label: "🐾 Animals", rounds: THEMES.animals },
  { id: "fruits", label: "🍎 Fruits", rounds: THEMES.fruits },
  { id: "vehicles", label: "🚗 Vehicles", rounds: THEMES.vehicles },
  { id: "food", label: "🍕 Food", rounds: THEMES.food },
];
const ALL_ROUNDS = CATEGORIES.flatMap((c) => c.rounds);
const selectedCategoryIds = new Set(CATEGORIES.map((c) => c.id));

function currentPool() {
  const active = CATEGORIES.filter((c) => selectedCategoryIds.has(c.id));
  const pool = active.flatMap((c) => c.rounds);
  return pool.length ? pool : ALL_ROUNDS;
}

function renderVisual(container, round) {
  container.innerHTML = "";
  if (round.type === "color") {
    const block = document.createElement("div");
    block.className = "visual-color";
    block.style.background = round.value;
    container.appendChild(block);
  } else if (round.type === "emoji") {
    const emoji = document.createElement("div");
    emoji.className = "visual-emoji";
    emoji.textContent = round.value;
    container.appendChild(emoji);
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
let lastSparkleTime = 0;
let lastDustTime = performance.now();

function spawnSparkles(x, y, count = 6) {
  for (let i = 0; i < count; i++) {
    const s = document.createElement("span");
    s.className = "sparkle";
    s.textContent = Math.random() < 0.5 ? "✨" : "⭐";
    const angle = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 24;
    s.style.setProperty("--sx", `${Math.cos(angle) * dist}px`);
    s.style.setProperty("--sy", `${Math.sin(angle) * dist - 18}px`);
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    stage.appendChild(s);
    s.addEventListener("animationend", () => s.remove());
  }
}

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
  const pool = currentPool();
  let round;
  do {
    round = pool[Math.floor(Math.random() * pool.length)];
  } while (round.word === lastRoundWord && pool.length > 1);
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

// Magic-light cursor drawn at the pinch point: a soft glowing orb that
// pulses gently, flaring brighter (gold -> purple-white) when pinching.
function drawMagicOrb(point, isPinching) {
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 170);
  const baseRgb = isPinching ? "179, 107, 255" : "255, 213, 79";
  const radius = (isPinching ? 15 : 11) + pulse * (isPinching ? 5 : 3);

  ctx.save();
  ctx.shadowBlur = 18 + pulse * 12;
  ctx.shadowColor = `rgba(${baseRgb}, 0.95)`;

  const gradient = ctx.createRadialGradient(
    point.x, point.y, 0,
    point.x, point.y, radius
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  gradient.addColorStop(0.45, `rgba(${baseRgb}, 0.9)`);
  gradient.addColorStop(1, `rgba(${baseRgb}, 0)`);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// A little ring of tiny sparkles orbiting the pinch point — purely
// decorative flair to make the hand cursor read as "magic wand" rather
// than a plain dot.
const ORBIT_GLYPHS = ["✨", "⭐", "💫"];

function drawOrbHalo(point, isPinching) {
  const count = isPinching ? 6 : 4;
  const radius = isPinching ? 30 : 24;
  const t = performance.now() / 480;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < count; i++) {
    const angle = t + (i * Math.PI * 2) / count;
    const x = point.x + Math.cos(angle) * radius;
    const y = point.y + Math.sin(angle) * radius * 0.6;
    const twinkle = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
    ctx.globalAlpha = 0.4 + twinkle * 0.6;
    ctx.font = `${8 + twinkle * 6}px serif`;
    ctx.fillText(ORBIT_GLYPHS[i % ORBIT_GLYPHS.length], x, y);
  }
  ctx.restore();
}

// Continuous fairy-dust trail: tiny fading glitter particles emitted from
// the pinch point every frame, independent of grabbing a card, so the whole
// hand cursor feels alive rather than just the moment of a grab.
let dustParticles = [];

function spawnDust(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.15 + Math.random() * 0.35;
    dustParticles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.25,
      age: 0,
      maxAge: 350 + Math.random() * 350,
      size: 1.2 + Math.random() * 2.2,
      rgb: Math.random() < 0.5 ? "255, 213, 79" : "179, 107, 255",
    });
  }
}

function updateAndDrawDust(dt) {
  if (dustParticles.length === 0) return;
  ctx.save();
  for (let i = dustParticles.length - 1; i >= 0; i--) {
    const p = dustParticles[i];
    p.age += dt;
    if (p.age > p.maxAge) {
      dustParticles.splice(i, 1);
      continue;
    }
    p.x += p.vx * (dt / 16);
    p.y += p.vy * (dt / 16);
    const t = p.age / p.maxAge;
    const alpha = (1 - t) * 0.85;
    const r = p.size * (1 - t * 0.5);
    ctx.shadowBlur = 5;
    ctx.shadowColor = `rgba(${p.rgb}, ${alpha})`;
    ctx.fillStyle = `rgba(${p.rgb}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function processResult(result) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const now = performance.now();
  const dustDt = now - lastDustTime;
  lastDustTime = now;
  updateAndDrawDust(dustDt);

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
    handleZoomGesture(false);
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

  const fingers = {
    thumb: isFingerExtended(landmarks, 4, 2, wrist, palmScale),
    index: isFingerExtended(landmarks, 8, 6, wrist, palmScale),
    middle: isFingerExtended(landmarks, 12, 10, wrist, palmScale),
    ring: isFingerExtended(landmarks, 16, 14, wrist, palmScale),
    pinky: isFingerExtended(landmarks, 20, 18, wrist, palmScale),
  };
  const isThumbsUp = fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky;
  const isPeaceSign = fingers.index && fingers.middle && !fingers.ring && !fingers.pinky;
  pinchDebugEl.textContent = `pinch: ${pinchRatio.toFixed(2)} ${isPinching ? "🤏" : ""} ${isThumbsUp ? "👍" : ""} ${isPeaceSign ? "✌️" : ""}`;

  const pinchPoint = {
    x: mapX((thumbTip.x + indexTip.x) / 2, overlay.width),
    y: ((thumbTip.y + indexTip.y) / 2) * overlay.height,
  };

  // Twinkling fairy-light dots instead of plain landmark markers: size and
  // color shimmer per-point so the whole hand sparkles, not just the cursor.
  const twinkleT = now / 260;
  ctx.save();
  landmarks.forEach((lm, i) => {
    const x = mapX(lm.x, overlay.width);
    const y = lm.y * overlay.height;
    const twinkle = 0.5 + 0.5 * Math.sin(twinkleT + i * 1.3);
    const rgb = i % 2 === 0 ? "255, 213, 79" : "255, 154, 226";
    ctx.shadowBlur = 6 + twinkle * 6;
    ctx.shadowColor = `rgba(${rgb}, 0.9)`;
    ctx.fillStyle = `rgba(${rgb}, ${0.6 + twinkle * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + twinkle * 2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  drawMagicOrb(pinchPoint, isPinching);
  drawOrbHalo(pinchPoint, isPinching);
  spawnDust(pinchPoint.x, pinchPoint.y, isPinching ? 2 : 1);

  handleGesture(isPinching, pinchPoint);
  handleThumbsUpGesture(isThumbsUp);
  const roundActive = currentRound && startOverlay.classList.contains("hidden");
  handleZoomGesture(isPeaceSign && !isPinching && grabbedCardId === null && roundActive);
}

// Finger-extension check: distance-based (tip vs. its own middle knuckle,
// both measured from the wrist) so it holds up across hand rotation,
// unlike an axis-aligned check. The margin is deliberately generous (not
// just "farther than the knuckle") so an ordinary half-open hand while
// reaching for a card doesn't read as "extended".
const FINGER_EXTEND_MARGIN = 0.28;

function isFingerExtended(landmarks, tipIdx, midIdx, wrist, palmScale) {
  const tip = landmarks[tipIdx];
  const mid = landmarks[midIdx];
  return distance(tip, wrist) - distance(mid, wrist) > palmScale * FINGER_EXTEND_MARGIN;
}

// A held-up thumbs-up acts as a hands-free "confirm" button press for
// whichever screen is active — an alternative to pinch-clicking the tiny
// on-screen buttons, which some players find fiddly to land. A fist-with-
// thumb-out is a very different shape from an open reaching hand, so it's
// much less prone to misfiring mid-round than the index+pinky "ILY" sign
// used before.
//
// It still has to be held for THUMBS_UP_HOLD_MS before it fires (not just a
// single rising-edge frame), as a second guard against one noisy MediaPipe
// frame triggering an accidental Submit mid-round.
const THUMBS_UP_HOLD_MS = 350;
let thumbsUpHoldStart = null;
let thumbsUpFired = false;

function handleThumbsUpGesture(isThumbsUp) {
  if (!isThumbsUp || isPinchingState || grabbedCardId !== null) {
    thumbsUpHoldStart = null;
    thumbsUpFired = false;
    return;
  }
  if (thumbsUpHoldStart === null) thumbsUpHoldStart = performance.now();
  if (thumbsUpFired || performance.now() - thumbsUpHoldStart < THUMBS_UP_HOLD_MS) return;
  thumbsUpFired = true;

  if (roundIntroPinchable() && !startBtn.disabled) {
    startBtn.click();
  } else if (!resultOverlay.classList.contains("hidden")) {
    nextBtn.click();
  } else if (startOverlay.classList.contains("hidden")) {
    submitBtn.click();
  }
}

// Holding up a peace sign (index + middle) magnifies the current round's
// picture full-screen — a "zoom to check" for the tiny corner thumbnail
// during a round. It's a hold gesture (not a click), so the overlay tracks
// state directly rather than only firing on a rising edge.
let zoomOpen = false;

function handleZoomGesture(shouldShow) {
  if (shouldShow === zoomOpen) return;
  zoomOpen = shouldShow;
  if (shouldShow) {
    renderVisual(zoomVisual, currentRound);
    zoomOverlay.classList.remove("hidden");
  } else {
    zoomOverlay.classList.add("hidden");
  }
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
      spawnSparkles(nearest.x, nearest.y, 7);
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
      const now = performance.now();
      if (now - lastSparkleTime > 110) {
        lastSparkleTime = now;
        spawnSparkles(card.x, card.y, 1);
      }
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

function renderCategoryChips() {
  categoryList.innerHTML = "";
  for (const cat of CATEGORIES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "category-chip";
    chip.classList.toggle("active", selectedCategoryIds.has(cat.id));
    chip.textContent = cat.label;
    chip.addEventListener("click", () => {
      if (selectedCategoryIds.has(cat.id)) {
        selectedCategoryIds.delete(cat.id);
      } else {
        selectedCategoryIds.add(cat.id);
      }
      chip.classList.toggle("active", selectedCategoryIds.has(cat.id));
    });
    categoryList.appendChild(chip);
  }
}
renderCategoryChips();

categoryPlayBtn.addEventListener("click", () => {
  categoryOverlay.classList.add("hidden");
  showRoundIntro(pickRound());
});

categoriesBtn.addEventListener("click", () => {
  categoryOverlay.classList.remove("hidden");
});

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
  zoomOverlay.classList.add("hidden");
  zoomOpen = false;

  showRoundIntro(pickRound());
}

exitBtn.addEventListener("click", exitGame);

createHandLandmarker().catch((err) => {
  statusEl.textContent = `Model load error: ${err.message}`;
});
