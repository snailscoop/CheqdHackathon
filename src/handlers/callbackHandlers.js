/**
 * Callback Handlers
 * 
 * Handlers for Telegram callback queries (button clicks).
 */

const logger = require('../utils/logger');
const sqliteService = require('../db/sqliteService');
const educationalCredentialService = require('../modules/education/educationalCredentialService');
const supportCredentialService = require('../modules/support/supportCredentialService');
const moderationCredentialService = require('../modules/moderation/moderationCredentialService');
const grokService = require('../services/grokService');

/**
 * Handle quiz callbacks (button clicks)
 * @param {Object} ctx - Telegram context
 */
async function handleQuizCallback(ctx) {
  try {
    // Parse callback data
    const data = ctx.callbackQuery.data;
    const [prefix, action, ...args] = data.split(':');
    
    // Record stat
    await sqliteService.recordStat('callback', `quiz_${action}`);
    
    // Get user ID
    const userId = ctx.callbackQuery.from.id;
    
    switch (action) {
      case 'start':
        // Start a new quiz
        const topicId = args[0];
        
        if (!topicId) {
          return ctx.reply('Error: No topic specified.');
        }
        
        // Get topic details
        const topic = await educationalCredentialService.getQuizTopic(topicId);
        
        if (!topic) {
          return ctx.reply(`Error: Topic '${topicId}' not found.`);
        }
        
        // Generate quiz questions
        const questions = await grokService.generateQuizQuestions(
          topic.name,
          topic.questionCount || 5,
          topic.difficulty || 'medium'
        );
        
        if (!questions || questions.length === 0) {
          return ctx.reply('Error: Could not generate quiz questions.');
        }
        
        // Create quiz session
        const session = educationalCredentialService.createQuizSession(
          userId,
          topic.name,
          questions,
          topic.passThreshold
        );
        
        // Send first question
        await ctx.reply(`Starting quiz on ${topic.name}...`);
        
        // Get message handlers to send question
        const messageHandlers = require('./messageHandlers');
        const sendQuizQuestion = messageHandlers.sendQuizQuestion;
        
        await sendQuizQuestion(ctx, session);
        break;
        
      case 'topics':
        // Show available topics
        const topics = await educationalCredentialService.getAvailableQuizTopics();
        
        if (!topics || topics.length === 0) {
          return ctx.reply('No quiz topics are currently available.');
        }
        
        // Create inline keyboard with topics
        const keyboard = {
          inline_keyboard: topics.map(topic => [
            {
              text: topic.name,
              callback_data: `quiz:start:${topic.id}`
            }
          ])
        };
        
        return ctx.editMessageText(
          'Please select a quiz topic:',
          { reply_markup: keyboard }
        );
        
      case 'cancel':
        // Cancel current quiz
        educationalCredentialService.endQuizSession(userId);
        return ctx.editMessageText('Quiz cancelled.');
        
      default:
        return ctx.reply('Unknown quiz action.');
    }
  } catch (error) {
    logger.error('Error handling quiz callback', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your selection.');
  }
}

/**
 * Handle support callbacks (button clicks)
 * @param {Object} ctx - Telegram context
 */
async function handleSupportCallback(ctx) {
  try {
    // Parse callback data
    const data = ctx.callbackQuery.data;
    const [prefix, action, ...args] = data.split(':');
    
    // Record stat
    await sqliteService.recordStat('callback', `support_${action}`);
    
    // Get user ID
    const userId = ctx.callbackQuery.from.id;
    
    switch (action) {
      case 'upgrade':
        // Get target tier
        const targetTier = args[0];
        
        if (!targetTier) {
          return ctx.reply('Error: No target tier specified.');
        }
        
        // Check current tier
        const currentTier = await supportCredentialService.getUserSupportTier(userId);
        
        // Check if already at or above target tier
        if (supportCredentialService.getTierLevel(currentTier) >= 
            supportCredentialService.getTierLevel(targetTier)) {
          return ctx.editMessageText(
            `You are already at the ${currentTier} support tier, which is at or above ${targetTier}.`
          );
        }
        
        // Create upgrade confirmation message
        let confirmationText = `Upgrade Support Tier\n\n`;
        confirmationText += `Current Tier: ${currentTier.toUpperCase()}\n`;
        confirmationText += `Target Tier: ${targetTier.toUpperCase()}\n\n`;
        
        // Add tier benefits
        confirmationText += `Benefits of ${targetTier.toUpperCase()}:\n`;
        
        switch (targetTier.toLowerCase()) {
          case 'premium':
            confirmationText += `• Priority Response\n`;
            confirmationText += `• Enhanced Token Limit (${supportCredentialService.getTierTokenLimit('premium')})\n`;
            confirmationText += `• Advanced Analytics\n`;
            confirmationText += `• Custom Credential Types\n`;
            break;
            
          case 'standard':
            confirmationText += `• Faster Response Time\n`;
            confirmationText += `• Increased Token Limit (${supportCredentialService.getTierTokenLimit('standard')})\n`;
            confirmationText += `• Basic Analytics\n`;
            break;
            
          default:
            confirmationText += `• Unknown tier benefits\n`;
        }
        
        // Add confirmation buttons
        const confirmKeyboard = {
          inline_keyboard: [
            [
              {
                text: 'Confirm Upgrade',
                callback_data: `support:confirm_upgrade:${targetTier}`
              }
            ],
            [
              {
                text: 'Cancel',
                callback_data: 'support:cancel_upgrade'
              }
            ]
          ]
        };
        
        return ctx.editMessageText(
          confirmationText,
          { reply_markup: confirmKeyboard }
        );
        
      case 'confirm_upgrade':
        // Get target tier
        const confirmTier = args[0];
        
        if (!confirmTier) {
          return ctx.reply('Error: No target tier specified.');
        }
        
        // Upgrade tier
        const upgradeResult = await supportCredentialService.upgradeSupportTier(userId, confirmTier);
        
        if (upgradeResult.success) {
          return ctx.editMessageText(
            `✅ Support tier upgraded to ${confirmTier.toUpperCase()}!\n\n` +
            `Your new token limit is ${upgradeResult.tokenLimit} tokens per ${upgradeResult.resetPeriod}.`
          );
        } else {
          return ctx.editMessageText(
            `❌ Failed to upgrade support tier: ${upgradeResult.error}`
          );
        }
        
      case 'cancel_upgrade':
        return ctx.editMessageText('Support tier upgrade cancelled.');
        
      default:
        return ctx.reply('Unknown support action.');
    }
  } catch (error) {
    logger.error('Error handling support callback', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your selection.');
  }
}

/**
 * Handle moderator callbacks (button clicks)
 * @param {Object} ctx - Telegram context
 */
async function handleModeratorCallback(ctx) {
  try {
    // Parse callback data
    const data = ctx.callbackQuery.data;
    const [prefix, action, ...args] = data.split(':');
    
    // Record stat
    await sqliteService.recordStat('callback', `mod_${action}`);
    
    // Get user ID
    const userId = ctx.callbackQuery.from.id;
    const chatId = ctx.chat.id;
    
    // Check if user is a moderator
    const isModerator = await moderationCredentialService.isUserModerator(userId, chatId);
    
    if (!isModerator) {
      return ctx.reply('You do not have moderator privileges in this chat.');
    }
    
    switch (action) {
      case 'ban_user':
        // Ask for username
        return ctx.editMessageText(
          'Please reply with the username to ban in the format:\n/mod ban @username [reason]'
        );
        
      case 'unban_user':
        // Ask for username
        return ctx.editMessageText(
          'Please reply with the username to unban in the format:\n/mod unban @username'
        );
        
      case 'kick_user':
        // Ask for username
        return ctx.editMessageText(
          'Please reply with the username to kick in the format:\n/mod kick @username [reason]'
        );
        
      case 'mute_user':
        // Ask for username
        return ctx.editMessageText(
          'Please reply with the username to mute in the format:\n/mod mute @username [duration]'
        );
        
      case 'unmute_user':
        // Ask for username
        return ctx.editMessageText(
          'Please reply with the username to unmute in the format:\n/mod unmute @username'
        );
        
      case 'add_mod':
        // Ask for username
        return ctx.editMessageText(
          'Please reply with the username to make moderator in the format:\n/mod add @username [level]'
        );
        
      case 'remove_mod':
        // Ask for username
        return ctx.editMessageText(
          'Please reply with the username to remove moderator privileges in the format:\n/mod remove @username'
        );
        
      default:
        return ctx.reply('Unknown moderator action.');
    }
  } catch (error) {
    logger.error('Error handling moderator callback', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your selection.');
  }
}

/**
 * Handle verify callbacks (button clicks)
 * @param {Object} ctx - Telegram context
 */
async function handleVerifyCallback(ctx) {
  try {
    // Parse callback data
    const data = ctx.callbackQuery.data;
    const [prefix, action, ...args] = data.split(':');
    
    // Record stat
    await sqliteService.recordStat('callback', `verify_${action}`);
    
    // Placeholder for verify callbacks
    return ctx.reply('Verify callback actions not yet implemented.');
  } catch (error) {
    logger.error('Error handling verify callback', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your selection.');
  }
}

/**
 * Handle admin callbacks (button clicks)
 * @param {Object} ctx - Telegram context
 */
async function handleAdminCallback(ctx) {
  try {
    // Parse callback data
    const data = ctx.callbackQuery.data;
    const [prefix, action, ...args] = data.split(':');
    
    // Record stat
    await sqliteService.recordStat('callback', `admin_${action}`);
    
    // Get user ID
    const userId = ctx.callbackQuery.from.id;
    
    // Check if user is an admin
    const adminIds = await sqliteService.getSetting('bot_admins');
    const isAdmin = adminIds && adminIds.includes(userId.toString());
    
    if (!isAdmin) {
      return ctx.reply('This action is only available to bot administrators.');
    }
    
    // Placeholder for admin callbacks
    return ctx.reply('Admin callback actions not yet implemented.');
  } catch (error) {
    logger.error('Error handling admin callback', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your selection.');
  }
}

/**
 * Handle credential callbacks (button clicks)
 * @param {Object} ctx - Telegram context
 */
async function handleCredentialCallback(ctx) {
  try {
    // Parse callback data
    const data = ctx.callbackQuery.data;
    const [prefix, action, ...args] = data.split(':');
    
    // Record stat
    await sqliteService.recordStat('callback', `credential_${action}`);
    
    // Placeholder for credential callbacks
    return ctx.reply('Credential callback actions not yet implemented.');
  } catch (error) {
    logger.error('Error handling credential callback', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your selection.');
  }
}

/**
 * Handle generic callbacks (button clicks)
 * @param {Object} ctx - Telegram context
 */
async function handleGenericCallback(ctx) {
  try {
    // Parse callback data
    const data = ctx.callbackQuery.data;
    
    // Log unknown callback
    logger.warn('Unknown callback query received', { data });
    
    return ctx.reply('This button action is not recognized.');
  } catch (error) {
    logger.error('Error handling generic callback', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your selection.');
  }
}

// Export callback handlers
module.exports = {
  handleQuizCallback,
  handleSupportCallback,
  handleModeratorCallback,
  handleVerifyCallback,
  handleAdminCallback,
  handleCredentialCallback,
  handleGenericCallback
}; 