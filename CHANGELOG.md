# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **MJPG-Streamer integration** for live camera streaming
- Automated installation script (install-rpi.sh) with MJPG-Streamer setup
- Stream control API endpoints (/api/stream/*)
- Multiple camera support (Raspberry Pi Camera Module + USB cameras)
- MJPG-Streamer configuration templates and systemd service
- Live stream preview URLs and web interface integration
- Comprehensive troubleshooting documentation
- Environment configuration for streaming parameters
- Stream quality and resolution control
- Remote camera access capabilities

## [1.0.0] - TBD

### Added
- Initial release with MJPG-Streamer integration
- Basic timelapse functionality with live streaming preview
- Web interface with HTML/CSS/JS and embedded stream viewer
- Express.js server setup with streaming API endpoints
- Socket.io for real-time updates and stream status
- Raspberry Pi Camera Module support via input_raspicam
- USB camera support via input_uvc
- Multi-resolution streaming (480p, 720p, 1080p)
- Automated installation and service setup
- Remote access and monitoring capabilities

### Dependencies
- express ^5.1.0
- socket.io ^4.8.1
- nodemon ^3.1.10 (dev)
- MJPG-Streamer (external dependency)
