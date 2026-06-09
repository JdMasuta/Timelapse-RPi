// services/video/VideoController.js - Production Ready Version
// Refactored to use extracted modules with EXACT SAME logic

const { promisify } = require("util");
const { exec } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const Logger = require("../camera/Logger");

// Import extracted modules
const {
  VideoError,
  SecurityError,
  ValidationError,
  ProcessError,
  ResourceError,
} = require("./Error"); // Ensure all custom errors are imported
const VideoConfig = require("./VideoConfig");
const VideoValidator = require("./VideoValidator");
const ResourceMonitor = require("./ResourceMonitor");
const ProcessManager = require("./ProcessManager");
const Mutex = require("./Mutex");

const execAsync = promisify(exec);

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
    // Note: process shutdown is owned solely by server.js, which calls cleanup() during
    // its graceful shutdown. This controller no longer registers its own signal handlers.
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(this.config.get("videosDir"), { recursive: true });
      await fs.mkdir(this.config.get("capturesDir"), { recursive: true });
      // Ensure the temporary directory also exists for symlink creation
      await fs.mkdir(this.config.get("tempDir"), { recursive: true });

      Logger.info("VideoController", "Directories ensured", {
        videosDir: this.config.get("videosDir"),
        capturesDir: this.config.get("capturesDir"),
        tempDir: this.config.get("tempDir"), // Log temp dir for visibility
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


  /**
   * Create video from folder of images - Production Ready
   * @param {string} inputFolder - Path to folder containing images
   * @param {object} options - Video creation options
   * @returns {Promise<object>} Video creation result
   */
  async createVideo(inputFolder, options = {}) {
    const startTime = Date.now();
    let correlationId;
    let tempSymlinkDir = null; // Declare variable for cleanup

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

      // Scan and analyze images, and build the FFmpeg concat list
      const imageData = await this.scanAndValidateImages(
        validatedFolder,
        correlationId,
        validatedOptions.fps
      );
      tempSymlinkDir = imageData.concatListPath; // temp artifact to clean up

      // Generate secure output path
      const outputInfo = await this.generateOutputPath(
        imageData,
        validatedOptions.codec,
        correlationId
      );

      // Build secure FFmpeg arguments
      const ffmpegArgs = this.buildSecureFFmpegArgs(
        imageData.concatListPath, // concat demuxer list of ordered frames
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

      // Cleanup temporary concat list file
      if (tempSymlinkDir) {
        await this.cleanupConcatList(tempSymlinkDir, correlationId);
      }
    }
  }

  async scanAndValidateImages(inputFolder, correlationId, fps = 30) {
    Logger.debug("VideoController", "Scanning images", {
      correlationId,
      inputFolder,
    });

    let concatListPath = null;

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

      // Manifest is the source of truth for frame timestamps; fall back to parsing
      // the canonical filename pattern for images captured before the manifest existed.
      const manifest = await this.readManifest(inputFolder, correlationId);

      const images = [];
      for (const filename of imageFiles) {
        let timestamp = null;
        if (manifest[filename] && manifest[filename].timestamp) {
          const d = new Date(manifest[filename].timestamp);
          if (!isNaN(d.getTime())) timestamp = d;
        }
        if (!timestamp) timestamp = this.parseTimestamp(filename);

        if (timestamp) {
          images.push({
            filename,
            timestamp,
            path: path.join(inputFolder, filename),
          });
        } else {
          Logger.warn("VideoController", "Skipping file with no known timestamp", {
            correlationId,
            filename,
          });
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

      // Build an FFmpeg concat-demuxer list (replaces the old temp-symlink tree).
      // Each frame is shown for 1/fps seconds; the last frame is repeated so it renders.
      const frameDuration = (1 / (fps || 30)).toFixed(6);
      const lines = ["ffconcat version 1.0"];
      for (const image of images) {
        lines.push(`file '${image.path.replace(/'/g, "'\\''")}'`);
        lines.push(`duration ${frameDuration}`);
      }
      lines.push(`file '${images[images.length - 1].path.replace(/'/g, "'\\''")}'`);

      concatListPath = path.join(
        this.config.get("tempDir"),
        `ffmpeg_concat_${correlationId}.txt`
      );
      await fs.writeFile(concatListPath, lines.join("\n") + "\n");
      Logger.info("VideoController", "Concat list created", {
        correlationId,
        concatListPath,
        count: images.length,
      });

      const result = {
        images,
        startTime,
        endTime,
        durationSeconds,
        count: images.length,
        concatListPath,
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
        errorCode: error.code,
      });
      if (concatListPath) {
        await this.cleanupConcatList(concatListPath, correlationId);
      }
      throw error;
    }
  }

  /**
   * Read the capture manifest (captures/manifest.json) if present.
   * Returns an object mapping filename -> { timestamp }. Missing/corrupt -> {}.
   */
  async readManifest(inputFolder, correlationId) {
    const manifestPath = path.join(inputFolder, "manifest.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      Logger.debug("VideoController", "No usable manifest; using filename parsing", {
        correlationId,
        error: error.message,
      });
      return {};
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

  buildSecureFFmpegArgs(concatListPath, outputPath, options, imageData) {
    // Build FFmpeg arguments array (NO shell execution, NO string interpolation)
    const args = [];

    // Overwrite output file
    args.push("-y");

    // Read ordered frames from the concat-demuxer list (-safe 0 allows absolute paths).
    args.push("-f", "concat");
    args.push("-safe", "0");
    args.push("-i", concatListPath);

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
      concatListPath,
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

  /**
   * Removes the temporary FFmpeg concat list file.
   * @param {string} listPath - The path to the concat list file.
   * @param {string} correlationId - The correlation ID for logging.
   */
  async cleanupConcatList(listPath, correlationId) {
    Logger.info("VideoController", "Cleaning up concat list", {
      correlationId,
      listPath,
    });
    try {
      await fs.rm(listPath, { force: true });
      Logger.info("VideoController", "Concat list cleaned up", {
        correlationId,
        listPath,
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        Logger.warn("VideoController", "Concat list not found during cleanup", {
          correlationId,
          listPath,
        });
      } else {
        Logger.error("VideoController", "Error cleaning up concat list", {
          correlationId,
          listPath,
          error: error.message,
        });
      }
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
        // If there's an active job, try to cancel it, which will also trigger symlink cleanup
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
