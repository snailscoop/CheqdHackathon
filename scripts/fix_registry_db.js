/**
 * Trust Registry Database Fix Script
 * 
 * This script aligns the trust registry database with the environment variables.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const loadEnv = require('./load-env');

// Load environment variables
loadEnv();

// Required environment variables
const requiredEnvVars = [
  'CHEQD_ROOT_REGISTRY_ID',
  'CHEQD_ROOT_DID',
  'BOT_REGISTRY_ID',
  'BOT_DID',
  'BOT_CREDENTIAL_ID',
  'BOT_ACCREDITATION_ID'
];

// Initialize logger
const log = (message) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

// Database path
const dbPath = path.join(__dirname, 'data', 'cheqd-bot.sqlite');

// Connect to database
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error(`Error opening database: ${err.message}`);
    process.exit(1);
  }
  log(`Connected to database at ${dbPath}`);
});

// Main function
async function main() {
  let transactionStarted = false;
  
  try {
    // Validate environment variables
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    // Verify duplicate entries in .env
    let envContent = fs.readFileSync('.env', 'utf8');
    const duplicateEntries = [];
    
    for (const envVar of requiredEnvVars) {
      const matches = envContent.match(new RegExp(`^${envVar}=.*$`, 'gm'));
      if (matches && matches.length > 1) {
        duplicateEntries.push(envVar);
      }
    }
    
    if (duplicateEntries.length > 0) {
      log(`WARNING: Duplicate entries found in .env for: ${duplicateEntries.join(', ')}`);
      log('Fixing .env file...');
      
      // Fix .env file - keep only the last value for each duplicate
      const fixedEnvContent = envContent.split('\n').reduce((acc, line) => {
        const match = line.match(/^([^=]+)=/);
        if (!match) return [...acc, line];
        
        const key = match[1];
        if (duplicateEntries.includes(key)) {
          // Remove existing entry from accumulator if it exists
          acc = acc.filter(l => !l.startsWith(`${key}=`));
        }
        return [...acc, line];
      }, []);
      
      fs.writeFileSync('.env', fixedEnvContent.join('\n'));
      log('Fixed .env file.');
    }

    log('Starting database fixes...');

    // Begin transaction
    await run('BEGIN TRANSACTION');
    transactionStarted = true;

    // Check if root registry exists in the database
    const rootRegistry = await get(
      'SELECT * FROM trust_registries WHERE registry_id = ?',
      [process.env.CHEQD_ROOT_REGISTRY_ID]
    );

    if (!rootRegistry) {
      log(`Root registry with ID ${process.env.CHEQD_ROOT_REGISTRY_ID} not found in database`);
      log('Creating root registry entry...');
      
      await run(
        `INSERT INTO trust_registries (
          registry_id, registry_name, registry_type, parent_id, did, data, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          process.env.CHEQD_ROOT_REGISTRY_ID,
          'SNAILS Trust Registry',
          'ROOT',
          null,
          process.env.CHEQD_ROOT_DID,
          JSON.stringify({
            description: 'Root trust registry for SNAILS ecosystem',
            trustFramework: 'https://snails.creator.coop/governance',
            trustFrameworkId: 'SNAILS Governance Framework',
            accreditationType: 'authorise',
            createdBy: 'system',
            metadata: {}
          })
        ]
      );
      log('Root registry created successfully');
    } else {
      log(`Found existing root registry: ${process.env.CHEQD_ROOT_REGISTRY_ID}`);
      
      // Update DID if different
      if (rootRegistry.did !== process.env.CHEQD_ROOT_DID) {
        log(`Updating root registry DID from ${rootRegistry.did} to ${process.env.CHEQD_ROOT_DID}`);
        await run(
          'UPDATE trust_registries SET did = ?, updated_at = datetime("now") WHERE registry_id = ?',
          [process.env.CHEQD_ROOT_DID, process.env.CHEQD_ROOT_REGISTRY_ID]
        );
      }
    }

    // Check if bot registry exists in the database
    const botRegistry = await get(
      'SELECT * FROM trust_registries WHERE registry_id = ?',
      [process.env.BOT_REGISTRY_ID]
    );

    if (!botRegistry) {
      log(`Bot registry with ID ${process.env.BOT_REGISTRY_ID} not found in database`);
      log('Creating bot registry entry...');
      
      await run(
        `INSERT INTO trust_registries (
          registry_id, registry_name, registry_type, parent_id, did, data, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          process.env.BOT_REGISTRY_ID,
          'Dail Bot Identity Registry',
          'ISSUER',
          process.env.CHEQD_ROOT_REGISTRY_ID,
          process.env.BOT_DID,
          JSON.stringify({
            description: 'Identity registry for Dail Bot',
            accreditationType: 'authorise',
            createdBy: 'system',
            metadata: {
              botType: 'telegram',
              issuanceAuthority: true
            }
          })
        ]
      );
      log('Bot registry created successfully');
    } else {
      log(`Found existing bot registry: ${process.env.BOT_REGISTRY_ID}`);
      
      // Update DID if different
      if (botRegistry.did !== process.env.BOT_DID) {
        log(`Updating bot registry DID from ${botRegistry.did} to ${process.env.BOT_DID}`);
        await run(
          'UPDATE trust_registries SET did = ?, updated_at = datetime("now") WHERE registry_id = ?',
          [process.env.BOT_DID, process.env.BOT_REGISTRY_ID]
        );
      }
      
      // Update parent if different
      if (botRegistry.parent_id !== process.env.CHEQD_ROOT_REGISTRY_ID) {
        log(`Updating bot registry parent from ${botRegistry.parent_id} to ${process.env.CHEQD_ROOT_REGISTRY_ID}`);
        await run(
          'UPDATE trust_registries SET parent_id = ?, updated_at = datetime("now") WHERE registry_id = ?',
          [process.env.CHEQD_ROOT_REGISTRY_ID, process.env.BOT_REGISTRY_ID]
        );
      }
    }

    // Check if bot accreditation exists
    const botAccreditation = await get(
      'SELECT * FROM trust_accreditations WHERE accreditation_id = ?',
      [process.env.BOT_ACCREDITATION_ID.replace('urn:uuid:', '')]
    );

    if (!botAccreditation) {
      log(`Bot accreditation with ID ${process.env.BOT_ACCREDITATION_ID} not found in database`);
      
      // Check for any accreditation with matching subject DID
      const existingAccreditation = await get(
        'SELECT * FROM trust_accreditations WHERE subject_id = ?',
        [process.env.BOT_DID]
      );
      
      if (existingAccreditation) {
        log(`Found existing accreditation for BOT_DID: ${existingAccreditation.accreditation_id}`);
        log(`Updating .env with existing accreditation ID: ${existingAccreditation.accreditation_id}`);
        
        // Update .env with existing accreditation ID
        envContent = fs.readFileSync('.env', 'utf8');
        envContent = envContent.replace(
          /BOT_ACCREDITATION_ID=.*/,
          `BOT_ACCREDITATION_ID=urn:uuid:${existingAccreditation.accreditation_id}`
        );
        fs.writeFileSync('.env', envContent);
        
        log('Updated BOT_ACCREDITATION_ID in .env');
      } else {
        log('No existing accreditation found for BOT_DID');
        log('Creating placeholder accreditation...');
        
        // Create a placeholder accreditation
        const accreditationId = process.env.BOT_ACCREDITATION_ID.replace('urn:uuid:', '');
        
        await run(
          `INSERT INTO trust_accreditations (
            accreditation_id, registry_id, subject_id, type, status, issued_at, 
            data, created_at
          ) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))`,
          [
            accreditationId,
            process.env.CHEQD_ROOT_REGISTRY_ID,
            process.env.BOT_DID,
            'authorise',
            'active',
            JSON.stringify({
              '@context': [
                'https://www.w3.org/2018/credentials/v1',
                'https://schema.org',
                'https://cheqd.io/contexts/accreditation/v1'
              ],
              type: ['VerifiableCredential'],
              id: process.env.BOT_ACCREDITATION_ID,
              issuer: {
                id: process.env.CHEQD_ROOT_DID
              },
              issuanceDate: new Date().toISOString(),
              credentialSubject: {
                id: process.env.BOT_DID,
                accreditationType: 'authorise',
                name: 'botIdentityAccreditation',
                trustFramework: 'https://cheqd.io/governance',
                trustFrameworkId: 'Cheqd Bot Governance Framework'
              },
              proof: {
                type: 'Ed25519Signature2020',
                created: new Date().toISOString(),
                verificationMethod: `${process.env.CHEQD_ROOT_DID}#key-1`,
                proofPurpose: 'assertionMethod',
                proofValue: 'placeholder'
              }
            })
          ]
        );
        
        log('Placeholder accreditation created');
      }
    } else {
      log(`Found existing bot accreditation: ${process.env.BOT_ACCREDITATION_ID}`);
      
      // Check if subject DID matches
      if (botAccreditation.subject_id !== process.env.BOT_DID) {
        log(`Warning: Accreditation subject ID (${botAccreditation.subject_id}) doesn't match BOT_DID (${process.env.BOT_DID})`);
        log('Consider updating your BOT_ACCREDITATION_ID in .env to match a valid accreditation for your BOT_DID');
      }
    }

    // Commit transaction
    if (transactionStarted) {
      await run('COMMIT');
      log('Database fixes committed successfully');
    }

    // Final verification
    await verifyRegistry();

  } catch (error) {
    // Rollback transaction on error
    if (transactionStarted) {
      try {
        await run('ROLLBACK');
        log('Transaction rolled back due to error');
      } catch (rollbackError) {
        console.error(`Error during rollback: ${rollbackError.message}`);
      }
    }
    console.error(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    // Close database connection
    db.close((err) => {
      if (err) {
        console.error(`Error closing database: ${err.message}`);
      } else {
        log('Database connection closed');
      }
    });
  }
}

