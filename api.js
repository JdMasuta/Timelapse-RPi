// api.js - Enhanced API with comprehensive configuration support
const socket = io(); // Connects to the Socket.IO server on the same host and port

// Event listeners for incoming data from the server
socket.on("statusUpdate", (data) => {
  document.getElementById("captureStatus").textContent = data.captureStatus;
  document.getElementById("imageCount").textContent = data.imageCount;
  document.getElementById("sessionTime").textContent = data.sessionTime;
  document.getElementById("nextCapture").textContent = data.nextCapture;

  // Update button states based on capture status
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  if (data.captureStatus === "Running") {
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

socket.on("configUpdate", (config) => {
  console.log("Received config update:", config);
  updateUIWithConfig(config);
});

socket.on("extendedConfigUpdate", (extendedConfig) => {
  console.log("Received extended config update:", extendedConfig);
  updateUIWithExtendedConfig(extendedConfig);
});

socket.on("systemInfoUpdate", (data) => {
  document.getElementById("memoryUsage").textContent = data.memoryUsage;
  document.getElementById("systemUptime").textContent = data.systemUptime;
  document.getElementById("streamStatus").textContent = data.streamStatus;
  document.getElementById("streamConnectionStatus").textContent =
    data.streamStatus === "Streaming" ? "🟢 Connected" : "🔴 Disconnected";
  document.getElementById("streamConnectionStatus").className =
    data.streamStatus === "Streaming"
      ? "stream-status connected"
      : "stream-status disconnected";
});

// MODIFIED: Now receives a stream URL instead of Base64 frames
socket.on("liveStreamUrl", (streamUrl) => {
  const liveStreamImg = document.getElementById("liveStream");
  const streamPlaceholder = document.getElementById("streamPlaceholder");
  const streamBtn = document.getElementById("streamBtn");

  if (streamUrl) {
    liveStreamImg.src = streamUrl;
    liveStreamImg.style.display = "block";
    streamPlaceholder.style.display = "none";
    streamBtn.textContent = "⏹️ Stop Preview";
    streamBtn.classList.remove("btn-primary");
    streamBtn.classList.add("btn-danger");
  } else {
    liveStreamImg.src = ""; // Clear the image source
    liveStreamImg.style.display = "none";
    streamPlaceholder.style.display = "flex"; // Show placeholder when stream stops
    streamBtn.textContent = "▶️ Start Preview";
    streamBtn.classList.remove("btn-danger");
    streamBtn.classList.add("btn-primary");
  }
});

socket.on("videoGenerationStatus", (data) => {
  const videoProgress = document.getElementById("videoProgress");
  const videoProgressFill = document.getElementById("videoProgressFill");
  const videoStatusText = document.getElementById("videoStatus");
  const generateBtn = document.getElementById("generateBtn");

  if (data.status === "in-progress") {
    videoProgress.style.display = "block";
    videoProgressFill.style.width = `${data.progress || 0}%`;
    videoStatusText.textContent = data.message;
    generateBtn.disabled = true;
  } else if (data.status === "complete") {
    videoProgressFill.style.width = "100%";
    videoStatusText.textContent = data.message;
    generateBtn.disabled = false;
    setTimeout(() => {
      videoProgress.style.display = "none"; // Hide progress after a short delay
    }, 3000);
  }
});

socket.on("notification", (data) => {
  showNotification(data.message, data.type);
});

socket.on("imageListUpdate", (imageList) => {
  const imagesList = document.getElementById("imagesList");

  if (imageList.length === 0) {
    imagesList.innerHTML = `
            <div class="empty-state">
                <div class="icon">📸</div>
                <p>No images captured yet</p>
            </div>
        `;
  } else {
    imagesList.innerHTML = imageList
      .map(
        (image) => `
            <div class="image-item">
                <div class="image-info">
                    <strong>${image.filename}</strong>
                    <div class="image-meta">
                        <span>Size: ${(image.size / 1024).toFixed(1)} KB</span>
                        <span>Created: ${new Date(
                          image.created
                        ).toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `
      )
      .join("");
  }
});

socket.on("imagesCleared", () => {
  document.getElementById("imagesList").innerHTML = `
        <div class="empty-state">
            <div class="icon">📸</div>
            <p>No images captured yet</p>
        </div>
    `;
});

/**
 * Update UI with basic configuration
 */
function updateUIWithConfig(config) {
  // Basic settings
  setElementValue("captureInterval", config.captureInterval);
  setElementValue("imageQuality", config.imageQuality);
  setElementValue("streamFps", config.streamFps);
  setElementValue("streamQuality", config.streamQuality);
  setElementValue("scheduleEnabled", config.scheduleEnabled);
  setElementValue("startTime", config.startTime);
  setElementValue("stopTime", config.stopTime);
  setElementValue("videoFps", config.videoFps);
  setElementValue("videoQuality", config.videoQuality);
}

/**
 * Update UI with extended configuration
 */
function updateUIWithExtendedConfig(extendedConfig) {
  // Update basic config first
  updateUIWithConfig(extendedConfig);

  // Extended settings
  setElementValue("videoCodec", extendedConfig.videoCodec);
  setElementValue("videoBitrate", extendedConfig.videoBitrate);
  setElementValue("cameraType", extendedConfig.cameraType);
  setElementValue("cameraDevice", extendedConfig.cameraDevice);
  setElementValue("resolutionWidth", extendedConfig.resolutionWidth);
  setElementValue("resolutionHeight", extendedConfig.resolutionHeight);
  setElementValue("rotation", extendedConfig.rotation);
  setElementValue("flipHorizontal", extendedConfig.flipHorizontal);
  setElementValue("flipVertical", extendedConfig.flipVertical);
  setElementValue("autoCleanup", extendedConfig.autoCleanup);
  setElementValue("maxImages", extendedConfig.maxImages);
  setElementValue("cleanupOlderThanDays", extendedConfig.cleanupOlderThanDays);
  setElementValue("autoGenerateVideo", extendedConfig.autoGenerateVideo);
  setElementValue(
    "enableHardwareAcceleration",
    extendedConfig.enableHardwareAcceleration
  );
  setElementValue("debugMode", extendedConfig.debugMode);
  setElementValue("logLevel", extendedConfig.logLevel);
  setElementValue("mockCamera", extendedConfig.mockCamera);
  setElementValue("maxStorageGb", extendedConfig.maxStorageGb);
}

/**
 * Helper function to set element value safely
 */
function setElementValue(elementId, value) {
  const element = document.getElementById(elementId);
  if (!element) {
    console.warn(`Element with ID '${elementId}' not found`);
    return;
  }

  if (element.type === "checkbox") {
    element.checked = Boolean(value);
  } else {
    element.value = value || "";
  }
}

/**
 * Get all configuration values from UI
 */
function getAllConfigValues() {
  return {
    // Basic settings
    captureInterval: parseInt(document.getElementById("captureInterval").value),
    imageQuality: document.getElementById("imageQuality").value,
    streamFps: parseInt(document.getElementById("streamFps").value),
    streamQuality: document.getElementById("streamQuality").value,
    scheduleEnabled: document.getElementById("scheduleEnabled").checked,
    startTime: document.getElementById("startTime").value,
    stopTime: document.getElementById("stopTime").value,
    videoFps: parseInt(document.getElementById("videoFps").value),
    videoQuality: document.getElementById("videoQuality").value,

    // Extended settings
    videoCodec: getElementValue("videoCodec"),
    videoBitrate: getElementValue("videoBitrate"),
    cameraType: getElementValue("cameraType"),
    cameraDevice: getElementValue("cameraDevice"),
    resolutionWidth: parseInt(getElementValue("resolutionWidth")),
    resolutionHeight: parseInt(getElementValue("resolutionHeight")),
    rotation: parseInt(getElementValue("rotation")),
    flipHorizontal: getElementChecked("flipHorizontal"),
    flipVertical: getElementChecked("flipVertical"),
    autoCleanup: getElementChecked("autoCleanup"),
    maxImages: parseInt(getElementValue("maxImages")),
    cleanupOlderThanDays: parseInt(getElementValue("cleanupOlderThanDays")),
    autoGenerateVideo: getElementChecked("autoGenerateVideo"),
    enableHardwareAcceleration: getElementChecked("enableHardwareAcceleration"),
    debugMode: getElementChecked("debugMode"),
    logLevel: getElementValue("logLevel"),
    mockCamera: getElementChecked("mockCamera"),
    maxStorageGb: parseInt(getElementValue("maxStorageGb")),
  };
}

/**
 * Helper function to get element value safely
 */
function getElementValue(elementId) {
  const element = document.getElementById(elementId);
  return element ? element.value : "";
}

/**
 * Helper function to get checkbox state safely
 */
function getElementChecked(elementId) {
  const element = document.getElementById(elementId);
  return element ? element.checked : false;
}

/**
 * Save configuration with enhanced error handling and feedback
 */
function saveConfig() {
  const configData = getAllConfigValues();

  // Add loading state
  const saveButton = document.querySelector(".config-actions .btn-primary");
  const originalText = saveButton.textContent;
  saveButton.textContent = "💾 Saving...";
  saveButton.disabled = true;
  saveButton.classList.add("loading");

  console.log("Saving extended configuration:", configData);

  // Emit extended configuration
  socket.emit("saveExtendedConfig", configData);

  // Reset button after timeout
  setTimeout(() => {
    saveButton.textContent = originalText;
    saveButton.disabled = false;
    saveButton.classList.remove("loading");
  }, 2000);
}

/**
 * Reset configuration to defaults
 */
function resetToDefaults() {
  if (
    confirm(
      "Are you sure you want to reset all settings to defaults? This action cannot be undone."
    )
  ) {
    socket.emit("resetConfigToDefaults");
    showNotification("Configuration reset to defaults", "info");
  }
}

/**
 * Request initial extended configuration
 */
function requestExtendedConfig() {
  socket.emit("requestExtendedConfig");
}

// Functions to emit commands to the server (existing functions)
function startCapture() {
  socket.emit("startCapture");
}

function stopCapture() {
  socket.emit("stopCapture");
}

function toggleStream() {
  socket.emit("toggleStream");
}

function generateVideo() {
  socket.emit("generateVideo");
}

function refreshImages() {
  socket.emit("refreshImages");
}

function clearImages() {
  socket.emit("clearImages");
}

function downloadImages() {
  socket.emit("downloadImages");
}

function refreshVideos() {
  socket.emit("refreshVideos");
}

// Request extended configuration on page load
document.addEventListener("DOMContentLoaded", () => {
  // Request extended configuration after a short delay to ensure socket is connected
  setTimeout(() => {
    requestExtendedConfig();
  }, 500);
});
