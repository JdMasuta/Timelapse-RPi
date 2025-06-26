// services/camera/constants.js - Updated with video constants

const OPERATION_PRIORITIES = {
  EMERGENCY_CAPTURE: 100,
  USER_CAPTURE: 80,
  TIMELAPSE: 60,
  STREAM: 20,
  // Note: Video creation is not in this queue - it runs independently
};

const RESOLUTIONS = {
  low: "640x480",
  medium: "1280x720",
  high: "1920x1080",
};

const DEFAULT_PATHS = {
  mjpegStreamerPath: "/usr/local/bin/mjpg_streamer",
  mjpegStreamerWwwPath: "/usr/local/share/mjpg-streamer/www/",
  outputDir: "./captures",
  videosDir: "./videos", // 🆕 New video output directory
};

const STREAM_CONFIG = {
  port: 8080,
  readySignal: "o: commands.............: enabled",
  startupTimeout: 5000,
};

const TIMELAPSE_CONFIG = {
  streamPauseDelay: 500, // ms to wait after stopping stream before capture
};

// 🆕 Video-specific constants
const VIDEO_CONFIG = {
  // Default video creation settings
  defaultFps: 30,
  defaultQuality: "medium",
  defaultCodec: "h264",

  // File patterns
  inputPattern: "timelapse_*.jpg",
  outputExtension: "mp4",

  // Processing limits
  maxConcurrentJobs: 1,
  defaultTimeout: 1800000, // 30 minutes

  // Quality presets (can be overridden by VideoController config)
  qualityPresets: {
    low: { description: "Low quality, small file size" },
    medium: { description: "Balanced quality and file size" },
    high: { description: "High quality, larger file size" },
  },
};

module.exports = {
  OPERATION_PRIORITIES,
  RESOLUTIONS,
  DEFAULT_PATHS,
  STREAM_CONFIG,
  TIMELAPSE_CONFIG,
  VIDEO_CONFIG, // 🆕 Export video constants
};
