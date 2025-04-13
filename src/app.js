/**
 * WLED-3CX-Splynx Integration - Main Application
 *
 * This script serves as the main entry point for the WLED integration with
 * 3CX and Splynx phone systems using web scraping for accurate status detection.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const packageJson = require('../package.json');

// Force clear cache for the module we are debugging to ensure latest code is loaded
const threeCxClientPath = require.resolve('./threecx-web-client-fixed');
if (require.cache[threeCxClientPath]) {
  delete require.cache[threeCxClientPath];
  logger.warn('Cleared Node.js cache for threecx-web-client-fixed.js');
}

const threeCxWebClient = require('./threecx-web-client-fixed'); // Use the fixed version
const { updateWLED } = require('./wled-controller');
const pino = require('pino');

// Initialize logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info', // Default to 'info'
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});

// Application version from package.json
const APP_VERSION = packageJson.version;

// Configuration from environment variables
const config = {
  // Application info
  app: {
    name: packageJson.name,
    version: APP_VERSION,
    description: packageJson.description
  },
  // Web server configuration
  server: {
    port: process.env.SERVER_PORT || 1550,
  },
  // WLED Configuration
  wled: {
    ipAddress: process.env.WLED_IP_ADDRESS,
    brightness: parseInt(process.env.WLED_BRIGHTNESS || '128', 10),
    transition: parseInt(process.env.WLED_TRANSITION || '1000', 10),
    statusColors: {
      available: { r: 0, g: 255, b: 0 }, // Green for available
      ringing: { r: 255, g: 255, b: 0 }, // Yellow for ringing
      onCall: { r: 255, g: 0, b: 0 }, // Red for on a call
      dnd: { r: 128, g: 0, b: 128 }, // Purple for do not disturb
      away: { r: 255, g: 165, b: 0 }, // Orange for away
      offline: { r: 0, g: 0, b: 255 }, // Blue for offline
    },
  },
};

// Create Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  // Increase ping timeout to prevent disconnections
  clientTracking: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Log WebSocket server events
wss.on('listening', () => {
  logger.info('WebSocket server is listening');
});

wss.on('error', (error) => {
  logger.error('WebSocket server error:', error);
});

// Store connected clients
const clients = new Set();
let currentStatus = 'offline';
let isMonitoring = true;

// --- State Variables ---
// Store latest call stats obtained from 3CX or manual input
let latestCallStats = {
  waitingCalls: 0,
  activeCalls: 0,
  totalCalls: 0, // Note: totalCalls from scraped stats might not be reliable
  servicedCalls: 0,
  abandonedCalls: 0,
  lastUpdated: null,
  source: 'initial',
};
let lastCallStats = null; // Store previous stats for comparison if needed

// Store team members status (will be dynamically populated from 3CX scraper)
let teamStatus = [];

// Last time team status was updated
let lastTeamStatusUpdate = null;

// Store latest agent statuses fetched from 3CX
let latestAgentStatuses = [];

// Store latest debug info from 3CX scraper
let latestDebugInfo = {};

// Variables to track manual status override
let manualStatusOverride = false;
let manualStatusTimestamp = 0;
const MANUAL_OVERRIDE_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds

// API routes
app.get('/api/status', async (req, res) => {
  // Get current WLED status
  let wledStatus = null;
  try {
    const { getWLEDStatus } = require('./wled-controller');
    wledStatus = await getWLEDStatus();
  } catch (error) {
    logger.error('Error getting WLED status:', error);
  }

  // Log what we're sending for debugging
  logger.info(`Sending status API response with ${teamStatus.length} team members and ${latestAgentStatuses.length} agent statuses`);

  res.json({
    status: currentStatus,
    monitoring: isMonitoring,
    wledConfig: config.wled,
    wledStatus: wledStatus,
    wledConnected: wledStatus !== null,
    callStats: latestCallStats,
    teamStatus: teamStatus && teamStatus.length > 0 ? teamStatus : latestAgentStatuses, // Use agent statuses as fallback
    agentStatuses: latestAgentStatuses,
    version: config.app.version,
  });
});

// Add a debug endpoint to get window monitoring information
app.get('/api/debug', (req, res) => {
  res.json({
    debugInfo: latestDebugInfo || {},
    status: currentStatus,
    monitoring: isMonitoring,
    callStats: latestCallStats,
  });
});

// Add endpoint to get call stats
app.get('/api/callStats', (req, res) => {
  res.json({
    callStats: latestCallStats,
  });
});

// Add endpoint to update call stats manually
app.post('/api/call-stats', (req, res) => {
  const newCallStats = req.body;

  // Validate call stats data
  if (typeof newCallStats !== 'object') {
    return res
      .status(400)
      .json({ success: false, error: 'Invalid call stats data' });
  }

  // Update call stats with new values
  latestCallStats = {
    ...latestCallStats,
    ...newCallStats,
    lastUpdated: new Date().toISOString(),
    source: 'manual',
  };

  // Broadcast updated call stats to all clients
  broadcastCallStats(latestCallStats);

  res.json({
    success: true,
    callStats: latestCallStats,
  });
});

// Add endpoint to get team status
app.get('/api/teamStatus', (req, res) => {
  // If we have no team status but have agent statuses, use those instead
  const statusToSend = (teamStatus && teamStatus.length > 0) ? teamStatus : latestAgentStatuses;
  
  logger.info(`Sending team status API response with ${statusToSend.length} members`);
  
  res.json({
    teamStatus: statusToSend,
  });
});

// Add endpoint to update team member status
app.post('/api/teamStatus/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const teamMember = teamStatus.find((member) => member.id === id);
  if (teamMember) {
    teamMember.status = status;
    teamMember.color = getColorForStatus(status);
    broadcastTeamStatus();
    res.json({ success: true, teamMember });
  } else {
    res.status(404).json({ success: false, error: 'Team member not found' });
  }
});

/**
 * Determines the CSS color name based on a given status string.
 * Used for frontend display purposes (e.g., in team status).
 *
 * @function getColorForStatus
 * @param {string} status - The status string (e.g., 'available', 'onCall').
 * @returns {string} The corresponding CSS color name (e.g., 'green', 'red') or 'gray' for unknown statuses.
 */
