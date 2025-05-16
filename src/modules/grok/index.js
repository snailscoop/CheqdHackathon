/**
 * Grok Module Index
 * 
 * Exports the Grok service functionality for natural language processing,
 * function calling, and credential-related operations.
 */

const grokService = require('./grokService');
const credentialNlpService = require('./credentialNlpService');
const { functionDefinitions, getFunctionDefinition } = require('./functionDefinitions');

module.exports = {
  // Main service
  initialize: grokService.initialize,
  processCommand: grokService.processCommand,
  
  // Role management
  getUserRole: grokService.getUserRole,
  setUserRole: grokService.setUserRole,
  clearRoleCache: grokService.clearRoleCache,
  
  // Function tracking
  updateFunctionResult: grokService.updateFunctionResult,
  
  // Credential NLP services
  processCredentialCommand: credentialNlpService.processCredentialCommand,
  formatCredentialForDisplay: credentialNlpService.formatCredentialForDisplay,
  processVerificationQuestion: credentialNlpService.processVerificationQuestion,
  validateCredentialId: credentialNlpService.validateCredentialId,
  extractCredentialId: credentialNlpService.extractCredentialId,
  
  // Function definitions
  functionDefinitions,
  getFunctionDefinition
}; 