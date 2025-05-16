/**
 * Master Cheqd DID-Linked Resource Test Script
 * 
 * This script tests all DID-Linked Resource operations in a logical sequence:
 * 1. Create a DID (resources need a DID to link to)
 * 2. Create a DID-Linked Resource
 * 3. Search for the resource by resourceId
 * 4. Search for the resource by resourceName and resourceType
 * 5. Test fetching only resource metadata
 * 6. Test integrity verification with checksum
 * 
 * Usage: node scripts/test-cheqd-dlr-master.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../src/utils/logger');
const cheqdService = require('../src/services/cheqdService');
const sqliteService = require('../src/db/sqliteService');

// Set NODE_ENV to development to enable mock responses
process.env.NODE_ENV = 'development';

// Configuration
const config = {
  studioApiKey: process.env.CHEQD_STUDIO_API_KEY,
  studioApiUrl: process.env.CHEQD_API_URL || process.env.CHEQD_NETWORK_URL || 'https://studio-api.cheqd.net',
  network: process.env.CHEQD_NETWORK_ID || 'testnet',
  testName: 'DID-Linked Resource Master Test ' + new Date().toISOString().split('T')[0]
};

// Track created resources
const resources = {
  did: null,
  resource: null,
  searchResults: {},
  dbRecords: {}
};

/**
 * Create sample text content in base64
 * @returns {string} Base64-encoded content
 */
function createSampleTextContent() {
  const content = `Sample text document for DID-Linked Resource testing
Created at: ${new Date().toISOString()}
This is a test document for the Cheqd DID-Linked Resource API.`;
  
  return Buffer.from(content).toString('base64');
}

/**
 * Create sample JSON content in base64
 * @returns {string} Base64-encoded content
 */
function createSampleJSONContent() {
  const content = {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://schema.org"
    ],
    "type": "CredentialSchema",
    "name": "Test Credential Schema",
    "author": "Test Author",
    "authored": new Date().toISOString(),
    "schema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "age": {
          "type": "integer"
        }
      },
      "required": ["name"]
    }
  };
  
  return Buffer.from(JSON.stringify(content)).toString('base64');
}

/**
 * Calculate SHA-256 checksum of content
 * @param {string} content - Base64 content
 * @returns {string} SHA-256 checksum
 */
function calculateChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Save test results to a file
 * @param {Object} resources - Test resources
 */
