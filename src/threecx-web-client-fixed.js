/**
 * 3CX Web Client Integration using Puppeteer
 *
 * This module handles interaction with the 3CX web client interface.
 * It uses Puppeteer to launch a browser, log in (handling initial manual login
 * and subsequent cookie-based sessions), navigate the UI, and scrape status
 * information and call statistics.
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const logger = require('pino')({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const mkdirAsync = promisify(fs.mkdir);

// Configuration from environment variables
const config = {
  threeCxUrl: process.env.THREECX_WEB_URL,
  refreshInterval: parseInt(
    process.env.THREECX_REFRESH_INTERVAL || '10000',
    10
  ),
  headless: process.env.THREECX_HEADLESS === 'true',
  // Screenshot control - default to disabled in production
  screenshots: {
    enabled: process.env.ENABLE_SCREENSHOTS === 'true' || false,
    // Limit how often screenshots can be taken (in milliseconds)
    minInterval: parseInt(process.env.SCREENSHOT_MIN_INTERVAL || '60000', 10), // Default: 1 minute
    // Limit total number of screenshots
    maxPerSession: parseInt(process.env.SCREENSHOT_MAX_PER_SESSION || '20', 10), // Default: 20 screenshots
  },
};

// Global variables
let browser = null;
let page = null;
let refreshIntervalId = null;
let statusCallback = null;
let observerActive = false;
let debounceTimer = null;
let lastStatusData = null;

// Screenshot tracking
let lastScreenshotTime = 0;
let screenshotCount = 0;

/**
 * Initializes the Puppeteer browser instance, logs into the 3CX web client,
 * navigates to the necessary page (switchboard), and starts the status refresh interval.
 * Handles initial manual login and subsequent automatic login using saved cookies.
 *
 * @async
 * @function initialize
 * @param {Function} callback - The function to call with status updates. It receives:
 *                              (error, { status, callStats, agentStatuses, debugInfo }).
 * @returns {Promise<boolean>} A promise that resolves to true if initialization was successful, false otherwise.
 */
async function initialize(callback) {
  try {
    statusCallback = callback;
    browser = null;

    // First, check if we have saved cookies
    let hasSavedCookies = false;
    try {
      const cookiesString = await readFileAsync(
        path.join(__dirname, '..', 'cookies.json'),
        'utf8'
      );
      logger.info(`Attempting to parse ${cookiesString.length} bytes from cookies.json`);
      const cookies = JSON.parse(cookiesString);
      logger.info(`Successfully parsed ${cookies.length} cookies from file.`);
      if (cookies && cookies.length > 0) {
        hasSavedCookies = true;
        logger.info('Found saved cookies, will try to use them');
      }
    } catch (cookieError) {
      logger.error('Error loading/setting cookies:', cookieError.message);
      if (cookieError instanceof SyntaxError) {
        logger.error('cookies.json appears to be corrupted or not valid JSON.');
      }
      // Optionally, delete the corrupted file?
      // fs.unlinkSync(path.join(__dirname, '..', 'cookies.json'));
    }

    // Initial launch options - start with user's preference
    const initialLaunchOptions = {
      headless: hasSavedCookies ? config.headless : false, // Force non-headless if no cookies
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };

    logger.info('Initializing 3CX web client...');
    logger.info(
      'Initial browser launch options:',
      JSON.stringify(initialLaunchOptions)
    );

    // Launch browser
    const headlessMode = initialLaunchOptions.headless;
    logger.info(
      headlessMode
        ? 'Launching GLOBAL browser in headless mode'
        : 'Launching GLOBAL browser in visible mode'
    );
    browser = await puppeteer.launch(initialLaunchOptions);

    // Create a new page
    page = await browser.newPage();

    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Try to load saved cookies if we have them
    if (hasSavedCookies) {
      logger.info('Loading saved cookies...');
      try {
        const cookiesString = await readFileAsync(
          path.join(__dirname, '..', 'cookies.json'),
          'utf8'
        );
        logger.info(`Attempting to parse ${cookiesString.length} bytes from cookies.json`);
        const cookies = JSON.parse(cookiesString);
        logger.info(`Successfully parsed ${cookies.length} cookies from file.`);
        
        // Check for expired cookies
        const now = Date.now() / 1000; // Current time in seconds
        const validCookies = cookies.filter(cookie => !cookie.expires || cookie.expires > now);
        
        if (validCookies.length < cookies.length) {
          logger.warn(`Filtered out ${cookies.length - validCookies.length} expired cookies`);
        }
        
        if (validCookies.length > 0) {
          await page.setCookie(...validCookies);
          logger.info(`${validCookies.length} cookies loaded successfully`);
        } else {
          logger.warn('No valid cookies found - all cookies may have expired');
          hasSavedCookies = false;
        }
      } catch (cookieError) {
        logger.error('Error loading/setting cookies:', cookieError.message);
        if (cookieError instanceof SyntaxError) {
          logger.error('cookies.json appears to be corrupted or not valid JSON.');
          
          // Backup the corrupted file and create a new one
          try {
            const cookiePath = path.join(__dirname, '..', 'cookies.json');
            const backupPath = path.join(__dirname, '..', `cookies.corrupted.${Date.now()}.json`);
            fs.renameSync(cookiePath, backupPath);
            logger.info(`Backed up corrupted cookies file to ${backupPath}`);
          } catch (backupError) {
            logger.error('Error backing up corrupted cookies file:', backupError.message);
          }
        }
        hasSavedCookies = false;
      }
    }

    // Navigate to 3CX web interface with more robust options
    logger.info(`Navigating to ${config.threeCxUrl}`);
    await page.goto(config.threeCxUrl, { 
      waitUntil: ['networkidle2', 'domcontentloaded'],
      timeout: 60000 // Increase timeout to 60 seconds for slower connections
    });

    // Check if login is required
    const loginRequired = await checkIfLoginRequired();

    // If login is required but we're in headless mode, restart in non-headless mode
    if (loginRequired && headlessMode) {
      logger.warn(`
===========================================================
LOGIN REQUIRED BUT BROWSER IS HEADLESS
Restarting browser in visible mode for manual login
===========================================================`);

      // Close the headless browser
      await browser.close();

      // Launch a new visible browser
      const visibleLaunchOptions = {
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      };

      logger.info('Launching browser in visible mode for login');
      browser = await puppeteer.launch(visibleLaunchOptions);

      // Create a new page
      page = await browser.newPage();

      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });

      // Navigate to 3CX web interface again
      logger.info(`Navigating to ${config.threeCxUrl} in visible browser`);
      await page.goto(config.threeCxUrl, { waitUntil: 'networkidle2' });
    }

    if (loginRequired) {
      logger.warn(`
===========================================================
LOGIN REQUIRED: Please log in manually in the browser window
The browser window should be open now. Please complete the login process.
The application will wait until you finish logging in.
===========================================================`);

      // Wait for login to complete
      await waitForLogin();

      // Save cookies for future use
      const cookies = await page.cookies();
      logger.info(`Attempting to save ${cookies.length} cookies.`);
      const cookiePath = path.join(__dirname, '..', 'cookies.json');
      
      // Make sure we have meaningful cookies before saving
      if (cookies && cookies.length > 0) {
        // Filter out cookies that might be about to expire
        const validCookies = cookies.filter(cookie => {
          // If cookie has no expiration or expires in more than a day, keep it
          if (!cookie.expires) return true;
          const expiryDate = new Date(cookie.expires * 1000); // Convert to milliseconds
          const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
          return expiryDate > oneDayFromNow;
        });
        
        if (validCookies.length > 0) {
          await writeFileAsync(cookiePath, JSON.stringify(validCookies, null, 2));
          logger.info(`${validCookies.length} cookies saved successfully to ${cookiePath}`);
        } else {
          logger.warn('No valid non-expiring cookies found to save');
        }
      } else {
        logger.warn('No cookies available to save');
      }
    }

    // Navigate to switchboard
    const switchboardSuccess = await navigateToSwitchboard();
    if (!switchboardSuccess) {
      logger.warn('Failed to navigate to switchboard');
    }

    // Start refresh interval
    startRefreshInterval();

    return true;
  } catch (error) {
    logger.error('Error initializing 3CX web client:', error);
    return false;
  }
}

