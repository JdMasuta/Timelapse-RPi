// Updated cameraService.js with operation queue integration
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
      comparator: (a, b) => {
        if (
          !a ||
          !b ||
          typeof a.priority !== "number" ||
          typeof b.priority !== "number"
        ) {
          console.error("Invalid operation enqueued:", a, b);
          return 0;
        }
        return b.priority - a.priority;
      },
    });
    this.currentOperation = null;
    this.operationStates = new Map();
    this.continueNextOperation = this.continueNextOperation.bind(this);

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
      if (!operation || typeof operation.priority !== "number") {
        console.error("Invalid operation:", operation);
        return;
      }
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
        await this._doStartStream(operation);
        break;
      case "timelapse":
        await this._doStartTimelapse(operation);
        break;
      case "capture":
        await this._doCaptureImage(operation);
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
        if (op.progress.wasActive) await this._doStartStream(op);
        break;
      case "timelapse":
        this.imageCount = op.progress.imageCount || 0;
        this.sessionStartTime = op.progress.sessionStartTime || Date.now();
        await this._doStartTimelapse(op);
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

  async _doCaptureImage(op) {
    const config = op.config;
    const resolution = this.getResolutionForQuality(config.imageQuality);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `timelapse_${timestamp}.jpg`;
    const filepath = path.join(this.outputDir, filename);

    const wasStreamActive = this.isStreamActive();
    const streamConfig = wasStreamActive ? this.getCurrentStreamConfig() : null;

    try {
      if (wasStreamActive) {
        op.callbacks.onNotification?.(
          "stream-paused",
          "Live preview paused for image capture..."
        );
        await this.stopStream();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const cmd = `fswebcam -r ${resolution} --no-banner "${filepath}"`;
      await execAsync(cmd);

      op.callbacks.onNotification?.("image-captured", filename);
    } catch (error) {
      op.callbacks.onNotification?.("capture-error", error.message);
      throw error;
    } finally {
      if (wasStreamActive && streamConfig) {
        await this.startStream(streamConfig, op.callbacks.onNotification);
      }
      this.currentOperation = null;
      await this.continueNextOperation();
    }
  }

  async startTimelapse(
    config,
    onImageCaptured,
    onError,
    onStreamNotification = null
  ) {
    await this.queueOperation(
      "timelapse",
      config,
      { onImageCaptured, onError, onNotification: onStreamNotification },
      OPERATION_PRIORITIES.TIMELAPSE
    );
  }

  async _doStartTimelapse(op) {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.imageCount = 0;
    this.sessionStartTime = Date.now();

    const config = op.config;
    const streamConfig = this.getCurrentStreamConfig();
    const wasStreamActive = this.isStreamActive();

    const loop = async () => {
      if (!this.isCapturing) return;

      try {
        if (wasStreamActive && streamConfig) {
          await this.stopStream();
          await new Promise((res) => setTimeout(res, 500));
        }

        const resolution = this.getResolutionForQuality(config.imageQuality);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `timelapse_${timestamp}.jpg`;
        const filepath = path.join(this.outputDir, filename);

        const cmd = `fswebcam -r ${resolution} --no-banner "${filepath}"`;
        await execAsync(cmd);

        this.imageCount++;
        op.callbacks.onNotification?.("image-captured", filename);
        op.callbacks.onImageCaptured?.({
          imageCount: this.imageCount,
          sessionTime: this.getSessionTime(),
          filename,
          filepath,
        });
      } catch (err) {
        op.callbacks.onError?.(err);
      }

      if (this.isCapturing && wasStreamActive && streamConfig) {
        await this.startStream(streamConfig, op.callbacks.onNotification);
      }

      if (this.isCapturing) {
        this.captureInterval = setTimeout(loop, config.captureInterval * 1000);
      }
    };

    loop();
  }

  async startStream(config, onNotification = null) {
    await this.queueOperation(
      "stream",
      config,
      { onNotification },
      OPERATION_PRIORITIES.STREAM
    );
  }

  async _doStartStream(op) {
    if (this.streamProcess || this.isCapturing) return;

    const config = op.config;
    this.currentStreamConfig = { ...config };

    const resolution = this.getResolutionForQuality(config.streamQuality);

    this.streamProcess = spawn(this.mjpegStreamerPath, [
      "-i",
      `input_uvc.so -d /dev/video0 -r ${resolution} -f ${config.streamFps}`,
      "-o",
      `output_http.so -w ${this.mjpegStreamerWwwPath} -p 8080`,
    ]);

    let ready = false;
    this.streamProcess.stderr.on("data", (data) => {
      const output = data.toString();
      if (output.includes("o: commands.............: enabled") && !ready) {
        ready = true;
        op.callbacks.onNotification?.("stream-ready", "Live preview is ready");
      }
    });

    this.streamProcess.on("error", (err) => {
      this.streamProcess = null;
      op.callbacks.onNotification?.("stream-error", err.message);
    });

    this.streamProcess.on("close", () => {
      this.streamProcess = null;
      op.callbacks.onNotification?.("stream-stopped", "Live preview stopped");
    });
  }

  stopTimelapse() {
    if (!this.isCapturing) return false;
    this.isCapturing = false;
    if (this.captureInterval) clearTimeout(this.captureInterval);
    this.continueNextOperation();
    return true;
  }

  async stopStream() {
    if (this.streamProcess) {
      this.streamProcess.kill("SIGKILL");
      this.streamProcess = null;
    }
    await this.continueNextOperation();
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
      return list.sort((a, b) => b.created - a.created);
    } catch (err) {
      console.error("Failed to list images:", err);
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
      return targets.length;
    } catch (err) {
      console.error("Failed to clear images:", err);
      throw err;
    }
  }

  getCurrentStreamConfig() {
    return this.currentStreamConfig ? { ...this.currentStreamConfig } : null;
  }

  setStreamProcess(proc) {
    this.streamProcess = proc;
  }

  cleanup() {
    this.stopTimelapse();
    this.stopStream();
  }

  async continueNextOperation() {
    if (!this.currentOperation && this.operationQueue.length > 0) {
      const nextOp = this.operationQueue.dequeue();
      await this.resumeOperation(nextOp);
    }
  }
}

module.exports = CameraService;
