// server.js - Updated with enhanced video generation capabilities
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os"); // Import the 'os' module
const CameraService = require("./services/cameraService");
const ConfigService = require("./services/configService");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// IMPORTANT: Set the absolute path to your mjpg_streamer executable
// You might find it in /usr/local/bin/mjpg_streamer or within the directory you compiled it.
// Replace '/path/to/your/mjpg_streamer' with the actual path.
const MJPEG_STREAMER_PATH = "/usr/local/bin/mjpg_streamer"; // Common default install location
// If you compiled it in your home directory, it might be something like:
// const MJPEG_STREAMER_PATH = '/home/pi/mjpg-streamer/mjpg-streamer-experimental/mjpg_streamer';

// IMPORTANT: Set the absolute path to mjpeg-streamer's www directory
// This is crucial for the output_http.so plugin to serve its web interface (and the stream endpoint)
// It's often ./www relative to the mjpg_streamer executable, or /usr/local/share/mjpg-streamer/www/
const MJPEG_STREAMER_WWW_PATH = "/usr/local/share/mjpg-streamer/www/"; // Common default install location
// If you compiled it in your home directory, it might be something like:
// const MJPEG_STREAMER_WWW_PATH = '/home/pi/mjpg-streamer/mjpg-streamer-experimental/www/';

// Function to get the server's local IP address
function getServerIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      // Filter out internal (loopback) and non-IPv4 addresses
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost"; // Fallback if no external IP is found
}

// Helper function to format time (seconds to HH:MM:SS)
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => (v < 10 ? "0" + v : v)).join(":");
}

// Helper function to format file sizes
function formatFileSize(bytes) {
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (bytes === 0) return "0 Bytes";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
}

// Initialize configuration service
const configService = new ConfigService();
let fullConfig;
let currentConfig; // Legacy config format for web interface compatibility

