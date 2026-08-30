# SongSong Game — Project Memory

Last updated: 2026-08-30 (Asia/Bangkok)

## Running the game

- `เปิดเกม.cmd` calls `start-game.ps1`.
- The opener starts PostgreSQL, starts the Node.js server on port 8080, waits for the site, and opens `http://localhost:8080/menu.html`.
- `ปิดเกม.cmd` calls `stop-game.ps1`.
- The closer stops both the Node.js game server and the PostgreSQL service.
- Windows may show a UAC prompt because controlling PostgreSQL requires administrator permission.
- Desktop shortcuts exist for opening and closing SongSong Game.

## Database

- PostgreSQL 17 is installed directly on Windows (not Docker).
- Windows service: `postgresql-x64-17`.
- Host: `127.0.0.1`, port: `5432`, database: `songsong`.
- Local credentials are stored in `.env.local`, which is ignored by Git.
- The original import is `songsong_backup.sql`.
- Public/private visibility is persisted in `question_sets.is_public`.
- `My body Part` is Public; `Test` is Private at the time of this note.

## Question-set visibility

- Teachers log in to My Question Sets and can toggle each set between Public and Private.
- Public sets appear on the first game setup screen and can be played without login.
- Private sets do not appear to ordinary players.
- Older restored databases are migrated automatically by `server.js` to add `is_public`.

## UI and gameplay decisions

- `menu.html` and setup/management screens use the fantasy castle theme.
- Live gameplay must show the camera feed without a castle background covering it.
- The My Question Sets screen uses the castle background.
- All mascot locations use `images/2BBB9E2A-CDD6-4A4A-8AD1-786A09A5B1CE.png`.
- Menu-facing text is English only.
- Score display uses the highlighted magical badge and score-change animation.
- Submit plays a sound whenever the Submit button is activated.
- Thumbs-up submits on a single hold (1.8s, shown via a fill on the Submit button) — releasing early cancels with no submit, no second gesture needed.
- Thumbs-down Skip gesture has been removed; teachers use the on-screen Skip button.
- Grabbing a card shows only small twinkling stars—no grab scaling, rotating aura, or heavy glow.
- A grabbed card follows the index fingertip (not the thumb/index pinch-gap midpoint), and drop-target detection uses best-overlap-area (falling back to nearest slot center) instead of first-match, so tight slot spacing on phones doesn't misdrop into a neighbor.
- The slot a dragged card is over lights up (`data-drop-target`) before release.
- Question-set teacher login persists via `localStorage` (not `sessionStorage`) and the login form submits on Enter.
- Root (`/`) serves `menu.html`, not `index.html`; every non-gameplay screen has a Home link back to it.

## Main URLs

- Local: `http://localhost:8080/menu.html`
- LAN (current recorded address): `http://192.168.1.37:8080/menu.html`

