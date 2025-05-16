/**
 * Cheqd SQLite Storage Module
 * 
 * This module provides storage utilities for Cheqd data using SQLite.
 * It's designed to support cheqdDbService with database operations.
 */

const sqliteService = require('../../db/sqliteService');
const logger = require('../../utils/logger');

class CheqdSqliteStorage {
  constructor() {
    this.initialized = false;
  }
  
  /**
   * Initialize the storage module
   * @returns {Promise<boolean>} - Success status
   */
  async initialize() {
    if (this.initialized) {
      return true;
    }
    
    try {
      // Create database tables
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS cheqd_config (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);
      
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS cheqd_dids (
          did_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          document TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS cheqd_credentials (
          credential_id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          issuer_did TEXT NOT NULL,
          subject_did TEXT NOT NULL,
          user_id TEXT,
          chat_id TEXT,
          data TEXT NOT NULL,
          jwt TEXT,
          issued_at TIMESTAMP NOT NULL,
          expires_at TIMESTAMP,
          revoked_at TIMESTAMP,
          status TEXT NOT NULL DEFAULT 'active'
        )
      `);
      
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS cheqd_registries (
          registry_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      this.initialized = true;
      logger.info('Cheqd SQLite storage initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Cheqd SQLite storage', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Store configuration
   * @param {string} key - Config key
   * @param {object} config - Config object
   * @returns {Promise<boolean>} - Success status
   */
  async storeConfig(key, config) {
    try {
      const configJson = JSON.stringify(config);
      
      await sqliteService.db.run(
        `INSERT INTO cheqd_config (key, value) 
         VALUES (?, ?) 
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, configJson]
      );
      
      return true;
    } catch (error) {
      logger.error('Failed to store config', { error: error.message, key });
      throw error;
    }
  }
  
  /**
   * Get configuration
   * @param {string} key - Config key
   * @returns {Promise<object|null>} - Config object
   */
  async getConfig(key) {
    try {
      const result = await sqliteService.db.get(
        'SELECT value FROM cheqd_config WHERE key = ?',
        [key]
      );
      
      if (result && result.value) {
        return JSON.parse(result.value);
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get config', { error: error.message, key });
      return null;
    }
  }
  
  /**
   * Store DID
   * @param {string} didId - DID ID
   * @param {object} document - DID document
   * @param {string} [userId] - User ID
   * @returns {Promise<boolean>} - Success status
   */
  async storeDid(didId, document, userId = 'system') {
    try {
      const documentJson = JSON.stringify(document);
      
      await sqliteService.db.run(
        `INSERT INTO cheqd_dids (did_id, user_id, document) 
         VALUES (?, ?, ?)
         ON CONFLICT(did_id) DO UPDATE SET document = excluded.document`,
        [didId, userId, documentJson]
      );
      
      return true;
    } catch (error) {
      logger.error('Failed to store DID', { error: error.message, didId });
      throw error;
    }
  }
  
  /**
   * Get DID
   * @param {string} didId - DID ID
   * @returns {Promise<object|null>} - DID object
   */
  async getDid(didId) {
    try {
      const result = await sqliteService.db.get(
        'SELECT * FROM cheqd_dids WHERE did_id = ?',
        [didId]
      );
      
      if (result) {
        return {
          didId: result.did_id,
          userId: result.user_id,
          didDocument: JSON.parse(result.document)
        };
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get DID', { error: error.message, didId });
      return null;
    }
  }
  
  /**
   * Store credential
   * @param {string} credentialId - Credential ID
   * @param {string} type - Credential type
   * @param {object} data - Credential data
   * @param {string} subjectDid - Subject DID
   * @param {string} issuerDid - Issuer DID
   * @param {string} [jwt] - JWT token
   * @param {string} [issuedAt] - Issuance date
   * @param {string} [expiresAt] - Expiration date
   * @param {string} [userId] - User ID
   * @param {string} [chatId] - Chat ID
   * @returns {Promise<boolean>} - Success status
   */
  async storeCredential(credentialId, type, data, subjectDid, issuerDid, jwt = null, 
                         issuedAt = null, expiresAt = null, userId = null, chatId = null) {
    try {
      const dataJson = JSON.stringify(data);
      const now = new Date().toISOString();
      
      await sqliteService.db.run(
        `INSERT INTO cheqd_credentials 
         (credential_id, type, issuer_did, subject_did, user_id, chat_id, data, jwt, issued_at, expires_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(credential_id) DO UPDATE SET 
           data = excluded.data,
           jwt = excluded.jwt,
           expires_at = excluded.expires_at`,
        [
          credentialId,
          type,
          issuerDid,
          subjectDid,
          userId,
          chatId,
          dataJson,
          jwt,
          issuedAt || now,
          expiresAt
        ]
      );
      
      return true;
    } catch (error) {
      logger.error('Failed to store credential', { error: error.message, credentialId });
      throw error;
    }
  }
  
  /**
   * Get credential
   * @param {string} credentialId - Credential ID
   * @returns {Promise<object|null>} - Credential object
   */
  async getCredential(credentialId) {
    try {
      const result = await sqliteService.db.get(
        'SELECT * FROM cheqd_credentials WHERE credential_id = ?',
        [credentialId]
      );
      
      if (result) {
        return {
          credentialId: result.credential_id,
          type: result.type,
          issuerDid: result.issuer_did,
          subjectDid: result.subject_did,
          userId: result.user_id,
          chatId: result.chat_id,
          data: JSON.parse(result.data),
          jwt: result.jwt,
          issuedAt: result.issued_at,
          expiresAt: result.expires_at,
          revokedAt: result.revoked_at,
          status: result.status
        };
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get credential', { error: error.message, credentialId });
      return null;
    }
  }
  
  /**
   * Get credential by Telegram user ID and chat ID
   * @param {string} telegramId - Telegram user ID
   * @param {string} chatId - Chat ID
   * @returns {Promise<object|null>} - Credential object
   */
  async getCredentialByTelegram(telegramId, chatId) {
    try {
      // Since we store telegram_id in the JSON data, we need to query differently
      const credentials = await sqliteService.db.all(
        `SELECT * FROM cheqd_credentials 
         WHERE chat_id = ? AND status = 'active'`,
        [chatId.toString()]
      );
      
      // Find credential for this user by parsing the data
      for (const cred of credentials) {
        try {
          const data = JSON.parse(cred.data);
          if (data.telegram_id === telegramId.toString()) {
            return {
              credentialId: cred.credential_id,
              type: cred.type,
              issuerDid: cred.issuer_did,
              subjectDid: cred.subject_did,
              userId: cred.user_id,
              chatId: cred.chat_id,
              data,
              jwt: cred.jwt,
              issuedAt: cred.issued_at,
              expiresAt: cred.expires_at,
              status: cred.status
            };
          }
        } catch (parseError) {
          logger.warn('Failed to parse credential data', { 
            error: parseError.message, 
            credentialId: cred.credential_id 
          });
        }
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get credential by Telegram ID', { 
        error: error.message, 
        telegramId,
        chatId
      });
      return null;
    }
  }
  
  /**
   * Revoke credential
   * @param {string} credentialId - Credential ID
   * @returns {Promise<boolean>} - Success status
   */
  async revokeCredential(credentialId) {
    try {
      await sqliteService.db.run(
        `UPDATE cheqd_credentials 
         SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP 
         WHERE credential_id = ?`,
        [credentialId]
      );
      
      return true;
    } catch (error) {
      logger.error('Failed to revoke credential', { error: error.message, credentialId });
      throw error;
    }
  }
  
  /**
   * Store registry
   * @param {string} registryId - Registry ID
   * @param {string} name - Registry name
   * @param {object} data - Registry data
   * @returns {Promise<boolean>} - Success status
   */
  async storeRegistry(registryId, name, data) {
    try {
      const dataJson = JSON.stringify(data);
      
      await sqliteService.db.run(
        `INSERT INTO cheqd_registries (registry_id, name, data) 
         VALUES (?, ?, ?)
         ON CONFLICT(registry_id) DO UPDATE SET 
           name = excluded.name,
           data = excluded.data`,
        [registryId, name, dataJson]
      );
      
      return true;
    } catch (error) {
      logger.error('Failed to store registry', { error: error.message, registryId });
      throw error;
    }
  }
  
  /**
   * Get registry
   * @param {string} registryId - Registry ID
   * @returns {Promise<object|null>} - Registry object
   */
  async getRegistry(registryId) {
    try {
      const result = await sqliteService.db.get(
        'SELECT * FROM cheqd_registries WHERE registry_id = ?',
        [registryId]
      );
      
      if (result) {
        return {
          registryId: result.registry_id,
          registryName: result.name,
          registryData: JSON.parse(result.data),
          createdAt: result.created_at
        };
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get registry', { error: error.message, registryId });
      return null;
    }
  }
}

// Export singleton instance
const cheqdSqliteStorage = new CheqdSqliteStorage();
module.exports = cheqdSqliteStorage; 