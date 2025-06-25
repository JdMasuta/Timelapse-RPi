// services/camera/Logger.js - Centralized logging utility

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

module.exports = Logger;
