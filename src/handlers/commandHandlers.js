/**
 * Command Handlers
 * 
 * Handlers for Telegram bot commands.
 */

const logger = require('../utils/logger');
const sqliteService = require('../db/sqliteService');
const grokService = require('../services/grokService');
const cheqdService = require('../services/cheqdService');
const telegramService = require('../services/telegramService');
const systemPrompts = require('../modules/grok/systemPrompts');

// Import credential services
const educationalCredentialService = require('../modules/education/educationalCredentialService');
const supportCredentialService = require('../modules/support/supportCredentialService');
const moderationCredentialService = require('../modules/moderation/moderationCredentialService');
const moderationService = require('../modules/moderation/moderationService');

/**
 * Handle the start command
 * @param {Object} ctx - Telegram context
 */
async function handleStartCommand(ctx) {
  try {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'there';
    
    // Record stat
    await sqliteService.recordStat('command', 'start');
    
    return ctx.reply(
      `Hello, ${firstName}! I'm Dail Bot, a trusted AI educational bot for the Cheqd ecosystem.\n\n` +
      `I can help you with:\n` +
      `• Learning about blockchain and DIDs\n` +
      `• Managing verifiable credentials\n` +
      `• Providing support and answering questions\n\n` +
      `Use /help to see what commands are available.`
    );
  } catch (error) {
    logger.error('Error handling start command', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your command.');
  }
}

/**
 * Handle the help command
 * @param {Object} ctx - Telegram context
 */
async function handleHelpCommand(ctx) {
  try {
    // Record stat
    await sqliteService.recordStat('command', 'help');
    
    return ctx.reply(
      `Dail Bot Commands:\n\n` +
      `/start - Start the bot\n` +
      `/help - Show this help message\n` +
      `/dail [command] - Use the natural language interface\n` +
      `/status - Check bot status\n` +
      `/quiz - Start an educational quiz\n` +
      `/progress - View your educational progress\n` +
      `/support - Check your support tier\n` +
      `/verify - Verify a credential\n` +
      `/did - Manage your DIDs\n` +
      `/credential - Manage your credentials\n` +
      `/mod - Moderation commands\n` +
      `/admin - Admin commands\n` +
      `/ask - Ask the AI a question\n\n` +
      `P2P Support Commands:\n` +
      `/become_provider - Apply to be a P2P support provider\n` +
      `/request_support - Request help from a P2P support provider`
    );
  } catch (error) {
    logger.error('Error handling help command', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your command.');
  }
}

/**
 * Handle the dail command (natural language interface)
 * @param {Object} ctx - Telegram context
 */
async function handleDailCommand(ctx) {
  try {
    // Extract command text
    const commandText = ctx.message.text.substring(6).trim();
    
    if (!commandText) {
      return ctx.reply(
        "Please provide a command after /dail. For example:\n" +
        "/dail create a new DID for me\n" +
        "/dail issue an educational credential to @username\n" +
        "/dail check my support tier\n" +
        "/dail kick @username for spamming\n" +
        "/dail mute @username for 10 minutes\n" +
        "/dail enable anti-spam in this chat"
      );
    }
    
    // Check for "get started" command specifically
    if (commandText.toLowerCase() === 'get started') {
      logger.info('Detected setup command in /dail message', { command: commandText });
      
      // Check if this is a group chat
      if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        // Send welcome message with setup instructions
        // Send initial message with button
        const startMsg = await ctx.reply(
          "🎉 *Welcome to Dail Bot!* 🎉\n\n" +
          "I'm here to help manage your group and provide credential services.\n\n" +
          "Here's how to set up the bot:\n" +
          "1. Make sure I'm an admin in this group\n" +
          "2. Click the button below to start setup\n\n" +
          "After setup, all admins will receive verifiable credentials to manage the group.",
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "🚀 Start Setup", callback_data: "payment:completed" }]
              ]
            }
          }
        );
        
        // Follow up with an additional message after a brief delay for better visibility
        setTimeout(async () => {
          try {
            await ctx.reply(
              "⬆️ Click the 'Start Setup' button above to begin. I'll create digital credentials for all admins.",
              { reply_to_message_id: startMsg.message_id }
            );
          } catch (error) {
            logger.error('Error sending follow-up message', { error: error.message });
          }
        }, 1500);
        
        return;
      } else {
        // This is a private chat, different instructions
        return ctx.reply(
          "🎉 *Welcome to Dail Bot!* 🎉\n\n" +
          "I can help you manage groups and work with verifiable credentials.\n\n" +
          "To get started:\n" +
          "• Add me to a group and make me admin\n" +
          "• Then use `/dail get started` in the group\n\n" +
          "Or try these commands in our private chat:\n" +
          "• `/did create` - Create your own DID\n" +
          "• `/verify` - Verify credentials\n" +
          "• `/help` - See all commands",
          { parse_mode: 'Markdown' }
        );
      }
    }
    
    // Special handling for "stop quiz" command
    if (commandText.toLowerCase() === 'stop quiz') {
      logger.info('Processing stop quiz command from /dail message', { userId: ctx.from.id });
      
      // Import the quiz handler
      const conversationalVideoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
      
      // Try to clear any active quiz session
      const result = await conversationalVideoQuizHandler.clearQuizSession(ctx.from.id);
      
      if (result) {
        await ctx.reply('Quiz session cleared successfully! You can now start a new quiz or continue with normal conversation.');
      } else {
        await ctx.reply('No active quiz session found or there was an error clearing the session.');
      }
      
      return;
    }
    
    // Handle variations of stop quiz command
    const stopQuizPatterns = ['end quiz', 'cancel quiz', 'quit quiz', 'exit quiz'];
    if (stopQuizPatterns.some(pattern => commandText.toLowerCase() === pattern)) {
      logger.info(`Processing ${commandText} command from /dail message`, { userId: ctx.from.id });
      
      // Import the quiz handler
      const conversationalVideoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
      
      // Try to clear any active quiz session
      const result = await conversationalVideoQuizHandler.clearQuizSession(ctx.from.id);
      
      if (result) {
        await ctx.reply('Quiz session cleared successfully! You can now start a new quiz or continue with normal conversation.');
      } else {
        await ctx.reply('No active quiz session found or there was an error clearing the session.');
      }
      
      return;
    }
    
    // Also check for more generic quiz reset requests
    if (commandText.toLowerCase().includes('quiz') && 
        (commandText.toLowerCase().includes('stop') || 
         commandText.toLowerCase().includes('cancel') || 
         commandText.toLowerCase().includes('exit') || 
         commandText.toLowerCase().includes('end') || 
         commandText.toLowerCase().includes('reset') ||
         commandText.toLowerCase().includes('clear'))) {
      
      logger.info(`Processing quiz stop request from /dail message: "${commandText}"`, { userId: ctx.from.id });
      
      // Import the quiz handler
      const conversationalVideoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
      
      // Try to clear any active quiz session
      const result = await conversationalVideoQuizHandler.clearQuizSession(ctx.from.id);
      
      if (result) {
        await ctx.reply('Quiz session cleared successfully! You can now start a new quiz or continue with normal conversation.');
      } else {
        await ctx.reply('No active quiz session found or there was an error clearing the session.');
      }
      
      return;
    }
    
    // Record stat
    await sqliteService.recordStat('command', 'dail');
    
    // Show typing indicator
    await ctx.replyWithChatAction('typing');
    
    // Direct handling for DID queries with exact match first (most efficient)
    // This helps ensure reliable handling of these critical commands
    const didExactQueries = [
      'check my dids', 
      'check my did', 
      'what are my dids', 
      'what is my did', 
      'show my dids', 
      'list my dids',
      'view my dids',
      'get my dids',
      'what dids do i have',
      'see my dids'
    ];
    
    if (didExactQueries.includes(commandText.toLowerCase())) {
      logger.info('Direct handling of check my dids command', { 
        exactMatch: true,
        command: commandText.toLowerCase()
      });
      return await handleMyDids(ctx, {});
    }
    
    // Check for transaction hash pattern in the command
    const txHashRegex = /\b([A-F0-9]{64})\b/i;
    const txHashMatch = commandText.match(txHashRegex);
    
    if (txHashMatch) {
      logger.info('Transaction hash detected in command', {
        txHash: txHashMatch[1],
        query: commandText
      });
      
      // Handle as blockchain query
      return await handleBlockchainQuery(ctx, commandText, txHashMatch[1]);
    }
    
    // CHECK FOR DID-RELATED COMMANDS - Direct handling like kick
    
    // Pattern for checking/viewing DIDs using a comprehensive regex pattern
    // This catches variations and more flexible phrasings
    const checkDidsPattern = /(?:check|view|show|list|see|get|tell\s+me|what\s+(?:are|is)|display|where\s+(?:are|is)|i\s+want\s+to\s+see)\s+(?:(?:my|all|the)\s+)?did(?:s)?(?:\s+(?:please|now|for\s+me))?/i;
    const checkDidsMatch = commandText.match(checkDidsPattern);
    
    if (checkDidsMatch) {
      logger.info('DID listing pattern matched', { 
        command: commandText, 
        matchType: 'regex pattern',
        pattern: checkDidsPattern.toString()
      });
      return await handleMyDids(ctx, {});
    }
    
    // Pattern for creating a new DID
    const createDidMatch = commandText.match(/(?:create|make|generate|new)(?:\s+a)?(?:\s+new)?\s+(?:did)(?:\s+for\s+me)?/i);
    if (createDidMatch) {
      logger.info('DID creation requested via natural language', { command: commandText });
      return await handleCreateDid(ctx, {});
    }
    
    // Pattern for general DID information (without "my") - excluding help-related queries
    const generalDidInfoPattern = /(?:check|show|list)\s+(?:did|dids)(?:\s+info)?/i;
    const generalDidInfoMatch = commandText.match(generalDidInfoPattern);
    if (generalDidInfoMatch) {
      logger.info('General DID information requested', { command: commandText });
      // For general DID info requests, we'll still show the user's DIDs
      return await handleMyDids(ctx, {});
    }
    
    // Pattern for DID help/information
    const didHelpMatch = commandText.match(/(?:what(?:\s+are|\'s)|help|info|about)(?:\s+with)?\s+(?:did|dids)(?:s)?/i);
    if (didHelpMatch) {
      logger.info('DID help requested via natural language', { command: commandText });
      return ctx.reply(
        "💡 *DIDs (Decentralized Identifiers)* 💡\n\n" +
        "DIDs are unique identifiers that enable verifiable, self-sovereign digital identity.\n\n" +
        "*Available DID Commands:*\n" +
        "• `/dail create a new did` - Create a new DID\n" +
        "• `/dail check my dids` - List your DIDs\n" +
        "• `/did create` - Create a DID (direct command)\n" +
        "• `/did list` - List your DIDs (direct command)\n\n" +
        "DIDs can be used for issuing and verifying credentials on the cheqd network.",
        { parse_mode: 'Markdown' }
      );
    }
    
    // Check for moderation commands specifically to properly route them
    const kickMatch = commandText.match(/kick\s+(@\w+|\w+)(?:\s+(.*))?/i);
    const banMatch = commandText.match(/ban\s+(@\w+|\w+)(?:\s+(.*))?/i);
    const muteMatch = commandText.match(/mute\s+(@\w+|\w+)(?:\s+(.*))?/i);
    
    // Handle specific moderation commands directly
    if (kickMatch) {
      const username = kickMatch[1].replace('@', '');
      const reason = kickMatch[2] || 'No reason provided';
      return await handleKickUser(ctx, { user: username, reason: reason });
    }
    
    if (banMatch) {
      const username = banMatch[1].replace('@', '');
      const reason = banMatch[2] || 'No reason provided';
      return await handleBanUser(ctx, { user: username, reason: reason });
    }
    
    if (muteMatch) {
      const username = muteMatch[1].replace('@', '');
      const duration = 60; // Default duration
      const reason = muteMatch[2] || 'No reason provided';
      return await handleMuteUser(ctx, { user: username, duration: duration, reason: reason });
    }
    
    // Check for slash command format in the text as direct command execution
    const slashCommandMatch = commandText.match(/^\/(\w+)(?:\s+(.*))?$/);
    if (slashCommandMatch) {
      const command = slashCommandMatch[1].toLowerCase();
      const args = slashCommandMatch[2] || '';
      
      // If it's a direct command, look for a handler
      const handlerName = `handle${command.charAt(0).toUpperCase() + command.slice(1)}Command`;
      if (typeof module.exports[handlerName] === 'function') {
        // Create a mock ctx with the adjusted message
        const mockCtx = {
          ...ctx,
          message: {
            ...ctx.message,
            text: `/${command} ${args}`
          }
        };
        return await module.exports[handlerName](mockCtx);
      }
    }
    
    // We already have DID command handling earlier in this function, 
    // so we don't need duplicate checks here
    
    // Process the natural language command with Grok AI
    const user = {
      id: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name
    };
    
    // Get user context for more personalized responses
    const userDids = await cheqdService.getUserDids(user.id);
    const supportTier = await supportCredentialService.getUserSupportTier(user.id);
    const educationalProgress = await educationalCredentialService.getUserProgress(user.id);
    
    // Determine if user is a moderator
    const isModerator = await moderationCredentialService.isUserModerator(user.id, ctx.chat.id);
    
    // Check if it's a group chat
    const isGroupChat = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    
    // Create context for the AI
    const context = {
      user,
      chat: {
        id: ctx.chat.id,
        type: ctx.chat.type,
        title: ctx.chat.title
      },
      userDids: userDids || [],
      supportTier: supportTier || 'basic',
      isModerator,
      isGroupChat,
      commandText
    };
    
    // Process with Grok
    const response = await processNaturalLanguageCommand(commandText, context);
    
    // Handle the response
    if (response.action && response.action !== 'unknown') {
      // An action was determined, execute it
      logger.info(`Executing action from natural language command: ${response.action}`, {
        parameters: response.parameters
      });
      return await executeCommandAction(ctx, response.action, response.parameters);
    } else {
      // If no specific action, check if it might be a general chat query
      const isGeneralQuestion = /what|how|why|when|where|who|can you|could you|would you|tell me|explain/i.test(commandText.toLowerCase());
      
      if (isGeneralQuestion) {
        // Process as a general AI query
        return await handleAskCommand({
          ...ctx,
          message: {
            ...ctx.message,
            text: `/ask ${commandText}`
          }
        });
      }
      
      // No specific action or general query identified
      return ctx.reply(response.text || "I'm not sure how to help with that request. Try being more specific or use a different command.");
    }
  } catch (error) {
    logger.error('Error handling dail command', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your command.');
  }
}

/**
 * Handle context command
 * @param {Object} ctx - Telegram context
 */
async function handleContextCommand(ctx) {
  try {
    // Parse command arguments
    const args = ctx.message.text.substring(9).trim().split(' ');
    const subCommand = args[0]?.toLowerCase();
    
    // Get user ID
    const userId = ctx.from.id;
    
    // Record stat
    await sqliteService.recordStat('command', 'context');
    
    switch (subCommand) {
      case 'clear':
        // Clear the conversation context
        const cleared = await grokService.clearConversationContext(userId, ctx.chat.id);
        
        if (cleared) {
          return ctx.reply('Your conversation context has been cleared. I\'ve forgotten our previous interactions.');
        } else {
          return ctx.reply('Sorry, there was an error clearing your conversation context.');
        }
        
      case 'show':
        // Show the current conversation context
        const context = await grokService.getConversationContext(userId, ctx.chat.id);
        
        if (!context || context.length === 0) {
          return ctx.reply('You don\'t have any stored conversation context.');
        }
        
        let contextText = 'Your conversation history (last 10 messages):\n\n';
        
        for (const msg of context) {
          const role = msg.role === 'user' ? 'You' : 'Bot';
          let content = msg.content;
          
          // Truncate long messages
          if (content.length > 100) {
            content = content.substring(0, 97) + '...';
          }
          
          contextText += `${role}: ${content}\n\n`;
        }
        
        return ctx.reply(contextText);
        
      default:
        // Show help text
        return ctx.reply(
          'Conversation Context Commands:\n\n' +
          '/context clear - Clear your conversation context\n' +
          '/context show - Show your current conversation context\n\n' +
          'The bot maintains context of your conversations to provide more accurate responses and remember previous interactions.'
        );
    }
  } catch (error) {
    logger.error('Error handling context command', { error: error.message });
    return ctx.reply('Sorry, there was an error managing your conversation context.');
  }
}

/**
 * Process a natural language command with Grok AI
 * @param {String} commandText - Command text
 * @param {Object} context - Command context
 * @returns {Promise<Object>} - Processed command result
 * @private
 */
async function processNaturalLanguageCommand(commandText, context) {
  try {
    // Check for continuity markers in the command that suggest referring to previous context
    const continuityMarkers = [
      'it', 'that', 'them', 'those', 'these', 'this', 'the', 
      'continue', 'again', 'more', 'next', 'previous', 'before',
      'instead', 'change', 'modify', 'update'
    ];
    
    const containsContinuityMarker = continuityMarkers.some(marker => 
      new RegExp(`\\b${marker}\\b`, 'i').test(commandText)
    );
    
    // If the command seems to refer to previous context, get conversation history
    let conversationHistory = [];
    if (containsContinuityMarker && context.user?.id) {
      conversationHistory = await grokService.getConversationContext(
        context.user.id, 
        context.chat?.id
      );
      
      logger.info('Including conversation history due to continuity markers', {
        historyLength: conversationHistory.length,
        command: commandText
      });
    }

    // First check for direct moderation commands with pattern matching
    // This ensures critical moderation functions work reliably
    const kickRegex = /\b(?:kick|remove|boot)\s+(?:@)?(\w+)\b/i;
    const banRegex = /\b(?:ban|block)\s+(?:@)?(\w+)\b/i;
    const muteRegex = /\b(?:mute|silence)\s+(?:@)?(\w+)\b/i;

    const kickMatch = commandText.match(kickRegex);
    const banMatch = commandText.match(banRegex);
    const muteMatch = commandText.match(muteRegex);

    if (kickMatch) {
      const username = kickMatch[1].replace(/^@/, '');
      return {
        text: `Processing kick request for user @${username}`,
        action: 'kick_user',
        parameters: {
          user: username,
          reason: 'Requested via command'
        }
      };
    }
    
    if (banMatch) {
      const username = banMatch[1].replace(/^@/, '');
      return {
        text: `Processing ban request for user @${username}`,
        action: 'ban_user',
        parameters: {
          user: username,
          reason: 'Requested via command'
        }
      };
    }
    
    if (muteMatch) {
      const username = muteMatch[1].replace(/^@/, '');
      return {
        text: `Processing mute request for user @${username}`,
        action: 'mute_user',
        parameters: {
          user: username,
          duration: 60, // Default 60 minutes
          reason: 'Requested via command'
        }
      };
    }

    // Check for education commands with pattern matching
    const quizRegex = /\b(?:start|take|begin|create|do)\s+(?:a\s+)?(?:quiz|test)(?:\s+(?:about|on)\s+)?([a-zA-Z0-9 ]+)?/i;
    const progressRegex = /\b(?:check|show|view|get)(?:\s+my)?\s+(?:progress|stats|achievements|learning)/i;
    
    const quizMatch = commandText.match(quizRegex);
    const progressMatch = progressRegex.test(commandText);
    
    if (quizMatch) {
      const topic = quizMatch[1]?.trim() || 'blockchain';
      return {
        text: `Starting a quiz on ${topic}`,
        action: 'start_quiz',
        parameters: {
          topic: topic
        }
      };
    }
    
    if (progressMatch) {
      return {
        text: 'Checking your educational progress',
        action: 'check_progress',
        parameters: {}
      };
    }
    
    // Check for support commands with pattern matching
    const checkTierRegex = /\b(?:check|show|view|get)(?:\s+my)?\s+(?:support|tier|subscription)/i;
    const upgradeTierRegex = /\b(?:upgrade|subscribe)(?:\s+to)?(?:\s+the)?(?:\s+(?:support|tier))?(?:\s+(?:level|plan))?\s+([a-zA-Z]+)/i;
    
    const checkTierMatch = checkTierRegex.test(commandText);
    const upgradeTierMatch = commandText.match(upgradeTierRegex);
    
    if (checkTierMatch) {
      return {
        text: 'Checking your support tier',
        action: 'check_support',
        parameters: {}
      };
    }
    
    if (upgradeTierMatch) {
      const targetTier = upgradeTierMatch[1]?.trim().toLowerCase() || 'standard';
      return {
        text: `Processing upgrade request to ${targetTier} tier`,
        action: 'upgrade_support',
        parameters: {
          target_tier: targetTier
        }
      };
    }

    // Define available actions for the JSON response prompt
    const availableActions = [
      'create_did', 'issue_credential', 'verify_credential', 'check_support',
      'upgrade_support', 'start_quiz', 'check_progress', 'make_moderator',
      'remove_moderator', 'ban_user', 'unban_user', 'kick_user', 'mute_user',
      'unmute_user', 'restrict_user', 'my_dids', 'blockchain_query',
      'enable_antispam', 'disable_antispam', 'set_permissions', 'revoke_credential',
      'register_issuer', 'check_registry', 'help', 'status', 'list_credentials',
      'analyze_image', 'generate_image', 'web_search', 'unknown'
    ];

    // Create a prompt using the system prompts module
    const systemPromptOptions = {
      availableActions
    };
    
    // Get JSON response formatted system prompt
    const systemPromptText = systemPrompts.getJSONResponsePrompt(systemPromptOptions);

    // Construct conversation history messages for context-aware processing
    let messages = [
      { role: 'system', content: systemPromptText }
    ];
    
    // Add conversation history if available
    if (conversationHistory.length > 0) {
      // Include a summary of context at the beginning
      const contextSummary = `The user has an ongoing conversation with the following context: ${
        conversationHistory.map(msg => `${msg.role}: "${msg.content.substring(0, 50)}..."`).join(', ')
      }`;
      
      messages.push({ role: 'system', content: contextSummary });
      
      // Add the actual history messages (limited to last 5 for processing efficiency)
      messages.push(...conversationHistory.slice(-5));
    }
    
    // Add the current command
    messages.push({ role: 'user', content: commandText });

    // Get a response from Grok
    const aiResponse = await grokService.client.chat.completions.create({
      model: grokService.defaultModel,
      messages: messages,
      response_format: { type: 'json_object' },
      temperature: 0.2, // Lower temperature for more consistent intent recognition
      max_tokens: 500
    });
    
    // Extract and parse the response
    const responseText = aiResponse.choices[0].message.content;
    let parsedResponse;
    
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (error) {
      logger.error('Failed to parse JSON response', { error: error.message, response: responseText });
      return {
        text: "I'm having trouble understanding that command. Could you try rephrasing it?",
        action: null,
        parameters: {}
      };
    }
    
    // Enhanced parameter extraction for all action types
    if (parsedResponse.action) {
      // Handle missing parameters for different action types
      if (['kick_user', 'ban_user', 'mute_user'].includes(parsedResponse.action) && !parsedResponse.parameters?.user) {
        // Try to extract a username for moderation actions
        const words = commandText.match(/\b\w+\b/g);
        if (words && words.length > 1) {
          // Get last word that's not a moderation action as potential username
          const potentialUsername = words.filter(word => 
            !['kick', 'ban', 'mute', 'remove'].includes(word.toLowerCase())
          ).pop();
          
          if (potentialUsername) {
            parsedResponse.parameters = parsedResponse.parameters || {};
            parsedResponse.parameters.user = potentialUsername;
            logger.info('Added missing user parameter', { user: potentialUsername });
          }
        }
      } else if (['start_quiz', 'learn_topic'].includes(parsedResponse.action) && !parsedResponse.parameters?.topic) {
        // Set default topic for education actions
        parsedResponse.parameters = parsedResponse.parameters || {};
        parsedResponse.parameters.topic = 'blockchain';
        logger.info('Set default topic for education action');
      } else if ('upgrade_support' === parsedResponse.action && !parsedResponse.parameters?.target_tier) {
        // Set default tier for support actions
        parsedResponse.parameters = parsedResponse.parameters || {};
        parsedResponse.parameters.target_tier = 'standard';
        logger.info('Set default tier level for support action');
      }
      
      // Try to infer missing parameters from conversation history
      if (conversationHistory.length > 0 && Object.keys(parsedResponse.parameters || {}).length === 0) {
        // Look through context for potential parameter values
        for (const msg of conversationHistory) {
          if (msg.role === 'user') {
            // For educational context
            if (['start_quiz', 'learn_topic'].includes(parsedResponse.action)) {
              const topicMatch = msg.content.match(/\b(?:about|on|topic)\s+([a-zA-Z0-9 ]+)/i);
              if (topicMatch) {
                parsedResponse.parameters = parsedResponse.parameters || {};
                parsedResponse.parameters.topic = topicMatch[1].trim();
                logger.info('Inferred topic from conversation history', { topic: parsedResponse.parameters.topic });
                break;
              }
            }
            
            // For support context
            if ('upgrade_support' === parsedResponse.action) {
              const tierMatch = msg.content.match(/\b(?:premium|standard|basic|enterprise)\b/i);
              if (tierMatch) {
                parsedResponse.parameters = parsedResponse.parameters || {};
                parsedResponse.parameters.target_tier = tierMatch[0].toLowerCase();
                logger.info('Inferred tier from conversation history', { tier: parsedResponse.parameters.target_tier });
                break;
              }
            }
          }
        }
      }
    }
    
    // Track token usage
    if (context.user && context.user.id) {
      const tokensUsed = aiResponse.usage.total_tokens;
      await supportCredentialService.trackTokenUsage(context.user.id, tokensUsed);
      
      // Store this command and response in conversation context
      if (conversationHistory.length > 0) {
        grokService.updateConversationContext(context.user.id, context.chat?.id, {
          role: 'user',
          content: commandText
        });
        
        grokService.updateConversationContext(context.user.id, context.chat?.id, {
          role: 'assistant',
          content: parsedResponse.interpretation || 'Command processed'
        });
      }
    }
    
    return {
      text: parsedResponse.interpretation,
      action: parsedResponse.action,
      parameters: parsedResponse.parameters
    };
  } catch (error) {
    logger.error('Error processing natural language command', { 
      error: error.message,
      commandText
    });
    
    return {
      text: "I'm having trouble understanding that command. Could you try rephrasing it?",
      action: null,
      parameters: {}
    };
  }
}

/**
 * Execute a command action
 * @param {Object} ctx - Telegram context
 * @param {String} action - Action to execute
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of the action
 * @private
 */
async function executeCommandAction(ctx, action, parameters) {
  try {
    logger.info('Executing command action', { action, parameters });
    
    switch (action) {
      case 'create_did':
        return await handleCreateDid(ctx, parameters);
        
      case 'issue_credential':
        return await handleIssueCredential(ctx, parameters);
        
      case 'verify_credential':
        return await handleVerifyCredential(ctx, parameters);
        
      case 'check_support':
        return await handleCheckSupport(ctx, parameters);
        
      case 'upgrade_support':
        return await handleUpgradeSupport(ctx, parameters);
        
      case 'start_quiz':
        return await handleStartQuiz(ctx, parameters);
        
      case 'check_progress':
        return await handleCheckProgress(ctx, parameters);
        
      case 'make_moderator':
        return await handleMakeModerator(ctx, parameters);
        
      case 'remove_moderator':
        return await handleRemoveModerator(ctx, parameters);
        
      case 'ban_user':
        return await handleBanUser(ctx, parameters);
        
      case 'unban_user':
        return await handleUnbanUser(ctx, parameters);
        
      case 'kick_user':
        return await handleKickUser(ctx, parameters);
        
      case 'my_dids':
        return await handleMyDids(ctx, parameters);
        
      case 'revoke_credential':
        return await handleRevokeCredential(ctx, parameters);
        
      case 'register_issuer':
        return await handleRegisterIssuer(ctx, parameters);
        
      case 'check_registry':
        return await handleCheckRegistry(ctx, parameters);
        
      case 'help':
        return await handleHelpCommand(ctx);
        
      case 'status':
        return await handleStatusCommand(ctx);
        
      case 'list_credentials':
        return await handleListCredentials(ctx, parameters);
        
      case 'mute_user':
        return await handleMuteUser(ctx, parameters);
        
      case 'unmute_user':
        return await handleUnmuteUser(ctx, parameters);
        
      case 'restrict_user':
        return await handleRestrictUser(ctx, parameters);
        
      case 'enable_antispam':
        return await handleEnableAntispam(ctx, parameters);
        
      case 'disable_antispam':
        return await handleDisableAntispam(ctx, parameters);
        
      case 'set_permissions':
        return await handleSetPermissions(ctx, parameters);
        
      case 'analyze_image':
        return await handleAnalyzeImage(ctx, parameters);
        
      case 'generate_image':
        return await handleGenerateImage(ctx, parameters);
        
      case 'web_search':
        return await handleWebSearch(ctx, parameters);
        
      case 'blockchain_query':
        return await handleBlockchainQuery(ctx, parameters.query, parameters.txHash);
        
      case 'unknown':
      default:
        return ctx.reply("I'm not sure how to handle that command. Try using one of my specific commands like /help, /quiz, or /support.");
    }
  } catch (error) {
    logger.error('Error executing command action', { 
      error: error.message,
      action,
      parameters
    });
    
    return ctx.reply('Sorry, there was an error executing that command.');
  }
}

/**
 * Handle blockchain query
 * @param {Object} ctx - Telegram context
 * @param {String} query - Query text
 * @param {String} txHash - Transaction hash
 * @returns {Promise<Object>} - Query result
 * @private
 */
async function handleBlockchainQuery(ctx, query, txHash) {
  try {
    // This is a placeholder for blockchain query handler
    // In a real implementation, this would interact with a blockchain node or API
    
    await ctx.reply(`I'm analyzing the transaction ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 10)}`);
    
    // Simulate some time for "analysis"
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // For now, just return a mock response
    return ctx.reply(
      `Transaction Analysis:\n\n` +
      `Hash: ${txHash.substring(0, 8)}...${txHash.substring(txHash.length - 8)}\n` +
      `Status: Confirmed (Block #1234567)\n` +
      `Type: Token Transfer\n` +
      `Amount: 100 CHEQ\n` +
      `Fee: 0.001 CHEQ\n` +
      `Time: ${new Date().toISOString()}\n\n` +
      `Note: This is a mock response for demonstration purposes.`
    );
  } catch (error) {
    logger.error('Error handling blockchain query', { 
      error: error.message,
      query,
      txHash
    });
    
    return ctx.reply('Sorry, there was an error processing the blockchain query.');
  }
}

/**
 * Handle status command
 * @param {Object} ctx - Telegram context
 */
async function handleStatusCommand(ctx) {
  try {
    // Record stat
    await sqliteService.recordStat('command', 'status');
    
    // Get bot info
    const botUsername = await sqliteService.getSetting('bot_username');
    
    // Get database stats
    const userCount = await sqliteService.db.get('SELECT COUNT(*) as count FROM users');
    const messageCount = await sqliteService.db.get('SELECT COUNT(*) as count FROM messages');
    const credentialCount = await sqliteService.db.get('SELECT COUNT(*) as count FROM credentials');
    
    // Get uptime
    const botStartTime = await sqliteService.getSetting('bot_start_time');
    const uptimeMs = botStartTime ? Date.now() - parseInt(botStartTime, 10) : 0;
    const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    
    return ctx.reply(
      `Dail Bot Status:\n\n` +
      `Username: @${botUsername}\n` +
      `Uptime: ${uptimeHours}h ${uptimeMinutes}m\n\n` +
      `Database Stats:\n` +
      `• Users: ${userCount.count}\n` +
      `• Messages: ${messageCount.count}\n` +
      `• Credentials: ${credentialCount.count}\n\n` +
      `Services:\n` +
      `• Database: ✅ Online\n` +
      `• Cheqd: ${cheqdService.useMock ? '⚠️ Mock Mode' : '✅ Online'}\n` +
      `• Grok AI: ${grokService.useMock ? '⚠️ Mock Mode' : '✅ Online'}`
    );
  } catch (error) {
    logger.error('Error handling status command', { error: error.message });
    return ctx.reply('Sorry, there was an error checking the bot status.');
  }
}

/**
 * Handle quiz command
 * @param {Object} ctx - Telegram context
 */
async function handleQuizCommand(ctx) {
  try {
    // Record stat
    await sqliteService.recordStat('command', 'quiz');
    
    // Check if in a private chat
    if (ctx.chat.type !== 'private') {
      return ctx.reply('Please use the quiz command in a private chat with the bot.');
    }
    
    // Get available quiz topics
    const topics = await educationalCredentialService.getAvailableQuizTopics();
    
    if (!topics || topics.length === 0) {
      return ctx.reply('No quiz topics are currently available. Please try again later.');
    }
    
    // Create inline keyboard with topics
    const keyboard = {
      inline_keyboard: topics.map(topic => [
        { text: topic.name, callback_data: `quiz:start:${topic.id}` }
      ])
    };
    
    return ctx.reply(
      'Please select a quiz topic:',
      { reply_markup: keyboard }
    );
  } catch (error) {
    logger.error('Error handling quiz command', { error: error.message });
    return ctx.reply('Sorry, there was an error starting the quiz.');
  }
}

/**
 * Handle progress command
 * @param {Object} ctx - Telegram context
 */
async function handleProgressCommand(ctx) {
  try {
    // Record stat
    await sqliteService.recordStat('command', 'progress');
    
    // Get user progress
    const userId = ctx.from.id;
    const progress = await educationalCredentialService.getUserProgress(userId);
    
    if (!progress || Object.keys(progress).length === 0) {
      return ctx.reply(
        "You haven't completed any educational activities yet. " +
        "Try using the /quiz command to start learning!"
      );
    }
    
    // Format progress report
    let progressReport = 'Your Educational Progress:\n\n';
    
    if (progress.quizzes) {
      progressReport += 'Quizzes Completed:\n';
      
      for (const [topic, results] of Object.entries(progress.quizzes)) {
        const passCount = results.filter(r => r.passed).length;
        const totalCount = results.length;
        const avgScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / totalCount);
        
        progressReport += `• ${topic}: ${passCount}/${totalCount} passed (avg: ${avgScore}%)\n`;
      }
      
      progressReport += '\n';
    }
    
    if (progress.credentials) {
      progressReport += 'Credentials Earned:\n';
      
      for (const credential of progress.credentials) {
        progressReport += `• ${credential.type} (${new Date(credential.issuedAt).toLocaleDateString()})\n`;
      }
      
      progressReport += '\n';
    }
    
    // Add recommendations
    progressReport += 'Recommendations:\n';
    
    if (progress.recommendations && progress.recommendations.length > 0) {
      for (const recommendation of progress.recommendations) {
        progressReport += `• ${recommendation}\n`;
      }
    } else {
      progressReport += '• Try more quizzes to get personalized recommendations';
    }
    
    return ctx.reply(progressReport);
  } catch (error) {
    logger.error('Error handling progress command', { error: error.message });
    return ctx.reply('Sorry, there was an error retrieving your progress.');
  }
}

/**
 * Handle support command
 * @param {Object} ctx - Telegram context
 */
async function handleSupportCommand(ctx) {
  try {
    // Record stat
    await sqliteService.recordStat('command', 'support');
    
    // Get user support tier
    const userId = ctx.from.id;
    const supportTier = await supportCredentialService.getUserSupportTier(userId);
    const tokenUsage = await supportCredentialService.getUserTokenUsage(userId);
    
    // Format support info
    let supportInfo = `Support Information:\n\n`;
    supportInfo += `Current Tier: ${supportTier.toUpperCase()}\n\n`;
    
    supportInfo += `Token Usage:\n`;
    supportInfo += `• Used: ${tokenUsage.tokensUsed}\n`;
    supportInfo += `• Remaining: ${tokenUsage.remaining}\n`;
    supportInfo += `• Reset Date: ${tokenUsage.resetDate}\n\n`;
    
    supportInfo += `Tier Benefits:\n`;
    
    switch (supportTier.toLowerCase()) {
      case 'premium':
        supportInfo += `• Priority Response\n`;
        supportInfo += `• Enhanced Token Limit\n`;
        supportInfo += `• Advanced Analytics\n`;
        supportInfo += `• Custom Credential Types\n`;
        break;
        
      case 'standard':
        supportInfo += `• Faster Response Time\n`;
        supportInfo += `• Increased Token Limit\n`;
        supportInfo += `• Basic Analytics\n`;
        break;
        
      case 'basic':
      default:
        supportInfo += `• Standard Response Time\n`;
        supportInfo += `• Basic Token Limit\n`;
        supportInfo += `• Consider upgrading for additional benefits\n`;
        break;
    }
    
    // Add upgrade info if not premium
    if (supportTier.toLowerCase() !== 'premium') {
      supportInfo += `\nTo upgrade your support tier, use the /upgrade_support command.`;
    }
    
    return ctx.reply(supportInfo);
  } catch (error) {
    logger.error('Error handling support command', { error: error.message });
    return ctx.reply('Sorry, there was an error retrieving your support information.');
  }
}

/**
 * Handle moderator command
 * @param {Object} ctx - Telegram context
 */
async function handleModeratorCommand(ctx) {
  try {
    // Record stat
    await sqliteService.recordStat('command', 'mod');
    
    // Parse command arguments
    const messageText = ctx.message.text;
    const args = messageText.substring(4).trim().split(' ');
    const subCommand = args[0]?.toLowerCase();
    
    // Check if user is a moderator
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const isModerator = await moderationCredentialService.isUserModerator(userId, chatId);
    
    if (!isModerator) {
      return ctx.reply('You do not have moderator privileges in this chat.');
    }
    
    // Handle specific subcommands
    if (subCommand) {
      // Process subcommand
      switch (subCommand) {
        case 'ban':
          // Get username and reason
          if (args.length < 2) {
            return ctx.reply('Usage: /mod ban @username [reason]');
          }
          
          const banUsername = args[1].replace('@', '');
          const banReason = args.slice(2).join(' ') || 'No reason provided';
          
          // Create parameters object and call the handler
          return await handleBanUser(ctx, { user: banUsername, reason: banReason });
          
        case 'unban':
          // Get username
          if (args.length < 2) {
            return ctx.reply('Usage: /mod unban @username');
          }
          
          const unbanUsername = args[1].replace('@', '');
          
          // Create parameters object and call the handler
          return await handleUnbanUser(ctx, { user: unbanUsername });
          
        case 'kick':
          // Get username and reason
          if (args.length < 2) {
            return ctx.reply('Usage: /mod kick @username [reason]');
          }
          
          const kickUsername = args[1].replace('@', '');
          const kickReason = args.slice(2).join(' ') || 'No reason provided';
          
          // Create parameters object and call the handler
          return await handleKickUser(ctx, { user: kickUsername, reason: kickReason });

        case 'add':
          // Get username and level
          if (args.length < 2) {
            return ctx.reply('Usage: /mod add @username [level]');
          }
          
          const modUsername = args[1].replace('@', '');
          const modLevel = args.length > 2 ? args[2].toLowerCase() : 'basic';
          
          // Validate level
          if (modLevel && !['basic', 'full', 'admin'].includes(modLevel)) {
            return ctx.reply('Invalid moderator level. Available levels: basic, full, admin');
          }
          
          // Create parameters object and call the handler
          return await handleMakeModerator(ctx, { user: modUsername, level: modLevel });
          
        case 'remove':
          // Get username
          if (args.length < 2) {
            return ctx.reply('Usage: /mod remove @username');
          }
          
          const removeUsername = args[1].replace('@', '');
          
          // Create parameters object and call the handler
          return await handleRemoveModerator(ctx, { user: removeUsername });
      }
    }
    
    // If no subcommand or subcommand not recognized, show mod info
    
    // Get moderator info
    const modInfo = await moderationCredentialService.getModeratorInfo(userId, chatId);
    
    // Format moderator info
    let modInfoText = `Moderator Information:\n\n`;
    modInfoText += `Status: ${modInfo.active ? 'Active' : 'Inactive'}\n`;
    modInfoText += `Level: ${modInfo.level}\n`;
    modInfoText += `Since: ${new Date(modInfo.since).toLocaleDateString()}\n\n`;
    
    modInfoText += `Permissions:\n`;
    
    for (const [perm, enabled] of Object.entries(modInfo.permissions)) {
      modInfoText += `• ${perm}: ${enabled ? '✅' : '❌'}\n`;
    }
    
    // Add moderator actions if in a group chat
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Ban User', callback_data: 'mod:ban_user' },
            { text: 'Unban User', callback_data: 'mod:unban_user' }
          ],
          [
            { text: 'Kick User', callback_data: 'mod:kick_user' },
            { text: 'Mute User', callback_data: 'mod:mute_user' }
          ],
          [
            { text: 'Unmute User', callback_data: 'mod:unmute_user' },
            { text: 'Add Moderator', callback_data: 'mod:add_mod' }
          ],
          [
            { text: 'Remove Moderator', callback_data: 'mod:remove_mod' }
          ]
        ]
      };
      
      return ctx.reply(modInfoText, { reply_markup: keyboard });
    } else {
      return ctx.reply(modInfoText);
    }
  } catch (error) {
    logger.error('Error handling moderator command', { error: error.message });
    return ctx.reply('Sorry, there was an error retrieving moderator information.');
  }
}

