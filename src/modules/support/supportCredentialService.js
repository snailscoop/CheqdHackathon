/**
 * Support Credential Service
 * 
 * This service manages support tier credentials for users.
 */

const logger = require('../../utils/logger');
const grokService = require('../../services/grokService');
const cheqdService = require('../../services/cheqdService');
const sqliteService = require('../../db/sqliteService');
const config = require('../../config/config');

class SupportCredentialService {
  constructor() {
    this.initialized = false;
    
    // Support tier levels and permissions
    this.TIERS = {
      BASIC: {
        name: 'Basic',
        level: 1,
        features: ['Standard support response time', 'Public documentation access'],
        maxTokens: 1000
      },
      STANDARD: {
        name: 'Standard',
        level: 2,
        features: ['Faster support response time', 'Access to community channels', 'Enhanced token allowance'],
        maxTokens: 3000
      },
      PREMIUM: {
        name: 'Premium',
        level: 3,
        features: ['Priority support', 'Premium chat features', 'Higher token limits', 'Access to beta features'],
        maxTokens: 5000
      },
      ENTERPRISE: {
        name: 'Enterprise',
        level: 4,
        features: ['Dedicated support', 'Custom integrations', 'Unlimited tokens', 'Custom feature development'],
        maxTokens: 10000
      }
    };
    
    // P2P Support Provider levels
    this.P2P_SUPPORT_LEVELS = {
      HELPER: {
        name: 'Helper',
        level: 1,
        features: ['Provide basic support to community members', 'Answer common questions'],
        requirements: ['Minimum of Basic support tier']
      },
      ADVISOR: {
        name: 'Advisor',
        level: 2,
        features: ['Provide advanced support', 'Access to support chat rooms', 'Dedicated helper badge'],
        requirements: ['Minimum of Standard support tier', 'Minimum 10 successful support interactions']
      },
      EXPERT: {
        name: 'Expert',
        level: 3,
        features: ['Provide expert-level support', 'Create support resources', 'Community recognition'],
        requirements: ['Minimum of Premium support tier', 'Minimum 50 successful support interactions']
      }
    };
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      logger.info('Initializing support credential service');
      
      // Ensure dependencies are initialized
      if (!grokService.initialized) {
        await grokService.initialize();
      }
      
      if (!cheqdService.initialized) {
        await cheqdService.initialize();
      }
      
      // Initialize support tracking tables if they don't exist
      await this._initializeDatabase();
      
      this.initialized = true;
      logger.info('Support credential service initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize support credential service', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize database tables for support credentials
   * @private
   */
  async _initializeDatabase() {
    try {
      // Create table for support subscriptions
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS support_subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          tier TEXT NOT NULL,
          start_date TIMESTAMP,
          end_date TIMESTAMP,
          credential_id TEXT,
          active INTEGER DEFAULT 1,
          data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);
      
      // Create table for support usage
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS support_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          tokens_used INTEGER DEFAULT 0,
          request_count INTEGER DEFAULT 0,
          reset_date TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);
      
      // Create table for P2P support providers
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS p2p_support_providers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          provider_level TEXT NOT NULL,
          start_date TIMESTAMP,
          end_date TIMESTAMP,
          credential_id TEXT,
          data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `);
      
      // Create table for P2P support interactions
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS p2p_support_interactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id INTEGER NOT NULL,
          seeker_id INTEGER NOT NULL,
          chat_id TEXT,
          successful INTEGER DEFAULT 1,
          interaction_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (provider_id) REFERENCES users(id),
          FOREIGN KEY (seeker_id) REFERENCES users(id)
        )
      `);
      
      // Create table for P2P support requests
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS p2p_support_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          seeker_id INTEGER NOT NULL,
          request_text TEXT,
          status TEXT DEFAULT 'open',
          provider_id INTEGER,
          chat_id TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (seeker_id) REFERENCES users(id),
          FOREIGN KEY (provider_id) REFERENCES users(id)
        )
      `);
      
      logger.info('Support database tables initialized');
    } catch (error) {
      logger.error('Failed to initialize support database tables', { error: error.message });
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
   * Issue a support tier credential
   * @param {Object} user - User information
   * @param {string} tier - Support tier (BASIC, STANDARD, PREMIUM, ENTERPRISE)
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Issued credential
   */
  async issueSupportTierCredential(user, tier, options = {}) {
    await this.ensureInitialized();
    
    try {
      const tierUpper = tier.toUpperCase();
      
      if (!this.TIERS[tierUpper]) {
        throw new Error(`Invalid support tier: ${tier}`);
      }
      
      const tierData = this.TIERS[tierUpper];
      
      logger.info('Issuing support tier credential', { 
        userId: user.id,
        tier: tierData.name
      });
      
      // Get user DIDs
      const userDids = await cheqdService.getUserDids(user.id);
      let userDid;
      
      // Get or create a DID for the user
      if (userDids && userDids.length > 0) {
        userDid = userDids[0].did;
      } else {
        userDid = await cheqdService.createDid(user.id);
      }
      
      // Get bot DID for issuing credentials
      const botDids = await cheqdService.getUserDids(config.telegram.botId || 0);
      let botDid;
      
      if (botDids && botDids.length > 0) {
        botDid = botDids[0].did;
      } else {
        botDid = await cheqdService.createDid(config.telegram.botId || 0);
      }
      
      // Calculate subscription dates
      const startDate = options.startDate ? new Date(options.startDate) : new Date();
      const duration = options.duration || 365; // Default: 1 year
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + duration);
      
      // Prepare credential data
      const credentialData = {
        title: `Support Tier: ${tierData.name}`,
        description: `Access to ${tierData.name} support tier`,
        tier: tierData.name,
        accessLevel: tierData.level,
        features: tierData.features,
        maxTokens: tierData.maxTokens,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      };
      
      // Issue the credential
      const credential = await cheqdService.issueCredential(
        botDid,
        userDid,
        'SupportTier',
        credentialData
      );
      
      // Update subscription in database
      await sqliteService.db.run(
        `INSERT INTO support_subscriptions 
         (user_id, tier, start_date, end_date, credential_id, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          tierData.name,
          startDate.toISOString(),
          endDate.toISOString(),
          credential.credential_id,
          JSON.stringify(credentialData)
        ]
      );
      
      // Initialize usage tracking if it doesn't exist
      await this._initializeUsageTracking(user.id);
      
      logger.info('Support tier credential issued successfully', {
        userId: user.id,
        tier: tierData.name,
        credentialId: credential.credential_id
      });
      
      return {
        issued: true,
        credential: credential,
        tier: tierData,
        subscription: {
          startDate,
          endDate,
          active: true
        }
      };
    } catch (error) {
      logger.error('Failed to issue support tier credential', { 
        error: error.message,
        userId: user.id,
        tier
      });
      throw error;
    }
  }

  /**
   * Get a user's active support tier
   * @param {string|number} userId - User ID
   * @returns {Promise<Object|null>} - User's active support tier or null
   */
  async getUserSupportTier(userId) {
    await this.ensureInitialized();
    
    try {
      // Check for active subscription
      const subscription = await sqliteService.db.get(
        `SELECT * FROM support_subscriptions 
         WHERE user_id = ? AND active = 1 AND end_date > CURRENT_TIMESTAMP
         ORDER BY tier DESC, end_date DESC
         LIMIT 1`,
        [userId]
      );
      
      if (!subscription) {
        // If no active subscription, check for active credentials
        const userDids = await cheqdService.getUserDids(userId);
        
        if (!userDids || userDids.length === 0) {
          return { tier: this.TIERS.BASIC, isDefault: true };
        }
        
        const credentials = await sqliteService.db.all(
          `SELECT * FROM credentials 
           WHERE holder_did = ? AND type = 'SupportTier' AND status = 'active'
           ORDER BY issued_at DESC`,
          [userDids[0].did]
        );
        
        if (!credentials || credentials.length === 0) {
          return { tier: this.TIERS.BASIC, isDefault: true };
        }
        
        // Find highest level active credential that hasn't expired
        let highestTier = null;
        const now = new Date();
        
        for (const cred of credentials) {
          const data = JSON.parse(cred.data);
          const endDate = data.endDate ? new Date(data.endDate) : null;
          
          if (!endDate || endDate > now) {
            const tierName = data.tier.toUpperCase();
            const tierData = this.TIERS[tierName] || this.TIERS.BASIC;
            
            if (!highestTier || tierData.level > highestTier.tier.level) {
              highestTier = {
                tier: tierData,
                credential: cred,
                endDate: endDate,
                isDefault: false
              };
            }
          }
        }
        
        if (highestTier) {
          return highestTier;
        }
        
        return { tier: this.TIERS.BASIC, isDefault: true };
      }
      
      // Return the tier data for the active subscription
      const tierName = subscription.tier.toUpperCase();
      const tierData = this.TIERS[tierName] || this.TIERS.BASIC;
      
      return {
        tier: tierData,
        subscription,
        endDate: new Date(subscription.end_date),
        isDefault: false
      };
    } catch (error) {
      logger.error('Failed to get user support tier', { 
        error: error.message,
        userId
      });
      
      // Default to BASIC tier on error
      return { tier: this.TIERS.BASIC, isDefault: true, error: error.message };
    }
  }

  /**
   * Check if a user has access to a specific feature based on tier
   * @param {string|number} userId - User ID
   * @param {number} requiredLevel - Required tier level
   * @returns {Promise<boolean>} - Whether the user has access
   */
  async checkTierAccess(userId, requiredLevel) {
    try {
      const userTier = await this.getUserSupportTier(userId);
      return userTier.tier.level >= requiredLevel;
    } catch (error) {
      logger.error('Failed to check tier access', { 
        error: error.message,
        userId,
        requiredLevel
      });
      return false;
    }
  }

  /**
   * Track token usage for a user
   * @param {string|number} userId - User ID
   * @param {number} tokens - Number of tokens used
   * @returns {Promise<Object>} - Updated usage info
   */
  async trackTokenUsage(userId, tokens) {
    await this.ensureInitialized();
    
    try {
      // Initialize tracking if it doesn't exist
      await this._initializeUsageTracking(userId);
      
      // Update token usage
      await sqliteService.db.run(
        `UPDATE support_usage
         SET tokens_used = tokens_used + ?,
             request_count = request_count + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [tokens, userId]
      );
      
      // Get updated usage
      return this.getUserTokenUsage(userId);
    } catch (error) {
      logger.error('Failed to track token usage', { 
        error: error.message,
        userId,
        tokens
      });
      throw error;
    }
  }

  /**
   * Get user's token usage
   * @param {string|number} userId - User ID
   * @returns {Promise<Object>} - User's token usage
   */
  async getUserTokenUsage(userId) {
    await this.ensureInitialized();
    
    try {
      // Get current tier
      const userTier = await this.getUserSupportTier(userId);
      
      // Get usage data
      const usage = await sqliteService.db.get(
        'SELECT * FROM support_usage WHERE user_id = ?',
        [userId]
      );
      
      if (!usage) {
        return {
          tokensUsed: 0,
          requestCount: 0,
          maxTokens: userTier.tier.maxTokens,
          remaining: userTier.tier.maxTokens,
          percentUsed: 0,
          resetDate: null
        };
      }
      
      // Calculate remaining tokens
      const remaining = Math.max(0, userTier.tier.maxTokens - usage.tokens_used);
      const percentUsed = (usage.tokens_used / userTier.tier.maxTokens) * 100;
      
      return {
        tokensUsed: usage.tokens_used,
        requestCount: usage.request_count,
        maxTokens: userTier.tier.maxTokens,
        remaining,
        percentUsed,
        resetDate: usage.reset_date ? new Date(usage.reset_date) : null
      };
    } catch (error) {
      logger.error('Failed to get user token usage', { 
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Reset token usage for a user
   * @param {string|number} userId - User ID
   * @returns {Promise<Object>} - Updated usage info
   */
  async resetTokenUsage(userId) {
    await this.ensureInitialized();
    
    try {
      const nextResetDate = new Date();
      nextResetDate.setMonth(nextResetDate.getMonth() + 1);
      
      await sqliteService.db.run(
        `UPDATE support_usage
         SET tokens_used = 0,
             reset_date = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [nextResetDate.toISOString(), userId]
      );
      
      logger.info('Reset token usage for user', { userId });
      
      return this.getUserTokenUsage(userId);
    } catch (error) {
      logger.error('Failed to reset token usage', { 
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Format user's support tier info for display
   * @param {string|number} userId - User ID
   * @returns {Promise<string>} - Formatted tier info
   */
  async formatSupportTierInfo(userId) {
    try {
      const tierInfo = await this.getUserSupportTier(userId);
      const usageInfo = await this.getUserTokenUsage(userId);
      
      // Build a formatted message
      let message = '🌟 *Your Support Tier* 🌟\n\n';
      
      // Add tier info
      message += `Current Tier: ${tierInfo.tier.name}\n`;
      message += `Access Level: ${tierInfo.tier.level}\n`;
      
      if (tierInfo.endDate) {
        message += `Valid Until: ${tierInfo.endDate.toLocaleDateString()}\n`;
      }
      
      message += '\n📋 *Features*\n';
      for (const feature of tierInfo.tier.features) {
        message += `- ${feature}\n`;
      }
      
      // Add usage info
      message += '\n📊 *Token Usage*\n';
      message += `Used: ${usageInfo.tokensUsed} / ${usageInfo.maxTokens}\n`;
      message += `Remaining: ${usageInfo.remaining} (${Math.round(100 - usageInfo.percentUsed)}% left)\n`;
      
      if (usageInfo.resetDate) {
        message += `Next Reset: ${usageInfo.resetDate.toLocaleDateString()}\n`;
      }
      
      return message;
    } catch (error) {
      logger.error('Failed to format support tier info', { 
        error: error.message,
        userId
      });
      return 'Sorry, there was an error retrieving your support tier information.';
    }
  }

  /**
   * Initialize token usage tracking for a user
   * @param {string|number} userId - User ID
   * @private
   */
  async _initializeUsageTracking(userId) {
    try {
      // Check if user already has usage tracking
      const existing = await sqliteService.db.get(
        'SELECT id FROM support_usage WHERE user_id = ?',
        [userId]
      );
      
      if (!existing) {
        // Create new usage tracking
        const resetDate = new Date();
        resetDate.setMonth(resetDate.getMonth() + 1);
        
        await sqliteService.db.run(
          `INSERT INTO support_usage 
           (user_id, tokens_used, request_count, reset_date)
           VALUES (?, 0, 0, ?)`,
          [userId, resetDate.toISOString()]
        );
        
        logger.info('Initialized usage tracking for user', { userId });
      }
    } catch (error) {
      logger.error('Failed to initialize usage tracking', { 
        error: error.message,
        userId
      });
      throw error;
    }
  }

  /**
   * Issue a P2P support provider credential
   * @param {Object} user - User information
   * @param {string} level - Provider level (HELPER, ADVISOR, EXPERT)
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Issued credential
   */
  async issueP2PSupportProviderCredential(user, level, options = {}) {
    await this.ensureInitialized();
    
    try {
      const levelUpper = level.toUpperCase();
      
      if (!this.P2P_SUPPORT_LEVELS[levelUpper]) {
        throw new Error(`Invalid P2P support level: ${level}`);
      }
      
      const levelData = this.P2P_SUPPORT_LEVELS[levelUpper];
      
      logger.info('Issuing P2P support provider credential', { 
        userId: user.id,
        level: levelData.name
      });
      
      // Get user DIDs
      const userDids = await cheqdService.getUserDids(user.id);
      let userDid;
      
      // Get or create a DID for the user
      if (userDids && userDids.length > 0) {
        userDid = userDids[0].did;
      } else {
        userDid = await cheqdService.createDid(user.id);
      }
      
      // Get bot DID for issuing credentials
      const botDids = await cheqdService.getUserDids(config.telegram.botId || 0);
      let botDid;
      
      if (botDids && botDids.length > 0) {
        botDid = botDids[0].did;
      } else {
        botDid = await cheqdService.createDid(config.telegram.botId || 0);
      }
      
      // Check if user meets requirements
      const userTier = await this.getUserSupportTier(user.id);
      
      // Check minimum tier requirement
      if (levelUpper === 'ADVISOR' && userTier.tier.level < 2) {
        throw new Error('Standard support tier or higher required for Advisor level');
      }
      
      if (levelUpper === 'EXPERT' && userTier.tier.level < 3) {
        throw new Error('Premium support tier or higher required for Expert level');
      }
      
      // For Advisor and Expert levels, check successful interactions
      if (levelUpper !== 'HELPER') {
        const supportInteractions = await this.getUserSupportInteractions(user.id);
        const successfulInteractions = supportInteractions.filter(i => i.successful).length;
        
        if (levelUpper === 'ADVISOR' && successfulInteractions < 10) {
          throw new Error('Minimum 10 successful support interactions required for Advisor level');
        }
        
        if (levelUpper === 'EXPERT' && successfulInteractions < 50) {
          throw new Error('Minimum 50 successful support interactions required for Expert level');
        }
      }
      
      // Calculate validity dates
      const startDate = options.startDate ? new Date(options.startDate) : new Date();
      const duration = options.duration || 180; // Default: 6 months
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + duration);
      
      // Prepare credential data
      const credentialData = {
        title: `P2P Support Provider: ${levelData.name}`,
        description: `Authorized to provide peer support at ${levelData.name} level`,
        level: levelData.name,
        accessLevel: levelData.level,
        features: levelData.features,
        requirements: levelData.requirements,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      };
      
      // Issue the credential
      const credential = await cheqdService.issueCredential(
        botDid,
        userDid,
        'P2PSupportProvider',
        credentialData
      );
      
      // Store in database
      await sqliteService.db.run(
        `INSERT INTO p2p_support_providers 
         (user_id, provider_level, start_date, end_date, credential_id, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          levelData.name,
          startDate.toISOString(),
          endDate.toISOString(),
          credential.credential_id,
          JSON.stringify(credentialData)
        ]
      );
      
      logger.info('P2P support provider credential issued successfully', {
        userId: user.id,
        level: levelData.name,
        credentialId: credential.credential_id
      });
      
      return {
        issued: true,
        credential: credential,
        level: levelData,
        validity: {
          startDate,
          endDate,
          active: true
        }
      };
    } catch (error) {
      logger.error('Failed to issue P2P support provider credential', { 
        error: error.message,
        userId: user.id,
        level
      });
      throw error;
    }
  }
  
  /**
   * Get user's P2P support provider status
   * @param {string|number} userId - User ID
   * @returns {Promise<Object|null>} - User's P2P support provider status or null
   */
  async getUserP2PSupportProviderStatus(userId) {
    await this.ensureInitialized();
    
    try {
      // Check for active provider
      const provider = await sqliteService.db.get(
        `SELECT * FROM p2p_support_providers 
         WHERE user_id = ? AND end_date > CURRENT_TIMESTAMP
         ORDER BY provider_level DESC, end_date DESC
         LIMIT 1`,
        [userId]
      );
      
      if (!provider) {
        // Check for credentials directly
        const userDids = await cheqdService.getUserDids(userId);
        
        if (!userDids || userDids.length === 0) {
          return { isProvider: false };
        }
        
        const credentials = await sqliteService.db.all(
          `SELECT * FROM credentials 
           WHERE holder_did = ? AND type = 'P2PSupportProvider' AND status = 'active'
           ORDER BY issued_at DESC`,
          [userDids[0].did]
        );
        
        if (!credentials || credentials.length === 0) {
          return { isProvider: false };
        }
        
        // Find active credential that hasn't expired
        let activeProviderStatus = null;
        const now = new Date();
        
        for (const cred of credentials) {
          const data = JSON.parse(cred.data);
          const endDate = data.endDate ? new Date(data.endDate) : null;
          
          if (!endDate || endDate > now) {
            const levelName = data.level;
            const levelKey = Object.keys(this.P2P_SUPPORT_LEVELS).find(
              key => this.P2P_SUPPORT_LEVELS[key].name === levelName
            );
            const levelData = levelKey ? this.P2P_SUPPORT_LEVELS[levelKey] : null;
            
            if (levelData) {
              activeProviderStatus = {
                isProvider: true,
                level: levelData,
                credential: cred,
                endDate: endDate
              };
              break;
            }
          }
        }
        
        return activeProviderStatus || { isProvider: false };
      }
      
      // Return provider status from database
      const levelName = provider.provider_level;
      const levelKey = Object.keys(this.P2P_SUPPORT_LEVELS).find(
        key => this.P2P_SUPPORT_LEVELS[key].name === levelName
      );
      const levelData = levelKey ? this.P2P_SUPPORT_LEVELS[levelKey] : null;
      
      return {
        isProvider: true,
        level: levelData,
        provider: provider,
        endDate: new Date(provider.end_date)
      };
    } catch (error) {
      logger.error('Failed to get user P2P support provider status', { 
        error: error.message,
        userId
      });
      
      return { isProvider: false, error: error.message };
    }
  }
  
  /**
   * Track P2P support interactions
   * @param {Object} params - Interaction parameters
   * @param {number} params.providerId - Provider user ID
   * @param {number} params.seekerId - Support seeker user ID
   * @param {string} params.chatId - Chat ID where interaction occurred
   * @param {boolean} params.successful - Whether the interaction was successful
   * @returns {Promise<Object>} - Tracked interaction
   */
  async trackP2PSupportInteraction(params) {
    await this.ensureInitialized();
    
    try {
      const { providerId, seekerId, chatId, successful = true } = params;
      
      const interactionId = await sqliteService.db.run(
        `INSERT INTO p2p_support_interactions
         (provider_id, seeker_id, chat_id, successful, interaction_time)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         RETURNING id`,
        [providerId, seekerId, chatId, successful ? 1 : 0]
      );
      
      logger.info('P2P support interaction tracked', {
        providerId,
        seekerId,
        chatId,
        successful,
        interactionId
      });
      
      return {
        id: interactionId,
        providerId,
        seekerId,
        chatId,
        successful,
        time: new Date()
      };
    } catch (error) {
      logger.error('Failed to track P2P support interaction', {
        error: error.message,
        params
      });
      throw error;
    }
  }
  
  /**
   * Get user's support interactions
   * @param {number} userId - User ID
   * @returns {Promise<Array>} - Support interactions
   */
  async getUserSupportInteractions(userId) {
    await this.ensureInitialized();
    
    try {
      const interactions = await sqliteService.db.all(
        `SELECT * FROM p2p_support_interactions
         WHERE provider_id = ?
         ORDER BY interaction_time DESC`,
        [userId]
      );
      
      return interactions.map(interaction => ({
        id: interaction.id,
        seekerId: interaction.seeker_id,
        chatId: interaction.chat_id,
        successful: interaction.successful === 1,
        time: new Date(interaction.interaction_time)
      }));
    } catch (error) {
      logger.error('Failed to get user support interactions', {
        error: error.message,
        userId
      });
      return [];
    }
  }
}

// Export singleton instance
const supportCredentialService = new SupportCredentialService();
module.exports = supportCredentialService; 