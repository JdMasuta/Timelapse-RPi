const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

class ConfigService {
    constructor() {
        this.envPath = path.join(__dirname, '..', '.env');
        this.defaultConfig = {
            // Server Configuration
            PORT: 3000,
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
            IMAGE_QUALITY: 'high', // high/medium/low
            MAX_STORAGE_GB: 10,

            // Camera Settings
            CAMERA_TYPE: 'libcamera',
            CAMERA_DEVICE: 0,
            RESOLUTION_WIDTH: 1920,
            RESOLUTION_HEIGHT: 1080,
            STREAM_WIDTH: 1280,
            STREAM_HEIGHT: 720,
            STREAM_FPS: 15,
            ROTATION: 0,
            FLIP_HORIZONTAL: false,
            FLIP_VERTICAL: false,

            // Video Generation Settings
            VIDEO_FPS: 30,
            VIDEO_QUALITY: 'medium',

            // Schedule Settings
            SCHEDULE_ENABLED: false,
            SCHEDULE_START_TIME: '08:00',
            SCHEDULE_STOP_TIME: '18:00',

            // MJPG-Streamer Input Plugin Settings
            MJPG_INPUT_PLUGIN: 'input_raspicam.so',
            MJPG_INPUT_OPTIONS: '-x 1280 -y 720 -fps 15 -ex auto',

            // Storage Management
            AUTO_CLEANUP: true,
            MAX_IMAGES: 1000,
            CLEANUP_OLDER_THAN_DAYS: 7,

            // Network Settings
            ENABLE_REMOTE_ACCESS: true,
            CORS_ORIGIN: '*',

            // Logging
            LOG_LEVEL: 'info',
            LOG_FILE: './logs/timelapse.log'
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
                mjpgStreamerAutostart: this.parseBool(process.env.MJPG_STREAMER_AUTOSTART) ?? this.defaultConfig.MJPG_STREAMER_AUTOSTART,

                // Timelapse Settings (main config used by web interface)
                captureInterval: parseInt(process.env.CAPTURE_INTERVAL) || this.defaultConfig.CAPTURE_INTERVAL,
                outputDir: process.env.OUTPUT_DIR || this.defaultConfig.OUTPUT_DIR,
                imageQuality: process.env.IMAGE_QUALITY || this.defaultConfig.IMAGE_QUALITY,
                maxStorageGb: parseInt(process.env.MAX_STORAGE_GB) || this.defaultConfig.MAX_STORAGE_GB,

                // Camera Settings
                cameraType: process.env.CAMERA_TYPE || this.defaultConfig.CAMERA_TYPE,
                cameraDevice: process.env.CAMERA_DEVICE || this.defaultConfig.CAMERA_DEVICE,
                resolutionWidth: parseInt(process.env.RESOLUTION_WIDTH) || this.defaultConfig.RESOLUTION_WIDTH,
                resolutionHeight: parseInt(process.env.RESOLUTION_HEIGHT) || this.defaultConfig.RESOLUTION_HEIGHT,
                streamWidth: parseInt(process.env.STREAM_WIDTH) || this.defaultConfig.STREAM_WIDTH,
                streamHeight: parseInt(process.env.STREAM_HEIGHT) || this.defaultConfig.STREAM_HEIGHT,
                streamFps: parseInt(process.env.STREAM_FPS) || this.defaultConfig.STREAM_FPS,
                rotation: parseInt(process.env.ROTATION) || this.defaultConfig.ROTATION,
                flipHorizontal: this.parseBool(process.env.FLIP_HORIZONTAL) ?? this.defaultConfig.FLIP_HORIZONTAL,
                flipVertical: this.parseBool(process.env.FLIP_VERTICAL) ?? this.defaultConfig.FLIP_VERTICAL,

                // Video Generation Settings
                videoFps: parseInt(process.env.VIDEO_FPS) || this.defaultConfig.VIDEO_FPS,
                videoQuality: process.env.VIDEO_QUALITY || this.defaultConfig.VIDEO_QUALITY,

                // Schedule Settings
                scheduleEnabled: this.parseBool(process.env.SCHEDULE_ENABLED) ?? this.defaultConfig.SCHEDULE_ENABLED,
                startTime: process.env.SCHEDULE_START_TIME || this.defaultConfig.SCHEDULE_START_TIME,
                stopTime: process.env.SCHEDULE_STOP_TIME || this.defaultConfig.SCHEDULE_STOP_TIME,

                // Stream Quality mapping for compatibility with existing web interface
                streamQuality: this.mapStreamQuality(process.env.STREAM_WIDTH, process.env.STREAM_HEIGHT),

                // MJPG-Streamer Plugin Settings
                mjpgInputPlugin: process.env.MJPG_INPUT_PLUGIN || this.defaultConfig.MJPG_INPUT_PLUGIN,
                mjpgInputOptions: process.env.MJPG_INPUT_OPTIONS || this.defaultConfig.MJPG_INPUT_OPTIONS,

                // Storage Management
                autoCleanup: this.parseBool(process.env.AUTO_CLEANUP) ?? this.defaultConfig.AUTO_CLEANUP,
                maxImages: parseInt(process.env.MAX_IMAGES) || this.defaultConfig.MAX_IMAGES,
                cleanupOlderThanDays: parseInt(process.env.CLEANUP_OLDER_THAN_DAYS) || this.defaultConfig.CLEANUP_OLDER_THAN_DAYS,

                // Network Settings
                enableRemoteAccess: this.parseBool(process.env.ENABLE_REMOTE_ACCESS) ?? this.defaultConfig.ENABLE_REMOTE_ACCESS,
                corsOrigin: process.env.CORS_ORIGIN || this.defaultConfig.CORS_ORIGIN,

                // Logging
                logLevel: process.env.LOG_LEVEL || this.defaultConfig.LOG_LEVEL,
                logFile: process.env.LOG_FILE || this.defaultConfig.LOG_FILE
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
        return value.toLowerCase() === 'true' || value === '1';
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