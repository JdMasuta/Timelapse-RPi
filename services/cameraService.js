// services/cameraService.js - Updated with VideoController integration

const fs = require("fs").promises;
const path = require("path");
const AdmZip = require("adm-zip");

// Import our modular components
const Logger = require("./camera/Logger");
const OperationQueue = require("./camera/OperationQueue");
const StreamController = require("./camera/StreamController");
const TimelapseController = require("./camera/TimelapseController");
const CaptureController = require("./camera/CaptureController");
const VideoController = require("./video/VideoController"); // 🆕 Import VideoController
const OperationContext = require("./camera/OperationContext");
const {
  OPERATION_PRIORITIES,
  DEFAULT_PATHS,
  VIDEO_CONFIG,
} = require("./camera/constants");

class CameraService {
  constructor() {
    // Initialize output directory
    this.outputDir =
      process.env.OUTPUT_DIR || path.join(__dirname, "..", "captures");

    // Initialize controllers
    this.streamController = new StreamController();
    this.captureController = new CaptureController(this.outputDir);
    this.timelapseController = new TimelapseController(this.captureController);
    this.operationQueue = new OperationQueue();

    // 🆕 Initialize VideoController (separate from main operation queue)
    this.videoController = new VideoController();

    // Bind context for callbacks
    this.continueNextOperation = this.continueNextOperation.bind(this);

    Logger.info("constructor", "CameraService initialized", {
      outputDir: this.outputDir,
      videosDir: DEFAULT_PATHS.videosDir,
      platform: process.platform,
    });

    this.ensureOutputDir();
  }

