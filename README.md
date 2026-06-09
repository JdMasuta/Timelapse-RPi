# Timelapse-RPi

A Node.js timelapse capture and management system for Raspberry Pi (and other
Unix/V4L2 hosts). It captures stills with `fswebcam`, offers a live MJPEG preview via
`mjpg-streamer`, renders frames into an MP4 with `ffmpeg`, and is controlled from a
browser through a real-time **Socket.IO** interface.

## Features

- Real-time timelapse capture control (start/stop, live status)
- Live camera preview via MJPG-Streamer
- Video generation from captured frames (H.264 / H.265, selectable quality/fps/bitrate)
- **Daily scheduling** — auto start/stop capture within a configured time window
- **Rotation & flip** applied at capture time
- **Notifications** on key events (capture start/stop, video complete/error) via
  webhook (built in) or email (optional, requires `nodemailer`)
- Image and video management (list, download, zip, delete)
- Single-file configuration (`config/settings.json`) with live updates from the UI
- Mock-camera mode for development/testing without hardware

## Requirements

- **Node.js 18+**
- External tools (installed by `install-rpi.sh`):
  - `fswebcam` — still capture
  - `mjpg-streamer` — live preview (port 8080)
  - `ffmpeg` — video generation
- A V4L2 camera (USB webcam or Raspberry Pi camera exposed as `/dev/video0`)

## Installation

### Raspberry Pi (automated)

```bash
git clone https://github.com/JdMasuta/Timelapse-RPi.git
cd Timelapse-RPi
bash install-rpi.sh
```

The script installs Node.js, the external tools, builds mjpg-streamer, creates the
runtime directories, and optionally installs a systemd service.

### Manual

```bash
git clone https://github.com/JdMasuta/Timelapse-RPi.git
cd Timelapse-RPi
npm install
sudo apt-get install -y fswebcam ffmpeg   # plus mjpg-streamer (see install-rpi.sh)
mkdir -p captures videos logs temp
npm start
```

The app listens on `http://localhost:3000` (configurable). The live stream is served
separately by mjpg-streamer on `http://<host>:8080/?action=stream`.

## Usage

```bash
npm start      # production
npm run dev    # auto-reload (nodemon)
npm test       # smoke test: boots the server (mock camera) and checks it serves
```

### Development without a camera

Set `MOCK_CAMERA=true` to write placeholder frames and simulate the stream, so the
full pipeline can be exercised on a machine with no camera/mjpg-streamer:

```bash
MOCK_CAMERA=true npm start
```

## Configuration

All settings live in a single JSON file: **`config/settings.json`**. It is created
automatically from `config/settings.default.json` on first run, and is updated
losslessly when you change settings in the web UI.

At startup the loader (`config/load.js`):
1. loads any `.env` file via `dotenv` (optional host-specific overrides / secrets),
2. reads `config/settings.json`, and
3. flattens scalar settings into `process.env` (without overriding values already set
   by `.env`), so the whole app reads configuration from the environment.

Settings groups: `server`, `paths`, `stream`, `capture`, `video`, `schedule`,
`notifications`, plus `resolutions` (quality→resolution tables for capture and stream).
See `config/schema.js` for the full settings ↔ environment-variable mapping.

Notable settings:

| Group | Key | Meaning |
|-------|-----|---------|
| `capture` | `intervalSeconds`, `imageQuality`, `rotation`, `flipHorizontal`, `flipVertical` | capture cadence and image transforms |
| `stream` | `fps`, `quality`, `device`, `inputPlugin`, `port` | live preview |
| `video` | `fps`, `quality` (low/medium/high), `codec` (h264/h265), `bitrate` | generation |
| `schedule` | `enabled`, `startTime`, `stopTime` | daily auto capture window (HH:MM) |
| `notifications` | `webhookEnabled`, `webhookUrl`, `emailEnabled`, `email*` | event notifications |

**Email notifications** require `nodemailer` (`npm install nodemailer`); if it is not
installed, email is skipped with a warning while webhook notifications still work.

## Control interface (Socket.IO)

The control API is **Socket.IO**, not REST. Clients connect to the same host/port as
the page and exchange events.

Client → server events: `startCapture`, `stopCapture`, `toggleStream`, `generateVideo`,
`generateQuickVideo`, `cancelVideoGeneration`, `getVideoStatus`, `getVideoCapabilities`,
`deleteVideo`, `refreshImages`, `clearImages`, `downloadImages`, `refreshVideos`,
`saveConfig`, `saveExtendedConfig`, `requestExtendedConfig`, `resetConfigToDefaults`.

Server → client events: `statusUpdate`, `configUpdate`, `extendedConfigUpdate`,
`streamStatusUpdate`, `liveStreamUrl`, `systemInfoUpdate`, `notification`,
`imageListUpdate`, `imagesCleared`, `imageDownloadReady`, `videoGenerationStatus`,
`videoListUpdate`, `videoStatusUpdate`, `configSaved`.

The only HTTP routes are static file serving plus video access:
- `GET /videos/:filename` — download a generated video
- `GET /videos/:filename/stream` — range-streamed playback

## Project structure

```
Timelapse-RPi/
├── server.js                     # Express + Socket.IO orchestration, scheduler wiring
├── config/
│   ├── settings.default.json     # shipped defaults (single source of truth)
│   ├── schema.js                 # settings <-> env mapping
│   └── load.js                   # loads dotenv + settings.json into the environment
├── services/
│   ├── cameraService.js          # façade over the camera controllers + operation queue
│   ├── configService.js          # reads config from env, persists UI edits to settings.json
│   ├── Scheduler.js              # daily auto start/stop
│   ├── NotificationService.js    # webhook + email notifications
│   ├── camera/                   # StreamController, CaptureController, TimelapseController, …
│   └── video/                    # VideoController (manifest + ffmpeg concat) and helpers
├── index.html, styles.css        # web UI
├── api.js, ui.js, app.js         # browser client (Socket.IO)
├── test/smoke.js                 # CI smoke test
└── install-rpi.sh                # Raspberry Pi setup
```

## License

ISC — see [LICENSE](LICENSE).
