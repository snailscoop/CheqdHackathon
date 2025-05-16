/**
 * Unified Credential Handlers
 * 
 * Provides a unified interface for various credential operations.
 */

const logger = require('../../../utils/logger');
const { Markup } = require('telegraf');
const cheqdService = require('../../../services/cheqdService');
const sqliteService = require('../../../db/sqliteService');
const grokService = require('../../../services/grokService');
const telegramService = require('../../../services/telegramService');
const educationalCredentialService = require('../../education/educationalCredentialService');
const supportCredentialService = require('../../support/supportCredentialService');
const moderationService = require('../../moderation/moderationService');
const moderationCredentialService = require('../../moderation/moderationCredentialService');
const credentialNlpService = require('../../grok/credentialNlpService');
const { verifyEducationalAccess, getUserCredentials } = require('../../unifiedCredentialHandlers');

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
    
    // Check for group setup commands - high priority
    const setupMatch = command.match(/(?:ready|setup|set\s+up|start|get\s+started)(?:\s+(?:the|this|a|an)\s+(?:bot|group|chat|community))?/i);
    if (setupMatch && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
      logger.info('Detected setup command in /dail message', { command });
      return await handleGroupSetup(ctx);
    }
    
    // Check for transaction hash pattern - high priority
    const txHashRegex = /\b([A-F0-9]{64})\b/i;
    const txHashMatch = command.match(txHashRegex);
    
    if (txHashMatch) {
      logger.info('Transaction hash detected in command', {
        txHash: txHashMatch[1],
        command
      });
      
      // Extract chain ID if specified
      let chainId = 'stargaze-1'; // Default chain
      
      const chainRegex = /on\s+([a-zA-Z0-9-]+)/i;
      const chainMatch = command.match(chainRegex);
      if (chainMatch && chainMatch[1]) {
        chainId = chainMatch[1].toLowerCase();
      } else if (command.toLowerCase().includes('osmosis')) {
        chainId = 'osmosis-1';
      } else if (command.toLowerCase().includes('cosmos')) {
        chainId = 'cosmoshub-4';
      } else if (command.toLowerCase().includes('juno')) {
        chainId = 'juno-1';
      } else if (command.toLowerCase().includes('cheqd')) {
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
      
      const isWhatHappenedQuery = whatHappenedPatterns.some(pattern => pattern.test(command));
      
      if (isWhatHappenedQuery) {
        // Handle as "what happened" inquiry
        return await handleWhatHappened(ctx, {
          txHash: txHashMatch[1],
          chainId
        });
      }
      
      // Handle as regular blockchain transaction
      return await handleBlockchainTransaction(ctx, {
        txHash: txHashMatch[1],
        chainId
      });
    }
    
    // Enhanced pattern matching for moderation commands - most critical functionality
    const kickMatch = command.match(/(?:kick|remove|boot)\s+(?:@)?(\w+)(?:\s+(.+))?/i);
    const banMatch = command.match(/(?:ban|block)\s+(?:@)?(\w+)(?:\s+(.+))?/i);
    const muteMatch = command.match(/(?:mute|silence)\s+(?:@)?(\w+)(?:\s+for\s+(\d+)(?:\s+(.+))?)?/i);
    const modMatch = command.match(/(?:make|set|add)\s+(?:@)?(\w+)(?:\s+(?:a|as))?\s+(?:mod|moderator)(?:\s+(\w+))?/i);
    
    // Process educational commands with pattern matching
    const quizMatch = command.match(/(?:start|take|begin)\s+(?:a\s+)?(?:quiz|test)(?:\s+(?:about|on)\s+(.+))?/i);
    const progressMatch = command.match(/(?:check|show|view)(?:\s+my)?\s+(?:progress|stats|achievements)/i);
    const learnMatch = command.match(/(?:learn|teach|tell\s+me)\s+(?:about)?(?:\s+)?([a-zA-Z0-9 ]+)/i);
    
    // Process support tier commands
    const tierCheckMatch = command.match(/(?:check|show|view)(?:\s+my)?\s+(?:support|tier|subscription)/i);
    const tierUpgradeMatch = command.match(/(?:upgrade|subscribe)(?:\s+to)?(?:\s+the)?(?:\s+(?:support|tier|plan))?(?:\s+(?:level|plan))?\s+([a-zA-Z]+)/i);
    
    // Handle direct execution routes first
    // 1. Moderation commands
    if (kickMatch) {
      try {
        logger.info('Detected kick command in /dail message', { command });
        
        const username = kickMatch[1].replace('@', '');
        const reason = kickMatch[2] || 'No reason provided';
        const chatId = ctx.chat.id;
        const moderatorId = ctx.from.id;
        
        // Check if user is admin or moderator
        logger.info('Checking if user is moderator', { userId: moderatorId, chatId });
        let isAdmin = false;
        try {
          const chatMember = await ctx.telegram.getChatMember(chatId, moderatorId);
          isAdmin = ['creator', 'administrator'].includes(chatMember.status);
          logger.debug('User is a Telegram admin', { userId: moderatorId, chatId });
        } catch (error) {
          logger.error('Error checking admin status', { error: error.message });
        }
        
        const isModerator = await moderationCredentialService.isUserModerator(moderatorId, chatId);
        
        if (!isAdmin && !isModerator) {
          return ctx.reply('You do not have permission to kick users from this chat.');
        }
        
        // Find target user and execute kick action directly
        logger.info('Finding target user', { username, chatId });
        // Use our improved findTargetUser function
        const targetUser = await findTargetUser(ctx, username);
        
        if (!targetUser) {
          logger.warn('User not found with any method', { username, chatId });
          return ctx.reply('User not found. Make sure the username is correct and they have sent a message in this chat before.');
        }
        
        // Execute kick action directly
        const moderator = { id: moderatorId, username: ctx.from.username, first_name: ctx.from.first_name };
        const target = { id: targetUser.id, username: targetUser.username, first_name: targetUser.first_name };
        const chat = { id: chatId, title: ctx.chat.title };
        
        logger.info('Executing kick action from /dail command', { 
          moderator: moderator.username,
          target: target.username
        });
        
        try {
          const kickResult = await moderationService.executeAction('kick', moderator, target, chat, { reason });
          
          if (!kickResult.success) {
            return ctx.reply(`Failed to kick user: ${kickResult.message}`);
          }
          
          return ctx.reply(kickResult.message);
        } catch (kickError) {
          logger.error('Error executing kick action', { error: kickError.message });
          return ctx.reply('Sorry, there was an error kicking the user. Please try again later.');
        }
      } catch (error) {
        logger.error('Error handling direct kick command', { error: error.message });
        return ctx.reply('Error executing kick command. Please try again or use the /kick command directly.');
      }
    }
    
    // 2. Education commands
    if (quizMatch) {
      try {
        const topic = quizMatch[1] || 'blockchain';
        logger.info('Detected quiz command in /dail message', { topic });
        return await educationalCredentialService.startQuiz(ctx, {
          topic,
          userId: ctx.from.id
        });
      } catch (error) {
        logger.error('Error handling direct quiz command', { error: error.message });
        return ctx.reply('Error starting quiz. Please try again later.');
      }
    }
    
    if (progressMatch) {
      try {
        logger.info('Detected progress check command in /dail message');
        const progressText = await educationalCredentialService.formatEducationalProgress(ctx.from.id);
        return ctx.reply(progressText, { parse_mode: 'Markdown' });
      } catch (error) {
        logger.error('Error handling direct progress command', { error: error.message });
        return ctx.reply('Error checking educational progress. Please try again later.');
      }
    }
    
    if (learnMatch) {
      try {
        const topic = learnMatch[1]?.trim() || 'blockchain';
        logger.info('Detected learning command in /dail message', { topic });
        const educationalContent = await educationalCredentialService.getEducationalContent(topic);
        
        if (!educationalContent || educationalContent.length === 0) {
          return ctx.reply(`No educational content found for topic: ${topic}. Try a different topic!`);
        }
        
        // Format the content as markdown text with quiz button
        for (const item of educationalContent) {
          const ipfsUrl = item.cid ? `https://ipfs.jackallabs.io/ipfs/${item.cid}?filename=${encodeURIComponent(item.title)}.mp4` : null;
          
          let message = `📚 *${item.title}*\n\n`;
          message += `${item.overview.split('.')[0]}.\n\n`;
          
          if (ipfsUrl) {
            message += `🔗 *Educational Video:* [Watch on Jackal](${ipfsUrl})\n\n`;
            message += `👀 *Watch this video and take a quiz to earn an educational credential!*\n`;
          }

          const topicName = item.title.split(':')[0].trim();
          
          // First send the content
          await ctx.reply(message, { parse_mode: 'Markdown' });
          
          // Then send the quiz button separately to ensure it appears
          // For video content with CID, use the quiz_cid format for the callback
          if (item.cid) {
            // Truncate CID to stay within Telegram's 64-byte callback data limit
            const shortCid = item.cid.substring(0, 24); // Use first 24 chars of CID for callback data
            await ctx.reply('Start a quiz on this video:', {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📝 Start Quiz Now', callback_data: `quiz_cid_${shortCid}` }]
                ]
              }
            });
          } else {
            // For non-video content, use the original quiz:start format
            await ctx.reply('Start a quiz on this topic:', {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📝 Start Quiz Now', callback_data: `quiz:start:${topicName}` }]
                ]
              }
            });
          }
        }
        
        return;
      } catch (error) {
        logger.error('Error handling direct learning command', { error: error.message });
        return ctx.reply('Error retrieving educational content. Please try again later.');
      }
    }
    
    // 3. Moderator commands - direct handling
    if (modMatch) {
      try {
        logger.info('Detected make moderator command in /dail message', { command });
        
        const username = modMatch[1].replace('@', '');
        const role = modMatch[2]?.toLowerCase() || 'basic'; // Default to basic role if not specified
        const chatId = ctx.chat.id;
        const adminId = ctx.from.id;
        
        // Check if user has admin rights
        logger.info('Checking if user has admin rights', { userId: adminId, chatId });
        let isAdmin = false;
        try {
          const chatMember = await ctx.telegram.getChatMember(chatId, adminId);
          isAdmin = ['creator', 'administrator'].includes(chatMember.status);
          logger.debug('User is a Telegram admin', { userId: adminId, chatId });
        } catch (error) {
          logger.error('Error checking admin status', { error: error.message });
        }
        
        // Also check if user is a moderator with sufficient privileges
        const isModerator = await moderationCredentialService.isUserModerator(adminId, chatId);
        const verificationResult = await moderationCredentialService.verifyModerationAuthority(
          adminId, 'add_moderator', chatId
        );
        
        // Only allow admins or properly verified moderators to create new moderators
        if (!isAdmin && (!isModerator || !verificationResult.verified)) {
          logger.warn('User lacks permission to make moderator', { adminId, chatId });
          return ctx.reply('You do not have permission to make users moderators in this chat. Only admins and authorized moderators can perform this action.');
        }
        
        // Find target user
        logger.info('Finding target user', { username, chatId });
        const targetUser = await findTargetUser(ctx, username);
        
        if (!targetUser) {
          logger.warn('User not found with any method', { username, chatId });
          return ctx.reply('User not found. Make sure the username is correct and they have sent a message in this chat before.');
        }
        
        logger.info('Target user found', { targetId: targetUser.id, targetUsername: targetUser.username });
        
                 // Determine the role level based on the provided role string
         let roleType;
         switch (role) {
           case 'admin':
             roleType = 'GROUP_ADMIN';
             break;
           case 'trusted':
           case 'cross':
             roleType = 'CROSS_CHAT_MODERATOR';
             break;
           case 'basic':
           default:
             roleType = 'GROUP_MODERATOR'; // Use GROUP_MODERATOR which is defined in the service
             break;
         }
        
                 // Create issuer and recipient objects
         const issuer = {
           id: adminId.toString(),
           username: ctx.from.username,
           firstName: ctx.from.first_name,
           lastName: ctx.from.last_name || ''
         };
         
         const recipient = {
           id: targetUser.id.toString(),
           username: targetUser.username || '',
           firstName: targetUser.first_name || '',
           lastName: targetUser.last_name || ''
         };
         
         const chat = {
           id: chatId.toString(),
           title: ctx.chat.title || `Chat ${chatId}`,
           type: ctx.chat.type
         };
        
        // Get or create DIDs for both users
        try {
          // Get DIDs for issuer and recipient
          const issuerDids = await cheqdService.getUserDids(issuer.id);
          const recipientDids = await cheqdService.getUserDids(recipient.id);
          
                     // Get or create issuer DID
           let issuerDid;
           if (issuerDids && issuerDids.length > 0) {
             issuerDid = issuerDids[0].did;
             logger.debug('Using existing issuer DID', { did: issuerDid });
           } else {
             logger.debug('Creating new issuer DID');
             // Use createDID (with uppercase D) as that's the actual function name
             issuerDid = await cheqdService.createDID(issuer.id);
             logger.debug('Created new issuer DID', { did: issuerDid });
           }
           
           // Get or create recipient DID
           let recipientDid;
           if (recipientDids && recipientDids.length > 0) {
             recipientDid = recipientDids[0].did;
             logger.debug('Using existing recipient DID', { did: recipientDid });
           } else {
             logger.debug('Creating new recipient DID');
             // Use createDID (with uppercase D) as that's the actual function name
             recipientDid = await cheqdService.createDID(recipient.id);
             logger.debug('Created new recipient DID', { did: recipientDid });
           }
          
          // Update objects with DIDs
          issuer.did = issuerDid;
          recipient.did = recipientDid;
          
          // Issue moderation credential
          logger.info('Issuing moderation credential', { 
            issuer: issuer.username,
            recipient: recipient.username,
            role: roleType
          });
          
          const result = await moderationCredentialService.issueModerationCredential(
            issuer,
            recipient,
            roleType,
            chat,
            { override: isAdmin } // Allow credential issuance if issuer is an admin
          );
          
          if (!result) {
            logger.error('Failed to issue moderation credential', { username });
            return ctx.reply('Failed to make user a moderator. Please try again later.');
          }
          
          logger.info('Successfully made user a moderator', { 
            username, 
            chatId, 
            role: roleType,
            credentialId: result.credential?.credential_id 
          });
          
          return ctx.reply(`✅ @${username} has been made a ${roleType.replace(/_/g, ' ')} in this chat. They now have moderation privileges.`);
        } catch (error) {
          logger.error('Error creating DIDs or issuing credential', { error: error.message });
          return ctx.reply('Error making user a moderator: ' + error.message);
        }
      } catch (error) {
        logger.error('Error handling make moderator command', { error: error.message });
        return ctx.reply('Sorry, there was an error making the user a moderator. Please try again later.');
      }
    }
    
    // 4. Support commands
    if (tierCheckMatch) {
      try {
        logger.info('Detected tier check command in /dail message');
        const tierInfo = await supportCredentialService.formatSupportTierInfo(ctx.from.id);
        return ctx.reply(tierInfo, { parse_mode: 'Markdown' });
      } catch (error) {
        logger.error('Error handling tier check command', { error: error.message });
        return ctx.reply('Error checking support tier. Please try again later.');
      }
    }
    
    // 4. Help command - direct handling
    if (command.toLowerCase() === 'help') {
      try {
        logger.info('Detected help command in /dail message');
        return ctx.reply(
          "🤖 *Dail Bot Help* 🤖\n\n" +
          "*Available Commands:*\n" +
          "• `/dail help` - Show this help message\n" +
          "• `/dail features` - Manage group features\n" +
          "• `/dail what are my dids` - Check your DIDs\n" +
          "• `/dail create a new did` - Create a new DID\n" +
          "• `/dail check support tier` - View your support tier\n" +
          "• `/dail start quiz` - Take an educational quiz\n\n" +
          "You can also ask me questions in natural language!",
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        logger.error('Error handling help command', { error: error.message });
        return ctx.reply('Error displaying help. Please try again later.');
      }
    }
    
    // 5. Features command - direct handling
    if (command.toLowerCase() === 'features') {
      try {
        logger.info('Detected features command in /dail message');
        
        // Get chat features from moderation service
        const moderationService = require('../../../modules/moderation/moderationService');
        await moderationService.ensureInitialized();
        
        const features = await moderationService.getChatFeatures(ctx.chat.id);
        
        // Format features as a message
        const featuresText = Object.entries(features)
          .map(([feature, status]) => `• ${feature}: ${status.enabled ? '✅ Enabled' : '❌ Disabled'}`)
          .join('\n');
        
        // Create feature toggle keyboard
        const keyboard = {
          inline_keyboard: [
            [
              { text: "✅ Enable Cross-Chat Moderation", callback_data: `feature:${moderationService.FEATURES.CROSS_CHAT_MODERATION}:enable` },
              { text: "❌ Disable Cross-Chat Moderation", callback_data: `feature:${moderationService.FEATURES.CROSS_CHAT_MODERATION}:disable` }
            ],
            [
              { text: "✅ Enable Platform Moderation", callback_data: `feature:${moderationService.FEATURES.PLATFORM_MODERATION}:enable` },
              { text: "❌ Disable Platform Moderation", callback_data: `feature:${moderationService.FEATURES.PLATFORM_MODERATION}:disable` }
            ],
            [
              { text: "✅ Enable Educational Credentials", callback_data: `feature:${moderationService.FEATURES.EDUCATIONAL_CREDENTIALS}:enable` },
              { text: "❌ Disable Educational Credentials", callback_data: `feature:${moderationService.FEATURES.EDUCATIONAL_CREDENTIALS}:disable` }
            ],
            [
              { text: "✅ Enable Trust Network", callback_data: `feature:${moderationService.FEATURES.TRUST_NETWORK}:enable` },
              { text: "❌ Disable Trust Network", callback_data: `feature:${moderationService.FEATURES.TRUST_NETWORK}:disable` }
            ]
          ]
        };
        
        return ctx.reply(
          "🎛️ *Feature Configuration*\n\n" +
          "Current feature settings:\n\n" +
          featuresText + "\n\n" +
          "Use the buttons below to toggle features:",
          { reply_markup: keyboard, parse_mode: 'Markdown' }
        );
      } catch (error) {
        logger.error('Error handling features command', { error: error.message });
        return ctx.reply('Error displaying features. Please try again later.');
      }
    }
    
    // 4. DID commands - direct handling for these critical commands
    const didCheckMatch = command.match(/(?:what\s+(?:are|is)|check|show|list|view|see|get)\s+my\s+did(?:s)?/i);
    if (didCheckMatch) {
      try {
        logger.info('Detected DID query command in /dail message', { command });
        
        // Get user ID
        const userId = ctx.from.id;
        
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
        // Fetch DIDs from database
        try {
          const dids = await sqliteService.db.all(
            'SELECT * FROM dids WHERE owner_id = ?',
            [userId.toString()]
          );
          
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
        } catch (dbError) {
          logger.warn('Error querying DIDs from database', { error: dbError.message });
          
          // Fallback to service method
          const dids = await cheqdService.getUserDids(userId);
          
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
        }
      } catch (error) {
        logger.error('Error handling DID query command', { error: error.message });
        return ctx.reply('Error retrieving your DIDs. Please try again later.');
      }
    }
    
    if (tierUpgradeMatch) {
      try {
        const requestedTier = tierUpgradeMatch[1]?.toLowerCase() || 'standard';
        logger.info('Detected tier upgrade command in /dail message', { tier: requestedTier });
        return await handleSupportUpgradeRequest(ctx, { requestedTier });
      } catch (error) {
        logger.error('Error handling tier upgrade command', { error: error.message });
        return ctx.reply('Error upgrading support tier. Please try again later.');
      }
    }
    
    // For commands not matched by direct patterns, use Grok AI
    // Provide context for better intent recognition
    const context = {
      userId: ctx.from.id,
      chatId: ctx.chat.id,
      chatType: ctx.chat.type,
      username: ctx.from.username,
      originalText: command
    };
    
    // Process with enhanced context for credential operations
    const credentialOp = await credentialNlpService.processCredentialCommand(command, { 
      userId: ctx.from.id,
      chatId: ctx.chat.id
    });
    
    // Check if it's a credential operation first with the enhanced NLP service
    if (credentialOp.isCredentialOperation && credentialOp.confidence > 0.7) {
      logger.info('Detected credential operation with enhanced NLP', { intent: credentialOp.intent });
      
      switch (credentialOp.intent) {
        case 'issue_credential':
          return await handleIssueCredential(ctx, credentialOp.entities);
        
        case 'verify_credential':
          return await handleVerifyCredential(ctx, credentialOp.entities);
        
        case 'revoke_credential':
          return await handleRevokeCredential(ctx, credentialOp.entities);
        
        case 'list_credentials':
          return await handleListCredentials(ctx, credentialOp.entities);
        
        case 'check_revocation':
          return await handleCheckCredential(ctx, credentialOp.entities);
        
        case 'credential_details':
          return await handleCredentialDetails(ctx, credentialOp.entities);
        
        case 'credential_schema':
          return await handleCredentialSchema(ctx, credentialOp.entities);
        
        default:
          return ctx.reply(credentialOp.message || 'I understand you want to do something with credentials, but I need more specific instructions.');
      }
    }
    
    // If not a credential operation, proceed with general Grok processing
    const result = await grokService.processCommand(command, context);
    
    if (result.error) {
      return ctx.reply(`Error processing command: ${result.error}`);
    }
    
    // Handle based on intent type returned from Grok
    if (result.type === 'function') {
      // Handle function calls based on the function name
      logger.info('Grok identified function to execute', { function: result.function });
      
      switch (result.function) {
        // Education functions
        case 'generate_quiz':
        case 'start_quiz':
          return await educationalCredentialService.startQuiz(ctx, {
            topic: result.parameters.topic || 'blockchain',
            difficulty: result.parameters.difficulty || 'medium',
            userId: ctx.from.id
          });
          
        case 'show_progress':
        case 'check_progress':
          const progressText = await educationalCredentialService.formatEducationalProgress(ctx.from.id);
          return ctx.reply(progressText, { parse_mode: 'Markdown' });
          
        case 'learn_topic':
          const educationalContent = await educationalCredentialService.getEducationalContent(
            result.parameters.topic || 'blockchain'
          );
          return ctx.reply(educationalContent, { parse_mode: 'Markdown' });
        
        // Support functions
        case 'check_support_tier':
          const tierInfo = await supportCredentialService.formatSupportTierInfo(ctx.from.id);
          return ctx.reply(tierInfo, { parse_mode: 'Markdown' });
          
        case 'upgrade_support_tier':
          return await handleSupportUpgradeRequest(ctx, { 
            requestedTier: result.parameters.target_tier || 'standard' 
          });
          
        // Credential functions  
        case 'issue_credential':
          return await handleIssueCredential(ctx, result.parameters);
          
        case 'verify_credential':
          return await handleVerifyCredential(ctx, result.parameters);
          
        case 'revoke_credential':
          return await handleRevokeCredential(ctx, result.parameters);
          
        case 'list_credentials':
        case 'get_user_credentials':
          return await handleListCredentials(ctx, result.parameters);
          
        case 'check_credential':
          return await handleCheckCredential(ctx, result.parameters);
          
        default:
          return ctx.reply('I recognize that command but I\'m not sure how to handle it yet.');
      }
    } else if (result.type === 'credential') {
      // Handle credential-specific operations from credentialNlpService
      const credResult = result.result;
      
      switch (credResult.intent) {
        case 'issue_credential':
          return await handleIssueCredential(ctx, credResult.parameters);
          
        case 'verify_credential':
          return await handleVerifyCredential(ctx, credResult.parameters);
          
        case 'revoke_credential':
          return await handleRevokeCredential(ctx, credResult.parameters);
          
        case 'list_credentials':
          return await handleListCredentials(ctx, credResult.parameters);
          
        default:
          return ctx.reply(credResult.message || 'I understand this is related to credentials, but I\'m not sure what action to take.');
      }
    } else if (result.type === 'text' || result.type === 'general_chat') {
      // Just return the message for general chat
      return ctx.reply(result.message);
    } else {
      return ctx.reply('I\'m not sure what you want to do. Try issuing a specific command or asking for help.');
    }
  } catch (error) {
    logger.error('Error in credential command handler', { error: error.message });
    return ctx.reply('Sorry, there was an error processing your command.');
  }
}

