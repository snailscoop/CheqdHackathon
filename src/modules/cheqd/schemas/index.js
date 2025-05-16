/**
 * Schema Index
 * 
 * Export all credential schemas for use with the Cheqd Trust Registry.
 */

const educationalCredentialSchema = require('./educationalCredentialSchema');
const aiAgentSchema = require('./aiAgentSchema');
const moderationCredentialSchema = require('./moderationCredentialSchema');
const supportCredentialSchema = require('./supportCredentialSchema');

module.exports = {
  educationalCredentialSchema,
  aiAgentSchema,
  moderationCredentialSchema,
  supportCredentialSchema
}; 