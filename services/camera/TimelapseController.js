// services/camera/TimelapseController.js - Timelapse management logic

const Logger = require("./Logger");
const { TIMELAPSE_CONFIG } = require("./constants");

class TimelapseController {
  constructor(captureController) {
    this.captureController = captureController;
    this.isCapturing = false;
    this.captureInterval = null;
    this.imageCount = 0;
    this.sessionStartTime = null;
    this.currentOperation = null;

    Logger.info("TimelapseController", "Timelapse controller initialized");
  }

  /**
   * Check if timelapse is currently running
   */
  isRunning() {
    return this.isCapturing;
  }

  /**
   * Get current session time formatted as HH:MM:SS
   */
  getSessionTime() {
    if (!this.sessionStartTime) return "00:00:00";
    const seconds = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map((v) => (v < 10 ? "0" + v : v)).join(":");
  }

  /**
   * Start timelapse capture
   */
  async start(operation, streamController) {
    Logger.info("TimelapseController", "Timelapse start requested", {
      isCurrentlyCapturing: this.isCapturing,
      operation: operation.getSummary(),
    });

    if (this.isCapturing) {
      Logger.warn("TimelapseController", "Already capturing, skipping");
      return false;
    }

    try {
      this.isCapturing = true;
      this.imageCount = 0;
      this.sessionStartTime = Date.now();
      this.currentOperation = operation;

      const config = operation.config;

      // Store actual stream state at timelapse start
      const streamWasActiveAtStart = streamController.isActive();
      const streamConfigAtStart = streamController.getCurrentConfig();

      Logger.info("TimelapseController", "Timelapse configuration", {
        captureInterval: config.captureInterval,
        imageQuality: config.imageQuality,
        streamWasActiveAtStart,
        hasStreamConfig: !!streamConfigAtStart,
      });

      // Start the capture loop
      await this._startCaptureLoop(
        config,
        streamController,
        streamWasActiveAtStart,
        streamConfigAtStart
      );

      return true;
    } catch (error) {
      Logger.error("TimelapseController", "Error starting timelapse", {
        error: error.message,
      });
      this.isCapturing = false;
      this.currentOperation = null;
      throw error;
    }
  }

  /**
   * Stop timelapse capture
   */
  stop() {
    Logger.info("TimelapseController", "Timelapse stop requested", {
      isCurrentlyCapturing: this.isCapturing,
      hasInterval: !!this.captureInterval,
      imageCount: this.imageCount,
    });

    if (!this.isCapturing) {
      Logger.warn("TimelapseController", "Not currently capturing");
      return false;
    }

    try {
      this.isCapturing = false;

      if (this.captureInterval) {
        clearTimeout(this.captureInterval);
        this.captureInterval = null;
        Logger.info("TimelapseController", "Capture interval cleared");
      }

      this.currentOperation = null;
      Logger.info("TimelapseController", "Timelapse stopped successfully");
      return true;
    } catch (error) {
      Logger.error("TimelapseController", "Error stopping timelapse", {
        error: error.message,
      });
      this.isCapturing = false;
      this.currentOperation = null;
      return false;
    }
  }

  /**
   * Start the capture loop
   */
  async _startCaptureLoop(
    config,
    streamController,
    streamWasActiveAtStart,
    streamConfigAtStart
  ) {
    const loop = async () => {
      if (!this.isCapturing) {
        Logger.info(
          "TimelapseController",
          "Capture loop stopping - no longer capturing"
        );
        return;
      }

      try {
        // Pause stream before capture
        if (streamWasActiveAtStart && streamConfigAtStart) {
          Logger.debug("TimelapseController", "Pausing stream for capture");
          streamController.stop();
          await new Promise((res) =>
            setTimeout(res, TIMELAPSE_CONFIG.streamPauseDelay)
          );
        }

        // Capture image
        const result = await this.captureController.captureImage(config);
        this.imageCount++;

        Logger.info("TimelapseController", "Timelapse image captured", {
          imageCount: this.imageCount,
          filename: result.filename,
        });

        // Notify callbacks
        this.currentOperation?.notify("image-captured", result.filename);
        this.currentOperation?.imageCaptured({
          imageCount: this.imageCount,
          sessionTime: this.getSessionTime(),
          filename: result.filename,
          filepath: result.filepath,
        });
      } catch (err) {
        Logger.error("TimelapseController", "Error in timelapse capture", {
          error: err.message,
        });
        this.currentOperation?.error(err);
      }

      // Resume stream after capture
      if (this.isCapturing && streamWasActiveAtStart && streamConfigAtStart) {
        Logger.debug("TimelapseController", "Resuming stream after capture");
        await streamController.start(streamConfigAtStart, (event, message) => {
          this.currentOperation?.notify(event, message);
        });
      }

      // Schedule next capture
      if (this.isCapturing) {
        Logger.debug("TimelapseController", "Scheduling next capture", {
          intervalSeconds: config.captureInterval,
        });
        this.captureInterval = setTimeout(loop, config.captureInterval * 1000);
      }
    };

    // Start the loop
    loop();
  }

  /**
   * Get timelapse status
   */
  getStatus() {
    return {
      isCapturing: this.isCapturing,
      imageCount: this.imageCount,
      sessionTime: this.getSessionTime(),
      hasInterval: !!this.captureInterval,
      currentOperation: this.currentOperation?.getSummary() || null,
    };
  }

  /**
   * Cleanup timelapse resources
   */
  cleanup() {
    Logger.info("TimelapseController", "Cleanup requested");
    this.stop();
    this.sessionStartTime = null;
    this.imageCount = 0;
  }
}

module.exports = TimelapseController;
