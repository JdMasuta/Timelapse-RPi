#!/bin/bash
# Updated Raspberry Pi Installation Script for Timelapse2

set -e  # Exit on error
echo "🍓 Timelapse2 Raspberry Pi Installation Script"
echo "=============================================="

# Check for Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
    echo "⚠️  Not running on Raspberry Pi. Continue anyway? (y/N): "
    read -r CONTINUE
    [[ ! $CONTINUE =~ ^[Yy]$ ]] && exit 1
fi

# Ensure we have network connection
ping -c 1 google.com &>/dev/null || {
    echo "❌ No internet connection. Please connect before continuing."
    exit 1
}

# Update packages
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Check and install correct Node.js version
NODE_OK=false
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | sed 's/v//')
    NODE_MAJOR=${NODE_VERSION%%.*}
    if (( NODE_MAJOR >= 22 )); then
        echo "✅ Node.js $NODE_VERSION already installed"
        NODE_OK=true
    else
        echo "⚠️  Installed Node.js is too old. Installing v22..."
    fi
fi

if [ "$NODE_OK" = false ]; then
    echo "📦 Installing Node.js v22 via nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install 22 || {
        echo "❌ Node.js install failed. Please install manually."
        exit 1
    }
fi
echo "✅ Node.js installed successfully"

# Install dependencies
echo "📦 Installing system dependencies..."
sudo apt install -y git libcamera-apps fswebcam cmake libjpeg-dev gcc g++

# Clone or update MJPG-Streamer
echo "🎥 Preparing MJPG-Streamer..."
cd /tmp/
if [ -d "mjpg-streamer" ]; then
    echo "🔁 Updating existing MJPG-Streamer repo..."
    cd mjpg-streamer
    git pull
else
    echo "⬇️ Cloning MJPG-Streamer repo..."
    git clone https://github.com/jacksonliam/mjpg-streamer.git
    cd mjpg-streamer
fi

cd mjpg-streamer-experimental

# Build only if binary not already present
if [ ! -f "/usr/local/bin/mjpg_streamer" ]; then
    echo "⚙️  Building MJPG-Streamer..."
    make && sudo make install
    echo "✅ MJPG-Streamer installed"
else
    echo "✅ MJPG-Streamer already built and installed"
fi

# Return to project directory
cd /home/access/Timelapse-RPi || {
    echo "❌ Timelapse-RPi directory not found in previous working dir"
    exit 1
}

# Check required files
if [ ! -f "server.js" ]; then
    echo "❌ server.js not found. Please make sure you're in the project root."
    exit 1
fi

if [ ! -f ".env" ]; then
    echo "⚙️  Setting up .env..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✅ .env file created from example"
    else
        echo "❌ .env.example not found. Please provide one before proceeding."
        exit 1
    fi
else
    echo "✅ .env file exists"
fi

# NPM dependencies
echo "📦 Installing Node dependencies..."
npm install || {
    echo "❌ npm install failed. Check for errors and try again."
    exit 1
}

# Create needed folders
echo "📁 Creating captures and logs directories..."
mkdir -p captures logs

# Camera setup
echo "🎥 Adding user to video group..."
sudo usermod -a -G video "$USER"

echo "🔍 Checking camera availability..."
if [ -e /dev/video0 ]; then
    echo "✅ USB camera detected"
elif command -v libcamera-still &> /dev/null; then
    echo "✅ libcamera tools available"
else
    echo "⚠️  No camera detected. Run: sudo raspi-config to enable or plug in a camera."
fi

# Verify MJPG-Streamer
if command -v mjpg_streamer &> /dev/null; then
    echo "✅ MJPG-Streamer installed"
else
    echo "⚠️  MJPG-Streamer not found. Check installation."
fi

# Offer to create systemd service for Timelapse2
read -p "🚀 Install Timelapse-RPi as system service? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "📋 Creating systemd service..."
    sudo tee /etc/systemd/system/timelapse.service > /dev/null <<EOF
[Unit]
Description=Timelapse-RPi Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PWD
ExecStart=$(which node) server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable timelapse.service

    if systemctl list-unit-files | grep -q timelapse.service; then
        echo "✅ timelapse.service created and enabled"
    else
        echo "❌ Failed to create timelapse.service. Check permissions or syntax."
    fi
fi

# Show access info
LOCAL_IP=$(hostname -I | awk '{print $1}')
HOSTNAME=$(hostname)

echo ""
echo "🎉 Installation complete!"
echo ""
echo "➡️  Web interface: http://$LOCAL_IP:3000 or http://$HOSTNAME:3000"
echo "➡️  Camera stream: http://$LOCAL_IP:8080/stream.html"
echo ""
echo "📖 See README.md for more details"
