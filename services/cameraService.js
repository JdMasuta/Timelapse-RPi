// Enhanced cameraService.js with comprehensive logging - Ready for RPi deployment
const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
const path = require("path");
const PriorityQueue = require("js-priority-queue");

const execAsync = promisify(exec);

const OPERATION_PRIORITIES = {
  EMERGENCY_CAPTURE: 100,
  USER_CAPTURE: 80,
  TIMELAPSE: 60,
  STREAM: 20,
};

// Enhanced logging utility
class Logger {
  static log(level, method, message, context = {}) {
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      level,
      method,
      message,
      ...context,
    };

    const logLine = `[${timestamp}] ${level.toUpperCase()} [CameraService.${method}] ${message}`;
    if (Object.keys(context).length > 0) {
      console.log(logLine, JSON.stringify(context, null, 2));
    } else {
      console.log(logLine);
    }
  }

  static info(method, message, context = {}) {
    this.log("info", method, message, context);
  }

  static error(method, message, context = {}) {
    this.log("error", method, message, context);
  }

  static debug(method, message, context = {}) {
    this.log("debug", method, message, context);
  }

  static warn(method, message, context = {}) {
    this.log("warn", method, message, context);
  }
}

class OperationContext {
  constructor(type, config, callbacks = {}, priority) {
    this.type = type;
    this.config = config;
    this.callbacks = callbacks;
    this.priority = priority;
    this.state = "queued";
    this.progress = {};
    this.timestamp = Date.now();
  }
}

