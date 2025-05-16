/**
 * Moderation Service
 * 
 * Central service for handling all moderation-related functionality:
 * - Authority verification
 * - Action execution
 * - Audit recording
 * - Appeal processing
 * - Opt-in feature management for cross-chat moderation
 * 
 * This service implements the Group-Controlled Opt-In Model for moderation.
 */

const logger = require('../../utils/logger');
const moderationCredentialService = require('./moderationCredentialService');
const sqliteService = require('../../db/sqliteService');
// Breaking circular dependency by using dynamic loading instead of direct require
let telegramService = null; // Will be loaded dynamically
const config = require('../../config/config');
const { v4: uuidv4 } = require('uuid');

class ModerationService {
  constructor() {
    this.initialized = false;
    
    // Action to human-readable description mapping
    this.ACTION_DESCRIPTIONS = {
      'warn': 'warning',
      'mute': 'restriction',
      'delete': 'message deletion',
      'kick': 'removal from chat',
      'ban': 'ban from chat',
      'pin': 'message pin',
      'announce': 'announcement',
      'add_moderator': 'moderator appointment',
      'remove_mod': 'moderator removal',
      'revoke_cred': 'credential revocation',
      'cross_chat_ban': 'cross-chat ban',
      'cross_chat_warn': 'cross-chat warning',
      'toggle_features': 'feature management'
    };
    
    // Feature flags for opt-in functionality
    this.FEATURES = {
      CROSS_CHAT_MODERATION: 'cross_chat_moderation',
      PLATFORM_MODERATION: 'platform_moderation',
      TRUST_NETWORK: 'trust_network',
      EDUCATIONAL_CREDENTIALS: 'educational_credentials',
      BLOCKCHAIN_VERIFICATION: 'blockchain_verification'
    };
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      logger.info('Initializing moderation service');
      
      // Dynamically load telegramService to avoid circular dependency
      if (!telegramService) {
        telegramService = require('../../services/telegramService');
      }
      
      // Ensure the credential service is initialized
      if (!moderationCredentialService.initialized) {
        await moderationCredentialService.initialize();
      }
      
      // Initialize moderation tables if they don't exist
      await this._initializeDatabase();
      
      this.initialized = true;
      logger.info('Moderation service initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize moderation service', { error: error.message });
      throw error;
    }
  }

  /**
   * Get telegramService instance with lazy loading
   * @private
   */
  _getTelegramService() {
    if (!telegramService) {
      telegramService = require('../../services/telegramService');
    }
    return telegramService;
  }

  /**
   * Initialize database tables for moderation
   * @private
   */
  async _initializeDatabase() {
    try {
      // Create table for moderation actions
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (target_user_id) REFERENCES users(id)
        )
      `);
      
      // Create table for appeals
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS moderation_appeals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          appeal_id TEXT UNIQUE NOT NULL,
          action_id TEXT NOT NULL,
          appealer_id INTEGER NOT NULL,
          status TEXT NOT NULL,
          reason TEXT,
          resolver_id INTEGER,
          resolution TEXT,
          resolution_reason TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          resolved_at TIMESTAMP,
          FOREIGN KEY (appealer_id) REFERENCES users(id),
          FOREIGN KEY (resolver_id) REFERENCES users(id),
          FOREIGN KEY (action_id) REFERENCES moderation_actions(action_id)
        )
      `);
      
      // Create table for telegram admin status caching
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS telegram_chat_admins (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          chat_id INTEGER NOT NULL,
          active INTEGER DEFAULT 1,
          admin_type TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, chat_id)
        )
      `);
      
      // Create table for NFT ownership verification
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS nft_ownership (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          wallet_address TEXT,
          collection TEXT NOT NULL,
          token_id TEXT,
          verified INTEGER DEFAULT 0,
          verified_at TIMESTAMP,
          UNIQUE(user_id, collection)
        )
      `);
      
      // Create table for moderation action history (replaces GunDB storage)
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS moderation_action_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action_id TEXT UNIQUE NOT NULL,
          chat_id INTEGER NOT NULL,
          data TEXT NOT NULL,
          synced INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          synced_at TIMESTAMP,
          FOREIGN KEY (action_id) REFERENCES moderation_actions(action_id)
        )
      `);
      
      // Create table for chat feature opt-in settings
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS chat_features (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id INTEGER NOT NULL,
          feature TEXT NOT NULL,
          enabled INTEGER DEFAULT 0,
          enabled_by INTEGER,
          enabled_at TIMESTAMP,
          settings TEXT,
          UNIQUE(chat_id, feature),
          FOREIGN KEY (enabled_by) REFERENCES users(id)
        )
      `);
      
      logger.info('Moderation database tables initialized');
    } catch (error) {
      logger.error('Failed to initialize moderation database tables', { error: error.message });
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
   * Process a moderation action with complete workflow
   * 
   * This is the main method that implements the moderation workflow:
   * 1. Verify authority
   * 2. Check opt-in status for cross-chat features
   * 3. Execute action
   * 4. Record in audit trail
   * 
   * @param {String} actionType - Type of moderation action (kick, ban, etc.)
   * @param {Object} moderator - User executing the action
   * @param {Object} target - Target user of the action
   * @param {Object} chat - Chat where the action is performed
   * @param {Object} options - Action options (reason, duration, etc.)
   * @returns {Promise<Object>} - Result of the moderation action
   */
  async processModerationAction(actionType, moderator, target, chat, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Processing moderation action', { 
        actionType, 
        moderatorId: moderator.id, 
        targetId: target.id,
        chatId: chat.id
      });
      
      // Step 1: Verify authority
      const authorityResult = await moderationCredentialService.verifyModerationAuthority(
        moderator.id,
        actionType,
        chat.id
      );
      
      if (!authorityResult.verified) {
        logger.warn('Moderation authority verification failed', {
          moderatorId: moderator.id,
          actionType,
          chatId: chat.id,
          reason: authorityResult.reason
        });
        
        return {
          success: false,
          message: authorityResult.reason || 'You do not have permission to perform this action.'
        };
      }
      
      // Step 2: For cross-chat actions, check if the feature is enabled
      if (actionType.startsWith('cross_chat_')) {
        const crossChatEnabled = await this.isFeatureEnabled(
          chat.id, 
          this.FEATURES.CROSS_CHAT_MODERATION
        );
        
        if (!crossChatEnabled) {
          logger.warn('Cross-chat moderation not enabled for this chat', {
            chatId: chat.id,
            actionType
          });
          
          return {
            success: false,
            message: 'Cross-chat moderation is not enabled for this group. Group admins can enable this feature.'
          };
        }
      }
      
      // Step 3: Execute the specific moderation action directly
      // Changed from executeAction to _executeModerationAction to avoid circular dependency
      const actionResult = await this._executeModerationAction(
        actionType,
        moderator,
        target,
        chat,
        options
      );
      
      // Step 4: Record the action in the audit trail if successful
      if (actionResult.success) {
        const actionId = uuidv4();
        
        await this.recordModerationAction(
          actionId,
          actionType,
          moderator,
          target,
          chat,
          options.reason || 'No reason provided',
          {
            duration: options.duration,
            method: options.method || 'telegram',
            credential: authorityResult.credential,
            role: authorityResult.role,
            level: authorityResult.level
          }
        );
        
        // Add the action ID to the result
        actionResult.actionId = actionId;
      }
      
      return actionResult;
    } catch (error) {
      logger.error('Error processing moderation action', { 
        error: error.message,
        actionType,
        moderatorId: moderator.id,
        targetId: target.id,
        chatId: chat.id
      });
      
      return {
        success: false,
        message: 'Error processing moderation action: ' + error.message
      };
    }
  }

  /**
   * Execute a moderation action
   * This is a public wrapper around _executeModerationAction for external API compatibility
   * @param {String} actionType - Type of moderation action (kick, ban, etc.)
   * @param {Object} moderator - User executing the action
   * @param {Object} target - Target user of the action
   * @param {Object} chat - Chat where the action is performed
   * @param {Object} options - Action options (reason, duration, etc.)
   * @returns {Promise<Object>} - Result of the moderation action
   */
  async executeAction(actionType, moderator, target, chat, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Executing moderation action', { 
        actionType, 
        moderator: moderator.username || moderator.id, 
        target: target.username || target.id,
        chatId: chat.id
      });
      
      // Use processModerationAction for the full workflow including authority check
      const result = await this.processModerationAction(
        actionType,
        moderator,
        target,
        chat,
        options
      );
      
      if (!result.success) {
        logger.warn('Moderation action failed', {
          actionType,
          moderator: moderator.username || moderator.id,
          target: target.username || target.id,
          message: result.message
        });
      }
      
      return result;
    } catch (error) {
      logger.error('Error executing moderation action', { 
        error: error.message,
        actionType,
        moderatorId: moderator.id,
        targetId: target.id
      });
      
      return {
        success: false,
        message: `Failed to execute ${actionType} action: ${error.message}`
      };
    }
  }

  /**
   * Execute a specific moderation action
   * @param {String} actionType - Type of moderation action
   * @param {Object} moderator - User executing the action
   * @param {Object} target - Target user of the action
   * @param {Object} chat - Chat where the action is performed
   * @param {Object} options - Action options
   * @returns {Promise<Object>} - Result of execution
   * @private
   */
  async _executeModerationAction(actionType, moderator, target, chat, options = {}) {
    try {
      const actionDescription = this.ACTION_DESCRIPTIONS[actionType] || actionType;
      
      switch (actionType) {
        case 'warn':
          // Send warning message to the user
          await this._getTelegramService().sendMessage(
            target.id,
            `⚠️ <b>Warning:</b> You have received a warning in ${chat.title} for: ${options.reason || 'No reason provided'}.`,
            { parse_mode: 'HTML' }
          );
          
          return {
            success: true,
            message: `Warning sent to ${target.username || target.first_name}`
          };
          
        case 'mute':
          // Mute user for specified duration
          const duration = options.duration || 3600; // Default: 1 hour
          
          await this._getTelegramService().restrictChatMember(
            chat.id,
            target.id,
            {
              can_send_messages: false,
              can_send_media_messages: false,
              can_send_polls: false,
              can_send_other_messages: false,
              can_add_web_page_previews: false,
              until_date: Math.floor(Date.now() / 1000) + duration
            }
          );
          
          return {
            success: true,
            message: `${target.username || target.first_name} has been muted for ${duration / 60} minutes`
          };
          
        case 'delete':
          // Delete message (requires message_id in options)
          if (!options.messageId) {
            return {
              success: false,
              message: 'Message ID required for deletion'
            };
          }
          
          await this._getTelegramService().deleteMessage(chat.id, options.messageId);
          
          return {
            success: true,
            message: `Message from ${target.username || target.first_name} has been deleted`
          };
          
        case 'kick':
          // Kick user from chat
          try {
            logger.info('Attempting to kick user from chat', {
              chatId: chat.id,
              userId: target.id,
              moderatorId: moderator.id
            });
            
            // Get access to the bot instance from telegramService
            if (!this._getTelegramService().bot || !this._getTelegramService().bot.telegram) {
              throw new Error('Telegram bot not initialized or available');
            }
            
            // Use the Telegraf API directly
            // First ban the user
            await this._getTelegramService().bot.telegram.banChatMember(chat.id, target.id);
            
            // Then unban to allow rejoining (kick = remove but can return)
            await this._getTelegramService().bot.telegram.unbanChatMember(chat.id, target.id);
            
            logger.info('Successfully kicked user', {
              targetUser: target.username || target.id,
              chatId: chat.id
            });
            
            // Record the moderation action
            await sqliteService.saveModerationAction({
              action_id: uuidv4(),
              user_id: moderator.id,
              chat_id: chat.id,
              target_user_id: target.id,
              action_type: 'kick',
              reason: options.reason || 'No reason provided'
            });
            
            return {
              success: true,
              message: `${target.username ? '@' + target.username : target.first_name} has been kicked from the chat${options.reason ? ` for: ${options.reason}` : ''}`
            };
          } catch (error) {
            logger.error('Failed to kick user', {
              error: error.message,
              chatId: chat.id,
              userId: target.id
            });
            
            return {
              success: false,
              message: `Failed to kick user: ${error.message}`
            };
          }
          
        case 'ban':
          // Ban user from chat (permanent or temporary)
          try {
            const banDuration = options.duration ? Math.floor(Date.now() / 1000) + options.duration : 0;
            
            // Get access to the bot instance from telegramService
            if (!this._getTelegramService().bot || !this._getTelegramService().bot.telegram) {
              throw new Error('Telegram bot not initialized or available');
            }
            
            // Use the Telegraf API directly
            await this._getTelegramService().bot.telegram.banChatMember(chat.id, target.id, { until_date: banDuration });
            
            const banMessage = options.duration 
              ? `${target.username || target.first_name} has been banned for ${options.duration / 60} minutes`
              : `${target.username || target.first_name} has been permanently banned`;
            
            return {
              success: true,
              message: banMessage
            };
          } catch (error) {
            logger.error('Failed to ban user', {
              error: error.message,
              chatId: chat.id,
              userId: target.id
            });
            
            return {
              success: false,
              message: `Failed to ban user: ${error.message}`
            };
          }
          
        case 'pin':
          // Pin message (requires message_id in options)
          if (!options.messageId) {
            return {
              success: false,
              message: 'Message ID required for pinning'
            };
          }
          
          await this._getTelegramService().pinChatMessage(chat.id, options.messageId, { disable_notification: options.silent });
          
          return {
            success: true,
            message: 'Message has been pinned'
          };
          
        case 'announce':
          // Send announcement to chat
          if (!options.message) {
            return {
              success: false,
              message: 'Announcement message content required'
            };
          }
          
          const announcementResult = await this._getTelegramService().sendMessage(
            chat.id,
            `📢 <b>ANNOUNCEMENT</b>\n\n${options.message}\n\n- ${moderator.username || moderator.first_name}`,
            { parse_mode: 'HTML' }
          );
          
          return {
            success: true,
            message: 'Announcement has been sent',
            messageId: announcementResult.message_id
          };
          
        default:
          return {
            success: false,
            message: `Unknown action type: ${actionType}`
          };
      }
    } catch (error) {
      logger.error('Error executing moderation action', { 
        error: error.message,
        actionType,
        moderatorId: moderator.id,
        targetId: target.id,
        chatId: chat.id
      });
      
      return {
        success: false,
        message: `Failed to execute ${actionType}: ${error.message}`
      };
    }
  }

  /**
   * Record a moderation action in the audit trail
   * @param {String} actionId - Unique action identifier
   * @param {String} actionType - Type of moderation action
   * @param {Object} moderator - User who performed the action
   * @param {Object} target - Target user of the action
   * @param {Object} chat - Chat where the action was performed
   * @param {String} reason - Reason for the action
   * @param {Object} data - Additional action data
   * @returns {Promise<Object>} - Recorded action
   */
  async recordModerationAction(actionId, actionType, moderator, target, chat, reason, data = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Recording moderation action', { 
        actionId,
        actionType, 
        moderatorId: moderator.id, 
        targetId: target.id,
        chatId: chat.id
      });
      
      // Store in SQLite for fast querying
      const jsonData = JSON.stringify(data);
      
      await sqliteService.db.run(
        `INSERT INTO moderation_actions
         (action_id, user_id, chat_id, target_user_id, action_type, reason, duration, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          actionId,
          moderator.id,
          chat.id,
          target.id,
          actionType,
          reason,
          data.duration || null,
          jsonData
        ]
      );
      
      // Prepare record for return value
      const record = {
        id: actionId,
        type: actionType,
        timestamp: Date.now(),
        moderator: {
          id: moderator.id,
          username: moderator.username,
          firstName: moderator.first_name,
          role: data.role || 'Unknown',
          level: data.level || 0,
          method: data.method || 'Unknown'
        },
        target: {
          id: target.id,
          username: target.username,
          firstName: target.first_name
        },
        chat: {
          id: chat.id,
          title: chat.title || `Chat ${chat.id}`
        },
        reason: reason,
        duration: data.duration,
        credential: data.credential ? {
          id: data.credential.id,
          role: data.credential.role,
          level: data.credential.level
        } : null
      };
      
      // Store in cross-instance action history table for synchronization
      await sqliteService.db.run(
        `INSERT OR REPLACE INTO moderation_action_history
         (action_id, chat_id, data, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          actionId,
          chat.id,
          JSON.stringify(record)
        ]
      );
      
      // Send notification to relevant users
      await this._sendModerationNotification(record);
      
      return record;
    } catch (error) {
      logger.error('Error recording moderation action', { 
        error: error.message,
        actionId,
        actionType,
        moderatorId: moderator.id,
        targetId: target.id
      });
      
      // Try to still return a basic record even if storage failed
      return {
        id: actionId,
        type: actionType,
        timestamp: Date.now(),
        moderator: {
          id: moderator.id,
          username: moderator.username
        },
        target: {
          id: target.id,
          username: target.username
        },
        chat: {
          id: chat.id,
          title: chat.title || `Chat ${chat.id}`
        },
        reason: reason,
        storageError: error.message
      };
    }
  }

  /**
   * Process an appeal for a moderation action
   * @param {String} actionId - ID of the action being appealed
   * @param {Object} appealer - User filing the appeal
   * @param {String} reason - Reason for the appeal
   * @param {Object} options - Additional appeal options
   * @returns {Promise<Object>} - Result of appeal filing
   */
  async processAppeal(actionId, appealer, reason, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Processing moderation appeal', { 
        actionId, 
        appealerId: appealer.id, 
        reason
      });
      
      // Verify action exists
      const action = await sqliteService.db.get(
        'SELECT * FROM moderation_actions WHERE action_id = ?',
        [actionId]
      );
      
      if (!action) {
        return {
          success: false,
          message: 'Action not found'
        };
      }
      
      // Verify user is authorized to appeal (must be the target or a higher-level moderator)
      if (action.target_user_id !== appealer.id) {
        // If not the target, check if appealer has higher authority than the moderator
        const appealerAuthority = await moderationCredentialService.verifyModerationAuthority(
          appealer.id,
          'all',
          action.chat_id
        );
        
        const moderatorAuthority = await moderationCredentialService.verifyModerationAuthority(
          action.user_id,
          'all',
          action.chat_id
        );
        
        if (!appealerAuthority.verified || appealerAuthority.level <= moderatorAuthority.level) {
          logger.warn('Unauthorized appeal attempt', {
            appealerId: appealer.id,
            actionId,
            targetId: action.target_user_id
          });
          
          return {
            success: false,
            message: 'You are not authorized to appeal this action'
          };
        }
      }
      
      // Check if an appeal already exists
      const existingAppeal = await sqliteService.db.get(
        'SELECT * FROM moderation_appeals WHERE action_id = ? AND appealer_id = ?',
        [actionId, appealer.id]
      );
      
      if (existingAppeal) {
        return {
          success: false,
          message: 'You have already filed an appeal for this action',
          appealId: existingAppeal.appeal_id
        };
      }
      
      // Create a new appeal
      const appealId = uuidv4();
      
      await sqliteService.db.run(
        `INSERT INTO moderation_appeals
         (appeal_id, action_id, appealer_id, status, reason)
         VALUES (?, ?, ?, ?, ?)`,
        [
          appealId,
          actionId,
          appealer.id,
          'pending',
          reason
        ]
      );
      
      // Notify relevant moderators about the appeal
      await this._notifyModeratorsAboutAppeal(appealId, actionId, appealer, reason, action);
      
      return {
        success: true,
        message: 'Appeal filed successfully',
        appealId
      };
    } catch (error) {
      logger.error('Error processing appeal', { 
        error: error.message,
        actionId,
        appealerId: appealer.id
      });
      
      return {
        success: false,
        message: `Failed to process appeal: ${error.message}`
      };
    }
  }

  /**
   * Update the status of an appeal
   * @param {String} appealId - ID of the appeal
   * @param {String} status - New status ('under_review', 'escalated', 'approved', 'rejected')
   * @param {Object} moderator - Moderator updating the status
   * @param {Object} options - Additional update options
   * @returns {Promise<Object>} - Result of the update
   */
  async updateAppealStatus(appealId, status, moderator, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Updating appeal status', { 
        appealId, 
        status, 
        moderatorId: moderator.id 
      });
      
      // Get the appeal
      const appeal = await sqliteService.db.get(
        'SELECT * FROM moderation_appeals WHERE appeal_id = ?',
        [appealId]
      );
      
      if (!appeal) {
        return {
          success: false,
          message: 'Appeal not found'
        };
      }
      
      // Get the original action to check chat context
      const action = await sqliteService.db.get(
        'SELECT * FROM moderation_actions WHERE action_id = ?',
        [appeal.action_id]
      );
      
      if (!action) {
        return {
          success: false,
          message: 'Original action not found'
        };
      }
      
      // Verify moderator has authority to update appeals
      const moderatorAuthority = await moderationCredentialService.verifyModerationAuthority(
        moderator.id,
        'manage_appeals',
        action.chat_id
      );
      
      if (!moderatorAuthority.verified) {
        return {
          success: false,
          message: 'You do not have permission to manage appeals'
        };
      }
      
      // If the status is resolved (approved/rejected), set the resolver and resolution
      let updateFields = 'status = ?';
      let updateParams = [status];
      
      if (status === 'approved' || status === 'rejected') {
        updateFields += ', resolver_id = ?, resolution = ?, resolution_reason = ?, resolved_at = CURRENT_TIMESTAMP';
        updateParams.push(
          moderator.id,
          status,
          options.reason || 'No reason provided'
        );
        
        // If approved, take remedial action
        if (status === 'approved') {
          await this._processApprovedAppeal(appeal, action, moderator, options);
        }
      }
      
      // Update the appeal record
      await sqliteService.db.run(
        `UPDATE moderation_appeals SET ${updateFields} WHERE appeal_id = ?`,
        [...updateParams, appealId]
      );
      
      // Notify relevant users
      await this._notifyAppealStatusUpdate(appealId, status, moderator, appeal, action, options);
      
      return {
        success: true,
        message: `Appeal status updated to ${status}`
      };
    } catch (error) {
      logger.error('Error updating appeal status', { 
        error: error.message,
        appealId,
        status,
        moderatorId: moderator.id
      });
      
      return {
        success: false,
        message: `Failed to update appeal: ${error.message}`
      };
    }
  }

  /**
   * Process an approved appeal with remedial actions
   * @param {Object} appeal - Appeal object
   * @param {Object} action - Original moderation action
   * @param {Object} moderator - Moderator approving the appeal
   * @param {Object} options - Remedial action options
   * @returns {Promise<Object>} - Result of remedial actions
   * @private
   */
  async _processApprovedAppeal(appeal, action, moderator, options = {}) {
    try {
      // Get target user
      const targetUser = await this._getUserById(action.target_user_id);
      
      if (!targetUser) {
        logger.warn('Could not find target user for remedial action', {
          targetId: action.target_user_id,
          actionId: action.action_id
        });
        return false;
      }
      
      // Execute remedial action based on original action type
      switch (action.action_type) {
        case 'ban':
          // Unban the user
          await this._getTelegramService().unbanChatMember(action.chat_id, targetUser.id);
          
          // Notify the user
          await this._getTelegramService().sendMessage(
            targetUser.id,
            `✅ Your appeal against a ban in "${action.chat_title || 'a chat'}" has been approved. You may rejoin the chat.`
          );
          break;
          
        case 'mute':
          // Unmute the user
          await this._getTelegramService().restrictChatMember(
            action.chat_id,
            targetUser.id,
            {
              can_send_messages: true,
              can_send_media_messages: true,
              can_send_polls: true,
              can_send_other_messages: true,
              can_add_web_page_previews: true
            }
          );
          
          // Notify the user
          await this._getTelegramService().sendMessage(
            targetUser.id,
            `✅ Your appeal against a restriction in "${action.chat_title || 'a chat'}" has been approved. Your ability to send messages has been restored.`
          );
          break;
          
        default:
          // For other actions, just notify the user
          await this._getTelegramService().sendMessage(
            targetUser.id,
            `✅ Your appeal against a moderation action in "${action.chat_title || 'a chat'}" has been approved.`
          );
      }
      
      return true;
    } catch (error) {
      logger.error('Error processing approved appeal remedial actions', {
        error: error.message,
        appealId: appeal.appeal_id,
        actionId: action.action_id
      });
      
      return false;
    }
  }

  /**
   * Send a notification about a moderation action
   * @param {Object} action - Action record
   * @returns {Promise<Boolean>} - Success status
   * @private
   */
  async _sendModerationNotification(action) {
    try {
      // Get action description
      const actionDesc = this.ACTION_DESCRIPTIONS[action.type] || action.type;
      
      // Format message for target user
      const targetMessage = `ℹ️ Moderation notice: You've received a ${actionDesc} in ${action.chat.title} for: ${action.reason}`;
      
      // Send notification to target user
      await this._getTelegramService().sendMessage(action.target.id, targetMessage);
      
      // Send notification to chat moderators (optional)
      if (action.type === 'ban' || action.type === 'kick') {
        try {
          // Get chat moderators (limit to prevent spam)
          const moderators = await moderationCredentialService.getChatModerators(action.chat.id);
          
          if (moderators && moderators.length > 0) {
            // Only notify up to 3 moderators other than the actor
            const otherMods = moderators
              .filter(mod => mod.user_id !== action.moderator.id)
              .slice(0, 3);
            
            // Moderator notification message
            const modMessage = `📋 Moderation log: ${action.moderator.username || action.moderator.firstName} performed ${actionDesc} on ${action.target.username || action.target.firstName} for: ${action.reason}`;
            
            // Send to other moderators
            for (const mod of otherMods) {
              await this._getTelegramService().sendMessage(mod.user_id, modMessage);
            }
          }
        } catch (error) {
          logger.warn('Error notifying moderators about action', {
            error: error.message,
            actionId: action.id
          });
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Error sending moderation notification', {
        error: error.message,
        actionId: action.id
      });
      
      return false;
    }
  }

  /**
   * Notify moderators about a new appeal
   * @param {String} appealId - Appeal ID
   * @param {String} actionId - Action ID
   * @param {Object} appealer - User filing the appeal
   * @param {String} reason - Appeal reason
   * @param {Object} action - Original action
   * @returns {Promise<Boolean>} - Success status
   * @private
   */
  async _notifyModeratorsAboutAppeal(appealId, actionId, appealer, reason, action) {
    try {
      // Get moderators with higher authority than the original moderator
      const moderators = await moderationCredentialService.getChatModerators(action.chat_id);
      
      // Filter for moderators with appeal authority (level 3+)
      const appealModerators = moderators.filter(mod => mod.level >= 3 && mod.user_id !== action.user_id);
      
      if (appealModerators.length === 0) {
        logger.warn('No moderators found for appeal notification', {
          appealId,
          chatId: action.chat_id
        });
        return false;
      }
      
      // Format the notification message
      const message = `🔍 <b>New Appeal Filed</b>\n\n` +
                     `User: ${appealer.username || appealer.first_name} (${appealer.id})\n` +
                     `Original action: ${action.action_type}\n` +
                     `Reason for appeal: ${reason}\n\n` +
                     `Use /review_appeal ${appealId} to respond to this appeal.`;
      
      // Send to up to 3 moderators with appeal authority
      for (const mod of appealModerators.slice(0, 3)) {
        await this._getTelegramService().sendMessage(mod.user_id, message, { parse_mode: 'HTML' });
      }
      
      return true;
    } catch (error) {
      logger.error('Error notifying moderators about appeal', {
        error: error.message,
        appealId
      });
      
      return false;
    }
  }

  /**
   * Notify users about an appeal status update
   * @param {String} appealId - Appeal ID
   * @param {String} status - New status
   * @param {Object} moderator - Moderator updating the status
   * @param {Object} appeal - Appeal object
   * @param {Object} action - Original action
   * @param {Object} options - Additional options
   * @returns {Promise<Boolean>} - Success status
   * @private
   */
  async _notifyAppealStatusUpdate(appealId, status, moderator, appeal, action, options = {}) {
    try {
      // Get the appealer
      const appealer = await this._getUserById(appeal.appealer_id);
      
      if (!appealer) {
        logger.warn('Could not find appealer for notification', {
          appealerId: appeal.appealer_id,
          appealId
        });
        return false;
      }
      
      // Format status for message
      let statusText = 'updated';
      
      switch (status) {
        case 'under_review':
          statusText = 'now under review';
          break;
        case 'escalated':
          statusText = 'escalated to higher authorities';
          break;
        case 'approved':
          statusText = 'approved';
          break;
        case 'rejected':
          statusText = 'rejected';
          break;
      }
      
      // Format message for appealer
      const message = `📣 <b>Appeal Update</b>\n\n` +
                     `Your appeal regarding the "${action.action_type}" action in "${action.chat_title || 'a chat'}" is ${statusText}.\n` +
                     (options.reason ? `Reason: ${options.reason}\n` : '') +
                     (status === 'approved' ? 'Any restrictions have been lifted.' : '');
      
      // Send notification to appealer
      await this._getTelegramService().sendMessage(appealer.id, message, { parse_mode: 'HTML' });
      
      // If status is terminal (approved/rejected), also notify the original moderator
      if (status === 'approved' || status === 'rejected') {
        try {
          const originalMod = await this._getUserById(action.user_id);
          
          if (originalMod) {
            const modMessage = `📣 <b>Appeal Resolution</b>\n\n` +
                              `An appeal against your "${action.action_type}" action on user ${action.target_username || action.target_user_id} ` +
                              `has been ${statusText} by ${moderator.username || moderator.first_name}.\n` +
                              (options.reason ? `Reason: ${options.reason}` : '');
            
            await this._getTelegramService().sendMessage(originalMod.id, modMessage, { parse_mode: 'HTML' });
          }
        } catch (error) {
          logger.warn('Error notifying original moderator about appeal resolution', {
            error: error.message,
            appealId,
            moderatorId: action.user_id
          });
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Error notifying about appeal status update', {
        error: error.message,
        appealId,
        status
      });
      
      return false;
    }
  }

  /**
   * Get a user by ID
   * @param {Number} userId - User ID
   * @returns {Promise<Object|null>} - User object or null
   * @private
   */
  async _getUserById(userId) {
    try {
      const user = await sqliteService.db.get(
        'SELECT * FROM users WHERE id = ?',
        [userId]
      );
      
      return user;
    } catch (error) {
      logger.error('Error getting user by ID', {
        error: error.message,
        userId
      });
      
      return null;
    }
  }

  /**
   * Enable or disable a feature for a chat
   * @param {number} chatId - The chat ID
   * @param {string} feature - Feature to toggle
   * @param {boolean} enabled - Whether to enable or disable
   * @param {number} userId - User ID enabling/disabling the feature
   * @param {Object} settings - Additional settings for the feature
   * @returns {Promise<Object>} - Result of the operation
   */
  async setFeatureEnabled(chatId, feature, enabled, userId, settings = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info(`${enabled ? 'Enabling' : 'Disabling'} feature for chat`, {
        chatId,
        feature,
        userId
      });
      
      // Verify the user has permission to change features
      const hasPermission = await moderationCredentialService.checkModeratorPermission(
        userId,
        chatId,
        'toggle_features'
      );
      
      if (!hasPermission) {
        logger.warn('User does not have permission to change features', {
          userId,
          chatId,
          feature
        });
        
        return {
          success: false,
          message: 'You do not have permission to change group features. Only group administrators can manage features.'
        };
      }
      
      // Check if the feature exists
      const validFeatures = Object.values(this.FEATURES);
      if (!validFeatures.includes(feature)) {
        return {
          success: false,
          message: `Invalid feature: ${feature}`
        };
      }
      
      // Update feature status in database
      const now = new Date().toISOString();
      const settingsJson = JSON.stringify(settings);
      
      // Check if feature entry exists
      const existingFeature = await sqliteService.db.get(
        'SELECT * FROM chat_features WHERE chat_id = ? AND feature = ?',
        [chatId, feature]
      );
      
      if (existingFeature) {
        // Update existing entry
        await sqliteService.db.run(
          `UPDATE chat_features 
           SET enabled = ?, enabled_by = ?, enabled_at = ?, settings = ?
           WHERE chat_id = ? AND feature = ?`,
          [enabled ? 1 : 0, userId, now, settingsJson, chatId, feature]
        );
      } else {
        // Create new entry
        await sqliteService.db.run(
          `INSERT INTO chat_features (chat_id, feature, enabled, enabled_by, enabled_at, settings)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [chatId, feature, enabled ? 1 : 0, userId, now, settingsJson]
        );
      }
      
      // For cross-chat features, special handling
      if (feature === this.FEATURES.CROSS_CHAT_MODERATION) {
        // TODO: When enabling cross-chat, register the chat in the trust network
        // This would involve adding the chat to relevant registries
      }
      
      return {
        success: true,
        message: `${feature} has been ${enabled ? 'enabled' : 'disabled'} for this group.`
      };
    } catch (error) {
      logger.error('Error setting feature status', {
        error: error.message,
        chatId,
        feature,
        enabled
      });
      
      return {
        success: false,
        message: 'Error setting feature status: ' + error.message
      };
    }
  }
  
  /**
   * Check if a feature is enabled for a chat
   * @param {number} chatId - The chat ID
   * @param {string} feature - Feature to check
   * @returns {Promise<boolean>} - Whether the feature is enabled
   */
  async isFeatureEnabled(chatId, feature) {
    await this.ensureInitialized();
    
    try {
      const featureStatus = await sqliteService.db.get(
        'SELECT enabled FROM chat_features WHERE chat_id = ? AND feature = ?',
        [chatId, feature]
      );
      
      return featureStatus && featureStatus.enabled === 1;
    } catch (error) {
      logger.error('Error checking feature status', {
        error: error.message,
        chatId,
        feature
      });
      
      return false;
    }
  }
  
  /**
   * Get all feature settings for a chat
   * @param {number} chatId - The chat ID
   * @returns {Promise<Object>} - Map of features to their status
   */
  async getChatFeatures(chatId) {
    await this.ensureInitialized();
    
    try {
      const features = await sqliteService.db.all(
        'SELECT feature, enabled, settings FROM chat_features WHERE chat_id = ?',
        [chatId]
      );
      
      const featureMap = {};
      
      // Initialize all features as disabled
      Object.values(this.FEATURES).forEach(feature => {
        featureMap[feature] = {
          enabled: false,
          settings: {}
        };
      });
      
      // Update with actual status from database
      features.forEach(row => {
        featureMap[row.feature] = {
          enabled: row.enabled === 1,
          settings: row.settings ? JSON.parse(row.settings) : {}
        };
      });
      
      return featureMap;
    } catch (error) {
      logger.error('Error getting chat features', {
        error: error.message,
        chatId
      });
      
      return {};
    }
  }

  /**
   * Track a moderation action
   * @param {string} userId - User ID performing the action
   * @param {string} chatId - Chat ID where action was performed
   * @param {string} actionType - Type of action
   * @param {string} targetUserId - User ID targeted by action
   * @param {object} data - Additional data about the action
   * @returns {Promise<string>} - Action ID
   */
  async trackModerationAction(userId, chatId, actionType, targetUserId, data = {}) {
    try {
      // Generate a unique action ID if none was provided
      const actionId = data.actionId || `action_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
      
      // Save to database
      await sqliteService.db.run(
        `INSERT INTO moderation_actions 
         (action_id, user_id, chat_id, target_user_id, action_type, data) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          actionId,
          userId,
          chatId,
          targetUserId,
          actionType,
          typeof data === 'object' ? JSON.stringify(data) : data
        ]
      );
      
      logger.info('Tracked moderation action', { 
        actionId, 
        userId, 
        chatId, 
        actionType 
      });
      
      return actionId;
    } catch (error) {
      logger.error('Error tracking moderation action', {
        error: error.message,
        userId,
        chatId,
        actionType
      });
      
      // Create tables if they don't exist
      try {
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
        
        // Try again with table created
        const retryActionId = data.actionId || `action_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
        
        await sqliteService.db.run(
          `INSERT INTO moderation_actions 
           (action_id, user_id, chat_id, target_user_id, action_type, data) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            retryActionId,
            userId,
            chatId,
            targetUserId,
            actionType,
            typeof data === 'object' ? JSON.stringify(data) : data
          ]
        );
        
        logger.info('Tracked moderation action after creating table', { 
          actionId: retryActionId, 
          userId, 
          chatId, 
          actionType 
        });
        
        return retryActionId;
      } catch (retryError) {
        logger.error('Failed retry tracking moderation action', { error: retryError.message });
        // Return a dummy action ID to prevent further errors
        return `dummy_${Date.now()}`;
      }
    }
  }
}

module.exports = new ModerationService(); 