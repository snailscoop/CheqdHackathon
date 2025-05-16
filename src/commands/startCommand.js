/**
 * Start Command Handler
 * 
 * Handles the /start command for the Telegram bot.
 */

const logger = require('../utils/logger');
const { escapeMarkdown } = require('../utils/textUtils');
const sqliteService = require('../db/sqliteService');

// Welcome message
const WELCOME_MESSAGE = `
Welcome to the Cheqd DID and Credential Bot! 👋

I can help you with:
🆔 Creating and managing DIDs
📜 Issuing and verifying credentials
🎬 Pinning videos to Jackal Protocol
🧠 Answering questions with AI

Type /help to see all available commands.
`;

/**
 * Handle the /start command
 */
async function handle(ctx) {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name || 'there';
  
  logger.info('Start command received', { userId, username });
  
  try {
    // Register user in database if new
    await registerUser(userId, username, ctx.from);
    
    // Send welcome message
    await ctx.replyWithMarkdown(`Hello ${escapeMarkdown(firstName)}! ${WELCOME_MESSAGE}`);
    
    // Send quick start buttons
    await sendQuickStartButtons(ctx);
    
    return true;
  } catch (error) {
    logger.error('Error handling start command', { error: error.message, userId });
    await ctx.reply('Welcome! I encountered an issue setting up your profile, but you can still use most functions.');
    return false;
  }
}

/**
 * Register a new user in the database
 */
async function registerUser(userId, username, userInfo) {
  if (!userId) return false;
  
  const now = new Date().toISOString();
  
  try {
    // First check if the user already exists
    const existingUser = await sqliteService.db.get(
      'SELECT id FROM users WHERE id = ?',
      [userId]
    );
    
    if (existingUser) {
      // User exists, update last activity
      await sqliteService.db.run(
        'UPDATE users SET last_activity = ?, username = ? WHERE id = ?',
        [now, username || null, userId]
      );
    } else {
      // New user, insert record
      await sqliteService.db.run(
        `INSERT INTO users (
          id, username, first_name, last_name, language, 
          is_premium, join_date, last_activity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          username || null,
          userInfo?.first_name || null,
          userInfo?.last_name || null,
          userInfo?.language_code || 'en',
          userInfo?.is_premium ? 1 : 0,
          now,
          now
        ]
      );
      
      logger.info('New user registered', { userId, username });
    }
    
    return true;
  } catch (error) {
    logger.error('Error registering user', { error: error.message, userId });
    return false;
  }
}

/**
 * Send quick start buttons to the user
 */
async function sendQuickStartButtons(ctx) {
  await ctx.reply('What would you like to do?', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🆔 Create a DID', callback_data: 'did:create' },
          { text: '📜 Issue a Credential', callback_data: 'cred:issue' }
        ],
        [
          { text: '🎬 Pin a Video', callback_data: 'video:pin' },
          { text: '❓ Take a Quiz', callback_data: 'quiz:start' }
        ]
      ]
    }
  });
}

module.exports = {
  handle
}; 