  async ensureOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      Logger.info("ensureOutputDir", "Output directory ensured", {
        path: this.outputDir,
      });
    } catch (error) {
      Logger.error("ensureOutputDir", "Failed to create output directory", {
        error: error.message,
      });
    }
  }

  // ============================================================================
  // EXISTING CAMERA OPERATION QUEUE METHODS (UNCHANGED)
  // ============================================================================

  async queueOperation(type, config, callbacks = {}, priority) {
    Logger.info("queueOperation", "Operation queuing requested", {
      type,
      priority,
      currentOperation: this.operationQueue.getCurrentOperation()?.type || null,
      currentOperationPriority:
        this.operationQueue.getCurrentOperation()?.priority || null,
      queueLength: this.operationQueue.length,
      streamActive: this.streamController.isActive(),
      isCapturing: this.timelapseController.isRunning(),
    });

    // Prevent duplicate stream operations
    if (
      type === "stream" &&
      this.operationQueue.getCurrentOperation()?.type === "stream"
    ) {
      Logger.warn(
        "queueOperation",
        "Stream operation already running, ignoring duplicate request"
      );
      callbacks.onNotification?.(
        "already-running",
        "Stream operation already in progress"
      );
      return;
    }

    const operation = new OperationContext(type, config, callbacks, priority);

    if (!this.operationQueue.hasCurrentOperation()) {
      Logger.info(
        "queueOperation",
        "No current operation, starting immediately",
        {
          type,
        }
      );
      await this.startOperation(operation);
      return;
    }

    if (this.operationQueue.shouldTakePriority(operation)) {
      Logger.info(
        "queueOperation",
        "Higher priority operation, pausing current",
        {
          newType: type,
          newPriority: priority,
          currentType: this.operationQueue.getCurrentOperation().type,
          currentPriority: this.operationQueue.getCurrentOperation().priority,
        }
      );

      const pausedOp = await this.pauseCurrentOperation();
      if (pausedOp) {
        this.operationQueue.enqueue(pausedOp);
      }
      await this.startOperation(operation);
    } else {
      Logger.info(
        "queueOperation",
        "Lower priority operation, adding to queue",
        {
          type,
          priority,
          queueLength: this.operationQueue.length + 1,
        }
      );
      this.operationQueue.enqueue(operation);
      callbacks.onNotification?.(
        "queued",
        `Operation queued (priority ${priority})`
      );
    }
  }

  async startOperation(operation) {
    Logger.info("startOperation", "Starting operation", operation.getSummary());

    if (!operation || !operation.isValid()) {
      Logger.error("startOperation", "Invalid operation passed", { operation });
      return;
    }

    this.operationQueue.setCurrentOperation(operation);

    try {
      switch (operation.type) {
        case "stream":
          Logger.info("startOperation", "Starting stream operation");
          await this._doStartStream(operation);
          break;
        case "timelapse":
          Logger.info("startOperation", "Starting timelapse operation");
          await this._doStartTimelapse(operation);
          break;
        case "capture":
          Logger.info("startOperation", "Starting capture operation");
          await this._doCaptureImage(operation);
          break;
        default:
          Logger.error("startOperation", "Unknown operation type", {
            type: operation.type,
          });
          this.operationQueue.setCurrentOperation(null);
          await this.continueNextOperation();
      }
    } catch (error) {
      Logger.error("startOperation", "Error starting operation", {
        type: operation.type,
        error: error.message,
      });
      this.operationQueue.setCurrentOperation(null);
      await this.continueNextOperation();
    }
  }

  async pauseCurrentOperation() {
    const op = this.operationQueue.getCurrentOperation();
    if (!op) {
      Logger.debug("pauseCurrentOperation", "No current operation to pause");
      return null;
    }

    Logger.info(
      "pauseCurrentOperation",
      "Pausing current operation",
      op.getSummary()
    );

    try {
      switch (op.type) {
        case "stream":
          op.progress.wasActive = this.streamController.isActive();
          op.progress.streamConfig = this.streamController.getCurrentConfig();
          if (op.progress.wasActive) {
            Logger.info("pauseCurrentOperation", "Stopping active stream");
            this.streamController.stop();
          }
          break;
        case "timelapse":
          op.progress.imageCount = this.timelapseController.imageCount;
          op.progress.sessionStartTime =
            this.timelapseController.sessionStartTime;
          Logger.info("pauseCurrentOperation", "Stopping timelapse", {
            imageCount: this.timelapseController.imageCount,
          });
          this.timelapseController.stop();
          break;
      }

      const pausedOp = this.operationQueue.pauseCurrentOperation();
      pausedOp?.notify("paused", `${pausedOp.type} paused`);
      return pausedOp;
    } catch (error) {
      Logger.error("pauseCurrentOperation", "Error pausing operation", {
        type: op.type,
        error: error.message,
      });
      this.operationQueue.setCurrentOperation(null);
      return null;
    }
  }

  async resumeOperation(op) {
    Logger.info("resumeOperation", "Resuming operation", {
      type: op?.type,
      state: op?.state,
      timestamp: op?.timestamp,
      hasProgress: !!op?.progress,
      wasActive: op?.progress?.wasActive,
      hasStreamConfig: !!op?.progress?.streamConfig,
    });

    if (!op || !op.isValid()) {
      Logger.error("resumeOperation", "Invalid operation passed", { op });
      return;
    }

    try {
      this.operationQueue.setCurrentOperation(op);

      switch (op.type) {
        case "stream":
          Logger.info(
            "resumeOperation",
            "Resuming stream operation - calling _doStartStream"
          );
          await this._doStartStream(op);
          break;
        case "timelapse":
          this.timelapseController.imageCount = op.progress.imageCount || 0;
          this.timelapseController.sessionStartTime =
            op.progress.sessionStartTime || Date.now();
          Logger.info("resumeOperation", "Resuming timelapse operation", {
            imageCount: this.timelapseController.imageCount,
          });
          await this._doStartTimelapse(op);
          break;
      }

      op.notify("resumed", `${op.type} resumed`);
    } catch (error) {
      Logger.error("resumeOperation", "Error resuming operation", {
        type: op.type,
        error: error.message,
      });
      this.operationQueue.setCurrentOperation(null);
      await this.continueNextOperation();
    }
  }

  async continueNextOperation() {
    Logger.debug("continueNextOperation", "Checking for next operation", {
      hasCurrentOperation: this.operationQueue.hasCurrentOperation(),
      queueLength: this.operationQueue.length,
    });

    try {
      if (
        !this.operationQueue.hasCurrentOperation() &&
        this.operationQueue.length > 0
      ) {
        const nextOp = this.operationQueue.dequeue();

        if (nextOp && nextOp.isValid()) {
          await this.resumeOperation(nextOp);
        } else {
          Logger.error("continueNextOperation", "Invalid operation dequeued", {
            nextOp,
          });
          if (this.operationQueue.length > 0) {
            await this.continueNextOperation();
          }
        }
      }
    } catch (error) {
      Logger.error("continueNextOperation", "Error in queue processing", {
        error: error.message,
      });
      this.operationQueue.setCurrentOperation(null);
    }
  }

  // ============================================================================
  // EXISTING CAMERA API METHODS (UNCHANGED)
  // ============================================================================

  async captureImage(config, notifyCallback = null) {
    Logger.info("captureImage", "Image capture requested", { config });
    await this.queueOperation(
      "capture",
      config,
      { onNotification: notifyCallback },
      OPERATION_PRIORITIES.USER_CAPTURE
    );
  }

  async startTimelapse(
    config,
    onImageCaptured,
    onError,
    onStreamNotification = null
  ) {
    Logger.info("startTimelapse", "Timelapse start requested", { config });
    await this.queueOperation(
      "timelapse",
      config,
      { onImageCaptured, onError, onNotification: onStreamNotification },
      OPERATION_PRIORITIES.TIMELAPSE
    );
  }

  async startStream(config, onNotification = null) {
    Logger.info("startStream", "Stream start requested", {
      config,
      isCurrentlyActive: this.streamController.isActive(),
      currentOperation: this.operationQueue.getCurrentOperation()?.type,
      queueLength: this.operationQueue.length,
    });
    await this.queueOperation(
      "stream",
      config,
      { onNotification },
      OPERATION_PRIORITIES.STREAM
    );
  }

  async stopStream() {
    Logger.info("stopStream", "Stream stop requested", {
      isCurrentlyActive: this.streamController.isActive(),
      currentOperation: this.operationQueue.getCurrentOperation()?.type,
    });

    const stopped = this.streamController.stop();

    if (
      stopped &&
      this.operationQueue.getCurrentOperation()?.type === "stream"
    ) {
      this.operationQueue.setCurrentOperation(null);
      Logger.info("stopStream", "Cleared current stream operation");
      await this.continueNextOperation();
    }

    return stopped;
  }

  stopTimelapse() {
    Logger.info("stopTimelapse", "Timelapse stop requested");
    const stopped = this.timelapseController.stop();

    if (stopped) {
      this.operationQueue.setCurrentOperation(null);
      setTimeout(() => {
        this.continueNextOperation().catch((error) => {
          Logger.error(
            "stopTimelapse",
            "Error continuing operations after stop",
            { error: error.message }
          );
        });
      }, 100);
    }

    return stopped;
  }

  // ============================================================================
  // 🆕 VIDEO GENERATION METHODS FOR SOCKET.IO ARCHITECTURE
  // ============================================================================

  /**
   * Generate video from captured timelapse images
   * Compatible with existing Socket.IO architecture
   *
   * @param {object} config - Configuration object from frontend
   * @param {function} onProgress - Progress callback for real-time updates
   * @returns {Promise<object>} Video generation result
   */
  async generateVideo(config, onProgress = null) {
    const startTime = Date.now();

    Logger.info("generateVideo", "Video generation requested via Socket.IO", {
      config: {
        videoFps: config.videoFps,
        videoQuality: config.videoQuality,
        videoCodec: config.videoCodec,
        videoBitrate: config.videoBitrate,
        hasProgressCallback: !!onProgress,
      },
    });

    try {
      // Check if video generation is available
      const availability = await this.checkVideoGenerationAvailable();
      if (!availability.available) {
        throw new Error(availability.message);
      }

      // Map frontend config to VideoController options
      const videoOptions = this.mapConfigToVideoOptions(config, onProgress);

      Logger.info("generateVideo", "Starting video generation", {
        inputFolder: this.outputDir,
        imageCount: availability.imageCount,
        options: videoOptions,
      });

      // Generate the video using our production VideoController
      const result = await this.videoController.createVideo(
        this.outputDir,
        videoOptions
      );

      const duration = Date.now() - startTime;

      Logger.info("generateVideo", "Video generation completed successfully", {
        filename: result.filename,
        size: result.size,
        processingTime: duration,
        sourceImages: availability.imageCount,
      });

      // Return result in format expected by Socket.IO handlers
      return {
        filename: result.filename,
        filepath: result.outputPath,
        size: result.size,
        duration: result.durationSeconds,
        frameCount: result.frameCount,
        processingTime: duration,
        downloadUrl: `/videos/${result.filename}`,
        metadata: {
          fps: result.fps,
          codec: result.codec,
          quality: result.quality,
          sourceImages: availability.imageCount,
          createdAt: result.createdAt,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      Logger.error("generateVideo", "Video generation failed", {
        error: error.message,
        errorCode: error.code,
        duration,
        config,
      });

      // Re-throw with enhanced error information for Socket.IO handlers
      const enhancedError = new Error(error.message);
      enhancedError.code = error.code || "VIDEO_GENERATION_ERROR";
      enhancedError.processingTime = duration;
      enhancedError.phase = this.determineErrorPhase(error);

      throw enhancedError;
    }
  }

  /**
   * Map frontend configuration to VideoController options
   * @private
   */
  mapConfigToVideoOptions(config, onProgress) {
    // Set defaults from VIDEO_CONFIG constants
    const fps = parseInt(config.videoFps) || VIDEO_CONFIG.defaultFps;
    const quality = this.mapQualityFromConfig(config.videoQuality);
    const codec = this.mapCodecFromConfig(config.videoCodec);

    // Handle bitrate conversion (frontend sends "5M", we need 5000)
    let bitrate = null;
    if (config.videoBitrate) {
      bitrate = config.videoBitrate.toString();
    } else if (process.env.VIDEO_BITRATE) {
      bitrate = process.env.VIDEO_BITRATE;
    }

    const options = {
      fps,
      quality,
      codec,
      bitrate,

      // Wrap progress callback for Socket.IO format
      onProgress: onProgress
        ? (progress, frame, total) => {
            try {
              // Call the Socket.IO progress callback with just the percentage
              onProgress(Math.round(progress));
            } catch (error) {
              Logger.warn("generateVideo", "Progress callback error", {
                error: error.message,
              });
            }
          }
        : null,

      // Enhanced completion callback
      onComplete: (result) => {
        Logger.info("generateVideo", "Video generation completed callback", {
          filename: result.filename,
          size: result.size,
        });
      },

      // Enhanced error callback
      onError: (error) => {
        Logger.error("generateVideo", "Video generation error callback", {
          error: error.message,
          errorCode: error.code,
        });
      },
    };

    // Validate options
    this.validateVideoOptions(options);

    return options;
  }

  /**
   * Map frontend quality setting to VideoController quality
   * @private
   */
  mapQualityFromConfig(frontendQuality) {
    const qualityMap = {
      low: "low",
      medium: "medium",
      high: "high",
      ultra: "high", // Map ultra to high since VideoController only has 3 levels
    };

    return qualityMap[frontendQuality] || "medium";
  }

  /**
   * Map frontend codec setting to VideoController codec
   * @private
   */
  mapCodecFromConfig(frontendCodec) {
    const codecMap = {
      h264: "h264",
      h265: "h265",
      vp9: "h264", // Fallback VP9 to H264 since VideoController doesn't support VP9 yet
    };

    return codecMap[frontendCodec] || "h264";
  }

  /**
   * Validate video generation options
   * @private
   */
  validateVideoOptions(options) {
    if (options.fps < 1 || options.fps > 120) {
      throw new Error(
        `Invalid frame rate: ${options.fps}. Must be between 1 and 120 FPS.`
      );
    }

    if (!["low", "medium", "high"].includes(options.quality)) {
      throw new Error(
        `Invalid quality: ${options.quality}. Must be low, medium, or high.`
      );
    }

    if (!["h264", "h265"].includes(options.codec)) {
      throw new Error(`Invalid codec: ${options.codec}. Must be h264 or h265.`);
    }

    if (options.bitrate && (options.bitrate < 100 || options.bitrate > 50000)) {
      throw new Error(
        `Invalid bitrate: ${options.bitrate}. Must be between 100 and 50000 kbps.`
      );
    }
  }

  /**
   * Check if video generation is possible
   * @returns {Promise<object>} Availability status
   */
  async checkVideoGenerationAvailable() {
    try {
      // Check if VideoController is processing
      const videoStatus = this.videoController.getStatus();
      if (videoStatus.isProcessing) {
        return {
          available: false,
          imageCount: 0,
          message: "Video generation already in progress",
        };
      }

      // Check for available images
      const files = await fs.readdir(this.outputDir);
      const imageFiles = files.filter(
        (file) =>
          file.toLowerCase().endsWith(".jpg") ||
          file.toLowerCase().endsWith(".jpeg")
      );

      if (imageFiles.length === 0) {
        return {
          available: false,
          imageCount: 0,
          message:
            "No images found. Please capture some timelapse images first.",
        };
      }

      // Check for valid timelapse images
      const validImages = imageFiles.filter((file) => {
        return file.match(
          /timelapse_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.(jpg|jpeg)$/i
        );
      });

      if (validImages.length < 2) {
        return {
          available: false,
          imageCount: imageFiles.length,
          message:
            "At least 2 timelapse images are required for video generation.",
        };
      }

      return {
        available: true,
        imageCount: validImages.length,
        message: `Ready to generate video from ${validImages.length} images`,
      };
    } catch (error) {
      Logger.error(
        "checkVideoGenerationAvailable",
        "Error checking availability",
        {
          error: error.message,
        }
      );

      return {
        available: false,
        imageCount: 0,
        message: `Error checking images: ${error.message}`,
      };
    }
  }

  /**
   * Cancel ongoing video generation
   * @returns {Promise<boolean>} Success status
   */
  async cancelVideoGeneration() {
    Logger.info(
      "cancelVideoGeneration",
      "Video cancellation requested via Socket.IO"
    );

    try {
      const cancelled = await this.videoController.cancelVideoCreation();

      if (cancelled) {
        Logger.info(
          "cancelVideoGeneration",
          "Video generation cancelled successfully"
        );
      } else {
        Logger.warn(
          "cancelVideoGeneration",
          "No video generation in progress to cancel"
        );
      }

      return cancelled;
    } catch (error) {
      Logger.error(
        "cancelVideoGeneration",
        "Error cancelling video generation",
        {
          error: error.message,
        }
      );
      return false;
    }
  }

  /**
   * Get video processing status for Socket.IO
   * @returns {object} Video processing status
   */
  getVideoProcessingStatus() {
    const status = this.videoController.getStatus();

    return {
      isProcessing: status.isProcessing,
      hasCurrentJob: !!status.currentJob,
      currentJob: status.currentJob
        ? {
            startTime: status.currentJob.startTime,
            duration: Date.now() - status.currentJob.startTime,
          }
        : null,
      metrics: status.metrics,
    };
  }

  /**
   * Get list of generated videos (enhanced for Socket.IO)
   * @returns {Promise<Array>} List of videos with enhanced metadata
   */
  async getVideoList() {
    try {
      const videos = await this.videoController.listVideos();

      // Enhance video list with download URLs and formatted data
      return videos.map((video) => ({
        ...video,
        downloadUrl: `/videos/${video.filename}`,
        sizeFormatted: this.formatFileSize(video.size),
        createdFormatted: new Date(video.created).toLocaleString(),
      }));
    } catch (error) {
      Logger.error("getVideoList", "Error getting video list", {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Delete a video file
   * @param {string} filename - Video filename to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteVideo(filename) {
    Logger.info("deleteVideo", "Video deletion requested via Socket.IO", {
      filename,
    });

    try {
      const deleted = await this.videoController.deleteVideo(filename);

      if (deleted) {
        Logger.info("deleteVideo", "Video deleted successfully", { filename });
      } else {
        Logger.warn("deleteVideo", "Video not found or could not be deleted", {
          filename,
        });
      }

      return deleted;
    } catch (error) {
      Logger.error("deleteVideo", "Error deleting video", {
        filename,
        error: error.message,
      });
      return false;
    }
  }

  // ============================================================================
  // 🆕 UTILITY METHODS FOR SOCKET.IO INTEGRATION
  // ============================================================================

  /**
   * Format file size in human-readable format
   * @private
   */
  formatFileSize(bytes) {
    const sizes = ["Bytes", "KB", "MB", "GB"];
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  }

  /**
   * Determine error phase for better error reporting
   * @private
   */
  determineErrorPhase(error) {
    if (error.name === "ValidationError") return "validation";
    if (error.name === "SecurityError") return "security_check";
    if (error.name === "ResourceError") return "resource_check";
    if (error.name === "ProcessError") return "video_encoding";
    if (error.message.includes("images") || error.message.includes("scan"))
      return "image_analysis";
    if (error.message.includes("ffmpeg")) return "video_encoding";
    return "unknown";
  }

  // ============================================================================
  // OPERATION IMPLEMENTATIONS (UNCHANGED)
  // ============================================================================

  async _doStartStream(op) {
    Logger.info("_doStartStream", "Queue-managed stream operation starting");
    await this.streamController.start(op.config, op.callbacks.onNotification);

    Logger.info(
      "_doStartStream",
      "Stream started successfully, marking operation complete"
    );
    this.operationQueue.setCurrentOperation(null);
    await this.continueNextOperation();
  }

  async _doCaptureImage(op) {
    Logger.info("_doCaptureImage", "Image capture operation starting");

    try {
      const result = await this.captureController.captureWithStreamPause(
        op.config,
        this.streamController,
        op.callbacks.onNotification
      );

      Logger.info("_doCaptureImage", "Image captured successfully", {
        filename: result.filename,
      });
    } catch (error) {
      Logger.error("_doCaptureImage", "Error capturing image", {
        error: error.message,
      });
      throw error;
    } finally {
      this.operationQueue.setCurrentOperation(null);
      await this.continueNextOperation();
    }
  }

  async _doStartTimelapse(op) {
    Logger.info("_doStartTimelapse", "Timelapse operation starting");
    await this.timelapseController.start(op, this.streamController);
  }

  // ============================================================================
  // UTILITY AND STATUS METHODS (UPDATED)
  // ============================================================================

  isStreamActive() {
    return this.streamController.isActive();
  }

  getStatus() {
    const timelapseStatus = this.timelapseController.getStatus();
    const streamStatus = this.streamController.getStatus();
    const queueStatus = this.operationQueue.getStatus();
    const videoStatus = this.getVideoProcessingStatus(); // Use our enhanced method

    const status = {
      isCapturing: timelapseStatus.isCapturing,
      imageCount: timelapseStatus.imageCount,
      sessionTime: timelapseStatus.sessionTime,
      isStreamActive: streamStatus.isActive,
      currentOperation: queueStatus.currentOperation?.type || null,
      queueLength: queueStatus.queueLength,
      streamPid: streamStatus.pid,
      // Enhanced video status for Socket.IO
      videoProcessing: videoStatus,
    };

    //Logger.debug("getStatus", "Status requested with video info", status);
    return status;
  }

  async getImageList() {
    try {
      const files = await fs.readdir(this.outputDir);
      const images = files.filter(
        (f) => f.endsWith(".jpg") || f.endsWith(".jpeg")
      );
      const list = await Promise.all(
        images.map(async (file) => {
          const stat = await fs.stat(path.join(this.outputDir, file));
          return {
            filename: file,
            filepath: path.join(this.outputDir, file),
            size: stat.size,
            created: stat.birthtime,
          };
        })
      );
      const sortedList = list.sort((a, b) => b.created - a.created);
      Logger.debug("getImageList", "Image list retrieved", {
        count: sortedList.length,
      });
      return sortedList;
    } catch (err) {
      Logger.error("getImageList", "Failed to list images", {
        error: err.message,
      });
      return [];
    }
  }

  // Complete createImageZip method:
  async createImageZip() {
    try {
      Logger.info("createImageZip", "Starting image zip creation");

      // Ensure temp directory exists
      const tempDir = path.join(this.outputDir, "temp");
      await fs.mkdir(tempDir, { recursive: true });

      const zipFilePath = path.join(tempDir, "images.zip");

      // Create new zip instance
      const zip = new AdmZip();

      // Read all files from output directory
      const files = await fs.readdir(this.outputDir);

      // Filter for image files only
      const imageFiles = files.filter((file) => {
        const ext = path.extname(file).toLowerCase();
        return (
          ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".bmp"
        );
      });

      if (imageFiles.length === 0) {
        throw new Error("No image files found to zip");
      }

      Logger.info("createImageZip", "Adding images to zip", {
        imageCount: imageFiles.length,
        outputDir: this.outputDir,
      });

      // Add each image file to the zip
      for (const imageFile of imageFiles) {
        const imagePath = path.join(this.outputDir, imageFile);

        try {
          // Read file and add to zip
          const fileData = await fs.readFile(imagePath);
          zip.addFile(imageFile, fileData);

          Logger.debug("createImageZip", `Added file to zip: ${imageFile}`);
        } catch (fileError) {
          Logger.warn(
            "createImageZip",
            `Failed to add file to zip: ${imageFile}`,
            {
              error: fileError.message,
            }
          );
          // Continue with other files even if one fails
        }
      }

      // Write the zip file
      await new Promise((resolve, reject) => {
        zip.writeZip(zipFilePath, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      // Verify the zip file was created and get its size
      const zipStats = await fs.stat(zipFilePath);

      Logger.info("createImageZip", "Image zip created successfully", {
        zipPath: zipFilePath,
        fileCount: imageFiles.length,
        zipSize: zipStats.size,
        zipSizeFormatted: this.formatFileSize(zipStats.size),
      });

      return {
        zipFilePath,
        imageCount: imageFiles.length,
        zipSize: zipStats.size,
        zipSizeFormatted: this.formatFileSize(zipStats.size),
      };
    } catch (err) {
      Logger.error("createImageZip", "Failed to create image zip", {
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }
  }

  // Helper method to format file sizes (add this if not already present):
  formatFileSize(bytes) {
    const sizes = ["Bytes", "KB", "MB", "GB"];
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  }

  async clearImages() {
    try {
      const files = await fs.readdir(this.outputDir);
      const targets = files.filter(
        (f) => f.endsWith(".jpg") || f.endsWith(".jpeg")
      );
      await Promise.all(
        targets.map((file) => fs.unlink(path.join(this.outputDir, file)))
      );
      this.timelapseController.imageCount = 0;
      Logger.info("clearImages", "Images cleared successfully", {
        count: targets.length,
      });
      return targets.length;
    } catch (err) {
      Logger.error("clearImages", "Failed to clear images", {
        error: err.message,
      });
      throw err;
    }
  }

  cleanup() {
    Logger.info("cleanup", "Cleanup requested");
    try {
      this.timelapseController.cleanup();
      this.streamController.cleanup();
      this.operationQueue.clear();
      // 🆕 Clean up video controller
      this.videoController.cleanup();
      Logger.info("cleanup", "Cleanup completed successfully");
    } catch (error) {
      Logger.error("cleanup", "Error during cleanup", { error: error.message });
    }
  }
}

module.exports = CameraService;
