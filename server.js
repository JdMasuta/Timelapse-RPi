// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os'); // Import the 'os' module
const CameraService = require('./services/cameraService');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// IMPORTANT: Set the absolute path to your mjpg_streamer executable
// You might find it in /usr/local/bin/mjpg_streamer or within the directory you compiled it.
// Replace '/path/to/your/mjpg_streamer' with the actual path.
const MJPEG_STREAMER_PATH = '/usr/local/bin/mjpg_streamer'; // Common default install location
// If you compiled it in your home directory, it might be something like:
// const MJPEG_STREAMER_PATH = '/home/pi/mjpg-streamer/mjpg-streamer-experimental/mjpg_streamer';

// IMPORTANT: Set the absolute path to mjpeg-streamer's www directory
// This is crucial for the output_http.so plugin to serve its web interface (and the stream endpoint)
// It's often ./www relative to the mjpg_streamer executable, or /usr/local/share/mjpg-streamer/www/
const MJPEG_STREAMER_WWW_PATH = '/usr/local/share/mjpg-streamer/www/'; // Common default install location
// If you compiled it in your home directory, it might be something like:
// const MJPEG_STREAMER_WWW_PATH = '/home/pi/mjpg-streamer/mjpg-streamer-experimental/www/';

// Function to get the server's local IP address
function getServerIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            // Filter out internal (loopback) and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost'; // Fallback if no external IP is found
}

const SERVER_IP_ADDRESS = getServerIpAddress();
console.log(`Node.js server running on: ${SERVER_IP_ADDRESS}:${PORT}`);


// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Store current configuration
let currentConfig = {
    captureInterval: 5,
    imageQuality: 'high',
    streamFps: 15,
    streamQuality: 'medium', // This will now map to mjpeg-streamer resolution
    scheduleEnabled: false,
    startTime: '08:00',
    stopTime: '18:00',
    videoFps: 30,
    videoQuality: 'medium'
};

