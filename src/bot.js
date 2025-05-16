/**
 * Dail Bot - Main Entry Point
 * 
 * This is the main entry point for the bot that initializes all services,
 * connects to Telegram, and sets up command handlers.
 */

const config = require('./config/config');
const logger = require('./utils/logger');
const telegramService = require('./services/telegramService');
const sqliteService = require('./db/sqliteService');
const integration = require('./modules/integration');
const cachingUtils = require('./utils/cachingUtils');
const { tryCatchAsync } = require('./utils/errorHandler');

/**
 * Initialize all required services
 */
async function initializeServices() {
  logger.info('Initializing bot services...');
  
  try {
    // Initialize database first
    await sqliteService.initialize();
    logger.info('Database initialized');
    
    // Initialize caching
    await cachingUtils.initializeCache();
    logger.info('Cache initialized');
    
    // Initialize integration services (Jackal, Grok, credentials)
    await integration.initialize();
    logger.info('Integration services initialized');
    
    // Initialize Telegram bot
    await telegramService.initialize();
    logger.info('Telegram service initialized');
    
    return true;
  } catch (error) {
    logger.error('Failed to initialize services', { error: error.message });
    throw error;
  }
}

/**
 * Start the bot and listen for commands
 */
async function startBot() {
  logger.info('Starting Dail Bot...');
  
  try {
    // Initialize all services
    await initializeServices();
    
    // Start listening for Telegram commands
    await telegramService.start();
    
    logger.info(`Dail Bot started successfully in ${process.env.NODE_ENV} mode`);
    
    // Handle graceful shutdown
    setupShutdownHandlers();
    
    return true;
  } catch (error) {
    logger.error('Failed to start bot', { error: error.message });
    process.exit(1);
  }
}

/**
 * Setup handlers for graceful shutdown
 */
function setupShutdownHandlers() {
  // Handle application termination
  process.on('SIGINT', gracefulShutdown('SIGINT'));
  process.on('SIGTERM', gracefulShutdown('SIGTERM'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    gracefulShutdown('uncaughtException')(error);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { reason: reason?.message || reason, stack: reason?.stack });
    gracefulShutdown('unhandledRejection')(reason);
  });
}

/**
 * Perform graceful shutdown of services
 */
function gracefulShutdown(signal) {
  return async (error) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    try {
      // Stop Telegram bot
      await tryCatchAsync(async () => {
        await telegramService.stop();
        logger.info('Telegram service stopped');
      });
      
      // Close database connections
      await tryCatchAsync(async () => {
        await sqliteService.close();
        logger.info('Database connections closed');
      });
      
      logger.info('Graceful shutdown completed');
    } catch (shutdownError) {
      logger.error('Error during shutdown', { error: shutdownError.message });
    }
    
    process.exit(error ? 1 : 0);
  };
}

// Start the bot if this file is run directly
if (require.main === module) {
  startBot();
}

// Export for testing/importing
module.exports = {
  startBot,
  initializeServices,
  gracefulShutdown
}; 