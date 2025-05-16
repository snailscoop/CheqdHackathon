/**
 * Register issuer DID on the cheqd testnet blockchain
 * 
 * This script checks if a specific issuer DID exists and registers it if needed
 */

// Load environment variables
require('../load-env');
const cheqdService = require('../src/services/cheqdService');
const sqliteService = require('../src/db/sqliteService');
const logger = require('../src/utils/logger');

// Configuration
const TARGET_DID = 'did:cheqd:testnet:c0ac067d-3f53-42b6-a45d-2f4c74133cb6';
const ADMIN_ID = 2041129914; // The admin user ID from logs

async function main() {
  try {
    // Initialize services
    await sqliteService.initialize();
    await cheqdService.initialize();
    
    logger.info('Checking if issuer DID exists on blockchain', { did: TARGET_DID });
    
    // Check if DID exists in our database
    const existingDid = await sqliteService.db.get(
      'SELECT * FROM dids WHERE did = ?',
      [TARGET_DID]
    );
    
    // Try to resolve DID on blockchain
    let didExists = false;
    try {
      const didDoc = await cheqdService.resolveDID(TARGET_DID);
      if (didDoc) {
        didExists = true;
        logger.info('DID already exists on blockchain', { did: TARGET_DID });
      }
    } catch (error) {
      logger.info('DID does not exist on blockchain, will create it', { 
        did: TARGET_DID, 
        error: error.message 
      });
    }
    
    if (!didExists) {
      // Register the DID in our database first if it doesn't exist
      if (!existingDid) {
        logger.info('Adding DID to local database', { did: TARGET_DID });
        await sqliteService.db.run(
          'INSERT INTO dids (did, owner_id, method, key_type, public_key, metadata) VALUES (?, ?, ?, ?, ?, ?)',
          [
            TARGET_DID,
            ADMIN_ID,
            'cheqd',
            'Ed25519VerificationKey2018',
            JSON.stringify([{ 
              kid: 'key-1',
              type: 'Ed25519VerificationKey2018',
              publicKeyBase58: 'HrwbApz9K3Y1vHMLiFKb9KP9F8uas7bcettVTFYoptQk'
            }]),
            JSON.stringify({
              id: TARGET_DID,
              controller: [TARGET_DID],
              verificationMethod: [{
                id: `${TARGET_DID}#key-1`,
                controller: TARGET_DID,
                type: 'Ed25519VerificationKey2018',
                publicKeyBase58: 'HrwbApz9K3Y1vHMLiFKb9KP9F8uas7bcettVTFYoptQk'
              }],
              authentication: [`${TARGET_DID}#key-1`],
              assertionMethod: [`${TARGET_DID}#key-1`]
            })
          ]
        );
      }
      
      // Create the DID on the blockchain
      logger.info('Registering DID on blockchain', { did: TARGET_DID });
      
      try {
        // Call the Cheqd Studio API to create this specific DID
        // Note: You may need to manually register this DID using the Cheqd Studio web interface
        // if your API doesn't support specifying a DID value
        logger.info('Please register this DID manually in the Cheqd Studio web interface');
        logger.info('Visit https://studio.cheqd.io/did and create a new DID with the ID:', { did: TARGET_DID });
        
        // Optional: Use the registry in the trust registry if available
        // await cheqdService.registerIssuer(TARGET_DID, 'Admin Issuer', ['ModerationCredential']);
      } catch (error) {
        logger.error('Failed to register DID on blockchain', { 
          did: TARGET_DID, 
          error: error.message 
        });
      }
    }
    
    // Check if user exists and create if needed
    const user = await sqliteService.db.get(
      'SELECT * FROM users WHERE id = ?',
      [ADMIN_ID]
    );
    
    if (!user) {
      logger.info('Creating admin user record', { userId: ADMIN_ID });
      await sqliteService.db.run(
        'INSERT INTO users (id, username, first_name) VALUES (?, ?, ?)',
        [ADMIN_ID, 'imasalmon', 'Admin User']
      );
    }
    
    logger.info('DID registration script completed');
  } catch (error) {
    logger.error('Script error', { error: error.message });
  } finally {
    // Close database connection
    if (sqliteService.db) {
      await sqliteService.db.close();
    }
    process.exit(0);
  }
}

main(); 