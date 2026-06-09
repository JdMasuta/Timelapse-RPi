// services/camera/VideoController.js - Production Ready Version
// Addresses all security vulnerabilities and reliability issues

const { spawn } = require("child_process");
const { promisify } = require("util");
const { exec } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const Logger = require("./Logger");

const execAsync = promisify(exec);

// ============================================================================
// ERROR CLASSES
// ============================================================================

class VideoError extends Error {
  constructor(message, code = "VIDEO_ERROR", details = {}) {
    super(message);
    this.name = "VideoError";
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

class ValidationError extends VideoError {
  constructor(message, field, value) {
    super(message, "VALIDATION_ERROR", { field, value });
    this.name = "ValidationError";
  }
}

class SecurityError extends VideoError {
  constructor(message, details = {}) {
    super(message, "SECURITY_ERROR", details);
    this.name = "SecurityError";
  }
}

class ResourceError extends VideoError {
  constructor(message, resource, limit) {
    super(message, "RESOURCE_ERROR", { resource, limit });
    this.name = "ResourceError";
  }
}

class ProcessError extends VideoError {
  constructor(message, exitCode, stderr) {
    super(message, "PROCESS_ERROR", {
      exitCode,
      stderr: stderr?.substring(0, 500),
    });
    this.name = "ProcessError";
  }
}

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================

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

// ============================================================================
// INPUT VALIDATION AND SANITIZATION
// ============================================================================

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

// ============================================================================
// RESOURCE MONITORING
// ============================================================================

class ResourceMonitor {
  constructor(config) {
    this.config = config;
  }

  async checkResources(inputFolder) {
    const checks = await Promise.allSettled([
      this.checkDiskSpace(),
      this.checkMemoryUsage(),
      this.checkInputFolder(inputFolder),
    ]);

    const failures = checks.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      const errors = failures.map((f) => f.reason.message).join("; ");
      throw new ResourceError(`Resource checks failed: ${errors}`);
    }

    return {
      diskSpace: checks[0].value,
      memoryUsage: checks[1].value,
      inputValidation: checks[2].value,
    };
  }

  async checkDiskSpace() {
    try {
      const stats = await fs.statfs(this.config.get("videosDir"));
      const freeSpace = stats.bavail * stats.bsize;

      if (freeSpace < this.config.get("minDiskSpace")) {
        throw new ResourceError(
          "Insufficient disk space",
          "diskSpace",
          this.config.get("minDiskSpace")
        );
      }

      return { freeSpace, required: this.config.get("minDiskSpace") };
    } catch (error) {
      if (error instanceof ResourceError) throw error;

      // statfs might not be available, use alternative check
      Logger.warn(
        "ResourceMonitor",
        "Could not check disk space using statfs, skipping check",
        {
          error: error.message,
        }
      );
      return {
        freeSpace: "unknown",
        required: this.config.get("minDiskSpace"),
      };
    }
  }

  async checkMemoryUsage() {
    const usage = process.memoryUsage();
    const currentUsage = usage.heapUsed + usage.external;

    if (currentUsage > this.config.get("maxMemoryUsage")) {
      throw new ResourceError(
        "Memory usage too high",
        "memoryUsage",
        this.config.get("maxMemoryUsage")
      );
    }

    return { currentUsage, maxUsage: this.config.get("maxMemoryUsage") };
  }

  async checkInputFolder(inputFolder) {
    try {
      const files = await fs.readdir(inputFolder);
      const imageFiles = files.filter((file) =>
        this.config
          .get("allowedExtensions")
          .some((ext) => file.toLowerCase().endsWith(ext))
      );

      if (imageFiles.length === 0) {
        throw new ValidationError(
          "No valid image files found in input folder",
          "inputFolder",
          inputFolder
        );
      }

      if (imageFiles.length > this.config.get("maxInputImages")) {
        throw new ResourceError(
          "Too many input images",
          "imageCount",
          this.config.get("maxInputImages")
        );
      }

      return {
        imageCount: imageFiles.length,
        maxImages: this.config.get("maxInputImages"),
      };
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ResourceError) {
        throw error;
      }
      throw new ValidationError(
        `Cannot access input folder: ${error.message}`,
        "inputFolder",
        inputFolder
      );
    }
  }
}

