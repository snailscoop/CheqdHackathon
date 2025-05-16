/**
 * Cheqd Database Service
 * 
 * This service provides a SQLite-based implementation for Cheqd operations
 * and acts as a bridge between the application and the Cheqd blockchain.
 */

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../../utils/logger');
const config = require('../../config/config');
const sqliteService = require('../../db/sqliteService');
const cheqdService = require('../../services/cheqdService');
const { v4: uuidv4 } = require('uuid');

// Cheqd configuration from config
const cheqdConfig = {
  networkUrl: config.cheqd?.networkUrl || process.env.CHEQD_NETWORK_URL || 'https://api.cheqd.io/v1',
  networkChainId: config.cheqd?.networkChainId || process.env.CHEQD_NETWORK_CHAIN_ID || 'cheqd-mainnet-1',
  networkFeeDenom: config.cheqd?.networkFeeDenom || process.env.CHEQD_NETWORK_FEE_DENOM || 'ncheq',
  studioApiKey: config.cheqd?.studioApiKey || process.env.CHEQD_STUDIO_API_KEY || '',
  rootRegistryId: config.cheqd?.rootRegistryId || process.env.CHEQD_ROOT_REGISTRY_ID || '',
  rootDid: config.cheqd?.rootDid || process.env.CHEQD_ROOT_DID || '',
  botDid: config.cheqd?.botDid || process.env.BOT_DID || ''
};

// Constants
const CONFIG_KEY = 'cheqd_config';
const REGISTRY_PREFIX = 'telegram_chat_';

class CheqdDbService {
  constructor() {
    this.initialized = false;
    this.apiClient = null;
    this.cheqdConfig = { ...cheqdConfig };
  }
  
