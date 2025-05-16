/**
 * Test script for moderation credential issuance
 * 
 * This script tests issuing a moderation credential using the same parameters
 * from the log file that previously failed.
 */

// Load environment variables
require('../load-env');
const sqliteService = require('../src/db/sqliteService');
const cheqdService = require('../src/services/cheqdService');
const moderationCredentialService = require('../src/modules/moderation/moderationCredentialService');
const logger = require('../src/utils/logger');

// Configuration - using same values from the logs
const ADMIN_ID = 2041129914;
const TARGET_ID = 5498994297;
const CHAT_ID = -1002668658699;
const ADMIN_USERNAME = 'imasalmon';
const TARGET_USERNAME = 'GarthVader1'; 

async function main() {
  try {
    // Initialize services
    await sqliteService.initialize();
    await cheqdService.initialize();
    await moderationCredentialService.initialize();
    
    logger.info('Starting moderation credential test');
    
    // Create issuer and recipient objects
    const issuer = {
      id: ADMIN_ID.toString(),
      username: ADMIN_USERNAME,
      firstName: 'Admin',
      lastName: 'User'
    };
    
    const recipient = {
      id: TARGET_ID.toString(),
      username: TARGET_USERNAME,
      firstName: 'Garth',
      lastName: 'Vader'
    };
    
    const chat = {
      id: CHAT_ID.toString(),
      title: 'Test Chat Group',
      type: 'supergroup'
    };
    
    // Issue moderation credential
    logger.info('Issuing moderation credential', { 
      issuer: issuer.username,
      recipient: recipient.username,
      role: 'GROUP_MODERATOR'
    });
    
    const result = await moderationCredentialService.issueModerationCredential(
      issuer,
      recipient,
      'GROUP_MODERATOR',
      chat,
      { override: true } // Allow credential issuance
    );
    
    if (result) {
      logger.info('Successfully issued moderation credential', {
        credentialId: result.credential?.credential_id,
        credentialType: result.credential?.type,
        role: result.role?.name,
        startDate: result.assignment?.startDate,
        endDate: result.assignment?.endDate
      });
    } else {
      logger.error('Failed to issue moderation credential');
    }
    
    logger.info('Test completed');
  } catch (error) {
    logger.error('Test error', { error: error.message });
  } finally {
    // Close database connection
    if (sqliteService.db) {
      await sqliteService.db.close();
    }
    process.exit(0);
  }
}

main(); 