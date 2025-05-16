/**
 * Credential NLP Service
 * 
 * Natural language processing service for credential-related commands and queries.
 * Helps with conversational interfaces for credential management.
 * 
 * SQLite-based implementation:
 * - Efficient SQLite caching for NLP results
 * - Improved credential ID extraction
 * - Context-aware permission checks
 * - Verbose credential formatting
 * - Rate limiting for API calls
 * - Advanced anti-abuse protections
 */

const logger = require('../../utils/logger');
const zlib = require('zlib');
const crypto = require('crypto');
const path = require('path');
const config = require('../../config/config');
const sqliteService = require('../../db/sqliteService');
const cheqdService = require('../../services/cheqdService');

// Use Bottleneck for rate limiting
const Bottleneck = require('bottleneck');

// Enhanced rate limiter for Cheqd API calls with more restrictive defaults
const cheqdLimiter = new Bottleneck({
  minTime: config.credential?.rateLimiting?.minTime || 200, // Increased from 100ms
  maxConcurrent: config.credential?.rateLimiting?.maxConcurrent || 3, // Decreased from 5
  highWater: config.credential?.rateLimiting?.highWater || 15, // Decreased from 20
  strategy: Bottleneck.strategy.LEAK,
  penalty: config.credential?.rateLimiting?.penalty || 2000 // Penalty time for failed requests
});

// User-specific rate limiters for enhanced control
const userLimiters = new Map();

// Cache TTL from config (default: 30 minutes)
const CACHE_TTL = config.credential?.nlpCacheTTL || 30 * 60 * 1000;

// Anti-abuse tracking
const abuseTracker = {
  suspiciousIPs: new Map(),
  rateLimitedUsers: new Map(),
  // Cleanup tracker periodically (every hour)
  startCleanup: function() {
    setInterval(() => {
      const now = Date.now();
      // Clean up suspiciousIPs older than 24 hours
      for (const [ip, data] of this.suspiciousIPs.entries()) {
        if (now - data.lastActivity > 24 * 60 * 60 * 1000) {
          this.suspiciousIPs.delete(ip);
        }
      }
      // Clean up rateLimitedUsers older than 1 hour
      for (const [userId, data] of this.rateLimitedUsers.entries()) {
        if (now - data.timestamp > 60 * 60 * 1000) {
          this.rateLimitedUsers.delete(userId);
        }
      }
    }, 60 * 60 * 1000); // Run every hour
  },
  // Track potentially abusive request
  trackRequest: function(userId, ipAddress, requestType) {
    // Track by IP
    if (ipAddress) {
      const ipData = this.suspiciousIPs.get(ipAddress) || {
        count: 0,
        lastActivity: Date.now(),
        requestTypes: {}
      };
      
      ipData.count++;
      ipData.lastActivity = Date.now();
      
      // Track request types
      ipData.requestTypes[requestType] = (ipData.requestTypes[requestType] || 0) + 1;
      
      this.suspiciousIPs.set(ipAddress, ipData);
      
      // Log suspicious activity if threshold reached
      if (ipData.count > 50) {
        logger.warn('Suspicious activity from IP', {
          ipAddress,
          requestCount: ipData.count,
          requestTypes: ipData.requestTypes
        });
      }
    }
    
    // Track by user ID
    if (userId) {
      const userData = this.rateLimitedUsers.get(userId) || {
        count: 0,
        timestamp: Date.now(),
        requestTypes: {}
      };
      
      userData.count++;
      userData.timestamp = Date.now();
      
      // Track request types
      userData.requestTypes[requestType] = (userData.requestTypes[requestType] || 0) + 1;
      
      this.rateLimitedUsers.set(userId, userData);
    }
  },
  // Check if request should be blocked
  shouldBlock: function(userId, ipAddress) {
    // Check IP-based blocking
    if (ipAddress) {
      const ipData = this.suspiciousIPs.get(ipAddress);
      if (ipData && ipData.count > 100) {
        return true;
      }
    }
    
    // Check user-based blocking
    if (userId) {
      const userData = this.rateLimitedUsers.get(userId);
      if (userData && userData.count > 50) {
        return true;
      }
    }
    
    return false;
  }
};

// Initialize abuse tracker cleanup
abuseTracker.startCleanup();

