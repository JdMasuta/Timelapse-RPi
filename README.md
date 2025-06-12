# Timelapse2

A Node.js-based timelapse capture and management system designed for Raspberry Pi with real-time web interface and live camera streaming via MJPG-Streamer. While optimized for Raspbian, it's compatible with all Unix-based systems.

## Features

- **Real-time timelapse capture control**
- **Live camera streaming** via MJPG-Streamer integration
- **Web-based user interface** accessible from any device on the network
- **Socket.io** for live updates and remote monitoring
- **Express.js backend** with RESTful API
- **Raspberry Pi camera module** support (via input_raspicam plugin)
- **USB camera compatibility** (via input_uvc plugin)
- **Image processing and management**
- **Stream preview** before timelapse capture
- **Multiple resolution support** for streaming and capture
- **Optimized for headless operation**

## System Requirements

### Raspberry Pi (Recommended)
- Raspberry Pi 3B+ or newer
- Raspbian OS (Bullseye or newer)
- Raspberry Pi Camera Module v2/v3 or compatible USB camera
- MicroSD card (16GB+ recommended)
- Stable internet connection (for remote access)
- **MJPG-Streamer** (automatically installed by setup script)

### General Unix Systems
- Any Unix-based system (Linux, macOS)
- Compatible camera device
- Network connectivity
- **MJPG-Streamer** compilation dependencies (cmake, libjpeg-dev)

## Prerequisites

- Node.js (v16 or higher) - Install via:
  ```bash
  # On Raspberry Pi/Debian/Ubuntu
  sudo apt update
  sudo apt install nodejs npm
  
  # Or use NodeSource repository for latest version
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **MJPG-Streamer dependencies:**
  ```bash
  sudo apt-get install cmake libjpeg8-dev gcc g++
  ```
- Camera access permissions
- Git (for cloning)

## Installation

### Raspberry Pi Quick Setup

**Option 1: Automated Installation**
```bash
git clone https://github.com/JdMasuta/Timelaspe-RPi.git
cd Timelapse2
bash install-rpi.sh
```

**Option 2: Manual Installation**

1. Clone this repository:
   ```bash
   git clone https://github.com/JdMasuta/Timelaspe-RPi.git
   cd Timelapse2
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Enable camera (Raspberry Pi only):
   ```bash
   sudo raspi-config
   # Navigate to Interface Options > Camera > Enable
   # Reboot when prompted
   ```

4. Configure your environment:
   ```bash
   cp .env.example .env
   nano .env  # Edit with your specific settings
   ```

5. Test camera access:
   ```bash
   # For RPi Camera Module
   libcamera-still -o test.jpg
   
   # For USB cameras
   fswebcam -r 1920x1080 test.jpg
   ```

### General Unix Installation

1. Clone and install:
   ```bash
   git clone https://github.com/JdMasuta/Timelaspe-RPi.git
   cd Timelapse2
   npm install
   ```

2. Ensure camera permissions:
   ```bash
   # Add user to video group (may require logout/login)
   sudo usermod -a -G video $USER
   ```

3. Configure environment as needed

## Usage

### Development Mode

Start the server with auto-reload:
```bash
npm run dev
```

### Production Mode

Start the server:
```bash
npm start
```

The application will be available at `http://localhost:3000` (or your configured port).

### Remote Access

Access your timelapse system from any device on your network:
- Find your Raspberry Pi's IP: `hostname -I`
- Access from another device: `http://YOUR_PI_IP:3000`
- **Live camera stream**: `http://YOUR_PI_IP:8080/stream.html`
- **MJPG stream URL**: `http://YOUR_PI_IP:8080/?action=stream`

## MJPG-Streamer Integration

The system uses MJPG-Streamer to provide live camera streaming capabilities.

### Stream URLs

- **Web viewer**: `http://YOUR_PI_IP:8080/stream.html`
- **Direct MJPG stream**: `http://YOUR_PI_IP:8080/?action=stream`  
- **Still image**: `http://YOUR_PI_IP:8080/?action=snapshot`

### Manual MJPG-Streamer Control

Start streaming (Raspberry Pi Camera):
```bash
cd /usr/local/bin
export LD_LIBRARY_PATH=/usr/local/lib
./mjpg_streamer -i "input_raspicam.so -x 1920 -y 1080 -fps 15 -ex auto" -o "output_http.so -w /usr/local/share/mjpg-streamer/www -p 8080"
```

Start streaming (USB Camera):
```bash
cd /usr/local/bin  
export LD_LIBRARY_PATH=/usr/local/lib
./mjpg_streamer -i "input_uvc.so -d /dev/video0 -r 1920x1080 -f 15" -o "output_http.so -w /usr/local/share/mjpg-streamer/www -p 8080"
```

Stop streaming:
```bash
pkill mjpg_streamer
```

### Running as a Service (Raspberry Pi)

To run automatically on boot:

1. Create a systemd service:
   ```bash
   sudo nano /etc/systemd/system/timelapse2.service
   ```

2. Add service configuration:
   ```ini
   [Unit]
   Description=Timelapse2 Service
   After=network.target

   [Service]
   Type=simple
   User=pi
   WorkingDirectory=/home/pi/Timelapse2
   ExecStart=/usr/bin/node server.js
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

3. Enable and start:
   ```bash
   sudo systemctl enable timelapse2.service
   sudo systemctl start timelapse2.service
   ```

## API Endpoints

### Timelapse Control
- `GET /` - Main application interface
- `POST /api/start` - Start timelapse capture
- `POST /api/stop` - Stop timelapse capture
- `GET /api/status` - Get current capture status

### Streaming Control
- `POST /api/stream/start` - Start MJPG-Streamer
- `POST /api/stream/stop` - Stop MJPG-Streamer
- `GET /api/stream/status` - Get streaming status
- `GET /api/stream/snapshot` - Capture single image via stream

## Project Structure

```
Timelapse2/
├── api.js          # API route handlers
├── app.js          # Main application logic
├── server.js       # Express server setup
├── index.html      # Main HTML interface
├── styles.css      # CSS styles
├── ui.js           # Frontend JavaScript
├── package.json    # Node.js dependencies
└── README.md       # This file
```

## Configuration

The application can be configured through environment variables:

- `PORT` - Server port (default: 3000)
- `CAPTURE_INTERVAL` - Time between captures in seconds
- `OUTPUT_DIR` - Directory for storing captured images

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any problems or have questions:

1. Check the [TROUBLESHOOTING.md](TROUBLESHOOTING.md) guide
2. Review the [GitHub Issues](https://github.com/JdMasuta/Timelaspe-RPi/issues)
3. Open a new issue with detailed information

## Changelog

### v1.0.0
- Initial release
- Basic timelapse functionality
- Web interface
- Real-time updates via Socket.io
