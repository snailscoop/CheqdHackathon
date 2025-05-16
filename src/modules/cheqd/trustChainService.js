/**
 * Trust Chain Service
 * 
 * This service handles verification, caching, and visualization
 * of trust chains in the Cheqd Trust Registry system.
 */

const logger = require('../../utils/logger');
const sqliteService = require('../../db/sqliteService');
const cheqdService = require('../../services/cheqdService');

class TrustChainService {
  constructor() {
    this.initialized = false;
    
    // In-memory cache for trust chains
    this.chainCache = {};
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
    
    // Setup cache cleanup interval
    setInterval(() => this._cleanupCache(), 2 * 60 * 1000);
    
    // Registry types and levels
    this.REGISTRY_TYPES = {
      ROOT: 'root',
      PARTNER: 'partner',
      COMMUNITY: 'community',
      BOT: 'bot'
    };
    
    this.PERMISSION_LEVELS = {
      FULL: 'full',
      ELEVATED: 'elevated',
      STANDARD: 'standard',
      BASIC: 'basic'
    };

    // Error recovery configuration
    this.errorRecovery = {
      maxRetries: 3,
      retryDelay: 1000,
      maxDelay: 10000,
      backoffFactor: 2
    };

    // Failed operations tracking
    this.failedOperations = new Map();
    
    // Clean up failed operations tracking every hour
    setInterval(() => this._cleanupFailedOperations(), 3600000);
  }

  /**
   * Clean up failed operations tracking
   * @private
   */
  _cleanupFailedOperations() {
    const now = Date.now();
    for (const [key, data] of this.failedOperations.entries()) {
      if (now - data.lastAttempt > 3600000) { // 1 hour
        this.failedOperations.delete(key);
      }
    }
  }

