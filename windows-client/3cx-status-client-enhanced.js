/**
 * Enhanced 3CX Status Client for Windows
 * 
 * This script uses multiple methods to detect 3CX status and updates WLED accordingly.
 */

require('dotenv').config();
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
  checkInterval: parseInt(process.env.CHECK_INTERVAL || '5000', 10),
  // Debug mode
  debug: process.env.DEBUG === 'true',
};

// Last known status to prevent unnecessary updates
let lastStatus = null;

/**
 * Run a PowerShell command and return the output
 * @param {string} command - PowerShell command to run
 * @returns {Promise<string>} - Command output
 */
function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    exec(`powershell.exe -Command "${command}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`PowerShell error: ${error}`);
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Get detailed information about 3CX processes
 * @returns {Promise<Array>} - Array of 3CX process objects
 */
async function get3CXProcessInfo() {
  try {
    // Get all 3CX-related processes with window titles
    const command = `
      Get-Process | 
      Where-Object {$_.ProcessName -like '*3CX*' -or $_.ProcessName -like '*3cx*'} | 
      ForEach-Object { 
        $proc = $_; 
        $title = (Get-Process -Id $proc.Id | Select-Object MainWindowTitle).MainWindowTitle;
        [PSCustomObject]@{
          ProcessName = $proc.ProcessName;
          Id = $proc.Id;
          WindowTitle = $title;
          Path = $proc.Path;
        } 
      } | ConvertTo-Json
    `;
    
    const output = await runPowerShell(command);
    
    if (config.debug) {
      console.log('3CX Process Info:');
      console.log(output);
    }
    
    // Parse JSON output
    try {
      return JSON.parse(output);
    } catch (e) {
      console.error('Error parsing JSON:', e);
      return [];
    }
  } catch (error) {
    console.error('Error getting 3CX process info:', error);
    return [];
  }
}

/**
 * Get 3CX status from registry
 * This is an alternative method that might work better
 * @returns {Promise<string>} - Status from registry
 */
async function get3CXStatusFromRegistry() {
  try {
    // Try to get status from registry
    // This path might need adjustment for your specific 3CX version
    const command = `
      if (Test-Path "HKCU:\\Software\\3CXPhone") {
        Get-ItemProperty -Path "HKCU:\\Software\\3CXPhone" -Name "Status" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status
      } elseif (Test-Path "HKCU:\\Software\\3CX") {
        Get-ItemProperty -Path "HKCU:\\Software\\3CX" -Name "Status" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status
      }
    `;
    
    const output = await runPowerShell(command);
    
    if (config.debug) {
      console.log('Registry Status:', output);
    }
    
    return output;
  } catch (error) {
    console.error('Error getting status from registry:', error);
    return '';
  }
}

/**
 * Check 3CX status using multiple methods
 */
async function check3CXStatus() {
  try {
    // Method 1: Check process info
    const processes = await get3CXProcessInfo();
    
    // Method 2: Check registry
    const registryStatus = await get3CXStatusFromRegistry();
    
    // Method 3: Check UI elements using accessibility API
    // This is more complex but can be added if needed
    
    // Analyze process info
    let statusFromProcess = 'unknown';
    
    if (processes && processes.length > 0) {
      // Look through all 3CX processes
      for (const proc of processes) {
        const title = (proc.WindowTitle || '').toLowerCase();
        
        if (config.debug) {
          console.log(`Process: ${proc.ProcessName}, Title: ${title}`);
        }
        
        // Check for call indicators in window title
        if (title.includes('on call') || title.includes('in call') || title.includes('calling')) {
          statusFromProcess = 'onCall';
          break;
        } else if (title.includes('ringing')) {
          statusFromProcess = 'ringing';
          break;
        } else if (title.includes('do not disturb') || title.includes('dnd')) {
          statusFromProcess = 'dnd';
          break;
        } else if (title.includes('away')) {
          statusFromProcess = 'away';
          break;
        } else if (title.includes('available')) {
          statusFromProcess = 'available';
        }
      }
    }
    
    // Analyze registry status
    let statusFromRegistry = 'unknown';
    
    if (registryStatus) {
      const status = registryStatus.toLowerCase();
      if (status.includes('dnd') || status.includes('do not disturb')) {
        statusFromRegistry = 'dnd';
      } else if (status.includes('away')) {
        statusFromRegistry = 'away';
      } else if (status.includes('available')) {
        statusFromRegistry = 'available';
      } else if (status.includes('call')) {
        statusFromRegistry = 'onCall';
      }
    }
    
    // Combine results, prioritizing active call states
    let finalStatus = 'available'; // Default
    
    if (statusFromProcess === 'onCall' || statusFromRegistry === 'onCall') {
      finalStatus = 'onCall';
    } else if (statusFromProcess === 'ringing') {
      finalStatus = 'ringing';
    } else if (statusFromProcess === 'dnd' || statusFromRegistry === 'dnd') {
      finalStatus = 'dnd';
    } else if (statusFromProcess === 'away' || statusFromRegistry === 'away') {
      finalStatus = 'away';
    } else if (statusFromProcess === 'available' || statusFromRegistry === 'available') {
      finalStatus = 'available';
    }
    
    if (config.debug) {
      console.log(`Status from process: ${statusFromProcess}`);
      console.log(`Status from registry: ${statusFromRegistry}`);
      console.log(`Final status: ${finalStatus}`);
    }
    
    return finalStatus;
  } catch (error) {
    console.error('Error checking 3CX status:', error);
    return 'offline';
  }
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
 * Setup manual status override via keyboard input
 */
function setupManualOverride() {
  console.log('\nManual Override Available:');
  console.log('---------------------------');
  console.log('Press the following keys to manually set status:');
  console.log('  a: Available');
  console.log('  r: Ringing');
  console.log('  c: On Call');
  console.log('  d: Do Not Disturb');
  console.log('  w: Away');
  console.log('  o: Offline');
  console.log('  q: Quit');
  console.log('  t: Toggle debug mode');
  
  // Set up key listener
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (key) => {
    const keyPressed = key.toString().toLowerCase();
    
    switch (keyPressed) {
      case 'a':
        await handleStatusChange('available');
        console.log('Status manually set to: Available');
        break;
      case 'r':
        await handleStatusChange('ringing');
        console.log('Status manually set to: Ringing');
        break;
      case 'c':
        await handleStatusChange('onCall');
        console.log('Status manually set to: On Call');
        break;
      case 'd':
        await handleStatusChange('dnd');
        console.log('Status manually set to: Do Not Disturb');
        break;
      case 'w':
        await handleStatusChange('away');
        console.log('Status manually set to: Away');
        break;
      case 'o':
        await handleStatusChange('offline');
        console.log('Status manually set to: Offline');
        break;
      case 't':
        config.debug = !config.debug;
        console.log(`Debug mode: ${config.debug ? 'ON' : 'OFF'}`);
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
  console.log('Starting Enhanced 3CX Status Client for Windows');
  console.log(`WLED IP: ${config.wled.ipAddress}`);
  console.log(`Check interval: ${config.checkInterval}ms`);
  console.log(`Debug mode: ${config.debug ? 'ON' : 'OFF'}`);
  
  try {
    // Setup manual override
    setupManualOverride();
    
    // Initial status check
    console.log('Performing initial status check...');
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
    
    console.log(`\nStatus checking active. Checking every ${config.checkInterval / 1000} seconds.`);
    console.log('(Use keyboard shortcuts for manual override if needed)');
    
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
