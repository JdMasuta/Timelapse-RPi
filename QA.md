# Technical Quality Analysis (QA.md)

> Scope note: This document is a qualitative architecture review intended to guide a
> ground-up rebuild. Per the rebuild constraints, **existing security-obfuscation
> scaffolding is excluded from the streamlining analysis** (path-traversal guards,
> `SecurityError` plumbing, symlink indirection, filename allow-listing). Where one of
> those mechanisms is a *genuine* protection that a real rebuild should keep, it is
> called out explicitly so it is not lost by accident. The configuration recommendations
> assume the new system persists settings in a single JSON file loaded into the
> environment via `dotenv`.

---

## 1. Executive Summary & System Overview

**Timelapse-RPi (a.k.a. "Timelapse2")** is a Node.js application for a Raspberry Pi (or any
V4L2/Unix host) that captures timelapse stills from a camera, offers a live MJPEG preview,
and renders the captured frames into an MP4 via FFmpeg. It is operated through a
browser-based control panel.

### Runtime topology

```
Browser (index.html + api.js + ui.js + app.js)
        │  Socket.IO (port 3000)            ▲  MJPEG <img> tag (port 8080)
        ▼                                   │
Node server (server.js)  ──spawns──►  mjpg_streamer  ──reads──►  /dev/video0
        │
        ▼
CameraService (services/cameraService.js)  ── façade over ──►
    • StreamController   → spawn mjpg_streamer
    • CaptureController  → exec fswebcam  → captures/*.jpg
    • TimelapseController→ interval loop over CaptureController
    • OperationQueue     → js-priority-queue arbitration
    • VideoController    → spawn ffmpeg   → videos/*.mp4
ConfigService (services/configService.js)  ── reads/writes ──►  .env
```

### Primary dataflows

1. **Configuration** — On boot, `ConfigService.loadConfig()` calls `dotenv`, reads
   `process.env`, validates/coerces ~40 keys into a `fullConfig` object, then derives a
   9-field `currentConfig` ("legacy") object that is the only config most camera code
   actually receives. Saves from the UI are written back to `.env` and re-applied to
   `process.env` live.
2. **Capture** — UI emits `startCapture` → `CameraService.startTimelapse()` enqueues a
   `timelapse` operation → `TimelapseController` runs a `setTimeout` loop that pauses the
   stream, shells out to `fswebcam`, writes a timestamped JPG to `captures/`, resumes the
   stream, and pushes `statusUpdate` events back over Socket.IO.
3. **Streaming** — UI emits `toggleStream` → `StreamController` spawns `mjpg_streamer`,
   watches stderr for a ready signal, and the server hands the browser a
   `http://<ip>:8080/?action=stream` URL that the `<img>` element loads directly.
4. **Video generation** — UI emits `generateVideo` → `VideoController` scans
   `captures/`, parses timestamps out of filenames, creates a temp dir of sequential
   symlinks, spawns `ffmpeg`, streams progress percentages back, and writes an MP4 to
   `videos/`.

### Headline architectural observations

- **The system is heavily over-configured relative to what it implements.** The
  `.env.example` is 262 lines; the bulk of it (scheduling, auto-cleanup, rotation/flip,
  mock camera, hardware acceleration, notifications, auth, HTTPS, log rotation) is
  **declared but never consumed by any code path.** Several "headline" settings
  (image quality, camera device, rotation) are loaded and then **ignored** because the
  capture/stream commands hardcode their values.
- **Configuration is fragmented across at least four sources of truth** that do not
  agree: `ConfigService.defaultConfig`, the `.env.example` template, the hardcoded
  constants in `server.js`, and `services/camera/constants.js` (plus a fifth,
  `VideoConfig`, for the video subsystem).
- **There is significant dead and duplicated code.** `services/camera/VideoController.js`
  (~1630 lines) is a complete, self-contained copy of the video pipeline that **nothing
  imports** — the live system uses the modularized `services/video/VideoController.js`.
- **The documented API does not exist.** The README advertises a REST API
  (`POST /api/start`, `GET /api/status`, `/api/stream/*`, …). The server implements
  **none** of these — the real interface is Socket.IO events plus two `/videos/*` file
  routes.
