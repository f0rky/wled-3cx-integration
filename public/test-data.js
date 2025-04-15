/**
 * Test data for the dashboard
 * This script provides sample data for testing the dashboard UI
 */

// Sample team status data based on the HTML structure provided
const sampleTeamStatus = [
  {
    id: "500",
    extension: "500",
    name: "Zoe Rook",
    status: "away",
    queues: "",
    color: "orange"
  },
  {
    id: "501",
    extension: "501",
    name: "Hanan Pillette",
    status: "available",
    queues: "",
    color: "green"
  },
  {
    id: "503",
    extension: "503",
    name: "Kelly Ellis",
    status: "available",
    queues: "",
    color: "green"
  },
  {
    id: "504",
    extension: "504",
    name: "Voicemail Network Status",
    status: "offline",
    queues: "",
    color: "gray"
  },
  {
    id: "509",
    extension: "509",
    name: "Callum Glennie",
    status: "available",
    queues: "Business Afterhours (Concierge)",
    color: "green"
  },
  {
    id: "511",
    extension: "511",
    name: "Anthony Finnerty",
    status: "available",
    queues: "Sales, Technical, Accounts",
    color: "green"
  },
  {
    id: "512",
    extension: "512",
    name: "Jason Leef",
    status: "available",
    queues: "Sales, Technical, Accounts, Business Escalations (HD)",
    color: "green"
  },
  {
    id: "534",
    extension: "534",
    name: "Brett Healy",
    status: "available",
    queues: "Sales, Technical, Accounts, Business Escalations (HD), Business Afterhours (Concierge)",
    color: "green"
  }
];

// Sample call statistics
const sampleCallStats = {
  waitingCalls: 2,
  activeCalls: 3,
  totalCalls: 15,
  servicedCalls: 10,
  abandonedCalls: 3,
  longestWaiting: "00:03:45",
  averageWaiting: "00:01:30",
  averageTalking: "00:04:15",
  lastUpdated: new Date().toISOString()
};

// Function to load test data into the dashboard
function loadTestData() {
  console.log('Loading test data into dashboard...');
  
  // Check if updateTeamStatus function exists
  if (typeof updateTeamStatus === 'function') {
    console.log('Updating team status with sample data...');
    updateTeamStatus(sampleTeamStatus);
  } else {
    console.error('updateTeamStatus function not found!');
  }
  
  // Check if updateCallStats function exists
  if (typeof updateCallStats === 'function') {
    console.log('Updating call stats with sample data...');
    updateCallStats(sampleCallStats);
  } else {
    console.error('updateCallStats function not found!');
  }
}

// Auto-load test data after a short delay
setTimeout(loadTestData, 1000);

console.log('Test data script loaded');
