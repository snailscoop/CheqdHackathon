/**
 * Telegram Credential Handlers
 * 
 * Handlers for managing educational, support, and moderation credentials
 * through Telegram bot commands and interactions.
 */

const logger = require('../../../utils/logger');
const { Markup } = require('telegraf');
const sqliteService = require('../../../db/sqliteService');
const cheqdService = require('../../../services/cheqdService');
const supportCredentialService = require('../../../services/supportCredentialService');

/**
 * Quiz completion handler
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleQuizCompletion(ctx) {
  try {
    // This would be called when a user completes a quiz
    const userId = ctx.from.id;
    const quizResult = ctx.session?.quizResult || {
      score: 0,
      totalQuestions: 0,
      title: 'Unknown Quiz',
      topic: 'Unknown Topic'
    };
    
    // Check if quiz result is valid
    if (!quizResult || quizResult.totalQuestions === 0) {
      return ctx.reply('No valid quiz results found. Please try again.');
    }
    
    // Issue credential
    const credentialData = {
      title: quizResult.title || quizResult.topic,
      score: quizResult.score,
      totalQuestions: quizResult.totalQuestions,
      percentage: Math.round((quizResult.score / quizResult.totalQuestions) * 100)
    };
    
    // Get user DID or create one
    const userDids = await cheqdService.getUserDids(userId);
    let holderDid;
    
    if (userDids && userDids.length > 0) {
      holderDid = userDids[0].did;
    } else {
      holderDid = await cheqdService.createDid(userId);
    }
    
    // Issue the credential
    const credential = await cheqdService.issueCredential(
      'system', // System will use bot's DID as issuer
      holderDid,
      'QuizCompletion',
      credentialData
    );
    
    if (credential) {
      return ctx.reply(
        `🎓 Congratulations! Quiz completion credential issued for "${quizResult.title || quizResult.topic}".\n\nScore: ${Math.round((quizResult.score / quizResult.totalQuestions) * 100)}%`,
        Markup.inlineKeyboard([
          Markup.button.callback('View My Credentials', 'view_credentials')
        ])
      );
    } else {
      return ctx.reply(
        `⚠️ Could not issue credential at this time.`
      );
    }
  } catch (error) {
    logger.error('Error in quiz completion handler', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your quiz result. Please try again.');
  }
}

/**
 * View educational progress handler
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleViewEducationalProgress(ctx) {
  try {
    const userId = ctx.from.id;
    
    // Get user DIDs
    const userDids = await cheqdService.getUserDids(userId);
    
    if (!userDids || userDids.length === 0) {
      return ctx.reply('You don\'t have any credentials yet. Complete some quizzes to earn credentials!');
    }
    
    // Get user's educational credentials
    const holderDid = userDids[0].did;
    
    // Query the database for educational credentials
    const credentials = await sqliteService.db.all(
      `SELECT * FROM credentials 
       WHERE holder_did = ? AND type LIKE 'Quiz%'
       ORDER BY issued_at DESC`,
      [holderDid]
    );
    
    if (!credentials || credentials.length === 0) {
      return ctx.reply('You don\'t have any educational credentials yet. Complete some quizzes to earn credentials!');
    }
    
    // Format the educational progress
    let progressText = '🎓 *Your Educational Progress*\n\n';
    
    for (const credential of credentials) {
      const data = JSON.parse(credential.data);
      progressText += `📚 *${data.title}*\n`;
      progressText += `✅ Score: ${data.score}/${data.totalQuestions} (${data.percentage}%)\n`;
      progressText += `📅 Completed: ${new Date(credential.issued_at).toLocaleDateString()}\n\n`;
    }
    
    return ctx.reply(progressText, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error viewing educational progress', { error: error.message });
    return ctx.reply('Sorry, there was an error retrieving your educational progress.');
  }
}

/**
 * Handle support tier verification
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleVerifySupportTier(ctx) {
  try {
    const userId = ctx.from.id;
    const params = ctx.message.text.split(' ').slice(1);
    const tierToCheck = params[0] || 'Basic';
    
    // Get user DIDs
    const userDids = await cheqdService.getUserDids(userId);
    
    if (!userDids || userDids.length === 0) {
      return ctx.reply('You don\'t have any credentials yet. Use /create_did to create your digital identity first.');
    }
    
    // Get user's support credentials
    const holderDid = userDids[0].did;
    
    // Query the database for support credentials
    const credential = await sqliteService.db.get(
      `SELECT * FROM credentials 
       WHERE holder_did = ? AND type = 'SupportTier'
       ORDER BY issued_at DESC LIMIT 1`,
      [holderDid]
    );
    
    if (!credential) {
      return ctx.reply(
        `⚠️ You do not have ${tierToCheck} support access.\n\nTo upgrade your support tier, please use the /upgrade_support command.`
      );
    }
    
    const data = JSON.parse(credential.data);
    const currentTier = data.tier;
    const accessLevel = data.accessLevel || 1;
    
    // Check if the user has the required tier
    const tierLevels = {
      'Basic': 1,
      'Standard': 2,
      'Premium': 3,
      'Enterprise': 4
    };
    
    if (tierLevels[currentTier] >= tierLevels[tierToCheck]) {
      return ctx.reply(
        `✅ You have ${currentTier} support access (Level ${accessLevel}).\n\nThis grants you access to enhanced support features and priority assistance.`,
        Markup.inlineKeyboard([
          Markup.button.callback('View Support Benefits', 'view_support_benefits')
        ])
      );
    } else {
      return ctx.reply(
        `⚠️ You have ${currentTier} support access, but ${tierToCheck} is required.\n\nTo upgrade your support tier, please use the /upgrade_support command.`
      );
    }
  } catch (error) {
    logger.error('Error verifying support tier', { error: error.message });
    return ctx.reply('Sorry, there was an error verifying your support tier.');
  }
}

/**
 * Handle blockchain access check
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleBlockchainAccessCheck(ctx) {
  try {
    const userId = ctx.from.id;
    const params = ctx.message.text.split(' ').slice(1);
    const blockchain = params[0] || 'testnet';
    
    // Get user DIDs
    const userDids = await cheqdService.getUserDids(userId);
    
    if (!userDids || userDids.length === 0) {
      return ctx.reply('You don\'t have any credentials yet. Use /create_did to create your digital identity first.');
    }
    
    // Get user's support credentials
    const holderDid = userDids[0].did;
    
    // Query the database for support credentials
    const credential = await sqliteService.db.get(
      `SELECT * FROM credentials 
       WHERE holder_did = ? AND type = 'SupportTier'
       ORDER BY issued_at DESC LIMIT 1`,
      [holderDid]
    );
    
    if (!credential) {
      return ctx.reply(
        `⚠️ You do not have access to ${blockchain.toUpperCase()} blockchain information.\n\nTo upgrade your support tier and gain access, please use the /upgrade_support command.`
      );
    }
    
    const data = JSON.parse(credential.data);
    const currentTier = data.tier;
    
    // Check blockchain access based on tier
    const blockchainAccess = {
      'Basic': ['testnet'],
      'Standard': ['testnet'],
      'Premium': ['testnet', 'mainnet', 'cheqd'],
      'Enterprise': ['testnet', 'mainnet', 'cheqd', 'cosmos']
    };
    
    if (blockchainAccess[currentTier].includes(blockchain.toLowerCase())) {
      return ctx.reply(
        `✅ You have access to ${blockchain.toUpperCase()} blockchain information with your ${currentTier} support tier.`,
        Markup.inlineKeyboard([
          Markup.button.callback(`View ${blockchain.toUpperCase()} Info`, `view_blockchain_${blockchain}`)
        ])
      );
    } else {
      return ctx.reply(
        `⚠️ You do not have access to ${blockchain.toUpperCase()} blockchain information with your ${currentTier} support tier.\n\nTo upgrade your support tier and gain access, please use the /upgrade_support command.`
      );
    }
  } catch (error) {
    logger.error('Error checking blockchain access', { error: error.message });
    return ctx.reply('Sorry, there was an error checking your blockchain access permissions.');
  }
}

/**
 * Handle support tier upgrade request
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleSupportUpgradeRequest(ctx) {
  try {
    const userId = ctx.from.id;
    const params = ctx.message.text.split(' ').slice(1);
    const requestedTier = params[0] || 'Standard';
    
    // Get user DIDs or create one
    const userDids = await cheqdService.getUserDids(userId);
    let holderDid;
    
    if (userDids && userDids.length > 0) {
      holderDid = userDids[0].did;
    } else {
      holderDid = await cheqdService.createDid(userId);
    }
    
    // Validate requested tier
    const validTiers = ['Basic', 'Standard', 'Premium', 'Enterprise'];
    if (!validTiers.includes(requestedTier)) {
      return ctx.reply(
        `⚠️ Invalid support tier. Please choose one of: ${validTiers.join(', ')}`
      );
    }
    
    // Check if user already has a support credential
    const existingCredential = await sqliteService.db.get(
      `SELECT * FROM credentials 
       WHERE holder_did = ? AND type = 'SupportTier'
       ORDER BY issued_at DESC LIMIT 1`,
      [holderDid]
    );
    
    const tierLevels = {
      'Basic': 1,
      'Standard': 2,
      'Premium': 3,
      'Enterprise': 4
    };
    
    if (existingCredential) {
      const data = JSON.parse(existingCredential.data);
      const currentTier = data.tier;
      
      // Check if downgrading
      if (tierLevels[requestedTier] < tierLevels[currentTier]) {
        return ctx.reply(
          `⚠️ You already have ${currentTier} support access, which is higher than ${requestedTier}.`
        );
      }
      
      // Check if same tier
      if (requestedTier === currentTier) {
        return ctx.reply(
          `ℹ️ You already have ${currentTier} support access.`
        );
      }
    }
    
    // For demo purposes, automatically approve the upgrade
    // In a real implementation, this would require payment or approval
    const credentialData = {
      tier: requestedTier,
      accessLevel: tierLevels[requestedTier],
      features: [],
      issueDate: new Date().toISOString(),
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 year
    };
    
    // Add features based on tier
    if (tierLevels[requestedTier] >= 1) {
      credentialData.features.push('Basic Support');
      credentialData.features.push('Testnet Access');
    }
    
    if (tierLevels[requestedTier] >= 2) {
      credentialData.features.push('Priority Support');
      credentialData.features.push('Developer Resources');
    }
    
    if (tierLevels[requestedTier] >= 3) {
      credentialData.features.push('Mainnet Access');
      credentialData.features.push('Cheqd Network Access');
      credentialData.features.push('24/7 Support');
    }
    
    if (tierLevels[requestedTier] >= 4) {
      credentialData.features.push('Enterprise Support');
      credentialData.features.push('Cosmos Network Access');
      credentialData.features.push('Dedicated Account Manager');
    }
    
    // Issue the credential
    const credential = await cheqdService.issueCredential(
      'system', // System will use bot's DID as issuer
      holderDid,
      'SupportTier',
      credentialData
    );
    
    if (credential) {
      return ctx.reply(
        `🌟 Support tier upgraded successfully to ${requestedTier}!\n\n` +
        `Your new support features include:\n` +
        `${credentialData.features.map(f => '- ' + f).join('\n')}\n\n` +
        `This upgrade is valid until ${new Date(credentialData.expiryDate).toLocaleDateString()}.`,
        Markup.inlineKeyboard([
          Markup.button.callback('View Support Details', 'view_support_details')
        ])
      );
    } else {
      return ctx.reply(
        `⚠️ Could not upgrade support tier at this time. Please try again later.`
      );
    }
  } catch (error) {
    logger.error('Error in support upgrade handler', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your support tier upgrade request.');
  }
}

/**
 * Handle issuing moderation credentials
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleIssueModerationCredential(ctx) {
  try {
    // Check if user has authority to issue moderation credentials
    const issuerUserId = ctx.from.id;
    const params = ctx.message.text.split(' ').slice(1);
    
    if (params.length < 2) {
      return ctx.reply('Usage: /issue_mod_credential @username roleType\n\nAvailable roles: CommunityModerator, GroupAdmin, CrossChatModerator');
    }
    
    const targetUsername = params[0].replace('@', '');
    const role = params[1];
    
    // Get target user from username
    let targetUser;
    if (ctx.chat.type !== 'private') {
      try {
        const chatMember = await ctx.getChatMember(targetUsername);
        targetUser = chatMember.user;
      } catch (memberError) {
        return ctx.reply('Cannot find user with that username in this chat.');
      }
    } else {
      return ctx.reply('This command can only be used in group chats to appoint moderators.');
    }
    
    // Check if issuer has admin rights
    try {
      const issuerMember = await ctx.getChatMember(issuerUserId);
      if (!['creator', 'administrator'].includes(issuerMember.status)) {
        return ctx.reply('You must be a chat administrator to issue moderation credentials.');
      }
    } catch (error) {
      logger.error('Error checking admin status', { error: error.message });
      return ctx.reply('Failed to verify your admin status.');
    }
    
    // Get target user DIDs or create one
    const targetDids = await cheqdService.getUserDids(targetUser.id);
    let holderDid;
    
    if (targetDids && targetDids.length > 0) {
      holderDid = targetDids[0].did;
    } else {
      holderDid = await cheqdService.createDid(targetUser.id);
    }
    
    // Get issuer DIDs or create one
    const issuerDids = await cheqdService.getUserDids(issuerUserId);
    let issuerDid;
    
    if (issuerDids && issuerDids.length > 0) {
      issuerDid = issuerDids[0].did;
    } else {
      issuerDid = await cheqdService.createDid(issuerUserId);
    }
    
    // Prepare credential data
    const credentialData = {
      role: role,
      communities: [{ 
        id: ctx.chat.id.toString(), 
        name: ctx.chat.title, 
        platform: 'Telegram' 
      }],
      appointer: {
        id: issuerUserId.toString(),
        name: ctx.from.username || ctx.from.first_name,
        did: issuerDid
      },
      permissions: [],
      issueDate: new Date().toISOString(),
      expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days
    };
    
    // Add permissions based on role
    if (role === 'CommunityModerator') {
      credentialData.permissions = ['delete_messages', 'restrict_members', 'ban_members'];
    } else if (role === 'GroupAdmin') {
      credentialData.permissions = ['delete_messages', 'restrict_members', 'ban_members', 'invite_users', 'pin_messages'];
    } else if (role === 'CrossChatModerator') {
      credentialData.permissions = ['delete_messages', 'restrict_members', 'ban_members', 'cross_chat_moderation'];
    } else {
      return ctx.reply('Invalid role type. Available roles: CommunityModerator, GroupAdmin, CrossChatModerator');
    }
    
    // Issue the credential
    const credential = await cheqdService.issueCredential(
      issuerDid,
      holderDid,
      'ModerationCredential',
      credentialData
    );
    
    if (credential) {
      return ctx.reply(
        `🛡️ ${role} credential successfully issued to @${targetUser.username || targetUser.first_name}!\n\n` +
        `They now have moderation authority in this community.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      return ctx.reply('Failed to issue moderation credential. Please try again later.');
    }
  } catch (error) {
    logger.error('Error issuing moderation credential', { error: error.message });
    return ctx.reply('Sorry, there was an error issuing the moderation credential.');
  }
}

/**
 * Handle verification of moderation authority
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleVerifyModAuthority(ctx) {
  try {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id.toString();
    const params = ctx.message.text.split(' ').slice(1);
    const actionType = params[0] || 'all';
    
    // Get user DIDs
    const userDids = await cheqdService.getUserDids(userId);
    
    if (!userDids || userDids.length === 0) {
      return ctx.reply('You don\'t have any credentials yet. Use /create_did to create your digital identity first.');
    }
    
    // Get user's moderation credentials
    const holderDid = userDids[0].did;
    
    // Query the database for moderation credentials
    const credentials = await sqliteService.db.all(
      `SELECT * FROM credentials 
       WHERE holder_did = ? AND type = 'ModerationCredential'
       ORDER BY issued_at DESC`,
      [holderDid]
    );
    
    if (!credentials || credentials.length === 0) {
      return ctx.reply('You do not have any moderation credentials.');
    }
    
    // Find a valid credential for this chat
    let validCredential = null;
    let role = '';
    let permissionLevel = 0;
    
    for (const credential of credentials) {
      const data = JSON.parse(credential.data);
      
      // Check if this credential applies to this chat
      const communityMatch = data.communities.find(c => c.id === chatId);
      if (!communityMatch) continue;
      
      // Check if the credential has the required permission
      if (actionType !== 'all') {
        if (!data.permissions.includes(actionType)) continue;
      }
      
      // Check if the credential is still valid
      const expiryDate = new Date(data.expiryDate);
      if (expiryDate < new Date()) continue;
      
      // This is a valid credential
      validCredential = credential;
      role = data.role;
      permissionLevel = data.permissions.length;
      break;
    }
    
    if (validCredential) {
      return ctx.reply(
        `✅ You have ${role} authority in this chat with permission level ${permissionLevel}.\n\n` +
        `You can perform ${actionType === 'all' ? 'all authorized' : '"' + actionType + '"'} moderation actions.`
      );
    } else {
      return ctx.reply(
        `⚠️ You do not have authority to perform "${actionType}" actions in this chat.`
      );
    }
  } catch (error) {
    logger.error('Error verifying moderation authority', { error: error.message });
    return ctx.reply('Sorry, there was an error verifying your moderation authority.');
  }
}

/**
 * Handle P2P support provider request
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleP2PSupportProviderRequest(ctx) {
  try {
    const userId = ctx.from.id;
    const params = ctx.message.text.split(' ').slice(1);
    const requestedLevel = params[0] || 'Helper';
    
    // Get user DIDs or create one
    const userDids = await cheqdService.getUserDids(userId);
    let holderDid;
    
    if (userDids && userDids.length > 0) {
      holderDid = userDids[0].did;
    } else {
      holderDid = await cheqdService.createDid(userId);
    }
    
    // Validate requested level
    const validLevels = ['Helper', 'Advisor', 'Expert'];
    if (!validLevels.includes(requestedLevel)) {
      return ctx.reply(
        `⚠️ Invalid support provider level. Please choose one of: ${validLevels.join(', ')}`
      );
    }
    
    // Check current support tier
    const userTier = await supportCredentialService.getUserSupportTier(userId);
    
    // Check if user already has a P2P support provider credential
    const providerStatus = await supportCredentialService.getUserP2PSupportProviderStatus(userId);
    
    if (providerStatus.isProvider) {
      const currentLevel = providerStatus.level.name;
      
      // Check if downgrading
      if (validLevels.indexOf(requestedLevel) < validLevels.indexOf(currentLevel)) {
        return ctx.reply(
          `⚠️ You are already a ${currentLevel} level provider, which is higher than ${requestedLevel}.`
        );
      }
      
      // Check if same level
      if (requestedLevel === currentLevel) {
        return ctx.reply(
          `ℹ️ You are already a ${currentLevel} level provider.`
        );
      }
    }
    
    // Try to issue credential
    try {
      const credential = await supportCredentialService.issueP2PSupportProviderCredential(
        {
          id: userId,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name
        },
        requestedLevel
      );
      
      return ctx.reply(
        `🌟 You are now a certified P2P Support Provider at ${requestedLevel} level!\n\n` +
        `Your provider features include:\n` +
        `${credential.level.features.map(f => '- ' + f).join('\n')}\n\n` +
        `This credential is valid until ${new Date(credential.validity.endDate).toLocaleDateString()}.`,
        Markup.inlineKeyboard([
          Markup.button.callback('View Provider Details', 'view_p2p_provider_details')
        ])
      );
    } catch (error) {
      // Provide specific feedback based on the error
      if (error.message.includes('tier')) {
        return ctx.reply(
          `⚠️ You don't meet the minimum support tier requirement for ${requestedLevel} level.\n\n` +
          `Required: ${error.message}\n\n` +
          `Your current tier: ${userTier.tier.name}\n\n` +
          `Please upgrade your support tier first with /upgrade_support.`
        );
      }
      
      if (error.message.includes('interactions')) {
        return ctx.reply(
          `⚠️ You don't have enough successful support interactions for ${requestedLevel} level.\n\n` +
          `${error.message}\n\n` +
          `Start by becoming a Helper and complete more support interactions.`
        );
      }
      
      // Generic error
      return ctx.reply(
        `⚠️ Could not issue P2P support provider credential: ${error.message}`
      );
    }
  } catch (error) {
    logger.error('Error in P2P support provider request handler', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your P2P support provider request.');
  }
}

/**
 * Handle request for P2P support
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleRequestP2PSupport(ctx) {
  try {
    const userId = ctx.from.id;
    const supportText = ctx.message.text.split(' ').slice(1).join(' ');
    
    if (!supportText || supportText.trim().length < 10) {
      return ctx.reply(
        '⚠️ Please provide a detailed description of your support request (at least 10 characters).\n\n' +
        'Example: /request_support I need help understanding how to verify my DID.'
      );
    }
    
    // Check if user has active request
    const existingRequest = await sqliteService.db.get(
      `SELECT * FROM p2p_support_requests 
       WHERE seeker_id = ? AND status = 'open'
       LIMIT 1`,
      [userId]
    );
    
    if (existingRequest) {
      return ctx.reply(
        `⚠️ You already have an open support request. Please wait for a response.\n\n` +
        `Your request: ${existingRequest.request_text.substring(0, 100)}${existingRequest.request_text.length > 100 ? '...' : ''}\n\n` +
        `Status: ${existingRequest.status}\n` +
        `Created: ${new Date(existingRequest.created_at).toLocaleString()}`
      );
    }
    
    // Get user's support tier
    const userTier = await supportCredentialService.getUserSupportTier(userId);
    
    // Create the support request
    const requestId = await sqliteService.db.run(
      `INSERT INTO p2p_support_requests
       (seeker_id, request_text, status, created_at, updated_at)
       VALUES (?, ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id`,
      [userId, supportText]
    );
    
    logger.info('Created P2P support request', {
      userId,
      requestId,
      supportText: supportText.substring(0, 50) + (supportText.length > 50 ? '...' : '')
    });
    
    // Notify available providers
    await notifyAvailableProviders(supportText, userId, userTier.tier.level, ctx.telegram);
    
    return ctx.reply(
      `✅ Your support request has been submitted!\n\n` +
      `Request ID: #${requestId}\n` +
      `Status: Open\n\n` +
      `A support provider will respond to your request soon. You will be notified when someone accepts your request.`
    );
  } catch (error) {
    logger.error('Error in request P2P support handler', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your support request.');
  }
}

/**
 * Notify available providers about a new support request
 * @param {string} requestText - Support request text
 * @param {number} seekerId - Support seeker ID
 * @param {number} seekerTierLevel - Seeker's support tier level
 * @param {Object} telegram - Telegram bot instance
 * @returns {Promise<void>}
 * @private
 */
