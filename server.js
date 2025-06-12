// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os'); // Import the 'os' module

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

let captureStatus = 'Stopped';
let imageCount = 0;
let sessionStartTime = null;
let captureProcess = null; // To hold the child process for image capture (e.g., raspistill)
let streamProcess = null; // To hold the mjpeg-streamer child process for video streaming

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Send initial status and config to the newly connected client
    socket.emit('statusUpdate', {
        captureStatus: captureStatus,
        imageCount: imageCount,
        sessionTime: formatTime(sessionStartTime ? (Date.now() - sessionStartTime) / 1000 : 0),
        nextCapture: '--'
    });
    socket.emit('configUpdate', currentConfig);
    // Also send the current stream status and URL if streaming is active
    if (streamProcess) {
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

    // Handle start capture command (simulation, as direct /dev/video0 for photos needs more setup)
    socket.on('startCapture', () => {
        if (captureStatus === 'Stopped') {
            console.log('Starting capture simulation...');
            captureStatus = 'Running';
            imageCount = 0;
            sessionStartTime = Date.now();

            let captureIntervalId = setInterval(() => {
                imageCount++;
                io.emit('statusUpdate', {
                    captureStatus: captureStatus,
                    imageCount: imageCount,
                    sessionTime: formatTime((Date.now() - sessionStartTime) / 1000),
                    nextCapture: `in ${currentConfig.captureInterval}s`
                });
            }, currentConfig.captureInterval * 1000);

            socket.captureIntervalId = captureIntervalId; // Store interval ID on socket for per-client stop
            io.emit('statusUpdate', {
                captureStatus: captureStatus,
                imageCount: imageCount,
                sessionTime: '00:00:00',
                nextCapture: `in ${currentConfig.captureInterval}s`
            });
            socket.emit('notification', { message: 'Time-lapse capture started (simulation)!', type: 'success' });
        } else {
            socket.emit('notification', { message: 'Capture is already running.', type: 'info' });
        }
    });

    // Handle stop capture command
    socket.on('stopCapture', () => {
        if (captureStatus === 'Running') {
            console.log('Stopping capture simulation...');
            captureStatus = 'Stopped';
            clearInterval(socket.captureIntervalId); // Clear the simulation interval

            io.emit('statusUpdate', {
                captureStatus: captureStatus,
                imageCount: imageCount,
                sessionTime: formatTime((Date.now() - sessionStartTime) / 1000),
                nextCapture: '--'
            });
            sessionStartTime = null; // Reset session time
            socket.emit('notification', { message: 'Time-lapse capture stopped.', type: 'success' });
        } else {
            socket.emit('notification', { message: 'Capture is not running.', type: 'info' });
        }
    });

    // Handle toggle stream command
    let streamReadyEmitted = false; // Flag to prevent multiple URL emissions
    socket.on('toggleStream', () => {
        if (!streamProcess) {
            console.log('Attempting to start live stream with mjpeg-streamer...');
            // Determine resolution for mjpeg-streamer
            let resolution = '640x480';
            switch (currentConfig.streamQuality) {
                case 'low': resolution = '640x480'; break;
                case 'medium': resolution = '1280x720'; break;
                case 'high': resolution = '1920x1080'; break;
            }

            // Spawn mjpg_streamer process
            // It's highly recommended to use absolute paths for the executable and the www directory
            try {
                streamProcess = spawn(MJPEG_STREAMER_PATH, [
                    '-i', `input_uvc.so -d /dev/video0 -r ${resolution} -f ${currentConfig.streamFps}`,
                    '-o', `output_http.so -w ${MJPEG_STREAMER_WWW_PATH} -p 8080` // Use the specified www path
                ]);

                streamProcess.stdout.on('data', (data) => {
                    console.log(`mjpeg-streamer stdout: ${data.toString()}`);
                });

                streamProcess.stderr.on('data', (data) => {
                    const stderrOutput = data.toString();
                    console.error(`mjpeg-streamer stderr: ${stderrOutput}`);
                    // Check if the server is ready to stream
                    if (stderrOutput.includes('o: commands.............: enabled') && !streamReadyEmitted) {
                        // Now using the server's actual IP address
                        const streamUrl = `http://${SERVER_IP_ADDRESS}:8080/?action=stream`;
                        io.emit('streamStatusUpdate', 'Streaming');
                        io.emit('liveStreamUrl', streamUrl); // Send the stream URL to all clients
                        socket.emit('notification', { message: 'Live preview started!', type: 'success' });
                        streamReadyEmitted = true; // Prevent multiple emissions
                    }
                    // Common errors here that prevent streaming:
                    // - "No such file or directory": MJPEG_STREAMER_PATH or MJPEG_STREAMER_WWW_PATH is wrong.
                    // - "Permission denied": Check permissions for /dev/video0 or the executable.
                    // - "select timeout": Camera device is busy or inaccessible.
                    // - "no input plugin loaded": Check input_uvc.so path/permissions, or if input_uvc.so is correct for your camera.
                    // - "Failed to open video device": /dev/video0 issue.
                });

                streamProcess.on('close', (code) => {
                    console.log(`mjpeg-streamer process exited with code ${code}`);
                    streamProcess = null;
                    streamReadyEmitted = false; // Reset flag on close
                    io.emit('streamStatusUpdate', 'Stopped');
                    io.emit('liveStreamUrl', ''); // Clear URL on client
                    socket.emit('notification', { message: 'Live preview stopped unexpectedly. Code: ' + code, type: 'error' });
                });

                streamProcess.on('error', (err) => {
                    console.error('Failed to start mjpeg-streamer process:', err);
                    streamProcess = null;
                    streamReadyEmitted = false; // Reset flag on error
                    io.emit('streamStatusUpdate', 'Stopped');
                    io.emit('liveStreamUrl', ''); // Clear URL on client
                    socket.emit('notification', { message: `Failed to start live preview process: ${err.message}. Check mjpeg-streamer path/permissions.`, type: 'error' });
                });

            } catch (error) {
                console.error('Error attempting to spawn mjpeg-streamer:', error);
                socket.emit('notification', { message: `Fatal error starting stream: ${error.message}.`, type: 'error' });
            }

        } else {
            console.log('Stopping live stream...');
            if (streamProcess) {
                streamProcess.kill('SIGKILL'); // Use SIGKILL to ensure termination
                streamProcess = null;
                streamReadyEmitted = false; // Reset flag on stop
            }
            io.emit('streamStatusUpdate', 'Stopped');
            io.emit('liveStreamUrl', ''); // Clear URL on client
            socket.emit('notification', { message: 'Live preview stopped.', type: 'success' });
        }
    });

    // Handle video generation (conceptual)
    socket.on('generateVideo', () => {
        console.log('Generating video...');
        io.emit('videoGenerationStatus', { status: 'in-progress', message: 'Starting video generation...' });
        let progress = 0;
        const videoGenerationInterval = setInterval(() => {
            progress += 10;
            if (progress <= 100) {
                io.emit('videoGenerationStatus', { status: 'in-progress', message: `Generating: ${progress}%`, progress: progress });
            } else {
                clearInterval(videoGenerationInterval);
                io.emit('videoGenerationStatus', { status: 'complete', message: 'Video generation complete!' });
                socket.emit('notification', { message: 'Time-lapse video generated!', type: 'success' });
            }
        }, 500); // Simulate progress every 0.5 seconds
    });

    // Handle image refresh (simulation)
    socket.on('refreshImages', () => {
        console.log('Refreshing images (simulation)...');
        socket.emit('notification', { message: 'Images refreshed (simulation).', type: 'info' });
    });

    // Handle clear images (simulation)
    socket.on('clearImages', () => {
        console.log('Clearing images (simulation)...');
        imageCount = 0; // Reset count on server side
        io.emit('statusUpdate', {
            captureStatus: captureStatus,
            imageCount: imageCount,
            sessionTime: formatTime(sessionStartTime ? (Date.now() - sessionStartTime) / 1000 : 0),
            nextCapture: '--'
        });
        socket.emit('notification', { message: 'All captured images cleared (simulation)!', type: 'success' });
        io.emit('imagesCleared');
    });

    // Handle video refresh (simulation)
    socket.on('refreshVideos', () => {
        console.log('Refreshing videos (simulation)...');
        socket.emit('notification', { message: 'Videos refreshed (simulation).', type: 'info' });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Clear any specific intervals for this socket if needed
        if (socket.captureIntervalId) {
            clearInterval(socket.captureIntervalId);
        }
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
        streamStatus: streamProcess ? 'Streaming' : 'Stopped'
    });
}, 5000); // Update every 5 seconds