function saveResults(resources) {
  try {
    // Create results directory if it doesn't exist
    const resultsDir = path.join(__dirname, '..', 'data', 'test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    
    // Create timestamp-based filename
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const filePath = path.join(resultsDir, `cheqd-dlr-master-test-${timestamp}.json`);
    
    // Write results to file
    fs.writeFileSync(filePath, JSON.stringify(resources, null, 2));
    logger.info(`Test results saved to: ${filePath}`);
  } catch (error) {
    logger.error('Failed to save test results', { error: error.message });
  }
}

/**
 * Run the Master DID-Linked Resource Test
 */
async function runTest() {
  logger.info('Starting Cheqd Master DID-Linked Resource Test');
  
  try {
    // Ensure services are initialized
    await sqliteService.initialize();
    await cheqdService.ensureInitialized();
    
    // Step 1: Create a DID (needed to link resources to)
    logger.info('Step 1: Creating a new DID');
    const didResult = await cheqdService.createDID({
      ownerId: 'system',
      method: 'cheqd'
    });
    
    logger.info(`Created DID: ${didResult.did}`);
    resources.did = didResult.did;
    resources.didDocument = didResult.document;
    
    // Step 2: Create a DID-linked resource (Text Document)
    logger.info('Step 2: Creating a DID-linked Text Resource');
    const textContent = createSampleTextContent();
    const textChecksum = calculateChecksum(textContent);
    
    const textResourceData = {
      data: textContent,
      encoding: 'base64',
      name: 'TestTextDocument',
      type: 'TextDocument'
    };
    
    const textResourceResult = await cheqdService.createResource(didResult.did, textResourceData);
    
    logger.info(`Text Resource created: ${textResourceResult.resourceId}`);
    resources.textResource = textResourceResult;
    
    // Step 3: Create another DID-linked resource (JSON Document)
    logger.info('Step 3: Creating a DID-linked JSON Resource');
    const jsonContent = createSampleJSONContent();
    const jsonChecksum = calculateChecksum(jsonContent);
    
    const jsonResourceData = {
      data: jsonContent,
      encoding: 'base64',
      name: 'TestJSONSchema',
      type: 'JSONDocument',
      mediaType: 'application/json'
    };
    
    const jsonResourceResult = await cheqdService.createResource(didResult.did, jsonResourceData);
    
    logger.info(`JSON Resource created: ${jsonResourceResult.resourceId}`);
    resources.jsonResource = jsonResourceResult;
    
    // Step 4: Search for the Text Resource by resourceId
    logger.info('Step 4: Searching for Text Resource by resourceId');
    const textResourceSearchResult = await cheqdService.searchResource(didResult.did, {
      resourceId: textResourceResult.resourceId
    });
    
    if (!textResourceSearchResult || textResourceSearchResult.dereferencingMetadata?.error === 'notFound') {
      throw new Error('Text Resource not found by resourceId');
    }
    
    logger.info(`Successfully found Text Resource by resourceId: ${textResourceResult.resourceId}`);
    resources.searchResults.byResourceId = textResourceSearchResult;
    
    // Step 5: Search for the JSON Resource by name and type
    logger.info('Step 5: Searching for JSON Resource by name and type');
    const jsonResourceSearchResult = await cheqdService.searchResource(didResult.did, {
      resourceName: 'TestJSONSchema',
      resourceType: 'JSONDocument'
    });
    
    if (!jsonResourceSearchResult || jsonResourceSearchResult.dereferencingMetadata?.error === 'notFound') {
      throw new Error('JSON Resource not found by name and type');
    }
    
    logger.info('Successfully found JSON Resource by name and type');
    resources.searchResults.byNameAndType = jsonResourceSearchResult;
    
    // Step 6: Test fetching only resource metadata
    logger.info('Step 6: Testing resourceMetadata parameter');
    const metadataOnlyResult = await cheqdService.searchResource(didResult.did, {
      resourceId: textResourceResult.resourceId,
      resourceMetadata: true
    });
    
    if (!metadataOnlyResult || !metadataOnlyResult.contentMetadata) {
      throw new Error('Resource metadata not returned properly');
    }
    
    logger.info('Successfully retrieved resource metadata only');
    resources.searchResults.metadataOnly = metadataOnlyResult;
    
    // Step 7: Test integrity verification with checksum
    logger.info('Step 7: Testing checksum verification');
    const checksumVerifyResult = await cheqdService.searchResource(didResult.did, {
      resourceId: textResourceResult.resourceId,
      checksum: textResourceResult.checksum
    });
    
    if (!checksumVerifyResult || checksumVerifyResult.dereferencingMetadata?.error === 'notFound') {
      throw new Error('Resource checksum verification failed');
    }
    
    logger.info('Successfully verified resource with checksum');
    resources.searchResults.withChecksum = checksumVerifyResult;
    
    // Step 8: Verify resources in database
    logger.info('Step 8: Verifying resources in database');
    const textResourceRecord = await sqliteService.db.get(
      'SELECT * FROM resources WHERE resource_id = ?',
      [textResourceResult.resourceId]
    );
    
    const jsonResourceRecord = await sqliteService.db.get(
      'SELECT * FROM resources WHERE resource_id = ?',
      [jsonResourceResult.resourceId]
    );
    
    if (!textResourceRecord || !jsonResourceRecord) {
      throw new Error('Resources not found in database');
    }
    
    logger.info('Successfully verified resources in database');
    resources.dbRecords = {
      textResource: {
        resourceId: textResourceRecord.resource_id,
        resourceName: textResourceRecord.resource_name,
        resourceType: textResourceRecord.resource_type
      },
      jsonResource: {
        resourceId: jsonResourceRecord.resource_id,
        resourceName: jsonResourceRecord.resource_name,
        resourceType: jsonResourceRecord.resource_type
      }
    };
    
    // Save all test results
    saveResults(resources);
    
    logger.info('✅ Cheqd Master DID-Linked Resource Test completed successfully!');
    return resources;
  } catch (error) {
    logger.error('Test failed', { error: error.message, stack: error.stack });
    
    // Save partial results even on failure
    if (Object.keys(resources).length > 0) {
      resources.error = error.message;
      saveResults(resources);
    }
    
    throw error;
  }
}

// Run the test if executed directly
if (require.main === module) {
  runTest()
    .then(success => {
      if (success) {
        logger.info('Test completed successfully');
        process.exit(0);
      } else {
        logger.error('Test failed');
        process.exit(1);
      }
    })
    .catch(error => {
      logger.error('Unexpected error', { error: error.message });
      process.exit(1);
    });
}

module.exports = {
  runTest
}; 