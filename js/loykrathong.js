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
// Kru Song faces the viewer, turned toward the water; she turns further to
// face the drop point while floating a krathong
const TEACHER_YAW = 0.45;
const TEACHER_YAW_FLOAT = 1.15;
const MAX_SIMPLE = 16;
const MAX_STUDENT = 80;

const els = {
  canvas: document.getElementById("river"),
  loading: document.getElementById("loading"),
  floatBtn: document.getElementById("floatBtn"),
  count: document.getElementById("count"),
  hint: document.getElementById("hint"),
  sound: document.getElementById("soundBtn"),
  wishes: document.getElementById("wishesBtn"),
  fs: document.getElementById("fsBtn"),
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
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Collects coloured primitives so a whole model merges into one
// vertex-coloured geometry (one draw call). `gradient` lightens a part
// toward white with height; `flat` gives it faceted low-poly shading;
// `colorAt(y)` colours it by its own local height (stripes, bands).
function partList() {
  const parts = [];
  const dummy = new THREE.Object3D();
  const add = (geo, color, setup, gradient = false, flat = false, colorAt = null) => {
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0, "XYZ");
    dummy.scale.set(1, 1, 1);
    setup?.(dummy);
    dummy.updateMatrix();
    parts.push({ geo, color: new THREE.Color(color), matrix: dummy.matrix.clone(), gradient, flat, colorAt });
  };
  return { parts, add };
}

