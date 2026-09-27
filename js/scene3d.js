// Decorative WebGL backdrop shared by the non-gameplay screens.
//
// The scene sits in a fixed <canvas> *behind* the existing DOM, so every
// button, link and form keeps working exactly as before. If WebGL is missing,
// the user prefers reduced motion, or anything throws, we return null and the
// page's original CSS background stays in place untouched.
//
// Never mount this on top of live camera gameplay: MediaPipe FPS on iPad is
// the known bottleneck, so callers must stop() before the camera starts.

import * as THREE from "../vendor/three/three.module.js";

const TAU = Math.PI * 2;

// Per-screen looks. "castle" matches the fantasy menu art; "meadow" is a dusk
// clover field that fits the wooden-frame art of Body Spelling Challenge.
const THEMES = {
  castle: {
    sky: 0x1d1a6b,
    fog: [0x241c78, 0.011],
    clouds: [0xc9b8ff, 0xffd6f4],
    circle: { outer: 0xffd98a, inner: 0x8fe3ff, glow: 0xb57bff, echo: 0xd08cff },
    beam: 0xc9a2ff,
    crystals: [0x8fe3ff, 0xff9ff0, 0xffe39a, 0xb99bff],
    sparkles: [0xffffff, 0xffe8a8, 0xd6c8ff, 0x9fe8ff],
    tiles: "gem",
    leaves: false,
    hills: false,
  },
  meadow: {
    sky: 0x2a2466,
    fog: [0x3a2f73, 0.016],
    clouds: [0xffc9e6, 0xd9c8ff],
    circle: { outer: 0xffe08a, inner: 0xb4ff9a, glow: 0x9dff7a, echo: 0xfff0a0 },
    beam: 0xfff0b0,
    crystals: null,
    sparkles: [0xfff4a8, 0xd8ff9a, 0xffffff, 0xffd27a],
    tiles: "magnet",
    leaves: true,
    hills: true,
  },
  // Generic wizard-school classroom: candle-lit stone hall with a corner
  // for each game (see VIEWS / addStations).
  classroom: {
    sky: 0x0e0810,
    fog: [0x1a1018, 0.018],
    clouds: null,
    circle: { outer: 0xffd98a, inner: 0xffc46a, glow: 0xffa84a, echo: 0xffe0a0 },
    beam: 0xffd9a0,
    crystals: null,
    sparkles: [0xffe2a8, 0xffd08a, 0xffffff, 0xfff0c8],
    tiles: "gem",
    leaves: false,
    hills: false,
    room: true,
    hemi: [0xffd9b0, 0x2a1820, 0.45],
    key: 0.3,
    rim: 0x6f8cff,
  },
};

