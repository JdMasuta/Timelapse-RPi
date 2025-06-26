// services/video/ResourceMonitor.js - Resource Monitoring
// Extracted from VideoController.js with no logic changes

const fs = require("fs").promises;
const Logger = require("../camera/Logger");
const { ResourceError, ValidationError } = require("./Error");

class ResourceMonitor {
  constructor(config) {
    this.config = config;
  }

  async checkResources(inputFolder) {
    const checks = await Promise.allSettled([
      this.checkDiskSpace(),
      this.checkMemoryUsage(),
      this.checkInputFolder(inputFolder),
    ]);

    const failures = checks.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      const errors = failures.map((f) => f.reason.message).join("; ");
      throw new ResourceError(`Resource checks failed: ${errors}`);
    }

    return {
      diskSpace: checks[0].value,
      memoryUsage: checks[1].value,
      inputValidation: checks[2].value,
    };
  }

  async checkDiskSpace() {
    try {
      const stats = await fs.statfs(this.config.get("videosDir"));
      const freeSpace = stats.bavail * stats.bsize;

      if (freeSpace < this.config.get("minDiskSpace")) {
        throw new ResourceError(
          "Insufficient disk space",
          "diskSpace",
          this.config.get("minDiskSpace")
        );
      }

      return { freeSpace, required: this.config.get("minDiskSpace") };
    } catch (error) {
      if (error instanceof ResourceError) throw error;

      // statfs might not be available, use alternative check
      Logger.warn(
        "ResourceMonitor",
        "Could not check disk space using statfs, skipping check",
        {
          error: error.message,
        }
      );
      return {
        freeSpace: "unknown",
        required: this.config.get("minDiskSpace"),
      };
    }
  }

  async checkMemoryUsage() {
    const usage = process.memoryUsage();
    const currentUsage = usage.heapUsed + usage.external;

    if (currentUsage > this.config.get("maxMemoryUsage")) {
      throw new ResourceError(
        "Memory usage too high",
        "memoryUsage",
        this.config.get("maxMemoryUsage")
      );
    }

    return { currentUsage, maxUsage: this.config.get("maxMemoryUsage") };
  }

  async checkInputFolder(inputFolder) {
    try {
      const files = await fs.readdir(inputFolder);
      const imageFiles = files.filter((file) =>
        this.config
          .get("allowedExtensions")
          .some((ext) => file.toLowerCase().endsWith(ext))
      );

      if (imageFiles.length === 0) {
        throw new ValidationError(
          "No valid image files found in input folder",
          "inputFolder",
          inputFolder
        );
      }

      if (imageFiles.length > this.config.get("maxInputImages")) {
        throw new ResourceError(
          "Too many input images",
          "imageCount",
          this.config.get("maxInputImages")
        );
      }

      return {
        imageCount: imageFiles.length,
        maxImages: this.config.get("maxInputImages"),
      };
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ResourceError) {
        throw error;
      }
      throw new ValidationError(
        `Cannot access input folder: ${error.message}`,
        "inputFolder",
        inputFolder
      );
    }
  }
}

module.exports = ResourceMonitor;
