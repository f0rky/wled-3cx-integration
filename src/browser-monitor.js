/**
 * 3CX Browser Monitor for WLED Integration
 * 
 * This script uses browser automation to monitor the 3CX web interface
 * and update WLED LED strips based on call status.
 */

require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Configuration from environment variables
const config = {
  // 3CX Configuration
  threecx: {
    webUrl: process.env.THREECX_WEB_URL || 'https://primonz.my3cx.nz',
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
};

// Last known status to prevent unnecessary updates
let lastStatus = null;
let browser = null;
let page = null;

/**
 * Launch browser and navigate to 3CX web interface
 */
async function initBrowser() {
  console.log('Launching browser...');
  
  try {
    // Always use headless mode since we don't have X server
    // But use the new headless mode for better compatibility
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ],
      defaultViewport: { width: 1280, height: 800 },
    });
    
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    // Create screenshots directory if it doesn't exist
    const fs = require('fs');
    const path = require('path');
    const screenshotsDir = path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir);
    }
    
    // Enable console logging from the browser
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    
    console.log(`Navigating to 3CX web interface: ${config.threecx.webUrl}`);
    await page.goto(config.threecx.webUrl, { waitUntil: 'networkidle2' });
    
    // Take a screenshot of the initial page
    await page.screenshot({ path: path.join(screenshotsDir, 'initial-page.png') });
    console.log('Screenshot saved to screenshots/initial-page.png');
    
    // Wait for Microsoft 365 login page to load
    console.log('Waiting for Microsoft 365 login page...');
    
    // Try to load cookies first
    const cookiesPath = path.join(process.cwd(), 'cookies.json');
    
    if (fs.existsSync(cookiesPath)) {
      try {
        console.log('Found saved cookies, attempting to use them...');
        const cookiesString = fs.readFileSync(cookiesPath, 'utf8');
        const cookies = JSON.parse(cookiesString);
        
        // Set cookies
        for (const cookie of cookies) {
          await page.setCookie(cookie);
        }
        
        console.log(`Loaded ${cookies.length} cookies from ${cookiesPath}`);
        
        // Refresh the page to apply cookies
        await page.reload({ waitUntil: 'networkidle2' });
        
        // Take a screenshot after applying cookies
        await page.screenshot({ path: path.join(screenshotsDir, 'after-cookies.png') });
        console.log('Screenshot saved to screenshots/after-cookies.png');
      } catch (error) {
        console.error('Error loading cookies:', error);
      }
    }
    
    // Check if we still need to log in
    if (await page.$('input[type="email"]')) {
      console.log('Microsoft 365 login page detected. Cookies did not work or were not found.');
      console.log('Please run the cookie exporter first:');
      console.log('  npm run export-cookies');
      
      // Take a screenshot of the login page
      await page.screenshot({ path: path.join(screenshotsDir, 'login-page.png') });
      console.log('Screenshot of login page saved to screenshots/login-page.png');
      
      throw new Error('Authentication required. Please run the cookie exporter first.');
    } else {
      console.log('Successfully authenticated with 3CX!');
      
      // Take a screenshot after login
      await page.screenshot({ path: path.join(screenshotsDir, 'after-login.png') });
      console.log('Screenshot saved to screenshots/after-login.png');
    }
    
    console.log('Successfully logged in to 3CX web interface');
    return true;
  } catch (error) {
    console.error('Error initializing browser:', error);
    return false;
  }
}

/**
 * Check call status from 3CX web interface
 */
