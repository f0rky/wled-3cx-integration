// WLED-3CX Integration Script
const axios = require('axios');
const WebSocket = require('ws');

// Configuration
const config = {
  // 3CX Configuration
  threecx: {
    websocketUrl: 'ws://your-3cx-server:port', // Replace with your 3CX WebSocket URL
    username: 'your-username',                 // Your 3CX username
    password: 'your-password',                 // Your 3CX password
    extension: 'your-extension',               // Your 3CX extension number
  },
  // WLED Configuration
  wled: {
    ipAddress: '192.168.1.100',                // Replace with your WLED device IP address
    statusColors: {
      available: { r: 0, g: 255, b: 0 },      // Green for available
      ringing: { r: 255, g: 255, b: 0 },      // Yellow for ringing
      onCall: { r: 255, g: 0, b: 0 },         // Red for on a call
      dnd: { r: 128, g: 0, b: 128 },          // Purple for do not disturb
      away: { r: 255, g: 165, b: 0 },         // Orange for away
      offline: { r: 0, g: 0, b: 255 },        // Blue for offline
    },
    brightness: 128,                           // 0-255
    transition: 1000,                          // Transition time in milliseconds
  },
  // Polling interval (ms) if WebSocket is not available
  pollingInterval: 5000,
};

// Last known status to prevent unnecessary updates
let lastStatus = null;

// Function to connect to 3CX WebSocket API
async function connect3CXWebSocket() {
  console.log('Connecting to 3CX WebSocket...');
  
  const ws = new WebSocket(config.threesx.websocketUrl);
  
  ws.on('open', () => {
    console.log('Connected to 3CX WebSocket');
    // Authenticate with 3CX
    ws.send(JSON.stringify({
      type: 'login',
      username: config.threesx.username,
      password: config.threesx.password,
    }));
    
    // Subscribe to extension status changes
    ws.send(JSON.stringify({
      type: 'subscribe',
      extension: config.threesx.extension,
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

// Function to poll 3CX API for status updates (fallback method)
async function startPolling() {
  console.log('Starting polling for 3CX status...');
  
  // Set up interval to check status
  setInterval(async () => {
    try {
      // Make API request to 3CX (this is simplified - you'll need the actual API endpoints)
      const response = await axios.get(`http://your-3cx-server/api/extensions/${config.threesx.extension}/status`, {
        auth: {
          username: config.threesx.username,
          password: config.threesx.password,
        }
      });
      
      if (response.data && response.data.status) {
        handleStatusChange(response.data.status);
      }
    } catch (error) {
      console.error('Error polling 3CX status:', error);
    }
  }, config.pollingInterval);
}

// Function to handle status changes and update WLED
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

// Function to update WLED with new color
async function updateWLED(color) {
  try {
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

// Start the application
async function main() {
  console.log('Starting WLED-3CX Integration');
  
  try {
    // Try WebSocket first
    const ws = await connect3CXWebSocket();
    
    // Set up error handling and graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
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
main().catch(console.error);