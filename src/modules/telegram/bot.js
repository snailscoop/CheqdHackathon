const { Telegraf, Markup } = require('telegraf');
const config = require('../../config/config');
const logger = require('../../utils/logger');
const commandHandlers = require('../handlers/commandHandlers');
const unifiedCredentialHandlers = require('./handlers/unifiedCredentialHandlers');

// Initialize bot
const bot = new Telegraf(config.telegram.token);

// Register command handlers
bot.command('start', commandHandlers.handleStartCommand);
bot.command('help', commandHandlers.handleHelpCommand);
bot.command('dail', commandHandlers.handleDailCommand);
bot.command('status', commandHandlers.handleStatusCommand);
bot.command('quiz', commandHandlers.handleQuizCommand);
bot.command('progress', commandHandlers.handleProgressCommand);
bot.command('support', commandHandlers.handleSupportCommand);
bot.command('mod', commandHandlers.handleModeratorCommand);
bot.command('verify', commandHandlers.handleVerifyCommand);
bot.command('did', commandHandlers.handleDIDCommand);
bot.command('credential', commandHandlers.handleCredentialCommand);
bot.command('admin', commandHandlers.handleAdminCommand);
bot.command('ask', commandHandlers.handleAskCommand);
bot.command('context', commandHandlers.handleContextCommand);

// Handle transaction commands
// Transaction analysis command
bot.command('tx', async (ctx) => {
  try {
    const text = ctx.message.text;
    const match = text.match(/^\/tx\s+(.*)/i);
    
    if (!match || !match[1]) {
      return ctx.reply('Please provide a transaction hash after /tx. For example: /tx F9FAD5A47E9CF475083A6813FC2959237CE82C118218A1088A61F9C8F9BEF5C5');
    }
    
    const params = match[1].trim().split(/\s+/);
    const txHash = params[0];
    let chainId = params[1] || 'stargaze-1';
    
    // Validate the transaction hash format
    const txHashRegex = /\b([A-F0-9]{64})\b/i;
    if (!txHashRegex.test(txHash)) {
      return ctx.reply('Invalid transaction hash format. Please provide a valid 64-character hexadecimal hash.');
    }
    
    // Process the transaction
    return await unifiedCredentialHandlers.handleBlockchainTransaction(ctx, {
      txHash,
      chainId
    });
  } catch (error) {
    logger.error('Error handling /tx command', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your transaction query.');
  }
});

// Transaction explanation command
bot.command('explain', async (ctx) => {
  try {
    const text = ctx.message.text;
    const match = text.match(/^\/explain\s+(.*)/i);
    
    if (!match || !match[1]) {
      return ctx.reply('Please provide a transaction hash after /explain. For example: /explain F9FAD5A47E9CF475083A6813FC2959237CE82C118218A1088A61F9C8F9BEF5C5');
    }
    
    const params = match[1].trim().split(/\s+/);
    const txHash = params[0];
    let chainId = params[1] || 'stargaze-1';
    
    // Validate the transaction hash format
    const txHashRegex = /\b([A-F0-9]{64})\b/i;
    if (!txHashRegex.test(txHash)) {
      return ctx.reply('Invalid transaction hash format. Please provide a valid 64-character hexadecimal hash.');
    }
    
    // Process the transaction with a user-friendly message
    return await unifiedCredentialHandlers.handleBlockchainTransaction(ctx, {
      txHash,
      chainId
    });
  } catch (error) {
    logger.error('Error handling /explain command', { error: error.message });
    return ctx.reply('Sorry, there was an error explaining your transaction.');
  }
});

// Register video quiz commands
bot.command('videoquiz', commandHandlers.handleVideoQuizCommand);
bot.command('vquiz', commandHandlers.handleVideoQuizCommand);
bot.command('mastervideotest', commandHandlers.handleMasterVideoTestCommand);
bot.command('testcid', (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length > 1) {
    const cid = args[1];
    return commandHandlers.processTestVideoCid(ctx, cid);
  } else {
    return ctx.reply('Please provide a CID: /testcid <cid>');
  }
});
bot.command('testquiz', commandHandlers.handleTestVideoQuizCommand);
bot.command('adminvideo', commandHandlers.handleAdminVideoCommand);
bot.command('cancelquiz', commandHandlers.handleCancelQuizCommand);