- **Concurrency is modeled twice.** Camera operations use a priority `OperationQueue`;
  video uses a `Mutex`; and stream pause/resume is implemented redundantly in both
  `CaptureController` and `TimelapseController`.

The good news for a rebuild: because so much configuration and code is inert, the
*essential* system is small — capture loop, stream toggle, FFmpeg render, and a Socket.IO
status channel. Most of the streamlining work is **deletion**, not redesign.

---

## 2. Feature & Component Analysis

### 2.1 Configuration Management (`ConfigService` + `.env`)

**Description.** Loads configuration from environment variables (via `dotenv`), validates
and type-coerces it, and persists UI edits back to `.env`. Exposes two shapes:
`getLegacyConfig()` (9 fields the web UI/camera use) and `getExtendedConfig()` (the full
advanced set). Auto-creates `.env` from `.env.example` on first run.

**Dependencies.** `dotenv`, `fs.promises`, `path`. Consumed by `server.js` (boot +
`saveConfig`/`saveExtendedConfig`/`resetConfigToDefaults` handlers).

**System relationships.** It is the root of the config dataflow:
`.env → process.env → fullConfig → currentConfig → camera operations`. Writes flow the
other way: UI form → `saveExtendedConfig` → validate → `mapExtendedConfigToEnv` →
`writeEnvFile` → mutate `process.env`.

**Simplification opportunities.**
- **Single source of truth.** Replace the parallel `defaultConfig` map, the
  `.env.example` template, and the per-module hardcoded constants with one
  `settings.json` (defaults shipped in-repo). See §4.
- **`writeEnvFile` destroys all comments.** `parseEnvContent` drops every `#` line, so the
  first UI save rewrites `.env` as a flat, comment-less `KEY=value` dump. The "262 lines of
  documented options" survive exactly until the user clicks Save once. A JSON file with a
  companion schema/`README` avoids this entirely.
- **Drop the legacy/extended split.** Two overlapping projections of the same config exist
  only for backward compatibility with the current UI. A rebuilt UI should consume one
  flat config object.
- **Delete validation for options that don't drive behavior** (rotation, flip, codec=vp9,
  log levels, etc.) — see the inventory in §4 for which keys are actually live.
- **Boolean/number parsing is hand-rolled** (`parseBool`, `parseNumber`, `validateTime`,
  `??` vs `||` mixing). With a typed JSON file these coercions largely disappear.

### 2.2 Web Server & Socket.IO Orchestration (`server.js`)

**Description.** Express app that (a) serves static files from the project root, (b)
exposes two `/videos/:filename[/stream]` routes (download + HTTP range streaming), and (c)
hosts the Socket.IO server that is the real control API. All user actions are Socket.IO
events; `server.js` is essentially a large `io.on("connection")` handler that delegates to
`CameraService` and broadcasts results.

**Dependencies.** `express`, `socket.io`, `http`, `os` (IP discovery), `path`, `fs`,
`child_process` (imported but stream spawning actually lives in `StreamController`),
`CameraService`, `ConfigService`.

**System relationships.** Central hub. Inbound: Socket.IO events from all browser scripts.
Outbound: method calls into `CameraService`/`ConfigService`, and `io.emit` broadcasts
(`statusUpdate`, `configUpdate`, `extendedConfigUpdate`, `streamStatusUpdate`,
`liveStreamUrl`, `videoGenerationStatus`, `videoListUpdate`, `imageListUpdate`,
`systemInfoUpdate`, `notification`, …). A 5-second `setInterval` pushes memory/uptime/stream
status to all clients.

**Simplification opportunities.**
- **Dead hardcoded constants.** `MJPEG_STREAMER_PATH` / `MJPEG_STREAMER_WWW_PATH` are
  declared at the top of `server.js` and never used (the real values come from
  `constants.js` inside `StreamController`). Delete.
- **Event-handler sprawl.** ~14 socket handlers, several of which are thin pass-throughs
  (`getVideoStatus`, `getVideoCapabilities`, `generateQuickVideo`). `getVideoCapabilities`
  returns a hardcoded literal that duplicates `ConfigService.validOptions`. Consolidate the
  video handlers; derive capabilities from config.
