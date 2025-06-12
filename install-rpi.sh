#!/bin/bash
# Raspberry Pi Installation Script for Timelapse2
# Run with: bash install-rpi.sh

echo "🍓 Timelapse2 Raspberry Pi Installation Script"
echo "=============================================="

# Check if running on Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
    echo "⚠️  Warning: This script is optimized for Raspberry Pi"
    echo "   It should work on other Unix systems but may need adjustments"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Update system packages
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "✅ Node.js already installed: $(node --version)"
fi

# Install additional dependencies
echo "📦 Installing system dependencies..."
sudo apt install -y git libcamera-apps fswebcam cmake libjpeg8-dev gcc g++

# Install/Build MJPG-Streamer
echo "🎥 Installing MJPG-Streamer..."
if [ ! -d "/tmp/mjpg-streamer" ]; then
    cd /tmp
    git clone https://github.com/jacksonliam/mjpg-streamer.git
    cd mjpg-streamer/mjpg-streamer-experimental
    make
    sudo make install
    echo "✅ MJPG-Streamer installed successfully"
else
    echo "✅ MJPG-Streamer source already exists, skipping download"
fi

# Install project dependencies
echo "📦 Installing project dependencies..."
cd "$OLDPWD"  # Return to original directory
npm install

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p captures logs

# Copy environment file
if [ ! -f .env ]; then
    echo "⚙️  Setting up environment configuration..."
    cp .env.example .env
    echo "✅ Created .env file - please configure it for your setup"
else
    echo "✅ .env file already exists"
fi

# Set up camera permissions
echo "🎥 Setting up camera permissions..."
sudo usermod -a -G video $USER

# Check camera availability
echo "🔍 Checking camera and streaming availability..."
if [ -e /dev/video0 ]; then
    echo "✅ USB camera detected at /dev/video0"
elif command -v libcamera-still &> /dev/null; then
    echo "✅ libcamera tools available for RPi Camera Module"
else
    echo "⚠️  No camera detected. Please:"
    echo "   - Connect a USB camera, or"
    echo "   - Enable RPi Camera Module: sudo raspi-config"
fi

# Test MJPG-Streamer installation
if command -v mjpg_streamer &> /dev/null; then
    echo "✅ MJPG-Streamer installed successfully"
    echo "   Stream will be available at: http://$(hostname -I | awk '{print $1}'):8080"
else
    echo "⚠️  MJPG-Streamer installation may have failed"
fi

# Offer to install as service
echo ""
read -p "🚀 Install Timelapse2 as system service (auto-start on boot)? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "📋 Creating Timelapse2 systemd service..."
    sudo tee /etc/systemd/system/timelapse2.service > /dev/null <<EOF
[Unit]
Description=Timelapse2 Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PWD
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable timelapse2.service
    echo "✅ Timelapse2 service created and enabled"
    echo "   Start with: sudo systemctl start timelapse2"
    echo "   Stop with: sudo systemctl stop timelapse2"
    echo "   Status: sudo systemctl status timelapse2"
fi

# Offer to install MJPG-Streamer as service
echo ""
read -p "📹 Install MJPG-Streamer as system service (auto-start streaming)? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🎥 Setting up MJPG-Streamer service..."
    echo "Choose camera type:"
    echo "1) Raspberry Pi Camera Module"  
    echo "2) USB Camera"
    read -p "Enter choice (1 or 2): " -n 1 -r
    echo
    
    if [[ $REPLY == "1" ]]; then
        MJPG_EXEC_START='/usr/local/bin/mjpg_streamer -i "input_raspicam.so -x 1280 -y 720 -fps 15 -ex auto" -o "output_http.so -w /usr/local/share/mjpg-streamer/www -p 8080"'
    elif [[ $REPLY == "2" ]]; then
        MJPG_EXEC_START='/usr/local/bin/mjpg_streamer -i "input_uvc.so -d /dev/video0 -r 1280x720 -f 15" -o "output_http.so -w /usr/local/share/mjpg-streamer/www -p 8080"'
    else
        echo "❌ Invalid choice, skipping MJPG-Streamer service setup"
        MJPG_EXEC_START=""
    fi
    
    if [ -n "$MJPG_EXEC_START" ]; then
        sudo tee /etc/systemd/system/mjpg-streamer.service > /dev/null <<EOF
[Unit]
Description=MJPG-Streamer for Timelapse2
After=network.target

[Service]
Type=simple
User=$USER
Group=video
WorkingDirectory=/usr/local/bin
Environment=LD_LIBRARY_PATH=/usr/local/lib
ExecStart=$MJPG_EXEC_START
ExecStop=/bin/kill -TERM \$MAINPID
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

        sudo systemctl daemon-reload
        sudo systemctl enable mjpg-streamer.service
        echo "✅ MJPG-Streamer service created and enabled"
        echo "   Start with: sudo systemctl start mjpg-streamer"
        echo "   Stop with: sudo systemctl stop mjpg-streamer"
        echo "   Status: sudo systemctl status mjpg-streamer"
    fi
fi

echo ""
echo "🎉 Installation complete!"
echo ""
echo "Next steps:"
echo "1. Configure .env file with your settings"
echo "2. Test camera: libcamera-still -o test.jpg (RPi) or fswebcam test.jpg (USB)"
echo "3. Test MJPG-Streamer manually:"
echo "   For RPi Camera: mjpg_streamer -i 'input_raspicam.so -x 1280 -y 720' -o 'output_http.so -p 8080'"
echo "   For USB Camera: mjpg_streamer -i 'input_uvc.so -d /dev/video0 -r 1280x720' -o 'output_http.so -p 8080'"
echo "4. Start development server: npm run dev"
echo "5. Access web interface: http://$(hostname -I | awk '{print $1}'):3000"
echo "6. Access camera stream: http://$(hostname -I | awk '{print $1}'):8080/stream.html"
echo ""
echo "📖 See README.md for detailed configuration options"