/**
 * Get or create a rate limiter for a specific user
 * @param {String} userId - User ID
 * @returns {Bottleneck} - User's rate limiter
 */
function getUserLimiter(userId) {
  if (!userLimiters.has(userId)) {
    // Create a new limiter for this user
    userLimiters.set(userId, new Bottleneck({
      minTime: 500,        // 500ms between requests
      maxConcurrent: 2,     // Max 2 concurrent requests
      reservoir: 20,        // Max 20 requests initially
      reservoirRefreshAmount: 10, // Refill 10 tokens
      reservoirRefreshInterval: 60 * 1000, // every minute
    }));
    
    // Clean up unused limiters after 10 minutes of inactivity
    const limiter = userLimiters.get(userId);
    limiter.on('idle', () => {
      setTimeout(() => {
        if (limiter.counts().RECEIVED === 0 && limiter.counts().QUEUED === 0) {
          userLimiters.delete(userId);
        }
      }, 10 * 60 * 1000);
    });
  }
  
  return userLimiters.get(userId);
}

/**
 * Process natural language credential command
 * @param {String} text - User message text
 * @param {Object} context - Message context (user, chat)
 * @returns {Promise<Object>} - NLP processing result
 */
async function processCredentialCommand(text, context = {}) {
  try {
    // Enhanced security: Track request for abuse detection
    if (context.user?.id && context.ipAddress) {
      abuseTracker.trackRequest(context.user.id, context.ipAddress, 'nlp_credential');
      
      // Check if request should be blocked
      if (abuseTracker.shouldBlock(context.user.id, context.ipAddress)) {
        logger.warn('Blocking abusive request', {
          userId: context.user.id,
          ipAddress: context.ipAddress
        });
        
        return {
          isCredentialOperation: false,
          confidence: 0,
          intent: null,
          entities: {
            error: 'Rate limited due to excessive requests'
          }
        };
      }
      
      // Apply user-specific rate limiting
      const userLimiter = getUserLimiter(context.user.id);
      
      try {
        // Wait for rate limiter clearance with timeout
        await Promise.race([
          userLimiter.schedule(() => Promise.resolve()),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Rate limit timeout')), 5000))
        ]);
      } catch (error) {
        logger.warn('Rate limiting applied', {
          userId: context.user.id,
          error: error.message
        });
        
        return {
          isCredentialOperation: false,
          confidence: 0,
          intent: null,
          entities: {
            error: 'Service temporarily unavailable, please try again later'
          }
        };
      }
    }
    
    // Try to get cached NLP result
    const cached = await getCachedNlpResult(text);
    if (cached) {
      logger.debug('Using cached NLP result', { text });
      return cached;
    }
    
    // Default result
    const result = {
      isCredentialOperation: false,
      confidence: 0,
      intent: null,
      entities: {}
    };
    
    // Enhanced: Look up user's credentials for context if userId is provided
    let userCredentials = [];
    let credentialTypes = [];
    
    if (context.userId) {
      try {
        // Get user DIDs
        const userDids = await getUserDids(context.userId);
        
        if (userDids && userDids.length > 0) {
          // Get credentials for each DID
          for (const didRecord of userDids) {
            const holderCredentials = await sqliteService.db.all(
              `SELECT * FROM credentials WHERE holder_did = ? ORDER BY issued_at DESC LIMIT 10`,
              [didRecord.did]
            );
            
            if (holderCredentials && holderCredentials.length > 0) {
              userCredentials.push(...holderCredentials);
              
              // Extract credential types for context
              holderCredentials.forEach(cred => {
                if (cred.type && !credentialTypes.includes(cred.type)) {
                  credentialTypes.push(cred.type);
                }
              });
            }
          }
        }
        
        // Add credential context to result
        result.entities.availableCredentialTypes = credentialTypes;
        
        logger.debug('Retrieved user credential context', { 
          userId: context.userId,
          credentialCount: userCredentials.length,
          types: credentialTypes 
        });
      } catch (error) {
        logger.warn('Error retrieving user credentials for context', { error: error.message });
      }
    }
    
    // Simple keyword-based intent matching
    const lowerText = text.toLowerCase();
    
    // Dashboard intents
    if (containsAny(lowerText, ['my credentials', 'show credentials', 'credential dashboard', 'view credentials'])) {
      result.isCredentialOperation = true;
      result.intent = 'view_credentials';
      result.confidence = 0.85;
    }
    // Check if user has credentials intent
    else if (containsAny(lowerText, ['do i have any credentials', 'do i have any creds', 'do i have credentials', 'check my credentials', 'are there credentials'])) {
      result.isCredentialOperation = true;
      result.intent = 'view_credentials';
      result.confidence = 0.9;
      // Set a flag to indicate this is a check for credentials rather than dashboard view
      result.entities.checkHasCredentials = true;
    }
    // Renewal intents
    else if (containsAny(lowerText, ['renew credential', 'extend credential', 'update credential'])) {
      result.isCredentialOperation = true;
      result.intent = 'renew_credential';
      result.confidence = 0.8;
      
      // Try to extract credential ID
      const credentialId = await extractCredentialId(text);
      if (credentialId) {
        result.entities.credentialId = credentialId;
      }
      
      // Enhanced: Try to identify specific credential type that needs renewal
      if (credentialTypes.length > 0) {
        for (const credType of credentialTypes) {
          const normalizedType = credType.toLowerCase();
          if (lowerText.includes(normalizedType)) {
            result.entities.credentialType = credType;
            result.confidence = 0.9; // Increase confidence when we match a specific credential type
            break;
          }
        }
      }
    }
    // Revocation check intents
    else if (containsAny(lowerText, ['check revocation', 'is revoked', 'still valid', 'check credential', 'is my credential valid'])) {
      result.isCredentialOperation = true;
      result.intent = 'check_revocation';
      result.confidence = 0.8;
      
      // Try to extract credential ID
      const credentialId = await extractCredentialId(text);
      if (credentialId) {
        result.entities.credentialId = credentialId;
        result.entities.verifyStatus = true; // Explicitly set verifyStatus to true
      } else {
        // Enhanced: Try to identify specific credential type to check
        if (credentialTypes.length > 0) {
          for (const credType of credentialTypes) {
            const normalizedType = credType.toLowerCase();
            if (lowerText.includes(normalizedType)) {
              result.entities.credentialType = credType;
              break;
            }
          }
        }
      }
    }
    // Revocation intents (admin only)
    else if (containsAny(lowerText, ['revoke credential', 'revoke', 'suspend credential'])) {
      result.isCredentialOperation = true;
      result.intent = 'revoke_credential';
      result.confidence = 0.85;
      
      // Try to extract credential ID
      const credentialId = await extractCredentialId(text);
      if (credentialId) {
        result.entities.credentialId = credentialId;
      }
      
      // Check permissions for revocation
      if (context.user) {
        // Try to require the grokService
        try {
          const grokService = require('./grokService');
          const role = await grokService._getUserRole(context.user.id, context.chat?.id);
          
          if (!['admin', 'moderator'].includes(role)) {
            result.intent = null;
            result.isCredentialOperation = false;
            result.confidence = 0;
            result.entities.error = 'Admin privileges required';
          }
        } catch (error) {
          logger.debug('Error accessing GrokService, using default role', { error: error.message });
          // Default to user role if grokService is not available
          result.intent = null;
          result.isCredentialOperation = false;
          result.confidence = 0;
          result.entities.error = 'Admin privileges required';
        }
      }
    }
    // NEW: Enhanced credential details request
    else if (containsAny(lowerText, ['credential details', 'credential info', 'tell me about my credential', 'show my credential', 'credential status'])) {
      result.isCredentialOperation = true;
      result.intent = 'credential_details';
      result.confidence = 0.85;
      
      // Try to extract credential ID
      const credentialId = await extractCredentialId(text);
      if (credentialId) {
        result.entities.credentialId = credentialId;
      } else {
        // Try to identify specific credential type from the text and user's available credentials
        if (credentialTypes.length > 0) {
          for (const credType of credentialTypes) {
            const normalizedType = credType.toLowerCase();
            if (lowerText.includes(normalizedType)) {
              result.entities.credentialType = credType;
              result.confidence = 0.9; // Increase confidence when we match a specific credential type
              break;
            }
          }
        }
      }
    }
    // NEW: Database schema query intent
    else if (containsAny(lowerText, ['credential schema', 'credential structure', 'credential format', 'credential fields', 'credential database'])) {
      result.isCredentialOperation = true;
      result.intent = 'credential_schema';
      result.confidence = 0.85;
      
      // Try to identify specific credential type
      if (credentialTypes.length > 0) {
        for (const credType of credentialTypes) {
          const normalizedType = credType.toLowerCase();
          if (lowerText.includes(normalizedType)) {
            result.entities.credentialType = credType;
            result.confidence = 0.9;
            break;
          }
        }
      }
    }
    
    // Cache the NLP result if it's a credential operation
    if (result.isCredentialOperation && result.confidence > 0.7) {
      await cacheNlpResult(text, result);
    }
    
    return result;
  } catch (error) {
    logger.error('Error processing credential command', { error: error.message });
    return {
      isCredentialOperation: false,
      confidence: 0,
      intent: null,
      entities: {
        error: 'An error occurred processing your request'
      }
    };
  }
}