- **Hardcoded stream URL.** `http://${SERVER_IP_ADDRESS}:8080/?action=stream` is rebuilt as
  a string literal in three places. The `8080` port is *also* in `constants.STREAM_CONFIG`
  and `MJPG_STREAMER_PORT` in `.env` — three copies. Centralize.
- **Duplicate shutdown handlers.** `server.js` registers `SIGTERM`/`SIGINT`, and
  `VideoController.setupGracefulShutdown()` registers its *own* `SIGTERM`/`SIGINT` that
  calls `process.exit(0)`. Two competing shutdown paths race on the same signals; the
  video one can exit before the server finishes cleanup. The rebuild should own one
  shutdown sequence.
- **`captureStatus` local variable** in the connection scope is written but the authoritative
  state lives in `CameraService` — it's vestigial.

### 2.3 Camera Service Façade & Operation Queue (`cameraService.js`, `OperationQueue`, `OperationContext`)

**Description.** `CameraService` is a façade that wires together the stream/capture/
timelapse/video controllers and arbitrates camera access through a priority queue so that,
e.g., a user capture can pre-empt a running stream and the stream resumes afterward.
`OperationQueue` wraps `js-priority-queue`; `OperationContext` is the per-operation record
(type, config, callbacks, priority, progress, state).

**Dependencies.** `js-priority-queue`, `adm-zip` (image ZIP), `fs.promises`, `path`, all
camera sub-controllers, and `video/VideoController`.

**System relationships.** Sole intermediary between `server.js` and the hardware-facing
controllers. Holds the canonical capture state (`getStatus()` is the source for
`statusUpdate`/`systemInfoUpdate`).

**Simplification opportunities.**
- **The priority queue is over-engineered for the actual workload.** There are only four
  priorities and, in practice, the device supports one camera consumer at a time. The
  pre-empt/pause/resume/`continueNextOperation` machinery (~250 lines across
  `cameraService.js` + `OperationQueue` + `OperationContext`) implements a general scheduler
  for a problem that is really a 3-state machine: `idle | streaming | capturing`. A rebuild
  can replace `js-priority-queue` and the whole pause/resume dance with an explicit state
  machine and drop the dependency.
- **Stream pause/resume is implemented twice.** `CaptureController.captureWithStreamPause()`
  pauses+resumes the stream, but the timelapse loop in `TimelapseController._startCaptureLoop`
  *also* pauses+resumes independently and calls `captureController.captureImage()` directly
  (bypassing `captureWithStreamPause`). Two coordination strategies for one concern.
- **`mapConfigToVideoOptions` / `mapQualityFromConfig` / `mapCodecFromConfig` are lossy
  shims** bridging UI vocabulary (`ultra`, `vp9`) to what `VideoController` supports
  (`high`, `h264`). These mappings exist only because the UI advertises options the engine
  can't deliver. Align the UI to the engine and delete the shims.
- **`formatFileSize` is defined three times** (server.js, cameraService.js ×2). Hoist to one
  util.

### 2.4 Live Streaming (`StreamController`)

**Description.** Spawns `mjpg_streamer` with `input_uvc.so`/`output_http.so`, watches
stderr for the ready signal (`o: commands.............: enabled`), and reports
ready/error/stopped via a notification callback. Stops with `SIGTERM` then `SIGKILL`.

**Dependencies.** `child_process.spawn`, `constants.js` (paths, port, ready signal, resolutions).

**System relationships.** Driven by `CameraService`; its lifecycle is intertwined with
capture (must be down while `fswebcam` grabs the device). The browser consumes its output
directly out-of-band on port 8080.

**Simplification opportunities.**
- **Config is largely ignored.** The spawn command hardcodes `input_uvc.so` and
  `-d /dev/video0`, ignoring `CAMERA_TYPE`, `CAMERA_DEVICE`, `MJPG_INPUT_PLUGIN`, and
  `MJPG_INPUT_OPTIONS` from config. Only `streamQuality`→resolution and `streamFps` are
  honored. Either wire the config through or delete those keys (see §4). For a Pi-camera
  path (`input_raspicam.so`) none of the libcamera config is reachable.
