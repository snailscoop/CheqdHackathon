/**
 * Error Handler
 * 
 * Utilities for handling errors consistently throughout the application.
 */

const logger = require('./logger');
const { 
  ApplicationError, 
  ValidationError,
  AuthorizationError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ExternalServiceError,
  DatabaseError
} = require('./errors');

/**
 * Handle errors in a consistent way
 * @param {Error} error - The error to handle
 * @param {Object} context - Context information
 * @returns {Object} - Standardized error response
 */
function handleError(error, context = {}) {
  // Log the error with context
  logError(error, context);
  
  // Generate a standardized response
  return formatErrorResponse(error);
}

/**
 * Log an error with appropriate level and context
 * @param {Error} error - The error to log
 * @param {Object} context - Additional context
 */
function logError(error, context = {}) {
  const { userId, chatId, functionName, operation } = context;
  
  const errorContext = {
    ...context,
    errorName: error.name,
    errorCode: error.code,
    stack: error.stack
  };

  // Use appropriate log level based on error type
  if (error instanceof ValidationError) {
    logger.warn(`Validation error: ${error.message}`, errorContext);
  } else if (error instanceof NotFoundError) {
    logger.info(`Not found: ${error.message}`, errorContext);
  } else if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    logger.warn(`Auth error: ${error.message}`, {
      ...errorContext,
      userId,
      chatId
    });
  } else if (error instanceof RateLimitError) {
    logger.warn(`Rate limit exceeded: ${error.message}`, {
      ...errorContext,
      userId,
      limitInfo: error.limitInfo
    });
  } else if (error instanceof ExternalServiceError) {
    logger.error(`External service error: ${error.message}`, {
      ...errorContext,
      service: error.service,
      originalError: error.originalError
    });
  } else if (error instanceof DatabaseError) {
    logger.error(`Database error: ${error.message}`, {
      ...errorContext,
      operation: error.operation,
      originalError: error.originalError
    });
  } else if (error instanceof ApplicationError) {
    logger.error(`Application error: ${error.message}`, errorContext);
  } else {
    // Unknown error type
    logger.error(`Unexpected error: ${error.message}`, {
      ...errorContext,
      error: error.toString()
    });
  }
}

/**
 * Format error for consistent API responses
 * @param {Error} error - The error to format
 * @returns {Object} - Formatted error response
 */
function formatErrorResponse(error) {
  const statusCode = error.statusCode || 500;
  
  // Basic error response
  const errorResponse = {
    success: false,
    error: {
      message: error.message || 'An unexpected error occurred',
      code: error.code || 'UNKNOWN_ERROR'
    },
    statusCode
  };
  
  // Add additional context based on error type
  if (error instanceof ValidationError && error.field) {
    errorResponse.error.field = error.field;
  } else if (error instanceof NotFoundError && error.resource) {
    errorResponse.error.resource = error.resource;
  } else if (error instanceof ExternalServiceError && error.service) {
    errorResponse.error.service = error.service;
  }
  
  // Sanitize response in production
  if (process.env.NODE_ENV === 'production') {
    // Don't expose internal details in production
    if (statusCode >= 500) {
      errorResponse.error.message = 'An internal server error occurred';
    }
    
    // Remove potentially sensitive information
    delete errorResponse.error.stack;
    delete errorResponse.error.originalError;
  } else {
    // Include stack trace in development
    errorResponse.error.stack = error.stack;
  }
  
  return errorResponse;
}

/**
 * Async error handler for promise rejections
 * @param {Function} fn - Async function to wrap
 * @returns {Function} - Wrapped function that handles errors
 */
function asyncErrorHandler(fn) {
  return async function(req, res, next) {
    try {
      await fn(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Safely execute a function and handle any errors
 * @param {Function} fn - Function to execute
 * @param {Object} context - Error context
 * @param {*} defaultValue - Default value to return on error
 * @returns {*} - Result of function or default value
 */
function tryCatch(fn, context = {}, defaultValue = null) {
  try {
    return fn();
  } catch (error) {
    logError(error, context);
    return defaultValue;
  }
}

/**
 * Safely execute an async function and handle any errors
 * @param {Function} fn - Async function to execute
 * @param {Object} context - Error context
 * @param {*} defaultValue - Default value to return on error
 * @returns {Promise<*>} - Result of function or default value
 */
async function tryCatchAsync(fn, context = {}, defaultValue = null) {
  try {
    return await fn();
  } catch (error) {
    logError(error, context);
    return defaultValue;
  }
}

/**
 * Convert an error to an ApplicationError
 * @param {Error} error - Original error
 * @param {String} message - Optional message
 * @param {String} code - Error code
 * @returns {ApplicationError} - Converted error
 */
function toApplicationError(error, message, code = 'INTERNAL_ERROR') {
  if (error instanceof ApplicationError) {
    return error;
  }
  
  const appError = new ApplicationError(
    message || error.message || 'An unexpected error occurred',
    code,
    500
  );
  
  appError.originalError = error;
  appError.stack = error.stack;
  
  return appError;
}

/**
 * Create a timeout promise that rejects after a specified time
 * @param {Number} ms - Timeout in milliseconds
 * @param {String} operation - Operation name for error message
 * @returns {Promise} - Promise that rejects after timeout
 */
function createTimeout(ms, operation = 'Operation') {
  const { TimeoutError } = require('./errors');
  
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(`${operation} timed out after ${ms}ms`, operation, ms));
    }, ms);
  });
}

/**
 * Execute a function with a timeout
 * @param {Promise} promise - Promise to execute
 * @param {Number} timeoutMs - Timeout in milliseconds
 * @param {String} operation - Operation name
 * @returns {Promise} - Promise with timeout
 */
function withTimeout(promise, timeoutMs, operation = 'Operation') {
  return Promise.race([
    promise,
    createTimeout(timeoutMs, operation)
  ]);
}

module.exports = {
  handleError,
  logError,
  formatErrorResponse,
  asyncErrorHandler,
  tryCatch,
  tryCatchAsync,
  toApplicationError,
  createTimeout,
  withTimeout
}; 