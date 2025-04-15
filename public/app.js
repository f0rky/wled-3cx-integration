/**
 * WLED-3CX-Splynx Integration - Web UI
 * 
 * This script handles the web UI for the WLED-3CX-Splynx integration,
 * including WebSocket communication and UI updates.
 */

// Status color mapping
const statusColors = {
    available: { r: 0, g: 255, b: 0 },      // Green for available
    ringing: { r: 255, g: 255, b: 0 },      // Yellow for ringing
    onCall: { r: 255, g: 0, b: 0 },         // Red for on a call
    dnd: { r: 128, g: 0, b: 128 },          // Purple for do not disturb
    away: { r: 255, g: 165, b: 0 },         // Orange for away
    offline: { r: 0, g: 0, b: 255 },        // Blue for offline
};

// Status display names
const statusDisplayNames = {
    available: 'Available',
    ringing: 'Ringing',
    onCall: 'On Call',
    dnd: 'Do Not Disturb',
    away: 'Away',
    offline: 'Offline',
};

// WebSocket connection
let ws = null;

// Status refresh interval (as fallback if WebSocket fails)
let statusRefreshInterval = null;

// UI elements
const statusBadge = document.getElementById('status-badge');
const monitoringBadge = document.getElementById('monitoring-badge');
const statusColor = document.getElementById('status-color');
const statusText = document.getElementById('status-text');
const monitoringToggle = document.getElementById('monitoring-toggle');
const statusButtons = document.querySelectorAll('.status-btn');
const brightnessSlider = document.getElementById('brightness-slider');
const brightnessValue = document.getElementById('brightness-value');
const transitionSlider = document.getElementById('transition-slider');
const transitionValue = document.getElementById('transition-value');
const applySettingsButton = document.getElementById('apply-settings');
const turnOffWLEDButton = document.getElementById('turn-off-wled');

// Call statistics UI elements
const waitingCallsElement = document.getElementById('waiting-calls');
const activeCallsElement = document.getElementById('active-calls');
const totalCallsElement = document.getElementById('total-calls');
const servicedCallsElement = document.getElementById('serviced-calls');
const abandonedCallsElement = document.getElementById('abandoned-calls');
const lastUpdatedElement = document.getElementById('last-updated');

const waitingCallsInput = document.getElementById('waiting-calls-input');
const activeCallsInput = document.getElementById('active-calls-input');
const totalCallsInput = document.getElementById('total-calls-input');
const servicedCallsInput = document.getElementById('serviced-calls-input');
const abandonedCallsInput = document.getElementById('abandoned-calls-input');
const updateCallStatsButton = document.getElementById('update-call-stats');

// Debug UI elements
const wledStatus = document.getElementById('wled-status');
const threecxAuthStatus = document.getElementById('threecx-auth-status');
const threecxStatus = document.getElementById('threecx-status');
const connectionDetails = document.getElementById('connection-details');
const refreshDebugButton = document.getElementById('refresh-debug');
const testWLEDButton = document.getElementById('test-wled');
const resetAuthButton = document.getElementById('reset-auth');
const takeScreenshotButton = document.getElementById('take-screenshot');
const screenshotContainer = document.getElementById('screenshot-container');
const screenshotImage = document.getElementById('screenshot-image');
const screenshotLink = document.getElementById('screenshot-link');

// WebSocket connection state
let wsReconnectAttempts = 0;
let wsReconnectInterval = null;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 2000; // 2 seconds

