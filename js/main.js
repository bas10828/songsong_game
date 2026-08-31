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
const skipBtn = document.getElementById("skipBtn");
const resultOverlay = document.getElementById("resultOverlay");
const resultText = document.getElementById("resultText");
const resultWord = document.getElementById("resultWord");
const nextBtn = document.getElementById("nextBtn");
const zoomOverlay = document.getElementById("zoomOverlay");
const zoomVisual = document.getElementById("zoomVisual");
const translateOverlay = document.getElementById("translateOverlay");
const translateDirectionPill = document.getElementById("translateDirectionPill");
const translatePromptHint = document.getElementById("translatePromptHint");
const translatePromptText = document.getElementById("translatePromptText");
const translateOptionsContainer = document.getElementById("translateOptions");
const translateOptionEls = [...translateOptionsContainer.children];
const categoryOverlay = document.getElementById("categoryOverlay");
const categoryList = document.getElementById("categoryList");
const categoryPlayBtn = document.getElementById("categoryPlayBtn");
const categoriesBtn = document.getElementById("categoriesBtn");
const publicSetsSection = document.getElementById("publicSetsSection");
const publicSetsList = document.getElementById("publicSetsList");
const modeOverlay = document.getElementById("modeOverlay");
const modeSoloBtn = document.getElementById("modeSoloBtn");
const modeTeamBtn = document.getElementById("modeTeamBtn");
const scoreHud = document.getElementById("scoreHud");
const teamTurnBanner = document.getElementById("teamTurnBanner");
const summaryOverlay = document.getElementById("summaryOverlay");
const summaryTitle = document.getElementById("summaryTitle");
const summaryScore = document.getElementById("summaryScore");
const playAgainBtn = document.getElementById("playAgainBtn");
const newSetupBtn = document.getElementById("newSetupBtn");
const recordBlock = document.getElementById("recordBlock");
const recordNameInput = document.getElementById("recordNameInput");
const recordSubmitBtn = document.getElementById("recordSubmitBtn");
const recordError = document.getElementById("recordError");
const recordSavedMsg = document.getElementById("recordSavedMsg");
const manageWordsBtn = document.getElementById("manageWordsBtn");
const authOverlay = document.getElementById("authOverlay");
const authUser = document.getElementById("authUser");
const authPass = document.getElementById("authPass");
const authError = document.getElementById("authError");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authCancelBtn = document.getElementById("authCancelBtn");
const setsListOverlay = document.getElementById("setsListOverlay");
const setsList = document.getElementById("setsList");
const newSetNameInput = document.getElementById("newSetNameInput");
const createSetBtn = document.getElementById("createSetBtn");
const setsListError = document.getElementById("setsListError");
const setsListBackBtn = document.getElementById("setsListBackBtn");
const setDetailOverlay = document.getElementById("setDetailOverlay");
const setDetailTitle = document.getElementById("setDetailTitle");
const renameSetBtn = document.getElementById("renameSetBtn");
const renameSetRow = document.getElementById("renameSetRow");
const renameSetInput = document.getElementById("renameSetInput");
const saveRenameBtn = document.getElementById("saveRenameBtn");
const cancelRenameBtn = document.getElementById("cancelRenameBtn");
const savedToast = document.getElementById("savedToast");
const setQuestionsList = document.getElementById("setQuestionsList");
const newQuestionKindSelect = document.getElementById("newQuestionKindSelect");
const addQuestionBtn = document.getElementById("addQuestionBtn");
const setDetailBackBtn = document.getElementById("setDetailBackBtn");
const leaderboardOverlay = document.getElementById("leaderboardOverlay");
const leaderboardTitle = document.getElementById("leaderboardTitle");
const leaderboardList = document.getElementById("leaderboardList");
const leaderboardBackBtn = document.getElementById("leaderboardBackBtn");
const questionFormOverlay = document.getElementById("questionFormOverlay");
const questionFormTitle = document.getElementById("questionFormTitle");
const spellFormFields = document.getElementById("spellFormFields");
const translateFormFields = document.getElementById("translateFormFields");
const qSpellWordInput = document.getElementById("qSpellWordInput");
const photoInputRow = document.getElementById("photoInputRow");
const customPhotoInput = document.getElementById("customPhotoInput");
const customPreview = document.getElementById("customPreview");
const dirThEnBtn = document.getElementById("dirThEnBtn");
const dirEnThBtn = document.getElementById("dirEnThBtn");
const qPromptInput = document.getElementById("qPromptInput");
const qOptionInputs = [0, 1, 2, 3].map((i) => document.getElementById(`qOption${i}`));
const qCorrectRadios = [0, 1, 2, 3].map((i) => document.getElementById(`qCorrect${i}`));
const sentenceFormFields = document.getElementById("sentenceFormFields");
const sentDirThEnBtn = document.getElementById("sentDirThEnBtn");
const sentDirEnThBtn = document.getElementById("sentDirEnThBtn");
const qSentPromptInput = document.getElementById("qSentPromptInput");
const sentCardMinusBtn = document.getElementById("sentCardMinusBtn");
const sentCardPlusBtn = document.getElementById("sentCardPlusBtn");
const sentCardCountLabel = document.getElementById("sentCardCountLabel");
const sentCardInputs = document.getElementById("sentCardInputs");
const questionFormError = document.getElementById("questionFormError");
const saveQuestionBtn = document.getElementById("saveQuestionBtn");
const cancelQuestionBtn = document.getElementById("cancelQuestionBtn");

// Hand-effect "skins" — each bundles the colors/glyphs used to draw the
// hand skeleton, pinch orb, and particle trails, plus the two CSS magic-
// aura colors used by the card-grab effect (synced onto :root so the
// existing CSS keeps working unchanged). One is picked at random each
// round so the effect keeps feeling fresh.
const HAND_SKINS = [
  {
    name: "fairy",
    boneColors: ["255, 241, 199", "255, 245, 214", "255, 250, 235", "255, 245, 214", "255, 241, 199"],
    tipGlowRgb: "255, 250, 235",
    orbIdleRgb: "255, 213, 79",
    orbPinchRgb: "255, 244, 214",
    orbitGlyphs: ["✨", "🌟", "💫"],
    dustRgbs: ["255, 250, 235", "255, 213, 79"],
    sparkleGlyphs: ["✨", "🌟"],
    magicA: "#fff4d6",
    magicB: "#ffd54f",
  },
  {
    name: "unicorn",
    boneColors: ["255, 110, 110", "255, 214, 92", "110, 220, 150", "110, 180, 255", "200, 120, 255"],
    tipGlowRgb: "255, 255, 255",
    orbIdleRgb: "255, 255, 255",
    orbPinchRgb: "200, 120, 255",
    orbitGlyphs: ["🦄", "✨", "🌈"],
    dustRgbs: ["255, 110, 110", "255, 214, 92", "110, 220, 150", "110, 180, 255", "200, 120, 255"],
    sparkleGlyphs: ["🌈", "✨", "⭐"],
    magicA: "#b06bff",
    magicB: "#7fd1ff",
  },
  {
    name: "flower",
    boneColors: ["90, 170, 90", "120, 200, 120", "100, 190, 140", "130, 200, 110", "110, 180, 160"],
    tipGlowRgb: "255, 182, 213",
    orbIdleRgb: "182, 230, 150",
    orbPinchRgb: "255, 133, 177",
    orbitGlyphs: ["🌸", "🦋", "🌷"],
    dustRgbs: ["255, 182, 213", "182, 230, 150", "255, 133, 177"],
    sparkleGlyphs: ["🌸", "🦋"],
    magicA: "#8fd68f",
    magicB: "#ff9ecf",
  },
];
let currentHandSkin = HAND_SKINS[0];

function pickHandSkin() {
  currentHandSkin = HAND_SKINS[Math.floor(Math.random() * HAND_SKINS.length)];
  document.documentElement.style.setProperty("--color-magic-a", currentHandSkin.magicA);
  document.documentElement.style.setProperty("--color-magic-b", currentHandSkin.magicB);
}

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
// Teacher-authored "question sets" are a separate, curated concept (see
// below) — not part of this random-sample pool.
const CATEGORIES = [
  { id: "colors", label: "🎨  Colors", rounds: THEMES.colors },
  { id: "animals", label: "🐾  Animals", rounds: THEMES.animals },
  { id: "fruits", label: "🍎  Fruits", rounds: THEMES.fruits },
  { id: "vehicles", label: "🚗  Vehicles", rounds: THEMES.vehicles },
  { id: "food", label: "🍕  Food", rounds: THEMES.food },
];
const selectedCategoryIds = new Set(CATEGORIES.map((c) => c.id));