/**
 * Handle verify command
 * @param {Object} ctx - Telegram context
 */
async function handleVerifyCommand(ctx) {
  try {
    // Record stat
    await sqliteService.recordStat('command', 'verify');
    
    // Check for credential ID in command
    const commandText = ctx.message.text.substring(8).trim();
    
    if (!commandText) {
      return ctx.reply(
        'Please provide a credential ID to verify. For example:\n' +
        '/verify vc:cheqd:123456789abcdef'
      );
    }
    
    // Show typing indicator
    await ctx.replyWithChatAction('typing');
    
    // Verify the credential
    const verificationResult = await cheqdService.verifyCredential(commandText);
    
    if (!verificationResult.verified) {
      return ctx.reply(
        `❌ Credential Verification Failed\n\n` +
        `Reason: ${verificationResult.error || 'Unknown error'}`
      );
    }
    
    // Format verification result
    const credential = verificationResult.credential;
    
    let verificationText = `✅ Credential Verified\n\n`;
    verificationText += `Type: ${credential.type}\n`;
    verificationText += `Issuer: ${credential.issuer}\n`;
    verificationText += `Holder: ${credential.holder}\n`;
    verificationText += `Issued: ${new Date(credential.issued_at).toLocaleDateString()}\n`;
    
    if (credential.expires_at) {
      verificationText += `Expires: ${new Date(credential.expires_at).toLocaleDateString()}\n`;
    }
    
    // Add data fields
    if (credential.data) {
      verificationText += `\nData:\n`;
      
      for (const [key, value] of Object.entries(credential.data)) {
        if (typeof value !== 'object') {
          verificationText += `• ${key}: ${value}\n`;
        }
      }
    }
    
    return ctx.reply(verificationText);
  } catch (error) {
    logger.error('Error handling verify command', { error: error.message });
    return ctx.reply('Sorry, there was an error verifying the credential.');
  }
}