// Initialize WebSocket connection
function initWebSocket() {
    // Clear any existing reconnect interval
    if (wsReconnectInterval) {
        clearInterval(wsReconnectInterval);
        wsReconnectInterval = null;
    }
    
    // Get the current host and port
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const port = window.location.port || (protocol === 'wss:' ? '443' : '1550'); // Use default port 1550 if not specified
    const wsUrl = `${protocol}//${host}:${port}`;
    
    console.log(`Connecting to WebSocket at ${wsUrl}`);
    
    // Close existing connection if any
    if (ws) {
        try {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        } catch (e) {
            console.log('Error closing existing WebSocket:', e);
        }
    }
    
    // Create new WebSocket connection
    try {
        ws = new WebSocket(wsUrl);
        
        // Set a connection timeout
        const connectionTimeout = setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) {
                console.log('WebSocket connection timeout');
                ws.close();
            }
        }, 5000); // 5 second timeout
        
        ws.onopen = () => {
            console.log('WebSocket connection established');
            clearTimeout(connectionTimeout);
            wsReconnectAttempts = 0;
            
            // Update connection status in UI
            const connectionStatus = document.getElementById('connection-status');
            if (connectionStatus) {
                connectionStatus.textContent = 'Connected';
                connectionStatus.className = 'badge bg-success';
            }
            
            // Request initial status
            setTimeout(() => {
                fetchStatus();
                // Request debug info
                requestDebugInfo();
                
                // Send a status request via WebSocket to ensure we get real-time updates
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'requestStatus'
                    }));
                }
            }, 500); // Small delay to ensure the connection is fully established
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received WebSocket message:', data.type);
                
                if (data.type === 'status') {
                    updateStatusUI(data.status, data.monitoring);
                } else if (data.type === 'debug') {
                    updateDebugInfo(data.debugInfo);
                } else if (data.type === 'wled') {
                    updateWLEDStatusUI(data.success, data.error);
                } else if (data.type === 'callStats') {
                    updateCallStatsUI(data.callStats);
                } else if (data.type === 'teamStatus') {
                    // Handle team status updates if needed
                    console.log('Received team status update');
                } else if (data.type === 'ping') {
                    // Respond to ping with pong
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'pong' }));
                    }
                }
            } catch (error) {
                console.error('Error processing WebSocket message:', error, event.data);
            }
        };
        
        ws.onclose = (event) => {
            console.log(`WebSocket connection closed: Code: ${event.code}, Reason: ${event.reason}`);
            clearTimeout(connectionTimeout);
            
            // Update connection status in UI
            const connectionStatus = document.getElementById('connection-status');
            if (connectionStatus) {
                connectionStatus.textContent = 'Disconnected';
                connectionStatus.className = 'badge bg-danger';
            }
            
            // Attempt to reconnect
            if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                wsReconnectAttempts++;
                const delay = RECONNECT_DELAY * Math.pow(1.5, wsReconnectAttempts - 1); // Exponential backoff
                console.log(`Attempting to reconnect (${wsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${delay}ms...`);
                
                // Set up reconnect interval with exponential backoff
                wsReconnectInterval = setTimeout(() => {
                    initWebSocket();
                }, delay);
                
                // Update UI to show reconnecting status
                if (connectionStatus) {
                    connectionStatus.textContent = 'Reconnecting...';
                    connectionStatus.className = 'badge bg-warning';
                }
            } else {
                console.error('Max reconnect attempts reached. Please refresh the page.');
                // Update UI to show failed status
                if (connectionStatus) {
                    connectionStatus.textContent = 'Connection Failed';
                    connectionStatus.className = 'badge bg-danger';
                }
                
                // Show a more user-friendly message
                const reconnectMessage = document.createElement('div');
                reconnectMessage.className = 'alert alert-danger mt-3';
                reconnectMessage.innerHTML = '<strong>Connection lost!</strong> Please refresh the page to reconnect.';
                
                const refreshButton = document.createElement('button');
                refreshButton.className = 'btn btn-primary ms-3';
                refreshButton.textContent = 'Refresh Now';
                refreshButton.onclick = () => window.location.reload();
                reconnectMessage.appendChild(refreshButton);
                
                // Add the message to the top of the page
                const container = document.querySelector('.container');
                if (container) {
                    container.prepend(reconnectMessage);
                }
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            
            // Update connection status in UI
            const connectionStatus = document.getElementById('connection-status');
            if (connectionStatus) {
                connectionStatus.textContent = 'Error';
                connectionStatus.className = 'badge bg-warning';
            }
        };
    } catch (error) {
        console.error('Error creating WebSocket:', error);
    }
}

// Request debug info from the server
function requestDebugInfo() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'requestDebug'
        }));
    }
}