function currentPool() {
  const active = CATEGORIES.filter((c) => selectedCategoryIds.has(c.id));
  const pool = active.flatMap((c) => c.rounds);
  return pool.length ? pool : CATEGORIES.flatMap((c) => c.rounds);
}

// --- Scoring session -----------------------------------------------------
const ROUNDS_PER_SESSION_DEFAULT = 10;
let sessionLength = ROUNDS_PER_SESSION_DEFAULT;
let gameMode = "solo"; // "solo" | "team"
let questionsAnswered = 0;
let soloCorrectCount = 0;
// Total points, not just a correct-count: base points for a correct
// answer, plus a time bonus (faster = more) and a streak bonus (more
// consecutive corrects = more) — see finishRound(). This is what gets
// submitted to the leaderboard; soloCorrectCount stays around purely for
// the "X/10 correct" readout, which the teacher still wants for grading
// regardless of how fast/streaky a kid answered. Team mode doesn't use
// any of this — it keeps the plain 1-point-per-correct scoring it always
// had, kept deliberately simple/separate from the solo bonus system.
let soloTotalPoints = 0;
let currentStreak = 0;
let roundStartTime = null;
let teamScoreRed = 0;
let teamScoreBlue = 0;
// Set while the summary screen is offering to save a just-broken record —
// only meaningful between showSummary() showing the prompt and the
// teacher/student tapping Save.
let pendingRecordSetId = null;
let pendingRecordScore = 0;
let pendingRecordSessionLength = 0;

// A session either draws from the built-in random category pool (fixed
// length) or plays a teacher-authored set start-to-finish in order (length
// = however many questions that set actually has — a half-finished 5/10
// set is still fully playable, not padded or blocked).
let sessionSource = "pool"; // "pool" | "teacherSet"
let activeTeacherSet = null;
let teacherSetQueue = [];

// Whose turn it is, in team mode, derived from how many questions have
// already been answered this session — alternates Red/Blue every question
// (1st, 3rd, 5th... = Red) rather than tracked as separate mutable state.
function teamForIndex(answeredCount) {
  return answeredCount % 2 === 0 ? "red" : "blue";
}

function resetSession() {
  questionsAnswered = 0;
  soloCorrectCount = 0;
  soloTotalPoints = 0;
  currentStreak = 0;
  teamScoreRed = 0;
  teamScoreBlue = 0;
  updateScoreHud();
}

function updateScoreHud() {
  const q = Math.min(questionsAnswered + 1, sessionLength);
  if (gameMode === "team") {
    scoreHud.textContent = `Q ${q}/${sessionLength} · 🔴 ${teamScoreRed} - ${teamScoreBlue} 🔵`;
  } else {
    scoreHud.textContent = `Q ${q}/${sessionLength} · ✅ ${soloCorrectCount} · 🌟 ${soloTotalPoints}`;
  }
  scoreHud.classList.remove("score-pop");
  void scoreHud.offsetWidth;
  scoreHud.classList.add("score-pop");
}

function updateTeamTurnBanner() {
  if (gameMode !== "team") {
    teamTurnBanner.classList.add("hidden");
    return;
  }
  const team = teamForIndex(questionsAnswered);
  teamTurnBanner.classList.remove("hidden");
  teamTurnBanner.classList.toggle("team-red", team === "red");
  teamTurnBanner.classList.toggle("team-blue", team === "blue");
  teamTurnBanner.textContent = team === "red" ? "🔴 Team Red's turn!" : "🔵 Team Blue's turn!";
}

