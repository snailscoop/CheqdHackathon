/**
 * Unified Credential Handlers
 * 
 * Provides a unified interface for various credential operations.
 */

const logger = require('../utils/logger');
const { Markup } = require('telegraf');
const cheqdService = require('../services/cheqdService');
const sqliteService = require('../db/sqliteService');
const grokService = require('../services/grokService');

/**
 * Process a credential command with natural language parsing
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleCredentialCommand(ctx) {
  try {
    const text = ctx.message.text;
    const match = text.match(/^\/dail\s+(.*)/i);
    
    if (!match || !match[1]) {
      return ctx.reply('Please provide a command after /dail. For example: /dail issue a quiz completion credential');
    }
    
    const command = match[1].trim();
    const userId = ctx.from.id;
    
    // Use Grok AI to parse the command
    const result = await grokService.processCommand(command, userId);
    
    if (result.error) {
      return ctx.reply(`Error processing command: ${result.error}`);
    }
    
    switch (result.intent) {
      case 'issue_credential':
        return handleIssueCredential(ctx, result.params);
      case 'verify_credential':
        return handleVerifyCredential(ctx, result.params);
      case 'revoke_credential':
        return handleRevokeCredential(ctx, result.params);
      case 'list_credentials':
        return handleListCredentials(ctx, result.params);
      case 'check_credential':
        return handleCheckCredential(ctx, result.params);
      default:
        return ctx.reply('I\'m not sure what you want to do with credentials. Try to be more specific or use standard commands like /issue, /verify, or /revoke.');
    }
  } catch (error) {
    logger.error('Error in credential command handler', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your command.');
  }
}

/**
 * Handle issuing a credential
 * @param {Object} ctx - Telegram context
 * @param {Object} params - Command parameters
 * @returns {Promise<void>}
 */
async function handleIssueCredential(ctx, params) {
  try {
    const issuerUserId = ctx.from.id;
    
    // Check if user has required permissions
    const isAdmin = await checkAdminStatus(ctx, issuerUserId);
    if (!isAdmin && params.credentialType !== 'self') {
      return ctx.reply('You don\'t have permission to issue credentials to others.');
    }
    
    // Get or determine the target user
    let targetUser;
    if (params.targetUsername) {
      // Try to find user in chat
      try {
        const username = params.targetUsername.replace('@', '');
        const chatMember = await ctx.getChatMember(username);
        targetUser = chatMember.user;
      } catch (error) {
        return ctx.reply('Could not find that user in this chat.');
      }
    } else {
      // Default to self
      targetUser = ctx.from;
    }
    
    // Get credential type
    const credentialType = params.credentialType || 'general';
    
    // Get or create DIDs
    const issuerDids = await cheqdService.getUserDids(issuerUserId);
    const holderDids = await cheqdService.getUserDids(targetUser.id);
    
    let issuerDid, holderDid;
    
    // Get or create issuer DID
    if (issuerDids && issuerDids.length > 0) {
      issuerDid = issuerDids[0].did;
    } else {
      issuerDid = await cheqdService.createDid(issuerUserId);
    }
    
    // Get or create holder DID
    if (holderDids && holderDids.length > 0) {
      holderDid = holderDids[0].did;
    } else {
      holderDid = await cheqdService.createDid(targetUser.id);
    }
    
    // Prepare credential data
    let credentialData = params.data || {};
    let specificType;
    
    switch (credentialType.toLowerCase()) {
      case 'education':
      case 'quiz':
      case 'learning':
        specificType = 'EducationalAchievement';
        // Set default values if not provided
        if (!credentialData.title) {
          credentialData.title = params.title || 'Educational Achievement';
        }
        if (!credentialData.score && params.score) {
          credentialData.score = parseInt(params.score);
          credentialData.totalQuestions = parseInt(params.totalQuestions || 10);
          credentialData.percentage = Math.round((credentialData.score / credentialData.totalQuestions) * 100);
        }
        break;
        
      case 'support':
      case 'tier':
        specificType = 'SupportTier';
        // Set default values if not provided
        if (!credentialData.tier) {
          credentialData.tier = params.tier || 'Basic';
        }
        if (!credentialData.accessLevel) {
          const tierLevels = {
            'Basic': 1, 'Standard': 2, 'Premium': 3, 'Enterprise': 4
          };
          credentialData.accessLevel = tierLevels[credentialData.tier] || 1;
        }
        credentialData.expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year
        break;
        
      case 'moderation':
      case 'mod':
        specificType = 'ModerationCredential';
        // Set default values if not provided
        if (!credentialData.role) {
          credentialData.role = params.role || 'CommunityModerator';
        }
        credentialData.communities = [{ 
          id: ctx.chat.id.toString(), 
          name: ctx.chat.title, 
          platform: 'Telegram' 
        }];
        credentialData.expiryDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days
        break;
        
      default:
        specificType = 'GeneralCredential';
        // Set default values if not provided
        if (!credentialData.name) {
          credentialData.name = params.name || 'General Credential';
        }
        if (!credentialData.description) {
          credentialData.description = params.description || 'A general purpose credential';
        }
    }
    
    // Add common fields
    credentialData.issueDate = new Date().toISOString();
    
    // Issue the credential
    const credential = await cheqdService.issueCredential(
      issuerDid,
      holderDid,
      specificType,
      credentialData
    );
    
    if (credential) {
      return ctx.reply(
        `✅ Successfully issued ${specificType} credential to ${targetUser.username || targetUser.first_name}!`,
        Markup.inlineKeyboard([
          Markup.button.callback('View Credential Details', `view_credential:${credential.credential_id}`)
        ])
      );
    } else {
      return ctx.reply('Failed to issue credential. Please try again later.');
    }
  } catch (error) {
    logger.error('Error in issue credential handler', { error: error.message });
    return ctx.reply('Sorry, there was an error issuing the credential.');
  }
}