export function mountMagicScene(opts = {}) {
  const {
    background = null, // image URL used as the far parallax layer
    host = document.body, // element the fixed canvas is inserted into
    floorY = -3.1, // height of the magic circle
    intensity = 1, // 0..1 scales particle counts
    zIndex = 0,
    theme: themeName = "castle",
    maxFps = 60, // lower it for pages left open a long time (the class board)
    view = "hub", // classroom theme: which corner the camera starts in
  } = opts;
  const theme = THEMES[themeName] || THEMES.castle;

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null;

  let renderer;
  const canvas = document.createElement("canvas");
  canvas.className = "scene3d-canvas";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: String(zIndex),
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 1.2s ease",
  });

  try {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: dpr < 1.5,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(dpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
  } catch (err) {
    console.warn("[scene3d] WebGL unavailable, keeping CSS background", err);
    return null;
  }

  host.insertBefore(canvas, host.firstChild);

  const small = Math.min(innerWidth, innerHeight) < 700;
  const density = Math.max(0.2, Math.min(1, intensity)) * (small ? 0.55 : 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.FogExp2(theme.fog[0], theme.fog[1]);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
  const camBase = new THREE.Vector3(0, 0.25, 10);
  const lookAt = new THREE.Vector3(0, -0.2, -2);
  camera.position.set(0, 2.4, 15); // intro fly-in start

  const disposables = [];
  const track = (x) => (disposables.push(x), x);

  // ---------- lights ----------
  const hemi = theme.hemi || [0xd8ccff, 0x2a1466, 1.4];
  scene.add(new THREE.HemisphereLight(hemi[0], hemi[1], hemi[2]));
  const key = new THREE.DirectionalLight(0xffffff, theme.key ?? 1.6);
  key.position.set(3, 6, 8);
  if (!theme.room) scene.add(key); // the classroom is lit by its candles
  const circleLight = new THREE.PointLight(0xffc877, 30, 14, 1.6);
  circleLight.position.set(0, floorY + 0.8, 0);
  scene.add(circleLight);
  const rimLight = new THREE.PointLight(theme.rim ?? 0x9d7bff, 40, 20, 1.5);
  rimLight.position.set(-5, 3, -3);
  if (!theme.room) scene.add(rimLight);

  // ---------- far background (the painted castle) ----------
  const BG_Z = -26;
  let bgMesh = null;
  let bgAspect = 1448 / 1086;
  if (background) {
    const tex = track(new THREE.TextureLoader().load(background, (t) => {
      bgAspect = t.image.width / t.image.height;
      layoutBackground();
    }));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = track(new THREE.MeshBasicMaterial({
      map: tex,
      color: 0x958ce0,
      fog: false,
      toneMapped: false,
      depthWrite: false,
    }));
    bgMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), mat);
    bgMesh.position.z = BG_Z;
    bgMesh.renderOrder = -10;
    scene.add(bgMesh);
  }

  if (theme.hills) addMeadowBackdrop(scene, track, floorY);
  const room = theme.room ? addClassroom(scene, track, floorY, small) : null;
  const stations = theme.room ? addStations(scene, track, floorY) : null;

  // Camera "view" the parallax orbits around. flyTo() animates it between
  // the classroom corners; other themes only have the hub.
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const startView = (theme.room && VIEWS[view]) || VIEWS.hub;
  const viewPos = v3(startView.pos);
  const viewLook = v3(startView.look);
  const introFrom = viewPos
    .clone()
    .add(viewPos.clone().sub(viewLook).normalize().multiplyScalar(5))
    .add(new THREE.Vector3(0, 2, 0));
  let flight = null;
  const camTarget = new THREE.Vector3();

  function layoutBackground() {
    if (!bgMesh) return;
    const dist = camBase.z - BG_Z;
    const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    const viewW = viewH * camera.aspect;
    // "cover" plus headroom so pointer parallax never reveals an edge
    let w = viewW * 1.22;
    let h = w / bgAspect;
    if (h < viewH * 1.22) {
      h = viewH * 1.22;
      w = h * bgAspect;
    }
    bgMesh.scale.set(w, h, 1);
    // centre the painting on where the camera actually looks at that depth
    const dir = lookAt.clone().sub(camBase);
    bgMesh.position.y = camBase.y + dir.y * ((BG_Z - camBase.z) / dir.z);
  }

  // ---------- soft cloud / haze layers ----------
  const cloudTex = track(makeCloudTexture());
  const clouds = [];
  const cloudCount = !theme.clouds ? 0 : small ? 5 : 9;
  for (let i = 0; i < cloudCount; i++) {
    const mat = track(new THREE.SpriteMaterial({
      map: cloudTex,
      color: theme.clouds[i % 2],
      transparent: true,
      opacity: 0.16 + Math.random() * 0.12,
      depthWrite: false,
      fog: false,
    }));
    const s = new THREE.Sprite(mat);
    const scale = 7 + Math.random() * 7;
    s.scale.set(scale * 1.8, scale, 1);
    s.position.set(rand(-16, 16), rand(-5, -1.5), rand(-18, -7));
    s.userData.speed = rand(0.08, 0.22) * (Math.random() < 0.5 ? -1 : 1);
    clouds.push(s);
    scene.add(s);
  }

  // ---------- magic circle on the floor ----------
  const circle = new THREE.Group();
  circle.position.y = floorY;
  scene.add(circle);

  const R = 3.1;
  const outerTex = track(makeRuneRingTexture());
  const innerTex = track(makeSigilTexture());
  const glowTex = track(makeGlowTexture());

  const ringMat = (map, color, opacity) =>
    track(new THREE.MeshBasicMaterial({
      map,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    }));

  const flat = (geo, mat, y = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    circle.add(m);
    return m;
  };

  const glowDisc = flat(track(new THREE.PlaneGeometry(R * 3.4, R * 3.4)), ringMat(glowTex, theme.circle.glow, 0.55), -0.01);
  const outerRing = flat(track(new THREE.PlaneGeometry(R * 2, R * 2)), ringMat(outerTex, theme.circle.outer, 0.95), 0.0);
  const innerRing = flat(track(new THREE.PlaneGeometry(R * 1.36, R * 1.36)), ringMat(innerTex, theme.circle.inner, 0.9), 0.02);
  const echoRing = flat(track(new THREE.PlaneGeometry(R * 2.5, R * 2.5)), ringMat(outerTex, theme.circle.echo, 0.28), 0.35);

  // rising beam of light
  const beamMat = track(new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(theme.beam) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 2.2);
        float streak = 0.55 + 0.45 * sin(vUv.x * 62.83 + uTime * 1.3) * sin(vUv.x * 25.13 - uTime * 0.7);
        float a = fade * (0.1 + 0.1 * streak);
        gl_FragColor = vec4(uColor * a, a);
      }`,
  }));
  const beam = new THREE.Mesh(track(new THREE.CylinderGeometry(R * 0.62, R * 0.8, 9, 48, 1, true)), beamMat);
  beam.position.y = 4.5;
  circle.add(beam);

  // ---------- floating crystals ----------
  const crystalGeo = track(new THREE.OctahedronGeometry(1, 0));
  const crystalPalette = theme.crystals || [];
  const crystals = [];
  const crystalSpots = [
    [-2.1, 0.9, 0.5], [2.2, 1.3, 0.2], [-5.2, 3.3, -4], [5.4, 3.1, -4.5],
    [0, 3.6, -7], [-1.7, -1.4, 1.5], [1.9, -1.1, 1.2], [-9, -1, -8], [9.2, -0.4, -8.5],
  ];
  const crystalCount = !theme.crystals ? 0 : small ? 5 : crystalSpots.length;
  for (let i = 0; i < crystalCount; i++) {
    const color = crystalPalette[i % crystalPalette.length];
    const mat = track(new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.75,
      metalness: 0.25,
      roughness: 0.12,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    }));
    const m = new THREE.Mesh(crystalGeo, mat);
    const s = rand(0.22, 0.42);
    m.scale.set(s, s * 1.7, s);
    const [x, y, z] = crystalSpots[i];
    m.position.set(x, y, z);
    m.userData = { base: new THREE.Vector3(x, y, z), phase: Math.random() * TAU, spin: rand(0.3, 0.8) };
    const halo = new THREE.Sprite(track(new THREE.SpriteMaterial({
      map: glowTex,
      color,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })));
    halo.scale.set(5, 3, 1); // parent's y-stretch makes this round
    m.add(halo);
    crystals.push(m);
    scene.add(m);
  }

  // ---------- drifting letter tiles (spelling theme) ----------
  const tiles = [];
  const letters = "ABCDEFGHIJKLMNOPRSTUWY";
  const tileGeo = track(new THREE.BoxGeometry(0.62, 0.62, 0.12));
  const tileSide = track(theme.tiles === "magnet"
    ? new THREE.MeshStandardMaterial({ color: 0xb87a3d, metalness: 0.05, roughness: 0.7 })
    : new THREE.MeshStandardMaterial({ color: 0xffd27a, metalness: 0.7, roughness: 0.3 }));
  const tileCount = small ? 7 : 14;
  for (let i = 0; i < tileCount; i++) {
    const face = track(new THREE.MeshStandardMaterial({
      map: track(theme.tiles === "magnet"
        ? makeMagnetTexture(letters[(Math.random() * letters.length) | 0], MAGNET_COLORS[i % MAGNET_COLORS.length])
        : makeLetterTexture(letters[(Math.random() * letters.length) | 0], i % 2 ? "#6a3cff" : "#c23cc9")),
      metalness: 0.1,
      roughness: 0.45,
      emissive: 0x2a1060,
      emissiveIntensity: 0.4,
    }));
    const m = new THREE.Mesh(tileGeo, [tileSide, tileSide, tileSide, tileSide, face, face]);
    resetTile(m, true);
    tiles.push(m);
    scene.add(m);
  }
  function resetTile(m, anywhere) {
    // in the classroom keep tiles behind the game corners so they never
    // drift through the corner cameras
    const z = theme.room ? rand(-17, -9) : rand(-11, -3);
    m.position.set(rand(-12, 12), anywhere ? rand(-5, 7) : -6.5, z);
    m.rotation.set(rand(-0.4, 0.4), rand(-0.8, 0.8), rand(-0.3, 0.3));
    m.scale.setScalar(rand(1.3, 2));
    m.userData = { vy: rand(0.18, 0.42), spin: rand(-0.5, 0.5), sway: rand(0.2, 0.6), phase: Math.random() * TAU };
  }

  // ---------- sparkle field ----------
  const sparkleCount = Math.round(900 * density);
  const sparkles = makeSparkles(sparkleCount, {
    box: [28, 14, 24],
    center: [0, 1, -6],
    rise: 0.25,
    sizeRange: [0.6, 2.2],
    colors: theme.sparkles,
  });
  scene.add(sparkles.points);

  const leaves = theme.leaves ? makeLeaves(small ? 8 : 16, track) : null;
  if (leaves) scene.add(leaves.group);

  // spiral of motes rising out of the circle
  const spiralCount = Math.round(260 * density);
  const spiral = makeSpiral(spiralCount, R * 0.9, floorY);
  scene.add(spiral.points);

  // ---------- interaction / loop ----------
  const pointer = new THREE.Vector2();
  const pointerSmooth = new THREE.Vector2();
  const onPointer = (e) => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  };
  addEventListener("pointermove", onPointer, { passive: true });

  function resize() {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the circle in frame on tall phone screens
    camera.fov = camera.aspect < 0.8 ? 62 : camera.aspect < 1.2 ? 52 : 45;
    camera.updateProjectionMatrix();
    layoutBackground();
  }
  resize();
  addEventListener("resize", resize);

  const timer = new THREE.Timer();
  let raf = 0;
  let running = false;
  // Arriving from the menu's fly-in: the camera is already in this corner,
  // so skip the intro and the fade for a continuous hand-off.
  let arrived = false;
  try {
    arrived = theme.room && sessionStorage.getItem("scene3d-arrive") === view;
    sessionStorage.removeItem("scene3d-arrive");
  } catch {}
  if (arrived) canvas.style.transition = "none";
  let introT = arrived ? 1 : 0;
  let firstFrame = true;

  const minFrameMs = 1000 / maxFps - 2;
  let lastDraw = -Infinity;

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (ts - lastDraw < minFrameMs) return;
    lastDraw = ts;
    timer.update(ts);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();

    // cinematic intro fly-in, then pointer parallax + idle sway
    introT = Math.min(1, introT + dt / 2.4);
    const ease = 1 - Math.pow(1 - introT, 3);
    pointerSmooth.lerp(pointer, 1 - Math.pow(0.001, dt));
    const swayX = Math.sin(t * 0.21) * 0.35;
    const swayY = Math.sin(t * 0.17) * 0.12;
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / flight.dur);
      const f = flight.t;
      const k = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      viewPos.lerpVectors(flight.fromPos, flight.toPos, k);
      viewPos.y += Math.sin(Math.PI * k) * 1.2; // gentle swoop
      viewLook.lerpVectors(flight.fromLook, flight.toLook, k);
      if (f >= 1) {
        const done = flight.resolve;
        flight = null;
        done();
      }
    }
    camTarget.set(
      viewPos.x + pointerSmooth.x * 0.9 + swayX,
      viewPos.y - pointerSmooth.y * 0.45 + swayY,
      viewPos.z,
    );
    camera.position.lerpVectors(introFrom, camTarget, ease);
    camera.lookAt(viewLook);

    outerRing.rotation.z = t * 0.08;
    innerRing.rotation.z = -t * 0.15;
    echoRing.rotation.z = -t * 0.04;
    echoRing.position.y = 0.35 + Math.sin(t * 0.8) * 0.12;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
    glowDisc.material.opacity = 0.4 + pulse * 0.25;
    circleLight.intensity = 22 + pulse * 16;
    beamMat.uniforms.uTime.value = t;

    for (const c of crystals) {
      const u = c.userData;
      c.position.y = u.base.y + Math.sin(t * 0.9 + u.phase) * 0.35;
      c.position.x = u.base.x + Math.cos(t * 0.4 + u.phase) * 0.15;
      c.rotation.y = t * u.spin;
      c.rotation.z = Math.sin(t * 0.5 + u.phase) * 0.15;
    }

    for (const m of tiles) {
      const u = m.userData;
      m.position.y += u.vy * dt;
      m.position.x += Math.sin(t * u.sway + u.phase) * 0.004;
      m.rotation.y += u.spin * dt;
      m.rotation.x = Math.sin(t * 0.6 + u.phase) * 0.3;
      if (m.position.y > 8) resetTile(m, false);
    }

    for (const s of clouds) {
      s.position.x += s.userData.speed * dt;
      if (s.position.x > 20) s.position.x = -20;
      if (s.position.x < -20) s.position.x = 20;
    }

    sparkles.uniforms.uTime.value = t;
    spiral.uniforms.uTime.value = t;
    leaves?.update(t, dt);
    room?.update(t);
    stations?.update(t);

    renderer.render(scene, camera);
    if (firstFrame && active) {
      firstFrame = false;
      canvas.style.opacity = "1";
      document.documentElement.classList.add("scene3d-on");
    }
  }

  // `active` lets a page hide the scene while a non-3D screen is showing
  // (e.g. game1's camera stage) without tearing down the WebGL context.
  let active = true;
  function start() {
    if (running || stopped || !active || document.hidden) return;
    running = true;
    timer.reset();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    cancelAnimationFrame(raf);
  }
  function setActive(on) {
    if (on === active) return;
    active = on;
    canvas.style.visibility = on ? "visible" : "hidden";
    document.documentElement.classList.toggle("scene3d-on", on && !firstFrame);
    if (on) start();
    else pause();
  }
  const onVisibility = () => (document.hidden ? pause() : start());
  document.addEventListener("visibilitychange", onVisibility);

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    stop();
  });

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    pause();
    removeEventListener("pointermove", onPointer);
    removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVisibility);
    document.documentElement.classList.remove("scene3d-on");
    sparkles.dispose();
    spiral.dispose();
    for (const d of disposables) d.dispose?.();
    renderer.dispose();
    // free the GPU context now rather than at GC time, so it is gone before
    // MediaPipe spins up on the camera screen
    renderer.forceContextLoss();
    canvas.remove();
  }

  // Resolves when the camera arrives (immediately if there is no such corner
  // or the scene is not animating, so callers can always await it).
  function flyTo(name, dur = 1.6) {
    const v = theme.room && VIEWS[name];
    if (!v) return Promise.resolve();
    if (!running) {
      // not animating (hidden tab, bfcache restore): just jump there
      viewPos.copy(v3(v.pos));
      viewLook.copy(v3(v.look));
      return Promise.resolve();
    }
    introT = 1;
    flight?.resolve();
    return new Promise((resolve) => {
      flight = {
        t: 0,
        dur,
        resolve,
        fromPos: viewPos.clone(),
        fromLook: viewLook.clone(),
        toPos: v3(v.pos),
        toLook: v3(v.look),
      };
    });
  }

  start();
  return { stop, pause, start, setActive, flyTo, canvas };
}

// ------------------------------------------------------------------ helpers

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function canvasTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeGlowTexture() {
  return canvasTexture(256, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.25, "rgba(255,255,255,.45)");
    grd.addColorStop(0.6, "rgba(255,255,255,.08)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}

function makeCloudTexture() {
  return canvasTexture(256, (g, s) => {
    for (let i = 0; i < 26; i++) {
      const x = s * (0.2 + Math.random() * 0.6);
      const y = s * (0.35 + Math.random() * 0.3);
      const r = s * (0.08 + Math.random() * 0.16);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, "rgba(255,255,255,.35)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    }
  });
}

function makeRuneRingTexture() {
  return canvasTexture(1024, (g, s) => {
    const c = s / 2;
    g.translate(c, c);
    g.strokeStyle = "#fff";
    g.fillStyle = "#fff";
    g.shadowColor = "#fff";
    g.shadowBlur = 10;
    const ring = (r, w) => {
      g.lineWidth = w;
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.stroke();
    };
    ring(500, 6);
    ring(482, 2);
    ring(398, 3);
    ring(386, 1.5);
    // letters of the alphabet around the band
    g.font = "bold 46px Georgia, 'Times New Roman', serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < abc.length; i++) {
      g.save();
      g.rotate((i / abc.length) * TAU);
      g.fillText(abc[i], 0, -442);
      g.restore();
    }
    // tick marks
    for (let i = 0; i < 104; i++) {
      g.save();
      g.rotate((i / 104) * TAU);
      g.fillRect(-1.5, -386, 3, i % 4 === 0 ? 22 : 10);
      g.restore();
    }
    // small orbs on the rim
    for (let i = 0; i < 8; i++) {
      g.save();
      g.rotate((i / 8) * TAU + TAU / 16);
      g.beginPath();
      g.arc(0, -491, 13, 0, TAU);
      g.fill();
      g.restore();
    }
  });
}

function makeSigilTexture() {
  return canvasTexture(1024, (g, s) => {
    const c = s / 2;
    g.translate(c, c);
    g.strokeStyle = "#fff";
    g.fillStyle = "#fff";
    g.shadowColor = "#fff";
    g.shadowBlur = 14;
    g.lineWidth = 5;
    g.beginPath();
    g.arc(0, 0, 490, 0, TAU);
    g.stroke();
    // eight-point star from two squares
    for (const off of [0, Math.PI / 4]) {
      g.beginPath();
      for (let i = 0; i <= 4; i++) {
        const a = off + (i / 4) * TAU;
        const x = Math.cos(a) * 470;
        const y = Math.sin(a) * 470;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    // hexagram
    g.lineWidth = 3;
    for (const off of [0, Math.PI]) {
      g.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = off - Math.PI / 2 + (i / 3) * TAU;
        const x = Math.cos(a) * 330;
        const y = Math.sin(a) * 330;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 330, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 165, 0, TAU);
    g.stroke();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * TAU;
      g.beginPath();
      g.arc(Math.cos(a) * 330, Math.sin(a) * 330, 22, 0, TAU);
      g.stroke();
    }
    g.beginPath();
    g.arc(0, 0, 40, 0, TAU);
    g.fill();
  });
}

function makeLetterTexture(letter, gem) {
  return canvasTexture(256, (g, s) => {
    const grd = g.createLinearGradient(0, 0, s, s);
    grd.addColorStop(0, "#fff3c4");
    grd.addColorStop(0.5, "#e7a93b");
    grd.addColorStop(1, "#fff0b3");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    const inner = g.createRadialGradient(s * 0.35, s * 0.3, 10, s / 2, s / 2, s * 0.6);
    inner.addColorStop(0, "#ffffff");
    inner.addColorStop(0.18, gem);
    inner.addColorStop(1, "#1d0f5c");
    g.fillStyle = inner;
    g.fillRect(18, 18, s - 36, s - 36);
    g.font = "bold 170px Georgia, 'Times New Roman', serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(255,220,140,.9)";
    g.shadowBlur = 18;
    g.fillStyle = "#fff";
    g.fillText(letter, s / 2, s / 2 + 10);
  });
}

const SPARKLE_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p);
    float core = exp(-r * r * 60.0);
    float cross = exp(-abs(p.x) * 40.0) * exp(-abs(p.y) * 8.0)
                + exp(-abs(p.y) * 40.0) * exp(-abs(p.x) * 8.0);
    float a = (core + cross * 0.55) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a, a);
  }`;