// Fetch current status from the API
function fetchStatus() {
    // Add a timestamp to prevent caching
    const timestamp = new Date().getTime();
    fetch(`/api/status?_=${timestamp}`)
        .then(response => response.json())
        .then(data => {
            updateStatusUI(data.status, data.monitoring);
            
            // Update WLED settings
            if (data.wledConfig) {
                brightnessSlider.value = data.wledConfig.brightness;
                brightnessValue.textContent = data.wledConfig.brightness;
                
                transitionSlider.value = data.wledConfig.transition;
                transitionValue.textContent = data.wledConfig.transition;
            }
            
            // Update WLED connection status
            updateWLEDStatusUI(data.wledConnected, null, data.wledStatus);
        })
        .catch(error => {
            console.error('Error fetching status:', error);
        });
}

// Update status UI elements
function updateStatusUI(status, monitoring) {
    // Update status badge
    statusBadge.textContent = statusDisplayNames[status] || 'Unknown';
    statusBadge.className = 'badge';
    statusBadge.classList.add(`bg-${getBadgeClass(status)}`);
    
    // Update monitoring badge
    monitoringBadge.textContent = monitoring ? 'Monitoring' : 'Manual';
    monitoringBadge.className = 'badge';
    monitoringBadge.classList.add(monitoring ? 'bg-success' : 'bg-warning');
    
    // Update monitoring toggle
    monitoringToggle.checked = monitoring;
    
    // Update status color box
    const color = statusColors[status] || statusColors.offline;
    statusColor.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    
    // Update status text
    statusText.textContent = statusDisplayNames[status] || 'Unknown';
}

// Get Bootstrap badge class for status
function getBadgeClass(status) {
    switch (status) {
        case 'available':
            return 'success';
        case 'ringing':
            return 'warning';
        case 'onCall':
            return 'danger';
        case 'dnd':
            return 'purple';
        case 'away':
            return 'orange';
        case 'offline':
            return 'primary';
        default:
            return 'secondary';
    }
}

// Fetch debug info from the API - only called manually or when needed
function fetchDebugInfo() {
    // Add a timestamp to prevent caching
    const timestamp = new Date().getTime();
    fetch(`/api/debug?_=${timestamp}`)
        .then(response => response.json())
        .then(data => {
            if (data.debugInfo) {
                updateDebugInfo(data.debugInfo);
            }
        })
        .catch(error => {
            console.error('Error fetching debug info:', error);
        });
}

