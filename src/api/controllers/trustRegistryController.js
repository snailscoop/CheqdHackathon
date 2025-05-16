/**
 * Trust Registry Controller
 * 
 * Handles API endpoints for trust registry accreditation operations
 */

const logger = require('../../utils/logger');
const trustRegistryService = require('../../modules/cheqd/trustRegistryService');
const cheqdService = require('../../services/cheqdService');

/**
 * Issue a verifiable accreditation
 */
async function issueAccreditation(req, res) {
  try {
    const { accreditationType } = req.query;
    
    if (!accreditationType) {
      return res.status(400).json({
        error: 'Missing required query parameter: accreditationType'
      });
    }
    
    const {
      issuerDid,
      subjectDid,
      schemas,
      format,
      accreditationName,
      trustFramework,
      trustFrameworkId,
      parentAccreditation,
      rootAuthorisation,
      credentialStatus
    } = req.body;
    
    // Validate required fields
    if (!issuerDid || !subjectDid) {
      return res.status(400).json({
        error: 'Missing required fields: issuerDid and subjectDid are required'
      });
    }
    
    // Process credential status if provided
    let statusListOptions = null;
    if (credentialStatus) {
      statusListOptions = {
        type: 'StatusList2021Entry',
        statusPurpose: credentialStatus.statusPurpose || 'revocation',
        statusListIndex: credentialStatus.statusListIndex || Math.floor(Math.random() * 100000).toString()
      };
      
      // Add status list name if provided
      if (credentialStatus.statusListName) {
        statusListOptions.statusListName = credentialStatus.statusListName;
      }
    } else {
      // Create default status list options
      statusListOptions = {
        type: 'StatusList2021Entry',
        statusPurpose: 'revocation'
      };
    }
    
    // Issue accreditation using trustRegistryService
    const result = await trustRegistryService.issueAccreditation({
      accreditationType,
      issuerDid,
      subjectDid,
      schemas,
      format: format || 'jwt',
      accreditationName,
      trustFramework,
      trustFrameworkId,
      parentAccreditation,
      rootAuthorisation,
      credentialStatus: statusListOptions
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error issuing accreditation', { 
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: `Failed to issue accreditation: ${error.message}`
    });
  }
}

/**
 * Verify a verifiable accreditation
 */
async function verifyAccreditation(req, res) {
  try {
    // Get query parameters
    const verifyStatus = req.query.verifyStatus === 'true';
    const allowDeactivatedDid = req.query.allowDeactivatedDid === 'true';
    
    // Extract body parameters according to Swagger spec
    const {
      subjectDid,
      didUrl,
      did,
      resourceId,
      resourceName,
      resourceType,
      schemas,
      policies,
      // Keep backward compatibility
      accreditationId,
      accreditationDid,
      verifyChain
    } = req.body;
    
    // Create verification options based on the request
    const verificationOptions = {
      // Use did/didUrl/resourceId info if available
      did,
      didUrl,
      resourceId,
      resourceName,
      resourceType,
      // Fall back to accreditationId/Did for backward compatibility
      accreditationId,
      accreditationDid,
      // Query parameters
      verifyStatus,
      allowDeactivatedDid,
      // Additional options
      verifyChain: verifyChain !== false,
      subjectDid,
      schemas,
      policies
    };
    
    // Basic validation - ensure we have enough info to identify an accreditation
    if (!didUrl && !did && !resourceId && !accreditationId && !accreditationDid && !subjectDid) {
      return res.status(400).json({
        error: 'Missing required fields: must provide either didUrl, did, resourceId, accreditationId, accreditationDid, or subjectDid'
      });
    }
    
    // Verify accreditation
    const result = await trustRegistryService.verifyAccreditation(verificationOptions);
    
    res.json(result);
  } catch (error) {
    logger.error('Error verifying accreditation', { 
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: `Failed to verify accreditation: ${error.message}`
    });
  }
}

/**
 * Revoke a verifiable accreditation
 */