/**
 * Handle verifying a credential
 * @param {Object} ctx - Telegram context
 * @param {Object} params - Command parameters
 * @returns {Promise<void>}
 */
async function handleVerifyCredential(ctx, params) {
  try {
    const credentialId = params.credentialId || params.id;
    
    if (!credentialId) {
      return ctx.reply('Please provide a credential ID to verify.');
    }
    
    // Verify the credential
    const result = await cheqdService.verifyCredential(credentialId);
    
    if (result.verified) {
      const credential = result.credential;
      const credentialData = JSON.parse(credential.data);
      
      let responseText = `✅ Credential Verified\n\n` +
        `🆔 ID: ${credential.credential_id}\n` +
        `🏷️ Type: ${credential.type}\n` +
        `👤 Holder: ${credential.holder_did}\n` +
        `🏛️ Issuer: ${credential.issuer_did}\n` +
        `📅 Issued: ${new Date(credential.issued_at).toLocaleDateString()}\n`;
      
      if (credential.expires_at) {
        responseText += `⏳ Expires: ${new Date(credential.expires_at).toLocaleDateString()}\n`;
      }
      
      responseText += `\n📄 Data: ${JSON.stringify(credentialData, null, 2)}`;
      
      return ctx.reply(responseText);
    } else {
      return ctx.reply(
        `❌ Credential Verification Failed\n\n` +
        `Reason: ${result.reason || 'Unknown error'}`
      );
    }
  } catch (error) {
    logger.error('Error in verify credential handler', { error: error.message });
    return ctx.reply(`Sorry, there was an error verifying the credential: ${error.message}`);
  }
}

/**
 * Handle revoking a credential
 * @param {Object} ctx - Telegram context
 * @param {Object} params - Command parameters
 * @returns {Promise<void>}
 */
async function handleRevokeCredential(ctx, params) {
  try {
    const userId = ctx.from.id;
    const credentialId = params.credentialId || params.id;
    const reason = params.reason || 'Revoked by user';
    
    if (!credentialId) {
      return ctx.reply('Please provide a credential ID to revoke.');
    }
    
    // Check if user has permission to revoke
    const isAdmin = await checkAdminStatus(ctx, userId);
    
    // If not admin, check if they are the issuer of the credential
    if (!isAdmin) {
      // Get the credential
      const credential = await sqliteService.db.get(
        'SELECT * FROM credentials WHERE credential_id = ?',
        [credentialId]
      );
      
      if (!credential) {
        return ctx.reply('Credential not found.');
      }
      
      // Get user DIDs
      const userDids = await cheqdService.getUserDids(userId);
      
      if (!userDids || !userDids.some(d => d.did === credential.issuer_did)) {
        return ctx.reply('You don\'t have permission to revoke this credential. Only the issuer or an admin can revoke credentials.');
      }
    }
    
    // Revoke the credential
    const result = await cheqdService.revokeCredential(credentialId, reason);
    
    if (result) {
      return ctx.reply(`✅ Credential ${credentialId} has been successfully revoked.\nReason: ${reason}`);
    } else {
      return ctx.reply('Failed to revoke credential. Please try again later.');
    }
  } catch (error) {
    logger.error('Error in revoke credential handler', { error: error.message });
    return ctx.reply('Sorry, there was an error revoking the credential.');
  }
}