/**
 * Checks if the 3CX login page is currently displayed or if logged-in elements are missing.
 * This helps determine if a manual login is required.
 *
 * @async
 * @function checkIfLoginRequired
 * @returns {Promise<boolean>} A promise that resolves to true if login is required, false otherwise.
 */
async function checkIfLoginRequired() {
  try {
    // Take a screenshot for login check - this is important for debugging
    try {
      await takeScreenshot('login-check', true);
    } catch (screenshotError) {
      logger.warn(
        'Could not take login check screenshot:',
        screenshotError.message
      );
    }
    
    // Wait a bit for the page to fully load and stabilize
    await page.waitForTimeout(2000);

    // Check if login form exists
    const loginFormExists = await page.evaluate(() => {
      return !!document.querySelector(
        'form[action*="login"], .login-form, #loginForm, input[name="username"], input[name="password"], .login-container, .auth-container'
      );
    });

    // Check if elements that indicate we're logged in exist
    const loggedInElementsExist = await page.evaluate(() => {
      return !!document.querySelector(
        '.user-menu, .user-profile, .logout-button, .user-info, .switchboard-container, .main-content, .dashboard-container, .navbar-brand'
      );
    });
    
    // Check for specific 3CX elements
    const threeCxElementsExist = await page.evaluate(() => {
      return !!document.querySelector(
        'app-root, app-dashboard, app-switchboard, .threecx-logo, .threecx-container'
      );
    });

    logger.debug(
      `Login form exists: ${loginFormExists}, Logged in elements exist: ${loggedInElementsExist}, 3CX elements exist: ${threeCxElementsExist}`
    );
    
    // If we see 3CX elements but no login form, we're probably logged in
    const isLoggedIn = threeCxElementsExist && !loginFormExists;
    logger.info(`Login required: ${!isLoggedIn}, Login form: ${loginFormExists}, Logged in elements: ${loggedInElementsExist}`);

    return !isLoggedIn;
  } catch (error) {
    logger.error(`Error checking if login is required: ${error.message}`);
    return true; // Assume login is required on error
  }
}

/**
 * Waits for the user to manually complete the login process in the visible browser window.
 * Monitors the page state for indicators of successful login (e.g., presence of dashboard elements).
 * Saves cookies upon successful login.
 *
 * @async
 * @function waitForLogin
 * @returns {Promise<boolean>} A promise that resolves to true if login is detected successfully within the timeout, false otherwise.
 */