async function showSummary() {
  recordBlock.classList.add("hidden");
  recordError.classList.add("hidden");
  recordSavedMsg.classList.add("hidden");
  pendingRecordSetId = null;

  if (gameMode === "team") {
    if (teamScoreRed === teamScoreBlue) {
      summaryTitle.textContent = "🤝 It's a Tie!";
    } else {
      summaryTitle.textContent = teamScoreRed > teamScoreBlue ? "🔴 Team Red Wins!" : "🔵 Team Blue Wins!";
    }
    summaryScore.textContent = `🔴 Team Red: ${teamScoreRed}    🔵 Team Blue: ${teamScoreBlue}`;
    summaryOverlay.classList.remove("hidden");
    return;
  }

  const stars =
    soloCorrectCount >= sessionLength ? "⭐⭐⭐" :
    soloCorrectCount >= sessionLength * 0.7 ? "⭐⭐" :
    soloCorrectCount >= sessionLength * 0.4 ? "⭐" : "";
  summaryTitle.textContent = "Great job!";
  summaryScore.textContent = `${soloCorrectCount} / ${sessionLength} correct ${stars}\n🌟 ${soloTotalPoints} points`;

  // Only teacher-authored sets have a leaderboard (built-in category
  // play draws a random pool each time, so there's no stable "set" to
  // hold a record); team mode never participates either — points are a
  // solo-only concept. The record is total points, not correct-count —
  // it's the number that rewards fast/streaky play, which is what a
  // "record" is meant to celebrate; correct-count alone is still shown
  // above for grading, it just isn't what's being competed over.
  if (sessionSource === "teacherSet" && activeTeacherSet) {
    try {
      const res = await fetch(`/api/question-sets/${activeTeacherSet.id}/leaderboard`);
      const board = await res.json();
      const currentBest = board.length ? board[board.length - 1].score : -1;
      if (soloTotalPoints > 0 && soloTotalPoints > currentBest) {
        pendingRecordSetId = activeTeacherSet.id;
        pendingRecordScore = soloTotalPoints;
        pendingRecordSessionLength = sessionLength;
        recordNameInput.value = "";
        recordBlock.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Failed to check leaderboard:", err);
    }
  }
  summaryOverlay.classList.remove("hidden");
}

recordSubmitBtn.addEventListener("click", async () => {
  const name = recordNameInput.value.trim();
  if (!name) {
    recordError.textContent = "Enter a nickname.";
    recordError.classList.remove("hidden");
    return;
  }
  recordError.classList.add("hidden");
  try {
    const res = await fetch(`/api/question-sets/${pendingRecordSetId}/leaderboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score: pendingRecordScore, sessionLength: pendingRecordSessionLength }),
    });
    const data = await res.json();
    if (!res.ok) {
      recordError.textContent = data.error || "Something went wrong.";
      recordError.classList.remove("hidden");
      return;
    }
    recordBlock.classList.add("hidden");
    recordSavedMsg.classList.remove("hidden");
  } catch (err) {
    recordError.textContent = "Network error — try again.";
    recordError.classList.remove("hidden");
  }
});

function renderVisual(container, round) {
  container.innerHTML = "";
  if (round.kind === "translate" || round.kind === "sentence") {
    const text = document.createElement("div");
    text.className = "visual-text";
    text.textContent = round.prompt;
    container.appendChild(text);
  } else if (round.type === "color") {
    const block = document.createElement("div");
    block.className = "visual-color";
    block.style.background = round.value;
    container.appendChild(block);
  } else if (round.type === "emoji") {
    const emoji = document.createElement("div");
    emoji.className = "visual-emoji";
    emoji.textContent = round.value;
    container.appendChild(emoji);
  } else if (round.type === "photo") {
    const img = document.createElement("img");
    img.className = "visual-photo";
    img.src = round.value;
    img.alt = round.word;
    container.appendChild(img);
  } else {
    container.innerHTML = `<svg viewBox="0 0 100 100" fill="#29b6f6">${SHAPE_PATHS[round.value]}</svg>`;
  }
}

let handLandmarker = null;
let handLandmarkerPromise = null;
let currentStream = null;
let facingMode = "user";

// Ask for the camera as soon as this page loads, decoupled from the
// "Start Camera" click. Requesting it inside the click handler meant the
// permission prompt (or a denial) landed *after* we'd already entered
// fullscreen, leaving a broken camera view stuck fullscreen with no easy
// way out. By preflighting here, the permission is usually already
// resolved by the time the user clicks Start.
let preflightStreamPromise = null;
let preflightError = null;

function preflightCamera() {
  preflightStreamPromise = navigator.mediaDevices
    .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
    .then((stream) => {
      preflightError = null;
      return stream;
    })
    .catch((err) => {
      preflightError = err;
      // Some browsers reject page-load camera requests until a user gesture.
      // Keep that failure recoverable so Start can retry on its first click.
      return null;
    });
}
preflightCamera();
let running = false;

let lastFrameTime = performance.now();
let fpsSmoothed = 0;

// --- Board state ---------------------------------------------------------
let currentRound = null; // { word, type, value }
let slots = []; // { index, el, cardId }
let cards = []; // { id, letter, el, currentSlot, homeX, homeY, x, y }
let grabbedCardId = null;
let grabOriginSlot = null; // slot index the grabbed card came from, or null (tray)
let lastRoundWord = "";
let cameraStarted = false;
let grabRadiusPx = 55;
let prevIsPinching = false;
let lastSparkleTime = 0;
let lastDustTime = performance.now();

function spawnSparkles(x, y, count = 6) {
  const starGlyphs = ["✦", "✧", "✨", "⭐"];
  for (let i = 0; i < count; i++) {
    const s = document.createElement("span");
    s.className = "sparkle";
    s.textContent = starGlyphs[Math.floor(Math.random() * starGlyphs.length)];
    const angle = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 24;
    s.style.setProperty("--sparkle-size", `${12 + Math.random() * 9}px`);
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

function pickPoolRound() {
  const pool = currentPool();
  let round;
  do {
    round = pool[Math.floor(Math.random() * pool.length)];
  } while (round.word === lastRoundWord && pool.length > 1);
  lastRoundWord = round.word;
  return { ...round, kind: "spell" };
}

// Converts a teacher-authored question (server shape) into the same
// internal "round" shape the rest of the game already understands.
function questionToRound(q) {
  if (q.kind === "translate") {
    return { kind: "translate", direction: q.direction, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex };
  }
  if (q.kind === "sentence") {
    return { kind: "sentence", direction: q.direction, prompt: q.prompt, answerWords: q.answerWords };
  }
  return { kind: "spell", word: q.word, type: q.visualType, value: q.visualValue };
}

// Single entry point for "what's the next question" — draws from the
// random built-in pool, or advances through a teacher set in order,
// depending on how this session was started.
function pickNextQuestion() {
  pickHandSkin();
  if (sessionSource === "teacherSet") {
    return questionToRound(teacherSetQueue.shift());
  }
  return pickPoolRound();
}

function clearBoard() {
  for (const s of slots) s.el.remove();
  for (const c of cards) c.el.remove();
  slots = [];
  cards = [];
  grabbedCardId = null;
  grabOriginSlot = null;
}

// Drives both "spell" rounds (one card per letter) and "sentence" rounds
// (one card per word) — same board, different tokenization.
function setupRound(round) {
  clearBoard();
  currentRound = round;
  roundStartTime = performance.now();

  const isSentence = round.kind === "sentence";
  const tokens = isSentence ? round.answerWords : round.word.split("");
  const shuffled = shuffle(tokens);

  slots = tokens.map((_, index) => {
    const el = document.createElement("div");
    el.className = isSentence ? "slot word" : "slot";
    el.dataset.filled = "false";
    stage.appendChild(el);
    return { index, el, cardId: null };
  });

  cards = shuffled.map((token, i) => {
    const el = document.createElement("div");
    el.className = isSentence ? "card word" : "card";
    el.dataset.grabbed = "false";
    el.textContent = token.toUpperCase();
    el.style.setProperty("--tilt", `${(Math.random() * 10 - 5).toFixed(1)}deg`);
    stage.appendChild(el);
    return {
      id: `card-${i}`,
      letter: token,
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

// Word tiles get a width that grows with the round's longest word, instead
// of the fixed square used for single letters — "elephant" needs more room
// than "I". Every tile in a sentence round shares this one width (not each
// one sized to its own word) — sizing each tile to its own word turned
// width into a free hint, since a card only ever fits the slot it belongs
// in.
// Off-screen clone of a real word-card, reused to measure how wide a word
// actually renders (font, weight, and the card's own padding all included,
// since it's styled with the exact same classes) rather than guessing from
// character count — a fixed per-character estimate was either too tight
// for wide letters or, tuned safe, made every card oversized regardless of
// what word it held (English and Thai glyphs aren't remotely the same
// width, so no single constant multiplier could fit both well anyway).
const wordMeasureEl = document.createElement("div");
wordMeasureEl.className = "card word";
wordMeasureEl.style.position = "absolute";
wordMeasureEl.style.visibility = "hidden";
wordMeasureEl.style.left = "-9999px";
wordMeasureEl.style.top = "-9999px";
wordMeasureEl.style.width = "auto";
wordMeasureEl.style.animation = "none";
document.body.appendChild(wordMeasureEl);

function measureWordTileWidth(word, fontSizePx) {
  wordMeasureEl.style.fontSize = `${fontSizePx}px`;
  wordMeasureEl.textContent = word.toUpperCase();
  return wordMeasureEl.getBoundingClientRect().width;
}

function tileWidthFor(m, isSentence) {
  if (!isSentence) return m.size;
  const fontSizePx = Math.max(13, m.size * 0.3);
  const widths = currentRound.answerWords.map((w) => measureWordTileWidth(w, fontSizePx));
  return Math.max(m.size, ...widths) + 4;
}

// Lays `count` same-size tiles out in a row, wrapping to further balanced
// rows (not one crammed/overflowing row, and not one near-empty last row)
// once they wouldn't all fit at their natural width — used for both the
// slot row and the card tray, so a long sentence wraps instead of running
// its tiles into each other off the edge of the stage.
function tileGrid(count, tileW, tileH, rect) {
  const colPitch = tileW + tileW * 0.22;
  const maxCols = Math.max(1, Math.floor((rect.width * 0.94) / colPitch));
  const cols = Math.min(Math.max(count, 1), maxCols);
  const rows = Math.max(1, Math.ceil(count / cols));
  const perRow = Math.ceil(count / rows);
  const rowCounts = [];
  let remaining = count;
  for (let r = 0; r < rows; r++) {
    const n = Math.min(perRow, remaining);
    rowCounts.push(n);
    remaining -= n;
  }
  return { rowCounts, colPitch, rowPitch: tileH + tileH * 0.4 };
}

function tilePosition(index, grid, centerX, baseY) {
  let row = 0;
  let idx = index;
  while (idx >= grid.rowCounts[row]) {
    idx -= grid.rowCounts[row];
    row++;
  }
  const itemsInRow = grid.rowCounts[row];
  return {
    x: centerX + (idx - (itemsInRow - 1) / 2) * grid.colPitch,
    y: baseY + row * grid.rowPitch,
  };
}

function slotPosition(index, metrics) {
  const m = metrics || computeMetrics();
  const isSentence = currentRound && currentRound.kind === "sentence";
  const grid = tileGrid(slots.length, tileWidthFor(m, isSentence), m.size, m.rect);
  return tilePosition(index, grid, m.rect.width / 2, m.rect.height * 0.22);
}

function layoutBoard() {
  const m = computeMetrics();
  const grabRadius = m.size * 0.85;
  const isSentence = currentRound && currentRound.kind === "sentence";
  const tileWidth = tileWidthFor(m, isSentence);
  const slotGrid = tileGrid(slots.length, tileWidth, m.size, m.rect);
  const cardGrid = tileGrid(cards.length, tileWidth, m.size, m.rect);
  const trayBaseY = m.rect.height * 0.66;

  slots.forEach((s, i) => {
    const pos = tilePosition(i, slotGrid, m.rect.width / 2, m.rect.height * 0.22);
    s.el.style.left = `${pos.x}px`;
    s.el.style.top = `${pos.y}px`;
    s.el.style.width = `${tileWidth + 6}px`;
    s.el.style.height = `${m.size + 6}px`;
  });

  cards.forEach((c, i) => {
    const homePos = tilePosition(i, cardGrid, m.rect.width / 2, trayBaseY);
    c.homeX = homePos.x;
    c.homeY = homePos.y;
    c.el.style.width = `${tileWidth}px`;
    c.el.style.height = `${m.size}px`;
    c.el.style.fontSize = isSentence ? `${Math.max(13, m.size * 0.3)}px` : `${Math.max(16, m.size * 0.45)}px`;
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

function ensureHandLandmarker() {
  if (handLandmarker) return Promise.resolve(handLandmarker);
  if (!handLandmarkerPromise) {
    handLandmarkerPromise = createHandLandmarker()
      .then(() => handLandmarker)
      .catch((err) => {
        handLandmarkerPromise = null;
        throw err;
      });
  }
  return handLandmarkerPromise;
}

async function startCamera() {
  if (!cameraStarted && preflightStreamPromise) {
    currentStream = await preflightStreamPromise;
    preflightStreamPromise = null;
  }

  if (cameraStarted || !currentStream || !currentStream.active) {
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
    }
    const constraints = {
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    };
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    preflightError = null;
  }
  video.srcObject = currentStream;
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
      };
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(video.error || new Error("Camera video could not be loaded"));
      };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }
  await video.play();
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
  const baseRgb = isPinching ? currentHandSkin.orbPinchRgb : currentHandSkin.orbIdleRgb;
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
// than a plain dot. Glyphs come from the current hand skin.
function drawOrbHalo(point, isPinching) {
  const glyphs = currentHandSkin.orbitGlyphs;
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
    ctx.fillText(glyphs[i % glyphs.length], x, y);
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
      rgb: currentHandSkin.dustRgbs[Math.floor(Math.random() * currentHandSkin.dustRgbs.length)],
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

// MediaPipe's 21-point hand skeleton, grouped as [wrist->finger] bone pairs
// (palm knuckles first so each finger chains off the previous one's base).
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];
const FINGERTIPS = [4, 8, 12, 16, 20];

// Which color a bone belongs to, by its first joint index — gives each
// finger its own hue (from the current hand skin) so the whole hand reads
// as a themed glove instead of a uniform wireframe.
function boneColor(fromIdx) {
  const [thumb, index, middle, ring, pinky] = currentHandSkin.boneColors;
  if (fromIdx <= 3) return thumb;
  if (fromIdx <= 8) return index;
  if (fromIdx <= 12) return middle;
  if (fromIdx <= 16) return ring;
  return pinky;
}

// Replaces a scattered dot-per-landmark view with a connected, glowing
// "fairy glove" outline — prettier than raw tracking dots and still reads
// each finger's position clearly enough to see what the hand is doing.
function drawHandSkeleton(landmarks) {
  const shimmer = 0.5 + 0.5 * Math.sin(performance.now() / 260);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [aIdx, bIdx] of HAND_CONNECTIONS) {
    const a = landmarks[aIdx];
    const b = landmarks[bIdx];
    const rgb = boneColor(aIdx);
    ctx.strokeStyle = `rgba(${rgb}, ${0.75 + shimmer * 0.25})`;
    ctx.shadowBlur = 8 + shimmer * 6;
    ctx.shadowColor = `rgba(${rgb}, 0.9)`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(mapX(a.x, overlay.width), a.y * overlay.height);
    ctx.lineTo(mapX(b.x, overlay.width), b.y * overlay.height);
    ctx.stroke();
  }

  for (const idx of FINGERTIPS) {
    const lm = landmarks[idx];
    const x = mapX(lm.x, overlay.width);
    const y = lm.y * overlay.height;
    const twinkle = 0.5 + 0.5 * Math.sin(performance.now() / 260 + idx);
    const rgb = currentHandSkin.tipGlowRgb;
    ctx.shadowBlur = 10 + twinkle * 6;
    ctx.shadowColor = `rgba(${rgb}, 0.95)`;
    ctx.fillStyle = `rgba(${rgb}, 0.95)`;
    ctx.beginPath();
    ctx.arc(x, y, 3 + twinkle * 1.5, 0, Math.PI * 2);
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
  // A fist with the thumb out reads as "thumb extended, everything else
  // curled" regardless of which way it's pointing — up vs down needs an
  // explicit direction check against the wrist, or a sideways/ambiguous
  // thumb would count as both (or neither, unreliably).
  const onlyThumbOut = fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky;
  const thumbVerticalOffset = wrist.y - thumbTip.y;
  const isThumbsUp = onlyThumbOut && thumbVerticalOffset > palmScale * THUMB_DIRECTION_MARGIN;
  const isPeaceSign = fingers.index && fingers.middle && !fingers.ring && !fingers.pinky;
  pinchDebugEl.textContent = `pinch: ${pinchRatio.toFixed(2)} ${isPinching ? "🤏" : ""} ${isThumbsUp ? "👍" : ""} ${isPeaceSign ? "✌️" : ""}`;

  // Anchored to the index fingertip rather than the thumb/index midpoint —
  // players aim by eye along their pointing finger, so a cursor sitting back
  // in the pinch gap reads as "not quite reaching" whatever it's aimed at.
  const pinchPoint = {
    x: mapX(indexTip.x, overlay.width),
    y: indexTip.y * overlay.height,
  };

  drawHandSkeleton(landmarks);

  drawMagicOrb(pinchPoint, isPinching);
  drawOrbHalo(pinchPoint, isPinching);
  spawnDust(pinchPoint.x, pinchPoint.y, isPinching ? 2 : 1);

  // Full-screen modals (summary, category picker, mode picker) sit on top
  // of the game board but the hand-tracking loop doesn't otherwise know
  // about them — without this guard a pinch/thumbs-up still lands on
  // whatever's underneath (submitBtn etc.), which is how the score kept
  // climbing after the session-summary screen came up.
  const modalOpen =
    !summaryOverlay.classList.contains("hidden") ||
    !categoryOverlay.classList.contains("hidden") ||
    !modeOverlay.classList.contains("hidden") ||
    !authOverlay.classList.contains("hidden") ||
    !setsListOverlay.classList.contains("hidden") ||
    !setDetailOverlay.classList.contains("hidden") ||
    !leaderboardOverlay.classList.contains("hidden") ||
    !questionFormOverlay.classList.contains("hidden") ||
    !translateOverlay.classList.contains("hidden");

  if (!modalOpen) {
    handleGesture(isPinching, pinchPoint);
    handleThumbsUpGesture(isThumbsUp);
    const roundActive = currentRound && startOverlay.classList.contains("hidden");
    handleZoomGesture(isPeaceSign && !isPinching && grabbedCardId === null && roundActive);
  }

  handleTranslateSelection(isPinching, pinchPoint);
}

// Finger-extension check: distance-based (tip vs. its own middle knuckle,
// both measured from the wrist) so it holds up across hand rotation,
// unlike an axis-aligned check. The margin is deliberately generous (not
// just "farther than the knuckle") so an ordinary half-open hand while
// reaching for a card doesn't read as "extended".
const FINGER_EXTEND_MARGIN = 0.28;

// How far the thumb tip has to sit above the wrist before a thumb-out fist
// counts as thumbs-up rather than sideways or ambiguous.
const THUMB_DIRECTION_MARGIN = 0.35;

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
//
// Submit needs a much longer hold than other buttons (THUMBS_UP_SUBMIT_HOLD_MS
// vs THUMBS_UP_HOLD_MS) so the fill progress on the button gives the player
// a visible beat to notice it's about to fire and pull their hand away if
// they want to fix their answer first — releasing early resets the hold
// with no submit, no separate second gesture required.
const THUMBS_UP_HOLD_MS = 350;
const THUMBS_UP_SUBMIT_HOLD_MS = 1800;
let thumbsUpHoldStart = null;
let thumbsUpFired = false;
let gameAudioContext = null;

function unlockGameAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!gameAudioContext) gameAudioContext = new AudioContextClass();
  if (gameAudioContext.state === "suspended") gameAudioContext.resume().catch(() => {});

  // A silent one-frame sound created during the initial Start Camera tap
  // unlocks Web Audio on mobile Safari/Chrome for later gesture-driven clicks.
  const unlockOscillator = gameAudioContext.createOscillator();
  const unlockGain = gameAudioContext.createGain();
  unlockGain.gain.value = 0.0001;
  unlockOscillator.connect(unlockGain);
  unlockGain.connect(gameAudioContext.destination);
  unlockOscillator.start();
  unlockOscillator.stop(gameAudioContext.currentTime + 0.01);
}

async function playSubmitSound() {
  unlockGameAudio();
  if (!gameAudioContext) return;
  if (gameAudioContext.state === "suspended") {
    try {
      await gameAudioContext.resume();
    } catch {
      return;
    }
  }
  if (gameAudioContext.state !== "running") return;

  const now = gameAudioContext.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((frequency, index) => {
    const oscillator = gameAudioContext.createOscillator();
    const gain = gameAudioContext.createGain();
    const startsAt = now + index * 0.065;
    const endsAt = startsAt + 0.42;

    oscillator.type = index === notes.length - 1 ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, startsAt);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.035, endsAt);
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(0.22, startsAt + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);

    oscillator.connect(gain);
    gain.connect(gameAudioContext.destination);
    oscillator.start(startsAt);
    oscillator.stop(endsAt);
  });
}

// Camera started, board showing, not looking at a result yet — the window
// where Submit/Skip are meaningful.
function isMidRound() {
  return startOverlay.classList.contains("hidden") && resultOverlay.classList.contains("hidden");
}

function boardFullyFilled() {
  return slots.length > 0 && slots.every((s) => s.cardId !== null);
}

// Whichever button a thumbs-up would currently click — shared by the fire
// logic and the hold-progress preview so they can never disagree about
// what's about to happen. Submit only becomes a target once every slot is
// filled — an empty-handed thumbs-up mid-round used to just pop the "Fill
// every slot first!" toast, which was easy to trigger by accident; now it
// does nothing at all.
function thumbsUpTarget() {
  if (roundIntroPinchable() && !startBtn.disabled) return startBtn;
  if (!resultOverlay.classList.contains("hidden")) return nextBtn;
  if (isMidRound() && boardFullyFilled()) return submitBtn;
  return null;
}

function handleThumbsUpGesture(isThumbsUp) {
  if (!isThumbsUp || isPinchingState || grabbedCardId !== null) {
    thumbsUpHoldStart = null;
    thumbsUpFired = false;
    submitBtn.style.setProperty("--thumb-hold-progress", "0");
    return;
  }
  if (thumbsUpHoldStart === null) thumbsUpHoldStart = performance.now();

  const target = thumbsUpTarget();
  const holdMs = target === submitBtn ? THUMBS_UP_SUBMIT_HOLD_MS : THUMBS_UP_HOLD_MS;
  const elapsed = performance.now() - thumbsUpHoldStart;
  submitBtn.style.setProperty("--thumb-hold-progress", target === submitBtn ? String(Math.min(1, elapsed / holdMs)) : "0");

  if (thumbsUpFired || elapsed < holdMs) return;
  thumbsUpFired = true;
  submitBtn.style.setProperty("--thumb-hold-progress", "0");

  if (target) target.click();
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
  if (isMidRound()) {
    skipBtn.classList.toggle("hover", pinchOverElement(pinchPoint, skipBtn));
  }
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
    if (isMidRound() && pinchOverElement(pinchPoint, skipBtn)) {
      skipBtn.click();
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
      spawnSparkles(nearest.x, nearest.y, 5);
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
      card.x = pinchPoint.x;
      card.y = pinchPoint.y;
      renderCard(card);
      updateDropTargetHighlight(card);
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

// Picks whichever slot a card rect overlaps *most* (by area), instead of the
// first slot found to overlap at all. On a small phone screen, tight slot
// spacing means a dragged card often straddles two neighboring slots at
// once — taking the first match in array order used to land the card in
// whichever slot happened to come first, not the one actually under the
// card. Falls back to the nearest slot center within one card-width if the
// card missed every slot outright (imprecise camera/finger tracking), so a
// near-miss still snaps in instead of bouncing back to the tray.
function findTargetSlot(cardRect) {
  let targetSlot = null;
  let bestOverlapArea = 0;
  for (const s of slots) {
    const slotRect = s.el.getBoundingClientRect();
    const overlapWidth = Math.min(cardRect.right, slotRect.right) - Math.max(cardRect.left, slotRect.left);
    const overlapHeight = Math.min(cardRect.bottom, slotRect.bottom) - Math.max(cardRect.top, slotRect.top);
    if (overlapWidth > 0 && overlapHeight > 0) {
      const area = overlapWidth * overlapHeight;
      if (area > bestOverlapArea) {
        bestOverlapArea = area;
        targetSlot = s;
      }
    }
  }

  if (!targetSlot) {
    const cardCenterX = (cardRect.left + cardRect.right) / 2;
    const cardCenterY = (cardRect.top + cardRect.bottom) / 2;
    let bestDist = Infinity;
    for (const s of slots) {
      const slotRect = s.el.getBoundingClientRect();
      const dx = cardCenterX - (slotRect.left + slotRect.right) / 2;
      const dy = cardCenterY - (slotRect.top + slotRect.bottom) / 2;
      const dist = Math.hypot(dx, dy);
      const snapRadius = Math.max(cardRect.width, slotRect.width);
      if (dist < snapRadius && dist < bestDist) {
        bestDist = dist;
        targetSlot = s;
      }
    }
  }
  return targetSlot;
}

// Highlights whichever slot a grabbed card is currently hovering, so the
// player can see where it'll land before letting go.
function updateDropTargetHighlight(card) {
  const target = card ? findTargetSlot(card.el.getBoundingClientRect()) : null;
  for (const s of slots) {
    s.el.dataset.dropTarget = s === target ? "true" : "false";
  }
}

function dropCard(card) {
  const targetSlot = findTargetSlot(card.el.getBoundingClientRect());
  updateDropTargetHighlight(null);

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

// Points for a correct answer: a flat base, a time bonus that tapers off
// the longer it takes (full bonus inside TIME_BONUS_WINDOW_MS, none past
// it), and a streak bonus that grows with consecutive corrects (capped, so
// a long streak doesn't dwarf the other two). currentStreak is the streak
// *including* this answer, so the first correct of a streak (streak = 1)
// gets no streak bonus yet — it takes two in a row to earn one.
const BASE_POINTS = 10;
const TIME_BONUS_MAX = 5;
const TIME_BONUS_WINDOW_MS = 15000;
const STREAK_BONUS_PER_LEVEL = 2;
const STREAK_BONUS_CAP = 10;

function pointsForCorrectAnswer() {
  const elapsedMs = performance.now() - roundStartTime;
  const timeBonus = Math.round(Math.max(0, 1 - elapsedMs / TIME_BONUS_WINDOW_MS) * TIME_BONUS_MAX);
  const streakBonus = Math.min(STREAK_BONUS_CAP, (currentStreak - 1) * STREAK_BONUS_PER_LEVEL);
  return { total: BASE_POINTS + timeBonus + streakBonus, timeBonus, streakBonus };
}

// Shared by every question kind's answer check: applies the score, advances
// the question counter, and shows the result overlay. Callers set
// resultWord (the "here's the right answer" reveal) themselves first, since
// that text differs by kind.
function finishRound(correct) {
  let breakdown = "";
  if (gameMode === "team") {
    if (correct) {
      if (teamForIndex(questionsAnswered) === "red") teamScoreRed++;
      else teamScoreBlue++;
    }
  } else if (correct) {
    soloCorrectCount++;
    currentStreak++;
    const points = pointsForCorrectAnswer();
    soloTotalPoints += points.total;
    const extras = [];
    if (points.timeBonus > 0) extras.push(`⏱️+${points.timeBonus}`);
    if (points.streakBonus > 0) extras.push(`🔥+${points.streakBonus}`);
    breakdown = ` +${points.total}pts${extras.length ? ` (${extras.join(" ")})` : ""}`;
  } else {
    currentStreak = 0;
  }
  questionsAnswered++;
  updateScoreHud();

  resultText.textContent = correct ? `Correct! 🎉${breakdown}` : "Not quite!";
  resultText.style.color = correct ? "#4caf50" : "#ff5252";
  nextBtn.textContent = questionsAnswered >= sessionLength ? "See Results 🏆" : "Next Word";
  resultOverlay.classList.remove("hidden");
}

// Handles both "spell" (letter tokens) and "sentence" (word tokens) rounds
// — same drag-into-slots board, just a different unit per card.
function checkSubmit() {
  const allFilled = slots.every((s) => s.cardId !== null);
  if (!allFilled) {
    resultText.textContent = "Fill every slot first!";
    resultText.style.color = "#ffb74d";
    resultWord.textContent = "";
    resultOverlay.classList.remove("hidden");
    return;
  }

  const answerTokens = currentRound.kind === "sentence" ? currentRound.answerWords : currentRound.word.split("");
  let correct = true;
  for (let i = 0; i < slots.length; i++) {
    const card = cards.find((c) => c.id === slots[i].cardId);
    if (card.letter !== answerTokens[i]) {
      correct = false;
      break;
    }
  }

  resultWord.textContent =
    currentRound.kind === "sentence" ? currentRound.answerWords.join(" ") : currentRound.word.toUpperCase();
  finishRound(correct);
}

// Counts the same as a wrong answer (reveals the correct answer, advances
// the session) — skipping isn't a free pass, it's for "I don't want to
// guess this one," same as leaving it wrong would be.
function skipQuestion() {
  resultText.textContent = "Skipped";
  resultText.style.color = "#ffb74d";
  resultWord.textContent =
    currentRound.kind === "sentence" ? currentRound.answerWords.join(" ") : currentRound.word.toUpperCase();
  finishRound(false);
}

submitBtn.addEventListener("click", () => {
  playSubmitSound();
  checkSubmit();
});
skipBtn.addEventListener("click", skipQuestion);
nextBtn.addEventListener("click", () => {
  resultOverlay.classList.add("hidden");
  if (questionsAnswered >= sessionLength) {
    showSummary();
    return;
  }
  showRoundIntro(pickNextQuestion());
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
  updateTeamTurnBanner();
  startOverlay.classList.remove("hidden");
}

function beginRound() {
  startOverlay.classList.add("hidden");
  if (currentRound.kind === "translate") {
    beginTranslateRound();
    return;
  }
  translateOverlay.classList.add("hidden");
  setupRound(currentRound);
  renderVisual(promptThumb, currentRound);
  promptThumb.classList.remove("hidden");
  instructionHint.classList.remove("hidden");
}

function beginTranslateRound() {
  clearBoard();
  promptThumb.classList.add("hidden");
  instructionHint.classList.add("hidden");

  const isThEn = currentRound.direction === "th-en";
  translateDirectionPill.textContent = isThEn ? "🇹🇭 → 🇬🇧 Pick the right translation" : "🇬🇧 → 🇹🇭 เลือกคำแปลที่ถูก";
  translatePromptHint.textContent = isThEn ? "What does this mean?" : "ประโยคนี้แปลว่าอะไร";
  translatePromptText.textContent = currentRound.prompt;
  currentRound.options.forEach((opt, i) => {
    translateOptionEls[i].querySelector(".option-text").textContent = opt;
    translateOptionEls[i].style.setProperty("--hold-progress", "0");
  });

  translateOverlay.classList.remove("hidden");
}

function selectTranslateAnswer(index) {
  const correct = index === currentRound.correctIndex;
  resultWord.textContent = currentRound.options[currentRound.correctIndex];
  translateOverlay.classList.add("hidden");
  finishRound(correct);
}

// Pinch-and-hold-to-select: dwelling the pinch cursor over an option while
// actively pinching fills a progress bar on that button; releasing or
// drifting off resets it. Chosen over a tap/click because this game is
// hands-free — there's no reliable "click" gesture, only sustained intent.
const TRANSLATE_HOLD_MS = 650;
let translateHoldIndex = null;
let translateHoldStart = null;

function handleTranslateSelection(isPinching, pinchPoint) {
  if (translateOverlay.classList.contains("hidden")) return;

  let hoveredIndex = null;
  for (let i = 0; i < translateOptionEls.length; i++) {
    translateOptionEls[i].classList.toggle("hover", pinchOverElement(pinchPoint, translateOptionEls[i], 10));
    if (pinchOverElement(pinchPoint, translateOptionEls[i], 10)) hoveredIndex = i;
  }

  if (!isPinching || hoveredIndex === null) {
    translateHoldIndex = null;
    translateHoldStart = null;
    for (const el of translateOptionEls) el.style.setProperty("--hold-progress", "0");
    return;
  }

  if (hoveredIndex !== translateHoldIndex) {
    translateHoldIndex = hoveredIndex;
    translateHoldStart = performance.now();
    for (const el of translateOptionEls) el.style.setProperty("--hold-progress", "0");
  }

  const progress = Math.min(1, (performance.now() - translateHoldStart) / TRANSLATE_HOLD_MS);
  translateOptionEls[hoveredIndex].style.setProperty("--hold-progress", String(progress));

  if (progress >= 1) {
    translateHoldIndex = null;
    translateHoldStart = null;
    selectTranslateAnswer(hoveredIndex);
  }
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
  // A failed page-load preflight is retried here from the user's click.
  // Must fire synchronously inside the click handler (before any await) or
  // browsers drop the user-gesture and refuse the fullscreen request.
  unlockGameAudio();
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
      try {
        await ensureHandLandmarker();
      } catch (err) {
        statusEl.textContent = `Model load error: ${err.message}`;
        startBtn.disabled = false;
        return;
      }
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

async function loadPublicQuestionSets() {
  try {
    const res = await fetch("/api/public-question-sets");
    if (!res.ok) throw new Error("Could not load public sets");
    const publicSets = await res.json();
    publicSetsList.innerHTML = "";
    for (const set of publicSets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "public-set-btn";
      button.disabled = set.questions.length === 0;
      button.innerHTML = `<span class="public-set-name"></span><span class="public-set-count"></span>`;
      button.querySelector(".public-set-name").textContent = set.name;
      button.querySelector(".public-set-count").textContent = `${set.questions.length} questions · PLAY ▶`;
      button.addEventListener("click", () => playSet(set));
      publicSetsList.appendChild(button);
    }
    publicSetsSection.classList.toggle("hidden", publicSets.length === 0);
  } catch (err) {
    console.error("Failed to load public question sets:", err);
    publicSetsSection.classList.add("hidden");
  }
}
loadPublicQuestionSets();

categoryPlayBtn.addEventListener("click", () => {
  categoryOverlay.classList.add("hidden");
  sessionSource = "pool";
  sessionLength = ROUNDS_PER_SESSION_DEFAULT;
  resetSession();
  showRoundIntro(pickNextQuestion());
});

categoriesBtn.addEventListener("click", () => {
  categoryOverlay.classList.remove("hidden");
});

// Shuffles a teacher set's questions into play order, sizes the session to
// however many questions it actually has, and starts the first one.
function startTeacherSetSession() {
  teacherSetQueue = shuffle(activeTeacherSet.questions);
  sessionLength = teacherSetQueue.length;
  resetSession();
  showRoundIntro(pickNextQuestion());
}

// Mode-select is shared by both entry paths: picking a mode after tapping
// "Play" on a teacher set jumps straight into that set (skipping the
// built-in category picker, since the content is already chosen); picking
// a mode any other way continues on to the category picker as before.
modeSoloBtn.addEventListener("click", () => {
  gameMode = "solo";
  modeOverlay.classList.add("hidden");
  if (sessionSource === "teacherSet" && activeTeacherSet) {
    startTeacherSetSession();
  } else {
    sessionSource = "pool";
    categoryOverlay.classList.remove("hidden");
  }
});

modeTeamBtn.addEventListener("click", () => {
  gameMode = "team";
  modeOverlay.classList.add("hidden");
  if (sessionSource === "teacherSet" && activeTeacherSet) {
    startTeacherSetSession();
  } else {
    sessionSource = "pool";
    categoryOverlay.classList.remove("hidden");
  }
});

playAgainBtn.addEventListener("click", () => {
  summaryOverlay.classList.add("hidden");
  if (sessionSource === "teacherSet" && activeTeacherSet) {
    startTeacherSetSession();
  } else {
    sessionLength = ROUNDS_PER_SESSION_DEFAULT;
    resetSession();
    showRoundIntro(pickNextQuestion());
  }
});

newSetupBtn.addEventListener("click", () => {
  summaryOverlay.classList.add("hidden");
  sessionSource = "pool";
  activeTeacherSet = null;
  resetSession();
  modeOverlay.classList.remove("hidden");
});

// --- Question sets (teacher-authored) -------------------------------------
// Named packs of up to 10 questions live on the server (data/question-
// sets.json + uploads/custom-words/*.jpg for spell-question photos), not
// localStorage, so they survive a cleared browser cache and are the same
// for every device hitting this server.
//
// NOTE: the login below is a client-side speed bump (keeps curious kids
// from wandering into the editor), not real security — the credentials are
// visible to anyone who reads this file. Fine for gating a content-editor
// screen in a classroom game; would not be fine for anything actually
// sensitive.
const AUTH_USER = "songsong";
const AUTH_PASS = "2222222222222222222222";
const MAX_QUESTIONS_PER_SET = 30;

let questionSets = [];
let currentSetId = null;
let editingQuestionId = null; // null while adding a new question
let questionFormKind = "spell"; // "spell" | "translate" — which sub-form is showing
let customPhotoDataUrl = null;

// Re-triggerable "✅ Saved!" toast — removing and re-adding the class (after
// a reflow) restarts the CSS animation even if a save lands mid-toast from
// a previous one.
function showSavedToast() {
  savedToast.classList.remove("show");
  savedToast.classList.remove("hidden");
  void savedToast.offsetWidth;
  savedToast.classList.add("show");
}

function getCurrentSet() {
  return questionSets.find((s) => s.id === currentSetId);
}

async function loadQuestionSets() {
  try {
    const res = await fetch("/api/question-sets");
    questionSets = await res.json();
  } catch (err) {
    console.error("Failed to load question sets:", err);
    questionSets = [];
  }
  renderSetsList();
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const maxDim = 480;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function updateCustomPreview() {
  customPreview.innerHTML = "";
  if (customPhotoDataUrl) {
    const img = document.createElement("img");
    img.src = customPhotoDataUrl;
    customPreview.appendChild(img);
  }
}

customPhotoInput.addEventListener("change", async () => {
  const file = customPhotoInput.files[0];
  if (!file) return;
  customPhotoDataUrl = await compressImageFile(file);
  updateCustomPreview();
});

function setDirectionTab(direction) {
  dirThEnBtn.classList.toggle("active", direction === "th-en");
  dirEnThBtn.classList.toggle("active", direction === "en-th");
}
dirThEnBtn.addEventListener("click", () => setDirectionTab("th-en"));
dirEnThBtn.addEventListener("click", () => setDirectionTab("en-th"));

function currentDirection() {
  return dirEnThBtn.classList.contains("active") ? "en-th" : "th-en";
}

function setSentDirectionTab(direction) {
  sentDirThEnBtn.classList.toggle("active", direction === "th-en");
  sentDirEnThBtn.classList.toggle("active", direction === "en-th");
}
sentDirThEnBtn.addEventListener("click", () => setSentDirectionTab("th-en"));
sentDirEnThBtn.addEventListener("click", () => setSentDirectionTab("en-th"));

function currentSentDirection() {
  return sentDirEnThBtn.classList.contains("active") ? "en-th" : "th-en";
}

// Explicit card-count control (min 2, max 8): the teacher picks the number
// of cards first, then gets exactly that many individual word inputs —
// no implicit "type a sentence and we split it" step.
const SENT_CARDS_MIN = 2;
const SENT_CARDS_MAX = 8;
let sentCardCount = 3;
let sentCardValues = ["", "", ""];

function renderSentCardInputs() {
  sentCardCountLabel.textContent = `${sentCardCount} card${sentCardCount === 1 ? "" : "s"}`;
  sentCardMinusBtn.disabled = sentCardCount <= SENT_CARDS_MIN;
  sentCardPlusBtn.disabled = sentCardCount >= SENT_CARDS_MAX;

  sentCardInputs.innerHTML = "";
  for (let i = 0; i < sentCardCount; i++) {
    const row = document.createElement("div");
    row.className = "sent-card-row";

    const badge = document.createElement("div");
    badge.className = "sent-card-badge";
    badge.textContent = i + 1;
    row.appendChild(badge);

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 30;
    input.autocomplete = "off";
    input.placeholder = `Word for card ${i + 1}`;
    input.value = sentCardValues[i] || "";
    input.addEventListener("input", () => {
      sentCardValues[i] = input.value;
    });
    row.appendChild(input);

    sentCardInputs.appendChild(row);
  }
}

function setSentCardCount(count) {
  const clamped = Math.max(SENT_CARDS_MIN, Math.min(SENT_CARDS_MAX, count));
  const nextValues = [];
  for (let i = 0; i < clamped; i++) nextValues.push(sentCardValues[i] || "");
  sentCardCount = clamped;
  sentCardValues = nextValues;
  renderSentCardInputs();
}

sentCardMinusBtn.addEventListener("click", () => setSentCardCount(sentCardCount - 1));
sentCardPlusBtn.addEventListener("click", () => setSentCardCount(sentCardCount + 1));

// --- Set list screen -------------------------------------------------------
function renderSetsList() {
  setsList.innerHTML = "";
  for (const set of questionSets) {
    const row = document.createElement("div");
    row.className = "set-row";

    const name = document.createElement("div");
    name.className = "set-name";
    name.textContent = set.name;
    row.appendChild(name);

    const count = document.createElement("div");
    count.className = "set-count";
    count.textContent = `${set.questions.length}/${MAX_QUESTIONS_PER_SET}`;
    row.appendChild(count);

    const visibilityBtn = document.createElement("button");
    visibilityBtn.type = "button";
    visibilityBtn.className = `visibility-btn ${set.isPublic ? "is-public" : "is-private"}`;
    visibilityBtn.textContent = set.isPublic ? "🌐 Public" : "🔒 Private";
    visibilityBtn.title = set.isPublic ? "Visible on the player home screen" : "Only teachers can see this set";
    visibilityBtn.addEventListener("click", () => updateSetVisibility(set, visibilityBtn));
    row.appendChild(visibilityBtn);

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "play-btn";
    playBtn.textContent = "▶️ Play";
    playBtn.disabled = set.questions.length === 0;
    playBtn.addEventListener("click", () => playSet(set));
    row.appendChild(playBtn);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "open-btn";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => openSet(set.id));
    row.appendChild(openBtn);

    const leaderboardBtn = document.createElement("button");
    leaderboardBtn.type = "button";
    leaderboardBtn.className = "leaderboard-btn";
    leaderboardBtn.textContent = "🏆";
    leaderboardBtn.addEventListener("click", () => showLeaderboard(set));
    row.appendChild(leaderboardBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "delete-btn";
    delBtn.textContent = "🗑️";
    delBtn.addEventListener("click", () => deleteSet(set.id, set.name));
    row.appendChild(delBtn);

    setsList.appendChild(row);
  }
}

async function updateSetVisibility(set, button) {
  button.disabled = true;
  setsListError.classList.add("hidden");
  try {
    const res = await fetch(`/api/question-sets/${set.id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: !set.isPublic }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not change visibility.");
    questionSets = data;
    renderSetsList();
    await loadPublicQuestionSets();
    showSavedToast();
  } catch (err) {
    setsListError.textContent = err.message || "Network error — try again.";
    setsListError.classList.remove("hidden");
    button.disabled = false;
  }
}

createSetBtn.addEventListener("click", async () => {
  setsListError.classList.add("hidden");
  const name = newSetNameInput.value.trim();
  if (!name) {
    setsListError.textContent = "Give the set a name.";
    setsListError.classList.remove("hidden");
    return;
  }
  try {
    const res = await fetch("/api/question-sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setsListError.textContent = data.error || "Something went wrong.";
      setsListError.classList.remove("hidden");
      return;
    }
    questionSets = data;
    renderSetsList();
    newSetNameInput.value = "";
    showSavedToast();
  } catch (err) {
    setsListError.textContent = "Network error — try again.";
    setsListError.classList.remove("hidden");
  }
});

async function deleteSet(id, name) {
  if (!confirm(`Delete the set "${name}"? This can't be undone.`)) return;
  try {
    const res = await fetch(`/api/question-sets/${id}`, { method: "DELETE" });
    questionSets = await res.json();
    renderSetsList();
  } catch (err) {
    console.error("Failed to delete set:", err);
  }
}

setsListBackBtn.addEventListener("click", () => {
  setsListOverlay.classList.add("hidden");
  categoryOverlay.classList.remove("hidden");
});

// The leaderboard is a chronological record-history, not a ranked top-10 —
// each row was, at the time it was set, the best score anyone had gotten
// on this set. The most recent row is always the current record holder.
async function showLeaderboard(set) {
  leaderboardTitle.textContent = `🏆 ${set.name}`;
  leaderboardList.textContent = "Loading…";
  setsListOverlay.classList.add("hidden");
  leaderboardOverlay.classList.remove("hidden");
  try {
    const res = await fetch(`/api/question-sets/${set.id}/leaderboard`);
    const board = await res.json();
    leaderboardList.innerHTML = "";
    if (!board.length) {
      leaderboardList.textContent = "No records yet — be the first!";
      return;
    }
    [...board].reverse().forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = "leaderboard-row";

      const badge = document.createElement("div");
      badge.className = "leaderboard-badge";
      badge.textContent = i === 0 ? "👑" : "🕘";
      row.appendChild(badge);

      const name = document.createElement("div");
      name.className = "leaderboard-name";
      name.textContent = entry.name;
      row.appendChild(name);

      const score = document.createElement("div");
      score.className = "leaderboard-score";
      score.textContent = `🌟 ${entry.score} pts`;
      row.appendChild(score);

      const date = document.createElement("div");
      date.className = "leaderboard-date";
      date.textContent = new Date(entry.createdAt).toLocaleDateString();
      row.appendChild(date);

      leaderboardList.appendChild(row);
    });
  } catch (err) {
    leaderboardList.textContent = "Network error — try again.";
  }
}

leaderboardBackBtn.addEventListener("click", () => {
  leaderboardOverlay.classList.add("hidden");
  setsListOverlay.classList.remove("hidden");
});

// --- Set detail screen -------------------------------------------------------
function openSet(id) {
  currentSetId = id;
  renderSetQuestionsList();
  renameSetRow.classList.add("hidden");
  setsListOverlay.classList.add("hidden");
  setDetailOverlay.classList.remove("hidden");
}

// Public sets can launch from the home screen; private sets reach this same
// path from the teacher-only management screen.
function playSet(set) {
  sessionSource = "teacherSet";
  activeTeacherSet = set;
  categoryOverlay.classList.add("hidden");
  setsListOverlay.classList.add("hidden");
  setDetailOverlay.classList.add("hidden");
  questionFormOverlay.classList.add("hidden");
  modeOverlay.classList.remove("hidden");
}

renameSetBtn.addEventListener("click", () => {
  const set = getCurrentSet();
  if (!set) return;
  renameSetInput.value = set.name;
  renameSetRow.classList.remove("hidden");
});

cancelRenameBtn.addEventListener("click", () => {
  renameSetRow.classList.add("hidden");
});

saveRenameBtn.addEventListener("click", async () => {
  const set = getCurrentSet();
  if (!set) return;
  const name = renameSetInput.value.trim();
  if (!name) return;
  try {
    const res = await fetch(`/api/question-sets/${set.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) return;
    questionSets = data;
    renderSetQuestionsList();
    renameSetRow.classList.add("hidden");
    showSavedToast();
  } catch (err) {
    console.error("Failed to rename set:", err);
  }
});

function questionSummary(q) {
  if (q.kind === "translate" || q.kind === "sentence") {
    const arrow = q.direction === "th-en" ? "🇹🇭→🇬🇧" : "🇬🇧→🇹🇭";
    return `${arrow} ${q.prompt}`;
  }
  return q.word.toUpperCase();
}

function renderSetQuestionsList() {
  const set = getCurrentSet();
  if (!set) return;
  setDetailTitle.textContent = `${set.name} (${set.questions.length}/${MAX_QUESTIONS_PER_SET})`;
  setQuestionsList.innerHTML = "";

  for (const q of set.questions) {
    const row = document.createElement("div");
    row.className = "question-row";

    const badge = document.createElement("div");
    badge.className = "kind-badge";
    badge.textContent = q.kind === "translate" ? "🌐" : q.kind === "sentence" ? "🧩" : "📝";
    row.appendChild(badge);

    const summary = document.createElement("div");
    summary.className = "q-summary";
    summary.textContent = questionSummary(q);
    row.appendChild(summary);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edit-btn";
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => openQuestionForm(q.kind, q));
    row.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "delete-btn";
    delBtn.textContent = "🗑️";
    delBtn.addEventListener("click", () => deleteQuestion(q.id));
    row.appendChild(delBtn);

    setQuestionsList.appendChild(row);
  }

  const full = set.questions.length >= MAX_QUESTIONS_PER_SET;
  addQuestionBtn.disabled = full;
  newQuestionKindSelect.disabled = full;
}

async function deleteQuestion(qid) {
  const set = getCurrentSet();
  if (!set) return;
  try {
    const res = await fetch(`/api/question-sets/${set.id}/questions/${qid}`, { method: "DELETE" });
    const list = await res.json();
    questionSets = list;
    renderSetQuestionsList();
  } catch (err) {
    console.error("Failed to delete question:", err);
  }
}

addQuestionBtn.addEventListener("click", () => openQuestionForm(newQuestionKindSelect.value, null));

setDetailBackBtn.addEventListener("click", () => {
  setDetailOverlay.classList.add("hidden");
  renderSetsList(); // question counts may have changed
  setsListOverlay.classList.remove("hidden");
});

// --- Question form (add or edit, spell or translate) ------------------------
const QUESTION_KIND_LABELS = {
  spell: "Spelling Question",
  translate: "Translation Question",
  sentence: "Sentence Builder Question",
};

function openQuestionForm(kind, existingQuestion) {
  questionFormKind = kind;
  editingQuestionId = existingQuestion ? existingQuestion.id : null;
  questionFormTitle.textContent = (existingQuestion ? "Edit " : "Add ") + QUESTION_KIND_LABELS[kind];
  questionFormError.classList.add("hidden");

  spellFormFields.classList.toggle("hidden", kind !== "spell");
  translateFormFields.classList.toggle("hidden", kind !== "translate");
  sentenceFormFields.classList.toggle("hidden", kind !== "sentence");

  if (kind === "spell") {
    qSpellWordInput.value = existingQuestion ? existingQuestion.word : "";
    customPhotoDataUrl = existingQuestion && existingQuestion.visualType === "photo" ? existingQuestion.visualValue : null;
    updateCustomPreview();
  } else if (kind === "translate") {
    setDirectionTab(existingQuestion ? existingQuestion.direction : "th-en");
    qPromptInput.value = existingQuestion ? existingQuestion.prompt : "";
    for (let i = 0; i < 4; i++) {
      qOptionInputs[i].value = existingQuestion ? existingQuestion.options[i] : "";
    }
    qCorrectRadios[existingQuestion ? existingQuestion.correctIndex : 0].checked = true;
  } else {
    setSentDirectionTab(existingQuestion ? existingQuestion.direction : "th-en");
    qSentPromptInput.value = existingQuestion ? existingQuestion.prompt : "";
    if (existingQuestion) {
      sentCardCount = existingQuestion.answerWords.length;
      sentCardValues = [...existingQuestion.answerWords];
    } else {
      sentCardCount = 3;
      sentCardValues = ["", "", ""];
    }
    renderSentCardInputs();
  }

  setDetailOverlay.classList.add("hidden");
  questionFormOverlay.classList.remove("hidden");
}

function closeQuestionForm() {
  questionFormOverlay.classList.add("hidden");
  setDetailOverlay.classList.remove("hidden");
}

cancelQuestionBtn.addEventListener("click", closeQuestionForm);

saveQuestionBtn.addEventListener("click", async () => {
  const set = getCurrentSet();
  if (!set) return;
  questionFormError.classList.add("hidden");

  let body;
  if (questionFormKind === "spell") {
    const word = qSpellWordInput.value.trim();
    if (!/^[a-zA-Z]{2,12}$/.test(word)) {
      questionFormError.textContent = "Word must be 2-12 letters only.";
      questionFormError.classList.remove("hidden");
      return;
    }
    if (!customPhotoDataUrl) {
      questionFormError.textContent = "Choose a photo first.";
      questionFormError.classList.remove("hidden");
      return;
    }
    body = { kind: "spell", word, visualType: "photo", visualValue: customPhotoDataUrl };
  } else if (questionFormKind === "translate") {
    const prompt = qPromptInput.value.trim();
    const options = qOptionInputs.map((el) => el.value.trim());
    if (!prompt) {
      questionFormError.textContent = "Question sentence can't be empty.";
      questionFormError.classList.remove("hidden");
      return;
    }
    if (options.some((o) => !o)) {
      questionFormError.textContent = "Fill in all 4 answer choices.";
      questionFormError.classList.remove("hidden");
      return;
    }
    const correctIndex = qCorrectRadios.findIndex((r) => r.checked);
    body = { kind: "translate", direction: currentDirection(), prompt, options, correctIndex };
  } else {
    const prompt = qSentPromptInput.value.trim();
    const answerWords = sentCardValues.map((w) => w.trim());
    if (!prompt) {
      questionFormError.textContent = "Question sentence can't be empty.";
      questionFormError.classList.remove("hidden");
      return;
    }
    if (answerWords.some((w) => !w)) {
      questionFormError.textContent = "Fill in a word for every card.";
      questionFormError.classList.remove("hidden");
      return;
    }
    body = { kind: "sentence", direction: currentSentDirection(), prompt, answerWords };
  }

  saveQuestionBtn.disabled = true;
  try {
    const url = editingQuestionId
      ? `/api/question-sets/${set.id}/questions/${editingQuestionId}`
      : `/api/question-sets/${set.id}/questions`;
    const res = await fetch(url, {
      method: editingQuestionId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      questionFormError.textContent = data.error || "Something went wrong.";
      questionFormError.classList.remove("hidden");
      return;
    }
    questionSets = data;
    renderSetQuestionsList();
    closeQuestionForm();
    showSavedToast();
  } catch (err) {
    questionFormError.textContent = "Network error — try again.";
    questionFormError.classList.remove("hidden");
  } finally {
    saveQuestionBtn.disabled = false;
  }
});

// --- Entry point + login gate -----------------------------------------------
manageWordsBtn.addEventListener("click", () => {
  if (localStorage.getItem("wordsAuthed") === "1") {
    categoryOverlay.classList.add("hidden");
    loadQuestionSets();
    setsListOverlay.classList.remove("hidden");
    return;
  }
  authUser.value = "";
  authPass.value = "";
  authError.classList.add("hidden");
  authOverlay.classList.remove("hidden");
});

authSubmitBtn.addEventListener("click", () => {
  if (authUser.value === AUTH_USER && authPass.value === AUTH_PASS) {
    localStorage.setItem("wordsAuthed", "1");
    authOverlay.classList.add("hidden");
    categoryOverlay.classList.add("hidden");
    loadQuestionSets();
    setsListOverlay.classList.remove("hidden");
  } else {
    authError.classList.remove("hidden");
  }
});

authCancelBtn.addEventListener("click", () => {
  authOverlay.classList.add("hidden");
});

[authUser, authPass].forEach((input) => {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") authSubmitBtn.click();
  });
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

  // Re-show the question already in progress rather than drawing a new
  // one — Exit is "stop the camera for a sec," not "skip this question,"
  // and for a teacher set, drawing a new one would silently consume the
  // next item in the queue.
  showRoundIntro(currentRound || pickNextQuestion());
}

exitBtn.addEventListener("click", exitGame);

ensureHandLandmarker().catch((err) => {
  statusEl.textContent = `Model load error: ${err.message}`;
});