function pointsMaterial(uniforms, vertexShader) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: SPARKLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function makeSparkles(count, { box, center, rise, sizeRange, colors }) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const extra = new Float32Array(count * 2); // size, phase
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    pos[i * 3] = center[0] + (Math.random() - 0.5) * box[0];
    pos[i * 3 + 1] = center[1] + (Math.random() - 0.5) * box[1];
    pos[i * 3 + 2] = center[2] + (Math.random() - 0.5) * box[2];
    tmp.set(colors[(Math.random() * colors.length) | 0]);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
    extra[i * 2] = rand(sizeRange[0], sizeRange[1]);
    extra[i * 2 + 1] = Math.random() * TAU;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("extra", new THREE.BufferAttribute(extra, 2));
  const uniforms = {
    uTime: { value: 0 },
    uRise: { value: rise },
    uHeight: { value: box[1] },
    uBottom: { value: center[1] - box[1] / 2 },
    uScale: { value: Math.min(window.devicePixelRatio || 1, 1.5) * innerHeight * 0.13 },
  };
  const mat = pointsMaterial(uniforms, /* glsl */ `
    uniform float uTime, uRise, uHeight, uBottom, uScale;
    attribute vec3 color;
    attribute vec2 extra;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec3 p = position;
      p.y = uBottom + mod(p.y - uBottom + uTime * uRise * extra.x * 0.5, uHeight);
      p.x += sin(uTime * 0.4 + extra.y) * 0.3;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float tw = 0.5 + 0.5 * sin(uTime * (1.2 + extra.x) + extra.y * 3.0);
      vAlpha = 0.35 + 0.9 * tw * tw;
      vColor = color;
      gl_PointSize = extra.x * uScale * (1.0 / -mv.z) * (0.6 + 0.6 * tw);
    }`);
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // vertices move in the shader
  return {
    points,
    uniforms,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

function makeSpiral(count, radius, floorY) {
  const seed = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seed[i * 3] = Math.random(); // phase along the climb
    seed[i * 3 + 1] = Math.random() * TAU; // angle offset
    seed[i * 3 + 2] = rand(0.7, 1.6); // size
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("seed", new THREE.BufferAttribute(seed, 3));
  const uniforms = {
    uTime: { value: 0 },
    uRadius: { value: radius },
    uFloor: { value: floorY },
    uScale: { value: Math.min(window.devicePixelRatio || 1, 1.5) * innerHeight * 0.13 },
  };
  const mat = pointsMaterial(uniforms, /* glsl */ `
    uniform float uTime, uRadius, uFloor, uScale;
    attribute vec3 seed;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float k = fract(seed.x + uTime * 0.07);
      float ang = seed.y + k * 9.0 + uTime * 0.6;
      float r = uRadius * (1.0 - k * 0.75);
      vec3 p = vec3(cos(ang) * r, uFloor + k * 7.5, sin(ang) * r);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      vAlpha = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.6, 1.0, k));
      vColor = mix(vec3(1.0, 0.86, 0.55), vec3(0.75, 0.6, 1.0), k);
      gl_PointSize = seed.z * uScale * (1.0 / -mv.z);
    }`);
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // vertices move in the shader
  return {
    points,
    uniforms,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------ meadow theme

const MAGNET_COLORS = ["#ef4f67", "#2f80ed", "#2dac6f", "#f5a60c", "#9b51e0"];

function makeMagnetTexture(letter, color) {
  return canvasTexture(256, (g, s) => {
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, "#fffaf0");
    grd.addColorStop(1, "#f1e2c2");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "#c79a5a";
    g.lineWidth = 14;
    g.strokeRect(7, 7, s - 14, s - 14);
    g.font = "900 180px 'Arial Rounded MT Bold', 'Segoe UI', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(0,0,0,.18)";
    g.fillText(letter, s / 2 + 5, s / 2 + 17);
    g.fillStyle = color;
    g.fillText(letter, s / 2, s / 2 + 10);
  });
}

function makeCloverTexture() {
  return canvasTexture(256, (g, s) => {
    g.translate(s / 2, s / 2);
    const leaf = (rot) => {
      g.save();
      g.rotate(rot);
      // heart-shaped leaflet pointing outward from the centre
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(-70, -30, -80, -105, -30, -110);
      g.bezierCurveTo(-8, -112, 0, -95, 0, -82);
      g.bezierCurveTo(0, -95, 8, -112, 30, -110);
      g.bezierCurveTo(80, -105, 70, -30, 0, 0);
      const grd = g.createRadialGradient(0, -60, 5, 0, -60, 90);
      grd.addColorStop(0, "#9df27a");
      grd.addColorStop(1, "#2f9e44");
      g.fillStyle = grd;
      g.fill();
      g.strokeStyle = "rgba(230,255,200,.7)";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(0, -8);
      g.lineTo(0, -70);
      g.stroke();
      g.restore();
    };
    for (let i = 0; i < 3; i++) leaf((i / 3) * TAU);
  });
}

function makeLeaves(count, track) {
  const tex = track(makeCloverTexture());
  const geo = track(new THREE.PlaneGeometry(0.7, 0.7));
  const mat = track(new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.3,
    side: THREE.DoubleSide,
    roughness: 0.6,
    emissive: 0x1d4a12,
    emissiveIntensity: 0.4,
  }));
  const group = new THREE.Group();
  const items = [];
  const reset = (m, anywhere) => {
    m.position.set(rand(-11, 11), anywhere ? rand(-4, 7) : 7.5, rand(-9, 1));
    m.scale.setScalar(rand(0.7, 1.4));
    m.userData = {
      vy: rand(0.25, 0.55),
      spin: new THREE.Vector3(rand(-1.2, 1.2), rand(-1.2, 1.2), rand(-0.8, 0.8)),
      sway: rand(0.5, 1.2),
      phase: Math.random() * TAU,
    };
  };
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mat);
    reset(m, true);
    items.push(m);
    group.add(m);
  }
  return {
    group,
    update(t, dt) {
      for (const m of items) {
        const u = m.userData;
        m.position.y -= u.vy * dt;
        m.position.x += Math.sin(t * u.sway + u.phase) * 0.01;
        m.rotation.x += u.spin.x * dt;
        m.rotation.y += u.spin.y * dt;
        m.rotation.z += u.spin.z * dt;
        if (m.position.y < -5) reset(m, false);
      }
    },
  };
}

