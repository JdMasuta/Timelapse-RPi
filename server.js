// Enhanced server.js logging example - Add this logging enhancement to your server.js

// Add this enhanced logging class at the top of your server.js
class ServerLogger {
  static log(level, userId, method, message, context = {}) {
    const timestamp = new Date().toISOString();
    const userInfo = userId ? `[User:${userId.slice(-4)}]` : "[System]";
    const logData = {
      timestamp,
      userId,
      level,
      method,
      message,
      ...context,
    };

    const logLine = `[${timestamp}] ${level.toUpperCase()} ${userInfo} [${method}] ${message}`;
    if (Object.keys(context).length > 0) {
      console.log(logLine, JSON.stringify(context, null, 2));
    } else {
      console.log(logLine);
    }
  }

  static info(userId, method, message, context = {}) {
    this.log("info", userId, method, message, context);
  }

  static error(userId, method, message, context = {}) {
    this.log("error", userId, method, message, context);
  }

  static debug(userId, method, message, context = {}) {
    this.log("debug", userId, method, message, context);
  }

  static warn(userId, method, message, context = {}) {
    this.log("warn", userId, method, message, context);
  }
}

// Enhanced socket event handler with user tracking
// Replace your existing socket connection handler with this enhanced version:

io.on("connection", (socket) => {
  const userId = socket.id;
  const userShortId = userId.slice(-4);

  ServerLogger.info(userId, "connection", "User connected", {
    userAgent: socket.handshake.headers["user-agent"],
    ip: socket.handshake.address,
  });

  // Send current configuration to the newly connected client
  socket.emit("configUpdate", currentConfig);

  const fullExtendedConfig = configService.getExtendedConfig();
  socket.emit("extendedConfigUpdate", fullExtendedConfig);
  ServerLogger.info(userId, "connection", "Sent configuration to client");

  // Handle disconnection
  socket.on("disconnect", () => {
    ServerLogger.info(userId, "disconnect", "User disconnected");
  });

  // Enhanced toggle stream handler with detailed logging
  socket.on("toggleStream", async () => {
    ServerLogger.info(userId, "toggleStream", "Stream toggle requested", {
      currentlyActive: cameraService.isStreamActive(),
      currentOperation: cameraService.getStatus().currentOperation,
      queueLength: cameraService.getStatus().queueLength,
    });

    try {
      if (!cameraService.isStreamActive()) {
        ServerLogger.info(userId, "toggleStream", "Starting stream");

        // Start stream using centralized method
        await cameraService.startStream(currentConfig, (event, message) => {
          ServerLogger.debug(
            userId,
            "streamCallback",
            "Stream event received",
            {
              event,
              message,
            }
          );

          if (event === "stream-ready") {
            const streamUrl = `http://${SERVER_IP_ADDRESS}:8080/?action=stream`;
            io.emit("streamStatusUpdate", "Streaming");
            io.emit("liveStreamUrl", streamUrl);
            socket.emit("notification", {
              message: "Live preview started!",
              type: "success",
            });
            ServerLogger.info(
              userId,
              "streamCallback",
              "Stream ready notification sent",
              {
                streamUrl,
              }
            );
          } else if (event === "stream-error") {
            io.emit("streamStatusUpdate", "Stopped");
            io.emit("liveStreamUrl", "");
            socket.emit("notification", {
              message: `Stream error: ${message}`,
              type: "error",
            });
            ServerLogger.error(
              userId,
              "streamCallback",
              "Stream error occurred",
              {
                error: message,
              }
            );
          } else if (event === "stream-stopped") {
            io.emit("streamStatusUpdate", "Stopped");
            io.emit("liveStreamUrl", "");
            ServerLogger.info(
              userId,
              "streamCallback",
              "Stream stopped notification sent"
            );
          }
        });
      } else {
        ServerLogger.info(userId, "toggleStream", "Stopping stream");

        // Stop stream using centralized method
        await cameraService.stopStream();
        io.emit("streamStatusUpdate", "Stopped");
        io.emit("liveStreamUrl", "");
        socket.emit("notification", {
          message: "Live preview stopped.",
          type: "success",
        });
        ServerLogger.info(userId, "toggleStream", "Stream stop completed");
      }
    } catch (error) {
      ServerLogger.error(userId, "toggleStream", "Stream toggle failed", {
        error: error.message,
        stack: error.stack,
      });
      socket.emit("notification", {
        message: error.message,
        type: "error",
      });
    }
  });

  // Enhanced start capture handler
  socket.on("startCapture", async () => {
    const status = cameraService.getStatus();
    ServerLogger.info(userId, "startCapture", "Timelapse start requested", {
      currentStatus: status,
      config: currentConfig,
    });

    if (!status.isCapturing) {
      try {
        captureStatus = "Running";

        await cameraService.startTimelapse(
          currentConfig,
          // onImageCaptured callback
          (captureData) => {
            ServerLogger.debug(userId, "timelapseCallback", "Image captured", {
              imageCount: captureData.imageCount,
              sessionTime: captureData.sessionTime,
              filename: captureData.filename,
            });

            io.emit("statusUpdate", {
              captureStatus: "Running",
              imageCount: captureData.imageCount,
              sessionTime: captureData.sessionTime,
              nextCapture: `in ${currentConfig.captureInterval}s`,
            });
          },
          // onError callback
          (error) => {
            ServerLogger.error(
              userId,
              "timelapseCallback",
              "Timelapse capture error",
              {
                error: error.message,
              }
            );
            captureStatus = "Stopped";
            io.emit("statusUpdate", {
              captureStatus: "Stopped",
              imageCount: cameraService.getStatus().imageCount,
              sessionTime: cameraService.getStatus().sessionTime,
              nextCapture: "--",
            });
            socket.emit("notification", {
              message: `Capture failed: ${error.message}`,
              type: "error",
            });
          },
          // onStreamNotification callback
          (type, message) => {
            ServerLogger.debug(
              userId,
              "streamNotificationCallback",
              "Stream notification",
              {
                type,
                message,
              }
            );

            if (type === "stream-paused") {
              io.emit("streamStatusUpdate", "Paused for capture");
              io.emit("notification", { message, type: "info" });
            } else if (type === "stream-resumed") {
              io.emit("streamStatusUpdate", "Streaming");
              io.emit("notification", { message, type: "success" });
            } else if (type === "stream-ready") {
              const streamUrl = `http://${SERVER_IP_ADDRESS}:8080/?action=stream`;
              io.emit("streamStatusUpdate", "Streaming");
              io.emit("liveStreamUrl", streamUrl);
              io.emit("notification", { message, type: "success" });
            } else if (type === "stream-error") {
              io.emit("streamStatusUpdate", "Stopped");
              io.emit("liveStreamUrl", "");
              io.emit("notification", { message, type: "error" });
            }
          }
        );

        const newStatus = cameraService.getStatus();
        io.emit("statusUpdate", {
          captureStatus: "Running",
          imageCount: newStatus.imageCount,
          sessionTime: newStatus.sessionTime,
          nextCapture: `in ${currentConfig.captureInterval}s`,
        });

        socket.emit("notification", {
          message: "Time-lapse capture started with fswebcam!",
          type: "success",
        });

        ServerLogger.info(
          userId,
          "startCapture",
          "Timelapse started successfully",
          {
            newStatus,
          }
        );
      } catch (error) {
        ServerLogger.error(
          userId,
          "startCapture",
          "Failed to start timelapse",
          {
            error: error.message,
            stack: error.stack,
          }
        );
        captureStatus = "Stopped";
        socket.emit("notification", {
          message: `Failed to start capture: ${error.message}`,
          type: "error",
        });
      }
    } else {
      ServerLogger.warn(userId, "startCapture", "Capture already running");
      socket.emit("notification", {
        message: "Capture is already running.",
        type: "info",
      });
    }
  });

  // Enhanced stop capture handler
  socket.on("stopCapture", () => {
    ServerLogger.info(userId, "stopCapture", "Timelapse stop requested", {
      currentStatus: cameraService.getStatus(),
    });

    const stopped = cameraService.stopTimelapse();
    if (stopped) {
      captureStatus = "Stopped";
      const status = cameraService.getStatus();
      io.emit("statusUpdate", {
        captureStatus: "Stopped",
        imageCount: status.imageCount,
        sessionTime: status.sessionTime,
        nextCapture: "--",
      });
      socket.emit("notification", {
        message: "Time-lapse capture stopped.",
        type: "success",
      });
      ServerLogger.info(
        userId,
        "stopCapture",
        "Timelapse stopped successfully",
        {
          finalStatus: status,
        }
      );
    } else {
      ServerLogger.warn(userId, "stopCapture", "No timelapse was running");
      socket.emit("notification", {
        message: "No capture was running.",
        type: "info",
      });
    }
  });

  // Enhanced configuration update handler
  socket.on("updateConfig", async (newConfig) => {
    ServerLogger.info(
      userId,
      "updateConfig",
      "Configuration update requested",
      {
        newConfig,
        currentConfig,
      }
    );

    try {
      // Merge with current config to ensure all required fields are present
      currentConfig = { ...currentConfig, ...newConfig };

      // Save using ConfigService
      await configService.saveConfig(currentConfig);

      // Update all clients
      io.emit("configUpdate", currentConfig);
      socket.emit("notification", {
        message: "Configuration updated successfully!",
        type: "success",
      });

      ServerLogger.info(
        userId,
        "updateConfig",
        "Configuration updated successfully",
        {
          updatedConfig: currentConfig,
        }
      );
    } catch (error) {
      ServerLogger.error(
        userId,
        "updateConfig",
        "Failed to update configuration",
        {
          error: error.message,
          newConfig,
        }
      );
      socket.emit("notification", {
        message: `Failed to update configuration: ${error.message}`,
        type: "error",
      });
    }
  });

  // Add logging to other handlers as well...
  socket.on("requestStatus", () => {
    ServerLogger.debug(userId, "requestStatus", "Status requested");
    const status = cameraService.getStatus();
    socket.emit("statusUpdate", {
      captureStatus: status.isCapturing ? "Running" : "Stopped",
      imageCount: status.imageCount,
      sessionTime: status.sessionTime,
      nextCapture: status.isCapturing
        ? `in ${currentConfig.captureInterval}s`
        : "--",
    });
    ServerLogger.debug(userId, "requestStatus", "Status sent", { status });
  });

  socket.on("requestImages", async () => {
    ServerLogger.debug(userId, "requestImages", "Image list requested");
    try {
      const images = await cameraService.getImageList();
      socket.emit("imageList", images);
      ServerLogger.debug(userId, "requestImages", "Image list sent", {
        count: images.length,
      });
    } catch (error) {
      ServerLogger.error(userId, "requestImages", "Failed to get image list", {
        error: error.message,
      });
      socket.emit("notification", {
        message: `Failed to get images: ${error.message}`,
        type: "error",
      });
    }
  });

  socket.on("clearImages", async () => {
    ServerLogger.info(userId, "clearImages", "Image clear requested");
    try {
      const deletedCount = await cameraService.clearImages();
      socket.emit("notification", {
        message: `Deleted ${deletedCount} image(s).`,
        type: "success",
      });
      // Send updated image list
      const images = await cameraService.getImageList();
      io.emit("imageList", images);
      ServerLogger.info(userId, "clearImages", "Images cleared successfully", {
        deletedCount,
      });
    } catch (error) {
      ServerLogger.error(userId, "clearImages", "Failed to clear images", {
        error: error.message,
      });
      socket.emit("notification", {
        message: `Failed to clear images: ${error.message}`,
        type: "error",
      });
    }
  });

  // Log any unhandled events
  socket.onAny((eventName, ...args) => {
    if (!["requestStatus", "requestImages"].includes(eventName)) {
      ServerLogger.debug(userId, "unhandledEvent", "Received event", {
        eventName,
        args: args.length > 0 ? args : undefined,
      });
    }
  });
});

// Add this helper function to periodically log system status
setInterval(() => {
  const status = cameraService.getStatus();
  ServerLogger.debug(null, "systemStatus", "Periodic status check", {
    ...status,
    connectedClients: io.engine.clientsCount,
  });
}, 30000); // Log every 30 seconds
