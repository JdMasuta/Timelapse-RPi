// services/camera/OperationContext.js - Operation data structure

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

  /**
   * Mark operation as running
   */
  markAsRunning() {
    this.state = "running";
  }

  /**
   * Mark operation as paused
   */
  markAsPaused() {
    this.state = "paused";
  }

  /**
   * Mark operation as completed
   */
  markAsCompleted() {
    this.state = "completed";
  }

  /**
   * Check if operation is valid
   */
  isValid() {
    return this.type && typeof this.priority === "number";
  }

  /**
   * Get a summary of the operation for logging
   */
  getSummary() {
    return {
      type: this.type,
      priority: this.priority,
      state: this.state,
      timestamp: this.timestamp,
      hasProgress: Object.keys(this.progress).length > 0,
    };
  }

  /**
   * Notify with event and message
   */
  notify(event, message) {
    if (this.callbacks.onNotification) {
      this.callbacks.onNotification(event, message);
    }
  }

  /**
   * Call error callback
   */
  error(error) {
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
  }

  /**
   * Call image captured callback (for timelapse)
   */
  imageCaptured(data) {
    if (this.callbacks.onImageCaptured) {
      this.callbacks.onImageCaptured(data);
    }
  }
}

module.exports = OperationContext;
