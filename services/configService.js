const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

class ConfigService {
    constructor() {
        this.envPath = path.join(__dirname, '..', '.env');
        this.defaultConfig = {
            // Server Configuration
            PORT: 3001,
            NODE_ENV: 'development',
            HOST: '0.0.0.0',

            // MJPG-Streamer Configuration
            MJPG_STREAMER_PORT: 8080,
            MJPG_STREAMER_PATH: '/usr/local/bin/mjpg_streamer',
            MJPG_STREAMER_WWW: '/usr/local/share/mjpg-streamer/www',
            MJPG_STREAMER_AUTOSTART: true,

            // Timelapse Settings
            CAPTURE_INTERVAL: 5,
            OUTPUT_DIR: './captures',
            IMAGE_QUALITY: 'high',
            MAX_STORAGE_GB: 10,

            // Camera Stream Settings
            STREAM_FPS: 15,
            STREAM_WIDTH: 1280,
            STREAM_HEIGHT: 720,
            STREAM_QUALITY: 'medium',

            // Daily Schedule Settings
            SCHEDULE_ENABLED: false,
            SCHEDULE_START_TIME: '08:00',
            SCHEDULE_STOP_TIME: '18:00',

            // Video Generation Settings
            VIDEO_FPS: 30,
            VIDEO_QUALITY: 'medium',
            VIDEO_CODEC: 'h264',
            VIDEO_BITRATE: '5M',

            // Advanced Camera Settings
            CAMERA_TYPE: 'libcamera',
            CAMERA_DEVICE: 0,
            RESOLUTION_WIDTH: 1920,
            RESOLUTION_HEIGHT: 1080,
            ROTATION: 0,
            FLIP_HORIZONTAL: false,
            FLIP_VERTICAL: false,

            // MJPG-Streamer Plugin Settings
            MJPG_INPUT_PLUGIN: 'input_raspicam.so',
            MJPG_INPUT_OPTIONS: '-x 1280 -y 720 -fps 15 -ex auto',

            // Storage Management
            AUTO_CLEANUP: true,
            MAX_IMAGES: 1000,
            CLEANUP_OLDER_THAN_DAYS: 7,
            AUTO_GENERATE_VIDEO: false,

            // Performance & Resource Settings
            ENABLE_HARDWARE_ACCELERATION: true,

            // Logging Configuration
            LOG_LEVEL: 'info',
            LOG_FILE: './logs/timelapse.log',

            // Development & Debug Settings
            DEBUG_MODE: false,
            MOCK_CAMERA: false
        };

        // Define valid options for dropdown/select fields
        this.validOptions = {
            imageQuality: ['low', 'medium', 'high'],
            streamFps: [5, 10, 15, 20, 25, 30],
            streamQuality: ['low', 'medium', 'high'],
            videoFps: [12, 15, 20, 24, 25, 30, 48, 60],
            videoQuality: ['low', 'medium', 'high', 'ultra'],
            videoCodec: ['h264', 'h265', 'vp9'],
            videoBitrate: ['1M', '2M', '5M', '10M', '20M'],
            cameraType: ['libcamera', 'usb', 'fswebcam'],
            rotation: [0, 90, 180, 270],
            mjpgInputPlugin: ['input_raspicam.so', 'input_uvc.so'],
            logLevel: ['error', 'warn', 'info', 'debug', 'trace']
        };
    }