// Initialize camera service
const cameraService = new CameraService();
let captureStatus = 'Stopped';

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Send initial status and config to the newly connected client
    const status = cameraService.getStatus();
    socket.emit('statusUpdate', {
        captureStatus: status.isCapturing ? 'Running' : 'Stopped',
        imageCount: status.imageCount,
        sessionTime: status.sessionTime,
        nextCapture: status.isCapturing ? `in ${currentConfig.captureInterval}s` : '--'
    });
    socket.emit('configUpdate', currentConfig);
    // Also send the current stream status and URL if streaming is active
    if (cameraService.isStreamActive()) {
        socket.emit('streamStatusUpdate', 'Streaming');
        // Now using the server's actual IP address
        socket.emit('liveStreamUrl', `http://${SERVER_IP_ADDRESS}:8080/?action=stream`);
    } else {
        socket.emit('streamStatusUpdate', 'Stopped');
        socket.emit('liveStreamUrl', ''); // Clear URL if not streaming
    }


    // Handle config saving
    socket.on('saveConfig', (config) => {
        console.log('Saving config:', config);
        // Update currentConfig only with values that are actually present and valid
        currentConfig.captureInterval = parseInt(config.captureInterval);
        currentConfig.imageQuality = config.imageQuality;
        currentConfig.streamFps = parseInt(config.streamFps);
        currentConfig.streamQuality = config.streamQuality;
        currentConfig.scheduleEnabled = config.scheduleEnabled;
        currentConfig.startTime = config.startTime;
        currentConfig.stopTime = config.stopTime;
        currentConfig.videoFps = parseInt(config.videoFps);
        currentConfig.videoQuality = config.videoQuality;
        
        io.emit('configUpdate', currentConfig); // Update all clients with new config
        socket.emit('notification', { message: 'Configuration saved!', type: 'success' });
    });

    // Handle start capture command
    socket.on('startCapture', async () => {
        const status = cameraService.getStatus();
        if (!status.isCapturing) {
            try {
                captureStatus = 'Running';
                
                // No need to manually set stream process - CameraService manages it internally
                
                await cameraService.startTimelapse(
                    currentConfig,
                    // onImageCaptured callback
                    (captureData) => {
                        io.emit('statusUpdate', {
                            captureStatus: 'Running',
                            imageCount: captureData.imageCount,
                            sessionTime: captureData.sessionTime,
                            nextCapture: `in ${currentConfig.captureInterval}s`
                        });
                    },
                    // onError callback
                    (error) => {
                        console.error('Timelapse capture error:', error);
                        captureStatus = 'Stopped';
                        io.emit('statusUpdate', {
                            captureStatus: 'Stopped',
                            imageCount: cameraService.getStatus().imageCount,
                            sessionTime: cameraService.getStatus().sessionTime,
                            nextCapture: '--'
                        });
                        socket.emit('notification', { 
                            message: `Capture failed: ${error.message}`, 
                            type: 'error' 
                        });
                    },
                    // onStreamNotification callback
                    (type, message) => {
                        if (type === 'stream-paused') {
                            io.emit('streamStatusUpdate', 'Paused for capture');
                            io.emit('notification', { message, type: 'info' });
                        } else if (type === 'stream-resumed') {
                            io.emit('streamStatusUpdate', 'Streaming');
                            io.emit('notification', { message, type: 'success' });
                        } else if (type === 'stream-ready') {
                            // New handler for when stream is actually ready
                            const streamUrl = `http://${SERVER_IP_ADDRESS}:8080/?action=stream`;
                            io.emit('streamStatusUpdate', 'Streaming');
                            io.emit('liveStreamUrl', streamUrl);
                            io.emit('notification', { message, type: 'success' });
                        } else if (type === 'stream-error') {
                            io.emit('streamStatusUpdate', 'Stopped');
                            io.emit('liveStreamUrl', '');
                            io.emit('notification', { message, type: 'error' });
                        }
                    }
                );

                const newStatus = cameraService.getStatus();
                io.emit('statusUpdate', {
                    captureStatus: 'Running',
                    imageCount: newStatus.imageCount,
                    sessionTime: newStatus.sessionTime,
                    nextCapture: `in ${currentConfig.captureInterval}s`
                });
                socket.emit('notification', { message: 'Time-lapse capture started with fswebcam!', type: 'success' });
            } catch (error) {
                console.error('Failed to start timelapse:', error);
                captureStatus = 'Stopped';
                socket.emit('notification', { 
                    message: `Failed to start capture: ${error.message}`, 
                    type: 'error' 
                });
            }
        } else {
            socket.emit('notification', { message: 'Capture is already running.', type: 'info' });
        }
    });

    // Handle stop capture command
    socket.on('stopCapture', () => {
        const status = cameraService.getStatus();
        if (status.isCapturing) {
            console.log('Stopping timelapse capture...');
            const stopped = cameraService.stopTimelapse();
            
            if (stopped) {
                captureStatus = 'Stopped';
                const finalStatus = cameraService.getStatus();
                
                io.emit('statusUpdate', {
                    captureStatus: 'Stopped',
                    imageCount: finalStatus.imageCount,
                    sessionTime: finalStatus.sessionTime,
                    nextCapture: '--'
                });
                socket.emit('notification', { message: 'Time-lapse capture stopped.', type: 'success' });
            }
        } else {
            socket.emit('notification', { message: 'Capture is not running.', type: 'info' });
        }
    });

    // Handle toggle stream command
    let streamReadyEmitted = false; // Flag to prevent multiple URL emissions
    socket.on('toggleStream', async () => {
        try {
            if (!cameraService.isStreamActive()) {
                // Start stream using centralized method
                await cameraService.startStream(currentConfig, (event, message) => {
                    if (event === 'stream-ready') {
                        const streamUrl = `http://${SERVER_IP_ADDRESS}:8080/?action=stream`;
                        io.emit('streamStatusUpdate', 'Streaming');
                        io.emit('liveStreamUrl', streamUrl);
                        socket.emit('notification', { message: 'Live preview started!', type: 'success' });
                        streamReadyEmitted = true;
                    } else if (event === 'stream-error') {
                        io.emit('streamStatusUpdate', 'Stopped');
                        io.emit('liveStreamUrl', '');
                        socket.emit('notification', { message: `Stream error: ${message}`, type: 'error' });
                    } else if (event === 'stream-stopped') {
                        io.emit('streamStatusUpdate', 'Stopped');
                        io.emit('liveStreamUrl', '');
                        streamReadyEmitted = false;
                    }
                });
            } else {
                // Stop stream using centralized method
                await cameraService.stopStream();
                io.emit('streamStatusUpdate', 'Stopped');
                io.emit('liveStreamUrl', '');
                socket.emit('notification', { message: 'Live preview stopped.', type: 'success' });
                streamReadyEmitted = false;
            }
        } catch (error) {
            console.error('Stream toggle error:', error);
            socket.emit('notification', { message: error.message, type: 'error' });
        }
    });

    // Handle video generation
    socket.on('generateVideo', async () => {
        try {
            console.log('Generating video with ffmpeg...');
            io.emit('videoGenerationStatus', { status: 'in-progress', message: 'Starting video generation...' });
            
            const result = await cameraService.generateVideo(
                currentConfig,
                (progress) => {
                    io.emit('videoGenerationStatus', { 
                        status: 'in-progress', 
                        message: `Generating: ${progress}%`, 
                        progress: progress 
                    });
                }
            );
            
            io.emit('videoGenerationStatus', { 
                status: 'complete', 
                message: `Video generation complete! File: ${result.filename}` 
            });
            socket.emit('notification', { 
                message: `Time-lapse video generated: ${result.filename}`, 
                type: 'success' 
            });
        } catch (error) {
            console.error('Video generation failed:', error);
            io.emit('videoGenerationStatus', { 
                status: 'error', 
                message: `Video generation failed: ${error.message}` 
            });
            socket.emit('notification', { 
                message: `Video generation failed: ${error.message}`, 
                type: 'error' 
            });
        }
    });

    // Handle image refresh
    socket.on('refreshImages', async () => {
        try {
            console.log('Refreshing images...');
            const imageList = await cameraService.getImageList();
            io.emit('imageListUpdate', imageList); // Send to all clients
            socket.emit('notification', { message: `Found ${imageList.length} images.`, type: 'info' });
        } catch (error) {
            console.error('Failed to refresh images:', error);
            socket.emit('notification', { message: `Failed to refresh images: ${error.message}`, type: 'error' });
        }
    });

    // Handle clear images
    socket.on('clearImages', async () => {
        try {
            console.log('Clearing images...');
            const clearedCount = await cameraService.clearImages();
            
            // Update status with current camera service state
            const status = cameraService.getStatus();
            io.emit('statusUpdate', {
                captureStatus: status.isCapturing ? 'Running' : 'Stopped',
                imageCount: status.imageCount,
                sessionTime: status.sessionTime,
                nextCapture: status.isCapturing ? `in ${currentConfig.captureInterval}s` : '--'
            });
            
            socket.emit('notification', { message: `Cleared ${clearedCount} images!`, type: 'success' });
            io.emit('imagesCleared');
        } catch (error) {
            console.error('Failed to clear images:', error);
            socket.emit('notification', { message: `Failed to clear images: ${error.message}`, type: 'error' });
        }
    });

    // Handle video refresh
    socket.on('refreshVideos', async () => {
        try {
            console.log('Refreshing videos...');
            const videoList = await cameraService.getVideoList();
            socket.emit('videoListUpdate', videoList);
            socket.emit('notification', { message: `Found ${videoList.length} videos.`, type: 'info' });
        } catch (error) {
            console.error('Failed to refresh videos:', error);
            socket.emit('notification', { message: `Failed to refresh videos: ${error.message}`, type: 'error' });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // No socket-specific cleanup needed with camera service
    });
});

// Helper function to format time (seconds to HH:MM:SS)
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s]
        .map(v => v < 10 ? '0' + v : v)
        .join(':');
}

// Start the server
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Open your browser to http://localhost:${PORT}`);
});

// --- System Info Simulation ---
let systemInfoInterval = setInterval(() => {
    const memoryUsage = `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`;
    const uptimeSeconds = process.uptime();
    const systemUptime = formatTime(uptimeSeconds);

    io.emit('systemInfoUpdate', {
        memoryUsage: memoryUsage,
        systemUptime: systemUptime,
        streamStatus: cameraService.isStreamActive() ? 'Streaming' : 'Stopped'
    });
}, 5000); // Update every 5 seconds
