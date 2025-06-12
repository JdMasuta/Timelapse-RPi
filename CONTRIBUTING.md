# Contributing to Timelapse2

Thank you for considering contributing to Timelapse2! This document provides guidelines and information for contributors.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a new branch for your feature or bug fix
4. Make your changes
5. Test your changes thoroughly
6. Submit a pull request

## Development Setup

### Raspberry Pi Development
1. Install Node.js (v16 or higher): `sudo apt install nodejs npm`
2. Install MJPG-Streamer dependencies: `sudo apt install cmake libjpeg8-dev gcc g++`
3. Build and install MJPG-Streamer (or use install-rpi.sh script)
4. Install project dependencies: `npm install`
5. Copy `.env.example` to `.env` and configure as needed
6. Enable camera: `sudo raspi-config` (Interface Options > Camera)
7. Start development server: `npm run dev`

### General Unix Development
1. Install Node.js (v16 or higher)
2. Install MJPG-Streamer and dependencies
3. Install project dependencies: `npm install`
4. Ensure camera access permissions
5. Copy `.env.example` to `.env` and configure as needed
6. Start development server: `npm run dev`

## Code Style

- Use consistent indentation (2 spaces)
- Follow JavaScript ES6+ standards
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused

## Testing

- Write tests for new features
- Ensure all existing tests pass
- Test on multiple browsers when applicable
- Test with different camera configurations (RPi Camera Module, USB cameras)
- **Test MJPG-Streamer integration** with both input plugins
- Test streaming functionality at different resolutions
- Test on different Raspberry Pi models when possible
- Verify remote access functionality
- Test concurrent streaming and timelapse capture

## Pull Request Process

1. Update documentation if necessary
2. Add or update tests as appropriate
3. Ensure your code follows the project's style guidelines
4. Write a clear, concise commit message
5. Create a pull request with a detailed description

## Bug Reports

When reporting bugs, please include:

- Operating system and version (especially Raspberry Pi model and Raspbian version)
- Node.js version
- Camera type (RPi Camera Module v2/v3, USB camera model)
- Browser version (if applicable)
- Steps to reproduce the issue
- Expected vs actual behavior
- Any error messages or logs

## Feature Requests

When suggesting new features:

- Clearly describe the feature and its use case
- Explain why it would be valuable to the project
- Consider implementation complexity
- Be open to discussion and feedback

## Code Review

All contributions will be reviewed for:

- Code quality and style
- Functionality and correctness
- Security considerations
- Performance impact
- Documentation completeness

## License

By contributing to Timelapse2, you agree that your contributions will be licensed under the ISC License.
