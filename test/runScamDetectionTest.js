#!/usr/bin/env node

/**
 * Command line runner for the scam detection tests
 */

const path = require('path');
const { spawn } = require('child_process');
const logger = require('../src/utils/logger');

// Command line arguments
const args = process.argv.slice(2);
const testType = args[0]; // Get the first argument as test type

// Available test types
const validTestTypes = ['airdrop', 'wallet', 'investment', 'admin', 'phishing', 'normal', 'all'];

// Display help if requested
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
AI Scam Detection Test Runner
-----------------------------

Usage: node runScamDetectionTest.js [test-type] [options]

Test types:
  - airdrop     Test detection of crypto airdrop scams
  - wallet      Test detection of wallet verification scams
  - investment  Test detection of investment scams
  - admin       Test detection of admin impersonation scams
  - phishing    Test detection of phishing link scams
  - normal      Test normal (non-scam) messages for false positives
  - all         Run all tests (default)

Options:
  --verbose, -v   Show more detailed output
  --help, -h      Show this help message

Example:
  node runScamDetectionTest.js airdrop -v
  `);
  process.exit(0);
}

// Validate test type
const selectedTest = testType && validTestTypes.includes(testType) 
  ? testType 
  : 'all';

// Set environment variables for test
const env = {
  ...process.env,
  NODE_ENV: 'test',
  TEST_TYPE: selectedTest,
  VERBOSE: args.includes('--verbose') || args.includes('-v') ? 'true' : 'false'
};

logger.info(`Starting scam detection test: ${selectedTest}`);

// Run the test script
const testProcess = spawn('node', [path.join(__dirname, 'scamDetectionTest.js')], { 
  env,
  stdio: 'inherit' // Pipe output to parent process
});

// Handle process exit
testProcess.on('close', (code) => {
  if (code === 0) {
    logger.info('Scam detection test completed successfully!');
  } else {
    logger.error(`Scam detection test failed with code ${code}`);
  }
});

// Handle errors
testProcess.on('error', (err) => {
  logger.error('Failed to run scam detection test', { error: err.message });
}); 