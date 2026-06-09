# Timelapse-RPi — System Documentation

This document describes the current architecture after the QA-driven refactor (see
`QA.md`). It reflects the real interfaces and dataflows in the code.

## Overview

Timelapse-RPi captures stills with `fswebcam`, serves a live MJPEG preview with
`mjpg-streamer`, and renders frames into MP4 with `ffmpeg`. It is controlled over
**Socket.IO** from a browser. Configuration lives in a single JSON file loaded into the
environment at startup.

## Components

| Layer | File(s) | Responsibility |
|-------|---------|----------------|
| Config loader | `config/load.js`, `config/schema.js`, `config/settings.default.json` | Load `.env` (dotenv) + `settings.json`, flatten scalars into `process.env`, expose typed settings, lossless JSON persistence |
| Config service | `services/configService.js` | Read config from env; validate and persist UI edits to `settings.json` |
| Server / orchestration | `server.js` | Express static + `/videos` routes; Socket.IO event handlers; reusable capture flows; scheduler wiring; single graceful shutdown |
| Camera façade | `services/cameraService.js` | Coordinates controllers via a priority `OperationQueue` |
| Stream | `services/camera/StreamController.js` | Spawns/stops mjpg-streamer (device/plugin/port from settings) |
| Capture | `services/camera/CaptureController.js` | Runs fswebcam (rotation/flip applied), writes the capture manifest, stream pause/resume |
| Timelapse | `services/camera/TimelapseController.js` | Interval loop; reuses CaptureController's pause/resume |
| Video | `services/video/VideoController.js` (+ `VideoConfig`, `VideoValidator`, `ResourceMonitor`, `ProcessManager`, `Mutex`, `Error`) | Reads manifest, builds an ffmpeg concat list, encodes MP4 |
| Scheduling | `services/Scheduler.js` | Auto start/stop capture within a daily window |
| Notifications | `services/NotificationService.js` | Webhook (native) + email (optional nodemailer) on key events |
| Logging | `services/camera/Logger.js` | Structured console logging |
| Web client | `index.html`, `api.js`, `ui.js`, `app.js`, `styles.css` | Socket.IO UI (one listener per event) |

## Configuration dataflow

```
config/settings.json  ──(config/load.js: dotenv + flatten)──►  process.env
        ▲                                                          │
        │ writeCurrent (lossless JSON)                             ▼
ConfigService.updateConfig  ◄── saveConfig / saveExtendedConfig   ConfigService.loadConfig
        ▲                          (Socket.IO)                     │
        └──────────────────────────────────────────────  fullConfig / currentConfig
```

`config/schema.js` is the single source mapping each setting (group/key) to its
environment-variable name and type. The loader and the config service both use it, so
there is one source of truth for defaults and persistence.

## Operational flows

### Capture
`startCapture` (Socket.IO) → `server.runStartCapture()` → `cameraService.startTimelapse()`
→ `TimelapseController` loop → `CaptureController.captureWithStreamPause()` (pauses the
stream if active, runs fswebcam with rotation/flip, writes `captures/manifest.json`,
resumes the stream) → `statusUpdate` broadcast. The same `runStartCapture/runStopCapture`
functions are used by the **Scheduler**.

### Streaming
`toggleStream` → `StreamController.start()` spawns mjpg-streamer using the configured
input plugin/device/port; when ready the server emits `liveStreamUrl`
(`http://<ip>:<stream.port>/?action=stream`) and the browser `<img>` loads it directly.

### Video generation
`generateVideo` → `cameraService.generateVideo()` → `VideoController.createVideo()`:
reads `captures/manifest.json` (falling back to filename parsing) to order frames, writes
a temporary ffmpeg **concat list**, spawns ffmpeg, verifies output, and reports progress
via `videoGenerationStatus`. Output MP4s are served by `GET /videos/:filename[/stream]`.

### Scheduling
`Scheduler` ticks periodically; when `schedule.enabled` and the current time is inside
`[startTime, stopTime]` it auto-starts capture, and auto-stops when the window closes
(only stopping captures it started).

### Notifications
`NotificationService.notify(event, data)` fires on `capture-started`, `capture-stopped`,
`capture-error`, `video-complete`, `video-error`. Webhook delivery uses native HTTP(S);
email uses `nodemailer` if installed.

## Concurrency & lifecycle

- Camera operations are arbitrated by a small internal priority queue
  (`OperationQueue`); video runs independently under a `Mutex`.
- Shutdown is owned solely by `server.js` (`SIGTERM`/`SIGINT` → cancel video, cleanup
  camera service, stop scheduler, close server).

## Capture filename & manifest contract

Captures are named `timelapse_<ISO with [:.]→->Z>.jpg` (e.g.
`timelapse_2025-06-25T13-43-41-407Z.jpg`). `captures/manifest.json` maps each filename to
its capture timestamp and is the source of truth for ordering during video generation.

## Testing

`npm test` runs `test/smoke.js`, which boots the server with `MOCK_CAMERA=true` and
verifies the page serves and the Socket.IO handshake succeeds. For manual end-to-end
testing without hardware, run `MOCK_CAMERA=true npm start` and exercise the UI.