async function checkCallStatus() {
  if (!page) {
    console.error('Browser page not initialized');
    return null;
  }
  
  try {
    // Wait for the page to be fully loaded
    await page.waitForSelector('body', { timeout: 5000 });
    
    // Take a screenshot for debugging (optional)
    // await page.screenshot({ path: 'debug-screenshot.png' });
    
    // Get all status information from the page
    const statusInfo = await page.evaluate(() => {
      // This function runs in the browser context
      const statusData = {
        pageTitle: document.title,
        currentUrl: window.location.href,
        // Try to find status elements with various potential selectors
        statusElements: []
      };
      
      // Common status indicators - add all potential status elements
      const potentialStatusSelectors = [
        // Status indicators
        '.status-indicator', '.presence-status', '.status-badge',
        // Specific status classes
        '.status-available', '.status-busy', '.status-dnd', '.status-away',
        // Call indicators
        '.call-active', '.call-in-progress', '.incoming-call', '.ringing',
        // Specific 3CX elements (these will need to be refined)
        '.user-status', '.extension-status', '.phone-status'
      ];
      
      // Check each potential selector
      potentialStatusSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          Array.from(elements).forEach(el => {
            statusData.statusElements.push({
              selector: selector,
              text: el.textContent.trim(),
              classList: Array.from(el.classList),
              visible: el.offsetParent !== null
            });
          });
        }
      });
      
      // Look for any elements containing status keywords
      const statusKeywords = ['available', 'busy', 'dnd', 'away', 'offline', 'on call', 'ringing'];
      const allElements = document.querySelectorAll('*');
      const statusTexts = [];
      
      Array.from(allElements).forEach(el => {
        const text = el.textContent.trim().toLowerCase();
        if (text && statusKeywords.some(keyword => text.includes(keyword))) {
          statusTexts.push({
            element: el.tagName,
            text: text,
            classes: Array.from(el.classList)
          });
        }
      });
      
      statusData.statusTextElements = statusTexts.slice(0, 10); // Limit to first 10 matches
      
      return statusData;
    });
    
    console.log('3CX Status Information:');
    console.log(JSON.stringify(statusInfo, null, 2));
    
    // Analyze the status information
    let detectedStatus = 'unknown';
    
    // Check page title for status indicators
    const pageTitle = statusInfo.pageTitle?.toLowerCase() || '';
    if (pageTitle.includes('on call') || pageTitle.includes('in call')) {
      detectedStatus = 'onCall';
    } else if (pageTitle.includes('ringing')) {
      detectedStatus = 'ringing';
    }
    
    // Check status elements
    const statusElements = statusInfo.statusElements || [];
    for (const element of statusElements) {
      const text = element.text.toLowerCase();
      const classes = element.classList.join(' ').toLowerCase();
      
      if (text.includes('on call') || text.includes('busy') || classes.includes('busy') || classes.includes('oncall')) {
        detectedStatus = 'onCall';
        break;
      } else if (text.includes('ringing') || classes.includes('ringing')) {
        detectedStatus = 'ringing';
        break;
      } else if (text.includes('dnd') || classes.includes('dnd')) {
        detectedStatus = 'dnd';
        break;
      } else if (text.includes('away') || classes.includes('away')) {
        detectedStatus = 'away';
        break;
      } else if (text.includes('available') || classes.includes('available')) {
        detectedStatus = 'available';
      }
    }
    
    // Check status text elements
    const statusTextElements = statusInfo.statusTextElements || [];
    for (const element of statusTextElements) {
      const text = element.text.toLowerCase();
      
      if (text.includes('on call') || text.includes('busy')) {
        detectedStatus = 'onCall';
        break;
      } else if (text.includes('ringing')) {
        detectedStatus = 'ringing';
        break;
      } else if (text.includes('dnd') || text.includes('do not disturb')) {
        detectedStatus = 'dnd';
        break;
      } else if (text.includes('away')) {
        detectedStatus = 'away';
        break;
      } else if (text.includes('available') && detectedStatus === 'unknown') {
        detectedStatus = 'available';
      }
    }
    
    // If we couldn't detect a specific status, default to available
    if (detectedStatus === 'unknown') {
      detectedStatus = 'available';
    }
    
    console.log(`Detected status: ${detectedStatus}`);
    return detectedStatus;
  } catch (error) {
    console.error('Error checking call status:', error);
    return 'offline';
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
 * Start monitoring 3CX status
 */
async function startMonitoring() {
  console.log('Starting 3CX status monitoring...');
  
  // Create a function to take status screenshots
  const fs = require('fs');
  const path = require('path');
  const screenshotsDir = path.join(process.cwd(), 'screenshots');
  
  let monitoringCount = 0;
  
  // Set interval to check status periodically
  setInterval(async () => {
    try {
      monitoringCount++;
      
      // Take a screenshot every 10 checks or when status changes
      const shouldTakeScreenshot = monitoringCount % 10 === 0;
      
      if (shouldTakeScreenshot) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await page.screenshot({ 
          path: path.join(screenshotsDir, `status-check-${timestamp}.png`),
          fullPage: true
        });
        console.log(`Periodic screenshot saved to screenshots/status-check-${timestamp}.png`);
        
        // Also dump the HTML structure for debugging
        const htmlContent = await page.content();
        fs.writeFileSync(path.join(screenshotsDir, `page-structure-${timestamp}.html`), htmlContent);
        console.log(`Page HTML saved to screenshots/page-structure-${timestamp}.html`);
      }
      
      const status = await checkCallStatus();
      if (status) {
        // If status changed, always take a screenshot
        if (status !== lastStatus) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          await page.screenshot({ 
            path: path.join(screenshotsDir, `status-change-to-${status}-${timestamp}.png`),
            fullPage: true
          });
          console.log(`Status change screenshot saved to screenshots/status-change-to-${status}-${timestamp}.png`);
        }
        
        await handleStatusChange(status);
      }
    } catch (error) {
      console.error('Error in monitoring cycle:', error);
    }
  }, config.threecx.refreshInterval);
}

/**
 * Main application function
 */
async function main() {
  console.log('Starting 3CX Browser Monitor for WLED Integration');
  
  // Validate configuration
  if (!config.wled.ipAddress) {
    console.error('Missing required configuration. Please check your .env file.');
    process.exit(1);
  }
  
  try {
    // Initialize browser and log in
    const initialized = await initBrowser();
    
    if (!initialized) {
      console.error('Failed to initialize browser. Exiting...');
      process.exit(1);
    }
    
    // Start monitoring
    await startMonitoring();
    
    // Set up error handling and graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      
      // Turn off WLED or set to default color on exit
      await updateWLED({r: 0, g: 0, b: 0});
      
      // Close browser
      if (browser) {
        await browser.close();
      }
      
      process.exit(0);
    });
  } catch (error) {
    console.error('Application error:', error);
    
    // Close browser on error
    if (browser) {
      await browser.close();
    }
    
    process.exit(1);
  }
}

// Run the application
if (require.main === module) {
  main().catch(error => {
    console.error('Application error:', error);
    
    // Close browser on error
    if (browser) {
      browser.close().catch(console.error);
    }
    
    process.exit(1);
  });
}

// Export functions for testing or external use
module.exports = {
  initBrowser,
  checkCallStatus,
  handleStatusChange,
  updateWLED
};