// Register callback query handlers
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  logger.info('Received callback query', { data, userId: ctx.from?.id });
  
  if (data.startsWith('feature:') || data === 'setup:complete' || data === 'payment:completed' || data.startsWith('deep:')) {
    return await unifiedCredentialHandlers.handleCallbackQuery(ctx);
  }
  
  // Existing callback handlers can be added here
});

// Register video quiz callback handlers
bot.on('callback_query', (ctx) => {
  if (ctx.callbackQuery.data.startsWith('video_quiz:')) {
    const conversationalVideoQuizHandler = require('./handlers/conversationalVideoQuizHandler');
    return conversationalVideoQuizHandler.handleVideoQuizCallback(ctx);
  }
  // Let other callback handlers proceed
  return;
});

// Register message handler for active video quiz sessions
bot.on('message', async (ctx, next) => {
  // Skip non-text messages
  if (!ctx.message.text) return next();
  
  // Skip messages that start with commands
  if (ctx.message.text.startsWith('/')) return next();
  
  try {
    const conversationalVideoQuizHandler = require('./handlers/conversationalVideoQuizHandler');
    
    // Check if message is a standalone "stop quiz" request
    const stopQuizPatterns = ['stop quiz', 'exit quiz', 'end quiz', 'cancel quiz', 'quit quiz'];
    if (stopQuizPatterns.some(pattern => ctx.message.text.toLowerCase().trim() === pattern)) {
      logger.info('Detected stop quiz request in message', { userId: ctx.from.id });
      
      // Try to clear any active quiz session
      const result = await conversationalVideoQuizHandler.clearQuizSession(ctx.from.id);
      
      if (result) {
        await ctx.reply('Quiz session cleared successfully! You can now start a new quiz or continue with normal conversation.');
      } else {
        await ctx.reply('No active quiz session found or there was an error clearing the session.');
      }
      
      return;
    }
    
    // Check if user has an active video quiz session
    const userId = ctx.from.id;
    const session = await conversationalVideoQuizHandler.getActiveQuizSession(userId);
    
    if (session) {
      // User has an active quiz session, handle as quiz response
      return conversationalVideoQuizHandler.handleQuizResponse(ctx, ctx.message.text);
    }
  } catch (error) {
    console.error('Error handling potential quiz response:', error);
  }
  
  // Continue to other handlers
  return next();
});

// Register transaction hash detection middleware
bot.on('message', async (ctx, next) => {
  // Skip non-text messages
  if (!ctx.message.text) return next();
  
  // Skip messages that start with commands
  if (ctx.message.text.startsWith('/')) return next();
  
  try {
    // Check for transaction hash pattern in the message
    const txHashRegex = /\b([A-F0-9]{64})\b/i;
    const txHashMatch = ctx.message.text.match(txHashRegex);
    
    if (txHashMatch) {
      const txHash = txHashMatch[1];
      
      logger.info('Transaction hash detected in message', {
        txHash: txHash.substring(0, 8) + '...',
        userId: ctx.from.id,
        chatId: ctx.chat.id
      });
      
      // Check for chain hint in the message
      let chainId = 'stargaze-1'; // Default chain
      
      if (ctx.message.text.toLowerCase().includes('osmosis')) {
        chainId = 'osmosis-1';
      } else if (ctx.message.text.toLowerCase().includes('cosmos')) {
        chainId = 'cosmoshub-4';
      } else if (ctx.message.text.toLowerCase().includes('juno')) {
        chainId = 'juno-1';
      } else if (ctx.message.text.toLowerCase().includes('cheqd')) {
        chainId = 'cheqd-mainnet-1';
      }
      
      // Check if this is a "what happened" query
      const whatHappenedPatterns = [
        /what\s+happened/i,
        /what\s+went\s+wrong/i,
        /why\s+did\s+it\s+fail/i,
        /explain\s+what/i,
        /tell\s+me\s+about/i
      ];
      
      const isWhatHappenedQuery = whatHappenedPatterns.some(pattern => pattern.test(ctx.message.text));
      
      // If this was a "what happened" query, route directly to that handler
      if (isWhatHappenedQuery) {
        return unifiedCredentialHandlers.handleWhatHappened(ctx, {
          txHash,
          chainId
        });
      }
      
      // If this was a transaction hash with no other context, or user specifically asked about it
      const askingAboutTx = ctx.message.text.toLowerCase().includes('what') ||
                           ctx.message.text.toLowerCase().includes('help') ||
                           ctx.message.text.toLowerCase().includes('explain') ||
                           ctx.message.text.toLowerCase().includes('analyze') ||
                           ctx.message.text.length < 100; // Just the hash or minimal text
      
      if (askingAboutTx) {
        // Ask if user would like to analyze the transaction
        return ctx.reply(
          `I noticed a blockchain transaction hash in your message. Would you like me to analyze it?`,
          Markup.inlineKeyboard([
            Markup.button.callback('Yes, analyze it', `analyze_tx:${txHash}:${chainId}`),
            Markup.button.callback('No, thanks', 'cancel_tx_analysis')
          ])
        );
      }
    }
  } catch (error) {
    logger.error('Error in transaction hash detection middleware', { error: error.message });
  }
  
  // Continue to other handlers
  return next();
});