class CameraService {
  constructor() {
    this.streamProcess = null;
    this.captureProcess = null;
    this.isCapturing = false;
    this.captureInterval = null;
    this.imageCount = 0;
    this.sessionStartTime = null;
    this.streamWasActive = false;
    this.outputDir =
      process.env.OUTPUT_DIR || path.join(__dirname, "..", "captures");
    this.mjpegStreamerPath = "/usr/local/bin/mjpg_streamer";
    this.mjpegStreamerWwwPath = "/usr/local/share/mjpg-streamer/www/";
    this.currentStreamConfig = null;

    this.operationQueue = new PriorityQueue({
      comparator: (a, b) => {
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        if (typeof a.priority !== "number" || typeof b.priority !== "number") {
          Logger.error("priorityQueue", "Invalid operation priority", { a, b });
          return 0;
        }
        return b.priority - a.priority;
      },
    });
    this.currentOperation = null;
    this.operationStates = new Map();
    this.continueNextOperation = this.continueNextOperation.bind(this);

    Logger.info("constructor", "CameraService initialized", {
      outputDir: this.outputDir,
      mjpegStreamerPath: this.mjpegStreamerPath,
      mjpegStreamerWwwPath: this.mjpegStreamerWwwPath,
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

  isStreamActive() {
    const active = this.streamProcess !== null;
    Logger.debug("isStreamActive", "Stream status checked", {
      active,
      pid: this.streamProcess?.pid,
    });
    return active;
  }

  getResolutionForQuality(quality) {
    const resolutions = {
      low: "640x480",
      medium: "1280x720",
      high: "1920x1080",
    };
    const resolution = resolutions[quality] || resolutions.medium;
    Logger.debug("getResolutionForQuality", "Resolution determined", {
      quality,
      resolution,
    });
    return resolution;
  }

  // ============================================================================
  // QUEUE MANAGEMENT METHODS (High-level operation scheduling)
  // ============================================================================

  async queueOperation(type, config, callbacks = {}, priority) {
    Logger.info("queueOperation", "Operation queuing requested", {
      type,
      priority,
      currentOperation: this.currentOperation?.type || null,
      currentOperationPriority: this.currentOperation?.priority || null,
      queueLength: this.operationQueue.length,
      streamActive: this.isStreamActive(),
      isCapturing: this.isCapturing,
    });

    // Validate operation before queuing
    if (!type || typeof priority !== "number") {
      Logger.error("queueOperation", "Invalid operation parameters", {
        type,
        priority,
      });
      return;
    }

    const operation = new OperationContext(type, config, callbacks, priority);

    if (!this.currentOperation) {
      Logger.info(
        "queueOperation",
        "No current operation, starting immediately",
        { type }
      );
      await this.startOperation(operation);
      return;
    }

    if (priority > this.currentOperation.priority) {
      Logger.info(
        "queueOperation",
        "Higher priority operation, pausing current",
        {
          newType: type,
          newPriority: priority,
          currentType: this.currentOperation.type,
          currentPriority: this.currentOperation.priority,
        }
      );
      await this.pauseCurrentOperation();
      this.operationQueue.queue(this.currentOperation);
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
      this.operationQueue.queue(operation);
      callbacks.onNotification?.(
        "queued",
        `Operation queued (priority ${priority})`
      );
    }
  }

  async startOperation(operation) {
    Logger.info("startOperation", "Starting operation", {
      type: operation?.type,
      priority: operation?.priority,
      state: operation?.state,
      timestamp: operation?.timestamp,
    });

    // Validate operation before starting
    if (!operation || !operation.type) {
      Logger.error("startOperation", "Invalid operation passed", { operation });
      return;
    }

    this.currentOperation = operation;
    operation.state = "running";

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
          this.currentOperation = null;
          await this.continueNextOperation();
      }
    } catch (error) {
      Logger.error("startOperation", "Error starting operation", {
        type: operation.type,
        error: error.message,
        stack: error.stack,
      });
      this.currentOperation = null;
      await this.continueNextOperation();
    }
  }

  async pauseCurrentOperation() {
    const op = this.currentOperation;
    if (!op) {
      Logger.debug("pauseCurrentOperation", "No current operation to pause");
      return;
    }

    Logger.info("pauseCurrentOperation", "Pausing current operation", {
      type: op.type,
      state: op.state,
      timestamp: op.timestamp,
    });
    op.state = "paused";

    try {
      switch (op.type) {
        case "stream":
          op.progress.wasActive = this.isStreamActive();
          if (op.progress.wasActive) {
            Logger.info("pauseCurrentOperation", "Stopping active stream");
            this._directStopStream();
          }
          break;
        case "timelapse":
          op.progress.imageCount = this.imageCount;
          op.progress.sessionStartTime = this.sessionStartTime;
          Logger.info("pauseCurrentOperation", "Stopping timelapse", {
            imageCount: this.imageCount,
          });
          this.stopTimelapse();
          break;
      }

      this.operationStates.set(op.timestamp, op);
      op.callbacks.onNotification?.("paused", `${op.type} paused`);
    } catch (error) {
      Logger.error("pauseCurrentOperation", "Error pausing operation", {
        type: op.type,
        error: error.message,
      });
    }

    this.currentOperation = null;
  }

  async resumeOperation(op) {
    Logger.info("resumeOperation", "Resuming operation", {
      type: op?.type,
      state: op?.state,
      timestamp: op?.timestamp,
    });

    // Validate operation before resuming
    if (!op || !op.type) {
      Logger.error("resumeOperation", "Invalid operation passed", { op });
      return;
    }

    try {
      op.state = "running";
      this.currentOperation = op;

      switch (op.type) {
        case "stream":
          if (op.progress.wasActive) {
            Logger.info("resumeOperation", "Resuming stream operation");
            await this._doStartStream(op);
          }
          break;
        case "timelapse":
          this.imageCount = op.progress.imageCount || 0;
          this.sessionStartTime = op.progress.sessionStartTime || Date.now();
          Logger.info("resumeOperation", "Resuming timelapse operation", {
            imageCount: this.imageCount,
          });
          await this._doStartTimelapse(op);
          break;
      }

      op.callbacks.onNotification?.("resumed", `${op.type} resumed`);
    } catch (error) {
      Logger.error("resumeOperation", "Error resuming operation", {
        type: op.type,
        error: error.message,
      });
      this.currentOperation = null;
      await this.continueNextOperation();
    }
  }

  async continueNextOperation() {
    Logger.debug("continueNextOperation", "Checking for next operation", {
      hasCurrentOperation: !!this.currentOperation,
      queueLength: this.operationQueue.length,
    });

    try {
      if (!this.currentOperation && this.operationQueue.length > 0) {
        const nextOp = this.operationQueue.dequeue();

        Logger.info("continueNextOperation", "Dequeued next operation", {
          type: nextOp?.type,
          priority: nextOp?.priority,
          timestamp: nextOp?.timestamp,
        });

        // Validate dequeued operation
        if (nextOp && nextOp.type) {
          await this.resumeOperation(nextOp);
        } else {
          Logger.error("continueNextOperation", "Invalid operation dequeued", {
            nextOp,
          });
          // Try to continue with the next operation if available
          if (this.operationQueue.length > 0) {
            await this.continueNextOperation();
          }
        }
      }
    } catch (error) {
      Logger.error("continueNextOperation", "Error in queue processing", {
        error: error.message,
      });
      // Reset state to prevent deadlock
      this.currentOperation = null;
    }
  }

  // ============================================================================
  // PUBLIC API METHODS (Queue-based operation requests)
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
      isCurrentlyActive: this.isStreamActive(),
      currentOperation: this.currentOperation?.type,
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
      isCurrentlyActive: this.isStreamActive(),
      currentOperation: this.currentOperation?.type,
    });

    if (this.streamProcess) {
      this.streamProcess.kill("SIGKILL");
      this.streamProcess = null;
      Logger.info("stopStream", "Stream process terminated");
    }
    return true;
  }

  // ============================================================================
  // PRIVATE DIRECT STREAM CONTROL (Low-level resource management)
  // ============================================================================

  async _directStartStream(config, onNotification = null) {
    Logger.info("_directStartStream", "Direct stream start called", {
      hasExistingProcess: !!this.streamProcess,
      existingPid: this.streamProcess?.pid,
      config,
    });

    // Only check for existing process, not isCapturing (this was the bug!)
    if (this.streamProcess) {
      Logger.warn(
        "_directStartStream",
        "Stream process already exists, skipping",
        {
          pid: this.streamProcess.pid,
        }
      );
      return;
    }

    try {
      this.currentStreamConfig = { ...config };
      const resolution = this.getResolutionForQuality(config.streamQuality);

      const command = [
        "-i",
        `input_uvc.so -d /dev/video0 -r ${resolution} -f ${config.streamFps}`,
        "-o",
        `output_http.so -w ${this.mjpegStreamerWwwPath} -p 8080`,
      ];

      Logger.info("_directStartStream", "Spawning mjpg_streamer process", {
        path: this.mjpegStreamerPath,
        command,
        resolution,
        fps: config.streamFps,
      });

      this.streamProcess = spawn(this.mjpegStreamerPath, command);

      Logger.info("_directStartStream", "Process spawned", {
        pid: this.streamProcess.pid,
        spawnfile: this.streamProcess.spawnfile,
      });

      let ready = false;
      this.streamProcess.stderr.on("data", (data) => {
        const output = data.toString().trim();
        Logger.debug("_directStartStream", "Stream stderr", { output });

        if (output.includes("o: commands.............: enabled") && !ready) {
          ready = true;
          Logger.info("_directStartStream", "Stream ready signal detected");
          onNotification?.("stream-ready", "Live preview is ready");
        }
      });

      this.streamProcess.stdout.on("data", (data) => {
        const output = data.toString().trim();
        Logger.debug("_directStartStream", "Stream stdout", { output });
      });

      this.streamProcess.on("error", (err) => {
        Logger.error("_directStartStream", "Stream process error", {
          error: err.message,
          code: err.code,
          errno: err.errno,
          syscall: err.syscall,
          path: err.path,
        });
        this.streamProcess = null;
        onNotification?.("stream-error", err.message);
      });

      this.streamProcess.on("close", (code, signal) => {
        Logger.info("_directStartStream", "Stream process closed", {
          code,
          signal,
          pid: this.streamProcess?.pid,
        });
        this.streamProcess = null;
        onNotification?.("stream-stopped", "Live preview stopped");
      });

      this.streamProcess.on("exit", (code, signal) => {
        Logger.info("_directStartStream", "Stream process exited", {
          code,
          signal,
          pid: this.streamProcess?.pid,
        });
      });

      // Set a timeout to check if the process starts successfully
      setTimeout(() => {
        if (this.streamProcess && !ready) {
          Logger.warn(
            "_directStartStream",
            "Stream not ready after 5 seconds",
            {
              pid: this.streamProcess.pid,
              exitCode: this.streamProcess.exitCode,
              killed: this.streamProcess.killed,
            }
          );
        }
      }, 5000);
    } catch (error) {
      Logger.error("_directStartStream", "Error starting stream", {
        error: error.message,
        stack: error.stack,
      });
      this.streamProcess = null;
      onNotification?.("stream-error", error.message);
    }
  }

  _directStopStream() {
    Logger.info("_directStopStream", "Direct stream stop called", {
      hasProcess: !!this.streamProcess,
      pid: this.streamProcess?.pid,
    });

    if (this.streamProcess) {
      try {
        const pid = this.streamProcess.pid;
        this.streamProcess.kill("SIGKILL");
        this.streamProcess = null;
        Logger.info("_directStopStream", "Stream process terminated", { pid });
        return true;
      } catch (error) {
        Logger.error("_directStopStream", "Error stopping stream", {
          error: error.message,
        });
        this.streamProcess = null;
        return false;
      }
    }
    return false;
  }

  // ============================================================================
  // OPERATION IMPLEMENTATIONS (Using direct control methods)
  // ============================================================================

  async _doStartStream(op) {
    Logger.info("_doStartStream", "Queue-managed stream operation starting");
    // Use direct method for queue-managed stream operations
    await this._directStartStream(op.config, op.callbacks.onNotification);
  }

  async _doCaptureImage(op) {
    Logger.info("_doCaptureImage", "Image capture operation starting");
    const config = op.config;
    const resolution = this.getResolutionForQuality(config.imageQuality);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `timelapse_${timestamp}.jpg`;
    const filepath = path.join(this.outputDir, filename);

    const wasStreamActive = this.isStreamActive();
    const streamConfig = wasStreamActive ? this.getCurrentStreamConfig() : null;

    Logger.info("_doCaptureImage", "Capture parameters", {
      resolution,
      filename,
      wasStreamActive,
      hasStreamConfig: !!streamConfig,
    });

    try {
      if (wasStreamActive) {
        op.callbacks.onNotification?.(
          "stream-paused",
          "Live preview paused for image capture..."
        );
        this._directStopStream();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const cmd = `fswebcam -r ${resolution} --no-banner "${filepath}"`;
      Logger.info("_doCaptureImage", "Executing capture command", { cmd });
      await execAsync(cmd);

      Logger.info("_doCaptureImage", "Image captured successfully", {
        filename,
      });
      op.callbacks.onNotification?.("image-captured", filename);
    } catch (error) {
      Logger.error("_doCaptureImage", "Error capturing image", {
        error: error.message,
      });
      op.callbacks.onNotification?.("capture-error", error.message);
      throw error;
    } finally {
      if (wasStreamActive && streamConfig) {
        Logger.info("_doCaptureImage", "Restarting stream after capture");
        await this._directStartStream(
          streamConfig,
          op.callbacks.onNotification
        );
      }
      this.currentOperation = null;
      await this.continueNextOperation();
    }
  }

  async _doStartTimelapse(op) {
    Logger.info("_doStartTimelapse", "Timelapse operation starting", {
      isCurrentlyCapturing: this.isCapturing,
    });

    if (this.isCapturing) {
      Logger.warn("_doStartTimelapse", "Already capturing, skipping");
      return;
    }

    try {
      this.isCapturing = true;
      this.imageCount = 0;
      this.sessionStartTime = Date.now();

      const config = op.config;

      // Store stream state without interfering with queue
      const streamConfig = this.getCurrentStreamConfig();
      const wasStreamActive = this.isStreamActive();

      Logger.info("_doStartTimelapse", "Timelapse configuration", {
        captureInterval: config.captureInterval,
        imageQuality: config.imageQuality,
        wasStreamActive,
        hasStreamConfig: !!streamConfig,
      });

      const loop = async () => {
        if (!this.isCapturing) {
          Logger.info(
            "_doStartTimelapse",
            "Timelapse loop stopping - no longer capturing"
          );
          return;
        }

        try {
          // Pause stream before capture
          if (wasStreamActive && streamConfig) {
            Logger.debug("_doStartTimelapse", "Pausing stream for capture");
            this._directStopStream();
            await new Promise((res) => setTimeout(res, 500));
          }

          const resolution = this.getResolutionForQuality(config.imageQuality);
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const filename = `timelapse_${timestamp}.jpg`;
          const filepath = path.join(this.outputDir, filename);

          const cmd = `fswebcam -r ${resolution} --no-banner "${filepath}"`;
          Logger.debug("_doStartTimelapse", "Capturing timelapse image", {
            cmd,
            imageCount: this.imageCount + 1,
          });
          await execAsync(cmd);

          this.imageCount++;
          Logger.info("_doStartTimelapse", "Timelapse image captured", {
            imageCount: this.imageCount,
            filename,
          });

          op.callbacks.onNotification?.("image-captured", filename);
          op.callbacks.onImageCaptured?.({
            imageCount: this.imageCount,
            sessionTime: this.getSessionTime(),
            filename,
            filepath,
          });
        } catch (err) {
          Logger.error("_doStartTimelapse", "Error in timelapse capture", {
            error: err.message,
          });
          op.callbacks.onError?.(err);
        }

        // Resume stream after capture
        if (this.isCapturing && wasStreamActive && streamConfig) {
          Logger.debug("_doStartTimelapse", "Resuming stream after capture");
          await this._directStartStream(
            streamConfig,
            op.callbacks.onNotification
          );
        }

        if (this.isCapturing) {
          Logger.debug("_doStartTimelapse", "Scheduling next capture", {
            intervalSeconds: config.captureInterval,
          });
          this.captureInterval = setTimeout(
            loop,
            config.captureInterval * 1000
          );
        }
      };

      loop();
    } catch (error) {
      Logger.error("_doStartTimelapse", "Error starting timelapse", {
        error: error.message,
      });
      this.isCapturing = false;
      this.currentOperation = null;
      await this.continueNextOperation();
    }
  }

  // ============================================================================
  // TIMELAPSE CONTROL METHODS
  // ============================================================================

  stopTimelapse() {
    Logger.info("stopTimelapse", "Timelapse stop requested", {
      isCurrentlyCapturing: this.isCapturing,
      hasInterval: !!this.captureInterval,
      currentOperation: this.currentOperation?.type,
    });

    if (!this.isCapturing) {
      Logger.warn("stopTimelapse", "Not currently capturing");
      return false;
    }

    try {
      this.isCapturing = false;
      if (this.captureInterval) {
        clearTimeout(this.captureInterval);
        this.captureInterval = null;
        Logger.info("stopTimelapse", "Capture interval cleared");
      }

      // Mark operation as complete and process queue safely
      this.currentOperation = null;

      // Use setTimeout to prevent stack overflow in recursive calls
      setTimeout(() => {
        this.continueNextOperation().catch((error) => {
          Logger.error(
            "stopTimelapse",
            "Error continuing operations after stop",
            { error: error.message }
          );
        });
      }, 100);

      Logger.info("stopTimelapse", "Timelapse stopped successfully");
      return true;
    } catch (error) {
      Logger.error("stopTimelapse", "Error stopping timelapse", {
        error: error.message,
      });
      this.isCapturing = false;
      this.currentOperation = null;
      return false;
    }
  }

  // ============================================================================
  // UTILITY AND STATUS METHODS
  // ============================================================================

  getSessionTime() {
    if (!this.sessionStartTime) return "00:00:00";
    const seconds = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map((v) => (v < 10 ? "0" + v : v)).join(":");
  }

  getStatus() {
    const status = {
      isCapturing: this.isCapturing,
      imageCount: this.imageCount,
      sessionTime: this.getSessionTime(),
      isStreamActive: this.isStreamActive(),
      currentOperation: this.currentOperation?.type || null,
      queueLength: this.operationQueue.length || 0,
      streamPid: this.streamProcess?.pid || null,
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
      this.imageCount = 0;
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

  getCurrentStreamConfig() {
    return this.currentStreamConfig ? { ...this.currentStreamConfig } : null;
  }

  setStreamProcess(proc) {
    Logger.info("setStreamProcess", "Stream process set externally", {
      hasProcess: !!proc,
      pid: proc?.pid,
    });
    this.streamProcess = proc;
  }

  cleanup() {
    Logger.info("cleanup", "Cleanup requested");
    try {
      this.stopTimelapse();
      this.stopStream();

      // Clear any remaining intervals
      if (this.captureInterval) {
        clearTimeout(this.captureInterval);
        this.captureInterval = null;
      }

      // Reset state
      this.currentOperation = null;
      this.isCapturing = false;
      Logger.info("cleanup", "Cleanup completed successfully");
    } catch (error) {
      Logger.error("cleanup", "Error during cleanup", { error: error.message });
    }
  }
}

module.exports = CameraService;
