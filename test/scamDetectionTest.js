/**
 * Comprehensive Scam Detection Test
 * 
 * This script tests the AI-powered scam detection system by simulating
 * 5 different types of crypto scams and verifying detection and actions.
 * It uses the real core functionality and real AI analysis.
 */

const logger = require('../src/utils/logger');
const sqliteService = require('../src/db/sqliteService');
const grokService = require('../src/services/grokService');
const banStorage = require('../src/modules/moderation/banStorage');

// Parse environment variables for controlling test execution
const TEST_TYPE = process.env.TEST_TYPE || 'all';
const VERBOSE = process.env.VERBOSE === 'true';

// Configure logger verbosity
if (!VERBOSE) {
  logger.level = 'info';
} else {
  logger.level = 'debug';
  logger.debug('Running in verbose mode');
}

// Display test configuration
logger.info(`Running scam detection test: ${TEST_TYPE}`);

// Mock Telegram Bot API - We don't want to send real messages during testing
const mockTelegramBot = {
  kickChatMember: async (chatId, userId, options) => {
    logger.info('🔴 MOCK: Kicked user from chat', { chatId, userId, options });
    return { ok: true };
  },
  restrictChatMember: async (chatId, userId, permissions) => {
    logger.info('🔴 MOCK: Restricted user in chat', { chatId, userId, permissions });
    return { ok: true };
  },
  sendMessage: async (chatId, text, options) => {
    logger.info('🔴 MOCK: Sent message to chat', { chatId, text: text.substring(0, 50) + '...' });
    return { ok: true, message_id: Math.floor(Math.random() * 10000) };
  },
  deleteMessage: async (chatId, messageId) => {
    logger.info('🔴 MOCK: Deleted message', { chatId, messageId });
    return true;
  }
};

// Mock TelegramService to use our mock bot
const telegramService = require('../src/services/telegramService');
telegramService.bot = { telegram: mockTelegramBot };

// Mock a chat context
const mockChat = {
  id: -1001234567890,
  title: 'Test Crypto Group',
  type: 'supergroup'
};

// Mock different user profiles
const testUsers = {
  normal: { id: 111111, first_name: 'Normal', last_name: 'User', username: 'normal_user' },
  scammer1: { id: 222222, first_name: 'Airdrop', last_name: 'Scammer', username: 'crypto_gifter' },
  scammer2: { id: 333333, first_name: 'Wallet', last_name: 'Thief', username: 'wallet_support' },
  scammer3: { id: 444444, first_name: 'Investment', last_name: 'Guru', username: 'crypto_investor' },
  scammer4: { id: 555555, first_name: 'Fake', last_name: 'Admin', username: 'admin_support' },
  scammer5: { id: 666666, first_name: 'Phishing', last_name: 'Link', username: 'verify_now' }
};

// Different scam messages to test
const scamMessages = {
  airdrop: `🎁 MASSIVE AIRDROP ALERT! 🎁
FREE $5000 in BTC to all community members!
Just follow these simple steps:
1. Connect your wallet at http://crypto-gift.tk
2. Verify your account by sending 0.01 BTC
3. Receive 10x back INSTANTLY!
Don't miss out on this limited time offer! First 100 people only!`,

  walletVerify: `🔐 WALLET SECURITY ALERT 🔐
We've detected suspicious activity on your wallet.
To secure your funds, please verify your wallet immediately!
✅ Click the link below to connect your wallet
✅ Enter your seed phrase to verify ownership
✅ Complete the security check
⚠️ Failure to verify within 24 hours will result in suspended access!
Verify now: https://wallet-secure-verify.ml`,

  investment: `💰 GUARANTEED 300% RETURNS! 💰
Our proprietary trading algorithm has generated 300% returns consistently!
Limited spots available for our exclusive crypto investment pool.
✅ Minimum investment: only 0.1 BTC
✅ Returns paid daily
✅ Withdraw anytime
✅ 100% guaranteed profit
Join our millionaires club today! Reply "INVEST" for details!`,

  adminImpersonation: `ATTENTION ALL MEMBERS
This is an urgent message from the Admin team.
The group will be upgrading our security protocols.
To maintain your membership, you MUST verify your account:
1. Message @admin_support directly
2. Send your verification code and wallet address
3. Complete a small transaction to confirm
Members who don't complete this by tomorrow will be removed.
-Management Team`,

  phishingLink: `🚨 ACCOUNT VERIFICATION REQUIRED 🚨
Your crypto account needs immediate verification!
Our security system detected unusual activity linked to your account.
To prevent permanent suspension:
✅ Click here to verify: https://accounts-blockchain-verify.tk
✅ Complete verification within 12 hours
Thank you for your cooperation.
Blockchain Security Team`
};

