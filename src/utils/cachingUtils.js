/**
 * Caching Utilities
 * 
 * SQLite-based caching utilities for efficient data storage and retrieval.
 */

const logger = require('./logger');
const sqliteService = require('../db/sqliteService');
const zlib = require('zlib');
const crypto = require('crypto');
const { tryCatchAsync } = require('./errorHandler');

// Default TTL (Time To Live) in milliseconds
const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes

// Initialize the cache table
async function initializeCache() {
  try {
    await sqliteService.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        expires_at INTEGER,
        created_at INTEGER,
        compression INTEGER DEFAULT 0,
        metadata TEXT
      )
    `);
    
    // Create index on expires_at for efficient cleanup
    await sqliteService.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache(expires_at)
    `);
    
    // Schedule cleanup of expired items
    scheduleCleanup();
    
    logger.info('Cache initialized');
    return true;
  } catch (error) {
    logger.error('Failed to initialize cache', { error: error.message });
    return false;
  }
}

// Schedule periodic cleanup of expired cache items
function scheduleCleanup(intervalMs = 60 * 60 * 1000) { // Default 1 hour
  setInterval(async () => {
    try {
      await cleanupExpiredItems();
    } catch (error) {
      logger.error('Cache cleanup failed', { error: error.message });
    }
  }, intervalMs);
}

// Remove expired items from the cache
async function cleanupExpiredItems() {
  const now = Date.now();
  
  const result = await sqliteService.db.run(
    'DELETE FROM cache WHERE expires_at > 0 AND expires_at < ?',
    [now]
  );
  
  if (result.changes > 0) {
    logger.debug(`Cleaned up ${result.changes} expired cache items`);
  }
  
  return result.changes;
}

// Hash a cache key for consistency
function hashKey(key) {
  if (typeof key !== 'string') {
    key = JSON.stringify(key);
  }
  
  return crypto
    .createHash('sha256')
    .update(key)
    .digest('hex')
    .substring(0, 32);
}

/**
 * Set a value in the cache
 * @param {String} key - Cache key
 * @param {*} value - Value to cache (will be serialized)
 * @param {Object} options - Cache options
 * @param {Number} options.ttl - Time to live in ms (0 for no expiration)
 * @param {Boolean} options.compress - Whether to compress the value
 * @param {Object} options.metadata - Additional metadata to store
 * @returns {Promise<Boolean>} - Success status
 */
