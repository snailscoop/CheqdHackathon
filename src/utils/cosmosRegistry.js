/**
 * Cosmos Chain Registry Utilities
 * 
 * This module provides utilities for fetching chain information from the Cosmos Chain Registry
 * https://github.com/cosmos/chain-registry
 */

const axios = require('axios');
const logger = require('./logger');

// Cache registry data to avoid repeated fetches
const chainRegistryCache = new Map();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

/**
 * Get chain information from the Cosmos Chain Registry
 * @param {string} chainName - The name of the chain (e.g., "stargaze", "osmosis")
 * @returns {Promise<Object>} - Chain information
 */
async function getChainInfo(chainName) {
  try {
    // Check cache first
    const cacheKey = `chain-info-${chainName}`;
    const cachedData = chainRegistryCache.get(cacheKey);
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
      logger.debug('Using cached chain info', { chainName });
      return cachedData.data;
    }

    // Fetch from GitHub if not in cache
    const url = `https://raw.githubusercontent.com/cosmos/chain-registry/master/${chainName}/chain.json`;
    logger.info('Fetching chain info from registry', { chainName, url });
    
    const response = await axios.get(url);
    
    if (response.status !== 200) {
      throw new Error(`Failed to fetch chain info: ${response.statusText}`);
    }
    
    // Cache the result
    chainRegistryCache.set(cacheKey, {
      data: response.data,
      timestamp: Date.now()
    });
    
    return response.data;
  } catch (error) {
    logger.error('Error fetching chain info', { 
      chainName,
      error: error.message 
    });
    throw new Error(`Failed to fetch chain info for ${chainName}: ${error.message}`);
  }
}

/**
 * Get a REST API endpoint for a specific chain
 * @param {string} chainName - The name of the chain (e.g., "stargaze", "osmosis")
 * @returns {Promise<string>} - REST API endpoint URL
 */
async function getRestEndpoint(chainName) {
  try {
    const chainInfo = await getChainInfo(chainName);
    
    if (!chainInfo.apis || !chainInfo.apis.rest || chainInfo.apis.rest.length === 0) {
      throw new Error(`No REST API endpoints found for ${chainName}`);
    }
    
    // Find a working endpoint
    for (const endpoint of chainInfo.apis.rest) {
      if (endpoint.address) {
        // Remove trailing slash if present
        return endpoint.address.endsWith('/') 
          ? endpoint.address.slice(0, -1) 
          : endpoint.address;
      }
    }
    
    throw new Error(`No valid REST endpoint found for ${chainName}`);
  } catch (error) {
    logger.error('Error getting REST endpoint', { 
      chainName, 
      error: error.message 
    });
    
    // Return fallback endpoints for common chains if registry fetch fails
    const fallbackEndpoints = {
      'stargaze': 'https://lcd-stargaze.keplr.app',
      'cosmoshub': 'https://lcd-cosmoshub.keplr.app',
      'osmosis': 'https://lcd-osmosis.keplr.app',
      'juno': 'https://lcd-juno.keplr.app',
      'akash': 'https://api-akash-ia.cosmosia.notional.ventures',
      'secret': 'https://lcd.secret.express',
      'jackal': 'https://rest.jackalprotocol.io',
      'neutron': 'https://rest-neutron.ecostake.com',
      'omniflix': 'https://rest.omniflix.nodestake.top',
      'cheqd': 'https://api.cheqd.net',
      'persistence': 'https://rest.cosmos.directory/persistence',
      'evmos': 'https://rest.cosmos.directory/evmos',
      'injective': 'https://lcd.injective.network',
      'sei': 'https://rest-sei.ecostake.com',
      'kujira': 'https://lcd-kujira.whispernode.com',
      'stride': 'https://stride-api.polkachu.com',
      'quicksilver': 'https://quicksilver-api.polkachu.com',
      'comdex': 'https://rest.comdex.one'
    };
    
    if (fallbackEndpoints[chainName]) {
      logger.info('Using fallback endpoint', { 
        chainName, 
        endpoint: fallbackEndpoints[chainName] 
      });
      return fallbackEndpoints[chainName];
    }
    
    throw error;
  }
}

/**
 * Convert chain ID to chain name for registry lookup
 * @param {string} chainId - Chain ID (e.g., "stargaze-1", "cosmoshub-4")
 * @returns {string} - Chain name for registry
 */
function chainIdToName(chainId) {
  // Map of chain IDs that don't follow the simple pattern
  const specialChainIds = {
    'secret-4': 'secret',
    'secretnetwork-1': 'secret',
    'jklnet-1': 'jackal',
    'omniflixhub-1': 'omniflix',
    'neutron-1': 'neutron',
    'akashnet-2': 'akash',
    'evmos_9001-2': 'evmos',
    'injective-1': 'injective',
    'pacific-1': 'sei',
    'kaiyo-1': 'kujira',
    'stride-1': 'stride',
    'quicksilver-2': 'quicksilver',
    'comdex-1': 'comdex',
    'core-1': 'persistence'
  };

  // Check special mapping first
  if (specialChainIds[chainId]) {
    return specialChainIds[chainId];
  }

  // Remove network identifier from chain ID
  const parts = chainId.split('-');
  return parts[0].toLowerCase();
}

module.exports = {
  getChainInfo,
  getRestEndpoint,
  chainIdToName
}; 