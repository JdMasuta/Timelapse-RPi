## Troubleshooting

### MJPG-Streamer Issues

**Stream not accessible:**
```bash
# Check if MJPG-Streamer is running
pgrep mjpg_streamer

# Check port availability
sudo netstat -tlnp | grep :8080

# Test camera access
# RPi Camera: libcamera-still -o test.jpg
# USB Camera: fswebcam -d /dev/video0 test.jpg
```

**Permission denied errors:**
```bash
# Add user to video group
sudo usermod -a -G video $USER
# Log out and back in for changes to take effect

# Check camera permissions
ls -l /dev/video*
```

**Camera busy/in use:**
```bash
# Stop conflicting processes
sudo systemctl stop mjpg-streamer
pkill mjpg_streamer

# Check what's using the camera
sudo lsof /dev/video0
```

**Build/compilation errors:**
```bash
# Ensure all dependencies are installed
sudo apt update
sudo apt install cmake libjpeg8-dev gcc g++ build-essential

# Clean build and retry
cd /tmp/mjpg-streamer/mjpg-streamer-experimental
make clean
make
sudo make install
```

### Camera Issues

**Raspberry Pi Camera not detected:**
```bash
# Enable camera in raspi-config
sudo raspi-config
# Navigate to: Interface Options > Camera > Enable

# Test camera
libcamera-still -o test.jpg
```

**USB Camera not working:**
```bash
# List available cameras
v4l2-ctl --list-devices

# Test camera formats
v4l2-ctl -d /dev/video0 --list-formats-ext

# Try different device
ls /dev/video*
```

### Network Access Issues

**Cannot access from other devices:**
```bash
# Check firewall (if enabled)
sudo ufw status
sudo ufw allow 3000  # Timelapse2 web interface
sudo ufw allow 8080  # MJPG-Streamer

# Check if services are binding to all interfaces
netstat -tlnp | grep :3000
netstat -tlnp | grep :8080
```

**Find Raspberry Pi IP address:**
```bash
hostname -I
ip addr show
```

### Performance Issues

**High CPU usage:**
- Reduce stream resolution in .env
- Lower FPS (frames per second)
- Reduce JPEG quality

**Storage filling up:**
- Enable AUTO_CLEANUP in .env
- Reduce MAX_IMAGES setting
- Check CLEANUP_OLDER_THAN_DAYS setting

### Service Issues

**Services not starting:**
```bash
# Check service status
sudo systemctl status timelapse2
sudo systemctl status mjpg-streamer

# View service logs
sudo journalctl -u timelapse2 -f
sudo journalctl -u mjpg-streamer -f

# Restart services
sudo systemctl restart timelapse2
sudo systemctl restart mjpg-streamer
```

### Getting Help

If you encounter issues not covered here:

1. Check the [GitHub Issues](https://github.com/JdMasuta/Timelaspe-RPi/issues)
2. Include in your issue report:
   - Raspberry Pi model and OS version
   - Camera type (RPi Camera Module version or USB camera model)
   - Error messages and logs
   - Steps to reproduce the problem
