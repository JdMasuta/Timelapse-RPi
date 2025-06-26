// app.js
// Any additional client-side application logic or initialization can go here.
console.log("RPi Time-Lapse Controller app.js loaded.");

// Enhanced existing generateVideo function
function generateVideo() {
  console.log("Starting video generation...");

  // Check if generation is already in progress
  const generateBtn = document.getElementById("generateBtn");
  if (generateBtn.disabled) {
    showNotification("Video generation already in progress", "warning");
    return;
  }

  // Show progress UI and disable button
  showVideoProgress();
  generateBtn.disabled = true;
  generateBtn.textContent = "⏳ Generating...";

  // Show cancel button
  const cancelBtn = document.getElementById("cancelBtn");
  if (cancelBtn) {
    cancelBtn.style.display = "inline-block";
  }

  // Emit generation request
  socket.emit("generateVideo");
}

// 🆕 New function to cancel video generation
function cancelVideoGeneration() {
  console.log("Cancelling video generation...");
  socket.emit("cancelVideoGeneration");

  // Update UI immediately
  const cancelBtn = document.getElementById("cancelBtn");
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = "⏳ Cancelling...";
  }
}

// 🆕 Generate quick preview video
function generateQuickVideo() {
  console.log("Starting quick video generation...");

  // Show progress UI
  showVideoProgress();

  // Emit quick generation request
  socket.emit("generateQuickVideo");

  showNotification("Generating quick preview...", "info");
}

// 🆕 Delete video function
function deleteVideo(filename) {
  if (confirm(`Are you sure you want to delete "${filename}"?`)) {
    console.log("Deleting video:", filename);
    socket.emit("deleteVideo", filename);
  }
}

// 🆕 Download video function
function downloadVideo(filename) {
  console.log("Downloading video:", filename);
  const downloadUrl = `/videos/${filename}`;

  // Create temporary download link
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showNotification(`Downloading ${filename}...`, "info");
}

// 🆕 Preview video function (open in new tab)
function previewVideo(filename) {
  console.log("Previewing video:", filename);
  const previewUrl = `/videos/${filename}/stream`;
  window.open(previewUrl, "_blank");
}

// Enhanced video generation status listener
socket.on("videoGenerationStatus", (data) => {
  console.log("Video generation status:", data);

  const { status, message, progress, result, error } = data;

  switch (status) {
    case "starting":
      updateVideoProgress(0, message);
      showNotification(message, "info");
      break;

    case "in-progress":
      updateVideoProgress(progress || 0, message);
      break;

    case "complete":
      updateVideoProgress(100, message);
      showNotification(message, "success");

      // Show result information
      if (result) {
        const resultMessage = `
            Video: ${result.filename}<br>
            Size: ${result.sizeFormatted}<br>
            Duration: ${result.duration}s<br>
            Processing time: ${Math.round(result.processingTime / 1000)}s
          `;
        showNotification(resultMessage, "success", 5000);
      }

      // Hide progress after delay
      setTimeout(() => {
        hideVideoProgress();
      }, 3000);

      // Refresh video list
      refreshVideos();
      break;

    case "error":
      updateVideoProgress(0, message);
      showNotification(message, "error");

      // Show error details if available
      if (error) {
        console.error("Video generation error details:", error);
      }

      // Hide progress after delay
      setTimeout(() => {
        hideVideoProgress();
      }, 3000);
      break;

    case "cancelled":
      updateVideoProgress(0, message);
      showNotification(message, "info");
      hideVideoProgress();
      break;
  }
});

// Video status updates
socket.on("videoStatusUpdate", (status) => {
  console.log("Video status update:", status);
  updateVideoStatus(status);
});

// Video list updates
socket.on("videoListUpdate", (videos) => {
  console.log("Video list update:", videos);
  updateVideoList(videos);
});

// Enhanced system info updates (modify existing listener)
socket.on("systemInfoUpdate", (data) => {
  document.getElementById("memoryUsage").textContent = data.memoryUsage;
  document.getElementById("systemUptime").textContent = data.systemUptime;
  document.getElementById("streamStatus").textContent = data.streamStatus;

  // Update video status if available
  if (data.videoStatus) {
    updateVideoStatus(data.videoStatus);
  }
});
