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
      comparator: (a, b) => b.priority - a.priority,
    });
    this.currentOperation = null;
    this.operationStates = new Map();

    this.ensureOutputDir();
  }

  async ensureOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error("Failed to create output directory:", error);
    }
  }

  isStreamActive() {
    return this.streamProcess !== null;
  }

  getResolutionForQuality(quality) {
    const resolutions = {
      low: "640x480",
      medium: "1280x720",
      high: "1920x1080",
    };
    return resolutions[quality] || resolutions.medium;
  }

  async queueOperation(type, config, callbacks = {}, priority) {
    const operation = new OperationContext(type, config, callbacks, priority);

    if (!this.currentOperation) {
      await this.startOperation(operation);
      return;
    }

    if (priority > this.currentOperation.priority) {
      await this.pauseCurrentOperation();
      this.operationQueue.queue(this.currentOperation);
      await this.startOperation(operation);
    } else {
      this.operationQueue.queue(operation);
      callbacks.onNotification?.(
        "queued",
        `Operation queued (priority ${priority})`
      );
    }
  }

  async startOperation(operation) {
    this.currentOperation = operation;
    operation.state = "running";

    switch (operation.type) {
      case "stream":
        await this._startStream(operation);
        break;
      case "timelapse":
        await this._startTimelapse(operation);
        break;
      case "capture":
        await this._performCapture(operation);
        break;
    }
  }

  async pauseCurrentOperation() {
    const op = this.currentOperation;
    if (!op) return;

    op.state = "paused";

    switch (op.type) {
      case "stream":
        op.progress.wasActive = this.isStreamActive();
        if (op.progress.wasActive) await this.stopStream();
        break;
      case "timelapse":
        op.progress.imageCount = this.imageCount;
        op.progress.sessionStartTime = this.sessionStartTime;
        this.stopTimelapse();
        break;
    }

    this.operationStates.set(op.timestamp, op);
    op.callbacks.onNotification?.("paused", `${op.type} paused`);
    this.currentOperation = null;
  }

  async resumeOperation(op) {
    op.state = "running";
    this.currentOperation = op;

    switch (op.type) {
      case "stream":
        if (op.progress.wasActive) await this._startStream(op);
        break;
      case "timelapse":
        this.imageCount = op.progress.imageCount || 0;
        this.sessionStartTime = op.progress.sessionStartTime || Date.now();
        await this._startTimelapse(op);
        break;
    }

    op.callbacks.onNotification?.("resumed", `${op.type} resumed`);
  }

  async captureImage(config, notifyCallback = null) {
    await this.queueOperation(
      "capture",
      config,
      { onNotification: notifyCallback },
      OPERATION_PRIORITIES.USER_CAPTURE
    );
  }

  async _performCapture(operation) {
    const { config, callbacks } = operation;
    const resolution = this.getResolutionForQuality(config.imageQuality);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `timelapse_${timestamp}.jpg`;
    const filepath = path.join(this.outputDir, filename);

    const wasStreamActive = this.isStreamActive();
    const streamConfig = wasStreamActive ? this.getCurrentStreamConfig() : null;

    try {
      if (wasStreamActive) {
        callbacks.onNotification?.(
          "stream-paused",
          "Live preview paused for image capture..."
        );
        await this.stopStream();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      await execAsync(`fswebcam -r ${resolution} --no-banner "${filepath}"`);
      callbacks.onNotification?.("captured", filename);
    } catch (error) {
      console.error("Capture failed:", error);
      callbacks.onNotification?.("capture-error", error.message);
    } finally {
      if (wasStreamActive && streamConfig) {
        try {
          await this._startStream(
            new OperationContext(
              "stream",
              streamConfig,
              callbacks,
              OPERATION_PRIORITIES.STREAM
            )
          );
        } catch (streamError) {
          console.error("Failed to restart stream:", streamError);
          callbacks.onNotification?.("stream-error", streamError.message);
        }
      }

      this.currentOperation = null;
    }
  }

  async _startTimelapse(operation) {
    const { config, callbacks } = operation;
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.imageCount = 0;
    this.sessionStartTime = Date.now();

    const loop = async () => {
      if (!this.isCapturing) return;
      try {
        await this.captureImage(config, callbacks.onNotification);
        this.imageCount++;
        callbacks.onImageCaptured?.({
          imageCount: this.imageCount,
          sessionTime: this.getSessionTime(),
        });
      } catch (err) {
        callbacks.onError?.(err);
      }
      if (this.isCapturing) {
        this.captureInterval = setTimeout(loop, config.captureInterval * 1000);
      }
    };
    loop();
  }

  async _startStream(operation) {
    const { config, callbacks } = operation;

    try {
      const resolution = this.getResolutionForQuality(config.streamQuality);
      this.streamProcess = spawn(this.mjpegStreamerPath, [
        "-i",
        `input_uvc.so -d /dev/video0 -r ${resolution} -f ${config.streamFps}`,
        "-o",
        `output_http.so -w ${this.mjpegStreamerWwwPath} -p 8080`,
      ]);

      this.currentStreamConfig = { ...config };

      let streamReadyEmitted = false;
      this.streamProcess.stderr.on("data", (data) => {
        const output = data.toString();
        if (output.includes("o: commands") && !streamReadyEmitted) {
          streamReadyEmitted = true;
          callbacks.onNotification?.("stream-ready", "Live preview is ready");
        }
      });

      this.streamProcess.on("error", (err) => {
        console.error("Stream error:", err);
        this.streamProcess = null;
        callbacks.onNotification?.("stream-error", err.message);
      });

      this.streamProcess.on("close", () => {
        this.streamProcess = null;
        callbacks.onNotification?.("stream-stopped", "Stream closed");
      });
    } catch (error) {
      throw error;
    }
  }

  stopTimelapse() {
    this.isCapturing = false;
    if (this.captureInterval) clearTimeout(this.captureInterval);
    return true;
  }

  stopStream() {
    if (this.streamProcess) this.streamProcess.kill("SIGKILL");
    this.streamProcess = null;
    return true;
  }

  getSessionTime() {
    if (!this.sessionStartTime) return "00:00:00";
    const seconds = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map((v) => (v < 10 ? "0" + v : v)).join(":");
  }

  getStatus() {
    return {
      isCapturing: this.isCapturing,
      imageCount: this.imageCount,
      sessionTime: this.getSessionTime(),
      isStreamActive: this.isStreamActive(),
    };
  }

  async getImageList() {
    try {
      const files = await fs.readdir(this.outputDir);
      const imageFiles = files.filter(
        (f) => f.endsWith(".jpg") || f.endsWith(".jpeg")
      );
      const list = await Promise.all(
        imageFiles.map(async (f) => {
          const stat = await fs.stat(path.join(this.outputDir, f));
          return {
            filename: f,
            filepath: path.join(this.outputDir, f),
            size: stat.size,
            created: stat.birthtime,
          };
        })
      );
      return list.sort((a, b) => b.created - a.created);
    } catch (e) {
      console.error("Failed to get image list:", e);
      return [];
    }
  }

  async clearImages() {
    try {
      const files = await fs.readdir(this.outputDir);
      const imageFiles = files.filter(
        (f) => f.endsWith(".jpg") || f.endsWith(".jpeg")
      );
      await Promise.all(
        imageFiles.map((f) => fs.unlink(path.join(this.outputDir, f)))
      );
      this.imageCount = 0;
      return imageFiles.length;
    } catch (e) {
      console.error("Failed to clear images:", e);
      throw e;
    }
  }

  getCurrentStreamConfig() {
    return this.currentStreamConfig ? { ...this.currentStreamConfig } : null;
  }

  setStreamProcess(streamProcess) {
    this.streamProcess = streamProcess;
  }

  cleanup() {
    this.stopTimelapse();
    this.stopStream();
  }
}

module.exports = CameraService;