function getColorForStatus(status) {
  switch (status) {
    case 'available':
      return 'green';
    case 'ringing':
      return 'yellow';
    case 'onCall':
      return 'red';
    case 'dnd':
      return 'purple';
    case 'away':
      return 'orange';
    case 'offline':
      return 'blue';
    default:
      return 'gray';
  }
}

app.post('/api/status', async (req, res) => {
  const { status, monitoring } = req.body;

  if (status) {
    logger.info(`Manual status update: ${status}`);
    currentStatus = status;
    broadcastStatus();

    // Update WLED based on status
    updateWLEDWithStatus(status);
  }

  if (monitoring !== undefined) {
    isMonitoring = monitoring;
    broadcastStatus();
  }

  res.json({ success: true });
});

// Add WLED status endpoint
app.get('/api/wled/status', async (req, res) => {
  try {
    const { getWLEDStatus } = require('./wled-controller');
    const status = await getWLEDStatus();
    res.json({
      success: true,
      status: status,
      connected: status !== null,
    });
  } catch (error) {
    logger.error('Error getting WLED status:', error);
    res.json({
      success: false,
      error: error.message,
      connected: false,
    });
  }
});

// Add endpoint to test WLED connection
app.post('/api/wled/test', async (req, res) => {
  try {
    const { updateWLED } = require('./wled-controller');
    // Flash white briefly to test connection
    const success = await updateWLED({ r: 255, g: 255, b: 255 });

    // Wait 1 second and restore current status color
    setTimeout(async () => {
      const color =
        config.wled.statusColors[currentStatus] ||
        config.wled.statusColors.offline;
      await updateWLED(color);
    }, 1000);

    res.json({ success: success });
  } catch (error) {
    logger.error('Error testing WLED connection:', error);
    res.json({ success: false, error: error.message });
  }
});

// Add endpoint to reset 3CX authentication
app.post('/api/reset-auth', async (req, res) => {
  try {
    logger.info('API request received: Reset 3CX authentication');

    // Stop monitoring before resetting
    logger.info('Stopping 3CX monitoring...');
    threeCxWebClient.stopMonitoring();

    // Reset authentication
    logger.info('Calling resetAuthentication()...');
    const resetResult = await threeCxWebClient.resetAuthentication();
    logger.info('Reset authentication result:', resetResult);

    if (resetResult) {
      // Restart monitoring
      logger.info('Restarting 3CX monitoring...');
      threeCxWebClient.startMonitoring(handleStatusChange);

      logger.info('Authentication reset successful');
      res.json({
        success: true,
        message:
          'Authentication reset successful. Please check the browser window for login.',
      });
    } else {
      logger.error('Authentication reset failed');
      res.json({ success: false, error: 'Authentication reset failed' });
    }
  } catch (error) {
    logger.error('Error resetting 3CX authentication:', error);
    res.json({ success: false, error: error.message });
  }
});

