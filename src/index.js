/**
 * WLED-3CX Integration
 * 
 * This script integrates 3CX phone system status with WLED LED strips,
 * showing different colors based on call status.
 */

// Load environment variables
require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');

// Configuration from environment variables
const config = {
  // 3CX Configuration
  threecx: {
    websocketUrl: process.env.THREECX_WEBSOCKET_URL,
    username: process.env.THREECX_USERNAME,
    password: process.env.THREECX_PASSWORD,
    extension: process.env.THREECX_EXTENSION,
  },
  // WLED Configuration
  wled: {
    ipAddress: process.env.WLED_IP_ADDRESS,
    brightness: parseInt(process.env.WLED_BRIGHTNESS || '128', 10),
    transition: parseInt(process.env.WLED_TRANSITION || '1000', 10),
    statusColors: {
      available: { r: 0, g: 255, b: 0 },      // Green for available
      ringing: { r: 255, g: 255, b: 0 },      // Yellow for ringing
      onCall: { r: 255, g: 0, b: 0 },         // Red for on a call
      dnd: { r: 128, g: 0, b: 128 },          // Purple for do not disturb
      away: { r: 255, g: 165, b: 0 },         // Orange for away
      offline: { r: 0, g: 0, b: 255 },        // Blue for offline
    },
  },
  // Polling interval (ms) if WebSocket is not available
  pollingInterval: parseInt(process.env.POLLING_INTERVAL || '5000', 10),
};

// Last known status to prevent unnecessary updates
let lastStatus = null;
let pollingIntervalId = null;

/**
 * Connect to 3CX WebSocket API
 * @returns {WebSocket} The WebSocket connection
 */
async function connect3CXWebSocket() {
  console.log('Connecting to 3CX WebSocket...');
  
  // Validate required configuration
  if (!config.threecx.websocketUrl) {
    throw new Error('3CX WebSocket URL is not configured');
  }
  
  const ws = new WebSocket(config.threecx.websocketUrl);
  
  ws.on('open', () => {
    console.log('Connected to 3CX WebSocket');
    // Authenticate with 3CX
    ws.send(JSON.stringify({
      type: 'login',
      username: config.threecx.username,
      password: config.threecx.password,
    }));
    
    // Subscribe to extension status changes
    ws.send(JSON.stringify({
      type: 'subscribe',
      extension: config.threecx.extension,
    }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'status') {
        handleStatusChange(message.status);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    console.log('Falling back to polling method...');
    // Fallback to polling if WebSocket fails
    startPolling();
  });
  
  ws.on('close', () => {
    console.log('WebSocket connection closed');
    // Try to reconnect after a delay
    setTimeout(() => connect3CXWebSocket(), 5000);
  });
  
  return ws;
}

/**
 * Poll 3CX API for status updates (fallback method)
 */
function startPolling() {
  // Clear any existing polling interval
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
  }
  
  console.log('Starting polling for 3CX status...');
  
  // Set up interval to check status
  pollingIntervalId = setInterval(async () => {
    try {
      // Make API request to 3CX (this is simplified - you'll need the actual API endpoints)
      const response = await axios.get(
        `http://${new URL(config.threecx.websocketUrl).hostname}/api/extensions/${config.threecx.extension}/status`, 
        {
          auth: {
            username: config.threecx.username,
            password: config.threecx.password,
          }
        }
      );
      
      if (response.data && response.data.status) {
        handleStatusChange(response.data.status);
      }
    } catch (error) {
      console.error('Error polling 3CX status:', error);
    }
  }, config.pollingInterval);
  
  return pollingIntervalId;
}

/**
 * Handle status changes and update WLED
 * @param {string} status - The new status from 3CX
 */
async function handleStatusChange(status) {
  console.log(`3CX status changed to: ${status}`);
  
  // Don't update if status hasn't changed
  if (status === lastStatus) return;
  lastStatus = status;
  
  // Map 3CX status to WLED colors
  let color;
  switch (status) {
    case 'available':
      color = config.wled.statusColors.available;
      break;
    case 'ringing':
      color = config.wled.statusColors.ringing;
      break;
    case 'busy':
    case 'on-call':
      color = config.wled.statusColors.onCall;
      break;
    case 'dnd':
      color = config.wled.statusColors.dnd;
      break;
    case 'away':
      color = config.wled.statusColors.away;
      break;
    case 'offline':
      color = config.wled.statusColors.offline;
      break;
    default:
      color = config.wled.statusColors.available;
  }
  
  // Update WLED
  await updateWLED(color);
}

/**
 * Update WLED with new color
 * @param {Object} color - RGB color object {r, g, b}
 */
async function updateWLED(color) {
  try {
    // Validate required configuration
    if (!config.wled.ipAddress) {
      throw new Error('WLED IP address is not configured');
    }
    
    console.log(`Setting WLED color to RGB(${color.r},${color.g},${color.b})`);
    
    const url = `http://${config.wled.ipAddress}/json`;
    const payload = {
      on: true,
      bri: config.wled.brightness,
      transition: config.wled.transition / 1000, // WLED uses seconds
      seg: [
        {
          col: [
            [color.r, color.g, color.b]
          ],
          fx: 0, // Solid color effect
          sx: 128, // Effect speed (not needed for solid)
          ix: 128, // Effect intensity (not needed for solid)
        }
      ]
    };
    
    await axios.post(url, payload);
    console.log('WLED updated successfully');
  } catch (error) {
    console.error('Error updating WLED:', error);
  }
}

/**
 * Main application function
 */
async function main() {
  console.log('Starting WLED-3CX Integration');
  
  // Validate configuration
  if (!config.threecx.websocketUrl || !config.wled.ipAddress) {
    console.error('Missing required configuration. Please check your .env file.');
    process.exit(1);
  }
  
  try {
    // Try WebSocket first
    const ws = await connect3CXWebSocket();
    
    // Set up error handling and graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      
      if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
      }
      
      // Turn off WLED or set to default color on exit
      await updateWLED({r: 0, g: 0, b: 0});
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to initialize WebSocket connection:', error);
    startPolling();
  }
}

// Run the application
if (require.main === module) {
  main().catch(error => {
    console.error('Application error:', error);
    process.exit(1);
  });
}

// Export functions for testing or external use
module.exports = {
  connect3CXWebSocket,
  startPolling,
  handleStatusChange,
  updateWLED
};
