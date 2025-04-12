/**
 * Cookie Exporter for 3CX Browser Monitor
 * 
 * This script helps export cookies from a browser session where you're already logged in to 3CX.
 * Run this script once to save your authenticated cookies, which can then be used by the monitor.
 */

require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Get 3CX URL from environment
const threecxUrl = process.env.THREECX_WEB_URL || 'https://primonz.my3cx.nz';
const cookiesPath = path.join(process.cwd(), 'cookies.json');

async function exportCookies() {
  console.log('Cookie Exporter for 3CX Browser Monitor');
  console.log(`Target URL: ${threecxUrl}`);
  
  // Create a visible browser for manual login
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: null
  });
  
  try {
    const page = await browser.newPage();
    
    // Navigate to 3CX
    console.log(`Navigating to ${threecxUrl}...`);
    await page.goto(threecxUrl, { waitUntil: 'networkidle2' });
    
    console.log('\n===========================================================');
    console.log('IMPORTANT: Please log in manually in the browser window.');
    console.log('After you have successfully logged in to 3CX, press Enter in this terminal.');
    console.log('===========================================================\n');
    
    // Wait for user to press Enter
    await new Promise(resolve => {
      process.stdin.once('data', data => {
        resolve();
      });
    });
    
    // Get all cookies
    const cookies = await page.cookies();
    
    // Save cookies to file
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
    
    console.log(`\nSuccess! ${cookies.length} cookies saved to ${cookiesPath}`);
    console.log('You can now run the monitor with these cookies.');
    
  } catch (error) {
    console.error('Error exporting cookies:', error);
  } finally {
    await browser.close();
  }
}

// Run the exporter
exportCookies().catch(console.error);