// Add endpoint to take a screenshot of the 3CX web interface
app.get('/api/take-screenshot', async (req, res) => {
  try {
    logger.info('Taking screenshot of 3CX web interface...');

    // Take screenshot
    const screenshotPath = await threeCxWebClient.takeScreenshot();

    if (screenshotPath) {
      res.json({ success: true, screenshotPath });
    } else {
      res.json({ success: false, error: 'Failed to take screenshot' });
    }
  } catch (error) {
    logger.error('Error taking screenshot:', error);
    res.json({ success: false, error: error.message });
  }
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  logger.info(`WebSocket connection established from ${ip}`);

  // Add client to the list with timestamp and ID
  const clientId =
    Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  ws.id = clientId;
  ws.connectedAt = new Date();
  ws.isAlive = true;
  clients.add(ws);

  logger.info(`Client connected: ${clientId}, total clients: ${clients.size}`);

  // Set up ping interval for this client
  ws.pingInterval = setInterval(() => {
    if (ws.isAlive === false) {
      logger.info(
        `Client ${clientId} not responding to pings, terminating connection`
      );
      clearInterval(ws.pingInterval);
      return ws.terminate();
    }

    ws.isAlive = false;
    try {
      // Send ping message
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    } catch (error) {
      logger.error(`Error sending ping to client ${clientId}:`, error.message);
      clearInterval(ws.pingInterval);
      ws.terminate();
    }
  }, 30000); // Check every 30 seconds

  // Send initial status
  try {
    sendStatusToClient(ws);
  } catch (error) {
    logger.error(
      `Error sending initial status to client ${clientId}:`,
      error.message
    );
  }

  // Send initial debug info
  try {
    sendDebugInfo(ws);
  } catch (error) {
    logger.error(
      `Error sending initial debug info to client ${clientId}:`,
      error.message
    );
  }

  // Send initial call stats if available
  if (lastCallStats) {
    try {
      ws.send(
        JSON.stringify({
          type: 'callStats',
          callStats: lastCallStats,
        })
      );
    } catch (error) {
      logger.error(
        `Error sending initial call stats to client ${clientId}:`,
        error.message
      );
    }
  }

  // Handle messages from client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      logger.debug(`Received message from ${clientId}: ${data.type}`);

      // Handle pong response to keep connection alive
      if (data.type === 'pong') {
        ws.isAlive = true;
        return;
      }

      // Handle call stats update
      if (data.type === 'callStats' && data.callStats) {
        logger.info('Received call stats update:', data.callStats);

        // Update call stats with new values
        latestCallStats = {
          ...latestCallStats,
          ...data.callStats,
          lastUpdated: new Date().toISOString(),
          source: 'manual',
        };

        // Broadcast call stats to all clients
        broadcastCallStats(latestCallStats);
      } else if (data.type === 'status') {
        // Handle status update
        logger.info('Received status update:', data.status);

        // Update current status
        if (data.status) {
          currentStatus = data.status;
        }

        // Update monitoring status
        if (data.monitoring !== undefined) {
          isMonitoring = data.monitoring;
        }

        // Broadcast status to all clients
        broadcastStatus();

        // Update WLED based on status
        if (data.status) {
          updateWLEDWithStatus(data.status);
        }
      } else if (data.type === 'wled') {
        // Handle WLED settings update
        logger.info('Received WLED settings update:', data.settings);

        // Update WLED settings
        if (data.settings) {
          // Update WLED with new settings
          updateWLED(data.settings)
            .then((success) => {
              // Broadcast WLED status to all clients
              broadcastWLEDStatus(success);
            })
            .catch((error) => {
              logger.error('Error updating WLED:', error);
              broadcastWLEDStatus(false, error.message);
            });
        }
      } else if (data.type === 'requestDebug') {
        // Send debug info
        sendDebugInfo(ws);  
      } else if (data.type === 'requestStatus') {
        // Send current status to the client
        logger.info(`Client ${clientId} requested status update`);
        sendStatusToClient(ws);
      } else if (data.type === 'requestCallStats') {
        // Send call stats
        if (lastCallStats) {
          ws.send(
            JSON.stringify({
              type: 'callStats',
              callStats: lastCallStats,
            })
          );
        }
      } else if (data.type === 'clearManualOverride') {
        // Clear manual status override
        manualStatusOverride = false;
        logger.info('Manual status override cleared');

        // If monitoring is enabled, trigger a status check
        if (isMonitoring) {
          // windowMonitor
          //   .determinePhoneStatus()
          //   .then((result) => handleStatusChange(null, result))
          //   .catch((err) => logger.error('Error checking status:', err));
        }

        // Send confirmation
        ws.send(
          JSON.stringify({
            type: 'status',
            success: true,
            message: 'Manual override cleared',
          })
        );
      }
    } catch (error) {
      logger.error(`Error processing message from ${clientId}:`, error);
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    logger.error(`WebSocket error for client ${clientId}:`, error.message);
  });

  // Handle connection close
  ws.on('close', (code, reason) => {
    logger.info(
      `WebSocket connection closed: ${ws.id}, Code: ${code || 'No code'}, Reason: ${reason || 'No reason provided'}`
    );

    // Clear ping interval
    if (ws.pingInterval) {
      clearInterval(ws.pingInterval);
      ws.pingInterval = null;
    }

    // Remove client from the list
    clients.delete(ws);
    logger.info(
      `Client disconnected: ${ws.id}, remaining clients: ${clients.size}`
    );
  });

  // Handle WebSocket errors
  ws.on('error', (error) => {
    logger.error(`WebSocket error for client ${ws.id}:`, error);
    // Remove client from the list on error
    clients.delete(ws);
  });
});

