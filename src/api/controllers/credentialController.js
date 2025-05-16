/**
 * Credential Controller
 * 
 * Handles credential-related API endpoints.
 */

const cheqdService = require('../../services/cheqdService');
const logger = require('../../utils/logger');

/**
 * List credentials
 */
async function listCredentials(req, res) {
  const { ownerId, type, status } = req.query;
  
  try {
    const credentials = await cheqdService.getCredentials({ ownerId, type, status });
    res.json({ credentials });
  } catch (error) {
    logger.error('Failed to list credentials', { error: error.message });
    res.status(500).json({ error: 'Failed to list credentials' });
  }
}

/**
 * Get credential by ID
 */
async function getCredential(req, res) {
  const { id } = req.params;
  
  try {
    const credential = await cheqdService.getCredential(id);
    
    if (!credential) {
      return res.status(404).json({ error: 'Credential not found' });
    }
    
    res.json({ credential });
  } catch (error) {
    logger.error('Failed to get credential', { error: error.message, id });
    res.status(500).json({ error: 'Failed to get credential' });
  }
}

/**
 * Issue a new credential
 */
async function issueCredential(req, res) {
  const { issuerDid, holderDid, type, claims } = req.body;
  
  try {
    if (!issuerDid || !holderDid || !type || !claims) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const credential = await cheqdService.issueCredential(issuerDid, holderDid, type, claims);
    res.status(201).json({ credential });
  } catch (error) {
    logger.error('Failed to issue credential', { error: error.message });
    res.status(500).json({ error: 'Failed to issue credential' });
  }
}

/**
 * Update credential status
 */
async function updateCredentialStatus(req, res) {
  const { id } = req.params;
  const { status, reason } = req.body;
  
  try {
    if (!status || !['active', 'suspended', 'revoked'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    const result = await cheqdService.updateCredentialStatus(id, status, reason);
    res.json({ success: true, result });
  } catch (error) {
    logger.error('Failed to update credential status', { error: error.message, id });
    res.status(500).json({ error: 'Failed to update credential status' });
  }
}

/**
 * Verify credential
 */
async function verifyCredential(req, res) {
  const { id } = req.params;
  
  try {
    const result = await cheqdService.verifyCredential(id);
    res.json({ result });
  } catch (error) {
    logger.error('Failed to verify credential', { error: error.message, id });
    res.status(500).json({ error: 'Failed to verify credential' });
  }
}

/**
 * Revoke credential using StatusList2021
 */
async function revokeCredential(req, res) {
  const { publish } = req.query;
  const { credential, symmetricKey } = req.body;
  
  try {
    if (!credential) {
      return res.status(400).json({ error: 'Missing required parameter: credential' });
    }
    
    // Convert publish string to boolean if needed
    const shouldPublish = publish === 'true' || publish === true;
    
    const result = await cheqdService.revokeCredentialWithStatusList(credential, {
      symmetricKey,
      publish: shouldPublish
    });
    
    res.json({ revoked: true });
  } catch (error) {
    logger.error('Failed to revoke credential', { 
      error: error.message,
      errorResponse: error.response?.data || {}
    });
    
    res.status(error.statusCode || 500).json({ 
      error: 'Failed to revoke credential',
      details: error.message
    });
  }
}

/**
 * Suspend credential using StatusList2021
 */
async function suspendCredential(req, res) {
  const { publish } = req.query;
  const { credential, symmetricKey } = req.body;
  
  try {
    if (!credential) {
      return res.status(400).json({ error: 'Missing required parameter: credential' });
    }
    
    // Convert publish string to boolean if needed
    const shouldPublish = publish === 'true' || publish === true;
    
    const result = await cheqdService.suspendCredentialWithStatusList(credential, {
      symmetricKey,
      publish: shouldPublish
    });
    
    res.json({ suspended: true });
  } catch (error) {
    logger.error('Failed to suspend credential', { 
      error: error.message,
      errorResponse: error.response?.data || {}
    });
    
    res.status(error.statusCode || 500).json({ 
      error: 'Failed to suspend credential',
      details: error.message
    });
  }
}

/**
 * Reinstate (unsuspend) credential using StatusList2021
 */
async function reinstateCredential(req, res) {
  const { publish } = req.query;
  const { credential, symmetricKey } = req.body;
  
  try {
    if (!credential) {
      return res.status(400).json({ error: 'Missing required parameter: credential' });
    }
    
    // Convert publish string to boolean if needed
    const shouldPublish = publish === 'true' || publish === true;
    
    const result = await cheqdService.reinstateCredentialWithStatusList(credential, {
      symmetricKey,
      publish: shouldPublish
    });
    
    res.json({ unsuspended: true });
  } catch (error) {
    logger.error('Failed to reinstate credential', { 
      error: error.message,
      errorResponse: error.response?.data || {}
    });
    
    res.status(error.statusCode || 500).json({ 
      error: 'Failed to reinstate credential',
      details: error.message
    });
  }
}

module.exports = {
  listCredentials,
  getCredential,
  issueCredential,
  updateCredentialStatus,
  verifyCredential,
  revokeCredential,
  suspendCredential,
  reinstateCredential
}; 