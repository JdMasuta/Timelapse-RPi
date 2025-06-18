# Timelapse2 - Node.js Timelapse Camera System Documentation

## Overview

Timelapse2 is a professional Node.js-based timelapse capture and management system designed for Raspberry Pi devices. The system combines automated image capture using `fswebcam`, real-time live streaming via `mjpg-streamer`, and video generation capabilities with `ffmpeg`. It features a modern web-based interface for remote control and monitoring.

## System Architecture

### Core Components

1. **Server Layer** (`server.js`) - Main Node.js server handling Socket.IO connections and orchestrating all system operations
2. **Camera Service** (`services/cameraService.js`) - Abstracted camera operations, image capture, and stream management
3. **Web Interface** (`index.html`, `api.js`, `ui.js`, `app.js`) - Browser-based control panel with real-time updates
4. **External Tools Integration** - `fswebcam`, `mjpg-streamer`, and `ffmpeg` for camera operations

## Data Flow and Operations

### 1. System Initialization Flow
```
server.js startup → 
CameraService instantiation → 
Express server setup → 
Socket.IO connection handling → 
Web interface serving → 
Client connection and status sync
```

### 2. Image Capture Flow
```
User clicks "Start Capture" → 
Socket.IO event 'startCapture' → 
server.js:112 startCapture handler → 
cameraService.startTimelapse() → 
Timed capture loop begins → 
For each capture:
  - Pause stream if active (cameraService.js:42)
  - Execute fswebcam command (cameraService.js:97)
  - Save image to captures/ directory
  - Resume stream if was active (cameraService.js:53)
  - Update UI via Socket.IO callbacks
```

### 3. Live Streaming Flow
```
User clicks "Start Preview" → 
Socket.IO event 'toggleStream' → 
server.js:206 toggleStream handler → 
Spawn mjpg-streamer process (server.js:220) → 
Stream available at http://SERVER_IP:8080/?action=stream → 
UI updates with stream URL → 
Browser displays live video feed
```

### 4. Video Generation Flow
```
User clicks "Generate Video" → 
Socket.IO event 'generateVideo' → 
server.js:292 generateVideo handler → 
cameraService.generateVideo() → 
ffmpeg processes images into MP4 → 
Progress updates sent to UI → 
Completed video saved to captures/
```

## File Structure and Responsibilities

### `/server.js` (Main Server - 412 lines)
**Primary responsibilities:**
- Express.js web server setup (lines 10-49)
- Socket.IO real-time communication handling (lines 70-382)
- MJPG-Streamer process management (lines 206-289)
- Configuration management and persistence (lines 52-109)
- System monitoring and status updates (lines 401-411)

**Key functions:**
- `getServerIpAddress()` (line 31) - Dynamic IP detection for stream URLs
- Socket event handlers for all user actions (startCapture, stopCapture, toggleStream, etc.)
- Stream process lifecycle management with error handling

### `/services/cameraService.js` (Camera Operations - 271 lines)
**Primary responsibilities:**
- Image capture orchestration using fswebcam (lines 83-126)
- Timelapse automation with configurable intervals (lines 128-167)
- Stream coordination and camera resource management (lines 42-81)
- File system operations for images and videos (lines 207-256)

**Key methods:**
- `captureImage(config, notifyCallback)` (line 83) - Single image capture with stream pause/resume
- `startTimelapse(config, callbacks...)` (line 128) - Automated capture loop
- `pauseStream()` / `resumeStream()` (lines 42, 53) - Stream management during captures
- `getImageList()` / `clearImages()` (lines 207, 235) - File management operations

### `/api.js` (Client-Side API - 188 lines)
**Primary responsibilities:**
- Socket.IO client connection and event handling (lines 2-124)
- UI synchronization with server state (lines 5-42)
- User action transmission to server (lines 127-175)
- Live stream URL management (lines 44-65)

**Key functions:**
- Status update handlers for real-time UI updates
- Configuration form submission (`saveConfig()` - line 127)
- Media control functions (start/stop capture, toggle stream)
- File management operations (refresh/clear images)