    /**
     * Load configuration from environment variables, with fallbacks to defaults
     */
    async loadConfig() {
        try {
            // Create .env file if it doesn't exist
            await this.ensureEnvFile();

            // Map environment variables to our config structure
            const config = {
                // Server Configuration
                port: parseInt(process.env.PORT) || this.defaultConfig.PORT,
                nodeEnv: process.env.NODE_ENV || this.defaultConfig.NODE_ENV,
                host: process.env.HOST || this.defaultConfig.HOST,

                // MJPG-Streamer Configuration
                mjpgStreamerPort: parseInt(process.env.MJPG_STREAMER_PORT) || this.defaultConfig.MJPG_STREAMER_PORT,
                mjpgStreamerPath: process.env.MJPG_STREAMER_PATH || this.defaultConfig.MJPG_STREAMER_PATH,
                mjpgStreamerWww: process.env.MJPG_STREAMER_WWW || this.defaultConfig.MJPG_STREAMER_WWW,

                // Timelapse Settings (main config used by web interface)
                captureInterval: this.parseNumber(process.env.CAPTURE_INTERVAL, 1, 3600) || this.defaultConfig.CAPTURE_INTERVAL,
                outputDir: process.env.OUTPUT_DIR || this.defaultConfig.OUTPUT_DIR,
                imageQuality: this.validateOption(process.env.IMAGE_QUALITY, 'imageQuality') || this.defaultConfig.IMAGE_QUALITY,
                maxStorageGb: parseInt(process.env.MAX_STORAGE_GB) || this.defaultConfig.MAX_STORAGE_GB,

                // Camera Stream Settings
                streamFps: this.validateOption(parseInt(process.env.STREAM_FPS), 'streamFps') || this.defaultConfig.STREAM_FPS,
                streamWidth: parseInt(process.env.STREAM_WIDTH) || this.defaultConfig.STREAM_WIDTH,
                streamHeight: parseInt(process.env.STREAM_HEIGHT) || this.defaultConfig.STREAM_HEIGHT,
                streamQuality: this.validateOption(process.env.STREAM_QUALITY, 'streamQuality') || this.mapStreamQuality(process.env.STREAM_WIDTH, process.env.STREAM_HEIGHT),

                // Daily Schedule Settings
                scheduleEnabled: this.parseBool(process.env.SCHEDULE_ENABLED) ?? this.defaultConfig.SCHEDULE_ENABLED,
                startTime: this.validateTime(process.env.SCHEDULE_START_TIME) || this.defaultConfig.SCHEDULE_START_TIME,
                stopTime: this.validateTime(process.env.SCHEDULE_STOP_TIME) || this.defaultConfig.SCHEDULE_STOP_TIME,

                // Video Generation Settings
                videoFps: this.validateOption(parseInt(process.env.VIDEO_FPS), 'videoFps') || this.defaultConfig.VIDEO_FPS,
                videoQuality: this.validateOption(process.env.VIDEO_QUALITY, 'videoQuality') || this.defaultConfig.VIDEO_QUALITY,
                videoCodec: this.validateOption(process.env.VIDEO_CODEC, 'videoCodec') || this.defaultConfig.VIDEO_CODEC,
                videoBitrate: this.validateOption(process.env.VIDEO_BITRATE, 'videoBitrate') || this.defaultConfig.VIDEO_BITRATE,

                // Advanced Camera Settings
                cameraType: this.validateOption(process.env.CAMERA_TYPE, 'cameraType') || this.defaultConfig.CAMERA_TYPE,
                cameraDevice: process.env.CAMERA_DEVICE || this.defaultConfig.CAMERA_DEVICE,
                resolutionWidth: parseInt(process.env.RESOLUTION_WIDTH) || this.defaultConfig.RESOLUTION_WIDTH,
                resolutionHeight: parseInt(process.env.RESOLUTION_HEIGHT) || this.defaultConfig.RESOLUTION_HEIGHT,
                rotation: this.validateOption(parseInt(process.env.ROTATION), 'rotation') || this.defaultConfig.ROTATION,
                flipHorizontal: this.parseBool(process.env.FLIP_HORIZONTAL) ?? this.defaultConfig.FLIP_HORIZONTAL,
                flipVertical: this.parseBool(process.env.FLIP_VERTICAL) ?? this.defaultConfig.FLIP_VERTICAL,

                // Storage Management
                autoCleanup: this.parseBool(process.env.AUTO_CLEANUP) ?? this.defaultConfig.AUTO_CLEANUP,
                maxImages: parseInt(process.env.MAX_IMAGES) || this.defaultConfig.MAX_IMAGES,
                cleanupOlderThanDays: parseInt(process.env.CLEANUP_OLDER_THAN_DAYS) || this.defaultConfig.CLEANUP_OLDER_THAN_DAYS,
                autoGenerateVideo: this.parseBool(process.env.AUTO_GENERATE_VIDEO) ?? this.defaultConfig.AUTO_GENERATE_VIDEO,

                // Performance & Resource Settings
                enableHardwareAcceleration: this.parseBool(process.env.ENABLE_HARDWARE_ACCELERATION) ?? this.defaultConfig.ENABLE_HARDWARE_ACCELERATION,

                // Logging Configuration
                logLevel: this.validateOption(process.env.LOG_LEVEL, 'logLevel') || this.defaultConfig.LOG_LEVEL,
                logFile: process.env.LOG_FILE || this.defaultConfig.LOG_FILE,

                // Development & Debug Settings
                debugMode: this.parseBool(process.env.DEBUG_MODE) ?? this.defaultConfig.DEBUG_MODE,
                mockCamera: this.parseBool(process.env.MOCK_CAMERA) ?? this.defaultConfig.MOCK_CAMERA
            };

            console.log('Configuration loaded successfully from environment variables');
            return config;
        } catch (error) {
            console.error('Error loading configuration:', error);
            throw error;
        }
    }

