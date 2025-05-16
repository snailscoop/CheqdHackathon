/**
 * Database migration script
 * 
 * Use this to update database schema when needed
 */

const sqliteService = require('./sqliteService');
const logger = require('../utils/logger');

async function runMigration() {
  try {
    logger.info('Running database migration...');
    
    // Initialize database connection
    await sqliteService.ensureInitialized();
    const db = sqliteService.db;
    
    // Check if educational_videos table exists
    const tableExists = await db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='educational_videos'"
    );
    
    if (tableExists) {
      logger.info('Updating educational_videos table...');
      
      // Add missing columns to educational_videos table
      
      // Check for title column
      try {
        await db.get("SELECT title FROM educational_videos LIMIT 1");
      } catch (error) {
        if (error.message.includes('no such column')) {
          logger.info('Adding title column to educational_videos');
          await db.run("ALTER TABLE educational_videos ADD COLUMN title TEXT");
        }
      }
      
      // Check for overview column
      try {
        await db.get("SELECT overview FROM educational_videos LIMIT 1");
      } catch (error) {
        if (error.message.includes('no such column')) {
          logger.info('Adding overview column to educational_videos');
          await db.run("ALTER TABLE educational_videos ADD COLUMN overview TEXT");
        }
      }
      
      // Check for has_summary column
      try {
        await db.get("SELECT has_summary FROM educational_videos LIMIT 1");
      } catch (error) {
        if (error.message.includes('no such column')) {
          logger.info('Adding has_summary column to educational_videos');
          await db.run("ALTER TABLE educational_videos ADD COLUMN has_summary BOOLEAN DEFAULT 0");
        }
      }
      
      // Check for has_quiz column
      try {
        await db.get("SELECT has_quiz FROM educational_videos LIMIT 1");
      } catch (error) {
        if (error.message.includes('no such column')) {
          logger.info('Adding has_quiz column to educational_videos');
          await db.run("ALTER TABLE educational_videos ADD COLUMN has_quiz BOOLEAN DEFAULT 0");
        }
      }
      
      // Check for processing column
      try {
        await db.get("SELECT processing FROM educational_videos LIMIT 1");
      } catch (error) {
        if (error.message.includes('no such column')) {
          logger.info('Adding processing column to educational_videos');
          await db.run("ALTER TABLE educational_videos ADD COLUMN processing BOOLEAN DEFAULT 0");
        }
      }
      
      // Check for last_error column
      try {
        await db.get("SELECT last_error FROM educational_videos LIMIT 1");
      } catch (error) {
        if (error.message.includes('no such column')) {
          logger.info('Adding last_error column to educational_videos');
          await db.run("ALTER TABLE educational_videos ADD COLUMN last_error TEXT");
        }
      }
      
      // Check for last_error_at column
      try {
        await db.get("SELECT last_error_at FROM educational_videos LIMIT 1");
      } catch (error) {
        if (error.message.includes('no such column')) {
          logger.info('Adding last_error_at column to educational_videos');
          await db.run("ALTER TABLE educational_videos ADD COLUMN last_error_at TIMESTAMP");
        }
      }
      
      // Check for published column
      try {
        await db.get("SELECT published FROM educational_videos LIMIT 1");
      } catch (error) {
        if (error.message.includes('no such column')) {
          logger.info('Adding published column to educational_videos');
          await db.run("ALTER TABLE educational_videos ADD COLUMN published BOOLEAN DEFAULT 0");
        }
      }
      
      // Check for published_at column
      try {
        await db.get("SELECT published_at FROM educational_videos LIMIT 1");
      } catch (error) {
        if (error.message.includes('no such column')) {
          logger.info('Adding published_at column to educational_videos');
          await db.run("ALTER TABLE educational_videos ADD COLUMN published_at TIMESTAMP");
        }
      }
      
      // Check for duration column
      try {
        await db.get("SELECT duration FROM educational_videos LIMIT 1");
      } catch (error) {
        if (error.message.includes('no such column')) {
          logger.info('Adding duration column to educational_videos');
          await db.run("ALTER TABLE educational_videos ADD COLUMN duration REAL");
        }
      }
    }
    
    logger.info('Database migration completed successfully');
    return true;
  } catch (error) {
    logger.error('Database migration failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  runMigration
}; 