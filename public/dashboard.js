/**
 * 3CX Team Dashboard - JavaScript
 * 
 * This script handles the team status dashboard, displaying team members' status
 * and call statistics from the 3CX phone system.
 */

// WebSocket connection
let ws = null;

// Dashboard elements
const queueAvailableContainer = document.getElementById('queue-available-container');
const queueAwayContainer = document.getElementById('queue-away-container');
const noQueueContainer = document.getElementById('no-queue-container');
const waitingCalls = document.getElementById('waiting-calls');
const servicedCalls = document.getElementById('serviced-calls');
const abandonedCalls = document.getElementById('abandoned-calls');
const longestWaiting = document.getElementById('longest-waiting');
const averageWaiting = document.getElementById('average-waiting');
const averageTalking = document.getElementById('average-talking');
const lastUpdated = document.getElementById('last-updated');
const refreshButton = document.getElementById('refresh-dashboard');
const autoRefreshToggle = document.getElementById('auto-refresh');
const showOfflineToggle = document.getElementById('show-offline');

// Status summary elements
const availableCount = document.getElementById('available-count');
const onCallCount = document.getElementById('on-call-count');
const dndCount = document.getElementById('dnd-count');
const awayCount = document.getElementById('away-count');

// Auto-refresh interval (in milliseconds)
let autoRefreshInterval = null;
const AUTO_REFRESH_INTERVAL = 10000; // 10 seconds

// Global variables
let currentTeamStatus = [];
let isMonitoring = false;
let appVersion = '1.0.0'; // Default version

// Initialize WebSocket connection
function initWebSocket() {
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
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket connection established');
            // Initial data fetch
            fetchDashboardData();
            
            // Request team status via WebSocket
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'requestStatus'
                }));
            }
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received WebSocket message:', data.type);
                
                if (data.type === 'teamStatus') {
                    console.log('Received team status update with', data.teamStatus.length, 'members');
                    updateTeamStatus(data.teamStatus);
                } else if (data.type === 'callStats') {
                    updateCallStats(data.callStats);
                } else if (data.type === 'status') {
                    // Update version information if available
                    if (data.version) {
                        appVersion = data.version;
                        updateVersionDisplay();
                    }
                    
                    // If the status message includes team status, update it
                    if (data.teamStatus && Array.isArray(data.teamStatus)) {
                        updateTeamStatus(data.teamStatus);
                    }
                    
                    // If the status message includes agent statuses, use those as fallback
                    if (!data.teamStatus && data.agentStatuses && Array.isArray(data.agentStatuses)) {
                        updateTeamStatus(data.agentStatuses);
                    }
                    
                    // If the status message includes call stats, update them
                    if (data.callStats) {
                        updateCallStats(data.callStats);
                    }
                } else if (data.type === 'ping') {
                    // Respond to ping with pong
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'pong' }));
                    }
                }
            } catch (error) {
                console.error('Error handling WebSocket message:', error);
            }
        };
        
        ws.onclose = () => {
            console.log('WebSocket connection closed');
            // Attempt to reconnect after a delay
            setTimeout(initWebSocket, 3000);
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    } catch (error) {
        console.error('Error creating WebSocket:', error);
    }
}

// Fetch dashboard data from the API
function fetchDashboardData() {
    console.log('Fetching dashboard data from API...');
    
    // First try the main status API
    fetch('/api/status')
        .then(response => response.json())
        .then(data => {
            console.log('API response:', data);
            
            // Process team status data if available
            if (data.teamStatus && Array.isArray(data.teamStatus) && data.teamStatus.length > 0) {
                console.log('Team status data received:', data.teamStatus.length, 'members');
                updateTeamStatus(data.teamStatus);
            } else if (data.agentStatuses && Array.isArray(data.agentStatuses) && data.agentStatuses.length > 0) {
                // Try alternative property name
                console.log('Agent statuses data received:', data.agentStatuses.length, 'members');
                updateTeamStatus(data.agentStatuses);
            } else {
                console.warn('No team status data found in API response, trying dedicated endpoint');
                // Fetch team status directly as a fallback
                fetchTeamStatus();
            }
            
            // Process call stats if available
            if (data.callStats) {
                updateCallStats(data.callStats);
            }
            
            updateLastUpdated();
        })
        .catch(error => {
            console.error('Error fetching dashboard data:', error);
            // Try the dedicated team status endpoint as a fallback
            fetchTeamStatus();
        });
}

// Fetch team status from the dedicated API endpoint
function fetchTeamStatus() {
    console.log('Fetching team status from dedicated API endpoint...');
    fetch('/api/teamStatus')
        .then(response => response.json())
        .then(teamData => {
            console.log('Team status API response:', teamData);
            if (teamData.teamStatus && Array.isArray(teamData.teamStatus) && teamData.teamStatus.length > 0) {
                updateTeamStatus(teamData.teamStatus);
            } else {
                console.error('No team status data found in teamStatus API response');
                // If we still don't have team status data, show a message in the UI
                showNoTeamStatusMessage();
            }
        })
        .catch(error => {
            console.error('Error fetching team status:', error);
            // Show error message in the UI
            showNoTeamStatusMessage('Error loading team status data. Please try refreshing the page.');
        });
}

