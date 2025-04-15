/**
 * WLED Controller Module
 *
 * Handles communication with a WLED device using its JSON HTTP API.
 * Reads configuration like IP address, default brightness, transition time,
 * and status-to-color mappings from environment variables.
 */

require('dotenv').config();
const axios = require('axios');
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

// Configuration from environment variables
const config = {
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

/**
 * Updates the WLED device with a specific solid color.
 * Turns the light on and sets the brightness and transition according to config.
 *
 * @async
 * @function updateWLED
 * @param {object} color - An object containing RGB color values.
 * @param {number} color.r - Red component (0-255).
 * @param {number} color.g - Green component (0-255).
 * @param {number} color.b - Blue component (0-255).
 * @returns {Promise<boolean>} A promise that resolves to true if the update was successful, false otherwise.
 * @throws {Error} If WLED IP address is not configured or color object is invalid.
 */
async function updateWLED(color) {
  try {
    // Validate required configuration
    if (!config.wled.ipAddress) {
      throw new Error('WLED IP address is not configured');
    }

    // Validate color values
    if (!color || typeof color !== 'object') {
      throw new Error('Invalid color object provided');
    }

    // Ensure color values are numbers and within range 0-255
    const r = Math.min(255, Math.max(0, parseInt(color.r) || 0));
    const g = Math.min(255, Math.max(0, parseInt(color.g) || 0));
    const b = Math.min(255, Math.max(0, parseInt(color.b) || 0));

    logger.info(`Setting WLED color to RGB(${r},${g},${b})`);

    const url = `http://${config.wled.ipAddress}/json`;
    const payload = {
      on: true,
      bri: config.wled.brightness,
      transition: config.wled.transition / 1000, // WLED uses seconds
      seg: [
        {
          col: [[r, g, b]],
          fx: 0, // Solid color effect
          sx: 128, // Effect speed (not needed for solid)
          ix: 128, // Effect intensity (not needed for solid)
        },
      ],
    };

    logger.debug('WLED payload:', JSON.stringify(payload));

    try {
      await axios.post(url, payload);
      logger.info('WLED updated successfully');
      return true;
    } catch (axiosError) {
      logger.error('WLED API error:', axiosError.message);
      if (axiosError.response) {
        logger.error('Response status:', axiosError.response.status);
        logger.error('Response data:', axiosError.response.data);
      }
      throw axiosError;
    }
  } catch (error) {
    logger.error('Error updating WLED:', error.message);
    return false;
  }
}

/**
 * Retrieves the current status of the WLED device.
 *
 * @async
 * @function getWLEDStatus
 * @returns {Promise<object|null>} A promise that resolves to the WLED status object (from the WLED JSON API /json endpoint) or null if an error occurred.
 * @throws {Error} If WLED IP address is not configured.
 */
async function getWLEDStatus() {
  try {
    // Validate required configuration
    if (!config.wled.ipAddress) {
      throw new Error('WLED IP address is not configured');
    }

    const url = `http://${config.wled.ipAddress}/json`;
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    logger.error('Error getting WLED status:', error.message);
    return null;
  }
}

/**
 * Turns off the WLED device.
 *
 * @async
 * @function turnOffWLED
 * @returns {Promise<boolean>} A promise that resolves to true if the command was sent successfully, false otherwise.
 * @throws {Error} If WLED IP address is not configured.
 */
async function turnOffWLED() {
  try {
    // Validate required configuration
    if (!config.wled.ipAddress) {
      throw new Error('WLED IP address is not configured');
    }

    logger.info('Turning off WLED');

    const url = `http://${config.wled.ipAddress}/json`;
    const payload = {
      on: false,
    };

    await axios.post(url, payload);
    logger.info('WLED turned off successfully');
    return true;
  } catch (error) {
    logger.error('Error turning off WLED:', error.message);
    return false;
  }
}

/**
 * Sets the brightness of the WLED device.
 *
 * @async
 * @function setWLEDBrightness
 * @param {number} brightness - The desired brightness level (0-255). Values outside this range will be clamped.
 * @returns {Promise<boolean>} A promise that resolves to true if the brightness was set successfully, false otherwise.
 * @throws {Error} If WLED IP address is not configured.
 */
async function setWLEDBrightness(brightness) {
  try {
    // Validate required configuration
    if (!config.wled.ipAddress) {
      throw new Error('WLED IP address is not configured');
    }

    // Validate brightness value
    const validBrightness = Math.max(0, Math.min(255, brightness));

    logger.info(`Setting WLED brightness to ${validBrightness}`);

    const url = `http://${config.wled.ipAddress}/json`;
    const payload = {
      bri: validBrightness,
    };

    await axios.post(url, payload);
    logger.info('WLED brightness updated successfully');

    // Update local config
    config.wled.brightness = validBrightness;

    return true;
  } catch (error) {
    logger.error('Error setting WLED brightness:', error.message);
    return false;
  }
}

/**
 * Sets the transition time of the WLED device.
 *
 * @async
 * @function setWLEDTransition
 * @param {number} transitionMs - The desired transition time in milliseconds (0-65535). Values outside this range will be clamped.
 * @returns {Promise<boolean>} A promise that resolves to true if the transition time was set successfully, false otherwise.
 * @throws {Error} If WLED IP address is not configured.
 */
async function setWLEDTransition(transitionMs) {
  try {
    // Validate required configuration
    if (!config.wled.ipAddress) {
      throw new Error('WLED IP address is not configured');
    }

    // Validate transition value
    const validTransition = Math.max(0, Math.min(65535, transitionMs));

    logger.info(`Setting WLED transition time to ${validTransition}ms`);

    const url = `http://${config.wled.ipAddress}/json`;
    const payload = {
      transition: validTransition / 1000, // WLED uses seconds
    };

    await axios.post(url, payload);
    logger.info('WLED transition time updated successfully');

    // Update local config
    config.wled.transition = validTransition;

    return true;
  } catch (error) {
    logger.error('Error setting WLED transition time:', error.message);
    return false;
  }
}

/**
 * Sets a specific effect on the WLED device.
 *
 * @async
 * @function setWLEDEffect
 * @param {number} effectId - The ID of the WLED effect to set.
 * @returns {Promise<boolean>} A promise that resolves to true if the effect was set successfully, false otherwise.
 * @throws {Error} If WLED IP address is not configured.
 */
async function setWLEDEffect(effectId) {
  try {
    // Validate required configuration
    if (!config.wled.ipAddress) {
      throw new Error('WLED IP address is not configured');
    }

    logger.info(`Setting WLED effect to ID ${effectId}`);

    const url = `http://${config.wled.ipAddress}/json`;
    const payload = {
      seg: [
        {
          fx: effectId,
        },
      ],
    };

    await axios.post(url, payload);
    logger.info(`WLED effect set to ${effectId} successfully`);
    return true;
  } catch (error) {
    logger.error('Error setting WLED effect:', error.message);
    return false;
  }
}

module.exports = {
  updateWLED,
  getWLEDStatus,
  turnOffWLED,
  setWLEDBrightness,
  setWLEDTransition,
  setWLEDEffect,
  config,
};
