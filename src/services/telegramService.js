/**
 * Telegram Bot Service
 * 
 * This service handles all interactions with the Telegram API.
 */

const { Telegraf, session, Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const sqliteService = require('../db/sqliteService');
const grokService = require('./grokService');
const cheqdService = require('./cheqdService');
const config = require('../config/config');
const messageGenerator = require('../utils/messageGenerator');

// Import credential service modules
const educationalCredentialService = require('../modules/education/educationalCredentialService');
const supportCredentialService = require('../modules/support/supportCredentialService');
const moderationCredentialService = require('../modules/moderation/moderationCredentialService');
const unifiedCredentialHandlers = require('../modules/telegram/handlers/unifiedCredentialHandlers');
const credentialHandlers = require('../modules/telegram/handlers/credentialHandlers');
const conversationalCredentialHandlers = require('../modules/telegram/handlers/conversationalCredentialHandlers');
// Breaking circular dependency by using dynamic loading instead of direct require
let moderationService = null; // Will be loaded dynamically

class TelegramService {
  constructor() {
    this.initialized = false;
    this.bot = null;
    this.userMap = new Map();
    this.messageMap = new Map();
  }

  /**
   * Initialize service state and data structures
   * @private
   */
  _initializeState() {
    this.bot = null;
    this.initialized = false;
    this.commands = {};
    // User mapping to remember usernames and IDs of users who've sent messages
    this.userMap = new Map();
    this.activeQuizSessions = {};
    this.activeStreams = new Map();
    this.messageBuffers = new Map();
  }

  /**
   * Initialize Telegram bot
   */
  async initialize() {
    try {
      logger.info('Initializing Telegram bot');
      
      await this._createBotInstance();
      await this._setupSessionHandling();
      this._setupMiddleware();
      this._registerCommands();
      this._setupErrorHandling();
      
      // Setup bot
      this._setupBot();
      
      // Ensure bot ID is properly set and stored
      await this._ensureBotIdIsSet();
      
      this.initialized = true;
      logger.info('Telegram bot initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize Telegram bot', { error: error.message });
      throw error;
    }
  }

  /**
   * Create Telegram bot instance
   * @private
   */
  async _createBotInstance() {
    // Create bot instance
    const token = config.telegram.token;
    
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not defined in environment variables');
    }
    
    this.bot = new Telegraf(token);
    
    // Set bot username if available
    if (config.telegram.username) {
      this.bot.botInfo = { 
        username: config.telegram.username,
        // Extract the bot ID from the token if possible
        id: parseInt(token.split(':')[0], 10)
      };
      logger.info('Set bot info from config', { botUsername: config.telegram.username, botId: this.bot.botInfo.id });
    }
  }

  /**
   * Ensure the bot ID is set and stored in the database
   * @private
   */
  async _ensureBotIdIsSet() {
    try {
      // First try to get bot ID from the botInfo (should be populated after bot.telegram.getMe())
      if (!this.bot.botInfo || !this.bot.botInfo.id) {
        logger.info('Bot ID not found in botInfo, retrieving from Telegram API');
        const botInfo = await this.bot.telegram.getMe();
        if (botInfo && botInfo.id) {
          this.bot.botInfo = botInfo;
          logger.info('Retrieved bot info from Telegram API', { 
            botId: botInfo.id, 
            username: botInfo.username 
          });
        }
      }
      
      // Save bot ID to database if we have it
      if (this.bot.botInfo && this.bot.botInfo.id) {
        await sqliteService.saveSetting('bot_id', this.bot.botInfo.id.toString());
        logger.info('Saved bot ID to database', { botId: this.bot.botInfo.id });
        
        // Make bot ID available globally
        global.telegramService = this;
      } else {
        logger.warn('Could not determine bot ID during initialization');
      }
    } catch (error) {
      logger.error('Error ensuring bot ID is set', { error: error.message });
    }
  }

  /**
   * Set up session handling for the bot
   * @private
   */
  async _setupSessionHandling() {
    // Use Telegraf's built-in session middleware
    this.bot.use(session());
  }

  /**
   * Set up middleware
   * @private
   */
  _setupMiddleware() {
    // Log all updates
    this.bot.use(async (ctx, next) => {
      const start = Date.now();
      
      logger.debug('Received Telegram update', { 
        updateId: ctx.update?.update_id,
        chatId: ctx.chat?.id,
        userId: ctx.from?.id,
        messageText: ctx.message?.text?.substring(0, 100)
      });
      
      // Remember users who send messages to the chat
      if (ctx.from) {
        this.rememberUser(ctx.from, ctx.chat?.id);
      }
      
      // Save message to database
      if (ctx.message && ctx.message.text) {
        await this._saveMessage(ctx);
      }
      
      // Check if user is banned with traditional method
      if (ctx.from && ctx.chat) {
        // Check traditional ban
        try {
          const isBanned = await sqliteService.isUserBanned(ctx.from.id, ctx.chat.id);
          if (isBanned) {
            logger.info(`Blocked message from banned user: ${ctx.from.id} in chat ${ctx.chat.id}`);
            return;
          }
        } catch (err) {
          logger.warn('Error checking if user is banned', { error: err.message });
        }
      }
      
      // AI-enhanced scam detection
      if (ctx.from && ctx.chat && ctx.message && ctx.message.text) {
        try {
          // Load ban storage service
          const banStorage = require('../modules/moderation/banStorage');
          await banStorage.ensureInitialized();
          
          // Process message for scam detection
          const analysis = await banStorage.processMessage(ctx.from.id.toString(), ctx.message.text, {
            messageId: ctx.message.message_id,
            chatId: ctx.chat.id.toString()
          });
          
          // Take action based on analysis
          if (analysis.action && analysis.action.recommended !== 'none') {
            logger.info('AI scam detection triggered', { 
              action: analysis.action.recommended,
              confidence: analysis.action.confidence,
              userId: ctx.from.id,
              chatId: ctx.chat.id
            });
            
            // Get chat settings to see if we should auto-moderate
            const settings = await sqliteService.getSettings(ctx.chat.id.toString());
            const autoModerateEnabled = settings?.antispamEnabled === true;
            
            // Handle different recommended actions
            if (analysis.action.recommended === 'ban' && analysis.action.confidence > 0.9 && autoModerateEnabled) {
              // High confidence ban - auto-ban if enabled
              await this.kickChatMember(ctx.chat.id, ctx.from.id, {
                reason: 'AI scam detection: ' + analysis.action.reason.join(', ').substring(0, 100)
              });
              
              // Notify chat
              await ctx.reply(`⚠️ Banned user ${ctx.from.first_name} (ID: ${ctx.from.id}) for scam detection.\nConfidence: ${(analysis.action.confidence * 100).toFixed(1)}%`);
              
              // Delete the message
              try {
                await ctx.deleteMessage(ctx.message.message_id);
              } catch (deleteErr) {
                logger.warn('Failed to delete scam message', { error: deleteErr.message });
              }
              
              return; // Stop processing
            } else if (analysis.action.recommended === 'suspend' && analysis.action.confidence > 0.85 && autoModerateEnabled) {
              // High confidence suspend - auto-mute if enabled
              const duration = 3600; // 1 hour
              await this.restrictChatMember(ctx.chat.id, ctx.from.id, {
                can_send_messages: false,
                until_date: Math.floor(Date.now() / 1000) + duration
              });
              
              // Notify chat
              await ctx.reply(`⚠️ Restricted user ${ctx.from.first_name} (ID: ${ctx.from.id}) for 1 hour due to suspicious activity.\nConfidence: ${(analysis.action.confidence * 100).toFixed(1)}%`);
              
              return; // Stop processing
            } else if (analysis.action.recommended === 'warn' && analysis.action.confidence > 0.8 && autoModerateEnabled) {
              // High confidence warning - notify admins
              const admins = await this._getChatAdmins(ctx.chat.id);
              
              // Only notify if there are admins
              if (admins && admins.length > 0) {
                const adminMentions = admins.map(admin => `[${admin.user.first_name}](tg://user?id=${admin.user.id})`).join(', ');
                
                await ctx.reply(
                  `⚠️ Potential scam detected\n` +
                  `Attention ${adminMentions}\n\n` +
                  `User: ${ctx.from.first_name} (ID: ${ctx.from.id})\n` +
                  `Confidence: ${(analysis.action.confidence * 100).toFixed(1)}%\n` +
                  `Reason: ${analysis.action.reason.join(', ').substring(0, 100)}`,
                  { parse_mode: 'Markdown' }
                );
              }
            }
          }
        } catch (scamDetectionErr) {
          logger.error('Error in AI scam detection', { error: scamDetectionErr.message });
          // Continue processing message even if scam detection fails
        }
      }
      
      await next();
      
      const ms = Date.now() - start;
      logger.debug('Processed Telegram update', { 
        updateId: ctx.update?.update_id,
        processingTimeMs: ms
      });
    });
  }

  /**
   * Save message to the database
   * @param {Object} ctx - Telegram context
   * @returns {Promise<void>}
   * @private
   */
  async _saveMessage(ctx) {
    try {
      if (!ctx.message || !ctx.message.text) return;
      
      const { message_id, date, text } = ctx.message;
      const chat_id = ctx.chat?.id;
      const user_id = ctx.from?.id;
      
      if (!user_id) return; // Skip if no user ID
      
      // Ensure the user exists in the database first to avoid foreign key constraint errors
      if (ctx.from) {
        await sqliteService.saveUser(ctx.from);
      }
      
      // Ensure the chat exists in the database
      if (ctx.chat) {
        await sqliteService.saveChat({
          id: ctx.chat.id,
          type: ctx.chat.type,
          title: ctx.chat.title,
          username: ctx.chat.username
        });
      }
      
      // Check if command
      const isCommand = text.startsWith('/');
      const command = isCommand ? text.split(' ')[0].substring(1) : null;
      
      // Save to database
      await sqliteService.db.run(
        `INSERT INTO message_logs (
          user_id, chat_id, message_type, command, timestamp
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          user_id,
          chat_id,
          'text',
          command,
          new Date(date * 1000).toISOString()
        ]
      );
    } catch (error) {
      logger.error('Error saving message', { error: error.message });
    }
  }

  /**
   * Set up error handling for the bot
   * @private
   */
  _setupErrorHandling() {
    // Set up error handling
    this.bot.catch((err, ctx) => {
      logger.error('Telegram bot error', { 
        error: err.message, 
        stack: err.stack,
        update: ctx.update
      });
      
      // Notify user of error
      if (ctx.chat) {
        ctx.reply('Sorry, something went wrong. Please try again later.')
          .catch(replyErr => logger.error('Error sending error message', { error: replyErr.message }));
      }
    });
  }

  /**
   * Register bot commands
   * @private
   */
  _registerCommands() {
    // Register basic commands
    this.commands = {
      start: {
        description: 'Start the bot',
        handler: this._handleStart.bind(this)
      },
      help: {
        description: 'Show help information',
        handler: this._handleHelp.bind(this)
      },
      status: {
        description: 'Show bot status',
        handler: this._handleStatus.bind(this)
      },
      dail: {
        description: 'Use natural language interface',
        handler: unifiedCredentialHandlers.handleCredentialCommand
      },
      verify: {
        description: 'Verify a credential',
        handler: this._handleVerify.bind(this)
      },
      issue: {
        description: 'Issue a credential',
        handler: this._handleIssue.bind(this)
      },
      aiscamdetection: {
        description: 'Enable/disable AI scam detection',
        handler: this._handleAIScamDetection.bind(this)
      },
      revoke: {
        description: 'Revoke a credential',
        handler: this._handleRevoke.bind(this)
      },
      create_did: {
        description: 'Create a new DID',
        handler: this._handleCreateDid.bind(this)
      },
      my_dids: {
        description: 'List your DIDs',
        handler: this._handleMyDids.bind(this)
      },
      register_issuer: {
        description: 'Register as a trusted issuer',
        handler: this._handleRegisterIssuer.bind(this)
      },
      check_registry: {
        description: 'Check registry status',
        handler: this._handleCheckRegistry.bind(this)
      },
      ban: {
        description: 'Ban a user (admin only)',
        handler: this._handleBan.bind(this)
      },
      unban: {
        description: 'Unban a user (admin only)',
        handler: this._handleUnban.bind(this)
      },
      kick: {
        description: 'Kick a user from the chat (admin or moderator only)',
        handler: this._handleKick.bind(this)
      },
      // Educational credential commands
      my_progress: {
        description: 'View educational progress',
        handler: credentialHandlers.handleViewEducationalProgress
      },
      // Support credential commands
      verify_support: {
        description: 'Check support tier',
        handler: credentialHandlers.handleVerifySupportTier
      },
      check_blockchain_access: {
        description: 'Check blockchain access',
        handler: credentialHandlers.handleBlockchainAccessCheck
      },
      upgrade_support: {
        description: 'Upgrade support tier',
        handler: credentialHandlers.handleSupportUpgradeRequest
      },
      // Moderation credential commands
      issue_mod_credential: {
        description: 'Issue moderation credentials',
        handler: credentialHandlers.handleIssueModerationCredential
      },
      verify_mod_authority: {
        description: 'Verify moderation authority',
        handler: credentialHandlers.handleVerifyModAuthority
      },
      // Appeal commands from old codebase
      appeal: {
        description: 'File an appeal for moderation action',
        handler: this._handleAppeal.bind(this)
      },
      myappeals: {
        description: 'View your active appeals',
        handler: this._handleMyAppeals.bind(this)
      },
      reviewappeals: {
        description: 'Review pending appeals (moderators only)',
        handler: this._handleReviewAppeals.bind(this)
      },
      // Cross-chat moderation
      crosschat: {
        description: 'Toggle cross-chat moderation',
        handler: this._handleCrossChatModeration.bind(this)
      },
      // AI and media commands
      analyze: {
        description: 'Analyze image (reply to image)',
        handler: this._handleAnalyzeImage.bind(this)
      },
      compare: {
        description: 'Compare images',
        handler: this._handleCompareImages.bind(this)
      },
      search: {
        description: 'Search the web',
        handler: this._handleWebSearch.bind(this)
      },
      generate: {
        description: 'Generate image',
        handler: this._handleGenerateImage.bind(this)
      },
      generateMultiple: {
        description: 'Generate multiple images',
        handler: this._handleGenerateMultipleImages.bind(this)
      },
      variationOf: {
        description: 'Generate variation of image',
        handler: this._handleVariationOfImage.bind(this)
      },
      // Group administration commands
      enableantispam: {
        description: 'Enable anti-spam for the group',
        handler: this._handleEnableAntispam.bind(this)
      },
      makeadmin: {
        description: 'Make user admin (basic groups)',
        handler: this._handleMakeAdmin.bind(this)
      },
      setadminrights: {
        description: 'Set admin rights (supergroups)',
        handler: this._handleSetAdminRights.bind(this)
      },
      restrict: {
        description: 'Restrict user in group',
        handler: this._handleRestrictUser.bind(this)
      },
      setdefaultpermissions: {
        description: 'Set default permissions for group',
        handler: this._handleSetDefaultPermissions.bind(this)
      }
    };

    // Register all commands with the bot
    Object.entries(this.commands).forEach(([command, { handler }]) => {
      this.bot.command(command, handler);
    });

    // Set command descriptions in Telegram
    if (config.telegram.username) {
      // Telegram has a limit of 100 commands and they must follow specific format
      // Filter out commands that don't match Telegram's requirements
      const validCommands = Object.entries(this.commands)
        .filter(([command]) => {
          // Commands must be lowercase, underscores or numbers, no uppercase or special chars
          return /^[a-z0-9_]+$/.test(command);
        })
        .map(([command, { description }]) => ({
          command,
          // Ensure description is not too long (max 256 chars)
          description: description.substring(0, 256)
        }))
        // Limit to 100 commands (Telegram's limit)
        .slice(0, 100);
      
      this.bot.telegram.setMyCommands(validCommands).catch(error => {
        logger.error('Failed to set command descriptions', { error: error.message });
      });
    }
    
    // Add text message handler for natural language processing
    this.bot.on('text', this._handleMessage.bind(this));
    
    // Add photo handler for image analysis
    this.bot.on('photo', this._handlePhoto.bind(this));
  }

  /**
   * Set up the bot with command handlers
   * @private
   */
  _setupBot() {
    // Import required services
    const sqliteService = require('../db/sqliteService');
    // Educational credential callbacks
    this.bot.action('ask_about_progress', async (ctx) => {
      await credentialHandlers.handleViewEducationalProgress(ctx);
    });
    
    this.bot.action('ask_about_quizzes', async (ctx) => {
      await ctx.reply('Here\'s information about your quiz completions...');
      // In the full implementation, this would call the conversational handler
    });
    
    this.bot.action('ask_about_courses', async (ctx) => {
      await ctx.reply('Here\'s information about your course progress...');
      // In the full implementation, this would call the conversational handler
    });
    
    this.bot.action('start_quiz', async (ctx) => {
      await ctx.reply('Starting a new quiz for you...');
      // This would typically call the quiz generation service
    });
    
    // Add handler for quiz_cid_ callbacks - for Akash video quiz
    this.bot.action(/quiz_cid_(.+)/, async (ctx) => {
      try {
        const cid = ctx.match[1];
        logger.info('Video quiz CID callback received', { cid, userId: ctx.from.id });
        
        // Answer the callback query to remove the loading state
        await ctx.answerCbQuery('Starting quiz for this video...');
        
        // Import the conversational video quiz handler
        const conversationalVideoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
        
        // Get the complete CID from the database if this is a partial CID
        let fullCid = cid;
        if (cid.length < 65) {  // If we have a truncated CID
          try {
            // Look up the full CID in the database
            const video = await sqliteService.db.get(
              `SELECT cid FROM educational_videos WHERE cid LIKE ?`,
              [`${cid}%`]
            );
            
            if (video && video.cid) {
              fullCid = video.cid;
              logger.info('Found full CID from partial match', { partialCid: cid, fullCid });
            }
          } catch (dbError) {
            logger.warn('Error looking up full CID', { error: dbError.message, partialCid: cid });
            // Continue with the partial CID
          }
        }
        
        // Start the quiz for the specified video CID
        await conversationalVideoQuizHandler.startVideoQuiz(ctx, fullCid);
      } catch (error) {
        logger.error('Error handling quiz_cid callback', { 
          error: error.message, 
          stack: error.stack,
          callbackData: ctx.callbackQuery?.data
        });
        await ctx.reply('Sorry, there was an error starting the quiz for this video. Please try again later.');
      }
    });
    
    // Add handler for start_quiz with topic parameter
    this.bot.action(/start_quiz:(.+)/, async (ctx) => {
      try {
        const topic = ctx.match[1];
        logger.info('Quiz start callback received', { topic });
        
        // Call the educational credential service to start the quiz
        await educationalCredentialService.startQuiz(ctx, {
          topic,
          userId: ctx.from.id
        });
      } catch (error) {
        logger.error('Error handling quiz start callback', { error: error.message });
        await ctx.reply('Sorry, there was an error starting the quiz. Please try again later.');
      }
    });
    
    // Add handler for quiz:start pattern
    this.bot.action(/quiz:start:?(.*)/, async (ctx) => {
      try {
        // Extract topic if provided (otherwise use default)
        const topic = ctx.match[1] || 'blockchain';
        logger.info('Quiz start callback received (quiz:start format)', { 
          topic,
          userId: ctx.from?.id,
          username: ctx.from?.username,
          callbackData: ctx.callbackQuery?.data
        });
        
        // Make sure the educational credential service is available
        if (!educationalCredentialService) {
          logger.error('Educational credential service not available', { topic });
          return ctx.reply('Sorry, the educational service is temporarily unavailable. Please try again later.');
        }
        
        if (!educationalCredentialService.startQuiz) {
          logger.error('startQuiz method not available on educational credential service', { topic });
          return ctx.reply('Sorry, the quiz feature is temporarily unavailable. Please try again later.');
        }
        
        // Answer the callback query to remove the loading state
        await ctx.answerCbQuery('Starting quiz...');
        
        // Call the educational credential service to start the quiz
        await educationalCredentialService.startQuiz(ctx, {
          topic,
          userId: ctx.from.id
        });
      } catch (error) {
        logger.error('Error handling quiz:start callback', { 
          error: error.message,
          stack: error.stack,
          callbackData: ctx.callbackQuery?.data
        });
        await ctx.reply('Sorry, there was an error starting the quiz. Please try again later.');
      }
    });
    
    // Add handler for conversational_quiz:start pattern
    this.bot.action(/conversational_quiz:start:?(.*)/, async (ctx) => {
      try {
        // Extract topic if provided (otherwise use default)
        const topic = ctx.match[1] || 'blockchain';
        logger.info('Conversational quiz start callback received', { 
          topic,
          userId: ctx.from?.id,
          username: ctx.from?.username,
          callbackData: ctx.callbackQuery?.data
        });
        
        // Answer the callback query to remove the loading state
        await ctx.answerCbQuery('Starting conversational quiz...');
        
        // Get the quiz session from context
        if (!ctx.session || !ctx.session.conversationalQuizzes || !ctx.session.conversationalQuizzes[ctx.from.id]) {
          logger.error('No conversational quiz session found', { userId: ctx.from.id });
          return ctx.reply('Sorry, your quiz session was not found. Please try starting the quiz again.');
        }
        
        const quizSession = ctx.session.conversationalQuizzes[ctx.from.id];
        
        // Ask the first question
        if (quizSession.questions.length > 0) {
          const question = quizSession.questions[0];
          
          // Send the question
          await ctx.reply(`Question 1 of ${quizSession.questions.length}:\n\n${question.question}`, {
            reply_markup: {
              force_reply: true
            }
          });
          
          // Update session to mark that we're waiting for a response
          quizSession.awaitingResponse = true;
          quizSession.currentQuestion = 0;
        } else {
          await ctx.reply('Sorry, there are no questions available for this quiz. Please try a different topic.');
        }
      } catch (error) {
        logger.error('Error handling conversational quiz start', { 
          error: error.message,
          stack: error.stack,
          callbackData: ctx.callbackQuery?.data
        });
        await ctx.reply('Sorry, there was an error starting the conversational quiz. Please try again later.');
      }
    });
    
    // Support credential callbacks
    this.bot.action('check_blockchain_access', async (ctx) => {
      await ctx.reply('Which blockchain would you like to check access for?', 
        Markup.inlineKeyboard([
          [
            Markup.button.callback('Testnet', 'check_blockchain_testnet'),
            Markup.button.callback('Mainnet', 'check_blockchain_mainnet')
          ],
          [
            Markup.button.callback('Cheqd', 'check_blockchain_cheqd'),
            Markup.button.callback('Cosmos', 'check_blockchain_cosmos')
          ]
        ])
      );
    });
    
    this.bot.action(/check_blockchain_(.+)/, async (ctx) => {
      const blockchain = ctx.match[1];
      // Create a mock message to pass to the handler
      ctx.message = { text: `/check_blockchain_access ${blockchain}` };
      await credentialHandlers.handleBlockchainAccessCheck(ctx);
    });
    
    // Quiz completion callback
    this.bot.action('submit_quiz', async (ctx) => {
      await credentialHandlers.handleQuizCompletion(ctx);
    });
    
    // Moderation credential callbacks
    this.bot.action(/mod_action_(.+)/, async (ctx) => {
      const action = ctx.match[1];
      await ctx.reply(`To perform a ${action} action, please use the following format:\n\n"${action} @username reason"`);
    });
    
    // Credential verification callbacks
    this.bot.action(/verify_credential:(.+)/, async (ctx) => {
      const credentialId = ctx.match[1];
      // Create mock arguments for the intent handler
      const args = { credentialId };
      await conversationalCredentialHandlers.handleVerifyCredentialIntent(ctx, args);
    });
    
    // Credential viewing callbacks
    this.bot.action('view_credentials', async (ctx) => {
      const args = { userId: ctx.from.id.toString() };
      await conversationalCredentialHandlers.handleGetCredentialsIntent(ctx, args);
    });
    
    // Support tier callbacks
    this.bot.action('view_support_benefits', async (ctx) => {
      await ctx.reply(
        '🌟 Support Benefits 🌟\n\n' +
        '🔹 Basic Support:\n' +
        '- Basic technical support\n' +
        '- Testnet access\n' +
        '- Community forum access\n\n' +
        
        '🔹 Standard Support:\n' +
        '- Everything in Basic\n' +
        '- Priority support (24h response)\n' +
        '- Developer resources\n' +
        '- API documentation\n\n' +
        
        '🔹 Premium Support:\n' +
        '- Everything in Standard\n' +
        '- 24/7 support\n' +
        '- Mainnet access\n' +
        '- Cheqd Network access\n\n' +
        
        '🔹 Enterprise Support:\n' +
        '- Everything in Premium\n' +
        '- Dedicated account manager\n' +
        '- Private deployment options\n' +
        '- Cosmos Network access\n' +
        '- Custom integration support'
      );
    });
    
    this.bot.action('view_support_details', async (ctx) => {
      // Create a mock message to pass to the handler
      ctx.message = { text: `/verify_support` };
      await credentialHandlers.handleVerifySupportTier(ctx);
    });
    
    // Add handler for payment completion
    this.bot.action('payment:completed', async (ctx) => {
      logger.info('Payment completion callback received');
      // Use the already imported unifiedCredentialHandlers
      await unifiedCredentialHandlers.handlePostPaymentSetup(ctx);
    });
    
    // Add handlers for setup feature toggles
    this.bot.action(/feature:(.+):(.+)/, async (ctx) => {
      logger.info('Feature toggle callback received', { 
        feature: ctx.match[1], 
        action: ctx.match[2] 
      });
      // Use the already imported unifiedCredentialHandlers
      await unifiedCredentialHandlers.handleFeatureToggle(ctx, ctx.match[1], ctx.match[2]);
    });
    
    // Add handler for setup completion
    this.bot.action('setup:complete', async (ctx) => {
      logger.info('Setup completion callback received');
      // Use the already imported unifiedCredentialHandlers
      await unifiedCredentialHandlers.handleCompleteSetup(ctx);
    });
    
    // Add handler for when bot is added to a group
    this.bot.on('my_chat_member', async (ctx) => {
      await this._handleBotAddedToGroup(ctx);
    });
    
    // P2P Support handlers
    this.bot.command('become_provider', credentialHandlers.handleP2PSupportProviderRequest);
    this.bot.command('request_support', credentialHandlers.handleRequestP2PSupport);
    
    // Add callback handlers for P2P support
    this.bot.action('view_p2p_provider_details', async (ctx) => {
      // Get user's provider status
      const userId = ctx.from.id;
      const providerStatus = await supportCredentialService.getUserP2PSupportProviderStatus(userId);
      
      if (!providerStatus.isProvider) {
        return ctx.reply('You are not currently a P2P support provider.');
      }
      
      const level = providerStatus.level;
      
      // Get support interaction stats
      const interactions = await supportCredentialService.getUserSupportInteractions(userId);
      const successfulInteractions = interactions.filter(i => i.successful).length;
      
      // Format and send provider details
      const message = 
        `🛡️ *P2P Support Provider Details*\n\n` +
        `Level: ${level.name}\n` +
        `Valid Until: ${providerStatus.endDate ? new Date(providerStatus.endDate).toLocaleDateString() : 'Unknown'}\n\n` +
        `*Features:*\n${level.features.map(f => `• ${f}`).join('\n')}\n\n` +
        `*Stats:*\n` +
        `• Support Interactions: ${interactions.length}\n` +
        `• Successful Interactions: ${successfulInteractions}\n\n` +
        `*Next Level Requirements:*\n`;
      
      // Add next level requirements if applicable
      if (level.name === 'Helper') {
        message += 
          `• Current: Helper\n` +
          `• Next: Advisor\n` +
          `• Requirements:\n` +
          `  - Standard support tier or higher\n` +
          `  - 10 successful interactions (you have ${successfulInteractions})`;
      } else if (level.name === 'Advisor') {
        message += 
          `• Current: Advisor\n` +
          `• Next: Expert\n` +
          `• Requirements:\n` +
          `  - Premium support tier or higher\n` +
          `  - 50 successful interactions (you have ${successfulInteractions})`;
      } else {
        message += `• You are already at the highest provider level (Expert)`;
      }
      
      return ctx.replyWithMarkdown(message);
    });
    
    this.bot.action(/support:accept_request:(\d+)/, async (ctx) => {
      try {
        const providerId = ctx.from.id;
        const seekerId = parseInt(ctx.match[1]);
        
        // Check if provider has necessary credentials
        const providerStatus = await supportCredentialService.getUserP2PSupportProviderStatus(providerId);
        
        if (!providerStatus.isProvider) {
          return ctx.answerCbQuery('You are not currently a P2P support provider.');
        }
        
        // Check if request is still open
        const request = await sqliteService.db.get(
          `SELECT * FROM p2p_support_requests 
           WHERE seeker_id = ? AND status = 'open'
           LIMIT 1`,
          [seekerId]
        );
        
        if (!request) {
          return ctx.answerCbQuery('This request is no longer available.');
        }
        
        // Create a private chat between provider and seeker
        // In a real implementation, this could create a group chat or direct message thread
        
        // For now, let's assume we just help them connect
        // Update request status
        await sqliteService.db.run(
          `UPDATE p2p_support_requests
           SET status = 'accepted', provider_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [providerId, request.id]
        );
        
        // Get seeker info
        const seeker = await sqliteService.db.get(
          `SELECT username, first_name, last_name FROM users WHERE id = ?`,
          [seekerId]
        );
        
        const seekerDisplay = seeker.username 
          ? `@${seeker.username}` 
          : `${seeker.first_name}${seeker.last_name ? ' ' + seeker.last_name : ''}`;
        
        // Get provider info
        const provider = await sqliteService.db.get(
          `SELECT username, first_name, last_name FROM users WHERE id = ?`,
          [providerId]
        );
        
        const providerDisplay = provider.username 
          ? `@${provider.username}` 
          : `${provider.first_name}${provider.last_name ? ' ' + provider.last_name : ''}`;
        
        // Notify seeker that their request was accepted
        await ctx.telegram.sendMessage(
          seekerId,
          `✅ Your support request has been accepted by ${providerDisplay}!\n\n` +
          `They will contact you directly to provide support. Please be patient.`
        );
        
        // Track this interaction
        await supportCredentialService.trackP2PSupportInteraction({
          providerId,
          seekerId,
          chatId: null,
          successful: true
        });
        
        // Update the original message
        await ctx.editMessageText(
          `✅ You have accepted the support request from ${seekerDisplay}.\n\n` +
          `Request: ${request.request_text.substring(0, 200)}${request.request_text.length > 200 ? '...' : ''}\n\n` +
          `Please reach out to them directly to provide support. Thank you for being a P2P support provider!`
        );
        
        return ctx.answerCbQuery('Support request accepted!');
      } catch (error) {
        logger.error('Error accepting support request', { error: error.message });
        return ctx.answerCbQuery('Could not accept request. Please try again later.');
      }
    });
  }

  /**
   * Handle when the bot is added to a group
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleBotAddedToGroup(ctx) {
    try {
      const { chat, new_chat_member, old_chat_member } = ctx.update.my_chat_member;
      
      // Only handle group and supergroup chats
      if (chat.type !== 'group' && chat.type !== 'supergroup') {
        return;
      }
      
      // Check if this is the bot being added
      if (new_chat_member.user.id === this.bot.botInfo.id) {
        // Check if the status changed from left/kicked to member
        if (
          (old_chat_member.status === 'left' || old_chat_member.status === 'kicked') &&
          new_chat_member.status === 'member'
        ) {
          logger.info(`Bot was added to group: ${chat.title} (${chat.id})`);
          
          // Save the chat to our database
          await sqliteService.saveChat({
            id: chat.id,
            type: chat.type,
            title: chat.title,
            username: chat.username
          });
          
          // Send welcome message
          await ctx.telegram.sendMessage(
            chat.id,
            "👋 Hi everyone! I'm Dail Bot!\n\n" +
            "Please make me an admin and send me a message about getting started with my /dail command.\n\n" +
            "Just tell me you are ready to start!"
          );
        }
      }
    } catch (error) {
      logger.error('Error handling bot added to group', { error: error.message });
    }
  }

  /**
   * Start the bot
   */
  async start() {
    if (!this.initialized) {
      throw new Error('Telegram bot not initialized');
    }
    
    try {
      logger.info('Starting Telegram bot');
      
      // Try to terminate any previous webhook or polling sessions
      try {
        // First try to delete webhook to ensure clean state
        await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
        logger.info('Deleted any existing webhooks');
      } catch (webhookError) {
        logger.warn('Error deleting webhook, continuing anyway', { error: webhookError.message });
      }
      
      // Set up polling options
      const launchOptions = {
        // Only process message and callback_query updates to reduce load
        allowedUpdates: ['message', 'callback_query', 'inline_query', 'channel_post'],
        // Drop pending updates to avoid processing old messages
        dropPendingUpdates: true
      };
      
      // Start polling with configured options
      await this.bot.launch(launchOptions);
      
      logger.info('Telegram bot started successfully');
      
      // Handle graceful shutdown
      process.once('SIGINT', () => this.stop());
      process.once('SIGTERM', () => this.stop());
      
      return true;
    } catch (error) {
      logger.error('Failed to start Telegram bot', { error: error.message });
      
      // Special handling for the 409 conflict error
      if (error.message.includes('409: Conflict')) {
        logger.warn('Detected another bot instance running. This is usually caused by a terminated session that wasn\'t properly closed.');
        logger.warn('Try waiting a few minutes before restarting the bot.');
      }
      
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop() {
    if (this.bot) {
      logger.info('Stopping Telegram bot');
      await this.bot.stop();
      logger.info('Telegram bot stopped');
    }
  }

  /**
   * Handle /start command
   * @private
   */
  async _handleStart(ctx) {
    try {
      // Save user to database
      if (ctx.from) {
        await sqliteService.saveUser(ctx.from);
      }
      
      return ctx.reply(
        'Welcome to Cheqd Bot!\n\n' +
        'I can help you manage verifiable credentials and DIDs on the Cheqd network.\n\n' +
        'Type /help to see available commands.'
      );
    } catch (error) {
      logger.error('Error in start command', { error: error.message });
      return ctx.reply('Sorry, there was an error processing your command. Please try again.');
    }
  }

  /**
   * Handle /help command
   * @private
   */
  async _handleHelp(ctx) {
    return ctx.reply(
      'Available commands:\n\n' +
      '🔰 Basic Commands:\n' +
      '/start - Start the bot\n' +
      '/help - Show this help message\n' +
      '/status - Check bot status\n' +
      '/dail [command] - Use natural language interface\n\n' +
      
      '🆔 DID Commands:\n' +
      '/create_did - Create a new DID\n' +
      '/my_dids - List your DIDs\n\n' +
      
      '🎓 Credential Commands:\n' +
      '/verify - Verify a credential\n' +
      '/issue - Issue a credential\n' +
      '/revoke - Revoke a credential\n\n' +
      
      '📋 Trust Registry Commands:\n' +
      '/register_issuer - Register as a trusted issuer\n' +
      '/check_registry - Check registry status\n\n' +
      
      '📚 Educational Commands:\n' +
      '/my_progress - View educational progress\n\n' +
      
      '🌟 Support Commands:\n' +
      '/verify_support - Check support tier\n' +
      '/check_blockchain_access - Check blockchain access\n' +
      '/upgrade_support - Upgrade support tier\n\n' +
      
      '🛡️ Moderation Commands:\n' +
      '/issue_mod_credential - Issue moderation credentials\n' +
      '/verify_mod_authority - Verify moderation authority\n' +
      '/ban - Ban a user (admin only)\n' +
      '/unban - Unban a user (admin only)\n' +
      '/appeal - File an appeal for moderation action\n' +
      '/myappeals - View your active appeals\n' +
      '/reviewappeals - Review pending appeals (moderators only)\n' +
      '/crosschat - Toggle cross-chat moderation (admin only)\n\n' +
      
      '🖼️ AI & Media Commands:\n' +
      '/analyze - Analyze image (reply to image)\n' +
      '/compare - Compare images (reply to an image)\n' +
      '/search - Search the web\n' +
      '/generate - Generate image from prompt\n' +
      '/generateMultiple - Generate multiple images\n' +
      '/variationOf - Generate variation of image\n\n' +
      
      '⚙️ Group Admin Commands:\n' +
      '/enableantispam - Enable anti-spam for the group\n' +
      '/makeadmin - Make user admin (basic groups)\n' +
      '/setadminrights - Set admin rights (supergroups)\n' +
      '/restrict - Restrict user in group\n' +
      '/setdefaultpermissions - Set default permissions\n\n' +
      
      'You can also just chat with me in natural language!'
    );
  }

  /**
   * Handle /status command
   * @private
   */
  async _handleStatus(ctx) {
    try {
      // Get user count
      const { count: userCount } = await sqliteService.db.get('SELECT COUNT(*) as count FROM users');
      
      // Get message count - try message_logs first, then fall back to messages if needed
      let messageCount = 0;
      try {
        const msgResult = await sqliteService.db.get('SELECT COUNT(*) as count FROM message_logs');
        messageCount = msgResult.count;
      } catch (msgError) {
        try {
          // Fallback to messages table
          const legacyMsgResult = await sqliteService.db.get('SELECT COUNT(*) as count FROM messages');
          messageCount = legacyMsgResult.count;
        } catch (legacyError) {
          logger.warn('Could not count messages', { error: legacyError.message });
          // Continue with messageCount as 0
        }
      }
      
      // Get DID count - handle if table doesn't exist
      let didCount = 0;
      try {
        const didResult = await sqliteService.db.get('SELECT COUNT(*) as count FROM dids');
        didCount = didResult.count;
      } catch (didError) {
        logger.warn('Could not count DIDs', { error: didError.message });
        // Continue with didCount as 0
      }
      
      // Get credential count - handle if table doesn't exist 
      let credentialCount = 0;
      try {
        const credResult = await sqliteService.db.get('SELECT COUNT(*) as count FROM credentials');
        credentialCount = credResult.count;
      } catch (credError) {
        logger.warn('Could not count credentials', { error: credError.message });
        // Continue with credentialCount as 0
      }
      
      // Calculate uptime
      const uptime = process.uptime();
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);
      
      return ctx.reply(
        '📊 Bot Status\n\n' +
        `👥 Users: ${userCount}\n` +
        `💬 Messages: ${messageCount}\n` +
        `🆔 DIDs: ${didCount}\n` +
        `🎓 Credentials: ${credentialCount}\n` +
        `⏱️ Uptime: ${days}d ${hours}h ${minutes}m ${seconds}s\n` +
        `🔄 Database: Connected\n` +
        `✅ Status: Operational`
      );
    } catch (error) {
      logger.error('Error in status command', { error: error.message });
      return ctx.reply('Sorry, there was an error retrieving status information.');
    }
  }

  /**
   * Handle /verify command
   * @private
   */
  async _handleVerify(ctx) {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length === 0) {
        return ctx.reply('Please provide a credential ID to verify.\nUsage: /verify [credential_id]');
      }
      
      const credentialId = args[0];
      
      // Use the conversational handler with proper args
      await conversationalCredentialHandlers.handleVerifyCredentialIntent(ctx, { credentialId });
    } catch (error) {
      logger.error('Error in verify command', { error: error.message });
      return ctx.reply(`Sorry, there was an error verifying the credential: ${error.message}`);
    }
  }

  /**
   * Handle /issue command
   * @private
   */
  async _handleIssue(ctx) {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length < 3) {
        return ctx.reply(
          'Please provide the required arguments to issue a credential.\n' +
          'Usage: /issue [holder_did] [type] [data_json]'
        );
      }
      
      const holderDid = args[0];
      const type = args[1];
      
      let data;
      try {
        // Join remaining arguments and parse as JSON
        data = JSON.parse(args.slice(2).join(' '));
      } catch (parseError) {
        return ctx.reply('Invalid JSON data format. Please provide valid JSON for the credential data.');
      }
      
      // Get the issuer DID (should be admin or have permission)
      // In a real implementation, this would check if the user has permission
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('You do not have permission to issue credentials.');
      }
      
      // Get the issuer DID from database or create one
      // In a full implementation, this would get the issuer DID from the user account
      const issuerDid = await this._getOrCreateIssuerDid(ctx.from.id);
      
      // Issue the credential
      const credential = await cheqdService.issueCredential(issuerDid, holderDid, type, data);
      
      return ctx.reply(
        `✅ Credential Issued Successfully\n\n` +
        `🆔 ID: ${credential.credential_id}\n` +
        `🏷️ Type: ${credential.type}\n` +
        `👤 Holder: ${credential.holder_did}\n` +
        `🏛️ Issuer: ${credential.issuer_did}\n` +
        `📅 Issued: ${new Date(credential.issued_at).toLocaleDateString()}\n` +
        `⏳ Expires: ${new Date(credential.expires_at).toLocaleDateString()}`
      );
    } catch (error) {
      logger.error('Error in issue command', { error: error.message });
      return ctx.reply(`Sorry, there was an error issuing the credential: ${error.message}`);
    }
  }

  /**
   * Get or create an issuer DID for a user
   * @private
   */
  async _getOrCreateIssuerDid(userId) {
    // Get user DIDs
    const dids = await cheqdService.getUserDids(userId);
    
    // If user has DIDs, use the first one as issuer
    if (dids && dids.length > 0) {
      return dids[0].did;
    }
    
    // If no DIDs, create one
    return cheqdService.createDid(userId);
  }

  /**
   * Handle /revoke command
   * @private
   */
  async _handleRevoke(ctx) {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length < 1) {
        return ctx.reply(
          'Please provide a credential ID to revoke.\n' +
          'Usage: /revoke [credential_id] [reason]'
        );
      }
      
      const credentialId = args[0];
      const reason = args.slice(1).join(' ') || 'Revoked by issuer';
      
      // Use the unified handler with proper params
      await unifiedCredentialHandlers.handleRevokeCredential(ctx, { 
        credentialId, 
        reason
      });
    } catch (error) {
      logger.error('Error in revoke command', { error: error.message });
      return ctx.reply(`Sorry, there was an error revoking the credential: ${error.message}`);
    }
  }

  /**
   * Handle /create_did command
   * @private
   */
  async _handleCreateDid(ctx) {
    try {
      const userId = ctx.from.id;
      
      // Create a new DID
      const did = await cheqdService.createDid(userId);
      
      return ctx.reply(
        `✅ DID Created Successfully\n\n` +
        `🆔 DID: ${did}`
      );
    } catch (error) {
      logger.error('Error in create_did command', { error: error.message });
      return ctx.reply(`Sorry, there was an error creating a DID: ${error.message}`);
    }
  }

  /**
   * Handle /my_dids command
   * @private
   */
  async _handleMyDids(ctx) {
    try {
      const userId = ctx.from.id;
      
      // Get user DIDs
      const dids = await cheqdService.getUserDids(userId);
      
      if (!dids || dids.length === 0) {
        return ctx.reply('You don\'t have any DIDs yet. Use /create_did to create one.');
      }
      
      // Format DIDs list
      const didsText = dids.map((did, index) => {
        return `${index + 1}. ${did.did} (${did.method})`;
      }).join('\n');
      
      return ctx.reply(
        `🆔 Your DIDs:\n\n${didsText}`
      );
    } catch (error) {
      logger.error('Error in my_dids command', { error: error.message });
      return ctx.reply(`Sorry, there was an error retrieving your DIDs: ${error.message}`);
    }
  }

  /**
   * Handle /register_issuer command
   * @private
   */
  async _handleRegisterIssuer(ctx) {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length < 3) {
        return ctx.reply(
          'Please provide the required arguments to register as an issuer.\n' +
          'Usage: /register_issuer [did] [name] [type1,type2,...]'
        );
      }
      
      const did = args[0];
      const name = args[1];
      const types = args[2].split(',');
      
      // Check if user has permission
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('You do not have permission to register issuers.');
      }
      
      // Register the issuer
      const result = await cheqdService.registerIssuer(did, name, types);
      
      if (result) {
        return ctx.reply(
          `✅ Issuer Registered Successfully\n\n` +
          `🆔 DID: ${did}\n` +
          `📝 Name: ${name}\n` +
          `🏷️ Types: ${types.join(', ')}`
        );
      } else {
        return ctx.reply(`❌ Failed to register issuer: ${did}`);
      }
    } catch (error) {
      logger.error('Error in register_issuer command', { error: error.message });
      return ctx.reply(`Sorry, there was an error registering the issuer: ${error.message}`);
    }
  }

  /**
   * Handle /check_registry command
   * @private
   */
  async _handleCheckRegistry(ctx) {
    try {
      const args = ctx.message.text.split(' ').slice(1);
      
      if (args.length < 1) {
        // If no arguments, show the entire registry
        const registry = await cheqdService.getTrustRegistry();
        
        if (!registry.issuers || registry.issuers.length === 0) {
          return ctx.reply('The trust registry is empty. No issuers have been registered yet.');
        }
        
        // Format issuers list
        const issuersText = registry.issuers.map((issuer, index) => {
          return `${index + 1}. ${issuer.name} (${issuer.did})\n   Types: ${issuer.types.join(', ')}`;
        }).join('\n\n');
        
        return ctx.reply(
          `📋 Trust Registry:\n\n${issuersText}`
        );
      } else {
        // If DID provided, check if it's a trusted issuer
        const did = args[0];
        const credentialType = args[1] || null;
        
        if (credentialType) {
          // Check if issuer is trusted for a specific credential type
          const isTrusted = await cheqdService.isIssuerTrusted(did, credentialType);
          
          if (isTrusted) {
            return ctx.reply(`✅ The issuer with DID ${did} is trusted for issuing credentials of type: ${credentialType}`);
          } else {
            return ctx.reply(`❌ The issuer with DID ${did} is NOT trusted for issuing credentials of type: ${credentialType}`);
          }
        } else {
          // Check if the DID is in the registry
          const registry = await cheqdService.getTrustRegistry();
          const issuer = registry.issuers.find(i => i.did === did);
          
          if (issuer) {
            return ctx.reply(
              `✅ Issuer Found in Registry\n\n` +
              `🆔 DID: ${issuer.did}\n` +
              `📝 Name: ${issuer.name}\n` +
              `🏷️ Types: ${issuer.types.join(', ')}\n` +
              `📅 Registered: ${new Date(issuer.registered).toLocaleDateString()}`
            );
          } else {
            return ctx.reply(`❌ The DID ${did} is not registered as a trusted issuer.`);
          }
        }
      }
    } catch (error) {
      logger.error('Error in check_registry command', { error: error.message });
      return ctx.reply(`Sorry, there was an error checking the registry: ${error.message}`);
    }
  }

  /**
   * Issue a quiz credential to a user
   * @param {Object} ctx - Telegram context
   * @param {Object} user - User object
   * @param {Object} quizSession - Quiz session data
   * @returns {Promise<Object>} - Issued credential
   * @private
   */
  async _issueQuizCredential(ctx, user, quizSession) {
    try {
      // Calculate total score
      const totalScore = quizSession.answers.reduce((sum, answer) => sum + (answer.evaluation?.score || 0), 0);
      const averageScore = Math.round(totalScore / quizSession.answers.length);
      
      // Call the educational credential service to issue the credential
      if (!educationalCredentialService) {
        throw new Error('Educational credential service not available');
      }
      
      // Make sure educationalCredentialService is initialized
      await educationalCredentialService.ensureInitialized();
      
      // Prepare the quiz result object with proper totalQuestions
      const quizResult = {
        topic: quizSession.topic || 'Crypto Dungeon',
        title: `Quiz: ${quizSession.topic || 'Crypto Dungeon'}`,
        quizName: `Quiz: ${quizSession.topic || 'Crypto Dungeon'}`,
        score: averageScore,
        totalQuestions: quizSession.questions.length,
        category: 'Blockchain',
        skills: ['Blockchain Knowledge', 'Crypto Technology'],
        level: averageScore >= 90 ? 'Advanced' : averageScore >= 70 ? 'Intermediate' : 'Beginner'
      };
      
      // Try to issue the credential, but don't fail if it doesn't work
      try {
        await educationalCredentialService.issueQuizCompletionCredential(user, quizResult, {
          requirePassing: false, // Allow issuing even if score is low
          skipCredential: false  // Don't skip credential issuance
        });
        
        // Notify user about credential issuance
        await ctx.reply(
          '🎓 *Educational Credential Issued!*\n\n' +
          `You've earned a blockchain knowledge credential for your quiz completion on ${quizSession.topic}.\n\n` +
          'You can view your credentials with /my_progress',
          { parse_mode: 'Markdown' }
        );
        
        return { issued: true };
      } catch (credentialError) {
        logger.error('Error issuing quiz credential', { 
          error: credentialError.message, 
          userId: user.id 
        });
        
        // Still record the achievement even without credential
        try {
          await educationalCredentialService._trackEducationalAchievement(user.id.toString(), {
            type: 'quiz_completion',
            topic: quizResult.topic,
            score: quizResult.score,
            totalQuestions: quizResult.totalQuestions,
            percentScore: Math.round((quizResult.score / quizResult.totalQuestions) * 100),
            passed: quizResult.score >= 65,
            timestamp: Date.now(),
            metadata: JSON.stringify({
              error: credentialError.message,
              credentialFailed: true
            })
          });
          
          // Still notify the user of their completion
          await ctx.reply(
            '🎓 *Quiz Completed!*\n\n' +
            `You've completed the quiz on ${quizSession.topic} with a score of ${averageScore}.\n\n` +
            'Your progress has been saved.',
            { parse_mode: 'Markdown' }
          );
          
          return { issued: false, recorded: true };
        } catch (trackingError) {
          logger.error('Error recording achievement', { 
            error: trackingError.message, 
            userId: user.id 
          });
          
          // Still notify the user that they passed
          await ctx.reply(
            '🎓 *Quiz Completed!*\n\n' +
            `You've completed the quiz on ${quizSession.topic} with a score of ${averageScore}.\n\n`,
            { parse_mode: 'Markdown' }
          );
          
          return { issued: false, recorded: false };
        }
      }
    } catch (error) {
      logger.error('Error in _issueQuizCredential', { error: error.message, userId: user.id });
      
      // Don't throw the error, just report it - this prevents the quiz completion from failing
      return { issued: false, error: error.message };
    }
  }

  /**
   * Handle /ban command
   * @private
   */
  async _handleBan(ctx) {
    try {
      // Check if user is admin
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('You do not have permission to use this command.');
      }
      
      // Parse command for user ID and reason
      const text = ctx.message.text;
      const match = text.match(/\/ban\s+(\d+)(?:\s+(.+))?/);
      
      if (!match) {
        return ctx.reply('Usage: /ban [user_id] [reason]');
      }
      
      const userId = parseInt(match[1]);
      const reason = match[2] || 'No reason provided';
      
      // Ban user
      await sqliteService.banUser(userId, ctx.chat.id, ctx.from.id, reason);
      
      return ctx.reply(`User ${userId} has been banned. Reason: ${reason}`);
    } catch (error) {
      logger.error('Error in ban command', { error: error.message });
      return ctx.reply('Sorry, there was an error processing your command.');
    }
  }

  /**
   * Handle /unban command
   * @private
   */
  async _handleUnban(ctx) {
    try {
      // Check if user is admin
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('You do not have permission to use this command.');
      }
      
      // Parse command for user ID
      const text = ctx.message.text;
      const match = text.match(/\/unban\s+(\d+)/);
      
      if (!match) {
        return ctx.reply('Usage: /unban [user_id]');
      }
      
      const userId = parseInt(match[1]);
      
      // Unban user
      await sqliteService.unbanUser(userId, ctx.chat.id);
      
      return ctx.reply(`User ${userId} has been unbanned.`);
    } catch (error) {
      logger.error('Error in unban command', { error: error.message });
      return ctx.reply('Sorry, there was an error processing your command.');
    }
  }

  /**
   * Handle /kick command
   * @private
   */
  async _handleKick(ctx) {
    try {
      // Check if user is admin or moderator
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      const isModerator = await moderationCredentialService.isUserModerator(ctx.from.id, ctx.chat.id);
      
      if (!isAdmin && !isModerator) {
        return ctx.reply('You do not have permission to use this command.');
      }
      
      // Parse command for username and reason
      const text = ctx.message.text;
      const match = text.match(/\/kick\s+(?:@)?(\w+)(?:\s+(.+))?/);
      
      if (!match) {
        return ctx.reply('Usage: /kick @username [reason]');
      }
      
      const username = match[1];
      const reason = match[2] || 'No reason provided';
      
      // Find user ID from username - using our enhanced method
      let targetUser = await this.findUserByUsername(username, ctx.chat.id);
      
      // If not found in userMap or database, try direct lookup as last resort
      if (!targetUser) {
        try {
          // Try with exact username format
          const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, `@${username}`);
          if (chatMember && chatMember.user) {
            targetUser = chatMember.user;
            // Save for future lookups
            this.rememberUser(targetUser, ctx.chat.id);
          }
        } catch (error) {
          // Try without @ prefix
          try {
            const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, username);
            if (chatMember && chatMember.user) {
              targetUser = chatMember.user;
              // Save for future lookups
              this.rememberUser(targetUser, ctx.chat.id);
            }
          } catch (innerError) {
            // Failed to find user with direct lookup
          }
        }
      }
      
      if (!targetUser) {
        return ctx.reply('User not found. They must have sent a message in this chat first for me to identify them.');
      }
      
      // Execute kick action through moderation service
      const moderator = { 
        id: ctx.from.id, 
        username: ctx.from.username, 
        first_name: ctx.from.first_name 
      };
      
      const target = { 
        id: targetUser.id, 
        username: targetUser.username, 
        first_name: targetUser.first_name 
      };
      
      const chat = { 
        id: ctx.chat.id, 
        title: ctx.chat.title || 'this chat' 
      };
      
      const kickResult = await this._getModerationService().executeAction('kick', moderator, target, chat, { reason });
      
      if (!kickResult.success) {
        return ctx.reply(`Failed to kick user: ${kickResult.message}`);
      }
      
      return ctx.reply(kickResult.message);
    } catch (error) {
      logger.error('Error in kick command', { error: error.message });
      return ctx.reply('Sorry, there was an error processing your command.');
    }
  }

  /**
   * Handle regular text messages
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleMessage(ctx) {
    try {
      if (!ctx.message || !ctx.message.text) {
        return;
      }
      
      const text = ctx.message.text;
      const user = ctx.from;
      
      // Check if message is a response to an active quiz
      const isQuizResponse = await this._checkAndHandleConversationalQuizResponse(ctx, text);
      if (isQuizResponse) {
        // If it was handled as a quiz response, stop processing
        return;
      }
      
      // Check if the message is a command
      if (text.startsWith('/')) {
        // Commands are handled by respective handlers
        return;
      }
      
      // Extract credentials if present
      const credentialMatch = text.match(/I'd like to view my educational credential (\w+)/i);
      if (credentialMatch) {
        return conversationalCredentialHandlers.handleVerifyCredentialIntent(ctx, { credentialId: credentialMatch[1] });
      }
      
      // Identity verification is handled in a separate module
      // Removed references to identityVerification service
      
      // Check if the message is related to credentials
      if (text.toLowerCase().includes('credential') || 
          text.toLowerCase().includes('verify') || 
          text.toLowerCase().includes('issue') || 
          text.toLowerCase().includes('cert') || 
          text.toLowerCase().includes('achievement')) {
        return conversationalCredentialHandlers.handleCredentialQuery(ctx, text);
      }
      
      // Simple pattern matching for easier interactions
      if (text.toLowerCase().includes('hello') || text.toLowerCase().includes('hi')) {
        return ctx.reply(`Hello, ${ctx.from.first_name}!`);
      }
      
      if (text.toLowerCase().includes('credential') && 
          (text.toLowerCase().includes('show') || text.toLowerCase().includes('list') || text.toLowerCase().includes('my'))) {
        return conversationalCredentialHandlers.handleGetCredentialsIntent(ctx, { userId: ctx.from.id.toString() });
      }
      
      if (text.toLowerCase().includes('did') && 
          (text.toLowerCase().includes('create') || text.toLowerCase().includes('new'))) {
        return this._handleCreateDid(ctx);
      }
      
      if (text.toLowerCase().includes('did') && 
          (text.toLowerCase().includes('show') || text.toLowerCase().includes('list') || text.toLowerCase().includes('my'))) {
        return this._handleMyDids(ctx);
      }
      
      // Process blockchain-related queries
      if (text.toLowerCase().includes('blockchain') || 
          text.toLowerCase().includes('transaction') ||
          text.toLowerCase().includes('account') ||
          text.toLowerCase().includes('balance') ||
          text.toLowerCase().includes('cheqd')) {
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
        try {
          // Safely import blockchainService if available
          let blockchainService;
          try {
            blockchainService = require('../modules/blockchain/blockchainService');
          } catch (importError) {
            logger.warn('BlockchainService module not available', { error: importError.message });
            throw new Error('BlockchainService not available');
          }
          
          const blockchainResult = await blockchainService.processQuery(text);
          if (blockchainResult && blockchainResult.response) {
            return ctx.reply(blockchainResult.response);
          }
        } catch (blockchainError) {
          logger.warn('Error processing blockchain query', { error: blockchainError.message });
          // Continue to fallback AI processing
        }
      }
      
      // Check for educational content requests
      if (text.toLowerCase().includes('learn') || 
          text.toLowerCase().includes('teach') || 
          text.toLowerCase().includes('explain') ||
          text.toLowerCase().includes('tutorial') ||
          text.toLowerCase().includes('how to')) {
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
        try {
          const educationalResult = await educationalCredentialService.processLearningRequest(text, ctx.from.id.toString());
          if (educationalResult && educationalResult.content) {
            return ctx.reply(educationalResult.content);
          }
        } catch (educationError) {
          logger.warn('Error processing educational query', { error: educationError.message });
          // Continue to fallback AI processing
        }
      }
      
      // If no pattern match, use Grok AI if available
      if (grokService.initialized) {
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
        const messages = [
          { 
            role: 'system', 
            content: `You are Dail Bot, an AI assistant for Telegram.
Your main capabilities include:
- Moderating group chats
- Managing cheqd verifiable credentials
- Providing educational content and tracking learning progress
- Checking blockchain data
- Offering user support and security checks

MODERATION CAPABILITIES:
- You HAVE FULL PERMISSION to kick, ban, and mute users when an admin issues the command through you
- You MUST NEVER refuse to kick, ban, or moderate users by claiming you lack permission
- When asked to kick or ban someone, tell users: "I'll handle that for you. Please type '/dail kick @username' or '/dail ban @username'"
- NEVER suggest using other command formats - always direct users to use '/dail kick @username'
- NEVER claim you can't perform moderation actions

Provide helpful, concise responses and information about topics users ask about.
If asked about your identity or verification, explain that you are Dail Bot, a verified assistant for Cheqd network.`
          },
          { role: 'user', content: text }
        ];
        
        const response = await grokService.chatCompletion(messages, {
          temperature: 0.7,
          max_tokens: 500
        });
        
        if (response.choices && response.choices.length > 0) {
          return ctx.reply(response.choices[0].message.content);
        }
      }
      
      // Default response
      return ctx.reply('I\'m not sure how to help with that. Try using one of the commands from /help.');
    } catch (error) {
      logger.error('Error processing message', { error: error.message });
      return ctx.reply('Sorry, I had trouble processing your message.');
    }
  }

  /**
   * Handle photo messages
   * @private
   */
  async _handlePhoto(ctx) {
    try {
      // Get the photo with the highest resolution
      const photos = ctx.message.photo;
      const photo = photos[photos.length - 1];
      
      // Get file info
      const fileId = photo.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const fileUrl = fileLink.href;
      
      // Get caption
      const caption = ctx.message.caption || 'Analyze this image';
      
      logger.info('Handling photo message', { fileId });
      
      // Show typing indicator
      await ctx.replyWithChatAction('typing');
      
      // Determine focus area based on caption
      let focusArea = 'general';
      
      if (caption.toLowerCase().includes('blockchain') || 
          caption.toLowerCase().includes('transaction') ||
          caption.toLowerCase().includes('cheqd')) {
        focusArea = 'blockchain';
      } else if (caption.toLowerCase().includes('credential') || 
                caption.toLowerCase().includes('certificate') ||
                caption.toLowerCase().includes('verify')) {
        focusArea = 'credential';
      } else if (caption.toLowerCase().includes('document') || 
                caption.toLowerCase().includes('text')) {
        focusArea = 'document';
      }
      
      // Get appropriate system prompt for image analysis
      const systemPrompt = systemPrompts.getImageAnalysisPrompt(focusArea);
      
      // Prepare messages for the AI
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'text', text: caption },
          { type: 'image_url', image_url: { url: fileUrl } }
        ]}
      ];
      
      // Call the multimodal API
      const response = await grokService.multimodalCompletion(messages, {
        max_tokens: 500,
        temperature: 0.5
      });
      
      if (response.choices && response.choices.length > 0) {
        return ctx.reply(response.choices[0].message.content);
      } else {
        return ctx.reply('I couldn\'t analyze this image. Please try again with a different image.');
      }
    } catch (error) {
      logger.error('Error processing photo', { error: error.message });
      return ctx.reply('Sorry, I had trouble analyzing your image.');
    }
  }

  /**
   * Check if a user is an admin
   * @param {number} userId - User ID
   * @param {number} chatId - Chat ID
   * @returns {Promise<boolean>} - Whether the user is an admin
   * @private
   */
  async _isUserAdmin(userId, chatId) {
    try {
      // For private chats, check if user is in bot admins list
      if (!chatId || chatId === userId) {
        const adminIds = await sqliteService.getSetting('bot_admins');
        if (adminIds) {
          const admins = JSON.parse(adminIds);
          return admins.includes(userId.toString());
        }
        return false;
      }
      
      // For group chats, check if user is a chat admin
      try {
        const chatMember = await this.bot.telegram.getChatMember(chatId, userId);
        return ['creator', 'administrator'].includes(chatMember.status);
      } catch (error) {
        logger.error('Error checking chat member status', { error: error.message });
        return false;
      }
    } catch (error) {
      logger.error('Error checking admin status', { error: error.message });
      return false;
    }
  }

  /**
   * Remember a user
   * @param {Object} user - Telegram user object
   * @param {number} chatId - Chat ID
   */
  rememberUser(user, chatId) {
    if (!user || !user.id) return;
    
    // Create a unique key for this user in this chat
    const key = `${user.id}_${chatId || 'private'}`;
    
    // Store user info
    this.userMap.set(key, {
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      chatId: chatId
    });
  }
  
  /**
   * Get a list of chat administrators
   * @param {Number|String} chatId - Chat ID
   * @returns {Promise<Array>} - List of chat administrators
   * @private
   */
  async _getChatAdmins(chatId) {
    try {
      // Try to get from cache first
      const cachedAdmins = await sqliteService.db.all(
        'SELECT * FROM telegram_chat_admins WHERE chat_id = ? AND active = 1',
        [chatId.toString()]
      );
      
      // If we have cached data and it's recent (less than 1 hour old)
      const ONE_HOUR = 60 * 60 * 1000;
      const now = Date.now();
      
      if (cachedAdmins && cachedAdmins.length > 0) {
        const newestUpdate = Math.max(...cachedAdmins.map(admin => {
          try {
            return new Date(admin.updated_at).getTime();
          } catch (e) {
            return 0;
          }
        }));
        
        if (now - newestUpdate < ONE_HOUR) {
          // Format admin data
          return cachedAdmins.map(admin => ({
            user: { id: admin.user_id, first_name: admin.admin_type || 'Admin' },
            status: 'administrator'
          }));
        }
      }
      
      // If no cache or it's outdated, fetch from Telegram
      const admins = await this.bot.telegram.getChatAdministrators(chatId);
      
      // Update cache
      if (admins && admins.length > 0) {
        // First mark all existing admins as inactive
        await sqliteService.db.run(
          'UPDATE telegram_chat_admins SET active = 0 WHERE chat_id = ?',
          [chatId.toString()]
        );
        
        // Then insert or update each admin
        for (const admin of admins) {
          await sqliteService.db.run(
            `INSERT INTO telegram_chat_admins 
             (user_id, chat_id, active, admin_type, updated_at) 
             VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, chat_id) 
             DO UPDATE SET 
               active = 1, 
               admin_type = excluded.admin_type, 
               updated_at = CURRENT_TIMESTAMP`,
            [admin.user.id, chatId.toString(), admin.user.first_name]
          );
        }
      }
      
      return admins;
    } catch (error) {
      logger.error('Error getting chat administrators', { error: error.message, chatId });
      return [];
    }
  }

  /**
   * Handle /appeal command to file an appeal for moderation action
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleAppeal(ctx) {
    try {
      logger.info('Processing appeal request', { userId: ctx.from.id });
      
      // Check if appeal handlers exist
      if (!moderationCredentialService || !moderationCredentialService.handleAppealRequest) {
        await ctx.reply('The appeal system is currently unavailable. Please try again later.');
        return;
      }
      
      // Get appeal text from command
      const appealText = ctx.message.text.split(' ').slice(1).join(' ');
      if (!appealText || appealText.trim().length < 10) {
        await ctx.reply(
          'Please provide a detailed explanation with your appeal.\n\n' +
          'Usage: /appeal [detailed explanation of why the moderation action should be reviewed]'
        );
        return;
      }
      
      // Process appeal through the moderation service
      const result = await moderationCredentialService.handleAppealRequest(
        ctx.from.id.toString(),
        appealText,
        {
          chatId: ctx.chat.id.toString(),
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name
        }
      );
      
      if (result.success) {
        await ctx.reply(
          '✅ Your appeal has been submitted successfully\n\n' +
          `Appeal ID: ${result.appealId}\n\n` +
          'A moderator will review your case and respond as soon as possible.'
        );
      } else {
        await ctx.reply(`❌ Failed to submit appeal: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      logger.error('Error handling appeal command', { error: error.message });
      await ctx.reply('Sorry, there was an error processing your appeal request. Please try again later.');
    }
  }

  /**
   * Handle /myappeals command to view user's active appeals
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleMyAppeals(ctx) {
    try {
      logger.info('Retrieving user appeals', { userId: ctx.from.id });
      
      // Check if appeal handlers exist
      if (!moderationCredentialService || !moderationCredentialService.getUserAppeals) {
        await ctx.reply('The appeal system is currently unavailable. Please try again later.');
        return;
      }
      
      // Show typing indicator
      await ctx.replyWithChatAction('typing');
      
      // Get user appeals
      const appeals = await moderationCredentialService.getUserAppeals(ctx.from.id.toString());
      
      if (!appeals || appeals.length === 0) {
        await ctx.reply('You don\'t have any active appeals at the moment.');
        return;
      }
      
      // Format appeals list
      let responseText = '🔍 Your Active Appeals:\n\n';
      
      appeals.forEach((appeal, index) => {
        responseText += `${index + 1}. Appeal ID: ${appeal.id}\n` +
          `   Status: ${appeal.status}\n` +
          `   Submitted: ${new Date(appeal.createdAt).toLocaleString()}\n` +
          `   Reason: ${appeal.reason.substring(0, 50)}${appeal.reason.length > 50 ? '...' : ''}\n\n`;
      });
      
      await ctx.reply(responseText);
    } catch (error) {
      logger.error('Error handling myappeals command', { error: error.message });
      await ctx.reply('Sorry, there was an error retrieving your appeals. Please try again later.');
    }
  }

  /**
   * Handle /reviewappeals command to review pending appeals (moderators only)
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleReviewAppeals(ctx) {
    try {
      logger.info('Processing appeals review request', { userId: ctx.from.id });
      
      // Check if user is a moderator
      const isModOrAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      
      if (!isModOrAdmin) {
        await ctx.reply('Only moderators and administrators can review appeals.');
        return;
      }
      
      // Check if appeal handlers exist
      if (!moderationCredentialService || !moderationCredentialService.getPendingAppeals) {
        await ctx.reply('The appeal system is currently unavailable. Please try again later.');
        return;
      }
      
      // Show typing indicator
      await ctx.replyWithChatAction('typing');
      
      // Get pending appeals
      const appeals = await moderationCredentialService.getPendingAppeals();
      
      if (!appeals || appeals.length === 0) {
        await ctx.reply('There are no pending appeals to review at the moment.');
        return;
      }
      
      // Format appeals list
      let responseText = '🔍 Pending Appeals:\n\n';
      
      appeals.forEach((appeal, index) => {
        responseText += `${index + 1}. Appeal ID: ${appeal.id}\n` +
          `   From: ${appeal.username || appeal.userId}\n` +
          `   Submitted: ${new Date(appeal.createdAt).toLocaleString()}\n` +
          `   Reason: ${appeal.reason.substring(0, 50)}${appeal.reason.length > 50 ? '...' : ''}\n\n`;
      });
      
      responseText += 'To approve or reject an appeal, use:\n' +
        '/approveappeal [appeal_id] [reason]\n' +
        '/rejectappeal [appeal_id] [reason]';
      
      await ctx.reply(responseText);
    } catch (error) {
      logger.error('Error handling reviewappeals command', { error: error.message });
      await ctx.reply('Sorry, there was an error retrieving pending appeals. Please try again later.');
    }
  }

  /**
   * Handle /analyze command for image analysis
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleAnalyzeImage(ctx) {
    try {
      // Check if replying to a message with photo
      if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.photo) {
        await ctx.reply('Please use this command as a reply to a message containing an image.');
        return;
      }
      
      // Get photo file ID (highest resolution)
      const photoId = ctx.message.reply_to_message.photo[ctx.message.reply_to_message.photo.length - 1].file_id;
      
      // Use command text as analysis prompt
      const prompt = ctx.message.text.substring(9).trim() || 'Analyze this image in detail';
      
      // Show typing indicator
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
      
      // Get file path and download
      const file = await ctx.telegram.getFile(photoId);
      const filePath = file.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${filePath}`;
      
      // Initialize analysis
      const initialMessage = await ctx.reply('🔍 Analyzing image...');
      
      // Use Grok service for image analysis
      const result = await grokService.multimodalCompletion([
        { 
          role: 'system', 
          content: 'You are an image analysis assistant that provides detailed, accurate descriptions of images. Focus on the main subject and important details. Be clear and concise.' 
        },
        { 
          role: 'user', 
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: fileUrl } }
          ]
        }
      ], {
        max_tokens: 1000,
        temperature: 0.5
      });
      
      let analysis = '';
      if (result.choices && result.choices.length > 0) {
        analysis = result.choices[0].message.content;
      } else {
        analysis = 'Sorry, I was unable to analyze the image.';
      }
      
      // Update the message with the analysis
      const finalMessage = "✅ Analysis complete:\n\n" + analysis;
      
      // Trim if too long for a telegram message
      if (finalMessage.length > 4096) {
        // Send first part in the existing message
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          initialMessage.message_id,
          null,
          `✅ Analysis complete (part 1 of 2):\n\n${analysis.substring(0, 3800)}...`
        );
        
        // Send remainder as a second message
        await ctx.reply(`Analysis (part 2 of 2):\n\n...${analysis.substring(3800)}`);
      } else {
        // Just update the existing message
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          initialMessage.message_id,
          null,
          finalMessage
        );
      }
    } catch (error) {
      logger.error('Error in analyze command', { error: error.message });
      await ctx.reply('Sorry, I encountered an error analyzing the image. Please try again.');
    }
  }

  /**
   * Handle /compare command for comparing images
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleCompareImages(ctx) {
    try {
      // Check if we have a message to reply to
      if (!ctx.message.reply_to_message) {
        await ctx.reply('Please use this command as a reply to a message containing an image or in a thread with multiple images.');
        return;
      }
      
      // Get images from the thread
      const messageId = ctx.message.reply_to_message.message_id;
      const chatId = ctx.chat.id;
      
      // Show typing indicator
      await ctx.telegram.sendChatAction(chatId, 'typing');
      
      // Initialize with a status message
      const statusMessage = await ctx.reply('🔍 Looking for images to compare...');
      
      // Get messages from thread if this is in a thread
      let images = [];
      const threadId = ctx.message.message_thread_id;
      
      if (threadId) {
        try {
          // Get messages from thread
          const messages = await ctx.telegram.getMessages(chatId, threadId);
          
          // Extract images from thread messages
          if (messages && messages.length > 0) {
            for (const message of messages) {
              if (message.photo && message.photo.length > 0) {
                images.push({
                  fileId: message.photo[message.photo.length - 1].file_id,
                  messageId: message.message_id
                });
              }
            }
          }
        } catch (threadError) {
          logger.warn('Error getting thread messages', { error: threadError.message });
          // Continue with just the replied message
        }
      }
      
      // If no images found in thread or not in a thread, use the replied message
      if (images.length === 0 && ctx.message.reply_to_message.photo) {
        images.push({
          fileId: ctx.message.reply_to_message.photo[ctx.message.reply_to_message.photo.length - 1].file_id,
          messageId: ctx.message.reply_to_message.message_id
        });
        
        // If there's a media group, try to get all images from it
        if (ctx.message.reply_to_message.media_group_id) {
          try {
            // Get media group messages
            const mediaGroupId = ctx.message.reply_to_message.media_group_id;
            
            // This is a simplified approach - in a real implementation,
            // you would need to get messages from the media group
            // For now, just update the status
            await ctx.telegram.editMessageText(
              chatId,
              statusMessage.message_id,
              null,
              '🔍 Found a media group, using the first image for now...'
            );
          } catch (mediaGroupError) {
            logger.warn('Error getting media group', { error: mediaGroupError.message });
            // Continue with just the replied message
          }
        }
      }
      
      // Check if we found images
      if (images.length === 0) {
        await ctx.telegram.editMessageText(
          chatId,
          statusMessage.message_id,
          null,
          'No images found to compare. Please reply to a message with an image.'
        );
        return;
      }
      
      // Update status
      await ctx.telegram.editMessageText(
        chatId,
        statusMessage.message_id,
        null,
        `🔍 Found ${images.length} image${images.length > 1 ? 's' : ''} to analyze. Processing...`
      );
      
      // Process each image to get its URL
      const imageUrls = [];
      for (const image of images) {
        try {
          const file = await ctx.telegram.getFile(image.fileId);
          const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
          imageUrls.push(fileUrl);
        } catch (fileError) {
          logger.warn('Error getting file', { error: fileError.message });
          // Skip this image
        }
      }
      
      if (imageUrls.length === 0) {
        await ctx.telegram.editMessageText(
          chatId,
          statusMessage.message_id,
          null,
          'Error retrieving image files. Please try again.'
        );
        return;
      }
      
      // Get comparison prompt
      const prompt = ctx.message.text.substring(9).trim() || 'Compare these images and describe the differences';
      
      // Use Grok to analyze images
      let result;
      if (imageUrls.length === 1) {
        // If only one image, do regular analysis
        result = await grokService.multimodalCompletion([
          { 
            role: 'system', 
            content: 'You are an image analysis assistant that provides detailed, accurate descriptions of images.'
          },
          { 
            role: 'user', 
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrls[0] } }
            ]
          }
        ], {
          max_tokens: 1000,
          temperature: 0.5
        });
      } else {
        // For multiple images, construct a message with all images
        const userContent = [{ type: 'text', text: prompt }];
        
        // Add each image to the content
        for (const url of imageUrls) {
          userContent.push({ type: 'image_url', image_url: { url } });
        }
        
        result = await grokService.multimodalCompletion([
          { 
            role: 'system', 
            content: 'You are an image analysis assistant skilled at comparing multiple images. Describe similarities, differences, and key features of all provided images.'
          },
          { role: 'user', content: userContent }
        ], {
          max_tokens: 1500,
          temperature: 0.5
        });
      }
      
      // Process result
      let analysis = '';
      if (result.choices && result.choices.length > 0) {
        analysis = result.choices[0].message.content;
      } else {
        analysis = 'Sorry, I was unable to analyze the images.';
      }
      
      // Update the message with the analysis
      const finalMessage = `✅ Image ${imageUrls.length > 1 ? 'Comparison' : 'Analysis'} Complete:\n\n${analysis}`;
      
      // Trim if too long for a telegram message
      if (finalMessage.length > 4096) {
        // Send first part in the existing message
        await ctx.telegram.editMessageText(
          chatId,
          statusMessage.message_id,
          null,
          `✅ ${imageUrls.length > 1 ? 'Comparison' : 'Analysis'} Complete (part 1 of 2):\n\n${analysis.substring(0, 3800)}...`
        );
        
        // Send remainder as a second message
        await ctx.reply(`${imageUrls.length > 1 ? 'Comparison' : 'Analysis'} (part 2 of 2):\n\n...${analysis.substring(3800)}`);
      } else {
        // Just update the existing message
        await ctx.telegram.editMessageText(
          chatId,
          statusMessage.message_id,
          null,
          finalMessage
        );
      }
    } catch (error) {
      logger.error('Error in compare command', { error: error.message });
      await ctx.reply('Sorry, I encountered an error comparing the images. Please try again.');
    }
  }

  /**
   * Handle /search command for web search
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleWebSearch(ctx) {
    try {
      const searchQuery = ctx.message.text.substring(8).trim(); // Remove '/search ' prefix
      
      if (!searchQuery) {
        await ctx.reply('Please provide a search query after /search. For example:\n/search latest blockchain news');
        return;
      }
      
      // Show typing indicator
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
      
      // Check if grok service is available
      if (!grokService.initialized) {
        await ctx.reply('Web search is not available right now. Please try again later.');
        return;
      }
      
      // Use grok's web search capability
      const result = await grokService.webSearch(searchQuery, {
        systemPrompt: 'You are Dail Bot, a helpful AI assistant.\nYou are searching the web for information about the user\'s query.\nProvide comprehensive, accurate search results with useful information.\nInclude relevant links and sources in your response.\nFormat important information clearly using markdown.',
        temperature: 0.3,
        max_tokens: 2000
      });
      
      // Extract response text
      let responseText = result.text || "No search results found.";
      
      // Split message if it's too long
      if (responseText.length > 4000) {
        const chunks = this._splitTextIntoChunks(responseText);
        for (const chunk of chunks) {
          await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(async () => {
            await ctx.reply(chunk, { parse_mode: 'HTML' }).catch(async () => {
              await ctx.reply(chunk); // Fallback to plain text
            });
          });
        }
      } else {
        // Try sending with markdown formatting first
        await ctx.reply(responseText, { parse_mode: 'Markdown' }).catch(async () => {
          // If markdown fails, try HTML
          await ctx.reply(responseText, { parse_mode: 'HTML' }).catch(async () => {
            // If HTML fails too, send plain text
            await ctx.reply(responseText);
          });
        });
      }
    } catch (error) {
      logger.error('Error in search command', { error: error.message });
      await ctx.reply('Sorry, I encountered an error performing your web search. Please try again later.');
    }
  }

  /**
   * Handle /generate command for image generation
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleGenerateImage(ctx) {
    try {
      // Get the prompt from the command text
      const prompt = ctx.message.text.substring(10).trim();
      
      if (!prompt) {
        await ctx.reply('Please provide a prompt after /generate. For example:\n/generate A cat sitting on a tree branch');
        return;
      }
      
      // Show typing indicator for upload
      await ctx.telegram.sendChatAction(ctx.chat.id, 'upload_photo');
      
      // Check if grok service is available
      if (!grokService.initialized) {
        await ctx.reply('Image generation is not available right now. Please try again later.');
        return;
      }
      
      // Show status message
      const statusMsg = await ctx.reply('🎨 Generating image from your prompt...');
      
      try {
        // Generate image with Grok
        const result = await grokService.imageGeneration(prompt, {
          n: 1,  // Generate just one image
          size: '1024x1024',  // Standard size
          response_format: 'url'  // Get URL rather than base64
        });
        
        if (!result || !result.data || !result.data.length) {
          await ctx.telegram.editMessageText(
            ctx.chat.id, 
            statusMsg.message_id, 
            null, 
            'Sorry, I was unable to generate an image from your prompt. Please try a different prompt.'
          );
          return;
        }
        
        // Get the image URL
        const imageUrl = result.data[0].url;
        
        // Delete the status message
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        
        // Send the generated image
        await ctx.replyWithPhoto(
          { url: imageUrl }, 
          { caption: `Generated image from prompt: "${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}"` }
        );
      } catch (genError) {
        logger.error('Error generating image', { error: genError.message, prompt });
        await ctx.telegram.editMessageText(
          ctx.chat.id, 
          statusMsg.message_id, 
          null, 
          `Sorry, I couldn't generate an image: ${genError.message}`
        );
      }
    } catch (error) {
      logger.error('Error in generate command', { error: error.message });
      await ctx.reply('Sorry, I encountered an error with image generation. Please try again later.');
    }
  }

  /**
   * Handle /generateMultiple command for generating multiple images
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleGenerateMultipleImages(ctx) {
    try {
      // Parse command text: /generateMultiple [count] [prompt]
      const text = ctx.message.text.substring(17).trim(); // Remove '/generateMultiple '
      
      // Split into count and prompt
      const parts = text.split(' ');
      let count = 1;
      let prompt = text;
      
      // Try to parse the first part as a number
      if (/^\d+$/.test(parts[0])) {
        count = parseInt(parts[0], 10);
        // Use the rest as the prompt
        prompt = parts.slice(1).join(' ');
      }
      
      // Validate inputs
      if (!prompt) {
        await ctx.reply(
          'Please provide a prompt after the count. For example:\n' +
          '/generateMultiple 3 A futuristic city with flying cars'
        );
        return;
      }
      
      // Limit count to avoid abuse (max 4 images)
      if (count < 1) count = 1;
      if (count > 4) count = 4;
      
      // Show typing indicator for upload
      await ctx.telegram.sendChatAction(ctx.chat.id, 'upload_photo');
      
      // Check if grok service is available
      if (!grokService.initialized) {
        await ctx.reply('Image generation is not available right now. Please try again later.');
        return;
      }
      
      // Show status message
      const statusMsg = await ctx.reply(`🎨 Generating ${count} image${count > 1 ? 's' : ''} from your prompt...`);
      
      try {
        // Generate images with Grok
        const result = await grokService.imageGeneration(prompt, {
          n: count,  // Generate specified number of images
          size: '1024x1024',  // Standard size
          response_format: 'url'  // Get URL rather than base64
        });
        
        if (!result || !result.data || !result.data.length) {
          await ctx.telegram.editMessageText(
            ctx.chat.id, 
            statusMsg.message_id, 
            null, 
            'Sorry, I was unable to generate images from your prompt. Please try a different prompt.'
          );
          return;
        }
        
        // Delete the status message
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        
        // Send each generated image
        for (let i = 0; i < result.data.length; i++) {
          // Get the image URL
          const imageUrl = result.data[i].url;
          
          // Show uploading indicator between images
          if (i > 0) {
            await ctx.telegram.sendChatAction(ctx.chat.id, 'upload_photo');
          }
          
          // Send the image
          await ctx.replyWithPhoto(
            { url: imageUrl }, 
            { 
              caption: i === 0 ? 
                `Generated image ${i+1}/${result.data.length} from prompt: "${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}"` : 
                `Generated image ${i+1}/${result.data.length}`
            }
          );
          
          // Add a small delay between images to avoid rate limiting
          if (i < result.data.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } catch (genError) {
        logger.error('Error generating multiple images', { error: genError.message, prompt });
        await ctx.telegram.editMessageText(
          ctx.chat.id, 
          statusMsg.message_id, 
          null, 
          `Sorry, I couldn't generate images: ${genError.message}`
        );
      }
    } catch (error) {
      logger.error('Error in generateMultiple command', { error: error.message });
      await ctx.reply('Sorry, I encountered an error with image generation. Please try again later.');
    }
  }

  /**
   * Split text into smaller chunks for Telegram message limits
   * @param {String} text - Text to split
   * @param {Number} maxLength - Maximum chunk length
   * @returns {Array<String>} - Array of text chunks
   * @private
   */
  _splitTextIntoChunks(text, maxLength = 4000) {
    const chunks = [];
    let remainingText = text;
    
    while (remainingText.length > 0) {
      if (remainingText.length <= maxLength) {
        chunks.push(remainingText);
        break;
      }
      
      // Find a good splitting point (newline or space)
      let splitPoint = remainingText.lastIndexOf('\n', maxLength);
      if (splitPoint === -1 || splitPoint < maxLength / 2) {
        splitPoint = remainingText.lastIndexOf(' ', maxLength);
      }
      if (splitPoint === -1) {
        splitPoint = maxLength;
      }
      
      chunks.push(remainingText.substring(0, splitPoint));
      remainingText = remainingText.substring(splitPoint + 1);
    }
    
    return chunks;
  }

  /**
   * Handle /crosschat command for cross-chat moderation
   * @param {Object} ctx - Telegram context 
   * @private
   */
  async _handleCrossChatModeration(ctx) {
    try {
      // Check if user is admin
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('Only administrators can use this command.');
      }
      
      // Get the option (on/off)
      const text = ctx.message.text;
      const option = text.split(' ')[1]?.toLowerCase();
      
      if (option === 'on' || option === 'enable') {
        await this._toggleCrossChatModeration(ctx, true);
      } else if (option === 'off' || option === 'disable') {
        await this._toggleCrossChatModeration(ctx, false);
      } else {
        await ctx.reply('Invalid option. Use /crosschat on to enable or /crosschat off to disable.');
      }
    } catch (error) {
      logger.error('Error handling crosschat command', { error: error.message });
      await ctx.reply('Error processing command. Please try again later.');
    }
  }
  
  /**
   * Toggle cross-chat moderation
   * @param {Object} ctx - Telegram context
   * @param {Boolean} enable - Whether to enable or disable
   * @private
   */
  async _toggleCrossChatModeration(ctx, enable) {
    try {
      // Store setting in database
      await sqliteService.updateSettings(ctx.chat.id.toString(), {
        crossChatModerationEnabled: enable
      });
      
      await ctx.reply(`Cross-chat moderation has been ${enable ? 'enabled' : 'disabled'} for this chat.`);
    } catch (error) {
      logger.error('Error toggling cross-chat moderation', { error: error.message });
      await ctx.reply('Error updating settings. Please try again later.');
    }
  }

  /**
   * Handle enabling anti-spam
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleEnableAntispam(ctx) {
    try {
      // Check if user is admin
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('Only administrators can use this command.');
      }
      
      // Get the option (on/off)
      const text = ctx.message.text;
      const option = text.split(' ')[1]?.toLowerCase();
      
      let enable = true; // Default is on
      if (option === 'off' || option === 'disable') {
        enable = false;
      }
      
      // Store setting in database
      await sqliteService.updateSettings(ctx.chat.id.toString(), {
        antispamEnabled: enable
      });
      
      await ctx.reply(`Anti-spam protection has been ${enable ? 'enabled' : 'disabled'} for this chat.`);
    } catch (error) {
      logger.error('Error handling enableantispam command', { error: error.message });
      await ctx.reply('Error updating settings. Please try again later.');
    }
  }

  /**
   * Handle enabling or disabling AI-powered scam detection
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleAIScamDetection(ctx) {
    try {
      // Check if user is admin
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('Only administrators can use this command.');
      }
      
      // Get the option (on/off)
      const text = ctx.message.text;
      const match = text.match(/\/aiscamdetection\s+(on|off|enable|disable)(?:\s+(.+))?/i);
      
      if (!match) {
        return ctx.reply(
          'Usage: /aiscamdetection [on|off] [options]\n\n' +
          'Options:\n' +
          '- threshold=0.X (confidence threshold, 0-1)\n' +
          '- all=true|false (analyze all messages)\n\n' +
          'Example: /aiscamdetection on threshold=0.7 all=false'
        );
      }
      
      const option = match[1].toLowerCase();
      const optionsText = match[2] || '';
      
      // Parse options
      const options = {};
      const thresholdMatch = optionsText.match(/threshold=(\d*\.\d+)/);
      if (thresholdMatch) {
        options.confidenceThreshold = parseFloat(thresholdMatch[1]);
      }
      
      const allMessagesMatch = optionsText.match(/all=(true|false)/i);
      if (allMessagesMatch) {
        options.useAIForAllMessages = allMessagesMatch[1].toLowerCase() === 'true';
      }
      
      // Enable or disable AI detection
      const enable = option === 'on' || option === 'enable';
      
      // Get ban storage service
      const banStorage = require('../modules/moderation/banStorage');
      await banStorage.ensureInitialized();
      
      // Update settings
      banStorage.setAIDetectionEnabled(enable, options);
      
      // Respond with current settings
      await ctx.reply(
        `AI-powered scam detection has been ${enable ? 'enabled' : 'disabled'} for this chat.\n\n` +
        `Current settings:\n` +
        `- Enabled: ${banStorage.aiAnalysisEnabled ? 'Yes' : 'No'}\n` +
        `- Confidence threshold: ${banStorage.aiConfidenceThreshold}\n` +
        `- Analyze all messages: ${banStorage.useAIForAllMessages ? 'Yes' : 'No'}`
      );
    } catch (error) {
      logger.error('Error handling AI scam detection command', { error: error.message });
      await ctx.reply('Error updating settings. Please try again later.');
    }
  }

  /**
   * Handle making a user an admin
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleMakeAdmin(ctx) {
    try {
      // Check if user is admin
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('Only administrators can use this command.');
      }
      
      // Parse command for user ID/username
      const text = ctx.message.text;
      const match = text.match(/\/makeadmin\s+(?:@)?(\w+)/);
      
      if (!match) {
        return ctx.reply('Usage: /makeadmin @username');
      }
      
      const username = match[1];
      
      // Try to resolve username to user ID
      let userId;
      const userMap = Array.from(this.userMap.values());
      const user = userMap.find(u => u.username === username);
      
      if (user) {
        userId = user.id;
      } else {
        return ctx.reply('User not found. They must have sent a message in this chat first.');
      }
      
      // Promote user to admin
      try {
        await ctx.telegram.promoteChatMember(ctx.chat.id, userId, {
          can_change_info: true,
          can_delete_messages: true,
          can_invite_users: true,
          can_restrict_members: true,
          can_pin_messages: true
        });
        
        await ctx.reply(`Successfully promoted @${username} to admin.`);
      } catch (promoteError) {
        logger.error('Error promoting member', { error: promoteError.message });
        await ctx.reply(`Error promoting user: ${promoteError.message}`);
      }
    } catch (error) {
      logger.error('Error handling makeadmin command', { error: error.message });
      await ctx.reply('Error processing command. Please try again later.');
    }
  }

  /**
   * Handle setting admin rights
   * @param {Object} ctx - Telegram context 
   * @private
   */
  async _handleSetAdminRights(ctx) {
    try {
      // Check if user is admin
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('Only administrators can use this command.');
      }
      
      // Parse command for user ID/username and rights
      const text = ctx.message.text;
      const match = text.match(/\/setadminrights\s+(?:@)?(\w+)\s+(.+)/);
      
      if (!match) {
        return ctx.reply(
          'Usage: /setadminrights @username [rights]\n\n' +
          'Available rights (comma separated):\n' +
          '- change_info\n' +
          '- delete_messages\n' +
          '- invite_users\n' +
          '- restrict_members\n' +
          '- pin_messages\n' +
          '- promote_members\n' +
          '- manage_video_chats\n' +
          '- manage_chat'
        );
      }
      
      const username = match[1];
      const rightsText = match[2];
      
      // Parse rights
      const rights = {
        can_change_info: rightsText.includes('change_info'),
        can_delete_messages: rightsText.includes('delete_messages'),
        can_invite_users: rightsText.includes('invite_users'),
        can_restrict_members: rightsText.includes('restrict_members'),
        can_pin_messages: rightsText.includes('pin_messages'),
        can_promote_members: rightsText.includes('promote_members'),
        can_manage_video_chats: rightsText.includes('manage_video_chats'),
        can_manage_chat: rightsText.includes('manage_chat')
      };
      
      // Try to resolve username to user ID
      let userId;
      const userMap = Array.from(this.userMap.values());
      const user = userMap.find(u => u.username === username);
      
      if (user) {
        userId = user.id;
      } else {
        return ctx.reply('User not found. They must have sent a message in this chat first.');
      }
      
      // Promote user with specific rights
      try {
        await ctx.telegram.promoteChatMember(ctx.chat.id, userId, rights);
        
        // Format rights for display
        const enabledRights = Object.entries(rights)
          .filter(([, enabled]) => enabled)
          .map(([right]) => right.replace('can_', ''))
          .join(', ');
        
        await ctx.reply(`Successfully set admin rights for @${username}:\n${enabledRights}`);
      } catch (promoteError) {
        logger.error('Error setting admin rights', { error: promoteError.message });
        await ctx.reply(`Error setting admin rights: ${promoteError.message}`);
      }
    } catch (error) {
      logger.error('Error handling setadminrights command', { error: error.message });
      await ctx.reply('Error processing command. Please try again later.');
    }
  }

  /**
   * Handle restricting a user
   * @param {Object} ctx - Telegram context
   * @private 
   */
  async _handleRestrictUser(ctx) {
    try {
      // Check if user is admin
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('Only administrators can use this command.');
      }
      
      // Parse command
      const text = ctx.message.text;
      const match = text.match(/\/restrict\s+(?:@)?(\w+)(?:\s+(\d+))?(?:\s+(.+))?/);
      
      if (!match) {
        return ctx.reply(
          'Usage: /restrict @username [duration_in_minutes] [reason]\n\n' +
          'Examples:\n' +
          '/restrict @user 60 Spamming - Restrict for 60 minutes\n' +
          '/restrict @user 0 - Restrict indefinitely'
        );
      }
      
      const username = match[1];
      const duration = match[2] ? parseInt(match[2], 10) : 60; // Default 60 minutes
      const reason = match[3] || 'No reason provided';
      
      // Try to resolve username to user ID
      let userId;
      const userMap = Array.from(this.userMap.values());
      const user = userMap.find(u => u.username === username);
      
      if (user) {
        userId = user.id;
      } else {
        return ctx.reply('User not found. They must have sent a message in this chat first.');
      }
      
      // Calculate until date (if duration is 0, it's indefinite)
      const untilDate = duration > 0 ? Math.floor(Date.now() / 1000) + (duration * 60) : 0;
      
      // Restrict user
      try {
        await ctx.telegram.restrictChatMember(ctx.chat.id, userId, {
          until_date: untilDate,
          can_send_messages: false,
          can_send_media_messages: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false
        });
        
        // Save restriction to database
        await sqliteService.saveRestriction(userId, ctx.chat.id, ctx.from.id, reason, untilDate);
        
        const durationText = duration > 0 ? `for ${duration} minutes` : 'indefinitely';
        await ctx.reply(`@${username} has been restricted ${durationText}.\nReason: ${reason}`);
      } catch (restrictError) {
        logger.error('Error restricting user', { error: restrictError.message });
        await ctx.reply(`Error restricting user: ${restrictError.message}`);
      }
    } catch (error) {
      logger.error('Error handling restrict command', { error: error.message });
      await ctx.reply('Error processing command. Please try again later.');
    }
  }

  /**
   * Handle setting default permissions
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleSetDefaultPermissions(ctx) {
    try {
      // Check if user is admin
      const isAdmin = await this._isUserAdmin(ctx.from.id, ctx.chat.id);
      if (!isAdmin) {
        return ctx.reply('Only administrators can use this command.');
      }
      
      // Parse command for permissions
      const text = ctx.message.text;
      const match = text.match(/\/setdefaultpermissions\s+(.+)/);
      
      if (!match) {
        return ctx.reply(
          'Usage: /setdefaultpermissions [permissions]\n\n' +
          'Available permissions (comma separated):\n' +
          '- send_messages\n' +
          '- send_media\n' +
          '- send_polls\n' +
          '- send_other\n' +
          '- web_previews\n' +
          '- change_info\n' +
          '- invite_users\n' +
          '- pin_messages\n\n' +
          'Example: /setdefaultpermissions send_messages,send_media'
        );
      }
      
      const permissionsText = match[1];
      
      // Parse permissions
      const permissions = {
        can_send_messages: permissionsText.includes('send_messages'),
        can_send_media_messages: permissionsText.includes('send_media'),
        can_send_polls: permissionsText.includes('send_polls'),
        can_send_other_messages: permissionsText.includes('send_other'),
        can_add_web_page_previews: permissionsText.includes('web_previews'),
        can_change_info: permissionsText.includes('change_info'),
        can_invite_users: permissionsText.includes('invite_users'),
        can_pin_messages: permissionsText.includes('pin_messages')
      };
      
      // Set permissions
      try {
        await ctx.telegram.setChatPermissions(ctx.chat.id, permissions);
        
        // Format permissions for display
        const enabledPermissions = Object.entries(permissions)
          .filter(([, enabled]) => enabled)
          .map(([permission]) => permission.replace('can_', ''))
          .join(', ');
        
        await ctx.reply(`Successfully set default permissions for this chat:\n${enabledPermissions || 'No permissions'}`);
      } catch (permissionsError) {
        logger.error('Error setting permissions', { error: permissionsError.message });
        await ctx.reply(`Error setting permissions: ${permissionsError.message}`);
      }
    } catch (error) {
      logger.error('Error handling setdefaultpermissions command', { error: error.message });
      await ctx.reply('Error processing command. Please try again later.');
    }
  }

  /**
   * Handle /variationOf command for generating image variations
   * @param {Object} ctx - Telegram context
   * @private
   */
  async _handleVariationOfImage(ctx) {
    try {
      // Check if replying to a message with photo
      if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.photo) {
        await ctx.reply('Please use this command as a reply to a message containing an image.');
        return;
      }
      
      // Get modification prompt
      const modificationPrompt = ctx.message.text.substring(12).trim() || 'Create a variation of this image';
      
      // Get photo file ID (highest resolution)
      const photoId = ctx.message.reply_to_message.photo[ctx.message.reply_to_message.photo.length - 1].file_id;
      
      // Get file info and URL
      const file = await ctx.telegram.getFile(photoId);
      const filePath = file.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${filePath}`;
      
      // Show uploading indicator
      await ctx.telegram.sendChatAction(ctx.chat.id, 'upload_photo');
      
      // Show status message
      const statusMsg = await ctx.reply('🎨 Creating variation of image...');
      
      try {
        // Check if grok service is available
        if (!grokService.initialized) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            'Image variation generation is not available right now. Please try again later.'
          );
          return;
        }
        
        // First analyze the image to get a description
        const imageAnalysisResult = await grokService.multimodalCompletion([
          { 
            role: 'system', 
            content: 'Describe this image in detail to use as a prompt for generating a similar image with variations. Focus on the main elements, style, colors, and composition. Be specific and detailed.' 
          },
          { 
            role: 'user', 
            content: [
              { type: 'text', text: 'Describe this image in detail so I can use it as a prompt for creating a variation with these changes: ' + modificationPrompt },
              { type: 'image_url', image_url: { url: fileUrl } }
            ]
          }
        ], {
          max_tokens: 500,
          temperature: 0.5
        });
        
        let description = 'An image';
        if (imageAnalysisResult.choices && imageAnalysisResult.choices.length > 0) {
          description = imageAnalysisResult.choices[0].message.content;
        }
        
        // Update status message
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          '✅ Image analyzed. Now generating variation...'
        );
        
        // Create a modified prompt that combines the description with the requested modifications
        const combinedPrompt = `${description} With these modifications: ${modificationPrompt}`;
        
        // Generate a new image based on the combined prompt
        const result = await grokService.imageGeneration(combinedPrompt, {
          n: 1,
          size: '1024x1024',
          response_format: 'url'
        });
        
        if (!result || !result.data || !result.data.length) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            'Sorry, I was unable to generate a variation of the image. Please try a different image or modification prompt.'
          );
          return;
        }
        
        // Get the image URL
        const imageUrl = result.data[0].url;
        
        // Delete the status message
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        
        // Send the generated image variation
        await ctx.replyWithPhoto(
          { url: imageUrl }, 
          { caption: `Variation of image with modifications: "${modificationPrompt.substring(0, 200)}${modificationPrompt.length > 200 ? '...' : ''}"` }
        );
      } catch (genError) {
        logger.error('Error generating image variation', { error: genError.message });
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `Sorry, I couldn't generate an image variation: ${genError.message}`
        );
      }
    } catch (error) {
      logger.error('Error in variationOf command', { error: error.message });
      await ctx.reply('Sorry, I encountered an error with image variation generation. Please try again later.');
    }
  }

  /**
   * Kick a user from chat
   * @param {Number} chatId - Chat ID
   * @param {Number} userId - User ID
   * @param {Object} options - Options for kicking
   * @returns {Promise<Object>} - Result
   */
  async kickChatMember(chatId, userId, options = {}) {
    try {
      logger.info('Kicking user from chat', { chatId, userId, options });
      
      // The Telegraf library uses banChatMember for kicking
      const result = await this.bot.telegram.banChatMember(chatId, userId, options);
      
      logger.info('Successfully kicked user from chat', { chatId, userId });
      return result;
    } catch (error) {
      logger.error('Failed to kick user from chat', { 
        error: error.message, 
        chatId, 
        userId,
        code: error.code,
        description: error.description
      });
      throw error;
    }
  }

  /**
   * Unban a user from chat
   * @param {Number} chatId - Chat ID
   * @param {Number} userId - User ID
   * @returns {Promise<Object>} - Result
   */
  async unbanChatMember(chatId, userId, options = {}) {
    try {
      logger.info('Unbanning user from chat', { chatId, userId });
      
      const result = await this.bot.telegram.unbanChatMember(chatId, userId, {
        only_if_banned: true,
        ...options
      });
      
      logger.info('Successfully unbanned user from chat', { chatId, userId });
      return result;
    } catch (error) {
      logger.error('Failed to unban user from chat', { 
        error: error.message, 
        chatId, 
        userId,
        code: error.code,
        description: error.description
      });
      throw error;
    }
  }

  /**
   * Restrict chat member
   * @param {Number} chatId - Chat ID
   * @param {Number} userId - User ID
   * @param {Object} permissions - Permission object
   * @returns {Promise<Object>} - Result
   */
  async restrictChatMember(chatId, userId, permissions) {
    try {
      logger.info('Restricting chat member', { chatId, userId, permissions });
      
      const result = await this.bot.telegram.restrictChatMember(chatId, userId, permissions);
      
      logger.info('Successfully restricted chat member', { chatId, userId });
      return result;
    } catch (error) {
      logger.error('Failed to restrict chat member', { 
        error: error.message, 
        chatId, 
        userId,
        code: error.code,
        description: error.description
      });
      throw error;
    }
  }

  /**
   * Delete a message
   * @param {Number} chatId - Chat ID
   * @param {Number} messageId - Message ID
   * @returns {Promise<Boolean>} - Success status
   */
  async deleteMessage(chatId, messageId) {
    try {
      logger.info('Deleting message', { chatId, messageId });
      
      const result = await this.bot.telegram.deleteMessage(chatId, messageId);
      
      logger.info('Successfully deleted message', { chatId, messageId });
      return result;
    } catch (error) {
      logger.error('Failed to delete message', { 
        error: error.message, 
        chatId, 
        messageId,
        code: error.code,
        description: error.description
      });
      throw error;
    }
  }

  /**
   * Pin a chat message
   * @param {Number} chatId - Chat ID
   * @param {Number} messageId - Message ID
   * @param {Object} options - Options for pin
   * @returns {Promise<Boolean>} - Success status
   */
  async pinChatMessage(chatId, messageId, options = {}) {
    try {
      logger.info('Pinning message', { chatId, messageId, options });
      
      const result = await this.bot.telegram.pinChatMessage(chatId, messageId, options);
      
      logger.info('Successfully pinned message', { chatId, messageId });
      return result;
    } catch (error) {
      logger.error('Failed to pin message', { 
        error: error.message, 
        chatId, 
        messageId,
        code: error.code,
        description: error.description
      });
      throw error;
    }
  }

  /**
   * Send message to chat
   * @param {Number} chatId - Chat ID
   * @param {String} text - Message text
   * @param {Object} options - Message options
   * @returns {Promise<Object>} - Message object
   */
  async sendMessage(chatId, text, options = {}) {
    try {
      logger.info('Sending message to chat', { 
        chatId, 
        textLength: text?.length,
        options
      });
      
      const result = await this.bot.telegram.sendMessage(chatId, text, options);
      
      logger.info('Successfully sent message', { 
        chatId, 
        messageId: result.message_id 
      });
      
      return result;
    } catch (error) {
      logger.error('Failed to send message', { 
        error: error.message, 
        chatId,
        code: error.code,
        description: error.description
      });
      throw error;
    }
  }

  /**
   * Find a user by username with database backup
   * @param {String} username - Username to find
   * @param {Number} chatId - Optional chat ID for context
   * @returns {Promise<Object|null>} - User object if found, null otherwise
   */
  async findUserByUsername(username, chatId = null) {
    try {
      // Remove @ if present
      if (username.startsWith('@')) {
        username = username.substring(1);
      }
      
      // Try our user map first (most efficient)
      if (this.userMap && this.userMap.size > 0) {
        const userMap = Array.from(this.userMap.values());
        const user = userMap.find(u => u.username?.toLowerCase() === username.toLowerCase());
        
        if (user) {
          logger.info('Found user in service userMap', { username, userId: user.id });
          return user;
        }
      }
      
      // If not found, try database lookup
      try {
        // Query the database directly for the user
        const dbUser = await sqliteService.db.get(
          'SELECT * FROM users WHERE username = ?',
          [username]
        );
        
        if (dbUser) {
          logger.info('Found user in database', { username, userId: dbUser.id });
          
          // Add to userMap for future fast access
          if (this.userMap) {
            const key = `${dbUser.id}_${chatId || 'private'}`;
            this.userMap.set(key, {
              id: dbUser.id,
              username: dbUser.username,
              first_name: dbUser.first_name,
              last_name: dbUser.last_name,
              chatId: chatId
            });
          }
          
          return {
            id: dbUser.id,
            username: dbUser.username,
            first_name: dbUser.first_name,
            last_name: dbUser.last_name
          };
        }
      } catch (dbErr) {
        logger.warn('Failed to find user in database', { username, error: dbErr.message });
      }
      
      return null;
    } catch (error) {
      logger.error('Error finding user by username', { error: error.message, username });
      return null;
    }
  }

  /**
   * Get moderationService instance with lazy loading
   * @private
   */
  _getModerationService() {
    if (!moderationService) {
      moderationService = require('../modules/moderation/moderationService');
    }
    return moderationService;
  }

  /**
   * Handle response to conversational quiz question
   * @param {Object} ctx - Telegram context
   * @returns {Promise<void>}
   * @private
   */
  async _handleConversationalQuizResponse(ctx) {
    try {
      const user = ctx.from;
      const userResponse = ctx.message.text;
      
      // Get the quiz session
      const quizSession = ctx.session.conversationalQuizzes[user.id];
      
      if (!quizSession || !quizSession.awaitingResponse) {
        logger.error('Quiz session not found or not awaiting response', { userId: user.id });
        return ctx.reply('Sorry, I couldn\'t find an active quiz for you. Try starting a new quiz.');
      }
      
      // Get the current question
      const currentQuestionIndex = quizSession.currentQuestion;
      const question = quizSession.questions[currentQuestionIndex];
      
      if (!question) {
        logger.error('Question not found in quiz session', { userId: user.id, index: currentQuestionIndex });
        return ctx.reply('Sorry, there was a problem retrieving the current question. Please try again.');
      }
      
      logger.info('Received response to quiz question', { 
        userId: user.id, 
        questionIndex: currentQuestionIndex,
        responseLength: userResponse.length
      });
      
      // Store the user's answer
      quizSession.answers[currentQuestionIndex] = {
        question: question.question,
        userResponse: userResponse,
        timestamp: Date.now()
      };
      
      // Show typing indicator
      await ctx.replyWithChatAction('typing');
      
      // Evaluate the response using Grok
      let evaluation = null;
      
      try {
        if (grokService && typeof grokService.evaluateQuizResponse === 'function') {
          evaluation = await grokService.evaluateQuizResponse({
            question,
            userResponse,
            videoContext: quizSession.content
          });
        }
      } catch (error) {
        logger.error('Error evaluating quiz response', { error: error.message });
      }
      
      // Fallback evaluation if Grok evaluation failed
      if (!evaluation) {
        evaluation = {
          score: 70,
          correct: true,
          feedback: "Your answer covers some important points.",
          learningAddition: "Also consider the broader implications discussed in the video.",
          encouragement: "Great effort! You're understanding the key concepts.",
          followUpQuestion: question.followUp || "Can you tell me more about this topic?"
        };
      }
      
      // Add evaluation to stored answer
      quizSession.answers[currentQuestionIndex].evaluation = evaluation;
      
      // Provide feedback on the answer
      let feedbackMessage = '';
      
      if (evaluation.correct) {
        feedbackMessage = `✅ Great answer! ${evaluation.feedback}\n\n`;
      } else {
        feedbackMessage = `👍 ${evaluation.feedback}\n\n`;
      }
      
      // Add learning addition if available
      if (evaluation.learningAddition) {
        feedbackMessage += `📚 ${evaluation.learningAddition}\n\n`;
      }
      
      // Add encouragement
      if (evaluation.encouragement) {
        feedbackMessage += `${evaluation.encouragement}\n\n`;
      }
      
      // Send feedback
      await ctx.reply(feedbackMessage);
      
      // Move to the next question or finish the quiz
      const nextQuestionIndex = currentQuestionIndex + 1;
      
      if (nextQuestionIndex < quizSession.questions.length) {
        // There are more questions - update session
        quizSession.currentQuestion = nextQuestionIndex;
        
        // Ask the next question after a short delay
        setTimeout(async () => {
          const nextQuestion = quizSession.questions[nextQuestionIndex];
          await ctx.reply(`Question ${nextQuestionIndex + 1} of ${quizSession.questions.length}:\n\n${nextQuestion.question}`);
        }, 1500);
      } else {
        // Quiz is complete
        quizSession.awaitingResponse = false;
        quizSession.isActive = false;
        quizSession.completed = true;
        quizSession.completedAt = Date.now();
        
        // Calculate final score
        const totalScore = quizSession.answers.reduce((sum, answer) => sum + (answer.evaluation?.score || 0), 0);
        const averageScore = Math.round(totalScore / quizSession.answers.length);
        quizSession.finalScore = averageScore;
        
        // Prepare completion message
        let completionMessage = `🎉 *Quiz Completed!*\n\n`;
        completionMessage += `You've completed the quiz on ${quizSession.topic}.\n\n`;
        completionMessage += `Your final score: ${averageScore}%\n\n`;
        
        if (averageScore >= 80) {
          completionMessage += "Excellent job! You've demonstrated a strong understanding of the material.";
        } else if (averageScore >= 60) {
          completionMessage += "Good job! You've grasped many of the key concepts.";
        } else {
          completionMessage += "Thanks for participating! Keep learning about this topic to improve your understanding.";
        }
        
        // Send completion message
        await ctx.reply(completionMessage, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📊 View Detailed Results', callback_data: `quiz_results:${user.id}` }],
              [{ text: '🏆 Issue Educational Credential', callback_data: `issue_edu_credential:${user.id}:${quizSession.topic}` }]
            ]
          }
        });
        
        // If score is high enough, we can automatically issue a credential
        if (averageScore >= 65 && educationalCredentialService) {
          try {
            // Issue a quiz completion credential
            const credResult = await this._issueQuizCredential(ctx, user, quizSession);
            
            if (credResult.issued) {
              logger.info('Issued quiz completion credential', { userId: user.id, topic: quizSession.topic, score: averageScore });
            } else {
              logger.warn('Could not issue quiz credential, but quiz was completed successfully', { userId: user.id, error: credResult.error });
            }
          } catch (error) {
            logger.error('Error issuing quiz completion credential', { error: error.message });
            // Even if credential issuance fails, we don't fail the quiz completion
          }
        } else {
          logger.info('Quiz completed but score too low for credential', { userId: user.id, score: averageScore });
        }
      }
      
    } catch (error) {
      logger.error('Error handling conversational quiz response', { error: error.message });
      await ctx.reply('Sorry, there was an error processing your answer. Please try again.');
    }
  }

  /**
   * Handle callback queries from inline keyboards
   * @param {Object} callbackQuery - Callback query
   * @returns {Promise<void>}
   */
  async _handleCallbackQuery(callbackQuery) {
    try {
      const data = callbackQuery.data;
      const ctx = callbackQuery;
      const msg = callbackQuery.message;
      const user = callbackQuery.from;
      
      logger.debug('Handling callback query', { 
        data,
        userId: user.id
      });
      
      // Destructure common pattern of callbackType:action:parameters
      const [callbackType, action, ...params] = data.split(':');
      
      // Handle different callback types
      
      // Standard quiz callbacks
      if (callbackType === 'quiz') {
        if (action === 'start') {
          // Handle start quiz action
          const topic = params[0] || 'blockchain';
          await educationalCredentialService.startQuiz(ctx, { topic });
        }
        else if (action === 'answer') {
          // Handle quiz answer callback
          const questionId = params[0];
          const answerId = params[1];
          
          if (questionId && answerId) {
            await this._handleQuizAnswer(ctx, questionId, answerId);
          }
        }
      }
      
      // Conversational quiz callbacks
      else if (callbackType === 'conversational_quiz') {
        // This callback has been removed since we're now starting the quiz directly
        logger.debug('Legacy conversational quiz callback - ignoring', { action });
        // Just acknowledge the callback to remove loading state
        await ctx.answerCbQuery();
      }
      
      // Support tier callbacks
      else if (callbackType === 'support') {
        if (action === 'upgrade') {
          const tier = params[0] || 'standard';
          await ctx.answerCbQuery(`Processing upgrade to ${tier} tier...`);
          await this._handleSupportTierUpgrade(ctx, tier);
        }
        else if (action === 'learn_more') {
          await ctx.answerCbQuery('Opening support tier information...');
          await this._sendSupportTierInfo(ctx);
        }
      }
      
      // Trust registry callbacks
      else if (callbackType === 'trust') {
        if (action === 'info') {
          const registryId = params[0];
          await ctx.answerCbQuery('Retrieving trust registry information...');
          await this._handleTrustRegistryInfo(ctx, registryId);
        }
      }
      
      // DID callbacks
      else if (callbackType === 'did') {
        if (action === 'create') {
          await ctx.answerCbQuery('Creating your DID...');
          await this._handleCreateDID(ctx);
        }
        else if (action === 'view') {
          await ctx.answerCbQuery('Retrieving your DID information...');
          await this._handleViewDID(ctx);
        }
      }
      
      // Credential callbacks
      else if (callbackType === 'credential') {
        if (action === 'view') {
          const credentialId = params[0];
          await ctx.answerCbQuery('Retrieving credential information...');
          await this._handleViewCredential(ctx, credentialId);
        }
        else if (action === 'list') {
          await ctx.answerCbQuery('Retrieving your credentials...');
          await this._handleListCredentials(ctx);
        }
      }
      
      // Start quiz callbacks (for educational content messages)
      else if (callbackType === 'start_quiz') {
        const topic = params.join(':') || 'blockchain';
        await ctx.answerCbQuery(`Starting a quiz on ${topic}...`);
        await educationalCredentialService.startQuiz(ctx, { topic });
      }
      
      // Unknown callback type
      else {
        logger.warn('Unknown callback type', { callbackType, action });
        await ctx.answerCbQuery('This action is not supported yet.');
      }
    } catch (error) {
      logger.error('Error handling callback query', { error: error.message });
      
      try {
        await callbackQuery.answerCbQuery('Sorry, an error occurred processing your request.');
      } catch (replyError) {
        logger.error('Error sending callback error reply', { error: replyError.message });
      }
    }
  }
  
  /**
   * Handle message text (including quiz responses)
   * @param {Object} ctx - Telegram context
   * @param {String} text - Message text
   * @returns {Promise<void>}
   */
  async _handleMessageText(ctx, text) {
    try {
      // Check if this is a response to an active conversational quiz
      const user = ctx.from;
      const isQuizResponse = await this._checkAndHandleConversationalQuizResponse(ctx, text);
      
      if (isQuizResponse) {
        logger.debug('Handled as quiz response', { userId: user.id });
        return;
      }
      
      // If not a quiz response, process as a regular command or message
      await this._processCommand(ctx, text);
    } catch (error) {
      logger.error('Error handling message text', { error: error.message });
    }
  }
  
  /**
   * Check if message is a response to an active conversational quiz and handle it
   * @param {Object} ctx - Telegram context
   * @param {String} text - Message text
   * @returns {Promise<boolean>} - Whether this was handled as a quiz response
   */
  async _checkAndHandleConversationalQuizResponse(ctx, text) {
    try {
      const user = ctx.from;
      
      // First check if this might be a video quiz response
      const conversationalVideoQuizHandler = require('../modules/telegram/handlers/conversationalVideoQuizHandler');
      try {
        const activeVideoSession = await conversationalVideoQuizHandler.getActiveQuizSession(user.id);
        
        if (activeVideoSession) {
          // Skip auto-detection for messages that are likely regular conversation
          // Common keywords that indicate a regular message, not a quiz response
          const regularMessagePatterns = [
            /^hi\b/i, /^hello\b/i, /^hey\b/i, /^ok\b/i, /^okay\b/i, 
            /^test\b/i, /^just testing/i, /^thanks/i, /^thank you/i,
            /^what/i, /^how/i, /^why/i, /^when/i, /^where/i, /^can you/i,
            /^could you/i, /^would you/i, /^do you/i, /^is there/i,
            /^is this/i, /^are you/i, /^let's/i, /^lets/i,
            /^\//  // Messages starting with / are commands
          ];

          // Check if the message appears to be a regular conversation
          const isRegularMessage = regularMessagePatterns.some(pattern => pattern.test(text));
          
          // If it looks like a regular message, don't treat as quiz response
          if (isRegularMessage && text.length < 50) {
            logger.info('Ignoring message that looks like regular conversation', { userId: user.id });
            return false;
          }
          
          // If message starts with "Answer:", or is a substantial response, proceed
          if (text.toLowerCase().startsWith('answer:') || text.length > 50) {
            // Extract the actual answer if it was prefixed
            const actualAnswer = text.toLowerCase().startsWith('answer:') ? 
                                text.substring(7).trim() : text;
                                
            // This is a video quiz response, handle it with the video quiz handler
            logger.info('Handling as video quiz response', { userId: user.id });
            await conversationalVideoQuizHandler.handleQuizResponse(ctx, actualAnswer);
            return true;
          }
          
          return false;
        }
      } catch (videoError) {
        logger.warn('Error checking for video quiz session', { error: videoError.message });
        // Continue to check standard quiz session
      }
      
      // Skip if this user doesn't have a session or active quiz
      if (!ctx.session || !ctx.session.conversationalQuizzes || !ctx.session.conversationalQuizzes[user.id]) {
        return false;
      }
      
      // Get the active quiz session
      const quizSession = ctx.session.conversationalQuizzes[user.id];
      
      // Check if this quiz is active and awaiting a response
      if (!quizSession.isActive || !quizSession.awaitingResponse) {
        return false;
      }
      
      // Apply the same message filtering to standard quizzes as we do for video quizzes
      const regularMessagePatterns = [
        /^hi\b/i, /^hello\b/i, /^hey\b/i, /^ok\b/i, /^okay\b/i, 
        /^test\b/i, /^just testing/i, /^thanks/i, /^thank you/i,
        /^what/i, /^how/i, /^why/i, /^when/i, /^where/i, /^can you/i,
        /^could you/i, /^would you/i, /^do you/i, /^is there/i,
        /^is this/i, /^are you/i, /^let's/i, /^lets/i,
        /^\//  // Messages starting with / are commands
      ];
      
      const isRegularMessage = regularMessagePatterns.some(pattern => pattern.test(text));
      
      // Don't process likely regular messages as quiz responses
      if (isRegularMessage && text.length < 50) {
        logger.info('Ignoring message that looks like regular conversation in standard quiz', { userId: user.id });
        return false;
      }
      
      // If message starts with "Answer:", extract the actual answer
      let actualAnswer = text;
      if (text.toLowerCase().startsWith('answer:')) {
        actualAnswer = text.substring(7).trim();
      }
      
      // This is a quiz response, handle it
      await this._handleConversationalQuizResponse(ctx, actualAnswer);
      return true;
    } catch (error) {
      logger.error('Error checking for quiz response', { error: error.message });
      return false;
    }
  }
  
  /**
   * Handle a user's response in a conversational quiz
   * @param {Object} ctx - Telegram context
   * @param {String} response - User's response text
   * @returns {Promise<void>}
   */
  async _handleConversationalQuizResponse(ctx, response) {
    try {
      const user = ctx.from;
      
      // Get the current quiz session
      const quizSession = ctx.session.conversationalQuizzes[user.id];
      
      // Set awaiting response to false to prevent duplicate processing
      quizSession.awaitingResponse = false;
      
      // Get the current question
      const currentQuestionIndex = quizSession.currentQuestion;
      const question = quizSession.questions[currentQuestionIndex];
      
      // Response is being processed, send typing indicator
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
      
      // Make sure grokService is available
      if (!grokService || typeof grokService.evaluateQuizResponse !== 'function') {
        logger.error('Grok service or evaluateQuizResponse function not available');
        await ctx.reply('Sorry, I cannot evaluate your response right now due to a technical issue.');
        return;
      }
      
      logger.info('Evaluating quiz response', { 
        userId: user.id, 
        questionIndex: currentQuestionIndex 
      });
      
      // Evaluate the user's response
      let evaluation;
      try {
        evaluation = await grokService.evaluateQuizResponse({
          question: question,
          userResponse: response,
          videoContext: quizSession.content
        });
        
        // Give a minimum baseline score to any genuine attempt
        if (response.length > 15 && evaluation.score < 40) {
          evaluation.score = Math.max(40, evaluation.score);
          evaluation.correct = evaluation.score >= 65;
          evaluation.feedback = "You've made a good attempt and touched on some relevant points. " + evaluation.feedback;
        }
      } catch (evalError) {
        logger.error('Error evaluating response with Grok', { error: evalError.message });
        
        // Provide a fallback evaluation if the service fails
        evaluation = {
          score: 70,
          correct: true,
          feedback: "You've provided a thoughtful response with some good points.",
          learningAddition: "The Cosmos ecosystem is designed for interoperability between blockchains, offering features like scalability and secure cross-chain transactions.",
          encouragement: "You're making good progress in understanding blockchain concepts!",
          followUpQuestion: "What other benefits do you see in blockchain gaming platforms?"
        };
      }
      
      // Save the answer and evaluation
      quizSession.answers.push({
        question: question.question,
        userResponse: response,
        evaluation: evaluation,
        timestamp: Date.now()
      });
      
      // Prepare and send feedback
      let feedbackMessage = '';
      
      if (evaluation.correct) {
        feedbackMessage = `✅ *Good answer!* (${evaluation.score}/100)\n\n`;
      } else {
        // Use a more encouraging message for partial credit
        if (evaluation.score >= 40) {
          feedbackMessage = `⚠️ *Partially correct* (${evaluation.score}/100)\n\n`;
        } else {
          feedbackMessage = `⚠️ *Let's explore this more* (${evaluation.score}/100)\n\n`;
        }
      }
      
      feedbackMessage += `${evaluation.feedback}\n\n`;
      
      if (evaluation.learningAddition) {
        feedbackMessage += `*Additional insight:*\n${evaluation.learningAddition}\n\n`;
      }
      
      if (evaluation.encouragement) {
        feedbackMessage += `${evaluation.encouragement}\n\n`;
      }
      
      // Check if we've reached the end of the quiz
      const isLastQuestion = currentQuestionIndex >= quizSession.questions.length - 1;
      
      if (isLastQuestion) {
        // Quiz complete - process results
        feedbackMessage += `🏁 *Quiz complete!*\n\n`;
        
        // Calculate overall score with a minimum baseline
        const totalScore = quizSession.answers.reduce((sum, answer) => sum + answer.evaluation.score, 0);
        let averageScore = totalScore / quizSession.answers.length;
        
        // Ensure the score is at least 50 if user completed all questions
        if (quizSession.answers.length === quizSession.questions.length && averageScore < 50) {
          averageScore = Math.max(50, averageScore);
        }
        
        const passed = averageScore >= 65;
        
        feedbackMessage += `Your final score: *${Math.round(averageScore)}/100*\n\n`;
        
        if (passed) {
          feedbackMessage += `🎓 *Congratulations!* You've earned an educational credential for completing this quiz successfully.`;
          
          // Mark quiz as completed
          quizSession.isActive = false;
          quizSession.completed = true;
          quizSession.passed = true;
          quizSession.endTime = Date.now();
          
          // Send the feedback
          await ctx.reply(feedbackMessage, { parse_mode: 'Markdown' });
          
          // Issue the credential
          await this._issueQuizCredential(ctx, user, quizSession);
        } else {
          feedbackMessage += `You didn't quite reach the passing score of 65. Would you like to try again?`;
          
          // Mark quiz as completed but not passed
          quizSession.isActive = false;
          quizSession.completed = true;
          quizSession.passed = false;
          quizSession.endTime = Date.now();
          
          // Send the feedback with retry option
          await ctx.reply(feedbackMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Try Again', callback_data: `quiz:start:${quizSession.topic}` }]
              ]
            }
          });
        }
      } else {
        // Not the last question - move to next question
        quizSession.currentQuestion++;
        const nextQuestion = quizSession.questions[quizSession.currentQuestion];
        
        // Add next question to feedback
        feedbackMessage += `*Question ${quizSession.currentQuestion + 1} of ${quizSession.questions.length}:*\n${nextQuestion.question}`;
        
        // Send feedback and next question
        await ctx.reply(feedbackMessage, { parse_mode: 'Markdown' });
        
        // Mark as awaiting response again
        quizSession.awaitingResponse = true;
      }
    } catch (error) {
      logger.error('Error handling conversational quiz response', { error: error.message });
      await ctx.reply('Sorry, there was a problem processing your response. The quiz will continue with the next question.');
      
      // Try to move to the next question if possible
      try {
        const user = ctx.from;
        const quizSession = ctx.session.conversationalQuizzes[user.id];
        
        if (quizSession && quizSession.isActive) {
          // Move to next question
          quizSession.currentQuestion++;
          
          // Check if we've reached the end
          if (quizSession.currentQuestion >= quizSession.questions.length) {
            // End the quiz
            await ctx.reply('That was the last question. The quiz is now complete, but I could not evaluate all your answers.');
            quizSession.isActive = false;
            quizSession.completed = true;
          } else {
            // Ask the next question
            const nextQuestion = quizSession.questions[quizSession.currentQuestion];
            await ctx.reply(`*Question ${quizSession.currentQuestion + 1} of ${quizSession.questions.length}:*\n${nextQuestion.question}`, {
              parse_mode: 'Markdown'
            });
            quizSession.awaitingResponse = true;
          }
        }
      } catch (recoveryError) {
        logger.error('Error in quiz recovery attempt', { error: recoveryError.message });
      }
    }
  }
}

// Export singleton instance
const telegramService = new TelegramService();
module.exports = telegramService; 