// Show a message when no team status data is available
function showNoTeamStatusMessage(message = 'No team status data available. Please make sure 3CX is connected.') {
    // Only show the message if we don't already have team status data
    if (currentTeamStatus.length === 0) {
        const noDataMessage = `
            <div class="alert alert-warning">
                <i class="bi bi-exclamation-triangle-fill"></i> ${message}
            </div>
        `;
        queueAvailableContainer.innerHTML = noDataMessage;
        queueAwayContainer.innerHTML = noDataMessage;
        noQueueContainer.innerHTML = noDataMessage;
    }
}

// Update team status display
function updateTeamStatus(teamStatus) {
    console.log('updateTeamStatus called with:', teamStatus);
    
    if (!teamStatus || !Array.isArray(teamStatus)) {
        console.error('Invalid team status data');
        return;
    }
    
    // Store the current team status data
    currentTeamStatus = teamStatus;
    
    console.log('Updating team status with', teamStatus.length, 'members');
    
    // Debug: Log the first few team members
    if (teamStatus.length > 0) {
        console.log('Sample team member:', teamStatus[0]);  
    }
    
    // Clear the containers
    queueAvailableContainer.innerHTML = '';
    queueAwayContainer.innerHTML = '';
    noQueueContainer.innerHTML = '';
    
    // Reset status counts
    let counts = {
        available: 0,
        onCall: 0,
        dnd: 0,
        away: 0,
        offline: 0
    };
    
    // Filter out entries without names (likely system extensions)
    const validMembers = teamStatus.filter(member => {
        // Filter by name
        if (!member.name || member.name.trim() === '') return false;
        
        // Filter offline members if toggle is unchecked
        if (!showOfflineToggle.checked && member.status === 'offline') return false;
        
        // Include this member
        return true;
    });
    
    // If no valid members, show a message in all containers
    if (validMembers.length === 0) {
        const noDataMessage = `
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i> No team members found.
            </div>
        `;
        queueAvailableContainer.innerHTML = noDataMessage;
        queueAwayContainer.innerHTML = noDataMessage;
        noQueueContainer.innerHTML = noDataMessage;
        return;
    }
    
    // Sort team members by extension number
    validMembers.sort((a, b) => {
        const extA = parseInt(a.extension) || 0;
        const extB = parseInt(b.extension) || 0;
        return extA - extB;
    });
    
    // Group members by their status and queue membership
    const queueAvailable = [];
    const queueAway = [];
    const noQueue = [];
    
    validMembers.forEach(member => {
        // Check if member is in any queue
        const isInQueue = member.queues && member.queues.trim() !== '';
        
        // Check if member is available or away/busy
        const isAvailable = member.status === 'available';
        const isAway = member.status === 'away';
        const isOnCall = member.status === 'onCall';
        const isDnd = member.status === 'dnd';
        
        // Any member who is away, on call, or DND should go in the away/busy column
        const isAwayOrBusy = isAway || isOnCall || isDnd;
        
        // Group member based on status first, then queue membership
        if (isAvailable) {
            // Available members go in queue available if they're in a queue, otherwise no queue
            if (isInQueue) {
                queueAvailable.push(member);
            } else {
                noQueue.push(member);
            }
        } else if (isAwayOrBusy) {
            // Away/busy members always go in the middle column regardless of queue membership
            queueAway.push(member);
        } else {
            // Everyone else (offline) goes in no queue
            noQueue.push(member);
        }
        
        // Count the number of queues for sorting
        member.queueCount = member.queues ? member.queues.split(',').length : 0;
        
        // Update counts
        if (member.status === 'available') counts.available++;
        else if (member.status === 'onCall') counts.onCall++;
        else if (member.status === 'dnd') counts.dnd++;
        else if (member.status === 'away') counts.away++;
        else counts.offline++;
    });
    
    // Sort each group by status (available first) and then by number of queues (most to least)
    const sortByAvailabilityAndQueues = (a, b) => {
        // First sort by availability (available comes first)
        if (a.status === 'available' && b.status !== 'available') return -1;
        if (a.status !== 'available' && b.status === 'available') return 1;
        
        // Then sort by number of queues
        return b.queueCount - a.queueCount;
    };
    
    queueAvailable.sort((a, b) => b.queueCount - a.queueCount); // Already all available
    queueAway.sort(sortByAvailabilityAndQueues);
    noQueue.sort(sortByAvailabilityAndQueues);
    
    // Render each group
    renderTeamMembers(queueAvailable, queueAvailableContainer);
    renderTeamMembers(queueAway, queueAwayContainer);
    renderTeamMembers(noQueue, noQueueContainer);
    
    // Update status counts
    availableCount.textContent = counts.available;
    onCallCount.textContent = counts.onCall;
    dndCount.textContent = counts.dnd;
    awayCount.textContent = counts.away;
    
    // Update last updated timestamp
    updateLastUpdated();
}

