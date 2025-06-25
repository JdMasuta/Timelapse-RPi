// services/cameraService.js - Main orchestrator (much cleaner!)

const fs = require("fs").promises;
const path = require("path");

// Import our modular components
const Logger = require("./camera/Logger");
const OperationQueue = require("./camera/OperationQueue");
const StreamController = require("./camera/StreamController");
const TimelapseController = require("./camera/TimelapseController");
const CaptureController = require("./camera/CaptureController");
const OperationContext = require("./camera/OperationContext");
const { OPERATION_PRIORITIES, DEFAULT_PATHS } = require("./camera/constants");

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

    // Bind context for callbacks
    this.continueNextOperation = this.continueNextOperation.bind(this);

    Logger.info("constructor", "CameraService initialized", {
      outputDir: this.outputDir,
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
  // QUEUE MANAGEMENT METHODS
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
        { type }
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
  // PUBLIC API METHODS
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
  // OPERATION IMPLEMENTATIONS
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
  // UTILITY AND STATUS METHODS
  // ============================================================================

  isStreamActive() {
    return this.streamController.isActive();
  }

  getStatus() {
    const timelapseStatus = this.timelapseController.getStatus();
    const streamStatus = this.streamController.getStatus();
    const queueStatus = this.operationQueue.getStatus();

    const status = {
      isCapturing: timelapseStatus.isCapturing,
      imageCount: timelapseStatus.imageCount,
      sessionTime: timelapseStatus.sessionTime,
      isStreamActive: streamStatus.isActive,
      currentOperation: queueStatus.currentOperation?.type || null,
      queueLength: queueStatus.queueLength,
      streamPid: streamStatus.pid,
    };

    Logger.debug("getStatus", "Status requested", status);
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
      Logger.info("cleanup", "Cleanup completed successfully");
    } catch (error) {
      Logger.error("cleanup", "Error during cleanup", { error: error.message });
    }
  }
}

module.exports = CameraService;
