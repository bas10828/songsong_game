// Loy Krathong page: a 3D night river where Kru Song (a paper-puppet
// character on the pier) floats a krathong for each student.
//
// The teacher is the only user. She enters a name, a photo and a wish; the
// photo is cut out locally (MediaPipe selfie segmenter, fully offline) and
// rides in the krathong like a sticker, with the wish in a bubble above it.
// Everything is stored in this browser's IndexedDB only, never uploaded.

import * as THREE from "../vendor/three/three.module.js";

const TAU = Math.PI * 2;
const FONT = '"Thonburi","Sukhumvit Set","Leelawadee UI","Noto Sans Thai","Tahoma",sans-serif';

// Wish categories set the krathong's petal/ribbon colour. Placeholder list
// until Kru Song sends the real one: edit here only.
const CATEGORIES = [
  { id: "money", label: "การเงิน", icon: "💰", color: "#ffc83d" },
  { id: "love", label: "ความรัก", icon: "💗", color: "#ff6fae" },
  { id: "health", label: "สุขภาพ", icon: "🍀", color: "#5fd37a" },
  { id: "study", label: "การเรียน", icon: "📚", color: "#5aa9ff" },
  { id: "work", label: "การงาน", icon: "⭐", color: "#ff9846" },
  { id: "family", label: "ครอบครัว", icon: "🏠", color: "#b88cff" },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

const WISH_PRESETS = [
  "ขอให้เรียนเก่ง สอบผ่านทุกวิชา",
  "ขอให้มีความสุขมากๆ สุขภาพแข็งแรง",
  "ขอให้ปีนี้เป็นปีที่ดี สมหวังทุกเรื่อง",
  "ขอให้ครอบครัวอบอุ่น มีแต่รอยยิ้ม",
];

// River layout (world units ~ metres). Water is y=0; the river flows +x.
const RIVER = { minX: -17, maxX: 19, nearZ: 3.9, farZ: -17 };
const PIER = { x: -3.2, z0: 1.4, z1: 4.6, top: 0.42 };
const TEACHER_POS = new THREE.Vector3(-3.35, PIER.top, 1.95);
const DROP_POS = new THREE.Vector3(-1.95, 0, 1.55);
const MAX_SIMPLE = 16;
const MAX_STUDENT = 80;

const els = {
  canvas: document.getElementById("river"),
  loading: document.getElementById("loading"),
  floatBtn: document.getElementById("floatBtn"),
  count: document.getElementById("count"),
  hint: document.getElementById("hint"),
  sound: document.getElementById("soundBtn"),
  sheet: document.getElementById("sheet"),
  backdrop: document.getElementById("sheetBackdrop"),
  name: document.getElementById("fName"),
  photo: document.getElementById("fPhoto"),
  photoPick: document.getElementById("photoPick"),
  photoPreview: document.getElementById("photoPreview"),
  photoStatus: document.getElementById("photoStatus"),
  cut: document.getElementById("fCut"),
  wish: document.getElementById("fWish"),
  presets: document.getElementById("presetChips"),
  cats: document.getElementById("catChips"),
  cancel: document.getElementById("cancelBtn"),
  error: document.getElementById("formError"),
  clear: document.getElementById("clearBtn"),
  toast: document.getElementById("toast"),
  sheetTitle: document.getElementById("sheetTitle"),
  submit: document.getElementById("submitBtn"),
  listBtn: document.getElementById("listBtn"),
  listPanel: document.getElementById("listPanel"),
  listItems: document.getElementById("listItems"),
  focusBar: document.getElementById("focusBar"),
  focusName: document.getElementById("focusName"),
  editBtn: document.getElementById("editBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  unfocusBtn: document.getElementById("unfocusBtn"),
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let toastTimer = 0;
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), ms);
}

// Adds a white sticker border (and a soft drop shadow) around whatever
// non-transparent pixels `src` has.
function stickerize(src, border, shadow = true) {
  const pad = Math.ceil(border + (shadow ? border * 1.2 : 2));
  const out = makeCanvas(src.width + pad * 2, src.height + pad * 2);
  const sil = makeCanvas(out.width, out.height);
  const s = sil.getContext("2d");
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    s.drawImage(src, pad + Math.cos(a) * border, pad + Math.sin(a) * border);
  }
  s.drawImage(src, pad, pad);
  s.globalCompositeOperation = "source-in";
  s.fillStyle = "#fff";
  s.fillRect(0, 0, sil.width, sil.height);

  const o = out.getContext("2d");
  if (shadow) {
    o.save();
    o.shadowColor = "rgba(20, 10, 50, 0.45)";
    o.shadowBlur = border * 1.4;
    o.shadowOffsetY = border * 0.5;
    o.drawImage(sil, 0, 0);
    o.restore();
  }
  o.drawImage(sil, 0, 0);
  o.drawImage(src, pad, pad);
  return out;
}

// Thai has no spaces between words, so wrap on Intl.Segmenter word
// boundaries (Safari 14.1+); fall back to grapheme-ish characters.
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split(/\n/)) {
    let parts;
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      parts = [...new Intl.Segmenter("th", { granularity: "word" }).segment(para)].map((s) => s.segment);
    } else {
      parts = para.match(/.[ัิ-ฺ็-๎]*/g) || [];
    }
    let line = "";
    for (const part of parts) {
      const next = line + part;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line.trim());
        line = part.trimStart();
      } else {
        line = next;
      }
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines.length ? lines : [""];
}

// ---------------------------------------------------------------------------
// Canvas art: textures for flames, glows, lanterns, bubbles, characters
// ---------------------------------------------------------------------------

function glowTexture(inner = "rgba(255,240,200,1)", mid = "rgba(255,170,80,0.35)") {
  const c = makeCanvas(128, 128);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, mid);
  grad.addColorStop(1, "rgba(255,140,60,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return canvasTexture(c);
}

function flameTexture() {
  const c = makeCanvas(64, 128);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 92, 2, 32, 80, 52);
  grad.addColorStop(0, "rgba(255,255,235,1)");
  grad.addColorStop(0.3, "rgba(255,220,120,0.95)");
  grad.addColorStop(0.65, "rgba(255,140,40,0.55)");
  grad.addColorStop(1, "rgba(255,90,20,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(32, 6);
  g.bezierCurveTo(52, 50, 58, 80, 32, 122);
  g.bezierCurveTo(6, 80, 12, 50, 32, 6);
  g.fill();
  return canvasTexture(c);
}

function lanternTexture() {
  const c = makeCanvas(96, 128);
  const g = c.getContext("2d");
  const halo = g.createRadialGradient(48, 70, 4, 48, 70, 60);
  halo.addColorStop(0, "rgba(255,190,90,0.55)");
  halo.addColorStop(1, "rgba(255,150,60,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, 96, 128);
  const body = g.createLinearGradient(0, 22, 0, 104);
  body.addColorStop(0, "#ffd27a");
  body.addColorStop(0.55, "#ffa640");
  body.addColorStop(1, "#ff7a2a");
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(26, 24);
  g.quadraticCurveTo(48, 16, 70, 24);
  g.lineTo(64, 100);
  g.quadraticCurveTo(48, 106, 32, 100);
  g.closePath();
  g.fill();
  const core = g.createRadialGradient(48, 96, 2, 48, 92, 22);
  core.addColorStop(0, "rgba(255,255,220,1)");
  core.addColorStop(1, "rgba(255,230,150,0)");
  g.fillStyle = core;
  g.fillRect(20, 70, 56, 40);
  return canvasTexture(c);
}

function moonTexture() {
  const c = makeCanvas(256, 256);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(118, 112, 10, 128, 128, 100);
  grad.addColorStop(0, "#fff9e6");
  grad.addColorStop(0.7, "#ffe9b0");
  grad.addColorStop(1, "#f6d48a");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 100, 0, TAU);
  g.fill();
  g.globalAlpha = 0.12;
  g.fillStyle = "#c79a52";
  for (const [x, y, r] of [[95, 100, 22], [150, 150, 28], [160, 95, 14], [110, 165, 12], [70, 140, 10]]) {
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
  return canvasTexture(c);
}

function softDotTexture() {
  const c = makeCanvas(64, 64);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c);
}

function ringTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext("2d");
  g.strokeStyle = "rgba(255,235,190,0.9)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(64, 64, 56, 0, TAU);
  g.stroke();
  return canvasTexture(c);
}

function drawFlower(g, x, y, r, petal = "#ff9ccf", center = "#ffd84a") {
  g.save();
  g.fillStyle = petal;
  g.strokeStyle = "#fff";
  g.lineWidth = r * 0.18;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU - Math.PI / 2;
    g.beginPath();
    g.arc(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.48, 0, TAU);
    g.stroke();
    g.fill();
  }
  g.fillStyle = center;
  g.beginPath();
  g.arc(x, y, r * 0.32, 0, TAU);
  g.fill();
  g.restore();
}

function drawHeart(g, x, y, s, color = "#ff6fae") {
  g.save();
  g.translate(x, y);
  g.scale(s / 20, s / 20);
  g.fillStyle = color;
  g.strokeStyle = "#fff";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 6);
  g.bezierCurveTo(-14, -4, -8, -16, 0, -8);
  g.bezierCurveTo(8, -16, 14, -4, 0, 6);
  g.stroke();
  g.fill();
  g.restore();
}

function drawSparkle(g, x, y, s, color = "#ffe27a") {
  g.save();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x, y, x + s, y);
  g.quadraticCurveTo(x, y, x, y + s);
  g.quadraticCurveTo(x, y, x - s, y);
  g.quadraticCurveTo(x, y, x, y - s);
  g.fill();
  g.restore();
}