// Update debug info UI
function updateDebugInfo(debugInfo) {
    if (!debugInfo) {
        console.error('No debug info received');
        return;
    }
        
    console.log('Updating debug info:', debugInfo);
        
    // Update WLED status
    if (debugInfo.wledStatus) {
        const wledConnected = debugInfo.wledStatus.connected;
        const wledIpAddress = debugInfo.wledStatus.ipAddress;
            
        let wledHtml = '';
            
        if (wledConnected) {
            wledHtml = `<div class="alert alert-success">WLED connected successfully!</div>`;
            wledHtml += `<div class="wled-details">`;
            wledHtml += `<div><strong>IP Address:</strong> ${escapeHtml(wledIpAddress || 'Not set')}</div>`;
            wledHtml += `<div><strong>On:</strong> ${debugInfo.wledStatus.on ? 'Yes' : 'No'}</div>`;
            wledHtml += `<div><strong>Brightness:</strong> ${debugInfo.wledStatus.brightness}</div>`;
            wledHtml += `</div>`;
        } else {
            wledHtml = `<div class="alert alert-danger">WLED connection failed!</div>`;
            if (debugInfo.wledStatus.error) {
                wledHtml += `<div class="alert alert-warning">${escapeHtml(debugInfo.wledStatus.error)}</div>`;
            }
        }
            
        wledStatus.innerHTML = wledHtml;
    } else {
        wledStatus.innerHTML = `<div class="alert alert-warning">No WLED status information available.</div>`;
    }
        
    // Update 3CX authentication status
    if (debugInfo.threecxAuth) {
        let authHtml = '';
        if (debugInfo.threecxAuth.authenticated) {
            authHtml = `<div class="alert alert-success">Authenticated to 3CX</div>`;
            authHtml += `<div class="auth-details">`;
            authHtml += `<div><strong>URL:</strong> ${escapeHtml(debugInfo.threecxAuth.url || 'Not set')}</div>`;
            authHtml += `<div><strong>Session:</strong> Valid</div>`;
            authHtml += `<div><strong>Last Login:</strong> ${new Date(debugInfo.threecxAuth.lastLogin).toLocaleString()}</div>`;
            authHtml += `</div>`;
        } else {
            authHtml = `<div class="alert alert-warning">Not authenticated to 3CX</div>`;
            if (debugInfo.threecxAuth.error) {
                authHtml += `<div class="alert alert-danger">${escapeHtml(debugInfo.threecxAuth.error)}</div>`;
            }
        }
            
        threecxAuthStatus.innerHTML = authHtml;
    } else {
        threecxAuthStatus.innerHTML = `<div class="alert alert-info">Checking 3CX authentication status...</div>`;
    }
        
    // Update 3CX status information
    if (debugInfo.status) {
        let statusHtml = `<div class="alert alert-info">`;
        statusHtml += `<strong>Current Status:</strong> ${escapeHtml(statusDisplayNames[debugInfo.status] || debugInfo.status)}<br>`;
        statusHtml += `<strong>Source:</strong> ${escapeHtml(debugInfo.source || 'Unknown')}<br>`;
        statusHtml += `<strong>Last Updated:</strong> ${new Date(debugInfo.serverTime).toLocaleString()}`;
        statusHtml += `</div>`;
            
        threecxStatus.innerHTML = statusHtml;
    } else {
        threecxStatus.innerHTML = `<div class="alert alert-info">Waiting for 3CX status information...</div>`;
    }
        
    // Update connection details
    let connectionHtml = `<div class="alert alert-info">`;
    connectionHtml += `<strong>Server Time:</strong> ${new Date(debugInfo.serverTime).toLocaleString()}<br>`;
        
    if (debugInfo.connectedClients !== undefined) {
        connectionHtml += `<strong>Connected Clients:</strong> ${debugInfo.connectedClients}<br>`;
    }
        
    if (debugInfo.callStats) {
        connectionHtml += `<strong>Call Stats Source:</strong> ${debugInfo.callStats.source || 'Unknown'}<br>`;
        connectionHtml += `<strong>Call Stats Updated:</strong> ${new Date(debugInfo.callStats.lastUpdated).toLocaleString()}`;
    }
        
    connectionHtml += `</div>`;
    connectionDetails.innerHTML = connectionHtml;
        
    // Update manual override info
    if (debugInfo.manualOverride) {
        const remainingTime = debugInfo.manualOverrideRemaining || 0;
        const overrideTime = new Date(debugInfo.manualOverrideTime);
            
        let overrideHtml = `<div class="alert alert-warning">`;
        overrideHtml += `<strong>Manual Override Active!</strong><br>`;
        overrideHtml += `Set at: ${overrideTime.toLocaleTimeString()}<br>`;
        overrideHtml += `Expires in: ${remainingTime} seconds`;
        overrideHtml += `</div>`;
            
        // Add override info to status display
        const statusDisplay = document.querySelector('.status-display');
        if (statusDisplay) {
            const existingOverrideInfo = statusDisplay.querySelector('.override-info');
            if (existingOverrideInfo) {
                existingOverrideInfo.innerHTML = overrideHtml;
            } else {
                const overrideInfo = document.createElement('div');
                overrideInfo.className = 'override-info';
                overrideInfo.innerHTML = overrideHtml;
                statusDisplay.appendChild(overrideInfo);
            }
        }
    } else {
        // Remove override info if exists
        const overrideInfo = document.querySelector('.override-info');
        if (overrideInfo) {
            overrideInfo.remove();
        }
    }
}

