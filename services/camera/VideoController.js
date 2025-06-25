// services/camera/VideoController.js - Video creation from timelapse images

const { spawn } = require("child_process");
const { promisify } = require("util");
const { exec } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const Logger = require("./Logger");

const execAsync = promisify(exec);

class VideoController {
  constructor() {
    this.videosDir = path.join(__dirname, "..", "..", "videos");
    this.isProcessing = false;
    this.currentProcess = null;

    Logger.info("VideoController", "Video controller initialized", {
      videosDir: this.videosDir,
    });

    this.ensureVideosDir();
  }

  async ensureVideosDir() {
    try {
      await fs.mkdir(this.videosDir, { recursive: true });
      Logger.info("VideoController", "Videos directory ensured", {
        path: this.videosDir,
      });
    } catch (error) {
      Logger.error("VideoController", "Failed to create videos directory", {
        error: error.message,
      });
    }
  }

  /**
   * Check if ffmpeg is available on the system
   */
  async checkFFmpegAvailability() {
    try {
      await execAsync("ffmpeg -version");
      Logger.info("VideoController", "FFmpeg is available");
      return true;
    } catch (error) {
      Logger.error("VideoController", "FFmpeg not available", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Create video from folder of images
   * @param {string} inputFolder - Path to folder containing images
   * @param {object} options - Video creation options
   * @param {number} options.fps - Video frame rate (default: 30)
   * @param {string} options.quality - Quality preset: 'low', 'medium', 'high' (default: 'medium')
   * @param {string} options.codec - Video codec: 'h264', 'h265' (default: 'h264')
   * @param {number} options.bitrate - Custom bitrate in kbps (optional, overrides quality preset)
   * @param {function} options.onProgress - Progress callback (optional)
   * @param {function} options.onComplete - Completion callback (optional)
   * @param {function} options.onError - Error callback (optional)
   */
  async createVideo(inputFolder, options = {}) {
    Logger.info("VideoController", "Video creation requested", {
      inputFolder,
      options,
      isProcessing: this.isProcessing,
    });

    if (this.isProcessing) {
      throw new Error("Video creation already in progress");
    }

    if (!(await this.checkFFmpegAvailability())) {
      throw new Error("FFmpeg is not available on this system");
    }

    this.isProcessing = true;

    try {
      // Set default options
      const config = {
        fps: 30,
        quality: "medium",
        codec: "h264",
        bitrate: null,
        onProgress: null,
        onComplete: null,
        onError: null,
        ...options,
      };

      Logger.info("VideoController", "Video creation config", config);

      // Scan and analyze images
      const imageData = await this._scanImages(inputFolder);
      if (imageData.images.length === 0) {
        throw new Error("No images found in input folder");
      }

      Logger.info("VideoController", "Images analyzed", {
        count: imageData.images.length,
        startTime: imageData.startTime,
        endTime: imageData.endTime,
        duration: imageData.duration,
      });

      // Generate output filename
      const outputFilename = this._generateOutputFilename(
        imageData.startTime,
        imageData.endTime,
        config.codec
      );
      const outputPath = path.join(this.videosDir, outputFilename);

      Logger.info("VideoController", "Output path generated", { outputPath });

      // Build and execute ffmpeg command
      const result = await this._executeFFmpeg(
        inputFolder,
        outputPath,
        config,
        imageData
      );

      this.isProcessing = false;

      Logger.info("VideoController", "Video creation completed", {
        outputPath,
        duration: result.duration,
        size: result.size,
      });

      config.onComplete?.(result);
      return result;
    } catch (error) {
      this.isProcessing = false;
      Logger.error("VideoController", "Video creation failed", {
        error: error.message,
      });
      options.onError?.(error);
      throw error;
    }
  }

  /**
   * Cancel current video creation process
   */
  async cancelVideoCreation() {
    if (!this.isProcessing || !this.currentProcess) {
      Logger.warn("VideoController", "No video creation process to cancel");
      return false;
    }

    Logger.info("VideoController", "Cancelling video creation", {
      pid: this.currentProcess.pid,
    });

    try {
      this.currentProcess.kill("SIGTERM");
      this.isProcessing = false;
      this.currentProcess = null;
      Logger.info("VideoController", "Video creation cancelled successfully");
      return true;
    } catch (error) {
      Logger.error("VideoController", "Error cancelling video creation", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Scan images in folder and extract metadata
   */
  async _scanImages(inputFolder) {
    Logger.debug("VideoController", "Scanning images", { inputFolder });

    try {
      const files = await fs.readdir(inputFolder);
      const imageFiles = files.filter(
        (file) =>
          file.toLowerCase().endsWith(".jpg") ||
          file.toLowerCase().endsWith(".jpeg")
      );

      if (imageFiles.length === 0) {
        throw new Error("No JPEG images found in input folder");
      }

      // Parse timestamps and sort chronologically
      const images = imageFiles
        .map((filename) => {
          const timestamp = this._parseTimestamp(filename);
          return {
            filename,
            timestamp,
            path: path.join(inputFolder, filename),
          };
        })
        .filter((img) => img.timestamp) // Remove files with unparseable timestamps
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      if (images.length === 0) {
        throw new Error("No images with valid timestamps found");
      }

      const startTime = images[0].timestamp;
      const endTime = images[images.length - 1].timestamp;
      const duration = Math.round(
        (endTime.getTime() - startTime.getTime()) / 1000
      ); // seconds

      return {
        images,
        startTime,
        endTime,
        duration,
        count: images.length,
      };
    } catch (error) {
      Logger.error("VideoController", "Error scanning images", {
        error: error.message,
        inputFolder,
      });
      throw error;
    }
  }

  /**
   * Parse timestamp from filename
   * Expected format: timelapse_2025-06-25T13-43-41-407Z.jpg
   * Converts to: 2025-06-25T13:43:41.407Z
   */
  _parseTimestamp(filename) {
    try {
      // Extract timestamp portion: 2025-06-25T13-43-41-407Z
      const match = filename.match(
        /timelapse_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/
      );
      if (!match) {
        Logger.warn(
          "VideoController",
          "Could not parse timestamp from filename",
          { filename }
        );
        return null;
      }

      const timestampStr = match[1];

      // Convert format: 2025-06-25T13-43-41-407Z -> 2025-06-25T13:43:41.407Z
      const isoString = timestampStr.replace(
        /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
        "T$1:$2:$3.$4Z"
      );

      const date = new Date(isoString);

      if (isNaN(date.getTime())) {
        Logger.warn("VideoController", "Invalid timestamp parsed", {
          filename,
          isoString,
        });
        return null;
      }

      return date;
    } catch (error) {
      Logger.warn("VideoController", "Error parsing timestamp", {
        filename,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Generate output filename with timestamp range
   */
  _generateOutputFilename(startTime, endTime, codec) {
    const formatTimestamp = (date) => {
      return date
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace(/Z$/, "")
        .substring(0, 19); // Remove milliseconds: 2025-06-25T13-43-41
    };

    const startStr = formatTimestamp(startTime);
    const endStr = formatTimestamp(endTime);
    const extension = codec === "h265" ? "mp4" : "mp4"; // Could use .mkv for h265 if preferred

    const filename = `timelapse_${startStr}_to_${endStr}.${extension}`;

    Logger.debug("VideoController", "Generated output filename", {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      filename,
    });

    return filename;
  }

  /**
   * Get quality settings for different presets
   */
  _getQualitySettings(quality, codec, customBitrate = null) {
    const settings = {
      h264: {
        low: { crf: 32, maxrate: "1000k", bufsize: "2000k" },
        medium: { crf: 26, maxrate: "2500k", bufsize: "5000k" },
        high: { crf: 20, maxrate: "5000k", bufsize: "10000k" },
      },
      h265: {
        low: { crf: 35, maxrate: "800k", bufsize: "1600k" },
        medium: { crf: 28, maxrate: "2000k", bufsize: "4000k" },
        high: { crf: 22, maxrate: "4000k", bufsize: "8000k" },
      },
    };

    const codecSettings = settings[codec] || settings.h264;
    const qualitySettings = codecSettings[quality] || codecSettings.medium;

    // Override with custom bitrate if provided
    if (customBitrate) {
      qualitySettings.maxrate = `${customBitrate}k`;
      qualitySettings.bufsize = `${customBitrate * 2}k`;
      delete qualitySettings.crf; // Use bitrate instead of CRF
      qualitySettings.bitrate = `${customBitrate}k`;
    }

    Logger.debug("VideoController", "Quality settings determined", {
      codec,
      quality,
      customBitrate,
      settings: qualitySettings,
    });

    return qualitySettings;
  }

  /**
   * Build FFmpeg command
   */
  _buildFFmpegCommand(inputFolder, outputPath, config, imageData) {
    const qualitySettings = this._getQualitySettings(
      config.quality,
      config.codec,
      config.bitrate
    );

    // Base command
    const cmd = [
      "ffmpeg",
      "-y", // Overwrite output file
      "-framerate",
      config.fps.toString(),
      "-pattern_type",
      "glob",
      "-i",
      `"${path.join(inputFolder, "*.jpg")}"`,
    ];

    // Video codec
    if (config.codec === "h265") {
      cmd.push("-c:v", "libx265");
    } else {
      cmd.push("-c:v", "libx264");
    }

    // Pixel format for compatibility
    cmd.push("-pix_fmt", "yuv420p");

    // Quality settings
    if (qualitySettings.crf) {
      cmd.push("-crf", qualitySettings.crf.toString());
    }
    if (qualitySettings.bitrate) {
      cmd.push("-b:v", qualitySettings.bitrate);
    }
    if (qualitySettings.maxrate) {
      cmd.push("-maxrate", qualitySettings.maxrate);
    }
    if (qualitySettings.bufsize) {
      cmd.push("-bufsize", qualitySettings.bufsize);
    }

    // Output frame rate
    cmd.push("-r", config.fps.toString());

    // Output file
    cmd.push(`"${outputPath}"`);

    const commandString = cmd.join(" ");

    Logger.info("VideoController", "FFmpeg command built", {
      command: commandString,
      codec: config.codec,
      quality: config.quality,
      fps: config.fps,
    });

    return commandString;
  }

  /**
   * Execute FFmpeg command with progress monitoring
   */
  async _executeFFmpeg(inputFolder, outputPath, config, imageData) {
    const command = this._buildFFmpegCommand(
      inputFolder,
      outputPath,
      config,
      imageData
    );

    Logger.info("VideoController", "Starting FFmpeg execution");

    return new Promise((resolve, reject) => {
      // Use shell execution for glob pattern support
      this.currentProcess = spawn("bash", ["-c", command], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";
      let lastProgress = 0;

      this.currentProcess.stderr.on("data", (data) => {
        const output = data.toString();
        stderr += output;

        // Parse progress from FFmpeg output
        const frameMatch = output.match(/frame=\s*(\d+)/);
        if (frameMatch) {
          const currentFrame = parseInt(frameMatch[1]);
          const progress = Math.min(
            100,
            Math.round((currentFrame / imageData.count) * 100)
          );

          if (progress > lastProgress) {
            lastProgress = progress;
            Logger.debug("VideoController", "FFmpeg progress", {
              frame: currentFrame,
              totalFrames: imageData.count,
              progress: `${progress}%`,
            });
            config.onProgress?.(progress, currentFrame, imageData.count);
          }
        }
      });

      this.currentProcess.on("close", async (code) => {
        this.currentProcess = null;

        if (code === 0) {
          try {
            // Get file stats for result
            const stats = await fs.stat(outputPath);
            const result = {
              outputPath,
              filename: path.basename(outputPath),
              size: stats.size,
              duration: imageData.duration,
              frameCount: imageData.count,
              fps: config.fps,
              codec: config.codec,
              quality: config.quality,
              createdAt: new Date().toISOString(),
            };

            Logger.info("VideoController", "FFmpeg completed successfully", {
              code,
              outputSize: stats.size,
              frameCount: imageData.count,
            });

            resolve(result);
          } catch (error) {
            Logger.error("VideoController", "Error getting output file stats", {
              error: error.message,
            });
            reject(new Error("Video created but could not verify output file"));
          }
        } else {
          Logger.error("VideoController", "FFmpeg failed", {
            code,
            stderr: stderr.substring(-1000), // Last 1000 chars of stderr
          });
          reject(
            new Error(
              `FFmpeg failed with code ${code}: ${stderr.substring(-500)}`
            )
          );
        }
      });

      this.currentProcess.on("error", (error) => {
        this.currentProcess = null;
        Logger.error("VideoController", "FFmpeg process error", {
          error: error.message,
        });
        reject(error);
      });
    });
  }

  /**
   * List existing videos
   */
  async listVideos() {
    try {
      const files = await fs.readdir(this.videosDir);
      const videoFiles = files.filter(
        (file) =>
          file.toLowerCase().endsWith(".mp4") ||
          file.toLowerCase().endsWith(".mkv") ||
          file.toLowerCase().endsWith(".avi")
      );

      const videos = await Promise.all(
        videoFiles.map(async (filename) => {
          const filepath = path.join(this.videosDir, filename);
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

  /**
   * Delete a video file
   */
  async deleteVideo(filename) {
    try {
      const filepath = path.join(this.videosDir, filename);
      await fs.unlink(filepath);

      Logger.info("VideoController", "Video deleted", { filename, filepath });
      return true;
    } catch (error) {
      Logger.error("VideoController", "Error deleting video", {
        filename,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get video creation status
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      hasCurrentProcess: !!this.currentProcess,
      videosDir: this.videosDir,
      pid: this.currentProcess?.pid || null,
    };
  }

  /**
   * Cleanup video controller resources
   */
  cleanup() {
    Logger.info("VideoController", "Cleanup requested");

    if (this.currentProcess) {
      try {
        this.currentProcess.kill("SIGTERM");
        Logger.info("VideoController", "Current process terminated");
      } catch (error) {
        Logger.error("VideoController", "Error terminating process", {
          error: error.message,
        });
      }
    }

    this.currentProcess = null;
    this.isProcessing = false;
  }
}

module.exports = VideoController;
