/**
 * DID Controller
 * 
 * Handles DID-related API endpoints.
 */

const cheqdService = require('../../services/cheqdService');
const logger = require('../../utils/logger');

/**
 * List DIDs
 */
async function listDids(req, res) {
  const { ownerId } = req.query;
  
  try {
    const dids = await cheqdService.getDids(ownerId);
    res.json({ dids });
  } catch (error) {
    logger.error('Failed to list DIDs', { error: error.message });
    res.status(500).json({ error: 'Failed to list DIDs' });
  }
}

/**
 * Resolve DID
 */
async function resolveDid(req, res) {
  const { did } = req.params;
  
  try {
    const didDocument = await cheqdService.resolveDid(did);
    
    if (!didDocument) {
      return res.status(404).json({ error: 'DID not found' });
    }
    
    res.json({ didDocument });
  } catch (error) {
    logger.error('Failed to resolve DID', { error: error.message, did });
    res.status(500).json({ error: 'Failed to resolve DID' });
  }
}

/**
 * Create DID
 */
async function createDid(req, res) {
  const { ownerId, method } = req.body;
  
  try {
    if (!ownerId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const did = await cheqdService.createDid(ownerId, method || 'cheqd');
    res.status(201).json({ did });
  } catch (error) {
    logger.error('Failed to create DID', { error: error.message });
    res.status(500).json({ error: 'Failed to create DID' });
  }
}

/**
 * Update DID document
 */
async function updateDid(req, res) {
  const { did } = req.body;
  
  try {
    if (!did) {
      return res.status(400).json({ error: 'Missing required parameter: did' });
    }
    
    // Pass the entire request body as updates
    const updateResult = await cheqdService.updateDID(did, req.body);
    
    if (!updateResult) {
      return res.status(404).json({ error: 'DID not found or update failed' });
    }
    
    // Format response to match Cheqd API response format
    res.json({ 
      did: updateResult.did,
      controllerKeyId: updateResult.document?.controller?.[0] || updateResult.document?.controller,
      keys: updateResult.keys || [],
      services: updateResult.services || [],
      controllerKeyRefs: updateResult.document?.authentication || []
    });
  } catch (error) {
    logger.error('Failed to update DID', { error: error.message, did });
    res.status(500).json({ error: 'Failed to update DID' });
  }
}

/**
 * Deactivate DID document
 */
async function deactivateDid(req, res) {
  const { did } = req.params;
  const { publicKeyHexs } = req.body;
  
  try {
    if (!did) {
      return res.status(400).json({ error: 'Missing required parameter: did' });
    }
    
    const deactivationResult = await cheqdService.deactivateDID(did, { 
      publicKeyHexs: publicKeyHexs || [] 
    });
    
    if (!deactivationResult) {
      return res.status(404).json({ error: 'DID not found or deactivation failed' });
    }
    
    res.json(deactivationResult);
  } catch (error) {
    logger.error('Failed to deactivate DID', { error: error.message, did });
    res.status(500).json({ error: 'Failed to deactivate DID' });
  }
}

/**
 * List DIDs
 * This endpoint returns all DIDs controlled by the account
 */
async function listAllDids(req, res) {
  try {
    // Use the service to get all DIDs
    const dids = await cheqdService.listDIDs();
    
    res.json(dids);
  } catch (error) {
    logger.error('Failed to list DIDs', { error: error.message });
    res.status(500).json({ error: 'Failed to list DIDs' });
  }
}

/**
 * Search/resolve DID document with extended options
 * Implements the W3C DID Resolution specification
 */
async function searchDid(req, res) {
  const { did } = req.params;
  
  try {
    if (!did) {
      return res.status(400).json({ error: 'Missing required parameter: did' });
    }
    
    // Get all query parameters
    const options = {
      metadata: req.query.metadata,
      versionId: req.query.versionId,
      versionTime: req.query.versionTime,
      transformKeys: req.query.transformKeys,
      service: req.query.service,
      relativeRef: req.query.relativeRef
    };
    
    // Use the search service
    const result = await cheqdService.searchDID(did, options);
    
    // If the result contains an error, return appropriate status code
    if (result?.didResolutionMetadata?.error === 'notFound') {
      res.status(404).json(result);
    } else {
      res.json(result);
    }
  } catch (error) {
    logger.error('Failed to search DID', { error: error.message, did });
    res.status(500).json({ error: 'Failed to search DID' });
  }
}

module.exports = {
  listDids,
  resolveDid,
  createDid,
  updateDid,
  deactivateDid,
  listAllDids,
  searchDid
}; 