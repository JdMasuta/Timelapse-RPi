// ui.js

// Function to show transient notifications
function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification show ${type}`; // Add type class for styling

    // Hide after 3 seconds
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Initial state updates (e.g., when page loads)
// These would typically be populated by the server via socket.io 'statusUpdate' and 'configUpdate'
// but adding some initial setup here for robust UI.
document.addEventListener('DOMContentLoaded', () => {
    // Set initial stream button text based on status
    const streamBtn = document.getElementById('streamBtn');
    const streamPlaceholder = document.getElementById('streamPlaceholder');
    const liveStreamImg = document.getElementById('liveStream');

    if (streamBtn.textContent.includes('Start Preview')) {
        liveStreamImg.style.display = 'none';
        streamPlaceholder.style.display = 'flex';
    } else {
        liveStreamImg.style.display = 'block';
        streamPlaceholder.style.display = 'none';
    }

    // Set initial stream status for connection
    document.getElementById('streamConnectionStatus').textContent = '🔴 Disconnected';
    document.getElementById('streamConnectionStatus').className = 'stream-status disconnected';
});

// IMPORTANT: Override the built-in confirm to use a custom modal
// This is a placeholder for a real custom modal implementation.
// For a production app, you'd build a modal with HTML/CSS and show/hide it.
window.confirm = function(message) {
    // In a real application, you would create a custom modal
    // with buttons for "Yes" and "No" and return a Promise that resolves
    // based on the user's choice.
    // For this example, we'll just use the console.
    console.warn(`Custom Confirm Dialog: ${message}`);
    return true; // Auto-confirm for demonstration purposes
};