/**
 * Master Cheqd Trust Registry Test Script
 * 
 * This script tests all Trust Registry service operations in a logical sequence:
 * 1. Create test DIDs
 * 2. Initialize trust registry hierarchy
 * 3. Issue an accreditation
 * 4. Verify the accreditation
 * 5. Suspend the accreditation
 * 6. Verify the suspended accreditation
 * 7. Reinstate the accreditation
 * 8. Verify the reinstated accreditation
 * 9. Revoke the accreditation
 * 10. Verify the revoked accreditation
 * 
 * Usage: node scripts/test-cheqd-trust-registry-master.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const cheqdService = require('../src/services/cheqdService');
const sqliteService = require('../src/db/sqliteService');
const trustRegistryService = require('../src/modules/cheqd/trustRegistryService');

// Globals
const resources = {
  issuerDID: null,
  subjectDID: null,
  rootRegistry: null,
  issuerRegistry: null,
  accreditation: null
};

// Configuration
const config = {
  testName: 'Trust Registry Master Test ' + new Date().toISOString().split('T')[0],
  testOutputDir: path.join(process.cwd(), 'data', 'test-results')
};

/**
 * Ensure test output directory exists
 */
function ensureOutputDir() {
  if (!fs.existsSync(config.testOutputDir)) {
    fs.mkdirSync(config.testOutputDir, { recursive: true });
  }
}

/**
 * Create test DIDs for issuer and subject
 */
async function createTestDids() {
  try {
    logger.info('Creating test DIDs');
    
    // Create issuer DID
    const issuerResult = await cheqdService.createDID({
      method: 'cheqd',
      network: 'testnet',
      ownerId: 'test-issuer'
    });
    
    resources.issuerDID = issuerResult.did;
    logger.info(`Created issuer DID: ${resources.issuerDID}`);
    
    // Create subject DID
    const subjectResult = await cheqdService.createDID({
      method: 'cheqd',
      network: 'testnet',
      ownerId: 'test-subject'
    });
    
    resources.subjectDID = subjectResult.did;
    logger.info(`Created subject DID: ${resources.subjectDID}`);
    
    return { issuerDid: resources.issuerDID, subjectDid: resources.subjectDID };
  } catch (error) {
    logger.error('Failed to create test DIDs', { error: error.message });
    throw error;
  }
}

/**
 * Initialize the trust registry hierarchy and register the issuer
 */
async function initializeTrustRegistry() {
  try {
    logger.info('Step 1-2: Initializing trust registry hierarchy');
    
    // First, check if we already have a root registry
    const existingRoot = await sqliteService.db.get(
      'SELECT * FROM trust_registries WHERE registry_type = ?',
      ['ROOT']
    );
    
    if (existingRoot) {
      logger.info(`Using existing root registry: ${existingRoot.registry_id}`);
      resources.rootRegistry = {
        id: existingRoot.registry_id,
        did: existingRoot.did,
        name: existingRoot.registry_name
      };
    } else {
      // Create a root registry
      const rootRegistry = await trustRegistryService.createOrUpdateRegistry({
        id: `root-${Date.now()}`,
        name: 'Test Root Registry',
        description: 'Test Root Registry for Automated Tests',
        type: 'ROOT',
        website: 'https://cheqd.io',
        did: resources.issuerDID,
        data: {
          description: 'Root registry for testing'
        }
      });
      
      resources.rootRegistry = rootRegistry;
      logger.info(`Created root registry with ID: ${rootRegistry.id}`);
    }
    
    // Create an issuer registry and link it to the root
    const issuerRegistry = await trustRegistryService.createOrUpdateRegistry({
      id: `issuer-${Date.now()}`,
      name: `Test Issuer Registry ${Date.now()}`,
      description: 'Test Issuer Registry for Automated Tests',
      type: 'ISSUER',
      parentId: resources.rootRegistry.id,
      did: resources.issuerDID,
      data: {
        description: 'Test Issuer Registry for Automated Tests'
      }
    });
    
    resources.issuerRegistry = issuerRegistry.id || issuerRegistry;
    logger.info(`Created issuer registry with ID: ${resources.issuerRegistry} for DID: ${resources.issuerDID}`);
    
    // Register credential types for the issuer
    const authorizationId = await trustRegistryService.registerCredentialType(
      resources.issuerRegistry,
      'accredit',
      {
        name: 'Accreditation credential',
        version: '1.0',
        description: 'A credential that accredits an entity'
      }
    );
    
    logger.info(`Registered credential type for issuer: accredit`);
    
    return { rootRegistry: resources.rootRegistry, issuerRegistry: resources.issuerRegistry };
  } catch (error) {
    logger.error('Failed to initialize trust registry', { error: error.message });
    throw error;
  }
}

