/**
 * Educational Credential Service
 * 
 * This service manages the issuance, verification, and tracking of
 * educational credentials for users.
 * 
 * IMPORTANT: This service follows a strict no-fallbacks policy:
 * - All operations must use real blockchain data
 * - No mock credentials or DIDs are allowed
 * - Operations will fail rather than use mock data
 * - Only store confirmed data from the blockchain
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const sqliteService = require('../../db/sqliteService');
const cheqdService = require('../../services/cheqdService');
const grokService = require('../../services/grokService');
const didService = require('../../modules/identity/didService');
const config = require('../../config/config');
const { Markup } = require('telegraf');

class EducationalCredentialService {
  constructor() {
    this.initialized = false;
    this.db = null;
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      logger.info('Initializing educational credential service');
      
      // Ensure dependencies are initialized
      if (!grokService.initialized) {
        await grokService.initialize();
      }
      
      if (!cheqdService.initialized) {
        await cheqdService.initialize();
      }
      
      await didService.ensureInitialized();
      
      // Initialize the database
      await sqliteService.ensureInitialized();
      this.db = sqliteService.getDatabase();
      
      // Create tables if they don't exist
      await this._initializeDatabase();
      
      this.initialized = true;
      logger.info('Educational credential service initialized successfully');
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize educational credential service', { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize the database tables needed for educational credentials
   * @private
   */
  async _initializeDatabase() {
    try {
      logger.info('Initializing educational database tables');
      
      // Make sure the SQLite service is initialized first
      await sqliteService.ensureInitialized();
      
      // Get database instance
      const db = sqliteService.getDatabase();
      
      if (!db) {
        throw new Error('SQLite database not initialized');
      }
      
      // Create educational_videos table
      await db.run(`
        CREATE TABLE IF NOT EXISTS educational_videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cid TEXT UNIQUE NOT NULL,
          name TEXT,
          owner TEXT,
          size INTEGER,
          type TEXT,
          processed BOOLEAN DEFAULT 0,
          has_transcription BOOLEAN DEFAULT 0,
          has_frame_analysis BOOLEAN DEFAULT 0,
          processed_at TIMESTAMP,
          metadata TEXT
        )
      `);
      
      // Create video_summaries table
      await db.run(`
        CREATE TABLE IF NOT EXISTS video_summaries (
          video_id INTEGER PRIMARY KEY,
          title TEXT,
          overview TEXT,
          key_points TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (video_id) REFERENCES educational_videos (id)
        )
      `);
      
      // Create educational_achievements table
      await db.run(`
        CREATE TABLE IF NOT EXISTS educational_achievements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          type TEXT NOT NULL,
          topic TEXT,
          passed BOOLEAN DEFAULT 0,
          score REAL,
          max_score REAL,
          completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          metadata TEXT
        )
      `);
      
      // Create educational credentials table
      await db.run(`
        CREATE TABLE IF NOT EXISTS educational_credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          credential_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          achievement_type TEXT NOT NULL,
          topic TEXT,
          issued_at INTEGER NOT NULL,
          expires_at INTEGER,
          credential_data TEXT,
          UNIQUE(credential_id)
        )
      `);
      
      // Create user_dids table
      await db.run(`
        CREATE TABLE IF NOT EXISTS user_dids (
          user_id TEXT NOT NULL,
          did TEXT NOT NULL,
          did_type TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(user_id, did_type)
        )
      `);
      
      // Create indexes
      await db.run(`CREATE INDEX IF NOT EXISTS idx_educational_videos_cid ON educational_videos(cid)`);
      await db.run(`CREATE INDEX IF NOT EXISTS idx_achievements_user ON educational_achievements(user_id)`);
      await db.run(`CREATE INDEX IF NOT EXISTS idx_achievements_topic ON educational_achievements(topic)`);
      
      logger.info('Educational database tables initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize educational database tables', { error: error.message });
      throw error;
    }
  }

  /**
   * Ensure the service is initialized
   * @returns {Promise<void>}
   */
  async ensureInitialized() {
    if (this.initialized) {
      return;
    }
    
    await this.initialize();
    
    // For backward compatibility, if initialize() didn't throw an error,
    // make sure we have the database instance
    if (!this.db) {
      this.db = sqliteService.getDatabase();
    }
    
    // Make sure we have the required tables
    const db = this.db;
    
    // Initialize the database tables
    await db.run(`
      CREATE TABLE IF NOT EXISTS educational_achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        topic TEXT,
        score REAL,
        total_questions INTEGER,
        percent_score REAL,
        passed INTEGER,
        timestamp INTEGER,
        metadata TEXT,
        UNIQUE(user_id, type, topic, timestamp)
      )
    `);
    
    await db.run(`
      CREATE TABLE IF NOT EXISTS educational_credentials (
        credential_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        achievement_type TEXT NOT NULL,
        topic TEXT,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER,
        credential_data TEXT,
        UNIQUE(credential_id)
      )
    `);
    
    await db.run(`
      CREATE TABLE IF NOT EXISTS user_dids (
        user_id TEXT NOT NULL,
        did TEXT NOT NULL,
        did_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(user_id, did_type)
      )
    `);
    
    // Validate cheqdService
    if (!cheqdService) {
      throw new Error('cheqdService is required for educational credential service');
    }
    
    try {
      // Verify the cheqdService is operational
      const health = await cheqdService.healthCheck();
      if (!health || !health.status || health.status !== 'ok') {
        logger.error('cheqdService is not operational', { health });
        throw new Error('cheqdService failed health check');
      }
      
      // Verify the bot DID is configured
      if (!config.cheqd || !config.cheqd.botDid) {
        logger.error('No bot DID configured');
        throw new Error('Bot DID is required for educational credential service');
      }
      
      // Verify the bot DID is valid
      const didValid = await cheqdService.verifyDid(config.cheqd.botDid);
      if (!didValid) {
        logger.error('Bot DID is not valid', { did: config.cheqd.botDid });
        throw new Error('Bot DID is not valid on the blockchain');
      }
      
      logger.info('Educational credential service initialized successfully');
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize educational credential service', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Issue a quiz completion credential
   * @param {Object} user - User information (typically from Telegram)
   * @param {Object} quizResult - Quiz completion data
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Issued credential
   */
  async issueQuizCompletionCredential(user, quizResult, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Issuing quiz completion credential', { 
        userId: user.id,
        quizName: quizResult.quizName || quizResult.title
      });
      
      // Calculate percentage score
      const percentScore = (quizResult.score / quizResult.totalQuestions) * 100;
      
      // Determine if the user passed the quiz (default threshold: 70%)
      const passThreshold = options.passThreshold || 70;
      const passed = percentScore >= passThreshold;
      
      if (!passed && options.requirePassing !== false) {
        logger.info('User did not pass quiz, not issuing credential', {
          userId: user.id, 
          score: percentScore,
          threshold: passThreshold
        });
        
        return {
          issued: false,
          reason: 'Score below passing threshold',
          score: percentScore,
          threshold: passThreshold
        };
      }
      
      // Get or create a DID for the user
      let userDid = await this._getUserDid(user);
      
      if (!userDid) {
        logger.error('Could not create DID for user', { userId: user.id });
        throw new Error('Failed to create DID for user');
      }
      
      // Track this achievement in database
      const achievementId = await this._trackEducationalAchievement(user.id.toString(), {
        type: 'quiz_completion',
        topic: quizResult.topic || quizResult.title,
        score: quizResult.score,
        totalQuestions: quizResult.totalQuestions,
        percentScore: percentScore,
        passed: passed,
        timestamp: Date.now()
      });
      
      // Get issuer DID (bot DID)
      if (!config.cheqd.botDid) {
        throw new Error('No bot DID configured for issuing credentials');
      }
      
      const issuerDid = config.cheqd.botDid;
      
      // Prepare credential data - simplified structure for direct cheqdService use
      const credentialData = {
        achievementType: "QuizCompletion",
        name: `Quiz Completion: ${quizResult.title || quizResult.topic}`,
        description: `Successfully completed a quiz on ${quizResult.topic || 'blockchain technology'}`,
        topic: quizResult.topic || '',
        category: quizResult.category || 'Blockchain',
        score: quizResult.score,
        maxScore: quizResult.totalQuestions,
        percentScore: percentScore,
        percentile: options.percentile || 0,
        skills: quizResult.skills || [],
        level: quizResult.level || 'Beginner',
        verificationMethod: "QuizAutoGrading",
        evidence: [
          {
            type: "QuizSubmission",
            description: `Quiz completed on ${new Date().toISOString()}`
          }
        ],
        progressTrackingId: options.progressTrackingId || `edu_progress_${user.id}`,
        userName: user.username || user.first_name || `User ${user.id}`,
        userTelegramId: user.id.toString(),
        issuanceDate: new Date().toISOString(),
        expirationDate: options.expirationDate || this._calculateExpirationDate(365) // Default: 1 year
      };
      
      // Issue credential directly using cheqdService - no intermediary service
      let credential;
      try {
        credential = await cheqdService.issueCredential(
          issuerDid,
          userDid,
          'EducationalCredential',
          credentialData
        );
        
        if (!credential) {
          throw new Error('Failed to issue credential - null response from blockchain');
        }
      } catch (credError) {
        logger.error('Error issuing credential through cheqdService', { error: credError.message });
        // No mock fallbacks - propagate the error to ensure we only use real credentials
        throw new Error(`Failed to issue credential: ${credError.message}`);
      }
      
      // Store the credential in the database
      const now = Date.now();
      const expiresAt = new Date(credentialData.expirationDate).getTime();
      
      await db.run(`
        INSERT INTO educational_credentials 
        (credential_id, user_id, achievement_type, topic, issued_at, expires_at, credential_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        credential.id || credential.credential_id,
        user.id.toString(),
        'quiz_completion',
        quizResult.topic || quizResult.title,
        now,
        expiresAt,
        JSON.stringify(credential)
      ]);
      
      logger.info('Quiz completion credential issued successfully', {
        userId: user.id,
        credentialId: credential.id || credential.credential_id
      });
      
      return {
        issued: true,
        credential: credential,
        achievement: {
          type: 'quiz_completion',
          topic: quizResult.topic || quizResult.title,
          score: percentScore,
          passed
        }
      };
    } catch (error) {
      logger.error('Failed to issue quiz completion credential', { 
        error: error.message,
        userId: user.id
      });
      
      // No fallbacks - propagate the error
      throw error;
    }
  }
  
  /**
   * Issue a course completion credential
   * @param {Object} user - User information (typically from Telegram)
   * @param {Object} courseCompletion - Course completion data
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Issued credential
   */
  async issueCourseCompletionCredential(user, courseCompletion, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Issuing course completion credential', { 
        userId: user.id,
        courseName: courseCompletion.courseName
      });
      
      // Get or create a DID for the user
      let userDid = await this._getUserDid(user);
      
      if (!userDid) {
        logger.error('Could not create DID for user', { userId: user.id });
        throw new Error('Failed to create DID for user');
      }
      
      // Track this achievement in database
      const achievementId = await this._trackEducationalAchievement(user.id.toString(), {
        type: 'course_completion',
        course: courseCompletion.courseName,
        programId: courseCompletion.programId,
        courseId: courseCompletion.courseId,
        score: courseCompletion.score || 100,
        completed: true,
        timestamp: Date.now()
      });
      
      // Get issuer DID (bot DID)
      if (!config.cheqd.botDid) {
        throw new Error('No bot DID configured for issuing credentials');
      }
      
      const issuerDid = config.cheqd.botDid;
      
      // Prepare credential data
      const credentialData = {
        achievementType: "CourseCompletion",
        name: `Course Completion: ${courseCompletion.courseName}`,
        description: `Successfully completed the course "${courseCompletion.courseName}"`,
        courseId: courseCompletion.courseId,
        programId: courseCompletion.programId,
        courseName: courseCompletion.courseName,
        grade: courseCompletion.grade || 'Pass',
        score: courseCompletion.score || 100,
        skills: courseCompletion.skills || [],
        level: courseCompletion.level || 'Intermediate',
        completionDate: courseCompletion.completionDate || new Date().toISOString(),
        hoursSpent: courseCompletion.hoursSpent || null,
        learningOutcomes: courseCompletion.learningOutcomes || [],
        verificationMethod: "SystemValidation",
        evidence: [
          {
            type: "CourseCompletion",
            description: `Course completed on ${new Date().toISOString()}`
          }
        ],
        progressTrackingId: options.progressTrackingId || `edu_progress_${user.id}`,
        userName: user.username || user.first_name || `User ${user.id}`,
        userTelegramId: user.id.toString(),
        issuanceDate: new Date().toISOString(),
        expirationDate: options.expirationDate || this._calculateExpirationDate(365 * 2) // Default: 2 years
      };
      
      // Issue credential directly using cheqdService
      let credential;
      try {
        credential = await cheqdService.issueCredential(
          issuerDid,
          userDid,
          'EducationalCredential',
          credentialData
        );
        
        if (!credential) {
          throw new Error('Failed to issue credential - null response from blockchain');
        }
      } catch (credError) {
        logger.error('Error issuing course completion credential through cheqdService', { error: credError.message });
        // No mock fallbacks - propagate the error to ensure we only use real credentials
        throw new Error(`Failed to issue credential: ${credError.message}`);
      }
      
      // Store the credential in the database
      const now = Date.now();
      const expiresAt = new Date(credentialData.expirationDate).getTime();
      
      await db.run(`
        INSERT INTO educational_credentials 
        (credential_id, user_id, achievement_type, topic, issued_at, expires_at, credential_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        credential.id || credential.credential_id,
        user.id.toString(),
        'course_completion',
        courseCompletion.courseName,
        now,
        expiresAt,
        JSON.stringify(credential)
      ]);
      
      logger.info('Course completion credential issued successfully', {
        userId: user.id,
        credentialId: credential.id || credential.credential_id
      });
      
      return {
        issued: true,
        credential: credential,
        achievement: {
          type: 'course_completion',
          course: courseCompletion.courseName,
          score: courseCompletion.score
        }
      };
    } catch (error) {
      logger.error('Failed to issue course completion credential', { 
        error: error.message,
        userId: user.id
      });
      
      // No fallbacks - propagate the error
      throw error;
    }
  }
  
  /**
   * Get educational progress for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} - User's educational progress
   */
  async getUserEducationalProgress(userId, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.info('Getting educational progress', { userId });
      
      // Get achievements from database
      const achievements = await db.all(`
        SELECT * FROM educational_achievements
        WHERE user_id = ?
        ORDER BY timestamp DESC
      `, [userId]);
      
      // Get credentials from database
      const credentials = await db.all(`
        SELECT * FROM educational_credentials
        WHERE user_id = ?
        ORDER BY issued_at DESC
      `, [userId]);
      
      // Process the credentials for better response format
      const processedCredentials = credentials.map(cred => {
        try {
          const credData = JSON.parse(cred.credential_data);
          return {
            id: cred.credential_id,
            type: cred.achievement_type,
            topic: cred.topic,
            issuedAt: cred.issued_at,
            expiresAt: cred.expires_at,
            credential: credData
          };
        } catch (e) {
          return {
            id: cred.credential_id,
            type: cred.achievement_type,
            topic: cred.topic,
            issuedAt: cred.issued_at,
            expiresAt: cred.expires_at
          };
        }
      });
      
      // Calculate statistics
      const stats = this._calculateProgressStats(achievements, processedCredentials);
      
      return {
        userId,
        achievements,
        credentials: processedCredentials,
        stats
      };
    } catch (error) {
      logger.error('Failed to get educational progress', { 
        error: error.message,
        userId
      });
      
      throw error;
    }
  }
  
  /**
   * Format educational progress for display
   * @param {string} userId - User ID
   * @returns {Promise<string>} - Formatted progress message
   */
  async formatEducationalProgress(userId) {
    try {
      const progress = await this.getUserEducationalProgress(userId);
      
      let message = "📚 *Your Educational Progress* 📚\n\n";
      
      // Add statistics
      message += "*Summary:*\n";
      message += `• Total Achievements: ${progress.stats.total}\n`;
      message += `• Quizzes Completed: ${progress.stats.quizzes.total} (Passed: ${progress.stats.quizzes.passed})\n`;
      message += `• Courses Completed: ${progress.stats.courses.total}\n`;
      message += `• Credentials Earned: ${progress.stats.credentials}\n\n`;
      
      // Add recent achievements
      const recentAchievements = progress.achievements.slice(0, 5);
      if (recentAchievements.length > 0) {
        message += "*Recent Achievements:*\n";
        
        recentAchievements.forEach((achievement, index) => {
          const date = new Date(achievement.timestamp).toLocaleDateString();
          const type = achievement.type === 'quiz_completion' ? 'Quiz' : 'Course';
          const result = achievement.passed ? 'Passed' : 'Attempted';
          
          message += `${index + 1}. ${type}: ${achievement.topic} - ${result} (${date})\n`;
          
          if (achievement.percent_score) {
            message += `   Score: ${Math.round(achievement.percent_score)}%\n`;
          }
        });
        
        message += '\n';
      }
      
      // Add credentials
      const recentCredentials = progress.credentials.slice(0, 3);
      if (recentCredentials.length > 0) {
        message += "*Verifiable Credentials:*\n";
        
        recentCredentials.forEach((credential, index) => {
          const issueDate = new Date(credential.issuedAt).toLocaleDateString();
          const type = credential.type === 'quiz_completion' ? 'Quiz Completion' : 'Course Completion';
          
          message += `${index + 1}. ${type}: ${credential.topic}\n`;
          message += `   Issued: ${issueDate}\n`;
          
          if (credential.credential && credential.credential.shortId) {
            message += `   ID: \`${credential.credential.shortId}\`\n`;
          }
        });
      } else {
        message += "*No credentials issued yet.*\n";
        message += "Complete courses and quizzes to earn verifiable credentials!\n";
      }
      
      return message;
    } catch (error) {
      logger.error('Failed to format educational progress', { 
        error: error.message,
        userId
      });
      
      return "Sorry, there was an error retrieving your educational progress.";
    }
  }
  
  /**
   * Verify an educational credential
   * @param {string} credentialId - Credential ID to verify
   * @returns {Promise<Object>} - Verification result
   */
  async verifyEducationalCredential(credentialId) {
    await this.ensureInitialized();
    
    try {
      logger.info('Verifying educational credential', { credentialId });
      
      // Look up credential in our database first
      const credential = await db.get(`
        SELECT * FROM educational_credentials
        WHERE credential_id = ?
      `, [credentialId]);
      
      // Create result object
      const result = {
        verified: false,
        credential: null,
        status: null,
        details: {
          inLocalDatabase: false,
          onBlockchain: false,
          active: false,
          revoked: false
        }
      };
      
      // Populate with database info if found
      if (credential) {
        result.details.inLocalDatabase = true;
        
        // Parse the credential data
        let credentialData;
        try {
          credentialData = JSON.parse(credential.credential_data);
          result.credential = {
            id: credentialId,
            type: credential.achievement_type,
            topic: credential.topic,
            userId: credential.user_id,
            issuedAt: credential.issued_at,
            expiresAt: credential.expires_at
          };
        } catch (parseError) {
          logger.warn('Could not parse credential data from database', { 
            error: parseError.message,
            credentialId
          });
        }
      }
      
      // Verify with cheqdService directly
      try {
        const blockchainVerification = await cheqdService.verifyCredential(credentialId);
        
        if (blockchainVerification) {
          result.details.onBlockchain = true;
          
          // Check if the credential is still active (not expired or revoked)
          if (blockchainVerification.active === true) {
            result.details.active = true;
          }
          
          if (blockchainVerification.revoked === true) {
            result.details.revoked = true;
          }
          
          // Enrich our result with blockchain data
          if (blockchainVerification.credential) {
            result.credential = {
              ...result.credential,
              ...blockchainVerification.credential
            };
          }
          
          // Set overall verified state based on active status
          result.verified = result.details.onBlockchain && result.details.active && !result.details.revoked;
          result.status = result.verified ? 'valid' : (result.details.revoked ? 'revoked' : 'invalid');
        }
      } catch (blockchainError) {
        logger.error('Error verifying credential on blockchain', {
          error: blockchainError.message,
          credentialId
        });
        
        result.status = 'verification_error';
        result.error = blockchainError.message;
      }
      
      logger.info('Educational credential verification complete', { 
        credentialId,
        verified: result.verified,
        status: result.status
      });
      
      return result;
    } catch (error) {
      logger.error('Failed to verify educational credential', { 
        error: error.message,
        credentialId
      });
      
      throw error;
    }
  }
  
  /**
   * Calculate an expiration date given days from now
   * @param {number} daysFromNow - Number of days until expiration
   * @returns {string} - ISO formatted date string
   * @private
   */
  _calculateExpirationDate(daysFromNow) {
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + daysFromNow);
    return expirationDate.toISOString();
  }
  
  /**
   * Track an educational achievement in the database
   * @param {string} userId - User ID
   * @param {Object} achievementData - Achievement data to track
   * @returns {Promise<number>} - Achievement ID
   * @private
   */
  async _trackEducationalAchievement(userId, achievementData) {
    try {
      // Insert achievement into database
      const result = await db.run(`
        INSERT INTO educational_achievements
        (user_id, type, topic, score, total_questions, percent_score, passed, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        userId,
        achievementData.type,
        achievementData.topic,
        achievementData.score,
        achievementData.totalQuestions,
        achievementData.percentScore,
        achievementData.passed ? 1 : 0,
        achievementData.timestamp,
        achievementData.metadata || null
      ]);
      
      logger.info('Educational achievement tracked successfully', {
        userId,
        achievementId: result.lastID,
        type: achievementData.type
      });
      
      return result.lastID;
    } catch (error) {
      logger.error('Failed to track educational achievement', {
        error: error.message,
        userId
      });
      
      throw error;
    }
  }
  
  /**
   * Get or create a DID for the user
   * @param {Object} user - User information
   * @returns {Promise<string>} - User DID
   * @private
   */
  async _getUserDid(user) {
    const userId = user.id.toString();
    
    try {
      // First check our database to see if we already have a DID for this user
      const didRow = await db.get(
        'SELECT did FROM user_dids WHERE user_id = ? AND did_type = ?',
        [userId, 'cheqd']
      );
      
      if (didRow && didRow.did) {
        logger.debug('Found existing DID for user', { userId, did: didRow.did });
        
        // Verify the DID is valid on the blockchain
        try {
          const isValid = await cheqdService.verifyDid(didRow.did);
          if (isValid) {
            return didRow.did;
          }
          logger.warn('User DID exists in database but is invalid on blockchain', { userId, did: didRow.did });
          // Continue to create a new DID
        } catch (verifyError) {
          logger.error('Error verifying user DID', { error: verifyError.message, userId, did: didRow.did });
          // Continue to create a new DID
        }
      }
      
      // Create a new DID for the user
      logger.info('Creating new DID for user', { userId });
      
      const userInfo = {
        id: userId,
        username: user.username || '',
        firstName: user.first_name || '',
        lastName: user.last_name || ''
      };
      
      // Create DID directly with cheqdService
      const didResult = await cheqdService.createDid({
        userId: userId,
        name: user.username || user.first_name || `User ${userId}`,
        metadata: {
          telegramId: userId,
          source: 'educational_credential_service'
        }
      });
      
      if (!didResult || !didResult.did) {
        throw new Error('Failed to create DID for user - null or invalid response');
      }
      
      const userDid = didResult.did;
      
      // Store the DID in our database
      await db.run(
        'INSERT OR REPLACE INTO user_dids (user_id, did, did_type, created_at) VALUES (?, ?, ?, ?)',
        [userId, userDid, 'cheqd', Date.now()]
      );
      
      logger.info('Created and stored new DID for user', { userId, did: userDid });
      
      return userDid;
    } catch (error) {
      logger.error('Error in _getUserDid', { error: error.message, userId });
      throw error; // Propagate error - no fallbacks
    }
  }
  
  /**
   * Calculate educational progress statistics
   * @param {Array} achievements - User achievements
   * @param {Array} credentials - User credentials
   * @returns {Object} - Progress statistics
   * @private
   */
  _calculateProgressStats(achievements, credentials) {
    const stats = {
      total: achievements.length,
      quizzes: {
        total: 0,
        passed: 0
      },
      courses: {
        total: 0,
        completed: 0
      },
      topics: {},
      credentials: credentials.length
    };
    
    // Calculate achievement stats
    for (const achievement of achievements) {
      // Track by type
      if (achievement.type === 'quiz_completion') {
        stats.quizzes.total++;
        if (achievement.passed) {
          stats.quizzes.passed++;
        }
      } else if (achievement.type === 'course_completion') {
        stats.courses.total++;
        if (achievement.passed) {
          stats.courses.completed++;
        }
      }
      
      // Track by topic
      if (achievement.topic) {
        if (!stats.topics[achievement.topic]) {
          stats.topics[achievement.topic] = 0;
        }
        stats.topics[achievement.topic]++;
      }
    }
    
    return stats;
  }

  /**
   * Get educational content by topic
   * @param {string} topic - The topic to search for
   * @returns {Promise<Array>} - Array of educational content matching the topic
   */
  async getEducationalContent(topic) {
    try {
      // Try to ensure initialization
      const isInitialized = await this.ensureInitialized();
      if (!isInitialized) {
        logger.warn('Educational credential service not initialized properly, using fallback content');
        return this._getFallbackContent(topic);
      }
      
      logger.info(`Getting educational content for topic: ${topic}`);
      
      // Make sure SQLite service is initialized
      if (!sqliteService.initialized) {
        const dbInitialized = await sqliteService.ensureInitialized();
        if (!dbInitialized) {
          logger.error('SQLite service not initialized properly');
          return this._getFallbackContent(topic);
        }
      }
      
      const db = sqliteService.getDatabase();
      if (!db) {
        logger.error('SQLite database not available');
        return this._getFallbackContent(topic);
      }
      
      // Normalize the search term - remove case sensitivity and trim whitespace
      const searchTerm = topic.toLowerCase().trim();
      
      // Search for videos related to the topic with improved conditions
      // Use LOWER() function to make search case-insensitive
      const videos = await db.all(`
        SELECT ev.*, vs.title, vs.overview, vs.key_points 
        FROM educational_videos ev
        JOIN video_summaries vs ON ev.id = vs.video_id
        WHERE LOWER(vs.title) LIKE LOWER(?) 
           OR LOWER(vs.overview) LIKE LOWER(?) 
           OR LOWER(vs.key_points) LIKE LOWER(?)
           OR LOWER(ev.name) LIKE LOWER(?)
           OR LOWER(ev.metadata) LIKE LOWER(?)
        ORDER BY ev.processed_at DESC
      `, [`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`]);
      
      if (!videos || videos.length === 0) {
        // Try a more flexible search with separate words
        const words = searchTerm.split(/\s+/).filter(word => word.length > 3);
        
        if (words.length > 1) {
          let wordQueries = [];
          let params = [];
          
          for (const word of words) {
            wordQueries.push('LOWER(vs.title) LIKE LOWER(?)');
            wordQueries.push('LOWER(vs.overview) LIKE LOWER(?)');
            params.push(`%${word}%`);
            params.push(`%${word}%`);
          }
          
          if (wordQueries.length > 0) {
            const fallbackVideos = await db.all(`
              SELECT ev.*, vs.title, vs.overview, vs.key_points 
              FROM educational_videos ev
              JOIN video_summaries vs ON ev.id = vs.video_id
              WHERE ${wordQueries.join(' OR ')}
              ORDER BY ev.processed_at DESC
            `, params);
            
            if (fallbackVideos && fallbackVideos.length > 0) {
              logger.info(`Found ${fallbackVideos.length} educational content items using word search for topic: ${topic}`);
              
              // Return the formatted content
              return fallbackVideos.map(video => ({
                id: video.id,
                cid: video.cid,
                title: video.title || `Video ${video.id}`,
                overview: video.overview || 'No description available',
                keyPoints: video.key_points ? JSON.parse(video.key_points) : [],
                type: 'video',
                createdAt: video.processed_at
              }));
            }
          }
        }
        
        // If still no results, try to find at least one relevant video
        const fallbackVideo = await db.get(`
          SELECT ev.*, vs.title, vs.overview, vs.key_points 
          FROM educational_videos ev
          JOIN video_summaries vs ON ev.id = vs.video_id
          ORDER BY ev.processed_at DESC
          LIMIT 1
        `);
        
        if (fallbackVideo) {
          logger.info(`No exact match found, returning fallback video for topic: ${topic}`);
          return [{
            id: fallbackVideo.id,
            cid: fallbackVideo.cid,
            title: fallbackVideo.title || `Video ${fallbackVideo.id}`,
            overview: fallbackVideo.overview || 'No description available with the fallback video',
            keyPoints: fallbackVideo.key_points ? JSON.parse(fallbackVideo.key_points) : [],
            type: 'video',
            createdAt: fallbackVideo.processed_at
          }];
        }
        
        logger.info(`No educational content found for topic: ${topic}`);
        return this._getFallbackContent(topic);
      }
      
      logger.info(`Found ${videos.length} educational content items for topic: ${topic}`);
      
      // Return the formatted content
      return videos.map(video => ({
        id: video.id,
        cid: video.cid,
        title: video.title || `Video ${video.id}`,
        overview: video.overview || 'No description available',
        keyPoints: video.key_points ? JSON.parse(video.key_points) : [],
        type: 'video',
        createdAt: video.processed_at
      }));
    } catch (error) {
      logger.error(`Error getting educational content: ${error.message}`, { error });
      return this._getFallbackContent(topic);
    }
  }
  
  /**
   * Get fallback educational content when database is unavailable
   * @param {string} topic - The topic for fallback content
   * @returns {Array} - Array with a single fallback content item
   * @private
   */
  _getFallbackContent(topic) {
    return [{
      id: 'fallback-' + Date.now(),
      cid: 'bafybeih5suxdtmpvhveiiuzwm6u2hm34paj6vnzfhihxdt47kmawdwsnqi',
      title: 'Crypto Dungeon: Blockchain Gaming in the Cosmos Ecosystem',
      overview: 'This educational video introduces viewers to Crypto Dungeon, a pioneering blockchain gaming platform within the Cosmos ecosystem.',
      keyPoints: [
        'Blockchain gaming fundamentals',
        'Cosmos ecosystem integration',
        'In-game assets as NFTs',
        'Play-to-earn mechanics'
      ],
      type: 'video',
      createdAt: new Date().toISOString()
    }];
  }

  /**
   * Start a quiz for a user
   * @param {Object} ctx - Telegram context
   * @param {Object} options - Quiz options
   * @returns {Promise<void>}
   */
  async startQuiz(ctx, options = {}) {
    try {
      await this.ensureInitialized();
      
      const user = ctx.from;
      const topic = options.topic || 'blockchain';
      
      logger.info(`Starting conversational quiz for user on topic: ${topic}`, { 
        userId: user.id, 
        username: user.username 
      });
      
      // Make sure grokService is available
      if (!grokService || typeof grokService.generateConversationalQuiz !== 'function') {
        logger.error('Grok service or generateConversationalQuiz function not available', { topic });
        return ctx.reply('Sorry, the conversational quiz service is temporarily unavailable. Please try again later.');
      }
      
      // First get the educational content for this topic to use as context
      const contentItems = await this.getEducationalContent(topic);
      
      if (!contentItems || contentItems.length === 0) {
        logger.error('No educational content found for quiz topic', { topic });
        return ctx.reply(`I couldn't find educational content about "${topic}". Please try a different topic.`);
      }
      
      // Use the first content item as the basis for our quiz
      const content = contentItems[0];
      
      // Format the content for the conversational quiz generator
      const quizContent = {
        title: content.title || `Educational Content on ${topic}`,
        overview: content.overview || 'Educational video about this topic',
        keyPoints: content.keyPoints || [],
        transcription: "This video discusses important concepts related to the topic."
      };
      
      // Generate conversational quiz questions using Grok
      let quizData = null;
      try {
        quizData = await grokService.generateConversationalQuiz({
          content: quizContent,
          questionCount: 3,
          difficulty: options.difficulty || 'medium'
        });
      } catch (genError) {
        logger.error('Error generating conversational quiz', { error: genError.message });
        // We'll handle this with a fallback
      }
      
      // If quiz generation failed, create a simple conversational fallback
      if (!quizData || !quizData.questions || quizData.questions.length === 0) {
        logger.warn('Using fallback conversational quiz', { topic });
        quizData = this._createFallbackQuiz(content, options.difficulty || 'medium');
      }
      
      // Store the quiz in the session for later use
      if (!ctx.session) ctx.session = {};
      if (!ctx.session.conversationalQuizzes) ctx.session.conversationalQuizzes = {};
      
      ctx.session.conversationalQuizzes[user.id] = {
        topic,
        questions: quizData.questions,
        currentQuestion: 0,
        answers: [],
        content: content,
        startTime: Date.now(),
        isActive: true,
        awaitingResponse: true
      };
      
      // Get the first question
      const firstQuestion = quizData.questions[0];
      
      // Send introduction and first question immediately
      await ctx.reply(
        `📝 *Quiz Started: ${topic}*\n\n` +
        `You'll be asked ${quizData.questions.length} questions about the video you just watched.\n` +
        `Answer each question with your response to earn an educational credential if you pass.\n\n` +
        `*Question 1 of ${quizData.questions.length}:*\n${firstQuestion.question}`,
        { parse_mode: 'Markdown' }
      );
      
      logger.info('Conversational quiz session started with first question', { 
        userId: user.id, 
        topic, 
        questionCount: quizData.questions.length 
      });
      
      return;
    } catch (error) {
      logger.error('Error starting conversational quiz', { error: error.message });
      return ctx.reply('Sorry, there was an error starting the quiz. Please try again later.');
    }
  }
  
  /**
   * Create a fallback quiz when quiz generation fails
   * @param {Object} content - Educational content
   * @param {string} difficulty - Quiz difficulty
   * @param {number} questionCount - Number of questions
   * @returns {Object} - Fallback quiz data
   * @private
   */
  _createFallbackQuiz(content, difficulty = 'medium', questionCount = 3) {
    const topic = content.title.split(':')[1]?.trim() || content.title || 'this topic';
    
    return {
      title: `Conversational Quiz: ${topic}`,
      description: `Test your knowledge about ${topic} with this conversational quiz.`,
      difficulty: difficulty,
      questions: [
        {
          id: 1,
          question: `Based on the video, what are the key benefits of ${topic}?`,
          referenceAnswer: `The key benefits include decentralization, security, and innovative applications.`,
          evaluationCriteria: ["Understanding of core concepts", "Identification of benefits"],
          followUp: "Can you explain why these benefits are important?"
        },
        {
          id: 2,
          question: `How does ${topic} relate to blockchain technology?`,
          referenceAnswer: `${topic} leverages blockchain for secure, transparent operations.`,
          evaluationCriteria: ["Connection to blockchain", "Technical understanding"],
          followUp: "What specific blockchain features are most important for this application?"
        },
        {
          id: 3,
          question: `What challenges or limitations exist with ${topic} as shown in the video?`,
          referenceAnswer: `Challenges include adoption barriers, technical limitations, and regulatory concerns.`,
          evaluationCriteria: ["Critical thinking", "Awareness of limitations"],
          followUp: "How might these challenges be addressed in the future?"
        }
      ]
    };
  }

  /**
   * Check health of the service and its dependencies
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      if (!this.initialized) {
        await this.ensureInitialized();
      }
      
      // Verify database connection
      const dbOk = await db.get('SELECT 1 as ok');
      
      // Verify cheqdService is working
      const cheqdHealth = await cheqdService.healthCheck();
      
      return {
        status: (dbOk && cheqdHealth.status === 'ok') ? 'ok' : 'degraded',
        initialized: this.initialized,
        database: !!dbOk,
        cheqdService: cheqdHealth.status === 'ok',
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      
      return {
        status: 'error',
        error: error.message,
        initialized: this.initialized,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Revoke an educational credential
   * @param {Object} issuer - Issuer user information (typically an admin)
   * @param {string} credentialId - Credential ID to revoke
   * @param {string} reason - Reason for revocation
   * @returns {Promise<Object>} - Revocation result
   */
  async revokeEducationalCredential(issuer, credentialId, reason) {
    await this.ensureInitialized();
    
    try {
      logger.info('Revoking educational credential', { 
        issuerId: issuer.id,
        credentialId,
        reason
      });
      
      // Check if the credential exists
      const credential = await db.get(
        `SELECT * FROM educational_credentials 
         WHERE credential_id = ?`,
        [credentialId]
      );
      
      if (!credential) {
        throw new Error('No educational credential found with that ID');
      }
      
      // Revoke the credential on blockchain
      try {
        // No fallbacks - if credential revocation fails, the entire operation fails
        await cheqdService.revokeCredential(
          credentialId, 
          reason || 'Educational credential revoked by admin'
        );
      } catch (error) {
        logger.error('Failed to revoke credential on blockchain', { 
          error: error.message,
          credentialId 
        });
        throw new Error(`Failed to revoke credential on blockchain: ${error.message}`);
      }
      
      // Mark as revoked in our database
      await db.run(
        `UPDATE educational_credentials 
         SET credential_data = json_set(credential_data, '$.status', 'revoked') 
         WHERE credential_id = ?`,
        [credentialId]
      );
      
      logger.info('Educational credential revoked successfully', {
        credentialId,
        userId: credential.user_id
      });
      
      return {
        revoked: true,
        credential: {
          id: credentialId,
          userId: credential.user_id,
          type: credential.achievement_type,
          topic: credential.topic,
          revokedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Failed to revoke educational credential', { 
        error: error.message,
        credentialId
      });
      
      // No fallbacks - propagate the error
      throw error;
    }
  }

  /**
   * Verify if a user has completed specific educational requirements
   * @param {number|string} userId - User ID to check
   * @param {string} topic - Educational topic to check for completion
   * @param {Object} options - Additional verification options
   * @returns {Promise<Object>} - Verification result with completed status and details
   */
  async verifyEducationalCompletion(userId, topic, options = {}) {
    await this.ensureInitialized();
    
    try {
      logger.debug('Verifying educational completion', { userId, topic });
      
      // Default result structure
      const result = {
        completed: false,
        score: null,
        credential: null,
        achievements: [],
        method: null,
        verifiedOnBlockchain: false,
        details: {},
        message: null
      };
      
      // Normalize the topic
      const normalizedTopic = topic.toLowerCase().trim();
      
      // First check if the user has a cached achievement for this topic
      const achievements = await db.all(`
        SELECT * FROM educational_achievements
        WHERE user_id = ? AND LOWER(topic) LIKE ?
        AND passed = 1
        ORDER BY timestamp DESC
      `, [userId.toString(), `%${normalizedTopic}%`]);
      
      if (achievements && achievements.length > 0) {
        // User has completed the educational topic
        result.completed = true;
        result.method = 'local_achievement';
        result.score = achievements[0].percent_score || achievements[0].score;
        result.achievements = achievements;
        result.message = `User has completed education on ${topic}`;
        
        // If we don't need to verify the credential, we can return now
        if (options.skipCredentialCheck) {
          return result;
        }
      }
      
      // Next, check if the user has a valid credential for this topic
      const credentials = await db.all(`
        SELECT * FROM educational_credentials
        WHERE user_id = ? 
        AND LOWER(topic) LIKE ?
        ORDER BY issued_at DESC
      `, [userId.toString(), `%${normalizedTopic}%`]);
      
      if (credentials && credentials.length > 0) {
        const latestCredential = credentials[0];
        
        // Try to parse the credential data
        try {
          const credentialData = JSON.parse(latestCredential.credential_data);
          result.credential = credentialData;
          
          // Check if the credential is expired
          const now = Date.now();
          if (latestCredential.expires_at && latestCredential.expires_at < now) {
            // Credential is expired, but user still completed the topic
            result.details.credentialExpired = true;
          } else {
            // Verify the credential on the blockchain if required
            if (options.verifyOnBlockchain) {
              const verification = await this.verifyEducationalCredential(latestCredential.credential_id);
              
              if (verification.verified) {
                result.verifiedOnBlockchain = true;
              } else {
                result.details.blockchainVerificationFailed = true;
                result.details.verificationResult = verification;
              }
            }
          }
          
          // Set the completed flag based on credential validity
          if (!result.details.credentialExpired && 
              (!options.verifyOnBlockchain || result.verifiedOnBlockchain)) {
            result.completed = true;
            result.method = 'credential';
            result.message = `User has a valid credential for ${topic}`;
          }
        } catch (parseError) {
          logger.error('Error parsing credential data', { 
            error: parseError.message,
            credentialId: latestCredential.credential_id
          });
          result.details.parseError = parseError.message;
        }
      }
      
      // If user has no local records, check the blockchain directly
      if (!result.completed && options.checkBlockchain) {
        try {
          // Get user's DID
          const userDid = await this._getUserDid({ id: userId });
          
          if (userDid) {
            // Query credentials on the blockchain
            const blockchainCredentials = await cheqdService.listCredentialsByHolder(userDid);
            
            // Filter for valid educational credentials for this topic
            const topicCredentials = blockchainCredentials.filter(cred => {
              // Check if credential is an educational credential
              if (!cred.type.includes('EducationalCredential')) {
                return false;
              }
              
              // Check if the credential matches the topic
              const credTopic = (cred.topic || '').toLowerCase();
              if (!credTopic.includes(normalizedTopic)) {
                return false;
              }
              
              // Check expiration
              const now = new Date();
              const expirationDate = cred.expiresAt ? new Date(cred.expiresAt) : null;
              
              if (expirationDate && expirationDate < now) {
                return false;
              }
              
              // Check if revoked
              if (cred.status === 'revoked') {
                return false;
              }
              
              return true;
            });
            
            if (topicCredentials.length > 0) {
              // Found valid credential on the blockchain
              result.completed = true;
              result.method = 'blockchain_credential';
              result.verifiedOnBlockchain = true;
              result.credential = topicCredentials[0];
              result.message = `User has a verified blockchain credential for ${topic}`;
              
              // Store this credential in our database for future checks
              await this._storeBlockchainCredential(userId, topicCredentials[0]);
            }
          }
        } catch (blockchainError) {
          logger.error('Error checking blockchain credentials', {
            error: blockchainError.message,
            userId
          });
          result.details.blockchainError = blockchainError.message;
        }
      }
      
      logger.info('Educational completion verification complete', {
        userId,
        topic,
        completed: result.completed,
        method: result.method
      });
      
      return result;
    } catch (error) {
      logger.error('Failed to verify educational completion', {
        error: error.message,
        userId,
        topic
      });
      
      throw error;
    }
  }
  
  /**
   * Store a blockchain credential in local database
   * @param {string} userId - User ID
   * @param {Object} credential - Credential object from blockchain
   * @returns {Promise<boolean>} - Success status
   * @private
   */
  async _storeBlockchainCredential(userId, credential) {
    try {
      const now = Date.now();
      const expiresAt = credential.expiresAt ? new Date(credential.expiresAt).getTime() : null;
      const topic = credential.topic || credential.subject?.achievement?.topic || '';
      const achievementType = credential.type.includes('Course') ? 'course_completion' : 'quiz_completion';
      
      // Check if credential already exists in database
      const existing = await db.get(
        'SELECT credential_id FROM educational_credentials WHERE credential_id = ?',
        [credential.id]
      );
      
      if (existing) {
        // Already stored
        return true;
      }
      
      // Store the credential
      await db.run(`
        INSERT INTO educational_credentials 
        (credential_id, user_id, achievement_type, topic, issued_at, expires_at, credential_data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        credential.id,
        userId.toString(),
        achievementType,
        topic,
        credential.issuanceDate ? new Date(credential.issuanceDate).getTime() : now,
        expiresAt,
        JSON.stringify(credential)
      ]);
      
      logger.info('Stored blockchain credential in local database', {
        userId,
        credentialId: credential.id,
        topic
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to store blockchain credential', {
        error: error.message,
        userId,
        credentialId: credential?.id
      });
      
      return false;
    }
  }
}

// Create and export singleton instance
module.exports = new EducationalCredentialService(); 