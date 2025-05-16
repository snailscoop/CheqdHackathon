/**
 * Quick script to add alternative_path column to video_frames table
 */

const sqliteService = require('../src/db/sqliteService');
const logger = require('../src/utils/logger');

async function main() {
  try {
    // Initialize database
    await sqliteService.initialize();
    
    // Try to add the column
    try {
      await sqliteService.db.run(`ALTER TABLE video_frames ADD COLUMN alternative_path TEXT`);
      logger.info('Successfully added alternative_path column to video_frames table');
    } catch (error) {
      // Column might already exist, which is fine
      if (error.message.includes('duplicate column')) {
        logger.info('alternative_path column already exists in video_frames table');
      } else {
        logger.error(`Error adding alternative_path column: ${error.message}`);
      }
    }
    
    // Verify the column exists
    const tableInfo = await sqliteService.db.all(`PRAGMA table_info(video_frames)`);
    const hasColumn = tableInfo.some(col => col.name === 'alternative_path');
    
    if (hasColumn) {
      logger.info('Verified that alternative_path column exists in video_frames table');
    } else {
      logger.error('Failed to add alternative_path column to video_frames table');
    }
    
  } catch (error) {
    logger.error('Error in script:', error.message);
  } finally {
    process.exit(0);
  }
}

// Run the main function
main(); 