async function revokeAccreditation(req, res) {
  try {
    // Get query parameters
    const publish = req.query.publish === 'true' || req.query.publish === true;
    
    // Extract body parameters according to Swagger spec
    const {
      didUrl,
      did,
      resourceId,
      resourceName,
      resourceType,
      symmetricKey,
      // Keep backward compatibility
      accreditationId,
      accreditationDid,
      reason
    } = req.body;
    
    // Create revocation options based on the request
    const revocationOptions = {
      // Use did/didUrl/resourceId info if available
      didUrl,
      did,
      resourceId,
      resourceName,
      resourceType,
      symmetricKey,
      // Fall back to accreditationId/Did for backward compatibility
      accreditationId,
      accreditationDid,
      reason,
      // Query parameters
      publish
    };
    
    // Basic validation - ensure we have enough info to identify an accreditation
    if (!didUrl && !did && !resourceId && !accreditationId && !accreditationDid) {
      return res.status(400).json({
        error: 'Missing required fields: must provide either didUrl, did, resourceId, accreditationId, or accreditationDid'
      });
    }
    
    // Revoke accreditation
    const result = await trustRegistryService.revokeAccreditation(revocationOptions);
    
    res.json(result);
  } catch (error) {
    logger.error('Error revoking accreditation', { 
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: `Failed to revoke accreditation: ${error.message}`
    });
  }
}

/**
 * Suspend a verifiable accreditation
 */
async function suspendAccreditation(req, res) {
  try {
    // Get query parameters
    const publish = req.query.publish === 'true' || req.query.publish === true;
    
    // Extract body parameters according to Swagger spec
    const {
      didUrl,
      did,
      resourceId,
      resourceName,
      resourceType,
      symmetricKey,
      // Keep backward compatibility
      accreditationId,
      accreditationDid,
      reason
    } = req.body;
    
    // Create suspension options based on the request
    const suspensionOptions = {
      // Use did/didUrl/resourceId info if available
      didUrl,
      did,
      resourceId,
      resourceName,
      resourceType,
      symmetricKey,
      // Fall back to accreditationId/Did for backward compatibility
      accreditationId,
      accreditationDid,
      reason,
      // Query parameters
      publish
    };
    
    // Basic validation - ensure we have enough info to identify an accreditation
    if (!didUrl && !did && !resourceId && !accreditationId && !accreditationDid) {
      return res.status(400).json({
        error: 'Missing required fields: must provide either didUrl, did, resourceId, accreditationId, or accreditationDid'
      });
    }
    
    // Suspend accreditation
    const result = await trustRegistryService.suspendAccreditation(suspensionOptions);
    
    res.json(result);
  } catch (error) {
    logger.error('Error suspending accreditation', { 
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: `Failed to suspend accreditation: ${error.message}`
    });
  }
}

/**
 * Reinstate a verifiable accreditation
 */
async function reinstateAccreditation(req, res) {
  try {
    // Get query parameters
    const publish = req.query.publish === 'true' || req.query.publish === true;
    
    // Extract body parameters according to Swagger spec
    const {
      didUrl,
      did,
      resourceId,
      resourceName,
      resourceType,
      symmetricKey,
      // Keep backward compatibility
      accreditationId,
      accreditationDid,
      reason
    } = req.body;
    
    // Create reinstatement options based on the request
    const reinstatementOptions = {
      // Use did/didUrl/resourceId info if available
      didUrl,
      did,
      resourceId,
      resourceName,
      resourceType,
      symmetricKey,
      // Fall back to accreditationId/Did for backward compatibility
      accreditationId,
      accreditationDid,
      reason,
      // Query parameters
      publish
    };
    
    // Basic validation - ensure we have enough info to identify an accreditation
    if (!didUrl && !did && !resourceId && !accreditationId && !accreditationDid) {
      return res.status(400).json({
        error: 'Missing required fields: must provide either didUrl, did, resourceId, accreditationId, or accreditationDid'
      });
    }
    
    // Reinstate accreditation
    const result = await trustRegistryService.reinstateAccreditation(reinstatementOptions);
    
    res.json(result);
  } catch (error) {
    logger.error('Error reinstating accreditation', { 
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: `Failed to reinstate accreditation: ${error.message}`
    });
  }
}

module.exports = {
  issueAccreditation,
  verifyAccreditation,
  revokeAccreditation,
  suspendAccreditation,
  reinstateAccreditation
}; 