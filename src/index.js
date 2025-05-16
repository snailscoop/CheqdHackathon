/**
 * Cheqd Bot: Main Entry Point
 * 
 * This file initializes all services and starts the Telegram bot.
 */

const logger = require('./utils/logger');
const config = require('./config/config');
const sqliteService = require('./db/sqliteService');
const telegramService = require('./services/telegramService');
const cheqdService = require('./services/cheqdService');
const grokService = require('./services/grokService');
const path = require('path');
const fs = require('fs');

// Additional services from original codebase
const blockchainService = require('./modules/blockchain/blockchainService');
const identityVerification = require('./modules/identity/identityVerificationService');
const banStorage = require('./modules/moderation/banStorage');
const educationalCredentialService = require('./modules/education/educationalCredentialService');
const supportCredentialService = require('./modules/support/supportCredentialService');
const moderationCredentialService = require('./modules/moderation/moderationCredentialService');
const trustRegistryService = require('./modules/cheqd/trustRegistryService');
const trustRegistryInit = require('./modules/cheqd/trustRegistryInit');
const serviceConnector = require('./modules/integration/serviceConnector');

// Jackal Protocol related services
let jackalMonitor, processingQueue, videoProcessor, jackalPinService;
try {
  jackalMonitor = require('./modules/jackal/jackalMonitor');
  processingQueue = require('./modules/jackal/processingQueue');
  videoProcessor = require('./modules/jackal/videoProcessor');
  jackalPinService = require('./modules/jackal/jackalPinService');
} catch (error) {
  logger.warn('Jackal Protocol modules not available, related functionality will be limited', { error: error.message });
}

// Check for environment variables
if (!process.env.TELEGRAM_BOT_TOKEN) {
  logger.error('TELEGRAM_BOT_TOKEN environment variable is required');
  process.exit(1);
}

// SQLite is the only database we support now

// Create necessary directories
const dirs = ['data', 'logs'];
for (const dir of dirs) {
  const dirPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.info(`Created directory: ${dirPath}`);
  }
}

/**
 * Initialize all services and start the bot
 */