/**
 * Format credential for display
 * @param {Object} credential - Credential data
 * @param {String} type - Credential type 
 * @param {Boolean} verbose - Whether to show verbose details
 * @returns {Promise<String>} - Formatted text
 */
async function formatCredentialForDisplay(credential, type, verbose = false) {
  try {
    if (!credential) {
      return "I don't have any information about this credential.";
    }
    
    let formatted = '';
    
    // Default formatting for any credential
    formatted = `*${credential.name || 'Credential'} (${type})*\n\n`;
    
    if (credential.issuer) {
      const issuerName = typeof credential.issuer === 'object' 
        ? (credential.issuer.name || credential.issuer.id)
        : credential.issuer;
      formatted += `*Issued by:* ${issuerName}\n`;
    }
    
    if (credential.issuanceDate) {
      formatted += `*Issued on:* ${formatDate(credential.issuanceDate)}\n`;
    }
    
    if (credential.expirationDate) {
      formatted += `*Valid until:* ${formatDate(credential.expirationDate)}\n`;
    }
    
    if (credential.status) {
      formatted += `*Status:* ${credential.status}\n`;
    }
    
    // Type-specific formatting
    if (type === 'support') {
      formatted += `*Support Level:* ${credential.supportLevel || 'Standard'}\n`;
    } else if (type === 'moderator') {
      formatted += `*Moderation Scope:* ${credential.scope || 'General'}\n`;
    } else if (type === 'snails_nft' && credential.nft) {
      formatted += `*NFT Collection:* ${credential.nft.collection}\n`;
      formatted += `*Token ID:* ${credential.nft.tokenId}\n`;
    }
    
    // Add verbose details if requested
    if (verbose) {
      formatted += `\n*Details:*\n`;
      
      if (credential.id) {
        formatted += `- Credential ID: ${credential.id}\n`;
      }
      
      if (credential.credentialSubject && credential.credentialSubject.id) {
        formatted += `- Subject: ${credential.credentialSubject.id}\n`;
      }
      
      if (credential.blockchain_confirmed) {
        formatted += `- Blockchain confirmed: Yes\n`;
      } else if (credential.blockchain_confirmed === false) {
        formatted += `- Blockchain confirmed: No\n`;
      }
      
      if (credential.attributes) {
        formatted += `- Attributes:\n`;
        for (const attr of credential.attributes) {
          formatted += `  • ${attr.name}: ${attr.value}\n`;
        }
      }
    }
    
    return formatted;
  } catch (error) {
    logger.error('Error formatting credential', { error: error.message });
    return "I'm having trouble formatting this credential information.";
  }
}

