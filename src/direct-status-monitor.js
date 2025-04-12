/**
 * Direct Status Monitor for WLED-3CX Integration
 * 
 * This script uses a simpler approach to monitor 3CX status and update WLED.
 * It doesn't require browser automation or cookies.
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration from environment variables
const config = {
  // 3CX Configuration
  threecx: {
    statusUrl: process.env.THREECX_STATUS_URL || 'https://primonz.my3cx.nz/api/status',
    refreshInterval: parseInt(process.env.STATUS_CHECK_INTERVAL || '5000', 10),
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
  // Manual status override (for testing)
  manualStatus: process.env.MANUAL_STATUS || null,
};

// Last known status to prevent unnecessary updates
let lastStatus = null;
let manualOverrideActive = false;

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
    case 'onCall':
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
    default:
      color = config.wled.statusColors.offline;
      break;
  }
  
  // Update WLED
  await updateWLED(color);
}

/**
 * Setup manual status override via keyboard input
 */
function setupManualOverride() {
  console.log('\nManual Status Override Mode');
  console.log('---------------------------');
  console.log('Press the following keys to manually set status:');
  console.log('  a: Available');
  console.log('  r: Ringing');
  console.log('  c: On Call');
  console.log('  d: Do Not Disturb');
  console.log('  w: Away');
  console.log('  o: Offline');
  console.log('  q: Quit');
  
  // Set up key listener
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (key) => {
    const keyPressed = key.toString().toLowerCase();
    
    switch (keyPressed) {
      case 'a':
        manualOverrideActive = true;
        await handleStatusChange('available');
        console.log('Status manually set to: Available');
        break;
      case 'r':
        manualOverrideActive = true;
        await handleStatusChange('ringing');
        console.log('Status manually set to: Ringing');
        break;
      case 'c':
        manualOverrideActive = true;
        await handleStatusChange('onCall');
        console.log('Status manually set to: On Call');
        break;
      case 'd':
        manualOverrideActive = true;
        await handleStatusChange('dnd');
        console.log('Status manually set to: Do Not Disturb');
        break;
      case 'w':
        manualOverrideActive = true;
        await handleStatusChange('away');
        console.log('Status manually set to: Away');
        break;
      case 'o':
        manualOverrideActive = true;
        await handleStatusChange('offline');
        console.log('Status manually set to: Offline');
        break;
      case 'q':
      case '\u0003': // Ctrl+C
        console.log('Shutting down...');
        // Turn off WLED or set to default color on exit
        await updateWLED({r: 0, g: 0, b: 0});
        process.exit(0);
        break;
    }
  });
}

/**
 * Main application function
 */
async function main() {
  console.log('Starting Direct Status Monitor for WLED-3CX Integration');
  
  // Validate configuration
  if (!config.wled.ipAddress) {
    console.error('Missing required configuration. Please check your .env file.');
    process.exit(1);
  }
  
  try {
    // Set up manual override
    setupManualOverride();
    
    // Check for initial manual status
    if (config.manualStatus) {
      console.log(`Using initial manual status: ${config.manualStatus}`);
      await handleStatusChange(config.manualStatus);
      manualOverrideActive = true;
    }
    
    // Set up error handling and graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      
      // Turn off WLED or set to default color on exit
      await updateWLED({r: 0, g: 0, b: 0});
      
      process.exit(0);
    });
  } catch (error) {
    console.error('Application error:', error);
    process.exit(1);
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
  handleStatusChange,
  updateWLED
};
