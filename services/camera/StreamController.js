// services/camera/StreamController.js - Stream management logic

const { spawn } = require("child_process");
const Logger = require("./Logger");
const { RESOLUTIONS, DEFAULT_PATHS, STREAM_CONFIG } = require("./constants");

class StreamController {
  constructor() {
    this.streamProcess = null;
    this.currentStreamConfig = null;
    this.mjpegStreamerPath = DEFAULT_PATHS.mjpegStreamerPath;
    this.mjpegStreamerWwwPath = DEFAULT_PATHS.mjpegStreamerWwwPath;

    Logger.info("StreamController", "Stream controller initialized", {
      mjpegStreamerPath: this.mjpegStreamerPath,
      mjpegStreamerWwwPath: this.mjpegStreamerWwwPath,
    });
  }

  /**
   * Check if stream is currently active
   */
  isActive() {
    const active = this.streamProcess !== null;
    // Logger.debug("StreamController", "Stream status checked", {
    //   active,
    //   pid: this.streamProcess?.pid,
    // });
    return active;
  }

  /**
   * Get current stream configuration
   */
  getCurrentConfig() {
    return this.currentStreamConfig ? { ...this.currentStreamConfig } : null;
  }

  /**
   * Get resolution for quality setting
   */
  getResolutionForQuality(quality) {
    const resolution = RESOLUTIONS[quality] || RESOLUTIONS.medium;
    Logger.debug("StreamController", "Resolution determined", {
      quality,
      resolution,
    });
    return resolution;
  }

  /**
   * Start stream with given configuration
   */
  async start(config, onNotification = null) {
    Logger.info("StreamController", "Stream start requested", {
      hasExistingProcess: !!this.streamProcess,
      existingPid: this.streamProcess?.pid,
      config,
    });

    // Check for existing process
    if (this.streamProcess) {
      Logger.warn(
        "StreamController",
        "Stream process already exists, skipping",
        {
          pid: this.streamProcess.pid,
        }
      );
      return false;
    }

    try {
      this.currentStreamConfig = { ...config };
      const resolution = this.getResolutionForQuality(config.streamQuality);

      const command = [
        "-i",
        `input_uvc.so -d /dev/video0 -r ${resolution} -f ${config.streamFps}`,
        "-o",
        "-rot -180", // Rotate video 180 degreess if needed
        `output_http.so -w ${this.mjpegStreamerWwwPath} -p ${STREAM_CONFIG.port}`,
      ];

      Logger.info("StreamController", "Spawning mjpg_streamer process", {
        path: this.mjpegStreamerPath,
        command,
        resolution,
        fps: config.streamFps,
      });

      this.streamProcess = spawn(this.mjpegStreamerPath, command);

      Logger.info("StreamController", "Process spawned", {
        pid: this.streamProcess.pid,
        spawnfile: this.streamProcess.spawnfile,
      });

      this._setupProcessHandlers(onNotification);
      this._setupReadyTimeout();

      return true;
    } catch (error) {
      Logger.error("StreamController", "Error starting stream", {
        error: error.message,
        stack: error.stack,
      });
      this.streamProcess = null;
      onNotification?.("stream-error", error.message);
      return false;
    }
  }

  /**
   * Stop the current stream
   */
  stop() {
    Logger.info("StreamController", "Stream stop requested", {
      hasProcess: !!this.streamProcess,
      pid: this.streamProcess?.pid,
    });

    if (this.streamProcess) {
      try {
        const pid = this.streamProcess.pid;
        this.streamProcess.kill("SIGTERM");
        // Give process time to terminate gracefully
        setTimeout(() => {
          if (this.streamProcess && !this.streamProcess.killed) {
            this.streamProcess.kill("SIGKILL");
          }
        }, 1000);
        this.streamProcess = null;
        Logger.info("StreamController", "Stream process terminated", { pid });
        return true;
      } catch (error) {
        Logger.error("StreamController", "Error stopping stream", {
          error: error.message,
        });
        this.streamProcess = null;
        return false;
      }
    }
    return false;
  }

  /**
   * Setup process event handlers
   */
  _setupProcessHandlers(onNotification) {
    let ready = false;

    this.streamProcess.stderr.on("data", (data) => {
      const output = data.toString().trim();
      Logger.debug("StreamController", "Stream stderr", { output });

      if (output.includes(STREAM_CONFIG.readySignal) && !ready) {
        ready = true;
        Logger.info("StreamController", "Stream ready signal detected");
        onNotification?.("stream-ready", "Live preview is ready");
      }
    });

    this.streamProcess.stdout.on("data", (data) => {
      const output = data.toString().trim();
      Logger.debug("StreamController", "Stream stdout", { output });
    });

    this.streamProcess.on("error", (err) => {
      Logger.error("StreamController", "Stream process error", {
        error: err.message,
        code: err.code,
        errno: err.errno,
        syscall: err.syscall,
        path: err.path,
      });
      this.streamProcess = null;
      onNotification?.("stream-error", err.message);
    });

    this.streamProcess.on("close", (code, signal) => {
      Logger.info("StreamController", "Stream process closed", {
        code,
        signal,
        pid: this.streamProcess?.pid,
      });
      this.streamProcess = null;
      onNotification?.("stream-stopped", "Live preview stopped");
    });

    this.streamProcess.on("exit", (code, signal) => {
      Logger.info("StreamController", "Stream process exited", {
        code,
        signal,
        pid: this.streamProcess?.pid,
      });
    });
  }

  /**
   * Setup timeout to check if stream starts successfully
   */
  _setupReadyTimeout() {
    setTimeout(() => {
      if (this.streamProcess && this.streamProcess.exitCode === null) {
        // Process is still running but might not be ready
        Logger.warn("StreamController", "Stream not ready after timeout", {
          pid: this.streamProcess.pid,
          exitCode: this.streamProcess.exitCode,
          killed: this.streamProcess.killed,
        });
      }
    }, STREAM_CONFIG.startupTimeout);
  }

  /**
   * Get stream status for debugging
   */
  getStatus() {
    return {
      isActive: this.isActive(),
      pid: this.streamProcess?.pid || null,
      hasConfig: !!this.currentStreamConfig,
      config: this.currentStreamConfig,
    };
  }

  /**
   * Cleanup stream resources
   */
  cleanup() {
    Logger.info("StreamController", "Cleanup requested");
    this.stop();
    this.currentStreamConfig = null;
  }
}

module.exports = StreamController;
