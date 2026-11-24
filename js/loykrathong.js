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
// a mooring post standing up at the back corner of the deck (behind her
// as the camera sees her; she wais it by mistake without her glasses)
const MOOR_POS = new THREE.Vector3(PIER.x - 0.8, PIER.top, (PIER.z0 + PIER.z1) / 2);
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
  viewBtn: document.getElementById("viewBtn"),
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
    } else if (style === "pout" || style === "squint") {
      // cross (or peering): inner ends pulled down (still short and soft)
      g.moveTo(ex - 9 * s, 50);
      g.quadraticCurveTo(ex + 1 * s, 43, ex + 11 * s, 40);
    } else {
      g.moveTo(ex - 9 * s, 47);
      g.quadraticCurveTo(ex + 1 * s, 42, ex + 11 * s, 46);
    }
    g.stroke();
  }
  const openEyes = (cross = false) => {
    for (let ex of EYES) {
      const s = ex < 128 ? -1 : 1;
      // white of the eye
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.ellipse(ex, EY + 2, 19, 21, 0, 0, TAU);
      g.fill();
      // cross-eyed: everything inside the white slides toward her nose
      g.save();
      g.clip();
      const ox = cross ? -s * 8 : 0;
      ex += ox;
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
      g.restore();
      ex -= ox;
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
  if (style === "cross") {
    // cross-eyed at something on her nose, a small round "o"
    openEyes(true);
    nose();
    g.fillStyle = "#a8303f";
    g.beginPath();
    g.ellipse(128, 114, 3.5, 4.5, 0, 0, TAU);
    g.fill();
    return c;
  }
  if (style === "squint") {
    // peering without her glasses: eyes screwed up into soft arcs (no
    // creases, which read older) and a wobbly little mouth
    g.strokeStyle = "#1c0e0a";
    for (const ex of EYES) {
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(ex - 17, EY + 6);
      g.quadraticCurveTo(ex, EY - 3, ex + 17, EY + 6);
      g.stroke();
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(ex - 11, EY + 12);
      g.quadraticCurveTo(ex, EY + 15, ex + 11, EY + 12);
      g.stroke();
    }
    nose();
    g.strokeStyle = "#a8303f";
    g.lineWidth = 2.8;
    g.beginPath();
    g.moveTo(119, 114);
    g.bezierCurveTo(124, 108, 129, 119, 137, 112);
    g.stroke();
    return c;
  }
  if (style === "shy") {
    // glasses back on: big eyes, very pink cheeks, a small closed smile
    openEyes();
    nose();
    for (const bx of [48, 208]) {
      const grad = g.createRadialGradient(bx, 108, 2, bx, 108, 24);
      grad.addColorStop(0, "rgba(255,95,135,0.6)");
      grad.addColorStop(1, "rgba(255,95,135,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(bx, 108, 25, 16, 0, 0, TAU);
      g.fill();
    }
    g.strokeStyle = "#a8303f";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(121, 111);
    g.quadraticCurveTo(128, 117, 135, 111);
    g.stroke();
    return c;
  }
  // fresh red lips, pursed into a little kiss
  const redLips = () => {
    g.fillStyle = "#d8203c";
    g.beginPath();
    g.ellipse(128, 110, 9, 6, 0, 0, TAU);
    g.ellipse(128, 118, 8, 5.6, 0, 0, TAU);
    g.fill();
    g.strokeStyle = "#8a1024";
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(121, 114);
    g.quadraticCurveTo(128, 116, 135, 114);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.beginPath();
    g.ellipse(124.5, 108, 2.4, 1.4, -0.3, 0, TAU);
    g.fill();
  };
  if (style === "pucker") {
    openEyes();
    nose();
    redLips();
    return c;
  }
  if (style === "kiss") {
    // happy shut eyes (as in the default face) over the red kiss
    g.strokeStyle = "#2a1a16";
    g.lineWidth = 4.5;
    for (const ex of EYES) {
      g.beginPath();
      g.arc(ex, EY + 8, 13, Math.PI * 1.12, Math.PI * 1.88);
      g.stroke();
    }
    nose();
    redLips();
    return c;
  }
  if (style === "pout") {
    // cross, but cute: big eyes under cross brows, puffed-up cheeks and a
    // tiny pouty frown
    openEyes();
    nose();
    g.fillStyle = "rgba(255,120,150,0.35)";
    for (const bx of [50, 206]) {
      g.beginPath();
      g.ellipse(bx, 112, 17, 12, 0, 0, TAU);
      g.fill();
    }
    g.strokeStyle = "#a8303f";
    g.lineWidth = 3.2;
    g.beginPath();
    g.moveTo(121, 116);
    g.quadraticCurveTo(128, 109, 135, 116);
    g.stroke();
    return c;
  }
  if (style === "yawn") {
    // eyes squeezed shut, mouth wide open in a big yawn, a tear at the corner
    g.strokeStyle = "#2a1a16";
    g.lineWidth = 4.5;
    for (const ex of EYES) {
      g.beginPath();
      g.moveTo(ex - 15, EY + 2);
      g.quadraticCurveTo(ex, EY + 9, ex + 15, EY + 2);
      g.stroke();
    }
    g.fillStyle = "rgba(160,220,255,0.9)";
    g.beginPath();
    g.ellipse(EYES[1] + 19, EY + 7, 3, 4.5, 0, 0, TAU);
    g.fill();
    nose();
    g.fillStyle = "#a8303f";
    g.beginPath();
    g.ellipse(128, 117, 8, 11, 0, 0, TAU);
    g.fill();
    g.fillStyle = "#ff8e9e";
    g.beginPath();
    g.ellipse(128, 123, 5, 3.5, 0, 0, TAU);
    g.fill();
    return c;
  }
  if (style === "sleep") {
    // dozing: relaxed shut eyes and a small open mouth
    g.strokeStyle = "#2a1a16";
    g.lineWidth = 4;
    for (const ex of EYES) {
      g.beginPath();
      g.arc(ex, EY - 4, 14, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    }
    nose();
    g.fillStyle = "#a8303f";
    g.beginPath();
    g.ellipse(128, 114, 3, 3.5, 0, 0, TAU);
    g.fill();
    return c;
  }
  if (style === "yum") {
    // happy shut eyes, cheeks full, a little munching mouth
    g.strokeStyle = "#2a1a16";
    g.lineWidth = 4.5;
    for (const ex of EYES) {
      g.beginPath();
      g.arc(ex, EY + 8, 13, Math.PI * 1.12, Math.PI * 1.88);
      g.stroke();
    }
    nose();
    g.fillStyle = "rgba(255,120,150,0.4)";
    for (const bx of [50, 206]) {
      g.beginPath();
      g.ellipse(bx, 110, 18, 13, 0, 0, TAU);
      g.fill();
    }
    g.strokeStyle = "#a8303f";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(120, 112);
    g.quadraticCurveTo(124, 116, 128, 112);
    g.quadraticCurveTo(132, 116, 136, 112);
    g.stroke();
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

// a cartoon "cross" mark (four little red curves), for when she's cross
function drawAnger() {
  const c = makeCanvas(128, 128);
  const g = c.getContext("2d");
  g.lineCap = "round";
  // four corner brackets, each bowed in toward the middle
  for (const [w, col] of [[20, "#ffffff"], [11, "#ff3b5c"]]) {
    g.lineWidth = w;
    g.strokeStyle = col;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      g.beginPath();
      g.moveTo(64 + sx * 12, 64 + sy * 48);
      g.quadraticCurveTo(64 + sx * 14, 64 + sy * 14, 64 + sx * 48, 64 + sy * 12);
      g.stroke();
    }
  }
  return c;
}

// a little yellow star, for the stars round a bonked head
function drawStar() {
  const c = makeCanvas(64, 64);
  const g = c.getContext("2d");
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 12 : 28;
    const a = (i / 10) * TAU - Math.PI / 2;
    g.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r);
  }
  g.closePath();
  g.lineJoin = "round";
  g.lineWidth = 5;
  g.strokeStyle = "#a8641a";
  g.stroke();
  g.fillStyle = "#ffe27a";
  g.fill();
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
    // a coin glinting: two bright little pings
    ting(vol = 0.08) {
      const a = on && ac();
      if (!a || vol < 0.005) return;
      [2093, 3136].forEach((f, i) => {
        const t = a.currentTime + i * 0.07;
        const osc = a.createOscillator();
        osc.frequency.value = f;
        osc.connect(env(a, vol, t, 0.003, 0.35));
        osc.start(t);
        osc.stop(t + 0.4);
      });
    },
    // a comb bouncing off a head: a hollow knock
    bonk() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(950, t);
      osc.frequency.exponentialRampToValueAtTime(220, t + 0.16);
      osc.connect(env(a, 0.22, t, 0.002, 0.18));
      osc.start(t);
      osc.stop(t + 0.25);
    },
    // "mwah!": a little smack and a rising chirp
    kiss() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      const hp = a.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800;
      src.connect(hp).connect(env(a, 0.12, t, 0.002, 0.05));
      src.start(t, rand(0, 0.2), 0.07);
      const osc = a.createOscillator();
      osc.frequency.setValueAtTime(700, t + 0.04);
      osc.frequency.exponentialRampToValueAtTime(1500, t + 0.22);
      osc.connect(env(a, 0.07, t + 0.04, 0.01, 0.2));
      osc.start(t + 0.04);
      osc.stop(t + 0.3);
    },
    // "hmph!": a short huff through the nose
    // a frog: two low, buzzy croaks
    ribbit(vol = 0.12) {
      const a = on && ac();
      if (!a || vol < 0.005) return;
      [0, 0.16].forEach((dt) => {
        const t = a.currentTime + dt;
        const osc = a.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(95, t + 0.11);
        const lp = a.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 900;
        osc.connect(lp).connect(env(a, vol, t, 0.01, 0.11));
        osc.start(t);
        osc.stop(t + 0.14);
      });
    },
    // a little shriek
    eek(vol = 0.1) {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(900, t);
      osc.frequency.exponentialRampToValueAtTime(1900, t + 0.12);
      osc.frequency.exponentialRampToValueAtTime(1500, t + 0.4);
      osc.connect(env(a, vol, t, 0.01, 0.4));
      osc.start(t);
      osc.stop(t + 0.45);
    },
    // ah... CHOO
    sneeze() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      const bp = a.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2600;
      bp.Q.value = 0.7;
      src.connect(bp).connect(env(a, 0.28, t, 0.005, 0.25));
      src.start(t, 0, 0.3);
      const osc = a.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(700, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.2);
      osc.connect(env(a, 0.06, t, 0.005, 0.2));
      osc.start(t);
      osc.stop(t + 0.25);
    },
    hmph() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      const bp = a.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 700;
      bp.Q.value = 1.2;
      src.connect(bp).connect(env(a, 0.14, t, 0.01, 0.22));
      src.start(t, rand(0, 0.15), 0.26);
      const osc = a.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.2);
      osc.connect(env(a, 0.05, t, 0.01, 0.2));
      osc.start(t);
      osc.stop(t + 0.25);
    },
    // a mosquito's whine, wandering in pitch, for len seconds
    buzz(len = 2, vol = 0.03) {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(620, t);
      const lfo = a.createOscillator();
      lfo.frequency.value = 1.3;
      const lg = a.createGain();
      lg.gain.value = 90;
      lfo.connect(lg).connect(osc.frequency);
      const bp = a.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1400;
      bp.Q.value = 1.5;
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.15);
      g.gain.setValueAtTime(vol, t + Math.max(0.2, len - 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      g.connect(a.destination);
      osc.connect(bp).connect(g);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + len + 0.05);
      lfo.stop(t + len + 0.05);
    },
    // a smack on the cheek
    slap() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      const bp = a.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1100;
      bp.Q.value = 0.9;
      src.connect(bp).connect(env(a, 0.32, t, 0.002, 0.12));
      src.start(t, rand(0, 0.2), 0.15);
      const osc = a.createOscillator();
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.1);
      osc.connect(env(a, 0.15, t, 0.002, 0.1));
      osc.start(t);
      osc.stop(t + 0.15);
    },
    // a long, sliding yawn
    yawn() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(380, t);
      osc.frequency.linearRampToValueAtTime(560, t + 0.35);
      osc.frequency.exponentialRampToValueAtTime(300, t + 1.2);
      const lp = a.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1300;
      osc.connect(lp).connect(env(a, 0.07, t, 0.15, 1.1));
      osc.start(t);
      osc.stop(t + 1.3);
    },
    meow(vol = 0.08) {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(560, t);
      osc.frequency.exponentialRampToValueAtTime(920, t + 0.12);
      osc.frequency.exponentialRampToValueAtTime(520, t + 0.45);
      const lp = a.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2200;
      osc.connect(lp).connect(env(a, vol, t, 0.03, 0.45));
      osc.start(t);
      osc.stop(t + 0.5);
    },
    // a soft mallet note (the ram wong tune)
    note(f, vol = 0.05, len = 0.4) {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      [1, 2].forEach((m, i) => {
        const osc = a.createOscillator();
        osc.frequency.value = f * m;
        osc.connect(env(a, vol * (i ? 0.3 : 1), t, 0.005, len));
        osc.start(t);
        osc.stop(t + len + 0.05);
      });
    },
    // a falling sparkle (a shooting star)
    shimmer() {
      const a = on && ac();
      if (!a) return;
      [2637, 2349, 2093, 1760, 1568, 1319, 1175].forEach((f, i) => {
        const t = a.currentTime + i * 0.07;
        const osc = a.createOscillator();
        osc.frequency.value = f;
        osc.connect(env(a, 0.04, t, 0.005, 0.5));
        osc.start(t);
        osc.stop(t + 0.55);
      });
    },
    munch() {
      const a = on && ac();
      if (!a) return;
      [0, 0.15, 0.3].forEach((dt) => {
        const t = a.currentTime + dt;
        const src = a.createBufferSource();
        src.buffer = noiseBuf(a);
        const bp = a.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 800;
        bp.Q.value = 1;
        src.connect(bp).connect(env(a, 0.12, t, 0.004, 0.06));
        src.start(t, rand(0, 0.2), 0.08);
      });
    },
    // a big puff of breath
    blow() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const src = a.createBufferSource();
      src.buffer = noiseBuf(a);
      const lp = a.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      src.connect(lp).connect(env(a, 0.16, t, 0.08, 0.3));
      src.start(t, 0, 0.4);
    },
    // hee hee hee
    giggle() {
      const a = on && ac();
      if (!a) return;
      [0, 0.13, 0.26].forEach((dt, i) => {
        const t = a.currentTime + dt;
        const osc = a.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(900 + i * 60, t);
        osc.frequency.exponentialRampToValueAtTime(1250 + i * 60, t + 0.07);
        osc.connect(env(a, 0.06, t, 0.01, 0.08));
        osc.start(t);
        osc.stop(t + 0.1);
      });
    },
    boing() {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.5);
      const lfo = a.createOscillator();
      lfo.frequency.value = 14;
      const lg = a.createGain();
      lg.gain.value = 40;
      lfo.connect(lg).connect(osc.frequency);
      osc.connect(env(a, 0.1, t, 0.01, 0.5));
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 0.55);
      lfo.stop(t + 0.55);
    },
    // Moo Deng: a baby hippo's squeaky little squeal (pitch < 1 = sleepier)
    squeak(vol = 0.07, pitch = 1) {
      const a = on && ac();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(520 * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(980 * pitch, t + 0.08);
      osc.frequency.exponentialRampToValueAtTime(600 * pitch, t + 0.24);
      const lfo = a.createOscillator();
      lfo.frequency.value = 22;
      const lg = a.createGain();
      lg.gain.value = 30 * pitch;
      lfo.connect(lg).connect(osc.frequency);
      osc.connect(env(a, vol, t, 0.015, 0.26));
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 0.32);
      lfo.stop(t + 0.32);
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
    {
      const moor = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.6, 8), wood);
      moor.position.set(MOOR_POS.x, PIER.top + 0.3, MOOR_POS.z);
      scene.add(moor);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.078, 8, 5, 0, TAU, 0, Math.PI / 2), wood);
      cap.position.set(MOOR_POS.x, PIER.top + 0.6, MOOR_POS.z);
      scene.add(cap);
      const rope = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.018, 5, 14), new THREE.MeshLambertMaterial({ color: 0xc9a46a }));
      rope.rotation.x = Math.PI / 2;
      for (const y of [0.4, 0.44]) {
        const r = rope.clone();
        r.position.set(MOOR_POS.x, PIER.top + y, MOOR_POS.z);
        scene.add(r);
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
    const k = await studentKrathong(rec, same ? { at: old.stolen ? old.target : old.root.position, replacing: true } : { replacing: true });
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
      for (const f of ["wince", "huh", "daze", "cry", "cry2", "pout", "pucker", "kiss", "squint", "shy", "cross", "yawn", "sleep", "yum"]) faces[f] = canvasTexture(drawFace(f));
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
    teacher.nameTag = s;
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
    const waiting = [...queue, ...(performing ? [performing.k] : [])].filter((k) => !k.coin && !k.timed);
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
    // tapped: a little reaction
    if (poke) {
      let want = IDLE;
      for (const [at, p] of POKE_KEYS[poke.kind]) if (poke.t >= at && p) want = p;
      return want;
    }
    // nothing to do for a while: she combs her hair
    if (idleComb != null) {
      let want = IDLE;
      for (const [at, p] of idleKind === "lip" ? IDLE_LIP_KEYS : IDLE_COMB_KEYS) if (idleComb >= at && p) want = p;
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
    p.inner.rotation.set(c.lean + (p.tilt || 0), p.spin || 0, sway * 0.025 * (1 - c.dip * 2));
    p.inner.position.set(sway * 0.012 + (p.shake || 0) * s, (-c.dip * 0.95 + c.rise + (p.bob || 0)) * s, 0);
    p.inner.scale.setScalar(s);
    p.inner.scale.y = s * (1 + Math.sin(t * 1.6) * 0.006);
    // kneeling folds the legs back under the skirt
    p.legs[0].rotation.x = p.legs[1].rotation.x = c.dip * 3.2;
    // dangling (the fly gag): legs pedalling the air
    if (p.kick) {
      const sw = Math.sin(t * 12) * 0.55 * p.kick;
      p.legs[0].rotation.x += sw;
      p.legs[1].rotation.x -= sw;
    }
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
  // a lucky-draw bag: each item once, in random order; when it's empty it
  // is refilled and reshuffled, and a new round never starts with the item
  // that ended the last one
  function makeBag(items) {
    let left = [];
    let last = null;
    return {
      draw() {
        if (!left.length) {
          // reshuffle until no item comes up twice running (an item can be in
          // the bag more than once, like the blank tickets)
          for (let tries = 0; tries < 100; tries++) {
            left = items.slice();
            for (let i = left.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [left[i], left[j]] = [left[j], left[i]];
            }
            if (left.every((v, i) => v !== (i === left.length - 1 ? last : left[i + 1]))) break;
          }
        }
        last = left.pop();
        return last;
      },
    };
  }
  // (two blank tickets: that float is a plain one, no gag)
  const floatBag = makeBag(["wet", "glasses", "firefly", "fish", "boomerang", "candle", "turtle", "mdride", "mdtug", "mdwish", "blank", "blank"]);
  // what happens when she's had nothing to do for a while
  const idleBag = makeBag(["comb", "lip", "frog", "cracker", "coin", "mozzie", "ramwong", "star", "sleepy", "cat", "mdsplash", "mdsplash", "mdnibble", "mdboom"]);
  function runPerformance(dt) {
    if (!performing && queue.length) {
      const next = queue.shift();
      if (next.coin && !startCoin(next)) return; // no krathong of hers left: still due
      performing = { k: next, t: 0 };
      const pk = performing.k;
      if (pk.coin || pk.timed) {
        // (the coin, frog and firecracker gags: none of the krathong set-up below)
      } else if (!pk.fire && !pk.sky) {
        // most floats have a gag, drawn like a lucky-draw stall: each one
        // once in a random order, then a fresh shuffle (never the same one
        // twice running, even across rounds)
        const gag = floatBag.draw();
        if (gag === "blank") { /* a plain float */ } else if (EXTRA[gag]) pk.extra = gag;
        else pk[gag] = true;
      } else if (pk.sky) {
        // ... and now and then a lantern carries her off, by the same rule
        pk.fly = !lastFly && (flyDry >= 2 || Math.random() < FLY_CHANCE);
        flyDry = pk.fly ? 0 : flyDry + 1;
        lastFly = pk.fly;
      }
      resetGag();
      if (pk.glasses) startGlasses(pk);
      if (pk.extra) EXTRA[pk.extra].start?.(pk);
      if (!pk.fire && !pk.coin && !pk.timed) {
        pk.root.visible = true;
        pk.root.scale.setScalar(0.001);
      }
      camState.mode = "teacher";
      orbit.lastInput = -1e9;
      if (!pk.coin && !pk.timed) sound.chime();
      updateFloatBtn();
    }
    if (!performing) return;
    const P = performing;
    const k = P.k;
    P.t += dt;
    const t = P.t;
    if (k.extra) EXTRA[k.extra].perform(P, k, t, dt);
    else if (k.coin) coinPerformance(P, k, t, dt);
    else if (k.frog) frogPerformance(P, k, t, dt);
    else if (k.cracker) crackerPerformance(P, k, t, dt);
    else if (k.fire) firePerformance(P, k, t, dt);
    else if (k.fly) flyPerformance(P, k, t, dt);
    else if (k.sky) skyPerformance(P, k, t, dt);
    else if (k.wet) wetPerformance(P, k, t, dt);
    else if (k.glasses) glassesPerformance(P, k, t, dt);
    else if (k.firefly) fireflyPerformance(P, k, t, dt);
    else if (k.fish) fishPerformance(P, k, t, dt);
    else floatPerformance(P, k, t);
    const keys = keysFor(k);
    if (t > keys[keys.length - 1][0]) {
      if (k.coin) endCoin(k);
      if (k.glasses) endGlasses(k);
      if (k.frog) endFrog();
      if (k.cracker) endCracker();
      if (k.extra) EXTRA[k.extra].end?.(k);
      k.extra = null;
      k.wet = false;
      k.glasses = false;
      k.firefly = false;
      k.fish = false;
      k.fly = false;
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
  // (letGo / camAt: the fly gag lets go late, and looks for the lantern later)
  function skyPerformance(P, k, t, dt, letGo = SKY_LET_GO, camAt = SKY_CAMERA) {
    if (t < letGo) {
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
    if (P.released && !P.shown && t > letGo + 1.1) {
      // the photo appears with a sparkle once the lantern is above her head
      P.shown = true;
      if (k.standee) k.standee.visible = true;
      burst(new THREE.Vector3(k.root.position.x, k.root.position.y + k.rimY * 0.55, k.root.position.z), 50, { speed: 1.6, colors: [0xfff3b0, 0xffd27a, 0xffb3e6, 0xffffff], life: 1 });
    }
    if (P.released && P.grow < 1) {
      P.grow = Math.min(1, P.grow + dt * 0.7);
      k.root.scale.setScalar(lerp(0.55, 1, smooth(P.grow)));
    }
    if (t > camAt && !P.followed) {
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
  const keysFor = (k) => k.extra ? EXTRA[k.extra].keys : k.coin ? k.plan.keys : k.timed ? (k.frog ? FROG_KEYS : CRACKER_KEYS) : (k.fire ? (k.fail ? FIRE_FAIL_KEYS : FIRE_OK_KEYS) : k.sky ? (k.fly ? FLY_KEYS : SKY_KEYS) : k.wet ? WET_KEYS : k.glasses ? k.gplan.keys : k.firefly ? FIREFLY_KEYS : k.fish ? FISH_KEYS : FLOAT_KEYS);

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
  // a little red "cross" mark by her head when she's cross (the coin gag)
  const angerMark = (() => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(drawAnger()), transparent: true, depthWrite: false }));
    m.visible = false;
    m.userData.ownFade = true;
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
      teacher.glassesMesh.visible = !g.noGlasses;
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
    angerMark.visible = g.anger > 0.01;
    angerMark.material.opacity = g.anger;
    // throbbing beside her head, on the other side from the "!" and "?"
    angerMark.scale.setScalar(0.26 * (1 + 0.12 * Math.abs(Math.sin(teacher.t * 7))) * (0.5 + 0.5 * g.anger));
    angerMark.position.set(-0.36, teacher.topY - 0.18, 0.05);
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
      anger: 0, exclaim: 0, tilt: 0, flail: 0, kick: 0, hairBlow: 0, wet: 0, puddle: 0, drops: 0, lily: false, towel: false, headTowel: false, dryer: false, powder: false, pos: null,
      noGlasses: false, spin: 0,
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
    teacher.spin = g.spin;
    teacher.flail = g.flail;
    teacher.kick = g.kick;
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
    wetEffects(P, t, dt);
  }
  // everything from the splash on: bubbles, tears, drips, the dryer's warm
  // air, powder (t = the wet gag's time; the fly gag ends the same way)
  function wetEffects(P, t, dt) {
    const water = (x, z) => wetTmp.set(x, 0.05, z);
    teacher.head.getWorldPosition(eyeTmp);
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
  // the fire gag's close shot, kept on her wherever she goes (a little
  // higher while she's in the water, to see over the floating lamps)
  function closeOnHer(pos, look) {
    const g = teacher.group.position;
    const y = Math.min(PIER.top, Math.max(WET_FLOAT_Y, g.y)) - PIER.top;
    look.set(g.x, 1.6 + y, g.z);
    pos.set(g.x + Math.sin(0.6) * 3.7, Math.max(1.85 + y, 1.25), g.z + Math.cos(0.6) * 3.7 + (camera.aspect < 1 ? 1.6 : 0));
  }
  function wetShot(pos, look, P) {
    const portrait = camera.aspect < 1 ? 1.6 : 0;
    if (P.t > 2.3 && P.t < 6.0) {
      // set and still before she wobbles: side on from the front, the pier
      // on the left and the splash on the right, so the whole fall reads
      look.set(-2.4, 1.2, 1.95);
      pos.set(-2.4 + Math.sin(0.15) * 5.4, 1.7, 1.95 + Math.cos(0.15) * 5.4 + portrait);
    } else if (P.t >= 6.0 && P.t < WET_OFFSET + 0.4) {
      closeOnHer(pos, look);
    } else {
      look.set(-2.6, 1.0, 1.6);
      pos.set(-1.3, 2.0, camera.aspect < 1 ? 8.8 : 7.2);
    }
  }

  // ----- the fly gag: now and then Kru Song doesn't let go of her lantern
  // in time and it carries her off the pier, legs pedalling, bawling. Out
  // over the river her grip goes: the lantern sails on up on its own (it
  // counts, nothing to redo) and she drops in with a splash. From there it
  // is the wet gag's ending: she scrambles out soaked, cries, towels off,
  // dries and combs her hair and is her pretty self again. -----
  const FLY_CHANCE = 1 / 3;
  let lastFly = false;
  let flyDry = 0; // lanterns since one last carried her off
  const FLY_UP_T = 3.9; // her feet leave the pier
  const FLY_PEAK_T = 6.3; // as high as she goes; her fingers start to slip
  const FLY_DROP_T = 6.9; // she lets go
  const FLY_SPLASH_T = 7.6;
  const FLY_SHIFT = FLY_SPLASH_T - WET_SPLASH_T; // wet gag time = t - FLY_SHIFT
  const FLY_PEAK = new THREE.Vector3(WET_UP.x, PIER.top + 1.5, WET_UP.z);
  const FLY_END = 24.0 + FLY_SHIFT;
  Object.assign(ARM, {
    hang: { x: -2.9, o: 0.5, e: -0.1 }, // up in a V, a string round each hand
  });
  // the two strings she dangles from (her arms are too short to reach the
  // rim over her big head, and this way the lantern never hides her face)
  const FLY_SCALE = 0.55; // the lantern's size in her hands
  const FLY_RIM_R = 0.3 * FLY_SCALE;
  const flyStrings = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([0, 1, 2, 3].map(() => new THREE.Vector3())), stringMat);
  flyStrings.frustumCulled = false;
  flyStrings.visible = false;
  scene.add(flyStrings);
  const flyRim = new THREE.Vector3();
  const flySide = new THREE.Vector3();
  const FLY_KEYS = [
    ...SKY_KEYS.filter(([at]) => at < SKY_LET_GO),
    [SKY_LET_GO, pose("hang", "hang", { hx: -0.4, rise: 0.07, yaw: SKY_SIDE })], // up on tiptoe... it won't let go
    [FLY_UP_T, pose("hang", "hang", { hx: 0.05, yaw: FACE_CAM })], // off she goes
    [FLY_DROP_T, pose("shock", "shock", { hx: -0.2, yaw: FACE_CAM })], // aaah
    // bobs up, climbs out, cries, dries off: the wet gag from its splash
    ...WET_GAG_KEYS.filter(([at]) => at >= 6.0 && at < 22.4).map(([at, p]) => [at + FLY_SHIFT, p]),
    [22.4 + FLY_SHIFT, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [FLY_END, null],
  ];
  function flyState(t) {
    if (t >= FLY_SPLASH_T) return wetState(t - FLY_SHIFT);
    const g = gagBase();
    if (t < SKY_LET_GO) return g;
    const p = wetPos.copy(TEACHER_POS);
    g.pos = p;
    if (t < FLY_UP_T) {
      // the lantern tugs; she's on tiptoe, still holding on
      const u = (t - SKY_LET_GO) / (FLY_UP_T - SKY_LET_GO);
      g.face = "huh";
      g.exclaim = Math.sin(clamp01(u * 1.3) * Math.PI);
    } else if (t < FLY_DROP_T) {
      // carried up and out over the river, swinging under the lantern
      const u = clamp01((t - FLY_UP_T) / (FLY_PEAK_T - FLY_UP_T));
      p.lerpVectors(TEACHER_POS, FLY_PEAK, smooth(u));
      p.y = lerp(TEACHER_POS.y, FLY_PEAK.y, 1 - (1 - u) ** 2) + Math.sin(t * 4) * 0.04;
      g.tilt = Math.sin(t * 3.3) * 0.09;
      g.kick = 1;
      if (t < FLY_PEAK_T) g.face = Math.floor(t * 4) % 2 ? "cry" : "cry2";
      else {
        // her fingers are slipping
        g.face = "huh";
        g.exclaim = Math.sin(clamp01((t - FLY_PEAK_T) / (FLY_DROP_T - FLY_PEAK_T)) * Math.PI);
        g.shake = Math.sin(t * 70) * 0.012;
      }
    } else {
      // ... and down she comes, feet first
      const u = (t - FLY_DROP_T) / (FLY_SPLASH_T - FLY_DROP_T);
      p.copy(FLY_PEAK);
      p.y = lerp(FLY_PEAK.y, -2.4, u * u);
      g.tilt = -0.2 * u;
      g.flail = 1;
      g.kick = 1;
      g.face = "wince";
    }
    return g;
  }
  function flyPerformance(P, k, t, dt) {
    applyGag(flyState(t));
    // the lantern stays in her hands until her grip goes, then it's away
    skyPerformance(P, k, t, dt, FLY_DROP_T, FLY_END - 0.6);
    const caught = t >= SKY_LET_GO && t < FLY_DROP_T;
    flyStrings.visible = caught;
    teacher.nameTag.visible = !caught; // the lantern sits where her name tag is
    if (caught) {
      // it floats up out of her hands to just over her head and stops
      // there, tugging: its strings are round her hands
      const g = teacher.group.position;
      flyRim.set(g.x, g.y + teacher.topY + 0.16 + Math.sin(t * 4) * 0.02, g.z);
      flyRim.lerpVectors(palms(handWorld, 0.22), flyRim, smooth(clamp01((t - SKY_LET_GO) / 0.4)));
      k.root.position.set(flyRim.x, flyRim.y - k.rimY * FLY_SCALE, flyRim.z);
      flySide.set(1, 0, 0).applyQuaternion(teacher.group.quaternion);
      const pos = flyStrings.geometry.attributes.position;
      teacher.hands.forEach((h, i) => {
        h.getWorldPosition(handB);
        pos.setXYZ(i * 2, handB.x, handB.y, handB.z);
        handB.copy(flyRim).addScaledVector(flySide, (i ? 1 : -1) * FLY_RIM_R);
        pos.setXYZ(i * 2 + 1, handB.x, handB.y, handB.z);
      });
      pos.needsUpdate = true;
    }
    if (once(P, "tug", t, SKY_LET_GO)) sound.pop(0.2);
    if (once(P, "liftoff", t, FLY_UP_T)) {
      sound.slip();
      burst(TEACHER_POS, 20, { speed: 1.1, colors: [0xfff3b0, 0xffd27a, 0xffffff], life: 0.6 });
    }
    if (t > FLY_UP_T + 0.4 && t < FLY_PEAK_T) tearFountain();
    for (const at of [4.4, 5.3]) if (once(P, "sobf" + at, t, at)) sound.sob();
    if (once(P, "free", t, FLY_DROP_T)) {
      // rid of her weight, the lantern jumps
      k.vel.y = 1.3;
      sound.slip();
      for (const h of teacher.hands) burst(h.getWorldPosition(handB), 10, { speed: 0.9, colors: [0xfff3b0, 0xffffff], life: 0.5 });
    }
    if (t >= FLY_SPLASH_T) wetEffects(P, t - FLY_SHIFT, dt);
  }
  function flyShot(pos, look, P) {
    const tw = P.t - FLY_SHIFT;
    if (P.t > 2.6 && tw < 6.0) {
      // set and still before the lantern takes her: side on, tall enough
      // for the pier, the top of her ride and the splash under it
      const d = camera.aspect < 1 ? 8.6 : 7.4;
      look.set(-2.35, 2.05, 1.95);
      pos.set(-2.35 + Math.sin(0.15) * d, 2.0, 1.95 + Math.cos(0.15) * d);
    } else if (tw >= 6.0) {
      closeOnHer(pos, look);
    } else {
      look.set(-2.7, 1.7, 1.4);
      pos.set(-1.0, 1.7, camera.aspect < 1 ? 9.6 : 7.8);
    }
  }

  // ----- idle: when Kru Song has had nothing to do for a while she combs
  // her hair, tilting her head from side to side, then a happy little
  // pose. Not a performance: the camera and the viewer's orbit are left
  // alone, and anything she's asked to do cuts it short. -----
  const IDLE_EVERY = 12; // seconds of nothing before something happens
  const IDLE_COMB_KEYS = [
    [0, pose("pocket", "clasp", { hz: 0.06, yaw: FACE_CAM })],
    [0.6, pose("comb", "rest", { hz: -0.18, hx: -0.05, yaw: FACE_CAM })],
    [1.4, pose("comb", "rest", { hz: 0.12, hx: -0.05, yaw: FACE_CAM })],
    [2.2, pose("comb", "rest", { hz: -0.18, hx: -0.05, yaw: FACE_CAM })],
    [3.0, pose("heart", "heart", { hz: 0.16, hx: -0.12, yaw: FACE_CAM })],
    [4.0, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
  ];
  const IDLE_COMB_END = 5.2;
  // ... and every other time, red lipstick with a little compact mirror,
  // then she blows the viewer a kiss
  Object.assign(ARM, {
    lip: { x: -1.7, o: -0.4, e: -1.5, w: 0.6 }, // lipstick to her lips
    mirror: { x: -1.15, o: -0.25, e: -1.35 }, // compact held up in front
    kissHand: { x: -1.8, o: -0.32, e: -1.75 }, // fingertips to her lips
    blow: { x: -1.45, o: 0.3, e: -0.35 }, // ... and away it goes
  });
  const IDLE_LIP_KEYS = [
    [0, pose("pocket", "pocket", { hz: 0.06, yaw: FACE_CAM })],
    [0.6, pose("lip", "mirror", { hx: -0.05, hz: 0.06, yaw: FACE_CAM })],
    [1.5, pose("lip", "mirror", { hx: -0.05, hz: -0.08, yaw: FACE_CAM })],
    [2.4, pose("rest", "mirror", { hx: 0.02, hz: 0.12, yaw: FACE_CAM })], // a look in the mirror
    [3.0, pose("kissHand", "rest", { hz: 0.08, yaw: FACE_CAM })],
    [3.5, pose("blow", "rest", { hx: -0.1, hz: -0.1, lean: -0.04, yaw: FACE_CAM })], // mwah!
    [4.6, pose("heart", "heart", { hz: 0.14, yaw: FACE_CAM })],
    [5.4, pose("clasp", "clasp", { hz: 0.08, yaw: FACE_CAM })],
  ];
  const IDLE_LIP_END = 5.9;
  const lipstick = handProp((add) => {
    add(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 10), "#e8c46a", (d) => { d.position.set(0, -0.02, -0.04); d.rotation.x = Math.PI / 2; }); // gold case
    add(new THREE.CylinderGeometry(0.012, 0.013, 0.04, 10), "#d8203c", (d) => { d.position.set(0, -0.02, -0.095); d.rotation.x = Math.PI / 2; }); // red bullet
    add(new THREE.SphereGeometry(0.012, 8, 6), "#d8203c", (d) => d.position.set(0, -0.02, -0.115));
  });
  const compact = (() => {
    const { parts, add } = partList();
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.014, 18), "#ff86b8", (d) => { d.rotation.x = Math.PI / 2; });
    add(new THREE.CylinderGeometry(0.038, 0.038, 0.004, 18), "#e8f4ff", (d) => { d.position.z = 0.009; d.rotation.x = Math.PI / 2; }); // the mirror
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 18), "#ff9cc8", (d) => { d.position.set(0, 0.045, -0.02); d.rotation.x = Math.PI / 2 - 0.5; }); // open lid
    const m = new THREE.Mesh(mergeParts(parts), propMat);
    m.position.set(0, -0.03, -0.04);
    m.visible = false;
    teacher.hands[1].add(m);
    return m;
  })();
  // the kiss: a pink heart floating out toward the viewer
  const kissHeart = (() => {
    const c = makeCanvas(128, 128);
    drawHeart(c.getContext("2d"), 64, 76, 80, "#ff4f8b");
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(c), transparent: true, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    return m;
  })();
  const kissFrom = new THREE.Vector3();
  const kissTo = new THREE.Vector3();
  let idleKind = "lip"; // the last one done (so the first is the comb)
  let idleFor = 0;
  let idleComb = null; // time into the comb (or lipstick), or null
  function stopIdleComb() {
    idleComb = null;
    comb.visible = false;
    lipstick.visible = false;
    compact.visible = false;
    kissHeart.visible = false;
    teacher.faceOverride = null;
    teacher.bob = 0;
  }
  function idleLipTick(t0, t) {
    lipstick.visible = t > 0.45 && t < 2.5;
    compact.visible = t > 0.45 && t < 2.95;
    // lips pursed while she paints them; a kiss with her eyes shut
    teacher.faceOverride = t > 0.6 && t < 3.0 ? "pucker" : t >= 3.0 && t < 4.4 ? "kiss" : t >= 4.6 && t < 5.4 ? "open" : null;
    if (t0 < 3.6 && t >= 3.6) {
      // mwah! off her fingertips toward the camera
      teacher.hands[0].getWorldPosition(kissFrom);
      kissTo.lerpVectors(kissFrom, camera.position, 0.55);
      kissTo.y += 0.35;
      burst(kissFrom, 18, { speed: 0.8, colors: [0xff7fb0, 0xffc2dc, 0xffffff], life: 0.6 });
      sound.kiss();
    }
    const u = (t - 3.6) / 1.3;
    kissHeart.visible = u > 0 && u < 1;
    if (kissHeart.visible) {
      kissHeart.position.lerpVectors(kissFrom, kissTo, smooth(u));
      kissHeart.position.x += Math.sin(u * 9) * 0.06;
      kissHeart.scale.setScalar(0.12 + 0.5 * smooth(Math.min(1, u * 1.6)));
      kissHeart.material.opacity = 1 - smooth(clamp01((u - 0.65) / 0.35));
      kissHeart.material.rotation = Math.sin(u * 7) * 0.2;
    }
    teacher.bob = t > 4.6 && t < 5.2 ? Math.abs(Math.sin((t - 4.6) * 10.5)) * 0.02 : 0;
    if (t >= IDLE_LIP_END) stopIdleComb();
  }
  function idleCombTick(dt) {
    if (performing || queue.length) {
      if (idleComb != null) stopIdleComb();
      idleFor = 0;
      return;
    }
    if (poke || mooSt.visit) {
      idleFor = 0;
      return;
    }
    // after 12s of nothing, the next ticket from the idle bag: combing her
    // hair, lipstick, the frog, the firecracker or the coin diver (counted
    // from when the last thing ended)
    if (idleComb == null) {
      // not while she's busy with the page: the add/edit sheet is open, the
      // camera is on a student's krathong (its edit bar showing), or she's
      // turning the view; the 12 s count starts again after
      if (document.body.classList.contains("sheet-open") || camState.mode === "follow" || clock - orbit.lastInput < 0.5) {
        idleFor = 0;
        return;
      }
      idleFor += dt;
      if (idleFor < IDLE_EVERY) return;
      idleFor = 0;
      let pick = idleBag.draw();
      // the coin gag needs a krathong of hers out on the water
      if (pick === "coin" && !coinTarget()) pick = idleBag.draw();
      if (pick === "coin" && !coinTarget()) pick = "comb";
      if (pick === "coin") {
        queue.push({ coin: true });
        return;
      }
      if (EXTRA[pick]) {
        queue.push({ timed: true, extra: pick });
        return;
      }
      if (pick === "frog" || pick === "cracker") {
        queue.push({ [pick]: true, timed: true });
        return;
      }
      idleComb = 0;
      idleKind = pick;
    }
    const t0 = idleComb;
    idleComb += dt;
    const t = idleComb;
    if (idleKind === "lip") return idleLipTick(t0, t);
    comb.visible = t > 0.45 && t < 3.05;
    teacher.faceOverride = t > 0.6 && t < 3.0 ? "blink" : t >= 3.0 && t < 4.0 ? "open" : null;
    // a happy little hop as she finishes
    teacher.bob = t > 3.0 && t < 3.6 ? Math.abs(Math.sin((t - 3.0) * 10.5)) * 0.02 : 0;
    if (t0 < 3.0 && t >= 3.0) {
      teacher.head.getWorldPosition(eyeTmp);
      eyeTmp.y += 0.2;
      burst(eyeTmp, 30, { speed: 1.2, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.8 });
    }
    if (t >= IDLE_COMB_END) stopIdleComb();
  }

  // ----- the coin diver: a boy who lives in the river, swimming from
  // krathong to krathong fishing out the coins people leave in them -----
  const BOY_Y = -0.66; // his feet: shoulders just out of the water
  const BOY_SPEED = 0.85;
  const boy = buildPerson({ skin: "#c98f62", hair: "#140d0a", top: "#4fc3f7", pants: "#2d3c6b", headScale: 1.5, openEyes: true }, 1.2, 0);
  // (he keeps clear of the pier, where she floats her krathongs and falls in)
  const inPierZone = (x, z) => x < -0.4 && z > -1.8;
  const diver = {
    script: null, // the coin gag drives him while it runs
    goal: null,
    grab: -1,
    wait: rand(1, 3),
    rippleT: 0,
    swim: 0,
    wob: 0,
    face: null,
    want: null,
    cur: { l: { x: -0.4, o: 0.9, e: -0.5, w: 0 }, r: { x: -0.4, o: 0.9, e: -0.5, w: 0 } },
  };
  {
    const g = boy.group.position;
    for (let i = 0; i < 12; i++) {
      randomSpot(g, false);
      if (!inPierZone(g.x, g.z)) break;
    }
    if (inPierZone(g.x, g.z)) g.set(2, 0, -4);
    g.y = BOY_Y;
  }
  // a gold coin in his right hand, with a glint
  const boyCoin = (() => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.016, 18), new THREE.MeshToonMaterial({ color: 0xffd34a, emissive: 0x6a4400, gradientMap: softToonRamp() }));
    m.rotation.x = Math.PI / 2;
    m.position.set(0, -0.06, 0);
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xffe9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glint.scale.setScalar(0.45);
    glint.userData.ownFade = true;
    m.add(glint);
    m.visible = false;
    boy.hands[1].add(m);
    return m;
  })();
  // a bump on his head, and stars going round it
  const bump = (() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshToonMaterial({ color: 0xf0a090, emissive: 0x24160c }));
    m.position.set(0.04, boy.faceC + HEAD_R + 0.02, 0.03);
    m.scale.set(1, 0.8, 1);
    m.visible = false;
    boy.head.add(m);
    return m;
  })();
  const starTex = canvasTexture(drawStar());
  const stars = [0, 1, 2].map(() => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false }));
    m.scale.setScalar(0.17);
    m.visible = false;
    m.userData.ownFade = true;
    boy.group.add(m);
    return m;
  });
  // her comb out of her hand: thrown, in the river, in his hand
  const flyComb = new THREE.Mesh(comb.geometry, propMat);
  flyComb.scale.setScalar(1.3);
  flyComb.visible = false;
  scene.add(flyComb);

  const KARM = {
    tread: { x: -0.4, o: 0.9, e: -0.5 }, // sculling just under the water
    reach: { x: -1.35, o: -0.15, e: -0.25 },
    up: { x: -2.95, o: 0.2, e: -0.1 }, // held high
    limp: { x: -0.15, o: 0.7, e: -0.15 },
    wave: { x: -0.25, o: 0.38, e: -2.15, w: 1 },
    wai: { x: -0.22, o: -0.4, e: -2.35 }, // sorry!
    cheer: { x: -2.6, o: 0.75, e: -0.4 },
  };
  const armWant = { x: 0, o: 0, e: 0, w: 0 };
  function poseBoy(p, dt) {
    const d = diver;
    const t = p.t;
    const s = p.height / 1.8;
    const k = 1 - Math.exp(-dt * 9);
    const want = d.want || { l: KARM.tread, r: KARM.tread };
    ["l", "r"].forEach((sd, i) => {
      const a = d.cur[sd];
      let b = want[sd];
      const ph = t * 8 + i * Math.PI;
      if (b === "paddle") {
        // doggy paddle: hands churning in front, out of step
        armWant.x = -1.25 + Math.sin(ph) * 0.55;
        armWant.o = -0.1;
        armWant.e = -0.7 + Math.cos(ph) * 0.4;
        armWant.w = 0;
        b = armWant;
      } else if (b === KARM.tread) {
        armWant.x = b.x;
        armWant.o = b.o + Math.sin(t * 3 + i * Math.PI) * 0.25;
        armWant.e = b.e;
        armWant.w = 0;
        b = armWant;
      }
      a.x += (b.x - a.x) * k;
      a.o += (b.o - a.o) * k;
      a.e += (b.e - a.e) * k;
      a.w += ((b.w ?? 0) - a.w) * k;
      const side = i ? 1 : -1;
      p.arms[i].rotation.set(a.x, 0, side * a.o);
      p.elbows[i].rotation.set(a.e, 0, side * a.w * Math.sin(t * 6) * 0.4);
    });
    p.inner.scale.setScalar(s);
    p.inner.position.set(0, 0, 0);
    p.inner.rotation.set(d.swim * 0.35, 0, Math.sin(t * 2.1) * 0.04);
    // legs kicking lazily under the water
    p.legs[0].rotation.x = Math.sin(t * 5) * 0.4;
    p.legs[1].rotation.x = -Math.sin(t * 5) * 0.4;
    // dizzy after the bonk: his head goes round and round
    p.head.rotation.set(Math.sin(t * 0.6) * 0.05 + Math.sin(t * 7) * 0.2 * d.wob, Math.sin(t * 0.4) * 0.1, Math.sin(t * 0.9) * 0.06 + Math.cos(t * 7) * 0.25 * d.wob);
    p.faceOverride = d.face;
  }
  function turnBoy(yaw, dt) {
    boy.group.rotation.y += wrapAngle(yaw - boy.group.rotation.y) * Math.min(1, dt * 5);
  }
  const boyTmp = new THREE.Vector3();
  function boyRipples(dt, every) {
    diver.rippleT -= dt;
    if (diver.rippleT > 0) return;
    diver.rippleT = every;
    const g = boy.group.position;
    if (g.y > BOY_Y - 0.4) ripple(g.x, g.z, 0.8, 0xcfe8ff);
  }
  // free time: off to a krathong, a coin, off to the next
  function boyRoam(dt) {
    const d = diver;
    if (d.script) return;
    const g = boy.group.position;
    const toCam = Math.atan2(camera.position.x - g.x, camera.position.z - g.z);
    let moving = false;
    let yaw = null;
    d.face = null;
    d.wob = 0;
    d.want = null;
    boyCoin.visible = false;
    if (inPierZone(g.x, g.z)) {
      // out of the way of the pier first (e.g. after handing her comb back)
      boyTmp.set(-0.1, 0, Math.min(g.z, 1.2));
      const dx = boyTmp.x - g.x;
      const dz = boyTmp.z - g.z;
      const dist = Math.hypot(dx, dz) || 1;
      g.x += (dx / dist) * Math.min(dist, BOY_SPEED * dt);
      g.z += (dz / dist) * Math.min(dist, BOY_SPEED * dt);
      yaw = Math.atan2(dx, dz);
      moving = true;
      d.goal = null;
      d.grab = -1;
    } else if (d.grab >= 0) {
      // at a krathong: reach in... a coin! hold it up, then off again
      const u0 = d.grab;
      d.grab += dt;
      const u = d.grab;
      if (u < 0.6) {
        d.want = { l: KARM.tread, r: KARM.reach };
        if (d.goal && krathongs.includes(d.goal)) yaw = Math.atan2(d.goal.root.position.x - g.x, d.goal.root.position.z - g.z);
      } else if (u < 1.7) {
        d.want = { l: KARM.tread, r: KARM.up };
        boyCoin.visible = true;
        yaw = toCam;
      }
      if (u0 < 0.6 && u >= 0.6) {
        boy.hands[1].getWorldPosition(boyTmp);
        burst(boyTmp, 14, { speed: 0.9, colors: [0xffe27a, 0xfff6c8, 0xffffff], life: 0.5 });
        sound.ting(Math.min(0.06, 0.5 / camera.position.distanceTo(boyTmp)));
      }
      if (u > 2.0) {
        d.grab = -1;
        d.goal = null;
        d.wait = rand(1.5, 4);
      }
    } else if (d.goal && krathongs.includes(d.goal) && d.goal.placed && !d.goal.stolen && d.goal.sinking == null) {
      const kp = d.goal.root.position;
      const dx = kp.x - g.x;
      const dz = kp.z - g.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.6) {
        d.grab = 0;
      } else {
        const step = Math.min(dist - 0.55, BOY_SPEED * dt);
        g.x += (dx / dist) * step;
        g.z += (dz / dist) * step;
        yaw = Math.atan2(dx, dz);
        moving = true;
      }
      if (inPierZone(kp.x, kp.z)) d.goal = null; // it drifted to the pier: leave it
    } else {
      d.goal = null;
      d.wait -= dt;
      if (d.wait <= 0) {
        const pick = krathongs.filter((k) => !k.sky && k.placed && !k.stolen && k.sinking == null && !inPierZone(k.root.position.x, k.root.position.z));
        d.goal = pick.length ? pick[Math.floor(Math.random() * pick.length)] : null;
        d.wait = 2;
      }
    }
    g.y = BOY_Y + Math.sin(boy.t * 2.4) * 0.03;
    d.swim += ((moving ? 1 : 0) - d.swim) * Math.min(1, dt * 4);
    if (!d.want) d.want = moving ? { l: "paddle", r: "paddle" } : { l: KARM.tread, r: KARM.tread };
    if (yaw != null) turnBoy(yaw, dt);
    boyRipples(dt, moving ? 0.35 : 1.3);
  }

  // ----- the coin gag (one of the idle-bag tickets): now and then
  // the coin diver fishes the coin out of one of Kru Song's krathongs and
  // it sinks. She gasps, points at him, fumes (cutely) and throws her comb
  // at him: bonk, a bump and stars. He dives for the krathong and floats
  // it again with its candle relit, then dives for her comb and brings it
  // back while she huffs. She combs her hair, and she's herself again. -----
  const COIN_EDGE = new THREE.Vector3(-2.55, PIER.top, 1.95); // she kneels here for the comb
  const COIN_RETURN = new THREE.Vector3(-1.95, BOY_Y, 1.95); // he hands it up from here
  Object.assign(ARM, {
    point: { x: -1.55, o: 0.05, e: -0.05 }, // "YOU!"
    fist: { x: 0.08, o: 0.3, e: -1.0 }, // little fists, cross
    windup: { x: -2.75, o: 0.4, e: -1.9 }, // comb back over her head
    fling: { x: -1.2, o: 0.0, e: -0.1 }, // ... and thrown
  });
  const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
  // one of her krathongs out on the water, the one nearest the pier
  function coinTarget() {
    let best = null;
    let bd = Infinity;
    for (const k of krathongs) {
      if (k.simple || k.sky || !k.placed || k.sinking != null || k.stolen) continue;
      const p = k.root.position;
      if (inPierZone(p.x, p.z)) continue;
      const d = Math.hypot(p.x - TEACHER_POS.x, p.z - TEACHER_POS.z);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }
  // everything is planned up front from where the krathong and the boy
  // are, so each beat is a function of the gag's time
  function planCoin(k) {
    const K = k.root.position.clone().setY(0);
    const S = boy.group.position.clone();
    // he stops beside it (to its right as the camera sees it)
    const G1 = new THREE.Vector3(K.x + 0.6, BOY_Y, K.z + 0.1);
    const CL = new THREE.Vector3(G1.x + 0.55, 0, G1.z + 0.35); // where the comb lands
    const a = Math.min(5, Math.max(1.2, Math.hypot(S.x - G1.x, S.z - G1.z) / 2.2));
    const b = a + 2.4; // she sees
    const c = b + 2.6; // winds up
    const rel = c + 1.0; // throws
    const h = rel + 0.9; // bonk
    const sw = h + 8.0; // he swims her comb back
    const j = sw + Math.min(6, Math.max(1.5, Math.hypot(CL.x - COIN_RETURN.x, CL.z - COIN_RETURN.z) / 1.7));
    const end = j + 5.8;
    const yawK = yawTo(TEACHER_POS, G1);
    const keys = [
      [0, pose("clasp", "clasp", { hz: 0.08, yaw: TEACHER_YAW })],
      [b, pose("brace", "brace", { hx: -0.1, yaw: yawK })], // gasp!
      [b + 1.0, pose("fist", "point", { hx: -0.05, hz: 0.1, yaw: yawK })], // YOU!
      [c, pose("windup", "fist", { hx: -0.15, lean: -0.06, yaw: yawK })],
      [rel, pose("fling", "fist", { hx: 0.05, lean: 0.12, yaw: yawK })],
      [h, pose("fist", "fist", { hx: -0.3, hz: 0.14, yaw: yawK - 0.6 })], // hmph!
      [h + 1.6, pose("fist", "fist", { hx: -0.1, yaw: yawK })],
    ];
    // huffing while he brings it back: chin up and away, then a glance
    for (let tt = h + 6.6, n = 0; tt < j - 1.3; tt += 1.3, n++) {
      keys.push([tt, n % 2 ? pose("fist", "fist", { hx: -0.05, hz: -0.1, yaw: yawTo(TEACHER_POS, COIN_RETURN) - 0.3 }) : pose("fist", "fist", { hx: -0.28, hz: 0.15, yaw: FACE_CAM - 0.5 })]);
    }
    keys.push(
      [j - 1.0, pose("rest", "rest", { yaw: FACE_WATER })], // to the edge
      [j + 0.3, pose("reach", "reach", { dip: 0.16, lean: 0.2, hx: 0.4, yaw: FACE_WATER })], // takes it
      [j + 1.1, pose("rest", "rest", { yaw: FACE_CAM })],
      [j + 1.3, pose("comb", "rest", { hz: -0.16, yaw: FACE_CAM })],
      [j + 2.1, pose("comb", "rest", { hz: 0.12, yaw: FACE_CAM })],
      [j + 2.9, pose("comb", "rest", { hz: -0.16, yaw: FACE_CAM })],
      [j + 3.7, pose("heart", "heart", { hz: 0.14, yaw: FACE_CAM })], // pretty again
      [j + 4.4, pose("clasp", "clasp", { yaw: TEACHER_YAW })], // back to her spot
      [j + 5.0, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
      [end, null]
    );
    return { K, S, G1, CL, a, b, c, rel, h, sw, j, end, keys };
  }
  function startCoin(item) {
    const k = coinTarget();
    if (!k) return false;
    item.target = k;
    item.plan = planCoin(k);
    k.stolen = true;
    diver.script = item;
    diver.goal = null;
    diver.grab = -1;
    return true;
  }
  function endCoin(item) {
    const k = item.target;
    if (krathongs.includes(k) && k.stolen) {
      // (in case it was cut short) her krathong is back, lit, on the water
      k.root.position.set(item.plan.K.x, 0, item.plan.K.z);
      k.root.rotation.z = 0;
      k.root.scale.setScalar(1);
      k.root.visible = true;
      k.flame.visible = true;
      k.pool.visible = true;
      k.lit = 1;
      k.placed = true;
    }
    if (k) k.stolen = false;
    diver.script = null;
    diver.face = null;
    diver.wob = 0;
    boyCoin.visible = false;
    flyComb.visible = false;
    bump.visible = false;
    for (const s of stars) s.visible = false;
  }
  // her side of it: faces, the cross mark, stomping, the comb, where she is
  function coinState(t, pl) {
    const g = gagBase();
    if (t < pl.b) return g;
    if (t < pl.b + 1.0) {
      g.face = "huh";
      g.exclaim = Math.sin(clamp01((t - pl.b) / 1.0) * Math.PI);
    } else if (t < pl.j + 1.1) g.face = "pout";
    else if (t < pl.j + 3.7) g.face = "blink"; // eyes shut, combing
    if (t >= pl.b + 1.0 && t < pl.j + 0.3) g.anger = smooth(clamp01((t - pl.b - 1.0) / 0.3)) * (1 - smooth(clamp01((t - pl.j) / 0.3)));
    // stomp, stomp
    if (t > pl.b + 1.2 && t < pl.c) g.bob = Math.abs(Math.sin((t - pl.b - 1.2) * 6)) * 0.03;
    if (t > pl.h + 6.6 && t < pl.j - 1.0) g.bob = Math.abs(Math.sin((t - pl.h) * 5)) * 0.022;
    g.comb = (t > pl.c - 0.05 && t < pl.rel) || (t > pl.j + 0.9 && t < pl.j + 3.75);
    if (t >= pl.j - 1.0 && t < pl.j + 5.0) {
      const p = wetPos;
      if (t < pl.j - 0.3) p.lerpVectors(TEACHER_POS, COIN_EDGE, smooth((t - pl.j + 1.0) / 0.7));
      else if (t < pl.j + 4.4) p.copy(COIN_EDGE);
      else p.lerpVectors(COIN_EDGE, TEACHER_POS, smooth(clamp01((t - pl.j - 4.4) / 0.6)));
      g.pos = p;
    }
    return g;
  }
  const coinTmp = new THREE.Vector3();
  const coinTmp2 = new THREE.Vector3();
  function coinPerformance(P, item, t, dt) {
    const pl = item.plan;
    applyGag(coinState(t, pl));
    const d = diver;
    const g = boy.group.position;
    const k = item.target;
    const alive = krathongs.includes(k);
    const toCam = Math.atan2(camera.position.x - g.x, camera.position.z - g.z);
    let yaw = toCam;
    let y = BOY_Y + Math.sin(boy.t * 2.4) * 0.03;
    let want = { l: KARM.tread, r: KARM.tread };
    let combInHand = false;
    d.swim = 0;
    d.wob = 0;
    d.face = null;
    boyCoin.visible = false;

    // ---- him ----
    if (t < pl.a) {
      g.lerpVectors(pl.S, pl.G1, smooth(t / pl.a));
      yaw = yawTo(pl.S, pl.G1);
      d.swim = 1;
      want = { l: "paddle", r: "paddle" };
    } else if (t < pl.h + 3.0) {
      g.copy(pl.G1);
      if (t < pl.a + 0.6) {
        want = { l: KARM.tread, r: KARM.reach };
        yaw = yawTo(pl.G1, pl.K);
      } else if (t < pl.a + 1.6) {
        want = { l: KARM.tread, r: KARM.up }; // a coin!
        boyCoin.visible = true;
        d.face = "open";
      } else if (t < pl.b + 1.0) {
        yaw = yawTo(pl.G1, pl.K); // uh-oh, it's sinking
        d.face = "huh";
      } else if (t < pl.h) {
        yaw = yawTo(pl.G1, TEACHER_POS); // who, me?
        d.face = "huh";
      } else {
        d.face = "daze";
        d.wob = 1;
        want = { l: KARM.limp, r: KARM.limp };
      }
    } else if (t < pl.h + 4.6) {
      // dives for the krathong
      g.copy(pl.G1);
      y = lerp(BOY_Y, -2.4, smooth(clamp01((t - pl.h - 3.0) / 0.35)));
      want = { l: KARM.up, r: KARM.up };
    } else if (t < pl.h + 6.4) {
      // up with it over his head, sets it back on the water, ta-da
      g.copy(pl.G1);
      y = lerp(-2.4, BOY_Y, smooth(clamp01((t - pl.h - 4.6) / 0.3)));
      if (t < pl.h + 5.4) want = { l: KARM.up, r: KARM.up };
      else if (t < pl.h + 6.0) {
        want = { l: KARM.reach, r: KARM.reach };
        yaw = yawTo(pl.G1, pl.K);
      } else {
        want = { l: KARM.cheer, r: KARM.cheer };
        d.face = "open";
      }
    } else if (t < pl.sw) {
      // dives again for her comb
      g.lerpVectors(pl.G1, coinTmp.set(pl.CL.x, 0, pl.CL.z), smooth(clamp01((t - pl.h - 6.4) / 1.0)));
      if (t < pl.h + 7.4) {
        y = lerp(BOY_Y, -2.4, smooth(clamp01((t - pl.h - 6.4) / 0.35)));
        want = { l: KARM.up, r: KARM.up };
      } else {
        y = lerp(-2.4, BOY_Y, smooth(clamp01((t - pl.h - 7.4) / 0.3)));
        want = { l: KARM.tread, r: KARM.up };
        combInHand = true;
        d.face = "open";
      }
    } else if (t < pl.j) {
      // one-handed doggy paddle to the pier, her comb held up high
      coinTmp.set(pl.CL.x, 0, pl.CL.z);
      g.lerpVectors(coinTmp, COIN_RETURN, smooth((t - pl.sw) / (pl.j - pl.sw)));
      yaw = yawTo(coinTmp, COIN_RETURN);
      d.swim = 1;
      want = { l: "paddle", r: KARM.up };
      combInHand = true;
    } else {
      g.copy(COIN_RETURN);
      // turned half to her, half to the camera
      yaw = yawTo(COIN_RETURN, COIN_EDGE) + wrapAngle(toCam - yawTo(COIN_RETURN, COIN_EDGE)) * 0.5;
      if (t < pl.j + 0.9) {
        want = { l: KARM.tread, r: KARM.up };
        combInHand = true;
      } else if (t < pl.j + 2.0) {
        want = { l: KARM.wai, r: KARM.wai }; // sorry, kru!
        d.face = "blink";
      } else {
        want = { l: KARM.tread, r: KARM.wave };
        d.face = "open";
      }
    }
    g.y = y;
    d.want = want;
    turnBoy(yaw, dt);
    if (y > BOY_Y - 0.2) boyRipples(dt, d.swim > 0.5 ? 0.3 : 1.2);

    // ---- the bump and the stars ----
    const bumpAmt = t < pl.h ? 0 : t < pl.j + 1.5 ? smooth(clamp01((t - pl.h) / 0.15)) : 1 - smooth(clamp01((t - pl.j - 1.5) / 0.5));
    bump.visible = bumpAmt > 0.01;
    bump.scale.set(1, 0.8, 1).multiplyScalar(Math.max(0.001, bumpAmt) * (1 + 0.25 * Math.exp(-(t - pl.h) * 6) * Math.sin((t - pl.h) * 40)));
    const starOn = t > pl.h && t < pl.h + 3.0;
    stars.forEach((s, i) => {
      s.visible = starOn;
      if (!starOn) return;
      const a = t * 4 + (i / 3) * TAU;
      s.position.set(Math.cos(a) * 0.24, boy.topY + 0.1 + Math.sin(a * 2) * 0.02, Math.sin(a) * 0.24);
      s.material.opacity = 1 - smooth(clamp01((t - pl.h - 2.6) / 0.4));
    });

    // ---- her krathong ----
    if (alive) {
      const kp = k.root.position;
      if (t < pl.a + 0.6) {
        kp.set(pl.K.x, Math.sin(clock * 1.4 + k.phase) * 0.025, pl.K.z);
      } else if (t < pl.a + 2.4) {
        // rocks as the coin comes out, then goes down, candle and all
        const u = (t - pl.a - 0.6) / 1.8;
        k.placed = false;
        kp.set(pl.K.x, -2.4 * u * u, pl.K.z);
        k.root.rotation.z = Math.sin(t * 14) * 0.15 * (1 - u) + 0.45 * u;
        if (t > pl.a + 0.9) {
          k.flame.visible = false;
          k.pool.visible = false;
          k.lit = 0;
        }
      } else if (t < pl.h + 4.6) {
        k.root.visible = false;
      } else if (t < pl.h + 5.4) {
        // up over his head
        k.root.visible = true;
        k.root.rotation.z = 0;
        boy.hands[0].getWorldPosition(kp);
        boy.hands[1].getWorldPosition(coinTmp2);
        kp.add(coinTmp2).multiplyScalar(0.5);
        kp.y += 0.04;
        k.root.scale.setScalar(0.6);
      } else if (t < pl.h + 6.0) {
        if (!P.kHeld) P.kHeld = kp.clone();
        const u = smooth((t - pl.h - 5.4) / 0.6);
        kp.lerpVectors(P.kHeld, coinTmp.set(pl.K.x, 0, pl.K.z), u);
        k.root.scale.setScalar(lerp(0.6, 1, u));
      } else {
        kp.set(pl.K.x, Math.sin(clock * 1.4 + k.phase) * 0.025, pl.K.z);
        k.root.scale.setScalar(1);
        if (once(P, "relight", t, pl.h + 6.0)) {
          k.flame.visible = true;
          k.pool.visible = true;
          k.lit = 1;
          k.flame.getWorldPosition(coinTmp2);
          burst(coinTmp2, 50, { speed: 1.4, colors: [0xfff3b0, 0xffd27a, 0xffb3e6, 0xffffff], life: 0.9 });
          ripple(pl.K.x, pl.K.z, 1.8);
          ripple(pl.K.x, pl.K.z, 2.8);
          sound.chime();
        }
        if (t > pl.h + 6.3 && k.stolen) {
          k.placed = true;
          k.stolen = false;
          k.vel.set(0, 0, 0);
        }
      }
    }

    // ---- her comb ----
    if (t >= pl.rel && t < pl.h + 0.6) {
      if (!P.combFrom) {
        P.combFrom = new THREE.Vector3();
        comb.getWorldPosition(P.combFrom);
      }
      flyComb.visible = true;
      const hit = coinTmp2.set(pl.G1.x, BOY_Y + boy.topY - 0.05, pl.G1.z);
      if (t < pl.h) {
        const u = (t - pl.rel) / (pl.h - pl.rel);
        flyComb.position.lerpVectors(P.combFrom, hit, u);
        flyComb.position.y += Math.sin(u * Math.PI) * 0.9;
      } else {
        // bonk! it bounces off into the river
        const u = (t - pl.h) / 0.6;
        flyComb.position.lerpVectors(hit, pl.CL, u);
        flyComb.position.y += Math.sin(u * Math.PI) * 0.6;
      }
      flyComb.rotation.set(t * 14, 0.3, t * 9);
    } else if (combInHand) {
      flyComb.visible = true;
      boy.hands[1].getWorldPosition(flyComb.position);
      flyComb.position.y += 0.05;
      flyComb.rotation.set(0, boy.group.rotation.y, 0.3);
    } else {
      flyComb.visible = false;
    }

    // ---- effects and sounds, each once ----
    const head = teacher.head.getWorldPosition(eyeTmp);
    if (once(P, "coin", t, pl.a + 0.6)) {
      boy.hands[1].getWorldPosition(coinTmp2);
      burst(coinTmp2, 24, { speed: 1.1, colors: [0xffe27a, 0xfff6c8, 0xffffff], life: 0.6 });
      sound.ting(0.08);
    }
    if (alive && once(P, "out", t, pl.a + 0.9)) {
      puff(coinTmp2.set(pl.K.x + 0.24, 0.75, pl.K.z + 0.1), { size: 0.08, grow: 2.5, life: 1.0, rise: 0.3, spread: 0.05, a: 0.6, color: 0x8a8088 });
      sound.fizzle();
    }
    // bubbles where it went down, and where he dives
    const bubbling = (t > pl.a + 0.9 && t < pl.a + 2.8) || (t > pl.h + 3.1 && t < pl.h + 4.6) || (t > pl.h + 6.5 && t < pl.h + 7.4);
    if (bubbling) {
      P.bub = (P.bub ?? 0) - dt;
      if (P.bub <= 0) {
        P.bub = rand(0.12, 0.25);
        const at = coinTmp2.set(g.x + rand(-0.3, 0.3), 0.05, g.z + rand(-0.3, 0.3));
        if (t < pl.a + 2.8) at.set(pl.K.x + rand(-0.25, 0.25), 0.05, pl.K.z + rand(-0.25, 0.25));
        burst(at, 4, { speed: 0.35, colors: [0xcfeeff, 0xffffff], life: 0.4, up: 0.4 });
        ripple(at.x, at.z, 0.5, 0xcfe8ff);
        sound.blub();
      }
    }
    if (once(P, "gasp", t, pl.b)) sound.pop(0.15);
    for (const at of [pl.b + 1.0, pl.b + 1.9, pl.c + 0.3]) if (once(P, "hmph" + at, t, at)) sound.hmph();
    if (once(P, "throw", t, pl.rel)) sound.whoosh();
    if (once(P, "bonk", t, pl.h)) {
      coinTmp2.set(pl.G1.x, BOY_Y + boy.topY, pl.G1.z);
      burst(coinTmp2, 30, { speed: 1.6, colors: [0xffe27a, 0xffffff], life: 0.5 });
      sound.bonk();
    }
    if (once(P, "combin", t, pl.h + 0.6)) {
      burst(coinTmp2.set(pl.CL.x, 0.05, pl.CL.z), 20, { speed: 1.2, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
      ripple(pl.CL.x, pl.CL.z, 1.0, 0xcfe8ff);
      sound.plop();
    }
    for (const at of [pl.h + 3.0, pl.h + 6.4]) {
      if (once(P, "dive" + at, t, at)) {
        burst(coinTmp2.set(g.x, 0.05, g.z), 40, { speed: 1.8, colors: [0xbfe6ff, 0xffffff], life: 0.6, up: 1.2 });
        ripple(g.x, g.z, 1.4, 0xcfe8ff);
        sound.plop();
      }
    }
    for (const at of [pl.h + 4.6, pl.h + 7.4]) {
      if (once(P, "up" + at, t, at)) {
        burst(coinTmp2.set(g.x, 0.05, g.z), 40, { speed: 1.8, colors: [0xbfe6ff, 0xffffff], life: 0.6, up: 1.2 });
        ripple(g.x, g.z, 1.6, 0xcfe8ff);
        sound.splash();
      }
    }
    // huffing: little puffs of steam from both sides of her head
    const huffing = (t > pl.b + 1.0 && t < pl.c) || (t > pl.h + 6.6 && t < pl.j - 1.0);
    if (huffing) {
      P.steam = (P.steam ?? 0) - dt;
      if (P.steam <= 0) {
        P.steam = 0.5;
        fwd.set(1, 0, 0).applyQuaternion(teacher.group.quaternion);
        for (const s of [-1, 1]) {
          coinTmp2.copy(head).addScaledVector(fwd, s * 0.22);
          coinTmp2.y += 0.12;
          puff(coinTmp2, { size: 0.05, grow: 2.4, life: 0.7, rise: 0.35, spread: 0.04, a: 0.75, color: 0xffffff });
        }
      }
      P.huffT = (P.huffT ?? 1.0) - dt;
      if (t > pl.h && P.huffT <= 0) {
        P.huffT = 2.6;
        sound.hmph();
      }
    }
    if (once(P, "back", t, pl.j + 0.9)) {
      comb.getWorldPosition(coinTmp2);
      burst(coinTmp2, 20, { speed: 0.9, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.6 });
    }
    if (once(P, "pretty", t, pl.j + 3.7)) {
      coinTmp2.copy(head);
      coinTmp2.y += 0.2;
      burst(coinTmp2, 50, { speed: 1.5, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.9 });
      sound.chime();
    }
  }
  function coinShot(pos, look, P) {
    const pl = P.k.plan;
    const t = P.t;
    const portrait = camera.aspect < 1;
    // close on the boy and her krathong, from the front a little to the side
    const onBoy = () => {
      const x = (pl.K.x + pl.G1.x) / 2;
      const z = (pl.K.z + pl.G1.z) / 2;
      const dd = portrait ? 5.8 : 4.4;
      look.set(x, 0.45, z);
      pos.set(x + Math.sin(0.35) * dd, 1.55, z + Math.cos(0.35) * dd);
    };
    if (t < pl.b - 0.3) onBoy();
    else if (t < pl.c - 0.4) {
      // from in front of her as she turns on him, so her cross little
      // face is what we see (he's behind the camera)
      const yawK = yawTo(TEACHER_POS, pl.G1) + 0.6;
      const dd = 3.7 + (portrait ? 1.6 : 0);
      look.set(TEACHER_POS.x, 1.55, TEACHER_POS.z);
      pos.set(TEACHER_POS.x + Math.sin(yawK) * dd, 1.85, TEACHER_POS.z + Math.cos(yawK) * dd);
    } else if (t < pl.h + 0.6) {
      // both of them, set and still before the throw
      const mx = (TEACHER_POS.x + pl.G1.x) / 2;
      const mz = (TEACHER_POS.z + pl.G1.z) / 2;
      const sep = Math.hypot(TEACHER_POS.x - pl.G1.x, TEACHER_POS.z - pl.G1.z);
      const dd = Math.max(4.5, sep * 0.95 + 2.6) * (portrait ? 1.6 : 1);
      look.set(mx, 0.9, mz);
      pos.set(mx + Math.sin(0.25) * dd, 1.4 + dd * 0.12, mz + Math.cos(0.25) * dd);
    } else if (t < pl.h + 6.5) onBoy();
    else if (t > pl.j - 1.6 && t < pl.j + 1.2) {
      // the hand-over: side on, her at the pier's edge and him in the water
      // below her (set before he arrives)
      const dd = 4.2 + (portrait ? 1.8 : 0);
      look.set((COIN_EDGE.x + COIN_RETURN.x) / 2, 0.8, 1.95);
      pos.set(look.x + Math.sin(0.15) * dd, 1.6, 1.95 + Math.cos(0.15) * dd);
    } else closeOnHer(pos, look);
  }

  // ----- the glasses gag: as she leans out to float her krathong, her
  // glasses slip off her nose, bounce across the deck and plop into the
  // river. The krathong still goes out fine, but she can't see a thing:
  // she squints and gropes about, and wais the mooring post instead of the
  // river. The coin-diver boy dives for them, swims them over and hands
  // them up; she puts them on, sees what she did and goes all shy, thanks
  // him, and wais the river properly. -----
  const GL_SLIP = 3.3; // off her nose
  const GL_DECK_T = 3.6; // first bounce, on the deck
  const GL_EDGE_T = 3.9; // off the edge
  const GL_PLOP_T = 4.15; // into the river
  const GL_DECK = new THREE.Vector3(-2.75, PIER.top + 0.02, 2.05);
  const GL_EDGE = new THREE.Vector3(-2.32, PIER.top + 0.02, 2.2);
  const GL_SPOT = new THREE.Vector3(-1.85, 0.02, 2.35); // where they go in
  const GL_DIVE = new THREE.Vector3(-1.65, BOY_Y, 2.45); // where he dives for them
  Object.assign(ARM, {
    grope: { x: -1.35, o: 0.08, e: -0.3, w: 1 }, // feeling about in front of her
    specs: { x: -1.55, o: -0.12, e: -1.8 }, // hands up by her face: glasses on
    cheeks: { x: -1.4, o: -0.45, e: -1.75 }, // hands to her chin, all shy
  });
  const glassesTmp = new THREE.Vector3();
  const glassesTmp2 = new THREE.Vector3();
  // her glasses out of her face: falling, in the river, in his hand, in hers
  const flyGlasses = teacher.glassesMesh ? new THREE.Mesh(teacher.glassesMesh.geometry, teacher.glassesMesh.material) : null;
  if (flyGlasses) {
    flyGlasses.visible = false;
    scene.add(flyGlasses);
  }
  function planGlasses() {
    const S = boy.group.position.clone();
    const go = 4.0; // he heard the plop
    const a = Math.min(4.5, Math.max(1.2, Math.hypot(S.x - GL_DIVE.x, S.z - GL_DIVE.z) / 2.2));
    const d0 = Math.max(go + a, 5.4); // dives
    const d1 = d0 + 1.3; // up, with them
    const w0 = Math.max(6.6, d1 - 0.6); // she turns to the post...
    const wai = w0 + 0.7; // ... and wais it
    const call = Math.max(d1 + 1.6, wai + 1.9); // "kru! here!"
    const step = call + 0.8; // she feels her way to the edge
    const take = step + 1.3; // kneels, takes them
    const on = take + 1.2; // puts them on
    const shy = on + 1.0; // sees what she did
    const thanks = shy + 1.6; // wais him
    const back = thanks + 1.2; // back to her spot
    const rwai = back + 0.8; // the real wai, to the river
    const wave = rwai + 1.6;
    const end = wave + 1.5;
    const yawPost = yawTo(TEACHER_POS, MOOR_POS);
    const yawCall = yawTo(TEACHER_POS, COIN_RETURN);
    const keys = FLOAT_KEYS.filter(([at]) => at < GL_SLIP);
    keys.push(
      [GL_EDGE_T, pose("brace", "brace", { dip: 0.1, lean: 0.05, hx: 0.1, yaw: FACE_WATER })], // oh no!
      [4.7, pose("grope", "grope", { hx: 0.2, yaw: FACE_WATER - 0.3 })]
    );
    // feeling about: turning this way and that, peering
    for (let tt = 5.6, n = 0; tt < w0 - 0.3; tt += 0.9, n++) {
      keys.push([tt, pose("grope", "grope", { hx: 0.22, hz: n % 2 ? 0.12 : -0.12, yaw: n % 2 ? FACE_WATER - 0.2 : FACE_CAM + 0.15 })]);
    }
    keys.push(
      [w0, pose("grope", "grope", { hx: 0.18, yaw: yawPost })], // there's the river...
      [wai, pose("wai", "wai", { dip: 0.08, lean: 0.2, hx: 0.38, eyes: 1, yaw: yawPost })],
      [wai + 1.1, pose("wai", "wai", { dip: 0.04, lean: 0.06, hx: 0.14, eyes: 1, yaw: yawPost })],
      [call, pose("rest", "rest", { hx: -0.05, hz: 0.14, yaw: yawCall })], // huh?
      [step, pose("grope", "grope", { hx: 0.2, yaw: FACE_WATER })],
      [take, pose("reach", "reach", { dip: 0.16, lean: 0.2, hx: 0.4, yaw: FACE_WATER })],
      [on - 0.3, pose("rest", "rest", { yaw: FACE_CAM })],
      [on, pose("specs", "specs", { hx: 0.02, yaw: FACE_CAM })],
      [shy, pose("cheeks", "cheeks", { hx: 0.14, hz: 0.14, yaw: FACE_CAM })],
      [shy + 0.5, pose("cheeks", "cheeks", { hx: 0.14, hz: -0.14, yaw: FACE_CAM })],
      [shy + 1.0, pose("cheeks", "cheeks", { hx: 0.16, hz: 0.14, yaw: FACE_CAM })],
      [thanks, pose("wai", "wai", { dip: 0.06, lean: 0.14, hx: 0.3, eyes: 1, yaw: FACE_WATER })], // thank you!
      [back, pose("clasp", "clasp", { yaw: TEACHER_YAW_FLOAT })],
      [rwai, pose("wai", "wai", { dip: 0.12, lean: 0.1, hx: 0.36, eyes: 1, yaw: FACE_WATER })],
      [wave, pose("clasp", "wave", { hx: 0.05, hz: -0.12, yaw: FACE_CAM })],
      [end, null]
    );
    return { S, go, a, d0, d1, w0, wai, call, step, take, on, shy, thanks, back, rwai, wave, end, keys };
  }
  function startGlasses(k) {
    k.gplan = planGlasses();
    diver.script = k;
    diver.goal = null;
    diver.grab = -1;
  }
  function endGlasses(k) {
    if (diver.script === k) diver.script = null;
    diver.face = null;
    if (flyGlasses) flyGlasses.visible = false;
  }
  // her side: no glasses, faces, the "!" and "?", walking to the edge
  function glassesState(t, pl) {
    const g = gagBase();
    if (t < GL_SLIP) return g;
    g.noGlasses = t < pl.on + 0.4;
    if (t >= GL_EDGE_T && t < 4.7) {
      g.face = "huh";
      g.exclaim = Math.sin(clamp01((t - GL_EDGE_T) / 0.8) * Math.PI);
    } else if (t >= 4.7 && t < pl.wai) g.face = "squint";
    else if (t >= pl.wai + 1.7 && t < pl.call) g.face = "squint";
    else if (t >= pl.call && t < pl.call + 0.8) g.face = "huh";
    else if (t >= pl.call + 0.8 && t < pl.on + 0.4) g.face = "squint";
    else if (t >= pl.on + 0.4 && t < pl.shy) g.face = "open";
    else if (t >= pl.shy && t < pl.thanks) g.face = "shy";
    // "?" while she feels about, and when he calls
    if (t > 5.2 && t < 6.4) g.question = Math.sin(clamp01((t - 5.2) / 1.2) * Math.PI);
    if (t > pl.call && t < pl.call + 0.9) g.question = Math.sin(clamp01((t - pl.call) / 0.9) * Math.PI);
    // little unsure shuffles while groping
    if (t > 4.8 && t < pl.w0 + 0.3) g.bob = Math.abs(Math.sin((t - 4.8) * 4)) * 0.012;
    if (t >= pl.step && t < pl.back + 0.6) {
      const p = wetPos;
      if (t < pl.step + 1.0) {
        // small careful steps, feeling the way
        const u = (t - pl.step) / 1.0;
        p.lerpVectors(TEACHER_POS, COIN_EDGE, smooth(u));
        p.y = PIER.top + Math.abs(Math.sin(u * Math.PI * 3)) * 0.025;
      } else if (t < pl.back) p.copy(COIN_EDGE);
      else p.lerpVectors(COIN_EDGE, TEACHER_POS, smooth(clamp01((t - pl.back) / 0.6)));
      g.pos = p;
    }
    return g;
  }
  function glassesPerformance(P, k, t, dt) {
    const pl = k.gplan;
    applyGag(glassesState(t, pl));
    // the krathong floats out as normal; the camera visits it at the end
    floatPerformance(P, k, Math.min(t, FLOAT_ON_WATER + 0.2));
    // it heads straight out into the river, so it never stands between the
    // camera and her (or the boy) for the rest of the gag
    if (once(P, "out", t, FLOAT_ON_WATER + 0.1) && k.target) {
      k.target.set(0.6, 0, -3.6);
      k.retarget = clock + 40;
      k.vel.set(0.35, 0, -0.9);
    }
    if (once(P, "follow", t, pl.end - 0.6)) focusOn(k, 8);

    // ---- the glasses ----
    if (flyGlasses) {
      if (!P.gScale) {
        P.gScale = new THREE.Vector3();
        teacher.glassesMesh.getWorldScale(P.gScale);
      }
      flyGlasses.scale.copy(P.gScale);
      const fg = flyGlasses.position;
      let show = true;
      if (t < GL_SLIP) show = false;
      else if (t < GL_DECK_T) {
        if (!P.gFrom) {
          P.gFrom = new THREE.Vector3();
          teacher.glassesMesh.getWorldPosition(P.gFrom);
          P.gQ = new THREE.Quaternion();
          teacher.glassesMesh.getWorldQuaternion(P.gQ);
        }
        const u = (t - GL_SLIP) / (GL_DECK_T - GL_SLIP);
        fg.lerpVectors(P.gFrom, GL_DECK, u);
        fg.y = lerp(P.gFrom.y, GL_DECK.y, u * u) + Math.sin(u * Math.PI) * 0.12;
        flyGlasses.quaternion.copy(P.gQ);
        flyGlasses.rotateX(u * 2.2);
        flyGlasses.rotateZ(u * 1.4);
      } else if (t < GL_EDGE_T) {
        // skitter, skitter across the boards
        const u = (t - GL_DECK_T) / (GL_EDGE_T - GL_DECK_T);
        fg.lerpVectors(GL_DECK, GL_EDGE, u);
        fg.y += Math.abs(Math.sin(u * Math.PI * 2)) * 0.1;
        flyGlasses.rotation.set(-Math.PI / 2 + Math.sin(u * 12) * 0.3, u * 5, 0);
      } else if (t < GL_PLOP_T) {
        const u = (t - GL_EDGE_T) / (GL_PLOP_T - GL_EDGE_T);
        fg.lerpVectors(GL_EDGE, GL_SPOT, u);
        fg.y = lerp(GL_EDGE.y, GL_SPOT.y, u * u) + Math.sin(u * Math.PI) * 0.08;
        flyGlasses.rotation.set(-Math.PI / 2 + u * 2, 5 + u * 3, 0);
      } else if (t < pl.d1) show = false; // at the bottom of the river
      else if (t < pl.take + 0.4) {
        // held up high in his hand, toward the camera
        boy.hands[1].getWorldPosition(fg);
        fg.y += 0.06;
        flyGlasses.rotation.set(0, Math.atan2(camera.position.x - fg.x, camera.position.z - fg.z), 0);
      } else if (t < pl.on + 0.4) {
        teacher.hands[0].getWorldPosition(fg);
        flyGlasses.rotation.set(0, Math.atan2(camera.position.x - fg.x, camera.position.z - fg.z), 0);
      } else show = false; // back on her nose
      flyGlasses.visible = show;
    }

    // ---- him ----
    const d = diver;
    const g = boy.group.position;
    const toCam = Math.atan2(camera.position.x - g.x, camera.position.z - g.z);
    const toHer = yawTo(g, teacher.group.position);
    let yaw = toCam;
    let y = BOY_Y + Math.sin(boy.t * 2.4) * 0.03;
    let want = { l: KARM.tread, r: KARM.tread };
    d.swim = 0;
    d.wob = 0;
    d.face = null;
    boyCoin.visible = false;
    if (t < pl.go) {
      g.copy(pl.S);
      g.y = BOY_Y;
    } else if (t < pl.go + pl.a) {
      g.lerpVectors(pl.S, GL_DIVE, smooth((t - pl.go) / pl.a));
      yaw = yawTo(pl.S, GL_DIVE);
      d.swim = 1;
      want = { l: "paddle", r: "paddle" };
    } else if (t < pl.d1) {
      g.copy(GL_DIVE);
      yaw = yawTo(GL_DIVE, GL_SPOT);
      if (t >= pl.d0) {
        y = lerp(BOY_Y, -2.4, smooth(clamp01((t - pl.d0) / 0.35)));
        want = { l: KARM.up, r: KARM.up };
      }
    } else if (t < pl.call) {
      // up, with them held high... and what is she doing?
      g.copy(GL_DIVE);
      y = lerp(-2.4, BOY_Y, smooth(clamp01((t - pl.d1) / 0.3))) + Math.sin(boy.t * 2.4) * 0.03;
      want = { l: KARM.tread, r: KARM.up };
      if (t < pl.d1 + 0.9) d.face = "open";
      else {
        yaw = toHer;
        d.face = "huh";
      }
    } else if (t < pl.call + 0.7) {
      g.lerpVectors(GL_DIVE, COIN_RETURN, smooth((t - pl.call) / 0.7));
      yaw = yawTo(GL_DIVE, COIN_RETURN);
      d.swim = 1;
      want = { l: "paddle", r: KARM.up };
    } else {
      g.copy(COIN_RETURN);
      // turned half to her, half to the camera
      const yh = yawTo(COIN_RETURN, COIN_EDGE);
      yaw = yh + wrapAngle(toCam - yh) * 0.5;
      if (t < pl.take + 0.4) {
        want = { l: t < pl.step ? KARM.wave : KARM.tread, r: KARM.up }; // "kru! over here!"
        d.face = "open";
      } else if (t < pl.thanks) {
        d.face = "open";
      } else {
        want = { l: KARM.tread, r: KARM.wave };
        d.face = "open";
      }
    }
    g.y = y;
    d.want = want;
    turnBoy(yaw, dt);
    if (y > BOY_Y - 0.2) boyRipples(dt, d.swim > 0.5 ? 0.3 : 1.2);

    // ---- effects and sounds, each once ----
    if (once(P, "slip", t, GL_SLIP)) sound.pop(0.08);
    if (once(P, "tick", t, GL_DECK_T)) {
      sound.ting(0.05);
      burst(GL_DECK, 8, { speed: 0.6, colors: [0xffe9d0, 0xffffff], life: 0.35 });
    }
    if (once(P, "tick2", t, GL_DECK_T + 0.15)) sound.ting(0.035);
    if (once(P, "plop", t, GL_PLOP_T)) {
      burst(GL_SPOT, 22, { speed: 1.1, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
      ripple(GL_SPOT.x, GL_SPOT.z, 1.0, 0xcfe8ff);
      ripple(GL_SPOT.x, GL_SPOT.z, 1.8, 0xcfe8ff);
      sound.plop();
    }
    if (once(P, "gasp", t, GL_EDGE_T + 0.1)) sound.pop(0.15);
    if (once(P, "dive", t, pl.d0)) {
      burst(glassesTmp.set(GL_DIVE.x, 0.05, GL_DIVE.z), 40, { speed: 1.8, colors: [0xbfe6ff, 0xffffff], life: 0.6, up: 1.2 });
      ripple(GL_DIVE.x, GL_DIVE.z, 1.4, 0xcfe8ff);
      sound.plop();
    }
    if (t > pl.d0 + 0.2 && t < pl.d1) {
      P.bub = (P.bub ?? 0) - dt;
      if (P.bub <= 0) {
        P.bub = rand(0.12, 0.25);
        const at = glassesTmp.set(GL_DIVE.x + rand(-0.25, 0.25), 0.05, GL_DIVE.z + rand(-0.25, 0.25));
        burst(at, 4, { speed: 0.35, colors: [0xcfeeff, 0xffffff], life: 0.4, up: 0.4 });
        ripple(at.x, at.z, 0.5, 0xcfe8ff);
        sound.blub();
      }
    }
    if (once(P, "up", t, pl.d1)) {
      burst(glassesTmp.set(GL_DIVE.x, 0.05, GL_DIVE.z), 40, { speed: 1.8, colors: [0xbfe6ff, 0xffffff], life: 0.6, up: 1.2 });
      ripple(GL_DIVE.x, GL_DIVE.z, 1.6, 0xcfe8ff);
      sound.splash();
    }
    if (once(P, "found", t, pl.d1 + 0.35)) {
      boy.hands[1].getWorldPosition(glassesTmp);
      burst(glassesTmp, 24, { speed: 1.0, colors: [0xffe9d0, 0xfff6c8, 0xffffff], life: 0.6 });
      sound.ting(0.08);
    }
    if (once(P, "call", t, pl.call + 0.7)) sound.pop(0.12);
    if (once(P, "call2", t, pl.call + 0.95)) sound.pop(0.12);
    if (once(P, "take", t, pl.take + 0.4)) {
      teacher.hands[0].getWorldPosition(glassesTmp);
      burst(glassesTmp, 16, { speed: 0.8, colors: [0xfff3b0, 0xffffff], life: 0.5 });
    }
    if (once(P, "on", t, pl.on + 0.4)) {
      teacher.head.getWorldPosition(glassesTmp2);
      glassesTmp2.y += 0.15;
      burst(glassesTmp2, 50, { speed: 1.4, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.9 });
      sound.chime();
    }
  }
  function glassesShot(pos, look, P) {
    const pl = P.k.gplan;
    const t = P.t;
    const portrait = camera.aspect < 1 ? 1.6 : 0;
    if (t < 2.3) {
      // as an ordinary float
      look.set(-2.6, 1.0, 1.6);
      pos.set(-1.3, 2.0, camera.aspect < 1 ? 8.8 : 7.2);
    } else if (t < 4.7) {
      // set and still before they slip: side on, her and the pier edge on
      // the left, the water where they go in on the right
      look.set(-2.6, 1.0, 2.05);
      pos.set(-2.6 + Math.sin(0.15) * 4.6, 1.6, 2.05 + Math.cos(0.15) * 4.6 + portrait);
    } else if (t < pl.d0 - 0.4) closeOnHer(pos, look);
    else if (t < pl.call + 0.6) {
      // both: her waiing the post, him coming up with her glasses
      const mx = (TEACHER_POS.x + GL_DIVE.x) / 2 - 0.25;
      const mz = 2.3;
      const dd = 4.6 * (camera.aspect < 1 ? 1.55 : 1);
      look.set(mx, 0.95, mz);
      pos.set(mx + Math.sin(0.05) * dd, 2.15, mz + Math.cos(0.05) * dd);
    } else if (t < pl.on - 0.2) {
      // the hand-over: side on, her at the pier's edge and him below her
      const dd = 4.2 + (camera.aspect < 1 ? 1.8 : 0);
      look.set((COIN_EDGE.x + COIN_RETURN.x) / 2, 0.8, 1.95);
      pos.set(look.x + Math.sin(0.15) * dd, 1.6, 1.95 + Math.cos(0.15) * dd);
    } else closeOnHer(pos, look);
  }

  // a closer version of closeOnHer, for little face gags
  function nearHer(pos, look, dd = 2.9) {
    const g = teacher.group.position;
    look.set(g.x, 1.4, g.z);
    pos.set(g.x + Math.sin(0.55) * dd, 1.75, g.z + Math.cos(0.55) * dd + (camera.aspect < 1 ? 1.4 : 0));
  }
  function defaultFloatShot(pos, look) {
    look.set(-2.6, 1.0, 1.6);
    pos.set(-1.3, 2.0, camera.aspect < 1 ? 8.8 : 7.2);
  }
  // her krathong heads out into the river once it's on the water (so it's
  // never between the camera and a gag)
  function sendOut(P, k, t) {
    if (once(P, "out", t, FLOAT_ON_WATER + 0.1) && k.target) {
      k.target.set(0.6, 0, -3.6);
      k.retarget = clock + 40;
      k.vel.set(0.35, 0, -0.9);
    }
  }
  const gagTmp = new THREE.Vector3();
  const gagTmp2 = new THREE.Vector3();
  const gagQ = new THREE.Quaternion();
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  // little pink hearts rising round her head (shy and happy moments)
  const heartSprites = [0, 1, 2].map(() => {
    const m = new THREE.Sprite(kissHeart.material.clone());
    m.visible = false;
    m.userData.ownFade = true;
    teacher.group.add(m);
    return m;
  });
  function showHearts(t, from, to) {
    heartSprites.forEach((m, i) => {
      const u = (t - from - i * 0.45) / 1.4;
      const on = t > from && t < to && u > 0 && u < 1;
      m.visible = on;
      if (!on) return;
      const side = i - 1;
      m.position.set(side * 0.32 + Math.sin(u * 8 + i) * 0.04, teacher.topY - 0.3 + u * 0.55, 0.1);
      m.scale.setScalar(0.12 + 0.08 * Math.sin(u * Math.PI));
      m.material.opacity = Math.sin(u * Math.PI);
    });
  }
  function hideHearts() {
    for (const m of heartSprites) m.visible = false;
  }

  // ----- the firefly gag (a gentle float gag): while she makes her wish
  // with her eyes shut, a firefly settles on the tip of her nose. She opens
  // her eyes and goes cross-eyed at it... ah... ah... CHOO! The firefly is
  // blown away, her hair puffs up and her glasses go crooked. She shakes it
  // off, straightens up with a shy smile and floats the krathong. -----
  ARM.low = { x: -0.38, o: -0.32, e: -0.85 }; // krathong held low, clear of her face
  const FF_SHIFT = 5.0; // the ordinary float resumes this much later
  const FF_LAND = 1.9;
  const FF_CHOO = 4.3;
  const FF_HOLD = 2.3; // the float is paused here (krathong in her hands)
  const FIREFLY_KEYS = [
    ...FLOAT_KEYS.filter(([at]) => at < FF_HOLD),
    [FF_HOLD, pose("low", "low", { hx: 0.08, yaw: FACE_CAM })], // what's on my nose?
    [3.5, pose("low", "low", { hx: -0.34, lean: -0.05, yaw: FACE_CAM })], // ah... ah...
    [FF_CHOO, pose("low", "low", { hx: 0.32, lean: 0.1, dip: 0.04, yaw: FACE_CAM })], // CHOO!
    [4.8, pose("low", "low", { hx: 0.0, hz: 0.1, yaw: FACE_CAM })],
    [5.3, pose("low", "low", { hz: 0.24, yaw: FACE_CAM })], // shake, shake
    [5.55, pose("low", "low", { hz: -0.24, yaw: FACE_CAM })],
    [5.8, pose("low", "low", { hz: 0.24, yaw: FACE_CAM })],
    [6.05, pose("low", "low", { hz: -0.24, yaw: FACE_CAM })],
    [6.3, pose("low", "low", { hx: 0.18, hz: 0.12, yaw: FACE_CAM })], // a sheepish smile
    ...FLOAT_KEYS.filter(([at]) => at >= FF_HOLD).map(([at, p]) => [at + FF_SHIFT, p]),
  ];
  const firefly = (() => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0x2a2416 }));
    body.scale.set(1, 1, 1.6);
    g.add(body);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xd8ff6a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(0.14);
    g.add(glow);
    g.userData.glow = glow;
    g.visible = false;
    scene.add(g);
    return g;
  })();
  function fireflyState(t) {
    const g = gagBase();
    if (t < FF_HOLD || t > FF_HOLD + FF_SHIFT) return g;
    if (t < 3.5) g.face = "cross";
    else if (t < FF_CHOO) g.face = Math.floor(t * 6) % 2 ? "cross" : "wince";
    else if (t < FF_CHOO + 0.35) g.face = "wince";
    else if (t < 5.2) g.face = "daze";
    else if (t < 6.3) g.face = "blink";
    else g.face = "shy";
    if (t >= FF_CHOO) {
      g.frizz = 1 - smooth(clamp01((t - 6.1) / 1.0));
      g.askew = 1 - smooth(clamp01((t - 6.2) / 0.5));
      if (t < FF_CHOO + 0.4) g.shake = Math.sin(t * 70) * 0.008;
    }
    return g;
  }
  function fireflyPerformance(P, k, t, dt) {
    applyGag(fireflyState(t));
    floatPerformance(P, k, t < FF_HOLD ? t : t < FF_HOLD + FF_SHIFT ? FF_HOLD : t - FF_SHIFT);
    // her nose, in the world
    const nose = gagTmp.set(0, C0 - 0.05, 0.2);
    teacher.head.localToWorld(nose);
    const f = firefly.position;
    firefly.visible = t > 0.4 && t < FF_CHOO + 1.4;
    if (t < FF_LAND) {
      // drifts in, looping lazily
      const u = smooth(clamp01((t - 0.4) / (FF_LAND - 0.4)));
      gagTmp2.set(nose.x + 1.1, nose.y + 0.6, nose.z + 0.8);
      f.lerpVectors(gagTmp2, nose, u);
      f.x += Math.sin(t * 5) * 0.15 * (1 - u);
      f.y += Math.cos(t * 3.7) * 0.1 * (1 - u);
    } else if (t < FF_CHOO) {
      f.copy(nose);
    } else {
      // blown away, tumbling
      const u = t - FF_CHOO;
      fwd.set(0, 0, 1).applyQuaternion(teacher.group.quaternion);
      f.copy(nose).addScaledVector(fwd, u * 2.2);
      f.y += u * 0.6 + Math.sin(u * 14) * 0.08;
      f.x += Math.cos(u * 14) * 0.08;
    }
    const glow = firefly.userData.glow;
    glow.material.opacity = (0.65 + 0.35 * Math.sin(t * 6)) * (t > FF_CHOO + 1.0 ? 1 - (t - FF_CHOO - 1.0) / 0.4 : 1);
    glow.scale.setScalar(t > FF_LAND && t < FF_CHOO ? 0.09 : 0.14);
    if (once(P, "land", t, FF_LAND)) sound.ting(0.03);
    for (const at of [3.6, 3.95]) if (once(P, "ah" + at, t, at)) sound.pop(0.05);
    if (once(P, "choo", t, FF_CHOO)) {
      sound.sneeze();
      burst(nose, 30, { speed: 1.4, colors: [0xffffff, 0xdff4ff], life: 0.5 });
      puff(nose, { size: 0.08, grow: 3, life: 0.6, rise: 0.1, spread: 0.1, a: 0.5, color: 0xffffff });
    }
    if (once(P, "pretty", t, 6.3)) {
      teacher.head.getWorldPosition(gagTmp2);
      gagTmp2.y += 0.18;
      burst(gagTmp2, 40, { speed: 1.3, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.8 });
    }
  }
  function fireflyShot(pos, look, P) {
    const t = P.t;
    if (t < 0.6 || t > FF_HOLD + FF_SHIFT + 0.3) defaultFloatShot(pos, look);
    else nearHer(pos, look, 3.0);
  }

  // ----- the fish gag (a gentle float gag): as she kneels and sets the
  // krathong on the water, a little fish leaps up and kisses her cheek.
  // She freezes, goes pink, hands to her cheeks, stands up all shy and
  // wiggly with hearts round her head, then wais the river. -----
  // (while she wais the river with her eyes shut, so her krathong is well
  // out of the way by then)
  const FISH_SHIFT = 4.0;
  const FISH_AT = 5.9; // the float pauses here, at the end of her wai
  const FISH_UP = 5.9; // out of the water
  const FISH_KISS = 6.35;
  const FISH_KISS_END = 6.8;
  const FISH_BACK = 7.35; // back in
  const FISH_KEYS = [
    ...FLOAT_KEYS.filter(([at]) => at < FISH_AT),
    [6.5, pose("cheeks", "cheeks", { dip: 0.12, lean: 0.0, hx: 0.05, yaw: FACE_WATER })], // !!!
    [7.4, pose("cheeks", "cheeks", { hx: 0.16, hz: 0.16, yaw: FACE_CAM })], // all shy
    [7.9, pose("cheeks", "cheeks", { hx: 0.16, hz: -0.16, yaw: FACE_CAM - 0.15 })],
    [8.4, pose("cheeks", "cheeks", { hx: 0.18, hz: 0.16, yaw: FACE_CAM })],
    [8.9, pose("cheeks", "cheeks", { hx: 0.2, hz: -0.1, yaw: FACE_CAM - 0.1 })],
    [9.4, pose("heart", "heart", { hz: 0.12, yaw: FACE_CAM })],
    ...FLOAT_KEYS.filter(([at]) => at >= FISH_AT).map(([at, p]) => [at + FISH_SHIFT, p]),
  ];
  const fish = (() => {
    const { parts, add } = partList();
    add(new THREE.SphereGeometry(0.05, 12, 8), "#ff8a3d", (d) => d.scale.set(1.7, 1, 0.75));
    add(new THREE.SphereGeometry(0.042, 10, 6), "#ffe0c0", (d) => { d.position.set(0.01, -0.016, 0); d.scale.set(1.5, 0.6, 0.62); });
    add(new THREE.ConeGeometry(0.045, 0.07, 3), "#ff6a2a", (d) => { d.position.set(-0.1, 0, 0); d.rotation.z = Math.PI / 2; d.scale.set(1, 1, 0.3); });
    add(new THREE.ConeGeometry(0.02, 0.04, 3), "#ff6a2a", (d) => { d.position.set(0, 0.05, 0); d.scale.set(1, 1, 0.3); });
    for (const z of [-0.035, 0.035]) {
      add(new THREE.SphereGeometry(0.012, 8, 6), "#ffffff", (d) => d.position.set(0.05, 0.012, z));
      add(new THREE.SphereGeometry(0.007, 6, 4), "#1a1010", (d) => d.position.set(0.056, 0.013, z * 1.15));
    }
    add(new THREE.SphereGeometry(0.009, 6, 4), "#ff5a8a", (d) => { d.position.set(0.084, -0.008, 0); d.scale.set(0.6, 1, 1.4); }); // puckered lips
    const m = new THREE.Mesh(mergeParts(parts), propMat);
    m.scale.setScalar(1.3);
    m.visible = false;
    scene.add(m);
    return m;
  })();
  const FISH_FROM = new THREE.Vector3(-2.1, -0.05, 1.85);
  const FISH_TO = new THREE.Vector3(-1.8, -0.05, 2.2);
  const fishPrev = new THREE.Vector3();
  function fishState(t) {
    const g = gagBase();
    if (t < FISH_UP || t > FISH_AT + FISH_SHIFT) return g;
    if (t < FISH_KISS + 0.15) g.face = null; // eyes still shut in her wai
    else if (t < 7.3) g.face = "huh";
    else if (t < 9.4) g.face = "shy";
    else g.face = "blink";
    if (t > FISH_KISS + 0.15 && t < 7.1) g.exclaim = Math.sin(clamp01((t - FISH_KISS - 0.15) / 0.8) * Math.PI);
    if (t > 7.4 && t < 9.4) g.bob = Math.abs(Math.sin((t - 7.4) * 6)) * 0.012;
    return g;
  }
  function fishPerformance(P, k, t, dt) {
    applyGag(fishState(t));
    floatPerformance(P, k, t < FISH_AT ? t : t < FISH_AT + FISH_SHIFT ? FISH_AT : t - FISH_SHIFT);
    sendOut(P, k, t);
    showHearts(t, 7.2, 9.8);
    // her cheek (on the water side of her face)
    const cheek = gagTmp.set(0.07, C0 - 0.04, 0.17);
    teacher.head.localToWorld(cheek);
    fishPrev.copy(fish.position);
    fish.visible = t > FISH_UP && t < FISH_BACK;
    if (fish.visible) {
      if (t < FISH_KISS) {
        if (!P.fishAt) P.fishAt = cheek.clone();
        const u = (t - FISH_UP) / (FISH_KISS - FISH_UP);
        fish.position.lerpVectors(FISH_FROM, P.fishAt, smooth(u));
        fish.position.y += Math.sin(u * Math.PI) * 0.25;
      } else if (t < FISH_KISS_END) {
        fish.position.copy(cheek); // mwah
      } else {
        const u = (t - FISH_KISS_END) / (FISH_BACK - FISH_KISS_END);
        fish.position.lerpVectors(cheek, FISH_TO, u);
        fish.position.y += Math.sin(u * Math.PI) * 0.2;
      }
      // nose first along its path (facing her cheek while it kisses)
      if (t >= FISH_KISS && t < FISH_KISS_END) gagTmp2.subVectors(cheek, FISH_FROM).setY(0);
      else gagTmp2.subVectors(fish.position, fishPrev);
      if (gagTmp2.lengthSq() > 1e-8) fish.quaternion.setFromUnitVectors(X_AXIS, gagTmp2.normalize());
      fish.rotateX(Math.sin(t * 30) * 0.2); // wiggle
    }
    if (once(P, "leap", t, FISH_UP)) {
      burst(gagTmp2.copy(FISH_FROM).setY(0.05), 24, { speed: 1.3, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
      ripple(FISH_FROM.x, FISH_FROM.z, 1.0, 0xcfe8ff);
      sound.blub();
    }
    if (once(P, "kiss", t, FISH_KISS)) {
      sound.kiss();
      burst(cheek, 18, { speed: 0.8, colors: [0xff7fb0, 0xffc2dc, 0xffffff], life: 0.6 });
    }
    if (once(P, "back", t, FISH_BACK)) {
      burst(gagTmp2.copy(FISH_TO).setY(0.05), 22, { speed: 1.1, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
      ripple(FISH_TO.x, FISH_TO.z, 1.2, 0xcfe8ff);
      sound.plop();
    }
    if (once(P, "gasp", t, FISH_KISS + 0.1)) sound.pop(0.12);
  }
  function fishShot(pos, look, P) {
    const t = P.t;
    if (t < 2.3 || t > FISH_AT + FISH_SHIFT + 0.4) return defaultFloatShot(pos, look);
    if (t < 7.4) {
      // from the river side, so her face shows as she leans to the water
      const g = TEACHER_POS;
      const dd = 3.4 + (camera.aspect < 1 ? 1.3 : 0);
      look.set(g.x + 0.35, 1.2, g.z);
      pos.set(g.x + Math.sin(1.05) * dd, 1.6, g.z + Math.cos(1.05) * dd);
    } else nearHer(pos, look, 3.0);
  }

  // ----- the frog gag: the little frog who lives on a lily pad by the pier
  // ribbits, hops onto the deck and up onto her bun. She feels it, it
  // ribbits on her head, she shrieks and spins round and round; it hops
  // into her hands, and... it's cute! She cuddles it, gives it a kiss,
  // kneels at the edge and lets it hop back to its lily pad. -----
  // (toward the bank, clear of where the glasses and the boy go in)
  const FROG_PAD = new THREE.Vector3(-1.95, 0.02, 2.95);
  const FROG_EDGE = new THREE.Vector3(-2.45, PIER.top, 2.5);
  const frogPad = (() => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 20, 1, false, 0.35, TAU - 0.7), new THREE.MeshLambertMaterial({ color: 0x4f9e52, emissive: 0x0c1a0c }));
    m.position.copy(FROG_PAD);
    scene.add(m);
    return m;
  })();
  const frog = (() => {
    const g = new THREE.Group();
    const { parts, add } = partList();
    add(new THREE.SphereGeometry(0.06, 12, 8), "#6cc24a", (d) => { d.position.y = 0.045; d.scale.set(1, 0.72, 1.15); });
    add(new THREE.SphereGeometry(0.05, 10, 6), "#d8f0a0", (d) => { d.position.set(0, 0.032, 0.02); d.scale.set(0.9, 0.5, 1); });
    for (const x of [-0.032, 0.032]) {
      add(new THREE.SphereGeometry(0.022, 10, 6), "#6cc24a", (d) => d.position.set(x, 0.088, 0.035));
      add(new THREE.SphereGeometry(0.017, 10, 6), "#ffffff", (d) => d.position.set(x, 0.092, 0.047));
      add(new THREE.SphereGeometry(0.009, 8, 4), "#1a1010", (d) => d.position.set(x, 0.094, 0.06));
      add(new THREE.SphereGeometry(0.03, 8, 6), "#5aae3a", (d) => { d.position.set(x * 1.6, 0.025, -0.035); d.scale.set(0.7, 0.6, 1.3); }); // back legs
      add(new THREE.SphereGeometry(0.014, 8, 4), "#5aae3a", (d) => { d.position.set(x * 1.2, 0.01, 0.06); d.scale.set(1, 0.5, 1.4); }); // front feet
    }
    add(new THREE.SphereGeometry(0.01, 6, 4), "#ff8fb0", (d) => d.position.set(-0.042, 0.06, 0.055)); // cheeks
    add(new THREE.SphereGeometry(0.01, 6, 4), "#ff8fb0", (d) => d.position.set(0.042, 0.06, 0.055));
    g.add(new THREE.Mesh(mergeParts(parts), propMat));
    const throat = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 6), new THREE.MeshToonMaterial({ color: 0xf4ffc8, emissive: 0x1a1a10 }));
    throat.position.set(0, 0.03, 0.055);
    throat.scale.setScalar(0.01);
    g.add(throat);
    g.userData.throat = throat;
    g.position.copy(FROG_PAD);
    g.rotation.y = -1.9; // facing the pier
    g.scale.setScalar(1.5);
    scene.add(g);
    return g;
  })();
  let frogCroak = rand(6, 14);
  let frogCroakT = -1;
  function croak(t0) {
    // the throat puffs out twice
    const u = t0;
    const s = u > 0 && u < 0.32 ? Math.sin((u % 0.16) / 0.16 * Math.PI) : 0;
    frog.userData.throat.scale.setScalar(0.01 + s * 1.1);
  }
  // free time: sits on its pad and ribbits now and then
  function frogIdle(dt) {
    if (performing?.k.frog) return;
    frogCroak -= dt;
    if (frogCroak <= 0) {
      frogCroak = rand(9, 20);
      frogCroakT = 0;
      sound.ribbit(Math.min(0.08, 0.6 / camera.position.distanceTo(frog.position)));
    }
    if (frogCroakT >= 0) {
      frogCroakT += dt;
      croak(frogCroakT);
      if (frogCroakT > 0.4) frogCroakT = -1;
    }
    frog.position.y = FROG_PAD.y + Math.sin(clock * 1.4) * 0.008;
  }
  Object.assign(ARM, {
    cradle: { x: -0.72, o: -0.4, e: -1.25 }, // holding it in her cupped hands
  });
  const FROG_ON = 3.3; // on her bun
  const FROG_EEK = 4.1;
  const FROG_SPIN_END = 5.6;
  const FROG_HANDS = 6.4; // in her hands
  const FROG_LET = 10.9; // hops off, home
  const FROG_KEYS = [
    [0, IDLE],
    [3.4, pose("clasp", "clasp", { hx: -0.2, hz: 0.1, yaw: FACE_CAM })], // hm? something up there?
    [FROG_EEK, pose("flail", "flail", { hx: -0.1, yaw: FACE_CAM })], // EEEK
    [FROG_SPIN_END, pose("rest", "rest", { hz: 0.18, yaw: FACE_CAM })], // dizzy
    [6.0, pose("cradle", "cradle", { hx: 0.25, yaw: FACE_CAM })], // into her hands
    [7.2, pose("heart", "heart", { hx: 0.1, hz: 0.14, yaw: FACE_CAM })], // cuddle
    [7.8, pose("heart", "heart", { hx: 0.1, hz: -0.14, yaw: FACE_CAM })],
    [8.5, pose("brace", "brace", { hx: 0.05, yaw: FACE_CAM })], // a kiss
    [9.4, pose("cradle", "cradle", { yaw: FACE_WATER })], // to the edge
    [10.3, pose("reach", "reach", { dip: 0.16, lean: 0.2, hx: 0.4, yaw: FACE_WATER })],
    [11.2, pose("clasp", "wave", { hz: -0.1, yaw: FACE_WATER - 0.3 })], // bye bye
    [12.4, pose("clasp", "clasp", { yaw: TEACHER_YAW })],
    [13.0, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [14.0, null],
  ];
  function frogState(t) {
    const g = gagBase();
    if (t >= 3.4 && t < FROG_EEK) {
      g.face = "huh";
      g.question = Math.sin(clamp01((t - 3.4) / 0.7) * Math.PI);
    } else if (t >= FROG_EEK && t < FROG_SPIN_END) {
      g.face = Math.floor(t * 5) % 2 ? "wince" : "cry2";
      g.exclaim = t < FROG_EEK + 0.8 ? Math.sin(clamp01((t - FROG_EEK) / 0.8) * Math.PI) : 0;
      g.flail = 0.7;
      // round and round (two whole turns), hopping
      g.spin = TAU * 2 * smooth(clamp01((t - FROG_EEK - 0.1) / 1.4));
      g.bob = Math.abs(Math.sin((t - FROG_EEK) * 9)) * 0.05;
      g.hairBlow = 1;
    } else if (t >= FROG_SPIN_END && t < 6.4) g.face = "daze";
    else if (t >= 6.4 && t < 7.0) g.face = "huh";
    else if (t >= 7.0 && t < 8.5) g.face = t < 7.2 ? "open" : "shy";
    else if (t >= 8.5 && t < 9.3) g.face = "kiss";
    else if (t >= 9.3 && t < 10.3) g.face = "shy";
    else if (t >= 11.2 && t < 12.4) g.face = "open";
    if (t >= 9.4 && t < 12.9) {
      const p = wetPos;
      if (t < 10.2) p.lerpVectors(TEACHER_POS, COIN_EDGE, smooth((t - 9.4) / 0.8));
      else if (t < 12.4) p.copy(COIN_EDGE);
      else p.lerpVectors(COIN_EDGE, TEACHER_POS, smooth(clamp01((t - 12.4) / 0.5)));
      g.pos = p;
    }
    return g;
  }
  const frogHop = (P, key, from, to, t, t0, t1, h = 0.35) => {
    if (!P[key]) P[key] = from.clone();
    const u = clamp01((t - t0) / (t1 - t0));
    frog.position.lerpVectors(P[key], to, u);
    frog.position.y += Math.sin(u * Math.PI) * h;
    return u;
  };
  function frogPerformance(P, k, t, dt) {
    applyGag(frogState(t));
    showHearts(t, 7.1, 9.6);
    // the frog sits where her name tag is
    if (teacher.nameTag) teacher.nameTag.visible = !(t > 2.9 && t < 6.2);
    const head = gagTmp.set(0.0, C0 + 0.25, -0.05);
    teacher.head.localToWorld(head);
    const hands = palms(gagTmp2, 0.06);
    let yaw = null;
    if (t < 2.0) {
      frog.position.copy(FROG_PAD);
    } else if (t < 2.5) {
      frogHop(P, "h1", FROG_PAD, FROG_EDGE, t, 2.0, 2.5);
      yaw = yawTo(FROG_PAD, FROG_EDGE);
    } else if (t < 2.8) {
      frog.position.copy(FROG_EDGE);
    } else if (t < FROG_ON) {
      frogHop(P, "h2", FROG_EDGE, head, t, 2.8, FROG_ON, 0.6);
      yaw = yawTo(FROG_EDGE, TEACHER_POS);
    } else if (t < 6.0) {
      // riding on her bun, hanging on through the spin
      frog.position.copy(head);
      teacher.head.getWorldQuaternion(gagQ);
      frog.quaternion.copy(gagQ);
    } else if (t < FROG_HANDS) {
      frogHop(P, "h3", head, hands, t, 6.0, FROG_HANDS, 0.25);
      yaw = teacher.group.rotation.y;
    } else if (t < FROG_LET) {
      // in her hands, facing her (lifted to her lips for the kiss)
      frog.position.copy(hands);
      frog.position.y += 0.02;
      yaw = teacher.group.rotation.y + Math.PI;
    } else if (t < FROG_LET + 0.6) {
      frogHop(P, "h4", hands, FROG_PAD, t, FROG_LET, FROG_LET + 0.6, 0.4);
      yaw = yawTo(COIN_EDGE, FROG_PAD);
    } else {
      frog.position.copy(FROG_PAD);
      yaw = -1.9;
    }
    if (yaw != null) frog.rotation.set(0, yaw, 0);
    // croaks: on the pad, on her head, in her hands, back home
    for (const at of [0.8, 1.5, 3.9, 6.8, FROG_LET + 0.9]) {
      if (once(P, "rib" + at, t, at)) {
        sound.ribbit(0.1);
        P.croakAt = at;
      }
    }
    croak(P.croakAt != null ? t - P.croakAt : -1);
    if (once(P, "land1", t, 2.5)) sound.pop(0.05);
    if (once(P, "land2", t, FROG_ON)) sound.pop(0.06);
    if (once(P, "eek", t, FROG_EEK)) sound.eek();
    if (once(P, "eek2", t, FROG_EEK + 0.9)) sound.eek(0.07);
    if (once(P, "cute", t, 7.0)) {
      teacher.head.getWorldPosition(gagTmp);
      gagTmp.y += 0.2;
      burst(gagTmp, 30, { speed: 1.1, colors: [0xffb3e6, 0xfff3b0, 0xffffff], life: 0.7 });
    }
    if (once(P, "kiss", t, 8.8)) {
      sound.kiss();
      burst(frog.position, 16, { speed: 0.8, colors: [0xff7fb0, 0xffc2dc, 0xffffff], life: 0.6 });
    }
    if (once(P, "home", t, FROG_LET + 0.6)) {
      ripple(FROG_PAD.x, FROG_PAD.z, 1.0, 0xcfe8ff);
      burst(gagTmp.copy(FROG_PAD).setY(0.05), 14, { speed: 0.8, colors: [0xbfe6ff, 0xffffff], life: 0.4 });
      sound.plop();
    }
  }
  function endFrog() {
    frog.position.copy(FROG_PAD);
    frog.rotation.set(0, -1.9, 0);
    frog.userData.throat.scale.setScalar(0.01);
    if (teacher.nameTag) teacher.nameTag.visible = true;
    hideHearts();
  }
  function frogShot(pos, look, P) {
    const t = P.t;
    if (t < FROG_ON) {
      // the pad, the deck's edge and her, set and still
      look.set(-2.65, 0.8, 2.55);
      const dd = 4.3 + (camera.aspect < 1 ? 1.6 : 0);
      pos.set(-2.65 + Math.sin(0.25) * dd, 1.55, 2.55 + Math.cos(0.25) * dd);
    } else nearHer(pos, look, 3.5);
  }

  // ----- the firecracker gag: a cheeky kid runs up on the bank, lights a
  // firecracker and lobs it onto the pier. It skitters round her feet going
  // bang-bang-bang and she hop-dances out of its way, shrieking. Then she
  // pants, turns on him and pouts (cross mark, stomping); he wais sorry and
  // runs off, and she huffs and is herself again. -----
  const kid = buildPerson({ skin: "#e3b08a", hair: "#1a1210", top: "#ffd54a", pants: "#3a5a8a", headScale: 1.5, openEyes: true }, 1.15, 0);
  const KID_FROM = new THREE.Vector3(-7.8, 0.35, 4.7);
  const KID_POS = new THREE.Vector3(-5.0, 0.35, 4.3);
  const KID_PARK = new THREE.Vector3(-12, -5, 8); // out of sight between gags
  kid.group.position.copy(KID_PARK);
  const kidSt = { run: 0, want: null, face: null, cur: { l: { x: -0.1, o: 0.1, e: -0.2, w: 0 }, r: { x: -0.1, o: 0.1, e: -0.2, w: 0 } }, crouch: 0 };
  function poseKid(p, dt) {
    const s = p.height / 1.8;
    const t = p.t;
    const d = kidSt;
    const k = 1 - Math.exp(-dt * 9);
    const want = d.want || { l: KARM.limp, r: KARM.limp };
    ["l", "r"].forEach((sd, i) => {
      const a = d.cur[sd];
      let b = want[sd];
      if (b === "run") {
        armWant.x = Math.sin(t * 14 + i * Math.PI) * 0.9;
        armWant.o = 0.15;
        armWant.e = -1.1;
        armWant.w = 0;
        b = armWant;
      }
      a.x += (b.x - a.x) * k;
      a.o += (b.o - a.o) * k;
      a.e += (b.e - a.e) * k;
      a.w += ((b.w ?? 0) - a.w) * k;
      const side = i ? 1 : -1;
      p.arms[i].rotation.set(a.x, 0, side * a.o);
      p.elbows[i].rotation.set(a.e, 0, side * a.w * Math.sin(t * 6) * 0.4);
    });
    p.inner.scale.setScalar(s);
    p.inner.position.set(0, -d.crouch * 0.12 * s + (d.run ? Math.abs(Math.sin(t * 14)) * 0.04 : 0), 0);
    p.inner.rotation.set(d.crouch * 0.35 + d.run * 0.12, 0, 0);
    const sw = Math.sin(t * 14) * 0.8 * d.run;
    p.legs[0].rotation.x = sw + d.crouch * 1.2;
    p.legs[1].rotation.x = -sw + d.crouch * 1.2;
    p.head.rotation.set(Math.sin(t * 0.6) * 0.05, Math.sin(t * 0.4) * 0.1, Math.sin(t * 0.9) * 0.05);
    p.faceOverride = d.face;
  }
  const cracker = (() => {
    const g = new THREE.Group();
    const { parts, add } = partList();
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.13, 10), "#e8302a", (d) => d.rotation.z = Math.PI / 2);
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 10), "#ffd54a", (d) => { d.rotation.z = Math.PI / 2; d.position.x = 0.03; });
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 5), "#3a2a20", (d) => { d.position.set(-0.08, 0.01, 0); d.rotation.z = Math.PI / 2 + 0.4; });
    g.add(new THREE.Mesh(mergeParts(parts), propMat));
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xffb04a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    spark.position.set(-0.1, 0.025, 0);
    spark.scale.setScalar(0.12);
    g.add(spark);
    g.userData.spark = spark;
    g.scale.setScalar(1.4);
    g.visible = false;
    scene.add(g);
    return g;
  })();
  const CR_LIT = 1.5;
  const CR_THROW = 2.3;
  const CR_LAND_T = 3.0;
  const CR_END = 6.3; // spent
  const CR_LAND = new THREE.Vector3(-3.0, PIER.top + 0.03, 2.35);
  const CR_KEYS = [
    [0, IDLE],
    [CR_LAND_T, pose("brace", "brace", { hx: -0.05, yaw: FACE_CAM })], // !
    [3.4, pose("flail", "flail", { hx: 0.1, yaw: FACE_CAM - 0.3 })],
    [4.3, pose("flail", "flail", { hx: 0.1, yaw: FACE_CAM + 0.3 })],
    [5.2, pose("flail", "flail", { hx: 0.1, yaw: FACE_CAM - 0.2 })],
    [CR_END + 0.1, pose("rest", "rest", { lean: 0.16, dip: 0.04, hx: 0.15, yaw: FACE_CAM })], // phew, panting
  ];
  const yawKid = yawTo(TEACHER_POS, KID_POS);
  CR_KEYS.push(
    [7.6, pose("fist", "point", { hx: -0.05, hz: 0.1, yaw: yawKid })], // YOU!
    [8.4, pose("fist", "fist", { hx: -0.1, yaw: yawKid })],
    [9.7, pose("fist", "fist", { hx: -0.28, hz: 0.15, yaw: FACE_CAM - 0.5 })], // hmph!
    [10.7, pose("clasp", "clasp", { hz: 0.08, yaw: FACE_CAM })],
    [11.4, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [12.6, null]
  );
  const CRACKER_KEYS = CR_KEYS;
  // where it skitters (a pure function of time), round her feet
  function crackerAt(out, t) {
    const u = t - CR_LAND_T;
    const a = u * 2.6 + Math.sin(u * 5) * 0.7;
    const r = 0.42 + Math.sin(u * 3.3) * 0.08;
    return out.set(TEACHER_POS.x + Math.cos(a) * r * 0.8, PIER.top + 0.03, TEACHER_POS.z + Math.sin(a) * r * 0.6 + 0.1);
  }
  const crTmp = new THREE.Vector3();
  function crackerState(t) {
    const g = gagBase();
    if (t < CR_LAND_T) return g;
    if (t < CR_END) {
      g.face = t < 3.4 ? "huh" : Math.floor(t * 4) % 2 ? "wince" : "cry2";
      g.exclaim = t < 3.8 ? Math.sin(clamp01((t - CR_LAND_T) / 0.8) * Math.PI) : 0;
      if (t > 3.3) {
        // hop! hop! on the side away from it
        g.bob = Math.abs(Math.sin((t - 3.3) * 8)) * 0.16;
        g.kick = 0.6;
        g.flail = 0.5;
        crackerAt(crTmp, t);
        const p = wetPos.copy(TEACHER_POS);
        p.x += (TEACHER_POS.x - crTmp.x) * 0.35;
        p.z += (TEACHER_POS.z + 0.1 - crTmp.z) * 0.35;
        g.pos = p;
      }
    } else if (t < 7.6) {
      g.face = "daze";
      g.bob = Math.abs(Math.sin((t - CR_END) * 7)) * 0.012; // panting
    } else if (t < 9.7) {
      g.face = "pout";
      g.anger = smooth(clamp01((t - 7.6) / 0.3)) * (1 - smooth(clamp01((t - 9.4) / 0.3)));
      if (t < 8.6) g.bob = Math.abs(Math.sin((t - 7.6) * 6)) * 0.03; // stomp, stomp
    } else if (t < 10.7) g.face = "pout";
    return g;
  }
  function crackerPerformance(P, k, t, dt) {
    applyGag(crackerState(t));
    // ---- him ----
    const d = kidSt;
    const g = kid.group.position;
    d.run = 0;
    d.crouch = 0;
    d.face = "open";
    d.want = null;
    let yaw = yawTo(KID_POS, TEACHER_POS);
    if (t < CR_LIT - 0.1) {
      g.lerpVectors(KID_FROM, KID_POS, smooth(clamp01(t / (CR_LIT - 0.1))));
      d.run = 1;
      d.want = { l: "run", r: "run" };
      yaw = yawTo(KID_FROM, KID_POS);
    } else if (t < 9.8) {
      g.copy(KID_POS);
      if (t < CR_THROW) {
        d.crouch = 1; // lighting it
        d.want = { l: KARM.reach, r: KARM.reach };
      } else if (t < CR_THROW + 0.3) {
        d.want = { l: KARM.limp, r: ARM.windup };
      } else if (t < CR_LAND_T) {
        d.want = { l: KARM.limp, r: ARM.fling };
      } else if (t < 7.8) {
        d.want = { l: KARM.cheer, r: KARM.cheer }; // ha ha!
        d.face = Math.floor(t * 4) % 2 ? "open" : "blink";
      } else if (t < 8.7) {
        d.face = "huh"; // uh-oh
      } else {
        d.want = { l: KARM.wai, r: KARM.wai }; // sorry, kru!
        d.face = "blink";
      }
    } else if (t < 11.6) {
      g.lerpVectors(KID_POS, KID_FROM, smooth((t - 9.8) / 1.8));
      d.run = 1;
      d.want = { l: "run", r: "run" };
      yaw = yawTo(KID_POS, KID_FROM);
    } else {
      g.copy(KID_PARK);
    }
    kid.group.rotation.y += wrapAngle(yaw - kid.group.rotation.y) * Math.min(1, dt * 8);

    // ---- the firecracker ----
    const c = cracker.position;
    cracker.visible = t > CR_LIT - 0.2 && t < CR_END + 0.3;
    if (t < CR_THROW + 0.3) {
      kid.hands[1].getWorldPosition(c);
      P.crFrom = c.clone();
    } else if (t < CR_LAND_T) {
      const u = (t - CR_THROW - 0.3) / (CR_LAND_T - CR_THROW - 0.3);
      c.lerpVectors(P.crFrom, CR_LAND, u);
      c.y += Math.sin(u * Math.PI) * 1.1;
      cracker.rotation.set(t * 9, 0, t * 6);
    } else if (t < CR_END) {
      if (t < 3.3) c.lerpVectors(CR_LAND, crackerAt(crTmp, 3.3), (t - CR_LAND_T) / 0.3);
      else crackerAt(c, t);
      cracker.rotation.set(0, t * 7, Math.sin(t * 20) * 0.3);
    } else cracker.rotation.set(0, cracker.rotation.y, 0);
    cracker.userData.spark.visible = t > CR_LIT && t < CR_END;
    cracker.userData.spark.scale.setScalar(0.1 + Math.random() * 0.08);
    if (t > CR_LIT && t < CR_END) {
      P.fuse = (P.fuse ?? 0) - dt;
      if (P.fuse <= 0) {
        P.fuse = 0.06;
        cracker.userData.spark.getWorldPosition(crTmp);
        burst(crTmp, 3, { speed: 0.6, colors: [0xffd27a, 0xffffff], life: 0.3 });
      }
    }
    // bang bang bang
    if (t > 3.3 && t < CR_END) {
      P.bang = (P.bang ?? 0) - dt;
      if (P.bang <= 0) {
        P.bang = rand(0.22, 0.4);
        burst(c, 26, { speed: 2.0, colors: [0xffd27a, 0xff6a3a, 0xffffff], life: 0.4, up: 1.2 });
        flash(c, 1.4, 0xffc070, 0.15);
        puff(c, { size: 0.06, grow: 3, life: 0.6, rise: 0.3, spread: 0.06, a: 0.5, color: 0x8a8088 });
        sound.pop(0.22);
      }
    }
    if (once(P, "light", t, CR_LIT)) sound.fizzle();
    if (once(P, "throw", t, CR_THROW + 0.3)) sound.whoosh();
    if (once(P, "land", t, CR_LAND_T)) sound.pop(0.08);
    for (const at of [3.35, 4.6, 5.6]) if (once(P, "eek" + at, t, at)) sound.eek(0.09);
    if (once(P, "out", t, CR_END)) {
      puff(c, { size: 0.1, grow: 3, life: 1.2, rise: 0.4, spread: 0.1, a: 0.6, color: 0x8a8088 });
      sound.fizzle();
    }
    for (const at of [7.6, 8.3, 9.7]) if (once(P, "hmph" + at, t, at)) sound.hmph();
    // steam while she's cross
    if (t > 7.6 && t < 9.6) {
      P.steam = (P.steam ?? 0) - dt;
      if (P.steam <= 0) {
        P.steam = 0.5;
        teacher.head.getWorldPosition(crTmp);
        fwd.set(1, 0, 0).applyQuaternion(teacher.group.quaternion);
        for (const s of [-1, 1]) {
          gagTmp.copy(crTmp).addScaledVector(fwd, s * 0.22);
          gagTmp.y += 0.12;
          puff(gagTmp, { size: 0.05, grow: 2.4, life: 0.7, rise: 0.35, spread: 0.04, a: 0.75, color: 0xffffff });
        }
      }
    }
  }
  function endCracker() {
    kid.group.position.copy(KID_PARK);
    cracker.visible = false;
    kidSt.face = null;
  }
  function crackerShot(pos, look, P) {
    const t = P.t;
    const two = () => {
      // both: her on the pier and him on the bank
      const mx = (TEACHER_POS.x + KID_POS.x) / 2;
      const mz = (TEACHER_POS.z + KID_POS.z) / 2;
      const dd = 5.0 * (camera.aspect < 1 ? 1.5 : 1);
      look.set(mx, 0.9, mz);
      pos.set(mx + Math.sin(0.45) * dd, 1.9, mz + Math.cos(0.45) * dd);
    };
    if (t < CR_LAND_T) two();
    else if (t < 7.4) closeOnHer(pos, look);
    else if (t < 9.9) two();
    else closeOnHer(pos, look);
  }

  // ===== more gags =====
  // A registry, so runPerformance, keysFor and the camera don't each grow
  // another branch: { keys, perform(P, k, t, dt), shot(pos, look, P),
  // start?(k), end?(k) }. Idle ones are queued as { timed: true, extra },
  // float ones put the name on her krathong as k.extra.
  const EXTRA = {};
  Object.assign(ARM, {
    clapOpen: { x: -1.3, o: 0.35, e: -0.6 }, // hands apart, lining up a clap
    clapShut: { x: -1.3, o: -0.5, e: -0.6 }, // ... CLAP
    pointUp: { x: -2.75, o: 0.12, e: -0.1 }, // up at the sky
    stretch: { x: -2.95, o: 0.25, e: -0.35 }, // a big stretch
    ramHi: { x: -2.2, o: 0.6, e: -1.3, w: 0.5 }, // ram wong: hand up by the head
    ramLo: { x: -0.5, o: 0.55, e: -1.2, w: 0.5 }, // ... and low at the waist
    snack: { x: -1.0, o: 0.05, e: -1.35 }, // a snack held up in front
    bite: { x: -1.6, o: -0.3, e: -1.75 }, // ... to her mouth
    aside: { x: -0.5, o: 0.8, e: -0.7 }, // ... held out to the side
  });
  const exTmp = new THREE.Vector3();
  const exTmp2 = new THREE.Vector3();
  // a point along a path of points, at an even speed (u = 0..1)
  function along(out, pts, u) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
    let d = clamp01(u) * total;
    for (let i = 1; i < pts.length; i++) {
      const seg = pts[i].distanceTo(pts[i - 1]);
      if (d <= seg || i === pts.length - 1) return out.lerpVectors(pts[i - 1], pts[i], seg ? Math.min(1, d / seg) : 1);
      d -= seg;
    }
    return out.copy(pts[pts.length - 1]);
  }
  function sparkleHead(n = 40) {
    teacher.head.getWorldPosition(exTmp);
    exTmp.y += 0.18;
    burst(exTmp, n, { speed: 1.3, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.8 });
  }
  // 0..1..0 between a and b, with r-second ramps
  const fade = (t, a, b, r = 0.3) => smooth(clamp01((t - a) / r)) * (1 - smooth(clamp01((t - b + r) / r)));
  // a single swell from a (the "!" and "?")
  const pulse = (t, a, len = 0.8) => (t > a && t < a + len ? Math.sin(((t - a) / len) * Math.PI) : 0);
  // the float gags' shot: from the river side, framing her and the water
  // thing (tx, tz) the gag is about
  function riverSide(pos, look, tx, tz, base = 3.8, yaw = 0.95) {
    const g = TEACHER_POS;
    const mx = (g.x + tx) / 2;
    const mz = (g.z + tz) / 2;
    const dd = base + Math.hypot(tx - g.x, tz - g.z) * 0.55 + (camera.aspect < 1 ? 1.5 : 0);
    look.set(mx, 0.95, mz);
    pos.set(mx + Math.sin(yaw) * dd, 1.65, mz + Math.cos(yaw) * dd);
  }
  // a float gag pauses the ordinary float at `at` for `shift` seconds
  const floatTime = (t, at, shift) => (t < at ? t : t < at + shift ? at : t - shift);
  // her krathong, held by the gag rather than the river
  function holdKrathong(k, x, z, y = null) {
    k.stolen = true;
    k.root.position.set(x, y ?? Math.sin(clock * 1.4 + k.phase) * 0.025, z);
    k.root.rotation.z = Math.sin(clock * 1.1 + k.phase) * 0.025;
  }
  // ... and let go, out into the river
  function freeKrathong(k, vx = 0.35, vz = -0.9) {
    k.stolen = false;
    if (!k.target) return;
    k.target.set(0.6, 0, -3.6);
    k.retarget = clock + 40;
    k.vel.set(vx, 0, vz);
  }
  function candleOut(k, out) {
    k.flame.visible = !out;
    k.pool.visible = !out;
    k.lit = out ? 0 : 1;
  }

  // ----- the mosquito (idle): one whines round her head. Her eyes follow
  // it, she lines up a clap... misses. It lands on her cheek, she slaps it
  // with both hands... and gets only herself. Teary, then cross, while it
  // buzzes off without a care. -----
  const mozzie = (() => {
    const g = new THREE.Group();
    const dark = new THREE.MeshBasicMaterial({ color: 0x2a2228 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), dark);
    body.scale.set(1, 1, 2.4);
    g.add(body);
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.025, 4), dark);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.032;
    g.add(nose);
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    g.userData.wings = [-1, 1].map((s) => {
      const piv = new THREE.Group();
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.02, 10), wingMat);
      w.scale.set(1, 0.5, 1);
      w.rotation.x = -Math.PI / 2;
      w.position.x = s * 0.02;
      piv.add(w);
      piv.userData.s = s;
      g.add(piv);
      return piv;
    });
    g.scale.setScalar(2.6);
    g.visible = false;
    scene.add(g);
    return g;
  })();
  const MZ_CLAP = 3.45;
  const MZ_LAND = 4.9;
  const MZ_SLAP = 5.45;
  const MOZZIE_KEYS = [
    [0, IDLE],
    [0.9, pose("clasp", "clasp", { hx: -0.12, hz: 0.16, yaw: FACE_CAM })], // eyes on it
    [1.6, pose("clasp", "clasp", { hx: -0.05, hz: -0.16, yaw: FACE_CAM - 0.15 })],
    [2.2, pose("clasp", "clasp", { hx: -0.15, hz: 0.14, yaw: FACE_CAM + 0.1 })],
    [2.8, pose("clapOpen", "clapOpen", { hx: -0.15, yaw: FACE_CAM })], // aim...
    [3.3, pose("clapShut", "clapShut", { hx: -0.12, yaw: FACE_CAM })], // CLAP
    [3.8, pose("clapOpen", "clapOpen", { hx: 0.2, yaw: FACE_CAM })], // ... nothing?
    [4.5, pose("clasp", "clasp", { hz: -0.1, yaw: FACE_CAM })],
    [5.25, pose("specs", "specs", { hx: 0.05, yaw: FACE_CAM })], // SLAP
    [5.9, pose("cheeks", "cheeks", { hx: 0.12, yaw: FACE_CAM })], // owww
    [7.0, pose("fist", "fist", { hx: -0.22, hz: 0.12, yaw: FACE_CAM - 0.3 })], // hmph!
    [8.5, pose("clasp", "clasp", { hz: 0.08, yaw: FACE_CAM })],
    [9.1, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [10.2, null],
  ];
  // round her head, up out of the way of the clap, onto her cheek, away
  function mozzieAt(out, t, head, cheek) {
    const lift = t > MZ_CLAP && t < MZ_CLAP + 1.0 ? Math.sin(((t - MZ_CLAP) / 1.0) * Math.PI) * 0.35 : 0;
    const a = t * 2.4;
    out.set(head.x + Math.cos(a) * 0.42, head.y + 0.08 + Math.sin(t * 3.1) * 0.1 + lift, head.z + 0.06 + Math.sin(a) * 0.4);
    if (t < 4.4) return out;
    if (t < MZ_LAND) return out.lerp(cheek, smooth((t - 4.4) / (MZ_LAND - 4.4)));
    if (t < MZ_SLAP) return out.copy(cheek);
    const u = t - MZ_SLAP;
    return out.copy(cheek).add(exTmp2.set(u * 0.9 + Math.sin(u * 9) * 0.08, u * 0.5, u * 0.7));
  }
  function mozzieState(t) {
    const g = gagBase();
    if (t < 0.7) return g;
    if (t < 2.8) g.face = "huh";
    else if (t < MZ_CLAP) g.face = "squint";
    else if (t < MZ_CLAP + 0.25) g.face = "wince";
    else if (t < MZ_LAND) g.face = "huh";
    else if (t < MZ_SLAP) g.face = "squint";
    else if (t < 5.95) g.face = "wince";
    else if (t < 7.0) g.face = Math.floor(t * 4) % 2 ? "cry" : "cry2";
    else if (t < 8.5) g.face = "pout";
    else if (t < 9.1) g.face = "blink";
    g.question = pulse(t, 3.9, 0.9);
    g.exclaim = pulse(t, MZ_LAND, 0.6);
    if (t > MZ_SLAP && t < MZ_SLAP + 0.35) g.shake = Math.sin(t * 70) * 0.008;
    if (t > 5.95 && t < 7.0) g.bob = Math.abs(Math.sin((t - 5.95) * 7)) * 0.02;
    g.anger = fade(t, 7.0, 8.5);
    if (t > 7.0 && t < 7.8) g.bob = Math.abs(Math.sin((t - 7.0) * 6)) * 0.03; // stomp
    return g;
  }
  function mozziePerformance(P, k, t, dt) {
    applyGag(mozzieState(t));
    const head = teacher.head.localToWorld(gagTmp.set(0, C0, 0));
    const cheek = teacher.head.localToWorld(gagTmp2.set(0.09, C0 - 0.085, 0.165));
    mozzie.visible = t > 0.3 && t < 7.5;
    mozzieAt(mozzie.position, t, head, cheek);
    mozzie.rotation.y = t * 4;
    const flap = t > MZ_LAND && t < MZ_SLAP ? 0.1 : 0.7; // still while it feeds
    for (const w of mozzie.userData.wings) w.rotation.z = w.userData.s * Math.sin(t * 70) * flap;
    if (once(P, "buzz", t, 0.3)) sound.buzz(MZ_LAND - 0.3);
    if (once(P, "clap", t, MZ_CLAP)) {
      palms(exTmp, 0.05);
      burst(exTmp, 14, { speed: 0.8, colors: [0xffffff, 0xfff3b0], life: 0.35 });
      sound.pop(0.3);
    }
    if (once(P, "slap", t, MZ_SLAP)) {
      burst(cheek, 18, { speed: 1.0, colors: [0xffe27a, 0xffffff], life: 0.4 });
      sound.slap();
    }
    if (once(P, "buzz2", t, MZ_SLAP + 0.05)) sound.buzz(1.6);
    if (once(P, "sob", t, 6.0)) sound.sob();
    if (once(P, "hmph", t, 7.1)) sound.hmph();
  }
  EXTRA.mozzie = {
    keys: MOZZIE_KEYS,
    perform: mozziePerformance,
    shot: (pos, look) => nearHer(pos, look, 3.1),
    end() {
      mozzie.visible = false;
    },
  };

  // ----- the shooting star (idle): she gazes up at the sky, a shooting
  // star streaks across it, she points, then quickly wais with her eyes
  // shut and makes a wish; hearts, and a happy twirl. -----
  const shootStar = Array.from({ length: 22 }, () => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xeaf4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    m.visible = false;
    m.renderOrder = 3;
    scene.add(m);
    return m;
  });
  const ST_FROM = 1.5;
  const ST_LEN = 1.3;
  // drawn across the top of whatever the camera sees, far away
  function placeStar(t) {
    shootStar.forEach((m, i) => {
      const u = (t - ST_FROM) / ST_LEN - i * 0.016;
      m.visible = u > 0 && u < 1;
      if (!m.visible) return;
      const x = lerp(-0.8, 0.5, u);
      const y = lerp(0.88, 0.52, u) - Math.sin(u * Math.PI) * 0.05;
      exTmp.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      m.position.copy(camera.position).addScaledVector(exTmp, 60);
      const tail = 1 - i / shootStar.length;
      m.scale.setScalar(i ? 3.2 * tail + 0.6 : 5.0);
      m.material.opacity = (i ? 0.9 * tail : 1) * clamp01(u / 0.1) * clamp01((1 - u) / 0.25);
    });
  }
  const STAR_KEYS = [
    [0, IDLE],
    [0.5, pose("clasp", "clasp", { hx: -0.38, hz: 0.06, yaw: FACE_CAM })], // a lovely sky
    [1.9, pose("pointUp", "clasp", { hx: -0.45, hz: -0.08, yaw: FACE_CAM })], // a shooting star!
    [3.0, pose("wai", "wai", { hx: 0.12, eyes: 1, yaw: FACE_CAM })], // quick, a wish
    [6.0, pose("heart", "heart", { hx: -0.1, hz: 0.14, yaw: FACE_CAM })],
    [6.9, pose("open", "open", { hx: -0.2, yaw: FACE_CAM })], // a happy twirl
    [7.9, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [9.0, null],
  ];
  function starState(t) {
    const g = gagBase();
    if (t > 0.5 && t < 1.9) g.face = "open";
    else if (t >= 1.9 && t < 3.0) g.face = "huh";
    else if (t >= 6.0 && t < 7.9) g.face = "open";
    g.exclaim = pulse(t, 1.9, 0.8);
    if (t > 6.9 && t < 7.8) {
      const u = (t - 6.9) / 0.9;
      g.spin = TAU * smooth(u);
      g.bob = Math.sin(u * Math.PI) * 0.08;
    }
    return g;
  }
  function starPerformance(P, k, t, dt) {
    applyGag(starState(t));
    placeStar(t);
    showHearts(t, 6.0, 8.3);
    if (once(P, "star", t, ST_FROM)) sound.shimmer();
    if (once(P, "ooh", t, 1.95)) sound.pop(0.1);
    // little sparkles rise from her hands while she wishes
    if (t > 3.3 && t < 5.9) {
      P.tw = (P.tw ?? 0) - dt;
      if (P.tw <= 0) {
        P.tw = 0.35;
        palms(exTmp, 0.05);
        exTmp.y += 0.1;
        burst(exTmp, 4, { speed: 0.5, colors: [0xfff3b0, 0xffffff], life: 0.6, up: 0.6 });
      }
    }
    if (once(P, "wish", t, 5.9)) sound.ting(0.06);
    if (once(P, "twirl", t, 7.8)) {
      sparkleHead();
      sound.chime();
    }
  }
  // low in front of her, looking up past her at the sky
  function starShot(pos, look, P) {
    if (P.t < 0.4 || P.t > 8.6) return nearHer(pos, look, 3.1);
    const g = teacher.group.position;
    const dd = 3.3 + (camera.aspect < 1 ? 1.4 : 0);
    look.set(g.x, 1.95, g.z);
    pos.set(g.x + Math.sin(0.5) * dd, 0.95, g.z + Math.cos(0.5) * dd);
  }
  EXTRA.star = {
    keys: STAR_KEYS,
    perform: starPerformance,
    shot: starShot,
    end() {
      for (const m of shootStar) m.visible = false;
      hideHearts();
    },
  };

  // ----- sleepy (idle): a big yawn and a stretch, she nods off on her
  // feet (Zzz, a bubble at her nose growing and shrinking with each
  // breath), the firefly bumps the bubble, POP, she jolts awake, looks
  // round and goes pink: did anyone see that? -----
  const zTex = (() => {
    const c = makeCanvas(96, 96);
    const g = c.getContext("2d");
    g.font = "bold 72px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.lineJoin = "round";
    g.strokeStyle = "#3a4a8a";
    g.strokeText("Z", 48, 50);
    g.fillStyle = "#ffffff";
    g.fillText("Z", 48, 50);
    return canvasTexture(c);
  })();
  const zzz = [0, 1, 2].map(() => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false }));
    m.visible = false;
    m.userData.ownFade = true;
    teacher.group.add(m);
    return m;
  });
  function showZzz(t, from, to) {
    zzz.forEach((m, i) => {
      const v = t - from - i * 0.6;
      const u = (v % 1.8) / 1.8;
      const on = t < to && v > 0;
      m.visible = on;
      if (!on) return;
      m.position.set(0.24 + u * 0.2, teacher.topY - 0.42 + u * 0.32, 0.05);
      m.scale.setScalar(0.09 + 0.08 * u);
      m.material.opacity = Math.sin(u * Math.PI);
    });
  }
  const snot = (() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), new THREE.MeshToonMaterial({ color: 0xd8f2ff, emissive: 0x2a3a4a, transparent: true, opacity: 0.6, depthWrite: false }));
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    glint.position.set(-0.024, 0.03, 0.05);
    m.add(glint);
    m.visible = false;
    teacher.head.add(m);
    return m;
  })();
  const SL_POP = 7.6;
  const SLEEPY_KEYS = [
    [0, IDLE],
    [0.5, pose("stretch", "brace", { hx: -0.25, hz: 0.1, yaw: FACE_CAM })], // a big yawn and a stretch
    [2.0, pose("clasp", "clasp", { hx: 0.12, yaw: FACE_CAM })],
    [2.7, pose("clasp", "clasp", { hx: 0.45, hz: 0.1, yaw: FACE_CAM })], // nodding off...
    [3.3, pose("clasp", "clasp", { hx: 0.0, yaw: FACE_CAM })], // ... jerks awake
    [3.8, pose("clasp", "clasp", { hx: 0.42, hz: -0.1, yaw: FACE_CAM })],
    [4.5, pose("clasp", "clasp", { hx: 0.5, hz: 0.2, lean: 0.04, yaw: FACE_CAM })], // asleep on her feet
    [SL_POP, pose("shock", "shock", { rise: 0.05, hx: -0.1, yaw: FACE_CAM })], // POP!
    [8.4, pose("rest", "rest", { hz: 0.25, yaw: FACE_CAM - 0.25 })], // who? what?
    [8.9, pose("rest", "rest", { hz: -0.25, yaw: FACE_CAM + 0.25 })],
    [9.4, pose("cheeks", "cheeks", { hx: 0.15, hz: 0.12, yaw: FACE_CAM })], // did anyone see?
    [10.6, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [11.6, null],
  ];
  function sleepyState(t) {
    const g = gagBase();
    if (t > 0.5 && t < 2.0) g.face = "yawn";
    else if (t >= 2.0 && t < 3.3) g.face = "sleep";
    else if (t >= 3.3 && t < 3.75) g.face = "huh";
    else if (t >= 3.75 && t < SL_POP) g.face = "sleep";
    else if (t >= SL_POP && t < 9.4) g.face = "huh";
    else if (t >= 9.4 && t < 10.6) g.face = "shy";
    g.exclaim = pulse(t, SL_POP, 0.8);
    if (t > SL_POP && t < SL_POP + 0.3) g.shake = Math.sin(t * 70) * 0.008;
    if (t > 9.4 && t < 10.6) g.bob = Math.abs(Math.sin((t - 9.4) * 6)) * 0.012;
    return g;
  }
  function sleepyPerformance(P, k, t, dt) {
    applyGag(sleepyState(t));
    showZzz(t, 4.4, SL_POP);
    // the bubble swells and shrinks with each breath
    const s = smooth(clamp01((t - 4.8) / 1.4)) * (0.75 + 0.35 * Math.sin(t * 2.6));
    snot.visible = t > 4.8 && t < SL_POP;
    snot.scale.setScalar(Math.max(0.01, s));
    snot.position.set(0.03, C0 - 0.055, 0.2 + 0.06 * s);
    const at = snot.getWorldPosition(gagTmp);
    // the firefly drifts in and bumps it, then flits off
    firefly.visible = t > 6.0 && t < 9.2;
    if (firefly.visible) {
      const f = firefly.position;
      if (t < SL_POP) {
        const u = smooth((t - 6.0) / (SL_POP - 6.0));
        gagTmp2.set(at.x + 1.2, at.y + 0.6, at.z + 0.7);
        f.lerpVectors(gagTmp2, at, u);
        f.x += Math.sin(t * 5) * 0.12 * (1 - u);
        f.y += Math.cos(t * 3.7) * 0.08 * (1 - u);
      } else {
        const u = t - SL_POP;
        if (!P.ffFrom) P.ffFrom = f.clone();
        f.copy(P.ffFrom);
        f.x += u * 0.8 + Math.sin(u * 10) * 0.06;
        f.y += u * 0.7;
        f.z += u * 0.3;
      }
      firefly.userData.glow.material.opacity = (0.65 + 0.35 * Math.sin(t * 6)) * (t > 8.8 ? 1 - (t - 8.8) / 0.4 : 1);
      firefly.userData.glow.scale.setScalar(0.14);
    }
    if (once(P, "yawn", t, 0.6)) sound.yawn();
    if (once(P, "nod", t, 3.3)) sound.pop(0.06);
    if (once(P, "pop", t, SL_POP)) {
      burst(at, 24, { speed: 1.0, colors: [0xd8f2ff, 0xffffff], life: 0.45 });
      sound.pop(0.25);
    }
    if (once(P, "eek", t, SL_POP + 0.1)) sound.eek(0.07);
  }
  EXTRA.sleepy = {
    keys: SLEEPY_KEYS,
    perform: sleepyPerformance,
    shot: (pos, look) => nearHer(pos, look, 3.1),
    end() {
      snot.visible = false;
      firefly.visible = false;
      for (const m of zzz) m.visible = false;
    },
  };

  // ----- ram wong (idle): the firecracker kid comes back (good as gold
  // this time) and they dance the ram wong together on the pier to a
  // little tune, then wai each other and he runs off. -----
  const RAM_KID = new THREE.Vector3(-3.65, PIER.top, 2.75);
  const RAM_PATH = [KID_FROM, new THREE.Vector3(-3.6, PIER.top, 4.45), RAM_KID];
  const yawRam = yawTo(TEACHER_POS, RAM_KID);
  const RAM_T0 = 2.9;
  const RAM_BEAT = 1.1;
  const RAM_N = 6;
  const RAM_END = RAM_T0 + RAM_N * RAM_BEAT;
  const ramPose = (i) =>
    i % 2
      ? pose("ramLo", "ramHi", { hz: -0.14, hx: -0.05, yaw: FACE_CAM - 0.22 })
      : pose("ramHi", "ramLo", { hz: 0.14, hx: -0.05, yaw: FACE_CAM + 0.22 });
  const RAM_KEYS = [
    [0, IDLE],
    [1.2, pose("clasp", "clasp", { hx: 0.12, yaw: yawRam })], // oh, him again?
    [2.0, pose("wai", "wai", { hx: 0.22, dip: 0.03, yaw: yawRam })],
    ...Array.from({ length: RAM_N }, (_, i) => [RAM_T0 + i * RAM_BEAT, ramPose(i)]),
    [RAM_END, pose("wai", "wai", { hx: 0.22, dip: 0.03, yaw: yawRam })],
    [10.5, pose("clasp", "wave", { hz: -0.12, yaw: yawRam })],
    [11.6, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [12.6, null],
  ];
  const RAM_NOTES = [523, 587, 659, 784, 659, 587, 659, 523, 587, 659, 784, 880];
  function ramState(t) {
    const g = gagBase();
    if (t > 1.2 && t < 2.0) g.face = "huh";
    else if (t >= 2.0 && t < RAM_T0) g.face = "blink";
    else if (t >= RAM_T0 && t < RAM_END) {
      g.face = Math.floor((t - RAM_T0) / RAM_BEAT) % 2 ? "open" : "blink";
      g.bob = Math.abs(Math.sin(((t - RAM_T0) / RAM_BEAT) * Math.PI * 2)) * 0.025;
    } else if (t >= RAM_END && t < 10.5) g.face = "blink";
    g.question = pulse(t, 1.2, 0.8);
    return g;
  }
  function ramPerformance(P, k, t, dt) {
    applyGag(ramState(t));
    const d = kidSt;
    const g = kid.group.position;
    d.run = 0;
    d.crouch = 0;
    d.face = "open";
    d.want = null;
    const toCam = Math.atan2(camera.position.x - g.x, camera.position.z - g.z);
    const toHer = yawTo(g, TEACHER_POS);
    let yaw = toHer;
    if (t < 2.0) {
      const u = clamp01(t / 2.0);
      along(g, RAM_PATH, u);
      along(exTmp, RAM_PATH, Math.min(1, u + 0.02));
      if (u < 0.99) yaw = yawTo(g, exTmp);
      d.run = 1;
      d.want = { l: "run", r: "run" };
    } else if (t < 10.6) {
      g.copy(RAM_KID);
      if (t < RAM_T0 || (t >= RAM_END && t < 10.0)) {
        d.want = { l: KARM.wai, r: KARM.wai };
        d.face = "blink";
        yaw = toCam + wrapAngle(toHer - toCam) * 0.55;
      } else if (t >= 10.0) {
        d.want = { l: KARM.limp, r: KARM.wave };
      } else {
        // a beat behind her, copying
        const v = (t - RAM_T0 - 0.25) / RAM_BEAT;
        const i = Math.floor(v);
        d.want = i < 0 ? { l: KARM.wai, r: KARM.wai } : i % 2 ? { l: ARM.ramLo, r: ARM.ramHi } : { l: ARM.ramHi, r: ARM.ramLo };
        yaw = toCam + wrapAngle(toHer - toCam) * 0.3;
        g.y = RAM_KID.y + (v > 0 ? Math.abs(Math.sin(v * Math.PI * 2)) * 0.03 : 0);
      }
    } else if (t < 12.5) {
      const u = clamp01((t - 10.6) / 1.9);
      along(g, RAM_PATH, 1 - u);
      along(exTmp, RAM_PATH, Math.max(0, 1 - u - 0.02));
      yaw = yawTo(g, exTmp);
      d.run = 1;
      d.want = { l: "run", r: "run" };
    } else g.copy(KID_PARK);
    kid.group.rotation.y += wrapAngle(yaw - kid.group.rotation.y) * Math.min(1, dt * 8);
    // the tune: a note on every half beat, "ching" and "chap" between
    for (let i = 0; i < RAM_N * 2; i++) {
      if (once(P, "n" + i, t, RAM_T0 + i * RAM_BEAT * 0.5)) {
        sound.note(RAM_NOTES[i % RAM_NOTES.length]);
        if (i % 2 === 0) sound.ting(0.022);
        else sound.pop(0.05);
      }
    }
    if (once(P, "done", t, RAM_END)) {
      sparkleHead(30);
      sound.chime();
    }
  }
  function ramShot(pos, look) {
    const mx = (TEACHER_POS.x + RAM_KID.x) / 2;
    const mz = (TEACHER_POS.z + RAM_KID.z) / 2;
    const dd = 4.4 * (camera.aspect < 1 ? 1.45 : 1);
    look.set(mx, 1.2, mz);
    pos.set(mx + Math.sin(0.5) * dd, 1.9, mz + Math.cos(0.5) * dd);
  }
  EXTRA.ramwong = {
    keys: RAM_KEYS,
    perform: ramPerformance,
    shot: ramShot,
    end() {
      kid.group.position.copy(KID_PARK);
      kidSt.face = null;
    },
  };

  // ----- the cat (idle): she has a grilled banana on a stick, takes a
  // bite and savours it with her eyes shut, holding it out to one side...
  // a cat creeps up the pier, leaps and makes off with it. She goes for
  // another bite: nothing! Looks at her empty hand, spots the cat, wails,
  // sighs, then laughs it off. -----
  const banana = handProp((add) => {
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 5), "#c8a070", (d) => {
      d.position.set(0, -0.02, 0.1);
      d.rotation.x = Math.PI / 2;
    });
    for (const z of [0.1, 0.16, 0.22]) add(new THREE.SphereGeometry(0.024, 10, 8), "#d8962e", (d) => { d.position.set(0, -0.02, z); d.scale.set(1, 0.8, 1.25); });
  });
  const CAT_FROM = new THREE.Vector3(-4.7, 0.35, 5.1);
  const CAT_ON = new THREE.Vector3(-3.5, PIER.top, 4.4);
  const CAT_AWAY = new THREE.Vector3(-7.5, 0.35, 5.6);
  const CAT_PARK = new THREE.Vector3(-12, -5, 9);
  const cat = (() => {
    const g = new THREE.Group();
    const fur = "#f2a24e";
    const dark = "#c9752c";
    const white = "#fff3e2";
    const { parts, add } = partList();
    add(new THREE.SphereGeometry(0.09, 14, 10), fur, (d) => { d.position.set(0, 0.15, 0); d.scale.set(0.85, 0.78, 1.45); });
    add(new THREE.SphereGeometry(0.06, 12, 8), white, (d) => { d.position.set(0, 0.12, 0.05); d.scale.set(0.9, 0.7, 1.2); }); // tummy
    for (const z of [-0.07, -0.02, 0.03]) add(new THREE.TorusGeometry(0.074, 0.009, 4, 14, Math.PI), dark, (d) => d.position.set(0, 0.152, z)); // tabby stripes
    add(new THREE.SphereGeometry(0.075, 14, 10), fur, (d) => d.position.set(0, 0.25, 0.13));
    add(new THREE.SphereGeometry(0.038, 10, 8), white, (d) => { d.position.set(0, 0.228, 0.19); d.scale.set(1.25, 0.8, 0.8); }); // muzzle
    add(new THREE.SphereGeometry(0.008, 6, 4), "#ff8fa8", (d) => d.position.set(0, 0.242, 0.212)); // nose
    for (const s of [-1, 1]) {
      add(new THREE.ConeGeometry(0.03, 0.055, 4), fur, (d) => { d.position.set(s * 0.042, 0.32, 0.12); d.rotation.set(0, Math.PI / 4, -s * 0.3); });
      add(new THREE.SphereGeometry(0.013, 8, 6), "#1a1410", (d) => d.position.set(s * 0.03, 0.262, 0.196));
      add(new THREE.SphereGeometry(0.005, 6, 4), "#ffffff", (d) => d.position.set(s * 0.03 + 0.004, 0.268, 0.207));
    }
    g.add(new THREE.Mesh(mergeParts(parts), propMat));
    const legs = [[-0.045, 0.08], [0.045, 0.08], [-0.045, -0.08], [0.045, -0.08]].map(([x, z]) => {
      const piv = new THREE.Group();
      piv.position.set(x, 0.12, z);
      const lp = partList();
      lp.add(new THREE.CylinderGeometry(0.018, 0.016, 0.11, 8), fur, (d) => (d.position.y = -0.06));
      lp.add(new THREE.SphereGeometry(0.019, 8, 6), white, (d) => d.position.set(0, -0.115, 0.004));
      piv.add(new THREE.Mesh(mergeParts(lp.parts), propMat));
      g.add(piv);
      return piv;
    });
    const tail = new THREE.Group();
    tail.position.set(0, 0.17, -0.12);
    const tp = partList();
    tp.add(new THREE.CylinderGeometry(0.014, 0.018, 0.2, 8), fur, (d) => { d.position.set(0, 0.09, -0.03); d.rotation.x = -0.35; });
    tp.add(new THREE.SphereGeometry(0.016, 8, 6), dark, (d) => d.position.set(0, 0.185, -0.065));
    tail.add(new THREE.Mesh(mergeParts(tp.parts), propMat));
    g.add(tail);
    // the stolen banana, crosswise in its mouth
    const snack = new THREE.Mesh(banana.geometry, propMat);
    snack.position.set(-0.13, 0.235, 0.2);
    snack.rotation.y = Math.PI / 2;
    snack.visible = false;
    g.add(snack);
    g.userData.legs = legs;
    g.userData.tail = tail;
    g.userData.snack = snack;
    g.scale.setScalar(1.25);
    g.position.copy(CAT_PARK);
    scene.add(g);
    return g;
  })();
  const CAT_SNEAK = 1.2;
  const CAT_SIT_T = 4.2;
  const CAT_LEAP = 4.6;
  const CAT_GRAB = 4.85;
  const CAT_LAND = 5.2;
  const CAT_GONE = 7.4;
  const yawCat = yawTo(TEACHER_POS, CAT_ON);
  const CAT_KEYS = [
    [0, pose("pocket", "clasp", { hz: 0.06, yaw: FACE_CAM })],
    [0.7, pose("snack", "clasp", { hz: 0.1, yaw: FACE_CAM })], // grilled banana!
    [1.6, pose("bite", "clasp", { hx: 0.05, yaw: FACE_CAM })], // nom
    [2.3, pose("aside", "heart", { hx: -0.05, hz: 0.15, yaw: FACE_CAM })], // mmm, so good
    [3.1, pose("aside", "heart", { hx: -0.05, hz: -0.12, yaw: FACE_CAM })],
    [3.9, pose("aside", "heart", { hx: -0.05, hz: 0.15, yaw: FACE_CAM })],
    [5.1, pose("bite", "clasp", { hx: 0.05, yaw: FACE_CAM })], // another bite... air
    [5.9, pose("snack", "clasp", { hx: 0.3, yaw: FACE_CAM })], // where did it go?
    [6.8, pose("point", "fist", { yaw: yawCat })], // YOU!
    [7.7, pose("cry", "cry", { hx: -0.1, yaw: FACE_CAM })], // waaah
    [9.1, pose("rest", "rest", { hz: 0.2, yaw: FACE_CAM })], // sigh
    [9.7, pose("heart", "heart", { hz: 0.12, yaw: FACE_CAM })], // oh well, hee hee
    [10.5, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [11.5, null],
  ];
  function catState(t) {
    const g = gagBase();
    if (t > 0.7 && t < 1.6) g.face = "open";
    else if (t >= 1.6 && t < 5.55) g.face = "yum";
    else if (t >= 5.55 && t < 6.8) g.face = "huh";
    else if (t >= 6.8 && t < 7.7) g.face = "pout";
    else if (t >= 7.7 && t < 9.1) g.face = Math.floor(t * 4) % 2 ? "cry" : "cry2";
    else if (t >= 9.1 && t < 9.7) g.face = "blink";
    else if (t >= 9.7 && t < 10.5) g.face = "open";
    g.question = pulse(t, 5.9, 0.9);
    g.exclaim = pulse(t, 6.8, 0.7);
    if (t > 2.3 && t < 4.6) g.bob = Math.abs(Math.sin((t - 2.3) * 4)) * 0.01;
    if (t > 7.7 && t < 9.1) g.bob = Math.abs(Math.sin((t - 7.7) * 7)) * 0.02;
    if (t > 9.7 && t < 10.5) g.bob = Math.abs(Math.sin((t - 9.7) * 9)) * 0.015;
    return g;
  }
  function catPerformance(P, k, t, dt) {
    applyGag(catState(t));
    banana.visible = t > 0.45 && t < CAT_GRAB;
    const c = cat.position;
    const ud = cat.userData;
    ud.snack.visible = t > CAT_GRAB && t < CAT_GONE;
    // it sits on the deck under her hand
    const hand = banana.getWorldPosition(gagTmp);
    const sit = gagTmp2.set(hand.x, PIER.top, hand.z);
    let yaw = null;
    let walk = 0;
    let crouch = 0;
    if (t < CAT_SNEAK) {
      c.copy(CAT_FROM);
      yaw = yawTo(CAT_FROM, CAT_ON);
    } else if (t < CAT_SIT_T) {
      // creeping along the bank, onto the pier and up behind her hand
      P.catPath ??= [CAT_FROM, CAT_ON, new THREE.Vector3()];
      P.catPath[2].copy(sit);
      const v = smooth((t - CAT_SNEAK) / (CAT_SIT_T - CAT_SNEAK));
      along(c, P.catPath, v);
      along(exTmp, P.catPath, Math.min(1, v + 0.02));
      if (v < 0.98) yaw = yawTo(c, exTmp);
      walk = 0.6;
      crouch = 1;
    } else if (t < CAT_LEAP) {
      c.copy(sit); // eyes on the prize
      yaw = yawTo(c, teacher.group.position);
    } else if (t < CAT_LAND) {
      P.leap ??= sit.clone();
      const v = (t - CAT_LEAP) / (CAT_LAND - CAT_LEAP);
      c.copy(P.leap);
      c.y = PIER.top + Math.sin(v * Math.PI) * Math.max(0.1, hand.y - PIER.top - 0.32);
      yaw = yawTo(c, teacher.group.position);
    } else if (t < CAT_GONE) {
      // off with it, back up the pier and away
      P.run ??= [P.leap.clone(), CAT_ON, CAT_FROM, CAT_AWAY];
      const v = clamp01((t - CAT_LAND) / (CAT_GONE - CAT_LAND));
      along(c, P.run, v);
      along(exTmp, P.run, Math.min(1, v + 0.02));
      yaw = yawTo(c, exTmp);
      walk = 1.6;
    } else c.copy(CAT_PARK);
    if (yaw != null) cat.rotation.y += wrapAngle(yaw - cat.rotation.y) * Math.min(1, dt * 10);
    ud.legs.forEach((l, i) => (l.rotation.x = walk ? Math.sin(clock * 9 * walk + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.6 : 0));
    ud.tail.rotation.set(crouch ? 0.7 : 0, 0, Math.sin(clock * 3) * 0.35);
    cat.scale.set(1.25, 1.25 * (1 - 0.15 * crouch), 1.25);
    if (once(P, "show", t, 0.8)) sound.ting(0.05);
    if (once(P, "munch", t, 1.9)) sound.munch();
    if (once(P, "mew", t, CAT_SIT_T)) sound.meow(0.04);
    if (once(P, "grab", t, CAT_GRAB)) {
      burst(hand, 12, { speed: 0.7, colors: [0xffe9a0, 0xffffff], life: 0.4 });
      sound.pop(0.1);
    }
    if (once(P, "chomp", t, 5.45)) sound.pop(0.12);
    if (once(P, "mew2", t, 5.8)) sound.meow(0.07);
    if (once(P, "you", t, 6.85)) sound.hmph();
    if (once(P, "sob", t, 7.8)) sound.sob();
    if (once(P, "hee", t, 9.8)) sound.giggle();
  }
  // from the river side, so the cat's walk up the pier reads
  function catShot(pos, look, P) {
    if (P.t > 7.6) return nearHer(pos, look, 3.2);
    const dd = 4.4 + (camera.aspect < 1 ? 1.6 : 0);
    look.set(-3.45, 1.0, 2.9);
    pos.set(-3.45 + Math.sin(1.2) * dd, 1.75, 2.9 + Math.cos(1.2) * dd);
  }
  EXTRA.cat = {
    keys: CAT_KEYS,
    perform: catPerformance,
    shot: catShot,
    end() {
      cat.position.copy(CAT_PARK);
      cat.userData.snack.visible = false;
      banana.visible = false;
    },
  };

  // ----- the boomerang krathong (float): she sets it on the water, it
  // drifts out... and comes back. She pushes it off again; back it comes
  // again! A pout and a stomp, then she kneels and blows it away with one
  // big puff, and claps. -----
  const BM_OUT = new THREE.Vector3(-0.5, 0, 0.7);
  const BM_S = 7.4;
  const BM_GO = 11.7;
  const BM_KEYS = [
    ...FLOAT_KEYS.filter(([at]) => at < 6.6),
    [6.7, pose("clasp", "clasp", { hx: 0.25, hz: 0.18, yaw: FACE_WATER })], // huh? it's coming back
    [7.7, pose("reach", "reach", { dip: 0.14, lean: 0.16, hx: 0.42, yaw: FACE_WATER })], // off you go
    [8.6, pose("clasp", "clasp", { hx: 0.2, yaw: FACE_WATER })],
    [9.6, pose("clasp", "clasp", { hx: 0.3, hz: -0.2, yaw: FACE_WATER })], // AGAIN?!
    [10.2, pose("fist", "fist", { hx: 0.1, hz: 0.12, yaw: FACE_WATER })], // hmph
    [11.0, pose("rest", "rest", { dip: 0.16, lean: 0.24, hx: 0.5, yaw: FACE_WATER })], // one big puff
    [12.1, pose("clap", "clap", { hx: -0.1, yaw: FACE_WATER - 0.4 })], // yay!
    [13.0, pose("heart", "heart", { hz: 0.14, yaw: FACE_CAM })],
    ...FLOAT_KEYS.filter(([at]) => at >= 6.6).map(([at, p]) => [at + BM_S, p]),
  ];
  function bmAt(out, t) {
    out.copy(DROP_POS);
    if (t < 4.6) return out;
    if (t < 6.4) return out.lerp(BM_OUT, smooth((t - 4.6) / 1.8));
    if (t < 7.6) return out.copy(BM_OUT).lerp(DROP_POS, smooth((t - 6.4) / 1.2));
    if (t < 8.2) return out;
    if (t < 9.3) return out.lerp(BM_OUT, smooth((t - 8.2) / 1.1));
    if (t < 10.4) return out.copy(BM_OUT).lerp(DROP_POS, smooth((t - 9.3) / 1.1));
    return out;
  }
  function bmState(t) {
    const g = gagBase();
    if (t < 6.7 || t > 13.6) return g;
    if (t < 7.7) g.face = "huh";
    else if (t < 8.6) g.face = null;
    else if (t < 9.6) g.face = "open";
    else if (t < 10.2) g.face = "huh";
    else if (t < 11.45) g.face = "pout"; // ... cheeks full of air
    else if (t < 11.9) g.face = "huh"; // whoooo
    else g.face = "open";
    g.question = pulse(t, 6.9, 0.9);
    g.exclaim = pulse(t, 9.6, 0.7);
    g.anger = fade(t, 10.2, 11.0);
    if (t > 10.2 && t < 10.9) g.bob = Math.abs(Math.sin((t - 10.2) * 6)) * 0.03;
    if (t > 12.1 && t < 13.0) g.bob = Math.abs(Math.sin((t - 12.1) * 8)) * 0.03;
    return g;
  }
  function bmPerformance(P, k, t, dt) {
    applyGag(bmState(t));
    floatPerformance(P, k, floatTime(t, 5.9, BM_S));
    const kp = k.root.position;
    if (t >= FLOAT_ON_WATER && t < BM_GO) {
      bmAt(exTmp, t);
      holdKrathong(k, exTmp.x, exTmp.z);
    }
    for (const at of [7.6, 10.4]) {
      if (once(P, "bump" + at, t, at)) {
        ripple(DROP_POS.x, DROP_POS.z, 1.0, 0xcfe8ff);
        sound.pop(0.07);
      }
    }
    if (once(P, "huh", t, 6.9)) sound.pop(0.1);
    if (once(P, "hmph", t, 10.25)) sound.hmph();
    if (once(P, "blow", t, 11.45)) {
      const mouth = teacher.head.localToWorld(exTmp.set(0, C0 - 0.07, 0.2));
      for (let i = 0; i < 5; i++) puff(exTmp2.lerpVectors(mouth, kp, i / 5), { size: 0.06, grow: 2, life: 0.6, rise: 0.05, spread: 0.05, a: 0.5, color: 0xffffff });
      sound.blow();
    }
    if (once(P, "go", t, BM_GO)) {
      freeKrathong(k, 1.8, -1.5);
      ripple(kp.x, kp.z, 1.6, 0xcfe8ff);
      ripple(kp.x, kp.z, 2.4, 0xcfe8ff);
      sound.whoosh();
    }
    // a wake of sparkles as it zooms off
    if (t > BM_GO && t < BM_GO + 1.0) {
      P.wake = (P.wake ?? 0) - dt;
      if (P.wake <= 0) {
        P.wake = 0.08;
        burst(exTmp.set(kp.x, 0.08, kp.z), 4, { speed: 0.4, colors: [0xbfe6ff, 0xffffff], life: 0.5, up: 0.3 });
      }
    }
    if (once(P, "yay", t, 12.1)) {
      sparkleHead();
      sound.chime();
    }
  }
  EXTRA.boomerang = {
    keys: BM_KEYS,
    perform: bmPerformance,
    shot(pos, look, P) {
      if (P.t < 2.3 || P.t > 13.6) return defaultFloatShot(pos, look);
      // side on to its trips out and back
      riverSide(pos, look, (DROP_POS.x + BM_OUT.x) / 2, (DROP_POS.z + BM_OUT.z) / 2, 4.4, 0.55);
    },
    end(k) {
      k.stolen = false;
    },
  };

  // ----- the candle goes out (float): a gust blows her krathong's candle
  // out while she wais with her eyes shut. She opens them: dark! Tears...
  // and the coin-diver boy swims up with a lighter and lights it again for
  // her. She wais him thank you, he waves and swims off. -----
  const CD_S = 5.0;
  const CD_OUT = 5.0;
  const CD_SWIM = 5.4;
  const CD_AT = 8.4;
  const CD_FLICK = 8.75;
  const CD_LIT = 9.2;
  const CD_BYE = 11.0;
  // (in front of it and to one side, so the krathong never hides him)
  const CANDLE_BOY = new THREE.Vector3(-1.3, BOY_Y, 1.2);
  const CANDLE_KEYS = [
    ...FLOAT_KEYS.filter(([at]) => at < 5.9),
    [5.9, pose("clasp", "clasp", { hx: 0.3, yaw: FACE_WATER })], // it went out!
    [6.8, pose("cry", "cry", { hx: -0.1, yaw: FACE_CAM })],
    [8.1, pose("clasp", "clasp", { hx: 0.2, yaw: FACE_WATER })], // oh? him?
    [9.4, pose("heart", "heart", { hx: 0.1, yaw: FACE_WATER })], // it's lit!
    [10.0, pose("wai", "wai", { hx: 0.25, dip: 0.04, yaw: FACE_WATER })], // thank you
    [11.0, pose("clasp", "clasp", { hz: 0.1, yaw: FACE_WATER - 0.3 })],
    ...FLOAT_KEYS.filter(([at]) => at >= 6.6).map(([at, p]) => [at + CD_S, p]),
  ];
  const lighter = (() => {
    const { parts, add } = partList();
    add(new THREE.BoxGeometry(0.03, 0.055, 0.016), "#e8302a", (d) => (d.position.y = -0.06));
    add(new THREE.BoxGeometry(0.03, 0.014, 0.017), "#c8c8d0", (d) => (d.position.y = -0.093));
    const m = new THREE.Mesh(mergeParts(parts), propMat);
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.flame, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    fl.position.y = -0.125;
    fl.scale.set(0.05, 0.1, 1);
    m.add(fl);
    m.userData.flame = fl;
    m.visible = false;
    boy.hands[1].add(m);
    return m;
  })();
  function candleState(t) {
    const g = gagBase();
    if (t < 5.9 || t > 11.6) return g;
    if (t < 6.8) g.face = "huh";
    else if (t < 8.1) g.face = Math.floor(t * 4) % 2 ? "cry" : "cry2";
    else if (t < CD_LIT) g.face = "huh";
    else if (t < 10.0) g.face = "open";
    else if (t < 11.0) g.face = "shy";
    g.exclaim = pulse(t, 5.95, 0.8);
    g.question = pulse(t, 8.2, 0.8);
    if (t > 6.8 && t < 8.1) g.bob = Math.abs(Math.sin((t - 6.8) * 7)) * 0.02;
    return g;
  }
  function candleBoy(P, k, t, dt) {
    const d = diver;
    const g = boy.group.position;
    if (!P.bS) {
      P.bS = g.clone();
      P.bS.y = BOY_Y;
    }
    const toCam = Math.atan2(camera.position.x - g.x, camera.position.z - g.z);
    let yaw = toCam;
    let want = { l: KARM.tread, r: KARM.tread };
    d.swim = 0;
    d.wob = 0;
    d.face = null;
    boyCoin.visible = false;
    if (t < CD_SWIM) {
      g.copy(P.bS);
      yaw = boy.group.rotation.y;
    } else if (t < CD_AT) {
      // he saw it go out: here he comes, paddling hard
      g.lerpVectors(P.bS, CANDLE_BOY, smooth((t - CD_SWIM) / (CD_AT - CD_SWIM)));
      yaw = yawTo(P.bS, CANDLE_BOY);
      d.swim = 1;
      want = { l: "paddle", r: "paddle" };
    } else {
      g.copy(CANDLE_BOY);
      const toK = yawTo(CANDLE_BOY, DROP_POS);
      d.face = "open";
      if (t < CD_LIT + 0.4) {
        yaw = toK;
        want = { l: KARM.tread, r: KARM.reach };
      } else if (t < 10.0) {
        yaw = toK + wrapAngle(toCam - toK) * 0.5;
        want = { l: KARM.tread, r: KARM.up };
      } else {
        yaw = yawTo(CANDLE_BOY, TEACHER_POS);
        want = { l: KARM.tread, r: KARM.wave };
      }
    }
    g.y = BOY_Y + Math.sin(boy.t * 2.4) * 0.03;
    lighter.visible = t > CD_AT - 0.2 && t < 10.0;
    lighter.userData.flame.visible = t > CD_FLICK && t < CD_LIT + 0.5;
    d.want = want;
    turnBoy(yaw, dt);
    boyRipples(dt, d.swim > 0.5 ? 0.3 : 1.2);
  }
  function candlePerformance(P, k, t, dt) {
    applyGag(candleState(t));
    floatPerformance(P, k, floatTime(t, 5.9, CD_S));
    if (t >= FLOAT_ON_WATER && t < CD_BYE) holdKrathong(k, DROP_POS.x, DROP_POS.z);
    if (diver.script === k) candleBoy(P, k, t, dt);
    if (once(P, "out", t, CD_OUT)) {
      k.flame.getWorldPosition(exTmp);
      candleOut(k, true);
      puff(exTmp, { size: 0.05, grow: 3, life: 1.2, rise: 0.4, spread: 0.03, a: 0.6, color: 0x9a929a });
      sound.fizzle();
    }
    if (once(P, "gasp", t, 5.95)) sound.pop(0.12);
    if (once(P, "sob", t, 6.9)) sound.sob();
    if (once(P, "flick", t, CD_FLICK)) {
      lighter.userData.flame.getWorldPosition(exTmp);
      burst(exTmp, 8, { speed: 0.5, colors: [0xffd27a, 0xffffff], life: 0.3 });
      sound.ting(0.04);
    }
    if (once(P, "lit", t, CD_LIT)) {
      candleOut(k, false);
      k.flame.getWorldPosition(exTmp);
      burst(exTmp, 50, { speed: 1.4, colors: [0xfff3b0, 0xffd27a, 0xffb3e6, 0xffffff], life: 0.9 });
      ripple(DROP_POS.x, DROP_POS.z, 1.8);
      sound.chime();
    }
    if (once(P, "go", t, CD_BYE)) freeKrathong(k);
    // he's done: back to his coins
    if (once(P, "bye", t, CD_BYE + 0.4) && diver.script === k) {
      diver.script = null;
      lighter.visible = false;
    }
  }
  EXTRA.candle = {
    keys: CANDLE_KEYS,
    perform: candlePerformance,
    shot(pos, look, P) {
      if (P.t < 2.3 || P.t > 11.8) return defaultFloatShot(pos, look);
      riverSide(pos, look, (DROP_POS.x + CANDLE_BOY.x) / 2, (DROP_POS.z + CANDLE_BOY.z) / 2);
    },
    start(k) {
      diver.script = k;
      diver.goal = null;
      diver.grab = -1;
    },
    end(k) {
      if (diver.script === k) diver.script = null;
      diver.face = null;
      lighter.visible = false;
      k.stolen = false;
      candleOut(k, false);
    },
  };

  // ----- the turtle (float): while she wais the river, a turtle surfaces
  // right under her krathong and lifts it on its shell. She opens her
  // eyes: !! ... aww. It swims off out into the river carrying it, she
  // waves bye-bye, and out there it dives and leaves the krathong
  // floating. -----
  const TU_UP = 5.0;
  const TU_GO = 6.8;
  const TU_DIVE = 10.0;
  const TU_S = 3.6;
  const TU_TO = new THREE.Vector3(-0.4, 0, -0.9);
  const TU_SCALE = 2.2; // its shell well wider than a krathong, so it shows
  const TU_RIDE = 0.12 * TU_SCALE; // the krathong's height on its shell
  const turtle = (() => {
    const g = new THREE.Group();
    const { parts, add } = partList();
    add(new THREE.SphereGeometry(0.24, 18, 10, 0, TAU, 0, Math.PI / 2), "#4c8a3c", (d) => d.scale.set(1, 0.5, 1.2)); // shell
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * TAU;
      const r = i === 6 ? 0 : 0.13;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r * 1.2;
      const y = 0.12 * Math.sqrt(Math.max(0, 1 - (x / 0.24) ** 2 - (z / 0.288) ** 2));
      add(new THREE.SphereGeometry(0.055, 10, 6), "#6fae4c", (d) => { d.position.set(x, y - 0.01, z); d.scale.set(1, 0.3, 1); });
    }
    add(new THREE.TorusGeometry(0.24, 0.018, 6, 24), "#c7b36a", (d) => { d.scale.set(1, 1.2, 1); d.rotation.x = Math.PI / 2; }); // rim
    add(new THREE.SphereGeometry(0.07, 12, 10), "#8cc66a", (d) => d.position.set(0, 0.03, 0.34)); // head
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(0.014, 8, 6), "#1a1410", (d) => d.position.set(s * 0.032, 0.06, 0.395));
      add(new THREE.SphereGeometry(0.005, 6, 4), "#ffffff", (d) => d.position.set(s * 0.032 + 0.004, 0.066, 0.406));
      add(new THREE.SphereGeometry(0.01, 6, 4), "#ff8fb0", (d) => d.position.set(s * 0.05, 0.03, 0.39)); // cheeks
    }
    g.add(new THREE.Mesh(mergeParts(parts), propMat));
    const flip = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => {
      const piv = new THREE.Group();
      piv.position.set(sx * 0.2, 0, sz * 0.17);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6), new THREE.MeshToonMaterial({ color: 0x8cc66a, emissive: 0x18240c, gradientMap: softToonRamp() }));
      m.position.x = sx * 0.06;
      m.scale.set(1.4, 0.3, 0.7);
      piv.add(m);
      piv.userData.s = sx * sz;
      g.add(piv);
      return piv;
    });
    g.userData.flip = flip;
    g.scale.setScalar(TU_SCALE);
    g.visible = false;
    scene.add(g);
    return g;
  })();
  const TURTLE_KEYS = [
    ...FLOAT_KEYS.filter(([at]) => at < 5.9),
    [5.9, pose("clasp", "clasp", { hx: 0.3, yaw: FACE_WATER })], // !!
    [6.6, pose("heart", "heart", { hx: 0.2, hz: 0.12, yaw: FACE_WATER })], // aww
    [7.4, pose("clasp", "wave", { hz: -0.1, yaw: FACE_WATER - 0.2 })], // bye-bye!
    [9.4, pose("heart", "heart", { hz: 0.14, yaw: FACE_CAM })],
    ...FLOAT_KEYS.filter(([at]) => at >= 6.6).map(([at, p]) => [at + TU_S, p]),
  ];
  function turtleState(t) {
    const g = gagBase();
    if (t < 5.9 || t > 10.2) return g;
    if (t < 6.6) g.face = "huh";
    else if (t < 7.4) g.face = "shy";
    else g.face = "open";
    g.exclaim = pulse(t, 5.95, 0.8);
    return g;
  }
  function turtlePerformance(P, k, t, dt) {
    applyGag(turtleState(t));
    floatPerformance(P, k, floatTime(t, 5.9, TU_S));
    showHearts(t, 6.6, 9.4);
    const tp = turtle.position;
    turtle.visible = t > TU_UP - 0.1 && t < TU_DIVE + 0.7;
    let yaw = yawTo(DROP_POS, TEACHER_POS); // looking up at her
    if (t < TU_GO) {
      tp.set(DROP_POS.x, lerp(-0.7, 0, smooth(clamp01((t - TU_UP) / 0.5))) + Math.sin(t * 2) * 0.01, DROP_POS.z);
      if (t < TU_UP + 0.2) turtle.rotation.y = yaw;
    } else if (t < TU_DIVE) {
      // out into the river along a lazy curve
      const u = smooth((t - TU_GO) / (TU_DIVE - TU_GO));
      tp.lerpVectors(DROP_POS, TU_TO, u);
      tp.x += Math.sin(u * Math.PI) * 0.6;
      tp.y = Math.sin(t * 2) * 0.015;
      exTmp.lerpVectors(DROP_POS, TU_TO, Math.min(1, u + 0.02));
      exTmp.x += Math.sin(Math.min(1, u + 0.02) * Math.PI) * 0.6;
      yaw = u < 0.98 ? yawTo(tp, exTmp) : turtle.rotation.y;
    } else {
      tp.y = lerp(0, -0.7, smooth(clamp01((t - TU_DIVE) / 0.6)));
      yaw = turtle.rotation.y;
    }
    turtle.rotation.y += wrapAngle(yaw - turtle.rotation.y) * Math.min(1, dt * 3);
    const swim = t > TU_GO && t < TU_DIVE ? 1 : 0.3;
    for (const f of turtle.userData.flip) f.rotation.y = f.userData.s * Math.sin(t * 5) * 0.5 * swim;
    // riding on its shell (it rises under it, and settles back as it dives)
    if (t >= FLOAT_ON_WATER && t < TU_DIVE + 0.3) {
      const up = smooth(clamp01((t - TU_UP) / 0.5)) * (1 - smooth(clamp01((t - TU_DIVE) / 0.3)));
      const bob = Math.sin(clock * 1.4 + k.phase) * 0.025;
      holdKrathong(k, t < TU_UP ? DROP_POS.x : tp.x, t < TU_UP ? DROP_POS.z : tp.z, lerp(bob, TU_RIDE + tp.y, up));
    }
    if (once(P, "up", t, TU_UP)) {
      burst(exTmp.set(DROP_POS.x, 0.05, DROP_POS.z), 24, { speed: 1.0, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
      ripple(DROP_POS.x, DROP_POS.z, 1.4, 0xcfe8ff);
      sound.blub();
    }
    if (once(P, "gasp", t, 5.95)) sound.pop(0.12);
    if (once(P, "aww", t, 6.6)) sound.ting(0.05);
    if (once(P, "dive", t, TU_DIVE + 0.3)) {
      freeKrathong(k);
      ripple(tp.x, tp.z, 1.4, 0xcfe8ff);
      sound.plop();
    }
    if (t > TU_GO && t < TU_DIVE) {
      P.rip = (P.rip ?? 0) - dt;
      if (P.rip <= 0) {
        P.rip = 0.5;
        ripple(tp.x, tp.z, 0.9, 0xcfe8ff);
      }
    }
  }
  EXTRA.turtle = {
    keys: TURTLE_KEYS,
    perform: turtlePerformance,
    shot(pos, look, P) {
      if (P.t < 2.3 || P.t > 10.6) return defaultFloatShot(pos, look);
      const tp = P.t > TU_GO ? turtle.position : DROP_POS;
      riverSide(pos, look, tp.x, tp.z);
    },
    end(k) {
      turtle.visible = false;
      k.stolen = false;
      hideHearts();
    },
  };

  // ===== Moo Deng: a baby pygmy hippo who lives in the river. Like the
  // coin diver she swims about on her own, now and then pops over (or
  // waddles up the pier) to say hello to Kru Song, squeaks and bounces
  // when tapped, and four gags borrow her (moo.script, like diver.script).
  const MOO_S = 1.5;
  const MOO_SWIM = -0.22 * MOO_S; // swimming: head and back out of the water
  const MOO_UNDER = -0.9; // dived, out of sight
  const MOO_SPEED = 0.55;
  const MOO_HI = new THREE.Vector3(-1.9, 0, 2.2); // below Kru Song, to say hi
  // (on her river side, never between her and the camera)
  const MOO_CLIMB_W = new THREE.Vector3(-1.85, 0, 1.75); // where she climbs out ...
  const MOO_CLIMB_D = new THREE.Vector3(-2.45, PIER.top, 1.75); // ... onto the pier
  const MOO_NEAR = new THREE.Vector3(-2.64, PIER.top, 1.8); // beside Kru Song
  const moo = (() => {
    const g = new THREE.Group();
    const inner = new THREE.Group(); // bob, squash and the tap hop
    g.add(inner);
    const SKIN = "#8c7884";
    const DARK = "#77646f";
    const SNOUT = "#c9939f";
    const BELLY = "#d2a5b0";
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, emissive: 0x1c1418, gradientMap: softToonRamp() });
    const body = partList();
    body.add(new THREE.SphereGeometry(0.2, 28, 18), SKIN, (d) => { d.position.set(0, 0.2, -0.02); d.scale.set(1, 0.86, 1.22); });
    body.add(new THREE.SphereGeometry(0.17, 16, 10), BELLY, (d) => { d.position.set(0, 0.13, 0.0); d.scale.set(0.9, 0.6, 1.12); });
    body.add(new THREE.SphereGeometry(0.03, 8, 6), DARK, (d) => d.position.set(0, 0.24, -0.27)); // tail
    // the wet shine on her back
    body.add(new THREE.SphereGeometry(0.03, 10, 6), "#e8dce4", (d) => { d.position.set(0.05, 0.366, -0.04); d.rotation.y = 0.4; d.scale.set(1.6, 0.22, 0.7); });
    body.add(new THREE.SphereGeometry(0.015, 8, 6), "#e8dce4", (d) => { d.position.set(0.1, 0.352, 0.04); d.scale.set(1.2, 0.25, 1); });
    inner.add(new THREE.Mesh(mergeParts(body.parts), mat));
    // stubby legs, on hip pivots
    const legs = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz], i) => {
      const piv = new THREE.Group();
      piv.position.set(sx * 0.11, 0.12, sz * 0.13);
      const lp = partList();
      lp.add(new THREE.CylinderGeometry(0.058, 0.062, 0.13, 10), SKIN, (d) => (d.position.y = -0.06));
      lp.add(new THREE.SphereGeometry(0.062, 10, 6), DARK, (d) => { d.position.y = -0.125; d.scale.set(1, 0.3, 1); });
      piv.add(new THREE.Mesh(mergeParts(lp.parts), mat));
      piv.userData.ph = i % 3 ? Math.PI : 0; // diagonal pairs step together
      inner.add(piv);
      return piv;
    });
    // the big round head
    const head = new THREE.Group();
    head.position.set(0, 0.3, 0.17);
    inner.add(head);
    const hp = partList();
    hp.add(new THREE.SphereGeometry(0.165, 28, 20), SKIN, (d) => { d.position.set(0, 0.05, 0.04); d.scale.set(1.08, 0.95, 1); });
    hp.add(new THREE.SphereGeometry(0.105, 24, 16), SNOUT, (d) => { d.position.set(0, -0.035, 0.168); d.scale.set(1.32, 0.76, 0.92); }); // snout
    for (const s of [-1, 1]) {
      hp.add(new THREE.SphereGeometry(0.014, 8, 6), "#4a3a44", (d) => { d.position.set(s * 0.045, 0.012, 0.24); d.scale.set(1, 0.6, 0.6); }); // nostrils
      hp.add(new THREE.SphereGeometry(0.038, 12, 8), "#ff7f9c", (d) => { d.position.set(s * 0.12, 0.05, 0.158); d.rotation.y = s * 0.55; d.scale.set(1, 0.6, 0.35); }); // pink cheeks
    }
    head.add(new THREE.Mesh(mergeParts(hp.parts), mat));
    // little round ears that wiggle
    const ears = [-1, 1].map((s) => {
      const piv = new THREE.Group();
      piv.position.set(s * 0.1, 0.19, -0.01);
      const ep = partList();
      ep.add(new THREE.SphereGeometry(0.042, 10, 8), SKIN, (d) => d.scale.set(1, 0.85, 0.6));
      ep.add(new THREE.SphereGeometry(0.026, 8, 6), "#e7a3b3", (d) => { d.position.z = 0.016; d.scale.set(1, 0.85, 0.5); });
      piv.add(new THREE.Mesh(mergeParts(ep.parts), mat));
      piv.userData.s = s;
      head.add(piv);
      return piv;
    });
    // big, low, round eyes (squashed flat to blink or sleep)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1216 });
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyes = [-1, 1].map((s) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), eyeMat);
      e.position.set(s * 0.072, 0.1, 0.178);
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), glintMat);
      gl.position.set(0.012, 0.014, 0.027);
      e.add(gl);
      e.userData.glint = gl;
      head.add(e);
      return e;
    });
    // the lower jaw opens: pink mouth, two baby teeth
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.07, 0.1);
    head.add(jaw);
    const jp = partList();
    jp.add(new THREE.SphereGeometry(0.1, 14, 10), SNOUT, (d) => { d.position.set(0, -0.025, 0.07); d.scale.set(1.2, 0.45, 0.95); });
    jp.add(new THREE.SphereGeometry(0.085, 14, 10), "#d9566f", (d) => { d.position.set(0, 0.0, 0.07); d.scale.set(1.05, 0.3, 0.85); });
    for (const s of [-1, 1]) jp.add(new THREE.BoxGeometry(0.018, 0.03, 0.018), "#ffffff", (d) => d.position.set(s * 0.06, 0.012, 0.14));
    jaw.add(new THREE.Mesh(mergeParts(jp.parts), mat));
    // a sleepy bubble at her nose (the wish gag)
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), new THREE.MeshToonMaterial({ color: 0xd8f2ff, emissive: 0x2a3a4a, transparent: true, opacity: 0.6, depthWrite: false }));
    bubble.position.set(0.04, 0.01, 0.275);
    bubble.visible = false;
    head.add(bubble);
    // ... and her own Zzz
    const zs = [0, 1, 2].map(() => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false }));
      m.visible = false;
      g.add(m);
      return m;
    });
    Object.assign(g.userData, { inner, legs, head, ears, eyes, jaw, bubble, zs });
    g.scale.setScalar(MOO_S);
    scene.add(g);
    return g;
  })();
  // (rear: up on her hind legs, nose to the sky, 0..1)
  const mooBase = () => ({ mouth: 0, eyes: 0, hx: 0, hy: 0, hz: 0, ears: 0, squash: 0, paddle: 0, walk: 0, rear: 0 });
  const mooSt = {
    script: null, // a gag is driving her
    goal: null,
    wait: 2,
    visit: null, // { kind: "water" | "deck", phase, t }
    nextVisit: 18, // (clock time) the first hello comes early
    tapT: -1,
    yaw: 0,
    blinkAt: 2,
    rippleT: 0,
    stride: 0,
    t: 0,
    want: mooBase(),
    cur: mooBase(),
  };
  const mooTmp = new THREE.Vector3();
  const mooTmp2 = new THREE.Vector3();
  {
    randomSpot(moo.position, false);
    moo.position.y = MOO_SWIM;
  }
  // an arc from a to b, h high at the top (u = 0..1)
  function hopArc(out, a, b, u, h) {
    out.lerpVectors(a, b, u);
    out.y += Math.sin(clamp01(u) * Math.PI) * h;
    return out;
  }
  // a point on her, in world space (local head / jaw coordinates)
  const mooMouth = (out) => moo.userData.jaw.localToWorld(out.set(0, -0.02, 0.17));
  const mooHead = (out) => moo.userData.head.localToWorld(out.set(0, 0.08, 0.1));
  function mooFace(p) {
    mooSt.yaw = Math.atan2(p.x - moo.position.x, p.z - moo.position.z);
  }
  function mooRipples(dt, every) {
    mooSt.rippleT -= dt;
    if (mooSt.rippleT > 0) return;
    mooSt.rippleT = every;
    const g = moo.position;
    if (g.y < 0.05 && g.y > MOO_UNDER + 0.3) ripple(g.x, g.z, 0.9, 0xcfe8ff);
  }
  // swim (or walk) toward p at speed; true once there
  function mooGo(p, speed, dt) {
    const g = moo.position;
    const dx = p.x - g.x;
    const dz = p.z - g.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const step = Math.min(d, speed * dt);
    g.x += (dx / d) * step;
    g.z += (dz / d) * step;
    mooSt.yaw = Math.atan2(dx, dz);
    return false;
  }
  // is Kru Song free for a hello?
  const herFree = () => !performing && !queue.length && !poke && idleComb == null;
  function mooGreet(kind) {
    if (!herFree()) return false;
    poke = { kind, t: 0 };
    idleFor = 0;
    return true;
  }
  // free time: swim about, float a while, and now and then pop over to
  // say hello
  function mooRoam(dt) {
    const s = mooSt;
    if (s.script) return;
    const g = moo.position;
    const w = (s.want = mooBase());
    s.t += dt;
    const busy = performing || queue.length;
    // a hello is due: off she goes (not while a gag runs or waits)
    if (!s.visit && !busy && clock > s.nextVisit && herFree() && !document.body.classList.contains("sheet-open") && g.y < 0.1) {
      s.visit = { kind: Math.random() < 0.4 ? "deck" : "water", phase: "go", t: 0 };
    }
    const v = s.visit;
    if (v) {
      v.t += dt;
      const onDeck = g.y > 0.2;
      // something started: cut the hello short
      if (busy && v.phase !== "back" && v.phase !== "hopdown" && v.phase !== "leave") {
        v.phase = onDeck ? "back" : "leave";
        v.t = 0;
      }
      const to = v.kind === "deck" ? MOO_CLIMB_W : MOO_HI;
      // far away: duck under and come up a few metres out, so a hello never
      // keeps Kru Song waiting (the idle counter holds while it runs)
      if (v.phase === "go" && v.t < dt * 1.5 && Math.hypot(g.x - to.x, g.z - to.z) > 5.5) v.phase = "dive";
      if (v.phase === "dive") {
        g.y = lerp(MOO_SWIM, MOO_UNDER, smooth(clamp01(v.t / 0.6)));
        if (v.t >= 0.6) {
          mooTmp.set(g.x - to.x, 0, g.z - to.z).normalize().multiplyScalar(4);
          g.set(to.x + mooTmp.x, MOO_UNDER, to.z + mooTmp.z);
          v.phase = "go";
          v.t = 0.5;
        }
      } else if (v.phase === "go") {
        g.y += (MOO_SWIM - g.y) * Math.min(1, dt * 2);
        w.paddle = 1;
        if (mooGo(to, 1.3, dt) || v.t > 25) {
          v.phase = v.kind === "deck" ? "hopup" : "hi";
          v.t = 0;
          if (v.phase === "hopup") v.from = g.clone();
        }
        mooRipples(dt, 0.35);
      } else if (v.phase === "hi") {
        // two happy bounces and a squeak; she waves back
        mooFace(TEACHER_POS);
        const u = v.t;
        const hop = u < 1.6 ? Math.abs(Math.sin((u / 0.8) * Math.PI)) * 0.3 : 0;
        g.y = MOO_SWIM + hop + Math.sin(s.t * 2) * 0.015;
        w.mouth = u > 0.15 && u < 1.2 ? 0.8 : 0;
        w.ears = 1;
        w.hx = -0.25;
        w.hz = u > 1.8 ? Math.sin(u * 3) * 0.2 : 0;
        w.squash = hop < 0.03 && u < 1.6 ? 0.5 : 0;
        if (once(v, "sq", u, 0.2)) {
          sound.squeak(0.07);
          mooGreet("greet");
        }
        for (const at of [0.8, 1.6]) if (once(v, "rip" + at, u, at)) ripple(g.x, g.z, 1.0, 0xcfe8ff);
        if (u > 3.4) {
          v.phase = "leave";
          v.t = 0;
        }
      } else if (v.phase === "hopup") {
        const u = clamp01(v.t / 0.7);
        hopArc(g, v.from, MOO_CLIMB_D, smooth(u), 0.45);
        mooFace(MOO_CLIMB_D);
        w.squash = u < 0.15 ? 0.7 : 0;
        if (once(v, "jump", v.t, 0.05)) {
          ripple(v.from.x, v.from.z, 1.2, 0xcfe8ff);
          burst(mooTmp.set(v.from.x, 0.05, v.from.z), 16, { speed: 0.8, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
          sound.boing();
        }
        if (u >= 1) {
          v.phase = "walk";
          v.t = 0;
        }
      } else if (v.phase === "walk") {
        g.y = PIER.top;
        w.walk = 1;
        if (mooGo(MOO_NEAR, 0.4, dt)) {
          v.phase = "nuzzle";
          v.t = 0;
        }
      } else if (v.phase === "nuzzle") {
        // she rubs her cheek on Kru Song's leg, who crouches to pat her
        g.y = PIER.top;
        mooFace(TEACHER_POS);
        const u = v.t;
        w.hx = -0.35;
        w.hz = Math.sin(u * 4) * 0.25;
        w.eyes = u > 0.8 && u < 3.0 ? 1 : 0;
        w.ears = 1;
        if (once(v, "sq", u, 0.15)) {
          sound.squeak(0.06, 1.1);
          mooGreet("pat");
        }
        if (once(v, "sq2", u, 2.2)) sound.squeak(0.05, 1.25);
        if (u > 3.6) {
          v.phase = "back";
          v.t = 0;
        }
      } else if (v.phase === "back") {
        g.y = PIER.top;
        w.walk = 1;
        if (mooGo(MOO_CLIMB_D, 0.5, dt)) {
          v.phase = "hopdown";
          v.t = 0;
          v.from = g.clone();
        }
      } else if (v.phase === "hopdown") {
        const u = clamp01(v.t / 0.7);
        mooTmp2.set(MOO_CLIMB_W.x + 0.2, MOO_SWIM, MOO_CLIMB_W.z - 0.1);
        hopArc(g, v.from, mooTmp2, smooth(u), 0.4);
        mooFace(mooTmp2);
        if (u >= 1 && once(v, "splash", v.t, 0.7)) {
          ripple(g.x, g.z, 1.6, 0xcfe8ff);
          burst(mooTmp.set(g.x, 0.05, g.z), 26, { speed: 1.0, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
          sound.plop();
          v.phase = "leave";
          v.t = 0;
        }
      } else {
        // done: back to roaming, and the next hello in a while
        s.visit = null;
        s.goal = null;
        s.wait = 0;
        s.nextVisit = clock + rand(25, 45);
      }
    } else {
      // roaming the river, clear of the pier while she's busy with a gag
      g.y += (MOO_SWIM + Math.sin(s.t * 2) * 0.015 - g.y) * Math.min(1, dt * 1.5);
      if (g.y > 0.2) g.y = MOO_SWIM; // (never left standing on the deck)
      let moving = false;
      if (s.goal) {
        moving = !mooGo(s.goal, MOO_SPEED, dt);
        if (!moving) {
          s.goal = null;
          s.wait = rand(2.5, 6);
        }
        w.paddle = moving ? 1 : 0;
      } else {
        // floating: looks about, wiggles her ears, the odd yawn
        s.wait -= dt;
        w.hy = Math.sin(s.t * 0.7) * 0.4;
        w.ears = Math.sin(s.t * 0.9) > 0.85 ? 1 : 0;
        if (Math.sin(s.t * 0.37) > 0.97) {
          w.mouth = 1;
          w.eyes = 0.7;
          w.hx = -0.3;
        }
        if (s.wait <= 0) {
          s.goal = new THREE.Vector3();
          for (let i = 0; i < 12; i++) {
            randomSpot(s.goal, false);
            if (Math.hypot(s.goal.x - g.x, s.goal.z - g.z) < 9) break;
          }
        }
      }
      // keep clear of the coin diver
      const b = boy.group.position;
      const bd = Math.hypot(g.x - b.x, g.z - b.z);
      if (bd < 1.1 && bd > 0.001) {
        g.x += ((g.x - b.x) / bd) * (1.1 - bd) * dt * 2;
        g.z += ((g.z - b.z) / bd) * (1.1 - bd) * dt * 2;
      }
      if (busy && inPierZone(g.x, g.z)) {
        s.goal = mooTmp2.set(-0.1, 0, Math.min(g.z, 1.2)).clone();
      }
      mooRipples(dt, moving ? 0.4 : 1.4);
    }
  }
  // her body, from s.want (eased), every frame
  function mooPose(dt) {
    const s = mooSt;
    const u = moo.userData;
    const c = s.cur;
    const w = s.want;
    const k = 1 - Math.exp(-dt * 9);
    for (const f of ["mouth", "eyes", "hx", "hy", "hz", "squash", "paddle", "walk", "rear"]) c[f] += (w[f] - c[f]) * k;
    // the tap: a squeaky hop
    let hop = 0;
    if (s.tapT >= 0) {
      s.tapT += dt;
      const v = s.tapT / 0.75;
      hop = v < 1 ? Math.sin(v * Math.PI) * 0.22 : 0;
      c.mouth = Math.max(c.mouth, v < 0.8 ? 0.9 : 0);
      if (v >= 1.3) s.tapT = -1;
    }
    s.blinkAt -= dt;
    if (s.blinkAt < -0.13) s.blinkAt = rand(2, 5);
    const shut = Math.max(c.eyes, s.blinkAt < 0 ? 1 : 0);
    for (const e of u.eyes) {
      e.scale.y = 1 - 0.85 * shut;
      e.userData.glint.visible = shut < 0.5;
    }
    u.jaw.rotation.x = c.mouth * 0.75;
    u.head.rotation.set(c.hx + Math.sin(s.t * 0.9) * 0.03, c.hy, c.hz);
    const wig = s.tapT >= 0 ? 1 : w.ears;
    for (const e of u.ears) e.rotation.z = e.userData.s * (0.15 + Math.sin(s.t * 20) * 0.4 * wig);
    s.stride += dt * (c.walk * 9 + c.paddle * 7);
    for (const l of u.legs) l.rotation.x = Math.sin(s.stride + l.userData.ph) * (0.55 * c.walk + 0.6 * c.paddle);
    const sq = c.squash;
    const breathe = Math.sin(s.t * 1.8) * 0.015;
    u.inner.scale.set(1 + sq * 0.12, 1 - sq * 0.2 + breathe, 1 + sq * 0.12);
    u.inner.position.y = hop / MOO_S + Math.abs(Math.sin(s.stride)) * 0.02 * c.walk;
    u.inner.rotation.x = -0.85 * c.rear;
    moo.rotation.y += wrapAngle(s.yaw - moo.rotation.y) * Math.min(1, dt * 5);
    moo.visible = moo.position.y > MOO_UNDER + 0.05;
  }
  // a tap on her: a squeaky hop, hearts (not while a gag has her)
  function hitMoo(cx, cy) {
    if (!moo.visible) return false;
    if (raycaster.intersectObject(moo, true).length) return true;
    moo.userData.head.getWorldPosition(mooTmp).project(camera);
    if (mooTmp.z > 1) return false;
    const x = ((mooTmp.x + 1) / 2) * innerWidth;
    const y = ((1 - mooTmp.y) / 2) * innerHeight;
    return Math.hypot(cx - x, cy - y) < 28;
  }
  function tapMoo() {
    if (mooSt.script || mooSt.tapT >= 0) return mooSt.tapT >= 0;
    mooSt.tapT = 0;
    sound.squeak(0.08, 1.15);
    mooHead(mooTmp);
    burst(mooTmp, 18, { speed: 0.8, colors: [0xff7fb0, 0xffc2dc, 0xffffff], life: 0.6, up: 0.8 });
    if (moo.position.y < 0.1) ripple(moo.position.x, moo.position.z, 1.0, 0xcfe8ff);
    return true;
  }
  function showMooZzz(t, from, to) {
    moo.userData.zs.forEach((m, i) => {
      const v = t - from - i * 0.6;
      const u = (v % 1.8) / 1.8;
      const on = t < to && v > 0;
      m.visible = on;
      if (!on) return;
      m.position.set(-0.05 + u * 0.14, 0.62 + u * 0.3, 0.15);
      m.scale.setScalar(0.07 + 0.06 * u);
      m.material.opacity = Math.sin(u * Math.PI);
    });
  }
  // a gag takes her: wherever she is, she ducks under first (so she never
  // jumps across the river in plain sight); true while still diving
  function mooDive(P, t, len = 0.6) {
    if (!P.mooFrom) P.mooFrom = moo.position.clone();
    if (t >= len) return false;
    const f = P.mooFrom;
    const u = smooth(t / len);
    if (f.y > 0.2) {
      // (she was up on the pier: a hop off into the water)
      hopArc(moo.position, f, mooTmp.set(MOO_CLIMB_W.x, MOO_UNDER, MOO_CLIMB_W.z), u, 0.4);
    } else moo.position.set(f.x, lerp(f.y, MOO_UNDER, u), f.z);
    if (once(P, "mooDive", t, 0)) ripple(f.x, f.z, 1.1, 0xcfe8ff);
    return true;
  }
  const mooClaim = (k) => {
    mooSt.script = k;
    mooSt.visit = null;
    mooSt.nextVisit = Math.max(mooSt.nextVisit, clock + rand(20, 35)); // (no hello straight after a gag)
    mooSt.tapT = -1;
    mooSt.want = mooBase();
  };
  function mooRelease(k) {
    if (mooSt.script !== k) return;
    mooSt.script = null;
    mooSt.goal = null;
    mooSt.wait = 0.5;
    mooSt.want = mooBase();
    moo.userData.bubble.visible = false;
    for (const m of moo.userData.zs) m.visible = false;
    if (moo.position.y > 0.2) moo.position.y = MOO_UNDER; // (never left on the deck)
  }
  Object.assign(ARM, {
    akimbo: { x: 0.15, o: 0.7, e: -1.75 }, // hands on hips
    pat: { x: -1.05, o: -0.1, e: -0.45, w: 1 }, // patting someone small
  });

  // ----- Moo Deng rides by (float): while Kru Song wais the river, a
  // little krathong comes drifting past with Moo Deng sitting in it,
  // bouncing, bouncing. It stops in front of the pier, she turns to Kru
  // Song and gives an enormous yawn (aww!), smacks her lips, then hops off
  // with a splash and the little krathong drifts on. -----
  const RD_S = 6.0;
  const RD_P0 = new THREE.Vector3(1.3, 0, 3.0);
  const RD_P1 = new THREE.Vector3(-1.7, 0, 2.6);
  const RD_P2 = new THREE.Vector3(-0.2, 0, 0.9);
  const RD_IN = 8.4; // stops in front of her
  const RD_YAWN = 8.9;
  const RD_OUT = 10.6; // drifts on
  const RD_HOP = 11.6; // ... and she hops off
  const RD_RIDE = 0.2; // how high she sits on it
  const yawRide = yawTo(TEACHER_POS, RD_P1);
  const RIDE_KEYS = [
    ...FLOAT_KEYS.filter(([at]) => at < 5.9),
    [5.9, pose("clasp", "clasp", { hx: 0.25, hz: 0.12, yaw: yawTo(TEACHER_POS, RD_P0) })], // huh? what's that
    [7.4, pose("clasp", "clasp", { hx: 0.28, yaw: yawRide })],
    [RD_YAWN + 0.4, pose("heart", "heart", { hx: 0.2, hz: 0.12, yaw: yawRide })], // aww
    [RD_OUT, pose("clasp", "wave", { hz: -0.1, yaw: yawRide })], // bye-bye!
    ...FLOAT_KEYS.filter(([at]) => at >= 6.6).map(([at, p]) => [at + RD_S, p]),
  ];
  function rideState(t) {
    const g = gagBase();
    if (t < 5.9 || t > 12.4) return g;
    if (t < 6.4) g.face = "huh";
    else if (t < RD_YAWN + 0.4) g.face = "open";
    else if (t < RD_OUT) g.face = Math.floor(t * 6) % 2 ? "shy" : "blink";
    else g.face = "open";
    g.exclaim = pulse(t, 5.95, 0.8);
    if (t > RD_YAWN + 0.4 && t < RD_OUT) g.bob = Math.abs(Math.sin(t * 9)) * 0.015;
    return g;
  }
  function ridePerformance(P, k, t, dt) {
    applyGag(rideState(t));
    floatPerformance(P, k, floatTime(t, 5.9, RD_S));
    sendOut(P, k, t);
    showHearts(t, RD_YAWN + 0.4, RD_OUT + 0.6);
    const w = (mooSt.want = mooBase());
    if (mooDive(P, t)) return;
    if (t < 5.6) {
      moo.position.y = MOO_UNDER;
      return;
    }
    // the little krathong: a real NPC one, so it just floats on after
    if (!P.rk) {
      P.rk = spawnSimple(RD_P0.x, RD_P0.z, false);
      P.rk.root.scale.setScalar(0.75);
      P.rk.stolen = true;
      k.mooRide = P.rk;
    }
    const rk = P.rk;
    const kp = mooTmp;
    if (t < RD_IN) kp.lerpVectors(RD_P0, RD_P1, smooth((t - 5.6) / (RD_IN - 5.6)));
    else if (t < RD_OUT) kp.copy(RD_P1);
    else kp.lerpVectors(RD_P1, RD_P2, smooth(clamp01((t - RD_OUT) / 2.4)));
    // bounce, bounce (paused while she yawns)
    const bouncing = t < RD_IN + 0.3 || (t > RD_OUT - 0.2 && t < RD_HOP);
    const hop = bouncing ? Math.abs(Math.sin(t * 4.4)) * 0.11 : 0;
    const bob = Math.sin(clock * 1.4 + rk.phase) * 0.02;
    if (rk.stolen) holdKrathong(rk, kp.x, kp.z, bob - (bouncing && hop < 0.03 ? 0.03 : 0));
    if (t < RD_HOP) {
      moo.position.set(kp.x, rk.root.position.y + RD_RIDE + hop, kp.z);
      w.squash = bouncing && hop < 0.025 ? 0.6 : 0;
      if (t < RD_IN - 0.3) mooSt.yaw = yawTo(moo.position, camera.position) + Math.sin(t * 1.3) * 0.6; // looking about as she drifts
      else if (t > RD_YAWN - 0.4 && t < RD_YAWN + 1.9) mooFace(camera.position); // the yawn, for everyone to see
      else mooFace(TEACHER_POS);
      w.ears = bouncing ? 1 : 0;
      if (t > RD_YAWN && t < RD_YAWN + 1.2) {
        // a huge yawn
        w.mouth = 1;
        w.eyes = 0.8;
        w.hx = -0.4;
      } else if (t > RD_YAWN + 1.2 && t < RD_YAWN + 1.7) {
        w.mouth = Math.abs(Math.sin((t - RD_YAWN - 1.2) * 19)) * 0.4; // smack smack
        w.eyes = 1;
      }
    } else {
      // hop off into the river with a splash, then swim off under
      if (!P.hopFrom) P.hopFrom = moo.position.clone();
      const u = clamp01((t - RD_HOP) / 0.7);
      hopArc(moo.position, P.hopFrom, mooTmp2.set(P.hopFrom.x - 0.5, MOO_SWIM, P.hopFrom.z + 0.45), smooth(u), 0.45);
      if (u >= 1) moo.position.y = lerp(MOO_SWIM, MOO_UNDER, smooth(clamp01((t - RD_HOP - 1.4) / 0.6)));
      w.paddle = u >= 1 ? 1 : 0;
      w.mouth = u < 1 ? 0.7 : 0;
    }
    if (once(P, "rkIn", t, 5.65)) ripple(RD_P0.x, RD_P0.z, 1.2, 0xcfe8ff);
    if (bouncing && hop < 0.02 && clock - (P.lastBoing ?? -9) > 0.5) {
      P.lastBoing = clock;
      sound.pop(0.05);
      ripple(kp.x, kp.z, 0.8, 0xcfe8ff);
    }
    if (once(P, "gasp", t, 5.95)) sound.pop(0.12);
    if (once(P, "yawn", t, RD_YAWN)) sound.squeak(0.06, 0.7);
    if (once(P, "aww", t, RD_YAWN + 0.45)) sound.giggle();
    if (once(P, "sq", t, RD_OUT - 0.3)) sound.squeak(0.07);
    if (once(P, "hop", t, RD_HOP)) sound.boing();
    if (once(P, "splash", t, RD_HOP + 0.7)) {
      ripple(moo.position.x, moo.position.z, 1.8, 0xcfe8ff);
      burst(mooTmp2.set(moo.position.x, 0.05, moo.position.z), 30, { speed: 1.1, colors: [0xbfe6ff, 0xffffff], life: 0.55 });
      sound.plop();
      freeKrathong(rk, 0.4, -0.7);
      randomSpot(rk.target, true);
    }
  }
  EXTRA.mdride = {
    keys: RIDE_KEYS,
    perform: ridePerformance,
    shot(pos, look, P) {
      if (P.t < 5.7 || P.t > 12.6) return defaultFloatShot(pos, look);
      riverSide(pos, look, moo.position.x, moo.position.z);
    },
    start: mooClaim,
    end(k) {
      mooRelease(k);
      if (k.mooRide?.stolen) {
        freeKrathong(k.mooRide, 0.4, -0.7);
        randomSpot(k.mooRide.target, true);
      }
      k.mooRide = null;
      hideHearts();
    },
  };

  // ----- bounce bounce SPLASH (idle): Moo Deng pops up below the pier
  // and bounces on the water, one, two, three (Kru Song claps along),
  // then a huge jump... belly flop! Kru Song gets soaked, freezes, then
  // bursts out laughing; Moo Deng squeaks, pleased with herself, and
  // swims off. -----
  const SP_SPOT = new THREE.Vector3(-1.65, 0, 1.85);
  const SP_UP = 1.0;
  const SP_HOPS = [2.2, 3.0, 3.8];
  const SP_JUMP = 4.8;
  const SP_FLOP = 5.6;
  const SP_GO = 8.8;
  const yawSp = yawTo(TEACHER_POS, SP_SPOT) * 0.6 + FACE_CAM * 0.4; // (half toward the camera)
  const SPLASH_KEYS = [
    [0, IDLE],
    [1.3, pose("clasp", "clasp", { hx: 0.18, yaw: yawSp })], // huh?
    [2.3, pose("clap", "clap", { hx: 0.05, yaw: yawSp })], // one, two, three!
    [4.4, pose("clasp", "clasp", { hx: -0.2, yaw: yawSp })], // ooh, a big one
    [SP_FLOP, pose("shock", "shock", { rise: 0.04, hx: -0.05, yaw: yawSp })], // SPLOSH
    [6.9, pose("heart", "heart", { hx: 0.1, hz: 0.12, yaw: yawSp })], // ahahaha
    [SP_GO, pose("clasp", "wave", { hz: -0.12, yaw: yawSp })],
    [10.2, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [11.0, null],
  ];
  function splashState(t) {
    const g = gagBase();
    if (t > 1.3 && t < 2.3) g.face = "huh";
    else if (t >= 2.3 && t < 4.4) g.face = "open";
    else if (t >= 4.4 && t < SP_FLOP) g.face = "open";
    else if (t >= SP_FLOP && t < 6.1) g.face = "wince";
    else if (t >= 6.1 && t < 6.9) g.face = "huh";
    else if (t >= 6.9 && t < 8.6) g.face = Math.floor(t * 7) % 2 ? "open" : "blink";
    g.question = pulse(t, 1.35, 0.9);
    g.exclaim = pulse(t, SP_FLOP + 0.1, 0.7);
    for (const at of SP_HOPS) if (t > at && t < at + 0.6) g.bob = Math.sin(((t - at) / 0.6) * Math.PI) * 0.02;
    if (t > SP_FLOP && t < SP_FLOP + 0.35) g.shake = Math.sin(t * 70) * 0.01;
    if (t > 6.9 && t < 8.6) g.bob = Math.abs(Math.sin((t - 6.9) * 9)) * 0.025;
    g.wet = t < SP_FLOP + 0.05 ? 0 : 0.8 * (1 - smooth(clamp01((t - 8.6) / 1.8)));
    g.drops = t < SP_FLOP + 0.1 ? 0 : 1 - smooth(clamp01((t - 8.4) / 1.6));
    return g;
  }
  function splashPerformance(P, k, t, dt) {
    applyGag(splashState(t));
    const w = (mooSt.want = mooBase());
    if (mooDive(P, t)) return;
    const g = moo.position;
    mooFace(TEACHER_POS);
    if (t < SP_UP) g.set(SP_SPOT.x, MOO_UNDER, SP_SPOT.z);
    else if (t < SP_JUMP - 0.3) {
      g.set(SP_SPOT.x, lerp(MOO_UNDER, MOO_SWIM, smooth(clamp01((t - SP_UP) / 0.4))), SP_SPOT.z);
      for (const at of SP_HOPS) {
        if (t > at && t < at + 0.6) {
          const u = (t - at) / 0.6;
          g.y = MOO_SWIM + Math.sin(u * Math.PI) * 0.35;
          w.ears = 1;
          w.mouth = 0.5;
        }
        if (t > at + 0.55 && t < at + 0.75) w.squash = 0.6;
      }
      w.hx = -0.2;
    } else if (t < SP_JUMP) {
      g.set(SP_SPOT.x, MOO_SWIM - 0.06, SP_SPOT.z); // crouch...
      w.squash = 1;
    } else if (t < SP_FLOP) {
      // ... and up, up, toward her, and down
      const u = (t - SP_JUMP) / (SP_FLOP - SP_JUMP);
      g.set(lerp(SP_SPOT.x, SP_SPOT.x - 0.25, u), MOO_SWIM + Math.sin(u * Math.PI) * 1.05, SP_SPOT.z);
      w.mouth = 0.9;
      w.ears = 1;
      w.hx = lerp(-0.4, 0.3, u);
    } else if (t < SP_GO) {
      // under, then pops back up, very pleased with herself
      const x = SP_SPOT.x - 0.25;
      if (t < 6.3) g.set(x, MOO_UNDER + 0.2, SP_SPOT.z);
      else g.set(x, lerp(MOO_UNDER + 0.2, MOO_SWIM, smooth(clamp01((t - 6.3) / 0.35))) + Math.sin(t * 5) * 0.02, SP_SPOT.z);
      w.mouth = t > 6.6 && t < 7.4 ? 0.8 : 0;
      w.eyes = t > 7.4 && t < 8.4 ? 1 : 0; // a happy squint
      w.ears = 1;
      w.hz = Math.sin(t * 4) * 0.15;
    } else {
      // off she swims, then dives
      const u = clamp01((t - SP_GO) / 1.8);
      g.set(lerp(SP_SPOT.x - 0.25, 0.1, smooth(u)), MOO_SWIM, lerp(SP_SPOT.z, 0.9, smooth(u)));
      if (t > 10.0) g.y = lerp(MOO_SWIM, MOO_UNDER, smooth(clamp01((t - 10.0) / 0.6)));
      mooSt.yaw = yawTo(SP_SPOT, mooTmp.set(0.1, 0, 0.9));
      w.paddle = 1;
      if (t < 10.0) mooRipples(dt, 0.35);
    }
    if (once(P, "up", t, SP_UP)) {
      ripple(SP_SPOT.x, SP_SPOT.z, 1.3, 0xcfe8ff);
      sound.blub();
    }
    if (once(P, "huh", t, 1.35)) sound.pop(0.08);
    SP_HOPS.forEach((at, i) => {
      if (once(P, "hop" + i, t, at)) sound.squeak(0.05, 1 + i * 0.12);
      if (once(P, "land" + i, t, at + 0.6)) {
        ripple(SP_SPOT.x, SP_SPOT.z, 1.1, 0xcfe8ff);
        sound.pop(0.06);
      }
    });
    if (once(P, "jump", t, SP_JUMP)) {
      burst(mooTmp.set(SP_SPOT.x, 0.05, SP_SPOT.z), 20, { speed: 0.9, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
      sound.boing();
    }
    if (once(P, "flop", t, SP_FLOP)) {
      const x = SP_SPOT.x - 0.25;
      ripple(x, SP_SPOT.z, 2.2, 0xcfe8ff);
      ripple(x, SP_SPOT.z, 3.2, 0xcfe8ff);
      burst(mooTmp.set(x, 0.1, SP_SPOT.z), 90, { speed: 2.4, colors: [0xbfe6ff, 0xffffff, 0x9fd6ff], life: 0.85, up: 1.8 });
      burst(mooTmp.set(x, 0.3, SP_SPOT.z), 60, { speed: 1.4, colors: [0xffffff, 0xd8f2ff], life: 1.0, up: 2.6 });
      for (let i = 0; i < 4; i++) puff(mooTmp.set(x + rand(-0.3, 0.3), 0.15, SP_SPOT.z + rand(-0.3, 0.3)), { size: 0.25, grow: 2.2, life: 0.7, rise: 0.4, spread: 0.2, a: 0.55, color: 0xeaf6ff });
      sound.splash();
    }
    // a sheet of water flying at her
    if (t > SP_FLOP && t < SP_FLOP + 0.35) {
      P.spray = (P.spray ?? 0) - dt;
      if (P.spray <= 0) {
        P.spray = 0.04;
        teacher.head.getWorldPosition(mooTmp2);
        const u = (t - SP_FLOP) / 0.35;
        mooTmp.set(SP_SPOT.x - 0.25, 0.2, SP_SPOT.z).lerp(mooTmp2, u);
        burst(mooTmp, 10, { speed: 0.7, colors: [0xbfe6ff, 0xffffff], life: 0.45 });
      }
    }
    if (once(P, "eek", t, SP_FLOP + 0.15)) sound.eek(0.08);
    if (once(P, "sq", t, 6.6)) sound.squeak(0.08, 1.1);
    if (once(P, "haha", t, 6.95)) sound.giggle();
    if (once(P, "bye", t, SP_GO)) sound.squeak(0.06, 1.2);
  }
  // both of them side by side, from the river side, room for the big jump
  function splashShot(pos, look) {
    riverSide(pos, look, SP_SPOT.x, SP_SPOT.z, 3.9, 0.85);
    look.y = 1.05;
  }
  EXTRA.mdsplash = {
    keys: SPLASH_KEYS,
    perform: splashPerformance,
    shot: splashShot,
    start: mooClaim,
    end: mooRelease,
  };

  // ----- tug of war (float): as Kru Song kneels to set her krathong on
  // the water, Moo Deng surfaces and chomps the other side of it. A tug
  // of war! Moo Deng wins, Kru Song sits back with a bump, hands on hips,
  // while Moo Deng swims off with it in her mouth, sets it down out on the
  // river herself, squeaks (cheeky) and dives. Kru Song can't help
  // laughing, and waves to her krathong. -----
  const TG_HOLD = 3.3; // her krathong stops in her hands here
  const TG_UP = 3.4;
  const TG_BITE = 4.0;
  const TG_PULL = 4.6;
  const TG_WIN = 7.0;
  const TG_DROP = 9.8; // Moo Deng lets go of it, out on the water
  const TG_TO = new THREE.Vector3(-0.5, 0, 1.0);
  const tugBack = pose("reach", "reach", { dip: 0.2, lean: -0.04, hx: 0.25, yaw: FACE_WATER });
  const tugFwd = pose("reach", "reach", { dip: 0.22, lean: 0.26, hx: 0.45, yaw: FACE_WATER });
  // she's dragged toward the end of the pier, heave by heave, and slides
  // back on her bottom when she loses
  const tugPos = new THREE.Vector3();
  function tugDrag(t) {
    if (t < TG_PULL || t > TG_WIN + 0.8) return null;
    let d;
    if (t < TG_WIN) d = smooth((t - TG_PULL) / (TG_WIN - TG_PULL)) * 0.42 + Math.max(0, Math.sin(((t - TG_PULL) / 0.8) * TAU)) * 0.05;
    else d = 0.42 * (1 - smooth((t - TG_WIN) / 0.8));
    return tugPos.copy(TEACHER_POS).addScaledVector(exTmp2.set(Math.sin(FACE_WATER), 0, Math.cos(FACE_WATER)), d);
  }
  const TUG_KEYS = [
    ...FLOAT_KEYS.filter(([at]) => at <= 3.1),
    [TG_BITE, pose("reach", "reach", { dip: 0.14, lean: 0.1, hx: 0.3, yaw: FACE_WATER })], // !!
    ...Array.from({ length: 6 }, (_, i) => [TG_PULL + i * 0.4, i % 2 ? tugFwd : tugBack]), // heave! ... heave!
    [TG_WIN, pose("shock", "shock", { dip: 0.06, lean: -0.14, hx: -0.15, yaw: FACE_WATER })], // whoa
    [8.0, pose("akimbo", "akimbo", { hx: 0.05, hz: 0.12, yaw: FACE_WATER - 0.3 })], // hmph!
    [10.2, pose("heart", "heart", { hx: 0.1, hz: 0.12, yaw: FACE_WATER - 0.3 })], // ... hee
    [11.2, pose("clasp", "wave", { hx: 0.05, hz: -0.12, yaw: FACE_CAM })],
    [12.9, null],
  ];
  function tugState(t) {
    const g = gagBase();
    if (t < TG_BITE) return g;
    if (t < TG_PULL) g.face = "huh";
    else if (t < TG_WIN) g.face = "squint";
    else if (t < 8.0) g.face = "huh";
    else if (t < 10.2) g.face = "pout";
    else if (t < 11.2) g.face = Math.floor(t * 6) % 2 ? "open" : "blink";
    g.exclaim = pulse(t, TG_BITE + 0.05, 0.7) + pulse(t, TG_WIN + 0.05, 0.6);
    g.anger = fade(t, 8.0, 10.1);
    if (t > TG_PULL && t < TG_WIN) g.shake = Math.sin(t * 40) * 0.004;
    g.pos = tugDrag(t);
    if (t > 8.1 && t < 8.9) g.bob = Math.abs(Math.sin((t - 8.1) * 7)) * 0.03; // stomp stomp
    if (t > 10.2 && t < 11.2) g.bob = Math.abs(Math.sin(t * 9)) * 0.015;
    return g;
  }
  function tugPerformance(P, k, t, dt) {
    applyGag(tugState(t));
    const w = (mooSt.want = mooBase());
    if (t < TG_HOLD) floatPerformance(P, k, t);
    if (!mooDive(P, t) && t < TG_UP) moo.position.y = MOO_UNDER;
    if (t < TG_HOLD) return;
    if (k.standee && !P.released) k.standee.visible = false;
    // her hands, and where Moo Deng comes up to meet them
    palms(handWorld, 0.1);
    handWorld.y -= 0.06;
    if (!P.anchor) {
      // up on her hind legs in the water, just off the end of the pier
      P.anchor = handWorld.clone();
      P.anchor.x = -1.95;
      P.anchor.y = MOO_SWIM + 0.04;
    }
    const A = P.anchor;
    const g = moo.position;
    const kp = k.root.position;
    if (t < TG_WIN) {
      const pull = t > TG_PULL ? Math.sin(((t - TG_PULL) / 0.8) * TAU) : 0;
      const up = smooth(clamp01((t - TG_UP) / 0.5));
      g.set(A.x + 0.1 * pull, lerp(MOO_UNDER, A.y, up), A.z);
      mooSt.yaw = -Math.PI / 2;
      moo.rotation.y = -Math.PI / 2;
      w.hy = t > TG_PULL ? Math.sin(t * 9) * 0.25 : 0; // shakes her head like a puppy
      w.mouth = t < TG_BITE - 0.25 ? 0 : t < TG_BITE ? 0.8 : 0.25;
      w.eyes = t > TG_PULL ? 0.6 : 0;
      w.ears = t > TG_PULL ? 1 : 0;
      w.rear = 1;
      w.hx = 0.45; // (her head stays level while she rears)
      w.paddle = 0.5;
      mooMouth(mooTmp);
      // in her hands, then held between the two of them
      const share = t < TG_BITE ? 0 : t < TG_PULL ? 0.5 * smooth((t - TG_BITE) / 0.6) : 0.5 + 0.12 * pull;
      kp.lerpVectors(handWorld, mooTmp, share);
      k.root.scale.setScalar(0.6);
    } else if (t < TG_DROP) {
      // she wins! off she swims with it in her mouth
      if (!P.winFrom) P.winFrom = g.clone();
      const u = smooth(clamp01((t - TG_WIN - 0.4) / (TG_DROP - TG_WIN - 0.4)));
      g.lerpVectors(P.winFrom, mooTmp2.set(TG_TO.x, MOO_SWIM + 0.06, TG_TO.z), u);
      if (t < TG_WIN + 0.4) g.x += Math.sin(((t - TG_WIN) / 0.4) * Math.PI) * 0.3; // yank!
      g.y += Math.sin(t * 3) * 0.015;
      mooSt.yaw = u < 0.95 ? yawTo(P.winFrom, TG_TO) : mooSt.yaw;
      w.mouth = 0.25;
      w.paddle = t > TG_WIN + 0.4 ? 1 : 0;
      w.ears = 1;
      w.hx = -0.2;
      mooMouth(mooTmp);
      kp.copy(mooTmp);
      kp.y = Math.max(0.02, kp.y - 0.05);
      k.root.scale.setScalar(lerp(0.6, 0.75, smooth(clamp01((t - TG_WIN) / 0.8))));
      if (t > TG_WIN + 0.4) mooRipples(dt, 0.35);
    } else {
      // lets go of it, turns, squeaks, dives
      if (!P.released) {
        P.released = true;
        k.root.scale.setScalar(1);
        k.root.position.y = 0;
        k.placed = true;
        if (k.standee) {
          k.standee.visible = true;
          burst(mooTmp.set(kp.x, 0.9, kp.z), 36, { speed: 1.2, colors: [0xfff3b0, 0xffb3e6, 0xffffff], life: 0.8 });
        }
        ripple(kp.x, kp.z, 1.8);
        sound.plop();
        freeKrathong(k, 0.3, -0.6);
        camState.until = 0;
      }
      g.x += dt * 0.25;
      mooFace(TEACHER_POS);
      w.mouth = t < TG_DROP + 1.0 && t > TG_DROP + 0.3 ? 0.8 : 0;
      w.eyes = t > TG_DROP + 0.3 && t < TG_DROP + 1.0 ? 1 : 0;
      w.ears = 1;
      if (t > TG_DROP + 1.2) g.y = lerp(MOO_SWIM, MOO_UNDER, smooth(clamp01((t - TG_DROP - 1.2) / 0.6)));
    }
    if (once(P, "up", t, TG_UP)) {
      burst(mooTmp.set(A.x, 0.05, A.z), 22, { speed: 1.0, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
      ripple(A.x, A.z, 1.3, 0xcfe8ff);
      sound.blub();
    }
    if (once(P, "chomp", t, TG_BITE)) sound.pop(0.14);
    if (once(P, "gasp", t, TG_BITE + 0.05)) sound.eek(0.06);
    for (let i = 0; i < 6; i++) if (once(P, "heave" + i, t, TG_PULL + i * 0.4)) sound.pop(0.04);
    if (once(P, "win", t, TG_WIN)) {
      sound.boing();
      burst(handWorld, 14, { speed: 0.8, colors: [0xfff3b0, 0xffffff], life: 0.4 });
    }
    if (once(P, "hmph", t, 8.05)) sound.hmph();
    if (once(P, "tee", t, TG_DROP + 0.35)) sound.squeak(0.08, 1.2);
    if (once(P, "hee", t, 10.25)) sound.giggle();
    if (once(P, "dive", t, TG_DROP + 1.5)) {
      ripple(g.x, g.z, 1.4, 0xcfe8ff);
      sound.plop();
    }
    if (once(P, "follow", t, 12.2)) focusOn(k, 8);
  }
  EXTRA.mdtug = {
    keys: TUG_KEYS,
    perform: tugPerformance,
    shot(pos, look, P) {
      if (P.t < 3.0 || P.t > 12.1) return defaultFloatShot(pos, look);
      const g = moo.position;
      // side-on for the tug, so it pulls left and right across the screen
      if (P.t < TG_WIN + 0.6) riverSide(pos, look, g.x, g.z, 3.4, 0.3);
      else riverSide(pos, look, g.x, g.z);
    },
    start: mooClaim,
    end(k) {
      mooRelease(k);
      k.stolen = false;
      if (!k.placed) {
        // (cut short: put it on the water where it is)
        k.placed = true;
        k.root.scale.setScalar(1);
        k.root.position.y = 0;
        if (k.standee) k.standee.visible = true;
        freeKrathong(k);
      }
    },
  };

  // ----- wishing together (float): Kru Song wais the river with her eyes
  // shut. Moo Deng surfaces beside the krathong, watches her, copies her
  // and shuts her eyes too... and nods off (Zzz, a bubble at her nose).
  // Kru Song opens her eyes: aww. She blows her a kiss, the heart floats
  // over and pops the bubble, Moo Deng wakes with a squeak, wiggles
  // happily, and swims away. -----
  const wsHeart = new THREE.Sprite(kissHeart.material.clone());
  wsHeart.visible = false;
  scene.add(wsHeart);
  const wsFrom = new THREE.Vector3();
  const WS_AT = 5.5;
  const WS_S = 7.0;
  const WS_SPOT = new THREE.Vector3(-1.9, 0, 2.05);
  const WS_KRATHONG = new THREE.Vector3(-1.1, 0, 1.25); // her krathong waits off to the side
  const WS_UP = 4.7;
  const WS_COPY = 5.6;
  const WS_SLEEP = 6.6;
  const WS_LOOK = 8.4; // Kru Song opens her eyes
  const WS_PAT = 10.0;
  const WS_POP = 10.6;
  const WS_GO = 11.6;
  const yawWs = yawTo(TEACHER_POS, WS_SPOT);
  const WISH_KEYS = [
    ...FLOAT_KEYS.filter(([at]) => at < WS_AT),
    [WS_LOOK, pose("clasp", "clasp", { dip: 0.1, lean: 0.06, hx: 0.4, yaw: yawWs })], // oh!
    [9.0, pose("heart", "heart", { dip: 0.1, hx: 0.35, hz: 0.12, yaw: yawWs })], // aww
    [WS_PAT - 0.5, pose("kissHand", "rest", { hx: 0.15, hz: 0.08, yaw: yawWs })],
    [WS_PAT, pose("blow", "rest", { hx: 0.2, hz: -0.1, lean: -0.04, yaw: yawWs })], // mwah!
    [WS_GO - 0.2, pose("clasp", "wave", { dip: 0.06, hx: 0.25, hz: -0.1, yaw: yawWs })],
    ...FLOAT_KEYS.filter(([at]) => at >= 5.9).map(([at, p]) => [at + WS_S, p]),
  ];
  function wishState(t) {
    const g = gagBase();
    if (t < WS_LOOK || t > WS_GO + 1.4) return g;
    if (t < 9.0) g.face = "huh";
    else if (t < WS_PAT - 0.5) g.face = "shy";
    else if (t < WS_PAT + 0.4) g.face = t < WS_PAT ? "pucker" : "kiss";
    else if (t < WS_POP) g.face = "open";
    else g.face = "open";
    g.exclaim = pulse(t, WS_LOOK + 0.05, 0.7);
    return g;
  }
  function wishPerformance(P, k, t, dt) {
    applyGag(wishState(t));
    floatPerformance(P, k, floatTime(t, WS_AT, WS_S));
    showHearts(t, 9.0, WS_POP + 0.8);
    // her krathong waits by the two of them, then floats off
    if (t >= FLOAT_ON_WATER && t < WS_GO + 0.5) {
      const u = smooth(clamp01((t - FLOAT_ON_WATER) / 1.5));
      holdKrathong(k, lerp(DROP_POS.x, WS_KRATHONG.x, u), lerp(DROP_POS.z, WS_KRATHONG.z, u));
    }
    if (once(P, "free", t, WS_GO + 0.5)) freeKrathong(k);
    const w = (mooSt.want = mooBase());
    const u = moo.userData;
    if (mooDive(P, t)) return;
    const g = moo.position;
    if (t < WS_UP) {
      g.set(WS_SPOT.x, MOO_UNDER, WS_SPOT.z);
      mooSt.yaw = moo.rotation.y = yawTo(WS_SPOT, TEACHER_POS);
      return;
    }
    if (t < WS_GO) {
      // up beside the pier, chin by the edge, looking up at her
      g.set(WS_SPOT.x, lerp(MOO_UNDER, MOO_SWIM + 0.08, smooth(clamp01((t - WS_UP) / 0.8))) + Math.sin(t * 1.6) * 0.012, WS_SPOT.z);
      // mostly toward us, her head turned up to Kru Song
      const toCam = yawTo(g, camera.position);
      mooSt.yaw = toCam + wrapAngle(yawTo(g, TEACHER_POS) - toCam) * 0.12;
      w.hy = wrapAngle(yawTo(g, TEACHER_POS) - mooSt.yaw) * 0.3;
      if (t < WS_COPY) {
        w.hz = 0.3; // hm? what is she doing?
        w.hx = -0.25;
      } else if (t < WS_SLEEP) {
        w.eyes = 1; // copying her: eyes shut, a wish
        w.hx = 0.1;
      } else if (t < WS_POP) {
        w.eyes = 1; // ... fast asleep
        w.hx = 0.35;
        w.hz = Math.sin(t * 1.1) * 0.15;

      } else {
        w.ears = 1;
        w.mouth = t < WS_POP + 0.7 ? 0.8 : 0;
        w.hx = -0.3;
        w.hz = Math.sin(t * 5) * 0.25; // a nuzzle
        w.squash = t < WS_POP + 0.2 ? 0.5 : 0;
      }
    } else {
      // off she goes, then under
      const v = clamp01((t - WS_GO) / 1.6);
      g.set(lerp(WS_SPOT.x, -0.6, smooth(v)), MOO_SWIM, lerp(WS_SPOT.z, 1.0, smooth(v)));
      if (t > WS_GO + 1.3) g.y = lerp(MOO_SWIM, MOO_UNDER, smooth(clamp01((t - WS_GO - 1.3) / 0.6)));
      mooSt.yaw = yawTo(WS_SPOT, mooTmp.set(-0.6, 0, 1.0));
      w.paddle = 1;
      if (v < 0.9) mooRipples(dt, 0.35);
    }
    showMooZzz(t, WS_SLEEP + 0.3, WS_POP);
    // the bubble swells and shrinks with each breath
    const b = smooth(clamp01((t - 7.2) / 1.4)) * (0.75 + 0.35 * Math.sin(t * 2.6));
    u.bubble.visible = t > 7.2 && t < WS_POP;
    u.bubble.scale.setScalar(Math.max(0.01, b));
    if (once(P, "up", t, WS_UP)) ripple(WS_SPOT.x, WS_SPOT.z, 1.1, 0xcfe8ff);
    if (once(P, "hm", t, WS_UP + 0.9)) sound.squeak(0.04, 0.9);
    if (once(P, "oh", t, WS_LOOK + 0.05)) sound.pop(0.1);
    if (once(P, "aww", t, 9.05)) sound.ting(0.05);
    // the kiss: a heart from her fingertips to the bubble
    if (once(P, "kiss", t, WS_PAT)) {
      teacher.hands[0].getWorldPosition(wsFrom);
      burst(wsFrom, 16, { speed: 0.7, colors: [0xff7fb0, 0xffc2dc, 0xffffff], life: 0.5 });
      sound.kiss();
    }
    const hu = (t - WS_PAT) / (WS_POP - WS_PAT);
    wsHeart.visible = hu > 0 && hu < 1;
    if (wsHeart.visible) {
      u.bubble.getWorldPosition(mooTmp2);
      wsHeart.position.lerpVectors(wsFrom, mooTmp2, smooth(hu));
      wsHeart.position.y += Math.sin(hu * Math.PI) * 0.3;
      wsHeart.position.x += Math.sin(hu * 9) * 0.04;
      wsHeart.scale.setScalar(0.1 + 0.12 * Math.sin(hu * Math.PI));
      wsHeart.material.rotation = Math.sin(hu * 7) * 0.2;
    }
    if (once(P, "pop", t, WS_POP)) {
      u.bubble.getWorldPosition(mooTmp);
      burst(mooTmp, 22, { speed: 0.9, colors: [0xd8f2ff, 0xffffff], life: 0.45 });
      sound.pop(0.22);
    }
    if (once(P, "awake", t, WS_POP + 0.1)) sound.squeak(0.08, 1.15);
    if (once(P, "bye", t, WS_GO)) sound.squeak(0.06, 1.25);
  }
  EXTRA.mdwish = {
    keys: WISH_KEYS,
    perform: wishPerformance,
    shot(pos, look, P) {
      if (P.t < 4.4 || P.t > WS_GO + 1.0) return defaultFloatShot(pos, look);
      riverSide(pos, look, WS_SPOT.x, WS_SPOT.z, 4.0);
    },
    start: mooClaim,
    end(k) {
      mooRelease(k);
      k.stolen = false;
      wsHeart.visible = false;
      hideHearts();
    },
  };

  // ----- the skirt nibbler (idle): Moo Deng climbs up the pier and
  // tiptoes up behind Kru Song, and gives the hem of her pha sin a nibble
  // and a tug. "?" She looks round the wrong way... tug, tug! She turns:
  // caught! Moo Deng lets go and looks away, all innocence. Kru Song
  // huffs, then can't help giggling, crouches to pat her, and Moo Deng
  // hops happily back into the river. -----
  const NB_SPOT = new THREE.Vector3(-2.78, PIER.top, 1.82); // at her hem
  const NB_TUGS = [4.0, 4.4, 5.7, 6.0];
  const NB_CAUGHT = 6.3;
  const NB_BACK = 10.0;
  const yawNb = yawTo(TEACHER_POS, NB_SPOT);
  const NIBBLE_KEYS = [
    [0, IDLE],
    [4.0, pose("rest", "rest", { hx: 0.35, hz: 0.12, yaw: FACE_CAM })], // hm? something tugged
    [4.7, pose("rest", "rest", { hx: 0.2, hz: 0.2, yaw: FACE_CAM - 0.8 })], // ... looks the wrong way
    [5.2, pose("rest", "rest", { hx: 0.15, hz: -0.1, yaw: FACE_CAM - 0.1 })],
    [NB_CAUGHT, pose("brace", "brace", { hx: 0.4, yaw: yawNb })], // YOU!
    [7.0, pose("akimbo", "akimbo", { hx: 0.35, hz: 0.12, yaw: yawNb })], // hmph
    [7.9, pose("heart", "heart", { hx: 0.35, hz: 0.12, yaw: yawNb })], // ... hee
    [8.5, pose("pat", "clasp", { dip: 0.14, lean: 0.14, hx: 0.5, yaw: yawNb })],
    [10.2, pose("clasp", "wave", { hx: 0.2, hz: -0.12, yaw: yawNb })],
    [11.6, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [12.6, null],
  ];
  function nibbleState(t) {
    const g = gagBase();
    if (t > 4.0 && t < NB_CAUGHT) g.face = "huh";
    else if (t >= NB_CAUGHT && t < 7.0) g.face = "huh";
    else if (t >= 7.0 && t < 7.9) g.face = "pout";
    else if (t >= 7.9 && t < 8.5) g.face = Math.floor(t * 6) % 2 ? "open" : "blink";
    else if (t >= 8.5 && t < 10.2) g.face = "shy";
    g.question = pulse(t, 4.05, 1.0) + pulse(t, 5.75, 0.6);
    g.exclaim = pulse(t, NB_CAUGHT + 0.05, 0.7);
    g.anger = fade(t, 7.0, 7.9, 0.2);
    // each tug jerks her toward the nibbler
    for (const at of NB_TUGS) if (t > at && t < at + 0.25) g.shake = Math.sin(((t - at) / 0.25) * Math.PI) * 0.025;
    if (t > 7.9 && t < 8.5) g.bob = Math.abs(Math.sin(t * 9)) * 0.015;
    return g;
  }
  function nibblePerformance(P, k, t, dt) {
    applyGag(nibbleState(t));
    showHearts(t, 8.5, NB_BACK);
    const w = (mooSt.want = mooBase());
    if (mooDive(P, t)) return;
    const g = moo.position;
    if (t < 0.8) {
      g.set(MOO_CLIMB_W.x, MOO_UNDER, MOO_CLIMB_W.z);
      return;
    }
    if (t < 1.4) {
      g.set(MOO_CLIMB_W.x, lerp(MOO_UNDER, MOO_SWIM, smooth((t - 0.8) / 0.5)), MOO_CLIMB_W.z);
      mooFace(MOO_CLIMB_D);
    } else if (t < 2.1) {
      hopArc(g, mooTmp.set(MOO_CLIMB_W.x, MOO_SWIM, MOO_CLIMB_W.z), MOO_CLIMB_D, smooth((t - 1.4) / 0.7), 0.45);
      mooFace(MOO_CLIMB_D);
      w.squash = t < 1.5 ? 0.7 : 0;
    } else if (t < 3.6) {
      // tiptoe, tiptoe...
      g.lerpVectors(MOO_CLIMB_D, NB_SPOT, smooth((t - 2.1) / 1.5));
      mooFace(NB_SPOT);
      w.walk = 0.6;
      w.eyes = 0.4;
    } else if (t < NB_BACK) {
      g.copy(NB_SPOT);
      if (t < NB_CAUGHT + 0.1) {
        // nibbling her hem, tugging
        mooFace(TEACHER_POS);
        w.hx = 0.35;
        w.mouth = t < 3.85 ? 0.8 : 0.15;
        w.eyes = 0.5;
        for (const at of NB_TUGS) {
          if (t > at && t < at + 0.25) {
            const j = Math.sin(((t - at) / 0.25) * Math.PI);
            g.addScaledVector(exTmp2.set(g.x - TEACHER_POS.x, 0, g.z - TEACHER_POS.z).normalize(), 0.05 * j);
            w.hx = 0.35 - 0.3 * j;
            w.hy = Math.sin(t * 30) * 0.15 * j;
          }
        }
      } else if (t < 8.5) {
        // caught: lets go, and looks away, ever so innocent
        mooSt.yaw = yawTo(g, camera.position) + 0.5;
        w.eyes = 1;
        w.hx = -0.3;
        w.hz = Math.sin(t * 2.5) * 0.2;
      } else {
        // a pat: bliss
        mooFace(TEACHER_POS);
        w.eyes = 1;
        w.ears = 1;
        w.hx = -0.25 + Math.abs(Math.sin(t * 7)) * 0.08;
      }
    } else if (t < 10.8) {
      g.lerpVectors(NB_SPOT, MOO_CLIMB_D, smooth((t - NB_BACK) / 0.8));
      mooFace(MOO_CLIMB_D);
      w.walk = 1;
    } else {
      const u = clamp01((t - 10.8) / 0.7);
      mooTmp2.set(MOO_CLIMB_W.x + 0.2, MOO_SWIM, MOO_CLIMB_W.z - 0.1);
      if (u < 1) hopArc(g, MOO_CLIMB_D, mooTmp2, smooth(u), 0.4);
      else {
        const v = clamp01((t - 11.5) / 1.0);
        g.set(lerp(mooTmp2.x, mooTmp2.x + 0.9, v), lerp(MOO_SWIM, MOO_UNDER, smooth(clamp01((t - 12.0) / 0.5))), lerp(mooTmp2.z, mooTmp2.z - 0.6, v));
        w.paddle = 1;
      }
      mooFace(mooTmp.set(0, 0, 0));
    }
    if (once(P, "up", t, 0.8)) ripple(MOO_CLIMB_W.x, MOO_CLIMB_W.z, 1.0, 0xcfe8ff);
    if (once(P, "hop", t, 1.4)) sound.boing();
    if (once(P, "chomp", t, 3.85)) sound.pop(0.1);
    NB_TUGS.forEach((at, i) => {
      if (once(P, "tug" + i, t, at)) sound.pop(0.06);
    });
    if (once(P, "huh", t, 4.05)) sound.pop(0.08);
    if (once(P, "caught", t, NB_CAUGHT + 0.05)) sound.eek(0.07);
    if (once(P, "hmph", t, 7.05)) sound.hmph();
    if (once(P, "hee", t, 7.95)) sound.giggle();
    if (once(P, "sq", t, 8.7)) sound.squeak(0.07, 1.15);
    if (once(P, "splash", t, 11.5)) {
      ripple(mooTmp2.x, mooTmp2.z, 1.6, 0xcfe8ff);
      burst(mooTmp.set(mooTmp2.x, 0.05, mooTmp2.z), 26, { speed: 1.0, colors: [0xbfe6ff, 0xffffff], life: 0.5 });
      sound.plop();
    }
  }
  EXTRA.mdnibble = {
    keys: NIBBLE_KEYS,
    perform: nibblePerformance,
    shot(pos, look) {
      riverSide(pos, look, NB_SPOT.x, NB_SPOT.z, 3.8, 0.6);
      look.y = 1.05;
    },
    start: mooClaim,
    end(k) {
      mooRelease(k);
      hideHearts();
    },
  };

  // ----- firecracker fright (idle): Moo Deng floats dozily below the
  // pier. BANG BANG BANG from a firecracker on the bank! She jumps out of
  // her skin and dives. Bubbles... then just her eyes and ears peep up,
  // trembling. Kru Song coaxes her with a slice of watermelon, tosses it,
  // CHOMP, munch munch munch, hearts, and off she swims, happy again. -----
  const FC_SPOT = new THREE.Vector3(-1.85, 0, 1.95);
  const FC_BANG = 2.4;
  const FC_PEEK = 5.0;
  const FC_TOSS = 7.3;
  const FC_CATCH = 8.0;
  const FC_GO = 10.2;
  const FC_CRACKER = new THREE.Vector3(-1.15, 0.3, 1.25); // a string of them tossed onto the water
  const yawFc = yawTo(TEACHER_POS, FC_SPOT) * 0.65 + FACE_CAM * 0.35;
  const melon = (() => {
    const { parts, add } = partList();
    add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 18, 1, false, 0, Math.PI), "#3f9a3a"); // rind
    add(new THREE.CylinderGeometry(0.088, 0.088, 0.034, 18, 1, false, 0, Math.PI), "#ff4d5e", (d) => d.position.y = 0.0); // flesh
    for (let i = 0; i < 5; i++) {
      const a = 0.4 + i * 0.58;
      add(new THREE.SphereGeometry(0.006, 6, 4), "#1a1216", (d) => d.position.set(Math.cos(a) * 0.05, 0.018, Math.sin(a) * 0.05));
    }
    const m = new THREE.Mesh(mergeParts(parts), propMat);
    m.scale.setScalar(1.6);
    m.visible = false;
    scene.add(m);
    return m;
  })();
  const BOOM_KEYS = [
    [0, IDLE],
    [1.2, pose("heart", "heart", { hx: 0.25, hz: 0.12, yaw: yawFc })], // aww, she's dozing
    [FC_BANG, pose("brace", "brace", { hx: -0.05, yaw: yawFc })], // BANG!
    [3.5, pose("clasp", "clasp", { hx: 0.4, yaw: yawFc })], // where did she go?
    [5.4, pose("heart", "heart", { hx: 0.35, hz: 0.12, yaw: yawFc })], // aww, poor thing
    [6.0, pose("pocket", "rest", { hx: 0.15, yaw: yawFc })],
    [6.4, pose("show", "clasp", { hx: 0.15, hz: 0.1, yaw: yawFc })], // here, look!
    [FC_TOSS - 0.3, pose("windup", "clasp", { hx: 0.05, yaw: yawFc })],
    [FC_TOSS, pose("fling", "clasp", { hx: 0.2, lean: 0.06, yaw: yawFc })],
    [FC_CATCH + 0.1, pose("clap", "clap", { hx: 0.15, yaw: yawFc })], // yay!
    [9.0, pose("heart", "heart", { hx: 0.2, hz: 0.12, yaw: yawFc })],
    [FC_GO, pose("clasp", "wave", { hx: 0.15, hz: -0.12, yaw: yawFc })],
    [11.4, pose("clasp", "wave", { hz: -0.12, yaw: FACE_CAM })],
    [12.3, null],
  ];
  function boomState(t) {
    const g = gagBase();
    if (t > 1.2 && t < FC_BANG) g.face = "shy";
    else if (t >= FC_BANG && t < 3.5) g.face = "wince";
    else if (t >= 3.5 && t < 5.4) g.face = "huh";
    else if (t >= 5.4 && t < 6.0) g.face = "shy";
    else if (t >= 6.0 && t < FC_CATCH + 0.1) g.face = "open";
    else if (t >= FC_CATCH + 0.1 && t < FC_GO) g.face = Math.floor(t * 6) % 2 ? "open" : "blink";
    g.exclaim = pulse(t, FC_BANG + 0.05, 0.7);
    g.question = pulse(t, 3.7, 1.2);
    if (t > FC_BANG && t < FC_BANG + 0.7) g.shake = Math.sin(t * 60) * 0.008;
    if (t > FC_CATCH + 0.1 && t < 9.0) g.bob = Math.abs(Math.sin(t * 8)) * 0.025;
    return g;
  }
  function boomPerformance(P, k, t, dt) {
    applyGag(boomState(t));
    showHearts(t, FC_CATCH + 0.3, FC_GO);
    const w = (mooSt.want = mooBase());
    // the watermelon: out of her pocket, held up, tossed, caught, munched
    melon.visible = t > 6.15 && t < FC_CATCH + 1.6;
    if (melon.visible) {
      if (t < FC_TOSS) {
        teacher.hands[0].getWorldPosition(melon.position);
        melon.rotation.set(Math.PI / 2, 0, Math.sin(t * 2) * 0.2);
        P.melonFrom = melon.position.clone();
      } else if (t < FC_CATCH) {
        const u = (t - FC_TOSS) / (FC_CATCH - FC_TOSS);
        mooMouth(mooTmp2);
        hopArc(melon.position, P.melonFrom, mooTmp2, u, 0.6);
        melon.rotation.set(Math.PI / 2 + u * 6, u * 3, 0);
      } else {
        // in her mouth, getting smaller with every munch
        mooMouth(melon.position);
        const left = 1 - clamp01((t - FC_CATCH) / 1.5);
        melon.scale.setScalar(1.6 * Math.max(0.05, left));
        melon.rotation.set(Math.PI / 2, 0, 0);
      }
    } else melon.scale.setScalar(1.6);
    if (mooDive(P, t)) return;
    const g = moo.position;
    // mostly toward us, her head turned up to Kru Song
    const toCam = yawTo(g, camera.position);
    mooSt.yaw = toCam + wrapAngle(yawTo(g, TEACHER_POS) - toCam) * 0.3;
    w.hy = wrapAngle(yawTo(g, TEACHER_POS) - mooSt.yaw) * 0.4;
    if (t < 0.8) g.set(FC_SPOT.x, MOO_UNDER, FC_SPOT.z);
    else if (t < FC_BANG) {
      // floating, dozy
      g.set(FC_SPOT.x, lerp(MOO_UNDER, MOO_SWIM, smooth(clamp01((t - 0.8) / 0.5))) + Math.sin(t * 1.5) * 0.012, FC_SPOT.z);
      w.eyes = 0.7;
      w.hz = Math.sin(t * 1.2) * 0.12;
    } else if (t < 3.2) {
      // jumps out of her skin... and dives
      const u = t - FC_BANG;
      g.set(FC_SPOT.x, MOO_SWIM + (u < 0.4 ? Math.sin((u / 0.4) * Math.PI) * 0.3 : lerp(0, MOO_UNDER - MOO_SWIM, smooth(clamp01((u - 0.4) / 0.35)))), FC_SPOT.z);
      w.mouth = 0.9;
      w.ears = 1;
      w.hx = -0.3;
      w.squash = u > 0.35 && u < 0.45 ? 0.8 : 0;
    } else if (t < FC_PEEK) {
      g.set(FC_SPOT.x, MOO_UNDER, FC_SPOT.z);
    } else if (t < 6.4) {
      // just eyes and ears, trembling
      g.set(FC_SPOT.x + Math.sin(t * 40) * 0.008, lerp(MOO_UNDER, MOO_SWIM - 0.2, smooth(clamp01((t - FC_PEEK) / 0.6))), FC_SPOT.z);
      w.hy = Math.sin(t * 1.8) * 0.5;
      w.hx = 0.1;
    } else if (t < FC_GO) {
      // up for the watermelon
      g.set(FC_SPOT.x, lerp(MOO_SWIM - 0.2, MOO_SWIM + 0.05, smooth(clamp01((t - 6.4) / 0.5))) + Math.sin(t * 3) * 0.01, FC_SPOT.z);
      w.ears = t > 6.6 ? 1 : 0;
      w.hx = t < FC_CATCH ? -0.3 : -0.1;
      if (t > FC_CATCH - 0.4 && t < FC_CATCH) w.mouth = 1; // aaah
      else if (t > FC_CATCH && t < FC_CATCH + 1.5) {
        w.mouth = Math.abs(Math.sin((t - FC_CATCH) * 9)) * 0.45; // munch munch munch
        w.eyes = 1;
      } else if (t > FC_CATCH + 1.6) {
        w.eyes = 1;
        w.hz = Math.sin(t * 4) * 0.2;
      }
    } else {
      const u = clamp01((t - FC_GO) / 1.6);
      g.set(lerp(FC_SPOT.x, -0.5, smooth(u)), MOO_SWIM, lerp(FC_SPOT.z, 1.0, smooth(u)));
      if (t > FC_GO + 1.3) g.y = lerp(MOO_SWIM, MOO_UNDER, smooth(clamp01((t - FC_GO - 1.3) / 0.6)));
      mooSt.yaw = yawTo(FC_SPOT, mooTmp.set(-0.5, 0, 1.0));
      w.paddle = 1;
      if (u < 0.9) mooRipples(dt, 0.35);
    }
    if (once(P, "up", t, 0.8)) ripple(FC_SPOT.x, FC_SPOT.z, 1.1, 0xcfe8ff);
    if (once(P, "aww", t, 1.25)) sound.ting(0.04);
    // the firecracker on the bank: three bangs
    [FC_BANG, FC_BANG + 0.25, FC_BANG + 0.55].forEach((at, i) => {
      if (once(P, "bang" + i, t, at)) {
        burst(mooTmp.set(FC_CRACKER.x + rand(-0.2, 0.2), FC_CRACKER.y, FC_CRACKER.z), 36, { speed: 2.4, colors: [0xfff1a8, 0xffb347, 0xff5a3a, 0xffffff], life: 0.55 });
        sound.pop(0.3);
        if (i === 0) sound.boom(0.25);
      }
    });
    if (once(P, "eep", t, FC_BANG + 0.1)) sound.squeak(0.09, 1.4);
    if (once(P, "dive", t, FC_BANG + 0.75)) {
      ripple(FC_SPOT.x, FC_SPOT.z, 1.8, 0xcfe8ff);
      burst(mooTmp.set(FC_SPOT.x, 0.05, FC_SPOT.z), 34, { speed: 1.2, colors: [0xbfe6ff, 0xffffff], life: 0.55 });
      sound.plop();
    }
    // bubbles where she hides
    if (t > 3.3 && t < FC_PEEK) {
      P.bub = (P.bub ?? 0) - dt;
      if (P.bub <= 0) {
        P.bub = 0.35;
        burst(mooTmp.set(FC_SPOT.x + rand(-0.15, 0.15), 0.03, FC_SPOT.z + rand(-0.15, 0.15)), 4, { speed: 0.25, colors: [0xd8f2ff, 0xffffff], life: 0.5, up: 0.6 });
        if (Math.random() < 0.5) sound.blub();
      }
    }
    if (once(P, "peek", t, FC_PEEK + 0.3)) sound.squeak(0.035, 0.85);
    if (once(P, "look", t, 6.45)) sound.ting(0.05);
    if (once(P, "toss", t, FC_TOSS)) sound.whoosh();
    if (once(P, "chomp", t, FC_CATCH)) {
      sound.pop(0.15);
      mooHead(mooTmp);
      burst(mooTmp, 20, { speed: 0.8, colors: [0xff7fb0, 0xff4d5e, 0xffffff], life: 0.6 });
    }
    if (once(P, "munch", t, FC_CATCH + 0.15)) sound.munch();
    if (once(P, "yay", t, FC_CATCH + 1.65)) sound.squeak(0.08, 1.2);
  }
  EXTRA.mdboom = {
    keys: BOOM_KEYS,
    perform: boomPerformance,
    shot(pos, look) {
      riverSide(pos, look, FC_SPOT.x, FC_SPOT.z, 3.7, 0.85);
      look.y = 1.0;
    },
    start: mooClaim,
    end(k) {
      mooRelease(k);
      melon.visible = false;
      melon.scale.setScalar(1.6);
      hideHearts();
    },
  };

  // ----- a tap on Kru Song: a quick little reaction, drawn from its own
  // lucky-draw bag. Only while she's free (no gag running or waiting);
  // taps during a reaction are ignored. -----
  const pokeBag = makeBag(["shy", "hmph", "giggle", "twirl", "dizzy"]);
  const POKE_LEN = 2.0;
  const POKE_LENS = { greet: 3.2, pat: 3.6 };
  const POKE_KEYS = {
    shy: [
      [0, pose("cheeks", "cheeks", { hx: 0.15, hz: 0.15, yaw: FACE_CAM })],
      [0.6, pose("cheeks", "cheeks", { hx: 0.15, hz: -0.15, yaw: FACE_CAM - 0.15 })],
      [1.2, pose("cheeks", "cheeks", { hx: 0.15, hz: 0.15, yaw: FACE_CAM })],
    ],
    hmph: [[0, pose("fist", "fist", { hx: -0.25, hz: 0.15, yaw: FACE_CAM - 0.6 })]],
    giggle: [
      [0, pose("heart", "heart", { hx: 0.1, hz: 0.12, yaw: FACE_CAM })],
      [0.5, pose("heart", "heart", { hx: 0.12, hz: -0.12, yaw: FACE_CAM })],
      [1.0, pose("heart", "heart", { hx: 0.1, hz: 0.12, yaw: FACE_CAM })],
    ],
    twirl: [
      [0, pose("open", "open", { hx: -0.15, yaw: FACE_CAM })],
      [1.0, pose("heart", "heart", { hz: 0.14, yaw: FACE_CAM })],
    ],
    // Moo Deng says hello from the water: a wave back, then a happy giggle
    greet: [
      [0, pose("clasp", "wave", { hx: 0.2, hz: -0.12, yaw: yawTo(TEACHER_POS, MOO_HI) })],
      [1.8, pose("heart", "heart", { hx: 0.25, hz: 0.12, yaw: yawTo(TEACHER_POS, MOO_HI) })],
    ],
    // ... or waddles up the pier: she crouches to pat her
    pat: [
      [0, pose("heart", "heart", { hx: 0.3, yaw: yawTo(TEACHER_POS, MOO_NEAR) })],
      [0.6, pose("pat", "clasp", { dip: 0.14, lean: 0.14, hx: 0.5, yaw: yawTo(TEACHER_POS, MOO_NEAR) })],
      [2.8, pose("heart", "heart", { hx: 0.3, hz: 0.12, yaw: yawTo(TEACHER_POS, MOO_NEAR) })],
    ],
    dizzy: [
      [0, pose("rest", "rest", { hz: 0.25, yaw: FACE_CAM })],
      [0.35, pose("rest", "rest", { hz: -0.25, yaw: FACE_CAM })],
      [0.7, pose("rest", "rest", { hz: 0.25, yaw: FACE_CAM })],
      [1.05, pose("rest", "rest", { hz: -0.25, yaw: FACE_CAM })],
      [1.4, pose("rest", "rest", { hz: 0.05, yaw: FACE_CAM })],
    ],
  };
  let poke = null; // { kind, t }
  function pokeState(kind, t) {
    const g = gagBase();
    if (kind === "shy") {
      g.face = "shy";
      g.bob = Math.abs(Math.sin(t * 6)) * 0.012;
    } else if (kind === "hmph") {
      g.face = "pout";
      g.anger = fade(t, 0, POKE_LEN, 0.25);
    } else if (kind === "giggle") {
      g.face = Math.floor(t * 6) % 2 ? "open" : "blink";
      g.bob = Math.abs(Math.sin(t * 9)) * 0.02;
    } else if (kind === "twirl") {
      g.face = t < 1.0 ? "open" : "blink";
      const u = clamp01(t / 0.9);
      g.spin = TAU * smooth(u);
      g.bob = u < 1 ? Math.sin(u * Math.PI) * 0.07 : 0;
    } else if (kind === "greet") {
      g.face = t < 1.8 ? "open" : Math.floor(t * 6) % 2 ? "open" : "blink";
      g.bob = t > 1.8 ? Math.abs(Math.sin(t * 9)) * 0.015 : 0;
    } else if (kind === "pat") {
      g.face = t < 0.6 ? "open" : "shy";
    } else if (kind === "dizzy") {
      g.face = "cross";
      g.question = fade(t, 0.2, POKE_LEN);
    }
    return g;
  }
  function stopPoke() {
    poke = null;
    hideHearts();
    resetGag();
  }
  function pokeTick(dt) {
    if (!poke) return;
    if (performing || queue.length) return stopPoke();
    const t0 = poke.t;
    poke.t += dt;
    const t = poke.t;
    applyGag(pokeState(poke.kind, t));
    if (poke.kind === "shy") showHearts(t, 0.05, POKE_LEN);
    if (poke.kind === "pat") showHearts(t, 0.6, POKE_LENS.pat);
    if (poke.kind === "greet" && t0 < 0.4 && t >= 0.4) sound.giggle();
    if (poke.kind === "twirl" && t0 < 0.9 && t >= 0.9) {
      sparkleHead(30);
      sound.ting(0.06);
    }
    if (t >= (POKE_LENS[poke.kind] ?? POKE_LEN)) stopPoke();
  }
  function pokeTeacher() {
    if (performing || queue.length || poke) return false;
    if (idleComb != null) stopIdleComb();
    idleFor = 0;
    poke = { kind: pokeBag.draw(), t: 0 };
    sound.pop(0.08); // boop
    const voice = { shy: () => sound.kiss(), hmph: () => sound.hmph(), giggle: () => sound.giggle(), twirl: () => sound.ting(0.05), dizzy: () => sound.boing() };
    voice[poke.kind]();
    return true;
  }
  // was the tap on her? (her meshes, or near the line from her feet to
  // her head on screen: she's small in the wide shot)
  const tapA = new THREE.Vector3();
  const tapB = new THREE.Vector3();
  function hitTeacher(cx, cy) {
    if (raycaster.intersectObject(teacher.group, true).length) return true;
    const s = teacher.group.position;
    tapA.set(s.x, s.y + 0.15, s.z).project(camera);
    tapB.set(s.x, s.y + teacher.topY * 0.9, s.z).project(camera);
    if (tapA.z > 1 || tapB.z > 1) return false;
    const ax = ((tapA.x + 1) / 2) * innerWidth;
    const ay = ((1 - tapA.y) / 2) * innerHeight;
    const bx = ((tapB.x + 1) / 2) * innerWidth;
    const by = ((1 - tapB.y) / 2) * innerHeight;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const u = clamp01(((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / (len * len));
    const d = Math.hypot(cx - (ax + (bx - ax) * u), cy - (ay + (by - ay) * u));
    // about a third of a metre either side, at least a fingertip
    return d < Math.max(26, (len / (teacher.topY * 0.9 - 0.15)) * 0.3);
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
      } else if (p === boy) {
        poseBoy(p, dt);
      } else if (p === kid) {
        poseKid(p, dt);
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
        if (p.faceOverride && p.faces[p.faceOverride]) p.faceMat.map = p.faces[p.faceOverride];
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
    // a tap on Kru Song herself, while she's free: a little reaction
    if (hitMoo(e.clientX, e.clientY) && tapMoo()) return;
    if (hitTeacher(e.clientX, e.clientY) && pokeTeacher()) return;
    // (not one still with Kru Song, e.g. waiting on the pier in the wet gag)
    const hit = raycaster.intersectObjects(pickables, false).find((h) => h.object.userData.krathong.placed && !h.object.userData.krathong.stolen);
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
    // keep the current close-up for `seconds` more without recentring
    holdFocus: (seconds) => {
      if (camState.mode === "follow") camState.until = clock + seconds;
    },
    // student krathongs still in the river, oldest first
    students: () => krathongs.filter((k) => !k.simple && k.sinking == null),
    onFocus: null,
    showWishes: false,
    // clean view level 2: the krathong in close-up hides its wish bubble
    // and name tag too
    hideFocusWish: false,
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
      } else if (k.placed && !k.stolen) {
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
        const wishHidden = focusedHere && api.hideFocusWish;
        if (wishHidden) near = 0;
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
          k.tag.visible = k.placed && near < 0.99 && !wishHidden;
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
    pokeTick(dt);
    idleCombTick(dt);
    frogIdle(dt);
    boyRoam(dt);
    mooRoam(dt);
    mooPose(dt);
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
      if (performing?.k.extra) {
        EXTRA[performing.k.extra].shot(goalPos, goalLook, performing);
      } else if (performing?.k.coin) {
        coinShot(goalPos, goalLook, performing);
      } else if (performing?.k.fire) {
        fireShot(goalPos, goalLook, performing);
      } else if (performing?.k.wet) {
        wetShot(goalPos, goalLook, performing);
      } else if (performing?.k.glasses) {
        glassesShot(goalPos, goalLook, performing);
      } else if (performing?.k.firefly) {
        fireflyShot(goalPos, goalLook, performing);
      } else if (performing?.k.fish) {
        fishShot(goalPos, goalLook, performing);
      } else if (performing?.k.frog) {
        frogShot(goalPos, goalLook, performing);
      } else if (performing?.k.cracker) {
        crackerShot(goalPos, goalLook, performing);
      } else if (performing?.k.fly) {
        flyShot(goalPos, goalLook, performing);
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
  // clean view: 0 = everything, 1 = buttons hidden (wish bubble stays),
  // 2 = wish bubble hidden too. One button cycles 0 → 1 → 2 → 0.
  let viewLevel = 0;
  const VIEW_ICON = ["👁", "🙈", "✨"];
  const VIEW_LABEL = ["ซ่อนปุ่ม", "ซ่อนคำอวยพรด้วย", "แสดงทั้งหมด"];
  function setView(n) {
    viewLevel = n;
    document.body.classList.toggle("view-1", n === 1);
    document.body.classList.toggle("view-2", n === 2);
    river.hideFocusWish = n === 2;
    els.viewBtn.textContent = VIEW_ICON[n];
    els.viewBtn.setAttribute("aria-label", VIEW_LABEL[n]);
    els.viewBtn.title = VIEW_LABEL[n];
  }
  river.onFocus = (k) => {
    focused = k;
    els.focusBar.hidden = !k;
    if (k) els.focusName.textContent = k.rec?.name || "";
    else if (viewLevel) setView(0);
  };
  els.viewBtn.addEventListener("click", () => {
    if (!focused) return;
    const next = (viewLevel + 1) % 3;
    // stay on this krathong while the view is clean; back to the usual
    // close-up time once the buttons return
    if (next === 1) river.holdFocus(3600);
    if (next === 0) river.holdFocus(25);
    setView(next);
    if (next === 1) els.listPanel.hidden = true;
  });
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