// Handle transaction analysis callback queries
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  
  if (data.startsWith('analyze_tx:')) {
    // Extract transaction hash and chain ID
    const parts = data.split(':');
    const txHash = parts[1];
    const chainId = parts[2] || 'stargaze-1';
    
    // Acknowledge the callback query to stop loading indicator
    await ctx.answerCbQuery();
    
    // Edit the message to show we're analyzing
    await ctx.editMessageText(`Analyzing transaction ${txHash.substring(0, 8)}...${txHash.substring(txHash.length - 8)} on ${chainId}...`);
    
    // Process the transaction
    try {
      // Get analysis from unified credential handler
      const analysis = await unifiedCredentialHandlers.handleBlockchainTransaction(ctx, {
        txHash,
        chainId,
        fromCallback: true
      });
      
      return analysis;
    } catch (error) {
      logger.error('Error handling transaction analysis callback', { error: error.message });
      return ctx.editMessageText('Sorry, there was an error analyzing this transaction.');
    }
  } else if (data.startsWith('deep:')) {
    // This callback is now handled by unifiedCredentialHandlers.handleCallbackQuery
    // Just log it for debugging
    logger.info('Forwarding deep analysis callback to unified handler', { data });
    return;
  } else if (data === 'cancel_tx_analysis') {
    // User doesn't want to analyze the transaction
    await ctx.answerCbQuery('Analysis canceled');
    return ctx.deleteMessage();
  }
  
  // Continue to other callback handlers if not handled
  return;
});

// Add direct deep analysis handler
bot.action(/^deep:(.*)$/, async (ctx) => {
  try {
    logger.info('Direct handling of deep analysis callback', { data: ctx.match[0] });
    
    // Extract chain ID from the callback data
    const chainId = ctx.match[1] || 'stargaze-1';
    
    // Extract transaction hash from the message text
    const messageText = ctx.callbackQuery.message.text || '';
    
    // Try various patterns to find the hash
    let txHash = null;
    const patterns = [
      /Hash:\s+`([A-F0-9]{64})`/i,
      /Hash:\s*([A-F0-9]{64})/i,
      /\b([A-F0-9]{64})\b/i
    ];
    
    for (const pattern of patterns) {
      const match = messageText.match(pattern);
      if (match && match[1]) {
        txHash = match[1];
        break;
      }
    }
    
    if (!txHash) {
      await ctx.answerCbQuery('Could not find transaction hash');
      return ctx.reply('Sorry, I could not find the transaction hash to analyze. Please try using the /tx command with the hash directly.');
    }
    
    // Try to show we're working on it
    try {
      await ctx.answerCbQuery('Analyzing transaction details...');
    } catch (e) {
      logger.warn('Could not answer callback query', { error: e.message });
    }
    
    try {
      await ctx.editMessageText(`🔍 *Deep analysis in progress...*\n\nAnalyzing transaction \`${txHash}\` on ${chainId}...`, {
        parse_mode: 'Markdown'
      });
    } catch (e) {
      logger.warn('Could not edit message', { error: e.message });
    }
    
    // Get the handler instance
    const unifiedCredentialHandlers = require('./handlers/unifiedCredentialHandlers');
    
    // Call the deep analysis function
    return await unifiedCredentialHandlers.handleDeepAnalysis(ctx, txHash, chainId);
  } catch (error) {
    logger.error('Error in direct deep analysis handler', { error: error.message });
    try {
      return ctx.reply(`Sorry, I encountered an error while analyzing this transaction: ${error.message}`);
    } catch (replyError) {
      logger.error('Could not send error message', { error: replyError.message });
    }
  }
});