async function waitForLogin() {
  try {
    logger.info('Waiting for login...');

    // Maximum wait time: 10 minutes
    const maxWaitTime = 10 * 60 * 1000;
    const startTime = Date.now();
    let loginSuccessful = false;

    // Check login status every 5 seconds and provide feedback
    while (Date.now() - startTime < maxWaitTime && !loginSuccessful) {
      try {
        const pageInfo = await page.evaluate(() => {
          // Collect all available information about the page
          const info = {
            url: window.location.href,
            title: document.title,
            path: window.location.pathname,
            hash: window.location.hash,
            bodyClasses: document.body ? document.body.className : 'no-body',
            elements: {},
            is3CXUrl: window.location.href.includes('3cx'),
          };

          // Check for login form elements ONLY if on the 3CX page
          info.elements.loginForm = info.is3CXUrl && !!document.querySelector(
            'form[action*="login"], .login-form, #loginForm, input[name="username"], input[name="password"]'
          );

          // Check for 3CX specific elements that indicate we're logged in
          info.elements.userMenu = !!document.querySelector(
            '.user-menu, .user-profile, .logout-button, .user-info'
          );
          info.elements.switchboard = !!document.querySelector(
            '.switchboard-container, queue-stat, .queue-stats, .queue-container'
          );
          info.elements.presenceIndicator = !!document.querySelector(
            '.presence-indicator, .status-indicator'
          );
          info.elements.angularApp = !!document.querySelector(
            '[ng-version]' // Use the corrected selector
          );

          // Check for 3CX specific URLs
          info.is3CXUrl =
            window.location.href.includes('my3cx') ||
            window.location.href.includes('3cx');
          info.isSwitchboardUrl =
            window.location.hash.includes('switchboard') ||
            window.location.hash.includes('dashboard');

          // Collect cookies for debugging (just names, not values for security)
          info.cookieNames = document.cookie
            .split(';')
            .map((c) => c.trim().split('=')[0]);

          // Check for session storage keys
          info.sessionStorageKeys = Object.keys(window.sessionStorage || {});

          // Check for local storage keys
          info.localStorageKeys = Object.keys(window.localStorage || {});

          // Look for authentication tokens in storage
          info.hasAuthToken = info.localStorageKeys.some(
            (key) =>
              key.toLowerCase().includes('token') ||
              key.toLowerCase().includes('auth') ||
              key.toLowerCase().includes('session')
          );

          // Check for angular specific elements (Original problematic selector removed)
          // const angularElements = document.querySelectorAll('[ng-*], [data-ng-*]');
          // info.angularElementCount = angularElements.length;

          // Check if we're on the switchboard specifically
          info.queueStatElement = !!document.querySelector('queue-stat');
          info.queueStatContent = document.querySelector('queue-stat')
            ? document.querySelector('queue-stat').textContent.substring(0, 100)
            : 'not-found';

          return info;
        });

        // Log detailed page information
        logger.debug('\n--- DETAILED PAGE ANALYSIS ---');
        logger.debug(JSON.stringify(pageInfo, null, 2));
        logger.debug('--- END PAGE ANALYSIS ---\n');

        // Determine login status based on collected information
        const loginFormVisibleOn3CX = pageInfo.elements.loginForm; // Renamed for clarity
        const is3CXLoggedIn =
          pageInfo.is3CXUrl &&
          !loginFormVisibleOn3CX && // Use renamed variable
          (pageInfo.elements.userMenu ||
            pageInfo.elements.switchboard ||
            pageInfo.elements.presenceIndicator ||
            pageInfo.hasAuthToken);

        const isSwitchboard =
          pageInfo.isSwitchboardUrl ||
          pageInfo.elements.switchboard ||
          pageInfo.queueStatElement;

        // Log current status
        logger.debug(
          `Login check: On 3CX URL: ${pageInfo.is3CXUrl}, Form visible (on 3CX): ${loginFormVisibleOn3CX}, Logged in elements found: ${is3CXLoggedIn}, On switchboard: ${isSwitchboard}`
        );
        logger.info(`URL: ${pageInfo.url}, Title: ${pageInfo.title}`);

        // Determine if login is successful
        if (is3CXLoggedIn) {
          logger.info(
            '\n==========================================================='
          );
          logger.info('LOGIN SUCCESSFUL!');
          logger.info(
            'You have successfully logged in to the 3CX web interface.'
          );
          logger.info('Your session has been saved for future use.');
          if (isSwitchboard) {
            logger.info('You are on the switchboard page - perfect!');
          } else {
            logger.info('Will navigate to switchboard next...');
          }
          logger.info(
            '===========================================================\n'
          );

          // Save cookies for future use
          const cookies = await page.cookies();
          logger.info(`Attempting to save ${cookies.length} cookies.`);
          const cookiePath = path.join(__dirname, '..', 'cookies.json');
          await writeFileAsync(cookiePath, JSON.stringify(cookies, null, 2));
          logger.info(`Cookies saved successfully to ${cookiePath}`);

          // Save local storage for debugging
          const localStorageData = await page.evaluate(() => {
            const data = {};
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              data[key] = localStorage.getItem(key);
            }
            return data;
          });

          try {
            await writeFileAsync(
              path.join(__dirname, '..', 'debug-localStorage.json'),
              JSON.stringify(localStorageData, null, 2)
            );
            logger.info('Saved local storage data for debugging');
          } catch (storageError) {
            logger.error(
              'Error saving local storage data:',
              storageError.message
            );
          }

          loginSuccessful = true;
          break;
        } else if (!loginFormVisibleOn3CX && pageInfo.is3CXUrl) { // Already on 3CX site, but login elements not yet present
          logger.info(
            'On 3CX site but not fully logged in yet. Waiting for session to initialize...'
          );
        } else if (loginFormVisibleOn3CX) { // On 3CX site but login form is showing
          logger.info('Still on login page. Please complete the login form.');
        } else if (!pageInfo.is3CXUrl) {
          logger.info(
            'Currently on external page (likely SSO provider). Waiting for redirect back to 3CX...'
          );
        }
      } catch (error) {
        logger.error(`Error during waitForLogin evaluation: ${error.message}`); // Log specific error
        // Keep waiting, maybe the page is transitioning
      }

      // Prevent tight loop on error
      if (!loginSuccessful) {
        // Wait 5 seconds before checking again
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    if (!loginSuccessful) {
      logger.error(
        '\n==========================================================='
      );
      logger.error('LOGIN TIMEOUT');
      logger.error('The login process timed out after 10 minutes.');
      logger.error('Please restart the application and try again.');
      logger.error(
        '===========================================================\n'
      );
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error waiting for login:', error);
    return false;
  }
}

/**
 * Attempts to navigate to the 3CX switchboard/dashboard page.
 * Tries various methods like checking current state, clicking links/icons, or direct URL navigation.
 *
 * @async
 * @function navigateToSwitchboard
 * @returns {Promise<boolean>} A promise that resolves to true if navigation to the switchboard was successful or deemed unnecessary (already there), false if it failed after multiple attempts.
 */
async function navigateToSwitchboard() {
  try {
    if (!browser || !page || page.isClosed()) {
      logger.warn(
        'Browser or page not available for navigation to switchboard'
      );
      return false;
    }

    // Take a screenshot before navigation attempt
    await takeScreenshot('pre-navigation');

    // Check if already on switchboard page by looking for queue-stat element
    const alreadyOnSwitchboard = await page.evaluate(async () => {
      // Wait a brief moment for the page to potentially settle
      await new Promise(resolve => setTimeout(resolve, 500));

      // Explicitly wait for the queue-stat element to appear (within the browser context)
      const waitForElement = async (selector, timeout = 5000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          if (document.querySelector(selector)) return true;
          await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
        }
        return false;
      };

      const queueStatVisible = await waitForElement('queue-stat');

      // Look for queue-stat element which is specific to the switchboard
      // const queueStatElement = document.querySelector('queue-stat'); // Already checked with waitForElement
      if (queueStatVisible) {
        // Use console.log inside evaluate as logger isn't available here
        console.log('Found queue-stat element - already on switchboard page (evaluate)');
        return true;
      }

      // Check URL and title
      const currentUrl = window.location.href;
      const currentTitle = document.title;

      const urlOrTitleMatch = (
        currentUrl.includes('switchboard') ||
        currentUrl.includes('dashboard') ||
        currentTitle.includes('Switchboard') ||
        currentTitle.includes('Dashboard')
      );
      if (urlOrTitleMatch) {
        console.log('URL or Title matches switchboard/dashboard (evaluate)');
      }

      return urlOrTitleMatch; // Return based on URL/Title if queue-stat wasn't found
    });

    if (alreadyOnSwitchboard) {
      logger.info('Already on switchboard/dashboard page');
      return true;
    }

    logger.info('Attempting to navigate to switchboard...');

    // Try to find and click the switchboard link using Angular component selectors
    const switchboardLinkFound = await page.evaluate(() => {
      // First look for Angular components that might be switchboard links
      const angularComponents = [
        'switchboard-link',
        'dashboard-link',
        'nav-item[routerlink*="switchboard"]',
        'nav-item[routerlink*="dashboard"]',
        '[routerlink*="switchboard"]',
        '[routerlink*="dashboard"]',
      ];

      for (const selector of angularComponents) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          logger.info(`Found Angular component: ${selector}`);
          elements[0].click();
          return { clicked: true, element: selector };
        }
      }

      // Look for standard switchboard links
      const switchboardLinks = [
        ...document.querySelectorAll('a[href*="switchboard"]'),
        ...document.querySelectorAll('a[href*="dashboard"]'),
        ...document.querySelectorAll('a[title*="Switchboard"]'),
        ...document.querySelectorAll('a[title*="Dashboard"]'),
        ...document.querySelectorAll('button[title*="Switchboard"]'),
        ...document.querySelectorAll('button[title*="Dashboard"]'),
      ];

      if (switchboardLinks.length > 0) {
        logger.info('Found switchboard/dashboard link');
        switchboardLinks[0].click();
        return { clicked: true, element: 'standard-link' };
      }

      // Look for menu items with switchboard text
      const menuItems = [
        ...document.querySelectorAll('.menu-item'),
        ...document.querySelectorAll('.nav-item'),
        ...document.querySelectorAll('.sidebar-item'),
        ...document.querySelectorAll('li'), // Check all list items
        ...document.querySelectorAll('button'), // Check all buttons
        ...document.querySelectorAll('a'), // Check all links
      ];

      for (const item of menuItems) {
        const text = item.textContent.toLowerCase();
        if (text.includes('switchboard') || text.includes('dashboard')) {
          logger.info('Found menu item with switchboard/dashboard text');
          item.click();
          return { clicked: true, element: 'menu-item' };
        }
      }

      return { clicked: false };
    });

    if (switchboardLinkFound.clicked) {
      logger.info(`Clicked ${switchboardLinkFound.element}`);
      // Wait for navigation to complete
      await page.waitForNavigation({ timeout: 10000 }).catch(() => {
        logger.info('Navigation timeout, but continuing...');
      });

      // Take a screenshot after clicking - this is important for debugging navigation
      await takeScreenshot('post-click-navigation', true);

      // Verify we're on the switchboard page
      const verifyResult = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          hasQueueStat: !!document.querySelector('queue-stat'),
        };
      });

      logger.info('Navigation verification:', verifyResult);

      if (verifyResult.hasQueueStat) {
        logger.info('Successfully navigated to switchboard (found queue-stat)');
        return true;
      }

      if (
        verifyResult.url.includes('switchboard') ||
        verifyResult.url.includes('dashboard')
      ) {
        logger.info('Successfully navigated to switchboard (URL match)');
        return true;
      }
    }

    return true; // Continue even if we couldn't find the switchboard
  } catch (error) {
    logger.error('Error navigating to switchboard:', error.message);
    return false;
  }
}