function mergeParts(parts) {
  let count = 0;
  const prepared = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.computeBoundingBox();
    const yMin = g.boundingBox.min.y;
    const yMax = g.boundingBox.max.y;
    const local = g.attributes.position.array.slice();
    g.applyMatrix4(p.matrix);
    if (p.flat) g.computeVertexNormals();
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
      c.copy(p.colorAt ? p.colorAt(local[i * 3 + 1]) : p.color);
      if (p.gradient) c.lerp(white, clamp01((local[i * 3 + 1] - yMin) / (yMax - yMin || 1)) * 0.55);
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
  return merged;
}

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
// the sticker's shape filled with an off-white board colour
function silhouette(src) {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext("2d");
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "#efe8dc";
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

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

// A light's reflection on rippled water is a streak broken into bands.
// The bands scroll (map) under a fixed soft envelope (alphaMap), so the
// reflection shimmers without its ends moving.
function streakBandsTexture() {
  const c = makeCanvas(64, 256);
  const g = c.getContext("2d");
  for (let y = 0; y < 256; y += 2) {
    const band = Math.abs(Math.sin(y * 0.098) * Math.sin(y * 0.0245 + 1.3));
    const sway = Math.sin(y * 0.049) * 8;
    const w = 12 + band * 18;
    g.fillStyle = `rgba(255,255,255,${(0.25 + band * 0.75).toFixed(3)})`;
    g.fillRect(32 - w + sway, y, w * 2, 1.4);
  }
  const t = canvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function streakEnvelopeTexture() {
  const c = makeCanvas(64, 128);
  const g = c.getContext("2d");
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    const v = y / 127;
    const along = Math.sin(v * Math.PI) ** 0.7 * (1 - v * 0.55);
    for (let x = 0; x < 64; x++) {
      const u = (x - 31.5) / 32;
      const a = along * Math.exp(-u * u * 5);
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = canvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; // read as raw alpha
  return t;
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
// The face painted onto the front of a 3D head, on a transparent canvas.
// Eyes sit at u = 0.5 +/- 0.17 so they line up with the glasses rings.
// style "open": big anime eyes and a small open smile; "blink" / default:
// happy closed eyes.
function drawFace(style = "closed") {
  const c = makeCanvas(256, 144);
  const g = c.getContext("2d");
  const EYES = [84, 172];
  const EY = 68;
  // blush with a few soft hatch strokes
  for (const bx of [52, 204]) {
    const grad = g.createRadialGradient(bx, 96, 2, bx, 96, 20);
    grad.addColorStop(0, "rgba(255,110,140,0.55)");
    grad.addColorStop(1, "rgba(255,110,140,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(bx, 96, 22, 13, 0, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(230,80,110,0.55)";
    g.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(bx + i * 7 - 3, 101);
      g.lineTo(bx + i * 7 + 3, 92);
      g.stroke();
    }
  }
  g.lineCap = "round";
  g.lineJoin = "round";
  // brows
  g.strokeStyle = "#3a2420";
  g.lineWidth = 3;
  for (const ex of EYES) {
    const s = ex < 128 ? -1 : 1;
    g.beginPath();
    g.moveTo(ex - 13 * s, 38);
    g.quadraticCurveTo(ex, 31, ex + 14 * s, 37);
    g.stroke();
  }
  if (style === "open") {
    for (const ex of EYES) {
      const s = ex < 128 ? -1 : 1;
      // white of the eye, then a tall iris with a dark-to-warm gradient
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.ellipse(ex, EY + 2, 15, 17, 0, 0, TAU);
      g.fill();
      const iris = g.createLinearGradient(0, EY - 16, 0, EY + 18);
      iris.addColorStop(0, "#1e1210");
      iris.addColorStop(0.55, "#4a2c22");
      iris.addColorStop(1, "#a0684a");
      g.fillStyle = iris;
      g.beginPath();
      g.ellipse(ex, EY + 3, 12, 16, 0, 0, TAU);
      g.fill();
      g.fillStyle = "#120a08";
      g.beginPath();
      g.ellipse(ex, EY + 2, 5.5, 7.5, 0, 0, TAU);
      g.fill();
      // two highlights
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.ellipse(ex + 4, EY - 5, 4.5, 5.5, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(ex - 5, EY + 10, 2.2, 0, TAU);
      g.fill();
      // thick upper lash line with a flick at the outer corner
      g.strokeStyle = "#1a0f0c";
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(ex - 17 * s, EY - 6);
      g.quadraticCurveTo(ex, EY - 21, ex + 16 * s, EY - 10);
      g.lineTo(ex + 22 * s, EY - 15);
      g.stroke();
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(ex - 9, EY + 20);
      g.quadraticCurveTo(ex, EY + 22, ex + 9, EY + 20);
      g.stroke();
    }
    // small nose and an open, happy mouth
    g.strokeStyle = "rgba(160,90,80,0.7)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(128, 90);
    g.lineTo(126, 94);
    g.stroke();
    g.fillStyle = "#b8384f";
    g.beginPath();
    g.moveTo(116, 104);
    g.quadraticCurveTo(128, 107, 140, 104);
    g.quadraticCurveTo(128, 124, 116, 104);
    g.fill();
    g.fillStyle = "#ff8fa3";
    g.beginPath();
    g.ellipse(128, 113, 6, 3.5, 0, 0, TAU);
    g.fill();
    return c;
  }
  // closed, happy eyes (blink frame and everyone else's default face)
  g.strokeStyle = "#2a1a16";
  g.lineWidth = 5;
  for (const ex of EYES) {
    g.beginPath();
    g.arc(ex, EY + 8, 13, Math.PI * 1.12, Math.PI * 1.88);
    g.stroke();
  }
  g.lineWidth = 4;
  g.beginPath();
  g.arc(128, 100, 10, Math.PI * 0.15, Math.PI * 0.85);
  g.stroke();
  return c;
}

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

// Drawings, toys and photos against a plain backdrop (paper, a wall): the
// selfie segmenter only knows people, so flood-fill the backdrop in from
// the edges instead. Returns null when the backdrop isn't plain enough.
// Gaps in hand-drawn outlines are bridged by thickening the drawing a
// little before the fill, then the fill creeps back up to the real lines.
function cutoutPlain(src, minPlain = 0.85) {
  const fit = Math.min(1, 360 / Math.max(src.width, src.height));
  const w = Math.max(8, Math.round(src.width * fit));
  const h = Math.max(8, Math.round(src.height * fit));
  const small = makeCanvas(w, h);
  const sg = small.getContext("2d", { willReadFrequently: true });
  sg.drawImage(src, 0, 0, w, h);
  const px = sg.getImageData(0, 0, w, h).data;

  // the backdrop colour: per-channel median of the border pixels
  const edge = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
  const med = [0, 1, 2].map((ch) => {
    const v = edge.map((i) => px[i * 4 + ch]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const dist = (i) => Math.hypot(px[i * 4] - med[0], px[i * 4 + 1] - med[1], px[i * 4 + 2] - med[2]);
  let near = 0;
  let spread = 0;
  for (const i of edge) {
    const d = dist(i);
    if (d < 48) {
      near++;
      spread += d;
    }
  }
  if (near / edge.length < minPlain) return null;
  // tolerance follows how noisy the backdrop is (paper grain, shadows)
  const tol = Math.min(80, Math.max(38, (spread / Math.max(1, near)) * 3 + 26));
  const isBg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) isBg[i] = dist(i) < tol ? 1 : 0;

  // thicken the drawing by R px so small gaps in its outline block the fill
  const R = 2;
  const blocked = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isBg[y * w + x]) continue;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) blocked[yy * w + xx] = 1;
        }
      }
    }
  }
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (const i of edge) {
    if (!blocked[i] && !bg[i]) {
      bg[i] = 1;
      stack.push(i);
    }
  }
  const spreadFrom = (list, ok) => {
    while (list.length) {
      const i = list.pop();
      const x = i % w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (n >= 0 && n < w * h && !bg[n] && ok(n)) {
          bg[n] = 1;
          list.push(n);
        }
      }
    }
  };
  spreadFrom(stack, (n) => !blocked[n]);
  // creep back over the thickened band, R steps, only through backdrop
  for (let step = 0; step < R + 1; step++) {
    const front = [];
    for (let i = 0; i < w * h; i++) {
      if (bg[i] || !isBg[i]) continue;
      const x = i % w;
      if ((x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i + w < w * h && bg[i + w])) front.push(i);
    }
    for (const i of front) bg[i] = 1;
  }

  const mc = makeCanvas(w, h);
  const mctx = mc.getContext("2d");
  const img = mctx.createImageData(w, h);
  let covered = 0;
  for (let i = 0; i < w * h; i++) {
    if (!bg[i]) {
      img.data[i * 4 + 3] = 255;
      covered++;
    }
  }
  const frac = covered / (w * h);
  if (frac < 0.02 || frac > 0.95) return null;
  dropSpecks(img.data, w, h);
  mctx.putImageData(img, 0, 0);

  // scale the mask up with smoothing, which softens the edge
  const cut = makeCanvas(src.width, src.height);
  const c = cut.getContext("2d");
  c.drawImage(src, 0, 0);
  c.globalCompositeOperation = "destination-in";
  c.imageSmoothingQuality = "high";
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
    // People go through the segmenter. Drawings, toys and anything on a
    // plain backdrop are cut by the backdrop's colour instead: the segmenter
    // finds no person there, or only a sliver of the picture.
    let person = null;
    try {
      person = await cutoutPerson(src);
    } catch (err) {
      console.warn("[loykrathong] no person in photo", err);
    }
    const plain = cutoutPlain(src, person ? 0.85 : 0.6);
    const area = (cv) => (cv ? cv.width * cv.height : 0);
    art = person && area(person) >= area(plain) * 0.5 ? person : plain || person;
    cut = !!art;
    if (!art) console.warn("[loykrathong] cutout failed, using frame");
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
    moon: moonTexture(),
    dot: softDotTexture(),
    ring: ringTexture(),
    streakBands: streakBandsTexture(),
    streakEnv: streakEnvelopeTexture(),
  };

  // ----- sky -----
  // low in the sky on the right, so the full moon of the 12th month is in
  // the wide shot and its path on the water lines up under it. Portrait
  // screens look further down, so the moon sits lower there (see resize).
  const MOON_DIR = new THREE.Vector3(0.3, 0.2, -1).normalize();
  let moon, halo;
  function placeMoon(portrait) {
    MOON_DIR.set(portrait ? 0.24 : 0.3, portrait ? 0.1 : 0.2, -1).normalize();
    moon.position.copy(MOON_DIR).multiplyScalar(300);
    halo.position.copy(moon.position);
  }
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

    moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.moon, fog: false, depthWrite: false }));
    moon.scale.setScalar(26);
    scene.add(moon);
    halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.glow, color: 0xfff0c8, fog: false, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })
    );
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
        col += uMoon * (pow(m, 320.0) * 1.1 + pow(m, 40.0) * 0.12);
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
  const place = new THREE.Object3D(); // scratch transform for instancing
  const TEMPLE_X = 4.5;
  // Lights on the far shore that streak across the water:
  // { x, z (water edge), w, len, color, strength }
  const reflections = [];
  const FAR_EDGE = RIVER.farZ - 0.5;
  {
    // wide and deep, so the camera can turn all the way round
    const near = new THREE.Mesh(new THREE.BoxGeometry(220, 1.2, 40), new THREE.MeshLambertMaterial({ color: 0x1b2a1e }));
    near.position.set(0, -0.25, RIVER.nearZ + 20);
    scene.add(near);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(220, 0.25, 0.5), new THREE.MeshLambertMaterial({ color: 0x4a4438 }));
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

    const far = new THREE.Mesh(new THREE.BoxGeometry(260, 1.4, 30), new THREE.MeshLambertMaterial({ color: 0x15192e }));
    far.position.set(0, -0.15, RIVER.farZ - 15.5);
    scene.add(far);

    // low-poly trees: a round canopy tree and a coconut palm, instanced
    const roundTree = (() => {
      const { parts, add } = partList();
      add(new THREE.CylinderGeometry(0.12, 0.2, 1.8, 6), 0x3b2a1e, (d) => (d.position.y = 0.9), false, true);
      const blob = new THREE.IcosahedronGeometry(1, 0);
      add(blob, 0x1d4227, (d) => { d.position.set(0, 2.3, 0); d.scale.set(1.15, 0.95, 1.15); }, false, true);
      add(blob, 0x25502f, (d) => { d.position.set(0.55, 2.8, 0.15); d.scale.setScalar(0.78); }, false, true);
      add(blob, 0x183a22, (d) => { d.position.set(-0.6, 2.65, -0.2); d.scale.setScalar(0.72); }, false, true);
      add(blob, 0x2c5b36, (d) => { d.position.set(0.05, 3.25, -0.05); d.scale.setScalar(0.6); }, false, true);
      return mergeParts(parts);
    })();
    const palm = (() => {
      const { parts, add } = partList();
      const seg = new THREE.CylinderGeometry(0.11, 0.14, 0.9, 6);
      let x = 0;
      let y = 0;
      for (let i = 0; i < 6; i++) {
        const lean = 0.05 + i * 0.045;
        const cx = x + Math.sin(lean) * 0.45;
        const cy = y + Math.cos(lean) * 0.45;
        add(seg, i % 2 ? 0x4a3524 : 0x3e2c1f, (d) => { d.position.set(cx, cy, 0); d.rotation.z = -lean; }, false, true);
        x += Math.sin(lean) * 0.9;
        y += Math.cos(lean) * 0.9;
      }
      const frond = new THREE.BoxGeometry(0.5, 0.03, 1);
      frond.translate(0, 0, 0.5);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2;
        const L1 = 1.0;
        const p1 = -0.15;
        add(frond, 0x2a5f30, (d) => { d.position.set(x, y, 0); d.rotation.set(p1, a, 0, "YXZ"); d.scale.set(1, 1, L1); }, false, true);
        const ex = x + Math.sin(a) * Math.cos(p1) * L1;
        const ey = y - Math.sin(p1) * L1;
        const ez = Math.cos(a) * Math.cos(p1) * L1;
        add(frond, 0x22512a, (d) => { d.position.set(ex, ey, ez); d.rotation.set(0.75, a, 0, "YXZ"); d.scale.set(0.85, 1, 1.1); }, false, true);
      }
      const nut = new THREE.IcosahedronGeometry(0.13, 0);
      for (const a of [0, 2.1, 4.2]) add(nut, 0x5a4020, (d) => d.position.set(x + Math.cos(a) * 0.14, y - 0.12, Math.sin(a) * 0.14), false, true);
      return mergeParts(parts);
    })();

    const spots = { round: [], palm: [] };
    // far shore, leaving a gap for the temple
    for (let i = 0; i < 64; i++) {
      const x = rand(-80, 80);
      // keep the temple and the chedi in the clear
      if (Math.abs(x - TEMPLE_X) < 8 || Math.abs(x + 15) < 5.5) continue;
      const z = rand(RIVER.farZ - 10, RIVER.farZ - 3.5);
      if (Math.random() < 0.3) spots.palm.push([x, 0.55, z, rand(0.8, 1.25)]);
      else spots.round.push([x, 0.55, z, rand(1.2, 1.9)]);
    }
    // behind the viewer, seen once the camera is turned round
    for (let i = 0; i < 46; i++) {
      if (Math.random() < 0.3) spots.palm.push([rand(-70, 70), 0.35, rand(RIVER.nearZ + 17, RIVER.nearZ + 36), rand(0.8, 1.25)]);
      else spots.round.push([rand(-70, 70), 0.35, rand(RIVER.nearZ + 17, RIVER.nearZ + 36), rand(1.2, 2)]);
    }
    const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const tint = new THREE.Color();
    for (const [geo, list] of [[roundTree, spots.round], [palm, spots.palm]]) {
      const im = new THREE.InstancedMesh(geo, treeMat, list.length);
      list.forEach(([x, y, z, s], i) => {
        place.position.set(x, y, z);
        place.rotation.set(0, rand(0, TAU), 0);
        place.scale.setScalar(s);
        place.updateMatrix();
        im.setMatrixAt(i, place.matrix);
        im.setColorAt(i, tint.setScalar(rand(0.75, 1.1)));
      });
      im.frustumCulled = false;
      scene.add(im);
    }

    const temple = buildTemple();
    temple.position.set(TEMPLE_X, 0.55, RIVER.farZ - 7);
    temple.scale.setScalar(0.82);
    scene.add(temple);
    reflections.push({ x: TEMPLE_X, z: FAR_EDGE, w: 7, len: 11, color: 0xffc77a, strength: 0.32 });

    // golden chedi: stepped base, bell, throne, the ringed spire, a gold tip
    const chedi = new THREE.Group();
    const gold = new THREE.MeshLambertMaterial({ color: 0xffb627, emissive: 0x7a4a00 });
    const add = (geo, y, sy = 1) => {
      const m = new THREE.Mesh(geo, gold);
      m.position.y = y;
      m.scale.y = sy;
      chedi.add(m);
    };
    add(new THREE.CylinderGeometry(3.6, 4.0, 0.6, 20), 0.3);
    add(new THREE.CylinderGeometry(3.2, 3.5, 0.6, 20), 0.9);
    add(new THREE.CylinderGeometry(2.9, 3.1, 0.4, 20), 1.4);
    add(new THREE.SphereGeometry(2.6, 20, 12, 0, TAU, 0, Math.PI / 2), 1.6, 1.3);
    add(new THREE.CylinderGeometry(1.1, 1.25, 0.6, 12), 5.2);
    for (let i = 0; i < 7; i++) {
      const r = lerp(0.9, 0.45, i / 6);
      add(new THREE.CylinderGeometry(r, r + 0.06, 0.2, 14), 5.65 + i * 0.32);
    }
    add(new THREE.ConeGeometry(0.42, 4, 14), 9.8);
    add(new THREE.SphereGeometry(0.13, 10, 8), 11.85);
    chedi.position.set(-15, 0.5, RIVER.farZ - 14);
    scene.add(chedi);
    const chediGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.glow, color: 0xffb860, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    chediGlow.position.set(-15, 5, RIVER.farZ - 13);
    chediGlow.scale.setScalar(17);
    scene.add(chediGlow);
    reflections.push({ x: -15, z: FAR_EDGE, w: 4, len: 12, color: 0xffb860, strength: 0.3 });
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

  // ----- glow dots: many soft additive lights in one draw call -----
  // `size` is in world units; uScale (set in resize) converts it to pixels.
  const glowScale = { value: 600 };
  const glowTime = { value: 0 };
  function glowPoints(n, flicker = 0) {
    const pos = new Float32Array(n * 3).fill(-999);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) phase[i] = rand(0, TAU);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
    const points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: glowScale, uTime: glowTime, uFlicker: { value: flicker } },
        vertexShader: `
          attribute vec3 color; attribute float size; attribute float phase;
          uniform float uScale, uTime, uFlicker; varying vec3 vC;
          void main(){
            vC = color * (1.0 + uFlicker * (sin(uTime * 13.0 + phase) * 0.6 + sin(uTime * 23.0 + phase * 1.7) * 0.4));
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size > 0.0 ? size * uScale / -mv.z : 0.0;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying vec3 vC;
          void main(){
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            gl_FragColor = vec4(vC, exp(-d * d * 4.5) * (1.0 - d));
          }`,
      })
    );
    points.frustumCulled = false;
    scene.add(points);
    const c = new THREE.Color();
    let used = 0;
    return {
      pos,
      col,
      size,
      // append a glow; returns its index
      add(x, y, z, color, s, gain = 1) {
        const i = used++;
        pos.set([x, y, z], i * 3);
        c.set(color).multiplyScalar(gain);
        col.set([c.r, c.g, c.b], i * 3);
        size[i] = s;
        return i;
      },
      dirty() {
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.attributes.size.needsUpdate = true;
      },
    };
  }

  // string lights along the far shore, warm bokeh in the distance, clay
  // oil lamps (prateep) along the near bank, reeds, lilies and lotus
  {
    const cols = [0xffc76b, 0xff9f6b, 0xfff0b0, 0xff7fb0];
    const bulbs = glowPoints(110, 0.04);
    const wire = [];
    const BULB_Z = RIVER.farZ - 2.2;
    for (let x = -40; x <= 40; x += 1.6) {
      const sag = Math.sin(((x + 40) / 8) * Math.PI);
      const y = 3.4 - Math.abs(sag) * 0.5;
      const color = pick(cols);
      bulbs.add(x, y, BULB_Z, color, 0.55, 0.75);
      bulbs.add(x, y, BULB_Z, 0xffffff, 0.12, 0.9);
      wire.push(new THREE.Vector3(x, y + 0.06, BULB_Z));
      reflections.push({ x, z: FAR_EDGE, w: 0.6, len: 6.5, color, strength: 0.8 });
    }
    bulbs.dirty();
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wire), new THREE.LineBasicMaterial({ color: 0x2a2030 })));
    // a pole at every high point of the string
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.06, 3.5, 5), new THREE.MeshLambertMaterial({ color: 0x3a2c26 }), 11);
    for (let i = 0; i <= 10; i++) {
      place.position.set(-40 + i * 8, 0.55 + 1.7, BULB_Z);
      place.rotation.set(0, 0, 0);
      place.scale.setScalar(1);
      place.updateMatrix();
      poles.setMatrixAt(i, place.matrix);
    }
    scene.add(poles);

    const bokeh = glowPoints(40);
    for (let i = 0; i < 40; i++) bokeh.add(rand(-60, 60), rand(1, 9), rand(-70, -45), pick(cols), rand(2.5, 6), rand(0.15, 0.4));
    bokeh.dirty();

    // prateep: a little clay cup with a flame on the bank's stone edge
    const cupXs = [];
    for (let x = -30; x <= 30; x += 0.85) {
      if (Math.abs(x - PIER.x) < 1.2) continue;
      cupXs.push(x + rand(-0.12, 0.12));
    }
    const lamps = glowPoints(cupXs.length * 2, 0.14);
    const cups = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.075, 0.05, 0.07, 9),
      new THREE.MeshLambertMaterial({ color: 0xa8643a, emissive: 0x2a1006 }),
      cupXs.length
    );
    cupXs.forEach((x, i) => {
      const z = RIVER.nearZ + 0.2 + rand(-0.08, 0.08);
      place.position.set(x, 0.44, z);
      place.rotation.set(0, 0, 0);
      place.scale.setScalar(1);
      place.updateMatrix();
      cups.setMatrixAt(i, place.matrix);
      lamps.add(x, 0.53, z, 0xff9a3a, 0.75, 0.8);
      lamps.add(x, 0.51, z, 0xfff0c0, 0.12, 1);
    });
    cups.frustumCulled = false;
    scene.add(cups);
    lamps.dirty();

    // reeds at both ends of the near bank, clear of the middle of the view
    const reedGeo = new THREE.ConeGeometry(0.025, 1, 3);
    reedGeo.translate(0, 0.5, 0);
    const REEDS = 320;
    const reeds = new THREE.InstancedMesh(reedGeo, new THREE.MeshLambertMaterial({ color: 0x35502a }), REEDS);
    for (let r = 0; r < REEDS; ) {
      const x = rand(-30, 30);
      if (Math.abs(x) < 4.6 || Math.abs(x - PIER.x) < 1.4) continue;
      place.position.set(x, 0.35, RIVER.nearZ + rand(0.5, 1.8));
      place.rotation.set(rand(-0.2, 0.2), rand(0, TAU), rand(-0.2, 0.2));
      place.scale.set(1, rand(0.35, 0.95), 1);
      place.updateMatrix();
      reeds.setMatrixAt(r++, place.matrix);
    }
    reeds.frustumCulled = false;
    scene.add(reeds);

    // lily pads with pink lotus, near both banks
    const padGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.02, 14, 1, false, 0.35, TAU - 0.35);
    const lotusGeo = (() => {
      const { parts, add } = partList();
      const petal = new THREE.SphereGeometry(0.1, 8, 6);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        add(petal, 0xe8609c, (d) => {
          d.position.set(Math.cos(a) * 0.12, 0.06, Math.sin(a) * 0.12);
          d.rotation.set(0, -a, -0.95, "YZX");
          d.scale.set(0.5, 1.4, 0.85);
        }, true);
      }
      for (let i = 0; i < 6; i++) {
        const a = ((i + 0.5) / 6) * TAU;
        add(petal, 0xf58ab8, (d) => {
          d.position.set(Math.cos(a) * 0.06, 0.1, Math.sin(a) * 0.06);
          d.rotation.set(0, -a, -0.35, "YZX");
          d.scale.set(0.45, 1.3, 0.8);
        }, true);
      }
      add(new THREE.SphereGeometry(0.05, 8, 6), 0xffd84a, (d) => d.position.set(0, 0.1, 0));
      return mergeParts(parts);
    })();
    const padSpots = [];
    for (let i = 0; i < 90 && padSpots.length < 44; i++) {
      const nearSide = i % 2 === 0;
      const x = nearSide ? (Math.random() < 0.5 ? rand(-17, -5.5) : rand(4.5, 19)) : rand(-17, 19);
      const z = nearSide ? rand(RIVER.nearZ - 1.3, RIVER.nearZ - 0.35) : rand(FAR_EDGE + 0.3, FAR_EDGE + 2.2);
      if (padSpots.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.75)) continue;
      padSpots.push([x, z]);
    }
    const pads = new THREE.InstancedMesh(padGeo, new THREE.MeshLambertMaterial({ color: 0x2c5a2a }), padSpots.length);
    const flowers = padSpots.filter((_, i) => i % 3 === 0);
    const lotus = new THREE.InstancedMesh(lotusGeo, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a0c18 }), flowers.length);
    padSpots.forEach(([x, z], i) => {
      place.position.set(x, 0.012, z);
      place.rotation.set(0, rand(0, TAU), 0);
      place.scale.setScalar(rand(0.75, 1.15));
      place.updateMatrix();
      pads.setMatrixAt(i, place.matrix);
    });
    flowers.forEach(([x, z], i) => {
      place.position.set(x + 0.08, 0.02, z - 0.05);
      place.rotation.set(0, rand(0, TAU), 0);
      place.scale.setScalar(rand(1, 1.4));
      place.updateMatrix();
      lotus.setMatrixAt(i, place.matrix);
    });
    pads.frustumCulled = lotus.frustumCulled = false;
    scene.add(pads, lotus);
  }

  // reflections of the far-shore lights; each streak turns toward the camera
  // every frame, the way a reflection always runs toward the viewer
  const streakGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
  const streakMat = (color) =>
    new THREE.MeshBasicMaterial({ color, map: tex.streakBands, alphaMap: tex.streakEnv, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const streaks = new THREE.InstancedMesh(streakGeo, streakMat(0xffffff), reflections.length);
  {
    const c = new THREE.Color();
    reflections.forEach((r, i) => streaks.setColorAt(i, c.set(r.color).multiplyScalar(r.strength)));
  }
  streaks.frustumCulled = false;
  scene.add(streaks);
  function updateStreaks() {
    reflections.forEach((r, i) => {
      place.position.set(r.x, 0.012, r.z);
      place.rotation.set(0, Math.atan2(camera.position.x - r.x, camera.position.z - r.z), 0);
      place.scale.set(r.w, 1, r.len);
      place.updateMatrix();
      streaks.setMatrixAt(i, place.matrix);
    });
    streaks.instanceMatrix.needsUpdate = true;
  }
  // one shared streak material for every krathong flame
  const krathongStreakMat = streakMat(0xb06a30);

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

  // sky lanterns (khom loi): paper lanterns lit from inside, all instanced,
  // with one glow dot each
  const MAX_LANTERNS = 64;
  const lanterns = [];
  const lanternMesh = (() => {
    const { parts, add } = partList();
    const bands = [
      [0.24, 0.255, 0xc8882e],
      [0.255, 0.28, 0xb4561c],
      [0.28, 0.3, 0x8a3410],
    ];
    bands.forEach(([r0, r1, color], i) => {
      add(new THREE.CylinderGeometry(r1, r0, 0.25, 12, 1, true), color, (d) => (d.position.y = -0.25 + i * 0.25));
    });
    add(new THREE.CircleGeometry(0.3, 12), 0x5a1e08, (d) => {
      d.position.y = 0.125;
      d.rotation.x = -Math.PI / 2;
    });
    add(new THREE.SphereGeometry(0.06, 8, 6), 0xfff2b0, (d) => (d.position.y = -0.3));
    const m = new THREE.InstancedMesh(
      mergeParts(parts),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      MAX_LANTERNS
    );
    m.count = 0;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  })();
  const lanternGlow = glowPoints(MAX_LANTERNS);
  function addLantern(pos, risen = 0, held = null) {
    const l = { p: pos.clone(), vy: rand(0.45, 0.8), phase: rand(0, TAU), drift: rand(-0.15, 0.25), held, a: 1 };
    l.p.y += risen;
    lanterns.push(l);
    return l;
  }
  const lanternTint = new THREE.Color();
  function drawLanterns() {
    const n = Math.min(lanterns.length, MAX_LANTERNS);
    for (let i = 0; i < n; i++) {
      const l = lanterns[i];
      place.position.copy(l.p);
      place.rotation.set(Math.sin(clock * 0.7 + l.phase) * 0.08, l.phase, Math.sin(clock * 0.5 + l.phase) * 0.08);
      place.scale.setScalar(1);
      place.updateMatrix();
      lanternMesh.setMatrixAt(i, place.matrix);
      lanternMesh.setColorAt(i, lanternTint.setScalar(l.a));
      lanternGlow.pos.set([l.p.x, l.p.y - 0.1, l.p.z], i * 3);
      lanternGlow.col.set([1 * l.a * 0.55, 0.6 * l.a * 0.55, 0.25 * l.a * 0.55], i * 3);
      lanternGlow.size[i] = 2.2;
    }
    for (let i = n; i < MAX_LANTERNS; i++) lanternGlow.size[i] = 0;
    lanternMesh.count = n;
    lanternMesh.instanceMatrix.needsUpdate = true;
    if (lanternMesh.instanceColor) lanternMesh.instanceColor.needsUpdate = true;
    lanternGlow.dirty();
  }
  // the sky already has lanterns drifting when the page opens
  for (let i = 0; i < 26; i++) addLantern(new THREE.Vector3(rand(-40, 40), 0, rand(-70, -15)), rand(4, 40));

  // ----- krathong geometry (merged per category, vertex coloured) -----
  const geoCache = new Map();
  function krathongGeometry(catColor) {
    if (geoCache.has(catColor)) return geoCache.get(catColor);
    const { parts, add } = partList();
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

    const merged = mergeParts(parts);
    geoCache.set(catColor, merged);
    return merged;
  }
  const krathongMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a160c });

  // ----- krathongs -----
  // unit card, bottom edge at the origin, scaled per photo
  const cardGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const CARD_T = 0.1;
  const CARD_LAYERS = 9;
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
    // the flame's reflection, turned toward the camera each frame
    const streak = new THREE.Mesh(streakGeo, krathongStreakMat);
    streak.position.y = 0.014;
    streak.scale.set(0.5, 1, 2.8);
    root.add(streak);

    const k = { root, spin, flame, glow, pool, streak, card: null, bubble: null, tag: null, speed: rand(0.12, 0.2), target: new THREE.Vector3(), vel: new THREE.Vector3(), retarget: 0, phase: rand(0, TAU), spinRate: rand(-0.12, 0.12), placed: true, textures: [] };

    if (card) {
      // the cut-out photo as a standee with real thickness: the photo on
      // the front, then a stack of white silhouette layers behind it that
      // read as the board's edge and back when seen from the side
      const t = canvasTexture(card);
      const sil = canvasTexture(silhouette(card));
      k.textures.push(t, sil);
      const h = 1.55;
      const standee = new THREE.Group();
      standee.position.y = 0.2;
      standee.scale.set((h * card.width) / card.height, h, 1);
      const front = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.5 }));
      front.position.z = CARD_T / 2 + 0.002;
      front.userData.krathong = k;
      const edge = new THREE.InstancedMesh(cardGeo, new THREE.MeshLambertMaterial({ map: sil, alphaTest: 0.5, side: THREE.DoubleSide }), CARD_LAYERS);
      for (let i = 0; i < CARD_LAYERS; i++) {
        place.position.set(0, 0, lerp(-CARD_T / 2, CARD_T / 2, i / (CARD_LAYERS - 1)));
        place.rotation.set(0, 0, 0);
        place.scale.setScalar(1);
        place.updateMatrix();
        edge.setMatrixAt(i, place.matrix);
      }
      standee.add(front, edge);
      root.add(standee);
      k.card = front;
      k.cardEdge = edge;
      k.standee = standee;
      k.cardH = h;
      k.cardYaw = 0;
      pickables.push(front);
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
      k.bubbleScale = s.scale.clone();
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
    for (const s of [k.flame, k.glow, k.card, k.cardEdge, k.bubble, k.tag]) s?.material.dispose();
    k.cardEdge?.dispose();
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

  // ----- characters: cute 3D people (big head, toon shading) -----
  // Built 1.8 units tall facing +z. The body and each arm are one merged
  // mesh; the head is its own group (scaled up for a chibi look) holding
  // the head + hair mesh, the painted face and small accessories. With
  // `outline` set, dark back-face shells give a cel-animation edge.
  const people = [];
  const HEAD_R = 0.17;
  const NECK_Y = 1.2;
  // one material per outline (people fade on their own); the shell is the
  // mesh pushed out along its normals
  function outlineMat(width) {
    const m = new THREE.MeshBasicMaterial({ color: 0x2a1626, side: THREE.BackSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", `vec3 transformed = position + normal * ${width.toFixed(4)};`);
    };
    m.customProgramCacheKey = () => "outline" + width;
    return m;
  }
  function withOutline(mesh, width, on) {
    if (on) mesh.add(new THREE.Mesh(mesh.geometry, outlineMat(width)));
    return mesh;
  }
  // lathe from (radius, y) pairs
  const lathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

  function buildPerson(look, height, yaw = 0) {
    const skin = look.skin || "#f6d2b8";
    const hair = look.hair || "#2b1b17";
    const top = look.top || "#ffffff";
    const sleeve = look.sleeve || top;
    const outline = !!look.outline;
    const hs = look.headScale || 1.2;
    const group = new THREE.Group();
    const inner = new THREE.Group(); // leans/squats around the feet
    inner.scale.setScalar(height / 1.8);
    group.add(inner);
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, emissive: 0x24160c });

    // body: shoes, legs or skirt, a waisted torso, collar, neck
    const body = partList();
    const b = body.add;
    // legs hang from hip pivots so walkers can stride; under a skirt only
    // the ankles and shoes show, so their pivot sits just above the hem
    const HIP_Y = look.skirt ? 0.22 : 0.78;
    const legGeo = (() => {
      const { parts, add } = partList();
      if (look.skirt) add(new THREE.CylinderGeometry(0.03, 0.028, 0.16, 8), skin, (d) => (d.position.y = 0.12 - HIP_Y));
      else add(new THREE.CylinderGeometry(0.058, 0.048, 0.7, 10), look.pants || "#33406b", (d) => (d.position.y = 0.42 - HIP_Y));
      add(new THREE.SphereGeometry(0.06, 10, 8), look.shoes || "#5a3a2a", (d) => { d.position.set(0, 0.035 - HIP_Y, 0.025); d.scale.set(1, 0.6, 1.55); });
      return mergeParts(parts);
    })();
    const legs = [];
    for (const x of look.skirt ? [-0.055, 0.055] : [-0.065, 0.065]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, HIP_Y, 0);
      pivot.add(withOutline(new THREE.Mesh(legGeo, mat), 0.005, outline));
      inner.add(pivot);
      legs.push(pivot);
    }
    if (look.skirt) {
      // flared pha sin with soft folds and woven gold bands
      // the profile is sampled densely, with extra rings at each band edge,
      // so the vertex-coloured bands stay crisp
      const ctrl = [[0.235, 0.14], [0.228, 0.24], [0.2, 0.42], [0.162, 0.6], [0.128, 0.74], [0.12, 0.8]];
      const radiusAt = (y) => {
        for (let i = 1; i < ctrl.length; i++) {
          if (y <= ctrl[i][1]) return lerp(ctrl[i - 1][0], ctrl[i][0], (y - ctrl[i - 1][1]) / (ctrl[i][1] - ctrl[i - 1][1]));
        }
        return ctrl[ctrl.length - 1][0];
      };
      const ys = [0.14, 0.159, 0.161, 0.199, 0.201, 0.224, 0.226, 0.239, 0.241, 0.3, 0.4, 0.5, 0.6, 0.68, 0.739, 0.741, 0.8];
      const skirt = lathe([[0, 0.14], ...ys.map((y) => [radiusAt(y), y]), [0, 0.8]], 32);
      const sp = skirt.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const x = sp.getX(i);
        const z = sp.getZ(i);
        const fold = 1 + 0.055 * clamp01((0.78 - sp.getY(i)) / 0.6) * Math.sin(Math.atan2(z, x) * 11);
        sp.setX(i, x * fold);
        sp.setZ(i, z * fold);
      }
      skirt.computeVertexNormals();
      const base = new THREE.Color(look.skirt);
      const band = new THREE.Color(look.skirtBand || look.skirt);
      b(skirt, look.skirt, null, false, false, (y) => {
        const gold = (y > 0.16 && y < 0.2) || (y > 0.225 && y < 0.24) || y > 0.74;
        if (y <= 0.141) return band; // the hem underneath
        return gold ? band : base;
      });
    } else {
      b(new THREE.CylinderGeometry(0.13, 0.125, 0.12, 16), look.pants || "#33406b", (d) => { d.position.y = 0.78; d.scale.z = 0.78; });
    }
    b(lathe([[0.0, 0.76], [0.118, 0.77], [0.122, 0.82], [0.135, 0.92], [0.148, 1.0], [0.145, 1.07], [0.128, 1.13], [0.09, 1.18], [0.04, 1.2], [0.0, 1.2]]), top, (d) => (d.scale.z = 0.78));
    // lace hem and collar
    b(new THREE.TorusGeometry(0.124, 0.014, 6, 24), look.lace || top, (d) => { d.position.y = 0.8; d.rotation.x = Math.PI / 2; d.scale.set(1, 0.78, 1); });
    b(new THREE.TorusGeometry(0.075, 0.016, 6, 20), look.lace || top, (d) => { d.position.set(0, 1.175, 0.008); d.rotation.x = Math.PI / 2 - 0.25; d.scale.set(1, 0.85, 1); });
    if (look.sash) {
      // a pha sabai across the chest, over the left shoulder
      b(new THREE.BoxGeometry(0.075, 0.5, 0.24), look.sash, (d) => { d.position.set(0.01, 1.0, 0); d.rotation.z = -0.55; });
    }
    if (look.pendant) {
      b(new THREE.TorusGeometry(0.065, 0.003, 4, 20, Math.PI), "#e8d6b0", (d) => { d.position.set(0, 1.14, 0.075); d.rotation.set(0.35, 0, Math.PI); });
      b(new THREE.SphereGeometry(0.016, 8, 6), look.pendant, (d) => { d.position.set(0, 1.075, 0.118); d.scale.y = 1.4; });
    }
    b(new THREE.CylinderGeometry(0.035, 0.04, 0.09, 10), skin, (d) => (d.position.y = NECK_Y + 0.02));
    inner.add(withOutline(new THREE.Mesh(mergeParts(body.parts), mat), 0.006, outline));

    // head group, pivoting at the neck so it can tilt
    const head = new THREE.Group();
    head.position.y = NECK_Y + 0.04;
    head.scale.setScalar(hs);
    inner.add(head);
    const C = HEAD_R * 0.95; // head centre above the pivot
    const hp = partList();
    const h = hp.add;
    h(new THREE.SphereGeometry(HEAD_R, 24, 18), skin, (d) => { d.position.y = C; d.scale.set(1.03, 1, 0.95); });
    // ears
    for (const x of [-1, 1]) h(new THREE.SphereGeometry(0.03, 8, 6), skin, (d) => { d.position.set(x * HEAD_R * 1.0, C - 0.01, -0.01); d.scale.set(0.6, 1, 0.8); });
    // hair: a puffy cap tilted back off the forehead, a fuller back, side-swept bangs
    h(new THREE.SphereGeometry(HEAD_R + 0.02, 24, 12, 0, TAU, 0, Math.PI * 0.56), hair, (d) => { d.position.y = C + 0.012; d.rotation.x = -0.38; d.scale.set(1.07, 1.08, 1.05); });
    h(new THREE.SphereGeometry(HEAD_R + 0.018, 18, 10, Math.PI, Math.PI, Math.PI * 0.25, Math.PI * 0.55), hair, (d) => { d.position.y = C; d.scale.set(1.06, 1.04, 1.06); });
    const bang = new THREE.ConeGeometry(0.05, 0.13, 6);
    for (let i = 0; i < 7; i++) {
      const a = -0.95 + (i / 6) * 1.9;
      const len = 1 - Math.abs(a) * 0.25;
      h(bang, hair, (d) => {
        d.position.set(Math.sin(a) * (HEAD_R + 0.008), C + 0.085 - Math.abs(a) * 0.035, Math.cos(a) * (HEAD_R + 0.008) * 0.95);
        d.rotation.set(Math.PI - 0.32, a, 0.28, "YXZ");
        d.scale.set(1, len, 0.42);
      });
    }
    // glossy "angel ring" highlight across the crown
    h(new THREE.TorusGeometry(HEAD_R * 1.06 + 0.012, 0.006, 4, 32, Math.PI * 1.1), look.hairShine || "#6a4c44", (d) => {
      d.position.set(0, C + 0.075, -0.027);
      d.rotation.set(Math.PI / 2 - 0.38, 0, Math.PI * -0.05);
    });
    if (look.sidelocks || look.openEyes) {
      for (const x of [-1, 1]) {
        h(new THREE.CylinderGeometry(0.024, 0.01, 0.2, 6), hair, (d) => {
          d.position.set(x * HEAD_R * 0.93, C - 0.07, 0.07);
          d.rotation.z = -x * 0.1;
          d.scale.z = 0.6;
        });
      }
    }
    if (look.longHair) h(new THREE.CylinderGeometry(0.17, 0.2, 0.36, 16, 1, false, Math.PI * 0.5, Math.PI), hair, (d) => d.position.set(0, C - 0.17, -0.02));
    if (look.bun) h(new THREE.SphereGeometry(0.1, 14, 10), hair, (d) => d.position.set(0, C + 0.21, -0.07));
    if (look.scrunchie) {
      // fluffy scrunchie round the bun, in puffs
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        h(new THREE.SphereGeometry(0.03, 8, 6), look.scrunchie, (d) => d.position.set(Math.cos(a) * 0.082, C + 0.155 + Math.sin(a) * 0.082 * 0.35, -0.07 + Math.sin(a) * 0.082 * 0.9));
      }
    }
    if (look.flower) {
      const fx = 0.12;
      const fy = C + 0.15;
      const fz = 0.02;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        h(new THREE.SphereGeometry(0.03, 6, 5), "#ffffff", (d) => d.position.set(fx + Math.cos(a) * 0.032, fy + Math.sin(a) * 0.032, fz));
      }
      h(new THREE.SphereGeometry(0.02, 6, 5), "#ffd84a", (d) => d.position.set(fx, fy, fz + 0.016));
    }
    head.add(withOutline(new THREE.Mesh(mergeParts(hp.parts), mat), 0.005, outline));

    // face painted on a patch of sphere just in front of the head
    const faces = { open: canvasTexture(drawFace(look.openEyes ? "open" : "closed")) };
    if (look.openEyes) faces.blink = canvasTexture(drawFace("blink"));
    const faceMat = new THREE.MeshToonMaterial({ map: faces.open, transparent: true, emissive: 0x24160c });
    const face = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R + 0.004, 18, 12, Math.PI * 0.5 - 0.75, 1.5, Math.PI * 0.5 - 0.3, 0.84), faceMat);
    face.position.y = C;
    face.scale.set(1.03, 1, 0.95);
    head.add(face);

    // accessories without an outline: glasses, hair clip
    const acc = partList();
    if (look.glasses) {
      const ring = new THREE.TorusGeometry(0.043, 0.005, 6, 24);
      for (const x of [-0.045, 0.045]) acc.add(ring, look.glasses, (d) => d.position.set(x, C - 0.016, 0.172));
      acc.add(new THREE.BoxGeometry(0.012, 0.005, 0.005), look.glasses, (d) => d.position.set(0, C - 0.008, 0.174));
      for (const x of [-1, 1]) {
        acc.add(new THREE.BoxGeometry(0.005, 0.005, 0.16), look.glasses, (d) => {
          d.position.set(x * 0.158, C - 0.012, 0.09);
          d.rotation.y = x * 0.12;
        });
      }
    }
    if (look.hairClip) {
      for (const dx of [0, 0.03]) {
        acc.add(new THREE.BoxGeometry(0.022, 0.066, 0.014), look.hairClip, (d) => {
          d.position.set(0.09 + dx, C + 0.105, 0.135);
          d.rotation.set(-0.55, 0, -0.4);
        });
      }
    }
    if (acc.parts.length) head.add(new THREE.Mesh(mergeParts(acc.parts), mat));

    // arms hang from shoulder pivots; rotation.z swings them out to the
    // side, rotation.x reaches them forward
    const armGeo = (() => {
      const { parts, add } = partList();
      if (look.puffSleeve) add(new THREE.SphereGeometry(0.07, 12, 10), sleeve, (d) => { d.position.y = -0.04; d.scale.set(1, 0.9, 1); });
      else add(new THREE.CylinderGeometry(0.048, 0.044, 0.16, 10), sleeve, (d) => (d.position.y = -0.07));
      add(new THREE.CylinderGeometry(0.03, 0.027, 0.22, 10), skin, (d) => (d.position.y = -0.19));
      add(new THREE.CylinderGeometry(0.027, 0.023, 0.2, 10), skin, (d) => (d.position.y = -0.38));
      add(new THREE.SphereGeometry(0.034, 10, 8), skin, (d) => { d.position.y = -0.5; d.scale.set(1, 1.15, 0.8); });
      return mergeParts(parts);
    })();
    const arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.165, 1.13, 0);
      pivot.add(withOutline(new THREE.Mesh(armGeo, mat), 0.005, outline));
      inner.add(pivot);
      arms.push(pivot);
    }
    const hand = new THREE.Object3D(); // right hand tip, for carrying things
    hand.position.y = -0.52;
    arms[1].add(hand);
    group.rotation.y = yaw;
    scene.add(group);
    // top of the head (with a bun) in group space, for name tags
    const topY = (NECK_Y + 0.04 + (C + (look.bun ? 0.31 : HEAD_R + 0.03)) * hs) * (height / 1.8);
    const p = { group, inner, head, arms, legs, stride: 0, walk: 0, hand, height, yaw, topY, faces, faceMat, blinkAt: rand(1, 4), t: rand(0, 10), pose: { tilt: 0, squat: 0, armL: -0.12, armR: 0.12 } };
    people.push(p);
    return p;
  }
  const teacher = buildPerson(
    // Kru Song as a cartoon: top bun with a white scrunchie, face-framing
    // strands, a white two-bar hair clip, thin round gold glasses, a white
    // lace puff-sleeve blouse with a pink pendant, and a festival pha sin
    {
      skin: "#fbe0cf",
      hair: "#1c1310",
      hairShine: "#5e443c",
      headScale: 1.42,
      outline: true,
      lace: "#ffffff",
      bun: true,
      scrunchie: "#fbf7ef",
      sidelocks: true,
      hairClip: "#f1efdd",
      glasses: "#d6b48c",
      openEyes: true,
      top: "#fdf8f2",
      sleeve: "#fdf8f2",
      puffSleeve: true,
      pendant: "#e88ab8",
      skirt: "#d9548f",
      skirtBand: "#ffd27a",
      shoes: "#b0605a",
    },
    1.9,
    TEACHER_YAW
  );
  teacher.group.position.copy(TEACHER_POS);
  {
    const c = drawNameTag("สองสอง", "#ffd98a");
    const t = canvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    s.scale.set((0.36 * c.width) / c.height, 0.36, 1);
    s.center.set(0.5, 0);
    s.position.y = teacher.topY + 0.06;
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
    // far-shore people face the river and the viewer; near-bank people
    // face the river, turned a little toward the middle
    const yaw = spot.near ? Math.PI - Math.sign(spot.x) * 0.55 : rand(-0.25, 0.25);
    const p = buildPerson(looks[i % looks.length], spot.near ? 1.75 : 1.85, yaw);
    p.group.position.set(spot.x, spot.near ? 0.3 : 0.55, spot.z);
    p.act = spot.act;
    p.near = !!spot.near;
    p.next = rand(1, 8);
    p.busy = 0;
    return p;
  });

  // Visitors strolling round the fair: a lane along the far shore (behind
  // the people at the water's edge, in front of the temple) and the two
  // ends of the near bank. They walk to a random spot, stop to look at the
  // river for a while, then move on. Some are children.
  const walkerLooks = [
    { skin: "#f3cdb0", hair: "#22150f", longHair: true, top: "#ffb3c8", skirt: "#7a5cff", skirtBand: "#ffd27a" },
    { skin: "#e2b08b", hair: "#1a120e", top: "#ffe08a", pants: "#3b4a7a" },
    { skin: "#f5d3bd", hair: "#3a2416", bun: true, flower: true, top: "#ffffff", sash: "#e85d8a", skirt: "#2f8a6a", skirtBand: "#ffd27a" },
    { skin: "#d9a57c", hair: "#140d0a", top: "#8fd3ff", pants: "#2f3a4a" },
    { skin: "#f0c6a6", hair: "#2a1a12", top: "#c9f2a7", skirt: "#ff9f6b", skirtBand: "#fff1c2" },
    { skin: "#e9bc98", hair: "#1d1410", top: "#ff8a8a", pants: "#4b3b70" },
  ];
  const LANES = [
    { y: 0.55, z: RIVER.farZ - 2.9, x0: -32, x1: 34, river: 0 },
    { y: 0.35, z: RIVER.nearZ + 3.2, x0: -30, x1: -6.5, river: Math.PI },
    { y: 0.35, z: RIVER.nearZ + 3.2, x0: 6.5, x1: 30, river: Math.PI },
  ];
  const walkers = [];
  for (let i = 0; i < 13; i++) {
    const lane = LANES[i < 9 ? 0 : 1 + (i % 2)];
    const kid = i % 4 === 3;
    const look = { ...walkerLooks[i % walkerLooks.length], headScale: kid ? 1.4 : 1.2 };
    const p = buildPerson(look, kid ? 1.25 : rand(1.7, 1.9), 0);
    p.lane = lane;
    p.group.position.set(rand(lane.x0, lane.x1), lane.y, lane.z + rand(-0.4, 0.4));
    p.goal = p.group.position.x;
    p.speed = kid ? rand(0.75, 0.95) : rand(0.5, 0.75);
    p.pause = rand(0, 4);
    walkers.push(p);
  }
  function walkAbout(dt) {
    for (const p of walkers) {
      const g = p.group.position;
      const dx = p.goal - g.x;
      let moving = false;
      if (p.pause > 0) {
        p.pause -= dt;
        if (p.pause <= 0) {
          const L = p.lane;
          p.goal = Math.min(L.x1, Math.max(L.x0, g.x + rand(4, 14) * (Math.random() < 0.5 ? -1 : 1)));
        }
      } else if (Math.abs(dx) < 0.1) {
        p.pause = rand(2, 7);
      } else {
        moving = true;
        g.x += Math.sign(dx) * Math.min(Math.abs(dx), p.speed * dt);
        p.stride += dt * p.speed * 7.5;
      }
      // turn toward where they're going, or to the river while stopped
      const want = moving ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : p.lane.river;
      p.group.rotation.y += wrapAngle(want - p.group.rotation.y) * Math.min(1, dt * 4);
      p.walk += ((moving ? 1 : 0) - p.walk) * Math.min(1, dt * 6);
    }
  }

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
    orbit.lastInput = -1e9; // recentre on the krathong
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
      orbit.lastInput = -1e9;
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
        if (!p.held && u < 0.6) p.held = addLantern(p.group.position, 0, p);
        if (p.held) {
          // held up over the head, lit a little more as it fills with hot air
          p.held.p.set(0, p.height + 0.4, 0.05);
          p.group.localToWorld(p.held.p);
          p.held.a = 0.4 + 0.6 * smooth(clamp01(u * 2));
          if (u > 0.6) {
            p.held.held = null;
            p.held = null;
          }
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
  // Arm angles keep the paper-puppet convention: positive armR / negative
  // armL swing an arm out to the side. Swinging inward reaches forward
  // instead, so arms carry things in front rather than through the body.
  function aimArm(pivot, side, angle, sway) {
    const out = side * angle;
    if (out >= 0) {
      pivot.rotation.set(0, 0, side * (out + sway));
    } else {
      pivot.rotation.set(Math.min(0, out * 1.3), 0, side * (out * 0.25 + sway));
    }
  }
  function poseAll(dt) {
    for (const p of people) {
      p.t += dt;
      const q = p.pose;
      if (p === teacher) {
        const want = performing ? TEACHER_YAW_FLOAT : TEACHER_YAW;
        p.group.rotation.y += (want - p.group.rotation.y) * Math.min(1, dt * 3);
      }
      const breathe = Math.sin(p.t * 1.6) * 0.012;
      // crouching leans forward over the water
      p.inner.rotation.x = -q.tilt * 0.9;
      p.inner.rotation.z = Math.sin(p.t * 0.9) * 0.02;
      p.inner.scale.y = (p.height / 1.8) * (1 - q.squat * 0.25 + breathe);
      p.inner.position.y = -q.squat * 0.1;
      aimArm(p.arms[0], -1, q.armL, Math.sin(p.t * 1.3) * 0.04);
      aimArm(p.arms[1], 1, q.armR, -Math.sin(p.t * 1.3 + 1) * 0.04);
      // walking: legs stride, arms swing the other way, a little bob
      if (p.walk > 0.001) {
        const sw = Math.sin(p.stride);
        p.legs[0].rotation.x = sw * 0.5 * p.walk;
        p.legs[1].rotation.x = -sw * 0.5 * p.walk;
        p.arms[0].rotation.x -= sw * 0.4 * p.walk;
        p.arms[1].rotation.x += sw * 0.4 * p.walk;
        p.inner.position.y += Math.abs(Math.cos(p.stride)) * 0.025 * p.walk;
      } else if (p.legs[0].rotation.x !== 0) {
        p.legs[0].rotation.x = p.legs[1].rotation.x = 0;
      }
      // a gentle head tilt, and now and then a blink
      p.head.rotation.z = Math.sin(p.t * 0.8) * 0.07;
      p.head.rotation.x = Math.sin(p.t * 0.53) * 0.04 + q.tilt * 0.3;
      if (p.faces.blink) {
        p.blinkAt -= dt;
        p.faceMat.map = p.blinkAt < 0 ? p.faces.blink : p.faces.open;
        if (p.blinkAt < -0.13) p.blinkAt = rand(2, 5);
      }
      // fade anyone the camera gets right up against during a close-up
      camYaw.subVectors(camera.position, p.group.position);
      const fade = clamp01((camYaw.length() - 2.4) / 2.2);
      if (fade !== p.fade) {
        p.fade = fade;
        p.group.visible = fade > 0.02;
        p.group.traverse((o) => {
          if (o.material) {
            const transparent = fade < 1 || o.material.map != null;
            // switching opaque <-> transparent needs a shader rebuild
            if (o.material.transparent !== transparent) o.material.needsUpdate = true;
            o.material.transparent = transparent;
            o.material.opacity = fade;
          }
        });
      }
    }
  }

  // ----- interaction: drag to turn the camera, pinch / wheel to zoom,
  // tap a krathong to look closer -----
  const ORBIT_IDLE = 15; // seconds without input before the shot recentres
  const orbit = { yaw: 0, pitch: 0, zoom: 1, sYaw: 0, sPitch: 0, sZoom: 1, lastInput: -1e9 };
  const orbitOffset = new THREE.Vector3();
  const orbitSph = new THREE.Spherical();
  const touches = new Map();
  let pinchDist = 0;
  const zoomBy = (f) => {
    orbit.zoom = Math.min(1.45, Math.max(0.4, orbit.zoom * f));
    orbit.lastInput = clock;
  };
  const pinchSpan = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;
  els.canvas.addEventListener("pointerdown", (e) => {
    sound.unlock();
    els.canvas.setPointerCapture?.(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) pinchDist = pinchSpan();
    downAt = touches.size === 1 ? { x: e.clientX, y: e.clientY } : null;
  });
  els.canvas.addEventListener("pointermove", (e) => {
    const t = touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    t.x = e.clientX;
    t.y = e.clientY;
    if (touches.size === 1) {
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) return;
      orbit.yaw -= dx * 0.006;
      orbit.pitch = Math.min(0.9, Math.max(-0.6, orbit.pitch + dy * 0.004));
      orbit.lastInput = clock;
    } else if (touches.size === 2) {
      const d = pinchSpan();
      if (pinchDist > 0 && d > 0) zoomBy(pinchDist / d);
      pinchDist = d;
    }
  });
  const endTouch = (e) => touches.delete(e.pointerId);
  els.canvas.addEventListener("pointercancel", endTouch);
  els.canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomBy(Math.exp(e.deltaY * 0.0012));
    },
    { passive: false }
  );
  els.canvas.addEventListener("pointerup", (e) => {
    endTouch(e);
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
    placeMoon(camera.aspect < 1);
    camera.updateProjectionMatrix();
    syncWideCam();
    for (const k of krathongs) randomSpot(k.target, k.simple);
    sparks.material.uniforms.uScale.value = h * renderer.getPixelRatio() * 0.5;
    glowScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
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
    showWishes: false,
  };
  const tmp = new THREE.Vector3();
  const camDist = new THREE.Vector3();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    waterMat.uniforms.uTime.value = clock;
    glowTime.value = clock;
    tex.streakBands.offset.y = -clock * 0.12;

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
      camDist.subVectors(camera.position, k.root.position);
      const toCam = Math.atan2(camDist.x, camDist.z);
      k.streak.visible = k.placed;
      k.streak.rotation.y = toCam;
      if (k.standee) {
        // faces the wide-shot viewer and only turns a little toward the
        // camera, so orbiting round shows the board's edge and back
        const base = Math.atan2(wideCam.position.x - k.root.position.x, wideCam.position.z - k.root.position.z);
        const turn = Math.min(0.35, Math.max(-0.35, wrapAngle(toCam - base)));
        const want = base + turn + Math.sin(clock * 0.45 + k.phase) * 0.12;
        k.cardYaw += wrapAngle(want - k.cardYaw) * Math.min(1, dt * 1.2);
        k.standee.rotation.y = k.cardYaw;
      }
      // wish bubble fades in close up, name tag shows from afar
      if (k.bubble) {
        const d = camDist.subVectors(camera.position, k.root.position).length();
        // hidden while Kru Song is still carrying it
        // only the krathong in close-up shows its wish; neighbours keep
        // their small name tags so they don't cover it
        const following = camState.mode === "follow";
        const focusedHere = following && camState.follow === k;
        let near = k.placed && focusedHere ? clamp01((9 - d) / 3.5) : 0;
        // "show all wishes": every student krathong in the river shows its
        // bubble, grown a little with distance so far ones stay readable.
        // A close-up still shows only its own.
        let grow = 1;
        if (api.showWishes && k.placed && !following) {
          near = 1;
          grow = Math.min(1.7, Math.max(1, d / 10));
        }
        k.bubble.scale.copy(k.bubbleScale).multiplyScalar(grow);
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

    for (const l of lanterns) {
      if (l.held) continue; // the NPC holding it places it
      l.p.y += l.vy * dt;
      l.p.x += (Math.sin(clock * 0.4 + l.phase) * 0.12 + l.drift) * dt;
      l.a = clamp01((48 - l.p.y) / 10) * (0.85 + Math.sin(clock * 3 + l.phase) * 0.15);
      if (l.p.y > 48) {
        // recycle ambient lanterns to the bottom of the sky, far away
        l.p.set(rand(-40, 40), rand(2, 6), rand(-70, -18));
      }
    }
    if (lanterns.length > 60) lanterns.splice(lanterns.findIndex((l) => !l.held), 1);

    runPerformance(dt);
    for (const n of npcs) npcAct(n, dt);
    walkAbout(dt);
    updateSparks(dt);
    poseAll(dt);
    drawLanterns();

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
    // the viewer's drag / pinch turns the shot around what it looks at
    const ko = 1 - Math.exp(-dt * 10);
    if (clock - orbit.lastInput > ORBIT_IDLE) {
      // hands off for a while: drift back to the composed shot
      orbit.yaw = wrapAngle(orbit.yaw) * (1 - Math.min(1, dt * 0.8));
      orbit.pitch *= 1 - Math.min(1, dt * 0.8);
      orbit.zoom += (1 - orbit.zoom) * Math.min(1, dt * 0.8);
    }
    orbit.sYaw += (orbit.yaw - orbit.sYaw) * ko;
    orbit.sPitch += (orbit.pitch - orbit.sPitch) * ko;
    orbit.sZoom += (orbit.zoom - orbit.sZoom) * ko;
    orbitOffset.subVectors(camState.pos, camState.look);
    orbitSph.setFromVector3(orbitOffset);
    orbitSph.theta += orbit.sYaw;
    orbitSph.phi = Math.min(1.5, Math.max(0.12, orbitSph.phi - orbit.sPitch));
    orbitSph.radius *= orbit.sZoom;
    orbitOffset.setFromSpherical(orbitSph);
    camera.position.copy(camState.look).add(orbitOffset);
    camera.position.y = Math.max(0.45, camera.position.y);
    // never inside the far shore's temple and trees
    camera.position.z = Math.max(FAR_EDGE + 1.5, camera.position.z);
    camera.lookAt(tmp.copy(camState.look));
    updateStreaks();

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

  // toggle: show every krathong's wish bubble at once (remembered per browser)
  try {
    river.showWishes = localStorage.getItem("lk.showWishes") === "1";
  } catch {}
  const paintWishes = () => {
    els.wishes.classList.toggle("on", river.showWishes);
    els.wishes.setAttribute("aria-pressed", String(river.showWishes));
  };
  paintWishes();
  els.wishes.addEventListener("click", () => {
    river.showWishes = !river.showWishes;
    if (river.showWishes) river.unfocus();
    try {
      localStorage.setItem("lk.showWishes", river.showWishes ? "1" : "0");
    } catch {}
    paintWishes();
    toast(river.showWishes ? "แสดงคำอวยพรทุกกระทง" : "ซ่อนคำอวยพร");
  });

  // fullscreen toggle; hidden where the browser can't do it (iPhone Safari)
  const root = document.documentElement;
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  if (root.requestFullscreen || root.webkitRequestFullscreen) {
    els.fs.hidden = false;
    const paintFs = () => {
      const on = !!fsElement();
      els.fs.classList.toggle("on", on);
      els.fs.setAttribute("aria-label", on ? "ออกจากเต็มจอ" : "เต็มจอ");
      els.fs.title = els.fs.getAttribute("aria-label");
    };
    document.addEventListener("fullscreenchange", paintFs);
    document.addEventListener("webkitfullscreenchange", paintFs);
    els.fs.addEventListener("click", async () => {
      try {
        if (fsElement()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else await (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
      } catch (err) {
        console.warn("[loykrathong] fullscreen", err);
        toast("เปิดเต็มจอไม่ได้ในเบราว์เซอร์นี้");
      }
      paintFs();
    });
    paintFs();
  }

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
