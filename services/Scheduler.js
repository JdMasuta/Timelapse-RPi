// services/Scheduler.js
// Optional daily schedule: when enabled, auto-starts capture inside the [start, stop]
// window and auto-stops it when the window closes. Only auto-stops captures that it
// auto-started, so manual captures are never interrupted by the scheduler.

const Logger = require("./camera/Logger");

class Scheduler {
  constructor({
    isEnabled,
    getWindow,
    isCapturing,
    startCapture,
    stopCapture,
    intervalMs = 30000,
  }) {
    this.isEnabled = isEnabled; // () => boolean
    this.getWindow = getWindow; // () => { start: "HH:MM", stop: "HH:MM" }
    this.isCapturing = isCapturing; // () => boolean
    this.startCapture = startCapture; // () => void
    this.stopCapture = stopCapture; // () => void
    this.intervalMs = intervalMs;
    this.timer = null;
    this._autoStarted = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    Logger.info("Scheduler", "Scheduler started", {
      intervalMs: this.intervalMs,
    });
    this.tick();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  _toMinutes(hhmm) {
    const [h, m] = String(hhmm).split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  _inWindow(start, stop) {
    const now = this._nowMinutes();
    const s = this._toMinutes(start);
    const e = this._toMinutes(stop);
    if (s === e) return false;
    if (s < e) return now >= s && now < e; // same-day window
    return now >= s || now < e; // overnight window
  }

  tick() {
    try {
      if (!this.isEnabled()) return;

      const { start, stop } = this.getWindow();
      const inWindow = this._inWindow(start, stop);
      const capturing = this.isCapturing();

      if (inWindow && !capturing) {
        Logger.info("Scheduler", "Within window - auto-starting capture", {
          start,
          stop,
        });
        this._autoStarted = true;
        this.startCapture();
      } else if (!inWindow && capturing && this._autoStarted) {
        Logger.info("Scheduler", "Outside window - auto-stopping capture", {
          start,
          stop,
        });
        this._autoStarted = false;
        this.stopCapture();
      }
    } catch (error) {
      Logger.error("Scheduler", "Tick error", { error: error.message });
    }
  }
}

module.exports = Scheduler;
