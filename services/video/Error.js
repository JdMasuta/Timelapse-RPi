// services/video/Error.js - Error Classes for Video Processing
// Extracted from VideoController.js with no logic changes

class VideoError extends Error {
  constructor(message, code = "VIDEO_ERROR", details = {}) {
    super(message);
    this.name = "VideoError";
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

class ValidationError extends VideoError {
  constructor(message, field, value) {
    super(message, "VALIDATION_ERROR", { field, value });
    this.name = "ValidationError";
  }
}

class SecurityError extends VideoError {
  constructor(message, details = {}) {
    super(message, "SECURITY_ERROR", details);
    this.name = "SecurityError";
  }
}

class ResourceError extends VideoError {
  constructor(message, resource, limit) {
    super(message, "RESOURCE_ERROR", { resource, limit });
    this.name = "ResourceError";
  }
}

class ProcessError extends VideoError {
  constructor(message, exitCode, stderr) {
    super(message, "PROCESS_ERROR", {
      exitCode,
      stderr: stderr?.substring(0, 500),
    });
    this.name = "ProcessError";
  }
}

module.exports = {
  VideoError,
  ValidationError,
  SecurityError,
  ResourceError,
  ProcessError,
};
