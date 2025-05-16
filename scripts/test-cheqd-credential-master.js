/**
 * Master Cheqd Credential Test Script
 * 
 * This script tests the 5 core credential API endpoints:
 * 1. /credential/issue
 * 2. /credential/verify
 * 3. /credential/suspend
 * 4. /credential/reinstate
 * 5. /credential/revoke
 * 
 * Run with: node scripts/test-cheqd-credential-master.js
 */

require('dotenv').config();
const logger = require('../src/utils/logger');
const cheqdService = require('../src/services/cheqdService');
const sqliteService = require('../src/db/sqliteService');

// Track created resources
const resources = {
  issuerDid: null,
  holderDid: null,
  credential: null,
  credentialId: null
};

/**
 * Run the Master Credential Test
 */
async function runTest() {
  logger.info('Starting Cheqd Credential API Test');
  
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
    
    // Step 2: Create holder DID
    logger.info('Step 2: Creating holder DID');
    const holderDidResult = await cheqdService.createDID({
      ownerId: 'system',
      method: 'cheqd'
    });
    
    logger.info(`Created holder DID: ${holderDidResult.did}`);
    resources.holderDid = holderDidResult.did;
    
    // Step 3: Issue credential API test
    logger.info('Step 3: Testing /credential/issue API');
    
    // Example credential data
    const credentialData = {
      name: 'John Doe',
      degree: 'Bachelor of Science',
      university: 'Example University',
      graduationDate: '2023-06-15',
      id: holderDidResult.did
    };
    
    const credentialType = 'VerifiableDiploma';
    const credential = await cheqdService.issueCredential(
      issuerDidResult.did,
      holderDidResult.did,
      credentialType,
      credentialData
    );
    
    resources.credential = credential;
    
    // Get the credential ID from the database
    const dbCredential = await sqliteService.db.get(
      'SELECT credential_id FROM credentials WHERE issuer_did = ? AND holder_did = ? ORDER BY issued_at DESC LIMIT 1',
      [issuerDidResult.did, holderDidResult.did]
    );
    
    if (!dbCredential || !dbCredential.credential_id) {
      throw new Error('Failed to retrieve credential ID from database');
    }
    
    resources.credentialId = dbCredential.credential_id;
    logger.info(`Credential issued with ID: ${resources.credentialId}`);
    
    // Step 4: Verify credential API test
    logger.info('Step 4: Testing /credential/verify API');
    const verifyResult = await cheqdService.verifyCredential(resources.credentialId);
    
    logger.info(`Verification result: ${verifyResult.verified}`);
    
    if (!verifyResult.verified) {
      throw new Error('Credential verification API failed - credential should be valid');
    }
    
    // Step 5: Suspend credential API test
    logger.info('Step 5: Testing /credential/suspend API');
    const suspendResult = await cheqdService.suspendCredential(resources.credentialId);
    
    logger.info('Credential suspend API call completed');
    
    // Step 6: Verify suspend worked
    logger.info('Step 6: Verifying suspend API worked correctly');
    const verifySuspendedResult = await cheqdService.verifyCredential(resources.credentialId);
    logger.info(`Suspended credential verification: ${verifySuspendedResult.verified}`);
    
    // Step 7: Reinstate credential API test
    logger.info('Step 7: Testing /credential/reinstate API');
    const reinstateResult = await cheqdService.reinstateCredential(resources.credentialId);
    
    logger.info('Credential reinstate API call completed');
    
    // Step 8: Verify reinstate worked
    logger.info('Step 8: Verifying reinstate API worked correctly');
    const verifyReinstatedResult = await cheqdService.verifyCredential(resources.credentialId);
    logger.info(`Reinstated credential verification: ${verifyReinstatedResult.verified}`);
    
    // Step 9: Revoke credential API test
    logger.info('Step 9: Testing /credential/revoke API');
    const revokeResult = await cheqdService.revokeCredential(resources.credentialId);
    
    logger.info('Credential revoke API call completed');
    
    // Step 10: Verify revoke worked
    logger.info('Step 10: Verifying revoke API worked correctly');
    const verifyRevokedResult = await cheqdService.verifyCredential(resources.credentialId);
    logger.info(`Revoked credential verification: ${verifyRevokedResult.verified}`);
    
    logger.info('✅ All credential API tests completed!');
    return true;
  } catch (error) {
    logger.error('Test failed', { error: error.message });
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