    /**
     * Get the legacy config format for compatibility with existing web interface
     */
    getLegacyConfig(config) {
        return {
            captureInterval: config.captureInterval,
            imageQuality: config.imageQuality,
            streamFps: config.streamFps,
            streamQuality: config.streamQuality,
            scheduleEnabled: config.scheduleEnabled,
            startTime: config.startTime,
            stopTime: config.stopTime,
            videoFps: config.videoFps,
            videoQuality: config.videoQuality
        };
    }

    /**
     * Get extended config with all available options for advanced settings
     */
    getExtendedConfig(config) {
        return {
            // Basic settings (compatible with web interface)
            ...this.getLegacyConfig(config),
            
            // Extended settings
            videoCodec: config.videoCodec,
            videoBitrate: config.videoBitrate,
            cameraType: config.cameraType,
            cameraDevice: config.cameraDevice,
            resolutionWidth: config.resolutionWidth,
            resolutionHeight: config.resolutionHeight,
            rotation: config.rotation,
            flipHorizontal: config.flipHorizontal,
            flipVertical: config.flipVertical,
            autoCleanup: config.autoCleanup,
            maxImages: config.maxImages,
            cleanupOlderThanDays: config.cleanupOlderThanDays,
            autoGenerateVideo: config.autoGenerateVideo,
            enableHardwareAcceleration: config.enableHardwareAcceleration,
            debugMode: config.debugMode,
            logLevel: config.logLevel
        };
    }

    /**
     * Update configuration both in memory and persist to .env file
     */
    async updateConfig(updates) {
        try {
            // Read current .env file
            const envContent = await this.readEnvFile();
            const envVars = this.parseEnvContent(envContent);

            // Map web interface updates to environment variable names
            const envUpdates = this.mapLegacyConfigToEnv(updates);

            // Update environment variables
            Object.assign(envVars, envUpdates);

            // Write back to .env file
            await this.writeEnvFile(envVars);

            // Update process.env for immediate effect
            Object.assign(process.env, envUpdates);

            console.log('Configuration updated and persisted to .env file');
            return true;
        } catch (error) {
            console.error('Error updating configuration:', error);
            throw error;
        }
    }

    /**
     * Update extended configuration with validation
     */
    async updateExtendedConfig(updates) {
        try {
            // Validate all updates
            const validatedUpdates = this.validateExtendedUpdates(updates);
            
            // Read current .env file
            const envContent = await this.readEnvFile();
            const envVars = this.parseEnvContent(envContent);

            // Map extended updates to environment variable names
            const envUpdates = this.mapExtendedConfigToEnv(validatedUpdates);

            // Update environment variables
            Object.assign(envVars, envUpdates);

            // Write back to .env file
            await this.writeEnvFile(envVars);

            // Update process.env for immediate effect
            Object.assign(process.env, envUpdates);

            console.log('Extended configuration updated and persisted to .env file');
            return true;
        } catch (error) {
            console.error('Error updating extended configuration:', error);
            throw error;
        }
    }

    /**
     * Validate extended configuration updates
     */
    validateExtendedUpdates(updates) {
        const validated = {};

        // Validate each field with appropriate validation
        Object.keys(updates).forEach(key => {
            const value = updates[key];
            
            switch (key) {
                case 'captureInterval':
                    validated[key] = this.parseNumber(value, 1, 3600);
                    break;
                case 'imageQuality':
                case 'streamQuality':
                case 'videoQuality':
                case 'videoCodec':
                case 'videoBitrate':
                case 'cameraType':
                case 'logLevel':
                    validated[key] = this.validateOption(value, key);
                    break;
                case 'streamFps':
                case 'videoFps':
                case 'rotation':
                    validated[key] = this.validateOption(parseInt(value), key);
                    break;
                case 'startTime':
                case 'stopTime':
                    validated[key] = this.validateTime(value);
                    break;
                case 'scheduleEnabled':
                case 'autoCleanup':
                case 'autoGenerateVideo':
                case 'flipHorizontal':
                case 'flipVertical':
                case 'enableHardwareAcceleration':
                case 'debugMode':
                    validated[key] = this.parseBool(value);
                    break;
                case 'maxImages':
                case 'cleanupOlderThanDays':
                case 'resolutionWidth':
                case 'resolutionHeight':
                    validated[key] = parseInt(value);
                    break;
                default:
                    validated[key] = value;
            }
        });

        return validated;
    }

