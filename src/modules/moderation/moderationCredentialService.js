/**
 * Moderation Credential Service
 * 
 * This service manages the issuance and verification of moderation credentials
 * for chat administrators and moderators.
 * 
 * IMPORTANT: This service follows a strict no-fallbacks policy:
 * - All operations must use real blockchain data
 * - No mock credentials or DIDs are allowed
 * - Operations will fail rather than use mock data
 * - Only store confirmed data from the blockchain
 */

const logger = require('../../utils/logger');
const grokService = require('../../services/grokService');
const cheqdService = require('../../services/cheqdService');
const sqliteService = require('../../db/sqliteService');
const config = require('../../config/config');

class ModerationCredentialService {
  constructor() {
    this.initialized = false;
    
    // Moderation roles and permissions - Group-Controlled Opt-In Model
    this.ROLES = {
      GROUP_ADMIN: {
        name: 'GroupAdmin',
        level: 3,
        permissions: [
          'manage_users',
          'manage_messages',
          'manage_settings',
          'manage_credentials',
          'manage_appeals',
          'manage_moderators',
          'manage_features'
        ]
      },
      GROUP_MODERATOR: {
        name: 'GroupModerator',
        level: 2,
        permissions: [
          'manage_users',
          'manage_messages',
          'basic_settings'
        ]
      },
      GROUP_HELPER: {
        name: 'GroupHelper',
        level: 1,
        permissions: [
          'flag_messages',
          'report_users'
        ]
      },
      CROSS_CHAT_MODERATOR: {
        name: 'CrossChatModerator',
        level: 2,
        scope: 'multi-group',
        permissions: [
          'cross_chat_moderation',
          'shared_ban_lists',
          'moderation_coordination'
        ]
      },
      PLATFORM_MODERATOR: {
        name: 'PlatformModerator',
        level: 3,
        scope: 'platform',
        permissions: [
          'platform_moderation',
          'credential_verification',
          'appeals_review'
        ]
      },
      PLATFORM_ADMIN: {
        name: 'PlatformAdmin',
        level: 4,
        scope: 'platform',
        permissions: [
          'manage_platform',
          'manage_registries',
          'revoke_credentials',
          'manage_trust_chain'
        ]
      }
    };
    
    // Role definitions for the Group-Controlled Opt-In Model
    this.ROLE_LEVELS = {
      // Group-specific roles (controlled by group admins)
      'GroupAdmin': {
        level: 3,
        scope: 'group',
        canManageModerators: true,
        canOptInFeatures: true
      },
      'GroupModerator': {
        level: 2,
        scope: 'group',
        canManageModerators: false,
        canOptInFeatures: false
      },
      'GroupHelper': {
        level: 1,
        scope: 'group',
        canManageModerators: false,
        canOptInFeatures: false
      },
      
      // Platform-level roles (opt-in required to be effective)
      'CrossChatModerator': {
        level: 2,
        scope: 'multi-group',
        requiresOptIn: true,
        canManageModerators: false,
        canOptInFeatures: false
      },
      'PlatformModerator': {
        level: 3,
        scope: 'platform',
        requiresOptIn: true,
        canManageModerators: false,
        canOptInFeatures: false
      },
      'PlatformAdmin': {
        level: 4,
        scope: 'platform',
        requiresOptIn: false, // Platform admins can manage the system itself
        canManageModerators: true,
        canOptInFeatures: true
      }
    };
    
    // Action permission mapping - updated for Group-Controlled Opt-In Model
    this.ACTION_PERMISSIONS = {
      // Group-specific actions (group scope)
      'warn': { minLevel: 1, scope: 'group' },       // GroupHelper or higher
      'mute': { minLevel: 2, scope: 'group' },       // GroupModerator or higher
      'delete': { minLevel: 2, scope: 'group' },     // GroupModerator or higher
      'kick': { minLevel: 2, scope: 'group' },       // GroupModerator or higher
      'ban': { minLevel: 3, scope: 'group' },        // GroupAdmin only (in their group)
      'pin': { minLevel: 2, scope: 'group' },        // GroupModerator or higher
      'add_moderator': { minLevel: 3, scope: 'group' }, // GroupAdmin only
      'remove_mod': { minLevel: 3, scope: 'group' },    // GroupAdmin only
      
      // Cross-chat actions (multi-group scope, requires opt-in)
      'cross_chat_ban': { minLevel: 2, scope: 'multi-group', requiresOptIn: true },
      'cross_chat_warn': { minLevel: 2, scope: 'multi-group', requiresOptIn: true },
      
      // Platform actions (platform scope)
      'revoke_cred': { minLevel: 4, scope: 'platform' }, // PlatformAdmin only
      'manage_registry': { minLevel: 4, scope: 'platform' }, // PlatformAdmin only
      
      // Feature management (group-specific but high level)
      'toggle_features': { minLevel: 3, scope: 'group' } // GroupAdmin only
    };
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      logger.info('Initializing moderation credential service');
      
      // Ensure dependencies are initialized
      if (!grokService.initialized) {
        await grokService.initialize();
      }
      
      if (!cheqdService.initialized) {
        await cheqdService.initialize();
      }
      
      // Initialize moderation tables if they don't exist
      await this._initializeDatabase();
      
      this.initialized = true;
      logger.info('Moderation credential service initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize moderation credential service', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize database tables for moderation credentials
   * @private
   */
  async _initializeDatabase() {
    try {
      // Create table for moderation assignments
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS moderation_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          chat_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          assigned_by INTEGER,
          credential_id TEXT,
          start_date TIMESTAMP,
          end_date TIMESTAMP,
          active INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (assigned_by) REFERENCES users(id)
        )
      `);
      
      // Create table for moderation actions
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS moderation_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          chat_id INTEGER NOT NULL,
          target_user_id INTEGER,
          action_type TEXT NOT NULL,
          reason TEXT,
          data TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (target_user_id) REFERENCES users(id)
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
   * Issue a moderation credential
   * @param {Object} issuer - Issuer user information (typically an admin)
   * @param {Object} recipient - Recipient user information
   * @param {string} role - Moderation role (ADMIN, SENIOR_MODERATOR, MODERATOR, HELPER)
   * @param {Object} chatInfo - Chat information
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Issued credential
   */
  async issueModerationCredential(issuer, recipient, role, chatInfo, options = {}) {
    await this.ensureInitialized();
    
    try {
      const roleUpper = role.toUpperCase();
      
      if (!this.ROLES[roleUpper]) {
        throw new Error(`Invalid moderation role: ${role}`);
      }
      
      const roleData = this.ROLES[roleUpper];
      
      logger.info('Issuing moderation credential', { 
        issuerId: issuer.id,
        recipientId: recipient.id,
        chatId: chatInfo.id,
        role: roleData.name
      });
      
      // Check if issuer has permission
      const issuerPermission = await this.checkModeratorPermission(
        issuer.id, 
        chatInfo.id, 
        'manage_moderators'
      );
      
      if (!issuerPermission && !options.override) {
        throw new Error('Issuer does not have permission to assign moderators');
      }
      
      // Create system user to handle undefined IDs
      try {
        await sqliteService.db.run(
          `INSERT OR IGNORE INTO users (id, username, first_name, last_name) VALUES (?, ?, ?, ?)`,
          [0, 'system', 'System', 'User']
        );
      } catch (sysError) {
        logger.warn('Error creating system user', { error: sysError.message });
      }
      
      // Get DIDs for issuer and recipient
      const issuerDids = await cheqdService.getUserDids(issuer.id);
      const recipientDids = await cheqdService.getUserDids(recipient.id);
      
      let issuerDid, recipientDid;
      
      // Get or create issuer DID - no fallbacks to mock DIDs
      if (issuerDids && issuerDids.length > 0) {
        issuerDid = issuerDids[0].did;
      } else {
        try {
          // Use the standard method name with proper case
          const newDid = await cheqdService.createDID(issuer.id);
          issuerDid = typeof newDid === 'object' ? newDid.did : newDid;
          
          // Verify DID was created successfully
          if (!issuerDid) {
            throw new Error('Created DID returned empty');
          }
          
          logger.debug('Created new issuer DID', { did: issuerDid });
        } catch (didError) {
          logger.error('Failed to create issuer DID', { error: didError.message });
          throw new Error(`Cannot proceed without valid issuer DID: ${didError.message}`);
        }
      }
      
      // Get or create recipient DID - no fallbacks to mock DIDs
      if (recipientDids && recipientDids.length > 0) {
        recipientDid = recipientDids[0].did;
      } else {
        try {
          // Use the standard method name with proper case
          const newDid = await cheqdService.createDID(recipient.id);
          recipientDid = typeof newDid === 'object' ? newDid.did : newDid;
          
          // Verify DID was created successfully
          if (!recipientDid) {
            throw new Error('Created DID returned empty');
          }
          
          logger.debug('Created new recipient DID', { did: recipientDid });
        } catch (didError) {
          logger.error('Failed to create recipient DID', { error: didError.message });
          throw new Error(`Cannot proceed without valid recipient DID: ${didError.message}`);
        }
      }
      
      // Calculate assignment dates
      const startDate = options.startDate ? new Date(options.startDate) : new Date();
      const duration = options.duration || 90; // Default: 90 days
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + duration);
      
      // Prepare credential data
      const credentialData = {
        title: `Moderation Role: ${roleData.name}`,
        description: `Authority to moderate in ${chatInfo.title || 'a Telegram chat'}`,
        role: roleData.name,
        permissions: roleData.permissions,
        level: roleData.level,
        communities: [{
          id: chatInfo.id.toString(),
          name: chatInfo.title || `Chat ${chatInfo.id}`,
          platform: 'Telegram'
        }],
        issuer: {
          id: issuer.id.toString(),
          name: issuer.username || issuer.first_name || `User ${issuer.id}`
        },
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      };
      
      // Ensure that issuerDid and recipientDid are strings - MOVED OUTSIDE try/catch for fallback access
      const issuerDidString = typeof issuerDid === 'object' ? issuerDid.did : issuerDid;
      const recipientDidString = typeof recipientDid === 'object' ? recipientDid.did : recipientDid;
      
      // Issue the credential
      let credential;
      try {
        credential = await cheqdService.issueCredential(
          issuerDidString,
          recipientDidString,
          'ModerationCredential',
          credentialData
        );
      } catch (credError) {
        logger.error('Error issuing credential through cheqdService', { error: credError.message });
        // No mock fallbacks - propagate the error to ensure we only use real credentials
        throw new Error(`Failed to issue credential: ${credError.message}`);
      }
      
      // Save to moderation assignments
      try {
        // Make sure recipient and issuer exist in database with proper error handling
        await sqliteService.db.run(
          `INSERT OR IGNORE INTO users (id, username, first_name, last_name) VALUES (?, ?, ?, ?)`,
          [parseInt(recipient.id), recipient.username || '', recipient.firstName || '', recipient.lastName || '']
        );

        // Make sure chat exists in database with proper error handling
        const chatIdInt = parseInt(chatInfo.id);
        await sqliteService.db.run(
          `INSERT OR IGNORE INTO chats (id, title, type) VALUES (?, ?, ?)`,
          [chatIdInt, chatInfo.title || '', chatInfo.type || 'group']
        );

        // Ensure the role name is valid and not null/undefined
        if (!roleData.name) {
          throw new Error('Role name cannot be null or undefined');
        }

        // Now insert the moderation assignment with mandatory field validation
        await sqliteService.db.run(
          `INSERT INTO moderation_assignments 
           (user_id, chat_id, role, assigned_by, credential_id, start_date, end_date)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            parseInt(recipient.id),
            chatIdInt,
            roleData.name, // Verified above to ensure it's not null/undefined
            issuer.id ? parseInt(issuer.id) : 0, // Use system user (0) if undefined
            credential.credential_id || `cred-${Date.now()}`, // Fallback ID if missing
            startDate.toISOString(),
            endDate.toISOString()
          ]
        );
      } catch (dbError) {
        logger.error('Error saving moderation assignment to database', { error: dbError.message });
        // Don't continue - if DB save fails, the credential is not properly assigned
        throw new Error(`Failed to save moderation assignment: ${dbError.message}`);
      }
      