/**
 * Issue a test accreditation
 */
async function issueAccreditation() {
  try {
    logger.info('Step 3: Issuing accreditation via service');
    
    // Issue accreditation
    const accreditationOptions = {
      accreditationType: 'accredit',
      issuerDid: resources.issuerDID,
      subjectDid: resources.subjectDID,
      schemas: ['https://example.com/schemas/trustRegistry'],
      format: 'jwt',
      accreditationName: 'Test Accreditation',
      trustFramework: 'Cheqd Test Trust Framework',
      trustFrameworkId: 'urn:cheqd:test-framework',
      credentialStatus: {
        type: 'StatusList2021Entry',
        statusPurpose: 'revocation'
      }
    };
    
    const accreditation = await trustRegistryService.issueAccreditation(accreditationOptions);
    
    // Store the resulting accreditation
    resources.accreditation = accreditation;
    
    // If the accreditation ID is not directly in the object, try to extract it from logs
    if (!resources.accreditation.id && accreditation) {
      // Try to find it in standard places
      if (accreditation.accreditationId) {
        resources.accreditation.id = accreditation.accreditationId;
      } else if (accreditation.id) {
        resources.accreditation.id = accreditation.id;
      } else if (accreditation.credentialId) {
        resources.accreditation.id = accreditation.credentialId;
      }
      
      // If still not found, look in the database for the most recent accreditation
      if (!resources.accreditation.id) {
        const recentAccreditation = await sqliteService.db.get(
          `SELECT accreditation_id FROM trust_accreditations 
           WHERE registry_id = ? AND subject_id = ? 
           ORDER BY created_at DESC LIMIT 1`,
          [resources.issuerRegistry, resources.subjectDID]
        );
        
        if (recentAccreditation) {
          resources.accreditation.id = recentAccreditation.accreditation_id;
        }
      }
    }
    
    logger.info(`Issued accreditation with ID: ${resources.accreditation?.id || 'unknown'}`);
    
    return accreditation;
  } catch (error) {
    logger.error('Failed to issue accreditation', { error: error.message });
    throw error;
  }
}

/**
 * Verify the issued accreditation
 */
async function verifyAccreditation() {
  try {
    logger.info('Step 4: Verifying accreditation');
    
    // If we don't have an accreditation ID, try to find it
    if (!resources.accreditation?.id) {
      // Try to find the most recent accreditation in the database
      const recentAccreditation = await sqliteService.db.get(
        `SELECT accreditation_id FROM trust_accreditations 
         WHERE registry_id = ? AND subject_id = ? 
         ORDER BY created_at DESC LIMIT 1`,
        [resources.issuerRegistry, resources.subjectDID]
      );
      
      if (recentAccreditation) {
        if (!resources.accreditation) {
          resources.accreditation = {};
        }
        resources.accreditation.id = recentAccreditation.accreditation_id;
        logger.info(`Found accreditation ID from database: ${resources.accreditation.id}`);
      } else {
        logger.warn('Could not find accreditation ID in database');
      }
    }
    
    const verificationOptions = {
      did: resources.subjectDID,
      verifyStatus: true
    };
    
    // Add accreditation ID if available
    if (resources.accreditation?.id) {
      verificationOptions.accreditationId = resources.accreditation.id;
    }
    
    const verificationResult = await trustRegistryService.verifyAccreditation(verificationOptions);
    
    logger.info(`Verification result: ${JSON.stringify(verificationResult)}`);
    
    return verificationResult;
  } catch (error) {
    logger.error('Failed to verify accreditation', { error: error.message });
    throw error;
  }
}