// Wish speech-bubble in the style of the reference image: a scalloped cloud
// with a white sticker edge, flowers, a heart and sparkles.
function drawBubble(name, wish, catColor) {
  const W = 760;
  const meas = makeCanvas(10, 10).getContext("2d");
  meas.font = `600 40px ${FONT}`;
  const MAX_LINES = 6;
  const all = wrapText(meas, wish || "", W - 170);
  const lines = all.slice(0, MAX_LINES);
  if (all.length > MAX_LINES) lines[MAX_LINES - 1] = lines[MAX_LINES - 1].replace(/.{0,2}$/u, "…");
  const lineH = 60;
  const nameH = name ? 66 : 0;
  const bodyH = 70 + nameH + lines.length * lineH + 30;
  const tail = 70;

  const shape = makeCanvas(W, bodyH + tail);
  const g = shape.getContext("2d");
  const fill = g.createLinearGradient(0, 0, 0, bodyH);
  fill.addColorStop(0, "#fff7f2");
  fill.addColorStop(1, "#ffe9ef");
  g.fillStyle = fill;
  const x0 = 46, y0 = 30, x1 = W - 46, y1 = bodyH - 14;
  g.beginPath();
  g.roundRect(x0, y0, x1 - x0, y1 - y0, 60);
  g.fill();
  // scalloped edge
  const bumps = (from, to, fixed, horizontal, r) => {
    const n = Math.max(3, Math.round(Math.abs(to - from) / (r * 1.5)));
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      g.beginPath();
      if (horizontal) g.arc(t, fixed, r, 0, TAU);
      else g.arc(fixed, t, r, 0, TAU);
      g.fill();
    }
  };
  bumps(x0 + 50, x1 - 50, y0 + 6, true, 30);
  bumps(x0 + 50, x1 - 50, y1 - 6, true, 30);
  bumps(y0 + 50, y1 - 50, x0 + 6, false, 30);
  bumps(y0 + 50, y1 - 50, x1 - 6, false, 30);
  // thought-bubble tail
  g.beginPath();
  g.arc(W / 2 + 10, bodyH + 14, 22, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(W / 2 - 8, bodyH + 50, 12, 0, TAU);
  g.fill();

  const out = stickerize(shape, 9);
  const o = out.getContext("2d");
  const ox = (out.width - W) / 2;
  const oy = (out.height - shape.height) / 2;
  o.translate(ox, oy);

  o.textAlign = "center";
  o.textBaseline = "middle";
  let ty = 74;
  if (name) {
    o.font = `800 46px ${FONT}`;
    o.lineWidth = 8;
    o.strokeStyle = "#fff";
    o.strokeText(name, W / 2, ty + 6);
    o.fillStyle = shade(catColor, -0.35);
    o.fillText(name, W / 2, ty + 6);
    ty += nameH;
  }
  o.font = `600 40px ${FONT}`;
  o.fillStyle = "#6b3a2a";
  for (const line of lines) {
    o.fillText(line, W / 2, ty + 10);
    ty += lineH;
  }

  drawFlower(o, 74, 62, 30);
  drawFlower(o, W - 80, bodyH - 36, 28, "#ffb3d6");
  drawHeart(o, 60, bodyH - 46, 34, catColor);
  drawSparkle(o, 40, bodyH / 2 + 40, 16);
  drawSparkle(o, W - 60, 46, 14, "#fff2b0");
  return out;
}

function drawNameTag(name, catColor) {
  const meas = makeCanvas(10, 10).getContext("2d");
  meas.font = `800 44px ${FONT}`;
  const w = Math.min(560, meas.measureText(name).width + 70);
  const c = makeCanvas(w, 92);
  const g = c.getContext("2d");
  g.fillStyle = catColor;
  g.beginPath();
  g.roundRect(4, 10, w - 8, 72, 36);
  g.fill();
  g.font = `800 44px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#2a1640";
  g.fillText(name, w / 2, 48, w - 40);
  return stickerize(c, 6, false);
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, clamp01(hsl.l + amt));
  return `#${c.getHexString()}`;
}

// Paper-puppet person. Body (head, hair, outfit) and each arm are separate
// canvases so the arms can swing on shoulder pivots. Canvas: 256 x 512,
// feet at the bottom edge.
function drawPerson(o) {
  const body = makeCanvas(256, 512);
  const g = body.getContext("2d");
  const skin = o.skin || "#f6d2b8";
  const hair = o.hair || "#2b1b17";

  // hair behind the head
  g.fillStyle = hair;
  if (o.longHair) {
    g.beginPath();
    g.roundRect(70, 70, 116, 120, 50);
    g.fill();
  }
  if (o.bun) {
    g.beginPath();
    g.arc(128, 36, 27, 0, TAU);
    g.fill();
  }

  // legs / skirt
  if (o.skirt) {
    const sk = g.createLinearGradient(0, 280, 0, 480);
    sk.addColorStop(0, o.skirt);
    sk.addColorStop(1, shade(o.skirt, -0.12));
    g.fillStyle = sk;
    g.beginPath();
    g.moveTo(84, 280);
    g.lineTo(172, 280);
    g.lineTo(180, 478);
    g.lineTo(76, 478);
    g.closePath();
    g.fill();
    if (o.skirtBand) {
      g.fillStyle = o.skirtBand;
      g.fillRect(79, 440, 98, 18);
      g.fillRect(84, 292, 88, 10);
      g.globalAlpha = 0.35;
      for (let y = 320; y < 430; y += 26) g.fillRect(82, y, 92, 5);
      g.globalAlpha = 1;
    }
  } else {
    g.fillStyle = o.pants || "#33406b";
    g.beginPath();
    g.roundRect(88, 270, 36, 210, 12);
    g.roundRect(132, 270, 36, 210, 12);
    g.fill();
  }
  // feet
  g.fillStyle = o.shoes || "#5a3a2a";
  g.beginPath();
  g.ellipse(104, 490, 24, 12, 0, 0, TAU);
  g.ellipse(152, 490, 24, 12, 0, 0, TAU);
  g.fill();

  // torso
  g.fillStyle = o.top || "#ffffff";
  g.beginPath();
  g.moveTo(80, 168);
  g.quadraticCurveTo(128, 152, 176, 168);
  g.lineTo(170, 292);
  g.lineTo(86, 292);
  g.closePath();
  g.fill();
  if (o.sash) {
    g.fillStyle = o.sash;
    g.beginPath();
    g.moveTo(80, 166);
    g.lineTo(104, 160);
    g.lineTo(172, 290);
    g.lineTo(146, 292);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(100 + i * 12, 176 + i * 21, 3, 0, TAU);
      g.fill();
    }
  }

  // neck + head
  g.fillStyle = skin;
  g.fillRect(116, 136, 24, 30);
  g.beginPath();
  g.ellipse(128, 98, 50, 54, 0, 0, TAU);
  g.fill();

  // hair on top / fringe
  g.fillStyle = hair;
  g.beginPath();
  g.ellipse(128, 70, 54, 34, 0, Math.PI, TAU);
  g.fill();
  g.beginPath();
  g.moveTo(76, 76);
  g.quadraticCurveTo(100, 92, 128, 70);
  g.quadraticCurveTo(156, 92, 180, 78);
  g.lineTo(180, 64);
  g.lineTo(76, 64);
  g.closePath();
  g.fill();
  if (o.flower) drawFlower(g, 168, 56, 15, "#ffffff", "#ffd84a");

  // happy closed eyes + smile + blush
  g.strokeStyle = "#3a2420";
  g.lineWidth = 4;
  g.lineCap = "round";
  for (const ex of [108, 148]) {
    g.beginPath();
    g.arc(ex, 104, 9, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
  }
  g.beginPath();
  g.arc(128, 118, 13, Math.PI * 0.15, Math.PI * 0.85);
  g.stroke();
  g.fillStyle = "rgba(255,120,140,0.45)";
  g.beginPath();
  g.ellipse(98, 122, 11, 7, 0, 0, TAU);
  g.ellipse(158, 122, 11, 7, 0, 0, TAU);
  g.fill();

  const arm = makeCanvas(56, 190);
  const a = arm.getContext("2d");
  a.fillStyle = o.sleeve || o.top || "#ffffff";
  a.beginPath();
  a.roundRect(8, 0, 40, 74, 18);
  a.fill();
  a.fillStyle = skin;
  a.beginPath();
  a.roundRect(13, 64, 30, 104, 14);
  a.fill();
  a.beginPath();
  a.arc(28, 168, 17, 0, TAU);
  a.fill();

  return { body: stickerize(body, 7, false), arm: stickerize(arm, 6, false) };
}

// ---------------------------------------------------------------------------
// Photo -> sticker cutout (MediaPipe selfie segmenter, lazy-loaded, offline)
// ---------------------------------------------------------------------------

let segmenterPromise = null;
function getSegmenter() {
  segmenterPromise ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import("../vendor/mediapipe/vision_bundle.mjs");
    const vision = await FilesetResolver.forVisionTasks(new URL("../vendor/mediapipe/wasm", import.meta.url).href);
    // CPU keeps MediaPipe off the GPU so it can't fight three.js for WebGL.
    return ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: new URL("../models/selfie_segmenter.tflite", import.meta.url).href, delegate: "CPU" },
      runningMode: "IMAGE",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  })().catch((err) => {
    segmenterPromise = null;
    throw err;
  });
  return segmenterPromise;
}

// iPad photos are ~12MP; textures that size crash iOS WebGL, so everything
// works on a copy at most 720px on its long side.
async function loadPhoto(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bmp = await createImageBitmap(file);
  }
  const scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
  const c = makeCanvas(bmp.width * scale, bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

async function cutoutPerson(src) {
  const seg = await getSegmenter();
  const result = seg.segment(src);
  const masks = result.confidenceMasks || [];
  const mask = masks.length > 1 ? masks[1] : masks[0];
  if (!mask) {
    result.close?.();
    throw new Error("no mask");
  }
  const mw = mask.width;
  const mh = mask.height;
  const conf = mask.getAsFloat32Array().slice();
  result.close?.();

  // Single-channel models don't say which side is "person": treat the side
  // that dominates the middle of the frame as the person.
  const at = (x, y) => conf[Math.floor(y * (mh - 1)) * mw + Math.floor(x * (mw - 1))];
  const centre = (at(0.5, 0.5) + at(0.5, 0.7) + at(0.4, 0.6) + at(0.6, 0.6)) / 4;
  const corners = (at(0.02, 0.02) + at(0.98, 0.02) + at(0.02, 0.5) + at(0.98, 0.5)) / 4;
  const invert = centre < corners;

  const mc = makeCanvas(mw, mh);
  const mctx = mc.getContext("2d");
  const img = mctx.createImageData(mw, mh);
  let covered = 0;
  for (let i = 0; i < conf.length; i++) {
    const p = invert ? 1 - conf[i] : conf[i];
    const al = smooth(clamp01((p - 0.35) / 0.3));
    img.data[i * 4 + 3] = al * 255;
    if (al > 0.5) covered++;
  }
  if (covered / conf.length < 0.03) throw new Error("no person found");
  dropSpecks(img.data, mw, mh);
  mctx.putImageData(img, 0, 0);

  const cut = makeCanvas(src.width, src.height);
  const c = cut.getContext("2d");
  c.drawImage(src, 0, 0);
  c.globalCompositeOperation = "destination-in";
  c.drawImage(mc, 0, 0, src.width, src.height);
  return cropToContent(cut);
}

// The segmenter often keeps small stray blobs (background bits, other
// people's hands). Keep only blobs at least a fifth the size of the biggest.
function dropSpecks(rgba, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || rgba[start * 4 + 3] < 128) continue;
    const id = sizes.length;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % w;
      const y = (i - x) / w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (n >= 0 && label[n] === -1 && rgba[n * 4 + 3] >= 128) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  if (sizes.length < 2) return;
  const keep = Math.max(...sizes) * 0.2;
  for (let i = 0; i < w * h; i++) {
    // soft edge pixels (<128) take the label of nothing; clear them only
    // when no kept blob is next to them
    const l = label[i];
    if (l >= 0 ? sizes[l] < keep : !nearKept(i)) rgba[i * 4 + 3] = 0;
  }
  function nearKept(i) {
    const x = i % w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (n >= 0 && n < w * h && label[n] >= 0 && sizes[label[n]] >= keep) return true;
    }
    return false;
  }
}

