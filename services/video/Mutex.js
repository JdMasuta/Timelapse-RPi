// services/video/Mutex.js - Atomic Operations Mutex
// Extracted from VideoController.js with no logic changes

class Mutex {
  constructor() {
    this.locked = false;
    this.waiting = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.waiting.push(resolve);
      }
    });
  }

  release() {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next();
    } else {
      this.locked = false;
    }
  }

  isLocked() {
    return this.locked;
  }
}

module.exports = Mutex;
