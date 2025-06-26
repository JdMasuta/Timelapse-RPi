// services/video/VideoConfig.js - Configuration Management
// Extracted from VideoController.js with no logic changes

const path = require("path");
const { ValidationError } = require("./Error");

class VideoConfig {
  constructor() {
    this.config = {
      // Paths and directories
      videosDir:
        process.env.VIDEOS_DIR || path.join(__dirname, "..", "..", "videos"),
      capturesDir:
        process.env.CAPTURES_DIR ||
        path.join(__dirname, "..", "..", "captures"),
      ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",

      // Security limits
      maxInputImages: parseInt(process.env.MAX_INPUT_IMAGES) || 10000,
      maxVideoDuration: parseInt(process.env.MAX_VIDEO_DURATION) || 3600, // seconds
      maxVideoSize:
        parseInt(process.env.MAX_VIDEO_SIZE) || 2 * 1024 * 1024 * 1024, // 2GB
      maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS) || 1,

      // Process limits
      processTimeout: parseInt(process.env.PROCESS_TIMEOUT) || 1800000, // 30 minutes
      killTimeout: parseInt(process.env.KILL_TIMEOUT) || 10000, // 10 seconds
      maxStderrSize: parseInt(process.env.MAX_STDERR_SIZE) || 1024 * 1024, // 1MB

      // Resource limits
      minDiskSpace: parseInt(process.env.MIN_DISK_SPACE) || 1024 * 1024 * 1024, // 1GB
      maxMemoryUsage:
        parseInt(process.env.MAX_MEMORY_USAGE) || 512 * 1024 * 1024, // 512MB

      // Quality presets
      qualityPresets: {
        h264: {
          low: {
            crf: 32,
            preset: "faster",
            maxrate: "1000k",
            bufsize: "2000k",
          },
          medium: {
            crf: 26,
            preset: "medium",
            maxrate: "2500k",
            bufsize: "5000k",
          },
          high: {
            crf: 20,
            preset: "slow",
            maxrate: "5000k",
            bufsize: "10000k",
          },
        },
        h265: {
          low: { crf: 35, preset: "faster", maxrate: "800k", bufsize: "1600k" },
          medium: {
            crf: 28,
            preset: "medium",
            maxrate: "2000k",
            bufsize: "4000k",
          },
          high: { crf: 22, preset: "slow", maxrate: "4000k", bufsize: "8000k" },
        },
      },

      // Validation whitelist
      allowedCodecs: ["h264", "h265"],
      allowedQualities: ["low", "medium", "high"],
      allowedExtensions: [".jpg", ".jpeg"],
      allowedFormats: ["mp4"],

      // FPS limits
      minFps: 0.1,
      maxFps: 120,

      // Bitrate limits (kbps)
      minBitrate: 100,
      maxBitrate: 50000,

      // Logging
      logLevel: process.env.LOG_LEVEL || "info",
      enableMetrics: process.env.ENABLE_METRICS === "true",
    };

    this.validate();
  }

  validate() {
    const required = ["videosDir", "capturesDir", "ffmpegPath"];
    for (const field of required) {
      if (!this.config[field]) {
        throw new ValidationError(
          `Missing required configuration: ${field}`,
          field,
          this.config[field]
        );
      }
    }

    // Validate numeric ranges
    if (this.config.maxInputImages < 1) {
      throw new ValidationError(
        "maxInputImages must be positive",
        "maxInputImages",
        this.config.maxInputImages
      );
    }

    if (this.config.processTimeout < 10000) {
      throw new ValidationError(
        "processTimeout must be at least 10 seconds",
        "processTimeout",
        this.config.processTimeout
      );
    }
  }

  get(key) {
    return this.config[key];
  }

  getQualitySettings(codec, quality) {
    const codecSettings = this.config.qualityPresets[codec];
    if (!codecSettings) {
      throw new ValidationError(`Unsupported codec: ${codec}`, "codec", codec);
    }

    const qualitySettings = codecSettings[quality];
    if (!qualitySettings) {
      throw new ValidationError(
        `Unsupported quality for ${codec}: ${quality}`,
        "quality",
        quality
      );
    }

    return { ...qualitySettings };
  }
}

module.exports = VideoConfig;
