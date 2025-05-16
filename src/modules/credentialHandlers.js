/**
 * Telegram Credential Handlers
 * 
 * Handlers for managing educational, support, and moderation credentials
 * through Telegram bot commands and interactions.
 */

const logger = require('../utils/logger');
const { Markup } = require('telegraf');
const sqliteService = require('../db/sqliteService');
const cheqdService = require('../services/cheqdService');

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

module.exports = {
  handleQuizCompletion,
  handleViewEducationalProgress,
  handleVerifySupportTier,
  handleBlockchainAccessCheck,
  handleSupportUpgradeRequest,
  handleIssueModerationCredential,
  handleVerifyModAuthority
}; 