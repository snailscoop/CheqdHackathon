/**
 * Resource Controller
 * 
 * Controller for DID-Linked Resource management.
 */

const logger = require('../../utils/logger');
const cheqdService = require('../../services/cheqdService');
const { NotFoundError } = require('../../utils/errors');

/**
 * Create a new DID-linked resource
 */
async function createResource(req, res) {
  const { did } = req.params;
  const resourceData = req.body;
  
  try {
    if (!did) {
      return res.status(400).json({ error: 'Missing required parameter: did' });
    }
    
    if (!resourceData) {
      return res.status(400).json({ error: 'Resource data is required' });
    }
    
    if (!resourceData.data) {
      return res.status(400).json({ error: 'Resource data content is required' });
    }
    
    if (!resourceData.name) {
      return res.status(400).json({ error: 'Resource name is required' });
    }
    
    if (!resourceData.type) {
      return res.status(400).json({ error: 'Resource type is required' });
    }
    
    // Create the resource
    const resource = await cheqdService.createResource(did, resourceData);
    
    // Return the created resource
    res.status(201).json(resource);
  } catch (error) {
    logger.error('Failed to create resource', { error: error.message, did });
    
    if (error.message.includes('non-existent DID')) {
      res.status(404).json({ error: `DID not found: ${did}` });
    } else {
      res.status(500).json({ error: 'Failed to create resource' });
    }
  }
}

/**
 * Search/retrieve a DID-linked resource
 */
async function searchResource(req, res) {
  const { did } = req.params;
  
  try {
    if (!did) {
      return res.status(400).json({ error: 'Missing required parameter: did' });
    }
    
    // Get all query parameters as search options
    const options = {
      resourceId: req.query.resourceId,
      resourceName: req.query.resourceName,
      resourceType: req.query.resourceType,
      resourceVersion: req.query.resourceVersion,
      resourceVersionTime: req.query.resourceVersionTime,
      checksum: req.query.checksum,
      resourceMetadata: req.query.resourceMetadata === 'true'
    };
    
    // Search for the resource
    const result = await cheqdService.searchResource(did, options);
    
    // If the resource was not found, return 404
    if (result?.dereferencingMetadata?.error === 'notFound') {
      res.status(404).json(result);
    } else {
      res.json(result);
    }
  } catch (error) {
    logger.error('Failed to search resource', { error: error.message, did });
    res.status(500).json({ error: 'Failed to search resource' });
  }
}

module.exports = {
  createResource,
  searchResource
}; 