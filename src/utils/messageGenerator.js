/**
 * Utility functions for generating formatted messages
 */
const logger = require('./logger');

/**
 * Generates standard formatted response messages
 */
class MessageGenerator {
  /**
   * Generate a success message
   * @param {string} message - The success message
   * @returns {string} Formatted success message
   */
  static success(message) {
    return `✅ ${message}`;
  }

  /**
   * Generate an error message
   * @param {string} message - The error message
   * @returns {string} Formatted error message
   */
  static error(message) {
    return `❌ ${message}`;
  }

  /**
   * Generate a warning message
   * @param {string} message - The warning message
   * @returns {string} Formatted warning message
   */
  static warning(message) {
    return `⚠️ ${message}`;
  }

  /**
   * Generate an info message
   * @param {string} message - The info message
   * @returns {string} Formatted info message
   */
  static info(message) {
    return `ℹ️ ${message}`;
  }

  /**
   * Generate a credential verification message
   * @param {Object} credential - The credential object
   * @param {boolean} isValid - Whether the credential is valid
   * @returns {string} Formatted credential verification message
   */
  static credentialVerification(credential, isValid) {
    const status = isValid ? '✅ Valid' : '❌ Invalid';
    
    return `${status} credential:\n\n` +
      `Type: ${credential.type || 'Not specified'}\n` +
      `Issuer: ${credential.issuer || 'Unknown'}\n` +
      `Issued Date: ${credential.issuanceDate || 'Not specified'}\n` +
      `Expires: ${credential.expirationDate || 'Never'}`;
  }
}

module.exports = MessageGenerator; 