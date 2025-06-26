// services/video/ProcessManager.js - Secure Process Management
// Extracted from VideoController.js with no logic changes

const { spawn } = require("child_process");
const Logger = require("../camera/Logger");
const { ProcessError } = require("./Error");

class ProcessManager {
  constructor(config) {
    this.config = config;
    this.currentProcess = null;
    this.abortController = new AbortController();
  }

  async executeFFmpeg(args, onProgress = null) {
    if (this.currentProcess) {
      throw new ProcessError("Process already running");
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stderr = "";
      let stdout = "";
      let progressData = { frame: 0, totalFrames: 0 };

      Logger.info("ProcessManager", "Starting FFmpeg process", {
        command: "ffmpeg",
        args: args.map((arg) =>
          typeof arg === "string" && arg.length > 50
            ? arg.substring(0, 47) + "..."
            : arg
        ),
      });

      // Start process with validated arguments (NO shell execution)
      this.currentProcess = spawn("ffmpeg", args, {
        stdio: ["pipe", "pipe", "pipe"],
        signal: this.abortController.signal,
      });

      const processTimeout = setTimeout(() => {
        this.killProcess("TIMEOUT");
        reject(
          new ProcessError(
            `Process timeout after ${this.config.get("processTimeout")}ms`
          )
        );
      }, this.config.get("processTimeout"));

      // Handle stdout
      this.currentProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        // Limit stdout size
        if (stdout.length > this.config.get("maxStderrSize")) {
          stdout = stdout.substring(
            stdout.length - this.config.get("maxStderrSize")
          );
        }
      });

      // Handle stderr and progress
      this.currentProcess.stderr.on("data", (data) => {
        const output = data.toString();
        stderr += output;

        // Limit stderr size to prevent memory leaks
        if (stderr.length > this.config.get("maxStderrSize")) {
          stderr = stderr.substring(
            stderr.length - this.config.get("maxStderrSize")
          );
        }

        // Parse progress
        this.parseProgress(output, progressData, onProgress);
      });

      // Handle process completion
      this.currentProcess.on("close", (code) => {
        clearTimeout(processTimeout);
        this.currentProcess = null;

        const duration = Date.now() - startTime;

        if (code === 0) {
          Logger.info(
            "ProcessManager",
            "FFmpeg process completed successfully",
            {
              duration,
              exitCode: code,
            }
          );
          resolve({
            exitCode: code,
            duration,
            stdout: stdout.substring(-1000), // Last 1KB
            stderr: stderr.substring(-1000),
          });
        } else {
          Logger.error("ProcessManager", "FFmpeg process failed", {
            duration,
            exitCode: code,
            stderr: stderr.substring(-1000),
          });
          reject(
            new ProcessError(
              `FFmpeg failed with exit code ${code}`,
              code,
              stderr
            )
          );
        }
      });

      // Handle process errors
      this.currentProcess.on("error", (error) => {
        clearTimeout(processTimeout);
        this.currentProcess = null;

        Logger.error("ProcessManager", "FFmpeg process error", {
          error: error.message,
          code: error.code,
        });

        if (error.name === "AbortError") {
          reject(new ProcessError("Process was cancelled"));
        } else {
          reject(new ProcessError(`Process error: ${error.message}`));
        }
      });
    });
  }

  parseProgress(output, progressData, onProgress) {
    // Parse frame information from FFmpeg output
    const frameMatch = output.match(/frame=\s*(\d+)/);
    if (frameMatch) {
      progressData.frame = parseInt(frameMatch[1]);
    }

    // Parse duration information if available
    const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (timeMatch) {
      const [, hours, minutes, seconds] = timeMatch;
      const currentSeconds =
        parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
      progressData.currentSeconds = currentSeconds;
    }

    // Call progress callback if available
    if (onProgress && progressData.frame > 0) {
      try {
        onProgress(progressData);
      } catch (error) {
        Logger.warn("ProcessManager", "Progress callback error", {
          error: error.message,
        });
      }
    }
  }

  async killProcess(reason = "USER_REQUEST") {
    if (!this.currentProcess) {
      return false;
    }

    Logger.info("ProcessManager", "Killing FFmpeg process", {
      pid: this.currentProcess.pid,
      reason,
    });

    return new Promise((resolve) => {
      const killTimeout = setTimeout(() => {
        // Force kill if graceful termination failed
        try {
          this.currentProcess.kill("SIGKILL");
          Logger.warn("ProcessManager", "Force killed process with SIGKILL", {
            pid: this.currentProcess.pid,
          });
        } catch (error) {
          Logger.error("ProcessManager", "Error force killing process", {
            error: error.message,
          });
        }
        resolve(true);
      }, this.config.get("killTimeout"));

      this.currentProcess.on("exit", () => {
        clearTimeout(killTimeout);
        resolve(true);
      });

      // Try graceful termination first
      try {
        this.currentProcess.kill("SIGTERM");
      } catch (error) {
        clearTimeout(killTimeout);
        Logger.error("ProcessManager", "Error killing process", {
          error: error.message,
        });
        resolve(false);
      }
    });
  }

  cleanup() {
    if (this.currentProcess) {
      this.abortController.abort();
      this.killProcess("CLEANUP");
    }
  }

  getStatus() {
    return {
      isRunning: !!this.currentProcess,
      pid: this.currentProcess?.pid || null,
    };
  }
}

module.exports = ProcessManager;