function cropToContent(cv) {
  const { width: w, height: h } = cv;
  const data = cv.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (data[(y * w + x) * 4 + 3] > 60) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return cv;
  const out = makeCanvas(x1 - x0 + 2, y1 - y0 + 2);
  out.getContext("2d").drawImage(cv, -x0, -y0);
  return out;
}

// Fallback when segmentation is off or fails: a rounded polaroid-ish frame.
function framedPhoto(src) {
  const side = Math.min(src.width, src.height * 0.85);
  const w = side;
  const h = Math.min(src.height, side / 0.82);
  const c = makeCanvas(w, h);
  const g = c.getContext("2d");
  g.beginPath();
  g.roundRect(0, 0, w, h, w * 0.08);
  g.clip();
  g.drawImage(src, (src.width - w) / 2, (src.height - h) / 2 - (src.height - h) * 0.2, w, h, 0, 0, w, h);
  return c;
}

async function makeSticker(src, wantCut) {
  let art = null;
  let cut = false;
  if (wantCut) {
    try {
      art = await cutoutPerson(src);
      cut = true;
    } catch (err) {
      console.warn("[loykrathong] cutout failed, using frame", err);
    }
  }
  if (!art) art = framedPhoto(src);
  // ~512px keeps each krathong's GPU textures small enough that a river
  // full of them doesn't exhaust iOS Safari's WebGL memory.
  const fit = Math.min(1, 480 / Math.max(art.width, art.height));
  if (fit < 1) {
    const small = makeCanvas(art.width * fit, art.height * fit);
    small.getContext("2d").drawImage(art, 0, 0, small.width, small.height);
    art = small;
  }
  const border = Math.max(8, Math.round(Math.max(art.width, art.height) * 0.025));
  return { canvas: stickerize(art, border), cut };
}

// ---------------------------------------------------------------------------
// IndexedDB: krathongs persist on this iPad only
// ---------------------------------------------------------------------------