/**
 * Suspend the accreditation
 */
async function suspendAccreditation() {
  try {
    logger.info('Step 5: Suspending accreditation');
    
    // Make sure we have an accreditation ID
    if (!resources.accreditation?.id) {
      logger.error('Cannot suspend: Missing accreditation ID');
      throw new Error('Missing accreditation ID for suspension');
    }
    
    const suspensionOptions = {
      accreditationId: resources.accreditation.id,
      reason: 'Test suspension'
    };
    
    const suspensionResult = await trustRegistryService.suspendAccreditation(suspensionOptions);
    
    logger.info(`Suspension result: ${JSON.stringify(suspensionResult)}`);
    
    return suspensionResult;
  } catch (error) {
    logger.error('Failed to suspend accreditation', { error: error.message });
    throw error;
  }
}

/**
 * Verify the suspended accreditation
 */
async function verifySuspendedAccreditation() {
  try {
    logger.info('Step 6: Verifying suspended accreditation');
    
    // Make sure we have an accreditation ID
    if (!resources.accreditation?.id) {
      logger.error('Cannot verify: Missing accreditation ID');
      throw new Error('Missing accreditation ID for verification');
    }
    
    const verificationOptions = {
      accreditationId: resources.accreditation.id,
      did: resources.subjectDID,
      verifyStatus: true
    };
    
    const verificationResult = await trustRegistryService.verifyAccreditation(verificationOptions);
    
    logger.info(`Suspended verification result: ${JSON.stringify(verificationResult)}`);
    
    return verificationResult;
  } catch (error) {
    logger.error('Failed to verify suspended accreditation', { error: error.message });
    throw error;
  }
}

/**
 * Reinstate the accreditation
 */
async function reinstateAccreditation() {
  try {
    logger.info('Step 7: Reinstating accreditation');
    
    // Make sure we have an accreditation ID
    if (!resources.accreditation?.id) {
      logger.error('Cannot reinstate: Missing accreditation ID');
      throw new Error('Missing accreditation ID for reinstatement');
    }
    
    const reinstatementOptions = {
      accreditationId: resources.accreditation.id,
      reason: 'Test reinstatement'
    };
    
    const reinstatementResult = await trustRegistryService.reinstateAccreditation(reinstatementOptions);
    
    logger.info(`Reinstatement result: ${JSON.stringify(reinstatementResult)}`);
    
    return reinstatementResult;
  } catch (error) {
    logger.error('Failed to reinstate accreditation', { error: error.message });
    throw error;
  }
}

/**
 * Verify the reinstated accreditation
 */
async function verifyReinstatedAccreditation() {
  try {
    logger.info('Step 8: Verifying reinstated accreditation');
    
    // Make sure we have an accreditation ID
    if (!resources.accreditation?.id) {
      logger.error('Cannot verify: Missing accreditation ID');
      throw new Error('Missing accreditation ID for verification');
    }
    
    const verificationOptions = {
      accreditationId: resources.accreditation.id,
      did: resources.subjectDID,
      verifyStatus: true
    };
    
    const verificationResult = await trustRegistryService.verifyAccreditation(verificationOptions);
    
    logger.info(`Reinstated verification result: ${JSON.stringify(verificationResult)}`);
    
    return verificationResult;
  } catch (error) {
    logger.error('Failed to verify reinstated accreditation', { error: error.message });
    throw error;
  }
}

/**
 * Revoke the accreditation
 */
async function revokeAccreditation() {
  try {
    logger.info('Step 9: Revoking accreditation');
    
    // Make sure we have an accreditation ID
    if (!resources.accreditation?.id) {
      logger.error('Cannot revoke: Missing accreditation ID');
      throw new Error('Missing accreditation ID for revocation');
    }
    
    const revocationOptions = {
      accreditationId: resources.accreditation.id,
      reason: 'Test revocation'
    };
    
    const revocationResult = await trustRegistryService.revokeAccreditation(revocationOptions);
    
    logger.info(`Revocation result: ${JSON.stringify(revocationResult)}`);
    
    return revocationResult;
  } catch (error) {
    logger.error('Failed to revoke accreditation', { error: error.message });
    throw error;
  }
}