/**
 * Sends the current application status (3CX status, monitoring state, WLED info, call stats, team status)
 * to a specific WebSocket client.
 *
 * @function sendStatusToClient
 * @param {WebSocket} ws - The WebSocket client instance to send the status to.
 */
function sendStatusToClient(ws) {
  try {
    ws.send(
      JSON.stringify({
        type: 'status',
        status: currentStatus,
        monitoring: isMonitoring,
      })
    );

    // Send call stats if available
    if (latestCallStats) {
      ws.send(
        JSON.stringify({
          type: 'callStats',
          callStats: latestCallStats,
        })
      );
    }
    
    // Send team status if available
    if (teamStatus && teamStatus.length > 0) {
      ws.send(
        JSON.stringify({
          type: 'teamStatus',
          teamStatus: teamStatus,
          lastUpdated: lastTeamStatusUpdate
        })
      );
    }
  } catch (error) {
    logger.error('Error sending status to client:', error);
  }
}

/**
 * Broadcasts the current application status (3CX status, monitoring state, WLED info, call stats, team status)
 * to all connected WebSocket clients.
 *
 * @function broadcastStatus
 */
function broadcastStatus() {
  logger.debug('Broadcasting status to all clients');
  const message = JSON.stringify({
    type: 'statusUpdate',
    status: currentStatus,
    monitoring: isMonitoring,
    callStats: latestCallStats,
    agentStatuses: latestAgentStatuses, // Include agent statuses
    teamStatus: teamStatus.map((member) => ({
      ...member,
      color: getColorForStatus(member.status),
    })),
    wledIp: config.wled.ipAddress,
  });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Sends the latest debug information (from the 3CX scraper) to a specific WebSocket client.
 * Includes details like detected elements, potential errors, and timing.
 *
 * @function sendDebugInfo
 * @param {WebSocket} ws - The WebSocket client instance to send the debug info to.
 */
function sendDebugInfo(ws) {
  // Create debug info object with current status and system info
  const debugInfoToSend = {
    status: currentStatus,
    callStats: latestCallStats,
    source: '3CX Web UI',
    serverTime: new Date().toISOString(),
    manualOverride: manualStatusOverride,
    manualOverrideTime: manualStatusOverride
      ? new Date(manualStatusTimestamp).toISOString()
      : null,
    manualOverrideRemaining: manualStatusOverride
      ? Math.max(
          0,
          Math.round(
            (MANUAL_OVERRIDE_TIMEOUT - (Date.now() - manualStatusTimestamp)) /
              1000
          )
        )
      : 0,
    connectedClients: clients.size,
    wledStatus: {
      connected: true,
      ipAddress: config.wled.ipAddress,
      brightness: config.wled.brightness,
      transition: config.wled.transition,
    },
    threecxAuth: {
      authenticated: true,
      url: process.env.THREECX_WEB_URL || 'https://primonz.my3cx.nz',
      lastLogin: new Date().toISOString(),
    },
  };

  // Get 3CX web client status
  threeCxWebClient
    .getStatus()
    .then((status) => {
      // Update status in debug info
      debugInfoToSend.currentStatus = status;

      // Send the debug info to the client
      ws.send(
        JSON.stringify({
          type: 'debug',
          debugInfo: debugInfoToSend,
        })
      );
    })
    .catch((error) => {
      logger.error('Error getting status from 3CX web client:', error);

      // Add error to debug info
      debugInfoToSend.error = error.message;

      // Send the debug info with error
      ws.send(
        JSON.stringify({
          type: 'debug',
          debugInfo: debugInfoToSend,
        })
      );
    });
}

/**
 * Broadcasts debug information (from the 3CX scraper) to all connected WebSocket clients.
 * Updates the global `latestDebugInfo` variable.
 *
 * @function broadcastDebugInfo
 * @param {object} debugInfo - The debug information object to broadcast.
 */
function broadcastDebugInfo(debugInfo) {
  latestDebugInfo = debugInfo;
  logger.debug(`Broadcasting debug info: ${JSON.stringify(latestDebugInfo)}`);

  const message = JSON.stringify({
    type: 'debug',
    debugInfo: latestDebugInfo,
  });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Broadcasts the latest call statistics (from the 3CX scraper or manual input)
 * to all connected WebSocket clients.
 * Updates the global `latestCallStats` variable if new stats are provided.
 *
 * @function broadcastCallStats
 * @param {object} [callStats=latestCallStats] - The call statistics object to broadcast. Defaults to the globally stored `latestCallStats`.
 */
function broadcastCallStats(callStats = latestCallStats) {
  if (callStats) {
    latestCallStats = callStats; // Update global state if new stats provided
  }

  const message = JSON.stringify({
    type: 'callStats',
    callStats: callStats,
  });

  logger.info(`Broadcasting call stats: ${JSON.stringify(callStats)}`);

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Broadcasts the success or failure status of the last WLED update command
 * to all connected WebSocket clients.
 *
 * @function broadcastWLEDStatus
 * @param {boolean} success - Whether the WLED update was successful.
 * @param {string|null} [errorMessage=null] - An optional error message if the update failed.
 */
function broadcastWLEDStatus(success, errorMessage = null) {
  const message = JSON.stringify({
    type: 'wled',
    success: success,
    error: errorMessage,
  });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Updates the WLED device's color based on the provided status string.
 * Uses the `statusColors` mapping defined in the configuration.
 * Logs the action and broadcasts the WLED update status.
 *
 * @async
 * @function updateWLEDWithStatus
 * @param {string} status - The status string (e.g., 'available', 'onCall').
 */
async function updateWLEDWithStatus(status) {
  const color = config.wled.statusColors[status];
  if (color) {
    logger.info(
      `Setting WLED color to RGB(${color.r},${color.g},${color.b})`
    );

    return updateWLED(color)
      .then((success) => {
        logger.info(`WLED update ${success ? 'successful' : 'failed'}`);
        broadcastWLEDStatus(success);
        return success;
      })
      .catch((error) => {
        logger.error('Error updating WLED:', error);
        broadcastWLEDStatus(false, error.message);
        throw error;
      });
  }
}

/**
 * Broadcasts the current team status array to all connected WebSocket clients.
 * 
 * @function broadcastTeamStatus
 */
function broadcastTeamStatus() {
  if (clients.size === 0) {
    return; // No clients connected
  }

  // Only broadcast if we have team status data
  if (!teamStatus || teamStatus.length === 0) {
    logger.debug('No team status data to broadcast');
    return;
  }

  logger.info(`Broadcasting team status for ${teamStatus.length} agents`);
  
  const message = JSON.stringify({
    type: 'teamStatus',
    teamStatus: teamStatus,
    lastUpdated: lastTeamStatusUpdate
  });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Main application entry point.
 * Initializes the Express server, WebSocket server, and the 3CX web client monitoring.
 * Sets up graceful shutdown handling.
 *
 * @async
 * @function main
 */
async function main() {
  logger.info('Starting WLED-3CX Integration...');
  logger.info(`Log level set to: ${logger.level}`);

  // Add application start log
  logger.info('Starting WLED-3CX Integration Application...');
  logger.info(`Server port: ${config.server.port}`);
  logger.info(`WLED IP: ${config.wled.ipAddress || 'Not configured'}`);

  // Initialize 3CX web client monitoring
  logger.info('Initializing 3CX Web Client...');
  const initSuccess = await threeCxWebClient.initialize(handleStatusChange);

  if (!initSuccess) {
    logger.error(
      'Failed to initialize 3CX Web Client. Application might not function correctly.'
    );
    // Potentially exit or retry initialization
    // process.exit(1);
  } else {
    logger.info('3CX Web Client initialized successfully.');
    // Start monitoring explicitly if initialize doesn't automatically start it
    // await threeCxWebClient.startMonitoring(handleStatusChange);
  }

  // Start the server
  server.listen(config.server.port, () => {
    logger.info(`Server listening on port ${config.server.port}`);
    logger.info(
      `Dashboard available at http://localhost:${config.server.port}`
    );
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('SIGINT received. Shutting down gracefully...');

    // Stop monitoring
    await threeCxWebClient.stopMonitoring();
    await threeCxWebClient.close();

    // Turn off WLED (optional)
    try {
      logger.info('Turning off WLED...');
      const { turnOffWLED } = require('./wled-controller'); // Import here if needed
      await turnOffWLED();
      logger.info('WLED turned off.');
    } catch (wledError) {
      logger.error('Error turning off WLED during shutdown:', wledError);
    }

    // Close WebSocket server
    wss.close(() => {
      logger.info('WebSocket server closed.');
      server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
      });
    });

    // Force exit after a timeout if graceful shutdown fails
    setTimeout(() => {
      logger.warn('Graceful shutdown timed out. Forcing exit.');
      process.exit(1);
    }, 5000); // 5 seconds timeout
  });

  process.on('uncaughtException', (error) => {
    logger.fatal('Uncaught Exception:', error);
    // Consider a graceful shutdown here as well
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Consider a graceful shutdown here as well
  });
}

// Run the application
if (require.main === module) {
  logger.info(`Starting ${config.app.name} v${config.app.version}`);
  main().catch((error) => {
    logger.fatal('Application failed to start:', error);
    process.exit(1);
  });
}

module.exports = { app, server, handleStatusChange, main };

/**
 * Callback function invoked by the 3CX web client module when a status update occurs.
 * Updates the application's current status, broadcasts changes to clients,
 * updates the WLED device, and handles errors.
 *
 * @function handleStatusChange
 * @param {Error|null} error - An error object if the status retrieval failed, otherwise null.
 * @param {object} result - An object containing the status update.
 * @param {object} result.status - The detected user status object (e.g., { status: 'available', source: '...' }).
 * @param {object} result.callStats - The detected call statistics (e.g., { waitingCalls: 0, ... }).
 * @param {object} result.debugInfo - Debugging information from the scraper.
 */
function handleStatusChange(error, result) {
  logger.debug('handleStatusChange called');
  // Destructure the result object, including the new agentStatuses
  const { status: statusResult, callStats: callStatsResult, agentStatuses: agentStatusesResult, debugInfo } = result || {};

  if (error) {
    logger.error(`Error fetching 3CX status: ${error.message}`);
    // Optionally set a specific error status or keep the last known one
    // currentStatus = 'error';
    return;
  }

  // Update Debug Info
  if (debugInfo) {
    latestDebugInfo = debugInfo;
    broadcastDebugInfo(latestDebugInfo);
  }

  // Update Call Stats
  if (callStatsResult) {
    latestCallStats = { ...callStatsResult };
    broadcastCallStats(latestCallStats); // Broadcast updated stats
  }

  // Handle Agent Statuses
  if (agentStatusesResult) {
    // Store the agent statuses in both variables to ensure they're available
    latestAgentStatuses = agentStatusesResult;
    teamStatus = agentStatusesResult;
    lastTeamStatusUpdate = new Date();
    logger.info(`Received ${teamStatus.length} agent statuses.`);
    broadcastTeamStatus();
  } else if (agentStatusesResult === null) {
    // This means the scraper tried but couldn't find the container or agents
    logger.warn('Agent status scraping returned null (container/elements not found).');
  } else {
    // This means the scraper didn't even run or returned undefined (e.g., browser closed)
    logger.warn('Agent status scraping did not return data.');
  }

  // Update WLED only if the *user's* status changed and monitoring is enabled
  if (isMonitoring && statusResult && statusResult.status !== currentStatus) {
    logger.info(
      `Status changed from ${currentStatus} to ${statusResult.status} (source: ${statusResult.source})`
    );

    // Update current status
    currentStatus = statusResult.status;

    // Broadcast status to all clients
    broadcastStatus();

    // Update WLED based on status
    updateWLEDWithStatus(statusResult.status);
  }
}