// Initialize the application asynchronously
async function initializeApp() {
  try {
    // Load configuration from environment variables
    fullConfig = await configService.loadConfig();
    currentConfig = configService.getLegacyConfig(fullConfig);

    const PORT = fullConfig.port;
    const SERVER_IP_ADDRESS = getServerIpAddress();
    console.log(`Node.js server running on: ${SERVER_IP_ADDRESS}:${PORT}`);

    // Serve static files from the current directory
    app.use(express.static(path.join(__dirname)));

    // 🆕 Ensure videos directory exists
    const videosDir = path.join(__dirname, "videos");
    const fs = require("fs");
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
      console.log("Videos directory created:", videosDir);
    }

    // 🆕 Video file serving routes
    app.get("/videos/:filename", (req, res) => {
      const filename = req.params.filename;

      // Security: Validate filename
      if (!filename || filename.includes("..") || filename.includes("/")) {
        return res.status(400).json({ error: "Invalid filename" });
      }

      const videoPath = path.join(__dirname, "videos", filename);

      // Check if file exists
      if (!fs.existsSync(videoPath)) {
        return res.status(404).json({ error: "Video not found" });
      }

      // Set appropriate headers for video download
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      // Stream the video file
      const stream = fs.createReadStream(videoPath);
      stream.on("error", (error) => {
        console.error("Error streaming video:", error);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream video" });
        }
      });

      stream.pipe(res);
    });

    // 🆕 Video streaming for preview
    app.get("/videos/:filename/stream", (req, res) => {
      const filename = req.params.filename;

      // Security validation
      if (!filename || filename.includes("..") || filename.includes("/")) {
        return res.status(400).json({ error: "Invalid filename" });
      }

      const videoPath = path.join(__dirname, "videos", filename);

      if (!fs.existsSync(videoPath)) {
        return res.status(404).json({ error: "Video not found" });
      }

      const stat = fs.statSync(videoPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        // Support range requests for video seeking
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(videoPath, { start, end });
        const head = {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "video/mp4",
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        // Full file stream
        const head = {
          "Content-Length": fileSize,
          "Content-Type": "video/mp4",
        };
        res.writeHead(200, head);
        fs.createReadStream(videoPath).pipe(res);
      }
    });

    // Initialize camera service with full config
    const cameraService = new CameraService();
    let captureStatus = "Stopped";

    // --- Socket.IO Connection Handling ---
    io.on("connection", (socket) => {
      console.log("A user connected:", socket.id);

      // Send initial status and config to the newly connected client
      const status = cameraService.getStatus();
      socket.emit("statusUpdate", {
        captureStatus: status.isCapturing ? "Running" : "Stopped",
        imageCount: status.imageCount,
        sessionTime: status.sessionTime,
        nextCapture: status.isCapturing
          ? `in ${currentConfig.captureInterval}s`
          : "--",
      });
      socket.emit("configUpdate", currentConfig);

      // Send extended configuration to new clients
      try {
        const fullExtendedConfig = configService.getExtendedConfig(fullConfig);
        socket.emit("extendedConfigUpdate", fullExtendedConfig);
      } catch (error) {
        console.error("Error sending initial extended config:", error);
      }

      // Also send the current stream status and URL if streaming is active
      if (cameraService.isStreamActive()) {
        socket.emit("streamStatusUpdate", "Streaming");
        // Now using the server's actual IP address
        socket.emit(
          "liveStreamUrl",
          `http://${SERVER_IP_ADDRESS}:8080/?action=stream`
        );
      } else {
        socket.emit("streamStatusUpdate", "Stopped");
        socket.emit("liveStreamUrl", ""); // Clear URL if not streaming
      }

      // Handle config saving with persistence
      socket.on("saveConfig", async (config) => {
        try {
          console.log("Saving config:", config);

          // Update configuration persistently using ConfigService
          await configService.updateConfig(config);

          // Reload the full configuration
          fullConfig = await configService.loadConfig();
          currentConfig = configService.getLegacyConfig(fullConfig);

          // Update all clients with new config
          io.emit("configUpdate", currentConfig);
          socket.emit("notification", {
            message: "Configuration saved and persisted!",
            type: "success",
          });
        } catch (error) {
          console.error("Error saving configuration:", error);
          socket.emit("notification", {
            message: `Failed to save configuration: ${error.message}`,
            type: "error",
          });
        }
      });

      // Handle extended config saving with full validation
      socket.on("saveExtendedConfig", async (extendedConfig) => {
        try {
          console.log("Saving extended config:", extendedConfig);

          // Update configuration persistently using ConfigService
          await configService.updateExtendedConfig(extendedConfig);

          // Reload the full configuration
          fullConfig = await configService.loadConfig();
          currentConfig = configService.getLegacyConfig(fullConfig);
          const fullExtendedConfig =
            configService.getExtendedConfig(fullConfig);

          // Update all clients with new config
          io.emit("configUpdate", currentConfig);
          io.emit("extendedConfigUpdate", fullExtendedConfig);
          socket.emit("notification", {
            message: "Extended configuration saved and persisted!",
            type: "success",
          });
          socket.emit("configSaved"); // Signal successful save
        } catch (error) {
          console.error("Error saving extended configuration:", error);
          socket.emit("notification", {
            message: `Failed to save extended configuration: ${error.message}`,
            type: "error",
          });
        }
      });

      // Handle request for extended configuration
      socket.on("requestExtendedConfig", () => {
        try {
          const fullExtendedConfig =
            configService.getExtendedConfig(fullConfig);
          socket.emit("extendedConfigUpdate", fullExtendedConfig);
          console.log("Sent extended configuration to client");
        } catch (error) {
          console.error("Error sending extended configuration:", error);
          socket.emit("notification", {
            message: "Failed to load extended configuration",
            type: "error",
          });
        }
      });

      // Handle reset to defaults
      socket.on("resetConfigToDefaults", async () => {
        try {
          console.log("Resetting configuration to defaults...");

          // Generate default .env content
          const defaultEnvContent = configService.generateDefaultEnvContent();
          await configService.writeEnvFile(
            configService.parseEnvContent(defaultEnvContent)
          );

          // Reload configuration
          fullConfig = await configService.loadConfig();
          currentConfig = configService.getLegacyConfig(fullConfig);
          const fullExtendedConfig =
            configService.getExtendedConfig(fullConfig);

          // Update all clients
          io.emit("configUpdate", currentConfig);
          io.emit("extendedConfigUpdate", fullExtendedConfig);
          socket.emit("notification", {
            message: "Configuration reset to defaults!",
            type: "success",
          });
        } catch (error) {
          console.error("Error resetting configuration:", error);
          socket.emit("notification", {
            message: `Failed to reset configuration: ${error.message}`,
            type: "error",
          });
        }
      });

      // Handle start capture command
      socket.on("startCapture", async () => {
        const status = cameraService.getStatus();
        if (!status.isCapturing) {
          try {
            captureStatus = "Running";

            // No need to manually set stream process - CameraService manages it internally

            await cameraService.startTimelapse(
              currentConfig,
              // onImageCaptured callback
              (captureData) => {
                io.emit("statusUpdate", {
                  captureStatus: "Running",
                  imageCount: captureData.imageCount,
                  sessionTime: captureData.sessionTime,
                  nextCapture: `in ${currentConfig.captureInterval}s`,
                });
              },
              // onError callback
              (error) => {
                console.error("Timelapse capture error:", error);
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
                if (type === "stream-paused") {
                  io.emit("streamStatusUpdate", "Paused for capture");
                  io.emit("notification", { message, type: "info" });
                } else if (type === "stream-resumed") {
                  io.emit("streamStatusUpdate", "Streaming");
                  io.emit("notification", { message, type: "success" });
                } else if (type === "stream-ready") {
                  // New handler for when stream is actually ready
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
          } catch (error) {
            console.error("Failed to start timelapse:", error);
            captureStatus = "Stopped";
            socket.emit("notification", {
              message: `Failed to start capture: ${error.message}`,
              type: "error",
            });
          }
        } else {
          socket.emit("notification", {
            message: "Capture is already running.",
            type: "info",
          });
        }
      });

      // Handle stop capture command
      socket.on("stopCapture", () => {
        const status = cameraService.getStatus();
        if (status.isCapturing) {
          console.log("Stopping timelapse capture...");
          const stopped = cameraService.stopTimelapse();

          if (stopped) {
            captureStatus = "Stopped";
            const finalStatus = cameraService.getStatus();

            io.emit("statusUpdate", {
              captureStatus: "Stopped",
              imageCount: finalStatus.imageCount,
              sessionTime: finalStatus.sessionTime,
              nextCapture: "--",
            });
            socket.emit("notification", {
              message: "Time-lapse capture stopped.",
              type: "success",
            });
          }
        } else {
          socket.emit("notification", {
            message: "Capture is not running.",
            type: "info",
          });
        }
      });

      // Handle toggle stream command
      let streamReadyEmitted = false; // Flag to prevent multiple URL emissions
      socket.on("toggleStream", async () => {
        try {
          if (!cameraService.isStreamActive()) {
            // Start stream using centralized method
            await cameraService.startStream(currentConfig, (event, message) => {
              if (event === "stream-ready") {
                const streamUrl = `http://${SERVER_IP_ADDRESS}:8080/?action=stream`;
                io.emit("streamStatusUpdate", "Streaming");
                io.emit("liveStreamUrl", streamUrl);
                socket.emit("notification", {
                  message: "Live preview started!",
                  type: "success",
                });
                streamReadyEmitted = true;
              } else if (event === "stream-error") {
                io.emit("streamStatusUpdate", "Stopped");
                io.emit("liveStreamUrl", "");
                socket.emit("notification", {
                  message: `Stream error: ${message}`,
                  type: "error",
                });
              } else if (event === "stream-stopped") {
                io.emit("streamStatusUpdate", "Stopped");
                io.emit("liveStreamUrl", "");
                streamReadyEmitted = false;
              }
            });
          } else {
            // Stop stream using centralized method
            await cameraService.stopStream();
            io.emit("streamStatusUpdate", "Stopped");
            io.emit("liveStreamUrl", "");
            socket.emit("notification", {
              message: "Live preview stopped.",
              type: "success",
            });
            streamReadyEmitted = false;
          }
        } catch (error) {
          console.error("Stream toggle error:", error);
          socket.emit("notification", {
            message: error.message,
            type: "error",
          });
        }
      });

      // ============================================================================
      // 🆕 ENHANCED VIDEO GENERATION SOCKET HANDLERS
      // ============================================================================

      // Enhanced existing video generation handler
      socket.on("generateVideo", async () => {
        try {
          console.log("Generating video with enhanced VideoController...");

          // Check availability first
          const availability =
            await cameraService.checkVideoGenerationAvailable();
          if (!availability.available) {
            socket.emit("notification", {
              message: availability.message,
              type: "error",
            });
            io.emit("videoGenerationStatus", {
              status: "error",
              message: availability.message,
            });
            return;
          }

          // Emit initial status
          io.emit("videoGenerationStatus", {
            status: "starting",
            message: `Starting video generation from ${availability.imageCount} images...`,
            imageCount: availability.imageCount,
          });

          // Generate video with progress tracking
          const result = await cameraService.generateVideo(
            currentConfig,
            (progress) => {
              // Emit progress updates (throttled by VideoController)
              io.emit("videoGenerationStatus", {
                status: "in-progress",
                message: `Generating video: ${progress}%`,
                progress: progress,
              });
            }
          );

          // Emit completion status
          io.emit("videoGenerationStatus", {
            status: "complete",
            message: `Video generation complete!`,
            result: {
              filename: result.filename,
              downloadUrl: result.downloadUrl,
              size: result.size,
              sizeFormatted: formatFileSize(result.size),
              duration: result.duration,
              frameCount: result.frameCount,
              processingTime: result.processingTime,
              metadata: result.metadata,
            },
          });

          // Send success notification
          socket.emit("notification", {
            message: `Time-lapse video generated: ${result.filename}`,
            type: "success",
          });

          // Refresh video list for all clients
          try {
            const videoList = await cameraService.getVideoList();
            io.emit("videoListUpdate", videoList);
          } catch (error) {
            console.error(
              "Error refreshing video list after generation:",
              error
            );
          }
        } catch (error) {
          console.error("Video generation failed:", error);

          // Emit error status
          io.emit("videoGenerationStatus", {
            status: "error",
            message: `Video generation failed: ${error.message}`,
            error: {
              code: error.code,
              phase: error.phase,
              processingTime: error.processingTime,
            },
          });

          // Send error notification
          socket.emit("notification", {
            message: `Video generation failed: ${error.message}`,
            type: "error",
          });
        }
      });

      // 🆕 Cancel video generation
      socket.on("cancelVideoGeneration", async () => {
        try {
          console.log("Cancelling video generation...");

          const cancelled = await cameraService.cancelVideoGeneration();

          if (cancelled) {
            io.emit("videoGenerationStatus", {
              status: "cancelled",
              message: "Video generation cancelled by user",
            });

            socket.emit("notification", {
              message: "Video generation cancelled successfully",
              type: "info",
            });
          } else {
            socket.emit("notification", {
              message: "No video generation in progress to cancel",
              type: "warning",
            });
          }
        } catch (error) {
          console.error("Error cancelling video generation:", error);
          socket.emit("notification", {
            message: `Failed to cancel video generation: ${error.message}`,
            type: "error",
          });
        }
      });

      // 🆕 Get video processing status
      socket.on("getVideoStatus", () => {
        try {
          const videoStatus = cameraService.getVideoProcessingStatus();
          socket.emit("videoStatusUpdate", videoStatus);
        } catch (error) {
          console.error("Error getting video status:", error);
          socket.emit("notification", {
            message: "Failed to get video status",
            type: "error",
          });
        }
      });

      // 🆕 Delete video file
      socket.on("deleteVideo", async (filename) => {
        try {
          console.log("Deleting video:", filename);

          const deleted = await cameraService.deleteVideo(filename);

          if (deleted) {
            socket.emit("notification", {
              message: `Video '${filename}' deleted successfully`,
              type: "success",
            });

            // Refresh video list for all clients
            try {
              const videoList = await cameraService.getVideoList();
              io.emit("videoListUpdate", videoList);
            } catch (error) {
              console.error(
                "Error refreshing video list after deletion:",
                error
              );
            }
          } else {
            socket.emit("notification", {
              message: `Failed to delete video '${filename}'`,
              type: "error",
            });
          }
        } catch (error) {
          console.error("Error deleting video:", error);
          socket.emit("notification", {
            message: `Error deleting video: ${error.message}`,
            type: "error",
          });
        }
      });

      // 🆕 Quick video generation (low quality for preview)
      socket.on("generateQuickVideo", async () => {
        try {
          console.log("Generating quick preview video...");

          // Check availability
          const availability =
            await cameraService.checkVideoGenerationAvailable();
          if (!availability.available) {
            socket.emit("notification", {
              message: availability.message,
              type: "error",
            });
            return;
          }

          // Override config for quick generation
          const quickConfig = {
            ...currentConfig,
            videoFps: 15,
            videoQuality: "low",
            videoCodec: "h264",
          };

          io.emit("videoGenerationStatus", {
            status: "starting",
            message: "Starting quick preview generation...",
            type: "preview",
          });

          const result = await cameraService.generateVideo(
            quickConfig,
            (progress) => {
              io.emit("videoGenerationStatus", {
                status: "in-progress",
                message: `Generating preview: ${progress}%`,
                progress: progress,
                type: "preview",
              });
            }
          );

          io.emit("videoGenerationStatus", {
            status: "complete",
            message: "Quick preview generated!",
            result: result,
            type: "preview",
          });

          socket.emit("notification", {
            message: `Quick preview generated: ${result.filename}`,
            type: "success",
          });

          // Refresh video list
          try {
            const videoList = await cameraService.getVideoList();
            io.emit("videoListUpdate", videoList);
          } catch (error) {
            console.error(
              "Error refreshing video list after quick generation:",
              error
            );
          }
        } catch (error) {
          console.error("Quick video generation failed:", error);
          io.emit("videoGenerationStatus", {
            status: "error",
            message: `Quick preview failed: ${error.message}`,
            type: "preview",
          });
        }
      });

      // 🆕 Get video generation capabilities
      socket.on("getVideoCapabilities", () => {
        try {
          const capabilities = {
            codecs: ["h264", "h265"],
            qualities: ["low", "medium", "high", "ultra"],
            fpsRange: { min: 0.1, max: 120 },
            bitrateOptions: ["1M", "2M", "5M", "10M", "20M"],
            maxConcurrentJobs: 1,
            supportedFormats: ["mp4"],
          };

          socket.emit("videoCapabilities", capabilities);
        } catch (error) {
          console.error("Error getting video capabilities:", error);
          socket.emit("notification", {
            message: "Failed to get video capabilities",
            type: "error",
          });
        }
      });

      // Handle image refresh
      socket.on("refreshImages", async () => {
        try {
          console.log("Refreshing images...");
          const imageList = await cameraService.getImageList();
          io.emit("imageListUpdate", imageList); // Send to all clients
          socket.emit("notification", {
            message: `Found ${imageList.length} images.`,
            type: "info",
          });
        } catch (error) {
          console.error("Failed to refresh images:", error);
          socket.emit("notification", {
            message: `Failed to refresh images: ${error.message}`,
            type: "error",
          });
        }
      });

      // Handle clear images
      socket.on("clearImages", async () => {
        try {
          console.log("Clearing images...");
          const clearedCount = await cameraService.clearImages();

          // Update status with current camera service state
          const status = cameraService.getStatus();
          io.emit("statusUpdate", {
            captureStatus: status.isCapturing ? "Running" : "Stopped",
            imageCount: status.imageCount,
            sessionTime: status.sessionTime,
            nextCapture: status.isCapturing
              ? `in ${currentConfig.captureInterval}s`
              : "--",
          });

          socket.emit("notification", {
            message: `Cleared ${clearedCount} images!`,
            type: "success",
          });
          io.emit("imagesCleared");
        } catch (error) {
          console.error("Failed to clear images:", error);
          socket.emit("notification", {
            message: `Failed to clear images: ${error.message}`,
            type: "error",
          });
        }
      });

      // Images download handler
      socket.on("downloadImages", async () => {
        try {
          console.log("Downloading images...");

          // Get the list of images
          const imageList = await cameraService.getImageList();
          if (imageList.length === 0) {
            socket.emit("notification", {
              message: "No images available for download.",
              type: "info",
            });
            return;
          }

          // Create a zip file of all images
          const zipFilePath = await cameraService.createImageZip();

          // Emit the download URL
          socket.emit("imageDownloadReady", {
            url: `/images/download/${path.basename(zipFilePath)}`,
            filename: path.basename(zipFilePath),
          });

          socket.emit("notification", {
            message: "Images zipped and ready for download!",
            type: "success",
          });
        } catch (error) {
          console.error("Failed to download images:", error);
          socket.emit("notification", {
            message: `Failed to download images: ${error.message}`,
            type: "error",
          });
        }
      });

      socket.on("imageDownloadReady", (url, filename) => {
        console.log("Image download ready:", url, filename);
      });

      // Enhanced existing video refresh handler
      socket.on("refreshVideos", async () => {
        try {
          console.log("Refreshing videos with enhanced metadata...");
          const videoList = await cameraService.getVideoList();
          socket.emit("videoListUpdate", videoList);
          socket.emit("notification", {
            message: `Found ${videoList.length} videos.`,
            type: "info",
          });
        } catch (error) {
          console.error("Failed to refresh videos:", error);
          socket.emit("notification", {
            message: `Failed to refresh videos: ${error.message}`,
            type: "error",
          });
        }
      });

      socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        // No socket-specific cleanup needed with camera service
      });
    });

    // Start the server
    server.listen(fullConfig.port, () => {
      console.log(`Server listening on port ${fullConfig.port}`);
      console.log(`Open your browser to http://localhost:${fullConfig.port}`);
    });

    // --- Enhanced System Info with Video Status ---
    let systemInfoInterval = setInterval(() => {
      const memoryUsage = `${(
        process.memoryUsage().heapUsed /
        1024 /
        1024
      ).toFixed(2)} MB`;
      const uptimeSeconds = process.uptime();
      const systemUptime = formatTime(uptimeSeconds);

      // Get enhanced status including video processing
      const fullStatus = cameraService.getStatus();

      io.emit("systemInfoUpdate", {
        memoryUsage: memoryUsage,
        systemUptime: systemUptime,
        streamStatus: cameraService.isStreamActive() ? "Streaming" : "Stopped",
        // Add video processing status
        videoStatus: fullStatus.videoProcessing,
      });
    }, 5000); // Update every 5 seconds

    // ============================================================================
    // 🆕 GRACEFUL SHUTDOWN ENHANCEMENT
    // ============================================================================

    // Add graceful shutdown handling with video processing cleanup
    const gracefulShutdown = async (signal) => {
      console.log(`${signal} received, shutting down gracefully...`);

      // Cancel any ongoing video generation
      try {
        await cameraService.cancelVideoGeneration();
        console.log("Video generation cancelled during shutdown");
      } catch (error) {
        console.error(
          "Error cancelling video generation during shutdown:",
          error
        );
      }

      // Cleanup camera service
      cameraService.cleanup();

      // Clear intervals
      clearInterval(systemInfoInterval);

      // Close server
      server.close(() => {
        console.log("Server closed");
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        console.log("Forced shutdown after timeout");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  } catch (error) {
    console.error("Failed to initialize application:", error);
    process.exit(1);
  }
}

// Start the application
initializeApp();
