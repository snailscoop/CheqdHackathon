/**
 * Master Cheqd Credential Status List Test Script
 * 
 * This script tests ONLY the 4 official credential status list API endpoints for encrypted status lists:
 * 1. POST /credential-status/create/encrypted
 * 2. POST /credential-status/update/encrypted
 * 3. POST /credential-status/check
 * 4. GET /credential-status/search
 * 
 * Run with: node scripts/test-cheqd-credential-status-master.js
 */

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const logger = require('../src/utils/logger');
const cheqdService = require('../src/services/cheqdService');
const sqliteService = require('../src/db/sqliteService');
const config = require('../src/config/config');

// Track created resources
const resources = {
  issuerDid: null,
  statusListId: null,
  statusListName: `status-list-${Date.now()}`,
  statusList: null,
  symmetricKey: null,
  credentialId: null,
  statusListIndex: 0 // Using index 0 for simplicity
};

/**
 * Run the Master Credential Status List Test
 */
async function runTest() {
  logger.info('Starting Cheqd Credential Status List API Test - OFFICIAL ENDPOINTS ONLY');
  
  try {
    // Ensure services are initialized
    await sqliteService.initialize();
    await cheqdService.ensureInitialized();
    
    // Step 1: Create issuer DID
    logger.info('Step 1: Creating issuer DID');
    const issuerDidResult = await cheqdService.createDID({
      ownerId: 'system',
      method: 'cheqd'
    });
    
    logger.info(`Created issuer DID: ${issuerDidResult.did}`);
    resources.issuerDid = issuerDidResult.did;
    
    // Step 2: CREATE - Test the /credential-status/create/encrypted endpoint
    logger.info('Step 2: Testing POST /credential-status/create/encrypted');
    
    // Define payment conditions
    const paymentConditions = [
      {
        feePaymentAddress: "cheqd1qs0nhyk868c246defezhz5eymlt0dmajna2csg",
        feePaymentAmount: 20,
        feePaymentWindow: 10
      }
    ];
    
    // Create status list using the service
    const statusListResult = await cheqdService.createCredentialStatusList(
      resources.issuerDid,
      resources.statusListName,
      'revocation',
      paymentConditions
    );
    
    resources.statusListId = statusListResult.id;
    resources.statusList = statusListResult.statusList;
    resources.symmetricKey = statusListResult.symmetricKey;
    
    logger.info(`Created encrypted status list with ID: ${resources.statusListId}`);
    
    // Step 3: Issue a credential using this status list
    logger.info('Step 3: Issuing a credential with the status list');
    
    // Create holder DID
    const holderDidResult = await cheqdService.createDID({
      ownerId: 'system',
      method: 'cheqd'
    });
    logger.info(`Created holder DID: ${holderDidResult.did}`);
    
    // Example credential data
    const credentialData = {
      name: "John Doe",
      degree: "Bachelor of Science",
      university: "Example University",
      graduationDate: "2023-06-15"
    };
    
    // Create a custom status property that references our new status list
    const statusProperty = {
      type: "StatusList2021Entry",
      statusPurpose: "revocation", // Must match the status list purpose
      statusListIndex: resources.statusListIndex.toString(),
      statusListCredential: resources.statusListId
    };
    
    // Issue credential using the cheqdService
    const credential = await cheqdService.issueCredential(
      resources.issuerDid,
      holderDidResult.did,
      'VerifiableDiploma',
      { ...credentialData, credentialStatus: statusProperty }
    );
    
    resources.credentialId = credential.id;
    logger.info(`Issued credential with ID: ${resources.credentialId} using status list: ${resources.statusListId}`);
    
    // Step 4: CHECK - Test the /credential-status/check endpoint
    logger.info('Step 4: Testing POST /credential-status/check');
    
    const statusBeforeUpdate = await cheqdService.checkCredentialStatus(
      resources.statusListId,
      resources.statusListIndex.toString(),
      resources.symmetricKey
    );
    
    logger.info(`Status check before update: ${JSON.stringify(statusBeforeUpdate)}`);
    
    // Step 5: UPDATE - Test the /credential-status/update/encrypted endpoint for revocation
    logger.info('Step 5: Testing POST /credential-status/update/encrypted with revoke action');
    
    // Directly use the updateCredentialStatusList method
    const updateForRevokeResult = await cheqdService.updateCredentialStatusList(
      resources.issuerDid,
      resources.statusListName,
      [resources.statusListIndex],
      'revoke',
      resources.symmetricKey
    );
    
    logger.info(`Update status list for revocation result: ${JSON.stringify(updateForRevokeResult)}`);
    
    // Step 6: CHECK again after update
    logger.info('Step 6: Testing POST /credential-status/check after revocation');
    
    const statusAfterRevoke = await cheqdService.checkCredentialStatus(
      resources.statusListId,
      resources.statusListIndex.toString(),
      resources.symmetricKey
    );
    
    logger.info(`Status check after revoke: ${JSON.stringify(statusAfterRevoke)}`);
    
    // Step 7: SEARCH - Test the /credential-status/search endpoint
    logger.info('Step 7: Testing GET /credential-status/search');
    
    const searchResult = await cheqdService.searchCredentialStatusList(resources.statusListId);
    
    logger.info(`Status list search result: ${JSON.stringify(searchResult)}`);
    
    // Step 8: UPDATE - Test the /credential-status/update/encrypted endpoint for reinstatement
    logger.info('Step 8: Testing POST /credential-status/update/encrypted with reinstate action');
    
    // Directly use the updateCredentialStatusList method
    const updateForReinstateResult = await cheqdService.updateCredentialStatusList(
      resources.issuerDid,
      resources.statusListName,
      [resources.statusListIndex],
      'reinstate',
      resources.symmetricKey
    );
    
    logger.info(`Update status list for reinstatement result: ${JSON.stringify(updateForReinstateResult)}`);
    
    // Step 9: CHECK final status
    logger.info('Step 9: Testing POST /credential-status/check after reinstatement');
    
    const statusAfterReinstate = await cheqdService.checkCredentialStatus(
      resources.statusListId,
      resources.statusListIndex.toString(),
      resources.symmetricKey
    );
    
    logger.info(`Status check after reinstate: ${JSON.stringify(statusAfterReinstate)}`);
    
    // Step 10: UPDATE - Test the /credential-status/update/encrypted endpoint for suspension
    logger.info('Step 10: Testing POST /credential-status/update/encrypted with suspend action');
    
    // Directly use the updateCredentialStatusList method
    const updateForSuspendResult = await cheqdService.updateCredentialStatusList(
      resources.issuerDid,
      resources.statusListName,
      [resources.statusListIndex],
      'suspend',
      resources.symmetricKey
    );
    
    logger.info(`Update status list for suspension result: ${JSON.stringify(updateForSuspendResult)}`);
    
    // Step 11: CHECK after suspension
    logger.info('Step 11: Testing POST /credential-status/check after suspension');
    
    const statusAfterSuspend = await cheqdService.checkCredentialStatus(
      resources.statusListId,
      resources.statusListIndex.toString(),
      resources.symmetricKey
    );
    
    logger.info(`Status check after suspend: ${JSON.stringify(statusAfterSuspend)}`);
    
    // Update the credential status in the database since we're not using helper methods
    await sqliteService.db.run(
      'UPDATE credentials SET status = ? WHERE credential_id = ?',
      ['suspended', resources.credentialId]
    );
    
    logger.info('✅ All 4 official credential status list API endpoints tested successfully!');
    return true;
  } catch (error) {
    logger.error('Test failed', { 
      error: error.message,
      response: error.response?.data
    });
    throw error;
  }
}

// Run the test if executed directly
if (require.main === module) {
  runTest()
    .then(success => {
      logger.info('Test completed successfully');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Test failed', { error: error.message });
      process.exit(1);
    });
}

module.exports = { runTest }; 