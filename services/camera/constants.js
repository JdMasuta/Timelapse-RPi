// services/camera/constants.js - values sourced from the single settings file

const { settings } = require("../../config/load");

const OPERATION_PRIORITIES = {
  EMERGENCY_CAPTURE: 100,
  USER_CAPTURE: 80,
  TIMELAPSE: 60,
  STREAM: 20,
  // Note: Video creation is not in this queue - it runs independently
};

// Quality -> resolution tables (single source of truth, in settings.json).
// Capture and stream intentionally use different scales (capture favors detail,
// stream favors bandwidth), so each has its own table.
const STREAM_RESOLUTIONS = settings.resolutions.stream;
const CAPTURE_RESOLUTIONS = settings.resolutions.capture;
// Back-compat alias used by StreamController.
const RESOLUTIONS = STREAM_RESOLUTIONS;

const DEFAULT_PATHS = {
  mjpegStreamerPath: settings.paths.mjpgStreamerPath,
  mjpegStreamerWwwPath: settings.paths.mjpgStreamerWww,
  outputDir: settings.paths.outputDir,
  videosDir: settings.paths.videosDir,
};

const STREAM_CONFIG = {
  port: settings.stream.port,
  readySignal: "o: commands.............: enabled",
  startupTimeout: 5000,
};

const TIMELAPSE_CONFIG = {
  streamPauseDelay: 500, // ms to wait after stopping stream before capture
};

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
  STREAM_RESOLUTIONS,
  CAPTURE_RESOLUTIONS,
  DEFAULT_PATHS,
  STREAM_CONFIG,
  TIMELAPSE_CONFIG,
  VIDEO_CONFIG,
};
