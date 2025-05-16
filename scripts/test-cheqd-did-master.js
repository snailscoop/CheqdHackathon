/**
 * Master Cheqd DID Test Script
 * 
 * This script tests all DID-related operations in a logical sequence:
 * 1. Create a DID
 * 2. List DIDs
 * 3. Search/resolve the DID
 * 4. Update the DID with a service endpoint
 * 5. Search/resolve the updated DID
 * 6. Deactivate the DID
 * 7. Search/resolve the deactivated DID
 * 
 * Usage: node scripts/test-cheqd-did-master.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const cheqdService = require('../src/services/cheqdService');
const sqliteService = require('../src/db/sqliteService');

// Configuration
const config = {
  studioApiKey: process.env.CHEQD_STUDIO_API_KEY,
  studioApiUrl: process.env.CHEQD_API_URL || 'https://studio-api.cheqd.net',
  network: process.env.CHEQD_NETWORK_ID || 'testnet',
  testName: 'Dail Bot Master Test ' + new Date().toISOString().split('T')[0]
};

// Check if API key is set
if (!config.studioApiKey) {
  logger.error('CHEQD_STUDIO_API_KEY not set in .env file');
  process.exit(1);
}

// Track created resources
const resources = {
  did: null,
  updatedDocument: null,
  deactivationResult: null,
  searchResults: {}
};

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
    const filePath = path.join(resultsDir, `cheqd-master-test-${timestamp}.json`);
    
    // Write results to file
    fs.writeFileSync(filePath, JSON.stringify(resources, null, 2));
    logger.info(`Test results saved to: ${filePath}`);
  } catch (error) {
    logger.error('Failed to save test results', { error: error.message });
  }
}

/**
 * Run the Master Cheqd DID Test
 */
async function runTest() {
  logger.info('Starting Cheqd Master DID Test');
  
  try {
    // Ensure services are initialized
    await sqliteService.initialize();
    await cheqdService.ensureInitialized();
    
    // Step 1: Create a DID
    logger.info('Step 1: Creating a new DID');
    const didResult = await cheqdService.createDID({
      ownerId: 'system',
      method: 'cheqd'
    });
    
    logger.info(`Created DID: ${didResult.did}`);
    resources.did = didResult.did;
    resources.initialDocument = didResult.document;
    
    // Step 2: List DIDs
    logger.info('Step 2: Listing all DIDs');
    const dids = await cheqdService.listDIDs();
    
    if (!dids.includes(didResult.did)) {
      throw new Error('Created DID not found in DID list');
    }
    
    logger.info(`Listed ${dids.length} DIDs, including the newly created one`);
    resources.listResult = dids;
    
    // Step 3: Search/resolve the DID
    logger.info('Step 3: Resolving the DID');
    const resolveResult = await cheqdService.searchDID(didResult.did, {});
    
    // Log the search result for debugging
    console.log('Search Result:', JSON.stringify(resolveResult, null, 2));
    
    if (!resolveResult.didDocument || resolveResult.didDocument.id !== didResult.did) {
      throw new Error('DID resolution failed or returned incorrect document');
    }
    
    logger.info(`Successfully resolved DID: ${didResult.did}`);
    resources.searchResults.initial = resolveResult;
    
    // Step 4: Update the DID with a service endpoint
    logger.info('Step 4: Updating the DID with a service endpoint');
    
    // Create service endpoint payload
    const serviceEndpoint = {
      service: [
        {
          id: `${didResult.did}#service-1`,
          type: "LinkedDomains",
          serviceEndpoint: [
            "https://example.com/master-test"
          ]
        }
      ]
    };
    
    const updateResult = await cheqdService.updateDID(didResult.did, serviceEndpoint);
    
    if (!updateResult) {
      throw new Error('DID update failed');
    }
    
    logger.info('DID document updated successfully with service endpoint');
    resources.updatedDocument = updateResult.document;
    
    // Step 5: Search/resolve the updated DID
    logger.info('Step 5: Resolving the updated DID');
    const resolveUpdatedResult = await cheqdService.searchDID(didResult.did, {});
    
    // Verify that the service endpoint was added
    const hasService = resolveUpdatedResult.didDocument.service && 
                      resolveUpdatedResult.didDocument.service.some(s => 
                        s.type === "LinkedDomains" && 
                        s.serviceEndpoint && 
                        s.serviceEndpoint.includes("https://example.com/master-test"));
    
    if (!hasService) {
      throw new Error('Updated DID does not contain the service endpoint');
    }
    
    logger.info('Successfully resolved updated DID with service endpoint');
    resources.searchResults.afterUpdate = resolveUpdatedResult;
    
    // Step 6: Deactivate the DID
    logger.info('Step 6: Deactivating the DID');
    const deactivationResult = await cheqdService.deactivateDID(didResult.did, {});
    
    if (!deactivationResult || !deactivationResult.didDocumentMetadata || !deactivationResult.didDocumentMetadata.deactivated) {
      throw new Error('DID deactivation failed');
    }
    
    logger.info('DID document deactivated successfully');
    resources.deactivationResult = deactivationResult;
    
    // Step 7: Search/resolve the deactivated DID
    logger.info('Step 7: Resolving the deactivated DID');
    const resolveDeactivatedResult = await cheqdService.searchDID(didResult.did, {});
    
    if (!resolveDeactivatedResult.didDocumentMetadata || !resolveDeactivatedResult.didDocumentMetadata.deactivated) {
      throw new Error('Deactivated DID does not show as deactivated on resolution');
    }
    
    logger.info('Successfully resolved deactivated DID with deactivated status');
    resources.searchResults.afterDeactivation = resolveDeactivatedResult;
    
    // Verify in database
    logger.info('Step 8: Verifying DID status in database');
    const didRecord = await sqliteService.db.get(
      'SELECT * FROM dids WHERE did = ?',
      [didResult.did]
    );
    
    if (!didRecord) {
      throw new Error('DID not found in database');
    }
    
    if (didRecord.status !== 'deactivated') {
      throw new Error(`DID status in database is '${didRecord.status}', expected 'deactivated'`);
    }
    
    logger.info('Successfully verified DID status in database');
    resources.dbRecord = {
      did: didRecord.did,
      status: didRecord.status
    };
    
    // Save all test results
    saveResults(resources);
    
    logger.info('✅ Cheqd Master DID Test completed successfully!');
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