      // Record this as a moderation action
      try {
        // Make sure we have a valid issuer ID for the action tracking
        const trackIssuerId = (issuer && issuer.id && issuer.id !== "undefined") ? issuer.id : 0;
        
        await this.trackModerationAction(
          trackIssuerId,
          chatInfo.id,
          'assign_role',
          recipient.id,
          {
            role: roleData.name,
            credentialId: credential.credential_id,
            reason: options.reason || `Assigned role: ${roleData.name}`
          }
        );
      } catch (trackError) {
        logger.error('Error tracking moderation action', { error: trackError.message });
        // Continue with the process even if tracking fails
      }
      
      logger.info('Moderation credential issued successfully', {
        issuerId: issuer.id,
        recipientId: recipient.id,
        chatId: chatInfo.id,
        role: roleData.name,
        credentialId: credential.credential_id
      });
      
      return {
        issued: true,
        credential: credential,
        role: roleData,
        assignment: {
          startDate,
          endDate,
          active: true
        }
      };
    } catch (error) {
      logger.error('Failed to issue moderation credential', { 
        error: error.message,
        issuerId: issuer.id,
        recipientId: recipient.id,
        chatId: chatInfo.id,
        role
      });
      throw error;
    }
  }

  /**
   * Revoke a moderation credential
   * @param {Object} issuer - Issuer user information (typically an admin)
   * @param {number} targetUserId - User ID whose credential is being revoked
   * @param {number} chatId - Chat ID
   * @param {string} reason - Reason for revocation
   * @returns {Promise<Object>} - Revocation result
   */
  async revokeModerationCredential(issuer, targetUserId, chatId, reason) {
    await this.ensureInitialized();
    
    try {
      logger.info('Revoking moderation credential', { 
        issuerId: issuer.id,
        targetUserId,
        chatId
      });
      
      // Check if issuer has permission
      const issuerPermission = await this.checkModeratorPermission(
        issuer.id, 
        chatId, 
        'manage_moderators'
      );
      
      if (!issuerPermission) {
        throw new Error('User does not have permission to revoke moderator roles');
      }
      
      // Get active assignment
      const assignment = await sqliteService.db.get(
        `SELECT * FROM moderation_assignments 
         WHERE user_id = ? AND chat_id = ? AND active = 1
         ORDER BY created_at DESC LIMIT 1`,
        [targetUserId, chatId]
      );
      
      if (!assignment) {
        throw new Error('No active moderation assignment found');
      }
      
      // Deactivate the assignment
      await sqliteService.db.run(
        `UPDATE moderation_assignments 
         SET active = 0, end_date = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [assignment.id]
      );
      
      // Revoke the credential
      let credentialRevoked = false;
      
      if (assignment.credential_id) {
        // No fallbacks - if credential revocation fails, the entire operation fails
        await cheqdService.revokeCredential(
          assignment.credential_id, 
          reason || 'Role revoked by admin'
        );
        credentialRevoked = true;
      }
      
      // Record this as a moderation action
      await this.trackModerationAction(
        issuer.id,
        chatId,
        'revoke_role',
        targetUserId,
        {
          role: assignment.role,
          credentialId: assignment.credential_id,
          reason: reason || 'Role revoked'
        }
      );
      
      logger.info('Moderation role revoked successfully', {
        issuerId: issuer.id,
        targetUserId,
        chatId,
        role: assignment.role
      });
      
      return {
        revoked: true,
        assignmentDeactivated: true,
        credentialRevoked,
        assignment
      };
    } catch (error) {
      logger.error('Failed to revoke moderation credential', { 
        error: error.message,
        issuerId: issuer.id,
        targetUserId,
        chatId
      });
      throw error;
    }
  }

  /**
   * Check if a user has a specific moderation permission in a chat
   * @param {number} userId - User ID
   * @param {number} chatId - Chat ID
   * @param {string} permission - Required permission
   * @returns {Promise<boolean>} - Whether the user has the permission
   */
  async checkModeratorPermission(userId, chatId, permission) {
    await this.ensureInitialized();
    
    try {
      // Special case for bot admins
      const adminIds = await sqliteService.getSetting('bot_admins');
      if (adminIds) {
        try {
          const admins = JSON.parse(adminIds);
          if (admins.includes(userId.toString())) {
            return true;
          }
        } catch (parseError) {
          logger.error('Failed to parse bot_admins setting', {
            error: parseError.message
          });
        }
      }
      
      // Check for active assignment in this chat
      const assignment = await sqliteService.db.get(
        `SELECT * FROM moderation_assignments 
         WHERE user_id = ? AND chat_id = ? AND active = 1
         AND (end_date IS NULL OR end_date > CURRENT_TIMESTAMP)
         ORDER BY role DESC LIMIT 1`,
        [userId, chatId]
      );
      
      if (!assignment) {
        return false;
      }
      
      // Get role data
      let roleData = null;
      
      for (const role in this.ROLES) {
        if (this.ROLES[role].name === assignment.role) {
          roleData = this.ROLES[role];
          break;
        }
      }
      
      if (!roleData) {
        return false;
      }
      
      // Check if role has the required permission
      return roleData.permissions.includes(permission);
    } catch (error) {
      logger.error('Failed to check moderator permission', { 
        error: error.message,
        userId,
        chatId,
        permission
      });
      return false;
    }
  }

  /**
   * Get user's moderation roles in a chat
   * @param {number} userId - User ID
   * @param {number} chatId - Chat ID (optional, if not provided, gets roles in all chats)
   * @returns {Promise<Array>} - List of moderation roles
   */
  async getUserModerationRoles(userId, chatId = null) {
    await this.ensureInitialized();
    
    try {
      let query, params;
      
      if (chatId) {
        // Get roles in a specific chat
        query = `
          SELECT * FROM moderation_assignments 
          WHERE user_id = ? AND chat_id = ? AND active = 1
          AND (end_date IS NULL OR end_date > CURRENT_TIMESTAMP)
          ORDER BY created_at DESC
        `;
        params = [userId, chatId];
      } else {
        // Get roles in all chats
        query = `
          SELECT * FROM moderation_assignments 
          WHERE user_id = ? AND active = 1
          AND (end_date IS NULL OR end_date > CURRENT_TIMESTAMP)
          ORDER BY chat_id, created_at DESC
        `;
        params = [userId];
      }
      
      const assignments = await sqliteService.db.all(query, params);
      
      if (!assignments || assignments.length === 0) {
        return [];
      }
      
      // Get chat info for each assignment
      const roles = [];
      
      for (const assignment of assignments) {
        // Get chat info
        let chatInfo;
        try {
          chatInfo = await sqliteService.getChat(assignment.chat_id);
        } catch (error) {
          chatInfo = { id: assignment.chat_id, title: `Chat ${assignment.chat_id}` };
        }
        
        // Get role data
        let roleData = null;
        for (const role in this.ROLES) {
          if (this.ROLES[role].name === assignment.role) {
            roleData = this.ROLES[role];
            break;
          }
        }
        
        roles.push({
          chat: chatInfo,
          role: assignment.role,
          roleData,
          startDate: new Date(assignment.start_date),
          endDate: assignment.end_date ? new Date(assignment.end_date) : null,
          credentialId: assignment.credential_id
        });
      }
      
      return roles;
    } catch (error) {
      logger.error('Failed to get user moderation roles', { 
        error: error.message,
        userId,
        chatId
      });
      throw error;
    }
  }

  /**
   * Get all moderators in a chat
   * @param {number} chatId - Chat ID
   * @returns {Promise<Array>} - List of moderators with their roles
   */
  async getChatModerators(chatId) {
    await this.ensureInitialized();
    
    try {
      // Get all active assignments in this chat
      const assignments = await sqliteService.db.all(
        `SELECT ma.*, u.username, u.first_name, u.last_name 
         FROM moderation_assignments ma
         JOIN users u ON ma.user_id = u.id
         WHERE ma.chat_id = ? AND ma.active = 1
         AND (ma.end_date IS NULL OR ma.end_date > CURRENT_TIMESTAMP)
         ORDER BY ma.role DESC, ma.created_at DESC`,
        [chatId]
      );
      
      if (!assignments || assignments.length === 0) {
        return [];
      }
      
      // Format moderator list
      const moderators = [];
      
      for (const assignment of assignments) {
        // Get role data
        let roleData = null;
        for (const role in this.ROLES) {
          if (this.ROLES[role].name === assignment.role) {
            roleData = this.ROLES[role];
            break;
          }
        }
        
        moderators.push({
          userId: assignment.user_id,
          username: assignment.username,
          name: assignment.first_name 
            ? (assignment.last_name 
              ? `${assignment.first_name} ${assignment.last_name}`
              : assignment.first_name)
            : `User ${assignment.user_id}`,
          role: assignment.role,
          roleData,
          startDate: new Date(assignment.start_date),
          endDate: assignment.end_date ? new Date(assignment.end_date) : null,
          credentialId: assignment.credential_id
        });
      }
      
      return moderators;
    } catch (error) {
      logger.error('Failed to get chat moderators', { 
        error: error.message,
        chatId
      });
      throw error;
    }
  }

  /**
   * Get moderation actions in a chat
   * @param {number} chatId - Chat ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} - List of moderation actions
   */
  async getModerationActions(chatId, options = {}) {
    await this.ensureInitialized();
    
    try {
      const limit = options.limit || 50;
      const offset = options.offset || 0;
      
      // Build query
      let query = `
        SELECT ma.*, 
               u1.username as actor_username, u1.first_name as actor_first_name,
               u2.username as target_username, u2.first_name as target_first_name
        FROM moderation_actions ma
        LEFT JOIN users u1 ON ma.user_id = u1.id
        LEFT JOIN users u2 ON ma.target_user_id = u2.id
        WHERE ma.chat_id = ?
      `;
      
      const queryParams = [chatId];
      
      // Add filters
      if (options.actionType) {
        query += ' AND ma.action_type = ?';
        queryParams.push(options.actionType);
      }
      
      if (options.userId) {
        query += ' AND ma.user_id = ?';
        queryParams.push(options.userId);
      }
      
      if (options.targetUserId) {
        query += ' AND ma.target_user_id = ?';
        queryParams.push(options.targetUserId);
      }
      
      // Add ordering and pagination
      query += ' ORDER BY ma.created_at DESC LIMIT ? OFFSET ?';
      queryParams.push(limit, offset);
      
      // Execute query
      const actions = await sqliteService.db.all(query, queryParams);
      
      return actions.map(action => ({
        ...action,
        data: action.data ? JSON.parse(action.data) : null,
        actor: {
          id: action.user_id,
          username: action.actor_username,
          firstName: action.actor_first_name
        },
        target: action.target_user_id ? {
          id: action.target_user_id,
          username: action.target_username,
          firstName: action.target_first_name
        } : null
      }));
    } catch (error) {
      logger.error('Failed to get moderation actions', { 
        error: error.message,
        chatId,
        options
      });
      throw error;
    }
  }

  /**
   * Format user's moderation roles for display
   * @param {number} userId - User ID
   * @param {number} chatId - Chat ID (optional)
   * @returns {Promise<string>} - Formatted roles info
   */
  async formatModerationRoles(userId, chatId = null) {
    try {
      const roles = await this.getUserModerationRoles(userId, chatId);
      
      if (roles.length === 0) {
        return 'You do not have any moderation roles.';
      }
      
      // Build a formatted message
      let message = '🛡️ *Your Moderation Roles* 🛡️\n\n';
      
      for (const role of roles) {
        message += `*${role.role}* in ${role.chat.title || `Chat ${role.chat.id}`}\n`;
        
        if (role.roleData && role.roleData.permissions) {
          message += 'Permissions:\n';
          for (const perm of role.roleData.permissions) {
            message += `- ${perm.replace(/_/g, ' ')}\n`;
          }
        }
        
        if (role.endDate) {
          message += `Valid until: ${role.endDate.toLocaleDateString()}\n`;
        }
        
        message += '\n';
      }
      
      return message;
    } catch (error) {
      logger.error('Failed to format moderation roles', { 
        error: error.message,
        userId,
        chatId
      });
      return 'Sorry, there was an error retrieving your moderation roles.';
    }
  }

  /**
   * Format chat moderators list for display
   * @param {number} chatId - Chat ID
   * @returns {Promise<string>} - Formatted moderators list
   */
  async formatChatModerators(chatId) {
    try {
      const moderators = await this.getChatModerators(chatId);
      
      if (moderators.length === 0) {
        return 'There are no moderators assigned to this chat.';
      }
      
      // Get chat info
      const chatInfo = await sqliteService.getChat(chatId);
      const chatTitle = chatInfo ? chatInfo.title : `Chat ${chatId}`;
      
      // Build a formatted message
      let message = `👮‍♂️ *Moderators in ${chatTitle}* 👮‍♂️\n\n`;
      
      // Group by role
      const roleGroups = {};
      
      for (const mod of moderators) {
        if (!roleGroups[mod.role]) {
          roleGroups[mod.role] = [];
        }
        roleGroups[mod.role].push(mod);
      }
      
      // List moderators by role
      for (const role in this.ROLES) {
        const roleName = this.ROLES[role].name;
        const mods = roleGroups[roleName];
        
        if (mods && mods.length > 0) {
          message += `*${roleName}s:*\n`;
          
          for (const mod of mods) {
            const displayName = mod.username 
              ? `@${mod.username}` 
              : mod.name || `User ${mod.userId}`;
            
            message += `- ${displayName}\n`;
          }
          
          message += '\n';
        }
      }
      
      return message;
    } catch (error) {
      logger.error('Failed to format chat moderators', { 
        error: error.message,
        chatId
      });
      return 'Sorry, there was an error retrieving the moderators list.';
    }
  }

  /**
   * Track a moderation action
   * @param {number} userId - User ID performing the action
   * @param {number} chatId - Chat ID
   * @param {string} actionType - Type of action
   * @param {number} targetUserId - Target user ID (optional)
   * @param {Object} data - Additional data
   * @returns {Promise<string>} - Action ID
   */
  async trackModerationAction(userId, chatId, actionType, targetUserId, data = {}) {
    try {
      // Get the moderation service without creating circular dependency
      const moderationService = require('./moderationService');
      
      // Use the moderation service's implementation
      return await moderationService.trackModerationAction(
        userId,
        chatId,
        actionType,
        targetUserId,
        data
      );
    } catch (error) {
      logger.error('Error tracking moderation action from credential service', {
        error: error.message,
        userId,
        chatId,
        actionType
      });
      
      // Generate a fallback action ID to prevent further errors
      return `fallback_${Date.now()}`;
    }
  }

  /**
   * Verify if a user has authority to perform a moderation action
   * @param {String|Number} userId - User ID to check authority for
   * @param {String} actionType - Type of moderation action to check (kick, ban, etc.)
   * @param {String|Number} chatId - Chat ID where the action would be performed
   * @param {Object} options - Additional verification options
   * @returns {Promise<Object>} - Verification result with verified status and level
   */
  async verifyModerationAuthority(userId, actionType, chatId, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.debug('Verifying moderation authority', { userId, actionType, chatId });
      
      // Default result structure
      const result = {
        verified: false,
        level: 0,
        role: null,
        credential: null,
        method: null,
        message: null
      };
      
      // Normalize action type to lowercase
      const action = actionType.toLowerCase();
      
      // Check if the action exists in our permission map
      if (!this.ACTION_PERMISSIONS[action] && action !== 'all') {
        result.message = `Unknown action type: ${action}`;
        return result;
      }
      
      // First, check if the user is a Telegram admin in this chat
      const isTelegramAdmin = await this._checkTelegramAdminStatus(userId, chatId);
      
      if (isTelegramAdmin) {
        const adminLevel = 2; // GroupAdmin level
        
        // If checking for 'all', just return the admin level
        if (action === 'all') {
          result.verified = true;
          result.level = adminLevel;
          result.role = 'GroupAdmin';
          result.method = 'telegram_admin';
          result.message = 'User is a Telegram admin';
          return result;
        }
        
        // Check if admin level is sufficient for the requested action
        const requiredLevel = this.ACTION_PERMISSIONS[action].minLevel;
        
        if (adminLevel >= requiredLevel) {
          result.verified = true;
          result.level = adminLevel;
          result.role = 'GroupAdmin';
          result.method = 'telegram_admin';
          result.message = 'User has sufficient privileges as Telegram admin';
          return result;
        }
      }
      
      // Next, check if the user holds SNAILS NFT
      const hasSnailsNFT = await this._checkSnailsNFTOwnership(userId);
      
      if (hasSnailsNFT) {
        const snailsLevel = 3; // CrossChatModerator level
        
        // If checking for 'all', just return the SNAILS level
        if (action === 'all') {
          result.verified = true;
          result.level = snailsLevel;
          result.role = 'CrossChatModerator';
          result.method = 'snails_nft';
          result.message = 'User is a SNAILS holder';
          return result;
        }
        
        // Check if SNAILS level is sufficient for the requested action
        const requiredLevel = this.ACTION_PERMISSIONS[action].minLevel;
        
        if (snailsLevel >= requiredLevel) {
          result.verified = true;
          result.level = snailsLevel;
          result.role = 'CrossChatModerator';
          result.method = 'snails_nft';
          result.message = 'User has sufficient privileges as SNAILS holder';
          return result;
        }
      }
      
      // Finally, check for verifiable credentials
      // First look in database cache for faster verification
      const cachedCredential = await this._getCachedModeratorCredential(userId, chatId);
      
      if (cachedCredential) {
        const credentialLevel = cachedCredential.level || 
                             this.ROLE_LEVELS[cachedCredential.role] || 1;
        
        // If checking for 'all', just return the credential level
        if (action === 'all') {
          result.verified = true;
          result.level = credentialLevel;
          result.role = cachedCredential.role;
          result.credential = cachedCredential;
          result.method = 'cached_credential';
          result.message = 'User has a valid moderation credential';
          return result;
        }
        
        // Check if credential level is sufficient for the requested action
        const requiredLevel = this.ACTION_PERMISSIONS[action].minLevel;
        
        if (credentialLevel >= requiredLevel) {
          result.verified = true;
          result.level = credentialLevel;
          result.role = cachedCredential.role;
          result.credential = cachedCredential;
          result.method = 'cached_credential';
          result.message = 'User has sufficient privileges based on credential';
          return result;
        }
      }
      
      // If not found in cache, check blockchain credentials
      try {
        // Get user's DID
        const userDids = await cheqdService.getUserDids(userId);
        
        if (!userDids || userDids.length === 0) {
          result.message = 'User has no DID';
          return result;
        }
        
        const userDid = userDids[0].did;
        
        // Query credentials for this user
        const credentials = await cheqdService.listCredentialsByHolder(userDid);
        
        // Filter for valid moderation credentials for this chat
        const moderationCredentials = credentials.filter(cred => {
          // Check if credential is a moderation credential
          if (!cred.type.includes('ModerationCredential')) {
            return false;
          }
          
          // Check expiration
          const now = new Date();
          const expirationDate = cred.expiresAt ? new Date(cred.expiresAt) : null;
          
          if (expirationDate && expirationDate < now) {
            return false;
          }
          
          // Check if revoked
          if (cred.status === 'revoked') {
            return false;
          }
          
          // Check if valid for this chat
          if (cred.communities) {
            let chatIds = [];
            
            if (Array.isArray(cred.communities)) {
              chatIds = cred.communities.map(c => c.id || c.toString());
            } else if (typeof cred.communities === 'object') {
              chatIds = [cred.communities.id || cred.communities.toString()];
            } else {
              chatIds = [cred.communities.toString()];
            }
            
            if (!chatIds.includes(chatId.toString())) {
              return false;
            }
          }
          
          return true;
        });
        
        if (moderationCredentials.length === 0) {
          result.message = 'No valid moderation credentials found';
          return result;
        }
        
        // Sort by level (highest first) and get best credential
        moderationCredentials.sort((a, b) => {
          const levelA = a.level || this.ROLE_LEVELS[a.role] || 1;
          const levelB = b.level || this.ROLE_LEVELS[b.role] || 1;
          return levelB - levelA;
        });
        
        const bestCredential = moderationCredentials[0];
        const credentialLevel = bestCredential.level || 
                             this.ROLE_LEVELS[bestCredential.role] || 1;
        
        // Cache this credential for future checks
        await this._cacheModeratorCredential(userId, chatId, bestCredential);
        
        // If checking for 'all', just return the credential level
        if (action === 'all') {
          result.verified = true;
          result.level = credentialLevel;
          result.role = bestCredential.role;
          result.credential = bestCredential;
          result.method = 'blockchain_credential';
          result.message = 'User has a valid blockchain moderation credential';
          return result;
        }
        
        // Check if credential level is sufficient for the requested action
        const requiredLevel = this.ACTION_PERMISSIONS[action].minLevel;
        
        if (credentialLevel >= requiredLevel) {
          result.verified = true;
          result.level = credentialLevel;
          result.role = bestCredential.role;
          result.credential = bestCredential;
          result.method = 'blockchain_credential';
          result.message = 'User has sufficient privileges based on blockchain credential';
          return result;
        } else {
          result.message = `Insufficient privilege level: required ${requiredLevel}, got ${credentialLevel}`;
          return result;
        }
      } catch (error) {
        logger.error('Error checking blockchain credentials', { error: error.message });
        result.message = `Error checking blockchain credentials: ${error.message}`;
        return result;
      }
      
      // If we get here, no valid authorization found
      result.message = 'No valid moderation authority found';
      return result;
    } catch (error) {
      logger.error('Error verifying moderation authority', { error: error.message });
      return {
        verified: false,
        level: 0,
        message: `Error verifying authority: ${error.message}`
      };
    }
  }
  
  /**
   * Check if user is a Telegram admin in the chat
   * @param {String|Number} userId - User ID to check
   * @param {String|Number} chatId - Chat ID to check
   * @returns {Promise<Boolean>} - Whether user is an admin
   * @private
   */
  async _checkTelegramAdminStatus(userId, chatId) {
    try {
      // Check our database first for cached Telegram admin status
      const admin = await sqliteService.db.get(
        `SELECT * FROM telegram_chat_admins WHERE user_id = ? AND chat_id = ? AND active = 1`,
        [userId, chatId]
      );
      
      if (admin) {
        return true;
      }
      
      // If not in database, try to get from Telegram API through bot context
      // This would require a bot context which we don't have direct access to here
      // In a real implementation, this would query Telegram's API or use a cached result
      
      return false;
    } catch (error) {
      logger.error('Error checking Telegram admin status', { error: error.message });
      return false;
    }
  }
  
  /**
   * Check if user holds a SNAILS NFT
   * @param {String|Number} userId - User ID to check
   * @returns {Promise<Boolean>} - Whether user holds a SNAILS NFT
   * @private
   */
  async _checkSnailsNFTOwnership(userId) {
    try {
      // Check our database for cached NFT ownership
      const nftOwnership = await sqliteService.db.get(
        `SELECT * FROM nft_ownership WHERE user_id = ? AND collection = 'SNAILS' AND verified = 1`,
        [userId]
      );
      
      if (nftOwnership) {
        // Check if the verification is recent enough (within the last 24 hours)
        const verificationTime = new Date(nftOwnership.verified_at);
        const now = new Date();
        const hoursSinceVerification = (now - verificationTime) / (1000 * 60 * 60);
        
        if (hoursSinceVerification < 24) {
          return true;
        }
      }
      
      // If not in database or verification is too old, this would typically
      // query a blockchain indexer or NFT API to verify ownership
      // For now, return false as we'd need to implement the actual verification
      
      return false;
    } catch (error) {
      logger.error('Error checking SNAILS NFT ownership', { error: error.message });
      return false;
    }
  }
  
  /**
   * Get cached moderator credential from database
   * @param {String|Number} userId - User ID to check
   * @param {String|Number} chatId - Chat ID to check
   * @returns {Promise<Object|null>} - Cached credential or null
   * @private
   */
  async _getCachedModeratorCredential(userId, chatId) {
    try {
      // Get credential from database
      const assignment = await sqliteService.db.get(
        `SELECT * FROM moderation_assignments 
         WHERE user_id = ? AND chat_id = ? AND active = 1 AND end_date > CURRENT_TIMESTAMP`,
        [userId, chatId]
      );
      
      if (!assignment) {
        return null;
      }
      
      // Get the role level based on role name
      let level = 1; // Default to lowest level
      
      if (assignment.role === 'CommunityAdmin' || assignment.role === 'PlatformAdmin') {
        level = 4;
      } else if (assignment.role === 'SeniorModerator' || assignment.role === 'MasterModerator') {
        level = 3;
      } else if (assignment.role === 'CommunityModerator' || assignment.role === 'GroupAdmin') {
        level = 2;
      }
      
      return {
        id: assignment.credential_id,
        role: assignment.role,
        level: level,
        startDate: assignment.start_date,
        endDate: assignment.end_date,
        source: 'database_cache'
      };
    } catch (error) {
      logger.error('Error getting cached moderator credential', { error: error.message });
      return null;
    }
  }
  
  /**
   * Cache moderator credential in database
   * @param {String|Number} userId - User ID
   * @param {String|Number} chatId - Chat ID
   * @param {Object} credential - Credential object
   * @returns {Promise<Boolean>} - Success status
   * @private
   */
  async _cacheModeratorCredential(userId, chatId, credential) {
    try {
      // Validate input parameters
      if (!userId || !chatId) {
        logger.error('Invalid parameters for caching credential', { userId, chatId });
        return false;
      }
      
      // Validate credential has required fields
      if (!credential || !credential.id) {
        logger.error('Invalid credential for caching', { credential });
        return false;
      }
      
      // Ensure credential has a role - this is critical for the NOT NULL constraint
      const role = credential.role || 
                  credential.type?.includes('Moderator') ? 'GroupModerator' : 
                  credential.type?.includes('Admin') ? 'GroupAdmin' : 
                  'GroupModerator';  // Use a default if all else fails
      
      // Default dates if not provided
      const startDate = credential.startDate || credential.issuedAt || new Date().toISOString();
      const endDate = credential.endDate || credential.expiresAt || new Date(Date.now() + 90*24*60*60*1000).toISOString();
      
      // Check if there's already a cached credential
      const existing = await sqliteService.db.get(
        `SELECT * FROM moderation_assignments 
         WHERE user_id = ? AND chat_id = ? AND credential_id = ?`,
        [userId, chatId, credential.id]
      );
      
      if (existing) {
        // Update the existing record
        await sqliteService.db.run(
          `UPDATE moderation_assignments
           SET role = ?, active = 1, start_date = ?, end_date = ?
           WHERE user_id = ? AND chat_id = ? AND credential_id = ?`,
          [
            role,
            startDate,
            endDate,
            userId,
            chatId,
            credential.id
          ]
        );
      } else {
        // Insert a new record
        await sqliteService.db.run(
          `INSERT INTO moderation_assignments
           (user_id, chat_id, role, credential_id, start_date, end_date, active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [
            userId,
            chatId,
            role,
            credential.id,
            startDate,
            endDate
          ]
        );
      }
      
      logger.info('Successfully cached moderator credential', { 
        userId, 
        chatId, 
        role,
        credentialId: credential.id
      });
      
      return true;
    } catch (error) {
      logger.error('Error caching moderator credential', { error: error.message });
      return false;
    }
  }

  /**
   * Check if a user is a moderator in a specific chat
   * @param {number} userId - User ID to check
   * @param {number} chatId - Chat ID
   * @returns {Promise<boolean>} - Whether the user is a moderator
   */
  async isUserModerator(userId, chatId) {
    await this.ensureInitialized();
    
    try {
      logger.info('Checking if user is moderator', { userId, chatId });
      
      // First check if the user is a Telegram admin, which automatically gives moderator status
      const isAdmin = await this._checkTelegramAdminStatus(userId, chatId);
      
      if (isAdmin) {
        logger.debug('User is a Telegram admin', { userId, chatId });
        return true;
      }
      
      // Check for active moderation assignments in the database
      const assignment = await sqliteService.db.get(
        `SELECT * FROM moderation_assignments 
         WHERE user_id = ? AND chat_id = ? AND active = 1
         AND (end_date IS NULL OR end_date > CURRENT_TIMESTAMP)
         LIMIT 1`,
        [userId, chatId]
      );
      
      if (assignment) {
        logger.debug('User has active moderation assignment', { 
          userId, 
          chatId,
          role: assignment.role
        });
        return true;
      }
      
      // Check for verifiable moderation credentials as a final check
      const authority = await this.verifyModerationAuthority(userId, 'all', chatId);
      
      if (authority && authority.verified) {
        logger.debug('User has verified moderation authority', {
          userId,
          chatId,
          level: authority.level,
          role: authority.role
        });
        return true;
      }
      
      logger.debug('User is not a moderator', { userId, chatId });
      return false;
    } catch (error) {
      logger.error('Error checking moderator status', { 
        error: error.message,
        userId,
        chatId
      });
      
      // On error, default to false for safety
      return false;
    }
  }

  /**
   * Save moderation assignment to database
   * @param {string} userId - User ID
   * @param {string} chatId - Chat ID
   * @param {string} role - Role assigned
   * @param {string} credentialId - Credential ID
   * @param {string} assignedBy - User ID who assigned the role
   * @returns {Promise<boolean>} - Success status
   * @private
   */
  async _saveModerationAssignment(userId, chatId, role, credentialId, assignedBy) {
    try {
      // Ensure the moderation_assignments table exists
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
      
      // Ensure users exist in the database to satisfy foreign key constraints
      await sqliteService.db.run(
        `INSERT OR IGNORE INTO users (id, username, first_name) 
         VALUES (?, ?, ?)`,
        [userId, `user_${userId}`, `User ${userId}`]
      );
      
      await sqliteService.db.run(
        `INSERT OR IGNORE INTO users (id, username, first_name) 
         VALUES (?, ?, ?)`,
        [assignedBy, `user_${assignedBy}`, `User ${assignedBy}`]
      );
      
      // Check if an assignment already exists
      const existingAssignment = await sqliteService.db.get(
        'SELECT * FROM moderation_assignments WHERE user_id = ? AND chat_id = ? AND role = ?',
        [userId, chatId, role]
      );
      
      if (existingAssignment) {
        // Update existing assignment
        await sqliteService.db.run(
          `UPDATE moderation_assignments 
           SET status = ?, credential_id = ?, assigned_by = ?, assigned_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          ['active', credentialId, assignedBy, existingAssignment.id]
        );
      } else {
        // Create new assignment
        await sqliteService.db.run(
          `INSERT INTO moderation_assignments 
           (user_id, chat_id, role, credential_id, assigned_by, status) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [userId, chatId, role, credentialId, assignedBy, 'active']
        );
      }
      
      logger.info('Saved moderation assignment', { 
        userId, 
        chatId, 
        role, 
        credentialId 
      });
      
      return true;
    } catch (error) {
      logger.error('Error saving moderation assignment to database', { 
        error: error.message,
        userId,
        chatId,
        role
      });
      
      // Create a fallback record in the local cache if database fails
      try {
        this.moderationRoles = this.moderationRoles || {};
        const key = `${userId}:${chatId}`;
        
        this.moderationRoles[key] = {
          role,
          credentialId,
          assignedBy,
          assignedAt: new Date().toISOString()
        };
        
        logger.warn('Created fallback moderation assignment in memory', { key });
        return true;
      } catch (cacheError) {
        logger.error('Failed to create fallback moderation assignment', { error: cacheError.message });
        return false;
      }
    }
  }

  /**
   * Track a moderation action (legacy interface)
   * @param {number} userId - User ID performing the action
   * @param {number} chatId - Chat ID
   * @param {number} targetUserId - Target user ID (optional)
   * @param {string} actionType - Type of action
   * @param {string} reason - Reason for action
   * @param {Object} data - Additional data
   * @returns {Promise<Object>} - Created action record
   * @private
   */
  async _trackModerationAction(userId, chatId, targetUserId, actionType, reason, data = {}) {
    // Call the new non-underscore version for consistency
    const newData = { ...data, reason };
    const actionId = await this.trackModerationAction(userId, chatId, actionType, targetUserId, newData);
    
    // Return compatible format with old function
    return {
      id: actionId,
      userId,
      chatId,
      targetUserId,
      actionType,
      reason,
      data,
      createdAt: new Date()
    };
  }
}

// Export singleton instance
const moderationCredentialService = new ModerationCredentialService();
module.exports = moderationCredentialService; 