async function startBot() {
  try {
    logger.info('Starting Cheqd Bot...');
    
    // Write PID file for process management
    fs.writeFileSync(path.join(__dirname, '..', '.cheqd-bot.pid'), process.pid.toString());
    
    // Process warning handler
    process.on('warning', (warning) => {
      logger.warn('Process Warning:', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
      });
    });
    
    // Initialize with proper timeouts for all services
    const DEFAULT_TIMEOUT = 10000;
    
    // Initialize SQLite database
    logger.info('Initializing SQLite database...');
    await sqliteService.initialize();
    logger.info('SQLite database initialized successfully');
    
    // Run database migrations
    logger.info('Running database migrations...');
    try {
      const dbMigration = require('./db/migration');
      await dbMigration.runMigration();
      logger.info('Database migrations completed successfully');
    } catch (migrationError) {
      logger.warn('Database migration error, continuing with existing schema', {
        error: migrationError.message
      });
    }
    
    // Initialize Grok AI service
    logger.info('Initializing Grok AI service...');
    try {
      await Promise.race([
        grokService.initialize(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Grok initialization timeout')), 
          DEFAULT_TIMEOUT))
      ]);
    logger.info('Grok AI service initialized successfully');
    } catch (error) {
      logger.warn('Grok service initialization failed, continuing with limited functionality', { error: error.message });
    }
    
    // Initialize Cheqd service
    logger.info('Initializing Cheqd service...');
    try {
      await Promise.race([
        cheqdService.initialize(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Cheqd initialization timeout')), 
          DEFAULT_TIMEOUT))
      ]);
      logger.info('Cheqd service initialized successfully');
    } catch (error) {
      logger.warn('Cheqd service initialization failed, continuing with limited functionality', { error: error.message });
    }
    

    
    // Initialize Trust Registry Service
    logger.info('Initializing Trust Registry Service...');
    try {
      await Promise.race([
        trustRegistryService.initialize(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Trust Registry initialization timeout')), 
          DEFAULT_TIMEOUT))
      ]);
      logger.info('Trust Registry Service initialized successfully');
      
      // Initialize Trust Registry data
      logger.info('Initializing Trust Registry data...');
      try {
        await Promise.race([
          trustRegistryInit.initializeTrustRegistry(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Trust Registry data initialization timeout')), 
            DEFAULT_TIMEOUT))
        ]);
        logger.info('Trust Registry data initialized successfully');
      } catch (registryDataErr) {
        logger.error('Error initializing Trust Registry data', { error: registryDataErr.message });
      }
    } catch (error) {
      logger.warn('Trust Registry service initialization failed, continuing with limited functionality', { error: error.message });
    }
    
    // Initialize Blockchain Service
    logger.info('Initializing Blockchain Service...');
    try {
      await blockchainService.initialize();
      logger.info('Blockchain Service initialized successfully');
    } catch (error) {
      logger.warn('Blockchain service initialization failed, continuing with limited functionality', { error: error.message });
    }
    
    // Initialize Identity Verification Service
    logger.info('Initializing Identity Verification Service...');
    try {
      await identityVerification.initialize();
      logger.info('Identity Verification Service initialized successfully');
    } catch (error) {
      logger.warn('Identity Verification service initialization failed, continuing with limited functionality', { error: error.message });
    }
    
    // Initialize Ban Storage
    logger.info('Initializing Ban Storage...');
    try {
      await banStorage.initialize();
      logger.info('Ban Storage initialized successfully');
    } catch (error) {
      logger.warn('Ban Storage initialization failed, continuing with limited functionality', { error: error.message });
    }
    
    // Initialize Educational Credential Service
    logger.info('Initializing Educational Credential Service...');
    try {
      await educationalCredentialService.initialize();
      logger.info('Educational Credential Service initialized successfully');
    } catch (error) {
      logger.warn('Educational Credential service initialization failed, continuing with limited functionality', { error: error.message });
    }
    
    // Initialize Support Credential Service
    logger.info('Initializing Support Credential Service...');
    try {
      await supportCredentialService.initialize();
      logger.info('Support Credential Service initialized successfully');
    } catch (error) {
      logger.warn('Support Credential service initialization failed, continuing with limited functionality', { error: error.message });
    }
    
    // Initialize Moderation Credential Service
    logger.info('Initializing Moderation Credential Service...');
    try {
      await moderationCredentialService.initialize();
      logger.info('Moderation Credential Service initialized successfully');
    } catch (error) {
      logger.warn('Moderation Credential service initialization failed, continuing with limited functionality', { error: error.message });
    }
    
    // Initialize Service Connector for cross-service integration
    logger.info('Initializing Service Connector...');
    try {
      await serviceConnector.initialize();
      logger.info('Service Connector initialized successfully');
    } catch (error) {
      logger.warn('Service Connector initialization failed, continuing with limited functionality', { error: error.message });
    }
    
    // Initialize Jackal Protocol services if available
    if (jackalMonitor && processingQueue && videoProcessor && jackalPinService) {
      logger.info('Initializing Jackal Protocol services...');
      try {
        // Initialize Jackal PIN Service first
        await jackalPinService.initialize();
        
        // Test connection to Jackal PIN API if apiKey is configured
        if (config.jackal && config.jackal.pinApiKey) {
          const pinApiConnected = await jackalPinService.testConnection();
          if (pinApiConnected) {
            logger.info('Jackal PIN Service connected successfully');
          } else {
            logger.warn('Jackal PIN Service connection test failed');
          }
        }
        
        // Then initialize and start the remaining services
        await Promise.all([
          jackalMonitor.initialize(),
          processingQueue.initialize(),
          videoProcessor.initialize()
        ]);
        
        // Start the processors
        jackalMonitor.start();
        processingQueue.start();
        videoProcessor.start();
        
        logger.info('Jackal Protocol services started successfully');
      } catch (error) {
        logger.warn('Jackal Protocol services initialization failed, continuing with limited functionality', { error: error.message });
      }
    }
    
    // Initialize and start Telegram bot
    logger.info('Initializing Telegram service...');
    await telegramService.initialize();
    logger.info('Telegram service initialized successfully');
    
    logger.info('Starting Telegram bot...');
    await telegramService.start();
    logger.info('Telegram bot started successfully');
    
    // Setup periodic tasks
    setupPeriodicTasks();
    
    // Setup graceful shutdown
    setupGracefulShutdown();
    
    logger.info('Cheqd Bot is now running');
  } catch (error) {
    logger.error('Failed to start Cheqd Bot', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

/**
 * Setup periodic tasks such as health checks
 */
function setupPeriodicTasks() {
  // Health check every 5 minutes
  setInterval(async () => {
    try {
      // Check database connection
      await sqliteService.healthCheck();
      
      // Log system health status
      logger.debug('Periodic health check: All systems operational');
    } catch (error) {
      logger.error('Periodic health check failed', { error: error.message });
    }
  }, 5 * 60 * 1000);
  
  // Run other periodic tasks as needed
  if (jackalPinService) {
    // Sync video pinning data every 20 minutes
    setInterval(async () => {
      try {
        await jackalPinService.syncPinnedContents();
      } catch (error) {
        logger.error('Failed to sync pinned contents', { error: error.message });
      }
    }, 20 * 60 * 1000);
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown() {
  async function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down...`);
    
    try {
      // Stop Telegram bot
      await telegramService.stop();
      
      // Close database connection
      await sqliteService.close();
      
      // Clean up other services
      if (jackalMonitor) await jackalMonitor.shutdown();
      if (processingQueue) await processingQueue.shutdown();
      if (videoProcessor) await videoProcessor.shutdown();
      
      // Remove PID file
      const pidFile = path.join(__dirname, '..', '.cheqd-bot.pid');
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }
      
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  }
  
  // Listen for termination signals
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    
    // For critical errors, we may want to exit
    if (error.message.includes('FATAL:') || error.message.includes('CRITICAL:')) {
      logger.error('Critical error occurred, exiting process');
      process.exit(1);
    }
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', { 
      reason: reason instanceof Error ? reason.message : reason,
      stack: reason instanceof Error ? reason.stack : 'No stack trace'
    });
  });
}

// Start the bot
startBot().catch(error => {
  logger.error('Unhandled error during startup', { error: error.message, stack: error.stack });
  process.exit(1);
}); 