async function notifyAvailableProviders(requestText, seekerId, seekerTierLevel, telegram) {
  try {
    // Find active providers
    const providers = await sqliteService.db.all(
      `SELECT p.*, u.username, u.first_name, u.last_name
       FROM p2p_support_providers p
       JOIN users u ON p.user_id = u.id
       WHERE p.end_date > CURRENT_TIMESTAMP`
    );
    
    if (!providers || providers.length === 0) {
      logger.warn('No active P2P support providers found');
      return;
    }
    
    // Filter providers based on level mapping to seeker tier
    // Higher tier seekers get access to higher level providers
    const eligibleProviders = providers.filter(provider => {
      const providerLevel = provider.provider_level;
      
      switch (seekerTierLevel) {
        case 1: // Basic tier
          return providerLevel === 'Helper'; // Only helpers
        case 2: // Standard tier
          return ['Helper', 'Advisor'].includes(providerLevel); // Helpers and advisors
        case 3: // Premium tier
        case 4: // Enterprise tier
          return true; // All provider levels
        default:
          return providerLevel === 'Helper'; // Default to helpers only
      }
    });
    
    if (eligibleProviders.length === 0) {
      logger.warn('No eligible providers found for seeker tier level', { seekerTierLevel });
      return;
    }
    
    // Get seeker info
    const seeker = await sqliteService.db.get(
      `SELECT username, first_name, last_name FROM users WHERE id = ?`,
      [seekerId]
    );
    
    const seekerDisplay = seeker.username 
      ? `@${seeker.username}` 
      : `${seeker.first_name}${seeker.last_name ? ' ' + seeker.last_name : ''}`;
    
    // Notify each eligible provider
    for (const provider of eligibleProviders) {
      try {
        const notificationText = 
          `🆘 *New Support Request*\n\n` +
          `From: ${seekerDisplay}\n` +
          `Request: ${requestText.substring(0, 200)}${requestText.length > 200 ? '...' : ''}\n\n` +
          `Would you like to help this user?`;
        
        await telegram.sendMessage(
          provider.user_id,
          notificationText, 
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '✅ Accept Request',
                    callback_data: `support:accept_request:${seekerId}`
                  }
                ]
              ]
            }
          }
        );
      } catch (error) {
        logger.error('Failed to notify provider about support request', {
          providerId: provider.user_id,
          error: error.message
        });
      }
    }
  } catch (error) {
    logger.error('Error notifying providers about support request', { error: error.message });
  }
}

module.exports = {
  handleQuizCompletion,
  handleViewEducationalProgress,
  handleVerifySupportTier,
  handleBlockchainAccessCheck,
  handleSupportUpgradeRequest,
  handleIssueModerationCredential,
  handleVerifyModAuthority,
  handleP2PSupportProviderRequest,
  handleRequestP2PSupport
}; 