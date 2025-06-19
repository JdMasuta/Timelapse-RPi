// ui.js - Enhanced UI with tab management and configuration helpers

// Function to show transient notifications
function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    
    // Add specific class for configuration-related notifications
    let notificationClass = `notification show ${type}`;
    if (message.toLowerCase().includes('configuration') || message.toLowerCase().includes('config')) {
        notificationClass += type === 'success' ? ' config-saved' : ' config-error';
    }
    
    notification.className = notificationClass;

    // Hide after 4 seconds (longer for config messages)
    const hideDelay = (type === 'success' && message.toLowerCase().includes('config')) ? 4000 : 3000;
    setTimeout(() => {
        notification.classList.remove('show');
    }, hideDelay);
}

/**
 * Switch between configuration tabs
 */
function switchTab(tabName) {
    // Hide all tab contents
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
        content.classList.remove('active');
    });
    
    // Remove active class from all tab buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.classList.remove('active');
    });
    
    // Show selected tab content
    const selectedTab = document.getElementById(`tab-${tabName}`);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Activate selected tab button
    const selectedButton = event?.target || document.querySelector(`[onclick="switchTab('${tabName}')"]`);
    if (selectedButton) {
        selectedButton.classList.add('active');
    }
    
    // Store active tab in sessionStorage for persistence
    sessionStorage.setItem('activeConfigTab', tabName);
    
    console.log(`Switched to tab: ${tabName}`);
}

/**
 * Initialize tab state on page load
 */
function initializeTabs() {
    // Get previously active tab or default to 'basic'
    const activeTab = sessionStorage.getItem('activeConfigTab') || 'basic';
    switchTab(activeTab);
}

/**
 * Add real-time validation to form inputs
 */
function initializeFormValidation() {
    // Capture Interval validation
    const captureInterval = document.getElementById('captureInterval');
    if (captureInterval) {
        captureInterval.addEventListener('input', function() {
            const value = parseInt(this.value);
            if (value < 1 || value > 3600) {
                this.setCustomValidity('Capture interval must be between 1 and 3600 seconds');
            } else {
                this.setCustomValidity('');
            }
        });
    }
    
    // Resolution validation
    const resolutionWidth = document.getElementById('resolutionWidth');
    const resolutionHeight = document.getElementById('resolutionHeight');
    
    if (resolutionWidth) {
        resolutionWidth.addEventListener('input', function() {
            const value = parseInt(this.value);
            if (value < 320 || value > 4096) {
                this.setCustomValidity('Width must be between 320 and 4096 pixels');
            } else {
                this.setCustomValidity('');
            }
        });
    }
    
    if (resolutionHeight) {
        resolutionHeight.addEventListener('input', function() {
            const value = parseInt(this.value);
            if (value < 240 || value > 2160) {
                this.setCustomValidity('Height must be between 240 and 2160 pixels');
            } else {
                this.setCustomValidity('');
            }
        });
    }
    
    // Max Images validation
    const maxImages = document.getElementById('maxImages');
    if (maxImages) {
        maxImages.addEventListener('input', function() {
            const value = parseInt(this.value);
            if (value < 10 || value > 10000) {
                this.setCustomValidity('Max images must be between 10 and 10,000');
            } else {
                this.setCustomValidity('');
            }
        });
    }
    
    // Cleanup days validation
    const cleanupDays = document.getElementById('cleanupOlderThanDays');
    if (cleanupDays) {
        cleanupDays.addEventListener('input', function() {
            const value = parseInt(this.value);
            if (value < 1 || value > 365) {
                this.setCustomValidity('Cleanup days must be between 1 and 365');
            } else {
                this.setCustomValidity('');
            }
        });
    }
}

/**
 * Add tooltips to complex settings
 */
function initializeTooltips() {
    const tooltips = [
        { id: 'videoCodec', text: 'H.264: Most compatible, H.265: Better compression, VP9: Open source' },
        { id: 'videoBitrate', text: 'Higher bitrate = better quality but larger file sizes' },
        { id: 'enableHardwareAcceleration', text: 'Uses GPU for faster video encoding if available' },
        { id: 'debugMode', text: 'Enables detailed logging for troubleshooting issues' },
        { id: 'mockCamera', text: 'Simulates camera for testing without real hardware' }
    ];
    
    tooltips.forEach(tooltip => {
        const element = document.getElementById(tooltip.id);
        if (element) {
            element.setAttribute('data-tooltip', tooltip.text);
            element.classList.add('tooltip');
        }
    });
}

/**
 * Show configuration summary
 */
