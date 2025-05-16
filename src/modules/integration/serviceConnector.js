/**
 * Service Connector
 * 
 * Integration module to connect various services including Jackal, Grok and credential services.
 * Provides a unified interface for complex operations that involve multiple modules.
 */

const logger = require('../../utils/logger');
const { tryCatchAsync } = require('../../utils/errorHandler');
const cachingUtils = require('../../utils/cachingUtils');

// Import needed services
const grokService = require('../grok/grokService');
const jackalPinService = require('../jackal/jackalPinService');
const cheqdService = require('../../services/cheqdService');

// Trust registry related services
const trustRegistryService = require('../cheqd/trustRegistryService');
const trustRegistryInit = require('../cheqd/trustRegistryInit');
const trustChainService = require('../cheqd/trustChainService');

// Cache TTLs
const CREDENTIAL_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const VIDEO_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const FUNCTION_RESULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Initialize all services
 * @returns {Promise<Boolean>} - Whether initialization succeeded
 */
async function initialize() {
  try {
    logger.info('Initializing service integrations');
    
    // Initialize the cache first
    await cachingUtils.initializeCache();
    
    // Initialize services
    await Promise.all([
      grokService.initialize(),
      cheqdService.initialize()
    ]);
    
    // Initialize trust registry services
    try {
      logger.info('Initializing trust registry service');
      await trustRegistryService.initialize();
      logger.info('Trust registry service initialized successfully');
      
      // Initialize trust registry data
      logger.info('Initializing trust registry data');
      await trustRegistryInit.initializeTrustRegistry();
      logger.info('Trust registry data initialized successfully');
    } catch (error) {
      logger.warn('Trust registry initialization failed, continuing with limited functionality', {
        error: error.message
      });
    }
    
    // Initialize moderation services
    try {
      const moderationService = require('../moderation/moderationService');
      await moderationService.initialize();
      logger.info('Moderation service initialized successfully');
    } catch (error) {
      logger.warn('Moderation service initialization failed, continuing with limited functionality', {
        error: error.message
      });
    }
    
    // The Jackal service doesn't have an explicit initialize method
    
    logger.info('Service integrations initialized successfully');
    return true;
  } catch (error) {
    logger.error('Failed to initialize service integrations', { error: error.message });
    return false;
  }
}

/**
 * Process video and extract credentials
 * This integrates Jackal and credential services
 * 
 * @param {String} videoUrl - URL of the video to process
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Processing result
 */
