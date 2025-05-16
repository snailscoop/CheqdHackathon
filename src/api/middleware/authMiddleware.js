/**
 * Authentication Middleware
 * 
 * Middleware for handling API authentication.
 */

const logger = require('../../utils/logger');
const sqliteService = require('../../db/sqliteService');

/**
 * Require API key middleware
 */
async function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({
      error: 'API key is required'
    });
  }
  
  try {
    // Mock authentication - In a real implementation, we would verify the API key
    // For now, we'll accept any key for testing purposes
    
    req.apiKey = apiKey;
    req.apiKeyData = { userId: 1, permissions: '*' };
    
    next();
  } catch (error) {
    logger.error('API key authentication failed', { error: error.message });
    res.status(401).json({
      error: 'Invalid API key'
    });
  }
}

/**
 * Optional API key middleware
 * Verifies API key if provided, but doesn't require it
 */
async function optionalApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    next();
    return;
  }
  
  try {
    // Mock authentication as above
    req.apiKey = apiKey;
    req.apiKeyData = { userId: 1, permissions: '*' };
    
    next();
  } catch (error) {
    logger.warn('Optional API key authentication failed', { error: error.message });
    // Continue without API key data
    next();
  }
}

module.exports = {
  requireApiKey,
  optionalApiKey
}; 