/**
 * Re-export of the main telegramService module
 * This module exists to maintain backward compatibility with tests
 * that expect telegramService to be in this location.
 */

// Import the actual telegramService from its correct location
const telegramService = require('../../services/telegramService');

// Re-export it
module.exports = telegramService; 