// Update WLED status UI
function updateWLEDStatusUI(success, errorMessage = null, statusData = null) {
    if (success) {
        let statusHtml = '<div class="alert alert-success">WLED connected successfully!</div>';
            
        if (statusData) {
            statusHtml += '<div class="wled-details">';
            statusHtml += `<div><strong>On:</strong> ${statusData.on ? 'Yes' : 'No'}</div>`;
            statusHtml += `<div><strong>Brightness:</strong> ${statusData.bri}</div>`;
                
            if (statusData.seg && statusData.seg.length > 0) {
                const segment = statusData.seg[0];
                if (segment.col && segment.col.length > 0) {
                    const color = segment.col[0];
                    statusHtml += `<div><strong>Current Color:</strong> RGB(${color[0]}, ${color[1]}, ${color[2]})</div>`;
                }
            }
                
            statusHtml += '</div>';
        }
            
        wledStatus.innerHTML = statusHtml;
    } else {
        let errorMsg = errorMessage || 'Could not connect to WLED device';
        wledStatus.innerHTML = `
            <div class="alert alert-danger">
                <strong>WLED Connection Error:</strong> ${escapeHtml(errorMsg)}
                <div class="mt-2">Check your WLED IP address in the .env file and make sure the device is powered on and connected to your network.</div>
            </div>
        `;
    }
}

// Helper function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Send status update via WebSocket
function sendStatusUpdate(status, monitoring) {
    console.log(`Sending status update: ${status}, monitoring: ${monitoring}`);
        
    // Log the color that should be applied
    if (status) {
        const color = statusColors[status];
        console.log(`Status color for ${status}: RGB(${color.r}, ${color.g}, ${color.b})`);
    }
        
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('Sending via WebSocket');
        ws.send(JSON.stringify({
            type: 'status',
            status: status,
            monitoring: monitoring
        }));
    } else {
        // Fallback to API if WebSocket is not available
        console.log('Sending via API');
        fetch('/api/status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: status,
                monitoring: monitoring
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('Status updated successfully via API');
            } else {
                console.error('API returned error:', data);
            }
        })
        .catch(error => {
            console.error('Error updating status via API:', error);
        });
    }
}

// Apply WLED settings
function applyWLEDSettings() {
    const brightness = parseInt(brightnessSlider.value, 10);
    const transition = parseInt(transitionSlider.value, 10);
        
    fetch('/api/wled/settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            brightness: brightness,
            transition: transition
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('WLED settings updated successfully');
        }
    })
    .catch(error => {
        console.error('Error updating WLED settings:', error);
    });
}

// Turn off WLED
function turnOffWLED() {
    fetch('/api/wled/off', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('WLED turned off successfully');
        }
    })
    .catch(error => {
        console.error('Error turning off WLED:', error);
    });
}

// Test WLED connection
function testWLEDConnection() {
    testWLEDButton.disabled = true;
    testWLEDButton.textContent = 'Testing...';
        
    fetch('/api/wled/test', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        updateWLEDStatusUI(data.success, data.error);
        testWLEDButton.disabled = false;
        testWLEDButton.textContent = 'Test WLED Connection';
    })
    .catch(error => {
        console.error('Error testing WLED connection:', error);
        updateWLEDStatusUI(false, error.message);
        testWLEDButton.disabled = false;
        testWLEDButton.textContent = 'Test WLED Connection';
    });
}

