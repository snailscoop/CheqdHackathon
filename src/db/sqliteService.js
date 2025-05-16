const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const config = require('../config/config');

class SQLiteService {
  constructor() {
    this.db = null;
    this.dbPath = config.database.path;
    this.initialized = false;
  }

  async initialize() {
    try {
      // Ensure the directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Open database connection
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });

      // Enable foreign keys
      await this.db.run('PRAGMA foreign_keys = ON');

      // Create tables if they don't exist
      await this.createTables();

      this.initialized = true;
      logger.info(`SQLite database initialized at ${this.dbPath}`);
      return true;
    } catch (error) {
      logger.error('Failed to initialize SQLite database', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Ensure the database is initialized
   */
  async ensureInitialized() {
    if (!this.initialized || !this.db) {
      await this.initialize();
    }
    return this.db;
  }

  async createTables() {
    // Define all tables here
    const tables = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        is_premium INTEGER DEFAULT 0,
        language TEXT DEFAULT 'en',
        token_balance INTEGER DEFAULT 0,
        join_date TIMESTAMP,
        last_activity TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Chats table
      `CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY,
        type TEXT,
        title TEXT,
        username TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Message logs table for analytics
      `CREATE TABLE IF NOT EXISTS message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        chat_id INTEGER,
        message_type TEXT DEFAULT 'text',
        command TEXT,
        timestamp TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      // Messages table (legacy support)
      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER,
        user_id INTEGER,
        chat_id INTEGER,
        text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      // Bans table
      `CREATE TABLE IF NOT EXISTS bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        chat_id INTEGER,
        banned_by INTEGER,
        reason TEXT,
        banned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (banned_by) REFERENCES users(id)
      )`,

      // Restrictions table
      `CREATE TABLE IF NOT EXISTS restrictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        chat_id INTEGER,
        restricted_by INTEGER,
        reason TEXT,
        until_date INTEGER,
        restricted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (restricted_by) REFERENCES users(id)
      )`,

      // Moderation actions table
      `CREATE TABLE IF NOT EXISTS moderation_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_id TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        target_user_id INTEGER,
        action_type TEXT NOT NULL,
        reason TEXT,
        duration INTEGER,
        data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (target_user_id) REFERENCES users(id)
      )`,

      // Appeals table
      `CREATE TABLE IF NOT EXISTS appeals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        action_id TEXT,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        reviewer_id INTEGER,
        review_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (reviewer_id) REFERENCES users(id)
      )`,

      // DID table for cheqd integration
      `CREATE TABLE IF NOT EXISTS dids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        did TEXT UNIQUE,
        owner_id INTEGER,
        method TEXT,
        key_type TEXT,
        public_key TEXT,
        metadata TEXT, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES users(id)
      )`,

      // Credentials table for cheqd integration
      `CREATE TABLE IF NOT EXISTS credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id TEXT UNIQUE,
        issuer_did TEXT,
        holder_did TEXT,
        type TEXT,
        schema TEXT,
        status TEXT,
        data TEXT,
        issued_at TIMESTAMP,
        expires_at TIMESTAMP,
        revocation_reason TEXT,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (issuer_did) REFERENCES dids(did),
        FOREIGN KEY (holder_did) REFERENCES dids(did)
      )`,

      // Cache table
      `CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        expires_at INTEGER,
        created_at INTEGER,
        compression INTEGER DEFAULT 0,
        metadata TEXT
      )`,

      // Jackal pinned videos table
      `CREATE TABLE IF NOT EXISTS jackal_videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id TEXT UNIQUE,
        title TEXT,
        description TEXT,
        url TEXT,
        pinned_by INTEGER,
        pin_status TEXT,
        ipfs_hash TEXT,
        metadata TEXT,
        transcript TEXT,
        pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pinned_by) REFERENCES users(id)
      )`,

      // Quiz questions for educational content
      `CREATE TABLE IF NOT EXISTS quiz_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT,
        difficulty TEXT,
        question TEXT,
        correct_answer TEXT,
        incorrect_answers TEXT,
        explanation TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Quiz results
      `CREATE TABLE IF NOT EXISTS quiz_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        quiz_id TEXT,
        score INTEGER,
        total_questions INTEGER,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      // API keys for external API access
      `CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        user_id INTEGER,
        description TEXT,
        permissions TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        last_used_at TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      // Function calls for analytics
      `CREATE TABLE IF NOT EXISTS function_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        function_name TEXT,
        user_id INTEGER,
        parameters TEXT,
        result TEXT,
        success INTEGER DEFAULT 0,
        execution_time INTEGER,
        called_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      // Grok conversations
      `CREATE TABLE IF NOT EXISTS grok_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        chat_id INTEGER,
        message TEXT,
        response TEXT,
        tokens_used INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,

      // Settings table
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Quiz states table
      `CREATE TABLE IF NOT EXISTS quiz_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        video_cid TEXT,
        quiz_data TEXT,
        current_question INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    // Indexes to improve query performance
    const indexes = [
      // Users
      `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
      `CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users(last_activity)`,
      
      // DIDs
      `CREATE INDEX IF NOT EXISTS idx_dids_owner_id ON dids(owner_id)`,
      
      // Credentials
      `CREATE INDEX IF NOT EXISTS idx_credentials_issuer_did ON credentials(issuer_did)`,
      `CREATE INDEX IF NOT EXISTS idx_credentials_holder_did ON credentials(holder_did)`,
      `CREATE INDEX IF NOT EXISTS idx_credentials_type ON credentials(type)`,
      `CREATE INDEX IF NOT EXISTS idx_credentials_status ON credentials(status)`,
      
      // Cache
      `CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache(expires_at)`,
      
      // Message logs
      `CREATE INDEX IF NOT EXISTS idx_message_logs_user_id ON message_logs(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_message_logs_timestamp ON message_logs(timestamp)`,
      
      // Bans
      `CREATE INDEX IF NOT EXISTS idx_bans_user_id ON bans(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bans_chat_id ON bans(chat_id)`,
      
      // Moderation actions
      `CREATE INDEX IF NOT EXISTS idx_moderation_actions_user_id ON moderation_actions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_moderation_actions_chat_id ON moderation_actions(chat_id)`,
      `CREATE INDEX IF NOT EXISTS idx_moderation_actions_target_user_id ON moderation_actions(target_user_id)`,
      
      // Appeals
      `CREATE INDEX IF NOT EXISTS idx_appeals_user_id ON appeals(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status)`,
      
      // Jackal videos
      `CREATE INDEX IF NOT EXISTS idx_jackal_videos_pinned_by ON jackal_videos(pinned_by)`,
      
      // Grok conversations
      `CREATE INDEX IF NOT EXISTS idx_grok_conversations_user_id ON grok_conversations(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_grok_conversations_created_at ON grok_conversations(created_at)`,

      // Quiz states
      `CREATE INDEX IF NOT EXISTS idx_quiz_states_user_id ON quiz_states(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_quiz_states_video_cid ON quiz_states(video_cid)`
    ];

    try {
      // Execute all table creation statements
      for (const tableQuery of tables) {
        await this.db.exec(tableQuery);
      }
      
      // Create indexes
      for (const indexQuery of indexes) {
        await this.db.exec(indexQuery);
      }
      
      logger.info('Database tables and indexes created successfully');
    } catch (error) {
      logger.error('Error creating database tables', { error: error.message });
      throw error;
    }
  }

  // User methods
  async getUser(userId) {
    return this.db.get('SELECT * FROM users WHERE id = ?', [userId]);
  }

  async saveUser(user) {
    const { id, username, first_name, last_name } = user;
    
    try {
      const now = new Date().toISOString();
      
      // Check if user exists
      const existingUser = await this.db.get('SELECT id FROM users WHERE id = ?', [id]);
      
      if (existingUser) {
        // Update existing user
        return this.db.run(
          `UPDATE users 
           SET username = ?, first_name = ?, last_name = ?, last_activity = ?
           WHERE id = ?`,
          [username, first_name, last_name, now, id]
        );
      } else {
        // Insert new user
        return this.db.run(
          `INSERT INTO users 
           (id, username, first_name, last_name, join_date, last_activity) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, username, first_name, last_name, now, now]
        );
      }
    } catch (error) {
      logger.error('Error saving user', { error: error.message, userId: id });
      throw error;
    }
  }

  // Chat methods
  async getChat(chatId) {
    return this.db.get('SELECT * FROM chats WHERE id = ?', [chatId]);
  }

  async saveChat(chat) {
    const { id, type, title, username } = chat;
    
    return this.db.run(
      `INSERT OR REPLACE INTO chats 
       (id, type, title, username) 
       VALUES (?, ?, ?, ?)`,
      [id, type, title, username]
    );
  }

  // Message methods
  async saveMessage(message) {
    const { message_id, from, chat, text } = message;
    
    // Make sure user and chat are saved first
    if (from) await this.saveUser(from);
    if (chat) await this.saveChat(chat);
    
    return this.db.run(
      `INSERT INTO messages 
       (message_id, user_id, chat_id, text) 
       VALUES (?, ?, ?, ?)`,
      [message_id, from?.id, chat?.id, text]
    );
  }

  // DID and credential methods
  async saveDid(did, ownerId, method = 'cheqd') {
    return this.db.run(
      `INSERT OR REPLACE INTO dids 
       (did, owner_id, method) 
       VALUES (?, ?, ?)`,
      [did, ownerId, method]
    );
  }

  async saveCredential(credential) {
    const {
      credential_id,
      issuer_did,
      holder_did,
      type,
      schema,
      status,
      data,
      issued_at,
      expires_at
    } = credential;
    
    return this.db.run(
      `INSERT OR REPLACE INTO credentials 
       (credential_id, issuer_did, holder_did, type, schema, status, data, issued_at, expires_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        credential_id,
        issuer_did,
        holder_did,
        type,
        schema,
        status,
        JSON.stringify(data),
        issued_at,
        expires_at
      ]
    );
  }

  // Settings methods
  async getSetting(key) {
    const result = await this.db.get('SELECT value FROM settings WHERE key = ?', [key]);
    return result ? result.value : null;
  }

  async saveSetting(key, value) {
    return this.db.run(
      `INSERT OR REPLACE INTO settings 
       (key, value, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [key, value]
    );
  }

  // Ban methods
  async banUser(userId, chatId, bannedBy, reason) {
    return this.db.run(
      `INSERT INTO bans 
       (user_id, chat_id, banned_by, reason) 
       VALUES (?, ?, ?, ?)`,
      [userId, chatId, bannedBy, reason]
    );
  }

  async isUserBanned(userId, chatId) {
    const result = await this.db.get(
      'SELECT * FROM bans WHERE user_id = ? AND chat_id = ?',
      [userId, chatId]
    );
    return !!result;
  }

  async unbanUser(userId, chatId) {
    return this.db.run(
      'DELETE FROM bans WHERE user_id = ? AND chat_id = ?',
      [userId, chatId]
    );
  }

  async saveRestriction(userId, chatId, restrictedBy, reason, untilDate) {
    return this.db.run(
      `INSERT INTO restrictions 
       (user_id, chat_id, restricted_by, reason, until_date) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, chatId, restrictedBy, reason, untilDate]
    );
  }

  async saveModerationAction(action) {
    const {
      action_id,
      user_id,
      chat_id,
      target_user_id,
      action_type,
      reason,
      duration,
      data
    } = action;
    
    return this.db.run(
      `INSERT INTO moderation_actions 
       (action_id, user_id, chat_id, target_user_id, action_type, reason, duration, data) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        action_id,
        user_id,
        chat_id,
        target_user_id,
        action_type,
        reason,
        duration,
        typeof data === 'object' ? JSON.stringify(data) : data
      ]
    );
  }

  async getModerationActions(filters = {}) {
    let query = 'SELECT * FROM moderation_actions WHERE 1=1';
    const params = [];
    
    if (filters.user_id) {
      query += ' AND user_id = ?';
      params.push(filters.user_id);
    }
    
    if (filters.chat_id) {
      query += ' AND chat_id = ?';
      params.push(filters.chat_id);
    }
    
    if (filters.target_user_id) {
      query += ' AND target_user_id = ?';
      params.push(filters.target_user_id);
    }
    
    if (filters.action_type) {
      query += ' AND action_type = ?';
      params.push(filters.action_type);
    }
    
    query += ' ORDER BY created_at DESC';
    
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }
    
    return this.db.all(query, params);
  }

  async updateSettings(chatId, settings) {
    const promises = [];
    
    for (const [key, value] of Object.entries(settings)) {
      const settingKey = `${chatId}:${key}`;
      promises.push(
        this.saveSetting(settingKey, typeof value === 'object' ? JSON.stringify(value) : value)
      );
    }
    
    return Promise.all(promises);
  }

  async getSettings(chatId) {
    const allSettings = await this.db.all(`SELECT key, value FROM settings WHERE key LIKE '${chatId}:%'`);
    
    const settings = {};
    for (const setting of allSettings) {
      const key = setting.key.split(':')[1];
      try {
        settings[key] = JSON.parse(setting.value);
      } catch (e) {
        settings[key] = setting.value;
      }
    }
    
    return settings;
  }

  async saveAppeal(userId, reason, actionId) {
    return this.db.run(
      `INSERT INTO appeals 
       (user_id, reason, action_id) 
       VALUES (?, ?, ?)`,
      [userId, reason, actionId]
    );
  }

  async getAppealsByUser(userId) {
    return this.db.all(
      `SELECT * FROM appeals WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
  }

  async getPendingAppeals() {
    return this.db.all(
      `SELECT a.*, u.username, u.first_name, u.last_name
       FROM appeals a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.status = 'pending'
       ORDER BY a.created_at ASC`
    );
  }

  async updateAppealStatus(appealId, status, reviewerId, notes) {
    return this.db.run(
      `UPDATE appeals 
       SET status = ?, reviewer_id = ?, review_notes = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, reviewerId, notes, appealId]
    );
  }

  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
      logger.info('SQLite database connection closed');
    }
  }

  /**
   * Store quiz state for a user
   * @param {string|number} userId - User ID
   * @param {string} cid - Content ID of the video
   * @param {Object} quizData - Quiz data to store
   * @returns {Promise<void>}
   */
  async storeQuizState(userId, cid, quizData) {
    try {
      await this.ensureInitialized();
      
      // Check if quiz state already exists for this user
      const existingState = await this.db.get(
        'SELECT id FROM quiz_states WHERE user_id = ?',
        [userId]
      );
      
      if (existingState) {
        // Update existing state
        await this.db.run(
          `UPDATE quiz_states 
           SET video_cid = ?, quiz_data = ?, current_question = 0, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?`,
          [cid, JSON.stringify(quizData), userId]
        );
      } else {
        // Insert new state
        await this.db.run(
          `INSERT INTO quiz_states (user_id, video_cid, quiz_data, current_question, created_at, updated_at)
           VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, cid, JSON.stringify(quizData)]
        );
      }
      
      logger.info(`Stored quiz state for user ${userId}, video ${cid}`);
    } catch (error) {
      logger.error(`Error storing quiz state: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Get current quiz state for a user
   * @param {string|number} userId - User ID
   * @returns {Promise<Object|null>} - Quiz state or null if not found
   */
  async getQuizState(userId) {
    try {
      await this.ensureInitialized();
      
      const state = await this.db.get(
        `SELECT * FROM quiz_states WHERE user_id = ?`,
        [userId]
      );
      
      if (!state) {
        return null;
      }
      
      // Parse quiz data
      const quizData = JSON.parse(state.quiz_data);
      return {
        ...state,
        ...quizData
      };
    } catch (error) {
      logger.error(`Error getting quiz state: ${error.message}`, { error });
      return null;
    }
  }

  /**
   * Update current question index for a user's quiz
   * @param {string|number} userId - User ID
   * @param {number} questionIndex - New question index
   * @returns {Promise<boolean>} - Success status
   */
  async updateQuizQuestion(userId, questionIndex) {
    try {
      await this.ensureInitialized();
      
      await this.db.run(
        `UPDATE quiz_states 
         SET current_question = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [questionIndex, userId]
      );
      
      return true;
    } catch (error) {
      logger.error(`Error updating quiz question: ${error.message}`, { error });
      return false;
    }
  }

  /**
   * Update quiz state for a user with partial data
   * @param {string|number} userId - User ID
   * @param {Object} updates - Key-value pairs to update
   * @returns {Promise<boolean>} - Success status
   */
  async updateQuizState(userId, updates) {
    try {
      await this.ensureInitialized();
      
      // Get current state first
      const currentState = await this.getQuizState(userId);
      if (!currentState) {
        logger.warn(`No quiz state found for user ${userId}`);
        return false;
      }
      
      // Extract quiz data from current state
      const quizData = { ...currentState };
      delete quizData.id;
      delete quizData.user_id;
      delete quizData.video_cid;
      delete quizData.quiz_data;
      delete quizData.current_question;
      delete quizData.created_at;
      delete quizData.updated_at;
      
      // Apply updates
      const updatedQuizData = { ...quizData, ...updates };
      
      // Special handling for current_question which is stored in its own column
      let questionUpdate = '';
      const params = [JSON.stringify(updatedQuizData), userId];
      
      if (updates.currentQuestion !== undefined) {
        questionUpdate = ', current_question = ?';
        params.splice(1, 0, updates.currentQuestion);
      }
      
      // Update the database
      await this.db.run(
        `UPDATE quiz_states 
         SET quiz_data = ?${questionUpdate}, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        params
      );
      
      return true;
    } catch (error) {
      logger.error(`Error updating quiz state: ${error.message}`, { error });
      return false;
    }
  }

  /**
   * Get the database instance
   * This will initialize the database if it's not already initialized
   * @returns {Object} SQLite database instance
   */
  getDatabase() {
    if (!this.initialized || !this.db) {
      logger.warn('Accessing database before initialization. Consider using ensureInitialized() first.');
      // Initialize in the background, but don't wait
      this.initialize().catch(err => {
        logger.error('Failed to initialize database in background', { error: err.message });
      });
    }
    
    return this.db;
  }
}

// Export singleton instance
const sqliteService = new SQLiteService();
module.exports = sqliteService; 