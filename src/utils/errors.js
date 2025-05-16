/**
 * Error Definitions
 * 
 * Custom error classes for the application.
 */

/**
 * Base application error
 */
class ApplicationError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || 'INTERNAL_ERROR';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error for invalid or missing input
 */
class ValidationError extends ApplicationError {
  constructor(message, field) {
    super(message, 'VALIDATION_ERROR', 400);
    this.field = field;
  }
}

/**
 * Error for unauthorized operations
 */
class AuthorizationError extends ApplicationError {
  constructor(message) {
    super(message || 'You are not authorized to perform this action', 'UNAUTHORIZED', 401);
  }
}

/**
 * Error for authentication failures
 */
class AuthenticationError extends ApplicationError {
  constructor(message) {
    super(message || 'Authentication failed', 'AUTHENTICATION_FAILED', 401);
  }
}

/**
 * Error for requested resources not found
 */
class NotFoundError extends ApplicationError {
  constructor(message, resource) {
    super(message || `${resource || 'Resource'} not found`, 'NOT_FOUND', 404);
    this.resource = resource;
  }
}

/**
 * Error for rate limit exceeded
 */
class RateLimitError extends ApplicationError {
  constructor(message, limitInfo) {
    super(message || 'Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429);
    this.limitInfo = limitInfo;
  }
}

/**
 * Error for external service failures
 */
class ExternalServiceError extends ApplicationError {
  constructor(message, service, originalError) {
    super(message || `${service || 'External service'} error`, 'EXTERNAL_SERVICE_ERROR', 502);
    this.service = service;
    this.originalError = originalError;
  }
}

/**
 * Error for database operations
 */
class DatabaseError extends ApplicationError {
  constructor(message, operation, originalError) {
    super(message || `Database operation failed: ${operation}`, 'DATABASE_ERROR', 500);
    this.operation = operation;
    this.originalError = originalError;
  }
}

/**
 * Error for configuration issues
 */
class ConfigurationError extends ApplicationError {
  constructor(message, configKey) {
    super(message || `Configuration error${configKey ? ` for ${configKey}` : ''}`, 'CONFIGURATION_ERROR', 500);
    this.configKey = configKey;
  }
}

/**
 * Error for blockchain-related issues
 */
class BlockchainError extends ApplicationError {
  constructor(message, chain, txHash) {
    super(message || 'Blockchain operation failed', 'BLOCKCHAIN_ERROR', 500);
    this.chain = chain;
    this.txHash = txHash;
  }
}

/**
 * Error for credential operations
 */
class CredentialError extends ApplicationError {
  constructor(message, credentialId) {
    super(message || 'Credential operation failed', 'CREDENTIAL_ERROR', 400);
    this.credentialId = credentialId;
  }
}

/**
 * Error for invalid or unverified credentials
 */
class CredentialVerificationError extends CredentialError {
  constructor(message, credentialId, reason) {
    super(message || 'Credential verification failed', credentialId);
    this.code = 'CREDENTIAL_VERIFICATION_ERROR';
    this.reason = reason;
  }
}

/**
 * Error for temporal constraints violation
 */
class TimeoutError extends ApplicationError {
  constructor(message, operation, timeoutMs) {
    super(message || `Operation timed out: ${operation}`, 'TIMEOUT_ERROR', 408);
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Error for API limits
 */
class ApiLimitError extends ApplicationError {
  constructor(message, service) {
    super(message || `API limit reached${service ? ` for ${service}` : ''}`, 'API_LIMIT_ERROR', 429);
    this.service = service;
  }
}

/**
 * Error for user-related issues
 */
class UserError extends ApplicationError {
  constructor(message, userId) {
    super(message || 'User operation failed', 'USER_ERROR', 400);
    this.userId = userId;
  }
}

module.exports = {
  ApplicationError,
  ValidationError,
  AuthorizationError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ExternalServiceError,
  DatabaseError,
  ConfigurationError,
  BlockchainError,
  CredentialError,
  CredentialVerificationError,
  TimeoutError,
  ApiLimitError,
  UserError
}; 