/**
 * Scrapes the 3CX web UI to determine the current user status (e.g., Available, On Call).
 * Relies on specific CSS selectors and element content which might change with 3CX updates.
 *
 * @async
 * @function getStatus
 * @returns {Promise<object|null>} A promise that resolves to an object containing the detected status
 *                                 (e.g., { status: 'available', source: 'some element text' }) or null if an error occurred or the page wasn't ready.
 */
async function getStatus() {
  try {
    if (!browser || !page) {
      logger.warn('Browser or page not initialized, returning default status');
      return { status: 'available', source: 'default' };
    }

    // Only take status detection screenshots occasionally
    await takeScreenshot('status-detection', false);

    // Default status
    let status = 'available';
    let statusSource = 'default';

    try {
      // Enhanced status detection with multiple methods and detailed debugging
      const statusResult = await page.evaluate(() => {
        // Debug information to collect
        const debugInfo = {
          title: document.title,
          url: window.location.href,
          bodyClasses: document.body.className,
          possibleStatusElements: [],
          methodsAttempted: [],
        };

        // Status mapping for normalization
        const statusMap = {
          // Available statuses
          available: 'available',
          online: 'available',
          ready: 'available',
          free: 'available',
          active: 'available',

          // Away statuses
          away: 'away',
          idle: 'away',
          break: 'away',
          lunch: 'away',
          brb: 'away',
          'be right back': 'away',

          // DND statuses
          dnd: 'dnd',
          busy: 'dnd',
          'do not disturb': 'dnd',
          meeting: 'dnd',
          'in a meeting': 'dnd',
          'on break': 'dnd',

          // Offline statuses
          offline: 'offline',
          unavailable: 'offline',
          'logged out': 'offline',
          disconnected: 'offline',

          // On-call statuses
          'on-call': 'on-call',
          'in-call': 'on-call',
          talking: 'on-call',
          'on call': 'on-call',
          'in call': 'on-call',
          'on the phone': 'on-call',
          'on a call': 'on-call',
        };

        // Function to normalize status text
        const normalizeStatus = (rawStatus) => {
          if (!rawStatus) return null;

          const lowerStatus = rawStatus.toLowerCase().trim();

          // Direct match
          if (statusMap[lowerStatus]) {
            return statusMap[lowerStatus];
          }

          // Partial match
          for (const [key, value] of Object.entries(statusMap)) {
            if (lowerStatus.includes(key)) {
              return value;
            }
          }

          return null;
        };

        // Method 1: Try to get status from specific status indicator elements
        debugInfo.methodsAttempted.push('status-indicators');
        const statusSelectors = [
          // Common status indicators
          '.status-indicator',
          '.user-status',
          '.status-icon',
          '[data-status]',
          // 3CX specific selectors
          '.presence-status',
          '.agent-status',
          '.user-presence',
          '.status-display',
          // General status classes
          '.status',
          '.presence',
          '.availability',
          '.user-availability',
          // Status with specific states
          '.status-available',
          '.status-away',
          '.status-busy',
          '.status-offline',
          '.status-dnd',
          // Any element with status in the class name
          '[class*="status"]',
          '[class*="presence"]',
          '[id*="status"]',
          '[id*="presence"]',
          // Data attributes
          '[data-presence]',
          '[data-availability]',
          '[data-user-status]',
        ];

        for (const selector of statusSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              for (const element of elements) {
                // Get element details for debugging
                const elementInfo = {
                  selector: selector,
                  text: element.textContent.trim(),
                  classList: Array.from(element.classList),
                  attributes: {},
                };

                // Get all attributes
                for (const attr of element.attributes) {
                  elementInfo.attributes[attr.name] = attr.value;
                }

                // Add to debug info
                debugInfo.possibleStatusElements.push(elementInfo);

                // Check class names for status
                const classList = Array.from(element.classList);
                for (const className of classList) {
                  const normalizedStatus = normalizeStatus(className);
                  if (normalizedStatus) {
                    return {
                      status: normalizedStatus,
                      source: `indicator-class:${selector}`,
                      element: elementInfo,
                      debugInfo,
                    };
                  }
                }

                // Check data attributes
                const dataAttributes = [
                  'data-status',
                  'data-presence',
                  'data-availability',
                  'data-user-status',
                ];
                for (const attr of dataAttributes) {
                  const attrValue = element.getAttribute(attr);
                  if (attrValue) {
                    const normalizedStatus = normalizeStatus(attrValue);
                    if (normalizedStatus) {
                      return {
                        status: normalizedStatus,
                        source: `indicator-attr:${attr}`,
                        element: elementInfo,
                        debugInfo,
                      };
                    }
                  }
                }

                // Check text content
                const textContent = element.textContent.trim();
                if (textContent) {
                  const normalizedStatus = normalizeStatus(textContent);
                  if (normalizedStatus) {
                    return {
                      status: normalizedStatus,
                      source: `indicator-text:${selector}`,
                      element: elementInfo,
                      debugInfo,
                    };
                  }
                }
              }
            }
          } catch (_error) {
            // Ignore errors for individual selectors
          }
        }

        // If all methods failed, return debug info
        return {
          status: null,
          source: 'none',
          debugInfo,
        };
      });

      // Log detailed debug info
      logger.debug(
        'Status detection debug info:',
        JSON.stringify(statusResult.debugInfo || {}, null, 2)
      );

      // If status was found, use it
      if (statusResult.status) {
        status = statusResult.status;
        statusSource = statusResult.source;
        logger.info(`Status detected: ${status} (source: ${statusSource})`);
        return { status, source: statusSource, debug: statusResult.debugInfo };
      }

      // If all methods failed, return default status
      logger.info(`Status: Using default status (${status})`);
      return { status, source: statusSource, debug: statusResult.debugInfo };
    } catch (statusError) {
      logger.error('Error detecting status:', statusError);
      return { status, source: 'error', error: statusError.message };
    }
  } catch (error) {
    logger.error('Error getting status:', error);
    return { status: 'available', source: 'error', error: error.message };
  }
}

