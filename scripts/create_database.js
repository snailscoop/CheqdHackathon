/**
 * Database Initialization Script
 * 
 * This script creates all necessary tables for the Cheqd Bot
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Get database path from .env or use default
require('dotenv').config();
const dbPath = process.env.DATABASE_PATH || './.cheqd.db';

console.log(`Initializing database at ${dbPath}`);

// Create database directory if it doesn't exist
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Connect to database
const db = new sqlite3.Database(dbPath);

// Run initialization in a transaction
db.serialize(() => {
  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');
  
  // Start transaction
  db.run('BEGIN TRANSACTION');

  try {
    // Create users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        language_code TEXT,
        is_bot INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create chats table
    db.run(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT,
        username TEXT,
        first_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        member_count INTEGER DEFAULT 0
      )
    `);

    // Create chat_members table (for tracking users in chats)
    db.run(`
      CREATE TABLE IF NOT EXISTS chat_members (
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_id, user_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create messages table
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        user_id INTEGER,
        text TEXT,
        type TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES chats(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create credentials table
    db.run(`
      CREATE TABLE IF NOT EXISTS credentials (
        credential_id TEXT PRIMARY KEY,
        issuer_did TEXT,
        holder_did TEXT,
        type TEXT,
        data TEXT,
        issued_at TIMESTAMP,
        expires_at TIMESTAMP,
        revoked INTEGER DEFAULT 0,
        revoked_at TIMESTAMP,
        revocation_reason TEXT
      )
    `);

    // Create dids table
    db.run(`
      CREATE TABLE IF NOT EXISTS dids (
        did TEXT PRIMARY KEY,
        user_id INTEGER,
        private_key TEXT,
        public_key TEXT,
        method TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create educational_progress table
    db.run(`
      CREATE TABLE IF NOT EXISTS educational_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        quiz_id TEXT,
        topic TEXT,
        score INTEGER,
        total_questions INTEGER,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create stats table
    db.run(`
      CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        action TEXT,
        count INTEGER DEFAULT 1,
        first_occurrence TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_occurrence TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create user_stats table
    db.run(`
      CREATE TABLE IF NOT EXISTS user_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        stat_type TEXT,
        stat_value INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create settings table
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create trust_registries table
    db.run(`
      CREATE TABLE IF NOT EXISTS trust_registries (
        registry_id TEXT PRIMARY KEY,
        did TEXT,
        registry_name TEXT,
        description TEXT,
        registry_type TEXT,
        parent_registry_id TEXT,
        data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create credential_types table
    db.run(`
      CREATE TABLE IF NOT EXISTS credential_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        registry_id TEXT,
        credential_type TEXT,
        description TEXT,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (registry_id) REFERENCES trust_registries(registry_id)
      )
    `);

    // Create chat_features table
    db.run(`
      CREATE TABLE IF NOT EXISTS chat_features (
        chat_id INTEGER,
        feature TEXT,
        enabled INTEGER DEFAULT 0,
        settings TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER,
        PRIMARY KEY (chat_id, feature)
      )
    `);

    // Create moderation_actions table
    db.run(`
      CREATE TABLE IF NOT EXISTS moderation_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        target_user_id INTEGER,
        moderator_id INTEGER,
        action_type TEXT,
        reason TEXT,
        duration INTEGER,
        performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES chats(id),
        FOREIGN KEY (target_user_id) REFERENCES users(id),
        FOREIGN KEY (moderator_id) REFERENCES users(id)
      )
    `);

    // Create ban_list table
    db.run(`
      CREATE TABLE IF NOT EXISTS ban_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        user_id INTEGER,
        reason TEXT,
        banned_by INTEGER,
        banned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES chats(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (banned_by) REFERENCES users(id)
      )
    `);

    // Create api_keys table
    db.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        user_id INTEGER,
        description TEXT,
        permissions TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        last_used_at TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create function_calls table
    db.run(`
      CREATE TABLE IF NOT EXISTS function_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        function_name TEXT,
        user_id INTEGER,
        parameters TEXT,
        result TEXT,
        success INTEGER DEFAULT 0,
        execution_time INTEGER,
        called_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Create grok_conversations table
    db.run(`
      CREATE TABLE IF NOT EXISTS grok_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        chat_id INTEGER,
        message TEXT,
        response TEXT,
        tokens_used INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Initialize default settings
    db.run(`
      INSERT OR IGNORE INTO settings (key, value) VALUES 
        ('bot_start_time', ?),
        ('support_tiers', '{"basic": {"price": 0, "tokens": 1000}, "standard": {"price": 9.99, "tokens": 5000}, "premium": {"price": 29.99, "tokens": 20000}, "enterprise": {"price": 99.99, "tokens": 100000}}'),
        ('bot_admins', '[]')
    `, [Date.now()]);

    console.log('Database initialization completed successfully');
    
    // Commit transaction
    db.run('COMMIT');
    
  } catch (error) {
    // Rollback transaction on error
    db.run('ROLLBACK');
    console.error('Error initializing database:', error);
  }
});

// Close database connection
db.close((err) => {
  if (err) {
    console.error('Error closing database:', err.message);
  } else {
    console.log('Database connection closed');
  }
}); 