/**
 * Process a verification question and format response
 * @param {String} credentialId - Credential ID
 * @param {Object} verificationResult - Verification result
 * @returns {Promise<String>} - Formatted response
 */
async function processVerificationQuestion(credentialId, verificationResult) {
  try {
    if (!verificationResult) {
      return `❌ I couldn't verify credential ${credentialId}. The credential may not exist or there was an error with the verification service.`;
    }
    
    // Check if verified
    if (verificationResult.verified) {
      return `✅ Credential ${credentialId} is *valid* and has been verified.\n\n${
        verificationResult.expiration 
          ? `It is valid until *${formatDate(verificationResult.expiration)}*.` 
          : ''
      }`;
    } else {
      let reason = verificationResult.reason || 'Unknown reason';
      
      return `❌ Credential ${credentialId} is *not valid*.\n\nReason: ${reason}`;
    }
  } catch (error) {
    logger.error('Error processing verification question', { error: error.message });
    return "I'm having trouble processing the verification result.";
  }
}

/**
 * Format date for display
 * @param {String} dateString - ISO date string
 * @returns {String} - Formatted date
 */
function formatDate(dateString) {
  if (!dateString) return 'Unknown';
  
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  } catch (error) {
    return dateString;
  }
}

/**
 * Check if text contains any of the given phrases
 * @param {String} text - Text to check
 * @param {Array} phrases - Phrases to look for
 * @returns {Boolean} - Whether any phrase is contained
 */