const db = (() => {
  let p = null;
  const open = () =>
    (p ??= new Promise((resolve, reject) => {
      const req = indexedDB.open("loykrathong", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("krathongs", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction("krathongs", mode);
      const r = fn(t.objectStore("krathongs"));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
    });
  };
  return {
    all: () => tx("readonly", (s) => s.getAll()).catch(() => []),
    put: (rec) => tx("readwrite", (s) => s.put(rec)).catch((e) => console.warn("[loykrathong] save failed", e)),
    remove: (id) => tx("readwrite", (s) => s.delete(id)).catch((e) => console.warn("[loykrathong] delete failed", e)),
    clear: () => tx("readwrite", (s) => s.clear()).catch(() => {}),
  };
})();

// ---------------------------------------------------------------------------
// Sound (WebAudio, synthesized: no audio files, works offline)
// ---------------------------------------------------------------------------

const sound = (() => {
  let ctx = null;
  let on = true;
  try {
    on = localStorage.getItem("loykrathong-sound") !== "off";
  } catch {}
  const ac = () => {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        return null;
      }
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  let noise = null;
  const noiseBuf = (a) => {
    if (noise) return noise;
    noise = a.createBuffer(1, a.sampleRate * 0.4, a.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  };
  const env = (a, gain, t0, attack, decay) => {
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(a.destination);
    return g;
  };
  return {
    get on() {
      return on;
    },
    toggle() {
      on = !on;
      try {
        localStorage.setItem("loykrathong-sound", on ? "on" : "off");
      } catch {}
      if (on) ac();
      return on;
    },
    unlock: () => on && ac(),
    pop(vol = 0.3) {
      const a = on && ac();
      if (!a || vol < 0.01) return;
      const t = a.currentTime;
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      const bp = a.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = rand(1200, 2400);
      bp.Q.value = 0.8;
      src.connect(bp).connect(env(a, vol, t, 0.002, 0.09));
      src.start(t, rand(0, 0.2), 0.12);
    },
    plop() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.18);
      osc.connect(env(a, 0.25, t, 0.005, 0.22));
      osc.start(t);
      osc.stop(t + 0.3);
    },
    chime() {
      const a = on && ac();
      if (!a) return;
      [880, 1175, 1568, 2093].forEach((f, i) => {
        const t = a.currentTime + i * 0.09;
        const osc = a.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = f;
        osc.connect(env(a, 0.09, t, 0.01, 0.6));
        osc.start(t);
        osc.stop(t + 0.7);
      });
    },
  };
})();

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function mount() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true, powerPreference: "high-performance" });
  } catch (err) {
    els.loading.textContent = "อุปกรณ์นี้ไม่รองรับ 3D (WebGL)";
    throw err;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const FOG = new THREE.Color(0x1a1846);
  scene.fog = new THREE.FogExp2(FOG, 0.022);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);

  scene.add(new THREE.HemisphereLight(0x9fb2ff, 0x2a1838, 1.0));
  const moonLight = new THREE.DirectionalLight(0xdfe6ff, 0.65);
  moonLight.position.set(30, 30, -60);
  scene.add(moonLight);
  // warm "candlelight" fill from the viewer so the krathongs read as lit
  const fill = new THREE.DirectionalLight(0xffd0a0, 1.35);
  fill.position.set(-2, 6, 12);
  scene.add(fill);

  const tex = {
    glow: glowTexture(),
    flame: flameTexture(),
    lantern: lanternTexture(),
    moon: moonTexture(),
    dot: softDotTexture(),
    ring: ringTexture(),
  };

  // ----- sky -----
  const MOON_DIR = new THREE.Vector3(0.42, 0.33, -1).normalize();
  {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color(0x060920) },
          horizon: { value: new THREE.Color(0x2f2a6e) },
          moonDir: { value: MOON_DIR },
        },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 zenith; uniform vec3 horizon; uniform vec3 moonDir; varying vec3 vDir;
          void main(){
            float h = clamp(vDir.y, 0.0, 1.0);
            vec3 col = mix(horizon, zenith, pow(h, 0.55));
            float m = max(dot(normalize(vDir), moonDir), 0.0);
            col += vec3(0.35,0.3,0.2) * pow(m, 18.0) + vec3(0.12,0.1,0.18) * pow(m, 4.0);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      })
    );
    sky.renderOrder = -10;
    scene.add(sky);

    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * TAU;
      const v = rand(0.08, 1);
      const r = 380;
      pos.set([Math.cos(u) * Math.sqrt(1 - v * v) * r, v * r, Math.sin(u) * Math.sqrt(1 - v * v) * r], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(
      new THREE.Points(
        sg,
        new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })
      )
    );

    const moonPos = MOON_DIR.clone().multiplyScalar(300);
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.moon, fog: false, depthWrite: false }));
    moon.position.copy(moonPos);
    moon.scale.setScalar(34);
    scene.add(moon);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.glow, color: 0xfff0c8, fog: false, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    halo.position.copy(moonPos);
    halo.scale.setScalar(130);
    scene.add(halo);
  }

  // ----- water -----
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: MOON_DIR },
      uDeep: { value: new THREE.Color(0x0a0d2e) },
      uZenith: { value: new THREE.Color(0x0c1236) },
      uHorizon: { value: new THREE.Color(0x3a3480) },
      uMoon: { value: new THREE.Color(0xffe2a0) },
      uFog: { value: FOG },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uMoonDir, uDeep, uZenith, uHorizon, uMoon, uFog;
      varying vec3 vWorld;
      float h(vec2 p){
        float t = uTime;
        p.x -= t * 0.55;
        return sin(p.x*1.1 + p.y*0.35 - t*0.9)*0.5
             + sin(p.y*1.9 + p.x*0.6 - t*1.3)*0.33
             + sin((p.x+p.y)*3.3 - t*2.1)*0.16
             + sin(p.x*6.7 - p.y*4.9 - t*2.9)*0.08;
      }
      void main(){
        vec2 p = vWorld.xz;
        float e = 0.06;
        float c = h(p);
        float dist = length(cameraPosition - vWorld);
        float amp = 0.11 / (1.0 + dist * 0.02);
        vec3 n = normalize(vec3(-(h(p+vec2(e,0.0))-c)/e*amp, 1.0, -(h(p+vec2(0.0,e))-c)/e*amp));
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 R = reflect(-V, n);
        float fres = 0.08 + 0.85 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 sky = mix(uHorizon, uZenith, clamp(R.y * 1.6, 0.0, 1.0));
        vec3 col = mix(uDeep, sky, fres);
        float m = max(dot(R, uMoonDir), 0.0);
        col += uMoon * (pow(m, 260.0) * 2.2 + pow(m, 40.0) * 0.25);
        float f = 1.0 - exp(-pow(dist * 0.022, 2.0));
        col = mix(col, uFog, f);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(220, 160, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.z = -40;
  scene.add(water);

  // ----- banks, pier, far shore -----
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x0b0e22 });
  {
    const near = new THREE.Mesh(new THREE.BoxGeometry(80, 1.2, 14), new THREE.MeshLambertMaterial({ color: 0x1b2a1e }));
    near.position.set(0, -0.25, RIVER.nearZ + 7);
    scene.add(near);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(80, 0.25, 0.5), new THREE.MeshLambertMaterial({ color: 0x3a3a34 }));
    lip.position.set(0, 0.28, RIVER.nearZ + 0.2);
    scene.add(lip);

    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4428 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, PIER.z1 - PIER.z0), wood);
    deck.position.set(PIER.x, PIER.top - 0.06, (PIER.z0 + PIER.z1) / 2);
    scene.add(deck);
    for (const dx of [-0.8, 0.8]) {
      for (const z of [PIER.z0 + 0.1, (PIER.z0 + PIER.z1) / 2]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), wood);
        post.position.set(PIER.x + dx, -0.2, z);
        scene.add(post);
      }
    }

    const far = new THREE.Mesh(new THREE.BoxGeometry(200, 1.4, 30), new THREE.MeshLambertMaterial({ color: 0x10142a }));
    far.position.set(0, -0.15, RIVER.farZ - 15.5);
    scene.add(far);

    // tree line (leaving a gap for the temple) + a temple + a golden chedi
    const TEMPLE_X = 4.5;
    for (let i = 0; i < 46; i++) {
      const x = rand(-70, 70);
      if (Math.abs(x - TEMPLE_X) < 9) continue;
      const z = rand(RIVER.farZ - 9, RIVER.farZ - 4);
      const s = rand(1.6, 3.4);
      const tree = new THREE.Mesh(i % 3 ? new THREE.SphereGeometry(s, 8, 6) : new THREE.ConeGeometry(s * 0.8, s * 3, 7), darkMat);
      tree.position.set(x, s * (i % 3 ? 1.1 : 1.4), z);
      scene.add(tree);
    }
    const temple = buildTemple();
    temple.position.set(TEMPLE_X, 0.55, RIVER.farZ - 7);
    temple.scale.setScalar(0.82);
    scene.add(temple);

    const chedi = new THREE.Group();
    const gold = new THREE.MeshLambertMaterial({ color: 0xd9a441, emissive: 0x4a2c06 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 1.6, 16), gold);
    base.position.y = 0.8;
    const bell = new THREE.Mesh(new THREE.SphereGeometry(2.6, 18, 12, 0, TAU, 0, Math.PI / 2), gold);
    bell.position.y = 1.6;
    bell.scale.y = 1.3;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.9, 7.5, 14), gold);
    spire.position.y = 8;
    chedi.add(base, bell, spire);
    chedi.position.set(-15, 0.5, RIVER.farZ - 14);
    scene.add(chedi);
    const chediGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.glow, color: 0xffb860, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    chediGlow.position.set(-15, 5, RIVER.farZ - 15);
    chediGlow.scale.setScalar(16);
    scene.add(chediGlow);
  }

  // Thai ordination hall (ubosot), floodlit for the festival: white walls
  // and pillars, three stacked steep red roofs with green borders, gold
  // gable boards and chofa finials curling up at the ridge ends.
  function buildTemple() {
    const g = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xf4ead8, emissive: 0x4a3c28 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xc23d1c, emissive: 0x3a0e04, side: THREE.DoubleSide });
    const green = new THREE.MeshLambertMaterial({ color: 0x2f8a46, emissive: 0x0c2a12 });
    const goldM = new THREE.MeshLambertMaterial({ color: 0xe8b444, emissive: 0x6a4208, side: THREE.DoubleSide });
    const doorM = new THREE.MeshLambertMaterial({ color: 0x7a1c12, emissive: 0x2a0804 });

    const L = 9; // length along the river
    const D = 4.6; // depth
    const H = 3.2; // wall height
    const base = new THREE.Mesh(new THREE.BoxGeometry(L + 2.2, 0.9, D + 2.2), white);
    base.position.y = 0.45;
    g.add(base);
    for (let i = 0; i < 3; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 0.5), white);
      step.position.set(0, 0.15 + i * 0.3, (D + 2.2) / 2 + 0.75 - i * 0.5);
      g.add(step);
    }
    const walls = new THREE.Mesh(new THREE.BoxGeometry(L, H, D), white);
    walls.position.y = 0.9 + H / 2;
    g.add(walls);
    // pillars along the front and back
    for (const z of [D / 2 + 0.55, -D / 2 - 0.55]) {
      for (let x = -L / 2; x <= L / 2 + 0.01; x += L / 6) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, H, 8), white);
        pillar.position.set(x, 0.9 + H / 2, z);
        g.add(pillar);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.17, 0.3, 8), goldM);
        cap.position.set(x, 0.9 + H - 0.15, z);
        g.add(cap);
      }
    }
    // red doors / windows with gold frames on the river side
    for (let i = -2; i <= 2; i++) {
      const tall = i === 0;
      const w = tall ? 1.1 : 0.7;
      const h = tall ? 2.1 : 1.3;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.24, h + 0.24, 0.06), goldM);
      frame.position.set(i * 1.7, 0.9 + (tall ? h / 2 + 0.05 : 1.6), D / 2 + 0.03);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), doorM);
      panel.position.copy(frame.position);
      panel.position.z += 0.02;
      g.add(frame, panel);
    }

    // stacked roofs: a gable prism per tier, extruded along the length
    const top = 0.9 + H;
    const tiers = [
      { len: L + 1.8, w: D + 2.4, h: 3.0, y: top },
      { len: L - 1.4, w: D + 1.4, h: 2.8, y: top + 1.0 },
      { len: L - 4.2, w: D + 0.4, h: 2.5, y: top + 2.0 },
    ];
    for (const t of tiers) {
      const shape = new THREE.Shape();
      shape.moveTo(-t.w / 2, 0);
      shape.lineTo(t.w / 2, 0);
      shape.lineTo(0, t.h);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: t.len, bevelEnabled: false });
      geo.translate(0, 0, -t.len / 2);
      geo.rotateY(Math.PI / 2);
      const roof = new THREE.Mesh(geo, roofMat);
      roof.position.y = t.y;
      g.add(roof);
      // green border strip along both eaves
      for (const s of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(t.len + 0.05, 0.16, 0.5), green);
        const slope = Math.atan2(t.h, t.w / 2);
        strip.position.set(0, t.y + 0.12, s * (t.w / 2 - 0.2));
        strip.rotation.x = s * slope;
        g.add(strip);
      }
      // gold gable boards + chofa / hang hong finials at both ends
      for (const s of [-1, 1]) {
        const gable = new THREE.Shape();
        gable.moveTo(-t.w / 2 + 0.25, 0.05);
        gable.lineTo(t.w / 2 - 0.25, 0.05);
        gable.lineTo(0, t.h - 0.25);
        gable.closePath();
        const board = new THREE.Mesh(new THREE.ShapeGeometry(gable), goldM);
        board.rotation.y = Math.PI / 2;
        board.position.set(s * (t.len / 2 + 0.03), t.y, 0);
        g.add(board);
        // the holder mirrors the left finial so both curl outward
        const holder = new THREE.Group();
        holder.position.set(s * (t.len / 2 + 0.05), t.y + t.h + 0.32, 0);
        holder.scale.x = s;
        const chofa = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 6, 14, Math.PI * 0.75), goldM);
        chofa.rotation.z = -0.5;
        holder.add(chofa);
        g.add(holder);
        for (const e of [-1, 1]) {
          const hong = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 5), goldM);
          hong.position.set(s * (t.len / 2 + 0.05), t.y + 0.15, e * (t.w / 2 - 0.1));
          hong.rotation.x = e * 0.9;
          g.add(hong);
        }
      }
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(t.len, 0.12, 0.12), goldM);
      ridge.position.y = t.y + t.h + 0.02;
      g.add(ridge);
    }

    // floodlight glow so it reads at night through the haze
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.glow, color: 0xffc77a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.position.set(0, 4, -1.5);
    glow.scale.setScalar(20);
    g.add(glow);
    return g;
  }

  // string lights along the far shore + warm bokeh in the distance
  {
    const bulbs = new THREE.Group();
    const cols = [0xffc76b, 0xff9f6b, 0xfff0b0, 0xff7fb0];
    for (let x = -40; x <= 40; x += 1.6) {
      const sag = Math.sin(((x + 40) / 8) * Math.PI);
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex.glow, color: pick(cols), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      s.position.set(x, 3.4 - Math.abs(sag) * 0.5, RIVER.farZ - 2.2);
      s.scale.setScalar(0.7);
      bulbs.add(s);
    }
    scene.add(bulbs);
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex.dot, color: pick(cols), transparent: true, opacity: rand(0.15, 0.4), fog: false, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      s.position.set(rand(-60, 60), rand(1, 9), rand(-70, -45));
      s.scale.setScalar(rand(1.5, 4));
      scene.add(s);
    }
    // lamp posts on the near bank
    for (const x of [-7.5, 9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6), darkMat);
      post.position.set(x, 1.3, RIVER.nearZ + 1.2);
      scene.add(post);
      const lamp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex.glow, color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      lamp.position.set(x, 2.7, RIVER.nearZ + 1.2);
      lamp.scale.setScalar(1.6);
      scene.add(lamp);
    }
  }

  // ----- shared FX: ripples, sparks, lanterns -----
  const ripples = [];
  function ripple(x, z, size = 1.4, color = 0xffe6b8) {
    const mat = new THREE.MeshBasicMaterial({ map: tex.ring, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    scene.add(m);
    ripples.push({ m, t: 0, size });
  }

  const SPARKS = 900;
  const sparkPos = new Float32Array(SPARKS * 3).fill(-999);
  const sparkCol = new Float32Array(SPARKS * 3);
  const sparkA = new Float32Array(SPARKS);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  let sparkHead = 0;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3));
  sparkGeo.setAttribute("alpha", new THREE.BufferAttribute(sparkA, 1));
  const sparks = new THREE.Points(
    sparkGeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: `
        attribute vec3 color; attribute float alpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = alpha > 0.0 ? 0.09 * uScale / -mv.z : 0.0; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.0, d)); }`,
    })
  );
  sparks.frustumCulled = false;
  scene.add(sparks);
  const tmpCol = new THREE.Color();
  function burst(p, n, { speed = 2, colors = [0xffd27a, 0xffffff, 0xff9a3a], life = 0.9, up = 1 } = {}) {
    for (let k = 0; k < n; k++) {
      const i = sparkHead;
      sparkHead = (sparkHead + 1) % SPARKS;
      const a = rand(0, TAU);
      const el = rand(-0.3, 1);
      const sp = speed * rand(0.4, 1);
      sparkPos.set([p.x, p.y, p.z], i * 3);
      sparkVel.set([Math.cos(a) * sp * Math.cos(el), Math.abs(Math.sin(el)) * sp * up + 0.5, Math.sin(a) * sp * Math.cos(el)], i * 3);
      tmpCol.set(pick(colors));
      sparkCol.set([tmpCol.r, tmpCol.g, tmpCol.b], i * 3);
      sparkLife[i] = life * rand(0.6, 1.2);
      sparkA[i] = 1;
    }
  }
  function updateSparks(dt) {
    for (let i = 0; i < SPARKS; i++) {
      if (sparkA[i] <= 0) continue;
      sparkLife[i] -= dt;
      if (sparkLife[i] <= 0) {
        sparkA[i] = 0;
        continue;
      }
      sparkVel[i * 3 + 1] -= 3.2 * dt;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      sparkA[i] = Math.min(1, sparkLife[i] * 2);
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;
    sparkGeo.attributes.alpha.needsUpdate = true;
  }

  const lanterns = [];
  function addLantern(pos, risen = 0) {
    const mat = new THREE.SpriteMaterial({ map: tex.lantern, transparent: true, depthWrite: false, fog: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.position.y += risen;
    s.scale.set(0.75, 1, 1);
    scene.add(s);
    lanterns.push({ s, vy: rand(0.45, 0.8), phase: rand(0, TAU), drift: rand(-0.15, 0.25), base: pos.y });
  }
  // the sky already has lanterns drifting when the page opens
  for (let i = 0; i < 26; i++) addLantern(new THREE.Vector3(rand(-40, 40), 0, rand(-70, -15)), rand(4, 40));

  // ----- krathong geometry (merged per category, vertex coloured) -----
  const geoCache = new Map();
  function krathongGeometry(catColor) {
    if (geoCache.has(catColor)) return geoCache.get(catColor);
    const parts = [];
    const dummy = new THREE.Object3D();
    const add = (geo, color, setup, gradient) => {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0, "XYZ");
      dummy.scale.set(1, 1, 1);
      setup?.(dummy);
      dummy.updateMatrix();
      parts.push({ geo, color: new THREE.Color(color), matrix: dummy.matrix.clone(), gradient });
    };
    const R = 0.5;
    add(new THREE.CylinderGeometry(R, R * 0.84, 0.2, 28), 0x3f7a2e, (d) => (d.position.y = 0.1));
    add(new THREE.CylinderGeometry(R * 1.01, R * 0.98, 0.07, 28, 1, true), catColor, (d) => (d.position.y = 0.13));
    const leaf = new THREE.ConeGeometry(0.1, 0.34, 4);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      add(leaf, i % 2 ? 0x5da23c : 0x3d7a2a, (d) => {
        d.position.set(Math.cos(a) * R * 0.92, 0.32, Math.sin(a) * R * 0.92);
        d.rotation.set(0, -a, -0.42, "YZX");
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = ((i + 0.5) / 10) * TAU;
      add(leaf, 0x4f9134, (d) => {
        d.position.set(Math.cos(a) * R * 0.7, 0.38, Math.sin(a) * R * 0.7);
        d.rotation.set(0, -a, -0.25, "YZX");
        d.scale.setScalar(0.85);
      });
    }
    const petal = new THREE.SphereGeometry(0.1, 10, 8);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      add(
        petal,
        catColor,
        (d) => {
          d.position.set(Math.cos(a) * 0.34, 0.38, Math.sin(a) * 0.34);
          d.rotation.set(0, -a, -0.6, "YZX");
          d.scale.set(0.5, 1.45, 0.9);
        },
        true
      );
    }
    add(new THREE.SphereGeometry(0.27, 14, 8, 0, TAU, 0, Math.PI / 2), 0xf29a18, (d) => (d.position.y = 0.24));
    const bloom = new THREE.SphereGeometry(0.06, 8, 6);
    for (let i = 0; i < 16; i++) {
      const a = rand(0, TAU);
      const r = rand(0.05, 0.24);
      add(bloom, i % 3 ? 0xffb52e : 0xfff3dc, (d) => {
        d.position.set(Math.cos(a) * r, 0.25 + Math.sqrt(Math.max(0, 0.075 - r * r)) * 0.9 + 0.02, Math.sin(a) * r);
        d.scale.set(1, i % 3 ? 0.8 : 0.45, 1);
      });
    }
    for (const a of [0.6, 2.3, 4.0]) {
      add(bloom, 0xb04fd6, (d) => {
        d.position.set(Math.cos(a) * R * 0.98, 0.18, Math.sin(a) * R * 0.98);
        d.scale.set(1.5, 0.6, 1.5);
      });
    }
    add(new THREE.CylinderGeometry(0.035, 0.038, 0.3, 10), 0xffe08a, (d) => d.position.set(0.24, 0.5, 0.1));
    const stick = new THREE.CylinderGeometry(0.011, 0.011, 0.48, 5);
    for (let i = 0; i < 3; i++) {
      add(stick, 0xb5652f, (d) => {
        d.position.set(-0.22 + i * 0.035, 0.56, -0.1);
        d.rotation.z = (i - 1) * 0.08;
      });
    }

    let count = 0;
    const prepared = parts.map((p) => {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      g.computeBoundingBox();
      const yMin = g.boundingBox.min.y;
      const yMax = g.boundingBox.max.y;
      const local = g.attributes.position.array.slice();
      g.applyMatrix4(p.matrix);
      count += g.attributes.position.count;
      return { g, p, local, yMin, yMax };
    });
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const white = new THREE.Color(0xffffff);
    const c = new THREE.Color();
    let o = 0;
    for (const { g, p, local, yMin, yMax } of prepared) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      for (let i = 0; i < n; i++) {
        c.copy(p.color);
        if (p.gradient) c.lerp(white, clamp01((local[i * 3 + 1] - yMin) / (yMax - yMin)) * 0.55);
        col[(o + i) * 3] = c.r;
        col[(o + i) * 3 + 1] = c.g;
        col[(o + i) * 3 + 2] = c.b;
      }
      o += n;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    merged.setAttribute("color", new THREE.BufferAttribute(col, 3));
    merged.computeBoundingSphere();
    geoCache.set(catColor, merged);
    return merged;
  }
  const krathongMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a160c });

  // ----- krathongs -----
  const krathongs = [];
  const pickables = [];

  function buildKrathong({ catColor, card, bubble, tag }) {
    const root = new THREE.Group();
    const spin = new THREE.Group();
    root.add(spin);
    spin.add(new THREE.Mesh(krathongGeometry(catColor), krathongMat));

    const flame = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.flame, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.position.set(0.24, 0.72, 0.1);
    flame.scale.set(0.09, 0.18, 1);
    spin.add(flame);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.glow, color: 0xffb060, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.position.copy(flame.position);
    glow.scale.setScalar(0.9);
    spin.add(glow);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: tex.glow, color: 0xffa050, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.015;
    root.add(pool);

    const k = { root, spin, flame, glow, pool, card: null, bubble: null, tag: null, speed: rand(0.12, 0.2), target: new THREE.Vector3(), vel: new THREE.Vector3(), retarget: 0, phase: rand(0, TAU), spinRate: rand(-0.12, 0.12), placed: true, textures: [] };

    if (card) {
      const t = canvasTexture(card);
      k.textures.push(t);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
      const h = 1.55;
      s.scale.set((h * card.width) / card.height, h, 1);
      s.center.set(0.5, 0);
      s.position.y = 0.2;
      s.userData.krathong = k;
      root.add(s);
      k.card = s;
      k.cardH = h;
      pickables.push(s);
    }
    const topY = k.card ? 0.2 + k.cardH : 0.75;
    if (bubble) {
      const t = canvasTexture(bubble);
      k.textures.push(t);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 }));
      const w = 1.9;
      s.scale.set(w, (w * bubble.height) / bubble.width, 1);
      s.center.set(0.5, 0);
      s.position.y = topY + 0.02;
      s.renderOrder = 2;
      root.add(s);
      k.bubble = s;
    }
    if (tag) {
      const t = canvasTexture(tag);
      k.textures.push(t);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
      const h = 0.3;
      s.scale.set((h * tag.width) / tag.height, h, 1);
      s.center.set(0.5, 0);
      s.position.y = topY + 0.04;
      s.renderOrder = 2;
      s.userData.krathong = k;
      root.add(s);
      k.tag = s;
      pickables.push(s);
    }
    scene.add(root);
    return k;
  }

  function disposeKrathong(k) {
    // Sprites share one geometry and the krathong mesh shares a cached
    // geometry + material, so only the per-krathong pieces are disposed.
    scene.remove(k.root);
    for (const s of [k.flame, k.glow, k.card, k.bubble, k.tag]) s?.material.dispose();
    k.pool.geometry.dispose();
    k.pool.material.dispose();
    for (const t of k.textures) t.dispose();
    unpick(k);
    const i = krathongs.indexOf(k);
    if (i >= 0) krathongs.splice(i, 1);
  }

  function unpick(k) {
    for (const s of [k.card, k.tag]) {
      const i = pickables.indexOf(s);
      if (s && i >= 0) pickables.splice(i, 1);
    }
  }

  // Delete: the krathong sinks with a ripple, then is disposed (see frame()).
  function sinkKrathong(k) {
    if (k.sinking != null) return;
    k.sinking = 0;
    unpick(k);
    const p = k.root.position;
    ripple(p.x, p.z, 1.6);
    sound.plop();
    if (camState.follow === k) camState.mode = "wide";
  }

  // Edit: build the updated krathong exactly where the old one floats.
  async function rebuildKrathong(old, rec) {
    const k = await studentKrathong(rec, { at: old.root.position, replacing: true });
    k.target.copy(old.target);
    k.vel.copy(old.vel);
    k.spin.rotation.y = old.spin.rotation.y;
    const following = camState.follow === old;
    disposeKrathong(old);
    if (following) focusOn(k, 12);
    updateCount();
    return k;
  }

  function spawnSimple(x, z, placedByNpc = true) {
    const simple = krathongs.filter((k) => k.simple);
    if (simple.length >= MAX_SIMPLE) disposeKrathong(simple[0]);
    const k = buildKrathong({ catColor: pick(CATEGORIES).color });
    k.simple = true;
    k.root.position.set(x, 0, z);
    randomSpot(k.target, true);
    k.root.scale.setScalar(0.85);
    krathongs.push(k);
    if (placedByNpc) ripple(x, z, 1.2);
    return k;
  }

  async function studentKrathong(rec, { atDrop = false, at = null, replacing = false } = {}) {
    const cat = CAT[rec.cat] || CATEGORIES[0];
    let card = null;
    if (rec.image) {
      try {
        const bmp = await createImageBitmap(rec.image);
        card = makeCanvas(bmp.width, bmp.height);
        card.getContext("2d").drawImage(bmp, 0, 0);
        bmp.close?.();
      } catch (err) {
        console.warn("[loykrathong] photo decode failed", err);
      }
    }
    const k = buildKrathong({
      catColor: cat.color,
      card,
      bubble: drawBubble(rec.name, rec.wish, cat.color),
      tag: rec.name ? drawNameTag(rec.name, cat.color) : null,
    });
    k.rec = rec;
    if (at) {
      k.root.position.copy(at);
    } else if (atDrop) {
      k.root.position.copy(DROP_POS);
    } else {
      randomSpot(k.root.position, false);
    }
    randomSpot(k.target, false);
    const students = krathongs.filter((x) => !x.simple && x.sinking == null);
    if (!replacing && students.length >= MAX_STUDENT) disposeKrathong(students[0]);
    krathongs.push(k);
    updateCount();
    return k;
  }

  function updateCount() {
    els.count.textContent = `🌸 ${krathongs.filter((k) => !k.simple && k.sinking == null).length}`;
  }

  // ----- characters (paper puppets, billboarded around Y) -----
  const people = [];
  function buildPerson(look, height) {
    const art = drawPerson(look);
    const scale = height / 512;
    const group = new THREE.Group();
    const inner = new THREE.Group(); // tilts/squats around the feet
    group.add(inner);
    const mk = (canvas) => {
      const t = canvasTexture(canvas);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(canvas.width * scale, canvas.height * scale),
        new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide })
      );
      return m;
    };
    const body = mk(art.body);
    body.position.y = (art.body.height * scale) / 2;
    inner.add(body);
    const arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 48 * scale, (512 - 170) * scale, 0.01);
      const arm = mk(art.arm);
      arm.position.y = (-art.arm.height * scale) / 2 + 12 * scale;
      pivot.add(arm);
      inner.add(pivot);
      arms.push(pivot);
    }
    const hand = new THREE.Object3D(); // right hand tip, for carrying things
    hand.position.y = -160 * scale;
    arms[1].add(hand);
    scene.add(group);
    const p = { group, inner, arms, hand, height, t: rand(0, 10), pose: { tilt: 0, squat: 0, armL: -0.12, armR: 0.12 } };
    people.push(p);
    return p;
  }

  const teacher = buildPerson(
    { skin: "#f8d8c0", hair: "#24160f", bun: true, flower: true, top: "#fff4ea", sash: "#e6a93a", skirt: "#d9548f", skirtBand: "#ffd27a", sleeve: "#fff4ea", shoes: "#8a4a3a" },
    2.05
  );
  teacher.group.position.copy(TEACHER_POS);
  {
    const c = drawNameTag("ครูสอง", "#ffd98a");
    const t = canvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    s.scale.set((0.36 * c.width) / c.height, 0.36, 1);
    s.center.set(0.5, 0);
    s.position.y = 2.15;
    teacher.group.add(s);
  }

  const looks = [
    { skin: "#e9bc98", hair: "#1d1410", top: "#7ec8ff", pants: "#2d3c6b" },
    { skin: "#f3cdb0", hair: "#2a1a12", longHair: true, top: "#ffd166", skirt: "#ef6f8f", skirtBand: "#ffe3a0" },
    { skin: "#d9a57c", hair: "#140d0a", top: "#a7f0b5", pants: "#4b3b70" },
    { skin: "#f5d3bd", hair: "#3a2416", bun: true, flower: true, top: "#ffffff", sash: "#7a5cff", skirt: "#5b6cff", skirtBand: "#ffd27a" },
    { skin: "#e2b08b", hair: "#1a120e", top: "#ff9a76", pants: "#2f4a3a" },
    { skin: "#f0c6a6", hair: "#22150f", longHair: true, top: "#c9a7ff", skirt: "#ff9fc8", skirtBand: "#ffffff" },
  ];
  // NPC actions: "float" krathongs, "lantern" release, "cracker" firecrackers
  const npcSpots = [
    { x: -12.5, z: RIVER.farZ - 0.6, act: "float" },
    { x: -8.5, z: RIVER.farZ - 1.4, act: "lantern" },
    { x: -4.2, z: RIVER.farZ - 0.6, act: "float" },
    { x: 0.5, z: RIVER.farZ - 1.6, act: "cracker" },
    { x: 4.5, z: RIVER.farZ - 0.6, act: "float" },
    { x: 8.6, z: RIVER.farZ - 1.3, act: "lantern" },
    { x: 13, z: RIVER.farZ - 1.5, act: "cracker" },
    { x: 5.8, z: RIVER.nearZ + 1.6, act: "lantern", near: true },
    { x: 8.6, z: RIVER.nearZ + 2.1, act: "cracker", near: true },
    { x: -9.6, z: RIVER.nearZ + 1.4, act: "float", near: true },
  ];
  const npcs = npcSpots.map((spot, i) => {
    const p = buildPerson(looks[i % looks.length], spot.near ? 1.75 : 1.85);
    p.group.position.set(spot.x, spot.near ? 0.3 : 0.55, spot.z);
    p.act = spot.act;
    p.near = !!spot.near;
    p.next = rand(1, 8);
    p.busy = 0;
    return p;
  });

  // ----- camera rig -----
  const camState = {
    pos: new THREE.Vector3(0.6, 3.3, 11),
    look: new THREE.Vector3(0.2, 1.1, -3),
    mode: "wide",
    follow: null,
    until: 0,
  };
  const goalPos = new THREE.Vector3();
  const goalLook = new THREE.Vector3();
  camera.position.copy(camState.pos);

  function wideShot(out, outLook) {
    const portrait = camera.aspect < 1;
    // portrait iPads look further down so the river, not the bank, fills
    // the extra height
    if (portrait) {
      out.set(-1.3, 5.6, 10.8);
      outLook.set(-1.1, 0.1, -4);
    } else {
      out.set(0.6, 3.3, 11);
      outLook.set(0.2, 1.1, -3);
    }
  }

  // Krathongs never leave the screen: each wanders between random spots
  // that are visible from the wide shot (checked against a stand-in camera,
  // so following one krathong up close doesn't shrink everyone's area).
  const wideCam = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
  const wideLook = new THREE.Vector3();
  const probe = new THREE.Vector3();
  function syncWideCam() {
    wideCam.aspect = camera.aspect;
    wideCam.fov = camera.fov;
    wideCam.updateProjectionMatrix();
    wideShot(wideCam.position, wideLook);
    wideCam.lookAt(wideLook);
    wideCam.updateMatrixWorld();
  }
  function inView(x, z) {
    probe.set(x, 0.7, z).project(wideCam);
    // keep clear of the top bar and the big button at the bottom
    return Math.abs(probe.x) < 0.8 && probe.y > -0.6 && probe.y < 0.45 && probe.z < 1;
  }
  // student krathongs use the nearer water, the small NPC ones the far side;
  // neither parks in front of Kru Song on the pier
  function randomSpot(out, simple) {
    for (let i = 0; i < 60; i++) {
      const x = rand(-16, 16);
      const z = simple ? rand(-15.5, -7) : rand(-11, 1.2);
      if (x < -0.6 && z > -1.5) continue;
      if (inView(x, z)) return out.set(x, 0, z);
    }
    return out.set(rand(-2, 3), 0, simple ? rand(-12, -9) : rand(-6, -3));
  }

  function focusOn(k, seconds = 9) {
    camState.mode = "follow";
    camState.follow = k;
    camState.until = clock + seconds;
  }

  // ----- the teacher's floating sequence -----
  const queue = [];
  let performing = null;

  function enqueueFloat(k) {
    k.placed = false;
    k.root.visible = false;
    queue.push(k);
    updateFloatBtn();
  }

  function updateFloatBtn() {
    els.floatBtn.textContent = performing || queue.length ? `🌸 กำลังลอย… (${queue.length + (performing ? 1 : 0)})` : "🌸 ลอยกระทงใบใหม่";
  }

  const handWorld = new THREE.Vector3();
  function runPerformance(dt) {
    if (!performing && queue.length) {
      performing = { k: queue.shift(), t: 0 };
      performing.k.root.visible = true;
      performing.k.root.scale.setScalar(0.001);
      camState.mode = "teacher";
      sound.chime();
      updateFloatBtn();
    }
    if (!performing) return;
    const P = performing;
    const k = P.k;
    P.t += dt;
    const t = P.t;
    const pose = teacher.pose;

    // 0-0.8 pop into hands, 0.8-1.6 present, 1.6-2.9 crouch & lower,
    // 2.9 release, 2.9-3.8 rise, 3.8-5.2 wave.
    const hold = smooth(clamp01(t / 0.6));
    const crouch = smooth(clamp01((t - 1.6) / 1.1)) * (1 - smooth(clamp01((t - 3.0) / 0.8)));
    pose.tilt = -0.32 * crouch;
    pose.squat = 0.28 * crouch;
    pose.armL = lerp(-0.12, 0.95, hold) * (1 - smooth(clamp01((t - 3.0) / 0.6)));
    pose.armR = lerp(0.12, -0.95, hold) * (1 - smooth(clamp01((t - 3.0) / 0.6)));
    if (t > 3.8) pose.armR = 2.5 + Math.sin((t - 3.8) * 9) * 0.35;
    if (t > 5.2) pose.armR = 0.12;

    if (t < 2.9) {
      // carried in front of her chest, then lowered onto the water
      teacher.inner.updateMatrixWorld(true);
      const chest = new THREE.Vector3(0, 1.0 - 0.15 * crouch, 0.45);
      teacher.inner.localToWorld(chest);
      const lower = smooth(clamp01((t - 1.6) / 1.3));
      handWorld.lerpVectors(chest, DROP_POS, lower);
      handWorld.y += Math.sin(lower * Math.PI) * 0.25 + (t > 0.8 && t < 1.6 ? Math.sin((t - 0.8) * 4) * 0.05 : 0);
      k.root.position.copy(handWorld);
      const sc = smooth(clamp01(t / 0.5)) * lerp(0.62, 1, lower);
      k.root.scale.setScalar(Math.max(0.001, sc));
      if (t < 0.5 && !P.sparkled) {
        P.sparkled = true;
        burst(handWorld, 40, { speed: 1.4, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.8 });
      }
    } else if (!P.released) {
      P.released = true;
      k.root.position.copy(DROP_POS);
      k.root.scale.setScalar(1);
      k.placed = true;
      ripple(DROP_POS.x, DROP_POS.z, 1.8);
      ripple(DROP_POS.x, DROP_POS.z, 2.8);
      burst(new THREE.Vector3(DROP_POS.x, 0.1, DROP_POS.z), 30, { speed: 1.1, colors: [0xbfe6ff, 0xffffff], life: 0.6 });
      sound.plop();
      focusOn(k, 8);
    }
    if (t > 5.4) {
      pose.armL = -0.12;
      pose.armR = 0.12;
      performing = null;
      updateFloatBtn();
    }
  }

  // ----- NPC behaviours -----
  function npcAct(p, dt) {
    p.next -= dt;
    const pose = p.pose;
    if (p.busy > 0) {
      p.busy -= dt;
      const u = 1 - p.busy / p.busyLen;
      const env = Math.sin(clamp01(u) * Math.PI);
      if (p.doing === "float") {
        pose.squat = 0.3 * env;
        pose.tilt = 0;
        pose.armL = 0.7 * env - 0.12;
        pose.armR = -0.7 * env + 0.12;
        if (u > 0.5 && !p.fired) {
          p.fired = true;
          const g = p.group.position;
          spawnSimple(g.x + rand(-0.4, 0.4), p.near ? RIVER.nearZ - 0.5 : RIVER.farZ + 0.8);
        }
      } else if (p.doing === "lantern") {
        pose.armL = -2.7 * smooth(clamp01(u * 3)) * (u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15);
        pose.armR = -pose.armL;
        if (!p.held && u < 0.6) {
          p.held = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.lantern, transparent: true, depthWrite: false }));
          p.held.scale.set(0.6, 0.8, 1);
          p.group.add(p.held);
        }
        if (p.held) {
          p.held.position.set(0, p.height + 0.35, 0.05);
          p.held.material.opacity = 0.4 + 0.6 * smooth(clamp01(u * 2));
        }
        if (u > 0.6 && p.held) {
          const w = new THREE.Vector3();
          p.held.getWorldPosition(w);
          p.group.remove(p.held);
          p.held.material.dispose();
          p.held = null;
          addLantern(w);
        }
      } else if (p.doing === "cracker") {
        pose.armR = 1.1 * env + 0.12;
        p.popT = (p.popT ?? 0) - dt;
        if (u > 0.2 && u < 0.85 && p.popT <= 0) {
          p.popT = rand(0.08, 0.18);
          const g = p.group.position;
          const at = new THREE.Vector3(g.x + 0.9, g.y + 0.15, g.z + 0.3);
          burst(at, 22, { speed: 2.4, colors: [0xfff1a8, 0xffb347, 0xff5a3a, 0xffffff], life: 0.55 });
          const d = camera.position.distanceTo(at);
          sound.pop(Math.min(0.22, 2.2 / d));
        }
      }
      if (p.busy <= 0) {
        pose.armL = -0.12;
        pose.armR = 0.12;
        pose.squat = 0;
      }
      return;
    }
    if (p.next <= 0) {
      // once the far water is full, floaters release a lantern instead, so no
      // earlier krathong ever has to be removed
      const full = krathongs.filter((k) => k.simple).length >= MAX_SIMPLE;
      p.doing = p.act === "float" && full ? "lantern" : p.act;
      p.busyLen = p.doing === "float" ? 2.4 : p.doing === "lantern" ? 3.6 : 2.2;
      p.busy = p.busyLen;
      p.fired = false;
      p.next = p.busyLen + (p.act === "cracker" ? rand(6, 12) : rand(7, 15));
    }
  }

  const camYaw = new THREE.Vector3();
  function poseAll(dt) {
    for (const p of people) {
      p.t += dt;
      const q = p.pose;
      // billboard around Y toward the camera
      camYaw.subVectors(camera.position, p.group.position);
      p.group.rotation.y = Math.atan2(camYaw.x, camYaw.z);
      const breathe = Math.sin(p.t * 1.6) * 0.012;
      p.inner.rotation.z = q.tilt + Math.sin(p.t * 0.9) * 0.02;
      p.inner.scale.y = 1 - q.squat * 0.35 + breathe;
      p.inner.position.y = -q.squat * 0.1;
      p.arms[0].rotation.z = q.armL + Math.sin(p.t * 1.3) * 0.04;
      p.arms[1].rotation.z = q.armR - Math.sin(p.t * 1.3 + 1) * 0.04;
      // fade anyone the camera gets right up against during a close-up
      const fade = clamp01((camYaw.length() - 2.4) / 2.2);
      if (fade !== p.fade) {
        p.fade = fade;
        p.group.visible = fade > 0.02;
        p.group.traverse((o) => {
          if (o.material) {
            o.material.transparent = true;
            o.material.opacity = fade;
          }
        });
      }
    }
  }

  // ----- interaction: tap a krathong to look closer -----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;
  els.canvas.addEventListener("pointerdown", (e) => {
    sound.unlock();
    downAt = { x: e.clientX, y: e.clientY };
  });
  els.canvas.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 12) return;
    downAt = null;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (hit) {
      focusOn(hit.object.userData.krathong, 25);
      els.hint.style.opacity = "0";
    } else if (camState.mode === "follow") {
      camState.mode = "wide";
    }
  });

  // ----- loop -----
  function resize() {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 58 : 45;
    camera.updateProjectionMatrix();
    syncWideCam();
    for (const k of krathongs) randomSpot(k.target, k.simple);
    sparks.material.uniforms.uScale.value = h * renderer.getPixelRatio() * 0.5;
  }
  addEventListener("resize", resize);
  resize();

  let clock = 0;
  let last = performance.now();
  let lastShown = null;
  const api = {
    studentKrathong,
    enqueueFloat,
    focusOn,
    updateCount,
    krathongs,
    disposeKrathong,
    sinkKrathong,
    rebuildKrathong,
    unfocus: () => (camState.mode = "wide"),
    // student krathongs still in the river, oldest first
    students: () => krathongs.filter((k) => !k.simple && k.sinking == null),
    onFocus: null,
  };
  const tmp = new THREE.Vector3();
  const camDist = new THREE.Vector3();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    waterMat.uniforms.uTime.value = clock;

    // krathongs wander slowly around the visible water, keeping apart
    for (const k of [...krathongs]) {
      if (k.sinking != null) {
        k.sinking += dt;
        const u = clamp01(k.sinking / 1.1);
        k.root.position.y = -0.6 * u * u;
        k.root.scale.setScalar(Math.max(0.001, 1 - u * 0.6));
        k.root.rotation.z = Math.sin(k.sinking * 9) * 0.12 * (1 - u);
        if (u >= 1) {
          disposeKrathong(k);
          updateCount();
        }
        continue;
      }
      if (k.placed) {
        const p = k.root.position;
        const tx = k.target.x - p.x;
        const tz = k.target.z - p.z;
        const dist = Math.hypot(tx, tz);
        if (dist < 0.5 || clock > k.retarget) {
          randomSpot(k.target, k.simple);
          k.retarget = clock + rand(25, 45);
        }
        // paddle out of the pier area quickly so close-ups aren't blocked by Kru Song
        const atPier = p.x < -0.4 && p.z > -1.8;
        const sp = k.speed * (atPier ? 2.5 : 1) * Math.min(1, dist / 1.5);
        let vx = (tx / (dist || 1)) * sp;
        let vz = (tz / (dist || 1)) * sp;
        for (const o of krathongs) {
          if (o === k || !o.placed || o.sinking != null) continue;
          const dx = p.x - o.root.position.x;
          const dz = p.z - o.root.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.9 && d > 0.001) {
            vx += (dx / d) * (1.9 - d) * 0.4;
            vz += (dz / d) * (1.9 - d) * 0.4;
          }
        }
        k.vel.x += (vx - k.vel.x) * Math.min(1, dt * 0.8);
        k.vel.z += (vz - k.vel.z) * Math.min(1, dt * 0.8);
        p.x += k.vel.x * dt;
        p.z += k.vel.z * dt;
        p.y = Math.sin(clock * 1.4 + k.phase) * 0.025;
        k.root.rotation.z = Math.sin(clock * 1.1 + k.phase) * 0.025;
        k.spin.rotation.y += k.spinRate * dt;
      }
      const flick = 1 + Math.sin(clock * 17 + k.phase) * 0.08 + Math.sin(clock * 29 + k.phase * 2) * 0.05;
      k.flame.scale.set(0.09 * flick, 0.18 * (2 - flick), 1);
      k.glow.material.opacity = 0.55 + (flick - 1) * 1.5;
      // wish bubble fades in close up, name tag shows from afar
      if (k.bubble) {
        const d = camDist.subVectors(camera.position, k.root.position).length();
        // hidden while Kru Song is still carrying it
        // only the krathong in close-up shows its wish; neighbours keep
        // their small name tags so they don't cover it
        const focusedHere = camState.mode === "follow" && camState.follow === k;
        const near = k.placed && focusedHere ? clamp01((9 - d) / 3.5) : 0;
        k.bubble.material.opacity = near;
        k.bubble.visible = near > 0.01;
        if (k.tag) {
          k.tag.material.opacity = 1 - near;
          k.tag.visible = k.placed && near < 0.99;
        }
      }
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.t += dt;
      const u = r.t / 1.8;
      r.m.scale.setScalar(0.2 + u * r.size * 2);
      r.m.material.opacity = (1 - u) * 0.8;
      if (u >= 1) {
        scene.remove(r.m);
        r.m.geometry.dispose();
        r.m.material.dispose();
        ripples.splice(i, 1);
      }
    }

    for (let i = lanterns.length - 1; i >= 0; i--) {
      const l = lanterns[i];
      l.s.position.y += l.vy * dt;
      l.s.position.x += (Math.sin(clock * 0.4 + l.phase) * 0.12 + l.drift) * dt;
      l.s.material.opacity = clamp01((48 - l.s.position.y) / 10) * (0.85 + Math.sin(clock * 3 + l.phase) * 0.15);
      if (l.s.position.y > 48) {
        // recycle ambient lanterns to the bottom of the sky, far away
        l.s.position.set(rand(-40, 40), rand(2, 6), rand(-70, -18));
      }
    }
    if (lanterns.length > 60) {
      const l = lanterns.shift();
      scene.remove(l.s);
      l.s.material.dispose();
    }

    runPerformance(dt);
    for (const n of npcs) npcAct(n, dt);
    updateSparks(dt);
    poseAll(dt);

    // camera
    if (camState.mode === "follow" && (clock > camState.until || !krathongs.includes(camState.follow))) camState.mode = "wide";
    // tell the page which student krathong (if any) is in close-up, so it
    // can show the edit / delete bar for it
    const shown = camState.mode === "follow" && !camState.follow.simple && camState.follow.sinking == null ? camState.follow : null;
    if (shown !== lastShown) {
      lastShown = shown;
      api.onFocus?.(shown);
    }
    if (camState.mode === "follow") {
      const p = camState.follow.root.position;
      goalLook.set(p.x, 1.3, p.z);
      goalPos.set(p.x + 0.25, 1.7, p.z + (camera.aspect < 1 ? 5.4 : 4.1));
    } else if (camState.mode === "teacher") {
      goalLook.set(-2.6, 1.0, 1.6);
      goalPos.set(-1.3, 2.0, camera.aspect < 1 ? 8.8 : 7.2);
      if (!performing) camState.mode = "wide";
    } else {
      wideShot(goalPos, goalLook);
      goalPos.x += Math.sin(clock * 0.07) * 0.6;
      goalPos.y += Math.sin(clock * 0.11) * 0.12;
    }
    const k = 1 - Math.exp(-dt * 1.8);
    camState.pos.lerp(goalPos, k);
    camState.look.lerp(goalLook, k);
    camera.position.copy(camState.pos);
    camera.lookAt(tmp.copy(camState.look));

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // a river that already has some life in it when the page opens
  for (let i = 0; i < 9; i++) {
    const k = spawnSimple(0, 0, false);
    randomSpot(k.root.position, true);
  }

  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });

  return api;
}

