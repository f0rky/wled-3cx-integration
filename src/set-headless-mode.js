/**
 * Configuration script for WLED-3CX Integration
 * This script sets all necessary environment variables at runtime
 * and starts the application with a visible browser window for authentication
 */

// 3CX Web Client Configuration
process.env.THREECX_WEB_URL = 'https://primonz.my3cx.nz';
process.env.THREECX_REFRESH_INTERVAL = '10000';
process.env.THREECX_HEADLESS = 'false'; // Set to false to see the browser window for authentication

// Web Server Configuration
process.env.SERVER_PORT = '1550';

// WLED Configuration
process.env.WLED_IP_ADDRESS = '192.168.111.50'; // Update with your WLED device IP
process.env.WLED_BRIGHTNESS = '128';
process.env.WLED_TRANSITION = '1000';

console.log('\n===== WLED-3CX Integration Configuration =====');
console.log('3CX Web Client:');
console.log('- URL:', process.env.THREECX_WEB_URL);
console.log('- Refresh Interval:', process.env.THREECX_REFRESH_INTERVAL, 'ms');
console.log('- Headless Mode:', process.env.THREECX_HEADLESS);

console.log('\nWeb Server:');
console.log('- Port:', process.env.SERVER_PORT);

console.log('\nWLED:');
console.log('- IP Address:', process.env.WLED_IP_ADDRESS);
console.log('- Brightness:', process.env.WLED_BRIGHTNESS);
console.log('- Transition:', process.env.WLED_TRANSITION, 'ms');

console.log('\n===========================================');
console.log(
  'Starting the application with visible browser window for authentication...'
);
console.log(
  'Please complete the login process when the browser window appears.'
);
console.log('Your session will be saved for future use.\n');

// Set up global error handling
process.on('uncaughtException', (error) => {
  console.error('\n===== UNCAUGHT EXCEPTION =====');
  console.error(error);
  console.error(error.stack);
  console.error('===============================\n');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n===== UNHANDLED PROMISE REJECTION =====');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  console.error('========================================\n');
});

try {
  console.log('Loading app.js...');
  // Import the main app but don't run it automatically
  const { main } = require('./app.js');
  console.log('App.js loaded successfully');

  // Explicitly call the main function
  console.log('Starting the application...');
  main().catch((error) => {
    console.error('Application error:', error);
    process.exit(1);
  });
} catch (error) {
  console.error('\n===== ERROR STARTING APPLICATION =====');
  console.error(error);
  console.error(error.stack);
  console.error('======================================\n');
}
