#!/usr/bin/env node

/**
 * Trust Registry Initialization Script
 * 
 * This script initializes the trust registry hierarchy for the Cheqd bot.
 * It creates root, partner, community and bot registries and sets up credential types.
 */

// Load environment variables
require('dotenv').config();

const path = require('path');
const logger = require('../src/utils/logger');
const sqliteService = require('../src/db/sqliteService');
const cheqdService = require('../src/services/cheqdService');
const trustRegistryInit = require('../src/modules/cheqd/trustRegistryInit');

/**
 * Main function
 */
async function main() {
  try {
    logger.info('Starting trust registry initialization');
    
    // Initialize SQL database
    await sqliteService.initialize();
    logger.info('SQLite database initialized');
    
    // Initialize Cheqd service
    try {
      await cheqdService.initialize();
      logger.info('Cheqd service initialized');
    } catch (error) {
      logger.warn('Cheqd service initialization failed, continuing with mock mode', {
        error: error.message
      });
    }
    
    // Initialize trust registry
    const botName = process.env.BOT_NAME || 'Dail Bot';
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'DailBot';
    
    const trustRegistryOptions = {
      rootName: process.env.TRUST_REGISTRY_ROOT_NAME || 'Cheqd Root Trust Registry',
      rootDescription: process.env.TRUST_REGISTRY_ROOT_DESC || 'Root registry for Cheqd ecosystem',
      rootDid: process.env.TRUST_REGISTRY_ROOT_DID,
      
      partnerName: process.env.TRUST_REGISTRY_PARTNER_NAME || 'Cheqd Partner Registry',
      partnerDescription: process.env.TRUST_REGISTRY_PARTNER_DESC || 'Partner registry for DID providers',
      partnerDid: process.env.TRUST_REGISTRY_PARTNER_DID,
      
      communityName: process.env.TRUST_REGISTRY_COMMUNITY_NAME || 'Cheqd Community Registry',
      communityDescription: process.env.TRUST_REGISTRY_COMMUNITY_DESC || 'Community registry for educational services',
      communityDid: process.env.TRUST_REGISTRY_COMMUNITY_DID,
      
      botName: `${botName} Registry`,
      botDescription: `Registry for the ${botName} Telegram bot`,
      botDid: process.env.TRUST_REGISTRY_BOT_DID,
      telegramBotId: process.env.TELEGRAM_BOT_ID,
      telegramBotUsername: botUsername,
      
      registerCredentialTypes: true,
      credentialTypes: [
        'EducationalCredential',
        'SupportTierCredential',
        'ModeratorCredential',
        'AdminCredential'
      ],
      
      createdBy: 'initialization-script'
    };
    
    // Create trust registry hierarchy
    const result = await trustRegistryInit.initializeTrustRegistry(trustRegistryOptions);
    
    logger.info('Trust registry hierarchy initialized successfully', {
      root: result.root?.registry_id,
      partner: result.partner?.registry_id,
      community: result.community?.registry_id,
      bot: result.bot?.registry_id,
      trustChainValid: result.trustChain?.valid
    });
    
    // Close database connection
    await sqliteService.close();
    
    logger.info('Trust registry initialization completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during trust registry initialization', {
      error: error.message,
      stack: error.stack
    });
    
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  logger.error('Unhandled error during trust registry initialization', {
    error: error.message,
    stack: error.stack
  });
  
  process.exit(1);
}); 