  /**
   * Initialize the service
   * @returns {Promise<boolean>} - Initialization status
   */
  async initialize() {
    if (this.initialized) {
      return true;
    }
    
    try {
      logger.info('Initializing Cheqd DB Service');
      
      // Initialize database tables if needed
      await this._initializeDatabase();
      
      // Initialize API client
      this._initializeApiClient();
      
      // Load config from database
      await this._loadConfig();
      
      // Set initialized flag
      this.initialized = true;
      logger.info('Cheqd DB Service initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize Cheqd DB Service', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Initialize database tables
   * @private
   */
  async _initializeDatabase() {
    try {
      // Create config table if it doesn't exist
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS cheqd_config (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);
      
      // Create registry table if it doesn't exist
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS cheqd_registries (
          registry_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
   * Ensure the service is initialized
   * @returns {Promise<boolean>} - Initialization status
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.initialized;
  }
  
  /**
   * Initialize the API client
   * @private
   */
  _initializeApiClient() {
    this.apiClient = axios.create({
      baseURL: this.cheqdConfig.networkUrl,
      headers: {
        'x-api-key': this.cheqdConfig.studioApiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    // Add request interceptor for logging
    this.apiClient.interceptors.request.use(
      (config) => {
        logger.debug('Making API request', {
          url: config.url,
          method: config.method,
          data: config.data ? 'data-present' : 'no-data'
        });
        return config;
      },
      (error) => {
        logger.error('API request error', { error: error.message });
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor for logging
    this.apiClient.interceptors.response.use(
      (response) => {
        logger.debug('API response received', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        if (error.response) {
          logger.error('API response error', {
            status: error.response.status,
            url: error.config.url,
            data: error.response.data
          });
        } else {
          logger.error('API network error', { error: error.message });
        }
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * Load configuration from database
   * @private
   */
  async _loadConfig() {
    try {
      // Load config from database
      const result = await sqliteService.db.get(
        'SELECT value FROM cheqd_config WHERE key = ?',
        [CONFIG_KEY]
      );
      
      if (result && result.value) {
        const config = JSON.parse(result.value);
        logger.info('Loaded Cheqd configuration from database');
        
        // Update config with stored values, but keep API key from environment
        this.cheqdConfig = {
          ...this.cheqdConfig,
          ...config,
          studioApiKey: this.cheqdConfig.studioApiKey // Always use env API key
        };
      } else {
        logger.info('No Cheqd configuration found in database, using environment variables');
        
        // Store current config in database
        await this._saveConfig();
      }
      
      return this.cheqdConfig;
    } catch (error) {
      logger.error('Failed to load Cheqd configuration', { error: error.message });
      // Continue with environment config
      return this.cheqdConfig;
    }
  }
  
  /**
   * Save configuration to database
   * @private
   */
  async _saveConfig() {
    try {
      const configJson = JSON.stringify({
        networkUrl: this.cheqdConfig.networkUrl,
        networkChainId: this.cheqdConfig.networkChainId,
        networkFeeDenom: this.cheqdConfig.networkFeeDenom,
        rootRegistryId: this.cheqdConfig.rootRegistryId,
        rootDid: this.cheqdConfig.rootDid,
        botDid: this.cheqdConfig.botDid
      });
      
      // Save config to database (upsert)
      await sqliteService.db.run(
        `INSERT INTO cheqd_config (key, value) 
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [CONFIG_KEY, configJson]
      );
      
      logger.info('Saved Cheqd configuration to database');
      return true;
    } catch (error) {
      logger.error('Failed to save Cheqd configuration', { error: error.message });
      return false;
    }
  }
  
  /**
   * Create a DID
   * @param {Object} options - DID creation options
   * @returns {Promise<Object>} - Created DID
   */
  async createDid(options = {}) {
    await this.ensureInitialized();
    
    try {
      // We'll use the cheqdService to create a DID
      const userId = options.userId || 'anonymous';
      const didResult = await cheqdService.createDID(userId, options.method || 'cheqd');
      
      logger.info('Created DID', { didId: didResult.did, userId });
      return {
        id: didResult.did,
        document: didResult.document,
        keys: didResult.keys
      };
    } catch (error) {
      logger.error('Failed to create DID', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Get a DID
   * @param {string} didId - DID ID
   * @returns {Promise<Object|null>} - DID or null if not found
   */
  async getDid(didId) {
    await this.ensureInitialized();
    
    try {
      // Use cheqdService to resolve the DID
      const didResult = await cheqdService.resolveDID(didId);
      
      if (didResult) {
        return {
          didId: didResult.did,
          didDocument: didResult.document,
          controller: didResult.metadata?.controller || didResult.document.controller,
          userId: didResult.metadata?.owner_id
        };
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get DID', { didId, error: error.message });
      return null;
    }
  }
  
  /**
   * Update a DID document
   * @param {string} didId - DID ID to update
   * @param {object} updates - Updates to apply to the DID document
   * @returns {Promise<Object|null>} - Updated DID document or null if failed
   */
  async updateDid(didId, updates) {
    await this.ensureInitialized();
    
    try {
      logger.info('Updating DID document', { didId });
      
      // Use the cheqdService to update the DID
      const updateResult = await cheqdService.updateDID(didId, updates);
      
      if (!updateResult) {
        throw new Error('Failed to update DID: No result returned');
      }
      
      logger.info('DID document updated', { 
        didId,
        hasServices: !!updates.service,
        hasVerificationMethods: !!updates.verificationMethod
      });
      
      return {
        didId: updateResult.did,
        didDocument: updateResult.document,
        controller: updateResult.document.controller,
        services: updateResult.services,
        controllerKeyId: updateResult.controllerKeyId,
        controllerKeyRefs: updateResult.controllerKeyRefs
      };
    } catch (error) {
      logger.error('Failed to update DID', { 
        didId, 
        error: error.message 
      });
      return null;
    }
  }
  
  /**
   * Deactivate a DID document
   * @param {string} didId - DID ID to deactivate
   * @param {object} options - Deactivation options
   * @returns {Promise<Object|null>} - Deactivation result or null if failed
   */
  async deactivateDid(didId, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Deactivating DID document', { didId });
      
      // Use the cheqdService to deactivate the DID
      const deactivationResult = await cheqdService.deactivateDID(didId, options);
      
      if (!deactivationResult) {
        throw new Error('Failed to deactivate DID: No result returned');
      }
      
      logger.info('DID document deactivated', { didId });
      
      return deactivationResult;
    } catch (error) {
      logger.error('Failed to deactivate DID', { 
        didId, 
        error: error.message 
      });
      return null;
    }
  }
  
  /**
   * Create a verifiable credential
   * @param {Object} credentialSubject - Credential subject
   * @param {string} type - Credential type
   * @param {string} issuerId - Issuer DID ID
   * @param {Object} options - Credential options
   * @returns {Promise<Object>} - Created credential
   */
  async createCredential(credentialSubject, type, issuerId, options = {}) {
    await this.ensureInitialized();
    
    try {
      // Use Bot DID as issuer if not specified
      const issuerDid = issuerId || this.cheqdConfig.botDid;
      
      if (!issuerDid) {
        throw new Error('Issuer DID is required');
      }
      
      // Generate subject DID if not provided
      let subjectDid = credentialSubject.id;
      
      if (!subjectDid) {
        // Create a DID for the subject
        const newDid = await this.createDid({
          userId: options.userId,
          keyType: 'Ed25519'
        });
        
        subjectDid = newDid.id;
        credentialSubject.id = subjectDid;
      }
      
      // Issue the credential using cheqdService
      const credential = await cheqdService.issueCredential(
        issuerDid,
        subjectDid,
        type,
        credentialSubject
      );
      
      // Add JWT representation for compatibility
      credential.jwt = `header.${Buffer.from(JSON.stringify({
        id: credential.id,
        jti: credential.id,
        sub: subjectDid,
        iss: issuerDid
      })).toString('base64')}.signature`;
      
      logger.info('Created credential', { 
        credentialId: credential.id,
        type,
        subjectDid
      });
      
      return credential;
    } catch (error) {
      logger.error('Failed to create credential', { 
        type,
        error: error.message,
        subjectId: credentialSubject.id
      });
      throw error;
    }
  }
  
  /**
   * Verify a credential
   * @param {string} jwt - Credential JWT
   * @returns {Promise<Object>} - Verification result
   */
  async verifyCredential(jwt) {
    await this.ensureInitialized();
    
    try {
      // Extract credential ID from JWT
      const parts = jwt.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }
      
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      const credentialId = payload.jti || payload.id;
      
      // Verify the credential
      const result = await cheqdService.verifyCredential(credentialId);
      
      return result;
    } catch (error) {
      logger.error('Failed to verify credential', { error: error.message });
      return {
        verified: false,
        reason: error.message
      };
    }
  }
  
  /**
   * Revoke a credential
   * @param {string} credentialId - Credential ID
   * @returns {Promise<boolean>} - Success
   */
  async revokeCredential(credentialId) {
    await this.ensureInitialized();
    
    try {
      // Revoke the credential
      const result = await cheqdService.revokeCredential(credentialId);
      
      if (result) {
        logger.info('Revoked credential', { credentialId });
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to revoke credential', { credentialId, error: error.message });
      return false;
    }
  }
  
  /**
   * Create a registry
   * @param {string} name - Registry name
   * @param {Object} options - Registry options
   * @returns {Promise<Object>} - Created registry
   */
  async createRegistry(name, options = {}) {
    await this.ensureInitialized();
    
    try {
      // Use Bot DID as issuer if not specified
      const issuerDid = options.issuerDid || this.cheqdConfig.botDid;
      
      if (!issuerDid) {
        throw new Error('Issuer DID is required');
      }
      
      // Create a simple registry object (in a real impl, would interact with blockchain)
      const registryId = `registry:${uuidv4()}`;
      const registry = {
        id: registryId,
        name,
        issuer: issuerDid,
        description: options.description || '',
        parentId: options.parentId || null,
        entries: [],
        created: new Date().toISOString()
      };
      
      // Store registry in database
      await sqliteService.db.run(
        'INSERT INTO cheqd_registries (registry_id, name, data) VALUES (?, ?, ?)',
        [registryId, name, JSON.stringify(registry)]
      );
      
      // If this is the root registry, update config
      if (options.isRoot) {
        this.cheqdConfig.rootRegistryId = registryId;
        await this._saveConfig();
      }
      
      logger.info('Created registry', { registryId, name });
      return registry;
    } catch (error) {
      logger.error('Failed to create registry', { name, error: error.message });
      throw error;
    }
  }
  
  /**
   * Get a registry
   * @param {string} registryId - Registry ID
   * @returns {Promise<Object|null>} - Registry or null if not found
   */
  async getRegistry(registryId) {
    await this.ensureInitialized();
    
    try {
      // Get registry from database
      const result = await sqliteService.db.get(
        'SELECT * FROM cheqd_registries WHERE registry_id = ?',
        [registryId]
      );
      
      if (result && result.data) {
        return JSON.parse(result.data);
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get registry', { registryId, error: error.message });
      return null;
    }
  }
  
  /**
   * Create a chat registry
   * @param {number} chatId - Telegram chat ID
   * @param {string} chatTitle - Chat title
   * @returns {Promise<Object>} - Created registry
   */
  async createChatRegistry(chatId, chatTitle) {
    await this.ensureInitialized();
    
    // Check if root registry exists
    if (!this.cheqdConfig.rootRegistryId) {
      logger.warn('Root registry not found, creating one');
      
      // Create root registry
      const rootRegistry = await this.createRegistry('Telegram Bot Root Registry', {
        isRoot: true,
        issuerDid: this.cheqdConfig.botDid,
        description: 'Root registry for Telegram bot'
      });
      
      if (!rootRegistry) {
        throw new Error('Failed to create root registry');
      }
    }
    
    // Create chat registry
    const registryName = `${REGISTRY_PREFIX}${chatId}`;
    const chatRegistry = await this.createRegistry(registryName, {
      issuerDid: this.cheqdConfig.botDid,
      description: `Registry for Telegram chat: ${chatTitle}`,
      parentId: this.cheqdConfig.rootRegistryId
    });
    
    return chatRegistry;
  }
  
  /**
   * Create a moderator credential
   * @param {Object} user - Telegram user
   * @param {Object} chat - Telegram chat
   * @param {Object} permissions - Moderator permissions
   * @returns {Promise<Object>} - Created credential
   */
  async createModeratorCredential(user, chat, permissions = {}) {
    await this.ensureInitialized();
    
    try {
      // Generate a UUID for the user if not already available
      const userId = user.id || user.telegram_id;
      
      if (!userId) {
        throw new Error('User ID is required');
      }
      
      // Create credential subject
      const credentialSubject = {
        name: user.first_name,
        telegram_id: userId.toString(),
        chat_id: chat.id.toString(),
        moderator: true,
        permissions: permissions || {
          can_ban: true,
          can_mute: true,
          can_delete: true
        },
        status: 'active'
      };
      
      // Create credential
      const credential = await this.createCredential(
        credentialSubject,
        'ModeratorCredential',
        this.cheqdConfig.botDid,
        {
          userId,
          chatId: chat.id
        }
      );
      
      return credential;
    } catch (error) {
      logger.error('Failed to create moderator credential', { 
        userId: user.id,
        chatId: chat.id,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Create an educational credential
   * @param {Object} user - Telegram user
   * @param {Object} chat - Telegram chat
   * @param {string} topic - Educational topic
   * @param {number} score - Score (0-100)
   * @returns {Promise<Object>} - Created credential
   */
  async createEducationalCredential(user, chat, topic, score) {
    await this.ensureInitialized();
    
    try {
      // Generate a UUID for the user if not already available
      const userId = user.id || user.telegram_id;
      
      if (!userId) {
        throw new Error('User ID is required');
      }
      
      // Create credential subject
      const credentialSubject = {
        name: user.first_name,
        telegram_id: userId.toString(),
        chat_id: chat.id.toString(),
        topic: topic,
        score: score,
        issued_date: new Date().toISOString()
      };
      
      // Create credential
      const credential = await this.createCredential(
        credentialSubject,
        'EducationalCredential',
        this.cheqdConfig.botDid,
        {
          userId,
          chatId: chat.id
        }
      );
      
      return credential;
    } catch (error) {
      logger.error('Failed to create educational credential', { 
        userId: user.id,
        chatId: chat.id,
        topic,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Get user credential for a chat
   * @param {number} userId - Telegram user ID
   * @param {number} chatId - Telegram chat ID
   * @returns {Promise<Object|null>} - Credential or null if not found
   */
  async getUserCredential(userId, chatId) {
    await this.ensureInitialized();
    
    try {
      // Get credential from database using the main cheqdService
      const credentials = await cheqdService.listCredentialsByHolder(null, {
        type: 'ModeratorCredential'
      });
      
      // Filter for the specific user and chat
      const credential = credentials.find(cred => {
        const subject = cred.credentialSubject;
        return subject.telegram_id === userId.toString() && 
               subject.chat_id === chatId.toString();
      });
      
      return credential;
    } catch (error) {
      logger.error('Failed to get user credential', { 
        userId,
        chatId,
        error: error.message
      });
      return null;
    }
  }
  
  /**
   * Ensure a DID exists in the database
   * @param {String} did - DID to check/create
   * @param {String} role - Role of the DID (issuer or holder)
   * @returns {Promise<Boolean>} - Success status
   */
  async ensureDIDExists(did, role) {
    await this.ensureInitialized();
    
    try {
      // Check if DID exists
      const existingDID = await sqliteService.db.get('SELECT * FROM dids WHERE did = ?', [did]);
      
      if (!existingDID) {
        logger.info(`DID ${did} does not exist in database, adding it`);
        
        // Get user ID or create one
        let ownerId = await this.getOrCreateOwnerId(role);
        
        // Check existing columns in the table
        const tableInfo = await sqliteService.db.all('PRAGMA table_info(dids)');
        const columnNames = tableInfo.map(col => col.name);
        
        // Prepare insert data
        const columns = [];
        const placeholders = [];
        const values = [];
        
        // DID
        if (columnNames.includes('did')) {
          columns.push('did');
          placeholders.push('?');
          values.push(did);
        }
        
        // Owner ID
        if (columnNames.includes('owner_id')) {
          columns.push('owner_id');
          placeholders.push('?');
          values.push(ownerId);
        }
        
        // Method
        if (columnNames.includes('method')) {
          columns.push('method');
          placeholders.push('?');
          values.push(did.startsWith('did:cheqd') ? 'cheqd' : did.split(':')[1]);
        }
        
        // Key type
        if (columnNames.includes('key_type')) {
          columns.push('key_type');
          placeholders.push('?');
          values.push('Ed25519');
        }
        
        // Metadata
        if (columnNames.includes('metadata')) {
          columns.push('metadata');
          placeholders.push('?');
          values.push(JSON.stringify({
            id: did,
            controller: did,
            created: new Date().toISOString(),
            role: role
          }));
        }
        
        // Insert the DID
        if (columns.length > 0) {
          await sqliteService.db.run(
            `INSERT INTO dids (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
            values
          );
          
          logger.info(`Added ${role} DID ${did} to database`);
          return true;
        } else {
          logger.warn('No valid columns found for dids table');
          return false;
        }
      } else {
        logger.debug(`DID ${did} already exists in database`);
        return true;
      }
    } catch (error) {
      logger.error(`Error ensuring DID exists: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get or create a user ID for owner
   * @param {String} role - Role of the user
   * @returns {Promise<Number>} - User ID
   */
  async getOrCreateOwnerId(role) {
    await this.ensureInitialized();
    
    try {
      // Check if users table exists
      const tables = await sqliteService.db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
      if (tables.length === 0) {
        // If no users table, return NULL for owner_id
        return null;
      }
      
      // Try to find a system user
      const systemUser = await sqliteService.db.get("SELECT id FROM users WHERE username = 'system'");
      if (systemUser) {
        return systemUser.id;
      }
      
      // Check if we have any users
      const anyUser = await sqliteService.db.get("SELECT id FROM users LIMIT 1");
      if (anyUser) {
        return anyUser.id;
      }
      
      // As a last resort, try to create a system user
      try {
        const result = await sqliteService.db.run(
          "INSERT INTO users (username, created_at) VALUES (?, CURRENT_TIMESTAMP)",
          ['system']
        );
        return result.lastID;
      } catch (error) {
        logger.warn(`Could not create system user: ${error.message}`);
        return null;
      }
    } catch (error) {
      logger.error(`Error getting or creating owner ID: ${error.message}`);
      return null;
    }
  }
}

// Export singleton instance
const cheqdDbService = new CheqdDbService();
module.exports = cheqdDbService; 