/**
 * Helper function to find a target user by username
 * @param {Object} ctx - Telegram context
 * @param {String} username - Username to find
 * @returns {Promise<Object|null>} - User object or null if not found
 */
async function findTargetUser(ctx, username) {
  try {
    const chatId = ctx.chat.id;
    logger.info('Finding target user', { username, chatId });
    
    // Clean the username (remove @ if present)
    if (username.startsWith('@')) {
      username = username.substring(1);
    }
    
    // Step 0: Try database lookup first (most reliable)
    try {
      // Query the database directly for the user
      const dbUser = await sqliteService.db.get(
        'SELECT * FROM users WHERE username = ?',
        [username]
      );
      
      if (dbUser) {
        logger.info('Found user in database', { username, userId: dbUser.id });
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
    
    // Step 1: Try local userMap (fastest, if available)
    if (telegramService && telegramService.userMap) {
      const userMap = Array.from(telegramService.userMap.values());
      const targetUser = userMap.find(u => u.username?.toLowerCase() === username.toLowerCase());
      
      if (targetUser) {
        logger.info('Found user in userMap', { username, userId: targetUser.id });
        return targetUser;
      }
    }
    
    // Step 2: Try using getChatMembers to get all chat members
    // This is more reliable but more expensive
    try {
      logger.info('Attempting to get chat members', { chatId });
      // First try to get chat member directly - this works even if they haven't sent a message
      const chatMember = await ctx.telegram.getChatMember(chatId, `@${username}`);
      if (chatMember && chatMember.user) {
        logger.info('Found user with getChatMember using @', { username, userId: chatMember.user.id });
        return chatMember.user;
      }
    } catch (err) {
      logger.warn('Failed to find user through getChatMember with @', { username, error: err.message });
      
      // Try without @ prefix
      try {
        const chatMember = await ctx.telegram.getChatMember(chatId, username);
        if (chatMember && chatMember.user) {
          logger.info('Found user with getChatMember without @', { username, userId: chatMember.user.id });
          return chatMember.user;
        }
      } catch (innerErr) {
        logger.warn('Failed to find user through getChatMember without @', { username, error: innerErr.message });
      }
    }
    
    // Step 3: Try fetching chat administrators as a last resort
    try {
      const admins = await ctx.telegram.getChatAdministrators(chatId);
      if (admins && admins.length > 0) {
        const matchingAdmin = admins.find(admin => 
          admin.user.username?.toLowerCase() === username.toLowerCase()
        );
        
        if (matchingAdmin) {
          logger.info('Found user in admin list', { username, userId: matchingAdmin.user.id });
          return matchingAdmin.user;
        }
      }
    } catch (listErr) {
      logger.warn('Failed to find user in admin list', { username, error: listErr.message });
    }
    
    // Step 4: For numeric usernames, try direct user ID lookup
    if (/^\d+$/.test(username)) {
      try {
        const userId = parseInt(username, 10);
        const chatMember = await ctx.telegram.getChatMember(chatId, userId);
        if (chatMember && chatMember.user) {
          logger.info('Found user by numeric ID', { username, userId });
          return chatMember.user;
        }
      } catch (numErr) {
        logger.warn('Failed to find user by numeric ID', { username, error: numErr.message });
      }
    }
    
    // Step 5: Try getting members of the chat (this method may not be available in all Telegram bot API versions)
    try {
      logger.info('Attempting to get specific chat member by username', { username, chatId });
      
      // Try with different username formats
      const attempts = [
        async () => await ctx.telegram.getChatMember(chatId, username),
        async () => await ctx.telegram.getChatMember(chatId, `@${username}`),
        async () => await ctx.telegram.getChatMember(chatId, username.toLowerCase())
      ];
      
      for (const attempt of attempts) {
        try {
          const result = await attempt();
          if (result && result.user) {
            logger.info('Found user through alternative method', { username, userId: result.user.id });
            return result.user;
          }
        } catch (e) {
          // Continue to next attempt
        }
      }
    } catch (err) {
      logger.warn('Failed all alternative methods to find user', { username, error: err.message });
    }
    
    // Step 6: Check if this is a channel message or reply and try to extract user info
    if (ctx.message && ctx.message.reply_to_message) {
      const replyMsg = ctx.message.reply_to_message;
      if (replyMsg.from && replyMsg.from.username === username) {
        logger.info('Found user from reply', { username, userId: replyMsg.from.id });
        return replyMsg.from;
      }
    }
    
    logger.warn('User not found with any method', { username, chatId });
    return null;
  } catch (error) {
    logger.error('Error finding target user', { error: error.message, username });
    return null;
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
    const queryParams = [holderDid];
    
    if (type) {
      query += ' AND type LIKE ?';
      queryParams.push(`%${type}%`);
    }
    
    query += ' ORDER BY issued_at DESC';
    
    // Query the database for credentials
    const credentials = await sqliteService.db.all(query, queryParams);
    
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
 * Handle detailed credential information view
 * @param {Object} ctx - Telegram context
 * @param {Object} params - Credential parameters
 * @returns {Promise<void>}
 */
async function handleCredentialDetails(ctx, params) {
  try {
    const userId = ctx.from.id;
    const credentialId = params.credentialId;
    const credentialType = params.credentialType;
    
    // Get user DIDs
    const userDids = await credentialNlpService.getUserDids(userId);
    
    if (!userDids || userDids.length === 0) {
      return ctx.reply('You don\'t have any credentials yet.');
    }
    
    // If we have a specific credential ID, show its details
    if (credentialId) {
      const credential = await credentialNlpService.getCredentialById(credentialId);
      
      if (!credential) {
        return ctx.reply(`No credential found with ID: ${credentialId}`);
      }
      
      // Format credential for display
      const formattedCredential = await credentialNlpService.formatCredentialForDisplay(credential);
      
      return ctx.reply(formattedCredential, { parse_mode: 'Markdown' });
    }
    
    // If we have a credential type, show the most recent credential of that type
    if (credentialType) {
      let didFilter = '';
      let params = [];
      
      // Build query with multiple DIDs in IN clause
      if (userDids.length > 0) {
        const didPlaceholders = userDids.map(() => '?').join(',');
        didFilter = `holder_did IN (${didPlaceholders})`;
        params = userDids.map(did => did.did);
      }
      
      // Add type filter
      if (didFilter) {
        didFilter += ' AND ';
      }
      didFilter += 'type = ?';
      params.push(credentialType);
      
      // Get the most recent credential of the specified type
      const credential = await sqliteService.db.get(
        `SELECT * FROM credentials 
         WHERE ${didFilter}
         ORDER BY issued_at DESC 
         LIMIT 1`,
        params
      );
      
      if (!credential) {
        return ctx.reply(`You don't have any ${credentialType} credentials.`);
      }
      
      // Format credential for display
      const formattedCredential = await credentialNlpService.formatCredentialForDisplay(credential);
      
      return ctx.reply(formattedCredential, { parse_mode: 'Markdown' });
    }
    
    // If no specific credential or type specified, show a summary of available credentials
    return await handleListCredentials(ctx, params);
  } catch (error) {
    logger.error('Error handling credential details', { error: error.message });
    return ctx.reply('Sorry, there was an error retrieving credential details.');
  }
}

/**
 * Handle credential schema information
 * @param {Object} ctx - Telegram context
 * @param {Object} params - Credential parameters
 * @returns {Promise<void>}
 */
async function handleCredentialSchema(ctx, params) {
  try {
    const credentialType = params.credentialType;
    
    if (!credentialType) {
      // Show available credential types in the system
      const types = await sqliteService.db.all(
        `SELECT DISTINCT type FROM credentials WHERE type IS NOT NULL`
      );
      
      if (!types || types.length === 0) {
        return ctx.reply('No credential types found in the system.');
      }
      
      const typesList = types.map(t => `- ${t.type}`).join('\n');
      return ctx.reply(`Available credential types:\n${typesList}\n\nTo see schema details, use: /dail credential schema <type>`);
    }
    
    // Get schema for specific credential type
    const schema = await credentialNlpService.getCredentialSchema(credentialType);
    
    if (!schema || schema.error) {
      return ctx.reply(`Error retrieving schema for ${credentialType}: ${schema?.error || 'Schema not found'}`);
    }
    
    // Format schema information
    let response = `*Schema for ${credentialType} Credentials*\n\n`;
    
    // Database table structure
    response += '*Database Columns:*\n';
    schema.columns.forEach(col => {
      response += `- \`${col.name}\` (${col.type})\n`;
    });
    
    // Data structure if available
    if (schema.dataSchema) {
      if (schema.dataSchema.context) {
        response += '\n*Context:*\n';
        const contexts = Array.isArray(schema.dataSchema.context) ? 
          schema.dataSchema.context : [schema.dataSchema.context];
        
        contexts.forEach(ctx => {
          response += `- ${ctx}\n`;
        });
      }
      
      if (schema.dataSchema.subjectProperties) {
        response += '\n*Subject Properties:*\n';
        schema.dataSchema.subjectProperties.forEach(prop => {
          response += `- \`${prop}\`\n`;
        });
      }
    }
    
    return ctx.reply(response, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error handling credential schema', { error: error.message });
    return ctx.reply('Sorry, there was an error retrieving credential schema information.');
  }
}

/**
 * Handle blockchain transaction analysis
 * @param {Object} ctx - Telegram context
 * @param {Object} params - Parameters
 * @param {string} params.txHash - Transaction hash
 * @param {string} params.chainId - Chain ID (defaults to 'stargaze-1')
 * @param {boolean} params.fromCallback - Whether this is coming from a callback query
 * @returns {Promise<void>}
 */
async function handleBlockchainTransaction(ctx, params) {
  try {
    const { txHash, chainId = 'stargaze-1', fromCallback = false } = params;
    
    if (!txHash) {
      return ctx.reply('Please provide a valid transaction hash to analyze.');
    }
    
    logger.info('Analyzing blockchain transaction', { 
      txHash,
      chainId,
      userId: ctx.from.id,
      fromCallback
    });
    
    // Skip typing indicator and processing message if from callback
    let processingMsg;
    if (!fromCallback) {
      // Show typing indicator while analyzing
      await ctx.replyWithChatAction('typing');
      
      // Let the user know we're working on it
      processingMsg = await ctx.reply(`Analyzing transaction ${txHash.substring(0, 8)}...${txHash.substring(txHash.length - 8)} on ${chainId}...`);
    }
    
    // Import the GrokTxAnalyzer
    let grokTxAnalyzer;
    try {
      grokTxAnalyzer = require('../../../modules/blockchain/grokTxAnalyzer');
    } catch (error) {
      logger.error('Failed to import GrokTxAnalyzer', { error: error.message });
      const errorMessage = 'Sorry, the transaction analysis service is currently unavailable.';
      
      if (fromCallback) {
        return ctx.editMessageText(errorMessage);
      } else {
        return ctx.reply(errorMessage);
      }
    }
    
    // Analyze the transaction
    const analysis = await grokTxAnalyzer.analyze({
      txHash,
      chainId,
      includeRawData: false
    });
    
    if (!analysis) {
      const errorMessage = 'Sorry, I couldn\'t analyze this transaction. Please check the hash and try again.';
      
      if (fromCallback) {
        return ctx.editMessageText(errorMessage);
      } else {
        return ctx.reply(errorMessage);
      }
    }
    
    // Format the analysis result for display
    const formattedAnalysis = formatTransactionAnalysis(analysis);
    
    // Handle response based on how it was called
    if (fromCallback) {
      // Replace the "analyzing..." message with the result
      return ctx.editMessageText(formattedAnalysis, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    } else {
          // Delete the processing message and send the analysis
    try {
      await ctx.deleteMessage(processingMsg.message_id);
    } catch (error) {
      logger.warn('Failed to delete processing message', { error: error.message });
      // Continue without deleting
    }
    
    return ctx.reply(formattedAnalysis.text, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: formattedAnalysis.markup
    });
    }
  } catch (error) {
    logger.error('Error handling blockchain transaction', { 
      error: error.message,
      params 
    });
    
    const errorMessage = 'Sorry, there was an error analyzing this transaction. Please try again later.';
    
    if (params.fromCallback) {
      return ctx.editMessageText(errorMessage);
    } else {
      return ctx.reply(errorMessage);
    }
  }
}

/**
 * Format transaction analysis for display
 * @param {Object} analysis - Transaction analysis result
 * @returns {string} - Formatted analysis text
 */
function formatTransactionAnalysis(analysis) {
  const { txHash, chainId, analysis: result } = analysis;
  const { summary, explanation, failure_reason, recommendations } = result;
  
  let formattedText = `🔍 *Transaction Analysis*\n\n`;
  formattedText += `*Hash:* \`${txHash}\`\n`;
  formattedText += `*Chain:* ${chainId}\n`;
  formattedText += `*Status:* ${result.errorDetails ? '❌ Failed' : '✅ Success'}\n\n`;
  
  // Add summary and explanation
  formattedText += `*Summary:* ${summary}\n\n`;
  formattedText += `*Details:* ${explanation}\n\n`;
  
  // Add failure reason if present
  if (failure_reason) {
    formattedText += `*Failure Reason:* ${failure_reason}\n\n`;
  }
  
  // Add recommendations if present
  if (recommendations && recommendations.length > 0) {
    formattedText += `*Recommendations:*\n`;
    recommendations.forEach((rec, index) => {
      formattedText += `${index + 1}. ${rec}\n`;
    });
  }
  
  // Add blockchain explorer link
  const explorerLink = getExplorerLink(txHash, chainId);
  if (explorerLink) {
    formattedText += `\n[View on Blockchain Explorer](${explorerLink})`;
  }
  
  return formattedText;
}

/**
 * Get blockchain explorer link for transaction
 * @param {string} txHash - Transaction hash
 * @param {string} chainId - Chain ID
 * @returns {string} - Explorer link
 */
function getExplorerLink(txHash, chainId) {
  // Map of chain IDs to explorer URLs
  const explorers = {
    'stargaze-1': `https://www.mintscan.io/stargaze/transactions/${txHash}`,
    'cheqd-mainnet-1': `https://explorer.cheqd.io/transactions/${txHash}`,
    'osmosis-1': `https://www.mintscan.io/osmosis/transactions/${txHash}`,
    'juno-1': `https://www.mintscan.io/juno/transactions/${txHash}`,
    'cosmoshub-4': `https://www.mintscan.io/cosmos/transactions/${txHash}`
  };
  
  return explorers[chainId] || null;
}

/**
 * Handle "what happened" inquiry about a transaction
 * @param {Object} ctx - Telegram context
 * @param {Object} params - Parameters
 * @param {string} params.txHash - Transaction hash
 * @param {string} params.chainId - Chain ID (defaults to 'stargaze-1')
 * @returns {Promise<void>}
 */
async function handleWhatHappened(ctx, params) {
  try {
    const { txHash, chainId = 'stargaze-1' } = params;
    
    if (!txHash) {
      return ctx.reply('Please provide a valid transaction hash to analyze.');
    }
    
    logger.info('Analyzing what happened with transaction', { 
      txHash,
      chainId,
      userId: ctx.from.id 
    });
    
    // Show typing indicator while analyzing
    await ctx.replyWithChatAction('typing');
    
    // Let the user know we're working on it
    const processingMsg = await ctx.reply(`Looking into what happened with transaction ${txHash.substring(0, 8)}...${txHash.substring(txHash.length - 8)}...`);
    
    // Import the GrokTxAnalyzer
    let grokTxAnalyzer;
    try {
      grokTxAnalyzer = require('../../../modules/blockchain/grokTxAnalyzer');
    } catch (error) {
      logger.error('Failed to import GrokTxAnalyzer', { error: error.message });
      return ctx.reply('Sorry, the transaction analysis service is currently unavailable.');
    }
    
    // Analyze the transaction
    const analysis = await grokTxAnalyzer.analyze({
      txHash,
      chainId,
      includeRawData: false
    });
    
    if (!analysis) {
      return ctx.reply('Sorry, I couldn\'t determine what happened with this transaction. Please check the hash and try again.');
    }
    
    if (!analysis) {
      // Delete the processing message
      try {
        await ctx.deleteMessage(processingMsg.message_id);
      } catch (error) {
        logger.warn('Failed to delete processing message', { error: error.message });
      }
      
      return ctx.reply(
        '❌ *Transaction Analysis Error*\n\nI couldn\'t analyze this transaction. The blockchain node returned no data for this transaction hash.',
        { parse_mode: 'Markdown' }
      );
    }
    
    // Format the analysis result as a narrative
    const formattedAnalysis = formatTransactionNarrative(analysis);
    
    // Delete the processing message and send the analysis
    try {
      await ctx.deleteMessage(processingMsg.message_id);
    } catch (error) {
      logger.warn('Failed to delete processing message', { error: error.message });
      // Continue without deleting
    }
    
    return ctx.reply(formattedAnalysis.text, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: formattedAnalysis.markup
    });
  } catch (error) {
    logger.error('Error handling "what happened" inquiry', { 
      error: error.message,
      params 
    });
    
    return ctx.reply('Sorry, there was an error analyzing this transaction. Please try again later.');
  }
}

/**
 * Format transaction analysis as a narrative explanation
 * @param {Object} analysis - Transaction analysis result
 * @returns {Object} - Formatted response with text and reply markup
 */
function formatTransactionNarrative(analysis) {
  const { txHash, chainId, analysis: result } = analysis;
  const { summary, explanation, failure_reason, recommendations } = result;
  
  let formattedText = `📖 *Transaction Story*\n\n`;
  
  // Add a "what happened" narrative
  formattedText += `${explanation}\n\n`;
  
  // Add specific failure reason if the transaction failed
  if (failure_reason) {
    formattedText += `*Why it failed:* ${failure_reason}\n\n`;
  }
  
  // Add recommendations if present
  if (recommendations && recommendations.length > 0) {
    formattedText += `*What to do next:*\n`;
    recommendations.forEach((rec, index) => {
      formattedText += `${index + 1}. ${rec}\n`;
    });
    formattedText += '\n';
  }
  
  // Add transaction details
  formattedText += `*Transaction details:*\n`;
  formattedText += `Hash: \`${txHash}\`\n`;
  formattedText += `Chain: ${chainId}\n`;
  
  // Add blockchain explorer link
  const explorerLink = getExplorerLink(txHash, chainId);
  if (explorerLink) {
    formattedText += `\n[View on Blockchain Explorer](${explorerLink})`;
  }
  
  // Add note about the /txdetails command as a direct alternative
  formattedText += `\n\n*Need more details?* Use the command:\n\`/txdetails ${txHash} ${chainId}\``;
  
  // Create a shortened hash version to ensure callback_data doesn't exceed Telegram's 64-byte limit
  // Take first 8 and last 8 characters of hash
  const shortHash = `${txHash.substring(0, 8)}...${txHash.substring(txHash.length - 8)}`;
  
  // Return object with text and keyboard markup
  // Include the shortened hash in the callback data to make extraction more reliable
  return {
    text: formattedText,
    markup: {
      inline_keyboard: [
        [{ text: "🔍 Get Deeper Analysis", callback_data: `deep:${shortHash}:${chainId}` }]
      ]
    }
  };
}

/**
 * Handle deep analysis callback for transactions
 * @param {Object} ctx - Telegram callback context
 * @param {string} txHash - Transaction hash
 * @param {string} chainId - Chain ID
 * @returns {Promise<void>}
 */
async function handleDeepAnalysis(ctx, txHash, chainId) {
  try {
    logger.info('Performing deep analysis of transaction', { 
      txHash,
      chainId,
      userId: ctx.from?.id 
    });
    
    // First, try to acknowledge the callback to prevent timeouts
    try {
      await ctx.answerCbQuery('Analyzing transaction details...');
    } catch (cbError) {
      logger.warn('Could not answer callback query', { error: cbError.message });
      // Continue anyway
    }
    
    // Update message to show we're working on it
    try {
      await ctx.editMessageText(
        `🔍 *Analyzing Transaction Details*\n\nPlease wait while I fetch detailed information about transaction \`${txHash}\`...`, 
        { parse_mode: 'Markdown' }
      );
    } catch (editError) {
      logger.warn('Could not edit message', { error: editError.message });
      // Try sending a new message instead
      await ctx.reply(
        `🔍 *Analyzing Transaction Details*\n\nPlease wait while I fetch detailed information about transaction \`${txHash}\`...`, 
        { parse_mode: 'Markdown' }
      );
    }
    
    // Import the GrokTxAnalyzer
    let grokTxAnalyzer;
    try {
      grokTxAnalyzer = require('../../../modules/blockchain/grokTxAnalyzer');
    } catch (error) {
      logger.error('Failed to import GrokTxAnalyzer', { error: error.message });
      return ctx.editMessageText(
        '❌ *Analysis Error*\n\nSorry, the transaction analysis service is currently unavailable.', 
        { parse_mode: 'Markdown' }
      );
    }
    
    // Analyze the transaction with raw data included
    logger.info('Requesting analysis with raw data included', { txHash, chainId });
    const analysis = await grokTxAnalyzer.analyze({
      txHash,
      chainId,
      includeRawData: true
    });
    
    if (!analysis) {
      return ctx.editMessageText(
        '❌ *Analysis Error*\n\nSorry, I couldn\'t analyze this transaction. Please check the hash and try again.', 
        { parse_mode: 'Markdown' }
      );
    }
    
    // Log if we got raw data
    if (analysis.rawData) {
      logger.info('Raw data received for transaction', { 
        txHash,
        hasRawTx: !!analysis.rawData.tx,
        hasRawTxResponse: !!analysis.rawData.txResponse,
        hasRawEvents: !!(analysis.analysis && analysis.analysis.rawEvents && analysis.analysis.rawEvents.length)
      });
    } else {
      logger.warn('No raw data received for transaction despite includeRawData=true', { txHash });
    }
    
    // Format the detailed analysis
    const detailedAnalysis = formatDetailedAnalysis(analysis);
    
    // Ensure the message isn't too long for Telegram (max ~4096 chars)
    let formattedAnalysis = detailedAnalysis;
    if (detailedAnalysis.length > 3800) {
      logger.warn('Detailed analysis too long, truncating', {
        originalLength: detailedAnalysis.length
      });
      formattedAnalysis = detailedAnalysis.substring(0, 3800) + "\n\n*Note: Analysis was truncated due to size limitations.*";
    }
    
    // Send the deep analysis response with error handling
    try {
      return await ctx.editMessageText(formattedAnalysis, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    } catch (sendError) {
      logger.error('Failed to send detailed analysis via edit', { error: sendError.message });
      
      // Try sending as a new message instead
      try {
        return await ctx.reply(formattedAnalysis, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });
      } catch (replyError) {
        logger.error('Failed to send detailed analysis via reply', { error: replyError.message });
        
        // Last resort: send a simple message
        return await ctx.reply('Sorry, I encountered an error while formatting the detailed analysis. Please try again later.');
      }
    }
  } catch (error) {
    logger.error('Error handling deep analysis', { 
      error: error.message,
      txHash,
      chainId
    });
    
    return ctx.editMessageText(
      '❌ *Analysis Error*\n\nSorry, there was an error analyzing this transaction in detail.\n\nError: ' + error.message, 
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Format detailed transaction analysis including raw data
 * @param {Object} analysis - Transaction analysis result with raw data
 * @returns {string} - Formatted detailed analysis text
 */
function formatDetailedAnalysis(analysis) {
  const { txHash, chainId, analysis: result, rawData } = analysis;
  
  let formattedText = `🔬 *Raw Blockchain Data Analysis*\n\n`;
  
  // Transaction basics
  formattedText += `*Hash:* \`${txHash}\`\n`;
  formattedText += `*Chain:* ${chainId}\n\n`;
  
  // Early validation - if no raw data is available, explain and show the basic analysis
  if (!rawData || (!rawData.tx && !rawData.txResponse && !rawData.tx_response)) {
    formattedText += `⚠️ *No raw blockchain data available*\n\n`;
    formattedText += `*Summary:* ${result.summary || "No summary available"}\n\n`;
    formattedText += `Try again or use \`/txdetails ${txHash} ${chainId}\` for another attempt.\n\n`;
    return formattedText;
  }
  
  // Get the transaction response (different chains may have different formats)
  const txResponse = rawData.txResponse || rawData.tx_response;
  
  // Show transaction status
  const isSuccess = txResponse && txResponse.code === 0;
  formattedText += `*Status:* ${isSuccess ? '✅ Success' : '❌ Failed'}\n`;
  
  if (txResponse) {
    // Basic transaction metadata
    if (txResponse.height) {
      formattedText += `*Block Height:* ${txResponse.height}\n`;
    }
    if (txResponse.timestamp) {
      formattedText += `*Timestamp:* ${txResponse.timestamp}\n`;
    }
    if (txResponse.gas_wanted || txResponse.gasWanted) {
      formattedText += `*Gas Wanted:* ${txResponse.gas_wanted || txResponse.gasWanted}\n`;
    }
    if (txResponse.gas_used || txResponse.gasUsed) {
      formattedText += `*Gas Used:* ${txResponse.gas_used || txResponse.gasUsed}\n`;
    }
    
    // Show failure reason if present
    if (!isSuccess && (txResponse.raw_log || txResponse.rawLog)) {
      formattedText += `\n*Error:* \`${txResponse.raw_log || txResponse.rawLog}\`\n\n`;
    }
  }
  
  // Section divider
  formattedText += `\n${"—".repeat(30)}\n\n`;
  
  // Show actual transaction messages
  if (rawData.tx && rawData.tx.body && rawData.tx.body.messages) {
    const messages = rawData.tx.body.messages;
    formattedText += `📨 *Raw Transaction Messages (${messages.length}):*\n\n`;
    
    messages.forEach((msg, index) => {
      formattedText += `*Message ${index + 1}:*\n`;
      
      // Show message type
      if (msg['@type']) {
        formattedText += `• Type: \`${msg['@type']}\`\n`;
      }
      
      // Extract the most important fields based on message type
      if (msg['@type'] && msg['@type'].includes('MsgExecuteContract')) {
        // For contract executions, show these important fields
        if (msg.sender) formattedText += `• Sender: \`${msg.sender}\`\n`;
        if (msg.contract) formattedText += `• Contract: \`${msg.contract}\`\n`;
        
        // Try to parse and show the contract call
        if (msg.msg) {
          try {
            const contractMsg = typeof msg.msg === 'string' 
              ? JSON.parse(msg.msg) 
              : msg.msg;
            
            const action = Object.keys(contractMsg)[0];
            formattedText += `• Action: \`${action || 'unknown'}\`\n`;
            
            // Show a sample of the parameters
            formattedText += `• Parameters: \`${JSON.stringify(contractMsg[action]).substring(0, 100)}\`${JSON.stringify(contractMsg[action]).length > 100 ? '...' : ''}\n`;
          } catch (e) {
            formattedText += `• Raw Message: \`${typeof msg.msg === 'string' ? msg.msg.substring(0, 100) : '[complex object]'}\`\n`;
          }
        }
        
        // Show funds if present
        if (msg.funds && msg.funds.length > 0) {
          const funds = msg.funds.map(f => `${f.amount} ${f.denom}`).join(', ');
          formattedText += `• Funds: \`${funds}\`\n`;
        }
      } else if (msg['@type'] && msg['@type'].includes('MsgSend')) {
        // For token transfers
        if (msg.from_address) formattedText += `• From: \`${msg.from_address}\`\n`;
        if (msg.to_address) formattedText += `• To: \`${msg.to_address}\`\n`;
        
        // Show amount
        if (msg.amount && msg.amount.length > 0) {
          const amount = msg.amount.map(a => `${a.amount} ${a.denom}`).join(', ');
          formattedText += `• Amount: \`${amount}\`\n`;
        }
      } else {
        // For other message types, just show a few key-value pairs
        const fields = Object.entries(msg)
          .filter(([key]) => key !== '@type' && !key.startsWith('_'))
          .slice(0, 5);
        
        fields.forEach(([key, value]) => {
          const displayValue = typeof value === 'object' 
            ? JSON.stringify(value).substring(0, 50) 
            : String(value).substring(0, 50);
            
          formattedText += `• ${key}: \`${displayValue}${displayValue.length >= 50 ? '...' : ''}\`\n`;
        });
        
        if (Object.keys(msg).length > 6) {
          formattedText += `• _and ${Object.keys(msg).length - 6} more fields_\n`;
        }
      }
      
      formattedText += '\n';
    });
  }
  
  // Section divider
  formattedText += `${"—".repeat(30)}\n\n`;
  
  // Show actual transaction logs
  if (txResponse && txResponse.logs && txResponse.logs.length > 0) {
    formattedText += `📋 *Raw Transaction Logs:*\n\n`;
    
    // For each message log (usually corresponds to a transaction message)
    txResponse.logs.forEach((log, logIndex) => {
      formattedText += `*Log ${logIndex + 1}:*\n`;
      
      if (log.msg_index !== undefined) {
        formattedText += `• Message Index: ${log.msg_index}\n`;
      }
      
      if (log.log) {
        formattedText += `• Log Message: \`${log.log}\`\n`;
      }
      
      // Display events for this log
      if (log.events && log.events.length > 0) {
        formattedText += `• Contains ${log.events.length} events:\n`;
        
        // Show a sample of events (first 2)
        log.events.slice(0, 2).forEach((event, eventIndex) => {
          formattedText += `  - Event ${eventIndex + 1}: \`${event.type}\` with ${event.attributes ? event.attributes.length : 0} attributes\n`;
          
          // Show a few sample attributes
          if (event.attributes && event.attributes.length > 0) {
            event.attributes.slice(0, 3).forEach(attr => {
              const key = attr.key ? attr.key : 'unknown';
              const value = attr.value !== undefined ? attr.value : '';
              formattedText += `    • ${key}: \`${String(value).substring(0, 30)}${String(value).length > 30 ? '...' : ''}\`\n`;
            });
            
            if (event.attributes.length > 3) {
              formattedText += `    • _and ${event.attributes.length - 3} more attributes_\n`;
            }
          }
        });
        
        if (log.events.length > 2) {
          formattedText += `  - _and ${log.events.length - 2} more events_\n`;
        }
      }
      
      formattedText += '\n';
    });
  }
  
  // Section divider
  formattedText += `${"—".repeat(30)}\n\n`;
  
  // Show key blockchain events by type
  if (result.eventsByType && Object.keys(result.eventsByType).length > 0) {
    formattedText += `🔍 *Key Blockchain Events by Type:*\n\n`;
    
    // Show the most important event types first
    const priorityEventTypes = [
      'wasm', 'transfer', 'message', 'coin_spent', 'coin_received', 
      'execute', 'instantiate', 'send', 'withdraw_rewards'
    ];
    
    // Filter available event types by priority
    const availableTypes = Object.keys(result.eventsByType);
    const orderedTypes = [
      ...priorityEventTypes.filter(type => availableTypes.includes(type)),
      ...availableTypes.filter(type => !priorityEventTypes.includes(type))
    ];
    
    // Show each event type
    for (const eventType of orderedTypes.slice(0, 3)) { // Limit to 3 event types to save space
      const events = result.eventsByType[eventType];
      formattedText += `*${eventType.toUpperCase()} Events (${events.length}):*\n`;
      
      // Show sample event
      if (events.length > 0) {
        const event = events[0];
        
        if (event.attributes) {
          const attributes = typeof event.attributes === 'object' && !Array.isArray(event.attributes)
            ? Object.entries(event.attributes)
            : (Array.isArray(event.attributes) 
                ? event.attributes.map(attr => [attr.key, attr.value]) 
                : []);
                
          attributes.slice(0, 5).forEach(([key, value]) => {
            formattedText += `• ${key}: \`${value ? String(value).substring(0, 40) : ''}\`\n`;
          });
          
          const attrCount = Array.isArray(event.attributes) 
            ? event.attributes.length 
            : Object.keys(event.attributes).length;
            
          if (attrCount > 5) {
            formattedText += `• _and ${attrCount - 5} more attributes_\n`;
          }
        }
        
        if (events.length > 1) {
          formattedText += `\n_${events.length - 1} more ${eventType} events not shown_\n`;
        }
      }
      
      formattedText += '\n';
    }
    
    if (orderedTypes.length > 3) {
      formattedText += `_${orderedTypes.length - 3} other event types not shown: ${orderedTypes.slice(3).join(', ')}_\n\n`;
    }
  }
  
  // Show Grok AI explanation of what happened
  formattedText += `${"—".repeat(30)}\n\n`;
  formattedText += `🤖 *AI Explanation:*\n\n`;
  formattedText += `${result.explanation || "No explanation available"}\n\n`;
  
  // If there was a failure, show more details
  if (!isSuccess && result.failure_reason) {
    formattedText += `*Failure Analysis:* ${result.failure_reason}\n\n`;
  }
  
  // Add recommendations if present
  if (result.recommendations && result.recommendations.length > 0) {
    formattedText += `*Recommendations:*\n`;
    result.recommendations.forEach((rec, index) => {
      formattedText += `${index + 1}. ${rec}\n`;
    });
    formattedText += '\n';
  }
  
  // Add explorer link
  const explorerLink = getExplorerLink(txHash, chainId);
  if (explorerLink) {
    formattedText += `\n[View Full Transaction on Explorer](${explorerLink})`;
  }
  
  return formattedText;
}

// Update module exports to include all necessary handlers
module.exports = {
  handleCredentialCommand,
  handleIssueCredential,
  handleVerifyCredential,
  handleRevokeCredential,
  handleListCredentials,
  handleCheckCredential,
  handleBlockchainTransaction,
  handleWhatHappened,
  handleDeepAnalysis,
  findTargetUser,
  checkAdminStatus,
  verifyEducationalAccess,
  getUserCredentials,
  handleCredentialDetails,
  handleCredentialSchema,
  handleGroupSetup,
  getTierFeatures,
  handlePostPaymentSetup,
  handleFeatureToggle,
  handleCompleteSetup,
  
  // Process callback queries for feature toggles and setup completion
  handleCallbackQuery: async (ctx) => {
    try {
      const data = ctx.callbackQuery.data;
      logger.info('Processing callback query', { callbackData: data, chatId: ctx.chat.id });
      
      // Handle feature toggle
      if (data.startsWith('feature:')) {
        logger.info('Handling feature toggle callback', { data });
        const [_, feature, action] = data.split(':');
        return await handleFeatureToggle(ctx, feature, action);
      }
      
      // Handle setup completion
      if (data === 'setup:complete') {
        logger.info('Handling setup complete callback', { data });
        return await handleCompleteSetup(ctx);
      }
      
      // Handle payment completed (dummy for hackathon)
      if (data === 'payment:completed') {
        logger.info('Handling payment completed callback', { data });
        // Send immediate acknowledgment message
        await ctx.telegram.sendMessage(
          ctx.chat.id,
          "🔄 *Starting Setup Process...*\n\nPlease wait while I configure credentials for all admins.",
          { parse_mode: 'Markdown' }
        );
        return await handlePostPaymentSetup(ctx);
      }
      
      // Handle deep analysis request
      if (data.startsWith('deep:')) {
        logger.info('Handling deep analysis callback', { data });
        
        try {
          // Extract the hash and chain ID directly from callback data
          const parts = data.split(':');
          
          // Expected format: deep:shortHash:chainId
          if (parts.length >= 3) {
            const shortHash = parts[1]; // This contains a shortened hash with format "first8...last8"
            const chainId = parts[2];
            
            // Check if we have a shortened hash with the expected format
            if (shortHash.includes('...')) {
              // Extract the full hash from the original message text as fallback
              const messageText = ctx.callbackQuery.message.text || '';
              logger.debug('Message text for hash extraction', { messageText: messageText.substring(0, 100) });
              
              // Try multiple regex patterns to find the hash
              let hashMatch = messageText.match(/Hash:\s+`([A-F0-9]{64})`/i);
              
              if (!hashMatch || !hashMatch[1]) {
                // Try alternative pattern without backticks
                hashMatch = messageText.match(/Hash:\s*([A-F0-9]{64})/i);
              }
              
              if (!hashMatch || !hashMatch[1]) {
                // Try to find any 64-character hex string in the message
                hashMatch = messageText.match(/\b([A-F0-9]{64})\b/i);
              }
              
              if (hashMatch && hashMatch[1]) {
                const txHash = hashMatch[1];
                logger.info('Found transaction hash from message text', { txHash, chainId });
                return await handleDeepAnalysis(ctx, txHash, chainId);
              } else {
                await ctx.answerCbQuery('Could not find full transaction hash');
                return ctx.editMessageText('Sorry, I could not find the full transaction hash in the message. Please try the analysis again with /tx command.');
              }
            } else {
              // If it's not a shortened hash with "...", we might have the full hash directly
              logger.info('Using hash directly from callback data', { hash: shortHash, chainId });
              return await handleDeepAnalysis(ctx, shortHash, chainId);
            }
          } else {
            // Legacy format: deep:chainId
            const chainId = parts[1] || 'stargaze-1';
            
            // Extract the full hash from the original message
            const messageText = ctx.callbackQuery.message.text || '';
            logger.debug('Message text for hash extraction (legacy format)', { messageText: messageText.substring(0, 100) });
            
            // Try multiple regex patterns to find the hash
            let hashMatch = messageText.match(/Hash:\s+`([A-F0-9]{64})`/i);
            
            if (!hashMatch || !hashMatch[1]) {
              // Try alternative pattern without backticks
              hashMatch = messageText.match(/Hash:\s*([A-F0-9]{64})/i);
            }
            
            if (!hashMatch || !hashMatch[1]) {
              // Try to find any 64-character hex string in the message
              hashMatch = messageText.match(/\b([A-F0-9]{64})\b/i);
            }
            
            // If still no match, we can't proceed
            if (!hashMatch || !hashMatch[1]) {
              await ctx.answerCbQuery('Error: Could not find transaction hash');
              return ctx.editMessageText('Sorry, I could not find the full transaction hash in the message. Please try the analysis again with /tx command.');
            }
            
            const txHash = hashMatch[1];
            
            logger.info('Found transaction hash for deep analysis (legacy format)', { txHash, chainId });
            return await handleDeepAnalysis(ctx, txHash, chainId);
          }
        } catch (error) {
          logger.error('Error in deep analysis callback', { error: error.message, data });
          await ctx.answerCbQuery('An error occurred during deep analysis');
          return ctx.editMessageText('Sorry, there was an error performing deep analysis: ' + error.message);
        }
      }
      
      // If no handler matched
      logger.warn('Unknown callback action', { data });
      return ctx.answerCbQuery('Unknown callback action');
    } catch (error) {
      logger.error('Error handling callback query', { error: error.message });
      try {
        return ctx.answerCbQuery('An error occurred while processing your request');
      } catch (cbError) {
        logger.error('Error answering callback query', { error: cbError.message });
      }
    }
  }
};

/**
 * Handle group setup process
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleGroupSetup(ctx) {
  try {
    if (!ctx.chat || ctx.chat.type === 'private') {
      return ctx.reply('This command is only available in group chats.');
    }
    
    // Get bot ID - first try from context directly
    let botId = ctx.botInfo?.id;
    
    if (!botId) {
      logger.info('Bot ID not available from context, trying alternative sources');
      
      // Try to get it from the global telegramService
      if (!botId && global.telegramService && global.telegramService.bot && global.telegramService.bot.botInfo) {
        botId = global.telegramService.bot.botInfo.id;
        logger.info('Using bot ID from global telegram service', { botId });
      }
      
      // Try to get bot ID from database
      if (!botId) {
        try {
          const botIdFromDb = await sqliteService.getSetting('bot_id');
          if (botIdFromDb) {
            botId = parseInt(botIdFromDb, 10);
            logger.info('Using bot ID from database', { botId });
          }
        } catch (dbError) {
          logger.error('Error retrieving bot ID from database', { error: dbError.message });
        }
      }
      
      // Emergency fallback: try to get bot ID directly from the Telegram API
      if (!botId && ctx.telegram) {
        try {
          logger.info('Attempting to get bot info from Telegram API');
          const botInfo = await ctx.telegram.getMe();
          if (botInfo && botInfo.id) {
            botId = botInfo.id;
            logger.info('Retrieved bot ID from Telegram API', { botId });
            
            // Save it for future use
            await sqliteService.saveSetting('bot_id', botId.toString());
          }
        } catch (apiError) {
          logger.error('Failed to get bot info from Telegram API', { error: apiError.message });
        }
      }
    }
    
    // If we still don't have a bot ID, notify the user
    if (!botId) {
      logger.error('Failed to determine bot ID for admin check');
      return ctx.reply(
        "I'm having trouble verifying my admin status in this group. Please try the setup again in a few minutes."
      );
    }
    
    // Get bot's member status in the group
    let botMember;
    try {
      logger.info('Checking bot admin status', { botId, chatId: ctx.chat.id });
      botMember = await ctx.telegram.getChatMember(ctx.chat.id, botId);
      logger.info('Bot member status retrieved', { status: botMember.status });
    } catch (error) {
      logger.error('Error getting bot member status', { 
        error: error.message, 
        botId,
        chatId: ctx.chat.id
      });
      
      // Save the bot ID to database for future reference if it wasn't there before
      if (botId && ctx.botInfo) {
        try {
          await sqliteService.saveSetting('bot_id', botId.toString());
          logger.info('Saved bot ID to database for future use', { botId });
        } catch (saveError) {
          logger.error('Failed to save bot ID to database', { error: saveError.message });
        }
      }
      
      return ctx.reply('I encountered an error checking my admin status. Please try again later or make sure I am an admin in this group.');
    }
    
    const isAdmin = ['administrator', 'creator'].includes(botMember.status);
    
    if (!isAdmin) {
      return ctx.reply(
        "❌ I need admin privileges to function properly in this group.\n\n" +
        "Please make me an admin, then try again with /dail setup."
      );
    }
    
    // Count total members and admins in the group
    let memberCount = 0;
    let adminCount = 0;
    
    try {
      // Get administrators first
      const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
      adminCount = admins.length;
      
      // For member count, use getChatMembersCount if available, otherwise estimate
      try {
        memberCount = await ctx.telegram.getChatMemberCount(ctx.chat.id);
      } catch (countError) {
        // Fallback: Use a default value or minimum estimate
        memberCount = 50; // Default assumption
        logger.warn('Could not get exact member count, using default value', {
          chatId: ctx.chat.id,
          defaultCount: memberCount
        });
      }
    } catch (error) {
      logger.error('Error getting chat member counts', { error: error.message });
      // Use fallback values
      adminCount = 1;
      memberCount = 10;
    }
    
    // Determine tier based on member and admin counts
    let tier = 'Basic';
    let price = '19.99';
    
    if (memberCount > 10000 && adminCount >= 5) {
      tier = 'Enterprise';
      price = '149.99';
    } else if (memberCount > 1000 && adminCount >= 3) {
      tier = 'Premium';
      price = '79.99';
    } else if (memberCount > 100) {
      tier = 'Standard';
      price = '49.99';
    }
    
    // Get the moderation service to check current features
    const moderationService = require('../../../modules/moderation/moderationService');
    await moderationService.ensureInitialized();
    
    // Send tier qualification message with payment button
    const message = `
🤖 *Group Setup Analysis Complete!* 🤖

👥 *Community Stats:*
• Members: ${memberCount}
• Moderators/Admins: ${adminCount}

✨ *Qualification Result:*
Based on your community size and moderation team, you qualify for our *${tier} Tier*.

💰 *${tier} Tier Price:* $${price}/month

*What's included:*
${getTierFeatures(tier)}

*Available Features (you can customize after payment):*
• Group Moderation: Always included
• Cross-Chat Moderation: Optional (share ban lists with other communities)
• Educational Credentials: Optional (issue credentials to members)
• Blockchain Verification: Optional (verify credentials on-chain)

Ready to activate Dail Bot for your community?
    `;
    
    // Create inline keyboard with payment button
    const keyboard = {
      inline_keyboard: [
        [{ text: `💰 Subscribe to ${tier} Tier - $${price}/month`, url: 'https://snails.wiki' }],
        [{ text: `⏩ Skip Payment (Demo)`, callback_data: 'payment:completed' }]
      ]
    };
    
    return ctx.replyWithMarkdown(message, { reply_markup: keyboard });
  } catch (error) {
    logger.error('Error handling group setup', { error: error.message });
    return ctx.reply('Sorry, there was an error setting up the bot for this group. Please try again later.');
  }
}

/**
 * Get features for a specific tier
 * @param {string} tier - The tier name
 * @returns {string} - Formatted tier features
 */
function getTierFeatures(tier) {
  const features = {
    'Basic': `• Basic moderation commands
• Community analytics (limited)
• DID management for admins
• Educational credentials
• Standard support`,
    
    'Standard': `• All Basic features
• Advanced moderation tools
• Full community analytics
• Custom command support
• Priority support
• Channel integration`,
    
    'Premium': `• All Standard features
• Anti-spam protection
• Custom credential templates
• API access
• Cross-chat moderation
• 24/7 support`,
    
    'Enterprise': `• All Premium features
• Custom development
• Dedicated account manager
• White-labeled solutions
• Multi-community management
• Integration with other platforms`
  };
  
  return features[tier] || features['Basic'];
}

/**
 * Handle the post-payment setup process
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handlePostPaymentSetup(ctx) {
  try {
    // For hackathon purposes, we're assuming the payment has been completed
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    
    // Get the moderation service to manage features
    const moderationService = require('../../../modules/moderation/moderationService');
    await moderationService.ensureInitialized();
    
    // Create feature selection keyboard
    const keyboard = {
      inline_keyboard: [
        [
          { text: "✅ Enable Cross-Chat Moderation", callback_data: `feature:${moderationService.FEATURES.CROSS_CHAT_MODERATION}:enable` },
          { text: "❌ Disable Cross-Chat Moderation", callback_data: `feature:${moderationService.FEATURES.CROSS_CHAT_MODERATION}:disable` }
        ],
        [
          { text: "✅ Enable Platform Moderation", callback_data: `feature:${moderationService.FEATURES.PLATFORM_MODERATION}:enable` },
          { text: "❌ Disable Platform Moderation", callback_data: `feature:${moderationService.FEATURES.PLATFORM_MODERATION}:disable` }
        ],
        [
          { text: "✅ Enable Educational Credentials", callback_data: `feature:${moderationService.FEATURES.EDUCATIONAL_CREDENTIALS}:enable` },
          { text: "❌ Disable Educational Credentials", callback_data: `feature:${moderationService.FEATURES.EDUCATIONAL_CREDENTIALS}:disable` }
        ],
        [
          { text: "✅ Enable Trust Network", callback_data: `feature:${moderationService.FEATURES.TRUST_NETWORK}:enable` },
          { text: "❌ Disable Trust Network", callback_data: `feature:${moderationService.FEATURES.TRUST_NETWORK}:disable` }
        ],
        [
          { text: "✅ Complete Setup", callback_data: "setup:complete" }
        ]
      ]
    };
    
    // Send the feature selection message
    return ctx.reply(
      "🎛️ *Feature Configuration*\n\n" +
      "Thank you for your subscription! Now let's customize your features.\n\n" +
      "Please select which features you'd like to enable for your community.\n\n" +
      "Remember that YOU have full control over these features and can change them anytime.",
      { reply_markup: keyboard, parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error('Error handling post-payment setup', { error: error.message });
    return ctx.reply('Sorry, there was an error configuring your group features. Please try again later.');
  }
}

/**
 * Handle feature toggle callback
 * @param {Object} ctx - Telegram callback context
 * @param {string} feature - Feature to toggle
 * @param {string} action - 'enable' or 'disable'
 * @returns {Promise<void>}
 */
async function handleFeatureToggle(ctx, feature, action) {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    
    // Get the moderation service to manage features
    const moderationService = require('../../../modules/moderation/moderationService');
    await moderationService.ensureInitialized();
    
    // Check if feature is valid
    if (!Object.values(moderationService.FEATURES).includes(feature)) {
      return ctx.answerCbQuery('Invalid feature selection');
    }
    
    // Toggle the feature
    const enabled = action === 'enable';
    const result = await moderationService.setFeatureEnabled(chatId, feature, enabled, userId);
    
    // Notify the user
    if (result.success) {
      // Answer the callback
      await ctx.answerCbQuery(`${feature} has been ${enabled ? 'enabled' : 'disabled'}`);
      
      // Update the message to show the current status
      const features = await moderationService.getChatFeatures(chatId);
      const statusMessage = Object.entries(features)
        .map(([feat, status]) => `• ${feat}: ${status.enabled ? '✅ Enabled' : '❌ Disabled'}`)
        .join('\n');
      
      await ctx.editMessageText(
        "🎛️ *Feature Configuration*\n\n" +
        "Thank you for your subscription! Here are your current feature settings:\n\n" +
        statusMessage + "\n\n" +
        "You can change these settings anytime using `/dail features`.",
        { parse_mode: 'Markdown' }
      );
      
      return;
    } else {
      return ctx.answerCbQuery(`Error: ${result.message}`);
    }
  } catch (error) {
    logger.error('Error handling feature toggle', { error: error.message });
    try {
      return ctx.answerCbQuery('An error occurred while toggling the feature');
    } catch (cbError) {
      logger.error('Error answering callback query', { error: cbError.message });
    }
  }
}

/**
 * Complete the setup process
 * @param {Object} ctx - Telegram callback context
 * @returns {Promise<void>}
 */
async function handleCompleteSetup(ctx) {
  try {
    const chatId = ctx.chat.id;
    let userId = null;
    
    // Safely get the user ID
    if (ctx.from && ctx.from.id) {
      userId = ctx.from.id;
    } else {
      logger.warn('User ID not found in callback context', { chatId });
    }
    
    // Get the moderation service to check features
    const moderationService = require('../../../modules/moderation/moderationService');
    await moderationService.ensureInitialized();
    
    // Get current features
    const features = await moderationService.getChatFeatures(chatId);
    
    // Get all admins in the group
    const admins = await ctx.telegram.getChatAdministrators(chatId);
    
    // Initialize services
    const moderationCredentialService = require('../../../modules/moderation/moderationCredentialService');
    await moderationCredentialService.ensureInitialized();
    
    const cheqdService = require('../../../services/cheqdService');
    await cheqdService.ensureInitialized();
    
    // Create bot DID if it doesn't exist
    const botId = ctx.botInfo.id;
    let botDid;
    
    try {
      // Use getUserDIDs safely (it might return undefined)
      const botDids = await cheqdService.getUserDids(botId);
      
      if (botDids && botDids.length > 0) {
        botDid = botDids[0].did;
        logger.info('Using existing bot DID', { did: botDid });
      } else {
        // Use createDID correctly - check for alternative methods if needed
        if (typeof cheqdService.createDid === 'function') {
          botDid = await cheqdService.createDid(botId);
        } else if (typeof cheqdService.createDID === 'function') {
          botDid = await cheqdService.createDID(botId);
        } else if (typeof cheqdService.createNewDid === 'function') {
          botDid = await cheqdService.createNewDid(botId);
        } else {
          logger.error('DID creation function not found in cheqdService');
          botDid = `did:cheqd:testnet:${botId}`;
        }
        logger.info('Created new bot DID', { did: botDid });
      }
    } catch (botDidError) {
      logger.error('Error getting or creating bot DID', { error: botDidError.message });
    }
    
    // Status message to track progress
    let statusMessage = "";
    
    // Create DIDs for all admins first
    logger.info('Creating DIDs for admins', { adminCount: admins.length });
    for (const admin of admins) {
      // Skip bots
      if (admin.user.is_bot) continue;
      
      try {
        const adminId = admin.user.id;
        // Check if admin already has a DID
        const adminDids = await cheqdService.getUserDids(adminId);
        
        if (adminDids && adminDids.length > 0) {
          logger.info('Admin already has DID', { 
            adminId, 
            adminUsername: admin.user.username,
            did: adminDids[0].did 
          });
          statusMessage += `• Admin @${admin.user.username || admin.user.first_name}: Using existing DID\n`;
        } else {
          // Create new DID for admin - with safe fallbacks
          let newDid;
          if (typeof cheqdService.createDid === 'function') {
            newDid = await cheqdService.createDid(adminId);
          } else if (typeof cheqdService.createDID === 'function') {
            newDid = await cheqdService.createDID(adminId);
          } else if (typeof cheqdService.createNewDid === 'function') {
            newDid = await cheqdService.createNewDid(adminId);
          } else {
            logger.warn('DID creation function not found in cheqdService, using mock DID');
            newDid = `did:cheqd:testnet:${adminId}`;
          }
          
          logger.info('Created new DID for admin', { 
            adminId, 
            adminUsername: admin.user.username,
            did: newDid 
          });
          statusMessage += `• Admin @${admin.user.username || admin.user.first_name}: Created new DID\n`;
        }
      } catch (didError) {
        logger.error('Error creating DID for admin', {
          error: didError.message,
          adminId: admin.user.id,
          adminUsername: admin.user.username
        });
        statusMessage += `• Admin @${admin.user.username || admin.user.first_name}: DID creation failed\n`;
      }
    }
    
    // Now issue credentials to all admins
    logger.info('Issuing credentials to admins');
    for (const admin of admins) {
      // Skip bots
      if (admin.user.is_bot) continue;
      
      // Issue admin credential
      try {
        const adminUser = {
          id: String(admin.user.id),
          username: admin.user.username || '',
          firstName: admin.user.first_name || '',
          lastName: admin.user.last_name || ''
        };
        
        // Create a proper issuer object with ID for the bot
        const issuer = {
          id: String(botId),
          username: ctx.botInfo.username,
          firstName: ctx.botInfo.first_name,
          lastName: ''
        };
        
        // Chat info for credential
        const chatInfo = {
          id: String(chatId),
          title: ctx.chat.title || `Chat ${chatId}`,
          type: ctx.chat.type
        };
        
        // Try to issue credential, but with extra error handling
        let result;
        try {
          // Get issuer and recipient DIDs in the correct format (strings)
          const botDids = await cheqdService.getUserDids(issuer.id);
          const adminDids = await cheqdService.getUserDids(adminUser.id);
          
          // Make sure to get the DID strings, not objects
          const issuerDidString = botDids && botDids.length > 0 ? 
            (typeof botDids[0] === 'object' ? botDids[0].did : botDids[0]) : 
            `did:cheqd:testnet:${issuer.id}`;
            
          const holderDidString = adminDids && adminDids.length > 0 ? 
            (typeof adminDids[0] === 'object' ? adminDids[0].did : adminDids[0]) : 
            `did:cheqd:testnet:${adminUser.id}`;
          
          // Create a proper issuer object with the DID string
          const properIssuer = {
            id: issuer.id,
            username: issuer.username || '',
            firstName: issuer.firstName || '',
            did: issuerDidString
          };
          
          // Create a proper holder object with the DID string
          const properHolder = {
            id: adminUser.id,
            username: adminUser.username || '',
            firstName: adminUser.firstName || '',
            lastName: adminUser.lastName || '',
            did: holderDidString
          };
          
          result = await moderationCredentialService.issueModerationCredential(
            properIssuer,
            properHolder,
            'GROUP_ADMIN',
            chatInfo,
            { override: true } // Allow credential issuance even if issuer isn't yet a moderator
          );
          
          logger.info('Issued admin credential', {
            userId: admin.user.id,
            chatId,
            credentialId: result.credential?.credential_id
          });
          
          // Send a direct confirmation message to the chat
          await ctx.telegram.sendMessage(
            chatId,
            `✅ Admin credential successfully issued to @${admin.user.username || admin.user.first_name}!`,
            { parse_mode: 'Markdown' }
          );
          
          statusMessage += `• Admin @${admin.user.username || admin.user.first_name}: Credential issued ✅\n`;
        } catch (innerError) {
          logger.error('Inner error issuing credential', { error: innerError.message });
          statusMessage += `• Admin @${admin.user.username || admin.user.first_name}: Credential failed (inner) ❌\n`;
        }
      } catch (credError) {
        logger.error('Error issuing admin credential', {
          error: credError.message,
          userId: admin.user.id,
          chatId
        });
        statusMessage += `• Admin @${admin.user.username || admin.user.first_name}: Credential failed ❌\n`;
      }
    }
    
    // Format feature status
    const featureStatus = Object.entries(features)
      .map(([feat, status]) => `• ${feat}: ${status.enabled ? '✅ Enabled' : '❌ Disabled'}`)
      .join('\n');
    
    // Send completion message
    await ctx.editMessageText(
      "🎉 *Setup Complete!* 🎉\n\n" +
      "Your group has been successfully configured with the following features:\n\n" +
      featureStatus + "\n\n" +
      "Admin credentials status:\n" +
      statusMessage + "\n" +
      "All group admins now have moderation credentials. You can:\n\n" +
      "• Appoint moderators with `/dail add moderator @username`\n" +
      "• Change features with `/dail features`\n" +
      "• Get help anytime with `/dail help`\n\n" +
      "Remember, YOU have full control over how this bot works in your group!",
      { parse_mode: 'Markdown' }
    );
    
    // Answer the callback query
    try {
      return ctx.answerCbQuery('Setup completed successfully!');
    } catch (cbError) {
      logger.error('Error answering complete setup callback query', { error: cbError.message });
    }
  } catch (error) {
    logger.error('Error completing setup', { error: error.message });
    try {
      return ctx.answerCbQuery('An error occurred while completing setup');
    } catch (cbError) {
      logger.error('Error answering callback query', { error: cbError.message });
    }
  }
} 