/**
 * Handle DID command
 * @param {Object} ctx - Telegram context
 */
async function handleDIDCommand(ctx) {
  try {
    // Record stat
    await sqliteService.recordStat('command', 'did');
    
    // Parse command arguments
    const args = ctx.message.text.substring(5).trim().split(' ');
    const subCommand = args[0]?.toLowerCase();
    
    // Get user ID
    const userId = ctx.from.id;
    
    // Handle subcommands
    switch (subCommand) {
      case 'create':
        // Create a new DID
        const newDid = await cheqdService.createDid(userId);
        
        return ctx.reply(
          `✅ Created new DID:\n${newDid}\n\n` +
          `This DID can be used for credential issuance and verification.`
        );
        
      case 'list':
        // List user's DIDs
        const dids = await cheqdService.getUserDids(userId);
        
        if (!dids || dids.length === 0) {
          return ctx.reply(
            `You don't have any DIDs yet. Use /did create to create one.`
          );
        }
        
        let didListText = `Your DIDs:\n\n`;
        
        for (const did of dids) {
          didListText += `• ${did.did}\n`;
          
          if (did.method) {
            didListText += `  Method: ${did.method}\n`;
          }
          
          if (did.created_at) {
            didListText += `  Created: ${new Date(did.created_at).toLocaleDateString()}\n`;
          }
          
          didListText += `\n`;
        }
        
        return ctx.reply(didListText);
        
      default:
        // Show help text
        return ctx.reply(
          `DID Management Commands:\n\n` +
          `/did create - Create a new DID\n` +
          `/did list - List your DIDs`
        );
    }
  } catch (error) {
    logger.error('Error handling DID command', { error: error.message });
    return ctx.reply('Sorry, there was an error managing your DIDs.');
  }
}