// ============================================================================
// ATOMIC OPERATIONS MUTEX
// ============================================================================

class Mutex {
  constructor() {
    this.locked = false;
    this.waiting = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.waiting.push(resolve);
      }
    });
  }

  release() {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next();
    } else {
      this.locked = false;
    }
  }

  isLocked() {
    return this.locked;
  }
}

// ============================================================================
// SECURE PROCESS MANAGEMENT
// ============================================================================

class ProcessManager {
  constructor(config) {
    this.config = config;
    this.currentProcess = null;
    this.abortController = new AbortController();
  }

  async executeFFmpeg(args, onProgress = null) {
    if (this.currentProcess) {
      throw new ProcessError("Process already running");
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stderr = "";
      let stdout = "";
      let progressData = { frame: 0, totalFrames: 0 };

      Logger.info("ProcessManager", "Starting FFmpeg process", {
        command: "ffmpeg",
        args: args.map((arg) =>
          typeof arg === "string" && arg.length > 50
            ? arg.substring(0, 47) + "..."
            : arg
        ),
      });

      // Start process with validated arguments (NO shell execution)
      this.currentProcess = spawn("ffmpeg", args, {
        stdio: ["pipe", "pipe", "pipe"],
        signal: this.abortController.signal,
      });

      const processTimeout = setTimeout(() => {
        this.killProcess("TIMEOUT");
        reject(
          new ProcessError(
            `Process timeout after ${this.config.get("processTimeout")}ms`
          )
        );
      }, this.config.get("processTimeout"));

      // Handle stdout
      this.currentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        // Limit stdout size
        if (stdout.length > this.config.get("maxStderrSize")) {
          stdout = stdout.substring(
            stdout.length - this.config.get("maxStderrSize")
          );
        }
      });

      // Handle stderr and progress
      this.currentProcess.stderr.on("data", (data) => {
        const output = data.toString();
        stderr += output;

        // Limit stderr size to prevent memory leaks
        if (stderr.length > this.config.get("maxStderrSize")) {
          stderr = stderr.substring(
            stderr.length - this.config.get("maxStderrSize")
          );
        }

        // Parse progress
        this.parseProgress(output, progressData, onProgress);
      });

      // Handle process completion
      this.currentProcess.on("close", (code) => {
        clearTimeout(processTimeout);
        this.currentProcess = null;

        const duration = Date.now() - startTime;

        if (code === 0) {
          Logger.info(
            "ProcessManager",
            "FFmpeg process completed successfully",
            {
              duration,
              exitCode: code,
            }
          );
          resolve({
            exitCode: code,
            duration,
            stdout: stdout.substring(-1000), // Last 1KB
            stderr: stderr.substring(-1000),
          });
        } else {
          Logger.error("ProcessManager", "FFmpeg process failed", {
            duration,
            exitCode: code,
            stderr: stderr.substring(-1000),
          });
          reject(
            new ProcessError(
              `FFmpeg failed with exit code ${code}`,
              code,
              stderr
            )
          );
        }
      });