// Update call stats UI
function updateCallStatsUI(callStats) {
  if (!callStats) return;
  
  // Update call statistics display
  if (waitingCallsElement) waitingCallsElement.textContent = callStats.waitingCalls || '0';
  if (activeCallsElement) activeCallsElement.textContent = callStats.activeCalls || '0';
  if (totalCallsElement) totalCallsElement.textContent = callStats.totalCalls || '0';
  if (servicedCallsElement) servicedCallsElement.textContent = callStats.servicedCalls || '0';
  if (abandonedCallsElement) abandonedCallsElement.textContent = callStats.abandonedCalls || '0';
  
  // Update input fields with current values
  if (waitingCallsInput) waitingCallsInput.value = callStats.waitingCalls || '0';
  if (activeCallsInput) activeCallsInput.value = callStats.activeCalls || '0';
  if (totalCallsInput) totalCallsInput.value = callStats.totalCalls || '0';
  if (servicedCallsInput) servicedCallsInput.value = callStats.servicedCalls || '0';
  if (abandonedCallsInput) abandonedCallsInput.value = callStats.abandonedCalls || '0';
  
  // Update last updated timestamp
  if (lastUpdatedElement && callStats.lastUpdated) {
    const lastUpdated = new Date(callStats.lastUpdated);
    lastUpdatedElement.textContent = lastUpdated.toLocaleTimeString();
  }
  
  // Add call stats to debug panel if they don't exist elsewhere
  if (!waitingCallsElement && callStats) {
    const callStatsContainer = document.createElement('div');
    callStatsContainer.className = 'call-stats-container mt-3';
    callStatsContainer.innerHTML = `
      <h5>Call Statistics</h5>
      <div class="row">
        <div class="col-4">
          <div class="stat-box">
            <div class="stat-value">${callStats.waitingCalls || '0'}</div>
            <div class="stat-label">Waiting</div>
          </div>
        </div>
        <div class="col-4">
          <div class="stat-box">
            <div class="stat-value">${callStats.activeCalls || '0'}</div>
            <div class="stat-label">Active</div>
          </div>
        </div>
        <div class="col-4">
          <div class="stat-box">
            <div class="stat-value">${callStats.totalCalls || '0'}</div>
            <div class="stat-label">Total</div>
          </div>
        </div>
      </div>
    `;
    
    // Add to the page if detectedApps exists
    if (detectedApps && detectedApps.parentNode) {
      detectedApps.parentNode.insertBefore(callStatsContainer, detectedApps.nextSibling);
    }
  }
}

// Send call statistics update to the server
function sendCallStatsUpdate() {
  // Get values from input fields
  const waitingCalls = parseInt(waitingCallsInput.value || '0', 10);
  const activeCalls = parseInt(activeCallsInput.value || '0', 10);
  const totalCalls = parseInt(totalCallsInput.value || '0', 10);
  const servicedCalls = parseInt(servicedCallsInput.value || '0', 10);
  const abandonedCalls = parseInt(abandonedCallsInput.value || '0', 10);
  
  // Create call stats object
  const callStats = {
    waitingCalls,
    activeCalls,
    totalCalls,
    servicedCalls,
    abandonedCalls
  };
  
  // Send to server via WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'callStats',
      callStats
    }));
    
    console.log('Sent call stats update:', callStats);
  } else {
    // Fallback to API if WebSocket is not available
    fetch('/api/call-stats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(callStats)
    })
    .then(response => response.json())
    .then(data => {
      console.log('Call stats update response:', data);
      if (data.callStats) {
        updateCallStatsUI(data.callStats);
      }
    })
    .catch(error => {
      console.error('Error updating call stats:', error);
    });
  }
}

