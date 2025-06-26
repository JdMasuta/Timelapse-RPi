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
    this.setupGracefulShutdown();
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

      // Scan and analyze images, and create symlinks
      const imageData = await this.scanAndValidateImages(
        validatedFolder,
        correlationId
      );
      tempSymlinkDir = imageData.tempSymlinkDir; // Store for cleanup

      // Generate secure output path
      const outputInfo = await this.generateOutputPath(
        imageData,
        validatedOptions.codec,
        correlationId
      );

      // Build secure FFmpeg arguments
      const ffmpegArgs = this.buildSecureFFmpegArgs(
        tempSymlinkDir, // Use the temporary symlink directory
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

      // Cleanup temporary symlink directory
      if (tempSymlinkDir) {
        await this.cleanupSymlinks(tempSymlinkDir, correlationId);
      }
    }
  }

  async scanAndValidateImages(inputFolder, correlationId) {
    Logger.debug("VideoController", "Scanning images", {
      correlationId,
      inputFolder,
    });

    let tempSymlinkDir = null; // Initialize to null

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
          // Ensure `path` is set correctly here
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

      // Log the images array to debug the 'path' property
      Logger.debug("VideoController", "Images array before symlink creation:", {
        correlationId,
        sampleImages: images
          .slice(0, 5)
          .map((img) => ({ filename: img.filename, path: img.path })), // Log a sample
        totalImages: images.length,
      });

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

      // --- Create a temporary directory for symlinks ---
      const tempDirPrefix = `ffmpeg_input_${correlationId}_`;
      tempSymlinkDir = await fs.mkdtemp(
        path.join(this.config.get("tempDir"), tempDirPrefix)
      );
      Logger.info("VideoController", "Created temporary symlink directory", {
        correlationId,
        tempSymlinkDir,
      });

      // --- Create sequential symlinks ---
      const symlinkPromises = images.map(async (image, index) => {
        const paddedIndex = String(index).padStart(3, "0"); // e.g., 000, 001, 002
        const symlinkName = `frame_${paddedIndex}.jpg`;
        const symlinkPath = path.join(tempSymlinkDir, symlinkName);
        const targetPath = image.path; // Absolute path to original image

        if (!targetPath || typeof targetPath !== "string") {
          Logger.error("VideoController", "Invalid target path for symlink", {
            correlationId,
            filename: image.filename,
            targetPath: targetPath, // Log the problematic path
            imageObject: image, // Log the whole image object for deeper inspection
          });
          throw new VideoError(
            `Invalid source path for symlink: ${image.filename}`,
            "SYMLINK_INVALID_SOURCE",
            { filename: image.filename }
          );
        }

        try {
          // Validate that the source file exists before creating a symlink
          await fs.access(targetPath);
          // Use 'file' type for symlink to regular files
          await fs.symlink(targetPath, symlinkPath, "file");
          Logger.debug("VideoController", "Symlink created", {
            correlationId,
            source: targetPath,
            destination: symlinkPath,
          });
        } catch (symlinkError) {
          Logger.error("VideoController", "Failed to create symlink", {
            correlationId,
            source: targetPath,
            destination: symlinkPath,
            error: symlinkError.message,
            errorCode: symlinkError.code, // Log specific error code (e.g., ENOENT if file not found)
          });
          // Rethrow to fail the video creation process if symlink fails
          throw new VideoError(
            `Failed to create symlink for ${image.filename}`,
            "SYMLINK_ERROR",
            {
              filename: image.filename,
              error: symlinkError.message,
              errorCode: symlinkError.code,
            }
          );
        }
      });

      await Promise.all(symlinkPromises);
      Logger.info("VideoController", "Sequential symlinks created", {
        correlationId,
        count: images.length,
        tempSymlinkDir,
      });

      const result = {
        images,
        startTime,
        endTime,
        durationSeconds,
        count: images.length,
        tempSymlinkDir, // Add the temporary directory path to the result
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
      Logger.error(
        "VideoController",
        "Error scanning images or creating symlinks",
        {
          correlationId,
          error: error.message,
          inputFolder,
          errorCode: error.code,
        }
      );
      // Ensure cleanup of partially created symlink directory if an error occurs early
      if (tempSymlinkDir) {
        await this.cleanupSymlinks(tempSymlinkDir, correlationId);
      }
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

  buildSecureFFmpegArgs(tempSymlinkDir, outputPath, options, imageData) {
    // Build FFmpeg arguments array (NO shell execution, NO string interpolation)
    const args = [];

    // Overwrite output file
    args.push("-y");

    // Input framerate
    args.push("-framerate", "1");

    // Use sequential image pattern
    // FFmpeg will look for files like frame_000.jpg, frame_001.jpg, etc.
    args.push("-i", path.join(tempSymlinkDir, "frame_%03d.jpg"));

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
      inputPath: path.join(tempSymlinkDir, "frame_%03d.jpg"), // Log the actual input path
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
   * Cleans up the temporary directory containing symlinks.
   * @param {string} tempDir - The path to the temporary directory.
   * @param {string} correlationId - The correlation ID for logging.
   */
  async cleanupSymlinks(tempDir, correlationId) {
    Logger.info(
      "VideoController",
      "Initiating cleanup of temporary symlink directory",
      {
        correlationId,
        tempDir,
      }
    );
    try {
      // Check if the directory exists before attempting to remove it
      await fs.access(tempDir);
      await fs.rm(tempDir, { recursive: true, force: true });
      Logger.info("VideoController", "Temporary symlink directory cleaned up", {
        correlationId,
        tempDir,
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        Logger.warn(
          "VideoController",
          "Temporary symlink directory not found during cleanup, skipping",
          {
            correlationId,
            tempDir,
          }
        );
      } else {
        Logger.error(
          "VideoController",
          "Error cleaning up temporary symlink directory",
          {
            correlationId,
            tempDir,
            error: error.message,
          }
        );
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
