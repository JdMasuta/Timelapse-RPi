// services/camera/CaptureController.js - Single image capture logic

const { promisify } = require("util");
const { exec } = require("child_process");
const path = require("path");
const Logger = require("./Logger");
const { RESOLUTIONS } = require("./constants");

const execAsync = promisify(exec);

class CaptureController {
  constructor(outputDir) {
    this.outputDir = outputDir;
    try {
      fs.accessSync(this.outputDir, fs.constants.W_OK);
    } catch (error) {
      throw new Error(`Output directory is not writable: ${this.outputDir}`);
    }
    Logger.info("CaptureController", "Capture controller initialized", {
      outputDir: this.outputDir,
    });
  }

  /**
   * Get resolution for quality setting
   */
  getResolutionForQuality(quality) {
    const resolution = RESOLUTIONS[quality] || RESOLUTIONS.medium;
    Logger.debug("CaptureController", "Resolution determined", {
      quality,
      resolution,
    });
    return resolution;
  }

  /**
   * Generate filename for capture
   */
  generateFilename(prefix = "timelapse") {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${prefix}_${timestamp}.jpg`;
  }

  /**
   * Capture a single image
   */
  async captureImage(config, filename = null) {
    const resolution = this.getResolutionForQuality(config.imageQuality);
    const imageFilename = filename || this.generateFilename();
    const filepath = path.join(this.outputDir, imageFilename);

    const cmd = `fswebcam -r ${resolution} --no-banner "${filepath}"`;

    Logger.info("CaptureController", "Executing capture command", {
      cmd,
      filename: imageFilename,
      resolution,
    });

    try {
      await execAsync(cmd);
      Logger.info("CaptureController", "Image captured successfully", {
        filename: imageFilename,
        filepath,
      });

      return {
        filename: imageFilename,
        filepath,
        resolution,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      Logger.error("CaptureController", "Error capturing image", {
        error: error.message,
        cmd,
        filename: imageFilename,
      });
      throw error;
    }
  }

  /**
   * Capture image with stream pause/resume logic
   */
  async captureWithStreamPause(
    config,
    streamController,
    onNotification = null
  ) {
    Logger.info("CaptureController", "Starting capture with stream pause");

    const wasStreamActive = streamController.isActive();
    const streamConfig = wasStreamActive
      ? streamController.getCurrentConfig()
      : null;

    Logger.info("CaptureController", "Stream state before capture", {
      wasStreamActive,
      hasStreamConfig: !!streamConfig,
    });

    try {
      // Pause stream if active
      if (wasStreamActive) {
        onNotification?.(
          "stream-paused",
          "Live preview paused for image capture..."
        );
        streamController.stop();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Capture image
      const result = await this.captureImage(config);
      onNotification?.("image-captured", result.filename);

      return result;
    } catch (error) {
      onNotification?.("capture-error", error.message);
      throw error;
    } finally {
      // Resume stream if it was active
      if (wasStreamActive && streamConfig) {
        Logger.info("CaptureController", "Restarting stream after capture");
        await streamController.start(streamConfig, onNotification);
      }
    }
  }

  /**
   * Update output directory
   */
  setOutputDir(newOutputDir) {
    this.outputDir = newOutputDir;
    Logger.info("CaptureController", "Output directory updated", {
      outputDir: this.outputDir,
    });
  }

  /**
   * Get capture status
   */
  getStatus() {
    return {
      outputDir: this.outputDir,
      isReady: !!this.outputDir,
    };
  }
}

module.exports = CaptureController;
