/**
 * Telegram Middleware
 * 
 * Collection of middleware functions for the Telegram bot
 */

const logger = require('../utils/logger');
const config = require('../config/config');
const { UserError, AuthorizationError } = require('../utils/errors');
const sqliteService = require('../db/sqliteService');

// Store for rate limiting
const rateLimits = {
  // Structure: { userId: { count: 0, resetTime: timestamp } }
};

/**
 * Log all incoming messages
 */
function logMessage(ctx, next) {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text || ctx.callbackQuery?.data;
  
  logger.info('Received message', {
    userId,
    username,
    chatId,
    text: text?.substring(0, 100)
  });
  
  return next();
}

/**
 * Enforce rate limits on users
 */
function rateLimit(ctx, next) {
  const userId = ctx.from?.id;
  const now = Date.now();
  
  // Skip rate limiting for admin users
  if (isAdmin(ctx)) {
    return next();
  }
  
  if (!userId) {
    return next();
  }
  
  // Get or initialize user rate limit data
  if (!rateLimits[userId]) {
    rateLimits[userId] = {
      count: 0,
      resetTime: now + 60000, // Reset after 1 minute
      blocked: false
    };
  }
  
  const userLimit = rateLimits[userId];
  
  // Reset counter if time elapsed
  if (now > userLimit.resetTime) {
    userLimit.count = 0;
    userLimit.resetTime = now + 60000;
    userLimit.blocked = false;
  }
  
  // Increment and check
  userLimit.count++;
  
  // Apply proper rate limits based on user tier
  const limit = 15; // Default limit of 15 messages per minute
  
  if (userLimit.count > limit) {
    if (!userLimit.blocked) {
      userLimit.blocked = true;
      logger.warn('Rate limit exceeded', { userId, count: userLimit.count });
      
      // Notify user
      ctx.reply('You are sending too many messages. Please wait a moment before trying again.');
    }
    return;
  }
  
  return next();
}

/**
 * Track user activity and log it to the database
 */
async function trackUserActivity(ctx, next) {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;
  const chatId = ctx.chat?.id;
  
  if (!userId) {
    return next();
  }
  
  try {
    // Update or insert user record
    await sqliteService.db.run(
      `INSERT INTO users (id, username, last_activity) 
       VALUES (?, ?, ?) 
       ON CONFLICT(id) DO UPDATE SET 
       username = EXCLUDED.username, 
       last_activity = EXCLUDED.last_activity`,
      [userId, username || null, new Date().toISOString()]
    );
    
    // Log message for analytics
    await sqliteService.db.run(
      `INSERT INTO message_logs (user_id, chat_id, timestamp)
       VALUES (?, ?, ?)`,
      [userId, chatId, new Date().toISOString()]
    );
  } catch (error) {
    logger.error('Error tracking user activity', { error: error.message, userId });
  }
  
  return next();
}

/**
 * Check if a user is authorized to access premium features
 */
function premiumAuthorization(ctx, next) {
  const premiumFeaturePattern = /^\/premium/;
  const command = ctx.message?.text;
  
  // Skip if not a premium command
  if (!command || !premiumFeaturePattern.test(command)) {
    return next();
  }
  
  const userId = ctx.from?.id;
  
  // For now just check if admin
  if (isAdmin(ctx)) {
    return next();
  }
  
  // TODO: Implement actual premium status check from database
  // For now, block all premium features for non-admins
  ctx.reply('This feature requires a premium subscription. Please contact support for more information.');
  return;
}

/**
 * Catch and handle any errors in the middleware chain
 */
function errorHandler(ctx, next) {
  return Promise.resolve(next())
    .catch(error => {
      logger.error('Error in Telegram handler', {
        error: error.message,
        userId: ctx.from?.id,
        username: ctx.from?.username,
        chatId: ctx.chat?.id
      });
      
      // Send user-friendly error message
      if (error instanceof UserError || error instanceof AuthorizationError) {
        ctx.reply(`Error: ${error.message}`);
      } else {
        ctx.reply('Sorry, something went wrong. Please try again later.');
      }
    });
}

/**
 * Check if user is an admin
 */
function isAdmin(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return false;
  
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => parseInt(id.trim(), 10));
  return adminIds.includes(userId);
}

module.exports = {
  logMessage,
  rateLimit,
  trackUserActivity,
  premiumAuthorization,
  errorHandler,
  isAdmin
}; 