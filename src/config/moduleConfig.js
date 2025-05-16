/**
 * Module Configuration
 * 
 * Configuration options for all modules (Jackal, Grok, credentials, etc.)
 * This centralizes all module-specific configuration options and provides defaults.
 */

const logger = require('../utils/logger');
const { ConfigurationError } = require('../utils/errors');

// Load and validate environment variables
function getEnvVar(key, defaultValue = undefined, required = false) {
  const value = process.env[key] || defaultValue;
  
  if (required && (value === undefined || value === null)) {
    throw new ConfigurationError(`Required environment variable ${key} is missing`, key);
  }
  
  return value;
}

// Default configuration
const defaultConfig = {
  // Grok configuration - support both OpenAI and Grok API
  grok: {
    // Make OpenAI API key optional, allowing use of Grok instead
    apiKey: getEnvVar('GROK_API_KEY', getEnvVar('OPENAI_API_KEY')),
    baseUrl: getEnvVar('GROK_API_ENDPOINT', getEnvVar('OPENAI_BASE_URL', 'https://api.x.ai/v1')),
    model: getEnvVar('GROK_MODEL', getEnvVar('OPENAI_MODEL', 'grok-3-beta')),
    temperature: parseFloat(getEnvVar('GROK_TEMPERATURE', getEnvVar('OPENAI_TEMPERATURE', '0.7'))),
    maxTokens: parseInt(getEnvVar('GROK_MAX_TOKENS', getEnvVar('OPENAI_MAX_TOKENS', '1500')), 10),
    timeout: parseInt(getEnvVar('GROK_TIMEOUT', getEnvVar('OPENAI_TIMEOUT', '30000')), 10),
    retries: parseInt(getEnvVar('GROK_RETRIES', getEnvVar('OPENAI_RETRIES', '3')), 10)
  },
  
  // Jackal configuration
  jackal: {
    rpcUrl: getEnvVar('JACKAL_RPC_URL', 'https://rpc.jackalprotocol.com'),
    apiUrl: getEnvVar('JACKAL_API_URL', 'https://pinapi.jackalprotocol.com/api'),
    apiKey: getEnvVar('JACKAL_API_KEY'),
    walletMnemonic: getEnvVar('JACKAL_WALLET_MNEMONIC'),
    walletAddress: getEnvVar('JACKAL_WALLET_ADDRESS'),
    pinDirectory: getEnvVar('JACKAL_PIN_DIRECTORY', './data/pins'),
    pollingInterval: parseInt(getEnvVar('JACKAL_POLLING_INTERVAL', '60000'), 10),
    timeout: parseInt(getEnvVar('JACKAL_TIMEOUT', '30000'), 10)
  },
  
  // Cheqd configuration
  cheqd: {
    rpcUrl: getEnvVar('CHEQD_RPC_URL', 'https://api.cheqd.io'),
    apiUrl: getEnvVar('CHEQD_API_URL', getEnvVar('CHEQD_NETWORK_URL', 'https://studio-api.cheqd.net')),
    studioApiKey: getEnvVar('CHEQD_STUDIO_API_KEY'),
    walletMnemonic: getEnvVar('CHEQD_WALLET_MNEMONIC'),
    walletAddress: getEnvVar('CHEQD_WALLET_ADDRESS'),
    networkId: getEnvVar('CHEQD_NETWORK_ID', 'testnet'),
    timeout: parseInt(getEnvVar('CHEQD_TIMEOUT', '30000'), 10),
    didMethod: getEnvVar('CHEQD_DID_METHOD', 'cheqd'),
    gasPrice: getEnvVar('CHEQD_GAS_PRICE', '0.025'),
    gasDenom: getEnvVar('CHEQD_GAS_DENOM', 'ncheq')
  },
  
  // Credential services
  credential: {
    defaultExpiration: getEnvVar('CREDENTIAL_DEFAULT_EXPIRATION', '365d'),
    defaultType: getEnvVar('CREDENTIAL_DEFAULT_TYPE', 'VerifiableCredential'),
    rateLimiting: {
      minTime: parseInt(getEnvVar('CREDENTIAL_RATE_LIMIT_MIN_TIME', '200'), 10),
      maxConcurrent: parseInt(getEnvVar('CREDENTIAL_RATE_LIMIT_MAX_CONCURRENT', '3'), 10),
      highWater: parseInt(getEnvVar('CREDENTIAL_RATE_LIMIT_HIGH_WATER', '15'), 10),
      penalty: parseInt(getEnvVar('CREDENTIAL_RATE_LIMIT_PENALTY', '2000'), 10)
    },
    nlpCacheTTL: parseInt(getEnvVar('CREDENTIAL_NLP_CACHE_TTL', '1800000'), 10) // 30 minutes
  },
  
  // Database configuration
  database: {
    path: getEnvVar('DATABASE_PATH', './data/database.sqlite')
  },
  
  // Cache configuration
  cache: {
    defaultTTL: parseInt(getEnvVar('CACHE_DEFAULT_TTL', '1800000'), 10), // 30 minutes
    cleanupInterval: parseInt(getEnvVar('CACHE_CLEANUP_INTERVAL', '3600000'), 10) // 1 hour
  },
  
  // Integration configuration
  integration: {
    videoProcessingTimeout: parseInt(getEnvVar('VIDEO_PROCESSING_TIMEOUT', '300000'), 10), // 5 minutes
    pollingInterval: parseInt(getEnvVar('INTEGRATION_POLLING_INTERVAL', '5000'), 10) // 5 seconds
  }
};

/**
 * Validate and merge custom configuration with defaults
 * @param {Object} customConfig - Custom configuration to merge
 * @returns {Object} - Complete configuration
 */
function buildConfig(customConfig = {}) {
  // Deep merge custom config with defaults
  const mergeDeep = (target, source) => {
    const output = { ...target };
    
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = mergeDeep(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  };
  
  function isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
  
  const config = mergeDeep(defaultConfig, customConfig);
  
  // Log configuration (without sensitive values)
  const sanitizedConfig = JSON.parse(JSON.stringify(config));
  
  // Remove sensitive information for logging
  if (sanitizedConfig.grok) sanitizedConfig.grok.apiKey = '[REDACTED]';
  if (sanitizedConfig.jackal) {
    sanitizedConfig.jackal.apiKey = '[REDACTED]';
    sanitizedConfig.jackal.walletMnemonic = '[REDACTED]';
  }
  if (sanitizedConfig.cheqd) {
    sanitizedConfig.cheqd.walletMnemonic = '[REDACTED]';
  }
  
  logger.debug('Module configuration loaded', { config: sanitizedConfig });
  
  return config;
}

// Export the configuration builder
module.exports = {
  defaultConfig,
  buildConfig
}; 