// Take screenshot of 3CX web interface
function takeScreenshot() {
    takeScreenshotButton.disabled = true;
    takeScreenshotButton.textContent = 'Taking Screenshot...';
    
    fetch('/api/take-screenshot')
        .then(response => response.json())
        .then(data => {
            takeScreenshotButton.disabled = false;
            takeScreenshotButton.textContent = 'Take 3CX Screenshot';
            
            if (data.success) {
                // Display the screenshot
                screenshotContainer.classList.remove('d-none');
                const screenshotUrl = data.screenshotPath;
                screenshotImage.src = screenshotUrl;
                screenshotLink.href = screenshotUrl;
                
                // Scroll to the screenshot
                screenshotContainer.scrollIntoView({ behavior: 'smooth' });
            } else {
                alert('Failed to take screenshot: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error taking screenshot:', error);
            takeScreenshotButton.disabled = false;
            takeScreenshotButton.textContent = 'Take 3CX Screenshot';
            alert('Error taking screenshot. See console for details.');
        });
}

// Reset 3CX authentication
function resetAuthentication() {
    if (confirm('Are you sure you want to reset 3CX authentication? This will require you to log in again.')) {
        fetch('/api/reset-auth', {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('Authentication reset successfully. Please wait for the browser to open for login.');
            } else {
                alert('Failed to reset authentication: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error resetting authentication:', error);
            alert('Error resetting authentication. See console for details.');
        });
    }
}

// Event listeners
// Initialize the application
function initApp() {
    // Initialize WebSocket connection
    initWebSocket();
    
    // Set up a fallback status refresh interval
    if (statusRefreshInterval) {
        clearInterval(statusRefreshInterval);
    }
    
    // Initial fetch
    fetchStatus();
    
    // Only set up the interval if WebSocket is not supported or fails
    statusRefreshInterval = setInterval(() => {
        // Only fetch status if WebSocket is not connected
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            fetchStatus();
        }
    }, 30000); // Reduced frequency to 30 seconds as a fallback
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize the application
  initApp();
  
  // Add connection status indicator to the page
  const statusContainer = document.querySelector('.status-indicator');
  if (statusContainer) {
    const connectionStatusBadge = document.createElement('span');
    connectionStatusBadge.id = 'connection-status';
    connectionStatusBadge.className = 'badge bg-secondary';
    connectionStatusBadge.textContent = 'Connecting...';
    statusContainer.appendChild(connectionStatusBadge);
    
    // Add reconnect button
    const reconnectButton = document.createElement('button');
    reconnectButton.id = 'reconnect-button';
    reconnectButton.className = 'btn btn-sm btn-outline-primary ms-2';
    reconnectButton.textContent = 'Reconnect';
    reconnectButton.style.display = 'none';
    reconnectButton.addEventListener('click', () => {
      reconnectButton.style.display = 'none';
      initWebSocket();
    });
    statusContainer.appendChild(reconnectButton);
  }
  
  // Status button click handlers
  statusButtons.forEach(button => {
    button.addEventListener('click', () => {
      const status = button.getAttribute('data-status');
      console.log(`Status button clicked: ${status}`);
      
      // Highlight the selected button
      statusButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update the status display immediately for better UX
      updateStatusUI(status, monitoringToggle.checked);
      
      // Send the status update to the server
      sendStatusUpdate(status, monitoringToggle.checked);
    });
  });
  
  // Monitoring toggle handler
  monitoringToggle.addEventListener('change', () => {
    sendStatusUpdate(null, monitoringToggle.checked);
  });
  
  // Brightness slider handler
  brightnessSlider.addEventListener('input', () => {
    brightnessValue.textContent = brightnessSlider.value;
  });
  
  // Transition slider handler
  transitionSlider.addEventListener('input', () => {
    transitionValue.textContent = transitionSlider.value;
  });
  
  // Apply settings button handler
  applySettingsButton.addEventListener('click', applyWLEDSettings);
  
  // Turn off WLED button handler
  turnOffWLEDButton.addEventListener('click', turnOffWLED);
  
  // Update call stats button handler
  if (updateCallStatsButton) {
    updateCallStatsButton.addEventListener('click', sendCallStatsUpdate);
  }
  
  // Refresh debug info button handler
  refreshDebugButton.addEventListener('click', () => {
    fetchDebugInfo();
    requestDebugInfo();
  });
  
  // Test WLED connection button handler
  testWLEDButton.addEventListener('click', testWLEDConnection);
  
  // Add event listener for refresh debug button
  if (refreshDebugButton) {
    refreshDebugButton.addEventListener('click', () => {
      requestDebugInfo();
    });
  }
  
  // Add event listener for test WLED button
  if (testWLEDButton) {
    testWLEDButton.addEventListener('click', testWLEDConnection);
  }
  
  // Add event listener for reset authentication button
  if (resetAuthButton) {
    resetAuthButton.addEventListener('click', resetAuthentication);
  }
  
  // Add event listener for take screenshot button
  if (takeScreenshotButton) {
    takeScreenshotButton.addEventListener('click', takeScreenshot);
  }
  
  // Set up auto-refresh for debug info
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      requestDebugInfo();
    }
  }, 5000); // Refresh every 5 seconds when page is visible
});

// Add some additional CSS styles dynamically
const style = document.createElement('style');
style.textContent = `
.threecx-window {
    background-color: rgba(40, 167, 69, 0.1);
}
.stat-box {
    text-align: center;
    padding: 10px;
    background-color: #f8f9fa;
    border-radius: 5px;
    margin-bottom: 10px;
}
.stat-value {
    font-size: 1.5rem;
    font-weight: bold;
}
.stat-label {
    font-size: 0.8rem;
    color: #6c757d;
}
.app-3cx {
    background-color: rgba(40, 167, 69, 0.1);
}
`;
document.head.appendChild(style);