// Test configurations for each scam type
const testConfigs = [
  {
    name: 'Crypto Airdrop Scam',
    user: testUsers.scammer1,
    message: scamMessages.airdrop,
    expectedThreatTypes: ['spam', 'scam', 'phishing'],
    expectedAction: 'ban',
    expectedConfidenceThreshold: 0.8
  },
  {
    name: 'Wallet Verification Scam',
    user: testUsers.scammer2,
    message: scamMessages.walletVerify,
    expectedThreatTypes: ['scam', 'phishing'],
    expectedAction: 'ban',
    expectedConfidenceThreshold: 0.85
  },
  {
    name: 'Investment Scam',
    user: testUsers.scammer3,
    message: scamMessages.investment,
    expectedThreatTypes: ['spam', 'scam'],
    expectedAction: 'ban',
    expectedConfidenceThreshold: 0.8
  },
  {
    name: 'Admin Impersonation Scam',
    user: testUsers.scammer4,
    message: scamMessages.adminImpersonation,
    expectedThreatTypes: ['scam', 'phishing'],
    expectedAction: 'ban',
    expectedConfidenceThreshold: 0.75
  },
  {
    name: 'Phishing Link Scam',
    user: testUsers.scammer5,
    message: scamMessages.phishingLink,
    expectedThreatTypes: ['scam', 'phishing'],
    expectedAction: 'ban',
    expectedConfidenceThreshold: 0.8
  }
];

// Non-scam messages for comparison (false positive tests)
const normalMessages = [
  'Hey everyone! Just wanted to introduce myself. I\'m new to crypto and looking forward to learning!',
  'Does anyone know when the next community update will be announced?',
  'I\'m having trouble with the wallet app. It keeps showing an error when I try to view my transaction history.',
  'The market looks pretty good today! What do you all think about the recent developments?',
  'Just shared an article about blockchain technology in our community channel. Check it out!'
];

// Mock auto-mod settings
const mockSettings = {
  antispamEnabled: true,
  aiScamDetectionEnabled: true
};

/**
 * Setup test environment
 */
async function setupTests() {
  logger.info('🔧 Setting up test environment...');

  // Initialize services
  await sqliteService.ensureInitialized();
  await grokService.initialize();
  
  // Disable foreign key constraints for testing
  try {
    await sqliteService.db.exec('PRAGMA foreign_keys = OFF;');
    logger.info('Foreign key constraints disabled for testing');
  } catch (error) {
    logger.warn('Failed to disable foreign key constraints', { error: error.message });
  }
  
  await banStorage.initialize();

  // Turn on AI analysis for all messages to ensure thorough testing
  banStorage.aiAnalysisEnabled = true;
  banStorage.useAIForAllMessages = true;
  banStorage.aiConfidenceThreshold = 0.65;

  // Save mock chat to database
  await sqliteService.saveChat(mockChat);
  
  // Save mock settings
  await sqliteService.updateSettings(mockChat.id.toString(), mockSettings);
  
  // Save users to database
  for (const user of Object.values(testUsers)) {
    await sqliteService.saveUser(user);
  }

  logger.info('✅ Test environment setup complete');
}

/**
 * Run a single scam test
 */
