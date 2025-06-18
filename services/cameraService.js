const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

class CameraService {
    constructor() {
        this.streamProcess = null;
        this.captureProcess = null;
        this.isCapturing = false;
        this.captureInterval = null;
        this.imageCount = 0;
        this.sessionStartTime = null;
        this.streamWasActive = false;
        this.outputDir = process.env.OUTPUT_DIR || path.join(__dirname, '..', 'captures');
        this.mjpegStreamerPath = '/usr/local/bin/mjpg_streamer';
        this.mjpegStreamerWwwPath = '/usr/local/share/mjpg-streamer/www/';
        this.cameraInUse = false; // Camera access mutex
        this.currentStreamConfig = null; // Store active stream configuration
        
        this.ensureOutputDir();
    }

    async ensureOutputDir() {
        try {
            await fs.mkdir(this.outputDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create output directory:', error);
        }
    }

    isStreamActive() {
        return this.streamProcess !== null;
    }

    getResolutionForQuality(quality) {
        const resolutions = {
            low: '640x480',
            medium: '1280x720',
            high: '1920x1080'
        };
        return resolutions[quality] || resolutions.medium;
    }


    async captureImage(config, notifyCallback = null) {
        const resolution = this.getResolutionForQuality(config.imageQuality);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `timelapse_${timestamp}.jpg`;
        const filepath = path.join(this.outputDir, filename);

        // Check if stream is active and preserve its configuration
        const wasStreamActive = this.isStreamActive();
        const streamConfig = wasStreamActive ? this.getCurrentStreamConfig() : null;

        try {
            // Step 1: Stop stream if active
            if (wasStreamActive) {
                if (notifyCallback) {
                    notifyCallback('stream-paused', 'Live preview paused for image capture...');
                }
                console.log('Stopping stream for image capture...');
                await this.stopStream();
                
                // Step 2: Add 500ms buffer for camera device handoff
                console.log('Waiting for camera device handoff...');
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Step 3: Capture image with fswebcam
            console.log(`Capturing image: ${filename}`);
            const fswebcamCommand = `fswebcam -r ${resolution} --no-banner "${filepath}"`;
            await execAsync(fswebcamCommand);
            console.log(`Image captured successfully: ${filename}`);
            
            return {
                filename,
                filepath,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Failed to capture image:', error);
            throw error;
        } finally {
            // Step 4: Restart stream if it was active before capture
            if (wasStreamActive && streamConfig) {
                try {
                    console.log('Restarting stream after image capture...');
                    await this.startStream(streamConfig, notifyCallback);
                    if (notifyCallback) {
                        notifyCallback('stream-resumed', 'Live preview resumed after image capture');
                    }
                } catch (streamError) {
                    console.error('Failed to restart stream after capture:', streamError);
                    if (notifyCallback) {
                        notifyCallback('stream-error', `Failed to restart stream: ${streamError.message}`);
                    }
                    // Don't throw here - image capture was successful
                }
            }
        }
    }

    async startTimelapse(config, onImageCaptured, onError, onStreamNotification = null) {
        if (this.isCapturing) {
            throw new Error('Timelapse is already running');
        }

        console.log('Starting timelapse capture with fswebcam...');
        
        // Acquire camera access for timelapse
        this.acquireCamera('timelapse');
        
        this.isCapturing = true;
        this.imageCount = 0;
        this.sessionStartTime = Date.now();

        const captureLoop = async () => {
            if (!this.isCapturing) return;

            try {
                // Each image capture will pause/resume stream individually with notifications
                const result = await this.captureImage(config, onStreamNotification);
                this.imageCount++;
                
                if (onImageCaptured) {
                    onImageCaptured({
                        imageCount: this.imageCount,
                        sessionTime: this.getSessionTime(),
                        filename: result.filename,
                        filepath: result.filepath
                    });
                }
            } catch (error) {
                console.error('Error during timelapse capture:', error);
                if (onError) {
                    onError(error);
                }
            }

            if (this.isCapturing) {
                this.captureInterval = setTimeout(captureLoop, config.captureInterval * 1000);
            }
        };

        captureLoop();
    }

    stopTimelapse() {
        if (!this.isCapturing) {
            return false;
        }

        console.log('Stopping timelapse capture...');
        this.isCapturing = false;
        
        if (this.captureInterval) {
            clearTimeout(this.captureInterval);
            this.captureInterval = null;
        }

        // CRITICAL FIX: Reset stream state and cleanup orphaned processes
        this.streamWasActive = false;
        
        // Kill any orphaned stream processes from timelapse operations
        if (this.streamProcess) {
            console.log('Cleaning up orphaned stream process from timelapse...');
            this.streamProcess.kill('SIGKILL');
            this.streamProcess = null;
        }
        
        // Release camera mutex
        this.releaseCamera();

        return true;
    }

    getSessionTime() {
        if (!this.sessionStartTime) return '00:00:00';
        
        const seconds = Math.floor((Date.now() - this.sessionStartTime) / 1000);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        
        return [h, m, s]
            .map(v => v < 10 ? '0' + v : v)
            .join(':');
    }

    getStatus() {
        return {
            isCapturing: this.isCapturing,
            imageCount: this.imageCount,
            sessionTime: this.getSessionTime(),
            isStreamActive: this.isStreamActive()
        };
    }

    async getImageList() {
        try {
            const files = await fs.readdir(this.outputDir);
            const imageFiles = files.filter(file => 
                file.toLowerCase().endsWith('.jpg') || 
                file.toLowerCase().endsWith('.jpeg')
            );
            
            const imageList = await Promise.all(
                imageFiles.map(async (file) => {
                    const filepath = path.join(this.outputDir, file);
                    const stats = await fs.stat(filepath);
                    return {
                        filename: file,
                        filepath,
                        size: stats.size,
                        created: stats.birthtime
                    };
                })
            );

            return imageList.sort((a, b) => b.created - a.created);
        } catch (error) {
            console.error('Failed to get image list:', error);
            return [];
        }
    }

    async clearImages() {
        try {
            const files = await fs.readdir(this.outputDir);
            const imageFiles = files.filter(file => 
                file.toLowerCase().endsWith('.jpg') || 
                file.toLowerCase().endsWith('.jpeg')
            );

            await Promise.all(
                imageFiles.map(file => 
                    fs.unlink(path.join(this.outputDir, file))
                )
            );

            this.imageCount = 0;
            console.log(`Cleared ${imageFiles.length} images from ${this.outputDir}`);
            return imageFiles.length;
        } catch (error) {
            console.error('Failed to clear images:', error);
            throw error;
        }
    }

    // Camera access control methods
    acquireCamera(operation) {
        if (this.cameraInUse) {
            throw new Error(`Camera busy with ${this.cameraInUse}`);
        }
        this.cameraInUse = operation;
    }

    releaseCamera() {
        this.cameraInUse = false;
    }

    // Centralized stream control methods
    async startStream(config, onNotification = null) {
        if (this.streamProcess) {
            throw new Error('Stream already running');
        }
        if (this.isCapturing) {
            throw new Error('Cannot start stream while timelapse is active');
        }

        try {
            this.acquireCamera('stream');
            console.log('Attempting to start live stream with mjpeg-streamer...');
            
            // Store current stream configuration
            this.currentStreamConfig = { ...config };
            
            const resolution = this.getResolutionForQuality(config.streamQuality);
            
            this.streamProcess = spawn(this.mjpegStreamerPath, [
                '-i', `input_uvc.so -d /dev/video0 -r ${resolution} -f ${config.streamFps}`,
                '-o', `output_http.so -w ${this.mjpegStreamerWwwPath} -p 8080`
            ]);

            // Monitor stderr for readiness
            let streamReadyEmitted = false;
            this.streamProcess.stderr.on('data', (data) => {
                const stderrOutput = data.toString();
                console.log(`mjpeg-streamer stderr: ${stderrOutput}`);
                
                if (stderrOutput.includes('o: commands.............: enabled') && !streamReadyEmitted) {
                    streamReadyEmitted = true;
                    if (onNotification) {
                        onNotification('stream-ready', 'Live preview is ready');
                    }
                }
            });

            this.streamProcess.on('error', (error) => {
                console.error('mjpeg-streamer error:', error);
                this.streamProcess = null;
                this.releaseCamera();
                if (onNotification) {
                    onNotification('stream-error', `Stream failed: ${error.message}`);
                }
            });

            this.streamProcess.on('close', (code) => {
                console.log(`mjpeg-streamer process exited with code ${code}`);
                this.streamProcess = null;
                this.releaseCamera();
                if (onNotification) {
                    onNotification('stream-stopped', 'Live preview stopped');
                }
            });

            return true;
        } catch (error) {
            this.releaseCamera();
            throw error;
        }
    }

    async stopStream() {
        if (this.streamProcess) {
            console.log('Stopping mjpeg-streamer...');
            this.streamProcess.kill('SIGKILL');
            this.streamProcess = null;
        }
        this.streamWasActive = false;
        this.currentStreamConfig = null; // Clear stored config
        this.releaseCamera();
        return true;
    }

    getCurrentStreamConfig() {
        return this.currentStreamConfig ? { ...this.currentStreamConfig } : null;
    }

    setStreamProcess(streamProcess) {
        this.streamProcess = streamProcess;
    }

    cleanup() {
        this.stopTimelapse();
        this.stopStream(); // Use centralized cleanup
    }
}

module.exports = CameraService;