    /**
     * Map legacy web interface config to environment variable names
     */
    mapLegacyConfigToEnv(legacyConfig) {
        const envUpdates = {};

        if (legacyConfig.captureInterval !== undefined) {
            envUpdates.CAPTURE_INTERVAL = legacyConfig.captureInterval.toString();
        }
        if (legacyConfig.imageQuality !== undefined) {
            envUpdates.IMAGE_QUALITY = legacyConfig.imageQuality;
        }
        if (legacyConfig.streamFps !== undefined) {
            envUpdates.STREAM_FPS = legacyConfig.streamFps.toString();
        }
        if (legacyConfig.streamQuality !== undefined) {
            const dimensions = this.mapQualityToStreamDimensions(legacyConfig.streamQuality);
            envUpdates.STREAM_WIDTH = dimensions.width.toString();
            envUpdates.STREAM_HEIGHT = dimensions.height.toString();
            envUpdates.STREAM_QUALITY = legacyConfig.streamQuality;
        }
        if (legacyConfig.scheduleEnabled !== undefined) {
            envUpdates.SCHEDULE_ENABLED = legacyConfig.scheduleEnabled.toString();
        }
        if (legacyConfig.startTime !== undefined) {
            envUpdates.SCHEDULE_START_TIME = legacyConfig.startTime;
        }
        if (legacyConfig.stopTime !== undefined) {
            envUpdates.SCHEDULE_STOP_TIME = legacyConfig.stopTime;
        }
        if (legacyConfig.videoFps !== undefined) {
            envUpdates.VIDEO_FPS = legacyConfig.videoFps.toString();
        }
        if (legacyConfig.videoQuality !== undefined) {
            envUpdates.VIDEO_QUALITY = legacyConfig.videoQuality;
        }

        return envUpdates;
    }

    /**
     * Map extended configuration to environment variables
     */
    mapExtendedConfigToEnv(extendedConfig) {
        const envUpdates = {};

        // Basic mappings (same as legacy)
        Object.assign(envUpdates, this.mapLegacyConfigToEnv(extendedConfig));

        // Extended mappings
        if (extendedConfig.videoCodec !== undefined) {
            envUpdates.VIDEO_CODEC = extendedConfig.videoCodec;
        }
        if (extendedConfig.videoBitrate !== undefined) {
            envUpdates.VIDEO_BITRATE = extendedConfig.videoBitrate;
        }
        if (extendedConfig.cameraType !== undefined) {
            envUpdates.CAMERA_TYPE = extendedConfig.cameraType;
        }
        if (extendedConfig.cameraDevice !== undefined) {
            envUpdates.CAMERA_DEVICE = extendedConfig.cameraDevice.toString();
        }
        if (extendedConfig.resolutionWidth !== undefined) {
            envUpdates.RESOLUTION_WIDTH = extendedConfig.resolutionWidth.toString();
        }
        if (extendedConfig.resolutionHeight !== undefined) {
            envUpdates.RESOLUTION_HEIGHT = extendedConfig.resolutionHeight.toString();
        }
        if (extendedConfig.rotation !== undefined) {
            envUpdates.ROTATION = extendedConfig.rotation.toString();
        }
        if (extendedConfig.flipHorizontal !== undefined) {
            envUpdates.FLIP_HORIZONTAL = extendedConfig.flipHorizontal.toString();
        }
        if (extendedConfig.flipVertical !== undefined) {
            envUpdates.FLIP_VERTICAL = extendedConfig.flipVertical.toString();
        }
        if (extendedConfig.autoCleanup !== undefined) {
            envUpdates.AUTO_CLEANUP = extendedConfig.autoCleanup.toString();
        }
        if (extendedConfig.maxImages !== undefined) {
            envUpdates.MAX_IMAGES = extendedConfig.maxImages.toString();
        }
        if (extendedConfig.cleanupOlderThanDays !== undefined) {
            envUpdates.CLEANUP_OLDER_THAN_DAYS = extendedConfig.cleanupOlderThanDays.toString();
        }
        if (extendedConfig.autoGenerateVideo !== undefined) {
            envUpdates.AUTO_GENERATE_VIDEO = extendedConfig.autoGenerateVideo.toString();
        }
        if (extendedConfig.enableHardwareAcceleration !== undefined) {
            envUpdates.ENABLE_HARDWARE_ACCELERATION = extendedConfig.enableHardwareAcceleration.toString();
        }
        if (extendedConfig.debugMode !== undefined) {
            envUpdates.DEBUG_MODE = extendedConfig.debugMode.toString();
        }
        if (extendedConfig.logLevel !== undefined) {
            envUpdates.LOG_LEVEL = extendedConfig.logLevel;
        }

        return envUpdates;
    }