/**
 * Handle listing credentials
 * @param {Object} ctx - Telegram context
 * @param {Object} params - Command parameters
 * @returns {Promise<void>}
 */
async function handleListCredentials(ctx, params) {
  try {
    const userId = ctx.from.id;
    const requestedUserId = params.userId || userId;
    const type = params.type || null;
    
    // Check if requested user is self or other
    const isSelf = requestedUserId === userId;
    
    // If requesting someone else's credentials, check permissions
    if (!isSelf) {
      const isAdmin = await checkAdminStatus(ctx, userId);
      if (!isAdmin) {
        return ctx.reply('You don\'t have permission to view other users\' credentials.');
      }
    }
    
    // Get user DIDs
    const userDids = await cheqdService.getUserDids(requestedUserId);
    
    if (!userDids || userDids.length === 0) {
      return ctx.reply(`${isSelf ? 'You don\'t' : 'This user doesn\'t'} have any credentials yet.`);
    }
    
    // Get holder DID
    const holderDid = userDids[0].did;
    
    // Build query based on type filter
    let query = 'SELECT * FROM credentials WHERE holder_did = ?';
    const params = [holderDid];
    
    if (type) {
      query += ' AND type LIKE ?';
      params.push(`%${type}%`);
    }
    
    query += ' ORDER BY issued_at DESC';
    
    // Query the database for credentials
    const credentials = await sqliteService.db.all(query, params);
    
    if (!credentials || credentials.length === 0) {
      return ctx.reply(`${isSelf ? 'You don\'t' : 'This user doesn\'t'} have any ${type || ''} credentials.`);
    }
    
    // Format the credentials list
    let responseText = `📜 ${isSelf ? 'Your' : 'User\'s'} Credentials:\n\n`;
    
    for (const credential of credentials) {
      const data = JSON.parse(credential.data);
      responseText += `🆔 ID: ${credential.credential_id}\n`;
      responseText += `🏷️ Type: ${credential.type}\n`;
      
      // Add type-specific info
      if (credential.type.includes('Education')) {
        responseText += `📚 Title: ${data.title || 'N/A'}\n`;
        if (data.score !== undefined && data.totalQuestions !== undefined) {
          responseText += `✅ Score: ${data.score}/${data.totalQuestions}\n`;
        }
      } else if (credential.type === 'SupportTier') {
        responseText += `🌟 Tier: ${data.tier || 'Basic'}\n`;
        responseText += `🔐 Access Level: ${data.accessLevel || 1}\n`;
      } else if (credential.type === 'ModerationCredential') {
        responseText += `👮 Role: ${data.role || 'Unknown'}\n`;
        if (data.communities && data.communities.length > 0) {
          responseText += `👥 Communities: ${data.communities.length}\n`;
        }
      }
      
      responseText += `📅 Issued: ${new Date(credential.issued_at).toLocaleDateString()}\n`;
      
      if (credential.expires_at) {
        const expiryDate = new Date(credential.expires_at);
        const isExpired = expiryDate < new Date();
        responseText += `${isExpired ? '⛔️ Expired' : '⏳ Expires'}: ${expiryDate.toLocaleDateString()}\n`;
      }
      
      responseText += `\n`;
    }
    
    return ctx.reply(responseText);
  } catch (error) {
    logger.error('Error in list credentials handler', { error: error.message });
    return ctx.reply('Sorry, there was an error retrieving the credentials.');
  }
}

/**
 * Handle checking a specific credential type
 * @param {Object} ctx - Telegram context
 * @param {Object} params - Command parameters
 * @returns {Promise<void>}
 */