- **Resolution mapping disagrees with the rest of the system.** `constants.RESOLUTIONS`
  maps `low→1280x720, medium→1920x1080, high→3840x2160`, while
  `ConfigService.mapQualityToStreamDimensions` maps `low→640x480, medium→1280x720,
  high→1920x1080`. The same `streamQuality` string yields different resolutions depending
  on which module reads it.
- **Ready-timeout is a no-op.** `_setupReadyTimeout` logs a warning but takes no corrective
  action; the start path resolves immediately regardless. Either implement a real
  ready/timeout promise or drop it.

### 2.5 Image Capture (`CaptureController`)

**Description.** Builds and `exec`s an `fswebcam` command to grab a single JPG, with
optional stream pause/resume around it.

**Dependencies.** `child_process.exec` (promisified), `fs` (writability check), `constants.RESOLUTIONS`.

**System relationships.** Called by `TimelapseController` (loop) and via the `capture`
operation. Its **filename format is an implicit contract** consumed by `VideoController`,
which parses the timestamp back out of the name.

**Simplification opportunities / correctness risks.**
- **`generateFilename()` is buggy.** The line
  `!!timestamp ? timelapse : this.generateTimestamp();` references an undefined identifier
  `timelapse`, computes nothing, and assigns nothing. `captureImage` then calls
  `generateFilename(timestamp)` passing the timestamp as the **prefix** argument, so the
  produced name does **not** begin with `timelapse_`. Because `VideoController.parseTimestamp`
  and `checkVideoGenerationAvailable` both require the strict
  `timelapse_YYYY-MM-DDThh-mm-ss-mmmZ.jpg` pattern, **captured frames can fail to match and
  video generation silently reports "no valid images."** This filename-as-contract coupling
  is the single most fragile dataflow in the system.
- **Resolution is hardcoded to `3840x2160`** with the quality lookup commented out, so
  `IMAGE_QUALITY` has no effect on capture.
- **Stray `const { time } = require("console")`** import is unused.
- **Recommendation:** In the rebuild, decouple capture metadata from the filename — store a
  sidecar manifest (or DB row) mapping file → capture timestamp, and let the video step read
  that manifest instead of regex-parsing names. This removes the brittle naming contract and
  the symlink-renaming workaround in §2.7.

### 2.6 Timelapse Loop (`TimelapseController`)

**Description.** Owns the recurring capture loop: tracks `imageCount`, `sessionStartTime`,
pauses/resumes the stream around each grab, schedules the next via
`setTimeout(loop, interval*1000)`, and fires callbacks for UI updates.

**Dependencies.** `CaptureController`, `constants.TIMELAPSE_CONFIG`.

**System relationships.** Created by `CameraService`; its counters feed `getStatus()`.

**Simplification opportunities.**
- **Duplicates stream coordination** (see §2.3) rather than reusing
  `captureWithStreamPause`.
- **The `SCHEDULE_*` config implies a scheduler that does not exist.** There is no code that
  starts/stops capture by `startTime`/`stopTime`. Either implement scheduling once, here, or
  delete the schedule config block entirely.
- **No `MAX_IMAGES` / `AUTO_CLEANUP` enforcement.** Those keys exist in config but the loop
  never trims old frames. Same decision: implement or delete.

### 2.7 Video Generation (`services/video/VideoController.js` + extracted modules)

**Description.** The live video engine, modularized into `Error`, `VideoConfig`,
`VideoValidator`, `ResourceMonitor`, `ProcessManager`, `Mutex`. It validates options, checks
disk/memory/input, confirms FFmpeg is present, scans `captures/` and sorts frames by parsed
timestamp, **creates a temp dir of sequentially named symlinks** (`frame_000.jpg`, …), runs
`ffmpeg` against the `frame_%03d.jpg` pattern, verifies the output, reports metrics, and
cleans up.

**Dependencies.** `child_process` (spawn/exec), `fs.promises`, `path`, `crypto`
(correlation IDs), `Logger`. **External:** `ffmpeg`.

