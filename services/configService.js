// services/configService.js
// Configuration service backed by the single settings.json file (see config/load.js).
// Reads runtime config from process.env (populated by the loader from settings.json, with
// real .env values taking precedence), and persists UI edits back to settings.json losslessly.

const configLoader = require("../config/load");

class ConfigService {
  constructor() {
    this.loader = configLoader;
    this.schema = configLoader.schema;
    this.defaults = configLoader.defaults; // raw settings.default.json

    // Env-keyed default map (single source: settings.default.json) used as fallbacks.
    this.defaultConfig = {};
    for (const f of this.schema) {
      this.defaultConfig[f.env] = this.defaults[f.group][f.key];
    }

    // Map of web-interface (camelCase) keys -> schema field. This is the bridge between
    // the UI's vocabulary and the canonical settings structure.
    this.uiKeyMap = {
      captureInterval: this._field("capture", "intervalSeconds"),
      imageQuality: this._field("capture", "imageQuality"),
      rotation: this._field("capture", "rotation"),
      flipHorizontal: this._field("capture", "flipHorizontal"),
      flipVertical: this._field("capture", "flipVertical"),
      streamFps: this._field("stream", "fps"),
      streamQuality: this._field("stream", "quality"),
      cameraDevice: this._field("stream", "device"),
      videoFps: this._field("video", "fps"),
      videoQuality: this._field("video", "quality"),
      videoCodec: this._field("video", "codec"),
      videoBitrate: this._field("video", "bitrate"),
      scheduleEnabled: this._field("schedule", "enabled"),
      startTime: this._field("schedule", "startTime"),
      stopTime: this._field("schedule", "stopTime"),
      webhookEnabled: this._field("notifications", "webhookEnabled"),
      webhookUrl: this._field("notifications", "webhookUrl"),
      emailEnabled: this._field("notifications", "emailEnabled"),
      emailHost: this._field("notifications", "emailHost"),
      emailPort: this._field("notifications", "emailPort"),
      emailUser: this._field("notifications", "emailUser"),
      emailPass: this._field("notifications", "emailPass"),
      emailTo: this._field("notifications", "emailTo"),
    };

    // Valid options for select/dropdown fields.
    this.validOptions = {
      imageQuality: ["low", "medium", "high"],
      streamFps: [5, 10, 15, 20, 25, 30],
      streamQuality: ["low", "medium", "high"],
      videoFps: [12, 15, 20, 24, 25, 30, 48, 60],
      videoQuality: ["low", "medium", "high", "ultra"],
      videoCodec: ["h264", "h265", "vp9"],
      videoBitrate: ["1M", "2M", "5M", "10M", "20M"],
      rotation: [0, 90, 180, 270],
    };
  }

  _field(group, key) {
    return this.schema.find((f) => f.group === group && f.key === key);
  }

  /**
   * Load configuration from environment variables (sourced from settings.json),
   * validating/coercing and falling back to defaults.
   */
  async loadConfig() {
    const d = this.defaultConfig;
    const config = {
      // Server
      port: parseInt(process.env.PORT) || d.PORT,
      host: process.env.HOST || d.HOST,

      // MJPG-Streamer
      mjpgStreamerPort: parseInt(process.env.MJPG_STREAMER_PORT) || d.MJPG_STREAMER_PORT,
      mjpgStreamerPath: process.env.MJPG_STREAMER_PATH || d.MJPG_STREAMER_PATH,
      mjpgStreamerWww: process.env.MJPG_STREAMER_WWW || d.MJPG_STREAMER_WWW,

      // Capture
      captureInterval:
        this.parseNumber(process.env.CAPTURE_INTERVAL, 1, 3600) || d.CAPTURE_INTERVAL,
      outputDir: process.env.OUTPUT_DIR || d.OUTPUT_DIR,
      imageQuality:
        this.validateOption(process.env.IMAGE_QUALITY, "imageQuality") || d.IMAGE_QUALITY,
      rotation:
        this.validateOption(parseInt(process.env.ROTATION), "rotation") ?? d.ROTATION,
      flipHorizontal: this.parseBool(process.env.FLIP_HORIZONTAL) ?? d.FLIP_HORIZONTAL,
      flipVertical: this.parseBool(process.env.FLIP_VERTICAL) ?? d.FLIP_VERTICAL,

      // Stream
      streamFps:
        this.validateOption(parseInt(process.env.STREAM_FPS), "streamFps") || d.STREAM_FPS,
      streamQuality:
        this.validateOption(process.env.STREAM_QUALITY, "streamQuality") || d.STREAM_QUALITY,
      cameraDevice: process.env.CAMERA_DEVICE || d.CAMERA_DEVICE,

      // Schedule
      scheduleEnabled: this.parseBool(process.env.SCHEDULE_ENABLED) ?? d.SCHEDULE_ENABLED,
      startTime: this.validateTime(process.env.SCHEDULE_START_TIME) || d.SCHEDULE_START_TIME,
      stopTime: this.validateTime(process.env.SCHEDULE_STOP_TIME) || d.SCHEDULE_STOP_TIME,

      // Video
      videoFps:
        this.validateOption(parseInt(process.env.VIDEO_FPS), "videoFps") || d.VIDEO_FPS,
      videoQuality:
        this.validateOption(process.env.VIDEO_QUALITY, "videoQuality") || d.VIDEO_QUALITY,
      videoCodec:
        this.validateOption(process.env.VIDEO_CODEC, "videoCodec") || d.VIDEO_CODEC,
      videoBitrate:
        this.validateOption(process.env.VIDEO_BITRATE, "videoBitrate") || d.VIDEO_BITRATE,

      // Notifications
      webhookEnabled: this.parseBool(process.env.NOTIFY_WEBHOOK_ENABLED) ?? d.NOTIFY_WEBHOOK_ENABLED,
      webhookUrl: process.env.NOTIFY_WEBHOOK_URL || d.NOTIFY_WEBHOOK_URL,
      emailEnabled: this.parseBool(process.env.NOTIFY_EMAIL_ENABLED) ?? d.NOTIFY_EMAIL_ENABLED,
      emailHost: process.env.EMAIL_HOST || d.EMAIL_HOST,
      emailPort: parseInt(process.env.EMAIL_PORT) || d.EMAIL_PORT,
      emailUser: process.env.EMAIL_USER || d.EMAIL_USER,
      emailTo: process.env.EMAIL_TO || d.EMAIL_TO,
    };

    console.log("Configuration loaded successfully from settings.json");
    return config;
  }

