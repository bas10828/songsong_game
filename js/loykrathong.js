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
const MAX_SKY = 40; // student lanterns, capped on their own
const isSky = (rec) => rec?.kind === "lantern";

const els = {
  canvas: document.getElementById("river"),
  loading: document.getElementById("loading"),
  floatBtn: document.getElementById("floatBtn"),
  lanternBtn: document.getElementById("lanternBtn"),
  fireBtn: document.getElementById("fireBtn"),
  kinds: document.getElementById("kindChips"),
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
// The face painted onto the front of a 3D head, on a transparent canvas
// (drawn at 2x for crisp lines). Layout units are 256 x 144.
// Styles: "open" big warm anime eyes and an open smile (Song Song);
// "blink" / default: happy closed eyes. Song Song's cartoon reactions:
// "wince" (squeezed >< eyes), "huh" (puzzled), "daze" (blank round eyes
// after a bang), "cry" / "cry2" (wailing with streaming tears, two frames).
function drawFace(style = "closed") {
  const c = makeCanvas(512, 288);
  const g = c.getContext("2d");
  g.scale(2, 2);
  // features a little larger than the layout, round the face's centre
  g.translate(128, 84);
  g.scale(1.22, 1.22);
  g.translate(-128, -84);
  const EYES = [84, 172];
  const EY = 78;
  const sad = style === "cry" || style === "cry2" || style === "wince";
  g.lineCap = "round";
  g.lineJoin = "round";
  // soft blush with a few tiny hatch strokes
  for (const bx of [46, 210]) {
    const grad = g.createRadialGradient(bx, 106, 2, bx, 106, 20);
    grad.addColorStop(0, "rgba(255,120,150,0.65)");
    grad.addColorStop(1, "rgba(255,120,150,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(bx, 106, 21, 13, 0, 0, TAU);
    g.fill();
    g.strokeStyle = "rgba(235,90,120,0.45)";
    g.lineWidth = 1.6;
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(bx + i * 6 - 2, 110);
      g.lineTo(bx + i * 6 + 2, 103);
      g.stroke();
    }
  }
  // short, soft, low brows (young), worried (inner ends up) when sad,
  // one raised when puzzled
  g.strokeStyle = "#5a3424";
  g.lineWidth = 3;
  for (const ex of EYES) {
    const s = ex < 128 ? -1 : 1;
    g.beginPath();
    if (sad) {
      g.moveTo(ex - 9 * s, 40);
      g.quadraticCurveTo(ex + 1 * s, 41, ex + 11 * s, 47);
    } else if (style === "huh" && s > 0) {
      g.moveTo(ex - 9, 40);
      g.quadraticCurveTo(ex + 1, 33, ex + 12, 38);
    } else {
      g.moveTo(ex - 9 * s, 47);
      g.quadraticCurveTo(ex + 1 * s, 42, ex + 11 * s, 46);
    }
    g.stroke();
  }
  const openEyes = () => {
    for (const ex of EYES) {
      const s = ex < 128 ? -1 : 1;
      // white of the eye
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.ellipse(ex, EY + 2, 19, 21, 0, 0, TAU);
      g.fill();
      // big round iris: dark at the top, warm amber at the bottom
      const iris = g.createLinearGradient(0, EY - 18, 0, EY + 22);
      iris.addColorStop(0, "#24120c");
      iris.addColorStop(0.45, "#5c3020");
      iris.addColorStop(1, "#d39255");
      g.fillStyle = iris;
      g.beginPath();
      g.ellipse(ex, EY + 3, 16.5, 19, 0, 0, TAU);
      g.fill();
      // a lighter ring low in the iris
      g.strokeStyle = "rgba(255,200,140,0.55)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(ex, EY + 7, 11, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
      g.fillStyle = "#170a06";
      g.beginPath();
      g.ellipse(ex, EY + 3, 6.5, 9, 0, 0, TAU);
      g.fill();
      // highlights: a big one, a small one, a glint
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.ellipse(ex + 6 * s, EY - 6, 6.5, 7.5, 0.3 * s, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(ex - 6 * s, EY + 14, 3, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(ex - 7 * s, EY - 6, 1.4, 0, TAU);
      g.fill();
      // a round, even upper lash line (no grown-up cat-eye flick)
      g.strokeStyle = "#1c0e0a";
      g.lineWidth = 4.2;
      g.beginPath();
      g.moveTo(ex - 19 * s, EY - 3);
      g.quadraticCurveTo(ex, EY - 25, ex + 19 * s, EY - 5);
      g.stroke();
    }
  };
  // just a tiny dot of a nose
  const nose = () => {
    g.fillStyle = "rgba(200,120,105,0.7)";
    g.beginPath();
    g.ellipse(128, 101, 1.8, 1.3, 0, 0, TAU);
    g.fill();
  };
  if (style === "open") {
    openEyes();
    nose();
    // a small open smile with a tongue (no teeth, which read older)
    g.fillStyle = "#a8303f";
    g.beginPath();
    g.moveTo(120, 108);
    g.quadraticCurveTo(128, 111, 136, 108);
    g.quadraticCurveTo(134, 119, 128, 119.5);
    g.quadraticCurveTo(122, 119, 120, 108);
    g.fill();
    g.fillStyle = "#ff8e9e";
    g.beginPath();
    g.ellipse(128, 115.5, 4.5, 2.6, 0, 0, TAU);
    g.fill();
    return c;
  }
  if (style === "huh") {
    openEyes();
    nose();
    // a small round "o?"
    g.fillStyle = "#a8303f";
    g.beginPath();
    g.ellipse(130, 113, 4, 5, 0, 0, TAU);
    g.fill();
    return c;
  }
  if (style === "wince") {
    // squeezed > < eyes and a wobbly little mouth
    g.strokeStyle = "#1c0e0a";
    g.lineWidth = 4.5;
    for (const ex of EYES) {
      const s = ex < 128 ? 1 : -1;
      g.beginPath();
      g.moveTo(ex - 13 * s, EY - 12);
      g.lineTo(ex + 9 * s, EY);
      g.lineTo(ex - 13 * s, EY + 12);
      g.stroke();
    }
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(116, 113);
    for (let i = 1; i <= 6; i++) g.lineTo(116 + i * 4, i % 2 ? 109 : 115);
    g.stroke();
    return c;
  }
  if (style === "daze") {
    // blank round eyes with tiny pupils, a zigzag mouth
    for (const ex of EYES) {
      g.fillStyle = "#ffffff";
      g.strokeStyle = "#1c0e0a";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(ex, EY + 2, 17, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = "#1c0e0a";
      g.beginPath();
      g.arc(ex, EY + 2, 3, 0, TAU);
      g.fill();
    }
    g.strokeStyle = "#1c0e0a";
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(110, 114);
    for (let i = 1; i <= 8; i++) g.lineTo(110 + i * 4.5, i % 2 ? 109 : 115);
    g.stroke();
    return c;
  }
  if (style === "cry" || style === "cry2") {
    // eyes shut tight and sad, tears pouring down the cheeks
    for (const ex of EYES) {
      const grad = g.createLinearGradient(0, EY + 4, 0, 150);
      grad.addColorStop(0, "rgba(150,220,255,0.95)");
      grad.addColorStop(1, "rgba(150,220,255,0.55)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(ex - 9, EY + 4);
      g.bezierCurveTo(ex - 12, EY + 40, ex - 15, EY + 60, ex - 13, 150);
      g.lineTo(ex + 11, 150);
      g.bezierCurveTo(ex + 13, EY + 60, ex + 10, EY + 40, ex + 9, EY + 4);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.8)";
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(ex - 3, EY + 12);
      g.lineTo(ex - 5, 140);
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 9;
      g.beginPath();
      g.arc(ex, EY - 6, 15, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
      g.strokeStyle = "#1c0e0a";
      g.lineWidth = 4.5;
      g.stroke();
    }
    g.fillStyle = "#a8303f";
    g.beginPath();
    if (style === "cry") g.ellipse(128, 115, 13, 10, 0, 0, TAU);
    else g.ellipse(128, 113, 8, 5, 0, 0, TAU);
    g.fill();
    if (style === "cry") {
      g.fillStyle = "#ff8e9e";
      g.beginPath();
      g.ellipse(128, 120, 7, 4, 0, 0, TAU);
      g.fill();
    }
    return c;
  }
  // closed, happy eyes (blink frame and everyone else's default face)
  g.strokeStyle = "#2a1a16";
  g.lineWidth = 4.5;
  for (const ex of EYES) {
    const s = ex < 128 ? -1 : 1;
    g.beginPath();
    g.arc(ex, EY + 8, 13, Math.PI * 1.12, Math.PI * 1.88);
    g.stroke();
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(ex + 12 * s, EY + 2);
    g.lineTo(ex + 18 * s, EY - 2);
    g.stroke();
    g.lineWidth = 4.5;
  }
  g.lineWidth = 3.5;
  g.beginPath();
  g.arc(128, 100, 9, Math.PI * 0.15, Math.PI * 0.85);
  g.stroke();
  return c;
}

// soot over the whole front of a head: an even sooty wash with darker
// smudges, fading out softly toward the edges of the canvas
function drawSoot() {
  const c = makeCanvas(256, 192);
  const g = c.getContext("2d");
  const wash = g.createRadialGradient(128, 92, 20, 128, 92, 125);
  wash.addColorStop(0, "rgba(46,38,42,0.85)");
  wash.addColorStop(0.6, "rgba(46,38,42,0.75)");
  wash.addColorStop(1, "rgba(46,38,42,0)");
  g.fillStyle = wash;
  g.fillRect(0, 0, 256, 192);
  for (let i = 0; i < 40; i++) {
    const x = rand(40, 216);
    const y = rand(30, 160);
    const rad = rand(10, 24);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(24,18,20,${rand(0.3, 0.55)})`);
    grad.addColorStop(1, "rgba(24,18,20,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, TAU);
    g.fill();
  }
  return c;
}

// a cartoon "?" for a puzzled moment
function drawQuestion(ch = "?") {
  const c = makeCanvas(128, 160);
  const g = c.getContext("2d");
  g.font = `900 130px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 12;
  g.strokeStyle = "#5a2a6a";
  g.lineJoin = "round";
  g.strokeText(ch, 64, 84);
  g.fillStyle = "#ffe27a";
  g.fillText(ch, 64, 84);
  return c;
}

// a cartoon water drop, for the wet gag
function drawDrop() {
  const c = makeCanvas(96, 128);
  const g = c.getContext("2d");
  g.beginPath();
  g.moveTo(48, 8);
  g.bezierCurveTo(62, 40, 84, 60, 84, 84);
  g.arc(48, 84, 36, 0, Math.PI);
  g.bezierCurveTo(12, 60, 34, 40, 48, 8);
  g.closePath();
  g.lineWidth = 8;
  g.strokeStyle = "#2a5a9a";
  g.lineJoin = "round";
  g.stroke();
  g.fillStyle = "#8fd4ff";
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.ellipse(36, 82, 7, 13, -0.3, 0, TAU);
  g.fill();
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
    // a rising whistle as a firework climbs
    whoosh() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(500, t);
      osc.frequency.exponentialRampToValueAtTime(1900, t + 1.1);
      osc.connect(env(a, 0.05, t, 0.05, 1.1));
      osc.start(t);
      osc.stop(t + 1.25);
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      src.loop = true;
      const hp = a.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2500;
      src.connect(hp).connect(env(a, 0.05, t, 0.1, 1.0));
      src.start(t);
      src.stop(t + 1.2);
    },
    // a deep thump with a noisy tail
    boom(vol = 0.5) {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.5);
      osc.connect(env(a, vol, t, 0.004, 0.6));
      osc.start(t);
      osc.stop(t + 0.7);
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      src.loop = true;
      const lp = a.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.exponentialRampToValueAtTime(300, t + 0.8);
      src.connect(lp).connect(env(a, vol * 0.7, t, 0.004, 0.9));
      src.start(t);
      src.stop(t + 1);
    },
    // glittery crackles after a burst
    crackle(n = 14, vol = 0.12) {
      const a = on && ac();
      if (!a) return;
      for (let i = 0; i < n; i++) {
        const t = a.currentTime + 0.25 + Math.random() * 0.9;
        const src = a.createBufferSource();
        src.buffer = noiseBuf(a);
        const bp = a.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = rand(2500, 5000);
        src.connect(bp).connect(env(a, vol * rand(0.4, 1), t, 0.001, 0.04));
        src.start(t, rand(0, 0.3), 0.06);
      }
    },
    // a fuse fizzing out: a short, falling hiss
    fizzle() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      src.loop = true;
      const bp = a.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 2;
      bp.frequency.setValueAtTime(4000, t);
      bp.frequency.exponentialRampToValueAtTime(600, t + 0.6);
      src.connect(bp).connect(env(a, 0.12, t, 0.02, 0.6));
      src.start(t);
      src.stop(t + 0.7);
    },
    // a cartoon "waaah": a wobbly falling wail
    sob() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(820, t);
      osc.frequency.exponentialRampToValueAtTime(520, t + 0.7);
      const lfo = a.createOscillator();
      lfo.frequency.value = 9;
      const depth = a.createGain();
      depth.gain.value = 40;
      lfo.connect(depth).connect(osc.frequency);
      osc.connect(env(a, 0.1, t, 0.04, 0.7));
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 0.8);
      lfo.stop(t + 0.8);
    },
    // a cartoon "whoa!": a quick rise and a long slide down
    slip() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(980, t + 0.18);
      osc.frequency.exponentialRampToValueAtTime(260, t + 0.75);
      osc.connect(env(a, 0.09, t, 0.02, 0.75));
      osc.start(t);
      osc.stop(t + 0.85);
    },
    // a big SPLASH: a deep plunge and a long hiss of spray
    splash() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.frequency.setValueAtTime(260, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.35);
      osc.connect(env(a, 0.35, t, 0.005, 0.4));
      osc.start(t);
      osc.stop(t + 0.5);
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      src.loop = true;
      const lp = a.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(5000, t);
      lp.frequency.exponentialRampToValueAtTime(500, t + 1.1);
      src.connect(lp).connect(env(a, 0.3, t, 0.01, 1.1));
      src.start(t);
      src.stop(t + 1.2);
    },
    // one bubble rising: a tiny upward "blub"
    blub() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      const f = rand(240, 420);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 2.4, t + 0.07);
      osc.connect(env(a, 0.12, t, 0.005, 0.08));
      osc.start(t);
      osc.stop(t + 0.12);
    },
    // "pffft": spitting out a mouthful of river
    spit() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      src.loop = true;
      const bp = a.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(1800, t);
      bp.frequency.exponentialRampToValueAtTime(900, t + 0.45);
      src.connect(bp).connect(env(a, 0.16, t, 0.01, 0.45));
      src.start(t);
      src.stop(t + 0.5);
    },
    // a hair dryer: an airy whirr with a soft motor hum
    dryer(len = 1.7) {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      src.loop = true;
      const bp = a.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1400;
      bp.Q.value = 0.6;
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.15);
      g.gain.setValueAtTime(0.07, t + len - 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      g.connect(a.destination);
      src.connect(bp).connect(g);
      const hum = a.createOscillator();
      hum.type = "sawtooth";
      hum.frequency.value = 180;
      const hg = a.createGain();
      hg.gain.value = 0.12;
      hum.connect(hg).connect(g);
      src.start(t);
      hum.start(t);
      src.stop(t + len);
      hum.stop(t + len);
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

  // ----- fireworks: their own particle pool (bigger points, air drag,
  // glitter) so big shells never eat the shared sparks, plus rockets,
  // flashes and dark smoke puffs -----
  const FW = 1800;
  const fwPos = new Float32Array(FW * 3).fill(-999);
  const fwCol = new Float32Array(FW * 3);
  const fwA = new Float32Array(FW);
  const fwSize = new Float32Array(FW);
  const fwVel = new Float32Array(FW * 3);
  const fwLife = new Float32Array(FW);
  const fwMax = new Float32Array(FW);
  const fwDrag = new Float32Array(FW);
  const fwGrav = new Float32Array(FW);
  const fwGlit = new Uint8Array(FW);
  let fwHead = 0;
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute("position", new THREE.BufferAttribute(fwPos, 3));
  fwGeo.setAttribute("color", new THREE.BufferAttribute(fwCol, 3));
  fwGeo.setAttribute("alpha", new THREE.BufferAttribute(fwA, 1));
  fwGeo.setAttribute("size", new THREE.BufferAttribute(fwSize, 1));
  const fwPoints = new THREE.Points(
    fwGeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: `
        attribute vec3 color; attribute float alpha; attribute float size; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = alpha > 0.0 ? size * uScale / -mv.z : 0.0; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(mix(vC, vec3(1.0), core * core * 0.6), vA * core); }`,
    })
  );
  fwPoints.frustumCulled = false;
  scene.add(fwPoints);
  let fwIdle = 99; // seconds since the last firework particle was born
  function fwSpark(x, y, z, vx, vy, vz, color, life, size = 0.16, drag = 1.6, grav = 1.4, glitter = 0) {
    fwIdle = 0;
    const i = fwHead;
    fwHead = (fwHead + 1) % FW;
    fwPos[i * 3] = x;
    fwPos[i * 3 + 1] = y;
    fwPos[i * 3 + 2] = z;
    fwVel[i * 3] = vx;
    fwVel[i * 3 + 1] = vy;
    fwVel[i * 3 + 2] = vz;
    tmpCol.set(color);
    fwCol[i * 3] = tmpCol.r;
    fwCol[i * 3 + 1] = tmpCol.g;
    fwCol[i * 3 + 2] = tmpCol.b;
    fwLife[i] = fwMax[i] = life;
    fwSize[i] = size;
    fwDrag[i] = drag;
    fwGrav[i] = grav;
    fwGlit[i] = glitter;
    fwA[i] = 1;
  }
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const dir = new THREE.Vector3();
  // one shell bursting at p. Styles: "peony" (a sphere), "ring" (a halo
  // facing the viewer), "heart" (a heart facing the viewer), "willow"
  // (slow gold trails that droop)
  function fwShell(p, style, colors, speed = 3.6) {
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    const c2 = colors[1] ?? colors[0];
    if (style === "heart") {
      const n = 130;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU;
        const hx = Math.pow(Math.sin(t), 3);
        const hy = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16;
        dir.copy(camRight).multiplyScalar(hx).addScaledVector(camUp, hy);
        const sp = speed * 0.95;
        fwSpark(p.x, p.y, p.z, dir.x * sp, dir.y * sp, dir.z * sp, colors[0], rand(1.5, 1.9), 0.19, 1.9, 0.5);
      }
      for (let i = 0; i < 40; i++) {
        dir.randomDirection().multiplyScalar(rand(0.2, 0.6) * speed);
        fwSpark(p.x, p.y, p.z, dir.x, dir.y, dir.z, c2, rand(0.8, 1.2), 0.13, 2, 1, 1);
      }
      return;
    }
    if (style === "ring") {
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * TAU;
        dir.copy(camRight).multiplyScalar(Math.cos(a)).addScaledVector(camUp, Math.sin(a) * 0.85);
        fwSpark(p.x, p.y, p.z, dir.x * speed, dir.y * speed, dir.z * speed, i % 2 ? colors[0] : c2, rand(1.3, 1.7), 0.18, 1.8, 1);
      }
      for (let i = 0; i < 70; i++) {
        dir.randomDirection().multiplyScalar(speed * rand(0.35, 0.55));
        fwSpark(p.x, p.y, p.z, dir.x, dir.y, dir.z, c2, rand(1, 1.4), 0.14, 1.8, 1.2, 1);
      }
      return;
    }
    if (style === "willow") {
      for (let i = 0; i < 150; i++) {
        dir.randomDirection().multiplyScalar(speed * rand(0.85, 1));
        fwSpark(p.x, p.y, p.z, dir.x, dir.y + 0.4, dir.z, i % 3 ? 0xffd27a : 0xfff1c0, rand(2.2, 2.8), 0.15, 1.2, 1.9, 1);
      }
      return;
    }
    // peony: an outer sphere in one colour, an inner one in the other
    for (let i = 0; i < 180; i++) {
      dir.randomDirection().multiplyScalar(speed * rand(0.92, 1));
      fwSpark(p.x, p.y, p.z, dir.x, dir.y, dir.z, colors[0], rand(1.4, 1.8), 0.18, 1.7, 1.3);
    }
    for (let i = 0; i < 80; i++) {
      dir.randomDirection().multiplyScalar(speed * rand(0.4, 0.5));
      fwSpark(p.x, p.y, p.z, dir.x, dir.y, dir.z, c2, rand(1.1, 1.5), 0.16, 1.7, 1.3, 1);
    }
  }
  // flashes: a bright glow that blooms and fades where something bursts
  const flashes = [];
  function flash(p, size = 6, color = 0xfff0d0, life = 0.55) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.position.copy(p);
    scene.add(m);
    flashes.push({ m, t: 0, size, life });
  }
  // rockets climb from a launch point with a gold trail, then burst
  const rockets = [];
  function launchRocket(from, shell) {
    rockets.push({ p: from.clone(), v: new THREE.Vector3(rand(0.1, 0.5), rand(6.2, 6.6), rand(-1.1, -0.7)), ...shell });
    sound.whoosh();
  }
  // dark smoke puffs (normal blending, so they can be darker than the sky)
  const SMOKE = 28;
  const smoke = [];
  for (let i = 0; i < SMOKE; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.dot, color: 0x4a4248, transparent: true, depthWrite: false, opacity: 0 }));
    m.visible = false;
    scene.add(m);
    smoke.push({ m, t: 1, life: 1, v: new THREE.Vector3(), s0: 0.2, s1: 0.6, a: 0.8 });
  }
  let smokeHead = 0;
  function puff(p, { size = 0.35, grow = 2.2, life = 1.4, rise = 0.35, spread = 0.3, a = 0.85, color = 0x4a4248 } = {}) {
    const s = smoke[smokeHead];
    smokeHead = (smokeHead + 1) % SMOKE;
    s.m.position.copy(p);
    s.m.material.color.set(color);
    s.m.visible = true;
    s.t = 0;
    s.life = life * rand(0.8, 1.2);
    s.v.set(rand(-spread, spread), rise * rand(0.7, 1.3), rand(-spread, spread));
    s.s0 = size;
    s.s1 = size * grow;
    s.a = a;
  }
  const rocketTmp = new THREE.Vector3();
  function updateFireworks(dt) {
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.v.y -= 4 * dt;
      r.p.addScaledVector(r.v, dt);
      for (let k = 0; k < 3; k++) fwSpark(r.p.x, r.p.y, r.p.z, rand(-0.15, 0.15), rand(-0.6, -0.2), rand(-0.15, 0.15), k ? 0xffc46a : 0xfff3c8, rand(0.35, 0.55), 0.11, 2, 0.5, 1);
      if (r.v.y < 0.9) {
        rockets.splice(i, 1);
        fwShell(r.p, r.style, r.colors, r.speed);
        flash(r.p, 7, r.colors[0]);
        rocketTmp.copy(r.p);
        sound.boom(Math.min(0.55, 6 / camera.position.distanceTo(rocketTmp)));
        if (r.style !== "heart") sound.crackle();
      }
    }
    // nothing alive for longer than any particle lives: skip the pool
    fwIdle += dt;
    for (let i = 0; i < (fwIdle < 3.5 ? FW : 0); i++) {
      if (fwA[i] <= 0) continue;
      fwLife[i] -= dt;
      if (fwLife[i] <= 0) {
        fwA[i] = 0;
        continue;
      }
      const k = Math.exp(-fwDrag[i] * dt);
      fwVel[i * 3] *= k;
      fwVel[i * 3 + 1] = fwVel[i * 3 + 1] * k - fwGrav[i] * dt;
      fwVel[i * 3 + 2] *= k;
      fwPos[i * 3] += fwVel[i * 3] * dt;
      fwPos[i * 3 + 1] += fwVel[i * 3 + 1] * dt;
      fwPos[i * 3 + 2] += fwVel[i * 3 + 2] * dt;
      const u = fwLife[i] / fwMax[i];
      fwA[i] = Math.min(1, u * 2.5) * (fwGlit[i] && u < 0.6 ? (Math.random() < 0.5 ? 1 : 0.15) : 1);
    }
    if (fwIdle < 3.5) {
      fwGeo.attributes.position.needsUpdate = true;
      fwGeo.attributes.color.needsUpdate = true;
      fwGeo.attributes.alpha.needsUpdate = true;
      fwGeo.attributes.size.needsUpdate = true;
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t += dt;
      const u = f.t / f.life;
      if (u >= 1) {
        scene.remove(f.m);
        f.m.material.dispose();
        flashes.splice(i, 1);
        continue;
      }
      f.m.scale.setScalar(f.size * (0.6 + 0.4 * Math.sqrt(u)));
      f.m.material.opacity = 1 - u;
    }
    for (const s of smoke) {
      if (!s.m.visible) continue;
      s.t += dt;
      const u = s.t / s.life;
      if (u >= 1) {
        s.m.visible = false;
        continue;
      }
      s.m.position.addScaledVector(s.v, dt);
      s.m.scale.setScalar(lerp(s.s0, s.s1, 1 - (1 - u) * (1 - u)));
      s.m.material.opacity = s.a * Math.min(1, u * 6) * (1 - u);
    }
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

  // ----- student sky lanterns (khom loi) -----
  // Like a krathong, but drifting in the sky above the canal: a paper
  // lantern lit from inside, with the student's cut-out photo hanging
  // under it on two strings. Root origin = bottom of the photo.
  const SKY_PHOTO_H = 1.2;
  const SKY_GAP = 0.14; // photo top to the lantern's rim
  const skyLanternGeo = (() => {
    const { parts, add } = partList();
    const paperLow = new THREE.Color(0xffe6a6);
    const paperHigh = new THREE.Color(0xff8a3c);
    const cap = new THREE.Color(0xc8582a);
    const c = new THREE.Color();
    // slightly bell-shaped paper body, open at the bottom
    const prof = [[0.36, 0], [0.39, 0.25], [0.43, 0.6], [0.44, 0.86], [0.4, 0.96], [0.26, 1.03], [0, 1.05]];
    add(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 18), 0xffffff, null, false, false, (y) => {
      if (y > 0.93) return cap;
      // thin glued seams across the paper
      if (Math.abs(y - 0.33) < 0.012 || Math.abs(y - 0.66) < 0.012) return c.copy(paperHigh).multiplyScalar(0.8);
      return c.copy(paperLow).lerp(paperHigh, smooth(clamp01(y / 0.95)));
    });
    // wire rim and the fuel cell hanging inside it
    add(new THREE.TorusGeometry(0.36, 0.012, 5, 24), 0x6a3a1a, (d) => (d.rotation.x = Math.PI / 2));
    add(new THREE.BoxGeometry(0.72, 0.012, 0.012), 0x6a3a1a, (d) => (d.position.y = 0.02));
    add(new THREE.BoxGeometry(0.012, 0.012, 0.72), 0x6a3a1a, (d) => (d.position.y = 0.02));
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), 0xfff2c0, (d) => (d.position.y = 0.04));
    return mergeParts(parts);
  })();
  const skyLanternMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  const stringMat = new THREE.LineBasicMaterial({ color: 0xffe9b8, fog: false });

  function buildSkyLantern({ catColor, card, bubble, tag }) {
    const root = new THREE.Group();
    const spin = new THREE.Group(); // the lantern, swaying on its own
    root.add(spin);
    const LB = card ? SKY_PHOTO_H + SKY_GAP : 0; // rim height above the root
    spin.position.y = LB;
    const body = new THREE.Mesh(skyLanternGeo, skyLanternMat.clone()); // own copy: dims while unlit
    spin.add(body);
    const flame = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.flame, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.position.y = 0.16;
    flame.scale.set(0.12, 0.22, 1);
    spin.add(flame);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex.glow, color: 0xffa050, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    );
    glow.position.y = 0.5;
    glow.scale.setScalar(3.2);
    spin.add(glow);
    // its warm light on the water far below (kept at y=0 every frame)
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: tex.glow, color: 0xff9a40, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    root.add(pool);

    const k = {
      sky: true, root, spin, body, flame, glow, pool, streak: null, card: null, bubble: null, tag: null,
      flameW: 0.12, flameH: 0.22, glowBase: 0.75,
      speed: rand(0.1, 0.16), target: new THREE.Vector3(), vel: new THREE.Vector3(), retarget: 0,
      phase: rand(0, TAU), spinRate: rand(-0.1, 0.1), placed: true, textures: [], lit: 1,
      midY: LB + 0.5, rimY: LB,
      // the category colour tints the paper, kept light so it stays warm
      tint: new THREE.Color(0xffffff).lerp(new THREE.Color(catColor), 0.4),
    };
    body.userData.krathong = k;
    pickables.push(body);

    if (card) {
      // one photo plane plus a white silhouette behind it (cheaper than the
      // krathong's layered standee), hanging from the rim on two strings
      const t = canvasTexture(card);
      const sil = canvasTexture(silhouette(card));
      k.textures.push(t, sil);
      const h = SKY_PHOTO_H;
      const w = (h * card.width) / card.height;
      const standee = new THREE.Group();
      const front = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.5 }));
      front.scale.set(w, h, 1);
      front.position.z = 0.01;
      front.userData.krathong = k;
      const back = new THREE.Mesh(cardGeo, new THREE.MeshLambertMaterial({ map: sil, alphaTest: 0.5, side: THREE.DoubleSide }));
      back.scale.set(w, h, 1);
      const sx = Math.min(w * 0.32, 0.3);
      const strings = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-sx, h * 0.96, 0), new THREE.Vector3(-0.3, LB, 0),
          new THREE.Vector3(sx, h * 0.96, 0), new THREE.Vector3(0.3, LB, 0),
        ]),
        stringMat
      );
      standee.add(front, back, strings);
      root.add(standee);
      k.card = front;
      k.cardEdge = back;
      k.strings = strings;
      k.standee = standee;
      k.cardYaw = 0;
      pickables.push(front);
    }
    const topY = LB + 1.08;
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
    for (const s of [k.flame, k.glow, k.card, k.cardEdge, k.bubble, k.tag, k.body]) s?.material.dispose();
    if (!k.sky) k.cardEdge?.dispose(); // the krathong's edge is an InstancedMesh
    k.strings?.geometry.dispose();
    k.pool.geometry.dispose();
    k.pool.material.dispose();
    for (const t of k.textures) t.dispose();
    unpick(k);
    const i = krathongs.indexOf(k);
    if (i >= 0) krathongs.splice(i, 1);
  }

  function unpick(k) {
    for (const s of [k.card, k.tag, k.body]) {
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
    if (k.sky) {
      // a deleted lantern drifts up into the dark and goes out
      burst(new THREE.Vector3(p.x, p.y + k.midY, p.z), 26, { speed: 1, colors: [0xffd27a, 0xffffff], life: 0.9 });
      sound.chime();
    } else {
      ripple(p.x, p.z, 1.6);
      sound.plop();
    }
    if (camState.follow === k) camState.mode = "wide";
  }

  // Edit: build the updated krathong exactly where the old one floats.
  // Switching krathong <-> lantern starts it at a fresh spot instead.
  async function rebuildKrathong(old, rec) {
    const same = !!old.sky === isSky(rec);
    const k = await studentKrathong(rec, same ? { at: old.root.position, replacing: true } : { replacing: true });
    if (same) {
      k.target.copy(old.target);
      k.vel.copy(old.vel);
      k.spin.rotation.y = old.spin.rotation.y;
    }
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
    const sky = isSky(rec);
    const parts = {
      catColor: cat.color,
      card,
      bubble: drawBubble(rec.name, rec.wish, cat.color),
      tag: rec.name ? drawNameTag(rec.name, cat.color) : null,
    };
    const k = sky ? buildSkyLantern(parts) : buildKrathong(parts);
    k.rec = rec;
    const spot = sky ? skySpot : randomSpot;
    if (at) {
      k.root.position.copy(at);
    } else if (atDrop) {
      // a lantern starts in Kru Song's hands (the performance carries it)
      k.root.position.copy(sky ? TEACHER_POS : DROP_POS);
    } else {
      spot(k.root.position, false);
    }
    spot(k.target, false);
    // each kind has its own cap, oldest first
    const same = krathongs.filter((x) => !x.simple && x.sinking == null && !!x.sky === sky);
    if (!replacing && same.length >= (sky ? MAX_SKY : MAX_STUDENT)) disposeKrathong(same[0]);
    krathongs.push(k);
    updateCount();
    return k;
  }

  function updateCount() {
    const live = krathongs.filter((k) => !k.simple && k.sinking == null);
    const sky = live.filter((k) => k.sky).length;
    els.count.textContent = `🌸 ${live.length - sky}` + (sky ? ` · 🏮 ${sky}` : "");
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
  // a hair lock: a tapered, flattened tube swept along a curve through
  // `pts` ([x, y, z] in head space). The flat side faces away from the
  // head's vertical axis so locks lie on the head and drape like ribbons.
  function lockGeometry(pts, w0, w1, flat = 0.5, seg = 22, radial = 8) {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const pos = [];
    const idx = [];
    const P = new THREE.Vector3();
    const T = new THREE.Vector3();
    const out = new THREE.Vector3();
    const side = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      curve.getPointAt(u, P);
      curve.getTangentAt(u, T);
      out.set(P.x, 0, P.z);
      if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
      out.normalize();
      side.crossVectors(T, out).normalize();
      nrm.crossVectors(side, T).normalize();
      // full width most of the way, then a soft point at the tip
      const w = lerp(w0, w1, Math.pow(u, 1.6));
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * TAU;
        pos.push(
          P.x + side.x * Math.cos(a) * w + nrm.x * Math.sin(a) * w * flat,
          P.y + side.y * Math.cos(a) * w + nrm.y * Math.sin(a) * w * flat,
          P.z + side.z * Math.cos(a) * w + nrm.z * Math.sin(a) * w * flat
        );
      }
    }
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j;
        const b = i * radial + ((j + 1) % radial);
        idx.push(a, a + radial, b, b, a + radial, b + radial);
      }
    }
    // close the tip
    const tip = pos.length / 3;
    curve.getPointAt(1, P);
    pos.push(P.x, P.y, P.z);
    for (let j = 0; j < radial; j++) idx.push(seg * radial + j, tip, seg * radial + ((j + 1) % radial));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // a point on a sphere round the head centre: polar angle from the crown,
  // azimuth from the front (+z) toward +x
  const onHead = (polar, az, r, cy) => [r * Math.sin(polar) * Math.sin(az), cy + r * Math.cos(polar), r * Math.sin(polar) * Math.cos(az)];
  // narrows the lower half of a head sphere toward a soft, small chin
  function chibiHead(geo, r) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y >= 0) continue;
      const k = 1 - 0.07 * Math.pow(-y / r, 1.6);
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * (1 - 0.03 * Math.pow(-y / r, 1.6)));
    }
    geo.computeVertexNormals();
    return geo;
  }
  // three-step toon ramp: softer shading than the default two tones
  let softRamp = null;
  function softToonRamp() {
    if (!softRamp) {
      softRamp = new THREE.DataTexture(new Uint8Array([165, 165, 165, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
      softRamp.minFilter = softRamp.magFilter = THREE.NearestFilter;
      softRamp.needsUpdate = true;
    }
    return softRamp;
  }

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
    if (look.softShade) mat.gradientMap = softToonRamp();
    if (look.rim) {
      // a soft lilac rim light round her silhouette, so she stands out
      // from the night river without adding a scene light
      const rim = new THREE.Color(look.rim);
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          "#include <opaque_fragment>",
          `float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.4);
          outgoingLight += vec3(${rim.r.toFixed(3)}, ${rim.g.toFixed(3)}, ${rim.b.toFixed(3)}) * rimF;
          #include <opaque_fragment>`
        );
      };
      mat.customProgramCacheKey = () => "toonRim" + look.rim;
    }

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
    h(look.partedHair ? chibiHead(new THREE.SphereGeometry(HEAD_R, 24, 18), HEAD_R) : new THREE.SphereGeometry(HEAD_R, 24, 18), skin, (d) => { d.position.y = C; d.scale.set(1.03, 1, 0.95); });
    // ears
    for (const x of [-1, 1]) h(new THREE.SphereGeometry(0.03, 8, 6), skin, (d) => { d.position.set(x * HEAD_R * 1.0, C - 0.01, -0.01); d.scale.set(0.6, 1, 0.8); });
    // hair: a puffy cap tilted back off the forehead, a fuller back, side-swept bangs
    h(new THREE.SphereGeometry(HEAD_R + 0.02, 24, 12, 0, TAU, 0, Math.PI * 0.56), hair, (d) => { d.position.y = C + 0.012; d.rotation.x = look.partedHair ? -0.58 : -0.38; d.scale.set(1.07, 1.08, 1.05); });
    h(new THREE.SphereGeometry(HEAD_R + 0.018, 18, 10, Math.PI, Math.PI, Math.PI * 0.25, Math.PI * 0.55), hair, (d) => { d.position.y = C; d.scale.set(1.06, 1.04, 1.06); });
    const bang = new THREE.ConeGeometry(0.05, 0.13, 6);
    for (let i = 0; i < (look.partedHair ? 0 : 7); i++) {
      const a = -0.95 + (i / 6) * 1.9;
      const len = 1 - Math.abs(a) * 0.25;
      h(bang, hair, (d) => {
        d.position.set(Math.sin(a) * (HEAD_R + 0.008), C + 0.085 - Math.abs(a) * 0.035, Math.cos(a) * (HEAD_R + 0.008) * 0.95);
        d.rotation.set(Math.PI - 0.32, a, 0.28, "YXZ");
        d.scale.set(1, len, 0.42);
      });
    }
    // glossy "angel ring" highlight across the crown
    if (!look.partedHair) h(new THREE.TorusGeometry(HEAD_R * 1.06 + 0.012, 0.006, 4, 32, Math.PI * 1.1), look.hairShine || "#6a4c44", (d) => {
      d.position.set(0, C + 0.075, -0.027);
      d.rotation.set(Math.PI / 2 - 0.38, 0, Math.PI * -0.05);
    });
    if (look.sidelocks) {
      for (const x of [-1, 1]) {
        h(new THREE.CylinderGeometry(0.024, 0.01, 0.2, 6), hair, (d) => {
          d.position.set(x * HEAD_R * 0.93, C - 0.07, 0.07);
          d.rotation.z = -x * 0.1;
          d.scale.z = 0.6;
        });
      }
    }
    if (look.longHair) h(new THREE.CylinderGeometry(0.17, 0.2, 0.36, 16, 1, false, Math.PI * 0.5, Math.PI), hair, (d) => d.position.set(0, C - 0.17, -0.02));
    // long hair with a centre parting and no fringe (Song Song). Every
    // lock starts on the scalp; below the jaw it continues on its own pivot
    // (`low`) that follows the head only partly, so a nod doesn't swing the
    // long hair through her body
    const low = partList();
    if (look.partedHair) {
      const R = HEAD_R;
      // 0 = dead straight, 1 = loose waves
      const W = look.hairWave ?? 1;
      // < 1 shortens and narrows the hanging hair (for a bigger head scale,
      // so it still ends at the same place on her body)
      const K = look.hairFit ?? 1;
      const rr = (r) => (0.17 + (r - 0.17) * (0.4 + 0.6 * W)) * K;
      const below = (d) => C - 0.16 - (d - 0.16) * K;
      const nFront = look.frontLocks ?? 4;
      const root = new THREE.Color(hair);
      const tipCol = new THREE.Color(look.hairTip || hair);
      const hairAt = (y) => root.clone().lerp(tipCol, clamp01((C - 0.1 - y) / 0.45));
      // front: from the parting, round the sides of the forehead, past the
      // cheeks, then down over the front of the shoulders
      for (const s of [-1, 1]) {
        for (let j = 0; j < nFront; j++) {
          const ph = j * 1.9 + (s > 0 ? 0.8 : 0);
          const pts = [
            onHead(0.08, s * 0.3, R + 0.012, C),
            onHead(0.7, s * (0.3 + j * 0.17), R + 0.03, C),
            onHead(1.3, s * (0.86 + j * 0.17), R + 0.034, C),
            [s * (R * 0.9 + j * 0.01), C - 0.16, 0.075 - j * 0.028],
            [(s * (0.125 + j * 0.01) + Math.sin(ph) * 0.03 * W) * K, below(0.26), (0.08 - j * 0.024) * K],
            [(s * (0.11 + j * 0.012) - Math.sin(ph) * 0.035 * W) * K, below(0.36), (0.09 - j * 0.024) * K],
            // the tip curls in toward her
            look.curlIn ? [s * (0.085 + j * 0.008) * K, below(0.41), (0.11 - j * 0.02) * K] : [(s * (0.12 + j * 0.008) + s * 0.03) * K, below(0.43), (0.095 - j * 0.024) * K],
          ];
          const fw = look.frontLockW ?? 0.04;
          h(lockGeometry(pts.slice(0, 5), fw, fw * 0.75, 0.45), hair, null, false, false, hairAt);
          low.add(lockGeometry(pts.slice(2), fw * 0.8, 0.006, 0.5), hair, null, false, false, hairAt);
        }
      }
      // back: a curtain of locks round the back half of the head that tucks
      // behind the shoulders and falls in waves to the middle of her back
      const N = 16;
      for (let i = 0; i < N; i++) {
        const az = lerp(1.0, TAU - 1.0, i / (N - 1));
        const ph = i * 1.7;
        const sx = Math.sin(az);
        const cz = Math.cos(az);
        const flare = 1 + 0.08 * W * Math.sin(i * 2.3);
        // a hanging point at height y, radius r, swayed sideways by a wave
        const hang = (y, r, wave) => [sx * r * 0.92 + cz * wave, y, Math.min(cz * r, (-0.07 - 0.04 * Math.abs(cz)) * K) - sx * wave * 0.3];
        const pts = [
          onHead(0.3, az, R * 0.92, C),
          onHead(1.15, az, R + 0.022, C),
          onHead(1.75, az, R + 0.03, C),
          hang(below(0.22), 0.17 * flare, Math.sin(ph) * 0.03 * W),
          hang(below(0.31), rr(0.185) * flare, -Math.sin(ph) * 0.045 * W),
          hang(below(0.4), rr(0.195) * flare, Math.sin(ph) * 0.05 * W),
          hang(below(0.49), rr(0.2) * flare, -Math.sin(ph) * 0.045 * W),
          hang(below(0.57), rr(0.18) * flare, Math.sin(ph + 1) * 0.04 * W),
        ];
        h(lockGeometry(pts.slice(0, 4), 0.06, 0.06, 0.38), hair, null, false, false, hairAt);
        low.add(lockGeometry(pts.slice(1), 0.064, 0.016, 0.4), hair, null, false, false, hairAt);
      }
    }
    if (look.bun) h(new THREE.SphereGeometry(0.1, 14, 10), hair, (d) => d.position.set(0, C + 0.21, -0.07));
    if (look.scrunchie) {
      // fluffy scrunchie round the bun, in puffs
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        h(new THREE.SphereGeometry(look.partedHair ? 0.038 : 0.03, 8, 6), look.scrunchie, (d) => d.position.set(Math.cos(a) * 0.082, C + 0.155 + Math.sin(a) * 0.082 * 0.35, -0.07 + Math.sin(a) * 0.082 * 0.9));
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
    let lowHair = null;
    if (low.parts.length) {
      lowHair = new THREE.Group();
      lowHair.position.copy(head.position);
      lowHair.scale.setScalar(hs);
      lowHair.add(withOutline(new THREE.Mesh(mergeParts(low.parts), mat), 0.005, outline));
      inner.add(lowHair);
    }

    // face painted on a patch of sphere just in front of the head
    const faces = { open: canvasTexture(drawFace(look.openEyes ? "open" : "closed")) };
    if (look.openEyes) {
      faces.blink = canvasTexture(drawFace("blink"));
      faces.closed = faces.blink; // happy closed eyes, held for a wish
      for (const f of ["wince", "huh", "daze", "cry", "cry2"]) faces[f] = canvasTexture(drawFace(f));
    }
    const faceMat = new THREE.MeshToonMaterial({ map: faces.open, transparent: true, emissive: 0x24160c });
    const faceGeo = new THREE.SphereGeometry(HEAD_R + 0.004, 18, 12, Math.PI * 0.5 - 0.75, 1.5, Math.PI * 0.5 - 0.3, 0.84);
    const face = new THREE.Mesh(look.partedHair ? chibiHead(faceGeo, HEAD_R + 0.004) : faceGeo, faceMat);
    face.position.y = C;
    face.scale.set(1.03, 1, 0.95);
    head.add(face);

    // accessories without an outline: glasses, hair clip
    const acc = partList();
    const specs = partList();
    if (look.glasses && look.partedHair) {
      // big, thin, softly octagonal frames round her (larger) painted eyes,
      // on their own mesh so they can be knocked askew
      const ring = new THREE.TorusGeometry(0.047, 0.0032, 6, 24);
      for (const x of [-0.058, 0.058]) {
        specs.add(ring, look.glasses, (d) => {
          d.position.set(x, C - 0.028, 0.178);
          d.scale.set(1.04, 1, 1);
        });
      }
      specs.add(new THREE.BoxGeometry(0.026, 0.004, 0.004), look.glasses, (d) => d.position.set(0, C - 0.012, 0.184));
      for (const x of [-1, 1]) {
        specs.add(new THREE.BoxGeometry(0.004, 0.004, 0.18), look.glasses, (d) => {
          d.position.set(x * 0.135, C - 0.02, 0.09);
          d.rotation.y = -x * 0.36;
        });
      }
    } else if (look.glasses) {
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
    if (look.hairClip && look.partedHair) {
      // two open rectangular bars above her right temple
      const clipBar = new THREE.TorusGeometry(0.028, 0.0055, 4, 4).rotateZ(Math.PI / 4);
      for (const [az, pol] of [[-0.86, 1.0], [-0.66, 0.96]]) {
        const [x, y, z] = onHead(pol, az, HEAD_R + 0.078, C);
        acc.add(clipBar, look.hairClip, (d) => {
          // stands upright (faces out level, not along the curve of the
          // crown) so it reads as a clip from the front
          d.position.set(x, y, z);
          d.lookAt(0, y, 0);
          d.rotateZ(0.45);
          d.scale.set(0.62, 1.45, 1);
        });
      }
    } else if (look.hairClip) {
      for (const dx of [0, 0.03]) {
        acc.add(new THREE.BoxGeometry(0.022, 0.066, 0.014), look.hairClip, (d) => {
          d.position.set(0.09 + dx, C + 0.105, 0.135);
          d.rotation.set(-0.55, 0, -0.4);
        });
      }
    }
    if (acc.parts.length) head.add(new THREE.Mesh(mergeParts(acc.parts), mat));
    let glassesMesh = null;
    if (specs.parts.length) {
      glassesMesh = new THREE.Mesh(mergeParts(specs.parts), mat);
      head.add(glassesMesh);
    }

    // arms hang from shoulder pivots; rotation.z swings them out to the
    // side, rotation.x reaches them forward
    // the forearm hangs from an elbow pivot so hands can come together
    // (a wai, carrying a krathong at the chest)
    const ELBOW_Y = -0.29;
    const upperGeo = (() => {
      const { parts, add } = partList();
      if (look.puffSleeve) add(new THREE.SphereGeometry(0.07, 12, 10), sleeve, (d) => { d.position.y = -0.04; d.scale.set(1, 0.9, 1); });
      else add(new THREE.CylinderGeometry(0.048, 0.044, 0.16, 10), sleeve, (d) => (d.position.y = -0.07));
      add(new THREE.CylinderGeometry(0.03, 0.028, 0.24, 10), skin, (d) => (d.position.y = -0.18));
      add(new THREE.SphereGeometry(0.029, 8, 6), skin, (d) => (d.position.y = ELBOW_Y));
      return mergeParts(parts);
    })();
    const foreGeo = (() => {
      const { parts, add } = partList();
      add(new THREE.CylinderGeometry(0.027, 0.023, 0.2, 10), skin, (d) => (d.position.y = -0.09));
      add(new THREE.SphereGeometry(0.034, 10, 8), skin, (d) => { d.position.y = -0.21; d.scale.set(1, 1.15, 0.8); });
      return mergeParts(parts);
    })();
    const arms = [];
    const elbows = [];
    const hands = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.165, 1.13, 0);
      pivot.add(withOutline(new THREE.Mesh(upperGeo, mat), 0.005, outline));
      const elbow = new THREE.Group();
      elbow.position.y = ELBOW_Y;
      elbow.rotation.x = -0.12;
      elbow.add(withOutline(new THREE.Mesh(foreGeo, mat), 0.005, outline));
      pivot.add(elbow);
      const hand = new THREE.Object3D(); // palm, for carrying things
      hand.position.y = -0.21;
      elbow.add(hand);
      inner.add(pivot);
      arms.push(pivot);
      elbows.push(elbow);
      hands.push(hand);
    }
    group.rotation.y = yaw;
    scene.add(group);
    // top of the head (with a bun) in group space, for name tags
    const topY = (NECK_Y + 0.04 + (C + (look.bun ? 0.31 : HEAD_R + 0.03)) * hs) * (height / 1.8);
    const p = { group, inner, mat, head, lowHair, face, glassesMesh, faceC: C, arms, elbows, hands, legs, stride: 0, walk: 0, height, yaw, topY, faces, faceMat, blinkAt: rand(1, 4), t: rand(0, 10), pose: { tilt: 0, squat: 0, armL: -0.12, armR: 0.12 } };
    people.push(p);
    return p;
  }
  const teacher = buildPerson(
    // Kru Song as a cartoon: long straight black hair parted in the middle
    // (no fringe), half up in a top bun with a white scrunchie, a white
    // two-bar clip, big thin rose-gold glasses, big warm anime eyes; dressed
    // for the festival in a white lace puff-sleeve blouse, pink pendant and
    // pha sin
    {
      skin: "#fde3d2",
      hair: "#18110f",
      hairTip: "#2c1f1a",
      hairWave: 0.15,
      headScale: 1.9,
      hairFit: 0.84,
      frontLocks: 3,
      frontLockW: 0.036,
      curlIn: true,
      outline: true,
      softShade: true,
      rim: "#5a4a9a",
      lace: "#ffffff",
      partedHair: true,
      bun: true,
      scrunchie: "#fbf7ef",
      hairClip: "#f3efd8",
      glasses: "#d9a991",
      openEyes: true,
      top: "#fdf8f2",
      sleeve: "#fdf8f2",
      puffSleeve: true,
      pendant: "#e88ab8",
      skirt: "#d9548f",
      skirtBand: "#ffd27a",
      shoes: "#b0605a",
    },
    1.6,
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
  // Student lanterns hover in a band of sky above the canal that the wide
  // shot sees: under the top bar, clear of the moon, and never so near the
  // viewer that one fills the screen. `out` is the root (bottom of photo).
  const moonNdc = new THREE.Vector3();
  function inSky(x, y, z) {
    probe.set(x, y + 0.2, z).project(wideCam);
    // the photo hangs no lower than the far shore, over the water, and the
    // name tag stays under the top bar
    if (Math.abs(probe.x) > 0.85 || probe.y < 0.02 || probe.z > 1) return false;
    probe.set(x, y + SKY_PHOTO_H + SKY_GAP + 1.4, z).project(wideCam);
    if (probe.y > 0.84 || Math.abs(probe.x) > 0.85) return false;
    moonNdc.copy(moon.position).project(wideCam);
    probe.set(x, y + SKY_PHOTO_H, z).project(wideCam);
    return Math.hypot((probe.x - moonNdc.x) * wideCam.aspect, probe.y - moonNdc.y) > 0.32;
  }
  function skySpot(out) {
    for (let i = 0; i < 120; i++) {
      const x = rand(-17, 17);
      const z = rand(-15, -3);
      const y = rand(3, 8);
      if (inSky(x, y, z)) return out.set(x, y, z);
    }
    return out.set(rand(-3, 4), 3.4, rand(-9, -6));
  }

  function focusOn(k, seconds = 9) {
    camState.mode = "follow";
    camState.follow = k;
    camState.until = clock + seconds;
    orbit.lastInput = -1e9; // recentre on the krathong
    // a zoom right in on Kru Song mustn't start the close-up inside it
    orbit.zoom = Math.max(orbit.zoom, 0.4);
    orbit.sZoom = Math.max(orbit.sZoom, 0.4);
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

  // each button shows how many of its kind are still waiting for Kru Song
  function updateFloatBtn() {
    const waiting = [...queue, ...(performing ? [performing.k] : [])];
    const sky = waiting.filter((k) => k.sky).length;
    const fire = waiting.filter((k) => k.fire).length;
    const water = waiting.length - sky - fire;
    els.fireBtn.textContent = fire ? `🎆 กำลังจุด… (${fire})` : "🎆 จุดพลุ";
    els.floatBtn.textContent = water ? `🌸 กำลังลอย… (${water})` : "🌸 ลอยกระทง";
    els.lanternBtn.textContent = sky ? `🏮 กำลังปล่อย… (${sky})` : "🏮 ปล่อยโคมลอย";
  }

  // ----- Kru Song's poses -----
  // Her body is posed from named key poses. Each performance is a list of
  // [time, pose] keys; the current key is the target and every joint eases
  // toward it, so moves overlap and settle softly instead of snapping.
  // Arms: x pitches the arm forward (negative = forward/up), o swings it
  // out to the side (negative = across the body), e bends the elbow
  // (negative = forearm forward/up), w rocks the forearm (a wave).
  const ARM = {
    rest: { x: -0.1, o: 0.1, e: -0.2 },
    clasp: { x: -0.32, o: -0.42, e: -1.0 }, // hands together at the tummy
    hold: { x: -0.62, o: -0.36, e: -1.0 }, // carrying at the chest
    wish: { x: -0.5, o: -0.38, e: -1.2 }, // krathong held close, under the chin
    wai: { x: -0.22, o: -0.4, e: -2.35 }, // palms together at the chest
    reach: { x: -1.05, o: -0.18, e: -0.3 }, // down to the water
    lift: { x: -1.95, o: -0.22, e: -0.45 }, // lantern raised up in front
    open: { x: -2.2, o: 0.55, e: -0.25 }, // arms open after letting go
    heart: { x: -0.3, o: -0.36, e: -1.85 }, // hands to the chest, happy
    wave: { x: -0.25, o: 0.38, e: -2.15, w: 1 }, // hand up beside the face
  };
  const pose = (l, r, more = {}) => ({ l: ARM[l], r: ARM[r ?? l], dip: 0, lean: 0, rise: 0, hx: 0.06, hz: 0, eyes: 0, yaw: null, ...more });
  const IDLE = pose("clasp", "clasp", { hz: 0.08 });
  const IDLE_WAVE = pose("clasp", "wave", { hz: -0.14, hx: 0, yaw: TEACHER_YAW - 0.25 });
  // krathong: show it, make a wish, kneel, set it on the water, wai to the
  // river, stand, wave goodbye to it
  // She faces the viewer to show the krathong and make her wish, turns to
  // the water to set it down, and turns back to wave.
  const FACE_CAM = 0.42;
  const FACE_WATER = 1.5;
  const FLOAT_KEYS = [
    [0, pose("hold", "hold", { hx: 0.22, yaw: FACE_CAM })],
    [0.9, pose("wish", "wish", { hx: 0.2, eyes: 1, hz: 0.1, yaw: FACE_CAM })],
    [2.3, pose("hold", "hold", { dip: 0.08, lean: 0.06, hx: 0.3, yaw: FACE_WATER })],
    [3.1, pose("reach", "reach", { dip: 0.14, lean: 0.16, hx: 0.42, yaw: FACE_WATER })],
    [4.4, pose("wai", "wai", { dip: 0.12, lean: 0.1, hx: 0.36, eyes: 1, yaw: FACE_WATER })],
    [5.9, pose("clasp", "clasp", { hx: 0.02, hz: 0.12, yaw: 0.8 })],
    [6.6, pose("clasp", "wave", { hx: 0.05, hz: -0.12, yaw: FACE_CAM })],
    [8.3, null],
  ];
  const FLOAT_LET_GO = 3.5; // krathong leaves her hands
  const FLOAT_ON_WATER = 4.3; // ... and lands
  const FLOAT_CAMERA = 7.7; // camera goes to the krathong, after her wave
  // lantern: hold it while it fills with warm air (eyes closed, a wish),
  // raise it, let go with open arms, watch it rise, hands to the heart, wave
  // the lantern is held out toward the water so it never hides her face
  const SKY_SIDE = 1.3;
  const SKY_KEYS = [
    [0, pose("hold", "hold", { hx: 0.18, yaw: SKY_SIDE })],
    [1.0, pose("hold", "hold", { hx: 0.12, eyes: 1, hz: 0.1, yaw: SKY_SIDE })],
    [2.6, pose("lift", "lift", { hx: -0.3, rise: 0.035, yaw: SKY_SIDE })],
    [3.4, pose("open", "open", { hx: -0.5, rise: 0.05, yaw: SKY_SIDE })],
    [4.4, pose("heart", "heart", { hx: -0.46, hz: 0.14, yaw: 0.8 })],
    [5.9, pose("heart", "wave", { hx: -0.38, hz: -0.1, yaw: FACE_CAM })],
    [7.6, null],
  ];
  const SKY_LET_GO = 3.4;
  const SKY_CAMERA = 7.0;

  // current, eased pose (arm values are copied, never the presets)
  const cur = { l: { x: 0, o: 0.1, e: -0.2, w: 0 }, r: { x: 0, o: 0.1, e: -0.2, w: 0 }, dip: 0, lean: 0, rise: 0, hx: 0, hz: 0, eyes: 0 };
  teacher.cur = cur;
  let idleWaveAt = 6;
  function teacherTarget() {
    if (performing) {
      const keys = keysFor(performing.k);
      let want = IDLE;
      for (const [at, p] of keys) if (performing.t >= at && p) want = p;
      return want;
    }
    // idle: hands clasped, swaying a little; now and then a small wave
    if (teacher.t > idleWaveAt + 2.6) idleWaveAt = teacher.t + rand(9, 16);
    return teacher.t > idleWaveAt && camState.mode === "wide" ? IDLE_WAVE : IDLE;
  }
  function easeTeacher(dt) {
    const want = teacherTarget();
    const k = 1 - Math.exp(-dt * 4.2);
    for (const side of ["l", "r"]) {
      const a = cur[side];
      const b = want[side];
      a.x += (b.x - a.x) * k;
      a.o += (b.o - a.o) * k;
      a.e += (b.e - a.e) * k;
      a.w += ((b.w ?? 0) - a.w) * k;
    }
    for (const f of ["dip", "lean", "rise", "hx", "hz", "eyes"]) cur[f] += (want[f] - cur[f]) * k;
    const yaw = want.yaw ?? (performing ? TEACHER_YAW_FLOAT : TEACHER_YAW);
    teacher.group.rotation.y += wrapAngle(yaw - teacher.group.rotation.y) * Math.min(1, dt * 2.2);
  }
  function poseTeacher(p) {
    const c = cur;
    const t = p.t;
    const s = p.height / 1.8;
    // weight shifts gently from foot to foot; the back stays straight
    const sway = Math.sin(t * 0.9);
    p.inner.rotation.set(c.lean + (p.tilt || 0), 0, sway * 0.025 * (1 - c.dip * 2));
    p.inner.position.set(sway * 0.012 + (p.shake || 0) * s, (-c.dip * 0.95 + c.rise + (p.bob || 0)) * s, 0);
    p.inner.scale.setScalar(s);
    p.inner.scale.y = s * (1 + Math.sin(t * 1.6) * 0.006);
    // kneeling folds the legs back under the skirt
    p.legs[0].rotation.x = p.legs[1].rotation.x = c.dip * 3.2;
    [c.l, c.r].forEach((a, i) => {
      const side = i ? 1 : -1;
      const drift = Math.sin(t * 1.3 + i) * 0.03;
      p.arms[i].rotation.set(a.x + drift, 0, side * a.o);
      p.elbows[i].rotation.set(a.e, 0, side * a.w * Math.sin(t * 5.2) * 0.38);
      // flailing (the wet gag): fast, out-of-step windmilling
      if (p.flail) {
        p.arms[i].rotation.x += Math.sin(t * 13 + i * Math.PI) * 0.55 * p.flail;
        p.arms[i].rotation.z += side * Math.sin(t * 9 + i * 2) * 0.25 * p.flail;
        p.elbows[i].rotation.x += Math.sin(t * 15 + i) * 0.35 * p.flail;
      }
    });
    p.head.rotation.x = c.hx + Math.sin(t * 0.53) * 0.03;
    p.head.rotation.z = c.hz + Math.sin(t * 0.8) * 0.05;
    p.head.rotation.y = Math.sin(t * 0.31) * 0.08;
    p.lowHair?.rotation.set(p.head.rotation.x * 0.45, p.head.rotation.y * 0.6 + Math.sin(t * 23) * 0.07 * (p.hairBlow || 0), p.head.rotation.z * 0.5 + Math.sin(t * 17) * 0.08 * (p.hairBlow || 0));
  }

  const handWorld = new THREE.Vector3();
  const handB = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  // between her palms, a little in front of them
  function palms(out, ahead = 0.08) {
    teacher.hands[0].getWorldPosition(out);
    teacher.hands[1].getWorldPosition(handB);
    out.add(handB).multiplyScalar(0.5);
    fwd.set(0, 0, 1).applyQuaternion(teacher.group.quaternion);
    return out.addScaledVector(fwd, ahead);
  }
  function runPerformance(dt) {
    if (!performing && queue.length) {
      performing = { k: queue.shift(), t: 0 };
      // now and then she falls in: never twice running, and never three
      // dry floats in a row (any three floats in a row have a splash)
      const pk = performing.k;
      if (!pk.fire && !pk.sky) {
        pk.wet = !lastWet && (dryRun >= 2 || Math.random() < WET_CHANCE);
        dryRun = pk.wet ? 0 : dryRun + 1;
        lastWet = pk.wet;
      }
      resetGag();
      if (!performing.k.fire) {
        performing.k.root.visible = true;
        performing.k.root.scale.setScalar(0.001);
      }
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
    if (k.fire) firePerformance(P, k, t, dt);
    else if (k.sky) skyPerformance(P, k, t, dt);
    else if (k.wet) wetPerformance(P, k, t, dt);
    else floatPerformance(P, k, t);
    const keys = keysFor(k);
    if (t > keys[keys.length - 1][0]) {
      k.wet = false;
      performing = null;
      resetGag();
      updateFloatBtn();
    }
  }
  function floatPerformance(P, k, t) {
    if (t < FLOAT_LET_GO) {
      palms(handWorld, 0.1);
      handWorld.y -= 0.06;
      k.root.position.copy(handWorld);
      // (picked back up after the wet gag, it's already full size)
      k.root.scale.setScalar(Math.max(0.001, (P.picked ? 1 : smooth(clamp01(t / 0.5))) * 0.6));
      // the photo would hide her face; it pops up once it's on the water
      if (k.standee) k.standee.visible = false;
      if (!P.sparkled) {
        P.sparkled = true;
        burst(handWorld, 40, { speed: 1.4, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.8 });
      }
      P.from = handWorld.clone();
    } else if (t < FLOAT_ON_WATER) {
      // glides from her hands down onto the water with a little trail
      const u = smooth((t - FLOAT_LET_GO) / (FLOAT_ON_WATER - FLOAT_LET_GO));
      k.root.position.lerpVectors(P.from, DROP_POS, u);
      k.root.position.y += Math.sin(u * Math.PI) * 0.12;
      k.root.scale.setScalar(lerp(0.6, 1, u));
      P.trail = (P.trail ?? 0) - 1;
      if (P.trail <= 0) {
        P.trail = 3;
        burst(k.root.position, 4, { speed: 0.3, colors: [0xfff3b0, 0xffffff], life: 0.6, up: 0.2 });
      }
    } else if (!P.released) {
      P.released = true;
      k.root.position.copy(DROP_POS);
      k.root.scale.setScalar(1);
      k.placed = true;
      if (k.standee) {
        k.standee.visible = true;
        burst(new THREE.Vector3(DROP_POS.x, 0.9, DROP_POS.z), 36, { speed: 1.2, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.8 });
      }
      ripple(DROP_POS.x, DROP_POS.z, 1.8);
      ripple(DROP_POS.x, DROP_POS.z, 2.8);
      burst(new THREE.Vector3(DROP_POS.x, 0.1, DROP_POS.z), 30, { speed: 1.1, colors: [0xbfe6ff, 0xffffff], life: 0.6 });
      sound.plop();
      camState.until = 0;
    }
    if (t > FLOAT_CAMERA && !P.followed) {
      P.followed = true;
      focusOn(k, 8);
    }
  }
  function skyPerformance(P, k, t, dt) {
    if (t < SKY_LET_GO) {
      // held by its rim, the photo tucked away until it flies; it lights
      // up as it fills with hot air
      palms(handWorld, 0.22);
      const sc = Math.max(0.001, smooth(clamp01(t / 0.5)) * 0.55);
      k.root.scale.setScalar(sc);
      k.root.position.copy(handWorld);
      k.root.position.y -= k.rimY * sc;
      if (k.standee) k.standee.visible = false;
      k.lit = 0.25 + 0.75 * smooth(clamp01((t - 0.8) / 1.8));
      k.spin.position.y = k.rimY;
      k.spin.rotation.set(Math.sin(t * 2) * 0.03, k.spin.rotation.y, Math.sin(t * 1.7) * 0.04);
      if (!P.sparkled) {
        P.sparkled = true;
        burst(handWorld, 40, { speed: 1.4, colors: [0xfff3b0, 0xffd27a, 0xffffff], life: 0.8 });
      }
    } else if (!P.released) {
      P.released = true;
      k.lit = 1;
      // full size grows in as it rises, the photo appears with a sparkle
      P.from = k.root.position.clone();
      P.grow = 0;
      k.placed = true;
      k.launch = 4.5;
      k.vel.set(0, 0.35, 0);
      sound.chime();
    }
    if (P.released && !P.shown && t > SKY_LET_GO + 1.1) {
      // the photo appears with a sparkle once the lantern is above her head
      P.shown = true;
      if (k.standee) k.standee.visible = true;
      burst(new THREE.Vector3(k.root.position.x, k.root.position.y + k.rimY * 0.55, k.root.position.z), 50, { speed: 1.6, colors: [0xfff3b0, 0xffd27a, 0xffb3e6, 0xffffff], life: 1 });
    }
    if (P.released && P.grow < 1) {
      P.grow = Math.min(1, P.grow + dt * 0.7);
      k.root.scale.setScalar(lerp(0.55, 1, smooth(P.grow)));
    }
    if (t > SKY_CAMERA && !P.followed) {
      P.followed = true;
      focusOn(k, 9);
    }
  }

  // ----- fireworks: Kru Song lights a cake of fireworks on the pier.
  // One time in three it goes wrong, cartoon style: the fuse fizzles, she
  // peeks in, it blows up in her face (soot, frizzy hair, crooked glasses),
  // she wails, then wipes her face with a hankie, combs her hair and is
  // back to her pretty self. Every gag state is a pure function of the
  // performance time, so resetGag() is trivial. -----
  const FIRE_YAW = 1.0;
  const FIRE_POS = new THREE.Vector3(TEACHER_POS.x + Math.sin(FIRE_YAW) * 0.62, PIER.top, TEACHER_POS.z + Math.cos(FIRE_YAW) * 0.62);
  const FIRE_TOP = FIRE_POS.clone().add(new THREE.Vector3(0, 0.2, 0));
  const FUSE_TIP = FIRE_POS.clone().add(new THREE.Vector3(-0.05, 0.22, 0.07));
  const MAX_FIRE = 2; // waiting or in progress
  Object.assign(ARM, {
    show: { x: -1.25, o: 0.2, e: -1.1 }, // incense held up to show
    brace: { x: -1.45, o: -0.35, e: -1.6 }, // hands up to her mouth, bracing for the bang
    knees: { x: -0.6, o: -0.05, e: -0.15 }, // hands on knees, peeking
    shock: { x: -0.25, o: 0.8, e: -0.3 }, // arms flung out stiff
    cry: { x: -1.75, o: -0.28, e: -1.55 }, // fists up to her eyes
    pocket: { x: 0.2, o: 0.22, e: -0.6 }, // hand to her hip pocket
    wipe: { x: -1.8, o: -0.35, e: -1.45, w: 1 }, // hankie rubbing her face
    comb: { x: -2.4, o: 0.5, e: -1.4, w: 1 }, // combing the top of her hair
    clap: { x: -0.65, o: -0.42, e: -1.5, w: 1 }, // clapping
  });
  // light it: show the incense, crouch to the fuse, then hands up to her
  // mouth, eyes squeezed shut, bracing for the bang
  const FIRE_START = [
    [0, pose("show", "clasp", { hx: 0.05, hz: 0.1, yaw: FACE_CAM })],
    [1.0, pose("reach", "rest", { dip: 0.2, lean: 0.18, hx: 0.4, yaw: FIRE_YAW })],
    [2.1, pose("brace", "brace", { dip: 0.04, hx: 0.12, hz: 0.1, yaw: FACE_CAM })],
  ];
  const FIRE_OK_KEYS = [
    ...FIRE_START,
    [4.0, pose("heart", "heart", { hx: -0.45, hz: 0.1, yaw: 0.7 })],
    [6.4, pose("clap", "clap", { hx: -0.3, yaw: FACE_CAM })],
    [8.0, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [9.6, null],
  ];
  const FIRE_FAIL_KEYS = [
    ...FIRE_START,
    [3.5, pose("rest", "rest", { hz: 0.28, hx: 0.1, yaw: 0.75 })], // huh?
    [4.6, pose("knees", "knees", { dip: 0.06, lean: 0.3, hx: 0.45, yaw: FIRE_YAW })], // peeks in
    [5.8, pose("shock", "shock", { rise: 0.05, hx: -0.08, yaw: FACE_CAM })], // BOOM
    [7.6, pose("cry", "cry", { hx: -0.15, yaw: FACE_CAM })], // waaah
    [10.4, pose("pocket", "rest", { hx: 0.05, yaw: FACE_CAM })],
    [11.0, pose("wipe", "clasp", { hz: 0.12, yaw: FACE_CAM })],
    [13.4, pose("rest", "rest", { yaw: FACE_CAM })],
    [13.8, pose("comb", "rest", { hz: -0.15, yaw: FACE_CAM })],
    [16.2, pose("heart", "heart", { hz: 0.14, yaw: FACE_CAM })],
    [17.4, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [19.0, null],
  ];
  const keysFor = (k) => (k.fire ? (k.fail ? FIRE_FAIL_KEYS : FIRE_OK_KEYS) : k.sky ? SKY_KEYS : k.wet ? WET_KEYS : FLOAT_KEYS);

  // props
  const propMat = new THREE.MeshToonMaterial({ vertexColors: true, emissive: 0x24160c, gradientMap: softToonRamp() });
  const mortar = (() => {
    const { parts, add } = partList();
    add(new THREE.CylinderGeometry(0.085, 0.09, 0.17, 16), "#d8323c", (d) => (d.position.y = 0.085));
    for (const y of [0.03, 0.14]) add(new THREE.TorusGeometry(0.088, 0.008, 6, 20), "#ffd27a", (d) => { d.position.y = y; d.rotation.x = Math.PI / 2; });
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.01, 16), "#3a2a2a", (d) => (d.position.y = 0.172));
    // a few tubes poking out of the top
    for (const [x, z] of [[0, 0], [0.035, 0.02], [-0.03, 0.03], [0.01, -0.035]]) add(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 8), "#f6e7c8", (d) => d.position.set(x, 0.185, z));
    // the fuse
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 5), "#6b4a2a", (d) => { d.position.set(-0.04, 0.2, 0.05); d.rotation.set(0.6, 0, 0.5); });
    const m = withOutline(new THREE.Mesh(mergeParts(parts), propMat), 0.004, true);
    m.position.copy(FIRE_POS);
    m.visible = false;
    scene.add(m);
    return m;
  })();
  // props held in her right hand (the hand pivot hangs at the end of the
  // forearm; the forearm runs along its -y)
  const handProp = (build) => {
    const { parts, add } = partList();
    build(add);
    const m = new THREE.Mesh(mergeParts(parts), propMat);
    m.visible = false;
    teacher.hands[0].add(m);
    return m;
  };
  const incense = handProp((add) => {
    add(new THREE.CylinderGeometry(0.005, 0.005, 0.34, 5), "#9a5a32", (d) => { d.position.set(0, -0.02, 0.12); d.rotation.x = Math.PI / 2; });
    add(new THREE.SphereGeometry(0.012, 8, 6), "#ff5a2a", (d) => d.position.set(0, -0.02, 0.29));
  });
  const ember = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xff7a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  ember.scale.setScalar(0.12);
  ember.position.set(0, -0.02, 0.29);
  incense.add(ember);
  const hankie = (() => {
    const c = makeCanvas(128, 128);
    const g = c.getContext("2d");
    g.fillStyle = "#ff9cc8";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#ffffff";
    for (let y = 16; y < 128; y += 24) for (let x = (y / 24) % 2 ? 16 : 28; x < 128; x += 24) {
      g.beginPath();
      g.arc(x, y, 4, 0, TAU);
      g.fill();
    }
    g.strokeStyle = "#ffffff";
    g.lineWidth = 8;
    g.setLineDash([6, 5]);
    g.strokeRect(6, 6, 116, 116);
    const geo = new THREE.PlaneGeometry(0.17, 0.17, 6, 6);
    // a soft droop, like cloth
    const pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setZ(i, 0.03 * Math.sin(pp.getX(i) * 18) - 0.05 * (pp.getY(i) + 0.085) ** 2 * 8);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ map: canvasTexture(c), side: THREE.DoubleSide, emissive: 0x24160c, gradientMap: softToonRamp() }));
    // in the palm; with her forearm folded up to her face the hand's -z
    // faces the viewer
    m.position.set(0, -0.01, -0.06);
    m.visible = false;
    teacher.hands[0].add(m);
    return m;
  })();
  const comb = handProp((add) => {
    add(new THREE.BoxGeometry(0.17, 0.034, 0.014), "#ff86b8", (d) => d.position.set(0, -0.02, -0.05));
    for (let i = 0; i < 12; i++) add(new THREE.BoxGeometry(0.007, 0.05, 0.009), "#ff86b8", (d) => d.position.set(-0.077 + i * 0.014, -0.06, -0.05));
  });
  // the gag's look: frizzy afro over her hair, soot on her face, a "?"
  const C0 = teacher.faceC;
  const frizz = (() => {
    const { parts, add } = partList();
    for (let i = 0; i < 46; i++) {
      // puffs all over the top and sides of the head, sooty grey here and there
      const pol = Math.acos(rand(-0.25, 1));
      const az = rand(0, TAU);
      if (pol > 1.2 && Math.cos(az) > 0.45) continue; // keep her face clear
      const r = HEAD_R + rand(0.05, 0.09);
      const [x, y, z] = onHead(pol, az, r, C0);
      add(new THREE.SphereGeometry(rand(0.045, 0.07), 10, 8), Math.random() < 0.25 ? "#4a4440" : "#1d1513", (d) => d.position.set(x, y, z));
    }
    // a few singed spikes
    for (let i = 0; i < 9; i++) {
      const pol = rand(0.2, 1.3);
      const az = rand(0, TAU);
      if (Math.cos(az) > 0.6 && pol > 0.9) continue;
      const [x, y, z] = onHead(pol, az, HEAD_R + 0.13, C0);
      add(new THREE.ConeGeometry(0.025, 0.11, 6), "#1d1513", (d) => {
        d.position.set(x, y, z);
        d.lookAt(x * 2, (y - C0) * 2 + C0, z * 2);
        d.rotateX(Math.PI / 2);
      });
    }
    const m = withOutline(new THREE.Mesh(mergeParts(parts), new THREE.MeshToonMaterial({ vertexColors: true, emissive: 0x24160c, gradientMap: softToonRamp() })), 0.005, true);
    m.visible = false;
    teacher.head.add(m);
    return m;
  })();
  const soot = (() => {
    const geo = chibiHead(new THREE.SphereGeometry(HEAD_R + 0.002, 24, 14, Math.PI * 0.5 - 1.1, 2.2, Math.PI * 0.5 - 0.55, 1.25), HEAD_R + 0.002);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: canvasTexture(drawSoot()), transparent: true, depthWrite: false, opacity: 0 }));
    m.position.copy(teacher.face.position);
    m.scale.copy(teacher.face.scale);
    m.renderOrder = 1;
    m.userData.ownFade = true;
    m.visible = false;
    teacher.face.renderOrder = 2;
    teacher.head.add(m);
    return m;
  })();
  const question = (() => {
    const c = drawQuestion();
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(c), transparent: true, depthWrite: false }));
    m.scale.set(0.36, 0.45, 1);
    m.visible = false;
    teacher.group.add(m);
    return m;
  })();

  // every gag state at time t of a performance (fail = the mishap)
  function gagState(fail, t) {
    const g = gagBase();
    if (t < 0) return g;
    if (t > 2.1 && t < (fail ? 3.3 : 3.9)) g.face = "wince";
    if (!fail) {
      // a happy little hop at each burst
      if (t > 4.6 && t < 7.4) g.bob = Math.abs(Math.sin((t - 4.6) * 4.5)) * 0.02;
      return g;
    }
    if (t >= 3.5 && t < 4.7) {
      g.face = "huh";
      g.question = Math.sin(clamp01((t - 3.5) / 1.2) * Math.PI);
    }
    if (t >= 5.8) {
      const u = t - 5.8;
      g.soot = t < 11.3 ? 1 : 1 - smooth(clamp01((t - 11.3) / 2));
      // four comb strokes, each tames a quarter of the frizz
      const strokes = clamp01((t - 14) / 2) * 4;
      g.frizz = t < 14 ? 1 + 0.3 * Math.exp(-u * 4) * Math.sin(u * 28) : 1 - (Math.floor(strokes) + smooth(strokes % 1)) / 4;
      g.askew = t < 13.4 ? 1 : 1 - smooth(clamp01((t - 13.4) / 0.4));
      g.shake = t < 6.4 ? Math.exp(-u * 7) * Math.sin(u * 60) * 0.03 : 0;
      if (t < 7.6) g.face = "daze";
      else if (t < 10.4) {
        g.face = Math.floor(t * 4) % 2 ? "cry" : "cry2";
        // little sobbing bounces
        g.bob = Math.abs(Math.sin((t - 7.6) * 7)) * 0.025;
      } else if (t < 11.0) g.face = "cry2";
      else if (t < 13.4) g.face = "blink"; // eyes shut while she wipes
      g.hankie = t > 10.9 && t < 13.5;
      g.comb = t > 13.7 && t < 16.2;
    }
    return g;
  }
  function applyGag(g) {
    soot.visible = g.soot > 0.001;
    soot.material.opacity = g.soot;
    // the puffs sink into her hair as the frizz goes (below ~0.78 they're
    // hidden), so each comb stroke visibly tames a quarter of it
    frizz.visible = g.frizz > 0.02;
    frizz.scale.setScalar(0.78 + 0.22 * g.frizz);
    if (teacher.glassesMesh) {
      teacher.glassesMesh.rotation.z = -0.3 * g.askew;
      teacher.glassesMesh.position.set(0.012 * g.askew, -0.03 * g.askew, 0);
    }
    teacher.faceOverride = g.face;
    teacher.bob = g.bob;
    teacher.shake = g.shake;
    hankie.visible = g.hankie;
    comb.visible = g.comb;
    question.visible = g.question > 0.01;
    // beside her head, clear of the name tag
    question.position.set(0.4, teacher.topY - 0.12 + Math.sin(teacher.t * 6) * 0.03, 0);
    question.material.opacity = g.question;
    applyWet(g);
  }
  function resetGag() {
    applyGag(gagState(false, -1));
    mortar.visible = false;
    incense.visible = false;
  }

  function enqueueFire() {
    const waiting = queue.filter((k) => k.fire).length + (performing?.k.fire ? 1 : 0);
    if (waiting >= MAX_FIRE) return false;
    queue.push({ fire: true, fail: Math.random() < 1 / 3 });
    updateFloatBtn();
    return true;
  }

  // the success show: four shells, the last a drooping gold willow
  const SHELLS = [
    { at: 3.6, style: "peony", colors: [0xff5fa8, 0xffe27a], speed: 4.6 },
    { at: 4.3, style: "ring", colors: [0x7fd4ff, 0xffffff], speed: 4.4 },
    { at: 5.0, style: "heart", colors: [0xff6fae, 0xffd0e6], speed: 3.8 },
    { at: 5.9, style: "willow", colors: [0xffd27a], speed: 4.0 },
  ];
  const eyeTmp = new THREE.Vector3();
  const eyeTmp2 = new THREE.Vector3();
  const headQ = new THREE.Quaternion();
  const headSide = new THREE.Vector3();
  function firePerformance(P, k, t, dt) {
    applyGag(gagState(k.fail, t));
    // the cake pops onto the pier, and goes once it's spent
    const gone = k.fail ? 5.85 : 8.6;
    mortar.visible = t > 0.2 && t < gone;
    mortar.scale.setScalar(Math.max(0.001, smooth(clamp01((t - 0.2) / 0.35))));
    if (t > 0.2 && !P.placed) {
      P.placed = true;
      burst(FIRE_TOP, 24, { speed: 1.1, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.7 });
      sound.plop();
    }
    if (!k.fail && t > gone - 0.4 && !P.cleared) {
      P.cleared = true;
      burst(FIRE_TOP, 18, { speed: 0.9, colors: [0xfff3b0, 0xffffff], life: 0.6 });
    }
    incense.visible = t < 2.3;
    // the lit fuse spits sparks
    const fuseEnd = k.fail ? 3.1 : 3.6;
    if (t > 1.85 && t < fuseEnd) {
      P.fuseT = (P.fuseT ?? 0) - dt;
      if (P.fuseT <= 0) {
        P.fuseT = 0.05;
        burst(FUSE_TIP, 4, { speed: 0.9, colors: [0xfff1a8, 0xffb347, 0xffffff], life: 0.35 });
        if (Math.random() < 0.3) sound.pop(0.05);
      }
    }
    if (!k.fail) {
      SHELLS.forEach((sh, i) => {
        if (t > sh.at && !(P.shot & (1 << i))) {
          P.shot = (P.shot ?? 0) | (1 << i);
          launchRocket(FIRE_TOP, sh);
          burst(FIRE_TOP, 14, { speed: 1.4, colors: [0xfff1a8, 0xffffff], life: 0.4 });
        }
      });
      return;
    }
    // ----- the mishap -----
    if (t > 3.1 && !P.fizzled) {
      P.fizzled = true;
      sound.fizzle();
      puff(FUSE_TIP, { size: 0.12, grow: 2.5, life: 1.1, rise: 0.3, spread: 0.05, a: 0.6, color: 0x8a8088 });
    }
    teacher.head.getWorldPosition(eyeTmp);
    eyeTmp.y += 0.22;
    if (t > 5.8 && !P.boom) {
      P.boom = true;
      eyeTmp2.lerpVectors(FIRE_TOP, eyeTmp, 0.6);
      flash(eyeTmp2, 3.2, 0xffd890, 0.45);
      fwShell(eyeTmp2, "peony", [0xffe27a, 0xff7a3a], 2.2);
      burst(eyeTmp2, 60, { speed: 2.6, colors: [0xfff1a8, 0xffb347, 0xff5a3a, 0xffffff], life: 0.6 });
      for (let i = 0; i < 12; i++) puff(eyeTmp, { size: 0.3, grow: 2.4, life: 1.6, rise: 0.4, spread: 0.6, a: 0.9 });
      sound.boom(0.6);
      sound.crackle(10, 0.1);
    }
    // smoke still curling off her singed hair
    if (t > 6 && t < 11) {
      P.wisp = (P.wisp ?? 0) - dt;
      if (P.wisp <= 0) {
        P.wisp = 0.28;
        puff(eyeTmp.clone().add(new THREE.Vector3(rand(-0.15, 0.15), 0.3, rand(-0.1, 0.1))), { size: 0.08, grow: 3, life: 1.6, rise: 0.45, spread: 0.06, a: 0.55, color: 0x6a6268 });
      }
    }
    // a little cough of smoke
    if (t > 6.9 && !P.cough) {
      P.cough = true;
      puff(eyeTmp.clone().add(new THREE.Vector3(0.05, -0.12, 0.15)), { size: 0.1, grow: 2.5, life: 0.9, rise: 0.2, spread: 0.1, a: 0.7 });
    }
    // fountains of tears from both eyes, flying sideways
    if (t > 7.7 && t < 10.4) tearFountain();
    for (const [at, flag] of [[7.8, 1], [8.7, 2], [9.6, 4]]) {
      if (t > at && !((P.sobs ?? 0) & flag)) {
        P.sobs = (P.sobs ?? 0) | flag;
        sound.sob();
      }
    }
    // tidied up: a sparkle over her hair and she's pretty again
    if (t > 16.2 && !P.sparkled) {
      P.sparkled = true;
      burst(eyeTmp, 50, { speed: 1.5, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.9 });
      sound.chime();
    }
  }
  function fireShot(pos, look, P) {
    // the mishap gets a close shot on her; otherwise a wide one with sky
    const close = P.k.fail && P.t > 3.4 && P.t < 17.8;
    if (close) {
      look.set(TEACHER_POS.x, 1.6, TEACHER_POS.z);
      pos.set(TEACHER_POS.x + Math.sin(0.6) * 3.7, 1.85, TEACHER_POS.z + Math.cos(0.6) * 3.7 + (camera.aspect < 1 ? 1.6 : 0));
    } else {
      // low and to the side: her whole figure in the lower third, the
      // bursts in the sky above
      look.set(-2.2, 2.9, 0.5);
      pos.set(0.5, 1.4, camera.aspect < 1 ? 14 : 11);
    }
  }

  // ----- the wet gag: now and then, kneeling to set her krathong on the
  // water, Kru Song wobbles and falls in, splash! The krathong flips out of
  // her hands onto the pier. She surfaces bawling, scrambles back up and
  // stands there dripping with a lily pad on her head, spits out the river
  // and cries; then towels off, dries and combs her hair, powders her nose,
  // is her pretty self again, picks the krathong up and floats it after
  // all. Like the fire gag, every state is a pure function of time. -----
  const WET_CHANCE = 1 / 3;
  let lastWet = false;
  let dryRun = 0; // water floats since she last fell in
  const WET_IN = new THREE.Vector3(-2.05, 0, 1.95); // where her feet go in
  const WET_UP = new THREE.Vector3(-1.6, 0, 1.95); // where she bobs up
  const WET_EDGE_X = -2.12; // treading water at the pier's edge
  const WET_FLOAT_Y = -0.85; // feet, treading water (shoulders just out)
  const WET_SPLASH = new THREE.Vector3(-1.45, 0.05, 1.95);
  // the krathong lands beside her on the deck (beside, as the close shot
  // sees her, so it never hides her)
  const WET_DECK = new THREE.Vector3(TEACHER_POS.x - 0.46, PIER.top, TEACHER_POS.z + 0.31);
  const WET_PICK_YAW = Math.atan2(WET_DECK.x - TEACHER_POS.x, WET_DECK.z - TEACHER_POS.z);
  const FACE_PIER = FACE_WATER - Math.PI;
  const WET_OFFSET = 23.2; // the ordinary float starts here
  const WET_SPLASH_T = 5.3; // she hits the water
  Object.assign(ARM, {
    flail: { x: -0.2, o: 1.6, e: -0.3 }, // arms straight out, windmilling for balance
    paddle: { x: -0.25, o: 2.3, e: -0.5, w: 1 }, // both arms up in a V, waving for help
    climb: { x: -2.5, o: 0.15, e: -0.3 }, // hauling herself up onto the deck
    rub: { x: -0.85, o: -0.5, e: -1.3, w: 1 }, // towelling her front
    towel: { x: -2.6, o: 0.35, e: -1.7, w: 1 }, // both hands rubbing the towel on her head
    dryer: { x: -2.2, o: 0.75, e: -1.0 }, // hair dryer held up to her hair
    powder: { x: -1.6, o: -0.2, e: -1.9, w: 1 }, // dabbing her cheek with a powder puff
  });
  const WET_GAG_KEYS = [
    [0, pose("hold", "hold", { hx: 0.22, yaw: FACE_CAM })],
    [0.9, pose("wish", "wish", { hx: 0.2, eyes: 1, hz: 0.1, yaw: FACE_CAM })],
    [2.3, pose("hold", "hold", { dip: 0.08, lean: 0.06, hx: 0.3, yaw: FACE_WATER })],
    [3.0, pose("reach", "reach", { dip: 0.14, lean: 0.16, hx: 0.42, yaw: FACE_WATER })],
    [3.6, pose("flail", "flail", { dip: 0.04, hx: -0.1, yaw: FACE_WATER })], // whoa, whoa!
    [4.4, pose("shock", "shock", { hx: -0.2, yaw: FACE_WATER })], // over she goes
    [6.0, pose("paddle", "paddle", { hx: -0.15, yaw: FACE_CAM })], // bobs up, bawling
    [7.6, pose("paddle", "paddle", { hx: 0, yaw: FACE_PIER })], // splashes to the pier
    [8.3, pose("climb", "climb", { hx: -0.2, yaw: FACE_PIER })],
    [9.5, pose("rest", "rest", { yaw: FACE_CAM })], // standing there dripping
    [10.1, pose("rest", "rest", { hx: -0.25, yaw: FACE_CAM })], // pffft
    [10.8, pose("cry", "cry", { hx: -0.15, yaw: FACE_CAM })], // waaah
    [13.4, pose("pocket", "rest", { yaw: FACE_CAM })],
    [13.8, pose("rub", "rub", { hz: 0.1, yaw: FACE_CAM })],
    [15.4, pose("towel", "towel", { hx: 0.15, yaw: FACE_CAM })],
    [17.2, pose("dryer", "rest", { hz: -0.12, yaw: FACE_CAM })],
    [19.0, pose("comb", "rest", { hz: -0.15, yaw: FACE_CAM })],
    [20.6, pose("powder", "rest", { hz: 0.1, yaw: FACE_CAM })],
    [21.6, pose("heart", "heart", { hz: 0.14, yaw: FACE_CAM })], // pretty again
    [22.4, pose("reach", "reach", { dip: 0.16, lean: 0.2, hx: 0.4, yaw: WET_PICK_YAW })], // picks the krathong up
  ];
  const WET_KEYS = [...WET_GAG_KEYS, ...FLOAT_KEYS.map(([at, p]) => [at + WET_OFFSET, p])];

  // props: a towel, the same towel over her head, a hair dryer, a powder
  // puff, a lily pad hat and a "!"
  const towelTex = (() => {
    const c = makeCanvas(128, 128);
    const g = c.getContext("2d");
    g.fillStyle = "#9fd8ff";
    g.fillRect(0, 0, 128, 128);
    for (const [y, col] of [[18, "#ffffff"], [30, "#ffe27a"], [98, "#ffe27a"], [110, "#ffffff"]]) {
      g.fillStyle = col;
      g.fillRect(0, y - 4, 128, 8);
    }
    // a little duck in the middle
    g.fillStyle = "#ffd84a";
    g.beginPath();
    g.ellipse(60, 70, 16, 11, 0, 0, TAU);
    g.ellipse(74, 58, 9, 9, 0, 0, TAU);
    g.fill();
    g.fillStyle = "#ff9a3a";
    g.beginPath();
    g.moveTo(82, 57);
    g.lineTo(90, 60);
    g.lineTo(82, 62);
    g.fill();
    return canvasTexture(c);
  })();
  const towelMat = new THREE.MeshToonMaterial({ map: towelTex, side: THREE.DoubleSide, emissive: 0x24160c, gradientMap: softToonRamp() });
  const towel = (() => {
    const geo = new THREE.PlaneGeometry(0.3, 0.22, 8, 6);
    const pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setZ(i, 0.025 * Math.sin(pp.getX(i) * 22) - 0.05 * (pp.getY(i) + 0.11) ** 2 * 6);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, towelMat);
    m.position.set(0, -0.02, -0.07);
    m.visible = false;
    teacher.hands[0].add(m);
    return m;
  })();
  // over her head like a hood, hanging down at the back
  const headTowel = (() => {
    // a soft cap over the crown, tipped back off her forehead
    const geo = new THREE.SphereGeometry(HEAD_R + 0.05, 18, 8, 0, TAU, 0, Math.PI * 0.42);
    const m = new THREE.Mesh(geo, towelMat);
    m.position.set(0, C0 + 0.05, -0.03);
    m.rotation.x = -0.35;
    m.scale.set(1.12, 1.25, 1.12);
    m.visible = false;
    teacher.head.add(m);
    return m;
  })();
  const dryer = handProp((add) => {
    add(new THREE.CylinderGeometry(0.022, 0.026, 0.12, 10), "#ff9cc8", (d) => d.position.set(0, -0.03, 0)); // handle
    add(new THREE.CylinderGeometry(0.042, 0.042, 0.16, 14), "#ff86b8", (d) => { d.position.set(0, 0.04, -0.06); d.rotation.x = Math.PI / 2; }); // barrel
    add(new THREE.CylinderGeometry(0.03, 0.036, 0.03, 14), "#f6e7f0", (d) => { d.position.set(0, 0.04, -0.15); d.rotation.x = Math.PI / 2; }); // nozzle
    add(new THREE.SphereGeometry(0.044, 12, 8), "#ff86b8", (d) => d.position.set(0, 0.04, 0.02));
  });
  const powderPuff = handProp((add) => {
    add(new THREE.SphereGeometry(0.045, 12, 8), "#ffd6e6", (d) => { d.position.set(0, -0.02, -0.05); d.scale.set(1, 1, 0.45); });
    add(new THREE.TorusGeometry(0.022, 0.006, 6, 12), "#ff86b8", (d) => d.position.set(0, -0.02, -0.03));
  });
  const lilyPad = (() => {
    const { parts, add } = partList();
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 20, 1, false, 0.35, TAU - 0.7), "#4fae5a");
    // a little pink lotus bud on top
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      add(new THREE.SphereGeometry(0.026, 8, 6), "#ff9cc8", (d) => { d.position.set(Math.cos(a) * 0.018, 0.03, Math.sin(a) * 0.018); d.scale.set(0.7, 1.4, 0.7); });
    }
    add(new THREE.SphereGeometry(0.014, 8, 6), "#ffd84a", (d) => d.position.y = 0.045);
    const m = withOutline(new THREE.Mesh(mergeParts(parts), propMat), 0.004, true);
    m.position.set(0.02, C0 + 0.33, -0.05);
    m.rotation.set(-0.25, 0.4, 0.18);
    m.visible = false;
    teacher.head.add(m);
    return m;
  })();
  const exclaim = (() => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(drawQuestion("!")), transparent: true, depthWrite: false }));
    m.scale.set(0.36, 0.45, 1);
    m.visible = false;
    teacher.group.add(m);
    return m;
  })();
  const puddle = (() => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.42, 28), new THREE.MeshBasicMaterial({ color: 0x6fb0e8, map: tex.dot, transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(TEACHER_POS.x, PIER.top + 0.004, TEACHER_POS.z);
    m.visible = false;
    scene.add(m);
    return m;
  })();
  // cartoon drops bobbing round her while she's soaked
  const dropTex = canvasTexture(drawDrop());
  const DROP_AT = [[-0.42, -0.1], [0.44, -0.3], [-0.36, -0.55]];
  const drops = DROP_AT.map(() => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: dropTex, transparent: true, depthWrite: false }));
    m.scale.set(0.15, 0.2, 1);
    m.visible = false;
    teacher.group.add(m);
    return m;
  });
  const DRY = new THREE.Color(1, 1, 1);
  const WET_TINT = new THREE.Color(0.76, 0.83, 0.98);

  // every field either gag can set, at rest
  function gagBase() {
    return {
      soot: 0, frizz: 0, askew: 0, face: null, hankie: false, comb: false, bob: 0, shake: 0, question: 0,
      exclaim: 0, tilt: 0, flail: 0, hairBlow: 0, wet: 0, puddle: 0, drops: 0, lily: false, towel: false, headTowel: false, dryer: false, powder: false, pos: null,
    };
  }
  // where her feet are at time t of the wet gag (null = on the pier)
  const wetPos = new THREE.Vector3();
  function wetState(t) {
    const g = gagBase();
    if (t < 3.6 || t >= WET_OFFSET) return g;
    const p = wetPos.copy(TEACHER_POS);
    g.pos = p;
    if (t < 4.4) {
      // whoa... whoa... wobbling on the edge, arms going round
      const u = (t - 3.6) / 0.8;
      g.tilt = Math.sin(u * 14) * (0.08 + 0.22 * u);
      g.flail = 1;
      g.face = "huh";
      g.exclaim = Math.sin(clamp01(u * 1.3) * Math.PI);
    } else if (t < WET_SPLASH_T) {
      // ... and a belly flop into the river
      const u = (t - 4.4) / (WET_SPLASH_T - 4.4);
      p.lerpVectors(TEACHER_POS, WET_IN, smooth(u));
      p.y = lerp(PIER.top, -2.4, u * u * u) + Math.sin(u * Math.PI) * 0.6;
      g.tilt = 1.25 * smooth(u);
      g.face = "wince";
    } else if (t < 6.0) {
      // under (the water hides her)
      p.copy(WET_UP);
      p.y = -2.4;
    } else if (t < 9.5) {
      // bobs up bawling, splashes over to the pier and climbs out
      const pop = smooth(clamp01((t - 6.0) / 0.3));
      p.copy(WET_UP);
      p.y = lerp(-2.4, WET_FLOAT_Y, pop) + Math.sin(t * 5) * 0.04 * pop;
      if (t >= 7.6) p.x = lerp(WET_UP.x, WET_EDGE_X, smooth(clamp01((t - 7.6) / 0.7)));
      if (t >= 8.3) {
        // two heaves up onto the deck, then a roll onto it
        const h1 = smooth(clamp01((t - 8.3) / 0.6));
        const h2 = smooth(clamp01((t - 8.9) / 0.6));
        p.y = lerp(lerp(WET_FLOAT_Y, -0.35, h1), PIER.top, h2);
        p.x = lerp(WET_EDGE_X, -2.6, smooth(clamp01((t - 9.1) / 0.4)));
        g.tilt = 0.3 * Math.sin(clamp01((t - 8.3) / 1.2) * Math.PI);
      }
      g.flail = t < 8.3 ? 0.6 : 0;
      if (t < 7.6) g.face = Math.floor(t * 4) % 2 ? "cry" : "cry2";
      else g.face = "wince";
      g.lily = true;
      g.wet = 1;
    } else {
      // back on the pier: a little hop over to her spot
      const u = clamp01((t - 9.5) / 0.5);
      p.set(lerp(-2.6, TEACHER_POS.x, smooth(u)), PIER.top + Math.sin(u * Math.PI) * 0.06, TEACHER_POS.z);
      g.wet = t < 13.8 ? 1 : 1 - smooth(clamp01((t - 13.8) / 4.6));
      g.lily = t < 15.5;
      // a puddle spreads under her, and dries up after she does
      g.puddle = smooth(clamp01((t - 9.6) / 2.5)) * (1 - smooth(clamp01((t - 18.5) / 2.5)));
      // soaked and shivering until the towel comes out
      g.drops = t < 13.8 ? smooth(clamp01((t - 9.6) / 0.4)) : 1 - smooth(clamp01((t - 13.8) / 0.6));
      if (t < 10.8 || (t >= 13.4 && t < 13.8)) g.shake = Math.sin(t * 75) * 0.006;
      if (t < 10.1) g.face = "daze";
      else if (t < 10.8) g.face = "wince"; // cheeks full of river
      else if (t < 13.4) {
        g.face = Math.floor(t * 4) % 2 ? "cry" : "cry2";
        g.bob = Math.abs(Math.sin((t - 10.8) * 7)) * 0.025;
      } else if (t < 13.8) g.face = "cry2";
      else if (t < 17.2) g.face = "blink"; // eyes shut while she towels off
      else if (t >= 20.6 && t < 21.6) g.face = "blink";
      g.towel = t > 13.5 && t < 15.4;
      g.headTowel = t >= 15.4 && t < 17.2;
      g.dryer = t > 17.1 && t < 19.0;
      g.hairBlow = t > 17.3 && t < 19.0 ? 1 : 0;
      g.comb = t > 18.95 && t < 20.6;
      g.powder = t > 20.5 && t < 21.6;
    }
    return g;
  }
  function applyWet(g) {
    teacher.tilt = g.tilt;
    teacher.flail = g.flail;
    teacher.hairBlow = g.hairBlow;
    teacher.group.position.copy(g.pos ?? TEACHER_POS);
    teacher.mat.color.lerpColors(DRY, WET_TINT, g.wet);
    lilyPad.visible = g.lily;
    drops.forEach((m, i) => {
      m.visible = g.drops > 0.01;
      m.material.opacity = g.drops;
      const [x, dy] = DROP_AT[i];
      m.position.set(x, teacher.topY + dy + Math.sin(teacher.t * 3 + i * 2) * 0.04, 0.05);
    });
    puddle.visible = g.puddle > 0.01;
    puddle.material.opacity = 0.55 * g.puddle;
    puddle.scale.setScalar(0.4 + 0.6 * g.puddle);
    towel.visible = g.towel;
    headTowel.visible = g.headTowel;
    dryer.visible = g.dryer;
    powderPuff.visible = g.powder;
    exclaim.visible = g.exclaim > 0.01;
    exclaim.position.set(0.4, teacher.topY - 0.12 + Math.sin(teacher.t * 9) * 0.03, 0);
    exclaim.material.opacity = g.exclaim;
  }
  resetGag();

  // fountains of tears from both eyes, flying sideways (both gags)
  function tearFountain() {
    teacher.head.getWorldQuaternion(headQ);
    for (const side of [-1, 1]) {
      eyeTmp2.set(side * 0.06, C0 - 0.02, 0.16);
      teacher.head.localToWorld(eyeTmp2);
      headSide.set(side, 0, 0).applyQuaternion(headQ);
      for (let i = 0; i < 2; i++) {
        const sp = rand(0.9, 1.4);
        const i0 = sparkHead;
        burst(eyeTmp2, 1, { speed: 0.01, colors: [0x9fe0ff, 0xd8f4ff], life: 0.7 });
        sparkVel.set([headSide.x * sp + rand(-0.1, 0.1), 0.9 + rand(0, 0.4), headSide.z * sp + rand(-0.1, 0.1)], i0 * 3);
      }
    }
  }
  // a drop that just falls (burst() always throws upward)
  function drip(at, vx = 0, vy = -0.2, vz = 0, life = 0.6) {
    const i0 = sparkHead;
    burst(at, 1, { speed: 0.01, colors: [0x9fe0ff, 0xd8f4ff, 0xffffff], life });
    sparkVel.set([vx, vy, vz], i0 * 3);
  }
  // fire each [time, ...] event once
  function once(P, key, t, at) {
    P.once ??= new Set();
    if (t < at || P.once.has(key)) return false;
    P.once.add(key);
    return true;
  }
  const wetTmp = new THREE.Vector3();
  function wetPerformance(P, k, t, dt) {
    applyGag(wetState(t));
    const water = (x, z) => wetTmp.set(x, 0.05, z);
    teacher.head.getWorldPosition(eyeTmp);

    // the krathong: in her hands, flipped out onto the pier as she wobbles,
    // waiting there, then back in her hands for the real float
    if (t < 3.65) floatPerformance(P, k, Math.min(t, 3.4));
    else if (t < 4.45) {
      if (!P.kFrom) P.kFrom = k.root.position.clone();
      const u = (t - 3.65) / 0.8;
      // a high arc on the far side of her head from the camera
      k.root.position.lerpVectors(P.kFrom, WET_DECK, u);
      k.root.position.y += Math.sin(u * Math.PI) * 1.3;
      k.root.position.z -= Math.sin(u * Math.PI) * 0.6;
      k.root.rotation.x = smooth(u) * TAU;
    } else if (t < 23.0) {
      k.root.position.copy(WET_DECK);
      k.root.rotation.x = 0;
      k.root.scale.setScalar(0.6);
    } else if (t < WET_OFFSET) {
      palms(handWorld, 0.1);
      handWorld.y -= 0.06;
      k.root.position.lerpVectors(WET_DECK, handWorld, smooth((t - 23.0) / (WET_OFFSET - 23.0)));
    } else {
      if (!P.picked) {
        // floatPerformance starts afresh: its sparkle, its glide
        P.picked = true;
        P.sparkled = false;
      }
      floatPerformance(P, k, t - WET_OFFSET);
    }
    if (once(P, "kland", t, 4.45)) {
      burst(WET_DECK, 24, { speed: 1.1, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.7 });
      sound.plop();
    }

    if (once(P, "slip", t, 3.6)) sound.slip();
    // SPLASH
    if (once(P, "splash", t, WET_SPLASH_T)) {
      burst(WET_SPLASH, 220, { speed: 3.6, colors: [0xbfe6ff, 0xffffff, 0x8fd0ff], life: 1.1, up: 1.8 });
      burst(WET_SPLASH, 80, { speed: 1.6, colors: [0xffffff], life: 0.8, up: 2.8 });
      flash(WET_SPLASH, 2.4, 0xbfe6ff, 0.35);
      for (const s of [1.6, 2.8, 4.2]) ripple(WET_SPLASH.x, WET_SPLASH.z, s, 0xcfe8ff);
      sound.splash();
    }
    // bubbles while she's under
    if (t > WET_SPLASH_T + 0.15 && t < 6.0) {
      P.bub = (P.bub ?? 0) - dt;
      if (P.bub <= 0) {
        P.bub = rand(0.12, 0.25);
        const at = water(WET_UP.x + rand(-0.25, 0.25), WET_UP.z + rand(-0.25, 0.25));
        burst(at, 4, { speed: 0.35, colors: [0xcfeeff, 0xffffff], life: 0.4, up: 0.4 });
        ripple(at.x, at.z, 0.5, 0xcfe8ff);
        sound.blub();
      }
    }
    // up she pops
    if (once(P, "surface", t, 6.0)) {
      const at = water(WET_UP.x, WET_UP.z);
      burst(at, 60, { speed: 2.2, colors: [0xbfe6ff, 0xffffff], life: 0.8, up: 1.4 });
      ripple(at.x, at.z, 2.0, 0xcfe8ff);
      sound.splash();
    }
    // splashing about while she's in the water
    if (t > 6.2 && t < 9.0) {
      P.slosh = (P.slosh ?? 0) - dt;
      if (P.slosh <= 0) {
        P.slosh = rand(0.15, 0.28);
        const g = teacher.group.position;
        const at = water(g.x + rand(-0.35, 0.35), g.z + rand(-0.3, 0.3));
        burst(at, 10, { speed: 1.3, colors: [0xbfe6ff, 0xffffff], life: 0.55 });
        if (Math.random() < 0.5) ripple(at.x, at.z, 0.9, 0xcfe8ff);
        if (Math.random() < 0.4) sound.pop(0.06);
      }
    }
    for (const at of [6.4, 7.2]) if (once(P, "sobw" + at, t, at)) sound.sob();
    // dripping on the pier: from her hair and hem, less as she dries
    const g = wetState(t);
    if (t > 9.4 && g.wet > 0.15) {
      P.drip = (P.drip ?? 0) - dt;
      if (P.drip <= 0) {
        P.drip = 0.04 / g.wet;
        const base = teacher.group.position;
        const hair = Math.random() < 0.5;
        wetTmp.set(base.x + rand(-0.17, 0.17), base.y + (hair ? rand(0.9, 1.3) : rand(0.25, 0.55)), base.z + rand(-0.15, 0.15));
        drip(wetTmp, 0, -0.3, 0, 0.5);
      }
    }
    // a little puddle splash as she lands back on the deck
    if (once(P, "deck", t, 9.6)) burst(teacher.group.position, 24, { speed: 1.2, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
    // pffft: a fountain of river from her mouth
    if (t > 10.3 && t < 10.75) {
      if (once(P, "spit", t, 10.3)) sound.spit();
      teacher.head.getWorldQuaternion(headQ);
      fwd.set(0, 0.45, 1).applyQuaternion(headQ);
      eyeTmp2.set(0, C0 - 0.09, 0.17);
      teacher.head.localToWorld(eyeTmp2);
      for (let i = 0; i < 3; i++) {
        const sp = rand(1.4, 2.0);
        drip(eyeTmp2, fwd.x * sp + rand(-0.1, 0.1), fwd.y * sp + 0.8, fwd.z * sp + rand(-0.1, 0.1), 0.8);
      }
    }
    if (t > 10.9 && t < 13.4) tearFountain();
    for (const at of [11.0, 11.9, 12.8]) if (once(P, "sob" + at, t, at)) sound.sob();
    // the lily pad pops off under the towel
    if (once(P, "lily", t, 15.5)) {
      lilyPad.getWorldPosition(wetTmp);
      burst(wetTmp, 16, { speed: 1, colors: [0x7fd48a, 0xffb3e6, 0xffffff], life: 0.6 });
    }
    // warm air from the dryer
    if (once(P, "dryer", t, 17.3)) sound.dryer(1.6);
    if (t > 17.3 && t < 18.9) {
      P.air = (P.air ?? 0) - dt;
      if (P.air <= 0) {
        P.air = 0.1;
        dryer.getWorldPosition(wetTmp);
        wetTmp.lerp(eyeTmp, 0.55);
        puff(wetTmp, { size: 0.06, grow: 2.5, life: 0.6, rise: 0.25, spread: 0.08, a: 0.35, color: 0xfff0e0 });
      }
    }
    // pat, pat, pat: little pink clouds of powder
    for (const at of [20.8, 21.1, 21.4]) {
      if (once(P, "powder" + at, t, at)) {
        powderPuff.getWorldPosition(wetTmp);
        puff(wetTmp, { size: 0.08, grow: 2.2, life: 0.8, rise: 0.15, spread: 0.06, a: 0.6, color: 0xffd6e6 });
      }
    }
    // pretty again
    if (once(P, "pretty", t, 21.6)) {
      eyeTmp2.copy(eyeTmp);
      eyeTmp2.y += 0.15;
      burst(eyeTmp2, 60, { speed: 1.6, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 1.0 });
      sound.chime();
    }
  }
  function wetShot(pos, look, P) {
    const portrait = camera.aspect < 1 ? 1.6 : 0;
    if (P.t > 2.3 && P.t < 6.0) {
      // set and still before she wobbles: side on from the front, the pier
      // on the left and the splash on the right, so the whole fall reads
      look.set(-2.4, 1.2, 1.95);
      pos.set(-2.4 + Math.sin(0.15) * 5.4, 1.7, 1.95 + Math.cos(0.15) * 5.4 + portrait);
    } else if (P.t >= 6.0 && P.t < WET_OFFSET + 0.4) {
      // the fire gag's close shot, kept on her wherever she goes (a little
      // higher while she's in the water, to see over the floating lamps)
      const g = teacher.group.position;
      const y = Math.min(PIER.top, Math.max(WET_FLOAT_Y, g.y)) - PIER.top;
      look.set(g.x, 1.6 + y, g.z);
      pos.set(g.x + Math.sin(0.6) * 3.7, Math.max(1.85 + y, 1.25), g.z + Math.cos(0.6) * 3.7 + portrait);
    } else {
      look.set(-2.6, 1.0, 1.6);
      pos.set(-1.3, 2.0, camera.aspect < 1 ? 8.8 : 7.2);
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
        easeTeacher(dt);
        poseTeacher(p);
      } else {
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
        // a gentle head tilt
        p.head.rotation.z = Math.sin(p.t * 0.8) * 0.07;
        p.head.rotation.x = Math.sin(p.t * 0.53) * 0.04 + q.tilt * 0.3;
      }
      // eyes closed while making a wish, otherwise a blink now and then
      if (p.faces.blink) {
        p.blinkAt -= dt;
        const shut = p === teacher && teacher.cur.eyes > 0.5;
        if (p === teacher && teacher.faceOverride) p.faceMat.map = p.faces[teacher.faceOverride];
        else p.faceMat.map = shut || p.blinkAt < 0 ? p.faces.blink : p.faces.open;
        if (p.blinkAt < -0.13) p.blinkAt = rand(2, 5);
      }
      // fade anyone the camera gets right up against during a close-up
      camYaw.subVectors(camera.position, p.group.position);
      // Kru Song is the centre of the orbit, so she only steps aside for a
      // krathong close-up
      const fade = p === teacher && camState.mode !== "follow" ? 1 : clamp01((camYaw.length() - 2.4) / 2.2);
      if (fade !== p.fade) {
        p.fade = fade;
        p.group.visible = fade > 0.02;
        p.group.traverse((o) => {
          if (o.material && !o.userData.ownFade) {
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
  const orbitPivot = new THREE.Vector3();
  let herW = 1; // 1 = orbiting round Kru Song, 0 = round a close-up
  const orbitSph = new THREE.Spherical();
  const touches = new Map();
  let pinchDist = 0;
  const zoomBy = (f) => {
    // round Kru Song the camera may come in close (the orbit radius stops it short of her)
    orbit.zoom = Math.min(2.4, Math.max(camState.mode === "follow" ? 0.4 : 0.15, orbit.zoom * f));
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
      orbit.pitch = Math.min(0.9, Math.max(-1.1, orbit.pitch + dy * 0.004));
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
    // (not one still with Kru Song, e.g. waiting on the pier in the wet gag)
    const hit = raycaster.intersectObjects(pickables, false).find((h) => h.object.userData.krathong.placed);
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
    fwPoints.material.uniforms.uScale.value = h * renderer.getPixelRatio() * 0.5;
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
    enqueueFire,
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
      if (k.sinking != null && k.sky) {
        // deleted lantern: rises away, shrinking, and goes out
        k.sinking += dt;
        const u = clamp01(k.sinking / 1.8);
        k.root.position.y += dt * (1 + u * 3);
        k.root.scale.setScalar(Math.max(0.001, 1 - u));
        if (u >= 1) {
          disposeKrathong(k);
          updateCount();
        }
        continue;
      }
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
      if (k.placed && k.sky) {
        // lanterns wander slowly in 3D through their band of sky
        const p = k.root.position;
        const tx = k.target.x - p.x;
        const ty = k.target.y - p.y;
        const tz = k.target.z - p.z;
        const dist = Math.hypot(tx, ty, tz);
        if (dist < 0.5 || clock > k.retarget) {
          skySpot(k.target);
          k.retarget = clock + rand(25, 45);
        }
        const sp = k.speed * Math.min(1, dist / 1.5);
        let vx = (tx / (dist || 1)) * sp;
        let vy = (ty / (dist || 1)) * sp;
        let vz = (tz / (dist || 1)) * sp;
        for (const o of krathongs) {
          if (o === k || !o.sky || !o.placed || o.sinking != null) continue;
          const dx = p.x - o.root.position.x;
          const dy = p.y - o.root.position.y;
          const dz = p.z - o.root.position.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < 2.2 && d > 0.001) {
            const push = (2.2 - d) * 0.35;
            vx += (dx / d) * push;
            vy += (dy / d) * push * 0.5;
            vz += (dz / d) * push;
          }
        }
        // just released: still climbing out of Kru Song's hands
        if (k.launch > 0) {
          k.launch -= dt;
          vy += 0.9 * smooth(clamp01(k.launch / 2));
        }
        const ease = Math.min(1, dt * 0.6);
        k.vel.x += (vx - k.vel.x) * ease;
        k.vel.y += (vy - k.vel.y) * ease;
        k.vel.z += (vz - k.vel.z) * ease;
        p.x += k.vel.x * dt;
        p.y += k.vel.y * dt;
        p.z += k.vel.z * dt;
        // a soft bob and sway on the warm air
        k.spin.position.y = k.rimY + Math.sin(clock * 0.8 + k.phase) * 0.06;
        k.spin.rotation.z = Math.sin(clock * 0.6 + k.phase) * 0.05;
        k.spin.rotation.x = Math.sin(clock * 0.45 + k.phase * 1.3) * 0.04;
        k.spin.rotation.y += k.spinRate * dt;
        if (k.standee) k.standee.rotation.z = Math.sin(clock * 0.6 + k.phase - 0.5) * 0.04;
      }
      if (k.sky) {
        // keep its pool of light on the water, fainter the higher it flies
        k.pool.position.y = 0.012 - k.root.position.y;
        k.pool.material.opacity = 0.26 * clamp01((9 - k.root.position.y) / 7) * k.lit;
        k.pool.visible = k.placed;
      } else if (k.placed) {
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
          if (o === k || o.sky || !o.placed || o.sinking != null) continue;
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
      const lit = k.lit ?? 1;
      if (k.body) k.body.material.color.copy(k.tint).multiplyScalar(0.4 + 0.6 * lit);
      k.flame.scale.set((k.flameW ?? 0.09) * flick, (k.flameH ?? 0.18) * (2 - flick), 1);
      k.glow.material.opacity = ((k.glowBase ?? 0.55) + (flick - 1) * 1.5) * lit;
      camDist.subVectors(camera.position, k.root.position);
      const toCam = Math.atan2(camDist.x, camDist.z);
      if (k.streak) {
        k.streak.visible = k.placed;
        k.streak.rotation.y = toCam;
      }
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
        // (a lantern's close-up is framed from further back)
        let near = k.placed && focusedHere ? clamp01(((k.sky ? 11.5 : 9) - d) / 3) : 0;
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
    updateFireworks(dt);
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
      const f = camState.follow;
      const p = f.root.position;
      if (f.sky) {
        // a little below the lantern, looking up at it against the sky
        goalLook.set(p.x, p.y + f.midY * 0.8, p.z);
        goalPos.set(p.x + 0.3, p.y + f.midY * 0.55, p.z + (camera.aspect < 1 ? 8.4 : 6.6));
      } else {
        goalLook.set(p.x, 1.3, p.z);
        goalPos.set(p.x + 0.25, 1.7, p.z + (camera.aspect < 1 ? 5.4 : 4.1));
      }
    } else if (camState.mode === "teacher") {
      if (performing?.k.fire) {
        fireShot(goalPos, goalLook, performing);
      } else if (performing?.k.wet) {
        wetShot(goalPos, goalLook, performing);
      } else if (performing?.k.sky) {
        // a lantern release: a lower, wider shot with room above her
        goalLook.set(-2.7, 1.7, 1.4);
        goalPos.set(-1.0, 1.7, camera.aspect < 1 ? 9.6 : 7.8);
      } else {
        goalLook.set(-2.6, 1.0, 1.6);
        goalPos.set(-1.3, 2.0, camera.aspect < 1 ? 8.8 : 7.2);
      }
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
    // Outside a close-up the camera turns round Kru Song: untouched, the
    // composed shot is unchanged; the more the viewer turns or zooms, the
    // more the pivot (and the point looked at) slides onto her
    // eased, so leaving a close-up with the orbit turned doesn't snap the
    // pivot from the krathong to her
    herW += ((camState.mode !== "follow" ? 1 : 0) - herW) * (1 - Math.exp(-dt * 3));
    const onHer = herW > 0.001;
    let herAmt = 0;
    if (onHer) {
      teacher.group.getWorldPosition(orbitPivot);
      orbitPivot.y += 1.05;
      // (zooming out doesn't pull the shot onto her: that's for the sky)
      const amt = herW * smooth(clamp01((Math.abs(wrapAngle(orbit.sYaw)) + Math.abs(orbit.sPitch)) * 2.5 + Math.max(0, 1 - orbit.sZoom) * 3));
      orbitPivot.lerpVectors(camState.look, orbitPivot, amt);
      herAmt = amt;
    } else {
      orbitPivot.copy(camState.look);
    }
    orbitOffset.subVectors(camState.pos, orbitPivot);
    orbitSph.setFromVector3(orbitOffset);
    orbitSph.theta += orbit.sYaw;
    orbitSph.phi = Math.min(1.5, Math.max(0.12, orbitSph.phi - orbit.sPitch));
    // turning round her also comes in closer, so she fills the shot
    orbitSph.radius = lerp(orbitSph.radius, Math.min(orbitSph.radius, 7), herAmt);
    orbitSph.radius *= orbit.sZoom;
    // never inside her
    if (herW > 0.5) orbitSph.radius = Math.max(orbitSph.radius, 2.6);
    orbitOffset.setFromSpherical(orbitSph);
    camera.position.copy(orbitPivot).add(orbitOffset);
    camera.position.y = Math.max(0.45, camera.position.y);
    // never inside the far shore's temple and trees
    camera.position.z = Math.max(FAR_EDGE + 1.5, camera.position.z);
    // looking up: dragging up past level (the camera can't go below the
    // ground) raises the point looked at, so the sky and the lanterns high
    // up come into frame. Zooming out only pulls straight back, so Kru Song
    // stays in the shot.
    const tiltUp = Math.max(0, -orbit.sPitch) * orbitSph.radius * 0.38;
    camera.lookAt(tmp.copy(orbitPivot).setY(orbitPivot.y + tiltUp));
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
  let kind = "krathong"; // or "lantern"
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
  // krathong or sky lantern; the titles follow the choice
  const selectKind = (k) => {
    kind = k === "lantern" ? "lantern" : "krathong";
    for (const b of els.kinds.children) b.setAttribute("aria-pressed", String(b.dataset.kind === kind));
    const sky = kind === "lantern";
    els.sheetTitle.textContent = editing ? (sky ? "แก้ไขโคมลอย" : "แก้ไขกระทง") : sky ? "โคมลอยใบใหม่" : "กระทงใบใหม่";
    els.submit.textContent = editing ? "บันทึก ✓" : sky ? "ปล่อยโคม 🏮" : "ลอยกระทง ✨";
  };
  for (const b of els.kinds.children) b.addEventListener("click", () => selectKind(b.dataset.kind));
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
    selectKind(kind);
  };

  function openEdit(k) {
    reset();
    editing = k;
    const rec = k.rec;
    selectKind(isSky(rec) ? "lantern" : "krathong");
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

  const openNew = (k) => {
    sound.unlock();
    if (editing) reset();
    selectKind(k);
    open();
    setTimeout(() => els.name.focus(), 320);
  };
  els.floatBtn.addEventListener("click", () => openNew("krathong"));
  els.lanternBtn.addEventListener("click", () => openNew("lantern"));
  // the action buttons wrap to two rows on narrow screens; the hint and the
  // edit bar sit above however tall they are
  const actions = document.getElementById("actions");
  const syncActionsH = () => document.documentElement.style.setProperty("--actions-h", `${actions.offsetHeight}px`);
  if (window.ResizeObserver) new ResizeObserver(syncActionsH).observe(actions);
  syncActionsH();
  els.fireBtn.addEventListener("click", () => {
    sound.unlock();
    if (!river.enqueueFire()) toast("รอพลุชุดนี้จุดเสร็จก่อนนะ");
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
    const what = k?.sky ? "โคมลอย" : "กระทง";
    if (!k || !confirm(`ลบ${what}ของ "${k.rec?.name || ""}" ?`)) return;
    await db.remove(k.rec.id);
    river.sinkKrathong(k);
    toast(`ลบ${what}ของ ${k.rec?.name || ""} แล้ว`);
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
      d.textContent = "ยังไม่มีกระทงหรือโคมลอย";
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
      b.appendChild(document.createTextNode(`${k.sky ? "🏮" : "🌸"} ${k.rec.name || "(ไม่มีชื่อ)"}`));
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
      const rec = { ...old.rec, kind, name, wish, cat: selectedCat, image: image || old.rec.image };
      await db.put(rec);
      if (old.sinking == null && river.krathongs.includes(old)) {
        editing = await river.rebuildKrathong(old, rec);
      }
      close();
      toast("บันทึกแล้ว");
      return;
    }
    const rec = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, name, wish, cat: selectedCat, image, createdAt: Date.now() };
    db.put(rec);
    const k = await river.studentKrathong(rec, { atDrop: true });
    river.enqueueFloat(k);
    close();
    reset();
  });

  els.clear.addEventListener("click", async () => {
    if (!confirm("ล้างกระทงและโคมลอยของนักเรียนทั้งหมดออกจากเครื่องนี้?")) return;
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
    toast(river.showWishes ? "แสดงคำอวยพรทุกใบ" : "ซ่อนคำอวยพร");
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