async function setCache(key, value, options = {}) {
  const hashedKey = hashKey(key);
  const now = Date.now();
  
  const {
    ttl = DEFAULT_TTL,
    compress = false,
    metadata = null
  } = options;
  
  // Calculate expiration time
  const expiresAt = ttl > 0 ? now + ttl : 0;
  
  try {
    // Serialize value
    let serialized = JSON.stringify(value);
    let compression = 0;
    
    // Compress if enabled and value is larger than 1KB
    if (compress && serialized.length > 1024) {
      const compressed = zlib.gzipSync(Buffer.from(serialized, 'utf8'));
      serialized = compressed.toString('base64');
      compression = 1;
    }
    
    // Store in database
    await sqliteService.db.run(
      `INSERT OR REPLACE INTO cache 
       (key, value, expires_at, created_at, compression, metadata) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        hashedKey,
        serialized,
        expiresAt,
        now,
        compression,
        metadata ? JSON.stringify(metadata) : null
      ]
    );
    
    logger.debug('Set cache', { key: hashedKey, expires: expiresAt > 0 });
    return true;
  } catch (error) {
    logger.warn('Failed to set cache', { key: hashedKey, error: error.message });
    return false;
  }
}

/**
 * Get a value from the cache
 * @param {String} key - Cache key
 * @param {*} defaultValue - Default value if not found
 * @returns {Promise<*>} - Cached value or default
 */
async function getCache(key, defaultValue = null) {
  const hashedKey = hashKey(key);
  const now = Date.now();
  
  try {
    // Query the cache
    const item = await sqliteService.db.get(
      'SELECT * FROM cache WHERE key = ? AND (expires_at = 0 OR expires_at > ?)',
      [hashedKey, now]
    );
    
    if (!item) {
      return defaultValue;
    }
    
    // Decompress if needed
    let value = item.value;
    if (item.compression === 1) {
      try {
        const decompressed = zlib.gunzipSync(Buffer.from(value, 'base64'));
        value = decompressed.toString('utf8');
      } catch (error) {
        logger.warn('Failed to decompress cache value', { 
          key: hashedKey, 
          error: error.message 
        });
        return defaultValue;
      }
    }
    
    // Parse JSON
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.warn('Failed to parse cache value', { 
        key: hashedKey, 
        error: error.message 
      });
      return defaultValue;
    }
  } catch (error) {
    logger.warn('Failed to get cache', { key: hashedKey, error: error.message });
    return defaultValue;
  }
}

/**
 * Remove an item from the cache
 * @param {String} key - Cache key
 * @returns {Promise<Boolean>} - Success status
 */
async function removeCache(key) {
  const hashedKey = hashKey(key);
  
  try {
    const result = await sqliteService.db.run(
      'DELETE FROM cache WHERE key = ?',
      [hashedKey]
    );
    
    return result.changes > 0;
  } catch (error) {
    logger.warn('Failed to remove cache', { key: hashedKey, error: error.message });
    return false;
  }
}

/**
 * Check if a key exists in the cache
 * @param {String} key - Cache key
 * @returns {Promise<Boolean>} - Whether key exists
 */
async function hasCache(key) {
  const hashedKey = hashKey(key);
  const now = Date.now();
  
  try {
    const result = await sqliteService.db.get(
      'SELECT 1 FROM cache WHERE key = ? AND (expires_at = 0 OR expires_at > ?)',
      [hashedKey, now]
    );
    
    return !!result;
  } catch (error) {
    logger.warn('Failed to check cache', { key: hashedKey, error: error.message });
    return false;
  }
}

/**
 * Clear all cache items
 * @returns {Promise<Number>} - Number of items cleared
 */
async function clearCache() {
  try {
    const result = await sqliteService.db.run('DELETE FROM cache');
    return result.changes;
  } catch (error) {
    logger.error('Failed to clear cache', { error: error.message });
    return 0;
  }
}

/**
 * Get cache statistics
 * @returns {Promise<Object>} - Cache stats
 */
async function getCacheStats() {
  try {
    const now = Date.now();
    
    const totalQuery = 'SELECT COUNT(*) as count FROM cache';
    const expiredQuery = 'SELECT COUNT(*) as count FROM cache WHERE expires_at > 0 AND expires_at < ?';
    const validQuery = 'SELECT COUNT(*) as count FROM cache WHERE expires_at = 0 OR expires_at > ?';
    const sizeQuery = 'SELECT SUM(LENGTH(value)) as total_size FROM cache';
    
    const [total, expired, valid, size] = await Promise.all([
      sqliteService.db.get(totalQuery),
      sqliteService.db.get(expiredQuery, [now]),
      sqliteService.db.get(validQuery, [now]),
      sqliteService.db.get(sizeQuery)
    ]);
    
    return {
      total: total?.count || 0,
      expired: expired?.count || 0,
      valid: valid?.count || 0,
      size: size?.total_size || 0
    };
  } catch (error) {
    logger.error('Failed to get cache stats', { error: error.message });
    return {
      total: 0,
      expired: 0,
      valid: 0,
      size: 0,
      error: error.message
    };
  }
}

/**
 * Get cached result from a function if available, otherwise execute and cache
 * @param {String} key - Cache key
 * @param {Function} fn - Function to execute
 * @param {Object} options - Cache options
 * @returns {Promise<*>} - Result
 */
async function getOrSet(key, fn, options = {}) {
  // Try to get from cache first
  const cachedResult = await getCache(key);
  
  if (cachedResult !== null) {
    return cachedResult;
  }
  
  // Execute the function
  const result = await tryCatchAsync(fn, { operation: 'cache_fn_execution' });
  
  // Only cache if result is not null/undefined
  if (result != null) {
    await setCache(key, result, options);
  }
  
  return result;
}

/**
 * Memoize a function with cache
 * @param {Function} fn - Function to memoize
 * @param {Function} keyFn - Function to generate cache key from args
 * @param {Object} options - Cache options
 * @returns {Function} - Memoized function
 */
function memoize(fn, keyFn = JSON.stringify, options = {}) {
  return async function(...args) {
    const key = keyFn(...args);
    return getOrSet(key, () => fn(...args), options);
  };
}

module.exports = {
  initializeCache,
  setCache,
  getCache,
  hasCache,
  removeCache,
  clearCache,
  getCacheStats,
  cleanupExpiredItems,
  getOrSet,
  memoize
}; 