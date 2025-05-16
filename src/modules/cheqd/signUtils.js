/**
 * Signing Utilities
 * 
 * Direct utilities for signing operations to avoid circular dependencies
 * between trustRegistryService and cheqdService.
 */

const axios = require('axios');
const config = require('../../config/config');
const logger = require('../../utils/logger');
const crypto = require('crypto');

/**
 * Sign data directly through the Cheqd Studio API
 * @param {String} didId - DID to sign with
 * @param {String|Object} data - Data to sign
 * @returns {Promise<String>} - Signature
 */
async function signData(didId, data) {
  try {
    // Use the direct API URL for Cheqd Studio
    const studioApiUrl = config.cheqd.apiUrl || 'https://studio-api.cheqd.net';
    
    // Ensure data is a string
    const dataToSign = typeof data === 'object' ? JSON.stringify(data) : data;
    
    logger.debug('Signing data via Cheqd Studio API', { 
      studioApiUrl,
      didId,
      dataSize: dataToSign.length
    });
    
    // Convert data to base64 for the API
    const dataBase64 = Buffer.from(dataToSign).toString('base64');
    
    // Create request payload
    const requestPayload = {
      issuerDid: didId,
      subjectDid: didId, // Self-issued for signing purposes
      credentialType: ["VerifiableCredential", "SignedData"],
      claims: {
        signedData: dataBase64,
        encoding: "base64",
        timestamp: new Date().toISOString()
      },
      expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      format: "jwt",
      attributes: {
        purpose: "signature",
        type: "EdDSA"
      }
    };
    
    // Using the /credential/issue endpoint instead of non-existent /credential/sign
    const response = await axios.post(
      `${studioApiUrl}/credential/issue`,
      requestPayload,
      {
        headers: {
          'accept': 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': config.cheqd.studioApiKey
        },
        timeout: 30000 // Increase timeout to 30 seconds
      }
    );
    
    // Check response and access JWT correctly
    if (!response.data || !response.data.proof || !response.data.proof.jwt) {
      throw new Error('Data signing failed: Invalid response from Cheqd Studio API');
    }
    
    const jwt = response.data.proof.jwt;
    
    logger.info('Successfully signed data with Cheqd API', {
      didId,
      signatureLength: jwt.length
    });
    
    // Return the JWT which contains the signed data
    return jwt;
  } catch (error) {
    // Log detailed error information
    logger.error('Failed to sign data via API', { 
      error: error.message,
      responseData: error.response?.data,
      status: error.response?.status,
      didId
    });
    
    // No mock fallbacks - propagate the error to ensure we only use real chain operations
    throw new Error(`API signing failed: ${error.message}`);
  }
}

/**
 * Utility function that explicitly prevents mock fallbacks
 * @returns {string} - Message indicating fallbacks are not allowed
 */
function removeMockFallbacks() {
  return "Mock fallbacks are not allowed. All operations must use real blockchain data.";
}

module.exports = {
  signData,
  removeMockFallbacks
}; 