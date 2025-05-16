/**
 * DID Utilities
 * 
 * Direct utilities for DID operations to avoid circular dependencies
 * between trustRegistryService and cheqdService.
 */

const axios = require('axios');
const config = require('../../config/config');
const logger = require('../../utils/logger');
const sqliteService = require('../../db/sqliteService');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new DID directly through the Cheqd Studio API
 * @param {Object} options - Options for DID creation
 * @returns {Promise<Object>} - Created DID information
 */
async function createDID(options = {}) {
  try {
    const ownerId = options.ownerId || options.userId || 'system';
    const method = options.method || 'cheqd';
    
    // Generate a random key for testing
    const key = crypto.randomBytes(32).toString('hex');
    
    // Determine network
    const network = method.includes(':') ? method.split(':')[2] : config.cheqd.networkId || 'testnet';
    
    // Use the direct API URL for Cheqd Studio
    const studioApiUrl = config.cheqd.apiUrl || 'https://studio-api.cheqd.net';
    
    logger.debug('Creating DID via Cheqd Studio API', { 
      studioApiUrl,
      network,
      ownerId
    });
    
    // Ensure we explicitly enable all verification methods when creating DID
    // This is important for signing capabilities later
    const response = await axios.post(
      `${studioApiUrl}/did/create`,
      {
        network: network,
        identifierFormatType: "uuid",
        
        // Enable ALL verification methods for maximum flexibility
        assertionMethod: true,
        authentication: true,
        keyAgreement: true,
        capabilityInvocation: true,
        capabilityDelegation: true,
        
        verificationMethodType: "Ed25519VerificationKey2018",
        options: { key }
      },
      {
        headers: {
          'accept': 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': config.cheqd.studioApiKey
        },
        timeout: 60000 // Increase timeout to 60 seconds for blockchain operations
      }
    );
    
    // Check response
    if (!response.data || !response.data.did) {
      throw new Error('DID creation failed: Invalid response from Cheqd Studio API');
    }
    
    const didResult = response.data;
    const didId = didResult.did;
    logger.info(`DID created successfully: ${didId}`);
    
    // Get the full DID document
    const didDocument = {
      id: didId,
      controller: didId,
      verificationMethod: [],
      authentication: [],
      assertionMethod: []
    };
    
    // Add verification methods
    if (didResult.keys && Array.isArray(didResult.keys)) {
      didResult.keys.forEach(key => {
        if (key.publicKeyHex) {
          const verificationMethod = {
            id: `${didId}#${key.kid}`,
            type: key.type || 'Ed25519VerificationKey2018',
            controller: didId,
            publicKeyHex: key.publicKeyHex
          };
          didDocument.verificationMethod.push(verificationMethod);
          
          // Add references to authentication and assertionMethod
          didDocument.authentication.push(`${didId}#${key.kid}`);
          didDocument.assertionMethod.push(`${didId}#${key.kid}`);
        }
      });
    }
    
    // Check if we can store this DID in the database (Optional, best effort)
    try {
      await sqliteService.db.run(
        'INSERT OR IGNORE INTO cheqd_dids (did, owner_id, created_at, metadata, keys) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)',
        [
          didId, 
          ownerId.toString(),
          JSON.stringify(didDocument),
          JSON.stringify(didResult.keys || [])
        ]
      );
      logger.debug(`DID ${didId} stored in local database`);
    } catch (dbError) {
      // Attempt to create the table if it doesn't exist
      try {
        await sqliteService.db.exec(`
          CREATE TABLE IF NOT EXISTS cheqd_dids (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            did TEXT UNIQUE,
            owner_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            metadata TEXT,
            keys TEXT
          )
        `);
        
        // Retry the insert
        await sqliteService.db.run(
          'INSERT OR IGNORE INTO cheqd_dids (did, owner_id, created_at, metadata, keys) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)',
          [
            didId, 
            ownerId.toString(),
            JSON.stringify(didDocument),
            JSON.stringify(didResult.keys || [])
          ]
        );
        logger.debug(`DID ${didId} stored in local database after creating table`);
      } catch (retryError) {
        logger.warn(`Could not store DID in database, but continuing: ${retryError.message}`);
      }
    }
    
    return {
      did: didId,
      keys: didResult.keys,
      document: didDocument
    };
  } catch (error) {
    logger.error('Failed to create DID via API', { 
      error: error.message,
      responseData: error.response?.data,
      status: error.response?.status,
      options
    });
    
    // No mock fallbacks - propagate the error to ensure we only use real chain operations
    throw new Error(`DID creation failed: ${error.message}`);
  }
}

module.exports = {
  createDID
}; 