// Transaction details command for deeper analysis
bot.command('txdetails', async (ctx) => {
  try {
    const text = ctx.message.text;
    const match = text.match(/^\/txdetails\s+(.*)/i);
    
    if (!match || !match[1]) {
      return ctx.reply('Please provide a transaction hash after /txdetails. For example: /txdetails F9FAD5A47E9CF475083A6813FC2959237CE82C118218A1088A61F9C8F9BEF5C5');
    }
    
    const params = match[1].trim().split(/\s+/);
    const txHash = params[0];
    let chainId = params[1] || 'stargaze-1';
    
    // Validate the transaction hash format
    const txHashRegex = /\b([A-F0-9]{64})\b/i;
    if (!txHashRegex.test(txHash)) {
      return ctx.reply('Invalid transaction hash format. Please provide a valid 64-character hexadecimal hash.');
    }
    
    // Show processing message
    const processingMsg = await ctx.reply(
      `🔍 *Analyzing Transaction Details*\n\nPlease wait while I fetch detailed information about transaction \`${txHash}\`...`,
      { parse_mode: 'Markdown' }
    );
    
    // Get the unifiedCredentialHandlers instance
    const unifiedCredentialHandlers = require('./handlers/unifiedCredentialHandlers');
    
    // Process the transaction with detailed analysis
    return await unifiedCredentialHandlers.handleDeepAnalysis(ctx, txHash, chainId);
  } catch (error) {
    logger.error('Error handling /txdetails command', { error: error.message });
    return ctx.reply('Sorry, there was an error analyzing this transaction in detail. Please try again later.');
  }
});

// Example transaction analysis command
bot.command('txexample', async (ctx) => {
  try {
    logger.info('Running transaction example');
    
    // Use a known working transaction hash from Stargaze
    const exampleHash = '7AC28E7790CD7F9876BA05EFC47B2CE33DA386EA2D53F20BF5B9F798FD2A8D9F';
    const chainId = 'stargaze-1';
    
    // Show processing message
    const message = await ctx.reply(
      `⚙️ *Transaction Analysis Example*\n\n` +
      `I'll analyze a sample NFT purchase transaction on Stargaze.\n\n` +
      `Transaction hash: \`${exampleHash}\`\n` +
      `Chain: ${chainId}\n\n` +
      `Processing...\n\n` +
      `You can try this yourself with:\n` +
      `/tx ${exampleHash}`,
      { parse_mode: 'Markdown' }
    );
    
    // Get unifiedCredentialHandlers
    const unifiedCredentialHandlers = require('./handlers/unifiedCredentialHandlers');
    
    // Process with regular transaction handler
    setTimeout(() => {
      unifiedCredentialHandlers.handleBlockchainTransaction(ctx, {
        txHash: exampleHash,
        chainId,
        isExample: true
      });
    }, 2000);
    
    return;
  } catch (error) {
    logger.error('Error showing transaction example', { error: error.message });
    return ctx.reply('Sorry, there was an error showing the transaction example. Please try again later.');
  }
});

module.exports = bot; 