// Gradient sky dome, a moon, and three parallax layers of rolling hills.
function addMeadowBackdrop(scene, track, floorY) {
  const skyMat = track(new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 top = vec3(0.07, 0.06, 0.26);
        vec3 mid = vec3(0.33, 0.22, 0.58);
        vec3 low = vec3(1.0, 0.66, 0.55);
        vec3 c = mix(low, mid, smoothstep(-0.12, 0.12, h));
        c = mix(c, top, smoothstep(0.12, 0.6, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(60, 32, 16)), skyMat);
  sky.renderOrder = -20;
  scene.add(sky);

  const moonGlow = new THREE.Sprite(track(new THREE.SpriteMaterial({
    map: track(canvasTexture(256, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, "rgba(255,250,230,1)");
      grd.addColorStop(0.16, "rgba(255,246,220,1)");
      grd.addColorStop(0.2, "rgba(255,230,200,.45)");
      grd.addColorStop(0.5, "rgba(255,200,230,.1)");
      grd.addColorStop(1, "rgba(255,200,230,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    })),
    fog: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })));
  moonGlow.position.set(-13, 9, -40);
  moonGlow.scale.setScalar(16);
  scene.add(moonGlow);

  const layers = [
    { z: -30, top: 3.2, color: "#4a3f93", trees: "#3d3584" },
    { z: -21, top: 1.6, color: "#2f4f7a", trees: "#27446c" },
    { z: -13, top: 0.2, color: "#1f4a45", trees: "#193e3a" },
  ];
  layers.forEach((L, i) => {
    const tex = track(makeHillTexture(L.color, L.trees, i));
    const mat = track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    const w = 110 - i * 25;
    const h = w / 4;
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), mat);
    // the ridge line sits 35% down from the texture's top edge
    mesh.position.set(0, L.top - h * 0.5 + h * 0.35, L.z);
    mesh.renderOrder = -15 + i;
    scene.add(mesh);
  });

  // meadow floor so the circle has ground under it
  const floor = new THREE.Mesh(
    track(new THREE.CircleGeometry(40, 48)),
    track(new THREE.MeshStandardMaterial({ color: 0x1f5a3a, roughness: 1 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, floorY - 0.02, -8);
  scene.add(floor);
}

function makeHillTexture(color, treeColor, seed) {
  const W = 2048;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const ridge = (x) =>
    H * 0.35 +
    Math.sin(x * 0.004 + seed * 2.1) * 34 +
    Math.sin(x * 0.011 + seed) * 16 +
    Math.sin(x * 0.0017 + seed * 4) * 40;
  // round-topped trees along the ridge
  g.fillStyle = treeColor;
  for (let x = 0; x < W; x += 26 + ((x * 7 + seed * 13) % 40)) {
    const y = ridge(x);
    const r = 16 + ((x * 13 + seed * 31) % 26);
    g.beginPath();
    g.arc(x, y - r * 0.6, r, 0, TAU);
    g.arc(x + r * 0.7, y - r * 0.3, r * 0.75, 0, TAU);
    g.fill();
  }
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) g.lineTo(x, ridge(x));
  g.lineTo(W, H);
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------- FX overlay
//
// A transparent canvas *above* the page for one-shot celebrations (3D
// confetti, score bursts). It only renders while particles are alive, so it
// costs nothing while idle.

export function mountFxLayer({ zIndex = 1001 } = {}) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  let renderer;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: String(zIndex),
    pointerEvents: "none",
  });
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (err) {
    return null;
  }
  document.body.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.z = 20;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 2.2));
  const dir = new THREE.DirectionalLight(0xffffff, 1.5);
  dir.position.set(2, 4, 6);
  scene.add(dir);

  let halfW = 1;
  let halfH = 1;
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    halfW = halfH * camera.aspect;
  }
  resize();
  addEventListener("resize", resize);
  const toWorld = (x, y) =>
    new THREE.Vector3((x / innerWidth) * 2 * halfW - halfW, halfH - (y / innerHeight) * 2 * halfH, 0);

  // confetti: one InstancedMesh of small paper rectangles
  const MAX = 420;
  const conf = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.28, 0.46),
    new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, metalness: 0.2 }),
    MAX,
  );
  conf.frustumCulled = false;
  conf.count = 0;
  conf.setColorAt(0, new THREE.Color()); // allocate instanceColor up front
  scene.add(conf);
  const confState = [];

  const starTex = makeGlowTexture();
  const sparks = [];
  const dummy = new THREE.Object3D();
  let raf = 0;
  let last = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;

    let alive = 0;
    for (let i = 0; i < confState.length; i++) {
      const p = confState[i];
      p.vel.y -= 5.5 * dt;
      p.vel.multiplyScalar(1 - 1.4 * dt);
      p.vel.y = Math.max(p.vel.y, -3.2);
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += Math.sin(now * 0.002 + p.phase) * 0.6 * dt;
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      if (p.pos.y < -halfH - 2) continue;
      dummy.position.copy(p.pos);
      dummy.rotation.set(p.rot.x, p.rot.y, p.rot.z);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      conf.setMatrixAt(alive, dummy.matrix);
      conf.setColorAt(alive, p.color);
      confState[alive++] = p;
    }
    confState.length = alive;
    conf.count = alive;
    conf.instanceMatrix.needsUpdate = true;
    conf.instanceColor.needsUpdate = true;

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        scene.remove(s.sprite);
        s.sprite.material.dispose();
        sparks.splice(i, 1);
        continue;
      }
      s.vel.multiplyScalar(1 - 2.5 * dt);
      s.vel.y -= 2 * dt;
      s.sprite.position.addScaledVector(s.vel, dt);
      const k = s.life / s.max;
      s.sprite.material.opacity = Math.min(1, k * 1.6);
      s.sprite.scale.setScalar(s.size * (0.4 + k * 0.6));
    }

    renderer.render(scene, camera);
    if (confState.length || sparks.length) raf = requestAnimationFrame(frame);
    else {
      raf = 0;
      renderer.clear();
    }
  }
  const kick = () => {
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  };

  const PALETTE = [0xef4f67, 0x2f80ed, 0xffd25a, 0x2dac6f, 0xb86bff, 0xffffff, 0xff9f43];

  return {
    confetti(count = 260) {
      for (let i = 0; i < count && confState.length < MAX; i++) {
        const fromLeft = i % 2 === 0;
        confState.push({
          pos: new THREE.Vector3(fromLeft ? -halfW - 0.5 : halfW + 0.5, -halfH * 0.3 + rand(-1, 1), rand(-3, 3)),
          vel: new THREE.Vector3((fromLeft ? 1 : -1) * rand(6, 17), rand(8, 17), rand(-2, 2)),
          rot: new THREE.Vector3(rand(0, TAU), rand(0, TAU), rand(0, TAU)),
          spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-6, 6)),
          phase: rand(0, TAU),
          scale: rand(0.7, 1.3),
          color: new THREE.Color(PALETTE[(Math.random() * PALETTE.length) | 0]),
        });
      }
      kick();
    },
    burst(x, y, hex = 0xffd25a, count = 26) {
      const origin = toWorld(x, y);
      for (let i = 0; i < count; i++) {
        const a = rand(0, TAU);
        const sp = rand(3, 9);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: starTex,
          color: i % 3 ? hex : 0xffffff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }));
        sprite.position.copy(origin);
        scene.add(sprite);
        const life = rand(0.8, 1.4);
        sparks.push({
          sprite,
          vel: new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp + 2, rand(-2, 2)),
          life,
          max: life,
          size: rand(0.9, 2.1),
        });
      }
      kick();
    },
  };
}