  /**
   * Execute operation with retry logic
   * @private
   */
  async _executeWithRetry(operation, operationName, options = {}) {
    const maxRetries = options.maxRetries || this.errorRecovery.maxRetries;
    const baseDelay = options.retryDelay || this.errorRecovery.retryDelay;
    const maxDelay = options.maxDelay || this.errorRecovery.maxDelay;
    const backoffFactor = options.backoffFactor || this.errorRecovery.backoffFactor;
    
    let attempt = 0;
    let lastError = null;
    
    while (attempt < maxRetries) {
      try {
        const result = await operation();
        this.failedOperations.delete(operationName);
        return result;
      } catch (error) {
        lastError = error;
        attempt++;
        
        this.failedOperations.set(operationName, {
          lastAttempt: Date.now(),
          attempts: attempt,
          lastError: error.message
        });
        
        const delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt - 1), maxDelay);
        logger.warn(`Operation "${operationName}" failed, retrying ${attempt}/${maxRetries}`, {
          error: error.message,
          delay
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    logger.error(`Operation "${operationName}" failed after ${maxRetries} attempts`, {
      error: lastError.message
    });
    
    throw lastError;
  }

  /**
   * Clean up expired cache entries
   * @private
   */
  _cleanupCache() {
    const now = Date.now();
    for (const key in this.chainCache) {
      if (this.chainCache[key].expires <= now) {
        delete this.chainCache[key];
      }
    }
  }

  /**
   * Initialize the trust chain service
   */
  async initialize() {
    try {
      logger.info('Initializing trust chain service');
      
      // Initialize trust registry tables
      await this._initializeDatabase();
      
      this.initialized = true;
      logger.info('Trust chain service initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize trust chain service', { error: error.message });
      // Mark as initialized anyway to prevent blocking other services
      this.initialized = true;
      logger.warn('Continuing with limited trust chain functionality');
      return false;
    }
  }

  /**
   * Initialize database tables for trust registry
   * @private
   */
  async _initializeDatabase() {
    try {
      // Create table for trust registries
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS trust_registries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          registry_id TEXT UNIQUE NOT NULL,
          registry_name TEXT NOT NULL,
          registry_type TEXT NOT NULL,
          parent_id TEXT,
          did TEXT,
          data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Create table for trust accreditations
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS trust_accreditations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          accreditation_id TEXT UNIQUE NOT NULL,
          registry_id TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          issued_at TIMESTAMP,
          expires_at TIMESTAMP,
          data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (registry_id) REFERENCES trust_registries(registry_id)
        )
      `);
      
      logger.info('Trust registry database tables initialized');
    } catch (error) {
      logger.error('Failed to initialize trust registry database tables', { error: error.message });
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
   * Verify a complete trust chain from a given entity to the root
   * @param {String|Object} entityIdOrObject - Entity ID, DID, or credential object
   * @param {Object} options - Verification options
   * @returns {Promise<Object>} - Trust chain verification result
   */
  async verifyTrustChain(entityIdOrObject, options = {}) {
    await this.ensureInitialized();
    
    return this._executeWithRetry(
      async () => {
        // Determine entity ID or DID
        let entityId;
        let entityType;
        let cacheKey;
        
        if (typeof entityIdOrObject === 'string') {
          entityId = entityIdOrObject;
          
          // Check if this is a credential ID
          try {
            const credential = await sqliteService.db.get(
              'SELECT * FROM credentials WHERE credential_id = ?',
              [entityId]
            );
            
            if (credential) {
              entityId = credential.issuer_did;
              entityType = 'did';
            } 
            // Otherwise assume it's a registry ID
            else {
              entityType = 'registry';
            }
          } catch (error) {
            // If not a credential, assume it's a registry ID
            entityType = 'registry';
          }
        } else if (entityIdOrObject && entityIdOrObject.issuer_did) {
          // It's a credential object
          entityId = entityIdOrObject.issuer_did;
          entityType = 'did';
        } else if (entityIdOrObject && entityIdOrObject.id) {
          // It's a registry object
          entityId = entityIdOrObject.id;
          entityType = 'registry';
        } else {
          throw new Error('Invalid entity identifier provided');
        }
        
        // Generate cache key
        cacheKey = `trustchain:${entityId}`;
        
        // Check cache first
        if (this.chainCache[cacheKey] && this.chainCache[cacheKey].expires > Date.now()) {
          logger.debug('Trust chain found in cache', { entityId });
          return this.chainCache[cacheKey].data;
        }
        
        // Start building the trust chain
        let registry;
        
        if (entityType === 'did') {
          // Find registry by DID
          registry = await this._getRegistryByDid(entityId);
          
          if (!registry) {
            throw new Error(`No registry found for DID: ${entityId}`);
          }
        } else {
          // Get registry by ID
          registry = await sqliteService.db.get(
            'SELECT * FROM trust_registries WHERE registry_id = ?',
            [entityId]
          );
          
          if (!registry) {
            throw new Error(`Registry not found: ${entityId}`);
          }
        }
        
        // Initialize trust chain
        const trustChain = {
          valid: false,
          chain: [],
          level: null,
          errors: [],
          warnings: []
        };
        
        // Build the chain by walking up the parent relationship
        let currentRegistry = registry;
        let depth = 0;
        const maxDepth = 10; // Prevent infinite loops
        
        while (currentRegistry && depth < maxDepth) {
          // Add to chain
          trustChain.chain.push({
            id: currentRegistry.registry_id,
            name: currentRegistry.registry_name,
            type: currentRegistry.registry_type,
            did: currentRegistry.did,
            data: currentRegistry.data ? JSON.parse(currentRegistry.data) : {},
            level: this._getRegistryLevel(currentRegistry.registry_type),
            parentId: currentRegistry.parent_id
          });
          
          // If no parent, break
          if (!currentRegistry.parent_id) {
            break;
          }
          
          // Get parent registry
          currentRegistry = await sqliteService.db.get(
            'SELECT * FROM trust_registries WHERE registry_id = ?',
            [currentRegistry.parent_id]
          );
          
          depth++;
        }
        
        // Validate the chain
        const validationResult = await this.validateTrustChain(trustChain.chain, options);
        
        // Update trust chain with validation results
        trustChain.valid = validationResult.valid;
        trustChain.errors = validationResult.errors;
        trustChain.warnings = validationResult.warnings;
        trustChain.level = this._getHighestLevelInChain(trustChain.chain);
        
        // Store in cache
        this.chainCache[cacheKey] = {
          data: trustChain,
          expires: Date.now() + this.cacheTTL
        };
        
        return trustChain;
      },
      `verify_trust_chain:${entityIdOrObject}`
    );
  }

  /**
   * Generate a visual representation of a trust chain
   * @param {Object} trustChain - Trust chain object
   * @param {Object} options - Visualization options
   * @returns {String} - HTML representation of the trust chain
   */
  generateTrustChainVisualization(trustChain, options = {}) {
    if (!trustChain || !trustChain.chain || trustChain.chain.length === 0) {
      return '<div class="trust-chain-error">No trust chain data available</div>';
    }
    
    // Generate appropriate chart format
    if (options.format === 'json') {
      return JSON.stringify(trustChain, null, 2);
    }
    
    // Default to HTML visualization
    let html = `
      <div class="trust-chain-container">
        <div class="trust-chain-header">
          <h2>Trust Chain Visualization</h2>
          <div class="trust-chain-status ${trustChain.valid ? 'valid' : 'invalid'}">
            ${trustChain.valid ? 'Valid' : 'Invalid'} Chain
          </div>
        </div>
        <div class="trust-chain-body">
    `;
    
    // Add chain links
    for (let i = trustChain.chain.length - 1; i >= 0; i--) {
      const registry = trustChain.chain[i];
      const isRoot = registry.type === this.REGISTRY_TYPES.ROOT;
      const isLast = i === 0;
      
      html += `
        <div class="trust-chain-link ${registry.type}">
          <div class="registry-icon ${registry.type}"></div>
          <div class="registry-details">
            <div class="registry-name">${registry.name}</div>
            <div class="registry-id">${registry.id}</div>
            <div class="registry-type">${registry.type.toUpperCase()}</div>
            ${registry.did ? `<div class="registry-did">${registry.did}</div>` : ''}
          </div>
          ${!isLast ? '<div class="chain-connector"></div>' : ''}
        </div>
      `;
    }
    
    // Add errors and warnings
    if (trustChain.errors.length > 0 || trustChain.warnings.length > 0) {
      html += '<div class="trust-chain-messages">';
      
      if (trustChain.errors.length > 0) {
        html += '<div class="trust-chain-errors">';
        html += '<h3>Errors</h3>';
        html += '<ul>';
        for (const error of trustChain.errors) {
          html += `<li>${error}</li>`;
        }
        html += '</ul>';
        html += '</div>';
      }
      
      if (trustChain.warnings.length > 0) {
        html += '<div class="trust-chain-warnings">';
        html += '<h3>Warnings</h3>';
        html += '<ul>';
        for (const warning of trustChain.warnings) {
          html += `<li>${warning}</li>`;
        }
        html += '</ul>';
        html += '</div>';
      }
      
      html += '</div>';
    }
    
    html += `
        </div>
      </div>
    `;
    
    return html;
  }

  /**
   * Get a permissioned link for a trust chain
   * @param {Object} trustChain - Trust chain object
   * @param {String} permissionLevel - Required permission level
   * @returns {String|null} - Permission link or null if insufficient permissions
   */
  getPermissionedLink(trustChain, permissionLevel) {
    if (!trustChain || !trustChain.valid) {
      return null;
    }
    
    // Get chain's highest level
    const chainLevel = trustChain.level;
    
    if (!this._isLevelSufficientForMinimum(chainLevel, permissionLevel)) {
      return null;
    }
    
    // Generate a signed link - in a real implementation this would be cryptographically signed
    const token = Buffer.from(JSON.stringify({
      chainId: trustChain.chain[0].id,
      level: chainLevel,
      expires: Date.now() + 3600000, // 1 hour
      permissions: permissionLevel
    })).toString('base64');
    
    return `https://registry.cheqd.io/verify?token=${token}`;
  }

  /**
   * Invalidate a trust chain in the cache
   * @param {String} entityId - Entity ID to invalidate
   */
  invalidateCache(entityId) {
    if (!entityId) return;
    
    const cacheKey = `trustchain:${entityId}`;
    
    if (this.chainCache[cacheKey]) {
      delete this.chainCache[cacheKey];
      logger.debug('Invalidated trust chain cache', { entityId });
    }
  }

  /**
   * Get registry level based on type
   * @param {String} registryType - Registry type
   * @returns {String} - Permission level
   * @private
   */
  _getRegistryLevel(registryType) {
    switch (registryType) {
      case this.REGISTRY_TYPES.ROOT:
        return this.PERMISSION_LEVELS.FULL;
      case this.REGISTRY_TYPES.PARTNER:
        return this.PERMISSION_LEVELS.ELEVATED;
      case this.REGISTRY_TYPES.COMMUNITY:
        return this.PERMISSION_LEVELS.STANDARD;
      case this.REGISTRY_TYPES.BOT:
        return this.PERMISSION_LEVELS.BASIC;
      default:
        return this.PERMISSION_LEVELS.BASIC;
    }
  }

  /**
   * Create a trust chain (simplified for SQLite implementation)
   * @param {Object} options - Creation options
   * @returns {Promise<Object>} - Created trust chain
   */
  async createTrustChain(options = {}) {
    await this.ensureInitialized();
    
    return this._executeWithRetry(
      async () => {
        // Create root registry if it doesn't exist
        let rootRegistry = await sqliteService.db.get(
          'SELECT * FROM trust_registries WHERE registry_type = ?',
          [this.REGISTRY_TYPES.ROOT]
        );
        
        if (!rootRegistry) {
          // Create root registry
          const rootName = options.rootName || 'Root Trust Registry';
          const rootId = options.rootId || `root-${Date.now()}`;
          
          await sqliteService.db.run(
            `INSERT INTO trust_registries 
             (registry_id, registry_name, registry_type, did, data)
             VALUES (?, ?, ?, ?, ?)`,
            [
              rootId,
              rootName,
              this.REGISTRY_TYPES.ROOT,
              options.rootDid || null,
              JSON.stringify({
                description: options.rootDescription || 'Root trust registry',
                created: new Date().toISOString()
              })
            ]
          );
          
          rootRegistry = await sqliteService.db.get(
            'SELECT * FROM trust_registries WHERE registry_id = ?',
            [rootId]
          );
        }
        
        // Create partner registry
        const partnerId = options.partnerId || `partner-${Date.now()}`;
        const partnerName = options.partnerName || 'Partner Trust Registry';
        
        await sqliteService.db.run(
          `INSERT INTO trust_registries 
           (registry_id, registry_name, registry_type, parent_id, did, data)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            partnerId,
            partnerName,
            this.REGISTRY_TYPES.PARTNER,
            rootRegistry.registry_id,
            options.partnerDid || null,
            JSON.stringify({
              description: options.partnerDescription || 'Partner trust registry',
              created: new Date().toISOString()
            })
          ]
        );
        
        // Create community registry
        const communityId = options.communityId || `community-${Date.now()}`;
        const communityName = options.communityName || 'Community Trust Registry';
        
        await sqliteService.db.run(
          `INSERT INTO trust_registries 
           (registry_id, registry_name, registry_type, parent_id, did, data)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            communityId,
            communityName,
            this.REGISTRY_TYPES.COMMUNITY,
            partnerId,
            options.communityDid || null,
            JSON.stringify({
              description: options.communityDescription || 'Community trust registry',
              created: new Date().toISOString()
            })
          ]
        );
        
        // Get the full chain
        const trustChain = await this.verifyTrustChain(communityId);
        
        return trustChain;
      },
      'create_trust_chain'
    );
  }

  /**
   * Get a registry by DID
   * @param {String} did - DID to search for
   * @returns {Promise<Object|null>} - Registry or null if not found
   * @private
   */
  async _getRegistryByDid(did) {
    try {
      return await sqliteService.db.get(
        'SELECT * FROM trust_registries WHERE did = ?',
        [did]
      );
    } catch (error) {
      logger.error('Failed to get registry by DID', { error: error.message, did });
      return null;
    }
  }

  /**
   * Validate a trust chain
   * @param {Array} chain - Trust chain to validate
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} - Validation result
   * @private
   */
  async validateTrustChain(chain, options = {}) {
    const result = {
      valid: true,
      errors: [],
      warnings: []
    };
    
    if (!chain || chain.length === 0) {
      result.valid = false;
      result.errors.push('Empty trust chain');
      return result;
    }
    
    // Check if chain includes a root
    const hasRoot = chain.some(registry => registry.type === this.REGISTRY_TYPES.ROOT);
    
    if (!hasRoot) {
      result.valid = false;
      result.errors.push('Trust chain does not include a root registry');
    }
    
    // Check chain integrity (each registry should point to a valid parent)
    for (let i = 0; i < chain.length - 1; i++) {
      const registry = chain[i];
      const parent = chain[i + 1];
      
      if (registry.parentId !== parent.id) {
        result.valid = false;
        result.errors.push(`Invalid parent relationship: ${registry.id} → ${parent.id}`);
      }
    }
    
    // Check for circular references
    const idSet = new Set();
    for (const registry of chain) {
      if (idSet.has(registry.id)) {
        result.valid = false;
        result.errors.push(`Circular reference detected: ${registry.id}`);
        break;
      }
      idSet.add(registry.id);
    }
    
    // For future: Add cryptographic validation, expiry checks, etc.
    
    return result;
  }

  /**
   * Get highest permission level in a chain
   * @param {Array} chain - Trust chain
   * @returns {String} - Highest permission level
   * @private
   */
  _getHighestLevelInChain(chain) {
    if (!chain || chain.length === 0) {
      return this.PERMISSION_LEVELS.BASIC;
    }
    
    const levelPriority = {
      [this.PERMISSION_LEVELS.FULL]: 4,
      [this.PERMISSION_LEVELS.ELEVATED]: 3,
      [this.PERMISSION_LEVELS.STANDARD]: 2,
      [this.PERMISSION_LEVELS.BASIC]: 1
    };
    
    let highestLevel = this.PERMISSION_LEVELS.BASIC;
    let highestPriority = 1;
    
    for (const registry of chain) {
      const level = registry.level || this._getRegistryLevel(registry.type);
      const priority = levelPriority[level] || 1;
      
      if (priority > highestPriority) {
        highestLevel = level;
        highestPriority = priority;
      }
    }
    
    return highestLevel;
  }

  /**
   * Check if a level is sufficient for a minimum requirement
   * @param {String} level - Current level
   * @param {String} minimumLevel - Minimum required level
   * @returns {Boolean} - Whether the level is sufficient
   * @private
   */
  _isLevelSufficientForMinimum(level, minimumLevel) {
    const levelPriority = {
      [this.PERMISSION_LEVELS.FULL]: 4,
      [this.PERMISSION_LEVELS.ELEVATED]: 3,
      [this.PERMISSION_LEVELS.STANDARD]: 2,
      [this.PERMISSION_LEVELS.BASIC]: 1
    };
    
    const currentPriority = levelPriority[level] || 1;
    const requiredPriority = levelPriority[minimumLevel] || 1;
    
    return currentPriority >= requiredPriority;
  }
}

// Export singleton instance
const trustChainService = new TrustChainService();
module.exports = trustChainService; 