function containsAny(text, phrases) {
  return phrases.some(phrase => text.includes(phrase));
}

/**
 * Extract credential ID from text with validation
 * @param {String} text - Text to extract from
 * @returns {Promise<String|null>} - Extracted and validated credential ID or null
 */
async function extractCredentialId(text) {
  // Example patterns for credential IDs
  const patterns = [
    /credential[:\s]+([a-zA-Z0-9_-]{8,})/i,
    /id[:\s]+([a-zA-Z0-9_-]{8,})/i,
    /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i, // UUID format
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidateId = match[1];
      
      // Rate-limit and validate with Cheqd
      try {
        const exists = await cheqdLimiter.schedule(async () => {
          return await validateCredentialId(candidateId);
        });
        
        if (exists) {
          return candidateId;
        }
      } catch (error) {
        logger.debug('Error validating credential ID', { 
          id: candidateId, 
          error: error.message 
        });
      }
    }
  }
  
  return null;
}

/**
 * Validate if a credential ID exists in the system
 * @param {String} credentialId - Credential ID to validate
 * @returns {Promise<Boolean>} - Whether the credential exists
 */
async function validateCredentialId(credentialId) {
  try {
    // Query the SQLite database to check if credential exists
    const credential = await sqliteService.db.get(
      'SELECT * FROM credentials WHERE credential_id = ?', 
      [credentialId]
    );
    return !!credential;
  } catch (error) {
    logger.debug('Error validating credential ID', { error: error.message });
    return false;
  }
}

/**
 * Cache NLP result in SQLite
 * @param {String} text - Original text
 * @param {Object} result - NLP result
 * @returns {Promise<void>}
 */
async function cacheNlpResult(text, result) {
  try {
    // Create the nlp_cache table if it doesn't exist
    await sqliteService.db.exec(`
      CREATE TABLE IF NOT EXISTS nlp_cache (
        id TEXT PRIMARY KEY,
        data TEXT,
        timestamp INTEGER
      )
    `);
    
    // Compress result to save space
    let compressed;
    try {
      compressed = zlib.gzipSync(JSON.stringify(result));
    } catch (error) {
      logger.warn('Failed to compress result', { error: error.message });
      return;
    }
    
    // Store in SQLite
    try {
      const hashId = hashText(text);
      await sqliteService.db.run(
        'INSERT OR REPLACE INTO nlp_cache (id, data, timestamp) VALUES (?, ?, ?)',
        [hashId, compressed.toString('base64'), Date.now()]
      );
      
      logger.debug('Cached NLP result', { text: text.substring(0, 20) + '...' });
    } catch (error) {
      logger.warn('Failed to store in SQLite', { error: error.message });
    }
  } catch (error) {
    logger.warn('Failed to cache NLP result', { error: error.message });
    // Continue despite cache error
  }
}

/**
 * Get cached NLP result from SQLite
 * @param {String} text - Original text
 * @returns {Promise<Object|null>} - Cached result or null
 */
