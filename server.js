// Fully restored and queue-integrated server.js

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const CameraService = require("./services/cameraService");
const ConfigService = require("./services/configService");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const configService = new ConfigService();
let fullConfig;
let currentConfig;

function getServerIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => (v < 10 ? "0" + v : v)).join(":");
}

async function initializeApp() {
  try {
    fullConfig = await configService.loadConfig();
    currentConfig = configService.getLegacyConfig(fullConfig);

    const PORT = fullConfig.port;
    const SERVER_IP_ADDRESS = getServerIpAddress();

    app.use(express.static(path.join(__dirname)));
    const cameraService = new CameraService();

    io.on("connection", (socket) => {
      const updateStatus = () => {
        const status = cameraService.getStatus();
        io.emit("statusUpdate", {
          captureStatus: status.isCapturing ? "Running" : "Stopped",
          imageCount: status.imageCount,
          sessionTime: status.sessionTime,
          nextCapture: status.isCapturing
            ? `in ${currentConfig.captureInterval}s`
            : "--",
        });
      };

      updateStatus();

      socket.emit("configUpdate", currentConfig);
      try {
        const fullExtendedConfig = configService.getExtendedConfig(fullConfig);
        socket.emit("extendedConfigUpdate", fullExtendedConfig);
      } catch (err) {
        console.error("Failed to send extended config:", err);
      }

      if (cameraService.isStreamActive()) {
        socket.emit("streamStatusUpdate", "Streaming");
        socket.emit(
          "liveStreamUrl",
          `http://${SERVER_IP_ADDRESS}:8080/?action=stream`
        );
      } else {
        socket.emit("streamStatusUpdate", "Stopped");
        socket.emit("liveStreamUrl", "");
      }

      socket.on("saveConfig", async (config) => {
        try {
          await configService.updateConfig(config);
          fullConfig = await configService.loadConfig();
          currentConfig = configService.getLegacyConfig(fullConfig);
          io.emit("configUpdate", currentConfig);
          socket.emit("notification", {
            message: "Configuration saved!",
            type: "success",
          });
        } catch (err) {
          socket.emit("notification", {
            message: `Failed to save config: ${err.message}`,
            type: "error",
          });
        }
      });

      socket.on("saveExtendedConfig", async (extendedConfig) => {
        try {
          await configService.updateExtendedConfig(extendedConfig);
          fullConfig = await configService.loadConfig();
          currentConfig = configService.getLegacyConfig(fullConfig);
          const fullExtendedConfig =
            configService.getExtendedConfig(fullConfig);
          io.emit("configUpdate", currentConfig);
          io.emit("extendedConfigUpdate", fullExtendedConfig);
          socket.emit("notification", {
            message: "Extended config saved!",
            type: "success",
          });
          socket.emit("configSaved");
        } catch (err) {
          socket.emit("notification", {
            message: `Failed to save extended config: ${err.message}`,
            type: "error",
          });
        }
      });

      socket.on("resetConfigToDefaults", async () => {
        try {
          const defaultEnvContent = configService.generateDefaultEnvContent();
          await configService.writeEnvFile(
            configService.parseEnvContent(defaultEnvContent)
          );
          fullConfig = await configService.loadConfig();
          currentConfig = configService.getLegacyConfig(fullConfig);
          const fullExtendedConfig =
            configService.getExtendedConfig(fullConfig);
          io.emit("configUpdate", currentConfig);
          io.emit("extendedConfigUpdate", fullExtendedConfig);
          socket.emit("notification", {
            message: "Config reset to defaults.",
            type: "success",
          });
        } catch (err) {
          socket.emit("notification", {
            message: `Failed to reset config: ${err.message}`,
            type: "error",
          });
        }
      });

      socket.on("requestExtendedConfig", () => {
        try {
          const fullExtendedConfig =
            configService.getExtendedConfig(fullConfig);
          socket.emit("extendedConfigUpdate", fullExtendedConfig);
        } catch (err) {
          socket.emit("notification", {
            message: "Failed to get extended config.",
            type: "error",
          });
        }
      });

      socket.on("startCapture", async () => {
        if (!cameraService.getStatus().isCapturing) {
          await cameraService.startTimelapse(
            currentConfig,
            (data) => updateStatus(),
            (error) => {
              console.error("Timelapse error:", error);
              updateStatus();
              socket.emit("notification", {
                message: `Capture error: ${error.message}`,
                type: "error",
              });
            },
            (event, message) => {
              if (event === "stream-paused")
                io.emit("streamStatusUpdate", "Paused for capture");
              if (event === "stream-resumed" || event === "stream-ready") {
                io.emit("streamStatusUpdate", "Streaming");
                io.emit(
                  "liveStreamUrl",
                  `http://${SERVER_IP_ADDRESS}:8080/?action=stream`
                );
              }
              if (event === "stream-error") {
                io.emit("streamStatusUpdate", "Stopped");
                io.emit("liveStreamUrl", "");
              }
              socket.emit("notification", {
                message,
                type: event.includes("error") ? "error" : "info",
              });
            }
          );
        } else {
          socket.emit("notification", {
            message: "Capture is already running.",
            type: "info",
          });
        }
      });

      socket.on("stopCapture", () => {
        if (cameraService.stopTimelapse()) {
          updateStatus();
          socket.emit("notification", {
            message: "Timelapse stopped.",
            type: "success",
          });
        }
      });

      socket.on("toggleStream", async () => {
        try {
          if (!cameraService.isStreamActive()) {
            await cameraService.startStream(currentConfig, (event, message) => {
              if (event === "stream-ready") {
                io.emit("streamStatusUpdate", "Streaming");
                io.emit(
                  "liveStreamUrl",
                  `http://${SERVER_IP_ADDRESS}:8080/?action=stream`
                );
                socket.emit("notification", { message, type: "success" });
              } else if (event === "stream-error") {
                io.emit("streamStatusUpdate", "Stopped");
                io.emit("liveStreamUrl", "");
                socket.emit("notification", { message, type: "error" });
              } else if (event === "queued") {
                socket.emit("notification", { message, type: "info" });
              }
            });
          } else {
            await cameraService.stopStream();
            io.emit("streamStatusUpdate", "Stopped");
            io.emit("liveStreamUrl", "");
            socket.emit("notification", {
              message: "Stream stopped.",
              type: "success",
            });
          }
        } catch (err) {
          socket.emit("notification", { message: err.message, type: "error" });
        }
      });

      socket.on("generateVideo", async () => {
        try {
          io.emit("videoGenerationStatus", {
            status: "in-progress",
            message: "Generating video...",
          });
          const result = await cameraService.generateVideo(
            currentConfig,
            (progress) => {
              io.emit("videoGenerationStatus", {
                status: "in-progress",
                message: `Progress: ${progress}%`,
                progress,
              });
            }
          );
          io.emit("videoGenerationStatus", {
            status: "complete",
            message: `Video complete: ${result.filename}`,
          });
          socket.emit("notification", {
            message: `Video created: ${result.filename}`,
            type: "success",
          });
        } catch (err) {
          io.emit("videoGenerationStatus", {
            status: "error",
            message: `Error: ${err.message}`,
          });
          socket.emit("notification", {
            message: `Video generation failed: ${err.message}`,
            type: "error",
          });
        }
      });

      socket.on("refreshImages", async () => {
        try {
          const imageList = await cameraService.getImageList();
          io.emit("imageListUpdate", imageList);
          socket.emit("notification", {
            message: `Found ${imageList.length} images.`,
            type: "info",
          });
        } catch (err) {
          socket.emit("notification", {
            message: `Failed to refresh images: ${err.message}`,
            type: "error",
          });
        }
      });

      socket.on("clearImages", async () => {
        try {
          const cleared = await cameraService.clearImages();
          updateStatus();
          socket.emit("notification", {
            message: `Cleared ${cleared} images.`,
            type: "success",
          });
          io.emit("imagesCleared");
        } catch (err) {
          socket.emit("notification", {
            message: `Failed to clear images: ${err.message}`,
            type: "error",
          });
        }
      });

      socket.on("refreshVideos", async () => {
        try {
          const videoList = await cameraService.getVideoList();
          socket.emit("videoListUpdate", videoList);
          socket.emit("notification", {
            message: `Found ${videoList.length} videos.`,
            type: "info",
          });
        } catch (err) {
          socket.emit("notification", {
            message: `Failed to refresh videos: ${err.message}`,
            type: "error",
          });
        }
      });
    });

    server.listen(fullConfig.port, () => {
      console.log(`Server running on http://localhost:${fullConfig.port}`);
    });

    setInterval(() => {
      const memoryUsage = `${(
        process.memoryUsage().heapUsed /
        1024 /
        1024
      ).toFixed(2)} MB`;
      const uptime = formatTime(process.uptime());
      io.emit("systemInfoUpdate", {
        memoryUsage,
        systemUptime: uptime,
        streamStatus: cameraService.isStreamActive() ? "Streaming" : "Stopped",
      });
    }, 5000);
  } catch (err) {
    console.error("Initialization failed:", err);
    process.exit(1);
  }
}

initializeApp();
