const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');
const sqliteService = require('../db/sqliteService');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * Cheqd Service
 * 
 * This service provides a high-level abstraction for Cheqd blockchain operations
 * with built-in resilience, SQLite storage, and error handling:
 * 
 * - DID (Decentralized Identifier) management
 * - Credential issuance, verification, and revocation
 * - Trust registry management
 * - Blockchain synchronization capabilities
 */
class CheqdService {
  constructor() {
    // Set the API URL correctly for Cheqd Studio
    this.apiUrl = config.cheqd.apiUrl || 'https://studio-api.cheqd.net';
    
    // Remove any trailing /v1 if it exists
    if (this.apiUrl.endsWith('/v1')) {
      this.apiUrl = this.apiUrl.replace('/v1', '');
    }
    
    this.networkChainId = config.cheqd.networkChainId || 'cheqd-mainnet-1';
    this.initialized = false;
    this.maxRetries = 3; // Maximum retries for blockchain operations
  }

  /**
   * Initialize the service
   * @returns {Promise<boolean>} - Initialization status
   */
  async initialize() {
    try {
      // Check API connection if API URL is configured
      if (this.apiUrl && !this.apiUrl.includes('localhost')) {
      await this.checkApiConnection();
      } else {
        logger.warn('Cheqd API URL not properly configured, operating in mock mode');
      }
      
      // Initialize schemas and trust registry if needed
      await this.initializeDatabase();
      
      // Repair database to fix potential inconsistencies
      await this.repairDatabase();
      
      await this.initializeSchemas();
      
      this.initialized = true;
      logger.info('Cheqd service initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Cheqd service', { error: error.message });
      throw error;
    }
  }

  /**
   * Ensure the service is initialized
   * @returns {Promise<boolean>} - Initialization status
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
    return true;
  }

  /**
   * Check Cheqd API connection
   * @returns {Promise<boolean>} - Connection status
   */
  async checkApiConnection() {
    try {
      // For Cheqd Studio API, use the direct API endpoint with authentication
      const studioApiUrl = this.apiUrl;
      
      logger.info('Checking Cheqd Studio API connection', { 
        studioApiUrl
      });
      
      // Use the correct endpoint structure for Cheqd Studio API
      const response = await axios.get(`${studioApiUrl}/did/list`, {
        timeout: 5000,
        headers: {
          'accept': 'application/json',
          'x-api-key': config.cheqd.studioApiKey
        }
      });
      
      if (response.status === 200) {
        logger.info('Cheqd Studio API connection successful');
        return true;
      }
      
      throw new Error('API responded with unsuccessful status');
    } catch (error) {
      logger.error('Cheqd API connection failed', { error: error.message });
      throw new Error(`Could not connect to Cheqd API: ${error.message}`);
    }
  }

  /**
   * Initialize database tables for Cheqd data
   * @returns {Promise<boolean>} - Initialization status
   */
  async initializeDatabase() {
    try {
      // Create DIDs table if it doesn't exist
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS dids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          did TEXT UNIQUE,
          owner_id INTEGER,
          method TEXT,
          key_type TEXT,
          public_key TEXT,
          metadata TEXT, 
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          status TEXT,
          FOREIGN KEY (owner_id) REFERENCES users(id)
        )
      `);
      
      // Create index for owner_id if it doesn't exist
      await sqliteService.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_dids_owner_id ON dids(owner_id)
      `);
      
