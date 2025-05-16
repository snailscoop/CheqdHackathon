/**
 * Integration Module Index
 * 
 * Exports the integration module functionality that connects
 * various services together (Jackal, Grok, credentials, etc.)
 */

const serviceConnector = require('./serviceConnector');
const moderationService = require('../moderation/moderationService');

module.exports = {
  // Main services
  initialize: serviceConnector.initialize,
  processMessage: serviceConnector.processMessage,
  
  // Cross-service functions
  executeFunction: serviceConnector.executeFunction,
  
  // Video and credential integration
  processVideoAndExtractCredentials: serviceConnector.processVideoAndExtractCredentials,
  getCredentialAiResponses: serviceConnector.getCredentialAiResponses,
  findRelatedVideosForCredential: serviceConnector.findRelatedVideosForCredential,
  
  // Moderation integration
  moderation: moderationService
}; 