### `/index.html` (Web Interface - 213 lines)
**Structure:**
- Status dashboard with real-time metrics (lines 17-34)
- Live preview panel with stream display (lines 36-56)
- Configuration forms for capture/stream settings (lines 58-139)
- Video generation controls with progress tracking (lines 141-172)
- File management panels for images and videos (lines 175-202)

### `/ui.js` (UI Utilities - 47 lines)
**Responsibilities:**
- Notification system implementation (lines 4-13)
- DOM initialization and state management (lines 18-35)
- Custom modal/confirmation dialog handling (lines 40-47)

### `/app.js` (Application Bootstrap - 7 lines)
**Purpose:** Minimal application initialization and logging

## Configuration and Settings

### Default Configuration Object (server.js:52-62)
```javascript
{
    captureInterval: 5,        // Seconds between captures
    imageQuality: 'high',      // low/medium/high (720p/1080p/4K)
    streamFps: 15,            // Live stream frame rate
    streamQuality: 'medium',   // Stream resolution
    scheduleEnabled: false,    // Daily schedule feature
    startTime: '08:00',       // Schedule start time
    stopTime: '18:00',        // Schedule stop time
    videoFps: 30,             // Generated video frame rate
    videoQuality: 'medium'    // Generated video quality
}
```

### Quality Mappings (cameraService.js:34-40)
- **Low:** 640x480
- **Medium:** 1280x720  
- **High:** 1920x1080

## External Dependencies and Integration

### Required System Tools
1. **fswebcam** - Image capture from USB/CSI cameras
   - Command format: `fswebcam -r {resolution} --no-banner "{filepath}"`
   - Used for high-quality still image capture

2. **mjpg-streamer** - Real-time video streaming
   - Default path: `/usr/local/bin/mjpg_streamer`
   - WWW path: `/usr/local/share/mjpg-streamer/www/`
   - Stream endpoint: `http://SERVER_IP:8080/?action=stream`

3. **ffmpeg** - Video generation from image sequences
   - Used by cameraService for MP4 creation from captured images

### Node.js Dependencies (package.json:22-26)
- **express** (^5.1.0) - Web server framework
- **socket.io** (^4.8.1) - Real-time bidirectional communication
- **nodemon** (^3.1.10) - Development auto-restart utility

## Key Operational Features

### Stream Management During Capture
The system intelligently manages camera resource conflicts by:
1. Detecting active MJPG-Streamer processes before image capture
2. Temporarily pausing the stream (`SIGKILL` to mjpg-streamer process)
3. Executing fswebcam for high-quality capture
4. Resuming the stream with original settings
5. Providing user notifications for stream state changes

### Real-time Communication
All system state changes are broadcast to connected clients via Socket.IO:
- Capture status and progress updates
- System performance metrics (memory usage, uptime)
- Stream connectivity status
- File operations results
- Error notifications and alerts

### Error Handling and Recovery
- Comprehensive error catching in all async operations
- Graceful degradation when external tools are unavailable
- Process cleanup on system shutdown or errors
- User feedback for all error conditions

### File Management
- Automatic directory creation for image storage (`captures/` directory)
- Timestamped filename generation for captured images
- Metadata tracking (file size, creation time, image count)
- Bulk operations for image clearing and listing

## Network and Connectivity

### Server Discovery
- Automatic local IP detection for multi-interface systems
- Dynamic stream URL generation based on server IP
- Default operation on port 3000 (configurable via `PORT` environment variable)

### Stream Architecture
- MJPG-Streamer operates on port 8080 independently
- Main Node.js server coordinates stream lifecycle
- Browser connects directly to stream endpoint for video data
- Control commands routed through Socket.IO on port 3000

## Installation and Deployment Notes

### Raspberry Pi Specific Considerations
- Camera module compatibility (USB webcam or CSI camera support)
- GPU memory allocation for video processing
- File system performance for high-resolution image storage
- Network configuration for remote access

### Required System Setup
1. Install fswebcam: `sudo apt-get install fswebcam`
2. Compile/install mjpg-streamer with UVC input plugin
3. Install ffmpeg: `sudo apt-get install ffmpeg`
4. Configure camera permissions for user access to `/dev/video0`
5. Set up Node.js environment and install dependencies

This system provides a complete, professional-grade timelapse solution with web-based remote control, suitable for long-term deployments and professional photography applications.