  /** Legacy config shape consumed by the existing web interface. */
  getLegacyConfig(config) {
    return {
      captureInterval: config.captureInterval,
      imageQuality: config.imageQuality,
      streamFps: config.streamFps,
      streamQuality: config.streamQuality,
      scheduleEnabled: config.scheduleEnabled,
      startTime: config.startTime,
      stopTime: config.stopTime,
      videoFps: config.videoFps,
      videoQuality: config.videoQuality,
    };
  }

  /** Extended config shape for the advanced settings UI. */
  getExtendedConfig(config) {
    return {
      ...this.getLegacyConfig(config),
      videoCodec: config.videoCodec,
      videoBitrate: config.videoBitrate,
      cameraDevice: config.cameraDevice,
      rotation: config.rotation,
      flipHorizontal: config.flipHorizontal,
      flipVertical: config.flipVertical,
      webhookEnabled: config.webhookEnabled,
      webhookUrl: config.webhookUrl,
      emailEnabled: config.emailEnabled,
      emailHost: config.emailHost,
      emailPort: config.emailPort,
      emailUser: config.emailUser,
      emailTo: config.emailTo,
    };
  }

  /** Persist a set of web-interface updates to settings.json + process.env. */
  async updateConfig(updates) {
    return this._applyUpdates(updates);
  }

  /** Persist extended updates (same path; the uiKeyMap covers every editable key). */
  async updateExtendedConfig(updates) {
    return this._applyUpdates(updates);
  }

  async _applyUpdates(updates) {
    const merged = this.loader.readMerged();

    for (const [uiKey, rawValue] of Object.entries(updates)) {
      const field = this.uiKeyMap[uiKey];
      if (!field) continue; // ignore unknown / removed keys

      const value = this._coerce(uiKey, field, rawValue);
      if (value === null || value === undefined) continue;

      merged[field.group][field.key] = value;
      process.env[field.env] = String(value); // live effect
    }

    this.loader.writeCurrent(merged);
    console.log("Configuration updated and persisted to settings.json");
    return true;
  }

  /** Reset settings.json back to the shipped defaults and re-apply to the environment. */
  async resetToDefaults() {
    const fs = require("fs");
    fs.copyFileSync(this.loader.DEFAULT_PATH, this.loader.CURRENT_PATH);
    const merged = this.loader.readMerged();
    // Re-apply every known field to process.env so the running process picks up defaults.
    for (const f of this.schema) {
      const v = merged[f.group][f.key];
      if (v !== undefined) process.env[f.env] = String(v);
    }
    console.log("Configuration reset to defaults in settings.json");
    return true;
  }

  /** Coerce/validate a single value based on its UI key and schema type. */
  _coerce(uiKey, field, value) {
    // Select/dropdown validation first (uses UI-key option lists).
    if (this.validOptions[uiKey]) {
      const candidate =
        field.type === "int" ? parseInt(value) : value;
      return this.validateOption(candidate, uiKey);
    }
    switch (field.type) {
      case "int": {
        const n = parseInt(value);
        return Number.isNaN(n) ? null : n;
      }
      case "bool":
        return this.parseBool(value) ?? false;
      case "string":
      default:
        if (uiKey === "startTime" || uiKey === "stopTime") {
          return this.validateTime(value);
        }
        return value === undefined ? null : String(value);
    }
  }

  // --- validation helpers ---

  validateOption(value, optionType) {
    if (value === undefined || value === null || !this.validOptions[optionType]) {
      return null;
    }
    return this.validOptions[optionType].includes(value) ? value : null;
  }

  parseNumber(value, min = null, max = null) {
    const num = parseInt(value);
    if (Number.isNaN(num)) return null;
    if (min !== null && num < min) return null;
    if (max !== null && num > max) return null;
    return num;
  }

  validateTime(timeString) {
    if (!timeString) return null;
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(timeString) ? timeString : null;
  }

  parseBool(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "boolean") return value;
    return value.toString().toLowerCase() === "true" || value === "1";
  }
}

module.exports = ConfigService;
