// services/camera/CaptureController.js - Single image capture logic

const fs = require("fs");
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
  generateFilename(prefix = "timelapse", timestamp = null) {
    !!timestamp ? timelapse : this.generateTimestamp();
    return `${prefix}_${timestamp}.jpg`;
  }

  /**
   * Generate a timestamp string for filenames
   */

  generateTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  /**
   * Write a minimal valid placeholder JPEG (used when MOCK_CAMERA is enabled).
   * @private
   */
  async _writeMockImage(filepath) {
    // 1x1 baseline JPEG, just enough to be a valid image file on disk.
    const MOCK_JPEG_BASE64 =
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U" +
      "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA" +
      "/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEA" +
      "AD8AfwD/2Q==";
    await fs.promises.writeFile(filepath, Buffer.from(MOCK_JPEG_BASE64, "base64"));
  }

  /**
   * Capture a single image
   */
  async captureImage(config, filename = null) {
    const resolution = "3840x2160"; // this.getResolutionForQuality(config.imageQuality);
    const timestamp = this.generateTimestamp();
    const imageFilename = filename || this.generateFilename(timestamp);
    const filepath = path.join(this.outputDir, imageFilename);

    // Dev/test mode: write a placeholder image instead of invoking fswebcam,
    // so the full pipeline can be smoke-tested without camera hardware.
    if (process.env.MOCK_CAMERA === "true") {
      await this._writeMockImage(filepath);
      Logger.info("CaptureController", "Mock image written", {
        filename: imageFilename,
        filepath,
      });
      return {
        filename: imageFilename,
        filepath,
        resolution,
        timestamp: new Date().toISOString(),
      };
    }

    const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:45"; // Adjust font size as needed

    const cmd = `fswebcam -r ${resolution} "${filepath}" --timestamp ${timestamp} --title "${imageFilename}" --font ${font}`;

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