// ---------------------------------------------------------------------------
// Form (teacher only)
// ---------------------------------------------------------------------------

function setupForm(river) {
  let selectedCat = CATEGORIES[0].id;
  let photoSrc = null; // downscaled original
  let sticker = null; // { canvas, cut }
  let processing = null;
  let editing = null; // the krathong being edited, or null for a new one
  let previewUrl = null;

  const selectCat = (id) => {
    selectedCat = CAT[id] ? id : CATEGORIES[0].id;
    CATEGORIES.forEach((c, i) => els.cats.children[i]?.setAttribute("aria-pressed", String(c.id === selectedCat)));
  };
  for (const c of CATEGORIES) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${c.icon} ${c.label}`;
    b.style.setProperty("--c", c.color);
    b.addEventListener("click", () => selectCat(c.id));
    els.cats.appendChild(b);
  }
  selectCat(selectedCat);
  for (const w of WISH_PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = w;
    b.addEventListener("click", () => {
      els.wish.value = w;
    });
    els.presets.appendChild(b);
  }

  const open = () => {
    document.body.classList.add("sheet-open");
    els.error.textContent = "";
  };
  const close = () => {
    document.body.classList.remove("sheet-open");
    els.name.blur();
    els.wish.blur();
    // after an edit (saved or cancelled) stay on that krathong a moment;
    // a half-typed new krathong is kept as a draft instead
    if (editing) {
      if (editing.sinking == null) river.focusOn(editing, 10);
      reset();
    }
  };
  const reset = () => {
    editing = null;
    els.name.value = "";
    els.wish.value = "";
    els.photo.value = "";
    photoSrc = null;
    sticker = null;
    processing = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    els.photoPick.classList.remove("has-photo");
    els.photoPreview.removeAttribute("src");
    els.photoStatus.textContent = "";
    els.sheetTitle.textContent = "กระทงใบใหม่";
    els.submit.textContent = "ลอยกระทง ✨";
  };

  function openEdit(k) {
    reset();
    editing = k;
    const rec = k.rec;
    els.sheetTitle.textContent = "แก้ไขกระทง";
    els.submit.textContent = "บันทึก ✓";
    els.name.value = rec.name || "";
    els.wish.value = rec.wish || "";
    selectCat(rec.cat);
    if (rec.image) {
      previewUrl = URL.createObjectURL(rec.image);
      els.photoPreview.src = previewUrl;
      els.photoPick.classList.add("has-photo");
      els.photoStatus.textContent = "แตะรูปเพื่อเปลี่ยน";
    }
    // keep the camera on this krathong while the form is open
    river.focusOn(k, 3600);
    open();
  }

  els.floatBtn.addEventListener("click", () => {
    sound.unlock();
    if (editing) reset();
    open();
    setTimeout(() => els.name.focus(), 320);
  });
  els.cancel.addEventListener("click", close);
  els.backdrop.addEventListener("click", close);

  // ----- edit / delete bar for the krathong in close-up -----
  let focused = null;
  river.onFocus = (k) => {
    focused = k;
    els.focusBar.hidden = !k;
    if (k) els.focusName.textContent = k.rec?.name || "";
  };
  els.editBtn.addEventListener("click", () => focused && openEdit(focused));
  els.unfocusBtn.addEventListener("click", () => river.unfocus());
  els.deleteBtn.addEventListener("click", async () => {
    const k = focused;
    if (!k || !confirm(`ลบกระทงของ "${k.rec?.name || ""}" ?`)) return;
    await db.remove(k.rec.id);
    river.sinkKrathong(k);
    toast(`ลบกระทงของ ${k.rec?.name || ""} แล้ว`);
  });

  // ----- list of every student krathong -----
  const listUrls = [];
  function renderList() {
    for (const u of listUrls.splice(0)) URL.revokeObjectURL(u);
    els.listItems.textContent = "";
    const items = river.students().slice().reverse(); // newest first
    if (!items.length) {
      const d = document.createElement("div");
      d.className = "empty";
      d.textContent = "ยังไม่มีกระทง";
      els.listItems.appendChild(d);
      return;
    }
    for (const k of items) {
      const b = document.createElement("button");
      b.type = "button";
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = (CAT[k.rec.cat] || CATEGORIES[0]).color;
      b.appendChild(dot);
      if (k.rec.image) {
        const img = document.createElement("img");
        img.className = "thumb";
        const u = URL.createObjectURL(k.rec.image);
        listUrls.push(u);
        img.src = u;
        img.alt = "";
        b.appendChild(img);
      }
      b.appendChild(document.createTextNode(k.rec.name || "(ไม่มีชื่อ)"));
      b.addEventListener("click", () => {
        els.listPanel.hidden = true;
        if (k.placed) river.focusOn(k, 25);
      });
      els.listItems.appendChild(b);
    }
  }
  els.listBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (els.listPanel.hidden) renderList();
    els.listPanel.hidden = !els.listPanel.hidden;
  });
  document.addEventListener("pointerdown", (e) => {
    if (!els.listPanel.hidden && !els.listPanel.contains(e.target) && !els.listBtn.contains(e.target)) els.listPanel.hidden = true;
  });

  async function process() {
    if (!photoSrc) return;
    const token = {};
    processing = token;
    els.photoStatus.textContent = els.cut.checked ? "กำลังตัดพื้นหลัง…" : "";
    const result = await makeSticker(photoSrc, els.cut.checked);
    if (processing !== token) return;
    sticker = result;
    processing = null;
    els.photoPreview.src = result.canvas.toDataURL("image/png");
    els.photoPick.classList.add("has-photo");
    els.photoStatus.textContent = els.cut.checked ? (result.cut ? "ตัดพื้นหลังแล้ว ✓" : "หาตัวคนไม่เจอ ใช้กรอบรูปแทน") : "";
  }

  els.photo.addEventListener("change", async () => {
    const file = els.photo.files?.[0];
    if (!file) return;
    els.photoStatus.textContent = "กำลังโหลดรูป…";
    try {
      photoSrc = await loadPhoto(file);
      await process();
    } catch (err) {
      console.warn(err);
      photoSrc = null;
      els.photoStatus.textContent = "เปิดรูปนี้ไม่ได้ ลองรูปอื่น";
    }
  });
  els.cut.addEventListener("change", () => process());

  els.sheet.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.name.value.trim();
    const wish = els.wish.value.trim();
    if (!name) {
      els.error.textContent = "ใส่ชื่อก่อน";
      return;
    }
    if (processing) {
      els.error.textContent = "รอรูปสักครู่…";
      return;
    }
    let image = null;
    if (sticker) {
      image = await new Promise((r) => sticker.canvas.toBlob(r, "image/png"));
    }
    if (editing) {
      const old = editing;
      // a new photo replaces the old one; otherwise keep the stored image
      const rec = { ...old.rec, name, wish, cat: selectedCat, image: image || old.rec.image };
      await db.put(rec);
      if (old.sinking == null && river.krathongs.includes(old)) {
        editing = await river.rebuildKrathong(old, rec);
      }
      close();
      toast("บันทึกแล้ว");
      return;
    }
    const rec = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, wish, cat: selectedCat, image, createdAt: Date.now() };
    db.put(rec);
    const k = await river.studentKrathong(rec, { atDrop: true });
    river.enqueueFloat(k);
    close();
    reset();
  });

  els.clear.addEventListener("click", async () => {
    if (!confirm("ล้างกระทงของนักเรียนทั้งหมดออกจากแม่น้ำและเครื่องนี้?")) return;
    await db.clear();
    for (const k of [...river.krathongs]) if (!k.simple) river.disposeKrathong(k);
    river.updateCount();
    close();
    toast("ล้างแม่น้ำแล้ว");
  });

  const paintSound = () => (els.sound.textContent = sound.on ? "🔊" : "🔇");
  paintSound();
  els.sound.addEventListener("click", () => {
    sound.toggle();
    paintSound();
  });

  // warm the segmenter up in the background so the first photo is quick
  setTimeout(() => getSegmenter().catch(() => {}), 1500);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async () => {
  try {
    await document.fonts?.ready;
  } catch {}
  let river;
  try {
    river = mount();
  } catch (err) {
    console.error("[loykrathong]", err);
    return;
  }
  setupForm(river);
  const saved = await db.all();
  saved.sort((a, b) => a.createdAt - b.createdAt);
  for (const rec of saved) await river.studentKrathong(rec);
  els.loading.classList.add("done");
  setTimeout(() => (els.hint.style.opacity = "0"), 7000);
})();
