/**
 * Trust Registry Initialization
 * 
 * This module initializes the trust registry hierarchy when the bot starts.
 * It ensures that the necessary registries are created if they don't exist,
 * and performs validation of the trust chain.
 */

const logger = require('../../utils/logger');
const config = require('../../config/config');
const cheqdService = require('../../services/cheqdService');
const sqliteService = require('../../db/sqliteService');
const trustRegistryService = require('./trustRegistryService');
const trustChainService = require('./trustChainService');

/**
 * Initialize the trust registry hierarchy with improved error handling
 * @param {Object} options - Initialization options
 * @returns {Promise<Object>} - Initialization results
 */
async function initializeTrustRegistry(options = {}) {
  try {
    logger.info('Initializing trust registry hierarchy');
    
    // Initialize services with timeout protection and retry
    try {
      await _retryWithBackoff(async () => {
        return Promise.race([
          cheqdService.initialize(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Cheqd service initialization timed out')), 180000)
          )
        ]);
      }, 3, 'Cheqd service initialization');
      
      logger.info('Cheqd service initialized successfully');
    } catch (initError) {
      logger.warn('Cheqd service initialization failed after retries', { error: initError.message });
      // Continue anyway - we'll try to work with limited functionality
    }
    
    try {
      logger.info('Initializing trust registry service');
      await _retryWithBackoff(async () => {
        return Promise.race([
          trustRegistryService.initialize(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Trust registry service initialization timed out')), 180000)
          )
        ]);
      }, 3, 'Trust registry service initialization');
      
      logger.info('Trust registry service initialized successfully');
    } catch (initError) {
      logger.warn('Trust registry service initialization failed after retries', { error: initError.message });
      // Continue anyway - we'll try to work with limited functionality
    }
    
    // Check for existing root registry
    let rootRegistry = null;
    
    // Detect if we're in first-boot initialization mode
    const configRootRegistryId = config.cheqd?.rootRegistryId;
    const envRootRegistryId = process.env.CHEQD_ROOT_REGISTRY_ID;
    
    const isFirstBoot = (!configRootRegistryId || configRootRegistryId === '') && 
                       (!envRootRegistryId || envRootRegistryId === '');
                       
    if (isFirstBoot) {
      logger.info('First boot detected: rootRegistryId is empty, will create new registry structure');
    } else {
      logger.info('Using existing registry IDs from config or environment');
      // Use environment variables if available
      if (envRootRegistryId) {
        config.cheqd = config.cheqd || {};
        config.cheqd.rootRegistryId = envRootRegistryId;
        config.cheqd.rootDid = process.env.CHEQD_ROOT_DID;
      }
    }
    
    // Create or use existing registries
    try {
      // If not first boot, try to load existing registry from database
      if (!isFirstBoot) {
        const rootId = config.cheqd.rootRegistryId;
        const rootDid = config.cheqd.rootDid;
        
        if (rootId) {
          rootRegistry = await trustRegistryService.getRegistry(rootId);
          
          if (rootRegistry) {
            logger.info('Loaded existing root registry from database', { 
              id: rootRegistry.id,
              did: rootRegistry.did || rootDid
            });
            
            // Update DID if it exists in config but not in registry
            if (rootDid && !rootRegistry.did) {
              await trustRegistryService.createOrUpdateRegistry({
                ...rootRegistry,
                did: rootDid
              });
              logger.info('Updated root registry with DID from config', { 
                did: rootDid 
              });
              rootRegistry.did = rootDid;
            }
          } else {
            logger.warn('Root registry not found in database, will create it', { id: rootId });
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to load existing root registry from database', {
        error: error.message
      });
      
      // Use config values as fallback after error
      if (config.cheqd.rootRegistryId && config.cheqd.rootDid) {
        logger.info('Using config values as fallback after database error');
        rootRegistry = {
          id: config.cheqd.rootRegistryId,
          did: config.cheqd.rootDid,
          name: options.rootName || 'SNAILS. Trust Registry',
          description: options.rootDescription || 'Root trust registry for SNAILS. ecosystem',
          source: 'config-fallback'
        };
      }
    }
    
    // Create root registry if it doesn't exist
    if (!rootRegistry) {
      try {
        logger.info('Creating SNAILS. root registry');
        
        rootRegistry = await trustRegistryService.createRootRegistry({
          name: options.rootName || 'SNAILS. Trust Registry',
          description: options.rootDescription || 'Root trust registry for SNAILS. ecosystem',
          trustFramework: options.trustFramework || 'https://snails.creator.coop/governance',
          trustFrameworkId: options.trustFrameworkId || 'SNAILS. Governance Framework',
          accreditationType: 'authorise'
        });
        
        logger.info('========= REGISTRY CREATED: ROOT REGISTRY =========');
        logger.info(`ROOT_REGISTRY_ID: ${rootRegistry.id}`);
        logger.info(`ROOT_DID: ${rootRegistry.did}`);
        logger.info('Add these values to your .env file as:');
        logger.info(`CHEQD_ROOT_REGISTRY_ID=${rootRegistry.id}`);
        logger.info(`CHEQD_ROOT_DID=${rootRegistry.did}`);
        logger.info('================================================');
        
        // Store registry ID in config for future use
        config.cheqd = config.cheqd || {};
        config.cheqd.rootRegistryId = rootRegistry.id;
        config.cheqd.rootDid = rootRegistry.did;
      } catch (error) {
        logger.error('Failed to create root registry', { error: error.message });
        
        // If creation failed but we have values, create a fallback object
        if (config.cheqd?.rootRegistryId && config.cheqd.rootDid) {
          logger.info('Using config values as fallback after creation failure');
          rootRegistry = {
            id: config.cheqd.rootRegistryId,
            did: config.cheqd.rootDid,
            name: options.rootName || 'SNAILS. Trust Registry',
            description: options.rootDescription || 'Root trust registry for SNAILS. ecosystem',
            source: 'config-fallback'
          };
        } else {
          // Continue with initialization even if root registry creation fails
          logger.warn('No fallback values available for root registry');
        }
      }
    }
    
    // Create bot identity registry if needed or load it from config if available
    let botRegistry = null;
    
    // Detect if we need to create a bot registry (either first boot or missing ID)
    const configBotRegistryId = config.cheqd?.botRegistryId;
    const envBotRegistryId = process.env.BOT_REGISTRY_ID;
    
    const needsBotRegistry = (!configBotRegistryId || configBotRegistryId === '') && 
                            (!envBotRegistryId || envBotRegistryId === '');
                            
    if (needsBotRegistry) {
      logger.info('Bot registry ID is empty, will create new bot registry');
    } else {
      logger.info('Using existing bot registry ID from config or environment');
      // Use environment variables if available
      if (envBotRegistryId) {
        config.cheqd = config.cheqd || {};
        config.cheqd.botRegistryId = envBotRegistryId;
        config.cheqd.botDid = process.env.BOT_DID;
      }
    }
    
    // Try to load existing bot registry if available
    if (!needsBotRegistry) {
      const botId = config.cheqd.botRegistryId;
      const botDid = config.cheqd.botDid;
      
      if (botId) {
        botRegistry = await trustRegistryService.getRegistry(botId);
        
        if (botRegistry) {
          logger.info('Loaded existing bot registry from database', { 
            id: botRegistry.id,
            did: botRegistry.did || botDid
          });
          
          // Update DID if it exists in config but not in registry
          if (botDid && !botRegistry.did) {
            await trustRegistryService.createOrUpdateRegistry({
              ...botRegistry,
              did: botDid
            });
            logger.info('Updated bot registry with DID from config', { 
              did: botDid 
            });
            botRegistry.did = botDid;
          }
        } else {
          logger.warn('Bot registry not found in database, will create it', { id: botId });
        }
      }
    }
    
    // Create bot registry if not loaded from database or config
    if (!botRegistry && rootRegistry) {
      try {
        logger.info('Creating bot identity registry');
        
        botRegistry = await trustRegistryService.createBotIdentityRegistry({
          name: options.botName || 'Dail Bot Identity Registry',
          description: options.botDescription || 'Identity registry for Dail Bot',
          accreditationType: 'authorise'
        });
        
        logger.info('========= REGISTRY CREATED: BOT REGISTRY =========');
        logger.info(`BOT_REGISTRY_ID: ${botRegistry.id}`);
        logger.info(`BOT_DID: ${botRegistry.did}`);
        logger.info('Add these values to your .env file as:');
        logger.info(`BOT_REGISTRY_ID=${botRegistry.id}`);
        logger.info(`BOT_DID=${botRegistry.did}`);
        logger.info('================================================');
        
        // Store registry ID in config for future use
        config.cheqd = config.cheqd || {};
        config.cheqd.botRegistryId = botRegistry.id;
        config.cheqd.botDid = botRegistry.did;
      } catch (error) {
        logger.error('Failed to create bot identity registry', { error: error.message });
        
        // If creation failed but we have values in config, use them as fallback
        if (config.cheqd?.botRegistryId && config.cheqd.botDid) {
          logger.info('Using config values as fallback after creation failure');
          botRegistry = {
            id: config.cheqd.botRegistryId,
            did: config.cheqd.botDid,
            name: options.botName || 'Dail Bot Identity Registry',
            description: options.botDescription || 'Identity registry for Dail Bot',
            source: 'config-fallback'
          };
        } else {
          // Continue initialization even if bot registry creation fails
          logger.warn('No fallback values available for bot registry');
        }
      }
    }
    
    // Create bot credential if needed and not in fallback mode
    const hasFallbackRegistry = botRegistry && botRegistry.source === 'config-fallback';
    
    // Check for existing credential and accreditation IDs in environment variables
    const envBotCredentialId = process.env.BOT_CREDENTIAL_ID;
    const envBotAccreditationId = process.env.BOT_ACCREDITATION_ID;
    
    // Use existing values if available
    if (envBotCredentialId && envBotAccreditationId) {
      logger.info('Using existing bot credential and accreditation IDs from environment');
      logger.info(`BOT_CREDENTIAL_ID: ${envBotCredentialId}`);
      logger.info(`BOT_ACCREDITATION_ID: ${envBotAccreditationId}`);
      
      // Store in config for internal use
      config.cheqd = config.cheqd || {};
      config.cheqd.botCredentialId = envBotCredentialId;
      config.cheqd.botAccreditationId = envBotAccreditationId;
    }
    // Otherwise create new ones if needed
    else if (botRegistry && (!config.cheqd?.botAccreditationId || config.cheqd.botAccreditationId === '') && !hasFallbackRegistry) {
      try {
        logger.info('Creating bot accreditation');
        
        const botAccreditation = await trustRegistryService.createBotAccreditation({
          botDid: botRegistry.did,
          accreditationType: 'authorise',
          accreditationName: 'botIdentityAccreditation'
        });
        
        if (botAccreditation && botAccreditation.id) {
          logger.info('========= CREDENTIAL CREATED: BOT ACCREDITATION =========');
          logger.info(`BOT_ACCREDITATION_ID: ${botAccreditation.id}`);
          logger.info('Add this value to your .env file as:');
          logger.info(`BOT_ACCREDITATION_ID=${botAccreditation.id}`);
          logger.info('===========================================================');
          
          config.cheqd = config.cheqd || {};
          config.cheqd.botAccreditationId = botAccreditation.id;
        }
      } catch (error) {
        logger.error('Failed to create bot accreditation', { error: error.message });
        
        // If creation failed but we have a value in config, update with informational message
        if (config.cheqd?.botAccreditationId) {
          logger.info('Using existing bot accreditation ID from config', {
            botAccreditationId: config.cheqd.botAccreditationId
          });
        }
      }
    } else if (config.cheqd?.botAccreditationId) {
      logger.info('Using existing bot accreditation ID from config', {
        botAccreditationId: config.cheqd.botAccreditationId
      });
    }
    
    // Initialization can be considered successful even with partial failures
    // as long as the services are able to operate with limited functionality
    const isPartialInitialization = (rootRegistry && !botRegistry) || (!rootRegistry && botRegistry);
    
    if (rootRegistry || botRegistry) {
      logger.info('Trust registry hierarchy initialized' + (isPartialInitialization ? ' with partial success' : ' successfully'));
      
      // If this was first boot, remind the user to update .env
      if (isFirstBoot || needsBotRegistry) {
        logger.info('=======================================================');
        logger.info('IMPORTANT: First boot with new registry values detected');
        logger.info('Please add the generated values to your .env file');
        logger.info('The values are marked with "REGISTRY CREATED" or "CREDENTIAL CREATED" in the logs');
        logger.info('=======================================================');
      }
    
    return {
      root: rootRegistry,
      bot: botRegistry,
        initialized: true,
        partialInitialization: isPartialInitialization,
        usingFallback: !!(rootRegistry?.source === 'config-fallback' || botRegistry?.source === 'config-fallback')
      };
    } else {
      logger.warn('Trust registry hierarchy initialization failed, but continuing with limited functionality');
      
      return {
        initialized: false,
        partialInitialization: true,
        error: 'Failed to initialize any registry'
      };
    }
  } catch (error) {
    logger.error('Failed to initialize trust registry hierarchy', {
      error: error.message,
      stack: error.stack
    });
    
    return {
      initialized: false,
      error: error.message
    };
  }
}

/**
 * Utility function to retry operations with exponential backoff
 * @param {Function} operation - The async operation to retry
 * @param {Number} maxRetries - Maximum number of retries
 * @param {String} operationName - Name of the operation for logging
 * @returns {Promise<any>} - Result of the operation
 * @private
 */
async function _retryWithBackoff(operation, maxRetries = 3, operationName = 'operation') {
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Attempt ${attempt}/${maxRetries} for ${operationName}`);
      return await operation();
    } catch (error) {
      lastError = error;
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 60000); // Max 60 seconds
      
      logger.warn(`Attempt ${attempt}/${maxRetries} for ${operationName} failed, retrying in ${backoffMs/1000}s`, {
        error: error.message
      });
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  throw lastError || new Error(`Failed after ${maxRetries} attempts`);
}

/**
 * Register an issuer in the trust registry
 * @param {String} did - Issuer DID
 * @param {String} name - Issuer name
 * @param {Array} credentialTypes - Credential types to authorize
 * @returns {Promise<Object>} - Registration result
 */
async function registerIssuer(did, name, credentialTypes = []) {
  try {
    logger.info('Registering issuer in trust registry', { did });
    
    // Ensure services are initialized
    await cheqdService.ensureInitialized();
    
    // Find the appropriate registry for the issuer (use bot registry if available)
    const registryId = config.cheqd?.botRegistryId || config.cheqd?.rootRegistryId;
    
    if (!registryId) {
      throw new Error('No trust registry found for issuer registration');
    }
    
    // Register the issuer with cheqdService
    const result = await cheqdService.registerIssuer(did, name, credentialTypes);
    
    if (result) {
      logger.info('Successfully registered issuer in trust registry', { 
        did, 
        credentialTypes: credentialTypes.join(', ') 
      });
    }
    
    return result;
  } catch (error) {
    logger.error('Failed to register issuer', { error: error.message, did });
    throw error;
  }
}

/**
 * Verify if an issuer is trusted for a specific credential
 * @param {String} issuerDid - Issuer DID
 * @param {String} credentialType - Credential type
 * @returns {Promise<Object>} - Verification result
 */
async function verifyTrustedIssuer(issuerDid, credentialType) {
  try {
    // Ensure services are initialized
    await cheqdService.ensureInitialized();
    
    // Check if the issuer is trusted for this credential type
    const isTrusted = await cheqdService.isIssuerTrusted(issuerDid, credentialType);
    
    return {
      trusted: isTrusted,
      issuerDid,
      credentialType,
      verifiedAt: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Failed to verify trusted issuer', { 
      error: error.message,
      issuerDid,
      credentialType
    });
    
    return {
      trusted: false,
      reason: `Verification error: ${error.message}`,
      issuerDid,
      credentialType
    };
  }
}

// Export functions
module.exports = {
  initializeTrustRegistry,
  registerIssuer,
  verifyTrustedIssuer
}; 