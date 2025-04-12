/**
 * 3CX Status Client for Windows
 * 
 * This script monitors 3CX status on a Windows PC and updates WLED accordingly.
 * It uses the Windows Active Directory API to detect call status.
 */

const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  // WLED Configuration
  wled: {
    ipAddress: process.env.WLED_IP_ADDRESS || '192.168.111.50',
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
  // Check interval in milliseconds
  checkInterval: 5000,
};

// Last known status to prevent unnecessary updates
let lastStatus = null;

/**
 * Check 3CX status using Windows PowerShell
 * This uses the Get-CsUserCall cmdlet to check for active calls
 */
async function check3CXStatus() {
  return new Promise((resolve, reject) => {
    // PowerShell command to check for active calls
    // This is a placeholder - you'll need to adjust based on your environment
    const command = 'powershell.exe -Command "Get-Process | Where-Object {$_.ProcessName -like \'*3CX*\' -and $_.MainWindowTitle -like \'*call*\'}"';
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing PowerShell command: ${error}`);
        resolve('offline'); // Default to offline on error
        return;
      }
      
      // Check if there's an active call
      if (stdout.includes('call')) {
        resolve('onCall');
      } else {
        // Check for other statuses
        // This is simplified - you'll need to adjust for your specific 3CX client
        const statusCommand = 'powershell.exe -Command "Get-Process | Where-Object {$_.ProcessName -like \'*3CX*\'} | Select-Object MainWindowTitle"';
        
        exec(statusCommand, (error, stdout, stderr) => {
          if (error) {
            console.error(`Error checking status: ${error}`);
            resolve('offline');
            return;
          }
          
          const windowTitle = stdout.toLowerCase();
          
          if (windowTitle.includes('ringing')) {
            resolve('ringing');
          } else if (windowTitle.includes('dnd') || windowTitle.includes('do not disturb')) {
            resolve('dnd');
          } else if (windowTitle.includes('away')) {
            resolve('away');
          } else if (windowTitle.includes('available')) {
            resolve('available');
          } else {
            resolve('available'); // Default to available
          }
        });
      }
    });
  });
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
 * Handle status changes and update WLED
 * @param {string} status - The new status from 3CX
 */
async function handleStatusChange(status) {
  console.log(`3CX status detected: ${status}`);
  
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
 * Main application function
 */
async function main() {
  console.log('Starting 3CX Status Client for Windows');
  
  try {
    // Initial status check
    const initialStatus = await check3CXStatus();
    await handleStatusChange(initialStatus);
    
    // Set up interval to check status
    setInterval(async () => {
      try {
        const status = await check3CXStatus();
        await handleStatusChange(status);
      } catch (error) {
        console.error('Error in status check cycle:', error);
      }
    }, config.checkInterval);
    
    console.log(`Status checking active. Checking every ${config.checkInterval / 1000} seconds.`);
    
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
main().catch(error => {
  console.error('Application error:', error);
  process.exit(1);
});
