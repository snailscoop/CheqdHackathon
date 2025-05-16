/**
 * Logger Utility
 * 
 * Production-ready logging utility for the application.
 */

// Default log level from environment or set to 'info'
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Log levels and their priorities
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Current log level as numeric value
const CURRENT_LEVEL = LOG_LEVELS[LOG_LEVEL] !== undefined ? LOG_LEVELS[LOG_LEVEL] : LOG_LEVELS.info;

/**
 * Format metadata for logging
 * @param {Object} meta - Metadata to format
 * @returns {string} - Formatted metadata string
 */
function formatMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) return '';
  
  try {
    return JSON.stringify(meta);
  } catch (e) {
    return `[Metadata serialization error: ${e.message}]`;
  }
}

/**
 * Get timestamp for logging
 * @returns {string} - Formatted timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Logger object with methods for different log levels
 */
const logger = {
  /**
   * Log an error message
   * @param {string} message - Message to log
   * @param {Object} meta - Optional metadata
   */
  error(message, meta) {
    if (CURRENT_LEVEL >= LOG_LEVELS.error) {
      console.error(`[${getTimestamp()}] ERROR: ${message} ${formatMeta(meta)}`);
    }
  },
  
  /**
   * Log a warning message
   * @param {string} message - Message to log
   * @param {Object} meta - Optional metadata
   */
  warn(message, meta) {
    if (CURRENT_LEVEL >= LOG_LEVELS.warn) {
      console.warn(`[${getTimestamp()}] WARN: ${message} ${formatMeta(meta)}`);
    }
  },
  
  /**
   * Log an info message
   * @param {string} message - Message to log
   * @param {Object} meta - Optional metadata
   */
  info(message, meta) {
    if (CURRENT_LEVEL >= LOG_LEVELS.info) {
      console.info(`[${getTimestamp()}] INFO: ${message} ${formatMeta(meta)}`);
    }
  },
  
  /**
   * Log a debug message
   * @param {string} message - Message to log
   * @param {Object} meta - Optional metadata
   */
  debug(message, meta) {
    if (CURRENT_LEVEL >= LOG_LEVELS.debug) {
      console.debug(`[${getTimestamp()}] DEBUG: ${message} ${formatMeta(meta)}`);
    }
  }
};

module.exports = logger; 