    /**
     * Validation and utility methods
     */
    
    /**
     * Validate option against allowed values
     */
    validateOption(value, optionType) {
        if (!value || !this.validOptions[optionType]) {
            return null;
        }
        
        const validValues = this.validOptions[optionType];
        return validValues.includes(value) ? value : null;
    }

    /**
     * Parse and validate number within range
     */
    parseNumber(value, min = null, max = null) {
        const num = parseInt(value);
        if (isNaN(num)) return null;
        
        if (min !== null && num < min) return null;
        if (max !== null && num > max) return null;
        
        return num;
    }

    /**
     * Validate time format (HH:MM)
     */
    validateTime(timeString) {
        if (!timeString) return null;
        
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        return timeRegex.test(timeString) ? timeString : null;
    }

    /**
     * Map stream quality to dimensions
     */
    mapQualityToStreamDimensions(quality) {
        const qualityMap = {
            low: { width: 640, height: 480 },
            medium: { width: 1280, height: 720 },
            high: { width: 1920, height: 1080 }
        };
        return qualityMap[quality] || qualityMap.medium;
    }

    /**
     * Map stream dimensions back to quality
     */
    mapStreamQuality(width, height) {
        const w = parseInt(width) || 1280;
        const h = parseInt(height) || 720;

        if (w <= 640 && h <= 480) return 'low';
        if (w <= 1280 && h <= 720) return 'medium';
        return 'high';
    }

    /**
     * Parse boolean values from environment variables
     */
    parseBool(value) {
        if (value === undefined || value === null) return undefined;
        return value.toString().toLowerCase() === 'true' || value === '1';
    }

    /**
     * Get available options for dropdowns/selects
     */
    getAvailableOptions() {
        return {
            imageQuality: [
                { value: 'low', label: 'Low (720p)', description: '1280x720 resolution' },
                { value: 'medium', label: 'Medium (1080p)', description: '1920x1080 resolution' },
                { value: 'high', label: 'High (4K)', description: '3840x2160 resolution' }
            ],
            streamFps: [
                { value: 5, label: '5 FPS', description: 'Very low CPU usage' },
                { value: 10, label: '10 FPS', description: 'Low CPU usage' },
                { value: 15, label: '15 FPS', description: 'Balanced performance' },
                { value: 20, label: '20 FPS', description: 'Smooth streaming' },
                { value: 25, label: '25 FPS', description: 'High quality' },
                { value: 30, label: '30 FPS', description: 'Maximum smoothness, high CPU' }
            ],
            streamQuality: [
                { value: 'low', label: 'Low (480p)', description: '640x480 - Low bandwidth' },
                { value: 'medium', label: 'Medium (720p)', description: '1280x720 - Balanced' },
                { value: 'high', label: 'High (1080p)', description: '1920x1080 - High quality' }
            ],
            videoFps: [
                { value: 12, label: '12 FPS', description: 'Stop motion style' },
                { value: 15, label: '15 FPS', description: 'Standard timelapse' },
                { value: 20, label: '20 FPS', description: 'Smooth motion' },
                { value: 24, label: '24 FPS', description: 'Cinematic standard' },
                { value: 25, label: '25 FPS', description: 'PAL standard' },
                { value: 30, label: '30 FPS', description: 'NTSC standard' },
                { value: 48, label: '48 FPS', description: 'High frame rate' },
                { value: 60, label: '60 FPS', description: 'Ultra smooth' }
            ],
            videoQuality: [
                { value: 'low', label: 'Low Quality', description: 'Smaller file size' },
                { value: 'medium', label: 'Medium Quality', description: 'Balanced size/quality' },
                { value: 'high', label: 'High Quality', description: 'Best quality' },
                { value: 'ultra', label: 'Ultra Quality', description: 'Maximum quality, large files' }
            ],
            videoCodec: [
                { value: 'h264', label: 'H.264', description: 'Most compatible' },
                { value: 'h265', label: 'H.265/HEVC', description: 'Better compression' },
                { value: 'vp9', label: 'VP9', description: 'Open source codec' }
            ],
            videoBitrate: [
                { value: '1M', label: '1 Mbps', description: 'Very low quality' },
                { value: '2M', label: '2 Mbps', description: 'Low quality' },
                { value: '5M', label: '5 Mbps', description: 'Standard quality' },
                { value: '10M', label: '10 Mbps', description: 'High quality' },
                { value: '20M', label: '20 Mbps', description: 'Very high quality' }
            ],
            cameraType: [
                { value: 'libcamera', label: 'Raspberry Pi Camera', description: 'RPi Camera Module v2/v3' },
                { value: 'usb', label: 'USB Camera', description: 'Standard USB webcam' },
                { value: 'fswebcam', label: 'Generic Camera', description: 'Any V4L2 compatible camera' }
            ],
            rotation: [
                { value: 0, label: '0°', description: 'No rotation' },
                { value: 90, label: '90°', description: 'Rotate 90 degrees clockwise' },
                { value: 180, label: '180°', description: 'Rotate 180 degrees' },
                { value: 270, label: '270°', description: 'Rotate 270 degrees clockwise' }
            ],
            logLevel: [
                { value: 'error', label: 'Error', description: 'Only error messages' },
                { value: 'warn', label: 'Warning', description: 'Warnings and errors' },
                { value: 'info', label: 'Info', description: 'General information' },
                { value: 'debug', label: 'Debug', description: 'Detailed debugging' },
                { value: 'trace', label: 'Trace', description: 'Very detailed logging' }
            ]
        };
    }

