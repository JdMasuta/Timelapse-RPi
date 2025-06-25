// services/camera/constants.js - Constants and configuration

const OPERATION_PRIORITIES = {
  EMERGENCY_CAPTURE: 100,
  USER_CAPTURE: 80,
  TIMELAPSE: 60,
  STREAM: 20,
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
};

const STREAM_CONFIG = {
  port: 8080,
  readySignal: "o: commands.............: enabled",
  startupTimeout: 5000,
};

const TIMELAPSE_CONFIG = {
  streamPauseDelay: 500, // ms to wait after stopping stream before capture
};

module.exports = {
  OPERATION_PRIORITIES,
  RESOLUTIONS,
  DEFAULT_PATHS,
  STREAM_CONFIG,
  TIMELAPSE_CONFIG,
};