/**
 * Handle credential command
 * @param {Object} ctx - Telegram context
 */
async function handleCredentialCommand(ctx) {
  try {
    // Record stat
    await sqliteService.recordStat('command', 'credential');
    
    // Parse command arguments
    const args = ctx.message.text.substring(12).trim().split(' ');
    const subCommand = args[0]?.toLowerCase();
    
    // Get user ID and DIDs
    const userId = ctx.from.id;
    const userDids = await cheqdService.getUserDids(userId);
    
    if (!userDids || userDids.length === 0) {
      return ctx.reply(
        `You don't have any DIDs yet. Use /did create to create one first.`
      );
    }
    
    // Handle subcommands
    switch (subCommand) {
      case 'list':
        // Get credential type filter
        const typeFilter = args[1];
        const options = typeFilter ? { type: typeFilter } : {};
        
        // Get credentials for the first DID
        const holderDid = userDids[0].did;
        const credentials = await cheqdService.getHolderCredentials(holderDid, options);
        
        if (!credentials || credentials.length === 0) {
          return ctx.reply(
            `You don't have any${typeFilter ? ` ${typeFilter}` : ''} credentials yet.`
          );
        }
        
        let credListText = `Your${typeFilter ? ` ${typeFilter}` : ''} Credentials:\n\n`;
        
        for (const cred of credentials) {
          credListText += `• ID: ${cred.id}\n`;
          credListText += `  Type: ${cred.type}\n`;
          credListText += `  Issuer: ${cred.issuer.substring(0, 10)}...${cred.issuer.substring(cred.issuer.length - 5)}\n`;
          credListText += `  Issued: ${new Date(cred.issued_at).toLocaleDateString()}\n`;
          
          if (cred.expires_at) {
            const expiryDate = new Date(cred.expires_at);
            const isExpired = expiryDate < new Date();
            
            credListText += `  Expires: ${expiryDate.toLocaleDateString()}${isExpired ? ' (EXPIRED)' : ''}\n`;
          }
          
          credListText += `\n`;
        }
        
        return ctx.reply(credListText);
        
      default:
        // Show help text
        return ctx.reply(
          `Credential Management Commands:\n\n` +
          `/credential list [type] - List your credentials\n`
        );
    }
  } catch (error) {
    logger.error('Error handling credential command', { error: error.message });
    return ctx.reply('Sorry, there was an error managing your credentials.');
  }
}

/**
 * Handle admin command
 * @param {Object} ctx - Telegram context
 */
