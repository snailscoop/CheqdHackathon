/**
 * Identity Verification Service
 * 
 * Handles verification of agent identities through Cheqd credentials.
 * Integrates with GrokService to provide natural language identity verification.
 * Uses SQLite for storage and Cheqd for credential verification.
 * 
 * IMPORTANT: This service follows a strict no-fallbacks policy:
 * - All operations must use real blockchain data
 * - No mock credentials or DIDs are allowed
 * - Operations will fail rather than use mock data
 * - Only store confirmed data from the blockchain
 */

const logger = require('../../utils/logger');
const config = require('../../config/config');
const cheqdService = require('../../services/cheqdService');
const zlib = require('zlib');
const sqliteService = require('../../db/sqliteService');
const crypto = require('crypto');

// In-memory credential cache for performance
const credentialCache = new Map();

class IdentityVerificationService {
  constructor() {
    this.initialized = false;
    
    // Phrases that trigger identity verification
    this.identityTriggerPhrases = [
      'who are you',
      'verify yourself',
      'your identity',
      'verify your identity',
      'show credentials',
      'prove your identity',
      'are you verified',
      'your credentials',
      'identity verification',
      'credential',
      'are you real',
      'are you authentic',
      'authentication',
      'verified bot'
    ];
    
    // Cache TTL (default: 10 minutes)
    this.cacheTTL = config.identityVerification?.cacheTTL || 10 * 60 * 1000;
    
    logger.info('Using Identity Verification Service with SQLite');
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      logger.info('Initializing Identity Verification Service');
      
      // Ensure SQLite is initialized
      await sqliteService.ensureInitialized();
      
      // Set initialized flag
      this.initialized = true;
      
      logger.info('Identity Verification Service initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize Identity Verification Service', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Ensure the service is initialized
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Check if a message is requesting identity verification
   * 
   * @param {String} message - The user's message
   * @returns {Boolean} - Whether the message is an identity verification request
   */
  isIdentityVerificationRequest(message) {
    if (!message || typeof message !== 'string') return false;
    
    const normalizedMessage = message.toLowerCase().trim();
    
    return this.identityTriggerPhrases.some(phrase => 
      normalizedMessage.includes(phrase)
    );
  }

  /**
   * Cache credentials for an agent in memory
   * 
   * @param {String} agentId - Agent DID
   * @param {Object} credentials - Credential object to cache
   * @returns {Promise<void>}
   */
  async cacheCredentials(agentId, credentials) {
    try {
      logger.info('Caching credentials in memory', { agentId });
      
      // Store in memory with timestamp
      credentialCache.set(agentId, {
        data: credentials,
        timestamp: Date.now()
      });
      
      logger.info('Cached credentials', { agentId });
    } catch (error) {
      logger.error('Failed to cache credentials', { error: error.message, agentId });
      // Continue despite cache error
    }
  }

  /**
   * Get cached credentials for an agent
   * 
   * @param {String} agentId - Agent DID
   * @returns {Promise<Object|null>} - Cached credentials or null if not found/expired
   */
  async getCachedCredentials(agentId) {
    try {
      // Get cached entry
      const cached = credentialCache.get(agentId);
      
      // Check if cache exists and is not expired
      if (!cached || !cached.data || !cached.timestamp || 
          Date.now() - cached.timestamp > this.cacheTTL) {
        return null;
      }
      
      logger.debug('Using cached credentials', { agentId });
      return cached.data;
    } catch (error) {
      logger.warn('Error retrieving cached credentials', { 
        error: error.message, 
        agentId 
      });
      return null;
    }
  }

  /**
   * Clear credential cache for a specific agent
   * @param {String} agentId - Agent ID to clear from cache
   */
  async clearCredentialCache(agentId) {
    if (!agentId) return;
    
    try {
      logger.info('Clearing credential cache', { agentId });
      
      // Remove from in-memory cache
      credentialCache.delete(agentId);
      
    } catch (error) {
      logger.error('Error clearing credential cache', { 
        error: error.message, 
        agentId 
      });
    }
  }

  /**
   * Retrieve agent credentials
   * 
   * @param {String} agentId - Agent DID
   * @returns {Promise<Object>} - Agent credentials
   */
  async retrieveAgentCredentials(agentId = null) {
    await this.ensureInitialized();
    
    // Use default agent ID if not provided
    const targetId = agentId || config.identityVerification?.agentId || 'default-agent-id';
    
    // Check cache first
    const cached = await this.getCachedCredentials(targetId);
    if (cached) {
      return cached;
    }
    
    try {
      // Try to fetch from SQLite
      const storedCredentials = await this.getStoredCredentials(targetId);
      if (storedCredentials) {
        await this.cacheCredentials(targetId, storedCredentials);
        return storedCredentials;
      }
      
      // If no stored credentials, try to fetch from Cheqd service
      let credentials;
      try {
        if (cheqdService && cheqdService.initialized) {
          // Fetch any credentials issued to this agent
          const dids = await cheqdService.getUserDids(targetId);
          if (!dids || dids.length === 0) {
            throw new Error(`No DIDs found for agent ID: ${targetId}`);
          }
          
          // Use the first DID found
          const agentDid = dids[0].did;
          
          // Check if there are any issued credentials for this DID
          const issuedCredentials = await cheqdService.listCredentialsByHolder(agentDid);
          
          if (issuedCredentials && issuedCredentials.length > 0) {
            // Use the first credential found
            return await cheqdService.getCredential(issuedCredentials[0].id);
          } else {
            throw new Error(`No issued credentials found for DID: ${agentDid}`);
          }
        } else {
          throw new Error('Cheqd service not initialized');
        }
      } catch (cheqdErr) {
        logger.error('Failed to fetch credentials from Cheqd', { 
          error: cheqdErr.message, 
          targetId 
        });
        throw new Error(`Cannot retrieve credentials: ${cheqdErr.message}`);
      }
    } catch (error) {
      logger.error('Failed to retrieve agent credentials', { 
        error: error.message, 
        targetId 
      });
      
      // No fallback credentials - enforce strict policy
      throw new Error('Cannot retrieve credentials - strict no-fallbacks policy is enforced');
    }
  }

  /**
   * Handle verification request and format response
   * 
   * @param {String} message - User message requesting verification
   * @param {Boolean} verbose - Whether to include detailed credential info
   * @returns {Promise<Object>} - Formatted response
   */
  async handleVerificationRequest(message, verbose = false) {
    await this.ensureInitialized();
    
    try {
      // Get credentials
      const credentials = await this.retrieveAgentCredentials();
      
      // Format credentials for display
      const formattedResponse = this.formatCredentials(credentials, verbose);
      
      return {
        status: 'success',
        message: formattedResponse
      };
    } catch (error) {
      logger.error('Error handling verification request', { error: error.message });
      
      return {
        status: 'error',
        message: 'Identity verification failed. This service follows a strict no-fallbacks policy that requires real blockchain verification. Please try again later when blockchain services are available.'
      };
    }
  }

  /**
   * Format credentials for display
   * 
   * @param {Object} credentials - Credentials to format
   * @param {Boolean} verbose - Whether to include detailed credential info
   * @returns {String} - Formatted credentials
   */
  formatCredentials(credentials, verbose = false) {
    if (!credentials) {
      return "I couldn't retrieve my credentials. Please try again later.";
    }
    
    const subject = credentials.credentialSubject || {};
    const status = credentials.status || {};
    const isVerified = status.verified === true;
    
    let response = `🤖 **Identity Verification**\n\n`;
    response += `✅ I am ${subject.name || 'Dail Bot'}, a verified AI assistant`;
    
    if (subject.organization) {
      response += ` from ${subject.organization}`;
    }
    
    if (subject.role) {
      response += `\n🔹 Role: ${subject.role}`;
    }
    
    if (isVerified) {
      response += `\n🔹 Verification Status: Verified`;
    } else {
      response += `\n🔹 Verification Status: Unverified`;
    }
    
    if (verbose) {
      response += `\n\n**Credential Details:**`;
      response += `\n🔹 DID: ${credentials.did || 'Not available'}`;
      response += `\n🔹 Issuer: ${credentials.issuer || 'Not available'}`;
      response += `\n🔹 Issuance Date: ${credentials.issuanceDate || 'Not available'}`;
      
      if (credentials.proof) {
        response += `\n🔹 Proof Type: ${credentials.proof.type || 'Not specified'}`;
      }
    }
    
    return response;
  }

  /**
   * Store encrypted credentials in SQLite
   * 
   * @param {String} credentialId - ID for the credentials
   * @param {Object} credentials - Credentials to store
   * @returns {Promise<Boolean>} - Success status
   */
  async storeEncryptedCredentials(credentialId, credentials) {
    await this.ensureInitialized();
    
    try {
      // Generate encryption key from credential ID
      const encryptionKey = this._generateEncryptionKey(credentialId);
      
      // Convert credentials to JSON
      const credentialsJson = JSON.stringify(credentials);
      
      // Compress and encrypt credentials
      const compressed = zlib.deflateSync(Buffer.from(credentialsJson, 'utf8'));
      const encryptedData = this._encrypt(compressed.toString('base64'), encryptionKey);
      
      // Store in database
      await sqliteService.db.run(
        'INSERT OR REPLACE INTO identity_credentials (credential_id, encrypted_data, updated_at) VALUES (?, ?, ?)',
        [credentialId, encryptedData, Date.now()]
      );
      
      logger.info('Stored encrypted credentials', { credentialId });
      return true;
    } catch (error) {
      logger.error('Failed to store encrypted credentials', {
        error: error.message,
        credentialId
      });
      return false;
    }
  }

  /**
   * Get stored credentials from SQLite
   * 
   * @param {String} credentialId - ID for the credentials
   * @returns {Promise<Object|null>} - Decrypted credentials or null
   */
  async getStoredCredentials(credentialId) {
    await this.ensureInitialized();
    
    try {
      // Check if table exists and create if not
      await sqliteService.db.run(`
        CREATE TABLE IF NOT EXISTS identity_credentials (
          credential_id TEXT PRIMARY KEY,
          encrypted_data TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      
      // Get encrypted data from database
      const row = await sqliteService.db.get(
        'SELECT encrypted_data FROM identity_credentials WHERE credential_id = ?',
        [credentialId]
      );
      
      if (!row || !row.encrypted_data) {
        return null;
      }
      
      // Generate encryption key from credential ID
      const encryptionKey = this._generateEncryptionKey(credentialId);
      
      // Decrypt and decompress data
      const decrypted = this._decrypt(row.encrypted_data, encryptionKey);
      const decompressed = zlib.inflateSync(Buffer.from(decrypted, 'base64')).toString('utf8');
      
      // Parse JSON
      const credentials = JSON.parse(decompressed);
      
      logger.info('Retrieved stored credentials', { credentialId });
      return credentials;
    } catch (error) {
      logger.error('Failed to get stored credentials', {
        error: error.message,
        credentialId
      });
      return null;
    }
  }

  /**
   * Generate encryption key from credential ID
   * 
   * @param {String} credentialId - Credential ID
   * @returns {String} - Encryption key
   * @private
   */
  _generateEncryptionKey(credentialId) {
    // Create a deterministic key based on credential ID
    return crypto
      .createHash('sha256')
      .update(credentialId + (process.env.ENCRYPTION_SALT || 'default-salt'))
      .digest('hex')
      .substring(0, 32); // Use first 32 chars (256 bits) for AES-256
  }

  /**
   * Encrypt data using AES-256-CBC
   * 
   * @param {String} text - Text to encrypt
   * @param {String} key - Encryption key
   * @returns {String} - Encrypted text
   * @private
   */
  _encrypt(text, key) {
    try {
      // Generate IV
      const iv = crypto.randomBytes(16);
      
      // Create cipher
      const cipher = crypto.createCipheriv(
        'aes-256-cbc',
        Buffer.from(key),
        iv
      );
      
      // Encrypt
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Return IV + encrypted data
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      logger.error('Encryption error', { error: error.message });
      throw error;
    }
  }

  /**
   * Decrypt data using AES-256-CBC
   * 
   * @param {String} text - Text to decrypt
   * @param {String} key - Encryption key
   * @returns {String} - Decrypted text
   * @private
   */
  _decrypt(text, key) {
    try {
      // Split IV and encrypted text
      const parts = text.split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted text format');
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const encryptedText = parts[1];
      
      // Create decipher
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(key),
        iv
      );
      
      // Decrypt
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('Decryption error', { error: error.message });
      throw error;
    }
  }

  /**
   * No fallback credential creation allowed
   * 
   * @param {String} errorMessage - Error message
   * @throws {Error} Always throws an error due to no-fallbacks policy
   * @private
   */
  _createFallbackCredentials(errorMessage) {
    logger.error('Attempted to create fallback credentials - not allowed', { errorMessage });
    throw new Error('Cannot create fallback credentials - strict no-fallbacks policy is enforced');
  }
}

module.exports = new IdentityVerificationService(); 