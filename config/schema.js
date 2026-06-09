// config/schema.js
// Single source of truth describing every persisted, user-editable setting:
// where it lives in settings.json (group/key), the environment-variable name it is
// flattened to (for backward compatibility with existing process.env consumers), and
// how to coerce it. Reference data that is not a scalar (e.g. resolution tables) is
// intentionally NOT listed here — it lives in settings.json but is read as a typed object.

module.exports = [
  // server
  { group: "server", key: "port", env: "PORT", type: "int" },
  { group: "server", key: "host", env: "HOST", type: "string" },

  // paths
  { group: "paths", key: "outputDir", env: "OUTPUT_DIR", type: "string" },
  { group: "paths", key: "videosDir", env: "VIDEOS_DIR", type: "string" },
  { group: "paths", key: "tempDir", env: "TEMP_DIR", type: "string" },
  { group: "paths", key: "ffmpegPath", env: "FFMPEG_PATH", type: "string" },
  { group: "paths", key: "mjpgStreamerPath", env: "MJPG_STREAMER_PATH", type: "string" },
  { group: "paths", key: "mjpgStreamerWww", env: "MJPG_STREAMER_WWW", type: "string" },

  // stream
  { group: "stream", key: "port", env: "MJPG_STREAMER_PORT", type: "int" },
  { group: "stream", key: "fps", env: "STREAM_FPS", type: "int" },
  { group: "stream", key: "quality", env: "STREAM_QUALITY", type: "string" },
  { group: "stream", key: "device", env: "CAMERA_DEVICE", type: "string" },
  { group: "stream", key: "inputPlugin", env: "MJPG_INPUT_PLUGIN", type: "string" },

  // capture
  { group: "capture", key: "intervalSeconds", env: "CAPTURE_INTERVAL", type: "int" },
  { group: "capture", key: "imageQuality", env: "IMAGE_QUALITY", type: "string" },
  { group: "capture", key: "rotation", env: "ROTATION", type: "int" },
  { group: "capture", key: "flipHorizontal", env: "FLIP_HORIZONTAL", type: "bool" },
  { group: "capture", key: "flipVertical", env: "FLIP_VERTICAL", type: "bool" },

  // video
  { group: "video", key: "fps", env: "VIDEO_FPS", type: "int" },
  { group: "video", key: "quality", env: "VIDEO_QUALITY", type: "string" },
  { group: "video", key: "codec", env: "VIDEO_CODEC", type: "string" },
  { group: "video", key: "bitrate", env: "VIDEO_BITRATE", type: "string" },
  { group: "video", key: "maxInputImages", env: "MAX_INPUT_IMAGES", type: "int" },
  { group: "video", key: "maxDurationSeconds", env: "MAX_VIDEO_DURATION", type: "int" },
  { group: "video", key: "processTimeoutMs", env: "PROCESS_TIMEOUT", type: "int" },

  // schedule
  { group: "schedule", key: "enabled", env: "SCHEDULE_ENABLED", type: "bool" },
  { group: "schedule", key: "startTime", env: "SCHEDULE_START_TIME", type: "string" },
  { group: "schedule", key: "stopTime", env: "SCHEDULE_STOP_TIME", type: "string" },

  // notifications
  { group: "notifications", key: "webhookEnabled", env: "NOTIFY_WEBHOOK_ENABLED", type: "bool" },
  { group: "notifications", key: "webhookUrl", env: "NOTIFY_WEBHOOK_URL", type: "string" },
  { group: "notifications", key: "emailEnabled", env: "NOTIFY_EMAIL_ENABLED", type: "bool" },
  { group: "notifications", key: "emailHost", env: "EMAIL_HOST", type: "string" },
  { group: "notifications", key: "emailPort", env: "EMAIL_PORT", type: "int" },
  { group: "notifications", key: "emailUser", env: "EMAIL_USER", type: "string" },
  { group: "notifications", key: "emailPass", env: "EMAIL_PASS", type: "string" },
  { group: "notifications", key: "emailTo", env: "EMAIL_TO", type: "string" },
];