async function handleCheckCredential(ctx, params) {
  try {
    const userId = ctx.from.id;
    const credentialType = params.type || 'general';
    
    // Get user DIDs
    const userDids = await cheqdService.getUserDids(userId);
    
    if (!userDids || userDids.length === 0) {
      return ctx.reply('You don\'t have any credentials yet.');
    }
    
    // Get holder DID
    const holderDid = userDids[0].did;
    
    // Determine the specific credential type to check
    let specificType;
    let responseTitle;
    
    switch (credentialType.toLowerCase()) {
      case 'education':
      case 'quiz':
      case 'learning':
        specificType = 'EducationalAchievement';
        responseTitle = '🎓 Educational Credentials';
        break;
        
      case 'support':
      case 'tier':
        specificType = 'SupportTier';
        responseTitle = '🌟 Support Tier Status';
        break;
        
      case 'moderation':
      case 'mod':
        specificType = 'ModerationCredential';
        responseTitle = '🛡️ Moderation Authority';
        break;
        
      default:
        specificType = '%';
        responseTitle = '📜 Credentials';
    }
    
    // Query the database for credentials
    const credentials = await sqliteService.db.all(
      `SELECT * FROM credentials 
       WHERE holder_did = ? AND type LIKE ? 
       ORDER BY issued_at DESC`,
      [holderDid, specificType]
    );
    
    if (!credentials || credentials.length === 0) {
      return ctx.reply(`You don\'t have any ${credentialType} credentials.`);
    }
    
    // Format the response based on credential type
    let responseText = `${responseTitle}\n\n`;
    
    if (specificType === 'SupportTier') {
      // For support tier, show the highest tier
      const credential = credentials[0]; // Most recent one
      const data = JSON.parse(credential.data);
      
      responseText += `🌟 Current Tier: ${data.tier || 'Basic'}\n`;
      responseText += `🔐 Access Level: ${data.accessLevel || 1}\n`;
      
      if (data.features && data.features.length > 0) {
        responseText += `\n✨ Features:\n`;
        for (const feature of data.features) {
          responseText += `- ${feature}\n`;
        }
      }
      
      if (credential.expires_at) {
        const expiryDate = new Date(credential.expires_at);
        const isExpired = expiryDate < new Date();
        responseText += `\n${isExpired ? '⛔️ Expired' : '⏳ Valid until'}: ${expiryDate.toLocaleDateString()}\n`;
      }
    } else if (specificType === 'ModerationCredential') {
      // For moderation, show communities and permissions
      const credential = credentials[0]; // Most recent one
      const data = JSON.parse(credential.data);
      
      responseText += `👮 Role: ${data.role || 'Unknown'}\n\n`;
      
      if (data.communities && data.communities.length > 0) {
        responseText += `👥 Communities:\n`;
        for (const community of data.communities) {
          responseText += `- ${community.name} (${community.platform})\n`;
        }
        responseText += `\n`;
      }
      
      if (data.permissions && data.permissions.length > 0) {
        responseText += `🔑 Permissions:\n`;
        for (const permission of data.permissions) {
          responseText += `- ${permission.replace('_', ' ')}\n`;
        }
        responseText += `\n`;
      }
      
      if (credential.expires_at) {
        const expiryDate = new Date(credential.expires_at);
        const isExpired = expiryDate < new Date();
        responseText += `${isExpired ? '⛔️ Expired' : '⏳ Valid until'}: ${expiryDate.toLocaleDateString()}\n`;
      }
    } else {
      // For other credential types, show a summary
      responseText += `You have ${credentials.length} ${credentialType} credential(s):\n\n`;
      
      for (const credential of credentials) {
        const data = JSON.parse(credential.data);
        
        if (credential.type.includes('Education')) {
          responseText += `📚 ${data.title || 'N/A'}\n`;
          if (data.score !== undefined && data.totalQuestions !== undefined) {
            responseText += `✅ Score: ${data.score}/${data.totalQuestions}\n`;
          }
        } else {
          responseText += `📄 ${data.name || data.title || credential.type}\n`;
        }
        
        responseText += `📅 Issued: ${new Date(credential.issued_at).toLocaleDateString()}\n\n`;
      }
    }
    
    return ctx.reply(responseText);
  } catch (error) {
    logger.error('Error in check credential handler', { error: error.message });
    return ctx.reply('Sorry, there was an error checking your credentials.');
  }
}

/**
 * Check if user has admin status in the chat
 * @param {Object} ctx - Telegram context
 * @param {number} userId - User ID to check
 * @returns {Promise<boolean>} - Whether the user is an admin
 */
