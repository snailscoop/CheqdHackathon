/**
 * Database Wrapper Module
 * 
 * This module provides a unified interface for database operations,
 * wrapping the SQLite service to maintain backward compatibility.
 */

const sqliteService = require('./sqliteService');
const logger = require('../utils/logger');

/**
 * Run a SQL query with parameters
 * @param {string} sql - SQL query to execute
 * @param {Array} params - Parameters for the query
 * @returns {Promise<void>} - Promise that resolves when the query is executed
 */
async function run(sql, params = []) {
  try {
    await sqliteService.ensureInitialized();
    return await sqliteService.db.run(sql, params);
  } catch (error) {
    logger.error('Database run error', { error: error.message, sql: sql.substring(0, 100) });
    throw error;
  }
}

/**
 * Get a single row from the database
 * @param {string} sql - SQL query to execute
 * @param {Array} params - Parameters for the query
 * @returns {Promise<Object>} - Promise that resolves to the first row
 */
async function get(sql, params = []) {
  try {
    await sqliteService.ensureInitialized();
    return await sqliteService.db.get(sql, params);
  } catch (error) {
    logger.error('Database get error', { error: error.message, sql: sql.substring(0, 100) });
    throw error;
  }
}

/**
 * Get multiple rows from the database
 * @param {string} sql - SQL query to execute
 * @param {Array} params - Parameters for the query
 * @returns {Promise<Array>} - Promise that resolves to array of rows
 */
async function all(sql, params = []) {
  try {
    await sqliteService.ensureInitialized();
    return await sqliteService.db.all(sql, params);
  } catch (error) {
    logger.error('Database all error', { error: error.message, sql: sql.substring(0, 100) });
    throw error;
  }
}

/**
 * Execute a SQL statement and return the last inserted ID
 * @param {string} sql - SQL query to execute
 * @param {Array} params - Parameters for the query
 * @returns {Promise<number>} - Promise that resolves to the last inserted ID
 */
async function runAndGetId(sql, params = []) {
  try {
    await sqliteService.ensureInitialized();
    const result = await sqliteService.db.run(sql, params);
    return result.lastID;
  } catch (error) {
    logger.error('Database runAndGetId error', { error: error.message, sql: sql.substring(0, 100) });
    throw error;
  }
}

/**
 * Begin a transaction
 * @returns {Promise<void>}
 */
async function beginTransaction() {
  try {
    await sqliteService.ensureInitialized();
    return await sqliteService.db.run('BEGIN TRANSACTION');
  } catch (error) {
    logger.error('Database beginTransaction error', { error: error.message });
    throw error;
  }
}

/**
 * Commit a transaction
 * @returns {Promise<void>}
 */
async function commit() {
  try {
    await sqliteService.ensureInitialized();
    return await sqliteService.db.run('COMMIT');
  } catch (error) {
    logger.error('Database commit error', { error: error.message });
    throw error;
  }
}

/**
 * Rollback a transaction
 * @returns {Promise<void>}
 */
async function rollback() {
  try {
    await sqliteService.ensureInitialized();
    return await sqliteService.db.run('ROLLBACK');
  } catch (error) {
    logger.error('Database rollback error', { error: error.message });
    throw error;
  }
}

// Helper function to ensure service is initialized
async function ensureInitialized() {
  if (!sqliteService.initialized) {
    await sqliteService.initialize();
  }
}

module.exports = {
  run,
  get,
  all,
  runAndGetId,
  beginTransaction,
  commit,
  rollback,
  ensureInitialized
}; 