/**
 * Scrapes the 3CX web UI (specifically looking for switchboard elements like 'queue-stat')
 * to fetch call statistics like waiting calls, active calls, etc.
 * Relies on specific CSS selectors which might change with 3CX updates.
 *
 * @async
 * @function fetchCallStats
 * @returns {Promise<object|null>} A promise that resolves to an object containing call statistics
 *                                 (e.g., { waitingCalls: 0, activeCalls: 1, ... }) or null if an error occurred or the page wasn't ready.
 */
async function fetchCallStats() {
  try {
    if (!browser || !page || page.isClosed()) {
      logger.warn(
        'Browser or page not initialized, returning default call stats'
      );
      return {
        waitingCalls: 0,
        activeCalls: 0,
        totalCalls: 0,
        servicedCalls: 0,
        abandonedCalls: 0,
        lastUpdated: new Date().toISOString(),
        source: 'default',
      };
    }

    // Take a screenshot to help diagnose call stats extraction
    await takeScreenshot('call-stats-detection');

    // Default call statistics
    const defaultStats = {
      waitingCalls: 0,
      activeCalls: 0,
      totalCalls: 0,
      servicedCalls: 0,
      abandonedCalls: 0,
      lastUpdated: new Date().toISOString(),
      source: 'web',
    };

    // Try multiple methods to extract call statistics
    try {
      // Method 1: Specifically target the queue-stat element structure from 3CX switchboard
      const statsResult = await page.evaluate(() => {
        const stats = {
          waitingCalls: 0,
          activeCalls: 0,
          totalCalls: 0,
          servicedCalls: 0,
          abandonedCalls: 0,
        };

        let foundStats = false;

        // Look specifically for the queue-stat element
        try {
          const queueStatElement = document.querySelector('queue-stat');
          if (queueStatElement) {
            console.log('Found queue-stat element!');

            // Look for the table rows within the queue-stat element
            const headerRow = queueStatElement.querySelector('.qst-l-td');
            const dataRow = queueStatElement.querySelector('.qst-d-td');

            if (headerRow && dataRow) {
              // Get all header cells and data cells
              const headers = headerRow.querySelectorAll('td');
              const data = dataRow.querySelectorAll('td');

              // Create a mapping of header text to data value
              const statsMap = {};
              for (let i = 0; i < headers.length && i < data.length; i++) {
                const headerText = headers[i].textContent.trim().toLowerCase();
                const dataValue = data[i].textContent.trim();
                statsMap[headerText] = dataValue;
              }

              // Extract specific stats we're interested in
              if (statsMap['waiting calls'] !== undefined) {
                stats.waitingCalls =
                  parseInt(statsMap['waiting calls'], 10) || 0;
                foundStats = true;
              }

              if (statsMap['serviced calls'] !== undefined) {
                stats.servicedCalls =
                  parseInt(statsMap['serviced calls'], 10) || 0;
                foundStats = true;
              }

              if (statsMap['abandoned calls'] !== undefined) {
                stats.abandonedCalls =
                  parseInt(statsMap['abandoned calls'], 10) || 0;
                foundStats = true;
              }

              // Calculate total calls
              if (foundStats) {
                stats.totalCalls =
                  stats.servicedCalls +
                  stats.abandonedCalls +
                  stats.waitingCalls;

                // Add additional stats if available
                if (statsMap['longest waiting'] !== undefined) {
                  stats.longestWaiting = statsMap['longest waiting'];
                }

                if (statsMap['average waiting'] !== undefined) {
                  stats.averageWaiting = statsMap['average waiting'];
                }

                if (statsMap['average talking'] !== undefined) {
                  stats.averageTalking = statsMap['average talking'];
                }

                return {
                  stats: stats,
                  source: 'queue-stat-element',
                  foundStats: true,
                  statsMap: statsMap,
                };
              }
            }
          }
        } catch (_error) {
          console.error('Error extracting from queue-stat element:', _error);
        }

        return {
          stats: foundStats ? stats : null,
          source: foundStats ? 'general-detection' : 'none',
          foundStats: foundStats,
          debug: {
            title: document.title,
            url: window.location.href,
          },
        };
      });

      // Log debug info
      logger.debug(
        'Call stats detection result:',
        JSON.stringify(statsResult, null, 2)
      );

      // Update stats if found
      if (statsResult && statsResult.stats && statsResult.foundStats) {
        logger.info('Call statistics found:', statsResult.stats);
        return {
          ...statsResult.stats,
          lastUpdated: new Date().toISOString(),
          source: statsResult.source || 'web-enhanced',
        };
      }

      // If all methods failed, return default stats
      logger.info('Call statistics: Using default values (no stats detected)');
      return defaultStats;
    } catch (statsError) {
      logger.error(`Error extracting call statistics: ${statsError.message}`);
      logger.error(`Stack trace: ${statsError.stack}`);
      // Optionally take a screenshot when an error occurs
      await takeScreenshot('call-stats-error');
      return null; // Indicate failure
    }
  } catch (error) {
    logger.error('Error getting call statistics:', error);
    return {
      waitingCalls: 0,
      activeCalls: 0,
      totalCalls: 0,
      servicedCalls: 0,
      abandonedCalls: 0,
      lastUpdated: new Date().toISOString(),
      source: 'error',
      error: error.message,
    };
  }
}

