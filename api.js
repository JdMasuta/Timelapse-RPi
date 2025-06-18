// api.js
const socket = io(); // Connects to the Socket.IO server on the same host and port

// Event listeners for incoming data from the server
socket.on('statusUpdate', (data) => {
    document.getElementById('captureStatus').textContent = data.captureStatus;
    document.getElementById('imageCount').textContent = data.imageCount;
    document.getElementById('sessionTime').textContent = data.sessionTime;
    document.getElementById('nextCapture').textContent = data.nextCapture;

    // Update button states based on capture status
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (data.captureStatus === 'Running') {
        startBtn.disabled = true;
        stopBtn.disabled = false;
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
});

socket.on('configUpdate', (config) => {
    // Update UI elements with received configuration
    document.getElementById('captureInterval').value = config.captureInterval;
    document.getElementById('imageQuality').value = config.imageQuality;
    document.getElementById('streamFps').value = config.streamFps;
    document.getElementById('streamQuality').value = config.streamQuality;
    document.getElementById('scheduleEnabled').checked = config.scheduleEnabled;
    document.getElementById('startTime').value = config.startTime;
    document.getElementById('stopTime').value = config.stopTime;
    document.getElementById('videoFps').value = config.videoFps;
    document.getElementById('videoQuality').value = config.videoQuality;
});

socket.on('systemInfoUpdate', (data) => {
    document.getElementById('memoryUsage').textContent = data.memoryUsage;
    document.getElementById('systemUptime').textContent = data.systemUptime;
    document.getElementById('streamStatus').textContent = data.streamStatus;
    document.getElementById('streamConnectionStatus').textContent = data.streamStatus === 'Streaming' ? '🟢 Connected' : '🔴 Disconnected';
    document.getElementById('streamConnectionStatus').className = data.streamStatus === 'Streaming' ? 'stream-status connected' : 'stream-status disconnected';
});

// MODIFIED: Now receives a stream URL instead of Base64 frames
socket.on('liveStreamUrl', (streamUrl) => {
    const liveStreamImg = document.getElementById('liveStream');
    const streamPlaceholder = document.getElementById('streamPlaceholder');
    const streamBtn = document.getElementById('streamBtn');

    if (streamUrl) {
        liveStreamImg.src = streamUrl;
        liveStreamImg.style.display = 'block';
        streamPlaceholder.style.display = 'none';
        streamBtn.textContent = '⏹️ Stop Preview';
        streamBtn.classList.remove('btn-primary');
        streamBtn.classList.add('btn-danger');
    } else {
        liveStreamImg.src = ''; // Clear the image source
        liveStreamImg.style.display = 'none';
        streamPlaceholder.style.display = 'flex'; // Show placeholder when stream stops
        streamBtn.textContent = '▶️ Start Preview';
        streamBtn.classList.remove('btn-danger');
        streamBtn.classList.add('btn-primary');
    }
});

socket.on('videoGenerationStatus', (data) => {
    const videoProgress = document.getElementById('videoProgress');
    const videoProgressFill = document.getElementById('videoProgressFill');
    const videoStatusText = document.getElementById('videoStatus');
    const generateBtn = document.getElementById('generateBtn');

    if (data.status === 'in-progress') {
        videoProgress.style.display = 'block';
        videoProgressFill.style.width = `${data.progress || 0}%`;
        videoStatusText.textContent = data.message;
        generateBtn.disabled = true;
    } else if (data.status === 'complete') {
        videoProgressFill.style.width = '100%';
        videoStatusText.textContent = data.message;
        generateBtn.disabled = false;
        setTimeout(() => {
            videoProgress.style.display = 'none'; // Hide progress after a short delay
        }, 3000);
    }
});

socket.on('notification', (data) => {
    showNotification(data.message, data.type);
});

socket.on('imageListUpdate', (imageList) => {
    const imagesList = document.getElementById('imagesList');
    
    if (imageList.length === 0) {
        imagesList.innerHTML = `
            <div class="empty-state">
                <div class="icon">📸</div>
                <p>No images captured yet</p>
            </div>
        `;
    } else {
        imagesList.innerHTML = imageList.map(image => `
            <div class="image-item">
                <div class="image-info">
                    <strong>${image.filename}</strong>
                    <div class="image-meta">
                        <span>Size: ${(image.size / 1024).toFixed(1)} KB</span>
                        <span>Created: ${new Date(image.created).toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }
});

socket.on('imagesCleared', () => {
    document.getElementById('imagesList').innerHTML = `
        <div class="empty-state">
            <div class="icon">📸</div>
            <p>No images captured yet</p>
        </div>
    `;
});

// Functions to emit commands to the server
function saveConfig() {
    const config = {
        captureInterval: parseInt(document.getElementById('captureInterval').value),
        imageQuality: document.getElementById('imageQuality').value,
        streamFps: parseInt(document.getElementById('streamFps').value),
        streamQuality: document.getElementById('streamQuality').value,
        scheduleEnabled: document.getElementById('scheduleEnabled').checked,
        startTime: document.getElementById('startTime').value,
        stopTime: document.getElementById('stopTime').value,
        videoFps: parseInt(document.getElementById('videoFps').value),
        videoQuality: document.getElementById('videoQuality').value
    };
    socket.emit('saveConfig', config);
}

function startCapture() {
    socket.emit('startCapture');
}

function stopCapture() {
    socket.emit('stopCapture');
}

function toggleStream() {
    socket.emit('toggleStream');
}

function generateVideo() {
    socket.emit('generateVideo');
}

function refreshImages() {
    socket.emit('refreshImages');
    // In a real app, the server would send back the list of images
    // For now, it just triggers a notification
}

function clearImages() {
    // Show a confirmation dialog (custom modal, as alert() is not allowed)
    showCustomConfirm('Are you sure you want to clear ALL captured images?', () => {
        socket.emit('clearImages');
    });
}

function refreshVideos() {
    socket.emit('refreshVideos');
    // In a real app, the server would send back the list of videos
    // For now, it just triggers a notification
}

// Function to simulate a custom confirmation modal
function showCustomConfirm(message, onConfirm) {
    // This is a simplified representation. In a real app, you'd create
    // a proper modal dialog in HTML/CSS/JS.
    console.log(`Confirmation: ${message}`);
    // For demonstration, we'll auto-confirm.
    // In a production app, you'd show a modal and wait for user input.
    if (confirm(message)) { // Using built-in confirm for now as a placeholder
        onConfirm();
    }
}