**System relationships.** Invoked by `CameraService.generateVideo()`; emits progress through
nested callbacks (`ProcessManager` → `handleProgress` → `onProgress` → Socket.IO). Output is
served by the `/videos/*` Express routes. Runs **outside** the camera `OperationQueue`,
serialized only by its own `Mutex`.

**Simplification opportunities.**
- **Delete the duplicate.** `services/camera/VideoController.js` (~1630 lines) is a
  monolithic copy of this entire subsystem (including inlined `VideoConfig`, `Mutex`,
  `ProcessManager`, etc.) and is **imported by nothing**. It is pure dead weight and a trap
  for future maintainers who may edit the wrong file. The two copies have already diverged
  (the live one uses sequential symlinks; the dead one uses `-pattern_type glob`).
- **The symlink dance exists only to work around the filename contract.** Because frames are
  named by timestamp, FFmpeg's sequential `%03d` input can't read them directly, so every
  render builds and tears down a temp symlink tree. If capture writes a manifest (per §2.5),
  FFmpeg can use a concat/demuxer list and the symlink machinery (and its `tempDir`,
  cleanup, and ENOENT handling) disappears.
- **The fourth config system.** `VideoConfig` reads its *own* env vars (`VIDEOS_DIR`,
  `CAPTURES_DIR`, `FFMPEG_PATH`, `MAX_INPUT_IMAGES`, `MAX_VIDEO_DURATION`, `PROCESS_TIMEOUT`,
  …) that are **not** in `.env.example` and **not** known to `ConfigService`. Fold these into
  the single settings file.
- **`getHealthCheck()` is never called** and references `this.checkDirectories()` which
  doesn't exist on the live class (it exists only on the dead copy) — latent bug. Remove or fix.
- **Security scaffolding (excluded from streamlining per scope):** path-traversal checks in
  `validateInputFolder`/`generateOutputPath`/`deleteVideo` and filename allow-listing are set
  aside for this review. *Retain note:* the `deleteVideo`/output-path checks are genuine
  protections for a network-exposed service and should be preserved (in simplified form) in
  any real rebuild, not dropped.

### 2.8 Front-end Control Panel (`index.html`, `api.js`, `ui.js`, `app.js`, `styles.css`)

**Description.** A single static page with a tabbed configuration panel, live-preview
`<img>`, status cards, and image/video management lists. Three global scripts share one
implicit global `socket` (created in `api.js`).

**Dependencies.** Socket.IO browser client (served by the server at
`/socket.io/socket.io.js`). No build step, no module system — plain globals.

**System relationships.** Pure Socket.IO client. Emits user intents; renders server
broadcasts into the DOM.

**Simplification opportunities.**
- **Split across three files with overlapping responsibilities and duplicate listeners.**
  Both `api.js` and `app.js` register `socket.on("systemInfoUpdate", …)` and
  `socket.on("videoGenerationStatus", …)`; both update overlapping DOM, so the two handlers
  partially fight each other. Consolidate to one client module.
- **Implicit global coupling.** `api.js` defines `socket`; `ui.js`/`app.js` assume it exists
  (`if (typeof socket !== "undefined")`). A rebuild should use ES modules and pass the socket
  explicitly.
- **`window.confirm` is monkey-patched** into a no-op-ish passthrough (`ui.js`), which is
  fragile. Use a real modal or native confirm, not a global override.
- **UI advertises capabilities the backend can't honor** (`ultra` quality, `vp9` codec,
  rotation, flip, mock camera). Trim the forms to what the engine implements.

### 2.9 Logging (`Logger`)

**Description.** Static class wrapping `console.log` with a timestamp and a
`CameraService.<method>` prefix.

**Simplification opportunities.** Ignores `LOG_LEVEL`/`LOG_FILE`/`MAX_LOG_*` config entirely
(everything is `console.log` at all levels; the label is always `CameraService.` even from
video modules). Either adopt a real logger (pino/winston) honoring the config, or delete the
log-rotation config. The misleading `CameraService.` prefix on `VideoController` logs should
be fixed.