      // Handle process errors
      this.currentProcess.on("error", (error) => {
        clearTimeout(processTimeout);
        this.currentProcess = null;

        Logger.error("ProcessManager", "FFmpeg process error", {
          error: error.message,
          code: error.code,
        });

        if (error.name === "AbortError") {
          reject(new ProcessError("Process was cancelled"));
        } else {
          reject(new ProcessError(`Process error: ${error.message}`));
        }
      });
    });
  }

  parseProgress(output, progressData, onProgress) {
    // Parse frame information from FFmpeg output
    const frameMatch = output.match(/frame=\s*(\d+)/);
    if (frameMatch) {
      progressData.frame = parseInt(frameMatch[1]);
    }

    // Parse duration information if available
    const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (timeMatch) {
      const [, hours, minutes, seconds] = timeMatch;
      const currentSeconds =
        parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
      progressData.currentSeconds = currentSeconds;
    }

    // Call progress callback if available
    if (onProgress && progressData.frame > 0) {
      try {
        onProgress(progressData);
      } catch (error) {
        Logger.warn("ProcessManager", "Progress callback error", {
          error: error.message,
        });
      }
    }
  }

  async killProcess(reason = "USER_REQUEST") {
    if (!this.currentProcess) {
      return false;
    }

    Logger.info("ProcessManager", "Killing FFmpeg process", {
      pid: this.currentProcess.pid,
      reason,
    });

    return new Promise((resolve) => {
      const killTimeout = setTimeout(() => {
        // Force kill if graceful termination failed
        try {
          this.currentProcess.kill("SIGKILL");
          Logger.warn("ProcessManager", "Force killed process with SIGKILL", {
            pid: this.currentProcess.pid,
          });
        } catch (error) {
          Logger.error("ProcessManager", "Error force killing process", {
            error: error.message,
          });
        }
        resolve(true);
      }, this.config.get("killTimeout"));

      this.currentProcess.on("exit", () => {
        clearTimeout(killTimeout);
        resolve(true);
      });

      // Try graceful termination first
      try {
        this.currentProcess.kill("SIGTERM");
      } catch (error) {
        clearTimeout(killTimeout);
        Logger.error("ProcessManager", "Error killing process", {
          error: error.message,
        });
        resolve(false);
      }
    });
  }

  cleanup() {
    if (this.currentProcess) {
      this.abortController.abort();
      this.killProcess("CLEANUP");
    }
  }

  getStatus() {
    return {
      isRunning: !!this.currentProcess,
      pid: this.currentProcess?.pid || null,
    };
  }
}

// ============================================================================
// MAIN VIDEO CONTROLLER - PRODUCTION READY
// ============================================================================

class VideoController {
  constructor(dependencies = {}) {
    // Dependency injection for testing
    this.config = dependencies.config || new VideoConfig();
    this.validator = dependencies.validator || new VideoValidator(this.config);
    this.resourceMonitor =
      dependencies.resourceMonitor || new ResourceMonitor(this.config);
    this.processManager =
      dependencies.processManager || new ProcessManager(this.config);
    this.mutex = dependencies.mutex || new Mutex();

    // State management
    this.isProcessing = false;
    this.currentJob = null;
    this.metrics = {
      jobsCompleted: 0,
      jobsFailed: 0,
      totalProcessingTime: 0,
      averageProcessingTime: 0,
    };

    Logger.info("VideoController", "Production video controller initialized", {
      videosDir: this.config.get("videosDir"),
      maxConcurrentJobs: this.config.get("maxConcurrentJobs"),
      processTimeout: this.config.get("processTimeout"),
    });

    this.ensureDirectories();
    this.setupGracefulShutdown();
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(this.config.get("videosDir"), { recursive: true });
      await fs.mkdir(this.config.get("capturesDir"), { recursive: true });

      Logger.info("VideoController", "Directories ensured", {
        videosDir: this.config.get("videosDir"),
        capturesDir: this.config.get("capturesDir"),
      });
    } catch (error) {
      Logger.error("VideoController", "Failed to create directories", {
        error: error.message,
      });
      throw new VideoError("Failed to initialize directories", "INIT_ERROR", {
        error: error.message,
      });
    }
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      Logger.info("VideoController", "Graceful shutdown initiated", { signal });

      if (this.currentJob) {
        Logger.info(
          "VideoController",
          "Cancelling current job during shutdown"
        );
        await this.cancelVideoCreation();
      }

