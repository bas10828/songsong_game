// Zero-dependency static file server. No build step — serves this
// directory as-is, the same way the target host will. Also exposes a
// tiny JSON API (no framework) for teacher-authored "question sets":
// named packs of up to 30 questions (spell-the-word or pick-the-
// translation), full CRUD on both the set and its nested questions.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const QUESTION_SETS_FILE = path.join(DATA_DIR, "question-sets.json");
const UPLOADS_DIR = path.join(ROOT, "uploads", "custom-words");
const MAX_QUESTIONS_PER_SET = 30;
// Bumped once per process start (i.e. every deploy/restart) and appended
// as a query string to js/main.js in served HTML. Guarantees a fresh URL
// after each deploy so CDN/browser caches of the old main.js can't get
// served alongside a newer HTML — the two must always be fetched together.
const BUILD_VERSION = Date.now();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(QUESTION_SETS_FILE)) fs.writeFileSync(QUESTION_SETS_FILE, "[]");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".m4a": "audio/mp4",
};

function respondJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function loadSets() {
  try {
    return JSON.parse(fs.readFileSync(QUESTION_SETS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveSets(list) {
  fs.writeFileSync(QUESTION_SETS_FILE, JSON.stringify(list, null, 2));
}

function sanitizeSetName(raw) {
  const name = String(raw || "").trim().slice(0, 40);
  return name.length ? name : null;
}

// Letters only, no spaces/numbers — matches the letter-card spelling board.
function sanitizeWord(raw) {
  const word = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  if (word.length < 2 || word.length > 12) return null;
  return word;
}

// Resolves the visual half of a "spell" question from a request body.
// On edit, a photo value that's already an "/uploads/..." path (rather
// than a fresh data: URL) means the teacher didn't replace the photo, so
// it's kept as-is instead of being re-decoded.
function resolveVisual(body, questionId) {
  if (body.visualType === "photo") {
    if (typeof body.visualValue === "string" && body.visualValue.startsWith("/uploads/custom-words/")) {
      return { visualType: "photo", visualValue: body.visualValue, wroteNewFile: false };
    }
    const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(body.visualValue || "");
    if (!match) return null;
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 3 * 1024 * 1024) return null;
    const filename = `${questionId}-${Date.now()}.jpg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
    return { visualType: "photo", visualValue: `/uploads/custom-words/${filename}`, wroteNewFile: true };
  }
  const emoji = String(body.visualValue || "").trim().slice(0, 8);
  if (!emoji) return null;
  return { visualType: "emoji", visualValue: emoji, wroteNewFile: false };
}

function deleteOldPhotoIfReplaced(oldQuestion, newVisual) {
  if (
    oldQuestion &&
    oldQuestion.kind === "spell" &&
    oldQuestion.visualType === "photo" &&
    oldQuestion.visualValue &&
    oldQuestion.visualValue !== newVisual.visualValue
  ) {
    fs.unlink(path.join(ROOT, oldQuestion.visualValue), () => {});
  }
}

function deletePhotoIfAny(question) {
  if (question && question.kind === "spell" && question.visualType === "photo" && question.visualValue) {
    fs.unlink(path.join(ROOT, question.visualValue), () => {});
  }
}

// Builds a validated question object from a request body, or returns
// { error } if something's wrong. `id` is reused on edit so a replaced
// photo file can be named deterministically-ish (id + timestamp).
function sanitizeDirection(raw) {
  return raw === "en-th" ? "en-th" : raw === "th-en" ? "th-en" : null;
}

function buildQuestion(body, id) {
  if (body.kind === "translate") {
    const direction = sanitizeDirection(body.direction);
    if (!direction) return { error: "Pick a translation direction." };
    const prompt = String(body.prompt || "").trim().slice(0, 200);
    if (!prompt) return { error: "Prompt sentence can't be empty." };
    const options = Array.isArray(body.options) ? body.options.map((o) => String(o || "").trim().slice(0, 80)) : [];
    if (options.length !== 4 || options.some((o) => !o)) return { error: "Need exactly 4 filled-in options." };
    const correctIndex = Number(body.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      return { error: "Pick which option is correct." };
    }
    return { id, kind: "translate", direction, prompt, options, correctIndex };
  }

  if (body.kind === "sentence") {
    const direction = sanitizeDirection(body.direction);
    if (!direction) return { error: "Pick a translation direction." };
    const prompt = String(body.prompt || "").trim().slice(0, 200);
    if (!prompt) return { error: "Prompt sentence can't be empty." };
    const answerWords = Array.isArray(body.answerWords)
      ? body.answerWords.map((w) => String(w || "").trim().slice(0, 30)).filter(Boolean)
      : [];
    if (answerWords.length < 2 || answerWords.length > 8) {
      return { error: "Answer needs 2-8 words." };
    }
    return { id, kind: "sentence", direction, prompt, answerWords };
  }

  // default / "spell"
  const word = sanitizeWord(body.word);
  if (!word) return { error: "Word must be 2-12 letters." };
  const visual = resolveVisual(body, id);
  if (!visual) return { error: body.visualType === "photo" ? "Invalid or too-large photo." : "Pick an emoji first." };
  return { id, kind: "spell", word, visualType: visual.visualType, visualValue: visual.visualValue, wroteNewFile: visual.wroteNewFile };
}

async function handleListSets(res) {
  respondJson(res, 200, loadSets());
}

async function handleCreateSet(req, res) {
  try {
    const body = await readJsonBody(req, 16 * 1024);
    const name = sanitizeSetName(body.name);
    if (!name) return respondJson(res, 400, { error: "Give the set a name." });
    const list = loadSets();
    const set = { id: crypto.randomUUID(), name, questions: [] };
    list.push(set);
    saveSets(list);
    respondJson(res, 200, list);
  } catch (err) {
    respondJson(res, 400, { error: err.message });
  }
}

async function handleRenameSet(id, req, res) {
  try {
    const body = await readJsonBody(req, 16 * 1024);
    const name = sanitizeSetName(body.name);
    if (!name) return respondJson(res, 400, { error: "Give the set a name." });
    const list = loadSets();
    const set = list.find((s) => s.id === id);
    if (!set) return respondJson(res, 404, { error: "Set not found." });
    set.name = name;
    saveSets(list);
    respondJson(res, 200, list);
  } catch (err) {
    respondJson(res, 400, { error: err.message });
  }
}

function handleDeleteSet(id, res) {
  const list = loadSets();
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return respondJson(res, 404, { error: "Set not found." });
  const [removed] = list.splice(idx, 1);
  for (const q of removed.questions) deletePhotoIfAny(q);
  saveSets(list);
  respondJson(res, 200, list);
}

async function handleAddQuestion(setId, req, res) {
  try {
    const body = await readJsonBody(req, 4 * 1024 * 1024); // 4MB cap (photo)
    const list = loadSets();
    const set = list.find((s) => s.id === setId);
    if (!set) return respondJson(res, 404, { error: "Set not found." });
    if (set.questions.length >= MAX_QUESTIONS_PER_SET) {
      return respondJson(res, 400, { error: `A set can only hold ${MAX_QUESTIONS_PER_SET} questions.` });
    }

    const built = buildQuestion(body, crypto.randomUUID());
    if (built.error) return respondJson(res, 400, { error: built.error });
    delete built.wroteNewFile;

    set.questions.push(built);
    saveSets(list);
    respondJson(res, 200, list);
  } catch (err) {
    respondJson(res, 400, { error: err.message });
  }
}

async function handleEditQuestion(setId, qid, req, res) {
  try {
    const body = await readJsonBody(req, 4 * 1024 * 1024);
    const list = loadSets();
    const set = list.find((s) => s.id === setId);
    if (!set) return respondJson(res, 404, { error: "Set not found." });
    const idx = set.questions.findIndex((q) => q.id === qid);
    if (idx === -1) return respondJson(res, 404, { error: "Question not found." });

    const built = buildQuestion(body, qid);
    if (built.error) return respondJson(res, 400, { error: built.error });

    if (built.kind === "spell") deleteOldPhotoIfReplaced(set.questions[idx], built);
    else deletePhotoIfAny(set.questions[idx]); // switched away from a spell+photo question
    delete built.wroteNewFile;

    set.questions[idx] = built;
    saveSets(list);
    respondJson(res, 200, list);
  } catch (err) {
    respondJson(res, 400, { error: err.message });
  }
}

function handleDeleteQuestion(setId, qid, res) {
  const list = loadSets();
  const set = list.find((s) => s.id === setId);
  if (!set) return respondJson(res, 404, { error: "Set not found." });
  const idx = set.questions.findIndex((q) => q.id === qid);
  if (idx === -1) return respondJson(res, 404, { error: "Question not found." });
  const [removed] = set.questions.splice(idx, 1);
  deletePhotoIfAny(removed);
  saveSets(list);
  respondJson(res, 200, list);
}

const server = http.createServer((req, res) => {
  const rawPath = decodeURIComponent(req.url.split("?")[0]);
  const parts = rawPath.split("/").filter(Boolean); // e.g. ["api","question-sets",":id","questions",":qid"]

  if (parts[0] === "api" && parts[1] === "question-sets") {
    const setId = parts[2];
    const sub = parts[3]; // "questions" or undefined
    const qid = parts[4];

    if (!setId && req.method === "GET") return void handleListSets(res);
    if (!setId && req.method === "POST") return void handleCreateSet(req, res);
    if (setId && !sub && req.method === "PUT") return void handleRenameSet(setId, req, res);
    if (setId && !sub && req.method === "DELETE") return void handleDeleteSet(setId, res);
    if (setId && sub === "questions" && !qid && req.method === "POST") return void handleAddQuestion(setId, req, res);
    if (setId && sub === "questions" && qid && req.method === "PUT") return void handleEditQuestion(setId, qid, req, res);
    if (setId && sub === "questions" && qid && req.method === "DELETE") return void handleDeleteQuestion(setId, qid, res);

    respondJson(res, 404, { error: "Unknown question-sets route." });
    return;
  }

  let urlPath = rawPath;
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    if (ext === ".html") {
      const html = data.toString("utf8").replace(
        /src="(js\/main\.js)"/g,
        `src="$1?v=${BUILD_VERSION}"`
      );
      res.end(html);
    } else {
      res.end(data);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
  console.log(`Camera access requires a secure context. Plain http only works from` );
  console.log(`"localhost" on this same machine — testing from a phone/iPad over`);
  console.log(`LAN needs HTTPS. See README for a quick cloudflared tunnel.`);
});
