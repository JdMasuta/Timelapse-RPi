# Feature: Persistent Environment Configuration

## Overview
This feature branch implements persistent configuration management using environment variables and .env files, replacing the previous hardcoded configuration approach.

## Changes Made

### 1. New ConfigService (`services/configService.js`)
- **Purpose**: Centralized configuration management with persistence
- **Features**:
  - Loads configuration from environment variables with fallback defaults
  - Maps environment variables to application configuration structure
  - Provides backward compatibility with existing web interface
  - Persists configuration changes to .env file
  - Automatically creates .env from .env.example if missing

### 2. Updated Server.js
- **Async Initialization**: Wrapped server startup in async function to load config
- **Persistent Config Updates**: saveConfig handler now persists changes to .env file
- **Environment-based Port**: Server port now comes from configuration
- **Backward Compatibility**: Maintains existing web interface expectations

### 3. Dependencies
- **Added**: `dotenv` package for environment variable handling
- **Updated**: package.json includes new dependency

## Configuration Mapping

### Environment Variables → Web Interface
- `CAPTURE_INTERVAL` → `captureInterval`
- `IMAGE_QUALITY` → `imageQuality`
- `STREAM_FPS` → `streamFps`
- `STREAM_WIDTH/HEIGHT` → `streamQuality` (mapped)
- `SCHEDULE_ENABLED` → `scheduleEnabled`
- `SCHEDULE_START_TIME` → `startTime`
- `SCHEDULE_STOP_TIME` → `stopTime`
- `VIDEO_FPS` → `videoFps`
- `VIDEO_QUALITY` → `videoQuality`

## Usage

### First Run
1. Application creates `.env` from `.env.example` if missing
2. Loads default configuration from environment variables
3. Web interface works as before

### Configuration Changes
1. User updates settings via web interface
2. Changes are immediately persisted to `.env` file
3. Changes survive server restarts
4. All connected clients receive real-time updates

### Manual Configuration
Users can directly edit `.env` file:
```bash
CAPTURE_INTERVAL=10
IMAGE_QUALITY=high
STREAM_FPS=30
SCHEDULE_ENABLED=true
```

## Benefits

1. **Persistence**: Configuration survives server restarts
2. **Flexibility**: Both web interface and file-based configuration
3. **Backward Compatibility**: Existing web interface unchanged
4. **Environment-based**: Follows 12-factor app principles
5. **Validation**: Type checking and fallback defaults
6. **Real-time Updates**: Changes immediately reflected across all clients

## Files Modified
- `server.js` - Async initialization and persistent config handling
- `package.json` - Added dotenv dependency

## Files Added
- `services/configService.js` - Configuration management service
- `.env` - Auto-generated environment configuration file

## Testing
- Verified configuration loading from environment variables
- Tested persistent updates through web interface
- Confirmed backward compatibility with existing features
- Validated automatic .env file creation

## Next Steps
This implementation provides a solid foundation for:
1. Advanced validation and error handling
2. Configuration versioning
3. Environment-specific defaults
4. Configuration migration utilities