// Verify registry entries
async function verifyRegistry() {
  log('Verifying registry entries...');
  
  // Check root registry
  const rootRegistry = await get(
    'SELECT * FROM trust_registries WHERE registry_id = ?',
    [process.env.CHEQD_ROOT_REGISTRY_ID]
  );
  
  if (rootRegistry && rootRegistry.did === process.env.CHEQD_ROOT_DID) {
    log('✓ Root registry verified');
  } else {
    log('✗ Root registry verification failed');
  }
  
  // Check bot registry
  const botRegistry = await get(
    'SELECT * FROM trust_registries WHERE registry_id = ?',
    [process.env.BOT_REGISTRY_ID]
  );
  
  if (botRegistry && botRegistry.did === process.env.BOT_DID) {
    log('✓ Bot registry verified');
  } else {
    log('✗ Bot registry verification failed');
  }
  
  // Check accreditation
  const accreditationId = process.env.BOT_ACCREDITATION_ID.replace('urn:uuid:', '');
  const botAccreditation = await get(
    'SELECT * FROM trust_accreditations WHERE accreditation_id = ?',
    [accreditationId]
  );
  
  if (botAccreditation && botAccreditation.subject_id === process.env.BOT_DID) {
    log('✓ Bot accreditation verified');
  } else {
    log('✗ Bot accreditation verification failed');
  }
}

// Helper function to run SQL with Promise interface
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Helper function to get a single row with Promise interface
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Helper function to get all rows with Promise interface
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Run the main function
main().catch(console.error); 