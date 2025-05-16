/**
 * Handlers Index
 * 
 * Exports all handlers for cleaner imports.
 */

// Import all handlers
const commandHandlers = require('./commandHandlers');
const messageHandlers = require('./messageHandlers');
const callbackHandlers = require('./callbackHandlers');

// Export all handlers
module.exports = {
  commandHandlers,
  messageHandlers,
  callbackHandlers
}; 