async function checkAdminStatus(ctx, userId) {
  try {
    // For private chats, only bot admins are considered admins
    if (ctx.chat.type === 'private') {
      // Check if user is in bot admins list
      const adminIds = await sqliteService.getSetting('bot_admins');
      if (adminIds) {
        const admins = JSON.parse(adminIds);
        return admins.includes(userId.toString());
      }
      return false;
    }
    
    // For group chats, check if user is a chat admin
    const chatMember = await ctx.getChatMember(userId);
    return ['creator', 'administrator'].includes(chatMember.status);
  } catch (error) {
    logger.error('Error checking admin status', { error: error.message });
    return false;
  }
}

/**
 * Verify if a user has credentials required to access educational content
 * @param {string|number} userId - The user ID to check credentials for
 * @param {string} [topic] - Optional specific topic to check access for
 * @returns {Promise<boolean>} - Whether the user has proper credentials
 */
async function verifyEducationalAccess(userId, topic = null) {
  try {
    logger.info(`Verifying educational access for user ${userId}${topic ? ` for topic ${topic}` : ''}`);
    
    // Get all user credentials
    const userCredentials = await getUserCredentials(userId);
    
    if (!userCredentials || userCredentials.length === 0) {
      logger.info(`User ${userId} has no credentials`);
      // No credentials found, allow only basic access
      return !topic; // If topic is specified, deny access; if general check, allow basic access
    }
    
    // If checking for specific topic
    if (topic) {
      // Define topic to credential mapping
      const topicCredentialMap = {
        'crypto': 'CRYPTO_BASIC',
        'crypto dungeon': 'CRYPTO_INTERMEDIATE',
        'jackal': 'STORAGE_BASIC',
        'cheqd': 'IDENTITY_BASIC',
        // Add more topic to credential mappings as needed
      };
      
      // Get required credential for topic (case insensitive)
      const topicLower = topic.toLowerCase();
      const requiredCredential = Object.keys(topicCredentialMap).find(key => 
        topicLower.includes(key.toLowerCase())
      );
      
      if (!requiredCredential) {
        logger.info(`No specific credential required for topic ${topic}`);
        return true; // No specific credential required for this topic
      }
      
      const hasRequiredCredential = userCredentials.some(cred => 
        cred.type === topicCredentialMap[requiredCredential]
      );
      
      logger.info(`User ${userId} ${hasRequiredCredential ? 'has' : 'lacks'} required credential for topic ${topic}`);
      return hasRequiredCredential;
    }
    
    // For general access, just check if user has any educational credential
    const hasAnyEducationalCredential = userCredentials.some(cred => 
      cred.type.includes('BASIC') || cred.type.includes('INTERMEDIATE') || cred.type.includes('ADVANCED')
    );
    
    logger.info(`User ${userId} ${hasAnyEducationalCredential ? 'has' : 'lacks'} educational credentials`);
    return hasAnyEducationalCredential;
  } catch (error) {
    logger.error(`Error verifying educational access: ${error.message}`, { error });
    // In case of error, default to no access
    return false;
  }
}

/**
 * Get all credentials for a user
 * @param {string|number} userId - The user ID to get credentials for
 * @returns {Promise<Array>} - Array of credential objects
 */
async function getUserCredentials(userId) {
  try {
    logger.info(`Getting credentials for user ${userId}`);
    
    // Ensure database is initialized
    await sqliteService.ensureInitialized();
    const db = sqliteService.db;
    
    // Get user DIDs
    const userDids = await cheqdService.getUserDids(userId);
    
    if (!userDids || userDids.length === 0) {
      logger.info(`No DIDs found for user ${userId}`);
      return [];
    }
    
    // Get credentials for all DIDs
    const credentials = [];
    for (const didRecord of userDids) {
      const holderCredentials = await db.all(
        `SELECT * FROM credentials WHERE holder_did = ? ORDER BY issued_at DESC`,
        [didRecord.did]
      );
      
      if (holderCredentials && holderCredentials.length > 0) {
        credentials.push(...holderCredentials);
      }
    }
    
    logger.info(`Found ${credentials.length} credentials for user ${userId}`);
    return credentials;
  } catch (error) {
    logger.error(`Error getting user credentials: ${error.message}`, { error });
    return [];
  }
}

module.exports = {
  handleCredentialCommand,
  handleIssueCredential,
  handleVerifyCredential,
  handleRevokeCredential,
  handleListCredentials,
  handleCheckCredential,
  verifyEducationalAccess,
  getUserCredentials
}; 