/**
 * Scrapes the 3CX web UI (switchboard) to get the status of all listed agents.
 * Relies on specific CSS selectors within the `<app-all-queue-agents>` component.
 *
 * @async
 * @function fetchAllAgentStatuses
 * @returns {Promise<Array<object>|null>} A promise that resolves to an array of agent objects
 *                                        (e.g., [{ extension: '534', name: 'Brett Healy', status: 'available' }, ...])
 *                                        or null if an error occurred or the container wasn't found.
 */
async function fetchAllAgentStatuses() {
  if (!browser || !page || page.isClosed()) {
    logger.warn('Browser or page not available for fetching agent statuses');
    return null;
  }

  try {
    await takeScreenshot('all-agents-status-detection');
    const agentStatuses = await page.evaluate(() => {
      const agents = [];
      const agentContainer = document.querySelector('app-all-queue-agents');
      if (!agentContainer) {
        console.warn('Agent container <app-all-queue-agents> not found.');
        return null; // Indicate container not found
      }

      const agentItems = agentContainer.querySelectorAll('div[data-qa="agent-item"]');
      if (agentItems.length === 0) {
        console.warn('No agent items found within the container.');
        return []; // Return empty array if no agents listed
      }

      agentItems.forEach((item) => {
        const numberEl = item.querySelector('div[data-qa="number"]');
        const nameEl = item.querySelector('div[data-qa="name"]');
        const queuesEl = item.querySelector('div[data-qa="queues"]');
        
        // Look for status indicator in different formats
        let statusIndicator = null;
        if (numberEl) {
          // Try both formats: <span class="status-indicator available"> and <span class="available status-indicator">
          statusIndicator = numberEl.querySelector('span.status-indicator') || 
                           numberEl.querySelector('span[class*="status-indicator"]');
        }

        if (numberEl && nameEl) {
          const extensionText = numberEl.textContent.trim();
          // Extract only the number part (remove status text if present)
          const extensionMatch = extensionText.match(/\d+/);
          const extension = extensionMatch ? extensionMatch[0] : null;

          const name = nameEl.getAttribute('title') || nameEl.textContent.trim();
          
          // Get queues information
          const queues = queuesEl ? queuesEl.textContent.trim() : '';

          // Determine status from class name
          let status = 'offline'; // Default
          
          if (statusIndicator) {
            const statusClasses = statusIndicator.className.split(' ');
            const knownStatuses = ['available', 'away', 'dnd', 'lunch', 'business-trip', 'oncall', 'on-call', 'onCall', 'ringing', 'off'];
            
            for (const className of statusClasses) {
              const matchedStatus = knownStatuses.find(s => className.toLowerCase() === s.toLowerCase());
              if (matchedStatus) {
                // Map status names for consistency
                if (matchedStatus === 'off') status = 'offline';
                else if (matchedStatus === 'on-call' || matchedStatus === 'oncall') status = 'onCall';
                else status = matchedStatus;
                break;
              }
            }
          }

          if (extension && name) {
            agents.push({ 
              id: extension, // Use extension as ID
              extension, 
              name, 
              status,
              queues,
              // Add color mapping for UI
              color: status === 'available' ? 'green' :
                     status === 'onCall' ? 'red' :
                     status === 'ringing' ? 'yellow' :
                     status === 'dnd' ? 'purple' :
                     status === 'away' ? 'orange' :
                     'gray' // Default for offline/unknown
            });
          }
        } else {
          console.warn('Could not find all required elements (number, name) for an agent item.');
        }
      });

      console.log(`Extracted ${agents.length} agent statuses.`);
      return agents;
    });

    if (agentStatuses === null) {
        logger.warn('Could not find agent container to extract statuses.');
        return null;
    }

    logger.info(`Fetched ${agentStatuses.length} agent statuses.`);
    return agentStatuses;

  } catch (error) {
    logger.error(`Error fetching all agent statuses: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    await takeScreenshot('all-agents-status-error');
    return null;
  }
}

/**
 * Closes the Puppeteer browser instance and cleans up related variables.
 * Stops the refresh interval if it's running.
 *
 * @async
 * @function close
 * @returns {Promise<void>} A promise that resolves when the browser is closed.
 */
async function close() {
  try {
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }

    if (browser) {
      logger.info('Closing browser...');
      await browser.close();
      logger.info('Browser closed successfully');
      browser = null;
      page = null;
    }
  } catch (error) {
    logger.error('Error closing browser:', error);
  }
}

/**
 * Resets the 3CX authentication by closing the browser, deleting the saved cookies file (`cookies.json`),
 * and re-initializing the client (which will likely trigger a manual login prompt).
 *
 * @async
 * @function resetAuthentication
 * @returns {Promise<boolean>} A promise that resolves to the success status of the re-initialization attempt.
 */
async function resetAuthentication() {
  try {
    logger.info('Resetting 3CX authentication...');

    // Close the browser if it's open
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }

    // Delete the cookies file if it exists
    const cookiesPath = path.join(__dirname, '..', 'cookies.json');
    try {
      if (fs.existsSync(cookiesPath)) {
        // Rename the old cookies file instead of deleting it (for backup purposes)
        const backupPath = path.join(__dirname, '..', `cookies.backup.${Date.now()}.json`);
        fs.renameSync(cookiesPath, backupPath);
        logger.info(`Backed up cookies file to ${backupPath}`);
      }
    } catch (error) {
      logger.error('Error backing up cookies file:', error);
      // If rename fails, try to delete as fallback
      try {
        if (fs.existsSync(cookiesPath)) {
          fs.unlinkSync(cookiesPath);
          logger.info('Deleted cookies file');
        }
      } catch (deleteError) {
        logger.error('Error deleting cookies file:', deleteError);
      }
    }

    // Reinitialize
    return await initialize(statusCallback);
  } catch (error) {
    logger.error('Error resetting authentication:', error);
    return false;
  }
}

/**
 * Collects and sends the current status data to the callback.
 * This is called both by the interval timer and the mutation observer.
 *
 * @async
 * @function collectAndSendStatusData
 * @param {string} [source='interval'] - The source of the status update request ('interval' or 'observer')
 */
async function collectAndSendStatusData(source = 'interval') {
  // Debounce function to prevent too many rapid updates
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  
  debounceTimer = setTimeout(async () => {
    try {
      // Check if browser and page are initialized
      if (!browser || !page) {
        logger.warn(
          'Browser or page not initialized, skipping status collection'
        );
        return;
      }

      // Navigate to switchboard if needed - safely
      try {
        await navigateToSwitchboard();
      } catch (navError) {
        logger.error('Error navigating to switchboard:', navError.message);
        // Continue with the refresh even if navigation fails
      }

      // Get status - safely
      let status;
      try {
        status = await getStatus();
      } catch (statusError) {
        logger.error('Error getting status:', statusError.message);
        status = { status: 'available', source: 'error' };
      }

      // Get call stats - safely
      let callStats;
      try {
        callStats = await fetchCallStats();
      } catch (statsError) {
        logger.error('Error getting call stats:', statsError.message);
        callStats = {
          waitingCalls: 0,
          activeCalls: 0,
          totalCalls: 0,
          servicedCalls: 0,
          abandonedCalls: 0,
          lastUpdated: new Date().toISOString(),
          source: 'error',
        };
      }

      // Get agent statuses - safely
      let agentStatuses;
      try {
        agentStatuses = await fetchAllAgentStatuses();
      } catch (agentError) {
        logger.error('Error getting agent statuses:', agentError.message);
        agentStatuses = null;
      }
      
      // Create the status data object
      const statusData = {
        status,
        callStats,
        agentStatuses,
      };
      
      // Check if the data has actually changed
      const hasChanged = !lastStatusData || 
                         JSON.stringify(statusData) !== JSON.stringify(lastStatusData);
      
      // Only send updates if the data has changed or it's a regular interval update
      if (hasChanged || source === 'interval') {
        // Update last status data
        lastStatusData = statusData;
        
        // Log the update source
        if (hasChanged) {
          logger.info(`Status update detected (source: ${source})`);
        } else {
          logger.debug(`Status refresh (no changes, source: ${source})`);
        }
        
        // Call the callback with combined results
        if (statusCallback) {
          statusCallback(null, statusData);
        }
      }
      
      // Setup mutation observer if not already active
      if (!observerActive) {
        setupMutationObserver();
      }
    } catch (error) {
      logger.error(`Error collecting status data (${source}):`, error);
      if (statusCallback) {
        statusCallback(error, null);
      }
    }
  }, source === 'observer' ? 500 : 0); // Debounce observer events by 500ms
}

/**
 * Sets up a Mutation Observer to watch for DOM changes in the 3CX interface
 * that might indicate status changes.
 *
 * @async
 * @function setupMutationObserver
 */
async function setupMutationObserver() {
  try {
    if (!page) {
      logger.warn('Cannot setup mutation observer: page not initialized');
      return;
    }
    
    // Check if observer is already setup
    if (observerActive) {
      return;
    }
    
    logger.info('Setting up mutation observer for real-time status updates');
    
    // Setup the mutation observer in the page context
    await page.evaluate(() => {
      // This function runs in the browser context
      if (window._3cxObserver) {
        window._3cxObserver.disconnect();
      }
      
      // Create a new observer instance
      window._3cxObserver = new MutationObserver((mutations) => {
        // Check if any mutations are relevant to status changes
        const relevantMutation = mutations.some(mutation => {
          // Check for changes to the agent list
          if (mutation.target.closest('app-all-queue-agents')) {
            return true;
          }
          
          // Check for changes to the queue stats
          if (mutation.target.closest('.queue-stat')) {
            return true;
          }
          
          // Check for changes to the status indicator
          if (mutation.target.closest('.status-indicator') || 
              mutation.target.closest('.status-selector')) {
            return true;
          }
          
          return false;
        });
        
        if (relevantMutation) {
          // Signal back to Node.js that a relevant change was detected
          window._statusChangeDetected = true;
        }
      });
      
      // Observe the entire document for changes, focusing on childList and subtree
      window._3cxObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
      
      // Initialize the change detection flag
      window._statusChangeDetected = false;
    });
    
    observerActive = true;
    logger.info('Mutation observer setup complete');
  } catch (error) {
    logger.error('Error setting up mutation observer:', error);
    observerActive = false;
  }
}

/**
 * Starts the interval timer that periodically calls `collectAndSendStatusData`
 * to poll for updates from the 3CX web client.
 * Also sets up a mutation observer to detect changes in real-time.
 *
 * @function startRefreshInterval
 */
function startRefreshInterval() {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }

  logger.info(
    `Starting status refresh interval (every ${config.refreshInterval}ms) with real-time updates`
  );
  
  // Initial data collection
  collectAndSendStatusData('initial');
  
  // Setup the mutation observer
  setupMutationObserver();

  // Set up the fallback interval
  refreshIntervalId = setInterval(async () => {
    try {
      // Check if status change was detected by the observer
      const statusChangeDetected = await page.evaluate(() => {
        const detected = window._statusChangeDetected || false;
        // Reset the flag
        window._statusChangeDetected = false;
        return detected;
      }).catch(() => false);
      
      if (statusChangeDetected) {
        logger.info('Status change detected by observer, collecting data');
        await collectAndSendStatusData('observer');
      } else {
        // Regular interval update
        await collectAndSendStatusData('interval');
      }
    } catch (error) {
      logger.error('Error in refresh interval:', error);
      if (statusCallback) {
        statusCallback(error, null);
      }
    }
  }, config.refreshInterval);

  logger.info(`Started refresh interval (${config.refreshInterval}ms) with real-time updates`);
}

/**
 * Starts the status monitoring process by ensuring the refresh interval is running.
 * Optionally sets the callback function for status updates.
 *
 * @function startMonitoring
 * @param {Function} [callback] - Optional function to call with status updates. If provided, it updates the internal `statusCallback`.
 */
function startMonitoring(callback) {
  if (callback) {
    statusCallback = callback;
  }

  startRefreshInterval();
}

/**
 * Stops the periodic status refresh interval and disconnects the mutation observer.
 *
 * @function stopMonitoring
 */
function stopMonitoring() {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
    logger.info('Stopped status monitoring interval');
  }
  
  // Disconnect the mutation observer if it exists
  if (page && observerActive) {
    page.evaluate(() => {
      if (window._3cxObserver) {
        window._3cxObserver.disconnect();
        window._3cxObserver = null;
      }
    }).catch(error => {
      logger.error('Error disconnecting mutation observer:', error);
    });
    
    observerActive = false;
    logger.info('Disconnected mutation observer');
  }
}

/**
 * Takes a screenshot of the current Puppeteer page and saves it to the `screenshots` directory.
 * Useful for debugging UI scraping issues.
 * Respects configuration settings to limit screenshot frequency and total count.
 *
 * @async
 * @function takeScreenshot
 * @param {string} [prefix='3cx'] - An optional prefix for the screenshot filename.
 * @param {boolean} [force=false] - If true, bypasses the screenshot limits for critical debugging.
 * @returns {Promise<string|null>} A promise that resolves to the full path of the saved screenshot file, or null if an error occurred or limits prevented taking a screenshot.
 */
async function takeScreenshot(prefix = '3cx', force = false) {
  try {
    // Check if screenshots are enabled in config
    if (!config.screenshots.enabled && !force) {
      logger.debug(`Screenshot requested (${prefix}) but screenshots are disabled in config`);
      return null;
    }
    
    // Check if we've reached the maximum number of screenshots
    if (screenshotCount >= config.screenshots.maxPerSession && !force) {
      logger.warn(`Screenshot limit reached (${config.screenshots.maxPerSession}). No more screenshots will be taken.`);
      return null;
    }
    
    // Check if we're taking screenshots too frequently
    const now = Date.now();
    const timeSinceLastScreenshot = now - lastScreenshotTime;
    if (timeSinceLastScreenshot < config.screenshots.minInterval && !force) {
      logger.debug(`Screenshot requested too soon (${timeSinceLastScreenshot}ms < ${config.screenshots.minInterval}ms)`);
      return null;
    }
    
    // Update screenshot tracking
    lastScreenshotTime = now;
    screenshotCount++;
    
    if (!page) {
      logger.warn('Cannot take screenshot: page not initialized');
      return null;
    }

    // Create screenshots directory if it doesn't exist
    const screenshotsDir = path.join(__dirname, '..', 'public', 'screenshots');
    try {
      await mkdirAsync(screenshotsDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        logger.error('Error creating screenshots directory:', error.message);
        return null;
      }
    }

    // Generate a filename with timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `${prefix}-screenshot-${timestamp}.png`;
    const filepath = path.join(screenshotsDir, filename);

    // Take the screenshot
    await page.screenshot({ path: filepath, fullPage: false });
    logger.info(`Screenshot saved to ${filepath} (${screenshotCount}/${config.screenshots.maxPerSession})`);

    return filepath;
  } catch (error) {
    logger.error('Error taking screenshot:', error.message);
    return null;
  }
}

module.exports = {
  initialize,
  getStatus,
  getCallStats: fetchCallStats, // Export with a different name to avoid conflicts
  close,
  resetAuthentication,
  startMonitoring,
  stopMonitoring,
  takeScreenshot,
  fetchAllAgentStatuses, // Export the new function
};