// --------------------------------------------------------- classroom theme
//
// A generic wizard-school classroom built entirely from procedural canvas
// textures: stone walls, arched night windows with light shafts, bookshelves,
// a chalkboard, floating candles and a few flapping books.

function repeatTex(tex, rx, ry) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  return tex;
}

function makeBrickTexture() {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = "#2a2026";
    g.fillRect(0, 0, s, s);
    const rowH = 32;
    for (let row = 0; row < s / rowH; row++) {
      const off = row % 2 ? 0 : 36;
      for (let x = -72 + off; x < s; x += 72) {
        const v = 70 + Math.random() * 40;
        g.fillStyle = `rgb(${v + 12}, ${v - 2}, ${v + 6})`;
        g.fillRect(x + 2, row * rowH + 2, 68, rowH - 4);
        // subtle top highlight so bricks read as bevelled
        g.fillStyle = "rgba(255,240,220,.07)";
        g.fillRect(x + 2, row * rowH + 2, 68, 3);
      }
    }
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
}

function makeFloorTexture() {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = "#1c1418";
    g.fillRect(0, 0, s, s);
    const n = 4;
    const t = s / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = 58 + Math.random() * 30;
        g.fillStyle = `rgb(${v + 6}, ${v}, ${v - 4})`;
        g.fillRect(x * t + 3, y * t + 3, t - 6, t - 6);
      }
    }
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.2})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
}

function makeShelfTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#1b1009";
  g.fillRect(0, 0, 1024, 512);
  const spines = ["#6b1a22", "#1f4a32", "#23335e", "#5a3a1a", "#4a1f4f", "#7a5a1a", "#2e2e2e"];
  const shelfH = 128;
  for (let shelf = 0; shelf < 4; shelf++) {
    const base = (shelf + 1) * shelfH - 12;
    let x = 4;
    while (x < 1020) {
      const w = 14 + Math.random() * 18;
      const h = 70 + Math.random() * 40;
      g.fillStyle = spines[(Math.random() * spines.length) | 0];
      g.fillRect(x, base - h, w - 2, h);
      g.fillStyle = "rgba(230,190,90,.75)";
      g.fillRect(x + 1, base - h + 10, w - 4, 3);
      g.fillRect(x + 1, base - 16, w - 4, 3);
      g.fillStyle = "rgba(255,255,255,.08)";
      g.fillRect(x + 2, base - h, 3, h);
      x += w + (Math.random() < 0.08 ? 20 : 0);
    }
    // wooden plank
    g.fillStyle = "#4a2c16";
    g.fillRect(0, base, 1024, 12);
    g.fillStyle = "rgba(255,210,150,.15)";
    g.fillRect(0, base, 1024, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWindowTexture(withMoon) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const g = c.getContext("2d");
  const arch = (inset) => {
    g.beginPath();
    g.moveTo(inset, 512);
    g.lineTo(inset, 128);
    g.arc(128, 128, 128 - inset, Math.PI, 0);
    g.lineTo(256 - inset, 512);
    g.closePath();
  };
  // stone surround
  arch(0);
  g.fillStyle = "#3b3038";
  g.fill();
  // night sky glass
  arch(16);
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, "#1a2a6e");
  sky.addColorStop(0.6, "#3a5cb0");
  sky.addColorStop(1, "#7fa3e0");
  g.fillStyle = sky;
  g.fill();
  g.save();
  arch(16);
  g.clip();
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`;
    g.fillRect(Math.random() * 256, Math.random() * 360, 2, 2);
  }
  if (withMoon) {
    const m = g.createRadialGradient(150, 150, 0, 150, 150, 70);
    m.addColorStop(0, "rgba(255,252,235,1)");
    m.addColorStop(0.4, "rgba(255,250,225,1)");
    m.addColorStop(0.46, "rgba(220,230,255,.45)");
    m.addColorStop(1, "rgba(200,220,255,0)");
    g.fillStyle = m;
    g.fillRect(60, 60, 180, 180);
  }
  g.restore();
  // lead cames: diamond lattice + mullion
  g.save();
  arch(16);
  g.clip();
  g.strokeStyle = "rgba(20,14,24,.85)";
  g.lineWidth = 3;
  for (let k = -512; k < 768; k += 48) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 512, 512);
    g.moveTo(k + 512, 0);
    g.lineTo(k, 512);
    g.stroke();
  }
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(128, 512);
  g.moveTo(0, 300);
  g.lineTo(256, 300);
  g.stroke();
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeChalkboardTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#5a3418";
  g.fillRect(0, 0, 1024, 512);
  const board = g.createLinearGradient(0, 0, 1024, 512);
  board.addColorStop(0, "#1f2e27");
  board.addColorStop(1, "#16221d");
  g.fillStyle = board;
  g.fillRect(28, 28, 968, 456);
  // old smudges
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 512;
    const r = 40 + Math.random() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(255,255,255,.06)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(28, 28, 968, 456);
  }
  g.fillStyle = "rgba(245,245,235,.9)";
  g.shadowColor = "rgba(255,255,255,.5)";
  g.shadowBlur = 4;
  g.textAlign = "center";
  g.font = "bold 92px 'Segoe Print', 'Comic Sans MS', cursive";
  g.fillText("A  B  C", 512, 170);
  g.font = "bold 64px 'Segoe Print', 'Comic Sans MS', cursive";
  g.fillText("Spell it right!", 512, 300);
  g.font = "44px 'Segoe Print', 'Comic Sans MS', cursive";
  g.fillStyle = "rgba(255,220,140,.85)";
  g.fillText("h - e - a - d", 512, 400);
  // little chalk star
  g.strokeStyle = "rgba(245,245,235,.85)";
  g.lineWidth = 5;
  g.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = 860 + Math.cos(a) * 44;
    const y = 150 + Math.sin(a) * 44;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.stroke();
  // chalk tray
  g.shadowBlur = 0;
  g.fillStyle = "#6e4222";
  g.fillRect(28, 470, 968, 14);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeShaftTexture() {
  return canvasTexture(256, (g, s) => {
    const v = g.createLinearGradient(0, 0, 0, s);
    v.addColorStop(0, "rgba(255,255,255,.9)");
    v.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = v;
    g.fillRect(0, 0, s, s);
    // soften the sides
    g.globalCompositeOperation = "destination-in";
    const h = g.createLinearGradient(0, 0, s, 0);
    h.addColorStop(0, "rgba(0,0,0,0)");
    h.addColorStop(0.3, "rgba(0,0,0,1)");
    h.addColorStop(0.7, "rgba(0,0,0,1)");
    h.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = h;
    g.fillRect(0, 0, s, s);
  });
}

function addClassroom(scene, track, floorY, small) {
  const W = 26; // room width
  const BACK = -18;
  const FRONT = 12;
  const H = 18;
  const depth = FRONT - BACK;
  const top = floorY + H;

  const stone = (rx, ry, color = 0xffffff) =>
    track(new THREE.MeshStandardMaterial({
      map: track(repeatTex(makeBrickTexture(), rx, ry)),
      color,
      roughness: 0.95,
    }));

  // floor
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(W, depth)),
    track(new THREE.MeshStandardMaterial({
      map: track(repeatTex(makeFloorTexture(), 5, 6)),
      roughness: 0.55,
      metalness: 0.1,
    })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, floorY - 0.03, (BACK + FRONT) / 2);
  scene.add(floor);

  // back wall + side walls + ceiling
  const back = new THREE.Mesh(track(new THREE.PlaneGeometry(W, H)), stone(8, 9));
  back.position.set(0, floorY + H / 2, BACK);
  scene.add(back);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(track(new THREE.PlaneGeometry(depth, H)), stone(9, 9, 0xd8ccd0));
    wall.rotation.y = -side * Math.PI / 2;
    wall.position.set(side * W / 2, floorY + H / 2, (BACK + FRONT) / 2);
    scene.add(wall);
  }
  const ceiling = new THREE.Mesh(
    track(new THREE.PlaneGeometry(W, depth)),
    track(new THREE.MeshStandardMaterial({ color: 0x1a1016, roughness: 1 })),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, top, (BACK + FRONT) / 2);
  scene.add(ceiling);

  // pillars between the windows
  const pillarMat = stone(1, 8, 0xb8aab4);
  const pillarGeo = track(new THREE.BoxGeometry(1.3, H, 1.3));
  for (const x of [-10.6, -3.6, 3.6, 10.6]) {
    const p = new THREE.Mesh(pillarGeo, pillarMat);
    p.position.set(x, floorY + H / 2, BACK + 0.6);
    scene.add(p);
  }

  // tall arched windows, glowing with moonlight
  const windows = [
    { x: -7.1, moon: false },
    { x: 0, moon: true },
    { x: 7.1, moon: false },
  ];
  const winGeo = track(new THREE.PlaneGeometry(4, 8));
  for (const w of windows) {
    const m = new THREE.Mesh(winGeo, track(new THREE.MeshBasicMaterial({
      map: track(makeWindowTexture(w.moon)),
      transparent: true,
      fog: false,
      toneMapped: false,
    })));
    m.position.set(w.x, floorY + (w.moon ? 10.2 : 8.6), BACK + 0.05);
    scene.add(m);
  }

  // light shafts falling from the side windows
  const shaftTex = track(makeShaftTexture());
  const shaftMat = track(new THREE.MeshBasicMaterial({
    map: shaftTex,
    color: 0x9fb8ff,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  }));
  const shafts = [];
  for (const w of windows) {
    const sh = new THREE.Mesh(track(new THREE.PlaneGeometry(3.6, 16)), shaftMat);
    // hang from the window and lean forward into the room
    sh.geometry.translate(0, -8, 0);
    sh.position.set(w.x, floorY + (w.moon ? 12 : 10.5), BACK + 0.4);
    sh.rotation.x = -0.72;
    scene.add(sh);
    shafts.push(sh);
  }

  // bookshelves along both side walls
  const shelfTex = track(makeShelfTexture());
  for (const side of [-1, 1]) {
    const tex = shelfTex.clone();
    track(tex);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(3, 1);
    const shelf = new THREE.Mesh(
      track(new THREE.PlaneGeometry(22, 7.5)),
      track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })),
    );
    shelf.rotation.y = -side * Math.PI / 2;
    shelf.position.set(side * (W / 2 - 0.05), floorY + 3.75, BACK + 11);
    scene.add(shelf);
  }

  // chalkboard under the centre window
  const board = new THREE.Mesh(
    track(new THREE.PlaneGeometry(6.4, 3.2)),
    track(new THREE.MeshStandardMaterial({ map: track(makeChalkboardTexture()), roughness: 0.9 })),
  );
  board.position.set(0, floorY + 4.3, BACK + 0.08);
  scene.add(board);

  // floating candles: one InstancedMesh for the wax, one Points for flames
  const N = small ? 22 : 44;
  const candleGeo = track(new THREE.CylinderGeometry(0.07, 0.08, 0.62, 10));
  candleGeo.translate(0, -0.31, 0); // origin at the wick end
  const candleMat = track(new THREE.MeshStandardMaterial({
    color: 0xfff1d6,
    emissive: 0x6a3a10,
    emissiveIntensity: 0.35,
    roughness: 0.6,
  }));
  const candles = new THREE.InstancedMesh(candleGeo, candleMat, N);
  candles.frustumCulled = false;
  scene.add(candles);
  const base = [];
  // keep candles clear of the corner cameras so none hangs right in the lens
  const cams = Object.values(VIEWS).map((v) => new THREE.Vector3(...v.pos));
  const probe = new THREE.Vector3();
  while (base.length < N) {
    probe.set(rand(-11, 11), floorY + rand(6.8, 12), rand(-16, 5));
    if (cams.some((c) => c.distanceTo(probe) < 6)) continue;
    base.push({
      x: probe.x,
      y: probe.y,
      z: probe.z,
      phase: Math.random() * TAU,
      speed: rand(0.5, 1.1),
    });
  }
  const flamePos = new Float32Array(N * 3);
  const flameSeed = new Float32Array(N);
  base.forEach((b, i) => (flameSeed[i] = b.phase));
  const flameGeo = new THREE.BufferGeometry();
  flameGeo.setAttribute("position", new THREE.BufferAttribute(flamePos, 3));
  flameGeo.setAttribute("seed", new THREE.BufferAttribute(flameSeed, 1));
  const flameUniforms = {
    uTime: { value: 0 },
    uScale: { value: Math.min(window.devicePixelRatio || 1, 1.5) * innerHeight * 0.5 },
  };
  const flameMat = new THREE.ShaderMaterial({
    uniforms: flameUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime, uScale;
      attribute float seed;
      varying float vFlick;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vFlick = 0.8 + 0.2 * sin(uTime * 13.0 + seed * 7.0) * sin(uTime * 7.3 + seed);
        gl_PointSize = uScale * 2.6 * vFlick / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      varying float vFlick;
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5, 0.62);
        // teardrop: narrow above, round below
        float w = p.y < 0.0 ? 0.13 + p.y * 0.2 : 0.13;
        float d = length(vec2(p.x / max(w, 0.02), p.y * 4.0));
        float core = exp(-d * d * 3.5);
        float halo = exp(-dot(p, p) * 14.0) * 0.45;
        vec3 col = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.95, 0.75), core);
        float a = (core + halo) * vFlick;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  track(flameGeo);
  track(flameMat);
  const flames = new THREE.Points(flameGeo, flameMat);
  flames.frustumCulled = false;
  scene.add(flames);

  // two warm lights that flicker with the candles
  const candleLights = [
    new THREE.PointLight(0xffb45a, 70, 26, 1.4),
    new THREE.PointLight(0xffa04a, 60, 26, 1.4),
  ];
  candleLights[0].position.set(-6, floorY + 10, -6);
  candleLights[1].position.set(6, floorY + 10, -3);
  for (const l of candleLights) scene.add(l);
  const moon = new THREE.DirectionalLight(0x8fa8ff, 0.9);
  moon.position.set(0, 10, -20);
  scene.add(moon);

  // flying books flapping around the upper hall
  const books = [];
  const bookCount = small ? 2 : 4;
  const coverColors = [0x7a1f27, 0x1f4d38, 0x2c3a7a, 0x6a4a1a];
  const pageMat = track(new THREE.MeshStandardMaterial({ color: 0xf3e6c8, roughness: 0.9, side: THREE.DoubleSide }));
  const coverGeo = track(new THREE.BoxGeometry(0.62, 0.035, 0.85));
  coverGeo.translate(0.31, 0, 0); // hinge on the spine
  const pageGeo = track(new THREE.PlaneGeometry(0.56, 0.78));
  pageGeo.rotateX(-Math.PI / 2);
  pageGeo.translate(0.3, 0.03, 0);
  for (let i = 0; i < bookCount; i++) {
    const coverMat = track(new THREE.MeshStandardMaterial({ color: coverColors[i % coverColors.length], roughness: 0.6 }));
    const book = new THREE.Group();
    const halves = [];
    for (const dir of [1, -1]) {
      const half = new THREE.Group();
      half.add(new THREE.Mesh(coverGeo, coverMat));
      half.add(new THREE.Mesh(pageGeo, pageMat));
      half.scale.x = dir;
      book.add(half);
      halves.push(half);
    }
    book.userData = {
      halves,
      cx: rand(-5, 5),
      cy: floorY + rand(6.5, 9.5),
      cz: rand(-12, -5),
      rx: rand(4, 7),
      rz: rand(2, 4),
      speed: rand(0.18, 0.3) * (i % 2 ? 1 : -1),
      phase: Math.random() * TAU,
    };
    scene.add(book);
    books.push(book);
  }

  const dummy = new THREE.Object3D();
  const prev = new THREE.Vector3();
  return {
    update(t) {
      for (let i = 0; i < N; i++) {
        const b = base[i];
        const y = b.y + Math.sin(t * b.speed + b.phase) * 0.25;
        dummy.position.set(b.x, y, b.z);
        dummy.rotation.set(0, 0, Math.sin(t * 0.7 + b.phase) * 0.04);
        dummy.updateMatrix();
        candles.setMatrixAt(i, dummy.matrix);
        flamePos[i * 3] = b.x;
        flamePos[i * 3 + 1] = y + 0.12;
        flamePos[i * 3 + 2] = b.z;
      }
      candles.instanceMatrix.needsUpdate = true;
      flameGeo.attributes.position.needsUpdate = true;
      flameUniforms.uTime.value = t;

      candleLights[0].intensity = 62 + Math.sin(t * 9.1) * 5 + Math.sin(t * 23.7) * 3;
      candleLights[1].intensity = 54 + Math.sin(t * 7.7 + 1) * 5 + Math.sin(t * 19.3) * 3;
      for (const sh of shafts) sh.material.opacity = 0.13 + Math.sin(t * 0.3) * 0.03;

      for (const book of books) {
        const u = book.userData;
        const a = t * u.speed + u.phase;
        prev.copy(book.position);
        book.position.set(
          u.cx + Math.sin(a) * u.rx,
          u.cy + Math.sin(a * 2.3) * 0.6,
          u.cz + Math.cos(a) * u.rz,
        );
        const dx = book.position.x - prev.x;
        const dz = book.position.z - prev.z;
        if (dx || dz) book.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
        book.rotation.z = Math.sin(a * 2) * 0.15;
        const flap = 0.35 + Math.sin(t * 7 + u.phase) * 0.55;
        u.halves[0].rotation.z = flap;
        u.halves[1].rotation.z = -flap;
      }
    },
  };
}

// Camera anchors. "hub" is the menu's wide shot; each game has its own corner
// of the classroom that the menu flies into and that game's pages start at.
const VIEWS = {
  hub: { pos: [0, 0.25, 10], look: [0, -0.2, -2] },
  spelling: { pos: [-5.2, 0.7, -4.2], look: [-8.6, -0.4, -11.6] },
  body: { pos: [5.2, 0.7, -4.2], look: [8.6, -0.4, -11.6] },
};

function makeBannerTexture(lines, colorA, colorB) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 768;
  const g = c.getContext("2d");
  // cloth with a swallow-tail bottom
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(512, 0);
  g.lineTo(512, 690);
  g.lineTo(256, 610);
  g.lineTo(0, 690);
  g.closePath();
  const cloth = g.createLinearGradient(0, 0, 512, 0);
  cloth.addColorStop(0, colorB);
  cloth.addColorStop(0.5, colorA);
  cloth.addColorStop(1, colorB);
  g.fillStyle = cloth;
  g.fill();
  g.strokeStyle = "#e8c070";
  g.lineWidth = 14;
  g.stroke();
  g.fillStyle = "#ffe6a0";
  g.textAlign = "center";
  g.shadowColor = "rgba(0,0,0,.5)";
  g.shadowBlur = 8;
  g.font = "bold 76px Georgia, 'Times New Roman', serif";
  lines.forEach((ln, i) => g.fillText(ln, 256, 200 + i * 96));
  // star emblem
  g.beginPath();
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 26 : 62;
    const x = 256 + Math.cos(a) * r;
    const y = 470 + Math.sin(a) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeTargetTexture() {
  return canvasTexture(512, (g, s) => {
    const rings = ["#f4f1ea", "#1d1d24", "#2f7de0", "#e03a4a", "#f5c542"];
    for (let i = 0; i < 10; i++) {
      g.beginPath();
      g.arc(s / 2, s / 2, (s / 2) * (1 - i / 10), 0, TAU);
      g.fillStyle = rings[Math.floor(i / 2)];
      g.fill();
      g.strokeStyle = "rgba(0,0,0,.25)";
      g.lineWidth = 2;
      g.stroke();
    }
  });
}

function makeBookPageTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = "#f6ead0";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(90,60,30,.35)";
    g.lineWidth = 2;
    for (let y = 40; y < s - 20; y += 18) {
      g.beginPath();
      g.moveTo(20, y);
      g.lineTo(s - 20, y);
      g.stroke();
    }
    g.fillStyle = "#6a3cc9";
    g.font = "bold 90px Georgia, serif";
    g.textAlign = "center";
    g.fillText("Aa", s / 2, 130);
  });
}

function addStations(scene, track, floorY) {
  const wood = track(new THREE.MeshStandardMaterial({ color: 0x6b4424, roughness: 0.7 }));
  const glowTex = track(makeGlowTexture());
  const floorGlow = (x, z, color) => {
    const m = new THREE.Mesh(
      track(new THREE.PlaneGeometry(6, 6)),
      track(new THREE.MeshBasicMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, floorY + 0.02, z);
    scene.add(m);
  };
  const banner = (x, z, lines, a, b) => {
    const m = new THREE.Mesh(
      track(new THREE.PlaneGeometry(2.4, 3.6)),
      track(new THREE.MeshStandardMaterial({
        map: track(makeBannerTexture(lines, a, b)),
        transparent: true,
        alphaTest: 0.2,
        side: THREE.DoubleSide,
        roughness: 0.8,
        emissive: 0xffffff,
        emissiveIntensity: 0.12,
      })),
    );
    m.position.set(x, floorY + 6.3, z);
    scene.add(m);
    return m;
  };

  // ---- Spelling Adventure corner (left): desk, open book, orbiting letters
  const SX = -8.6;
  const SZ = -11.6;
  const desk = new THREE.Group();
  const top = new THREE.Mesh(track(new THREE.BoxGeometry(3.2, 0.16, 1.7)), wood);
  top.position.y = 1.9;
  desk.add(top);
  const legGeo = track(new THREE.BoxGeometry(0.16, 1.9, 0.16));
  for (const [lx, lz] of [[-1.45, -0.7], [1.45, -0.7], [-1.45, 0.7], [1.45, 0.7]]) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(lx, 0.95, lz);
    desk.add(leg);
  }
  const pageMat = track(new THREE.MeshStandardMaterial({
    map: track(makeBookPageTexture()),
    roughness: 0.9,
    emissive: 0x2a1a08,
    emissiveIntensity: 0.4,
  }));
  const pageGeo = track(new THREE.PlaneGeometry(0.9, 1.1));
  for (const dir of [-1, 1]) {
    const page = new THREE.Mesh(pageGeo, pageMat);
    page.rotation.set(-Math.PI / 2, dir * 0.18, 0);
    page.position.set(dir * 0.47, 2.02, 0);
    desk.add(page);
  }
  desk.position.set(SX, floorY, SZ);
  desk.rotation.y = 0.45;
  scene.add(desk);
  floorGlow(SX, SZ, 0x7fd8ff);
  const spellBanner = banner(SX, SZ - 1.2, ["Spelling", "Adventure"], "#2c55c9", "#16287a");
  spellBanner.rotation.y = 0.45;

  const orbitGeo = track(new THREE.BoxGeometry(0.5, 0.5, 0.1));
  const orbitSide = track(new THREE.MeshStandardMaterial({ color: 0xffd27a, metalness: 0.7, roughness: 0.3 }));
  const orbiters = [];
  const word = "SPELL";
  for (let i = 0; i < word.length; i++) {
    const face = track(new THREE.MeshStandardMaterial({
      map: track(makeLetterTexture(word[i], i % 2 ? "#3c7dff" : "#8a3cff")),
      emissive: 0x3050ff,
      emissiveIntensity: 0.35,
    }));
    const m = new THREE.Mesh(orbitGeo, [orbitSide, orbitSide, orbitSide, orbitSide, face, face]);
    scene.add(m);
    orbiters.push(m);
  }
  const spellLight = new THREE.PointLight(0x7fb8ff, 25, 9, 1.5);
  spellLight.position.set(SX, floorY + 3.2, SZ + 0.5);
  scene.add(spellLight);

  // ---- Body Spelling Challenge corner (right): easel, target, arrow
  const BX = 8.6;
  const BZ = -11.6;
  const easel = new THREE.Group();
  const postGeo = track(new THREE.BoxGeometry(0.14, 4.2, 0.14));
  for (const [px, rz] of [[-0.8, -0.12], [0.8, 0.12]]) {
    const p = new THREE.Mesh(postGeo, wood);
    p.position.set(px, 2.1, 0);
    p.rotation.z = rz;
    easel.add(p);
  }
  const rim = track(new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.8 }));
  const target = new THREE.Mesh(
    track(new THREE.CylinderGeometry(1.25, 1.25, 0.18, 48)),
    [rim, track(new THREE.MeshStandardMaterial({ map: track(makeTargetTexture()), roughness: 0.6 })), rim],
  );
  target.rotation.x = Math.PI / 2; // top cap now faces +z, toward the room
  target.position.set(0, 3.1, 0.1);
  easel.add(target);
  const arrow = new THREE.Group();
  const shaft = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8)),
    track(new THREE.MeshStandardMaterial({ color: 0x8a5a2a })),
  );
  shaft.rotation.x = Math.PI / 2;
  arrow.add(shaft);
  const fletch = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.12, 0.35, 3)),
    track(new THREE.MeshStandardMaterial({ color: 0x2f9be0 })),
  );
  fletch.rotation.x = -Math.PI / 2;
  fletch.position.z = 0.65;
  arrow.add(fletch);
  arrow.position.set(0.15, 3.18, 0.85);
  arrow.rotation.set(0.08, -0.12, 0);
  easel.add(arrow);
  easel.position.set(BX, floorY, BZ);
  easel.rotation.y = -0.45;
  scene.add(easel);
  floorGlow(BX, BZ, 0xff8ad8);
  const bodyBanner = banner(BX, BZ - 1.2, ["Body", "Spelling"], "#a83fb4", "#5a1466");
  bodyBanner.rotation.y = -0.45;
  const bodyLight = new THREE.PointLight(0xff9ad8, 25, 9, 1.5);
  bodyLight.position.set(BX, floorY + 3.4, BZ + 1);
  scene.add(bodyLight);

  return {
    update(t) {
      orbiters.forEach((m, i) => {
        const a = t * 0.8 + (i / orbiters.length) * TAU;
        m.position.set(SX + Math.cos(a) * 1.3, floorY + 3.1 + Math.sin(t * 1.6 + i) * 0.15, SZ + Math.sin(a) * 1.3);
        m.rotation.y = -a + Math.PI / 2;
      });
      spellLight.intensity = 22 + Math.sin(t * 2.2) * 5;
      bodyLight.intensity = 22 + Math.sin(t * 2.2 + 1.5) * 5;
      spellBanner.rotation.z = Math.sin(t * 0.9) * 0.02;
      bodyBanner.rotation.z = Math.sin(t * 0.9 + 1) * 0.02;
    },
  };
}
