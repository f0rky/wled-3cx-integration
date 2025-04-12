#!/bin/bash
# Debug script for WLED-3CX integration
# This script runs the browser monitor in debug mode with enhanced logging

# Create logs directory if it doesn't exist
mkdir -p logs

# Set debug environment variables
export DEBUG=puppeteer:*
export DEBUG_LEVEL=debug

# Run the monitor with logging
echo "Starting browser monitor in DEBUG mode (with enhanced logging)"
echo "Screenshots will be saved to the screenshots directory"
echo "Logs will be saved to logs/debug.log"
node src/browser-monitor.js 2>&1 | tee logs/debug.log
