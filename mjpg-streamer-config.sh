# MJPG-Streamer Configuration for Timelapse2
# This file contains common configurations for different camera setups

# Raspberry Pi Camera Module (input_raspicam)
# Basic 720p streaming
export MJPG_CMD_RASPICAM_720P="mjpg_streamer -i 'input_raspicam.so -x 1280 -y 720 -fps 15 -ex auto' -o 'output_http.so -w /usr/local/share/mjpg-streamer/www -p 8080'"

# High quality 1080p streaming  
export MJPG_CMD_RASPICAM_1080P="mjpg_streamer -i 'input_raspicam.so -x 1920 -y 1080 -fps 10 -ex auto -ISO 100' -o 'output_http.so -w /usr/local/share/mjpg-streamer/www -p 8080'"

# Low bandwidth 480p streaming
export MJPG_CMD_RASPICAM_480P="mjpg_streamer -i 'input_raspicam.so -x 640 -y 480 -fps 30 -ex auto' -o 'output_http.so -w /usr/local/share/mjpg-streamer/www -p 8080'"

# USB Camera (input_uvc)
# Basic 720p streaming
export MJPG_CMD_USB_720P="mjpg_streamer -i 'input_uvc.so -d /dev/video0 -r 1280x720 -f 15 -q 80' -o 'output_http.so -w /usr/local/share/mjpg-streamer/www -p 8080'"

# High quality 1080p streaming
export MJPG_CMD_USB_1080P="mjpg_streamer -i 'input_uvc.so -d /dev/video0 -r 1920x1080 -f 10 -q 90' -o 'output_http.so -w /usr/local/share/mjpg-streamer/www -p 8080'"

# Low bandwidth 480p streaming  
export MJPG_CMD_USB_480P="mjpg_streamer -i 'input_uvc.so -d /dev/video0 -r 640x480 -f 30 -q 70' -o 'output_http.so -w /usr/local/share/mjpg-streamer/www -p 8080'"

# Common parameters:
# -x/-y or -r: Resolution (width x height)
# -fps/-f: Frames per second
# -ex: Exposure mode (auto, night, backlight, etc.)
# -ISO: ISO sensitivity (100-800)
# -q: JPEG quality (0-100)
# -d: Device path for USB cameras
# -p: HTTP port for output
# -w: Web directory path

# Usage examples:
# Start streaming: eval $MJPG_CMD_RASPICAM_720P
# Stop streaming: pkill mjpg_streamer
# Check if running: pgrep mjpg_streamer

# Stream URLs:
# Live stream: http://YOUR_IP:8080/?action=stream
# Snapshot: http://YOUR_IP:8080/?action=snapshot  
# Web interface: http://YOUR_IP:8080/stream.html