/**
 * Verify the revoked accreditation
 */
async function verifyRevokedAccreditation() {
  try {
    logger.info('Step 10: Verifying revoked accreditation');
    
    // Make sure we have an accreditation ID
    if (!resources.accreditation?.id) {
      logger.error('Cannot verify: Missing accreditation ID');
      throw new Error('Missing accreditation ID for verification');
    }
    
    const verificationOptions = {
      accreditationId: resources.accreditation.id,
      did: resources.subjectDID,
      verifyStatus: true
    };
    
    const verificationResult = await trustRegistryService.verifyAccreditation(verificationOptions);
    
    logger.info(`Revoked verification result: ${JSON.stringify(verificationResult)}`);
    
    return verificationResult;
  } catch (error) {
    logger.error('Failed to verify revoked accreditation', { error: error.message });
    throw error;
  }
}

/**
 * Ensure the registry_authorizations table exists
 */
async function ensureRequiredTables() {
  try {
    // Ensure registry_authorizations table exists
    await sqliteService.db.exec(`
      CREATE TABLE IF NOT EXISTS registry_authorizations (
        authorization_id TEXT PRIMARY KEY,
        registry_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        permission TEXT NOT NULL,
        credential_type TEXT,
        data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        FOREIGN KEY (registry_id) REFERENCES trust_registries(registry_id)
      )
    `);
    
    logger.info('Ensured required database tables exist');
  } catch (error) {
    logger.error('Failed to ensure required tables', { error: error.message });
  }
}

/**
 * Save test results to a file
 */
async function saveTestResults(results) {
  try {
    const filename = path.join(
      config.testOutputDir, 
      `trust-registry-master-test-${new Date().toISOString().replace(/:/g, '-')}.json`
    );
    
    await fs.promises.writeFile(
      filename,
      JSON.stringify(results, null, 2)
    );
    
    logger.info(`Test results saved to: ${filename}`);
  } catch (error) {
    logger.error('Failed to save test results', { error: error.message });
  }
}

/**
 * Run the Master Trust Registry Test
 */
async function runTest() {
  logger.info('Starting Cheqd Trust Registry Master Test using direct service calls');
  
  try {
    // Ensure services are initialized
    await sqliteService.initialize();
    await cheqdService.ensureInitialized();
    
    // Make sure required tables exist
    await ensureRequiredTables();
    
    // Ensure output directory exists
    ensureOutputDir();
    
    // Create test DIDs first
    await createTestDids();
    
    // Initialize trust registry
    await initializeTrustRegistry();
    
    // Issue an accreditation
    await issueAccreditation();
    
    // Verify the issued accreditation
    const verificationResult = await verifyAccreditation();
    
    // Suspend the accreditation
    await suspendAccreditation();
    
    // Verify the suspended accreditation
    const suspendedVerificationResult = await verifySuspendedAccreditation();
    
    // Reinstate the accreditation
    await reinstateAccreditation();
    
    // Verify the reinstated accreditation
    const reinstatedVerificationResult = await verifyReinstatedAccreditation();
    
    // Revoke the accreditation
    await revokeAccreditation();
    
    // Verify the revoked accreditation
    const revokedVerificationResult = await verifyRevokedAccreditation();
    
    // Collect results
    const testResults = {
      timestamp: new Date().toISOString(),
      resources,
      verificationResults: {
        initial: verificationResult,
        suspended: suspendedVerificationResult,
        reinstated: reinstatedVerificationResult,
        revoked: revokedVerificationResult
      }
    };
    
    // Save results to file
    await saveTestResults(testResults);
    
    logger.info('Trust Registry Master Test completed successfully');
    return testResults;
  } catch (error) {
    logger.error('Test failed', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    // Clean up
    await sqliteService.close();
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  runTest().catch(error => {
    logger.error('Unexpected error', { error: error.message });
    process.exit(1);
  });
}

module.exports = {
  runTest
}; 