function showConfigurationSummary(config) {
    // Create summary display if it doesn't exist
    let summaryDiv = document.querySelector('.config-summary');
    if (!summaryDiv) {
        summaryDiv = document.createElement('div');
        summaryDiv.className = 'config-summary';
        
        const configPanel = document.querySelector('.panel h2');
        if (configPanel && configPanel.textContent.includes('Configuration')) {
            configPanel.parentNode.insertBefore(summaryDiv, configPanel.nextSibling);
        }
    }
    
    summaryDiv.innerHTML = `
        <h4>📊 Current Configuration Summary</h4>
        <div class="config-summary-grid">
            <div class="config-summary-item">
                <span class="config-summary-value">${config.captureInterval}s</span>
                <span class="config-summary-label">Capture Interval</span>
            </div>
            <div class="config-summary-item">
                <span class="config-summary-value">${config.imageQuality.toUpperCase()}</span>
                <span class="config-summary-label">Image Quality</span>
            </div>
            <div class="config-summary-item">
                <span class="config-summary-value">${config.streamFps} FPS</span>
                <span class="config-summary-label">Stream Rate</span>
            </div>
            <div class="config-summary-item">
                <span class="config-summary-value">${config.videoCodec?.toUpperCase() || 'H264'}</span>
                <span class="config-summary-label">Video Codec</span>
            </div>
            <div class="config-summary-item">
                <span class="config-summary-value">${config.rotation || 0}°</span>
                <span class="config-summary-label">Rotation</span>
            </div>
            <div class="config-summary-item">
                <span class="config-summary-value">${config.autoCleanup ? 'ON' : 'OFF'}</span>
                <span class="config-summary-label">Auto-Cleanup</span>
            </div>
        </div>
    `;
}

/**
 * Handle keyboard shortcuts for power users
 */
function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', function(event) {
        // Ctrl+S to save configuration
        if (event.ctrlKey && event.key === 's') {
            event.preventDefault();
            saveConfig();
            showNotification('Configuration saved via keyboard shortcut', 'success');
        }
        
        // Ctrl+1-5 to switch tabs
        if (event.ctrlKey && event.key >= '1' && event.key <= '5') {
            event.preventDefault();
            const tabs = ['basic', 'camera', 'video', 'storage', 'advanced'];
            const tabIndex = parseInt(event.key) - 1;
            if (tabs[tabIndex]) {
                switchTab(tabs[tabIndex]);
            }
        }
        
        // Ctrl+R to reset (with confirmation)
        if (event.ctrlKey && event.key === 'r') {
            event.preventDefault();
            resetToDefaults();
        }
    });
}

/**
 * Add visual feedback for configuration changes
 */
function initializeChangeTracking() {
    const formElements = document.querySelectorAll('input, select');
    
    formElements.forEach(element => {
        element.addEventListener('change', function() {
            // Add visual indicator that changes are pending
            this.classList.add('changed');
            
            // Show save reminder after a delay
            setTimeout(() => {
                if (document.querySelector('.changed')) {
                    showConfigurationReminder();
                }
            }, 3000);
        });
    });
}

/**
 * Show reminder to save configuration changes
 */
function showConfigurationReminder() {
    const changedElements = document.querySelectorAll('.changed');
    if (changedElements.length > 0) {
        showNotification(`${changedElements.length} setting(s) changed. Don't forget to save!`, 'info');
    }
}

/**
 * Clear change indicators after successful save
 */
function clearChangeIndicators() {
    const changedElements = document.querySelectorAll('.changed');
    changedElements.forEach(element => {
        element.classList.remove('changed');
    });
}

// Initial state updates and setup
document.addEventListener('DOMContentLoaded', () => {
    // Initialize all UI enhancements
    initializeTabs();
    initializeFormValidation();
    initializeTooltips();
    initializeKeyboardShortcuts();
    initializeChangeTracking();
    
    // Set initial stream button text based on status
    const streamBtn = document.getElementById('streamBtn');
    const streamPlaceholder = document.getElementById('streamPlaceholder');
    const liveStreamImg = document.getElementById('liveStream');

    if (streamBtn && streamBtn.textContent.includes('Start Preview')) {
        if (liveStreamImg) liveStreamImg.style.display = 'none';
        if (streamPlaceholder) streamPlaceholder.style.display = 'flex';
    } else {
        if (liveStreamImg) liveStreamImg.style.display = 'block';
        if (streamPlaceholder) streamPlaceholder.style.display = 'none';
    }

    // Set initial stream status for connection
    const streamStatus = document.getElementById('streamConnectionStatus');
    if (streamStatus) {
        streamStatus.textContent = '🔴 Disconnected';
        streamStatus.className = 'stream-status disconnected';
    }
    
    console.log('Enhanced UI initialized with comprehensive configuration support');
});

// Listen for successful configuration saves to clear change indicators
if (typeof socket !== 'undefined') {
    socket.on('configSaved', () => {
        clearChangeIndicators();
        showNotification('Configuration saved successfully!', 'success');
    });
    
    socket.on('extendedConfigUpdate', (config) => {
        showConfigurationSummary(config);
    });
}

// IMPORTANT: Override the built-in confirm to use a custom modal
// This is a placeholder for a real custom modal implementation.
window.confirm = function(message) {
    // For production, you would create a custom modal with HTML/CSS
    // and return a Promise that resolves based on user choice
    console.log(`Confirmation Dialog: ${message}`);
    return window.originalConfirm ? window.originalConfirm(message) : true;
};

// Store original confirm function
window.originalConfirm = window.confirm;