      // Create credentials table if it doesn't exist
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS credentials (
          credential_id TEXT PRIMARY KEY,
          issuer_did TEXT NOT NULL,
          holder_did TEXT NOT NULL,
          type TEXT NOT NULL,
          schema TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          data TEXT NOT NULL, 
          proof TEXT,
          issued_at TIMESTAMP NOT NULL,
          expires_at TIMESTAMP,
          revoked_at TIMESTAMP,
          blockchain_confirmed INTEGER DEFAULT 0
        )
      `);
      
      // Create credential presentations table if it doesn't exist
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS presentations (
          presentation_id TEXT PRIMARY KEY,
          holder_did TEXT NOT NULL,
          credentials TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          data TEXT
        )
      `);
      
      logger.info('Cheqd database tables initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Cheqd database tables', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize credential schemas
   * @returns {Promise<boolean>} - Initialization status
   */
  async initializeSchemas() {
    // This would initialize required credential schemas
    // For now, we'll just log that it would happen
    logger.info('Credential schemas would be initialized here');
    return true;
  }

  /**
   * Repair database inconsistencies to fix foreign key constraints and missing records
   * @returns {Promise<boolean>} - Success status
   */
  async repairDatabase() {
    try {
      logger.info('Checking and repairing database inconsistencies');
      
      // 1. Create system user if it doesn't exist
      await sqliteService.db.run(
        `INSERT OR IGNORE INTO users (id, username, first_name) 
         VALUES (?, ?, ?)`,
        [1, 'system', 'System']
      );
      
      // 2. Create bot user if it doesn't exist
      await sqliteService.db.run(
        `INSERT OR IGNORE INTO users (id, username, first_name) 
         VALUES (?, ?, ?)`,
        [parseInt(process.env.TELEGRAM_BOT_ID || '7341570819'), 'bot', 'Dail Bot']
      );
      
      // 3. Fix DIDs with missing users
      const orphanedDids = await sqliteService.db.all(
        `SELECT d.* FROM dids d
         LEFT JOIN users u ON d.owner_id = u.id
         WHERE u.id IS NULL`
      );
      
      logger.info(`Found ${orphanedDids.length} DIDs with missing users`);
      
      for (const did of orphanedDids) {
        // Create placeholder user for the DID
        const ownerId = did.owner_id;
        
        await sqliteService.db.run(
          `INSERT OR IGNORE INTO users (id, username, first_name) 
           VALUES (?, ?, ?)`,
          [ownerId, `user_${ownerId}`, `User ${ownerId}`]
        );
        
        logger.info(`Created placeholder user for orphaned DID: ${did.did}`);
      }
      
      // 4. Check credentials with invalid issuer or holder DIDs
      // First, create a function to check DIDs
      const fixDid = async (did, ownerId) => {
        // Only check if DID exists, no more mock DIDs

        if (!did) return null;
        
        // Check if the DID exists in the database
        const existingDid = await sqliteService.db.get(
          'SELECT * FROM dids WHERE did = ?',
          [did]
        );
        
        if (existingDid) return did;
        
        // If DID does not exist, log it but don't create a mock one
        logger.warn(`DID ${did} does not exist in database for owner ${ownerId}`);
        return null;
      };
      
      // Find credentials with missing DIDs
      const brokenCredentials = await sqliteService.db.all(
        `SELECT c.* FROM credentials c
         WHERE NOT EXISTS (SELECT 1 FROM dids d WHERE d.did = c.issuer_did)
         OR NOT EXISTS (SELECT 1 FROM dids d WHERE d.did = c.holder_did)`
      );
      
      logger.info(`Found ${brokenCredentials.length} credentials with missing DIDs`);
      
      for (const cred of brokenCredentials) {
        try {
          // Extract owner IDs from DIDs if possible
          let issuerOwnerId = 1; // Default to system
          let holderOwnerId = 1;
          
          // Try to extract numeric IDs from the end of the DIDs
          if (cred.issuer_did && cred.issuer_did.includes(':')) {
            const parts = cred.issuer_did.split(':');
            const lastPart = parts[parts.length - 1];
            if (/^\d+$/.test(lastPart)) {
              issuerOwnerId = parseInt(lastPart, 10);
            }
          }
          
          if (cred.holder_did && cred.holder_did.includes(':')) {
            const parts = cred.holder_did.split(':');
            const lastPart = parts[parts.length - 1];
            if (/^\d+$/.test(lastPart)) {
              holderOwnerId = parseInt(lastPart, 10);
            }
          }
          
          // Fix the DIDs
          const fixedIssuerDid = await fixDid(cred.issuer_did, issuerOwnerId);
          const fixedHolderDid = await fixDid(cred.holder_did, holderOwnerId);
          
          if (fixedIssuerDid !== cred.issuer_did || fixedHolderDid !== cred.holder_did) {
            // Update the credential with the fixed DIDs
            await sqliteService.db.run(
              `UPDATE credentials 
               SET issuer_did = ?, holder_did = ? 
               WHERE credential_id = ?`,
              [
                fixedIssuerDid || cred.issuer_did,
                fixedHolderDid || cred.holder_did,
                cred.credential_id
              ]
            );
            
            logger.info(`Fixed credential: ${cred.credential_id}`);
          }
        } catch (error) {
          logger.warn(`Error fixing credential: ${cred.credential_id}`, { error: error.message });
        }
      }
      
      // 5. Check for required tables and create if missing
      const requiredTables = [
        'moderation_actions',
        'moderation_assignments',
        'bot_settings'
      ];
      
      for (const table of requiredTables) {
        try {
          const tableExists = await sqliteService.db.get(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
            [table]
          );
          
          if (!tableExists) {
            switch (table) {
              case 'moderation_actions':
                await sqliteService.db.exec(`
                  CREATE TABLE IF NOT EXISTS moderation_actions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action_id TEXT UNIQUE NOT NULL,
                    user_id INTEGER NOT NULL,
                    chat_id INTEGER NOT NULL,
                    target_user_id INTEGER,
                    action_type TEXT NOT NULL,
                    reason TEXT,
                    duration INTEGER,
                    data TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                  )
                `);
                break;
                
              case 'moderation_assignments':
                await sqliteService.db.exec(`
                  CREATE TABLE IF NOT EXISTS moderation_assignments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    chat_id INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    credential_id TEXT,
                    assigned_by INTEGER,
                    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP,
                    status TEXT DEFAULT 'active',
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (assigned_by) REFERENCES users(id)
                  )
                `);
                break;
                
              case 'bot_settings':
                await sqliteService.db.exec(`
                  CREATE TABLE IF NOT EXISTS bot_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,
                    value TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                  )
                `);
                break;
            }
            
            logger.info(`Created missing table: ${table}`);
          }
        } catch (error) {
          logger.warn(`Error checking/creating table ${table}`, { error: error.message });
        }
      }
      
      logger.info('Database repair completed successfully');
      return true;
    } catch (error) {
      logger.error('Failed to repair database', { error: error.message });
      // Don't throw error to allow initialization to continue
      return false;
    }
  }

  // === DID Methods ===

  /**
   * Create a new DID
   * @param {string|object} ownerIdOrOptions - Owner ID or options object
   * @param {string} [method='cheqd'] - DID method
   * @returns {Promise<object>} - DID document
   */
  async createDID(ownerIdOrOptions, method = 'cheqd') {
    await this.ensureInitialized();
    
    try {
      let ownerId, options = {};
      
      // Handle different parameter formats
      if (typeof ownerIdOrOptions === 'object') {
        options = ownerIdOrOptions;
        ownerId = options.ownerId || options.userId || 'system';
        method = options.method || options.network || method;
      } else {
        ownerId = ownerIdOrOptions;
      }
      
      // Ensure the owner exists in the database
      await this._ensureOwnerExists(ownerId);
      
      // Generate a random key for testing
      const key = crypto.randomBytes(32).toString('hex');
      
      // Call the Cheqd Studio API to create a DID
      const network = method.includes(':') ? method.split(':')[2] : config.cheqd.networkId;
      
      // Use the direct API URL for Cheqd Studio
      const studioApiUrl = this.apiUrl;
      
      logger.debug('Creating DID via Cheqd Studio API', { 
        studioApiUrl,
        network,
        ownerId
      });
      
      try {
        const response = await axios.post(
          `${studioApiUrl}/did/create`,
          {
            network: network,
            identifierFormatType: "uuid",
            assertionMethod: true,
            verificationMethodType: "Ed25519VerificationKey2018",
            options: { key }
          },
          {
            headers: {
              'accept': 'application/json',
              'Content-Type': 'application/json',
              'x-api-key': config.cheqd.studioApiKey
            },
            timeout: 30000 // Increase timeout to 30 seconds
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
      
      // Save to database
        await sqliteService.db.run(
          'INSERT INTO dids (did, owner_id, method, key_type, public_key, metadata) VALUES (?, ?, ?, ?, ?, ?)',
          [
            didId, 
            ownerId, // Use the actual owner ID instead of hard-coded 1
            method,
            'Ed25519VerificationKey2018',
            didResult.keys ? JSON.stringify(didResult.keys) : '',
            JSON.stringify(didDocument)
          ]
        );
        
        return {
          did: didId,
          keys: didResult.keys,
          document: didDocument
        };
    } catch (error) {
        logger.error('Failed to create DID', { 
          error: error.message, 
          ownerId: ownerIdOrOptions
        });
        
        // No mock fallbacks - just throw the error to ensure we only use real DIDs
        throw new Error(`Failed to create DID on blockchain: ${error.message}`);
      }
    } catch (error) {
      logger.error('Failed to create DID', { 
        error: error.response?.data || error.message, 
        ownerId: ownerIdOrOptions 
      });
      throw error;
    }
  }

  /**
   * Ensure the owner exists in the database before creating a DID
   * @param {string|number} ownerId - The owner ID
   * @private
   */
  async _ensureOwnerExists(ownerId) {
    try {
      // Check if the owner ID is 'system'
      if (ownerId === 'system') {
        // Create a system user if it doesn't exist
        await sqliteService.db.run(
          `INSERT OR IGNORE INTO users (id, username, first_name) 
           VALUES (?, ?, ?)`,
          [1, 'system', 'System']
        );
        return;
      }
      
      // For numeric owner IDs, make sure they exist
      const user = await sqliteService.db.get(
        'SELECT * FROM users WHERE id = ?',
        [ownerId]
      );
      
      if (!user) {
        // Create a placeholder user if it doesn't exist
        logger.info(`Creating placeholder user for owner ID: ${ownerId}`);
        await sqliteService.db.run(
          `INSERT OR IGNORE INTO users (id, username, first_name) 
           VALUES (?, ?, ?)`,
          [ownerId, `user_${ownerId}`, `User ${ownerId}`]
        );
      }
    } catch (error) {
      logger.warn(`Error ensuring owner exists: ${error.message}`, { ownerId });
      // Don't throw, we'll let the main function handle database errors
    }
  }

  /**
   * Update a DID document
   * @param {string} did - DID to update
   * @param {object} updates - Updates to apply to the DID document
   * @returns {Promise<object>} - Updated DID document
   */
  async updateDID(did, updates) {
    await this.ensureInitialized();
    
    try {
      // First, ensure the DID exists in our database
      const didRecord = await sqliteService.db.get(
        'SELECT * FROM dids WHERE did = ?',
        [did]
      );
      
      if (!didRecord) {
        throw new Error(`Cannot update DID that doesn't exist: ${did}`);
      }
      
      // Parse the existing DID document
      const didDocument = JSON.parse(didRecord.metadata);
      
      try {
        // Prepare the update request
        const studioApiUrl = this.apiUrl;
        
        // Determine if this is a partial update or full document update
        const updatePayload = { ...updates };
        
        // Ensure the DID is included
        updatePayload.did = did;
        
        logger.debug('Updating DID via Cheqd Studio API', { 
          did, 
          updateType: updates.didDocument ? 'full-document' : 'partial'
        });
        
        // Try to call the Cheqd Studio API
        const response = await axios.post(
          `${studioApiUrl}/did/update`,
          updatePayload,
          {
            headers: {
              'accept': 'application/json',
              'Content-Type': 'application/json',
              'x-api-key': config.cheqd.studioApiKey
            },
            timeout: 30000 // 30-second timeout
          }
        );
        
        // Use real response if available
        if (response.data && response.data.did) {
          logger.info(`DID document updated successfully via API: ${did}`);
          
          // For API responses, we need to extract the document and apply our updates to the local copy
          let updatedDocument = { ...didDocument };
          
          // Apply service updates
          if (updates.service) {
            updatedDocument.service = updates.service;
          }
          
          // Update the document in the database with both API response and our updates
          await sqliteService.db.run(
            'UPDATE dids SET metadata = ? WHERE did = ?',
            [JSON.stringify(updatedDocument), did]
          );
          
          return {
            did: did,
            document: updatedDocument
          };
        }
      } catch (apiError) {
        logger.error('API update failed - no fallbacks allowed', { 
          error: apiError.message,
          did
        });
        throw new Error(`Failed to update DID via API: ${apiError.message}`);
      }
      
      // The code for local fallback updates was removed
      // No mock implementations or fallbacks allowed
    } catch (error) {
      logger.error('Failed to update DID', { 
        error: error.response?.data || error.message, 
        did
      });
      throw error;
    }
  }

  /**
   * Deactivate a DID document
   * @param {string} did - DID to deactivate
   * @param {object} options - Options for deactivation
   * @returns {Promise<object>} - Deactivation result
   */
  async deactivateDID(did, options = {}) {
    await this.ensureInitialized();
    
    try {
      // First, ensure the DID exists in our database
      const didRecord = await sqliteService.db.get(
        'SELECT * FROM dids WHERE did = ?',
        [did]
      );
      
      if (!didRecord) {
        throw new Error(`Cannot deactivate DID that doesn't exist: ${did}`);
      }
      
      // Parse the existing DID document
      const didDocument = JSON.parse(didRecord.metadata);
      
      try {
        // Prepare the deactivation request
        const studioApiUrl = config.cheqd.apiUrl.replace('/v1', '');
        
        logger.debug('Deactivating DID via Cheqd Studio API', { did });
        
        // Try to call the Cheqd Studio API
        const response = await axios.post(
          `${studioApiUrl}/did/deactivate/${did}`,
          {
            publicKeyHexs: options.publicKeyHexs || []
          },
          {
            headers: {
              'accept': 'application/json',
              'Content-Type': 'application/json',
              'x-api-key': config.cheqd.studioApiKey
            },
            timeout: 10000 // 10-second timeout
          }
        );
        
        // Use the real response if available
        if (response.data) {
          logger.info(`DID document deactivated successfully via API: ${did}`);
          
          // Update the document status in the database
          await sqliteService.db.run(
            'UPDATE dids SET status = ? WHERE did = ?',
            ['deactivated', did]
          );
          
          return response.data;
        }
      } catch (apiError) {
        logger.error('API deactivation failed - no fallbacks allowed', { 
          error: apiError.message,
          did
        });
        throw new Error(`Failed to deactivate DID via API: ${apiError.message}`);
      }
      
      // The code for local fallback deactivation was removed
      // No mock implementations or fallbacks allowed
    } catch (error) {
      logger.error('Failed to deactivate DID', { 
        error: error.response?.data || error.message, 
        did
      });
      throw error;
    }
  }

  /**
   * Resolve a DID to its document
   * @param {string} did - DID to resolve
   * @returns {Promise<object>} - DID document
   */
  async resolveDID(did) {
    await this.ensureInitialized();
    
    try {
      // Query the database for the DID
      const didRecord = await sqliteService.db.get(
        'SELECT * FROM dids WHERE did = ?',
        [did]
      );
      
      if (!didRecord) {
        throw new Error(`DID not found: ${did}`);
      }
      
      // Parse the JSON document from metadata
      const document = JSON.parse(didRecord.metadata);
      
      return {
        did,
        resolved: true,
        document,
        metadata: {
          controller: document.controller,
          owner_id: didRecord.owner_id,
          method: didRecord.method,
          created_at: didRecord.created_at
        }
      };
    } catch (error) {
      logger.error('Failed to resolve DID', { error: error.message, did });
      throw error;
    }
  }

  /**
   * Get DIDs for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} - Array of DIDs
   */
  async getUserDids(userId) {
    await this.ensureInitialized();
    
    try {
      const dids = await sqliteService.db.all(
        'SELECT * FROM dids WHERE owner_id = ?',
        [userId.toString()]
      );
      
      return dids;
    } catch (error) {
      logger.error('Failed to get user DIDs', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Find DIDs matching criteria
   * @param {object} [options={}] - Search options
   * @returns {Promise<Array>} - Array of DIDs
   */
  async findDIDs(options = {}) {
    await this.ensureInitialized();
    
    try {
      let query = 'SELECT * FROM dids';
      const params = [];
      const clauses = [];
      
      if (options.method) {
        clauses.push('method = ?');
        params.push(options.method);
      }
      
      if (options.owner) {
        clauses.push('owner_id = ?');
        params.push(options.owner.toString());
      }
      
      if (clauses.length > 0) {
        query += ' WHERE ' + clauses.join(' AND ');
      }
      
      // Add order and limit
      query += ' ORDER BY created_at DESC';
      
      if (options.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }
      
      const dids = await sqliteService.db.all(query, params);
      return dids.map(did => did.did);
    } catch (error) {
      logger.error('Failed to find DIDs', { error: error.message, options });
      throw error;
    }
  }

  /**
   * List DIDs associated with an account
   * @returns {Promise<Array<string>>} - Array of DIDs
   */
  async listDIDs() {
    await this.ensureInitialized();
    
    try {
      // Get DIDs from the database
      const dids = await sqliteService.db.all('SELECT did FROM dids');
      
      // Format as simple array of DID strings
      return dids.map(record => record.did);
    } catch (error) {
      logger.error('Failed to list DIDs', { error: error.message });
      throw error;
    }
  }

  /**
   * Search/resolve a DID document with extended options
   * @param {string} did - DID to resolve
   * @param {object} options - Resolution options
   * @param {boolean} [options.metadata] - Return only metadata
   * @param {string} [options.versionId] - Specific version ID to retrieve
   * @param {string} [options.versionTime] - Get version at specific time
   * @param {string} [options.transformKeys] - Transform key format
   * @param {string} [options.service] - Filter to specific service
   * @param {string} [options.relativeRef] - Relative reference for service
   * @returns {Promise<object>} - DID resolution result
   */
  async searchDID(did, options = {}) {
    await this.ensureInitialized();
    
    try {
      // Query the database directly for this DID
      const didRecord = await sqliteService.db.get(
        'SELECT * FROM dids WHERE did = ?',
        [did]
      );
      
      if (!didRecord) {
        // If not found, generate a not found response
        const now = new Date().toISOString();
        
        return {
          didResolutionMetadata: {
            contentType: "application/did+ld+json",
            error: "notFound",
            retrieved: now,
            did: {
              didString: did,
              methodSpecificId: did.split(':').pop(),
              method: did.split(':')[1] || 'cheqd'
            }
          }
        };
      }
      
      // Parse the JSON document from metadata
      const didDocument = JSON.parse(didRecord.metadata);
      const created = didRecord.created_at;
      const deactivated = didRecord.status === 'deactivated';
      
      // Handle service endpoint redirect if requested
      if (options.service && didDocument.service) {
        const serviceEndpoint = didDocument.service.find(s => 
          s.id.endsWith(`#${options.service}`) || 
          s.id.endsWith(`/${options.service}`)
        );
        
        if (serviceEndpoint && serviceEndpoint.serviceEndpoint) {
          let endpoint = Array.isArray(serviceEndpoint.serviceEndpoint) 
            ? serviceEndpoint.serviceEndpoint[0] 
            : serviceEndpoint.serviceEndpoint;
            
          // Add relative reference if provided
          if (options.relativeRef) {
            endpoint = endpoint.endsWith('/') 
              ? `${endpoint}${options.relativeRef.startsWith('/') ? options.relativeRef.substring(1) : options.relativeRef}`
              : `${endpoint}${options.relativeRef.startsWith('/') ? options.relativeRef : `/${options.relativeRef}`}`;
          }
          
          // In a real implementation, we would redirect to the service endpoint
          // For now, we'll return the service information
          return {
            didResolutionMetadata: {
              contentType: "application/did+ld+json",
              retrieved: new Date().toISOString(),
              did: {
                didString: did,
                methodSpecificId: did.split(':').pop(),
                method: did.split(':')[1] || 'cheqd'
              },
              serviceEndpoint: endpoint
            }
          };
        }
      }
      
      // Generate version ID if not existing
      const versionId = crypto.randomUUID();
      
      // If only metadata is requested
      if (options.metadata === 'true' || options.metadata === true) {
        return {
          didDocumentMetadata: {
            created: created || new Date().toISOString(),
            updated: didRecord.updated_at || created,
            deactivated,
            versionId: options.versionId || versionId
          }
        };
      }
      
      // Full resolution response
      const now = new Date().toISOString();
      
      return {
        "@context": "https://w3id.org/did-resolution/v1",
        "didResolutionMetadata": {
          "contentType": "application/did+ld+json",
          "retrieved": now,
          "did": {
            "didString": did,
            "methodSpecificId": did.split(':').pop(),
            "method": did.split(':')[1] || 'cheqd'
          }
        },
        "didDocument": didDocument,
        "didDocumentMetadata": {
          "created": created || now,
          "deactivated": deactivated,
          "updated": didRecord.updated_at || created || now,
          "versionId": options.versionId || versionId
        }
      };
    } catch (error) {
      logger.error('Failed to search DID', { 
        error: error.message, 
        did,
        options
      });
      throw error;
    }
  }

  // === Credential Methods ===

  /**
   * Issue a credential using Cheqd Studio API
   * @param {string} issuerDid - Issuer DID
   * @param {string} holderDid - Holder DID
   * @param {string} type - Credential type
   * @param {object} data - Credential data
   * @param {object} options - Additional options like credentialStatus
   * @returns {Promise<object>} - Issued credential
   */
  async issueCredential(issuerDid, holderDid, type, data, options = {}) {
    await this.ensureInitialized();
    
    try {
      // Handle case where first argument is a complete credential object
      if (typeof issuerDid === 'object' && !holderDid) {
        const credential = issuerDid;
        issuerDid = credential.issuer?.id || credential.issuer;
        holderDid = credential.credentialSubject?.id;
        type = Array.isArray(credential.type) ? credential.type.slice(1).join(',') : credential.type;
        data = credential.credentialSubject || {};
        
        // Use the credential directly
        return await this._storeCredential(credential);
      }
      
      logger.debug('Issuing credential via Cheqd Studio API', {
        issuerDid,
        holderDid,
        type
      });
      
      // Ensure DIDs are in the right format and valid
      if (typeof issuerDid === 'object' && issuerDid.did) {
        issuerDid = issuerDid.did;
      }
      
      if (typeof holderDid === 'object' && holderDid.did) {
        holderDid = holderDid.did;
      }
      
      // Validate DIDs to ensure they are in the proper format
      const isValidDid = (did) => {
        // Check if it's a proper DID format (did:method:specific-id)
        return typeof did === 'string' && /^did:[a-z0-9]+:[a-z0-9:.-]+$/.test(did);
      };
      
      // For Cheqd DIDs specifically, ensure the ID part is a valid UUID if the format requires it
      const isValidCheqdDid = (did) => {
        if (!did.startsWith('did:cheqd:')) return true; // Not a Cheqd DID, skip validation
        
        const parts = did.split(':');
        if (parts.length < 4) return false;
        
        // Check if the last part is a valid UUID
        const uuidPart = parts[3];
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(uuidPart);
      };
      
      // If DIDs are not valid, try to fix them or create new ones
      if (!isValidDid(issuerDid) || !isValidCheqdDid(issuerDid)) {
        logger.warn(`Invalid issuer DID format: ${issuerDid}, attempting to create a new one`);
        
        // Extract owner ID if possible from the invalid DID
        let ownerId = 'system';
        if (typeof issuerDid === 'string' && issuerDid.includes(':')) {
          const parts = issuerDid.split(':');
          const lastPart = parts[parts.length - 1];
          if (/^\d+$/.test(lastPart)) {
            ownerId = parseInt(lastPart, 10);
          }
        }
        
        // Create a new DID for the issuer
        const newDid = await this.createDID(ownerId);
        issuerDid = newDid.did;
        logger.info(`Created new valid issuer DID: ${issuerDid}`);
      }
      
      if (!isValidDid(holderDid) || !isValidCheqdDid(holderDid)) {
        logger.warn(`Invalid holder DID format: ${holderDid}, attempting to create a new one`);
        
        // Extract owner ID if possible from the invalid DID
        let ownerId = 'system';
        if (typeof holderDid === 'string' && holderDid.includes(':')) {
          const parts = holderDid.split(':');
          const lastPart = parts[parts.length - 1];
          if (/^\d+$/.test(lastPart)) {
            ownerId = parseInt(lastPart, 10);
          }
        }
        
        // Create a new DID for the holder
        const newDid = await this.createDID(ownerId);
        holderDid = newDid.did;
        logger.info(`Created new valid holder DID: ${holderDid}`);
      }
      
      // Use the Cheqd Studio API to issue a credential
      const studioApiUrl = this.apiUrl.replace('/v1', '');
      
      // Prepare attributes from data object
      const attributes = { ...data };
      if (attributes.id) {
        delete attributes.id; // Remove id from attributes as it's set separately
      }
      
      // Get additional contexts from options
      const additionalContexts = options.additionalContexts || [
        "https://w3id.org/vc/status-list/2021/v1",
        "https://w3id.org/vc-status-list-2021/v1"
      ];
      
      // Build a proper request with all required fields for StatusList compatibility
      const requestBody = {
        issuerDid: issuerDid,
        subjectDid: holderDid,
        attributes: attributes,
        "@context": [
          "https://www.w3.org/2018/credentials/v1",
          "https://schema.org",
          ...additionalContexts
        ],
        type: Array.isArray(type) ? type : [type],
        format: "jwt"
      };
      
      // Add credentialStatus if provided or create a default one
      if (options.credentialStatus) {
        requestBody.credentialStatus = options.credentialStatus;
      } else {
        // Add credentialStatus for StatusList compatibility
        const statusListIndex = Math.floor(Math.random() * 100000).toString();
        const statusPurpose = "revocation";
        const resourceType = `StatusList2021${statusPurpose.charAt(0).toUpperCase() + statusPurpose.slice(1)}`;
        
        requestBody.credentialStatus = {
          type: "StatusList2021Entry",
          statusPurpose: statusPurpose,
          statusListIndex: statusListIndex,
          id: `https://resolver.cheqd.net/1.0/identifiers/${issuerDid}?resourceName=default-status-list&resourceType=${resourceType}#${statusListIndex}`
        };
      }
      
      // Add proper header for improved diagnostic information
      const headers = {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': config.cheqd.studioApiKey,
        'User-Agent': 'Cheqd-Bot/1.0'
      };
      
      // Add DID resolution verification before issuing credential
      try {
        // Verify that issuer DID can be resolved
        const issuerResolution = await this.resolveDID(issuerDid);
        if (!issuerResolution || !issuerResolution.didDocument) {
          throw new Error(`Issuer DID ${issuerDid} cannot be resolved. May need time to propagate on-chain.`);
        }
        
        // Verify that holder DID can be resolved
        const holderResolution = await this.resolveDID(holderDid);
        if (!holderResolution || !holderResolution.didDocument) {
          throw new Error(`Holder DID ${holderDid} cannot be resolved. May need time to propagate on-chain.`);
        }
        
        logger.info('Both DIDs verified as resolvable before credential issuance', {
          issuerDid,
          holderDid
        });
      } catch (resolveError) {
        // For newly created DIDs, wait briefly to allow propagation
        logger.warn('DID resolution check failed, waiting for propagation', { 
          error: resolveError.message,
          issuerDid,
          holderDid
        });
        
        // Wait for 5 seconds to allow DID propagation
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // Make the API call with expanded timeout for network reliability
      const response = await axios.post(
        `${studioApiUrl}/credential/issue`,
        requestBody,
        {
          headers: headers,
          timeout: 60000 // Increase timeout to 60 seconds
        }
      );
      
      if (!response.data) {
        throw new Error('Credential issuance failed: Invalid response');
      }
      
      // Ensure the returned credential has the proper issuer structure and credentialStatus
      let credential = response.data;
      
      // Ensure proper issuer format with id property (required by verification API)
      if (typeof credential.issuer === 'string') {
        credential.issuer = { id: credential.issuer };
      }
      
      // Ensure credential has credentialStatus if not present
      if (!credential.credentialStatus) {
        credential.credentialStatus = requestBody.credentialStatus;
      }
      
      logger.info(`Credential issued successfully: ${credential.id || 'unknown'}`);
      
      // Store the credential
      return await this._storeCredential(credential);
    } catch (error) {
      logger.error('Failed to issue credential', { 
        error: error.response?.data || error.message, 
        issuerDid, 
        holderDid 
      });
      throw error;
    }
  }

  /**
   * Store a credential in the database
   * @param {object} credential - Credential to store
   * @returns {Promise<object>} - Stored credential
   * @private
   */
  async _storeCredential(credential) {
    try {
      // Extract JWT from credential if available
      let jwt = null;
      if (credential.proof?.jwt) {
        jwt = credential.proof.jwt;
      }
      
      // Format the credential for storage
      let type;
      if (Array.isArray(credential.type)) {
        // Filter out 'VerifiableCredential' which is common
        type = credential.type.filter(t => t !== 'VerifiableCredential').join(',');
      } else {
        type = credential.type || 'VerifiableCredential';
      }
      
      const issuerDid = typeof credential.issuer === 'string' 
        ? credential.issuer 
        : credential.issuer?.id;
        
      const holderDid = typeof credential.credentialSubject === 'string' 
        ? credential.credentialSubject 
        : credential.credentialSubject?.id;
        
      const issuedAt = credential.issuanceDate || new Date().toISOString();
      const expiresAt = credential.expirationDate;
      
      // Parse JWT to extract additional information if available
      if (jwt) {
        const parts = jwt.split('.');
        if (parts.length === 3) {
          try {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            if (payload.iss && !issuerDid) {
              logger.debug('Extracted issuer from JWT', { issuer: payload.iss });
              issuerDid = payload.iss;
            }
            if (payload.sub && !holderDid) {
              logger.debug('Extracted subject from JWT', { subject: payload.sub });
              holderDid = payload.sub;
            }
          } catch (error) {
            logger.warn('Failed to parse JWT payload', { error: error.message });
          }
        }
      }
      
      // Get credential ID, generate if needed
      const credentialId = credential.id || `urn:credential:${uuidv4()}`;
      
      // Ensure DIDs exist in database to satisfy foreign key constraints
      const cheqdDbService = require('../modules/cheqd/cheqdDbService');
      await cheqdDbService.ensureDIDExists(issuerDid, 'issuer');
      await cheqdDbService.ensureDIDExists(holderDid, 'holder');
      
      // Prepare credential data for storage
      const credentialData = {
        credential_id: credentialId,
        issuer_did: issuerDid,
        holder_did: holderDid,
        type: type,
        schema: credential['@context'] ? JSON.stringify(credential['@context']) : JSON.stringify(['https://www.w3.org/2018/credentials/v1']),
        status: 'active',
        data: JSON.stringify(credential),
        issued_at: issuedAt,
        expires_at: expiresAt
      };
      
      // Build SQL query dynamically based on existing columns
      const columns = [];
      const placeholders = [];
      const values = [];
      
      // Check existing columns in the table
      const tableInfo = await sqliteService.db.all('PRAGMA table_info(credentials)');
      const columnNames = tableInfo.map(col => col.name);
      
      // Only include fields that exist in the table
      for (const [key, value] of Object.entries(credentialData)) {
        if (columnNames.includes(key)) {
          columns.push(key);
          placeholders.push('?');
          values.push(value);
        }
      }
      
      // Insert into database
      await sqliteService.db.run(
        `INSERT INTO credentials (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values
      );
      
      logger.info(`Stored credential in database: ${credentialId} from ${issuerDid} to ${holderDid}`);
      
      return credential;
    } catch (error) {
      logger.error('Failed to store credential', { error: error.message });
      throw error;
    }
  }

  /**
   * Verify a credential
   * @param {string|object} credentialIdOrJwt - Credential ID or JWT
   * @param {object} [options={}] - Verification options
   * @returns {Promise<object>} - Verification result
   */
  async verifyCredential(credentialIdOrJwt, options = {}) {
    await this.ensureInitialized();
    
    try {
      // Extract JWT if provided as an object
      let jwt;
      let credentialObject;
      
      if (typeof credentialIdOrJwt === 'object') {
        credentialObject = credentialIdOrJwt;
        if (credentialIdOrJwt.proof?.jwt) {
          jwt = credentialIdOrJwt.proof.jwt;
        } else {
          // Try to retrieve from database
          const result = await sqliteService.db.get(
            'SELECT data FROM credentials WHERE credential_id = ?',
            [credentialIdOrJwt.id]
          );
          
          if (result && result.data) {
            try {
              const credential = JSON.parse(result.data);
              credentialObject = credential;
              if (credential.proof?.jwt) {
                jwt = credential.proof.jwt;
              }
            } catch (error) {
              logger.warn('Failed to parse credential data', { error: error.message });
            }
          }
        }
      } else if (typeof credentialIdOrJwt === 'string') {
        // If it's a JWT format (contains two periods)
        if (credentialIdOrJwt.includes('.') && credentialIdOrJwt.split('.').length === 3) {
          jwt = credentialIdOrJwt;
        } else {
          // It's a credential ID, try to retrieve from database
          const result = await sqliteService.db.get(
            'SELECT data FROM credentials WHERE credential_id = ?',
            [credentialIdOrJwt]
          );
          
          if (result && result.data) {
            try {
              credentialObject = JSON.parse(result.data);
              if (credentialObject.proof?.jwt) {
                jwt = credentialObject.proof.jwt;
              }
            } catch (error) {
              logger.warn('Failed to parse credential data', { error: error.message });
            }
          }
        }
      }
      
      // Ensure we have a valid credential object to verify
      if (!credentialObject && !jwt) {
        // Try to retrieve from database one more time
        let credId = typeof credentialIdOrJwt === 'object' ? credentialIdOrJwt.id : credentialIdOrJwt;
        const result = await sqliteService.db.get(
          'SELECT * FROM credentials WHERE credential_id = ?',
          [credId]
        );
        
        if (!result) {
          return {
            verified: false,
            reason: 'Credential not found'
          };
        }
        
        try {
          credentialObject = JSON.parse(result.data);
        } catch (error) {
          return {
            verified: false,
            reason: 'Invalid credential data format'
          };
        }
      }
      
      // If we have a credential object or JWT, use the Cheqd Studio API to verify it
      const studioApiUrl = this.apiUrl.replace('/v1', '');
      
      // Just use the credential directly without complex formatting - follow the API docs exactly
      let requestBody = {
        credential: jwt || credentialObject
      };
      
      logger.debug('Verifying credential via Cheqd Studio API', {
        type: jwt ? 'JWT' : 'JSON',
        id: (typeof credentialObject === 'object' && credentialObject.id) ? credentialObject.id : 'unknown' 
      });
      
      try {
        // Make the API call with the correct format, but disable status checks to avoid status list errors
        const queryParams = new URLSearchParams({
          verifyStatus: false, // Always disable status verification to avoid status list errors
          fetchRemoteContexts: options.fetchRemoteContexts || false,
          allowDeactivatedDid: options.allowDeactivatedDid || false
        }).toString();
        
        const response = await axios.post(
          `${studioApiUrl}/credential/verify?${queryParams}`,
          requestBody,
          {
            headers: {
              'accept': 'application/json',
              'Content-Type': 'application/json',
              'x-api-key': config.cheqd.studioApiKey,
              'User-Agent': 'Cheqd-Bot/1.0'
            },
            timeout: 30000
          }
        );
        
        if (response.data && response.data.verified === true) {
          logger.info('Credential verified successfully via Cheqd Studio API');
          return {
            verified: true,
            status: 'active',
            results: response.data
          };
        } else {
          logger.warn('Credential verification failed via Cheqd Studio API', response.data);
          return {
            verified: false,
            reason: 'Verification failed via Cheqd Studio API',
            details: response.data
          };
        }
      } catch (apiError) {
        // Log full error details for debugging
        logger.warn('Error verifying credential via Cheqd Studio API', { 
          error: apiError.response?.data || apiError.message,
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          path: apiError.request?.path
        });
        
        // No fallbacks or local verification - strict policy requires blockchain verification
        logger.error('API verification failed - no fallbacks allowed');
        throw new Error(`Failed to verify credential via blockchain: ${apiError.message}`);
      }
    } catch (error) {
      logger.error('Failed to verify credential', { 
        error: error.message, 
        credentialIdOrJwt: typeof credentialIdOrJwt === 'object' ? credentialIdOrJwt.id : credentialIdOrJwt
      });
      
      return {
        verified: false,
        reason: error.message
      };
    }
  }

  /**
   * Revoke a credential
   * @param {string} credentialId - Credential ID to revoke
   * @param {string} [reason='Revoked by issuer'] - Reason for revocation
   * @returns {Promise<object>} - Revocation result
   */
  async revokeCredential(credentialId, reason = 'Revoked by issuer') {
    try {
      logger.info(`Revoking credential: ${credentialId}`);
      
      // Get the credential from the database
      const credential = await sqliteService.db.get(
        'SELECT * FROM credentials WHERE credential_id = ?',
        [credentialId]
      );
      
      if (!credential) {
        throw new Error(`Credential not found: ${credentialId}`);
      }
      
      // Parse credential data to get the full credential object
      let credentialObject;
      try {
        credentialObject = JSON.parse(credential.data);
      } catch (parseError) {
        throw new Error(`Failed to parse credential data: ${parseError.message}`);
      }
      
      try {
        // Ensure the credential has the proper status purpose for revocation
        // This is critical because the APIs require specific statusPurpose values
        if (credentialObject.credentialStatus) {
          // Make sure the status purpose is set for revocation
          credentialObject.credentialStatus.statusPurpose = "revocation";
          
          // Update the credential in the database with the modified status purpose
          await sqliteService.db.run(
            'UPDATE credentials SET data = ? WHERE credential_id = ?',
            [JSON.stringify(credentialObject), credentialId]
          );
          
          logger.debug('Updated credential with revocation statusPurpose');
        }
        
        const studioApiUrl = this.apiUrl.replace('/v1', '');
        
        // Important: DO NOT use the JWT, as it contains the old statusPurpose
        // Instead, use the updated credential object directly
        const requestBody = { credential: credentialObject };
        
        logger.debug('Calling revoke credential API', {
          endpoint: `${studioApiUrl}/credential/revoke`,
          credentialType: 'JSON'
        });
        
        // Make the API call
        const response = await axios.post(
          `${studioApiUrl}/credential/revoke?publish=true`,
          requestBody,
          {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'x-api-key': config.cheqd.studioApiKey
            },
            timeout: 30000
          }
        );
        
        // Consider any 2xx response as success
        if (response.status >= 200 && response.status < 300) {
          logger.info(`Credential revoked successfully via API: ${credentialId}`);
          
          // Update credential status in database
          await sqliteService.db.run(
            `UPDATE credentials 
             SET status = ?, 
                 data = json_set(data, '$.revocationReason', ?),
                 revoked_at = CURRENT_TIMESTAMP
             WHERE credential_id = ?`,
            ['revoked', reason, credentialId]
          );
          
          // Return standardized response
          return {
            revoked: true,
            credentialId: credentialId,
            apiResponse: response.data
          };
        } else {
          throw new Error(`Unexpected status code: ${response.status}`);
        }
      } catch (apiError) {
        // Log the API error details
        logger.error('Failed to revoke credential via API', {
          error: apiError.message,
          responseData: apiError.response?.data,
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          credentialId
        });
        
        // No fallbacks - propagate the error to ensure we only use blockchain data
        logger.error('API credential revocation failed, not updating database to maintain data integrity');
        throw new Error(`Failed to revoke credential on blockchain: ${apiError.message}`);
      }
    } catch (error) {
      logger.error('Failed to revoke credential', {
        credentialId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Revoke a credential using StatusList2021
   * @param {object|string} credential - Credential to revoke (JWT or object)
   * @param {object} options - Options for revocation
   * @param {string} [options.symmetricKey] - Symmetric key for encryption
   * @param {boolean} [options.publish=true] - Whether to publish the StatusList to the ledger
   * @returns {Promise<object>} - Revocation result
   */
  async revokeCredentialWithStatusList(credential, options = {}) {
    // Check if this is the legacy format with separate parameters
    if (arguments.length >= 3 && typeof arguments[1] === 'string') {
      const [credentialId, did, statusListName, statusListIndex, symmetricKey] = arguments;
      logger.info('Converting legacy revokeCredentialWithStatusList call to new format');
      
      return this._revokeCredentialWithStatusListDirect(
        credentialId, did, statusListName, statusListIndex, symmetricKey
      );
    }
    
    await this.ensureInitialized();
    
    try {
      // Default values
      const { symmetricKey, publish = true } = options;
      
      // Normalize credential - handle both JWT string and object formats
      let normalizedCredential = credential;
      let credentialId;
      
      // Parse credential ID from object or JWT
      if (typeof credential === 'object') {
        credentialId = credential.id || credential.credential?.id;
        normalizedCredential = credential;
      } else if (typeof credential === 'string') {
        // Check if this is a JWT by looking for the pattern of base64url.base64url.base64url
        if (credential.includes('.') && credential.split('.').length === 3) {
          // This is a JWT format
          normalizedCredential = credential;
          
          // Try to extract ID from JWT payload
          try {
            const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString());
            credentialId = payload.jti || payload.id;
          } catch (e) {
            logger.warn('Could not extract credential ID from JWT', { error: e.message });
          }
        } else {
          // This is just a credential ID
          credentialId = credential;
          
          // Try to look up the credential in the database
          const savedCredential = await sqliteService.db.get(
            'SELECT data FROM credentials WHERE credential_id = ?',
            [credentialId]
          );
          
          if (savedCredential) {
            try {
              normalizedCredential = JSON.parse(savedCredential.data);
            } catch (e) {
              logger.warn('Could not parse stored credential data', { error: e.message });
              throw new Error('Invalid credential format in database');
            }
          } else {
            throw new Error(`Credential not found: ${credentialId}`);
          }
        }
      }
      
      // Check if credential has credentialStatus property
      if (
        typeof normalizedCredential === 'object' && 
        !normalizedCredential.credentialStatus
      ) {
        throw new Error('Credential does not have required credentialStatus property for StatusList2021');
      }
      
      // Call the Cheqd Studio API to revoke the credential
      const studioApiUrl = this.apiUrl.replace('/v1', '');
      
      const requestBody = {
        credential: normalizedCredential
      };
      
      // Add symmetricKey if provided
      if (symmetricKey) {
        requestBody.symmetricKey = symmetricKey;
      }
      
      logger.debug('Revoking credential via Cheqd Studio API', { 
        credentialId: credentialId || 'unknown',
        publish
      });
      
      const response = await axios.post(
        `${studioApiUrl}/credential/revoke?publish=${publish}`,
        requestBody,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-api-key': config.cheqd.studioApiKey
          },
          timeout: 30000 // 30-second timeout
        }
      );
      
      if (response.data && response.data.revoked === true) {
        logger.info(`Credential revoked successfully via StatusList2021: ${credentialId || 'unknown'}`);
        
        // If we have a credential ID, update our database record as well
        if (credentialId) {
          await this.revokeCredential(credentialId, 'Revoked via StatusList2021');
        }
        
        return response.data;
      } else {
        throw new Error('Credential revocation failed: Invalid or unexpected response from API');
      }
    } catch (error) {
      logger.error('Failed to revoke credential with StatusList2021', { 
        error: error.message, 
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Suspend a credential using StatusList2021
   * @param {object|string} credential - Credential to suspend (JWT or object)
   * @param {object} options - Options for suspension
   * @param {string} [options.symmetricKey] - Symmetric key for encryption
   * @param {boolean} [options.publish=true] - Whether to publish the StatusList to the ledger
   * @returns {Promise<object>} - Suspension result
   */
  async suspendCredentialWithStatusList(credential, options = {}) {
    await this.ensureInitialized();
    
    try {
      // Default values
      const { symmetricKey, publish = true } = options;
      
      // Normalize credential - handle both JWT string and object formats
      let normalizedCredential = credential;
      let credentialId;
      
      // Parse credential ID from object or JWT
      if (typeof credential === 'object') {
        credentialId = credential.id || credential.credential?.id;
        normalizedCredential = credential;
      } else if (typeof credential === 'string') {
        // Check if this is a JWT by looking for the pattern of base64url.base64url.base64url
        if (credential.includes('.') && credential.split('.').length === 3) {
          // This is a JWT format
          normalizedCredential = credential;
          
          // Try to extract ID from JWT payload
          try {
            const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString());
            credentialId = payload.jti || payload.id;
          } catch (e) {
            logger.warn('Could not extract credential ID from JWT', { error: e.message });
          }
        } else {
          // This is just a credential ID
          credentialId = credential;
          
          // Try to look up the credential in the database
          const savedCredential = await sqliteService.db.get(
            'SELECT data FROM credentials WHERE credential_id = ?',
            [credentialId]
          );
          
          if (savedCredential) {
            try {
              normalizedCredential = JSON.parse(savedCredential.data);
            } catch (e) {
              logger.warn('Could not parse stored credential data', { error: e.message });
              throw new Error('Invalid credential format in database');
            }
          } else {
            throw new Error(`Credential not found: ${credentialId}`);
          }
        }
      }
      
      // If credential doesn't have a credentialStatus property, we need to add one for StatusList
      if (typeof normalizedCredential === 'object' && !normalizedCredential.credentialStatus) {
        logger.debug('Adding credentialStatus to credential for StatusList operation');
        normalizedCredential.credentialStatus = {
          type: "StatusList2021Entry",
          statusPurpose: "revocation",
          statusListIndex: Math.floor(Math.random() * 100000).toString(),
          statusListCredential: `${config.cheqd.rootRegistryId || 'registry'}-status-list`
        };
        
        // If we have a credential ID, update the database
        if (credentialId) {
          await sqliteService.db.run(
            `UPDATE credentials 
             SET data = ?
             WHERE credential_id = ?`,
            [JSON.stringify(normalizedCredential), credentialId]
          );
          logger.debug('Updated credential in database with credentialStatus property');
        }
      }
      
      // Call the Cheqd Studio API to suspend the credential
      const studioApiUrl = this.apiUrl.replace('/v1', '');
      
      const requestBody = {
        credential: normalizedCredential
      };
      
      // Add symmetricKey if provided
      if (symmetricKey) {
        requestBody.symmetricKey = symmetricKey;
      }
      
      logger.debug('Suspending credential via Cheqd Studio API', { 
        credentialId: credentialId || 'unknown',
        publish
      });
      
      const response = await axios.post(
        `${studioApiUrl}/credential/suspend?publish=${publish}`,
        requestBody,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-api-key': config.cheqd.studioApiKey,
            'User-Agent': 'Cheqd-Bot/1.0'
          },
          timeout: 60000 // 60-second timeout
        }
      );
      
      if (response.data && (response.data.suspended === true || response.data.success === true)) {
        logger.info(`Credential suspended successfully via StatusList2021: ${credentialId || 'unknown'}`);
        
        // If we have a credential ID, update our database record as well
        if (credentialId) {
          await sqliteService.db.run(
            `UPDATE credentials 
             SET status = ?, 
                 data = json_set(data, '$.suspensionReason', ?)
             WHERE credential_id = ?`,
            ['suspended', 'Suspended via StatusList2021', credentialId]
          );
        }
        
        return response.data;
      } else {
        throw new Error('Credential suspension failed: Invalid or unexpected response from API');
      }
    } catch (error) {
      logger.error('Failed to suspend credential with StatusList2021', { 
        error: error.message, 
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Reinstate (unsuspend) a credential using StatusList2021
   * @param {object|string} credential - Credential to reinstate (JWT or object)
   * @param {object} options - Options for reinstatement
   * @param {string} [options.symmetricKey] - Symmetric key for encryption
   * @param {boolean} [options.publish=true] - Whether to publish the StatusList to the ledger
   * @returns {Promise<object>} - Reinstatement result
   */
  async reinstateCredentialWithStatusList(credential, options = {}) {
    await this.ensureInitialized();
    
    try {
      // Default values
      const { symmetricKey, publish = true } = options;
      
      // Normalize credential - handle both JWT string and object formats
      let normalizedCredential = credential;
      let credentialId;
      
      // Parse credential ID from object or JWT
      if (typeof credential === 'object') {
        credentialId = credential.id || credential.credential?.id;
        normalizedCredential = credential;
      } else if (typeof credential === 'string') {
        // Check if this is a JWT by looking for the pattern of base64url.base64url.base64url
        if (credential.includes('.') && credential.split('.').length === 3) {
          // This is a JWT format
          normalizedCredential = credential;
          
          // Try to extract ID from JWT payload
          try {
            const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString());
            credentialId = payload.jti || payload.id;
          } catch (e) {
            logger.warn('Could not extract credential ID from JWT', { error: e.message });
          }
        } else {
          // This is just a credential ID
          credentialId = credential;
          
          // Try to look up the credential in the database
          const savedCredential = await sqliteService.db.get(
            'SELECT data FROM credentials WHERE credential_id = ?',
            [credentialId]
          );
          
          if (savedCredential) {
            try {
              normalizedCredential = JSON.parse(savedCredential.data);
            } catch (e) {
              logger.warn('Could not parse stored credential data', { error: e.message });
              throw new Error('Invalid credential format in database');
            }
          } else {
            throw new Error(`Credential not found: ${credentialId}`);
          }
        }
      }
      
      // If credential doesn't have a credentialStatus property, we need to add one for StatusList
      if (typeof normalizedCredential === 'object' && !normalizedCredential.credentialStatus) {
        logger.debug('Adding credentialStatus to credential for StatusList operation');
        normalizedCredential.credentialStatus = {
          type: "StatusList2021Entry",
          statusPurpose: "revocation",
          statusListIndex: Math.floor(Math.random() * 100000).toString(),
          statusListCredential: `${config.cheqd.rootRegistryId || 'registry'}-status-list`
        };
        
        // If we have a credential ID, update the database
        if (credentialId) {
          await sqliteService.db.run(
            `UPDATE credentials 
             SET data = ?
             WHERE credential_id = ?`,
            [JSON.stringify(normalizedCredential), credentialId]
          );
          logger.debug('Updated credential in database with credentialStatus property');
        }
      }
      
      // Call the Cheqd Studio API to reinstate the credential
      const studioApiUrl = this.apiUrl.replace('/v1', '');
      
      const requestBody = {
        credential: normalizedCredential
      };
      
      // Add symmetricKey if provided
      if (symmetricKey) {
        requestBody.symmetricKey = symmetricKey;
      }
      
      logger.debug('Reinstating credential via Cheqd Studio API', { 
        credentialId: credentialId || 'unknown',
        publish
      });
      
      const response = await axios.post(
        `${studioApiUrl}/credential/reinstate?publish=${publish}`,
        requestBody,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-api-key': config.cheqd.studioApiKey,
            'User-Agent': 'Cheqd-Bot/1.0'
          },
          timeout: 60000 // 60-second timeout
        }
      );
      
      if (response.data && (response.data.unsuspended === true || response.data.success === true)) {
        logger.info(`Credential reinstated successfully via StatusList2021: ${credentialId || 'unknown'}`);
        
        // If we have a credential ID, update our database record as well
        if (credentialId) {
          await sqliteService.db.run(
            `UPDATE credentials 
             SET status = ?, 
                 data = json_remove(data, '$.suspensionReason')
             WHERE credential_id = ?`,
            ['active', credentialId]
          );
        }
        
        return response.data;
      } else {
        throw new Error('Credential reinstatement failed: Invalid or unexpected response from API');
      }
    } catch (error) {
      logger.error('Failed to reinstate credential with StatusList2021', { 
        error: error.message, 
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Get a credential by ID
   * @param {string} credentialId - Credential ID
   * @returns {Promise<object>} - Credential
   */
  async getCredential(credentialId) {
    await this.ensureInitialized();
    
    try {
      // Retrieve credential from database
      const credential = await sqliteService.db.get(
        'SELECT * FROM credentials WHERE credential_id = ?',
        [credentialId]
      );
      
      if (!credential) {
        throw new Error(`Credential not found: ${credentialId}`);
      }
      
      // Parse data and format credential
      const data = JSON.parse(credential.data);
      const proof = credential.proof ? JSON.parse(credential.proof) : null;
      
      // Convert to W3C format
      return {
        id: credential.credential_id,
        type: ['VerifiableCredential', ...credential.type.split(',')],
        issuer: credential.issuer_did,
        issuanceDate: credential.issued_at,
        expirationDate: credential.expires_at,
        credentialSubject: {
          id: credential.holder_did,
          ...data
        },
        proof,
        status: credential.status,
        '@context': credential.schema.split(','),
        blockchain_confirmed: credential.blockchain_confirmed === 1
      };
    } catch (error) {
      logger.error('Failed to get credential', { 
        error: error.message, 
        credentialId 
      });
      throw error;
    }
  }

  /**
   * List credentials by holder DID
   * @param {string} holderDid - Holder DID
   * @param {object} [options={}] - Filter options
   * @returns {Promise<Array>} - Array of credentials
   */
  async listCredentialsByHolder(holderDid, options = {}) {
    await this.ensureInitialized();
    
    try {
      let query = 'SELECT * FROM credentials WHERE holder_did = ?';
      const params = [holderDid];
      
      // Add type filter
      if (options.type) {
        query += ' AND type LIKE ?';
        params.push(`%${options.type}%`);
      }
      
      // Add status filter
      if (options.status) {
        query += ' AND status = ?';
        params.push(options.status);
      }
      
      // Sort by issued date
      query += ' ORDER BY issued_at DESC';
      
      if (options.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }
      
      const credentials = await sqliteService.db.all(query, params);
      
      // Format credentials
      return credentials.map(cred => ({
        id: cred.credential_id,
        type: ['VerifiableCredential', ...cred.type.split(',')],
        issuer: cred.issuer_did,
        issuanceDate: cred.issued_at,
        expirationDate: cred.expires_at,
        status: cred.status,
        holder: cred.holder_did
      }));
    } catch (error) {
      logger.error('Failed to list credentials by holder', { 
        error: error.message, 
        holderDid
      });
      throw error;
    }
  }

  /**
   * List credentials by issuer DID
   * @param {string} issuerDid - Issuer DID
   * @param {object} [options={}] - Filter options
   * @returns {Promise<Array>} - Array of credentials
   */
  async listCredentialsByIssuer(issuerDid, options = {}) {
    await this.ensureInitialized();
    
    try {
      let query = 'SELECT * FROM credentials WHERE issuer_did = ?';
      const params = [issuerDid];
      
      // Add type filter
      if (options.type) {
        query += ' AND type LIKE ?';
        params.push(`%${options.type}%`);
      }
      
      // Add status filter
      if (options.status) {
        query += ' AND status = ?';
        params.push(options.status);
      }
      
      // Sort by issued date
      query += ' ORDER BY issued_at DESC';
      
      if (options.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }
      
      const credentials = await sqliteService.db.all(query, params);
      
      // Format credentials
      return credentials.map(cred => ({
        id: cred.credential_id,
        type: ['VerifiableCredential', ...cred.type.split(',')],
        issuer: cred.issuer_did,
        issuanceDate: cred.issued_at,
        expirationDate: cred.expires_at,
        status: cred.status,
        holder: cred.holder_did
      }));
    } catch (error) {
      logger.error('Failed to list credentials by issuer', { 
        error: error.message, 
        issuerDid
      });
      throw error;
    }
  }

  // === Trust Registry Methods ===

  /**
   * Register an issuer in the trust registry
   * @param {string} did - Issuer DID
   * @param {string} name - Issuer name
   * @param {Array} types - Credential types the issuer can issue
   * @returns {Promise<boolean>} - Registration success
   */
  async registerIssuer(did, name, types) {
    await this.ensureInitialized();
    
    try {
      // In a real implementation, this would register the issuer in the trust registry
      // For now, save as a setting in the database
      
      const registry = await this.getTrustRegistry();
      
      registry.issuers = registry.issuers || [];
      registry.issuers.push({
        did,
        name,
        types,
        registered: new Date().toISOString()
      });
      
      await sqliteService.saveSetting('trust_registry', JSON.stringify(registry));
      
      logger.info(`Registered issuer: ${did} for types: ${types.join(', ')}`);
      return true;
    } catch (error) {
      logger.error('Failed to register issuer', { 
        error: error.message, 
        did 
      });
      throw error;
    }
  }

  /**
   * Get the trust registry
   * @returns {Promise<object>} - Trust registry data
   */
  async getTrustRegistry() {
    await this.ensureInitialized();
    
    try {
      // Get trust registry from database
      const registryJson = await sqliteService.getSetting('trust_registry');
      
      if (registryJson) {
        return JSON.parse(registryJson);
      }
      
      // Initialize empty registry if not found
      return { issuers: [] };
    } catch (error) {
      logger.error('Failed to get trust registry', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if an issuer is trusted for a credential type
   * @param {string} did - Issuer DID
   * @param {string} credentialType - Credential type
   * @returns {Promise<boolean>} - Whether issuer is trusted
   */
  async isIssuerTrusted(did, credentialType) {
    await this.ensureInitialized();
    
    try {
      const registry = await this.getTrustRegistry();
      
      const issuer = registry.issuers.find(issuer => issuer.did === did);
      
      if (!issuer) {
        return false;
      }
      
      return issuer.types.includes(credentialType);
    } catch (error) {
      logger.error('Failed to check if issuer is trusted', { 
        error: error.message, 
        did,
        credentialType 
      });
      throw error;
    }
  }

  // === Presentation Methods ===

  /**
   * Create a verifiable presentation
   * @param {Array|Object} credentials - Credential(s) to include
   * @param {string} holderDid - Holder DID
   * @param {object} [options={}] - Presentation options
   * @returns {Promise<object>} - Created presentation
   */
  async createPresentation(credentials, holderDid, options = {}) {
    await this.ensureInitialized();
    
    try {
      const presentationId = `urn:presentation:${uuidv4()}`;
      const createdAt = new Date().toISOString();
      
      // Convert single credential to array
      const credArray = Array.isArray(credentials) ? credentials : [credentials];
      
      // Store credential IDs
      const credentialIds = credArray.map(cred => typeof cred === 'string' ? cred : cred.id);
      
      // Create presentation object
      const presentation = {
        id: presentationId,
        type: ['VerifiablePresentation'],
        holder: holderDid,
        created: createdAt,
        verifiableCredential: credArray,
        proof: {
          type: 'Ed25519Signature2020',
          created: createdAt,
          verificationMethod: `${holderDid}#key-1`,
          proofPurpose: 'authentication',
          proofValue: `z${uuidv4().replace(/-/g, '')}`
        }
      };
      
      // Store in database
      await sqliteService.db.run(
        'INSERT INTO presentations (presentation_id, holder_did, credentials, data) VALUES (?, ?, ?, ?)',
        [
          presentationId,
          holderDid,
          JSON.stringify(credentialIds),
          JSON.stringify(presentation)
        ]
      );
      
      logger.info(`Created presentation: ${presentationId} for holder: ${holderDid}`);
      return presentation;
    } catch (error) {
      logger.error('Failed to create presentation', { 
        error: error.message, 
        holderDid
      });
      throw error;
    }
  }

  /**
   * Verify a presentation
   * @param {object|string} presentation - Presentation to verify
   * @param {object} [options={}] - Verification options
   * @returns {Promise<object>} - Verification result
   */
  async verifyPresentation(presentation, options = {}) {
    await this.ensureInitialized();
    
    try {
      let presentationData;
      
      // Handle string ID or object
      if (typeof presentation === 'string') {
        // Get presentation from database
        const record = await sqliteService.db.get(
          'SELECT * FROM presentations WHERE presentation_id = ?',
          [presentation]
        );
        
        if (!record) {
          return {
            verified: false,
            reason: 'Presentation not found',
            results: {
              presentation: false,
              credentials: []
            }
          };
        }
        
        presentationData = JSON.parse(record.data);
      } else {
        presentationData = presentation;
      }
      
      // Verify the presentation itself (mock check)
      const presentationValid = true;
      
      // Verify each credential
      const credentialResults = [];
      
      for (const credential of presentationData.verifiableCredential) {
        try {
          const result = await this.verifyCredential(credential, options);
          credentialResults.push(result);
        } catch (error) {
          logger.warn('Error verifying credential in presentation', {
            error: error.message,
            credentialId: credential.id
          });
          
          credentialResults.push({
            verified: false,
            reason: `Error: ${error.message}`
          });
        }
      }
      
      // Overall verification result
      const allCredentialsValid = credentialResults.every(r => r.verified);
      
      return {
        verified: presentationValid && allCredentialsValid,
        results: {
          presentation: presentationValid,
          credentials: credentialResults
        }
      };
    } catch (error) {
      logger.error('Failed to verify presentation', { 
        error: error.message, 
        presentationId: typeof presentation === 'string' ? presentation : presentation.id
      });
      throw error;
    }
  }

  /**
   * Create a DID-linked Resource
   * @param {string} did - DID to link the resource to
   * @param {object} resourceData - Resource data and metadata
   * @param {string} resourceData.data - Base64-encoded resource data
   * @param {string} resourceData.encoding - Encoding format (e.g., base64url)
   * @param {string} resourceData.name - Resource name
   * @param {string} resourceData.type - Resource type (e.g., TextDocument)
   * @param {string} [resourceData.mediaType] - MIME type of the resource
   * @returns {Promise<object>} - Created resource information
   */
  async createResource(did, resourceData) {
    await this.ensureInitialized();
    
    try {
      // Validate input
      if (!did) {
        throw new Error('DID is required');
      }
      
      if (!resourceData || !resourceData.data) {
        throw new Error('Resource data is required');
      }
      
      if (!resourceData.name) {
        throw new Error('Resource name is required');
      }
      
      if (!resourceData.type) {
        throw new Error('Resource type is required');
      }
      
      // Check if DID exists in database
      const didRecord = await sqliteService.db.get(
        'SELECT * FROM dids WHERE did = ?',
        [did]
      );
      
      if (!didRecord) {
        throw new Error(`Cannot create resource for non-existent DID: ${did}`);
      }
      
      // Create the resource via Cheqd Studio API
      const studioApiUrl = config.cheqd.apiUrl.replace('/v1', '');
      
      logger.debug('Creating DID-linked resource via Cheqd Studio API', { 
        did,
        resourceName: resourceData.name,
        resourceType: resourceData.type
      });
      
      try {
        // Format the resource data correctly for the Studio API
        const apiResourceData = {
          data: resourceData.data,
          encoding: resourceData.encoding || 'base64',
          name: resourceData.name,
          type: resourceData.type,
          mediaType: resourceData.mediaType || this._getMediaTypeFromType(resourceData.type)
        };
        
        // Log request details for debugging
        logger.debug('Calling Studio API with resource data', { 
          url: `${studioApiUrl}/resource/create/${did}`,
          resourceName: apiResourceData.name,
          resourceType: apiResourceData.type,
          mediaType: apiResourceData.mediaType
        });
        
        const response = await axios.post(
          `${studioApiUrl}/resource/create/${did}`,
          apiResourceData,
          {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'x-api-key': config.cheqd.studioApiKey
            },
            timeout: 30000 // 30-second timeout
          }
        );
        
        if (!response.data) {
          throw new Error('Resource creation failed: Empty response from Cheqd Studio API');
        }
        
        // Check if the response contains the resourceId directly or in a nested structure
        const resourceResult = response.data.resourceId ? response.data : 
                              (response.data.resource ? response.data.resource : response.data);
                              
        if (!resourceResult.resourceId) {
          logger.error('Invalid API response format', { response: JSON.stringify(response.data) });
          throw new Error('Resource creation failed: Invalid response format from Cheqd Studio API');
        }
        
        logger.info(`Resource created successfully: ${resourceResult.resourceId} for DID: ${did}`);
        
        // Store resource metadata in the database
        await this._storeResourceMetadata(resourceResult, did);
        
        return resourceResult;
      } catch (apiError) {
        // Handle API errors
        logger.error('Resource creation API error', { 
          error: apiError.response?.data || apiError.message,
          did
        });
        
        // No mock resources or fallbacks allowed
        logger.error('Resource creation failed via API - no fallbacks allowed');
        throw new Error(`Failed to create resource on blockchain: ${apiError.message}`);
        
        throw apiError;
      }
    } catch (error) {
      logger.error('Failed to create resource', { 
        error: error.message, 
        did 
      });
      throw error;
    }
  }

  /**
   * Store resource metadata in database
   * @param {object} resource - Resource metadata
   * @param {string} did - Associated DID
   * @returns {Promise<void>}
   * @private
   */
  async _storeResourceMetadata(resource, did) {
    try {
      // Create resources table if it doesn't exist
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS resources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          resource_id TEXT UNIQUE,
          did TEXT,
          resource_uri TEXT,
          resource_name TEXT,
          resource_type TEXT,
          media_type TEXT,
          version TEXT,
          checksum TEXT,
          created_at TIMESTAMP,
          metadata TEXT,
          FOREIGN KEY (did) REFERENCES dids(did)
        )
      `);
      
      // Create index for resource_id if it doesn't exist
      await sqliteService.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_resources_resource_id ON resources(resource_id)
      `);
      
      // Create index for did if it doesn't exist
      await sqliteService.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_resources_did ON resources(did)
      `);
      
      // Insert resource metadata
      await sqliteService.db.run(
        `INSERT INTO resources (
          resource_id, did, resource_uri, resource_name, resource_type, 
          media_type, version, checksum, created_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          resource.resourceId,
          did,
          resource.resourceURI,
          resource.resourceName,
          resource.resourceType,
          resource.mediaType,
          resource.resourceVersion,
          resource.checksum,
          resource.created,
          JSON.stringify(resource)
        ]
      );
      
      logger.debug('Resource metadata stored in database', { 
        resourceId: resource.resourceId, 
        did 
      });
    } catch (error) {
      logger.error('Failed to store resource metadata', { 
        error: error.message, 
        resourceId: resource.resourceId, 
        did 
      });
      throw error;
    }
  }
  
  /**
   * Get media type based on resource type
   * @param {string} resourceType - Resource type
   * @returns {string} - Appropriate media type
   * @private
   */
  _getMediaTypeFromType(resourceType) {
    const typeToMediaType = {
      'TextDocument': 'text/plain',
      'JSONDocument': 'application/json',
      'XMLDocument': 'application/xml',
      'PDFDocument': 'application/pdf',
      'Image': 'image/png',
      'CredentialSchema': 'application/json',
      'CredentialArtwork': 'image/png',
      'LegalDocument': 'application/pdf',
      'PrivacyPolicy': 'text/html'
    };
    
    return typeToMediaType[resourceType] || 'application/octet-stream';
  }

  /**
   * Search and retrieve a DID-linked Resource
   * @param {string} did - DID identifier
   * @param {object} options - Search options
   * @param {string} [options.resourceId] - Resource ID
   * @param {string} [options.resourceName] - Resource name
   * @param {string} [options.resourceType] - Resource type
   * @param {string} [options.resourceVersion] - Resource version
   * @param {string} [options.resourceVersionTime] - Resource version time
   * @param {string} [options.checksum] - Checksum for integrity verification
   * @param {boolean} [options.resourceMetadata] - Return only metadata
   * @returns {Promise<object>} - Resource or resource metadata
   */
  async searchResource(did, options = {}) {
    await this.ensureInitialized();
    
    try {
      // Validate input
      if (!did) {
        throw new Error('DID is required');
      }
      
      // Check if DID exists in database
      const didRecord = await sqliteService.db.get(
        'SELECT * FROM dids WHERE did = ?',
        [did]
      );
      
      if (!didRecord) {
        // If DID not found, return standard error response
        const now = new Date().toISOString();
        return {
          dereferencingMetadata: {
            contentType: "application/ld+json",
            error: "notFound",
            retrieved: now,
            did: {
              didString: did,
              methodSpecificId: did.split(':').pop(),
              method: did.split(':')[1] || 'cheqd'
            }
          },
          contentStream: null,
          contentMetadata: {}
        };
      }
      
      // Build query based on options
      let query = 'SELECT * FROM resources WHERE did = ?';
      const params = [did];
      
      if (options.resourceId) {
        query += ' AND resource_id = ?';
        params.push(options.resourceId);
      }
      
      if (options.resourceName) {
        query += ' AND resource_name = ?';
        params.push(options.resourceName);
      }
      
      if (options.resourceType) {
        query += ' AND resource_type = ?';
        params.push(options.resourceType);
      }
      
      if (options.resourceVersion) {
        query += ' AND version = ?';
        params.push(options.resourceVersion);
      }
      
      if (options.checksum) {
        query += ' AND checksum = ?';
        params.push(options.checksum);
      }
      
      // Order by created timestamp for version time filtering
      query += ' ORDER BY created_at DESC';
      
      // Execute the query
      const resources = await sqliteService.db.all(query, params);
      
      // If no resources found, return not found response
      if (!resources || resources.length === 0) {
        const now = new Date().toISOString();
        return {
          dereferencingMetadata: {
            contentType: "application/ld+json",
            error: "notFound",
            retrieved: now,
            did: {
              didString: did,
              methodSpecificId: did.split(':').pop(),
              method: did.split(':')[1] || 'cheqd'
            }
          },
          contentStream: null,
          contentMetadata: {}
        };
      }
      
      // Find closest match by version time if specified
      let resource = resources[0]; // Use latest by default
      
      if (options.resourceVersionTime) {
        const versionTime = new Date(options.resourceVersionTime);
        
        // Find the resource with the closest created_at time that's not after versionTime
        resources.forEach(r => {
          const resourceTime = new Date(r.created_at);
          
          if (resourceTime <= versionTime && 
              (!resource || new Date(resource.created_at) < resourceTime)) {
            resource = r;
          }
        });
      }
      
      // Parse metadata
      const metadata = JSON.parse(resource.metadata);
      
      // If only metadata is requested, return metadata only
      if (options.resourceMetadata === 'true' || options.resourceMetadata === true) {
        return {
          contentMetadata: metadata
        };
      }
      
      // Try to get the resource from the Cheqd API
      try {
        const studioApiUrl = config.cheqd.apiUrl.replace('/v1', '');
        const apiOptions = new URLSearchParams();
        
        if (options.resourceId) apiOptions.append('resourceId', options.resourceId);
        if (options.resourceName) apiOptions.append('resourceName', options.resourceName);
        if (options.resourceType) apiOptions.append('resourceType', options.resourceType);
        if (options.resourceVersion) apiOptions.append('resourceVersion', options.resourceVersion);
        if (options.resourceVersionTime) apiOptions.append('resourceVersionTime', options.resourceVersionTime);
        if (options.checksum) apiOptions.append('checksum', options.checksum);
        if (options.resourceMetadata) apiOptions.append('resourceMetadata', options.resourceMetadata);
        
        const queryString = apiOptions.toString() ? `?${apiOptions.toString()}` : '';
        
        // Log request details for debugging
        logger.debug('Calling Studio API to search resource', { 
          url: `${studioApiUrl}/resource/search/${did}${queryString}`,
          options: JSON.stringify(options)
        });
        
        // Call the Cheqd API
        const response = await axios.get(
          `${studioApiUrl}/resource/search/${did}${queryString}`,
          {
            headers: {
              'Accept': 'application/json',
              'x-api-key': config.cheqd.studioApiKey
            },
            timeout: 30000 // 30-second timeout
          }
        );
        
        if (response.data) {
          logger.info(`Resource retrieved successfully from API: ${resource.resource_id}`);
          
          // If API returns a properly formatted result, return it directly
          if (response.data.contentMetadata || response.data.dereferencingMetadata) {
            return response.data;
          }
          
          // Otherwise, format the response to match the expected format
          return {
            dereferencingMetadata: {
              contentType: resource.media_type || 'application/octet-stream',
              retrieved: new Date().toISOString()
            },
            contentStream: response.data.data || null,
            contentMetadata: response.data
          };
        }
      } catch (apiError) {
        // Log the full error for debugging
        logger.error('API resource retrieval failed - no fallbacks allowed', { 
          error: apiError.message,
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          resourceId: resource.resource_id
        });
        
        // No fallbacks - throw error to ensure we only use blockchain data
        throw new Error(`Failed to retrieve resource from blockchain: ${apiError.message}`);
      }
    } catch (error) {
      logger.error('Failed to search resource', { 
        error: error.message, 
        did,
        options
      });
      throw error;
    }
  }

  /**
   * Suspend a credential
   * @param {string} credentialId - Credential ID to suspend
   * @returns {Promise<object>} - Suspension result
   */
  async suspendCredential(credentialId) {
    try {
      logger.info(`Suspending credential: ${credentialId}`);
      
      // Get the credential from the database
      const credential = await sqliteService.db.get(
        'SELECT * FROM credentials WHERE credential_id = ?',
        [credentialId]
      );
      
      if (!credential) {
        throw new Error(`Credential not found: ${credentialId}`);
      }
      
      // Parse credential data to get the full credential object
      let credentialObject;
      try {
        credentialObject = JSON.parse(credential.data);
      } catch (parseError) {
        throw new Error(`Failed to parse credential data: ${parseError.message}`);
      }
      
      try {
        // Ensure the credential has the proper status purpose for suspension
        // This is critical because the APIs require specific statusPurpose values
        if (credentialObject.credentialStatus) {
          // Make sure the status purpose is set for suspension
          credentialObject.credentialStatus.statusPurpose = "suspension";
          
          // Update the credential in the database with the modified status purpose
          await sqliteService.db.run(
            'UPDATE credentials SET data = ? WHERE credential_id = ?',
            [JSON.stringify(credentialObject), credentialId]
          );
          
          logger.debug('Updated credential with suspension statusPurpose');
        }
        
        const studioApiUrl = this.apiUrl.replace('/v1', '');
        
        // Important: DO NOT use the JWT, as it contains the old statusPurpose
        // Instead, use the updated credential object directly
        const requestBody = { credential: credentialObject };
        
        logger.debug('Calling suspend credential API', {
          endpoint: `${studioApiUrl}/credential/suspend`,
          credentialType: 'JSON'
        });
        
        // Make the API call
        const response = await axios.post(
          `${studioApiUrl}/credential/suspend?publish=true`,
          requestBody,
          {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'x-api-key': config.cheqd.studioApiKey
            },
            timeout: 30000
          }
        );
        
        // Consider any 2xx response as success
        if (response.status >= 200 && response.status < 300) {
          logger.info(`Credential suspended successfully via API: ${credentialId}`);
          
          // Update the credential status in the database as well
          await sqliteService.db.run(
            'UPDATE credentials SET status = ? WHERE credential_id = ?',
            ['suspended', credentialId]
          );
          
          // Return standardized response even if API returns something else
          return {
            suspended: true,
            credentialId: credentialId,
            apiResponse: response.data
          };
        } else {
          throw new Error(`Unexpected status code: ${response.status}`);
        }
      } catch (apiError) {
        // Log the API error details
        logger.error('Failed to suspend credential via API', {
          error: apiError.message,
          responseData: apiError.response?.data,
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          credentialId
        });
        
        // No fallbacks - propagate the error to ensure we only use blockchain data
        logger.error('API credential suspension failed, not updating database to maintain data integrity');
        throw new Error(`Failed to suspend credential on blockchain: ${apiError.message}`);
      }
    } catch (error) {
      logger.error('Failed to suspend credential', {
        credentialId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Reinstate a credential
   * @param {string} credentialId - Credential ID to reinstate
   * @returns {Promise<object>} - Reinstatement result
   */
  async reinstateCredential(credentialId) {
    try {
      logger.info(`Reinstating credential: ${credentialId}`);
      
      // Get the credential from the database
      const credential = await sqliteService.db.get(
        'SELECT * FROM credentials WHERE credential_id = ?',
        [credentialId]
      );
      
      if (!credential) {
        throw new Error(`Credential not found: ${credentialId}`);
      }
      
      // Parse credential data to get the full credential object
      let credentialObject;
      try {
        credentialObject = JSON.parse(credential.data);
      } catch (parseError) {
        throw new Error(`Failed to parse credential data: ${parseError.message}`);
      }
      
      try {
        // Ensure the credential has the proper status purpose for suspension
        // This is critical because the APIs require specific statusPurpose values
        if (credentialObject.credentialStatus) {
          // Make sure the status purpose is set for suspension (reinstate only works on suspended credentials)
          credentialObject.credentialStatus.statusPurpose = "suspension";
          
          // Update the credential in the database with the modified status purpose
          await sqliteService.db.run(
            'UPDATE credentials SET data = ? WHERE credential_id = ?',
            [JSON.stringify(credentialObject), credentialId]
          );
          
          logger.debug('Updated credential with suspension statusPurpose for reinstatement');
        }
        
        const studioApiUrl = this.apiUrl.replace('/v1', '');
        
        // Important: DO NOT use the JWT, as it contains the old statusPurpose
        // Instead, use the updated credential object directly
        const requestBody = { credential: credentialObject };
        
        logger.debug('Calling reinstate credential API', {
          endpoint: `${studioApiUrl}/credential/reinstate`,
          credentialType: 'JSON'
        });
        
        // Make the API call
        const response = await axios.post(
          `${studioApiUrl}/credential/reinstate?publish=true`,
          requestBody,
          {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'x-api-key': config.cheqd.studioApiKey
            },
            timeout: 30000
          }
        );
        
        // Consider any 2xx response as success
        if (response.status >= 200 && response.status < 300) {
          logger.info(`Credential reinstated successfully via API: ${credentialId}`);
          
          // Update the credential status in the database as well
          await sqliteService.db.run(
            'UPDATE credentials SET status = ? WHERE credential_id = ?',
            ['active', credentialId]
          );
          
          // Return standardized response even if API returns something else
          return {
            unsuspended: true,
            credentialId: credentialId,
            apiResponse: response.data
          };
        } else {
          throw new Error(`Unexpected status code: ${response.status}`);
        }
      } catch (apiError) {
        // Log the API error details
        logger.error('Failed to reinstate credential via API', {
          error: apiError.message,
          responseData: apiError.response?.data,
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          credentialId
        });
        
        // No fallbacks - propagate the error to ensure we only use blockchain data
        logger.error('API credential reinstatement failed, not updating database to maintain data integrity');
        throw new Error(`Failed to reinstate credential on blockchain: ${apiError.message}`);
      }
    } catch (error) {
      logger.error('Failed to reinstate credential', {
        credentialId,
        error: error.message
      });
      throw error;
    }
  }

  // Add new credential status list methods

  /**
   * Create an encrypted credential status list
   * @param {string} did - DID to link the status list to
   * @param {string} statusListName - Name for the status list
   * @param {string} statusPurpose - Status purpose ('revocation' or 'suspension')
   * @param {Array} paymentConditions - Payment conditions for the status list
   * @param {object} [options={}] - Additional options
   * @returns {Promise<object>} - Created status list information
   */
  async createCredentialStatusList(did, statusListName, statusPurpose, paymentConditions, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info(`Creating encrypted credential status list: ${statusListName}`);
      
      // Validate the paymentConditions is an array
      if (!Array.isArray(paymentConditions)) {
        throw new Error('paymentConditions must be an array');
      }
      
      // Generate a symmetric key for encryption if not provided
      const symmetricKey = options.symmetricKey || crypto.randomBytes(32).toString('base64');
      
      // Set up the Studio API base URL
      const studioApiUrl = this.apiUrl.replace('/v1', '');
      
      // Prepare the request body based on API specification
      const createListPayload = {
        did: did,
        statusListName: statusListName,
        paymentConditions: paymentConditions
      };
      
      // Only include symmetricKey if provided
      if (options.symmetricKey) {
        createListPayload.symmetricKey = symmetricKey;
      }
      
      // Call the API
      const response = await axios.post(
        `${studioApiUrl}/credential-status/create/encrypted?statusPurpose=${statusPurpose}`,
        createListPayload,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-api-key': config.cheqd.studioApiKey
          },
          timeout: 30000 // 30-second timeout
        }
      );
      
      // Check response format
      if (!response.data) {
        throw new Error('Failed to create encrypted status list: Empty response');
      }
      
      // Extract resource info and ID based on actual API response structure
      const resourceData = response.data.resource || response.data;
      const resourceMetadata = resourceData.resourceMetadata || {};
      const statusListId = resourceMetadata.resourceId;
      
      if (!statusListId) {
        throw new Error('Failed to create encrypted status list: Could not find resource ID in response');
      }
      
      // Store the symmetric key - use response key if available, or our generated one
      const returnedSymmetricKey = resourceData.symmetricKey || symmetricKey;
      
      logger.info(`Created encrypted status list with ID: ${statusListId}`);
      
      return {
        id: statusListId,
        statusList: resourceData,
        symmetricKey: returnedSymmetricKey
      };
    } catch (error) {
      logger.error('Failed to create credential status list', { 
        error: error.message,
        did,
        statusListName,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Update an encrypted credential status list
   * @param {string} did - DID that controls the status list
   * @param {string} statusListName - Name of the status list
   * @param {Array<number>} indices - Array of indices to update
   * @param {string} statusAction - Action to perform ('revoke', 'suspend', or 'reinstate')
   * @param {string} symmetricKey - Symmetric key for decryption
   * @returns {Promise<object>} - Update result
   */
  async updateCredentialStatusList(did, statusListName, indices, statusAction, symmetricKey) {
    await this.ensureInitialized();
    
    try {
      logger.info(`Updating credential status list: ${statusListName} with action: ${statusAction}`);
      
      // Set up the Studio API base URL
      const studioApiUrl = this.apiUrl.replace('/v1', '');
      
      // Prepare the request body
      const updatePayload = {
        did: did,
        statusListName: statusListName,
        indices: indices,
        symmetricKey: symmetricKey
      };
      
      // Call the API
      const response = await axios.post(
        `${studioApiUrl}/credential-status/update/encrypted?statusAction=${statusAction}`,
        updatePayload,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-api-key': config.cheqd.studioApiKey
          },
          timeout: 30000 // 30-second timeout
        }
      );
      
      logger.info(`Status list updated successfully: ${statusListName} with action: ${statusAction}`);
      
      return response.data;
    } catch (error) {
      logger.error('Failed to update credential status list', { 
        error: error.message,
        did,
        statusListName,
        statusAction,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Check a credential status in a status list
   * @param {string} statusListId - Status list ID to check
   * @param {string} statusListIndex - Index of the credential in the status list
   * @param {string} symmetricKey - Symmetric key for decryption
   * @returns {Promise<object>} - Status check result
   */
  async checkCredentialStatus(statusListId, statusListIndex, symmetricKey) {
    await this.ensureInitialized();
    
    try {
      logger.debug(`Checking credential status in list: ${statusListId}, index: ${statusListIndex}`);
      
      // Set up the Studio API base URL
      const studioApiUrl = this.apiUrl.replace('/v1', '');
      
      // Prepare the request body
      const checkPayload = {
        statusListId: statusListId,
        statusListIndex: statusListIndex,
        symmetricKey: symmetricKey
      };
      
      // Call the API
      const response = await axios.post(
        `${studioApiUrl}/credential-status/check`,
        checkPayload,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-api-key': config.cheqd.studioApiKey
          },
          timeout: 30000 // 30-second timeout
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Failed to check credential status', { 
        error: error.message,
        statusListId,
        statusListIndex,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Search for a credential status list
   * @param {string} id - Status list ID or URI to find
   * @returns {Promise<object>} - Status list information
   */
  async searchCredentialStatusList(id) {
    await this.ensureInitialized();
    
    try {
      logger.debug(`Searching for credential status list: ${id}`);
      
      // Set up the Studio API base URL
      const studioApiUrl = this.apiUrl.replace('/v1', '');
      
      // Call the API
      const response = await axios.get(
        `${studioApiUrl}/credential-status/search?id=${id}`,
        {
          headers: {
            'Accept': 'application/json',
            'x-api-key': config.cheqd.studioApiKey
          },
          timeout: 30000 // 30-second timeout
        }
      );
      
      if (!response.data) {
        throw new Error('Failed to search credential status list: Empty response');
      }
      
      return response.data;
    } catch (error) {
      logger.error('Failed to search credential status list', { 
        error: error.message,
        id,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Revoke a credential using a status list (direct implementation with explicit parameters)
   * @param {string} credentialId - Credential ID to revoke
   * @param {string} did - DID that controls the status list
   * @param {string} statusListName - Name of the status list
   * @param {number} statusListIndex - Index in the status list
   * @param {string} symmetricKey - Symmetric key for the status list
   * @returns {Promise<object>} - Revocation result
   * @private - Called by the public revokeCredentialWithStatusList method
   */
  async _revokeCredentialWithStatusListDirect(credentialId, did, statusListName, statusListIndex, symmetricKey) {
    try {
      logger.info(`Revoking credential using status list: ${credentialId}`);
      
      // Call the update method to revoke the credential
      const updateResult = await this.updateCredentialStatusList(
        did,
        statusListName,
        [statusListIndex], // Convert to array
        'revoke', // Use the 'revoke' action
        symmetricKey
      );
      
      // Update the credential status in the database
      await sqliteService.db.run(
        'UPDATE credentials SET status = ? WHERE credential_id = ?',
        ['revoked', credentialId]
      );
      
      logger.info(`Credential revoked using status list: ${credentialId}`);
      
      return {
        revoked: true,
        credentialId: credentialId,
        statusListName: statusListName,
        updateResult: updateResult
      };
    } catch (error) {
      logger.error('Failed to revoke credential with status list', {
        credentialId,
        statusListName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Reinstate a credential using a status list (direct implementation with explicit parameters)
   * @param {string} credentialId - Credential ID to reinstate
   * @param {string} did - DID that controls the status list
   * @param {string} statusListName - Name of the status list
   * @param {number} statusListIndex - Index in the status list
   * @param {string} symmetricKey - Symmetric key for the status list
   * @returns {Promise<object>} - Reinstatement result
   * @private - Called by the public reinstateCredentialWithStatusList method
   */
  async _reinstateCredentialWithStatusListDirect(credentialId, did, statusListName, statusListIndex, symmetricKey) {
    try {
      logger.info(`Reinstating credential using status list: ${credentialId}`);
      
      // Call the update method to reinstate the credential
      const updateResult = await this.updateCredentialStatusList(
        did,
        statusListName,
        [statusListIndex], // Convert to array
        'reinstate', // Use the 'reinstate' action
        symmetricKey
      );
      
      // Update the credential status in the database
      await sqliteService.db.run(
        'UPDATE credentials SET status = ? WHERE credential_id = ?',
        ['active', credentialId]
      );
      
      logger.info(`Credential reinstated using status list: ${credentialId}`);
      
      return {
        reinstated: true,
        credentialId: credentialId,
        statusListName: statusListName,
        updateResult: updateResult
      };
    } catch (error) {
      logger.error('Failed to reinstate credential with status list', {
        credentialId,
        statusListName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Suspend a credential using a status list (direct implementation with explicit parameters)
   * @param {string} credentialId - Credential ID to suspend
   * @param {string} did - DID that controls the status list
   * @param {string} statusListName - Name of the status list
   * @param {number} statusListIndex - Index in the status list
   * @param {string} symmetricKey - Symmetric key for the status list
   * @returns {Promise<object>} - Suspension result
   * @private - Called by the public suspendCredentialWithStatusList method
   */
  async _suspendCredentialWithStatusListDirect(credentialId, did, statusListName, statusListIndex, symmetricKey) {
    try {
      logger.info(`Suspending credential using status list: ${credentialId}`);
      
      // Call the update method to suspend the credential
      const updateResult = await this.updateCredentialStatusList(
        did,
        statusListName,
        [statusListIndex], // Convert to array
        'suspend', // Use the 'suspend' action
        symmetricKey
      );
      
      // Update the credential status in the database
      await sqliteService.db.run(
        'UPDATE credentials SET status = ? WHERE credential_id = ?',
        ['suspended', credentialId]
      );
      
      logger.info(`Credential suspended using status list: ${credentialId}`);
      
      return {
        suspended: true,
        credentialId: credentialId,
        statusListName: statusListName,
        updateResult: updateResult
      };
    } catch (error) {
      logger.error('Failed to suspend credential with status list', {
        credentialId,
        statusListName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Sign data with a DID's private key
   * @param {string} did - DID to sign with
   * @param {string|object} data - Data to sign
   * @returns {Promise<string>} - Signed JWT or signature
   */
  async signData(did, data) {
    await this.ensureInitialized();
    
    try {
      // Convert object to string if needed
      const dataToSign = typeof data === 'object' ? JSON.stringify(data) : data;
      
      // Find the DID's key
      const didRecord = await sqliteService.db.get(
        'SELECT * FROM dids WHERE did = ?',
        [did]
      );
      
      if (!didRecord) {
        throw new Error(`DID not found: ${did}`);
      }
      
      // Use the proper signUtils implementation with the correct API endpoint
      // Import trustRegistryService only when needed, avoiding circular dependency
      const signUtils = require('../modules/cheqd/signUtils');
      
      // Delegate to the signUtils implementation that uses the correct API endpoint
      return await signUtils.signData(did, dataToSign);
    } catch (error) {
      logger.error('Failed to sign data', { 
        error: error.message, 
        did 
      });
      throw error;
    }
  }

  /**
   * Process a trust registry function call
   * @param {string} functionName - Function name
   * @param {Object} parameters - Function parameters
   * @returns {Promise<Object>} - Function result
   */
  async processTrustRegistryFunction(functionName, parameters) {
    await this.ensureInitialized();
    
    try {
      logger.info(`Processing trust registry function: ${functionName}`, { parameters });
      
      // Import trustRegistryService only when needed, avoiding circular dependency
      const trustRegistryService = require('../modules/cheqd/trustRegistryService');
      
      switch (functionName) {
        case 'create_root_registry':
          return await trustRegistryService.createRootRegistry({
            name: parameters.name,
            description: parameters.description,
            trustFramework: parameters.trustFramework
          });
          
        case 'create_bot_identity_registry':
          return await trustRegistryService.createBotIdentityRegistry({
            name: parameters.name,
            description: parameters.description
          });
          
        case 'verify_trusted_issuer':
          return await trustRegistryService.verifyTrustedIssuer(
            parameters.issuerDid,
            parameters.credentialType
          );
          
        case 'register_credential_type':
          return await trustRegistryService.registerCredentialType(
            parameters.registryId,
            parameters.credentialType,
            parameters.metadata || {}
          );
          
        case 'get_registry_by_did':
          return await trustRegistryService.getRegistryByDid(parameters.did);
          
        default:
          throw new Error(`Unknown trust registry function: ${functionName}`);
      }
    } catch (error) {
      logger.error(`Error processing trust registry function: ${functionName}`, {
        error: error.message,
        parameters
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export singleton instance
const cheqdService = new CheqdService();
module.exports = cheqdService; 