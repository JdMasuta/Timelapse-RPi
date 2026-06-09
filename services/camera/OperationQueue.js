// services/camera/OperationQueue.js - Queue management logic

const Logger = require("./Logger");

/**
 * Minimal highest-priority-first queue. Replaces the external js-priority-queue
 * dependency: the workload is tiny (a handful of operations), so a sorted array is
 * more than sufficient and removes a dependency.
 */
class PriorityQueue {
  constructor() {
    this.items = [];
  }
  get length() {
    return this.items.length;
  }
  queue(item) {
    this.items.push(item);
    // Highest priority first; stable for equal priorities (insertion order preserved).
    this.items.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }
  dequeue() {
    return this.items.shift();
  }
  clear() {
    this.items = [];
  }
}

class OperationQueue {
  constructor() {
    this.queue = new PriorityQueue();

    this.currentOperation = null;
    this.operationStates = new Map();

    Logger.info("OperationQueue", "Queue initialized");
  }

  /**
   * Get current queue length
   */
  get length() {
    return this.queue.length;
  }

  /**
   * Check if there's a current operation
   */
  hasCurrentOperation() {
    return this.currentOperation !== null;
  }

  /**
   * Get current operation
   */
  getCurrentOperation() {
    return this.currentOperation;
  }

  /**
   * Set current operation
   */
  setCurrentOperation(operation) {
    this.currentOperation = operation;
    if (operation) {
      operation.markAsRunning();
      Logger.info(
        "OperationQueue",
        "Current operation set",
        operation.getSummary()
      );
    } else {
      Logger.info("OperationQueue", "Current operation cleared");
    }
  }

  /**
   * Add operation to queue
   */
  enqueue(operation) {
    if (!operation || !operation.isValid()) {
      Logger.error("OperationQueue", "Invalid operation enqueued", {
        operation,
      });
      return false;
    }

    this.queue.queue(operation);
    Logger.info("OperationQueue", "Operation enqueued", {
      ...operation.getSummary(),
      queueLength: this.queue.length,
    });
    return true;
  }

  /**
   * Remove and return next operation from queue
   */
  dequeue() {
    if (this.queue.length === 0) {
      Logger.debug("OperationQueue", "Dequeue called on empty queue");
      return null;
    }

    const operation = this.queue.dequeue();
    Logger.info("OperationQueue", "Operation dequeued", {
      ...operation?.getSummary(),
      remainingInQueue: this.queue.length,
    });
    return operation;
  }

  /**
   * Pause current operation and store it
   */
  pauseCurrentOperation() {
    if (!this.currentOperation) {
      Logger.debug("OperationQueue", "No current operation to pause");
      return null;
    }

    const op = this.currentOperation;
    op.markAsPaused();
    this.operationStates.set(op.timestamp, op);

    Logger.info("OperationQueue", "Operation paused", op.getSummary());

    this.currentOperation = null;
    return op;
  }

  /**
   * Check if operation should take priority over current operation
   */
  shouldTakePriority(newOperation) {
    if (!this.currentOperation) {
      return true; // No current operation, can start immediately
    }

    return newOperation.priority > this.currentOperation.priority;
  }

  /**
   * Get queue status for debugging
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      hasCurrentOperation: this.hasCurrentOperation(),
      currentOperation: this.currentOperation?.getSummary() || null,
      storedOperations: this.operationStates.size,
    };
  }

  /**
   * Clear all operations (for cleanup)
   */
  clear() {
    this.queue.clear();
    this.currentOperation = null;
    this.operationStates.clear();
    Logger.info("OperationQueue", "Queue cleared");
  }
}

module.exports = OperationQueue;