### 2.10 Install / Ops (`install-rpi.sh`, `mjpg-streamer-config.sh`, `mjpg-streamer.service.template`, CI)

**Description.** Bash installer (Node 22 via nvm, builds mjpg-streamer, installs
fswebcam/ffmpeg, optional systemd unit) plus mjpg-streamer service templates. CI workflow
runs a Node matrix.

**Simplification opportunities.**
- **Installer hardcodes `cd /home/access/Timelapse-RPi`**, which only works for one specific
  user/path — should derive from the script location.
- **CI is aspirational.** It runs `npm test` (which is `echo "Error: no test specified" &&
  exit 1`) and `npm run lint`/`build --if-present` (neither script exists). CI cannot be
  green as written. The rebuild should ship at least a smoke test and a lint config, or
  trim the workflow.
- **README/SYSTEM_DOCUMENTATION drift.** Both describe a REST API and line numbers that no
  longer match the code. Regenerate docs from the actual Socket.IO contract.

---

## 3. Library & Dependency Inventory

### Runtime dependencies (`package.json`)

| Library | Current role | Recommendation |
|---|---|---|
| **express** `^5.1.0` | Static file serving + `/videos/*` routes. | **Keep.** Minimal surface; could even be replaced by Node's built-in `http` + Socket.IO's static serving, but Express is low-cost and familiar. |
| **socket.io** `^4.8.1` | The real control/telemetry API (all commands + status). | **Keep — core.** This *is* the API. Formalize the event contract (typed payloads) in the rebuild. |
| **dotenv** `^16.5.0` | Loads `.env` into `process.env` (called inside `ConfigService`). | **Keep**, repurposed: load the new `settings.json`-derived values / secrets into the environment at the single entrypoint (see §4). |
| **adm-zip** `^0.5.16` | Zips `captures/` for the "Download images" button. | **Keep (or replace).** Single, contained use. Could be swapped for streaming `archiver` or native `zlib`/`tar`, but not worth churn unless the download feature is reworked. |
| **js-priority-queue** `^0.1.5` | Backs `OperationQueue` priority arbitration. | **Excise.** The four-level priority scheduler is overkill for a single-camera device; replace with an explicit `idle/streaming/capturing` state machine. Removes the dep and ~250 lines of pause/resume logic. |
| **nodemon** `^3.1.10` | Dev auto-reload (`npm run dev`). | **Keep but recategorize** — move to `devDependencies`; it should not ship as a production dependency. |

### External system tools (not npm, but hard dependencies)

| Tool | Role | Notes for rebuild |
|---|---|---|
| **mjpg-streamer** | Live MJPEG preview on :8080. | Core to streaming. Consider whether `libcamera`/`rpicam-vid` streaming is a better single-stack option on modern Pi OS (Bullseye+ deprecates raspicam). |
| **fswebcam** | Still capture (`exec`). | Works for UVC/USB. Does **not** cover libcamera/Pi Camera Module v3 well despite config claiming `libcamera` support — the rebuild should pick one capture backend per camera type and actually branch on it. |
| **ffmpeg** | Image-sequence → MP4. | Core. Keep. |
| **libcamera-apps** | Installed but unused by the app (only referenced in install/README). | Wire up or drop the libcamera config. |

### Node built-ins in use
`http`, `os`, `path`, `fs`/`fs.promises`, `child_process` (`spawn`/`exec`), `util.promisify`,
`crypto` (correlation IDs). All appropriate; no action.

### Net dependency goal for the rebuild
Keep **express, socket.io, dotenv, adm-zip**; **drop js-priority-queue**; **move nodemon to
dev**. That reduces the production dependency set to four well-justified libraries.

---

## 4. Proposed Configuration Migration Path

### 4.1 Current state (why it needs to change)

Configuration today is spread across **five** sources that disagree:

1. `ConfigService.defaultConfig` (services/configService.js)
2. `.env.example` (262 lines)
3. Hardcoded constants in `server.js` (`MJPEG_STREAMER_PATH`, port literals)
4. `services/camera/constants.js` (`DEFAULT_PATHS`, `STREAM_CONFIG`, `RESOLUTIONS`)
5. `VideoConfig` (services/video/VideoConfig.js — its own env vars, undocumented in `.env`)