async function handleAdminCommand(ctx) {
  try {
    // Record stat
    await sqliteService.recordStat('command', 'admin');
    
    // Check if user is an admin
    const userId = ctx.from.id;
    const adminIds = await sqliteService.getSetting('bot_admins');
    const isAdmin = adminIds && adminIds.includes(userId.toString());
    
    if (!isAdmin) {
      return ctx.reply('This command is only available to bot administrators.');
    }
    
    // Parse command arguments
    const args = ctx.message.text.substring(7).trim().split(' ');
    const subCommand = args[0]?.toLowerCase();
    
    // Handle subcommands
    switch (subCommand) {
      case 'stats':
        // Get bot stats
        const botStats = await sqliteService.getStats();
        
        let statsText = `Bot Statistics:\n\n`;
        
        for (const [category, stats] of Object.groupBy(botStats, item => item.category)) {
          statsText += `${category.toUpperCase()}:\n`;
          
          for (const stat of stats) {
            statsText += `• ${stat.action}: ${stat.count}\n`;
          }
          
          statsText += `\n`;
        }
        
        return ctx.reply(statsText);
        
      case 'broadcast':
        // Check for message
        const broadcastMessage = args.slice(1).join(' ');
        
        if (!broadcastMessage) {
          return ctx.reply('Please provide a message to broadcast.');
        }
        
        // Get user count for confirmation
        const userCount = await sqliteService.db.get('SELECT COUNT(*) as count FROM users');
        
        return ctx.reply(
          `Are you sure you want to broadcast this message to ${userCount.count} users?\n\n` +
          `Message: ${broadcastMessage}\n\n` +
          `To confirm, reply with: /admin confirm_broadcast ${broadcastMessage}`
        );
        
      case 'confirm_broadcast':
        // Get message
        const confirmedMessage = args.slice(1).join(' ');
        
        if (!confirmedMessage) {
          return ctx.reply('Please provide a message to broadcast.');
        }
        
        // Send confirmation
        await ctx.reply('Broadcasting message... This may take some time.');
        
        // Simulate broadcast (would normally send to all users)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        return ctx.reply('Message broadcast completed successfully.');
        
      default:
        // Show help text
        return ctx.reply(
          `Admin Commands:\n\n` +
          `/admin stats - View bot statistics\n` +
          `/admin broadcast [message] - Broadcast a message to all users\n`
        );
    }
  } catch (error) {
    logger.error('Error handling admin command', { error: error.message });
    return ctx.reply('Sorry, there was an error processing the admin command.');
  }
}

/**
 * Handle ask command (AI Q&A)
 * @param {Object} ctx - Telegram context
 */
