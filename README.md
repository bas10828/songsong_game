# Hand-Gesture Spelling Game — Phase 1

Camera + MediaPipe hand tracking + pinch detection + drag one card into one
slot. Purpose: validate feel and frame rate on iPad Safari before building
the rest of the game.

## Stack

- Static HTML/CSS/JS, no build step, no runtime npm dependencies.
- MediaPipe Tasks Vision (`HandLandmarker`), self-hosted under `vendor/mediapipe`
  and `models/hand_landmarker.task` — no CDN calls, no API keys, no recurring
  cost. Everything runs client-side via WASM/WebGL.

## Run locally

```
npm run start
```

Serves the project root at `http://localhost:8080`.

## Important: camera requires a secure context

Browsers only allow camera access on `https://` or on `http://localhost`
from the same machine. A LAN IP like `http://192.168.x.x:8080` will **not**
get a camera prompt on either Chrome or Safari.

To test on a real Android phone or iPad on the same network, tunnel the
local server over HTTPS. `cloudflared` is already available on this machine:

```
cloudflared tunnel --url http://localhost:8080
```

This prints a temporary `https://*.trycloudflare.com` URL — open that on the
iPad/phone. (Alternative: `ngrok http 8080` if you have it set up.)

## What to check on the iPad first

- Open the tunnel URL in Safari, tap **Start Camera**, grant permission.
- Watch the `FPS` counter in the top-left HUD for ~30s of normal hand
  movement. This is the number from the brief's known risk: MediaPipe on
  iOS Safari has historically run far slower (~6-7fps) than on Android
  Chrome (~20-25fps) due to a WebGL/WASM gap, not a hardware limit.
- Try the pinch gesture (thumb tip + index tip together) over the yellow
  card and drag it into the dashed slot; release to drop.
- If GPU delegate fails to initialize, the code falls back to CPU
  automatically (status text will say which one loaded) — note whether that
  fallback fires on this iPad/OS version, since CPU delegate is slower.

If FPS on iPad is unworkable, decide before building Phase 2/3 whether to:
tune model complexity/resolution, try the CPU vs GPU delegate, downscale
the camera feed, or accept a lower frame budget in the UX.

## Project layout

```
index.html            Phase 1 test page
css/style.css
js/main.js            camera + HandLandmarker + pinch/drag logic
vendor/mediapipe/      self-hosted WASM runtime + JS bundle (from @mediapipe/tasks-vision)
models/hand_landmarker.task   self-hosted model asset
server.js             zero-dependency static file server for local/dev use
```

Deploying to the target static host: copy everything except `node_modules`,
`package-lock.json`, and `server.js` (or keep `server.js` too if the host is
a plain Node process — no build step needed either way).

## Regenerating vendor assets (e.g. to bump MediaPipe version)

```
npm install
cp -r node_modules/@mediapipe/tasks-vision/wasm vendor/mediapipe/
cp node_modules/@mediapipe/tasks-vision/vision_bundle.mjs vendor/mediapipe/
```

Model asset (already downloaded) came from:
`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