    /**
     * Get configuration summary for display
     */
    getConfigSummary(config) {
        return {
            capture: {
                interval: `${config.captureInterval} seconds`,
                quality: config.imageQuality,
                resolution: `${config.resolutionWidth}x${config.resolutionHeight}`
            },
            stream: {
                fps: config.streamFps,
                quality: config.streamQuality,
                resolution: `${config.streamWidth}x${config.streamHeight}`
            },
            video: {
                fps: config.videoFps,
                quality: config.videoQuality,
                codec: config.videoCodec,
                bitrate: config.videoBitrate
            },
            schedule: {
                enabled: config.scheduleEnabled,
                startTime: config.startTime,
                stopTime: config.stopTime
            },
            storage: {
                autoCleanup: config.autoCleanup,
                maxImages: config.maxImages,
                cleanupDays: config.cleanupOlderThanDays
            }
        };
    }

    /**
     * Ensure .env file exists, create from .env.example if not
     */
    async ensureEnvFile() {
        try {
            await fs.access(this.envPath);
        } catch (error) {
            // .env doesn't exist, create from .env.example
            const examplePath = path.join(__dirname, '..', '.env.example');
            try {
                const exampleContent = await fs.readFile(examplePath, 'utf8');
                await fs.writeFile(this.envPath, exampleContent);
                console.log('Created .env file from .env.example');
            } catch (exampleError) {
                // Create basic .env file with defaults
                const defaultEnvContent = this.generateDefaultEnvContent();
                await fs.writeFile(this.envPath, defaultEnvContent);
                console.log('Created default .env file');
            }
        }
    }

    /**
     * Read .env file content
     */
    async readEnvFile() {
        try {
            return await fs.readFile(this.envPath, 'utf8');
        } catch (error) {
            console.warn('Could not read .env file, using defaults');
            return '';
        }
    }

    /**
     * Parse .env file content into key-value pairs
     */
    parseEnvContent(content) {
        const envVars = {};
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const [key, ...valueParts] = trimmedLine.split('=');
                if (key && valueParts.length > 0) {
                    envVars[key.trim()] = valueParts.join('=').trim();
                }
            }
        }

        return envVars;
    }

    /**
     * Write environment variables back to .env file
     */
    async writeEnvFile(envVars) {
        const content = Object.entries(envVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        await fs.writeFile(this.envPath, content + '\n');
    }

    /**
     * Generate default .env content
     */
    generateDefaultEnvContent() {
        return Object.entries(this.defaultConfig)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + '\n';
    }
}

module.exports = ConfigService;
