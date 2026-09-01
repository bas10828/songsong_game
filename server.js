// Static file server (no build step — serves this directory as-is, the
// same way the target host will) plus a tiny JSON API (no framework) for
// teacher-authored "question sets": named packs of up to 30 questions
// (spell-the-word, translate, or sentence-builder), full CRUD on both the
// set and its nested questions. Everything — including uploaded photos,
// as bytea — lives in Postgres (see `pool` below, configured via standard
// PG* env vars), so there's no on-disk state to lose on a container
// recreate.
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

require("dotenv").config();

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const TLS_DIR = path.join(ROOT, "certs");
const TLS_KEY_PATH = path.join(TLS_DIR, "songsong-key.pem");
const TLS_CERT_PATH = path.join(TLS_DIR, "songsong-cert.pem");
const MAX_QUESTIONS_PER_SET = 30;

// Local development database settings. Environment variables supplied by
// deployment always win; `.env.local` only fills values that are missing.
const localEnvPath = path.join(ROOT, ".env.local");
if (fs.existsSync(localEnvPath)) {
  for (const line of fs.readFileSync(localEnvPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
// Bumped once per process start (i.e. every deploy/restart) and appended
// as a query string to js/main.js in served HTML. Guarantees a fresh URL
// after each deploy so CDN/browser caches of the old main.js can't get
// served alongside a newer HTML — the two must always be fetched together.
const BUILD_VERSION = Date.now();

const pool = new Pool();

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

// Maps a `questions` row back to the API's question shape (only the
// columns relevant to its `kind` are populated; the rest are NULL). A
// photo's bytes never leave the DB via this path — visualValue is a URL
// that serves them from `/api/photos/:id` on demand.
function rowToQuestion(row) {
  if (row.kind === "spell") {
    return {
      id: row.id,
      kind: "spell",
      word: row.word,
      visualType: row.visual_type,
      visualValue: row.visual_type === "photo" ? `/api/photos/${row.id}` : row.visual_value,
    };
  }
  if (row.kind === "translate") {
    return { id: row.id, kind: "translate", direction: row.direction, prompt: row.prompt, options: row.options, correctIndex: row.correct_index };
  }
  return { id: row.id, kind: "sentence", direction: row.direction, prompt: row.prompt, answerWords: row.answer_words };
}

async function loadSets(publicOnly = false) {
  const { rows: sets } = await pool.query(
    `SELECT id, name, is_public
       FROM question_sets
      ${publicOnly ? "WHERE is_public = true" : ""}
      ORDER BY created_at`
  );
  // Explicit column list — omits photo_data (bytea) so every save/load
  // round-trip doesn't drag every photo's bytes through for no reason;
  // handlePhoto() queries photo_data separately, on demand.
  const { rows: questions } = await pool.query(
    "SELECT id, set_id, kind, word, visual_type, visual_value, direction, prompt, options, correct_index, answer_words FROM questions ORDER BY position"
  );
  const bySet = new Map(sets.map((s) => [s.id, { id: s.id, name: s.name, isPublic: s.is_public, questions: [] }]));
  for (const q of questions) {
    const set = bySet.get(q.set_id);
    if (set) set.questions.push(rowToQuestion(q));
  }
  return [...bySet.values()];
}

async function insertQuestion(client, setId, position, q) {
  await client.query(
    `INSERT INTO questions (id, set_id, position, kind, word, visual_type, visual_value, photo_data, photo_mime, direction, prompt, options, correct_index, answer_words)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      q.id, setId, position, q.kind,
      q.kind === "spell" ? q.word : null,
      q.kind === "spell" ? q.visualType : null,
      q.kind === "spell" && q.visualType === "emoji" ? q.visualValue : null,
      q.kind === "spell" && q.visualType === "photo" ? q.photoData : null,
      q.kind === "spell" && q.visualType === "photo" ? q.photoMime : null,
      q.kind !== "spell" ? q.direction : null,
      q.kind !== "spell" ? q.prompt : null,
      q.kind === "translate" ? JSON.stringify(q.options) : null,
      q.kind === "translate" ? q.correctIndex : null,
      q.kind === "sentence" ? JSON.stringify(q.answerWords) : null,
    ]
  );
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
// On edit, a photo value that's already this question's own `/api/photos/`
// URL (rather than a fresh data: URL) means the teacher didn't replace the
// photo, so the existing bytes are kept instead of being re-decoded.
function resolveVisual(body, questionId) {
  if (body.visualType === "photo") {
    if (body.visualValue === `/api/photos/${questionId}`) {
      return { visualType: "photo", keepExisting: true };
    }
    const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(body.visualValue || "");
    if (!match) return null;
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 3 * 1024 * 1024) return null;
    const mime = `image/${match[1] === "jpg" ? "jpeg" : match[1]}`;
    return { visualType: "photo", photoData: buffer, photoMime: mime };
  }
  const emoji = String(body.visualValue || "").trim().slice(0, 8);
  if (!emoji) return null;
  return { visualType: "emoji", visualValue: emoji };
}

// Builds a validated question object from a request body, or returns
// { error } if something's wrong. `id` is reused on edit so an unchanged
// photo's `/api/photos/:id` URL can be recognized (see resolveVisual).
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
  return {
    id,
    kind: "spell",
    word,
    visualType: visual.visualType,
    visualValue: visual.visualValue,
    photoData: visual.photoData,
    photoMime: visual.photoMime,
    keepExisting: visual.keepExisting,
  };
}

async function handleListSets(res) {
  try {
    respondJson(res, 200, await loadSets());
  } catch (err) {
    respondJson(res, 500, { error: err.message });
  }
}

async function handleListPublicSets(res) {
  try {
    respondJson(res, 200, await loadSets(true));
  } catch (err) {
    respondJson(res, 500, { error: err.message });
  }
}

async function handleCreateSet(req, res) {
  try {
    const body = await readJsonBody(req, 16 * 1024);
    const name = sanitizeSetName(body.name);
    if (!name) return respondJson(res, 400, { error: "Give the set a name." });
    await pool.query("INSERT INTO question_sets (name) VALUES ($1)", [name]);
    respondJson(res, 200, await loadSets());
  } catch (err) {
    respondJson(res, 400, { error: err.message });
  }
}

async function handleRenameSet(id, req, res) {
  try {
    const body = await readJsonBody(req, 16 * 1024);
    const name = sanitizeSetName(body.name);
    if (!name) return respondJson(res, 400, { error: "Give the set a name." });
    const { rowCount } = await pool.query(
      "UPDATE question_sets SET name = $1, updated_at = now() WHERE id = $2",
      [name, id]
    );
    if (!rowCount) return respondJson(res, 404, { error: "Set not found." });
    respondJson(res, 200, await loadSets());
  } catch (err) {
    respondJson(res, 400, { error: err.message });
  }
}

async function handleSetVisibility(id, req, res) {
  try {
    const body = await readJsonBody(req, 16 * 1024);
    if (typeof body.isPublic !== "boolean") {
      return respondJson(res, 400, { error: "isPublic must be true or false." });
    }
    const { rowCount } = await pool.query(
      "UPDATE question_sets SET is_public = $1, updated_at = now() WHERE id = $2",
      [body.isPublic, id]
    );
    if (!rowCount) return respondJson(res, 404, { error: "Set not found." });
    respondJson(res, 200, await loadSets());
  } catch (err) {
    respondJson(res, 400, { error: err.message });
  }
}

async function handleDeleteSet(id, res) {
  try {
    // Photos live in the deleted rows' own `photo_data` column, so
    // ON DELETE CASCADE removes them along with the questions — no
    // separate cleanup step needed.
    const { rowCount } = await pool.query("DELETE FROM question_sets WHERE id = $1", [id]);
    if (!rowCount) return respondJson(res, 404, { error: "Set not found." });
    respondJson(res, 200, await loadSets());
  } catch (err) {
    respondJson(res, 500, { error: err.message });
  }
}

async function handleAddQuestion(setId, req, res) {
  try {
    const body = await readJsonBody(req, 4 * 1024 * 1024); // 4MB cap (photo)
    const { rows: setRows } = await pool.query("SELECT id FROM question_sets WHERE id = $1", [setId]);
    if (!setRows.length) return respondJson(res, 404, { error: "Set not found." });
    const { rows: countRows } = await pool.query(
      "SELECT COUNT(*)::int AS n, COALESCE(MAX(position), -1) AS maxpos FROM questions WHERE set_id = $1",
      [setId]
    );
    if (countRows[0].n >= MAX_QUESTIONS_PER_SET) {
      return respondJson(res, 400, { error: `A set can only hold ${MAX_QUESTIONS_PER_SET} questions.` });
    }

    const built = buildQuestion(body, crypto.randomUUID());
    if (built.error) return respondJson(res, 400, { error: built.error });

    await insertQuestion(pool, setId, countRows[0].maxpos + 1, built);
    respondJson(res, 200, await loadSets());
  } catch (err) {
    respondJson(res, 400, { error: err.message });
  }
}

async function handleEditQuestion(setId, qid, req, res) {
  try {
    const body = await readJsonBody(req, 4 * 1024 * 1024);
    const { rows } = await pool.query("SELECT id FROM questions WHERE id = $1 AND set_id = $2", [qid, setId]);
    if (!rows.length) return respondJson(res, 404, { error: "Question not found." });

    const built = buildQuestion(body, qid);
    if (built.error) return respondJson(res, 400, { error: built.error });

    // When the photo is unchanged, leave photo_data/photo_mime untouched
    // rather than re-writing them with nothing.
    if (built.keepExisting) {
      await pool.query(
        `UPDATE questions SET kind=$1, word=$2, visual_type=$3, direction=$4, prompt=$5, options=$6, correct_index=$7, answer_words=$8
         WHERE id = $9`,
        [
          built.kind, built.word, built.visualType,
          null, null, null, null, null,
          qid,
        ]
      );
    } else {
      await pool.query(
        `UPDATE questions SET kind=$1, word=$2, visual_type=$3, visual_value=$4, photo_data=$5, photo_mime=$6, direction=$7, prompt=$8, options=$9, correct_index=$10, answer_words=$11
         WHERE id = $12`,
        [
          built.kind,
          built.kind === "spell" ? built.word : null,
          built.kind === "spell" ? built.visualType : null,
          built.kind === "spell" && built.visualType === "emoji" ? built.visualValue : null,
          built.kind === "spell" && built.visualType === "photo" ? built.photoData : null,
          built.kind === "spell" && built.visualType === "photo" ? built.photoMime : null,
          built.kind !== "spell" ? built.direction : null,
          built.kind !== "spell" ? built.prompt : null,
          built.kind === "translate" ? JSON.stringify(built.options) : null,
          built.kind === "translate" ? built.correctIndex : null,
          built.kind === "sentence" ? JSON.stringify(built.answerWords) : null,
          qid,
        ]
      );
    }
    respondJson(res, 200, await loadSets());
  } catch (err) {
    respondJson(res, 400, { error: err.message });
  }
}

async function handleDeleteQuestion(setId, qid, res) {
  try {
    const { rowCount } = await pool.query("DELETE FROM questions WHERE id = $1 AND set_id = $2", [qid, setId]);
    if (!rowCount) return respondJson(res, 404, { error: "Question not found." });
    respondJson(res, 200, await loadSets());
  } catch (err) {
    respondJson(res, 500, { error: err.message });
  }
}

// The leaderboard is an append-only log of record-breaking plays for a
// set, not a full history of every play — a row is only inserted when its
// score beats every prior row for that set. That means "ORDER BY
// created_at" already puts the current record holder last; there's no
// separate "current best" query needed.
async function handleGetLeaderboard(setId, res) {
  try {
    const { rows } = await pool.query(
      "SELECT name, score, session_length, created_at FROM high_scores WHERE set_id = $1 ORDER BY created_at ASC",
      [setId]
    );
    respondJson(
      res,
      200,
      rows.map((r) => ({ name: r.name, score: r.score, sessionLength: r.session_length, createdAt: r.created_at }))
    );
  } catch (err) {
    respondJson(res, 500, { error: err.message });
  }
}

async function handlePostLeaderboard(setId, req, res) {
  try {
    const body = await readJsonBody(req, 1024);
    const name = String(body.name || "").trim().slice(0, 20);
    const score = Number(body.score);
    // Stored alongside the score (rather than read live off the set at
    // display time) so a record's denominator doesn't silently change if
    // the teacher later adds/removes questions from the set.
    const sessionLength = Number(body.sessionLength);
    if (!name) return respondJson(res, 400, { error: "Enter a nickname." });
    if (!Number.isInteger(score) || score < 0) return respondJson(res, 400, { error: "Invalid score." });
    if (!Number.isInteger(sessionLength) || sessionLength < 1) {
      return respondJson(res, 400, { error: "Invalid session length." });
    }

    const { rows: setRows } = await pool.query("SELECT id FROM question_sets WHERE id = $1", [setId]);
    if (!setRows.length) return respondJson(res, 404, { error: "Set not found." });

    const { rows: bestRows } = await pool.query(
      "SELECT score FROM high_scores WHERE set_id = $1 ORDER BY score DESC LIMIT 1",
      [setId]
    );
    if (bestRows.length && score <= bestRows[0].score) {
      return respondJson(res, 400, { error: "Not a new record." });
    }

    await pool.query(
      "INSERT INTO high_scores (set_id, name, score, session_length) VALUES ($1, $2, $3, $4)",
      [setId, name, score, sessionLength]
    );
    return void handleGetLeaderboard(setId, res);
  } catch (err) {
    respondJson(res, 400, { error: err.message });
  }
}

async function handlePhoto(id, res) {
  try {
    const { rows } = await pool.query(
      "SELECT photo_data, photo_mime FROM questions WHERE id = $1 AND kind = 'spell' AND visual_type = 'photo'",
      [id]
    );
    if (!rows.length || !rows[0].photo_data) {
      res.writeHead(404);
      return void res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": rows[0].photo_mime || "image/jpeg", "Cache-Control": "no-cache" });
    res.end(rows[0].photo_data);
  } catch (err) {
    res.writeHead(500);
    res.end(err.message);
  }
}

function requestListener(req, res) {
  try {
    handleRequest(req, res);
  } catch (err) {
    // A handler threw synchronously (e.g. loadSets() hitting a corrupt
    // question-sets.json) — fail this one request, not the whole process.
    respondJson(res, 500, { error: err.message });
  }
}

// HTTPS needs a cert (LAN/classroom use, so getUserMedia gets a secure
// context on other devices — see the console message in startServer).
// Behind a TLS-terminating reverse proxy or tunnel (e.g. Cloudflare
// Tunnel in production), the cert files won't exist and TLS is already
// handled upstream, so this falls back to plain HTTP instead of refusing
// to start — this used to throw and crash the process, which forced
// production to stay pinned to an old commit (from before the whole
// question-set visibility feature existed) just to avoid the cert
// requirement.
const hasTlsCert = fs.existsSync(TLS_KEY_PATH) && fs.existsSync(TLS_CERT_PATH);
const server = hasTlsCert
  ? https.createServer({ key: fs.readFileSync(TLS_KEY_PATH), cert: fs.readFileSync(TLS_CERT_PATH) }, requestListener)
  : http.createServer(requestListener);

function handleRequest(req, res) {
  const rawPath = decodeURIComponent(req.url.split("?")[0]);
  const parts = rawPath.split("/").filter(Boolean); // e.g. ["api","question-sets",":id","questions",":qid"]

  if (parts[0] === "api" && parts[1] === "public-question-sets" && req.method === "GET") {
    return void handleListPublicSets(res);
  }

  if (parts[0] === "api" && parts[1] === "question-sets") {
    const setId = parts[2];
    const sub = parts[3]; // "questions" or undefined
    const qid = parts[4];

    if (!setId && req.method === "GET") return void handleListSets(res);
    if (!setId && req.method === "POST") return void handleCreateSet(req, res);
    if (setId && !sub && req.method === "PUT") return void handleRenameSet(setId, req, res);
    if (setId && sub === "visibility" && req.method === "PUT") return void handleSetVisibility(setId, req, res);
    if (setId && !sub && req.method === "DELETE") return void handleDeleteSet(setId, res);
    if (setId && sub === "questions" && !qid && req.method === "POST") return void handleAddQuestion(setId, req, res);
    if (setId && sub === "questions" && qid && req.method === "PUT") return void handleEditQuestion(setId, qid, req, res);
    if (setId && sub === "questions" && qid && req.method === "DELETE") return void handleDeleteQuestion(setId, qid, res);
    if (setId && sub === "leaderboard" && req.method === "GET") return void handleGetLeaderboard(setId, res);
    if (setId && sub === "leaderboard" && req.method === "POST") return void handlePostLeaderboard(setId, req, res);

    respondJson(res, 404, { error: "Unknown question-sets route." });
    return;
  }

  if (parts[0] === "api" && parts[1] === "photos" && parts[2] && req.method === "GET") {
    return void handlePhoto(parts[2], res);
  }

  let urlPath = rawPath;
  if (urlPath === "/") urlPath = "/menu.html";

  // Never expose local configuration, database dumps, logs, or TLS keys.
  const firstSegment = urlPath.split("/").filter(Boolean)[0]?.toLowerCase();
  if (["certs", "backups", "data", "node_modules"].includes(firstSegment) || urlPath.startsWith("/.")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

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
    const cacheControl = urlPath.startsWith("/vendor/") || urlPath.startsWith("/models/")
      ? "public, max-age=604800"
      : "no-cache";
    let responseBody = data;
    if (ext === ".html") {
      const html = data.toString("utf8").replace(
        /src="(js\/main\.js)"/g,
        `src="$1?v=${BUILD_VERSION}"`
      );
      responseBody = Buffer.from(html, "utf8");
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": responseBody.length,
      "Cache-Control": cacheControl,
    });
    res.end(responseBody);
  });
}

async function startServer() {
  // Safe, repeatable migration for databases restored from an older backup.
  await pool.query(
    "ALTER TABLE question_sets ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false"
  );
  server.listen(PORT, "0.0.0.0", () => {
    const scheme = hasTlsCert ? "https" : "http";
    console.log(`Serving ${ROOT} at ${scheme}://localhost:${PORT}`);
    if (!hasTlsCert) {
      console.log(`No certs/ found — serving plain HTTP (fine behind a TLS-terminating`);
      console.log(`reverse proxy/tunnel). Camera access needs a secure context, so a`);
      console.log(`browser hitting this directly (not through such a proxy) only gets`);
      console.log(`getUserMedia on "localhost" — LAN/phone testing needs real HTTPS,`);
      console.log(`see certs/ setup in the project notes.`);
    }
  });
}

startServer().catch((err) => {
  console.error("Could not initialize the database:", err);
  process.exitCode = 1;
});