async function handleAskCommand(ctx) {
  try {
    // Extract question
    const question = ctx.message.text.substring(5).trim();
    
    if (!question) {
      return ctx.reply('Please provide a question after /ask. For example: /ask What is a DID?');
    }
    
    // Record stat
    await sqliteService.recordStat('command', 'ask');
    
    // Show typing indicator
    await ctx.replyWithChatAction('typing');
    
    // Get user info for token tracking
    const user = {
      id: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name
    };
    
    // Process with Grok
    const response = await grokService.generateChatResponse(question, user);
    
    // Reply with the answer
    return ctx.reply(response.text);
  } catch (error) {
    logger.error('Error handling ask command', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your question.');
  }
}

// Placeholder handlers for command actions
async function handleCreateDid(ctx, parameters) {
  try {
    // Get user ID
    const userId = ctx.from.id;
    
    // Show typing indicator
    await ctx.replyWithChatAction('typing');
    
    // Create a new DID using the cheqd service
    const newDid = await cheqdService.createDid(userId);
    
    if (!newDid) {
      return ctx.reply('Sorry, there was an error creating your DID. Please try again later.');
    }
    
    // Return success message
    return ctx.reply(
      `✅ Created new DID:\n${newDid}\n\n` +
      `This DID can be used for credential issuance and verification.`
    );
  } catch (error) {
    logger.error('Error creating DID', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error creating your DID. Please try again later.');
  }
}

async function handleIssueCredential(ctx, parameters) {
  return ctx.reply('This will issue a credential.');
}

async function handleVerifyCredential(ctx, parameters) {
  return ctx.reply('This will verify a credential.');
}

async function handleCheckSupport(ctx, parameters) {
  return ctx.reply('This will check your support tier.');
}

async function handleUpgradeSupport(ctx, parameters) {
  return ctx.reply('This will upgrade your support tier.');
}

async function handleStartQuiz(ctx, parameters) {
  return ctx.reply('This will start a quiz.');
}

async function handleCheckProgress(ctx, parameters) {
  return ctx.reply('This will check your progress.');
}

async function handleMakeModerator(ctx, parameters) {
  try {
    if (!parameters || !parameters.user) {
      return ctx.reply('Please specify a user to make moderator.');
    }
    
    const username = parameters.user.replace('@', '');
    const level = parameters.level || 'basic'; // Default to basic level if not specified
    const chatId = ctx.chat.id;
    const adminId = ctx.from.id;
    
    logger.info(`Processing make moderator request for user: ${username}`, {
      chatId,
      requestedBy: adminId,
      level
    });
    
    // Check if user has admin rights or is already a high-level moderator
    const isAdmin = await telegramService._isUserAdmin(adminId, chatId);
    const isModerator = await moderationCredentialService.isUserModerator(adminId, chatId);
    const verificationResult = await moderationCredentialService.verifyModerationAuthority(
      adminId, 'add_moderator', chatId
    );
    
    if (!isAdmin && (!isModerator || !verificationResult.verified)) {
      logger.warn('User lacks permission to make moderator', { adminId, chatId });
      return ctx.reply('You do not have permission to make users moderators in this chat. Only admins and authorized moderators can perform this action.');
    }
    
    // Enhanced robust user lookup method
    let targetUser = null;
    
    // Method 1: Try from userMap (fast, but only works for users who sent messages)
    const userMap = Array.from(telegramService.userMap.values());
    targetUser = userMap.find(u => u.username?.toLowerCase() === username.toLowerCase());
    
    // Method 2: Direct getChatMember call (works for any chat member)
    if (!targetUser) {
      try {
        // Try with exact username format
        logger.info('Attempting direct getChatMember lookup', { username, chatId });
        const chatMember = await ctx.telegram.getChatMember(chatId, `@${username}`);
        if (chatMember && chatMember.user) {
          targetUser = chatMember.user;
          logger.info('Found user through direct getChatMember with @', { username, userId: targetUser.id });
        }
      } catch (err) {
        logger.warn('Failed to find user through direct getChatMember with @', { username, error: err.message });
        
        // Try without @ prefix
        try {
          const chatMember = await ctx.telegram.getChatMember(chatId, username);
          if (chatMember && chatMember.user) {
            targetUser = chatMember.user;
            logger.info('Found user through direct getChatMember without @', { username, userId: targetUser.id });
          }
        } catch (innerErr) {
          logger.warn('Failed to find user through direct getChatMember without @', { username, error: innerErr.message });
        }
      }
    }
    
    // Method 3: Try to find the user in admins list
    if (!targetUser) {
      try {
        const admins = await ctx.telegram.getChatAdministrators(chatId);
        if (admins && admins.length > 0) {
          const matchingAdmin = admins.find(admin => 
            admin.user.username?.toLowerCase() === username.toLowerCase());
          
          if (matchingAdmin) {
            targetUser = matchingAdmin.user;
            logger.info('Found user in administrators list', { username, userId: targetUser.id });
          }
        }
      } catch (listErr) {
        logger.warn('Failed to find user in administrators list', { username, error: listErr.message });
      }
    }
    
    // Method 4: Try alternative approaches with different username formats
    if (!targetUser) {
      const attempts = [
        // Try with lower case
        async () => {
          const member = await ctx.telegram.getChatMember(chatId, username.toLowerCase());
          return member?.user;
        },
        // Try with string ID if numeric
        async () => {
          if (/^\d+$/.test(username)) {
            const member = await ctx.telegram.getChatMember(chatId, username);
            return member?.user;
          }
          return null;
        }
      ];
      
      for (const attempt of attempts) {
        try {
          const user = await attempt();
          if (user) {
            targetUser = user;
            logger.info('Found user through alternative method', { username, userId: user.id });
            break;
          }
        } catch (e) {
          // Continue to next attempt
        }
      }
    }
    
    if (!targetUser) {
      logger.error('User not found for making moderator', { username, chatId });
      return ctx.reply(
        'User not found. Make sure the username is correct and they have sent a message in this chat before.'
      );
    }
    
    // Map level parameter to role
    let role;
    switch (level.toLowerCase()) {
      case 'admin':
        role = 'GroupAdmin';
        break;
      case 'full':
        role = 'SeniorModerator';
        break;
      default:
        role = 'CommunityModerator';
    }
    
    // Prepare user objects
    const issuer = { id: adminId, username: ctx.from.username, first_name: ctx.from.first_name };
    const recipient = { id: targetUser.id, username: targetUser.username, first_name: targetUser.first_name };
    const chat = { id: chatId, title: ctx.chat.title };
    
    logger.info('Making user a moderator', { 
      issuer: issuer.username,
      recipient: recipient.username, 
      role 
    });
    
    // Issue moderation credential
    const result = await moderationCredentialService.issueModerationCredential(
      issuer,
      recipient,
      role,
      chat
    );
    
    if (!result) {
      logger.error('Failed to issue moderation credential', { username });
      return ctx.reply('Failed to make user a moderator. Please try again later.');
    }
    
    // Record the action
    await moderationService.executeAction('add_moderator', issuer, recipient, chat, { role });
    
    logger.info('Successfully made user a moderator', { username, chatId, role });
    return ctx.reply(`@${username} has been made a ${role} in this chat.`);
  } catch (error) {
    logger.error('Error making user a moderator', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error making the user a moderator. Please try again or contact an administrator.');
  }
}

async function handleRemoveModerator(ctx, parameters) {
  try {
    if (!parameters || !parameters.user) {
      return ctx.reply('Please specify a user to remove moderator status from.');
    }
    
    const username = parameters.user.replace('@', '');
    const chatId = ctx.chat.id;
    const adminId = ctx.from.id;
    
    logger.info(`Processing remove moderator request for user: ${username}`, {
      chatId,
      requestedBy: adminId
    });
    
    // Check if user has admin rights or is already a high-level moderator
    const isAdmin = await telegramService._isUserAdmin(adminId, chatId);
    const isModerator = await moderationCredentialService.isUserModerator(adminId, chatId);
    const verificationResult = await moderationCredentialService.verifyModerationAuthority(
      adminId, 'remove_mod', chatId
    );
    
    if (!isAdmin && (!isModerator || !verificationResult.verified)) {
      logger.warn('User lacks permission to remove moderator', { adminId, chatId });
      return ctx.reply('You do not have permission to remove moderator status in this chat. Only admins and authorized moderators can perform this action.');
    }
    
    // Enhanced robust user lookup method
    let targetUser = null;
    
    // Method 1: Try from userMap (fast, but only works for users who sent messages)
    const userMap = Array.from(telegramService.userMap.values());
    targetUser = userMap.find(u => u.username?.toLowerCase() === username.toLowerCase());
    
    // Method 2: Direct getChatMember call (works for any chat member)
    if (!targetUser) {
      try {
        // Try with exact username format
        logger.info('Attempting direct getChatMember lookup', { username, chatId });
        const chatMember = await ctx.telegram.getChatMember(chatId, `@${username}`);
        if (chatMember && chatMember.user) {
          targetUser = chatMember.user;
          logger.info('Found user through direct getChatMember with @', { username, userId: targetUser.id });
        }
      } catch (err) {
        logger.warn('Failed to find user through direct getChatMember with @', { username, error: err.message });
        
        // Try without @ prefix
        try {
          const chatMember = await ctx.telegram.getChatMember(chatId, username);
          if (chatMember && chatMember.user) {
            targetUser = chatMember.user;
            logger.info('Found user through direct getChatMember without @', { username, userId: targetUser.id });
          }
        } catch (innerErr) {
          logger.warn('Failed to find user through direct getChatMember without @', { username, error: innerErr.message });
        }
      }
    }
    
    // Method 3: Try to find the user in admins list
    if (!targetUser) {
      try {
        const admins = await ctx.telegram.getChatAdministrators(chatId);
        if (admins && admins.length > 0) {
          const matchingAdmin = admins.find(admin => 
            admin.user.username?.toLowerCase() === username.toLowerCase());
          
          if (matchingAdmin) {
            targetUser = matchingAdmin.user;
            logger.info('Found user in administrators list', { username, userId: targetUser.id });
          }
        }
      } catch (listErr) {
        logger.warn('Failed to find user in administrators list', { username, error: listErr.message });
      }
    }
    
    // Method 4: Try alternative approaches with different username formats
    if (!targetUser) {
      const attempts = [
        // Try with lower case
        async () => {
          const member = await ctx.telegram.getChatMember(chatId, username.toLowerCase());
          return member?.user;
        },
        // Try with string ID if numeric
        async () => {
          if (/^\d+$/.test(username)) {
            const member = await ctx.telegram.getChatMember(chatId, username);
            return member?.user;
          }
          return null;
        }
      ];
      
      for (const attempt of attempts) {
        try {
          const user = await attempt();
          if (user) {
            targetUser = user;
            logger.info('Found user through alternative method', { username, userId: user.id });
            break;
          }
        } catch (e) {
          // Continue to next attempt
        }
      }
    }
    
    if (!targetUser) {
      logger.error('User not found for removing moderator', { username, chatId });
      return ctx.reply(
        'User not found. Make sure the username is correct and they have sent a message in this chat before.'
      );
    }
    
    // Check if target user is actually a moderator
    const isTargetModerator = await moderationCredentialService.isUserModerator(targetUser.id, chatId);
    
    if (!isTargetModerator) {
      return ctx.reply(`@${username} is not a moderator in this chat.`);
    }
    
    // Prepare user objects
    const issuer = { id: adminId, username: ctx.from.username, first_name: ctx.from.first_name };
    const target = { id: targetUser.id, username: targetUser.username, first_name: targetUser.first_name };
    const chat = { id: chatId, title: ctx.chat.title };
    
    logger.info('Removing moderator status', { 
      issuer: issuer.username,
      target: target.username
    });
    
    // Revoke moderation credential
    const result = await moderationCredentialService.revokeModerationCredential(
      issuer,
      target.id,
      chatId,
      'Moderator status removed by admin/moderator'
    );
    
    if (!result) {
      logger.error('Failed to revoke moderation credential', { username });
      return ctx.reply('Failed to remove moderator status. Please try again later.');
    }
    
    // Record the action
    await moderationService.executeAction('remove_mod', issuer, target, chat, {});
    
    logger.info('Successfully removed moderator status', { username, chatId });
    return ctx.reply(`@${username} is no longer a moderator in this chat.`);
  } catch (error) {
    logger.error('Error removing moderator status', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error removing moderator status. Please try again or contact an administrator.');
  }
}

async function handleBanUser(ctx, parameters) {
  try {
    if (!parameters || !parameters.user) {
      return ctx.reply('Please specify a user to ban.');
    }
    
    const reason = parameters.reason || 'No reason provided';
    const username = parameters.user.replace('@', '');
    const chatId = ctx.chat.id;
    const moderatorId = ctx.from.id;
    
    // Check if user is admin or moderator with ban permissions
    const isAdmin = await telegramService._isUserAdmin(moderatorId, chatId);
    const isModerator = await moderationCredentialService.isUserModerator(moderatorId, chatId);
    const verificationResult = await moderationCredentialService.verifyModerationAuthority(
      moderatorId, 'ban', chatId
    );
    
    if (!isAdmin && (!isModerator || !verificationResult.verified)) {
      return ctx.reply('You do not have permission to ban users.');
    }
    
    // Get user ID from username
    const userMap = Array.from(telegramService.userMap.values());
    const targetUser = userMap.find(u => u.username?.toLowerCase() === username.toLowerCase());
    
    if (!targetUser) {
      return ctx.reply(
        'User not found. They must have sent a message in this chat first for me to identify them.'
      );
    }
    
    // Execute the ban action
    const moderator = { id: moderatorId, username: ctx.from.username, first_name: ctx.from.first_name };
    const target = { id: targetUser.id, username: targetUser.username, first_name: targetUser.first_name };
    const chat = { id: chatId, title: ctx.chat.title };
    
    const banResult = await moderationService.executeAction('ban', moderator, target, chat, { reason });
    
    if (!banResult.success) {
      return ctx.reply(`Failed to ban user: ${banResult.message}`);
    }
    
    return ctx.reply(banResult.message);
  } catch (error) {
    logger.error('Error banning user', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error banning the user.');
  }
}

async function handleUnbanUser(ctx, parameters) {
  try {
    if (!parameters || !parameters.user) {
      return ctx.reply('Please specify a user to unban.');
    }
    
    const username = parameters.user.replace('@', '');
    const chatId = ctx.chat.id;
    const moderatorId = ctx.from.id;
    
    // Check if user is admin or moderator with unban permissions
    const isAdmin = await telegramService._isUserAdmin(moderatorId, chatId);
    const isModerator = await moderationCredentialService.isUserModerator(moderatorId, chatId);
    
    if (!isAdmin && !isModerator) {
      return ctx.reply('You do not have permission to unban users.');
    }
    
    // Get user ID from username
    const userMap = Array.from(telegramService.userMap.values());
    const targetUser = userMap.find(u => u.username?.toLowerCase() === username.toLowerCase());
    
    if (!targetUser) {
      return ctx.reply(
        'User not found. They must have sent a message in this chat first for me to identify them.'
      );
    }
    
    // Execute the unban action
    try {
      await telegramService.unbanChatMember(chatId, targetUser.id);
      
      // Update ban in database
      await sqliteService.unbanUser(targetUser.id, chatId);
      
      return ctx.reply(`@${username} has been unbanned.`);
    } catch (unbanError) {
      logger.error('Error unbanning user', { error: unbanError.message });
      return ctx.reply(`Error unbanning user: ${unbanError.message}`);
    }
  } catch (error) {
    logger.error('Error unbanning user', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error unbanning the user.');
  }
}

/**
 * Handle kick user action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleKickUser(ctx, parameters) {
  try {
    if (!parameters || !parameters.user) {
      return ctx.reply('Please specify a user to kick.');
    }
    
    const username = parameters.user.replace('@', '');
    const reason = parameters.reason || 'No reason provided';
    const chatId = ctx.chat.id;
    const moderatorId = ctx.from.id;
    
    logger.info(`Processing kick request for user: ${username}`, {
      chatId,
      requestedBy: moderatorId,
      reason
    });
    
    // Check if user is admin or moderator with kick permissions
    const isAdmin = await telegramService._isUserAdmin(moderatorId, chatId);
    const isModerator = await moderationCredentialService.isUserModerator(moderatorId, chatId);
    const verificationResult = await moderationCredentialService.verifyModerationAuthority(
      moderatorId, 'kick', chatId
    );
    
    if (!isAdmin && (!isModerator || !verificationResult.verified)) {
      logger.warn('User lacks permission to kick', { moderatorId, chatId });
      return ctx.reply('You do not have permission to kick users from this chat. Only admins and authorized moderators can perform this action.');
    }
    
    // Enhanced robust user lookup method
    let targetUser = null;
    
    // Method 1: Try from userMap (fast, but only works for users who sent messages)
    const userMap = Array.from(telegramService.userMap.values());
    targetUser = userMap.find(u => u.username?.toLowerCase() === username.toLowerCase());
    
    // Method 2: Direct getChatMember call (works for any chat member)
    if (!targetUser) {
      try {
        // Try with exact username format
        logger.info('Attempting direct getChatMember lookup', { username, chatId });
        const chatMember = await ctx.telegram.getChatMember(chatId, `@${username}`);
        if (chatMember && chatMember.user) {
          targetUser = chatMember.user;
          logger.info('Found user through direct getChatMember with @', { username, userId: targetUser.id });
        }
      } catch (err) {
        logger.warn('Failed to find user through direct getChatMember with @', { username, error: err.message });
        
        // Try without @ prefix
        try {
          const chatMember = await ctx.telegram.getChatMember(chatId, username);
          if (chatMember && chatMember.user) {
            targetUser = chatMember.user;
            logger.info('Found user through direct getChatMember without @', { username, userId: targetUser.id });
          }
        } catch (innerErr) {
          logger.warn('Failed to find user through direct getChatMember without @', { username, error: innerErr.message });
        }
      }
    }
    
    // Method 3: Try to find the user in admins list
    if (!targetUser) {
      try {
        const admins = await ctx.telegram.getChatAdministrators(chatId);
        if (admins && admins.length > 0) {
          const matchingAdmin = admins.find(admin => 
            admin.user.username?.toLowerCase() === username.toLowerCase());
          
          if (matchingAdmin) {
            targetUser = matchingAdmin.user;
            logger.info('Found user in administrators list', { username, userId: targetUser.id });
          }
        }
      } catch (listErr) {
        logger.warn('Failed to find user in administrators list', { username, error: listErr.message });
      }
    }
    
    // Method 4: Try alternative approaches with different username formats
    if (!targetUser) {
      const attempts = [
        // Try with lower case
        async () => {
          const member = await ctx.telegram.getChatMember(chatId, username.toLowerCase());
          return member?.user;
        },
        // Try with string ID if numeric
        async () => {
          if (/^\d+$/.test(username)) {
            const member = await ctx.telegram.getChatMember(chatId, username);
            return member?.user;
          }
          return null;
        }
      ];
      
      for (const attempt of attempts) {
        try {
          const user = await attempt();
          if (user) {
            targetUser = user;
            logger.info('Found user through alternative method', { username, userId: user.id });
            break;
          }
        } catch (e) {
          // Continue to next attempt
        }
      }
    }
    
    if (!targetUser) {
      logger.error('User not found for kicking', { username, chatId });
      return ctx.reply(
        'User not found. Make sure the username is correct and they have sent a message in this chat before.'
      );
    }
    
    // Execute the kick action
    const moderator = { id: moderatorId, username: ctx.from.username, first_name: ctx.from.first_name };
    const target = { id: targetUser.id, username: targetUser.username, first_name: targetUser.first_name };
    const chat = { id: chatId, title: ctx.chat.title };
    
    logger.info('Executing kick action', { moderator: moderator.username, target: target.username });
    const kickResult = await moderationService.executeAction('kick', moderator, target, chat, { reason });
    
    if (!kickResult.success) {
      logger.error('Failed to kick user', { error: kickResult.message });
      return ctx.reply(`Failed to kick user: ${kickResult.message}`);
    }
    
    logger.info('Successfully kicked user', { username, chatId });
    return ctx.reply(kickResult.message);
  } catch (error) {
    logger.error('Error kicking user', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error kicking the user. Please try again or contact an administrator.');
  }
}

/**
 * Handle my DIDs action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleMyDids(ctx, parameters) {
  try {
    // Get user ID
    const userId = ctx.from.id;
    
    logger.info('Fetching DIDs for user', { userId });
    
    // Show typing indicator to user while fetching DIDs
    await ctx.replyWithChatAction('typing');
    
    // Important: Ensure user ID is in the correct format before passing to the service
    // This fixes potential type conversion issues
    if (!userId) {
      logger.warn('Missing user ID in context', { ctx: JSON.stringify(ctx.from) });
      return ctx.reply('Could not identify your user account. Please try again later.');
    }
    
    try {
      // Try direct DID listing first without using the service
      const directQuery = await sqliteService.db.all(
        'SELECT * FROM dids WHERE owner_id = ?',
        [userId.toString()]
      );
      
      if (directQuery && directQuery.length > 0) {
        // Format the direct query results
        let didListText = "Your DIDs:\n\n";
        
        for (const did of directQuery) {
          didListText += `• ${did.did}\n`;
          
          if (did.method) {
            didListText += `  Method: ${did.method}\n`;
          }
          
          if (did.created_at) {
            didListText += `  Created: ${new Date(did.created_at).toLocaleDateString()}\n`;
          }
          
          didListText += `\n`;
        }
        
        // Add a note about DID usage
        didListText += "You can use these DIDs for credential issuance and verification.";
        
        logger.info('DIDs fetched directly from database', { 
          userId, 
          didCount: directQuery.length 
        });
        
        return ctx.reply(didListText);
      }
    } catch (dbError) {
      logger.warn('Failed direct database query, falling back to service', { 
        error: dbError.message 
      });
      // Continue to service method
    }
    
    // Fetch the user's DIDs from the cheqd service
    const dids = await cheqdService.getUserDids(userId);
    
    logger.info('DIDs fetched successfully', { userId, didCount: dids?.length || 0 });
    
    // If no DIDs are found, provide instructions to create one
    if (!dids || dids.length === 0) {
      return ctx.reply(
        "You don't have any DIDs yet.\n\n" +
        "You can create one using:\n" +
        "• /did create\n" +
        "• or /dail create a new DID for me"
      );
    }
    
    // Format the DID list for display
    let didListText = "Your DIDs:\n\n";
    
    for (const did of dids) {
      didListText += `• ${did.did}\n`;
      
      if (did.method) {
        didListText += `  Method: ${did.method}\n`;
      }
      
      if (did.created_at) {
        didListText += `  Created: ${new Date(did.created_at).toLocaleDateString()}\n`;
      }
      
      didListText += `\n`;
    }
    
    // Add a note about DID usage
    didListText += "You can use these DIDs for credential issuance and verification.";
    
    return ctx.reply(didListText);
  } catch (error) {
    logger.error('Error handling my DIDs', { error: error.message, userId: ctx.from?.id, parameters });
    return ctx.reply('Sorry, there was an error retrieving your DIDs. Please try again later.');
  }
}

/**
 * Handle revoke credential action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleRevokeCredential(ctx, parameters) {
  try {
    // Implementation of handleRevokeCredential function
    // This function should return a result based on the parameters
    // For now, we'll just return a placeholder response
    return ctx.reply('This will revoke a credential.');
  } catch (error) {
    logger.error('Error handling revoke credential', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error revoking the credential.');
  }
}

/**
 * Handle register issuer action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleRegisterIssuer(ctx, parameters) {
  try {
    // Implementation of handleRegisterIssuer function
    // This function should return a result based on the parameters
    // For now, we'll just return a placeholder response
    return ctx.reply('This will register you as a trusted issuer.');
  } catch (error) {
    logger.error('Error handling register issuer', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error registering as a trusted issuer.');
  }
}

/**
 * Handle check registry action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleCheckRegistry(ctx, parameters) {
  try {
    // Implementation of handleCheckRegistry function
    // This function should return a result based on the parameters
    // For now, we'll just return a placeholder response
    return ctx.reply('This will check the registry status.');
  } catch (error) {
    logger.error('Error handling check registry', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error checking the registry status.');
  }
}

/**
 * Handle list credentials action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleListCredentials(ctx, parameters) {
  try {
    // Implementation of handleListCredentials function
    // This function should return a result based on the parameters
    // For now, we'll just return a placeholder response
    return ctx.reply('This will list your credentials.');
  } catch (error) {
    logger.error('Error handling list credentials', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error retrieving your credentials.');
  }
}

/**
 * Handle mute user action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleMuteUser(ctx, parameters) {
  try {
    // Implementation of handleMuteUser function
    // This function should return a result based on the parameters
    // For now, we'll just return a placeholder response
    return ctx.reply('This will mute a user.');
  } catch (error) {
    logger.error('Error handling mute user', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error muting the user.');
  }
}

/**
 * Handle unmute user action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleUnmuteUser(ctx, parameters) {
  try {
    // Implementation of handleUnmuteUser function
    // This function should return a result based on the parameters
    // For now, we'll just return a placeholder response
    return ctx.reply('This will unmute a user.');
  } catch (error) {
    logger.error('Error handling unmute user', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error unmuting the user.');
  }
}

/**
 * Handle restrict user action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleRestrictUser(ctx, parameters) {
  try {
    // Implementation of handleRestrictUser function
    // This function should return a result based on the parameters
    // For now, we'll just return a placeholder response
    return ctx.reply('This will restrict a user.');
  } catch (error) {
    logger.error('Error handling restrict user', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error restricting the user.');
  }
}

/**
 * Handle enable antispam action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleEnableAntispam(ctx, parameters) {
  try {
    // Implementation of handleEnableAntispam function
    // For now, we'll just return a placeholder response
    return ctx.reply('This will enable anti-spam protection.');
  } catch (error) {
    logger.error('Error handling web search', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error performing the web search.');
  }
}

/**
 * Handle disable antispam action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleDisableAntispam(ctx, parameters) {
  try {
    // Implementation of handleDisableAntispam function
    // For now, we'll just return a placeholder response
    return ctx.reply('This will disable anti-spam protection.');
  } catch (error) {
    logger.error('Error handling web search', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error performing the web search.');
  }
}

/**
 * Handle set permissions action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleSetPermissions(ctx, parameters) {
  try {
    // Implementation of handleSetPermissions function
    // For now, we'll just return a placeholder response
    return ctx.reply('This will set permissions for users in the group.');
  } catch (error) {
    logger.error('Error handling web search', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error performing the web search.');
  }
}

/**
 * Handle analyze image action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleAnalyzeImage(ctx, parameters) {
  try {
    // Implementation of handleAnalyzeImage function
    // For now, we'll just return a placeholder response
    return ctx.reply('This will analyze an image.');
  } catch (error) {
    logger.error('Error handling web search', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error performing the web search.');
  }
}

/**
 * Handle generate image action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleGenerateImage(ctx, parameters) {
  try {
    // Implementation of handleGenerateImage function
    // For now, we'll just return a placeholder response
    return ctx.reply('This will generate an image from a prompt.');
  } catch (error) {
    logger.error('Error handling web search', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error performing the web search.');
  }
}

/**
 * Handle web search action
 * @param {Object} ctx - Telegram context
 * @param {Object} parameters - Action parameters
 * @returns {Promise<Object>} - Result of execution
 */
async function handleWebSearch(ctx, parameters) {
  try {
    // Implementation of handleWebSearch function
    // For now, we'll just return a placeholder response
    return ctx.reply('This will perform a web search.');
  } catch (error) {
    logger.error('Error handling web search', { error: error.message, parameters });
    return ctx.reply('Sorry, there was an error performing the web search.');
  }
}

/**
 * Handle video quiz command
 * @param {Object} ctx - Telegram context
 */
async function handleVideoQuizCommand(ctx) {
  try {
    const videoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
    await videoQuizHandler.listAvailableVideoQuizzes(ctx);
  } catch (error) {
    logger.error('Error handling video quiz command', { error: error.message });
    await ctx.reply('Sorry, there was an error retrieving video quizzes. Please try again later.');
  }
}

async function handleMasterVideoTestCommand(ctx) {
  try {
    // Extract CID from command arguments
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply(
        'Please provide a video CID to process.\n' +
        'Usage: /mastervideotest <video-cid>'
      );
    }
    
    const cid = args[1].trim();
    
    // Send processing message
    const processingMsg = await ctx.reply('🔄 Processing video for Master Video Quiz...\nThis may take several minutes depending on video length.');
    
    // Load and run the Master Video Quiz test
    const MasterVideoQuizTest = require('../../test/masterVideoQuiz');
    const tester = new MasterVideoQuizTest();
    
    // Process the video
    const result = await tester.processVideo(cid);
    
    if (!result.success) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        null,
        `❌ Failed to process video: ${result.error}`
      );
      return;
    }
    
    // Get the quiz session handler
    const videoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
    
    // Create a quiz session for this user
    const session = await videoQuizHandler.createQuizSession(ctx.from.id, result.quizId);
    
    // Update message with success and quiz info
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      processingMsg.message_id,
      null,
      `✅ Master Video Quiz created successfully!\n\n` +
      `Title: ${result.quizTitle}\n` +
      `Questions: ${result.quizQuestions}\n\n` +
      `This is a comprehensive quiz that tests deep understanding of the video content.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Start Master Quiz', callback_data: `video_quiz:start:${session.id}` }]
          ]
        }
      }
    );
  } catch (error) {
    logger.error('Error handling master video test command', { error: error.message });
    await ctx.reply('Sorry, there was an error processing the master video quiz. Please try again later.');
  }
}

async function processTestVideoCid(ctx, cid) {
  try {
    // Check if in a private chat
    if (ctx.chat.type !== 'private') {
      return ctx.reply('Please use this command in a private chat with the bot.');
    }
    
    // Import the video quiz handler
    const conversationalVideoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
    
    // Start video quiz with the provided CID
    await conversationalVideoQuizHandler.startVideoQuiz(ctx, cid);
  } catch (error) {
    logger.error('Error processing test video CID', { error: error.message, cid });
    return ctx.reply('Sorry, there was an error processing the video CID.');
  }
}

/**
 * Handle test video quiz command for admins
 * @param {Object} ctx - Telegram context
 */
async function handleTestVideoQuizCommand(ctx) {
  try {
    // Extract CID from command arguments
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply(
        'Please provide a video CID to test.\n' +
        'Usage: /testquiz <video-cid>'
      );
    }
    
    const cid = args[1].trim();
    
    // Import the quiz handler
    const conversationalVideoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
    
    // Run the test
    await conversationalVideoQuizHandler.testVideoQuizFlow(ctx, cid);
  } catch (error) {
    logger.error('Error testing video quiz', { error: error.message });
    await ctx.reply('Sorry, there was an error testing the video quiz. Please try again later.');
  }
}

/**
 * Handle admin video management command
 * @param {Object} ctx - Telegram context
 */
async function handleAdminVideoCommand(ctx) {
  try {
    const userId = ctx.from.id;
    
    // Check if user is an admin
    const isAdmin = await isUserAdmin(userId);
    if (!isAdmin) {
      return ctx.reply("This command is only available to bot administrators.");
    }
    
    // Parse command arguments
    const text = ctx.message.text;
    const args = text.split(' ');
    
    if (args.length < 2) {
      return ctx.reply(
        "Usage: /adminvideo <command> [options]\n\n" +
        "Available commands:\n" +
        "- add <url> - Add a new video from URL\n" +
        "- process <cid> - Process an existing video\n" +
        "- test <cid> - Test video quiz flow\n" +
        "- publish <cid> - Make video available to users\n" +
        "- list - List all videos\n" +
        "- delete <cid> - Delete a video\n" +
        "- info <cid> - Get detailed info about a video"
      );
    }
    
    const command = args[1].toLowerCase();
    
    switch (command) {
      case 'add': {
        if (args.length < 3) {
          return ctx.reply("Please provide a URL to add. Usage: /adminvideo add <url>");
        }
        
        const url = args[2];
        const title = args.slice(3).join(' ') || `Educational Video (${new Date().toISOString().split('T')[0]})`;
        
        // First reply to let user know we're working on it
        const statusMsg = await ctx.reply(`Adding video from URL: ${url}\nThis may take some time...`);
        
        try {
          // Import required modules
          const jackalPinService = require('../modules/jackal/jackalPinService');
          await jackalPinService.ensureInitialized();
          
          // Pin the video
          const result = await jackalPinService.pinVideo(url, {
            title: title,
            description: `Educational video added by admin: ${ctx.from.username || ctx.from.first_name}`,
            type: 'educational'
          });
          
          if (!result.success) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              null,
              `❌ Failed to add video: ${result.error || 'Unknown error'}`
            );
            return;
          }
          
          // Update the message with success and next steps
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `✅ Video added successfully!\n\nCID: ${result.cid}\n\nUse /adminvideo process ${result.cid} to process it.`
          );
        } catch (error) {
          logger.error(`Error adding video: ${error.message}`, { error, url });
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `❌ Error adding video: ${error.message}`
          );
        }
        break;
      }
      
      case 'process': {
        if (args.length < 3) {
          return ctx.reply("Please provide a CID to process. Usage: /adminvideo process <cid>");
        }
        
        const cid = args[2];
        
        // First reply to let user know we're working on it
        const statusMsg = await ctx.reply(`Processing video with CID: ${cid}\nThis may take a while...`);
        
        try {
          // Import required modules
          const videoProcessor = require('../modules/jackal/videoProcessor');
          await videoProcessor.initialize();
          
          // Start the processing
          const result = await videoProcessor.processVideoByCid(cid, { force: true });
          
          if (!result) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              null,
              `❌ Failed to process video. Check the logs for details.`
            );
            return;
          }
          
          // Update the message with success info
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `✅ Video processed successfully!\n\nID: ${result.id}\nTitle: ${result.title || result.name}\n\nUse /adminvideo test ${cid} to test the quiz flow.`
          );
        } catch (error) {
          logger.error(`Error processing video: ${error.message}`, { error, cid });
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `❌ Error processing video: ${error.message}`
          );
        }
        break;
      }
      
      case 'test': {
        if (args.length < 3) {
          return ctx.reply("Please provide a CID to test. Usage: /adminvideo test <cid>");
        }
        
        const cid = args[2];
        
        // Use the existing test function
        const conversationalVideoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
        await conversationalVideoQuizHandler.testVideoQuizFlow(ctx, cid);
        break;
      }
      
      case 'publish': {
        if (args.length < 3) {
          return ctx.reply("Please provide a CID to publish. Usage: /adminvideo publish <cid>");
        }
        
        const cid = args[2];
        
        // First reply to let user know we're working on it
        const statusMsg = await ctx.reply(`Publishing video with CID: ${cid}...`);
        
        try {
          // Import required modules
          await sqliteService.ensureInitialized();
          
          // Update the video to mark it as ready for users
          await sqliteService.db.run(
            `UPDATE educational_videos 
             SET published = 1, published_at = CURRENT_TIMESTAMP 
             WHERE cid = ?`,
            [cid]
          );
          
          // Get video info
          const video = await sqliteService.db.get(
            `SELECT * FROM educational_videos WHERE cid = ?`,
            [cid]
          );
          
          if (!video) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              null,
              `❌ Video not found with CID: ${cid}`
            );
            return;
          }
          
          // Update the message with success info
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `✅ Video published successfully!\n\nID: ${video.id}\nTitle: ${video.title || video.name}\n\nUsers can now access this video for quizzes.`
          );
        } catch (error) {
          logger.error(`Error publishing video: ${error.message}`, { error, cid });
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `❌ Error publishing video: ${error.message}`
          );
        }
        break;
      }
      
      case 'list': {
        // Reply to let user know we're working on it
        const statusMsg = await ctx.reply('Fetching video list...');
        
        try {
          // Import required modules
          await sqliteService.ensureInitialized();
          
          // Get all videos
          const videos = await sqliteService.db.all(
            `SELECT ev.*, vs.title 
             FROM educational_videos ev 
             LEFT JOIN video_summaries vs ON ev.id = vs.video_id 
             ORDER BY ev.id DESC
             LIMIT 10`
          );
          
          if (!videos || videos.length === 0) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              null,
              'No videos found in the database.'
            );
            return;
          }
          
          // Format the list
          let message = `📋 Educational Videos (${videos.length}):\n\n`;
          
          for (const video of videos) {
            const title = video.title || video.name || 'Untitled';
            const status = video.processed ? '✅' : video.processing ? '⏳' : '❌';
            const published = video.published ? '🌐' : '🔒';
            
            message += `${published} ${status} ${title}\n`;
            message += `ID: ${video.id}, CID: ${video.cid.substring(0, 10)}...\n\n`;
          }
          
          // Update the message with the list
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            message
          );
        } catch (error) {
          logger.error(`Error listing videos: ${error.message}`, { error });
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `❌ Error listing videos: ${error.message}`
          );
        }
        break;
      }
      
      case 'delete': {
        if (args.length < 3) {
          return ctx.reply("Please provide a CID to delete. Usage: /adminvideo delete <cid>");
        }
        
        const cid = args[2];
        
        // First reply to let user know we're confirming
        const confirmMsg = await ctx.reply(
          `⚠️ Are you sure you want to delete the video with CID: ${cid}?\n\n` +
          `This will remove it from the database and make it unavailable to users. The video itself will remain in Jackal storage.\n\n` +
          `Reply with "/adminvideo confirm_delete ${cid}" to confirm.`
        );
        break;
      }
      
      case 'confirm_delete': {
        if (args.length < 3) {
          return ctx.reply("Please provide a CID to confirm deletion. Usage: /adminvideo confirm_delete <cid>");
        }
        
        const cid = args[2];
        
        // First reply to let user know we're working on it
        const statusMsg = await ctx.reply(`Deleting video with CID: ${cid}...`);
        
        try {
          // Import required modules
          await sqliteService.ensureInitialized();
          
          // Get video info first
          const video = await sqliteService.db.get(
            `SELECT * FROM educational_videos WHERE cid = ?`,
            [cid]
          );
          
          if (!video) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              null,
              `❌ Video not found with CID: ${cid}`
            );
            return;
          }
          
          // Delete all related data
          await sqliteService.db.run('DELETE FROM video_transcriptions WHERE video_id = ?', [video.id]);
          await sqliteService.db.run('DELETE FROM video_frames WHERE video_id = ?', [video.id]);
          await sqliteService.db.run('DELETE FROM video_analysis WHERE video_id = ?', [video.id]);
          await sqliteService.db.run('DELETE FROM video_summaries WHERE video_id = ?', [video.id]);
          await sqliteService.db.run('DELETE FROM video_quizzes WHERE video_id = ?', [video.id]);
          await sqliteService.db.run('DELETE FROM educational_videos WHERE id = ?', [video.id]);
          
          // Update the message with success info
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `✅ Video deleted successfully!\n\nID: ${video.id}, CID: ${video.cid}\nTitle: ${video.title || video.name}`
          );
        } catch (error) {
          logger.error(`Error deleting video: ${error.message}`, { error, cid });
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `❌ Error deleting video: ${error.message}`
          );
        }
        break;
      }
      
      case 'info': {
        if (args.length < 3) {
          return ctx.reply("Please provide a CID to get info. Usage: /adminvideo info <cid>");
        }
        
        const cid = args[2];
        
        // First reply to let user know we're working on it
        const statusMsg = await ctx.reply(`Fetching info for video with CID: ${cid}...`);
        
        try {
          // Import required modules
          await sqliteService.ensureInitialized();
          
          // Get comprehensive video info
          const video = await sqliteService.db.get(
            `SELECT ev.*, vs.title, vs.overview, vs.key_points 
             FROM educational_videos ev 
             LEFT JOIN video_summaries vs ON ev.id = vs.video_id 
             WHERE ev.cid = ?`,
            [cid]
          );
          
          if (!video) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              null,
              `❌ Video not found with CID: ${cid}`
            );
            return;
          }
          
          // Get quiz data
          const quiz = await sqliteService.db.get(
            `SELECT * FROM video_quizzes WHERE video_id = ?`,
            [video.id]
          );
          
          // Format detailed info
          let message = `📋 Video Details:\n\n`;
          message += `Title: ${video.title || video.name || 'Untitled'}\n`;
          message += `ID: ${video.id}, CID: ${video.cid}\n\n`;
          
          message += `Status:\n`;
          message += `- Processed: ${video.processed ? '✅' : '❌'}\n`;
          message += `- Processing: ${video.processing ? '⏳' : '❌'}\n`;
          message += `- Published: ${video.published ? '✅' : '❌'}\n`;
          message += `- Has Transcription: ${video.has_transcription ? '✅' : '❌'}\n`;
          message += `- Has Frame Analysis: ${video.has_frame_analysis ? '✅' : '❌'}\n`;
          message += `- Has Summary: ${video.has_summary ? '✅' : '❌'}\n`;
          message += `- Has Quiz: ${video.has_quiz ? '✅' : '❌'}\n\n`;
          
          if (video.last_error) {
            message += `Last Error: ${video.last_error}\n`;
            message += `Error Time: ${video.last_error_at}\n\n`;
          }
          
          if (quiz) {
            message += `Quiz:\n`;
            message += `- Title: ${quiz.title}\n`;
            message += `- Questions: ${quiz.question_count}\n`;
            message += `- Difficulty: ${quiz.difficulty}\n\n`;
          }
          
          if (video.overview) {
            const overview = video.overview.length > 150
              ? video.overview.substring(0, 150) + "..."
              : video.overview;
            message += `Overview: ${overview}\n\n`;
          }
          
          // Update the message with the info
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            message
          );
        } catch (error) {
          logger.error(`Error getting video info: ${error.message}`, { error, cid });
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `❌ Error getting video info: ${error.message}`
          );
        }
        break;
      }
      
      default:
        return ctx.reply(`Unknown command: ${command}. Use /adminvideo for help.`);
    }
  } catch (error) {
    logger.error(`Error handling admin video command: ${error.message}`, { error });
    return ctx.reply(`Sorry, there was an error: ${error.message}`);
  }
}

/**
 * Check if a user is an admin
 * @param {number} userId - User ID to check
 * @returns {Promise<boolean>} - Whether user is an admin
 */
async function isUserAdmin(userId) {
  try {
    await sqliteService.ensureInitialized();
    const db = sqliteService.db;
    
    const adminSetting = await db.get('SELECT value FROM settings WHERE key = ?', ['admin_users']);
    
    if (!adminSetting || !adminSetting.value) {
      // If no admin setting exists, allow only the first user who tries this
      const firstUser = await db.get('SELECT MIN(id) as first_id FROM users');
      return firstUser && firstUser.first_id === userId;
    }
    
    try {
      const adminUsers = JSON.parse(adminSetting.value);
      return adminUsers.includes(userId);
    } catch (e) {
      // If parsing fails, try comma-separated list
      const adminList = adminSetting.value.split(',').map(id => parseInt(id.trim()));
      return adminList.includes(userId);
    }
  } catch (error) {
    logger.error(`Error checking admin status: ${error.message}`);
    return false;
  }
}

/**
 * Handle cancel quiz command
 * @param {Object} ctx - Telegram context
 */
async function handleCancelQuizCommand(ctx) {
  try {
    const userId = ctx.from.id;
    
    // Import the quiz handler
    const conversationalVideoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
    
    // Try to clear any active quiz session
    const result = await conversationalVideoQuizHandler.clearQuizSession(userId);
    
    if (result) {
      await ctx.reply('Quiz session cleared successfully! You can now start a new quiz or continue with normal conversation.');
    } else {
      await ctx.reply('No active quiz session found or there was an error clearing the session.');
    }
  } catch (error) {
    logger.error('Error handling cancel quiz command', { error: error.message });
    await ctx.reply('An error occurred while trying to cancel your quiz session.');
  }
}

// Export command handlers
module.exports = {
  handleStartCommand,
  handleHelpCommand,
  handleDailCommand,
  handleStatusCommand,
  handleQuizCommand,
  handleProgressCommand,
  handleSupportCommand,
  handleModeratorCommand,
  handleVerifyCommand,
  handleDIDCommand,
  handleCredentialCommand,
  handleAdminCommand,
  handleAskCommand,
  handleContextCommand,
  
  // Additional handlers for dail command execution
  executeCommandAction,
  processNaturalLanguageCommand,
  handleCreateDid,
  handleIssueCredential,
  handleVerifyCredential,
  handleCheckSupport,
  handleUpgradeSupport,
  handleStartQuiz,
  handleCheckProgress,
  handleMakeModerator,
  handleRemoveModerator,
  handleBanUser,
  handleUnbanUser,
  handleKickUser,
  handleMyDids,
  handleBlockchainQuery,
  handleRevokeCredential,
  handleRegisterIssuer,
  handleCheckRegistry,
  handleListCredentials,
  handleMuteUser,
  handleUnmuteUser,
  handleRestrictUser,
  handleEnableAntispam,
  handleDisableAntispam,
  handleSetPermissions,
  handleAnalyzeImage,
  handleGenerateImage,
  handleWebSearch,
  handleVideoQuizCommand,
  handleMasterVideoTestCommand,
  processTestVideoCid,
  handleTestVideoQuizCommand,
  handleAdminVideoCommand,
  isUserAdmin,
  handleCancelQuizCommand
}; 