async function runScamTest(config) {
  logger.info(`\n🧪 TEST: ${config.name} ------------------------`);
  logger.info(`- User: ${config.user.username} (${config.user.id})`);
  logger.info(`- Message length: ${config.message.length} characters`);
  
  try {
    // Process the message with banStorage
    const result = await banStorage.processMessage(
      config.user.id.toString(),
      config.message,
      {
        messageId: Math.floor(Math.random() * 10000),
        chatId: mockChat.id.toString()
      }
    );
    
    // Analyze results
    logger.info(`\n📊 Detection results:`);
    logger.info(`- AI Analysis: ${result.aiAnalysis.isScam ? 'SCAM DETECTED' : 'No scam detected'} (${(result.aiAnalysis.confidence * 100).toFixed(1)}% confidence)`);
    logger.info(`- Pattern Analysis: ${result.threatAnalysis.threats.length > 0 ? 'Threats detected' : 'No threats'} (${(result.threatAnalysis.confidence * 100).toFixed(1)}% confidence)`);
    logger.info(`- Behavior Analysis: ${result.behaviorAnalysis.suspicious ? 'Suspicious' : 'Normal'}`);
    logger.info(`- Recommended Action: ${result.action.recommended}`);
    logger.info(`- Action Confidence: ${(result.action.confidence * 100).toFixed(1)}%`);
    logger.info(`- Action Reason: ${result.action.reason.join(', ')}`);
    
    // Check scam detection
    if (!result.aiAnalysis.isScam && config.expectedAction !== 'none') {
      logger.error(`❌ FAILED: AI did not detect scam in "${config.name}" test`);
      return false;
    }
    
    // Check threat patterns
    const detectedThreats = result.threatAnalysis.threats.map(t => t.type);
    const missedThreats = config.expectedThreatTypes.filter(t => !detectedThreats.includes(t));
    
    if (missedThreats.length > 0) {
      logger.warn(`⚠️ WARNING: Did not detect expected threat types: ${missedThreats.join(', ')}`);
    }
    
    // Check action recommendation
    if (result.action.recommended !== config.expectedAction && config.expectedAction !== 'any') {
      logger.error(`❌ FAILED: Expected action "${config.expectedAction}" but got "${result.action.recommended}"`);
      return false;
    }
    
    // Check confidence level
    if (result.action.confidence < config.expectedConfidenceThreshold) {
      logger.warn(`⚠️ WARNING: Confidence ${(result.action.confidence * 100).toFixed(1)}% below expected threshold ${(config.expectedConfidenceThreshold * 100).toFixed(1)}%`);
    }
    
    // Check database logs
    const logs = await sqliteService.db.all(
      `SELECT * FROM ai_scam_detection_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [config.user.id.toString()]
    );
    
    if (logs.length === 0) {
      logger.error(`❌ FAILED: No AI scam detection logs found in database`);
      return false;
    }
    
    logger.info(`✅ Database log entry created (id: ${logs[0].id})`);
    
    // Simulate the action that would be taken
    if (result.action.recommended === 'ban' && result.action.confidence > 0.8) {
      await mockTelegramBot.kickChatMember(mockChat.id, config.user.id, {
        reason: `AI scam detection: ${result.action.reason.join(', ').substring(0, 100)}`
      });
      
      // Save ban to database
      await banStorage.addBan(config.user.id.toString(), mockChat.id.toString(), {
        reason: `AI scam detection: ${result.action.reason.join(', ').substring(0, 100)}`,
        bannedBy: 'system',
        propagate: result.action.confidence > 0.9 // Propagate high-confidence bans
      });
      
      // Verify ban was added to database
      const ban = await banStorage.checkBan(config.user.id.toString(), mockChat.id.toString());
      if (!ban) {
        logger.error(`❌ FAILED: Ban not added to database`);
        return false;
      }
      
      logger.info(`✅ User banned successfully and ban stored in database`);
    }
    else if (result.action.recommended === 'suspend' && result.action.confidence > 0.75) {
      await mockTelegramBot.restrictChatMember(mockChat.id, config.user.id, {
        can_send_messages: false,
        until_date: Math.floor(Date.now() / 1000) + 3600 // 1 hour
      });
      
      logger.info(`✅ User suspended successfully`);
    }
    
    // Test passed
    logger.info(`✅ ${config.name} test PASSED`);
    return true;
  } catch (error) {
    logger.error(`❌ FAILED: Error during test:`, { error: error.message, stack: error.stack });
    return false;
  }
}

/**
 * Test non-scam messages (check for false positives)
 */
async function testNormalMessages() {
  logger.info('\n🧪 TESTING NORMAL MESSAGES (false positive check) ------------------------');
  
  let allPassed = true;
  
  for (let i = 0; i < normalMessages.length; i++) {
    const message = normalMessages[i];
    const user = testUsers.normal;
    
    logger.info(`\n- Testing normal message ${i+1}/${normalMessages.length}`);
    
    try {
      // Process the message with banStorage
      const result = await banStorage.processMessage(
        user.id.toString(),
        message,
        {
          messageId: Math.floor(Math.random() * 10000),
          chatId: mockChat.id.toString()
        }
      );
      
      // Check for false positives
      if (result.aiAnalysis.isScam && result.aiAnalysis.confidence > 0.65) {
        logger.error(`❌ FALSE POSITIVE: Normal message detected as scam with ${(result.aiAnalysis.confidence * 100).toFixed(1)}% confidence`);
        logger.error(`- Message: "${message}"`);
        logger.error(`- AI Reasoning: ${result.aiAnalysis.reasoning.join(', ')}`);
        allPassed = false;
      } else {
        logger.info(`✅ Correctly identified as normal message`);
      }
      
      // Check that no severe action is recommended
      if (result.action.recommended !== 'none' && result.action.recommended !== 'warn') {
        logger.error(`❌ FALSE POSITIVE: Severe action "${result.action.recommended}" recommended for normal message`);
        allPassed = false;
      } else {
        logger.info(`✅ No severe action recommended`);
      }
    } catch (error) {
      logger.error(`❌ Error processing normal message:`, { error: error.message });
      allPassed = false;
    }
  }
  
  if (allPassed) {
    logger.info(`\n✅ All normal messages correctly processed (no false positives)`);
  } else {
    logger.error(`\n❌ Some normal messages triggered false positives`);
  }
  
  return allPassed;
}

/**
 * Main test function
 */
async function runTests() {
  logger.info('🚀 Starting AI Scam Detection Tests');
  
  try {
    // Set up test environment
    await setupTests();
    
    let passedTests = 0;
    let failedTests = 0;
    
    // Run scam tests based on TEST_TYPE
    if (TEST_TYPE === 'all' || TEST_TYPE === 'airdrop') {
      const passed = await runScamTest(testConfigs[0]); // Airdrop scam
      TEST_TYPE === 'airdrop' ? process.exit(passed ? 0 : 1) : (passed ? passedTests++ : failedTests++);
    }
    
    if (TEST_TYPE === 'all' || TEST_TYPE === 'wallet') {
      const passed = await runScamTest(testConfigs[1]); // Wallet verification scam
      TEST_TYPE === 'wallet' ? process.exit(passed ? 0 : 1) : (passed ? passedTests++ : failedTests++);
    }
    
    if (TEST_TYPE === 'all' || TEST_TYPE === 'investment') {
      const passed = await runScamTest(testConfigs[2]); // Investment scam
      TEST_TYPE === 'investment' ? process.exit(passed ? 0 : 1) : (passed ? passedTests++ : failedTests++);
    }
    
    if (TEST_TYPE === 'all' || TEST_TYPE === 'admin') {
      const passed = await runScamTest(testConfigs[3]); // Admin impersonation scam
      TEST_TYPE === 'admin' ? process.exit(passed ? 0 : 1) : (passed ? passedTests++ : failedTests++);
    }
    
    if (TEST_TYPE === 'all' || TEST_TYPE === 'phishing') {
      const passed = await runScamTest(testConfigs[4]); // Phishing link scam
      TEST_TYPE === 'phishing' ? process.exit(passed ? 0 : 1) : (passed ? passedTests++ : failedTests++);
    }
    
    // Test normal messages (false positive check)
    if (TEST_TYPE === 'all' || TEST_TYPE === 'normal') {
      const normalTestsPassed = await testNormalMessages();
      TEST_TYPE === 'normal' ? process.exit(normalTestsPassed ? 0 : 1) : (normalTestsPassed ? passedTests++ : failedTests++);
    }
    
    // Only report results for 'all' tests
    if (TEST_TYPE === 'all') {
      // Report results
      logger.info('\n-----------------------------------------');
      logger.info(`🏁 TESTS COMPLETED: ${passedTests} passed, ${failedTests} failed`);
      logger.info('-----------------------------------------');
      
      if (failedTests === 0) {
        logger.info('✅ ALL TESTS PASSED - AI Scam Detection is functioning correctly!');
        process.exit(0);
      } else {
        logger.error(`❌ ${failedTests} TESTS FAILED - Please review the logs and fix issues`);
        process.exit(1);
      }
    }
    
  } catch (error) {
    logger.error('💥 Fatal error running tests:', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Run the tests
runTests(); 