// Render team members in a container
function renderTeamMembers(members, container) {
    // If no members, show a message
    if (members.length === 0) {
        container.innerHTML = `
            <div class="alert alert-light text-center small">
                <i class="bi bi-info-circle"></i> No team members in this category
            </div>
        `;
        return;
    }
    
    // Clear the container
    container.innerHTML = '';
    
    // Add each team member
    members.forEach(member => {
        // Determine status color class
        let statusClass = 'status-gray'; // Default
        
        if (member.color) {
            statusClass = `status-${member.color}`;
        } else {
            // Determine color based on status if not provided
            switch (member.status) {
                case 'available':
                    statusClass = 'status-green';
                    break;
                case 'onCall':
                    statusClass = 'status-red';
                    break;
                case 'ringing':
                    statusClass = 'status-yellow';
                    break;
                case 'dnd':
                    statusClass = 'status-purple';
                    break;
                case 'away':
                    statusClass = 'status-orange';
                    break;
                default:
                    statusClass = 'status-gray';
            }
        }
        
        // Create HTML for the team member card
        let memberHtml = `
            <div class="team-member bg-light" data-id="${member.id || member.extension}">
                <h4><span class="status-indicator ${statusClass}"></span> ${member.name}</h4>
                <p class="mb-1"><strong>Ext:</strong> ${member.extension} - ${getStatusDisplayName(member.status)}</p>
        `;
        
        // Add queues information if available
        if (member.queues && member.queues.trim() !== '') {
            memberHtml += `<p class="mb-1 small text-muted"><strong>Queues:</strong> ${member.queues}</p>`;
        }
        
        // Close the team member div
        memberHtml += `</div>`;
        
        // Create and append the member element
        const memberElement = document.createElement('div');
        memberElement.innerHTML = memberHtml;
        container.appendChild(memberElement);
    });
}

// Update call statistics display
function updateCallStats(callStats) {
    if (!callStats) {
        console.error('Invalid call stats data');
        return;
    }
    
    waitingCalls.textContent = callStats.waitingCalls || '0';
    servicedCalls.textContent = callStats.servicedCalls || '0';
    abandonedCalls.textContent = callStats.abandonedCalls || '0';
    longestWaiting.textContent = callStats.longestWaiting || '00:00:00';
    averageWaiting.textContent = callStats.averageWaiting || '00:00:00';
    averageTalking.textContent = callStats.averageTalking || '00:00:00';
    
    updateLastUpdated();
}

// Update the last updated timestamp
function updateLastUpdated() {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    lastUpdated.textContent = timeString;
}

// Update a team member's status
function updateTeamMemberStatus(id, status) {
    fetch(`/api/teamStatus/${id}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log(`Updated status for team member ${id} to ${status}`);
        } else {
            console.error('Error updating team member status:', data.error);
        }
    })
    .catch(error => {
        console.error('Error updating team member status:', error);
    });
}

// Get display name for status
function getStatusDisplayName(status) {
    switch (status) {
        case 'available':
            return 'Available';
        case 'onCall':
            return 'On Call';
        case 'ringing':
            return 'Ringing';
        case 'dnd':
            return 'Do Not Disturb';
        case 'away':
            return 'Away';
        case 'lunch':
            return 'Lunch';
        case 'business-trip':
            return 'Business Trip';
        case 'offline':
            return 'Offline';
        default:
            return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Offline';
    }
}

// Set up auto-refresh
function setupAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    if (autoRefreshToggle.checked) {
        autoRefreshInterval = setInterval(fetchDashboardData, AUTO_REFRESH_INTERVAL);
    }
}

// Toggle showing offline team members
function toggleOfflineMembers() {
    // If we have team status data, update the display
    if (currentTeamStatus.length > 0) {
        updateTeamStatus(currentTeamStatus);
    }
}

// Update version display in the footer
function updateVersionDisplay() {
    const versionElement = document.getElementById('app-version');
    if (versionElement) {
        versionElement.textContent = `v${appVersion}`;
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Initialize WebSocket
    initWebSocket();
    
    // Set up auto-refresh
    setupAutoRefresh();
    
    // Add event listener to refresh button
    refreshButton.addEventListener('click', fetchDashboardData);
    
    // Add event listener to auto-refresh toggle
    autoRefreshToggle.addEventListener('change', setupAutoRefresh);
    
    // Add event listener to show-offline toggle
    showOfflineToggle.addEventListener('change', toggleOfflineMembers);
    
    // Initialize version display
    updateVersionDisplay();
});