async function getCachedNlpResult(text) {
  try {
    // Create the nlp_cache table if it doesn't exist
    await sqliteService.db.exec(`
      CREATE TABLE IF NOT EXISTS nlp_cache (
        id TEXT PRIMARY KEY,
        data TEXT,
        timestamp INTEGER
      )
    `);
    
    // Get cached entry
    const hashId = hashText(text);
    const cached = await sqliteService.db.get(
      'SELECT * FROM nlp_cache WHERE id = ?',
      [hashId]
    );
    
    // Check if cache exists and is not expired
    if (!cached || !cached.data || !cached.timestamp || 
        Date.now() - cached.timestamp > CACHE_TTL) {
      return null;
    }
    
    // Decompress and parse
    try {
      const decompressed = zlib.gunzipSync(Buffer.from(cached.data, 'base64'));
      return JSON.parse(decompressed.toString());
    } catch (error) {
      logger.warn('Failed to decompress or parse cached result', { error: error.message });
      
      // Clean up broken cache entry
      await sqliteService.db.run(
        'DELETE FROM nlp_cache WHERE id = ?',
        [hashId]
      );
      
      return null;
    }
  } catch (error) {
    logger.warn('Error retrieving cached NLP result', { error: error.message });
    return null;
  }
}

/**
 * Generate hash for text
 * @param {String} text - Text to hash
 * @returns {String} - Hash of the text
 */
function hashText(text) {
  return crypto
    .createHash('sha256')
    .update(text.toLowerCase().trim())
    .digest('hex')
    .substring(0, 16);
}

/**
 * Get user DIDs from database
 * @param {string|number} userId - User ID 
 * @returns {Promise<Array>} - Array of DID records
 */
async function getUserDids(userId) {
  try {
    await sqliteService.ensureInitialized();
    const db = sqliteService.db;
    
    const dids = await db.all(
      'SELECT * FROM dids WHERE owner_id = ?',
      [userId]
    );
    
    return dids || [];
  } catch (error) {
    logger.error('Error getting user DIDs', { error: error.message, userId });
    return [];
  }
}

/**
 * Get credential by ID
 * @param {string} credentialId - Credential ID to look up
 * @returns {Promise<Object|null>} - Credential object or null
 */
async function getCredentialById(credentialId) {
  try {
    await sqliteService.ensureInitialized();
    const db = sqliteService.db;
    
    const credential = await db.get(
      'SELECT * FROM credentials WHERE credential_id = ?',
      [credentialId]
    );
    
    if (!credential) {
      return null;
    }
    
    // Parse JSON data if available
    if (credential.data) {
      try {
        credential.parsedData = JSON.parse(credential.data);
      } catch (parseError) {
        logger.warn('Failed to parse credential data', { credentialId });
      }
    }
    
    return credential;
  } catch (error) {
    logger.error('Error getting credential by ID', { error: error.message, credentialId });
    return null;
  }
}

/**
 * Get database schema information for a credential type
 * @param {string} credentialType - Credential type
 * @returns {Promise<Object>} - Schema information
 */
async function getCredentialSchema(credentialType) {
  try {
    await sqliteService.ensureInitialized();
    const db = sqliteService.db;
    
    // Get table info
    const tableInfo = await db.all('PRAGMA table_info(credentials)');
    
    // Get sample credential of this type (if available)
    const sampleCredential = await db.get(
      'SELECT * FROM credentials WHERE type = ? LIMIT 1',
      [credentialType]
    );
    
    // Extract schema details from sample credential
    let dataSchema = {};
    if (sampleCredential && sampleCredential.data) {
      try {
        const parsedData = JSON.parse(sampleCredential.data);
        
        if (parsedData['@context']) {
          dataSchema.context = parsedData['@context'];
        }
        
        if (parsedData.credentialSubject) {
          dataSchema.subjectProperties = Object.keys(parsedData.credentialSubject);
        }
      } catch (parseError) {
        logger.warn('Failed to parse sample credential data', { credentialType });
      }
    }
    
    return {
      tableName: 'credentials',
      columns: tableInfo.map(col => ({
        name: col.name,
        type: col.type
      })),
      dataSchema
    };
  } catch (error) {
    logger.error('Error getting credential schema', { error: error.message, credentialType });
    return {
      tableName: 'credentials',
      columns: [],
      error: error.message
    };
  }
}

module.exports = {
  processCredentialCommand,
  formatCredentialForDisplay,
  processVerificationQuestion,
  validateCredentialId,
  extractCredentialId,
  getUserDids,
  getCredentialById,
  getCredentialSchema
}; 