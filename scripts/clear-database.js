/**
 * Database Clear Script
 * 
 * This script clears all data from all tables in the database while preserving the table structure.
 * Use this to start fresh without any mock data.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Configure database path
const dbPath = path.join(__dirname, '../data/cheqd-bot.sqlite');

console.log(`Clearing database at: ${dbPath}`);

// Check if database exists
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found at: ${dbPath}`);
  process.exit(1);
}

// Connect to database
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error(`Error opening database: ${err.message}`);
    process.exit(1);
  }
  console.log(`Connected to database at ${dbPath}`);
});

// Get all tables and clear each one
db.serialize(() => {
  // Disable foreign key constraints temporarily
  db.run('PRAGMA foreign_keys = OFF;');
  
  // Get all table names
  db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';", (err, tables) => {
    if (err) {
      console.error(`Error retrieving tables: ${err.message}`);
      return closeDb();
    }
    
    console.log(`Found ${tables.length} tables to clear`);
    
    // Clear each table
    db.run('BEGIN TRANSACTION;');
    
    tables.forEach(table => {
      const tableName = table.name;
      console.log(`Clearing table: ${tableName}`);
      db.run(`DELETE FROM ${tableName};`, err => {
        if (err) {
          console.error(`Error clearing table ${tableName}: ${err.message}`);
        }
      });
    });
    
    // Commit transaction
    db.run('COMMIT;', err => {
      if (err) {
        console.error(`Error committing transaction: ${err.message}`);
        db.run('ROLLBACK;');
      } else {
        console.log('All tables cleared successfully');
      }
      
      // Re-enable foreign key constraints
      db.run('PRAGMA foreign_keys = ON;');
      
      // Close the database
      closeDb();
    });
  });
});

// Close database connection
function closeDb() {
  db.close(err => {
    if (err) {
      console.error(`Error closing database: ${err.message}`);
    } else {
      console.log('Database connection closed');
    }
  });
} 