async function processVideoAndExtractCredentials(videoUrl, options = {}) {
  try {
    logger.info('Processing video and extracting credentials', { videoUrl });
    
    // First, pin the video to Jackal
    const pinResult = await jackalPinService.pinVideo(videoUrl, {
      title: options.title,
      description: options.description || 'Video for credential extraction'
    });
    
    if (!pinResult || !pinResult.success) {
      throw new Error('Failed to pin video to Jackal');
    }
    
    // Wait for video processing and transcription
    const videoId = pinResult.videoId;
    let processingComplete = false;
    let attempts = 0;
    
    while (!processingComplete && attempts < 10) {
      attempts++;
      
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      const status = await jackalPinService.getVideoStatus(videoId);
      processingComplete = status && status.status === 'completed';
      
      logger.debug('Video processing status', { 
        videoId, 
        status: status?.status, 
        attempt: attempts 
      });
    }
    
    if (!processingComplete) {
      throw new Error('Video processing timed out');
    }
    
    // Get the transcription
    const transcription = await jackalPinService.getVideoTranscript(videoId);
    
    if (!transcription) {
      throw new Error('Failed to get video transcription');
    }
    
    // Use Grok to analyze the transcription for potential credentials
    const grokResult = await grokService.processCommand(
      `Analyze this transcription for credential information: ${transcription.substring(0, 1000)}...`,
      { source: 'video_analysis', videoId }
    );
    
    // Extract credentials from Grok result
    let credentials = [];
    
    if (grokResult && grokResult.type === 'credential') {
      // Direct credential operation
      credentials.push(grokResult.result);
    } else if (grokResult && grokResult.type === 'function' && 
              (grokResult.function === 'get_credential' || 
               grokResult.function === 'issue_credential')) {
      // Function call related to credentials
      const credentialResult = await cheqdService.processCredentialFunction(
        grokResult.function,
        grokResult.parameters
      );
      
      if (credentialResult && credentialResult.credential) {
        credentials.push(credentialResult.credential);
      }
    }
    
    return {
      success: true,
      videoId,
      transcription,
      credentials,
      pinResult
    };
  } catch (error) {
    logger.error('Error processing video and extracting credentials', { 
      videoUrl, 
      error: error.message 
    });
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get AI-generated responses for credential questions
 * @param {String} credentialId - Credential ID
 * @param {Array<String>} questions - List of questions
 * @returns {Promise<Object>} - AI responses
 */
async function getCredentialAiResponses(credentialId, questions) {
  try {
    // Get the credential first
    const credential = await cachingUtils.getOrSet(
      `credential:${credentialId}`,
      () => cheqdService.getCredential(credentialId),
      { ttl: CREDENTIAL_CACHE_TTL }
    );
    
    if (!credential) {
      throw new Error(`Credential ${credentialId} not found`);
    }
    
    // Process each question with Grok
    const responses = [];
    
    for (const question of questions) {
      // Create cache key based on question and credential ID
      const cacheKey = `credential_qa:${credentialId}:${question}`;
      
      const response = await cachingUtils.getOrSet(
        cacheKey,
        async () => {
          const grokResult = await grokService.processCommand(
            `Regarding credential ${credentialId}: ${question}`,
            { credential }
          );
          
          if (grokResult.type === 'text') {
            return grokResult.message;
          } else if (grokResult.type === 'credential') {
            return grokResult.result.entities.response || 'No specific answer found.';
          } else {
            return 'Unable to process question.';
          }
        },
        { ttl: FUNCTION_RESULT_CACHE_TTL }
      );
      
      responses.push({
        question,
        answer: response
      });
    }
    
    return {
      success: true,
      credentialId,
      responses
    };
  } catch (error) {
    logger.error('Error getting AI responses for credential questions', { 
      credentialId, 
      error: error.message 
    });
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Find related videos for credential context
 * @param {String} credentialId - Credential ID
 * @returns {Promise<Object>} - Related videos
 */
async function findRelatedVideosForCredential(credentialId) {
  try {
    // Get the credential first
    const credential = await cachingUtils.getOrSet(
      `credential:${credentialId}`,
      () => cheqdService.getCredential(credentialId),
      { ttl: CREDENTIAL_CACHE_TTL }
    );
    
    if (!credential) {
      throw new Error(`Credential ${credentialId} not found`);
    }
    
    // Get relevant search terms based on credential
    const searchTerms = [];
    
    if (credential.name) searchTerms.push(credential.name);
    if (credential.type) searchTerms.push(credential.type);
    if (credential.issuer && typeof credential.issuer === 'string') {
      searchTerms.push(credential.issuer);
    } else if (credential.issuer && credential.issuer.name) {
      searchTerms.push(credential.issuer.name);
    }
    
    // Add additional terms from credential attributes
    if (credential.attributes && Array.isArray(credential.attributes)) {
      for (const attr of credential.attributes) {
        if (attr.name && attr.value && typeof attr.value === 'string') {
          searchTerms.push(attr.value);
        }
      }
    }
    
    // Create search query
    const query = searchTerms.filter(Boolean).join(' ');
    
    if (!query) {
      return {
        success: false,
        error: 'Not enough information to search for videos'
      };
    }
    
    // Search for videos with Jackal
    const videos = await cachingUtils.getOrSet(
      `credential_videos:${credentialId}`,
      () => jackalPinService.searchVideos(query),
      { ttl: VIDEO_CACHE_TTL }
    );
    
    return {
      success: true,
      credentialId,
      searchTerms,
      videos: videos || []
    };
  } catch (error) {
    logger.error('Error finding related videos for credential', { 
      credentialId, 
      error: error.message 
    });
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Execute a cross-service function using Grok
 * @param {String} functionName - Function name to execute
 * @param {Object} parameters - Function parameters
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} - Function result
 */
async function executeFunction(functionName, parameters, context = {}) {
  try {
    logger.debug('Executing cross-service function', { functionName, parameters });
    
    // Check which service should handle this function
    if (functionName.startsWith('pin_') || 
        functionName === 'get_pinned_videos' || 
        functionName === 'search_videos') {
      // Jackal functions
      const jackalResult = await jackalPinService.executeFunction(functionName, parameters);
      
      // Update Grok function call record
      if (context.userId) {
        await grokService.updateFunctionResult(
          context.userId,
          functionName,
          jackalResult,
          !!jackalResult?.success
        );
      }
      
      return jackalResult;
    } else if (functionName.includes('credential') || 
              functionName === 'verify_credential' || 
              functionName === 'issue_credential') {
      // Credential functions
      const credentialResult = await cheqdService.processCredentialFunction(
        functionName,
        parameters
      );
      
      // Update Grok function call record
      if (context.userId) {
        await grokService.updateFunctionResult(
          context.userId,
          functionName,
          credentialResult,
          !!credentialResult?.success
        );
      }
      
      return credentialResult;
    } else if (functionName === 'create_root_registry' || 
              functionName === 'create_bot_identity_registry' ||
              functionName === 'verify_trusted_issuer' ||
              functionName === 'register_credential_type' ||
              functionName === 'get_registry_by_did') {
      // Trust registry functions
      const registryResult = await cheqdService.processTrustRegistryFunction(
        functionName,
        parameters
      );
      
      // Update Grok function call record
      if (context.userId) {
        await grokService.updateFunctionResult(
          context.userId,
          functionName,
          registryResult,
          !!registryResult?.success
        );
      }
      
      return registryResult;
    } else {
      // Let Grok handle other functions
      const grokResult = await grokService.processFunction(
        functionName,
        parameters,
        context
      );
      
      return grokResult;
    }
  } catch (error) {
    logger.error('Error executing cross-service function', { 
      functionName, 
      error: error.message 
    });
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Process message with integrated services
 * @param {String} message - User message
 * @param {Object} context - Message context (user, chat)
 * @returns {Promise<Object>} - Processing result
 */
async function processMessage(message, context = {}) {
  return tryCatchAsync(async () => {
    // First check if credential-related with Grok
    const grokResult = await grokService.processCommand(message, context);
    
    // If credential operation, handle it
    if (grokResult.type === 'credential') {
      const credentialResult = await cheqdService.processCredentialIntent(
        grokResult.result.intent,
        grokResult.result.entities,
        context
      );
      
      return {
        type: 'credential_response',
        result: credentialResult
      };
    }
    
    // If function call, handle it with appropriate service
    if (grokResult.type === 'function') {
      const functionResult = await executeFunction(
        grokResult.function,
        grokResult.parameters,
        context
      );
      
      return {
        type: 'function_response',
        function: grokResult.function,
        result: functionResult
      };
    }
    
    // Otherwise just return the Grok result
    return grokResult;
  }, {
    operation: 'process_message',
    message: message && message.substring(0, 100),
    userId: context.user?.id,
    chatId: context.chat?.id
  }, {
    type: 'error',
    message: 'Sorry, I encountered an error processing your message.'
  });
}

module.exports = {
  initialize,
  processVideoAndExtractCredentials,
  getCredentialAiResponses,
  findRelatedVideosForCredential,
  executeFunction,
  processMessage
}; 