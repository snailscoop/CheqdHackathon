/**
 * Conversational Credential Handlers
 * 
 * Handlers for processing natural language credential requests and responses.
 */

const logger = require('../../../utils/logger');
const { Markup } = require('telegraf');
const grokService = require('../../../services/grokService');
const cheqdService = require('../../../services/cheqdService');
const sqliteService = require('../../../db/sqliteService');

/**
 * Process credential-related natural language query
 * @param {Object} ctx - Telegram context
 * @param {string} text - User's message text
 * @returns {Promise<void>}
 */
async function handleCredentialQuery(ctx, text) {
  try {
    // Process the text with Grok AI to determine the intent
    const userId = ctx.from.id;
    const result = await grokService.processCredentialQuery(text, userId);
    
    if (result.functionCall) {
      // Handle specific function calls from the NLP processor
      switch (result.name) {
        case 'issue_credential':
          return handleIssueCredentialIntent(ctx, result.args);
        case 'verify_credential':
          return handleVerifyCredentialIntent(ctx, result.args);
        case 'get_user_credentials':
          return handleGetCredentialsIntent(ctx, result.args);
        default:
          return ctx.reply('I understand you want to do something with credentials, but I\'m not sure what exactly. Could you please be more specific?');
      }
    } else {
      // If no function call, just return the text response
      return ctx.reply(result.text);
    }
  } catch (error) {
    logger.error('Error in credential query handler', { error: error.message });
    return ctx.reply('Sorry, I had trouble processing your credential request. Please try again or use specific commands.');
  }
}

/**
 * Handle credential issuance intent from NLP
 * @param {Object} ctx - Telegram context
 * @param {Object} args - Arguments from NLP
 * @returns {Promise<void>}
 */
async function handleIssueCredentialIntent(ctx, args) {
  try {
    const issuerUserId = ctx.from.id;
    const recipientId = args.recipientId;
    const credentialType = args.credentialType;
    const data = args.data || {};
    
    // Validate credential type
    const validTypes = ['Education', 'Support', 'Moderation'];
    if (!validTypes.includes(credentialType)) {
      return ctx.reply(`Sorry, "${credentialType}" is not a valid credential type. Available types: ${validTypes.join(', ')}`);
    }
    
    // Check if user has permission to issue this type of credential
    const isAdmin = await checkAdminStatus(ctx, issuerUserId);
    if (!isAdmin) {
      return ctx.reply('You don\'t have permission to issue credentials. This requires administrator privileges.');
    }
    
    // Get target user if specified
    let targetUser = null;
    if (recipientId) {
      try {
        if (ctx.chat.type !== 'private') {
          // Try to get user from chat members
          const chatMember = await ctx.getChatMember(recipientId);
          targetUser = chatMember.user;
        } else {
          return ctx.reply('Issuing credentials to other users is only available in group chats.');
        }
      } catch (error) {
        return ctx.reply('I couldn\'t find that user in this chat. Please make sure they are a member of this chat.');
      }
    } else {
      targetUser = ctx.from; // If no recipient specified, issue to self
    }
    
    // Get DIDs for issuer and holder
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
    
    // Prepare credential data based on type
    let credentialData = { ...data };
    let specificType = '';
    
    if (credentialType === 'Education') {
      specificType = 'EducationalAchievement';
      if (!credentialData.title) {
        credentialData.title = 'General Educational Achievement';
      }
      credentialData.issueDate = new Date().toISOString();
    } else if (credentialType === 'Support') {
      specificType = 'SupportTier';
      if (!credentialData.tier) {
        credentialData.tier = 'Basic';
      }
      credentialData.issueDate = new Date().toISOString();
      credentialData.expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year
    } else if (credentialType === 'Moderation') {
      specificType = 'ModerationCredential';
      if (!credentialData.role) {
        credentialData.role = 'CommunityModerator';
      }
      credentialData.communities = [{ 
        id: ctx.chat.id.toString(), 
        name: ctx.chat.title, 
        platform: 'Telegram' 
      }];
      credentialData.issueDate = new Date().toISOString();
      credentialData.expiryDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days
    }
    
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
    logger.error('Error in issue credential intent handler', { error: error.message });
    return ctx.reply('Sorry, there was an error issuing the credential.');
  }
}

/**
 * Handle credential verification intent from NLP
 * @param {Object} ctx - Telegram context
 * @param {Object} args - Arguments from NLP
 * @returns {Promise<void>}
 */
async function handleVerifyCredentialIntent(ctx, args) {
  try {
    const credentialId = args.credentialId;
    
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
    logger.error('Error in verify credential intent handler', { error: error.message });
    return ctx.reply(`Sorry, there was an error verifying the credential: ${error.message}`);
  }
}

/**
 * Handle get user credentials intent from NLP
 * @param {Object} ctx - Telegram context
 * @param {Object} args - Arguments from NLP
 * @returns {Promise<void>}
 */
async function handleGetCredentialsIntent(ctx, args) {
  try {
    const requestedUserId = args.userId || ctx.from.id.toString();
    const type = args.type || null;
    
    // Check if requested user is self or other
    const isSelf = requestedUserId === ctx.from.id.toString();
    
    // If requesting someone else's credentials, check permissions
    if (!isSelf) {
      const isAdmin = await checkAdminStatus(ctx, ctx.from.id);
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
      
      responseText += '\n';
    }
    
    return ctx.reply(responseText);
  } catch (error) {
    logger.error('Error in get credentials intent handler', { error: error.message });
    return ctx.reply('Sorry, there was an error retrieving the credentials.');
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

module.exports = {
  handleCredentialQuery,
  handleIssueCredentialIntent,
  handleVerifyCredentialIntent,
  handleGetCredentialsIntent
}; 