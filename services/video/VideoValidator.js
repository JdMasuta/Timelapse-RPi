// services/video/VideoValidator.js - Input Validation and Sanitization
// Extracted from VideoController.js with no logic changes

const path = require("path");
const crypto = require("crypto");
const Logger = require("../camera/Logger");
const { ValidationError, SecurityError } = require("./Error");

class VideoValidator {
  constructor(config) {
    this.config = config;
  }

  /**
   * Parse common bitrate string formats into integer kbps
   * Supports: "1000", "1000k", "1000K", "2m", "2M", "1.5M"
   * @param {string} bitrateStr - Bitrate string to parse
   * @returns {number} - Bitrate in kbps as integer
   * @throws {ValidationError} - If format is invalid
   */
  parseBitrateString(bitrateStr) {
    if (typeof bitrateStr !== "string") {
      throw new ValidationError(
        "Bitrate string must be a string",
        "bitrate",
        bitrateStr
      );
    }

    const trimmed = bitrateStr.trim().toLowerCase();

    // Match patterns: number, number + k/m suffix
    const match = trimmed.match(/^(\d+(?:\.\d+)?)([km])?$/);

    if (!match) {
      throw new ValidationError(
        "Invalid bitrate format. Supported formats: '1000', '1000k', '2m'",
        "bitrate",
        bitrateStr
      );
    }

    const [, numberPart, suffix] = match;
    const numValue = parseFloat(numberPart);

    if (isNaN(numValue) || numValue <= 0) {
      throw new ValidationError(
        "Bitrate must be a positive number",
        "bitrate",
        bitrateStr
      );
    }

    let kbps;
    switch (suffix) {
      case "k":
        kbps = numValue; // Already in kbps
        break;
      case "m":
        kbps = numValue * 1000; // Convert Mbps to kbps
        break;
      default:
        kbps = numValue; // Assume kbps if no suffix
        break;
    }

    // Ensure result is an integer
    const result = Math.round(kbps);

    if (result !== kbps && Math.abs(result - kbps) > 0.1) {
      throw new ValidationError(
        "Bitrate must result in whole number of kbps",
        "bitrate",
        bitrateStr
      );
    }

    return result;
  }

  validateCreateVideoOptions(inputFolder, options) {
    const correlationId = this.generateCorrelationId();

    try {
      // Validate input folder
      const validatedFolder = this.validateInputFolder(inputFolder);

      // Validate and sanitize options
      const validatedOptions = this.validateVideoOptions(options);

      Logger.info("VideoValidator", "Options validated successfully", {
        correlationId,
        inputFolder: validatedFolder,
        options: validatedOptions,
      });

      return {
        inputFolder: validatedFolder,
        options: validatedOptions,
        correlationId,
      };
    } catch (error) {
      Logger.error("VideoValidator", "Validation failed", {
        correlationId,
        error: error.message,
        inputFolder,
        options,
      });
      throw error;
    }
  }

  validateInputFolder(inputFolder) {
    if (!inputFolder || typeof inputFolder !== "string") {
      throw new ValidationError(
        "Input folder must be a non-empty string",
        "inputFolder",
        inputFolder
      );
    }

    // Resolve and validate path
    const resolvedPath = path.resolve(inputFolder);
    const allowedBase = path.resolve(this.config.get("capturesDir"));

    // Path traversal protection
    if (!resolvedPath.startsWith(allowedBase)) {
      throw new SecurityError("Input folder outside allowed directory", {
        inputFolder: resolvedPath,
        allowedBase,
      });
    }

    // Additional security checks
    if (resolvedPath.includes("..") || resolvedPath.includes("~")) {
      throw new SecurityError("Path contains dangerous characters", {
        inputFolder: resolvedPath,
      });
    }

    return resolvedPath;
  }

  validateVideoOptions(options = {}) {
    const validated = {};

    // FPS validation
    validated.fps = this.validateFps(options.fps);

    // Quality validation
    validated.quality = this.validateQuality(options.quality);

    // Codec validation
    validated.codec = this.validateCodec(options.codec);

    // Bitrate validation (optional)
    if (options.bitrate !== undefined) {
      validated.bitrate = this.validateBitrate(options.bitrate);
    }

    // Callback validation
    validated.onProgress = this.validateCallback(options.onProgress);
    validated.onComplete = this.validateCallback(options.onComplete);
    validated.onError = this.validateCallback(options.onError);

    return validated;
  }

  validateFps(fps) {
    const defaultFps = 30;

    if (fps === undefined) return defaultFps;

    if (typeof fps !== "number" || !Number.isInteger(fps)) {
      throw new ValidationError("FPS must be an integer", "fps", fps);
    }

    if (fps < this.config.get("minFps") || fps > this.config.get("maxFps")) {
      throw new ValidationError(
        `FPS must be between ${this.config.get("minFps")} and ${this.config.get(
          "maxFps"
        )}`,
        "fps",
        fps
      );
    }

    return fps;
  }

  validateQuality(quality) {
    const defaultQuality = "medium";

    if (quality === undefined) return defaultQuality;

    if (typeof quality !== "string") {
      throw new ValidationError("Quality must be a string", "quality", quality);
    }

    if (!this.config.get("allowedQualities").includes(quality)) {
      throw new ValidationError(
        `Quality must be one of: ${this.config
          .get("allowedQualities")
          .join(", ")}`,
        "quality",
        quality
      );
    }

    return quality;
  }

  validateCodec(codec) {
    const defaultCodec = "h264";

    if (codec === undefined) return defaultCodec;

    if (typeof codec !== "string") {
      throw new ValidationError("Codec must be a string", "codec", codec);
    }

    if (!this.config.get("allowedCodecs").includes(codec)) {
      throw new ValidationError(
        `Codec must be one of: ${this.config.get("allowedCodecs").join(", ")}`,
        "codec",
        codec
      );
    }

    return codec;
  }

  validateBitrate(bitrate) {
    const originalValue = bitrate;
    let parsedBitrate;

    // Handle different input types
    if (typeof bitrate === "number") {
      if (!Number.isInteger(bitrate)) {
        throw new ValidationError(
          "Bitrate must be an integer",
          "bitrate",
          originalValue
        );
      }
      parsedBitrate = bitrate;
    } else if (typeof bitrate === "string") {
      parsedBitrate = this.parseBitrateString(bitrate);
    } else {
      throw new ValidationError(
        "Bitrate must be an integer or string format (e.g., '1000', '1000k', '2m')",
        "bitrate",
        originalValue
      );
    }

    // Range validation (lines 289-298 remain the same but use parsedBitrate)
    if (
      parsedBitrate < this.config.get("minBitrate") ||
      parsedBitrate > this.config.get("maxBitrate")
    ) {
      throw new ValidationError(
        `Bitrate must be between ${this.config.get(
          "minBitrate"
        )} and ${this.config.get("maxBitrate")} kbps`,
        "bitrate",
        originalValue // Show original input in error
      );
    }

    return parsedBitrate;
  }

  validateCallback(callback) {
    if (callback === undefined) return null;

    if (typeof callback !== "function") {
      throw new ValidationError(
        "Callback must be a function",
        "callback",
        typeof callback
      );
    }

    return callback;
  }

  generateCorrelationId() {
    return crypto.randomBytes(8).toString("hex");
  }
}

module.exports = VideoValidator;