On top of that, **most config keys are inert.** Categorizing the `.env.example` surface:

- **Actually drives behavior:** `PORT`, `OUTPUT_DIR`, `CAPTURE_INTERVAL`, `STREAM_FPS`,
  `STREAM_WIDTH`/`STREAM_HEIGHT`/`STREAM_QUALITY` (stream resolution), `VIDEO_FPS`,
  `VIDEO_QUALITY`, `VIDEO_CODEC`, `VIDEO_BITRATE`, and the `VideoConfig` set
  (`VIDEOS_DIR`, `CAPTURES_DIR`, `FFMPEG_PATH`, `MAX_*`, `PROCESS_TIMEOUT`).
- **Loaded but ignored by the code that should use it:** `IMAGE_QUALITY` (capture hardcodes
  4K), `CAMERA_TYPE`/`CAMERA_DEVICE`/`MJPG_INPUT_PLUGIN`/`MJPG_INPUT_OPTIONS` (stream
  hardcodes UVC + `/dev/video0`), `RESOLUTION_WIDTH`/`HEIGHT`, `ROTATION`,
  `FLIP_HORIZONTAL`/`FLIP_VERTICAL`, `MJPG_STREAMER_PATH`/`WWW`/`PORT` (controllers use
  `constants.js` instead).
- **Declared for features that don't exist:** all `SCHEDULE_*`, `AUTO_CLEANUP`,
  `MAX_IMAGES`, `CLEANUP_OLDER_THAN_DAYS`, `AUTO_GENERATE_VIDEO`, `MAX_STORAGE_GB`,
  `ENABLE_HARDWARE_ACCELERATION`, `LOG_LEVEL`/`LOG_FILE`/`MAX_LOG_*`,
  `ENABLE_*_NOTIFICATIONS`/`EMAIL_*`/`WEBHOOK_URL`, `API_KEY`/`JWT_SECRET`/`ENABLE_AUTH`/
  `ENABLE_HTTPS`/`SSL_*`, `CORS_ORIGIN`/`ENABLE_REMOTE_ACCESS`, `MOCK_CAMERA`,
  `DEBUG_MODE`, `*_WARNING_THRESHOLD`, `SIMULATE_CAPTURE_DELAY`, `MAX_CONCURRENT_CAPTURES`.

Roughly **70% of the configuration surface is decorative.** A migration is therefore mostly
a culling exercise.

### 4.2 Target state: single `settings.json` loaded into the environment via `dotenv`

**Step 1 — Define the canonical file.** Create `config/settings.json` containing **only the
live keys**, grouped logically. Illustrative shape:

```json
{
  "server":   { "port": 3000, "host": "0.0.0.0" },
  "paths":    { "capturesDir": "./captures", "videosDir": "./videos", "tempDir": "./temp",
                "ffmpegPath": "ffmpeg", "mjpgStreamerPath": "/usr/local/bin/mjpg_streamer",
                "mjpgStreamerWww": "/usr/local/share/mjpg-streamer/www" },
  "stream":   { "port": 8080, "fps": 15, "width": 1280, "height": 720,
                "device": "/dev/video0", "inputPlugin": "input_uvc.so" },
  "capture":  { "intervalSeconds": 5, "width": 1920, "height": 1080 },
  "video":    { "fps": 30, "quality": "medium", "codec": "h264", "bitrate": "5M",
                "maxInputImages": 10000, "maxDurationSeconds": 3600,
                "processTimeoutMs": 1800000 }
}
```

Keep a checked-in `config/settings.default.json`; the live `config/settings.json` is
git-ignored and created from the default on first run (mirroring today's
`.env`-from-`.env.example` behavior, but without the comment-stripping problem).

**Step 2 — Single loader at the entrypoint.** Per the rebuild constraint, flatten the JSON
into `process.env` at boot and layer `dotenv` on top for host-specific secrets/overrides, so
existing `process.env.X` consumers keep working during the transition:

```js
// config/load.js — called once, before anything reads config
const fs = require("fs");
require("dotenv").config();                 // optional .env overrides / secrets last

const settings = JSON.parse(fs.readFileSync("./config/settings.json", "utf8"));

// Flatten {stream:{fps:15}} -> process.env.STREAM_FPS unless already set by .env
const flatten = (obj, prefix = "") => Object.entries(obj).forEach(([k, v]) => {
  const key = `${prefix}${k}`.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  if (v && typeof v === "object") flatten(v, `${key}_`);
  else if (process.env[key] === undefined) process.env[key] = String(v);
});
flatten(settings);

module.exports = settings;                  // also export typed object for direct use
```

This satisfies "single JSON file, loaded via dotenv into the environment," and gives modules
a typed `settings` object so they can stop hand-parsing strings.

**Step 3 — Collapse the five config sources into the loader.**
- Delete `server.js`'s hardcoded `MJPEG_STREAMER_*` constants → read from `settings.paths`.
- Replace `constants.js` `DEFAULT_PATHS`/`STREAM_CONFIG` with references to `settings`.
- Delete `VideoConfig`'s independent `process.env` reads; construct it from `settings.video`
  + `settings.paths`.
- Reconcile the resolution maps: pick **one** quality→resolution table and put it in
  `settings` (or derive resolution from explicit width/height and drop the `low/medium/high`
  indirection entirely).

**Step 4 — Persistence path for UI edits.** Replace `writeEnvFile` (which destroys comments)
with a JSON read-modify-write against `config/settings.json`:
`load → deep-merge validated updates → JSON.stringify(…, 2) → write`. Re-broadcast the merged
object over Socket.IO. JSON round-trips losslessly, so the "documentation gets wiped on first
save" problem goes away.

**Step 5 — Cull dead config.** Do **not** migrate the inert keys from §4.1. For each
"declared but unimplemented" feature (scheduling, cleanup, rotation/flip, notifications,
auth, HTTPS, hardware accel, log rotation, mock camera), make an explicit decision:
*implement it* (and then add the key back) or *drop it*. Shipping config for non-existent
features is the single biggest source of confusion in the current system.

**Step 6 — Validation.** With a typed JSON file, replace the bespoke
`parseBool`/`parseNumber`/`validateOption`/`validateTime` helpers with a single schema
validator (e.g. a small hand-written validator or a schema lib) applied once at load and once
per UI update. Reject-and-default behavior stays, but lives in one place.

### 4.3 Migration sequencing (low-risk order)

1. Land the loader + `settings.default.json` alongside the existing `.env` (loader fills only
   *unset* env vars, so nothing breaks).
2. Point `VideoConfig` and `StreamController`/`constants.js` at `settings`; delete their
   private constants.
3. Switch `ConfigService` reads to `settings`, then switch its writes to JSON; retire `.env`
   and `.env.example`.
4. Delete dead code in the same sweep: `services/camera/VideoController.js`, the unused
   `server.js` constants, the unused `time` import, and the inert config keys.
5. Regenerate README/SYSTEM_DOCUMENTATION from the real Socket.IO + `/videos` contract.

---

### Appendix: Highest-leverage cleanups for the rebuild (ranked)

1. **Delete `services/camera/VideoController.js`** (~1630 lines of dead, divergent duplicate).
2. **Collapse five config sources into one `settings.json` + loader**, culling ~70% inert keys.
3. **Fix the capture filename contract** (`generateFilename` bug) or replace it with a capture
   manifest — this also eliminates the FFmpeg symlink workaround.
4. **Replace the priority `OperationQueue` with a 3-state machine**; drop `js-priority-queue`
   and the duplicated stream pause/resume logic.
5. **Unify the front-end** into one module with one set of socket listeners.
6. **Reconcile the two resolution maps** and the three copies of the `:8080` stream URL/port.
7. **Single graceful-shutdown owner**; remove the competing handler in the video subsystem.
8. **Align UI options to engine capabilities** (drop `ultra`/`vp9`/rotation/flip/mock) and
   delete the lossy mapping shims.
9. **Make docs and CI truthful** (real API surface; real test/lint scripts).