      this.processManager.cleanup();
      Logger.info("VideoController", "Shutdown complete");
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }

  /**
   * Create video from folder of images - Production Ready
   * @param {string} inputFolder - Path to folder containing images
   * @param {object} options - Video creation options
   * @returns {Promise<object>} Video creation result
   */
  async createVideo(inputFolder, options = {}) {
    const startTime = Date.now();
    let correlationId;

    try {
      // Acquire mutex lock for atomic operation
      await this.mutex.acquire();

      // Validate inputs and generate correlation ID
      const validated = this.validator.validateCreateVideoOptions(
        inputFolder,
        options
      );
      correlationId = validated.correlationId;
      const validatedFolder = validated.inputFolder;
      const validatedOptions = validated.options;

      Logger.info("VideoController", "Video creation started", {
        correlationId,
        inputFolder: validatedFolder,
        options: validatedOptions,
      });

      // Check if already processing
      if (this.isProcessing) {
        throw new ResourceError(
          "Video creation already in progress",
          "concurrency",
          1
        );
      }

      // Check system resources
      const resourceCheck = await this.resourceMonitor.checkResources(
        validatedFolder
      );
      Logger.info("VideoController", "Resource check passed", {
        correlationId,
        resources: resourceCheck,
      });

      // Check FFmpeg availability
      if (!(await this.checkFFmpegAvailability())) {
        throw new ProcessError("FFmpeg is not available on this system");
      }

      // Set processing state
      this.isProcessing = true;
      this.currentJob = {
        correlationId,
        startTime,
        inputFolder: validatedFolder,
        options: validatedOptions,
      };

      // Scan and analyze images
      const imageData = await this.scanAndValidateImages(
        validatedFolder,
        correlationId
      );

      // Generate secure output path
      const outputInfo = await this.generateOutputPath(
        imageData,
        validatedOptions.codec,
        correlationId
      );

      // Build secure FFmpeg arguments
      const ffmpegArgs = this.buildSecureFFmpegArgs(
        validatedFolder,
        outputInfo.outputPath,
        validatedOptions,
        imageData
      );

      // Execute video creation
      const processResult = await this.processManager.executeFFmpeg(
        ffmpegArgs,
        (progressData) =>
          this.handleProgress(
            progressData,
            imageData,
            validatedOptions.onProgress,
            correlationId
          )
      );

      // Verify output and generate result
      const result = await this.generateResult(
        outputInfo,
        imageData,
        validatedOptions,
        processResult,
        startTime,
        correlationId
      );

      // Update metrics
      this.updateMetrics(true, Date.now() - startTime);

      Logger.info("VideoController", "Video creation completed successfully", {
        correlationId,
        duration: Date.now() - startTime,
        outputFile: result.filename,
        frameCount: result.frameCount,
      });

      // Call completion callback
      if (validatedOptions.onComplete) {
        try {
          validatedOptions.onComplete(result);
        } catch (error) {
          Logger.warn("VideoController", "Completion callback error", {
            correlationId,
            error: error.message,
          });
        }
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(false, duration);

      Logger.error("VideoController", "Video creation failed", {
        correlationId,
        duration,
        error: error.message,
        errorCode: error.code,
      });

      // Call error callback if available
      if (options.onError) {
        try {
          options.onError(error);
        } catch (callbackError) {
          Logger.warn("VideoController", "Error callback failed", {
            correlationId,
            error: callbackError.message,
          });
        }
      }

      throw error;
    } finally {
      // Always cleanup state
      this.isProcessing = false;
      this.currentJob = null;
      this.mutex.release();
    }
  }

  async scanAndValidateImages(inputFolder, correlationId) {
    Logger.debug("VideoController", "Scanning images", {
      correlationId,
      inputFolder,
    });

    try {
      const files = await fs.readdir(inputFolder);
      const imageFiles = files.filter((file) =>
        this.config
          .get("allowedExtensions")
          .some((ext) => file.toLowerCase().endsWith(ext))
      );

      if (imageFiles.length === 0) {
        throw new ValidationError(
          "No valid image files found",
          "inputFolder",
          inputFolder
        );
      }

      // Parse timestamps and validate
      const images = [];
      for (const filename of imageFiles) {
        const timestamp = this.parseTimestamp(filename);
        if (timestamp) {
          images.push({
            filename,
            timestamp,
            path: path.join(inputFolder, filename),
          });
        } else {
          Logger.warn(
            "VideoController",
            "Skipping file with invalid timestamp",
            {
              correlationId,
              filename,
            }
          );
        }
      }

      if (images.length === 0) {
        throw new ValidationError(
          "No images with valid timestamps found",
          "imageFiles",
          imageFiles.length
        );
      }

      // Sort chronologically
      images.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      const startTime = images[0].timestamp;
      const endTime = images[images.length - 1].timestamp;
      const durationSeconds = Math.round(
        (endTime.getTime() - startTime.getTime()) / 1000
      );

      // Validate duration limits
      if (durationSeconds > this.config.get("maxVideoDuration")) {
        throw new ResourceError(
          "Video duration exceeds maximum allowed",
          "videoDuration",
          this.config.get("maxVideoDuration")
        );
      }

      const result = {
        images,
        startTime,
        endTime,
        durationSeconds,
        count: images.length,
      };

      Logger.info("VideoController", "Images scanned and validated", {
        correlationId,
        count: result.count,
        duration: durationSeconds,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

      return result;
    } catch (error) {
      Logger.error("VideoController", "Error scanning images", {
        correlationId,
        error: error.message,
        inputFolder,
      });
      throw error;
    }
  }

  parseTimestamp(filename) {
    try {
      // Expected format: timelapse_2025-06-25T13-43-41-407Z.jpg
      const match = filename.match(
        /timelapse_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/
      );
      if (!match) {
        return null;
      }

      const timestampStr = match[1];

      // Convert to ISO format: 2025-06-25T13:43:41.407Z
      const isoString = timestampStr.replace(
        /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
        "T$1:$2:$3.$4Z"
      );

      const date = new Date(isoString);
      return isNaN(date.getTime()) ? null : date;
    } catch (error) {
      return null;
    }
  }

  async generateOutputPath(imageData, codec, correlationId) {
    const formatTimestamp = (date) => {
      return date
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace(/Z$/, "")
        .substring(0, 19);
    };

    const startStr = formatTimestamp(imageData.startTime);
    const endStr = formatTimestamp(imageData.endTime);
    const extension = "mp4"; // Always use MP4 for compatibility

    const filename = `timelapse_${startStr}_to_${endStr}.${extension}`;
    const outputPath = path.join(this.config.get("videosDir"), filename);

    // Ensure output path is secure
    const resolvedOutputPath = path.resolve(outputPath);
    const allowedOutputBase = path.resolve(this.config.get("videosDir"));

    if (!resolvedOutputPath.startsWith(allowedOutputBase)) {
      throw new SecurityError("Output path outside allowed directory", {
        outputPath: resolvedOutputPath,
        allowedBase: allowedOutputBase,
      });
    }

    Logger.debug("VideoController", "Output path generated", {
      correlationId,
      filename,
      outputPath: resolvedOutputPath,
    });

    return {
      filename,
      outputPath: resolvedOutputPath,
    };
  }

  buildSecureFFmpegArgs(inputFolder, outputPath, options, imageData) {
    // Build FFmpeg arguments array (NO shell execution, NO string interpolation)
    const args = [];

    // Overwrite output file
    args.push("-y");

    // Input framerate
    args.push("-framerate", options.fps.toString());

    // Input pattern (using glob)
    args.push("-pattern_type", "glob");
    args.push("-i", path.join(inputFolder, "*.jpg"));

    // Video codec
    const codecMap = {
      h264: "libx264",
      h265: "libx265",
    };
    args.push("-c:v", codecMap[options.codec]);

    // Pixel format for compatibility
    args.push("-pix_fmt", "yuv420p");

    // Quality settings
    const qualitySettings = this.config.getQualitySettings(
      options.codec,
      options.quality
    );

    if (options.bitrate) {
      // Custom bitrate
      args.push("-b:v", `${options.bitrate}k`);
      args.push("-maxrate", `${options.bitrate}k`);
      args.push("-bufsize", `${options.bitrate * 2}k`);
    } else {
      // Quality preset
      if (qualitySettings.crf) {
        args.push("-crf", qualitySettings.crf.toString());
      }
      if (qualitySettings.preset) {
        args.push("-preset", qualitySettings.preset);
      }
      if (qualitySettings.maxrate) {
        args.push("-maxrate", qualitySettings.maxrate);
      }
      if (qualitySettings.bufsize) {
        args.push("-bufsize", qualitySettings.bufsize);
      }
    }

    // Output framerate
    args.push("-r", options.fps.toString());

    // Output file
    args.push(outputPath);

    Logger.debug("VideoController", "FFmpeg arguments built", {
      argsCount: args.length,
      codec: options.codec,
      quality: options.quality,
      fps: options.fps,
    });

    return args;
  }

  handleProgress(progressData, imageData, onProgressCallback, correlationId) {
    try {
      const progress =
        imageData.count > 0
          ? Math.min(
              100,
              Math.round((progressData.frame / imageData.count) * 100)
            )
          : 0;

      Logger.debug("VideoController", "Progress update", {
        correlationId,
        frame: progressData.frame,
        totalFrames: imageData.count,
        progress: `${progress}%`,
      });

      if (onProgressCallback) {
        onProgressCallback(progress, progressData.frame, imageData.count);
      }
    } catch (error) {
      Logger.warn("VideoController", "Progress handling error", {
        correlationId,
        error: error.message,
      });
    }
  }

  async generateResult(
    outputInfo,
    imageData,
    options,
    processResult,
    startTime,
    correlationId
  ) {
    try {
      // Verify output file exists and get stats
      const stats = await fs.stat(outputInfo.outputPath);

      // Validate file size
      if (stats.size > this.config.get("maxVideoSize")) {
        // Delete oversized file
        await fs.unlink(outputInfo.outputPath);
        throw new ResourceError(
          "Generated video exceeds maximum size limit",
          "videoSize",
          this.config.get("maxVideoSize")
        );
      }

      const result = {
        outputPath: outputInfo.outputPath,
        filename: outputInfo.filename,
        size: stats.size,
        durationSeconds: imageData.durationSeconds,
        frameCount: imageData.count,
        fps: options.fps,
        codec: options.codec,
        quality: options.quality,
        processingTime: Date.now() - startTime,
        createdAt: new Date().toISOString(),
        correlationId,
      };

      Logger.info("VideoController", "Result generated", {
        correlationId,
        filename: result.filename,
        size: result.size,
        processingTime: result.processingTime,
      });

      return result;
    } catch (error) {
      Logger.error("VideoController", "Error generating result", {
        correlationId,
        error: error.message,
      });
      throw error;
    }
  }

  updateMetrics(success, duration) {
    if (success) {
      this.metrics.jobsCompleted++;
    } else {
      this.metrics.jobsFailed++;
    }

    this.metrics.totalProcessingTime += duration;
    const totalJobs = this.metrics.jobsCompleted + this.metrics.jobsFailed;
    this.metrics.averageProcessingTime =
      totalJobs > 0
        ? Math.round(this.metrics.totalProcessingTime / totalJobs)
        : 0;

    if (this.config.get("enableMetrics")) {
      Logger.info("VideoController", "Metrics updated", this.metrics);
    }
  }

  async checkFFmpegAvailability() {
    try {
      await execAsync(`${this.config.get("ffmpegPath")} -version`);
      return true;
    } catch (error) {
      Logger.error("VideoController", "FFmpeg not available", {
        ffmpegPath: this.config.get("ffmpegPath"),
        error: error.message,
      });
      return false;
    }
  }

  async cancelVideoCreation() {
    if (!this.isProcessing || !this.currentJob) {
      Logger.warn("VideoController", "No video creation process to cancel");
      return false;
    }

    Logger.info("VideoController", "Cancelling video creation", {
      correlationId: this.currentJob.correlationId,
    });

    try {
      const killed = await this.processManager.killProcess("USER_CANCEL");
      if (killed) {
        this.isProcessing = false;
        this.currentJob = null;
        Logger.info("VideoController", "Video creation cancelled successfully");
        return true;
      } else {
        Logger.error("VideoController", "Failed to cancel video creation");
        return false;
      }
    } catch (error) {
      Logger.error("VideoController", "Error cancelling video creation", {
        error: error.message,
      });
      return false;
    }
  }

  async listVideos() {
    try {
      const files = await fs.readdir(this.config.get("videosDir"));
      const videoFiles = files.filter((file) =>
        this.config
          .get("allowedFormats")
          .some((format) => file.toLowerCase().endsWith(`.${format}`))
      );

      const videos = await Promise.all(
        videoFiles.map(async (filename) => {
          const filepath = path.join(this.config.get("videosDir"), filename);
          const stats = await fs.stat(filepath);

          return {
            filename,
            filepath,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
          };
        })
      );

      const sortedVideos = videos.sort((a, b) => b.created - a.created);

      Logger.debug("VideoController", "Videos listed", {
        count: sortedVideos.length,
      });
      return sortedVideos;
    } catch (error) {
      Logger.error("VideoController", "Error listing videos", {
        error: error.message,
      });
      return [];
    }
  }

  async deleteVideo(filename) {
    try {
      // Validate filename (security check)
      if (
        !filename ||
        typeof filename !== "string" ||
        filename.includes("..") ||
        filename.includes("/")
      ) {
        throw new SecurityError("Invalid filename for deletion", { filename });
      }

      const filepath = path.join(this.config.get("videosDir"), filename);

      // Ensure path is within videos directory
      const resolvedPath = path.resolve(filepath);
      const allowedBase = path.resolve(this.config.get("videosDir"));

      if (!resolvedPath.startsWith(allowedBase)) {
        throw new SecurityError("File path outside allowed directory", {
          filepath: resolvedPath,
          allowedBase,
        });
      }

      await fs.unlink(resolvedPath);

      Logger.info("VideoController", "Video deleted successfully", {
        filename,
        filepath: resolvedPath,
      });
      return true;
    } catch (error) {
      Logger.error("VideoController", "Error deleting video", {
        filename,
        error: error.message,
      });

      if (error instanceof SecurityError) {
        throw error;
      }

      return false;
    }
  }

  getStatus() {
    return {
      isProcessing: this.isProcessing,
      currentJob: this.currentJob
        ? {
            correlationId: this.currentJob.correlationId,
            startTime: this.currentJob.startTime,
            duration: Date.now() - this.currentJob.startTime,
          }
        : null,
      processStatus: this.processManager.getStatus(),
      mutex: {
        isLocked: this.mutex.isLocked(),
        waitingCount: this.mutex.waiting.length,
      },
      metrics: { ...this.metrics },
      config: {
        maxConcurrentJobs: this.config.get("maxConcurrentJobs"),
        processTimeout: this.config.get("processTimeout"),
        maxInputImages: this.config.get("maxInputImages"),
      },
    };
  }

  getHealthCheck() {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      components: {
        ffmpeg: this.checkFFmpegAvailability(),
        directories: this.checkDirectories(),
        resources: this.checkBasicResources(),
      },
      metrics: this.metrics,
    };
  }

  async checkDirectories() {
    try {
      await Promise.all([
        fs.access(this.config.get("videosDir")),
        fs.access(this.config.get("capturesDir")),
      ]);
      return { status: "ok" };
    } catch (error) {
      return { status: "error", error: error.message };
    }
  }

  checkBasicResources() {
    const memUsage = process.memoryUsage();
    return {
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
      },
      uptime: process.uptime(),
    };
  }

  cleanup() {
    Logger.info("VideoController", "Cleanup initiated");

    try {
      if (this.currentJob) {
        this.cancelVideoCreation();
      }

      this.processManager.cleanup();
      this.isProcessing = false;
      this.currentJob = null;

      Logger.info("VideoController", "Cleanup completed successfully");
    } catch (error) {
      Logger.error("VideoController", "Error during cleanup", {
        error: error.message,
      });
    }
  }
}

module.exports = VideoController;
