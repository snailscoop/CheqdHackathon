/**
 * DID Service
 * 
 * This service manages DIDs (Decentralized Identifiers) for users,
 * creating and managing them with the Cheqd network.
 */

const logger = require('../../utils/logger');
const db = require('../../db/database');
const cheqdService = require('../../services/cheqdService');
const config = require('../../config/config');

class DIDService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the DID service
   */
  async initialize() {
    try {
      logger.info('Initializing DID service');
      
      // Initialize dependency services
      if (!cheqdService.initialized) {
        await cheqdService.initialize();
      }
      
      // Create database tables if needed
      await this._initializeDatabase();
      
      this.initialized = true;
      logger.info('DID service initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize DID service', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize the database tables for DIDs
   * @private
   */
  async _initializeDatabase() {
    try {
      // Create user_dids table to track DIDs
      await db.run(`
        CREATE TABLE IF NOT EXISTS user_dids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          did TEXT NOT NULL,
          method TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          metadata TEXT,
          UNIQUE(user_id, did)
        )
      `);
      
      logger.info('DID database tables initialized');
    } catch (error) {
      logger.error('Failed to initialize DID database tables', { error: error.message });
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
   * Create a DID for a user
   * @param {Object} user - User object (typically from Telegram)
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Created DID information
   */
  async createDidForUser(user, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Creating DID for user', { userId: user.id });
      
      const userId = user.id.toString();
      
      // Check if user already has a DID
      const existingDid = await this.getUserDid(userId);
      if (existingDid) {
        logger.info('User already has a DID', { 
          userId,
          did: existingDid.did
        });
        
        return existingDid;
      }
      
      // Create a new DID for the user
      const didMethod = options.method || 'cheqd';
      
      // Get user name for the DID
      const userName = user.username || 
                     user.first_name || 
                     `user_${userId}`;
      
      // Generate DID using Cheqd service
      const didResult = await cheqdService.createDid({
        method: didMethod,
        userName: userName,
        userId: userId,
        metadata: {
          source: 'dail-bot',
          telegramId: userId,
          reason: options.reason || 'user_request'
        }
      });
      
      // Store the DID in the database
      await this._storeDid(userId, didResult.did, {
        method: didMethod,
        metadata: JSON.stringify({
          userName,
          reason: options.reason || 'user_request',
          associatedDid: options.associatedDid || null
        })
      });
      
      logger.info('DID created for user', {
        userId,
        did: didResult.did
      });
      
      return {
        did: didResult.did,
        method: didMethod,
        createdAt: Date.now(),
        userId
      };
    } catch (error) {
      logger.error('Failed to create DID for user', {
        error: error.message,
        userId: user.id
      });
      
      throw error;
    }
  }
  
  /**
   * Get a user's DID
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} - User's DID or null if not found
   */
  async getUserDid(userId) {
    await this.ensureInitialized();
    
    try {
      // Query database for user's DID
      const result = await db.get(`
        SELECT * FROM user_dids
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId.toString()]);
      
      if (!result) {
        return null;
      }
      
      let metadata = null;
      try {
        metadata = result.metadata ? JSON.parse(result.metadata) : null;
      } catch (e) {
        logger.warn('Failed to parse DID metadata', {
          userId,
          error: e.message
        });
      }
      
      return {
        did: result.did,
        method: result.method,
        createdAt: result.created_at,
        userId,
        metadata
      };
    } catch (error) {
      logger.error('Error getting user DID', {
        error: error.message,
        userId
      });
      
      return null;
    }
  }
  
  /**
   * Resolve a DID to its associated user
   * @param {string} did - Decentralized Identifier
   * @returns {Promise<Object|null>} - User info or null if not found
   */
  async resolveDid(did) {
    await this.ensureInitialized();
    
    try {
      // Query database to find user by DID
      const result = await db.get(`
        SELECT * FROM user_dids
        WHERE did = ?
      `, [did]);
      
      if (!result) {
        // Try resolving through Cheqd service
        const resolvedDid = await cheqdService.resolveDid(did);
        
        if (resolvedDid && resolvedDid.metadata && resolvedDid.metadata.telegramId) {
          return {
            userId: resolvedDid.metadata.telegramId,
            source: 'cheqd_resolution',
            did
          };
        }
        
        return null;
      }
      
      return {
        userId: result.user_id,
        source: 'local_database',
        createdAt: result.created_at,
        did
      };
    } catch (error) {
      logger.error('Error resolving DID to user', {
        error: error.message,
        did
      });
      
      return null;
    }
  }
  
  /**
   * Store a DID in the database
   * @param {string} userId - User ID
   * @param {string} did - Decentralized Identifier
   * @param {Object} options - Additional options
   * @returns {Promise<void>}
   * @private
   */
  async _storeDid(userId, did, options = {}) {
    try {
      const now = Date.now();
      
      await db.run(`
        INSERT INTO user_dids (user_id, did, method, created_at, metadata)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (user_id, did) DO UPDATE SET
        method = ?,
        metadata = ?
      `, [
        userId.toString(),
        did,
        options.method || 'cheqd',
        now,
        options.metadata || null,
        options.method || 'cheqd',
        options.metadata || null
      ]);
      
      logger.info('DID stored in database', {
        userId,
        did
      });
    } catch (error) {
      logger.error('Failed to store DID in database', {
        error: error.message,
        userId,
        did
      });
      
      throw error;
    }
  }
}

// Create and export singleton instance
module.exports = new DIDService(); 