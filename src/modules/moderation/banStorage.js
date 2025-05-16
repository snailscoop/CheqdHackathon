/**
 * Ban Storage Service - Manages banned user tracking without credentials
 * 
 * This service provides a way to track banned users across communities
 * using SQLite for storage. It is integrated with the trust registry
 * system but operates separately to ensure bad actors cannot obtain credentials.
 */

const logger = require('../../utils/logger');
const sqliteService = require('../../db/sqliteService');
let grokService;

class BanStorage {
  constructor() {
    this.initialized = false;
    
    // Threat detection patterns
    this.threatPatterns = {
      spam: [
        /(?:buy|sell|trade)\s+(?:crypto|bitcoin|eth|nft)/i,
        /(?:investment|profit|earn)\s+(?:guaranteed|100%|double)/i,
        /(?:free|giveaway|airdrop)\s+(?:crypto|token|coin)/i,
        // Enhanced airdrop scam detection
        /(?:massive|free|exclusive|limited)\s+(?:airdrop|drop|giveaway)/i,
        /(?:receive|get|claim)\s+(?:\d+[k$]|\$\d+)\s+(?:free|back|instantly)/i,
        /(?:first|only)\s+\d+\s+(?:people|members)/i,
        /(?:steps|step|simple|easy)\s+(?:to|for)\s+(?:claim|get|receive)/i
      ],
      scam: [
        /(?:wallet|seed|private)\s+(?:phrase|key|password)/i,
        /(?:verify|validate|confirm)\s+(?:wallet|account)/i,
        /(?:send|transfer)\s+(?:crypto|token|coin)/i,
        // Enhanced investment scam detection
        /(?:guaranteed|assured)\s+(?:\d+%|returns|profits|gains)/i,
        /(?:algorithm|trading|investment)\s+(?:generated|profitable|exclusive)/i,
        /(?:minimum|min)\s+(?:investment|deposit)/i,
        /(?:join|limited|spots|pool|club|exclusive)\s+(?:investment|trading|opportunity)/i,
        // Enhanced wallet scam detection
        /(?:security|suspicious)\s+(?:alert|activity|detected)/i,
        /(?:secure|protect|verify)\s+(?:funds|wallet|crypto|account)/i,
        /(?:24\s*hours|immediately|urgent|asap)/i,
        /(?:failure|fail)\s+(?:to)\s+(?:verify|confirm|secure)/i
      ],
      phishing: [
        /(?:click|visit|go to)\s+(?:this|the)\s+(?:link|url|website)/i,
        /(?:connect|link)\s+(?:wallet|account)/i,
        /(?:update|verify)\s+(?:information|details)/i,
        // Enhanced phishing detection
        /http[s]?:\/\/(?!telegram\.org|t\.me).*?(?:verify|secure|connect|wallet|account|blockchain|crypto)/i,
        /(?:attention|urgent|notice|required|alert)\s+(?:all|members|users|verification)/i,
        /(?:verify|verification|required|confirm)\s+(?:account|identity|details)/i,
        // Admin impersonation detection
        /(?:admin|management|team)\s+(?:message|notice|attention|announcement)/i,
        /(?:group|chat|channel)\s+(?:upgrading|update|security|protocols)/i,
        /(?:maintain|complete|continue)\s+(?:membership|access|account)/i,
        /(?:message|send|contact)\s+(?:@admin|admin|support|team)/i
      ]
    };
    
    // Suspicious behavior patterns
    this.behaviorPatterns = {
      rapidMessages: { threshold: 10, window: 60000 }, // 10 messages per minute
      linkSpam: { threshold: 5, window: 300000 },      // 5 links per 5 minutes
      mentionSpam: { threshold: 8, window: 300000 }    // 8 mentions per 5 minutes
    };
    
    // User behavior tracking
    this.userBehavior = {};
    
    // Clean up behavior tracking every hour
    setInterval(() => this._cleanupBehaviorTracking(), 3600000);
    
    // Enhanced AI analysis settings
    this.aiAnalysisEnabled = true;
    this.aiConfidenceThreshold = 0.65;
    this.useAIForAllMessages = false; // Only use AI for suspicious messages to save API calls
  }
  
  /**
   * Initialize ban storage
   */
  async initialize() {
    try {
      await sqliteService.ensureInitialized();
      
      // Load Grok service dynamically to avoid circular dependencies
      if (!grokService) {
        grokService = require('../../services/grokService');
        // Initialize Grok service if not already initialized
        if (!grokService.initialized) {
          await grokService.initialize();
        }
      }
      
      // Create tables if they don't exist
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS bans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          reason TEXT,
          banned_by TEXT,
          banned_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
          expires_at INTEGER,
          propagate INTEGER DEFAULT 0,
          UNIQUE(user_id, chat_id)
        );
        
        -- Ensure columns exist (get table info)
        PRAGMA table_info(bans);
      `);
      
      // Check if necessary columns exist, add them if they don't
      const bansColumns = await sqliteService.db.all("PRAGMA table_info(bans)");
      const columnNames = bansColumns.map(col => col.name);
      
      // Add expires_at column if missing
      if (!columnNames.includes('expires_at')) {
        await sqliteService.db.exec(`
          ALTER TABLE bans ADD COLUMN expires_at INTEGER;
        `);
        logger.info('Added expires_at column to bans table', { service: 'ban-storage' });
      }
      
      // Add propagate column if missing
      if (!columnNames.includes('propagate')) {
        await sqliteService.db.exec(`
          ALTER TABLE bans ADD COLUMN propagate INTEGER DEFAULT 0;
        `);
        logger.info('Added propagate column to bans table', { service: 'ban-storage' });
      }
      
      // Continue with other tables
      await sqliteService.db.exec(`
        CREATE TABLE IF NOT EXISTS scammers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT UNIQUE NOT NULL,
          reason TEXT,
          reported_by TEXT,
          reported_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
          evidence TEXT,
          verified INTEGER DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS suspensions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          reason TEXT,
          suspended_by TEXT,
          suspended_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
          expires_at INTEGER NOT NULL,
          UNIQUE(user_id, chat_id)
        );
        
        CREATE TABLE IF NOT EXISTS ai_scam_detection_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          message_text TEXT,
          pattern_confidence REAL,
          ai_confidence REAL,
          action_taken TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );
        
        CREATE INDEX IF NOT EXISTS idx_bans_user_id ON bans(user_id);
        CREATE INDEX IF NOT EXISTS idx_bans_chat_id ON bans(chat_id);
        CREATE INDEX IF NOT EXISTS idx_scammers_user_id ON scammers(user_id);
        CREATE INDEX IF NOT EXISTS idx_suspensions_user_id ON suspensions(user_id);
        CREATE INDEX IF NOT EXISTS idx_suspensions_chat_id ON suspensions(chat_id);
        CREATE INDEX IF NOT EXISTS idx_ai_scam_logs_user_id ON ai_scam_detection_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_ai_scam_logs_chat_id ON ai_scam_detection_logs(chat_id);
      `);
      
      this.initialized = true;
      logger.info('Ban storage initialized', { service: 'ban-storage' });
      return true;
    } catch (error) {
      logger.error('Failed to initialize ban storage', { 
        error: error.message, 
        service: 'ban-storage' 
      });
      throw error;
    }
  }
  
  /**
   * Get initialization status
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }
  
  /**
   * Resilient operation with retries
   * @param {Function} operation - The operation to perform
   * @param {String} operationName - Name of the operation for logging
   * @param {Number} maxRetries - Maximum number of retries
   * @returns {Promise<*>} - Operation result
   */
  async _resilientOperation(operation, operationName = 'operation', maxRetries = 3) {
    let attempt = 0;
    let lastError = null;
    
    while (attempt < maxRetries) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        attempt++;
        const delay = Math.pow(2, attempt) * 200; // Exponential backoff
        
        logger.warn(`Ban storage operation "${operationName}" failed, retrying ${attempt}/${maxRetries}`, {
          error: error.message,
          service: 'ban-storage'
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    logger.error(`Ban storage operation "${operationName}" failed after ${maxRetries} attempts`, {
      error: lastError.message,
      service: 'ban-storage'
    });
    
    throw lastError;
  }

  /**
   * Clean up behavior tracking data
   * @private
   */
  _cleanupBehaviorTracking() {
    const now = Date.now();
    for (const [userId, data] of Object.entries(this.userBehavior)) {
      // Remove expired data
      for (const [type, records] of Object.entries(data)) {
        data[type] = records.filter(record => now - record.timestamp < this.behaviorPatterns[type].window);
        if (data[type].length === 0) {
          delete data[type];
        }
      }
      // Remove user if no data left
      if (Object.keys(data).length === 0) {
        delete this.userBehavior[userId];
      }
    }
  }

  /**
   * Track user behavior
   * @param {String} telegramId - Telegram user ID
   * @param {String} behaviorType - Type of behavior
   * @param {Object} data - Behavior data
   */
  _trackBehavior(telegramId, behaviorType, data = {}) {
    if (!this.userBehavior[telegramId]) {
      this.userBehavior[telegramId] = {};
    }
    
    if (!this.userBehavior[telegramId][behaviorType]) {
      this.userBehavior[telegramId][behaviorType] = [];
    }
    
    this.userBehavior[telegramId][behaviorType].push({
      timestamp: Date.now(),
      ...data
    });
  }

  /**
   * Check for suspicious behavior
   * @param {String} telegramId - Telegram user ID
   * @returns {Object} - Behavior analysis
   */
  _checkSuspiciousBehavior(telegramId) {
    const behavior = this.userBehavior[telegramId];
    if (!behavior) return { suspicious: false };
    
    const now = Date.now();
    const analysis = {
      suspicious: false,
      reasons: []
    };
    
    // Check each behavior type
    for (const [type, pattern] of Object.entries(this.behaviorPatterns)) {
      const records = behavior[type] || [];
      const recentRecords = records.filter(r => now - r.timestamp < pattern.window);
      
      if (recentRecords.length >= pattern.threshold) {
        analysis.suspicious = true;
        analysis.reasons.push(`${type} threshold exceeded (${recentRecords.length}/${pattern.threshold})`);
      }
    }
    
    return analysis;
  }

  /**
   * Analyze message for threats
   * @param {String} message - Message text
   * @returns {Object} - Threat analysis
   */
  _analyzeThreats(message) {
    const analysis = {
      threats: [],
      confidence: 0
    };
    
    // Check each threat pattern
    for (const [type, patterns] of Object.entries(this.threatPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          analysis.threats.push({
            type,
            pattern: pattern.toString(),
            confidence: 0.8 // High confidence for pattern matches
          });
        }
      }
    }
    
    // Calculate overall confidence
    if (analysis.threats.length > 0) {
      analysis.confidence = Math.min(0.8 + (analysis.threats.length * 0.1), 1.0);
    }
    
    return analysis;
  }

  /**
   * Process a message for threats and suspicious behavior with AI enhancement
   * @param {String} telegramId - Telegram user ID
   * @param {String} message - Message text
   * @param {Object} context - Message context
   * @returns {Promise<Object>} - Analysis result
   */
  async processMessage(telegramId, message, context = {}) {
    await this.ensureInitialized();
    
    // Track message
    this._trackBehavior(telegramId, 'rapidMessages', { message });
    
    // Track links if present
    const linkCount = (message.match(/https?:\/\/[^\s]+/g) || []).length;
    if (linkCount > 0) {
      this._trackBehavior(telegramId, 'linkSpam', { count: linkCount });
    }
    
    // Track mentions if present
    const mentionCount = (message.match(/@\w+/g) || []).length;
    if (mentionCount > 0) {
      this._trackBehavior(telegramId, 'mentionSpam', { count: mentionCount });
    }
    
    // Analyze threats using pattern matching
    const threatAnalysis = this._analyzeThreats(message);
    
    // Check behavioral patterns
    const behaviorAnalysis = this._checkSuspiciousBehavior(telegramId);
    
    // Determine initial action based on patterns
    const initialAction = this._determineAction(threatAnalysis, behaviorAnalysis);
    
    // Enhanced AI analysis
    let aiAnalysis = { confidence: 0, isScam: false, reasoning: [] };
    
    // Only use AI if:
    // 1. AI analysis is enabled
    // 2. Either useAIForAllMessages is true OR the message is already somewhat suspicious
    const shouldUseAI = this.aiAnalysisEnabled && 
        (this.useAIForAllMessages || 
         threatAnalysis.confidence > 0.3 || 
         behaviorAnalysis.suspicious || 
         initialAction.recommended !== 'none');
    
    if (shouldUseAI && grokService && grokService.initialized) {
      try {
        aiAnalysis = await this._performAIScamAnalysis(message, context);
        
        // Log AI analysis for training and auditing
        await this._logAIAnalysis(telegramId, context.chatId, message, threatAnalysis.confidence, aiAnalysis.confidence, initialAction.recommended);
      } catch (error) {
        logger.error('Error performing AI scam analysis', { 
          error: error.message,
          telegramId,
          service: 'ban-storage'
        });
        // Continue with just pattern-based analysis on AI failure
      }
    }
    
    // Combine pattern-based and AI-based analysis
    const finalAction = this._combineAnalysisResults(initialAction, aiAnalysis);
    
    // Return comprehensive analysis
    return {
      userId: telegramId,
      messageId: context.messageId,
      chatId: context.chatId,
      threatAnalysis,
      behaviorAnalysis,
      aiAnalysis,
      action: finalAction
    };
  }
  
  /**
   * Perform AI-based scam analysis
   * @param {String} message - Message text
   * @param {Object} context - Message context
   * @returns {Promise<Object>} - AI analysis result
   * @private
   */
  async _performAIScamAnalysis(message, context = {}) {
    try {
      // Skip empty messages
      if (!message || message.trim().length === 0) {
        return { confidence: 0, isScam: false, reasoning: [] };
      }
      
      // Skip short messages unless they have URLs
      if (message.length < 10 && !message.match(/https?:\/\/[^\s]+/g)) {
        return { confidence: 0, isScam: false, reasoning: [] };
      }
      
      // Fast path: Pre-filter obvious normal messages to avoid false positives
      // Simple greeting or question patterns - these are very unlikely to be scams
      const normalMessagePatterns = [
        /^(?:hi|hello|hey|greetings)[\s\!\.\,]/i,
        /^(?:good\s+(?:morning|afternoon|evening|day))[\s\!\.\,]/i,
        /^(?:how\s+(?:are|is|has)\s+(?:you|everyone|the|it))/i,
        /^(?:when\s+(?:is|will|are|can|did))/i,
        /^(?:does\s+anyone|anyone|anybody)\s+know/i,
        /^(?:what\s+(?:do|are|is|about|should))/i,
        /^(?:i(?:'|\s+)m\s+(?:new|having|trying|looking|curious|interested))/i,
        /^(?:thanks|thank you|thx)/i,
        /^(?:the|this|it|that)/i
      ];
      
      let isLikelyNormalMessage = normalMessagePatterns.some(pattern => pattern.test(message));
      
      // Check if message contains any crypto wallet addresses or URLs
      // If not, and it passes the normal message pattern, it's very likely safe
      const containsWalletOrLink = /(?:0x[a-fA-F0-9]{40}|bc1[a-zA-Z0-9]{39}|http)/i.test(message);
      
      if (isLikelyNormalMessage && !containsWalletOrLink && message.length < 150) {
        return { 
          confidence: 0.9, 
          isScam: false, 
          reasoning: ['Message matches normal conversation pattern without suspicious elements']
        };
      }
      
      // Fast path: Check for obvious scam indicators before calling AI
      // This acts as a fallback in case AI returns low confidence
      const highRiskIndicators = {
        airdrop: /(?:free|massive)\s+(?:airdrop|giveaway).+(?:connect|verify|send)/is,
        wallet: /(?:wallet|account)\s+(?:security|verify|connect).+(?:urgent|immediate|within 24)/is,
        investment: /(?:investment|returns?|profit).+(?:guaranteed|[2-9]\d{2}%|double)/is,
        admin: /(?:admin|management|team).+(?:verify|send|contact).+(?:code|address|transaction)/is,
        phishing: /(?:click|verify|connect).+(?:https?:\/\/[^\s]+)/is
      };
      
      let fastPathScamType = null;
      let fastPathConfidence = 0;
      
      for (const [type, pattern] of Object.entries(highRiskIndicators)) {
        if (pattern.test(message)) {
          fastPathScamType = type;
          fastPathConfidence = 0.85;
          break;
        }
      }
      
      // Check for suspicious URLs (non-standard TLDs often used in scams)
      const urlMatch = message.match(/https?:\/\/[^\s]+\.(tk|ml|ga|cf|gq|top|xyz|pw)/i);
      if (urlMatch) {
        fastPathScamType = fastPathScamType || 'suspicious_url';
        fastPathConfidence = Math.max(fastPathConfidence, 0.8);
      }

      // Create system prompt for scam detection
      const systemPrompt = `You are a cryptocurrency security expert specializing in detecting scams and fraud. Analyze the following message and determine if it contains:
1. Phishing attempts
2. Unsolicited investment opportunities
3. Requests for sensitive information (wallet keys, seed phrases)
4. Suspicious links or requests to connect wallets
5. Unrealistic promises (guaranteed returns, free money)
6. Impersonation of services or individuals
7. Fake airdrops or token giveaways
8. Urgency to act immediately
9. Suspicious content that may be attempting to scam users

IMPORTANT: Be very conservative with your assessment. Normal conversation, questions, greetings, or general discussions about cryptocurrency without asking for action are NOT scams. Only flag a message as a scam if it clearly exhibits multiple scam indicators. Avoid false positives.`;
      
      // Create message payload for Grok
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ];
      
      // Define function calling schema for structured output
      const functions = [
        {
          name: "analyze_scam_risk",
          description: "Analyze if a message is likely a cryptocurrency scam or phishing attempt",
          parameters: {
            type: "object",
            properties: {
              isScam: {
                type: "boolean",
                description: "Whether the message appears to be a scam"
              },
              confidence: {
                type: "number",
                description: "Confidence level from 0 to 1"
              },
              scamType: {
                type: "string",
                description: "Type of scam if detected (phishing, investment, wallet, etc.)"
              },
              reasoning: {
                type: "array",
                items: {
                  type: "string"
                },
                description: "List of reasons why this is or isn't a scam"
              }
            },
            required: ["isScam", "confidence", "reasoning"]
          }
        }
      ];
      
      // Call Grok API with function calling
      const response = await grokService.chatCompletion(messages, {
        temperature: 0.1, // Low temperature for more predictable outputs
        max_tokens: 1000,
        functions: functions,
        function_call: { name: "analyze_scam_risk" }
      });
      
      // Process response
      let result = { confidence: 0, isScam: false, reasoning: [], scamType: '' };
      
      if (response.choices && 
          response.choices[0] && 
          response.choices[0].message && 
          response.choices[0].message.function_call) {
        
        // Parse function call arguments
        try {
          const functionArgs = JSON.parse(response.choices[0].message.function_call.arguments);
          
          result = {
            confidence: functionArgs.confidence || 0,
            isScam: functionArgs.isScam || false,
            scamType: functionArgs.scamType || '',
            reasoning: functionArgs.reasoning || []
          };
        } catch (parseError) {
          logger.error('Error parsing function call arguments', { error: parseError.message });
          // Continue with default result
        }
      }
      // Fallback to content-based parsing if function calling fails
      else if (response.choices && response.choices[0] && response.choices[0].message) {
        const content = response.choices[0].message.content;
        
        // Simple confidence extraction from text
        const confidenceMatch = content.match(/confidence[\s\:]*(0?\.\d+|\d+\/10)/i);
        let confidence = 0;
        
        if (confidenceMatch) {
          const value = confidenceMatch[1];
          if (value.includes('/')) {
            // Handle X/10 format
            const [num, denom] = value.split('/').map(n => parseFloat(n));
            confidence = num / denom;
          } else {
            confidence = parseFloat(value);
          }
        }
        
        // Simple scam detection from content
        const isScam = content.toLowerCase().includes('scam') && 
                     !(content.toLowerCase().includes('not a scam') || 
                       content.toLowerCase().includes('doesn\'t appear to be a scam') || 
                       content.toLowerCase().includes('does not appear to be a scam'));
        
        result = {
          confidence: confidence,
          isScam: isScam,
          reasoning: [content.substring(0, 200)]
        };
      }
      
      // Use our fast path results if AI confidence is lower than our fast path analysis
      // This helps in cases where AI is uncertain but we detected obvious scam patterns
      if (fastPathScamType && (!result.isScam || result.confidence < fastPathConfidence)) {
        const fastPathReasons = [`Detected high-risk ${fastPathScamType} pattern`];
        if (urlMatch) {
          fastPathReasons.push(`Suspicious URL domain detected: ${urlMatch[0]}`);
        }
        
        logger.info('Using fast path scam detection', { 
          type: fastPathScamType, 
          confidence: fastPathConfidence,
          aiResult: { isScam: result.isScam, confidence: result.confidence }
        });
        
        return {
          confidence: fastPathConfidence,
          isScam: true,
          scamType: fastPathScamType,
          reasoning: fastPathReasons
        };
      }
      
      // If AI says it's a scam but confidence is very low, we need to be cautious
      // to prevent false positives
      if (result.isScam) {
        if (result.confidence < 0.4) {
          // Too low confidence - override to avoid false positives
          result.isScam = false;
          result.confidence = 0.7; // High confidence it's NOT a scam
          result.reasoning.unshift('Low confidence scam detection overridden to prevent false positive');
        } else if (result.confidence < 0.65) {
          // For borderline cases, check for key indicators before accepting AI judgment
          const hasKeyScamIndicators = [
            /wallet|private key|seed phrase|connect|verify|validate|secure|urgent|airdrop|giveaway|free|investment|profit|double|guaranteed|click|dm|pm|send/i.test(message),
            /https?:\/\/[^\s]+/i.test(message)
          ].filter(Boolean).length >= 1;
          
          if (!hasKeyScamIndicators) {
            // No supporting evidence, override to avoid false positive
            result.isScam = false;
            result.confidence = 0.6;
            result.reasoning.unshift('Medium confidence scam detection without supporting indicators rejected');
          }
        }
      }
      
      return result;
    } catch (error) {
      logger.error('Error in AI scam analysis', { error: error.message });
      return { confidence: 0, isScam: false, reasoning: [] };
    }
  }
  
  /**
   * Combine pattern-based and AI-based analysis results
   * @param {Object} patternAction - Pattern-based action recommendation
   * @param {Object} aiAnalysis - AI analysis results
   * @returns {Object} - Combined action recommendation
   * @private
   */
  _combineAnalysisResults(patternAction, aiAnalysis) {
    // Start with pattern-based action
    const combinedAction = {
      recommended: patternAction.recommended,
      confidence: patternAction.confidence,
      reason: [...patternAction.reason]
    };
    
    // Case 1: AI detects scam with reasonable confidence, take stronger action
    if (aiAnalysis.isScam && aiAnalysis.confidence >= this.aiConfidenceThreshold) {
      // Upgrade action severity based on AI confidence
      if (combinedAction.recommended === 'none') {
        combinedAction.recommended = aiAnalysis.confidence >= 0.8 ? 'suspend' : 'warn';
        combinedAction.confidence = aiAnalysis.confidence;
      } else if (combinedAction.recommended === 'warn') {
        combinedAction.recommended = aiAnalysis.confidence >= 0.8 ? 'ban' : 'suspend';
        combinedAction.confidence = Math.max(combinedAction.confidence, aiAnalysis.confidence);
      } else if (combinedAction.recommended === 'suspend' && aiAnalysis.confidence >= 0.8) {
        combinedAction.recommended = 'ban';
        combinedAction.confidence = Math.max(combinedAction.confidence, aiAnalysis.confidence);
      }
      
      // Add AI reasoning to explanation
      if (aiAnalysis.reasoning && aiAnalysis.reasoning.length > 0) {
        combinedAction.reason.push(`AI detection: ${aiAnalysis.confidence.toFixed(2)} confidence`);
        combinedAction.reason.push(...aiAnalysis.reasoning.slice(0, 2));
      }
      
      // Add scam type if available
      if (aiAnalysis.scamType) {
        combinedAction.reason.push(`Detected scam type: ${aiAnalysis.scamType}`);
      }
    }
    // Case 2: AI thinks it's a scam but low confidence - still consider as evidence
    else if (aiAnalysis.isScam && aiAnalysis.confidence > 0.3) {
      // Even with low confidence, if pattern also indicates possible threat, increase severity
      if (patternAction.confidence > 0.3) {
        // Combine evidence from both sources
        const combinedConfidence = (aiAnalysis.confidence + patternAction.confidence) * 0.7;
        
        // Upgrade action if combined confidence is high enough
        if (combinedConfidence > 0.7) {
          if (combinedAction.recommended === 'none' || combinedAction.recommended === 'warn') {
            combinedAction.recommended = 'suspend';
          } else if (combinedAction.recommended === 'suspend' && combinedConfidence > 0.8) {
            combinedAction.recommended = 'ban';
          }
          
          combinedAction.confidence = combinedConfidence;
          combinedAction.reason.push(`Combined AI+pattern detection: ${combinedConfidence.toFixed(2)} confidence`);
          
          if (aiAnalysis.reasoning && aiAnalysis.reasoning.length > 0) {
            combinedAction.reason.push(aiAnalysis.reasoning[0]);
          }
        }
        // Otherwise just increase confidence but keep the same action
        else {
          combinedAction.confidence = Math.max(combinedAction.confidence, combinedConfidence);
          
          if (combinedAction.recommended === 'none') {
            combinedAction.recommended = 'warn';
            combinedAction.reason.push('Low confidence scam indicators detected');
          }
        }
      }
      // If pattern has very low confidence but AI detects something, at least warn
      else if (combinedAction.recommended === 'none') {
        combinedAction.recommended = 'warn';
        combinedAction.confidence = aiAnalysis.confidence;
        combinedAction.reason.push(`Possible scam detected by AI: ${aiAnalysis.confidence.toFixed(2)} confidence`);
      }
    } 
    // Case 3: AI confident it's NOT a scam, possibly downgrade action
    else if (!aiAnalysis.isScam && aiAnalysis.confidence > 0.85 && patternAction.confidence < 0.7) {
      // Only downgrade if pattern detection wasn't extremely confident
      if (combinedAction.recommended === 'ban' && patternAction.confidence < 0.75) {
        combinedAction.recommended = 'suspend';
        combinedAction.reason.push('Action downgraded by AI analysis');
      } else if (combinedAction.recommended === 'suspend' && patternAction.confidence < 0.6) {
        combinedAction.recommended = 'warn';
        combinedAction.reason.push('Action downgraded by AI analysis');
      } else if (combinedAction.recommended === 'warn' && patternAction.confidence < 0.5) {
        combinedAction.recommended = 'none';
        combinedAction.reason = ['No action needed based on AI analysis'];
      }
    }
    
    // Final safety check - if detection confidence is very high, always ban
    if (combinedAction.confidence > 0.9 && combinedAction.recommended !== 'ban') {
      combinedAction.recommended = 'ban';
      combinedAction.reason.push('Action escalated to ban due to very high confidence');
    }
    
    return combinedAction;
  }
  
  /**
   * Log AI analysis results for training and auditing
   * @param {String} userId - User ID
   * @param {String} chatId - Chat ID
   * @param {String} messageText - Message text
   * @param {Number} patternConfidence - Pattern-based confidence
   * @param {Number} aiConfidence - AI-based confidence
   * @param {String} actionTaken - Action taken
   * @returns {Promise<void>}
   * @private
   */
  async _logAIAnalysis(userId, chatId, messageText, patternConfidence, aiConfidence, actionTaken) {
    try {
      await sqliteService.db.run(
        `INSERT INTO ai_scam_detection_logs (
          user_id, 
          chat_id, 
          message_text, 
          pattern_confidence, 
          ai_confidence, 
          action_taken
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          chatId,
          messageText.substring(0, 1000), // Limit text length
          patternConfidence,
          aiConfidence,
          actionTaken
        ]
      );
    } catch (error) {
      logger.error('Error logging AI analysis', { error: error.message });
      // Non-critical error, continue execution
    }
  }

  /**
   * Determine what action to take based on analyses
   * @param {Object} threatAnalysis - Threat analysis
   * @param {Object} behaviorAnalysis - Behavior analysis
   * @returns {Object} - Recommended action
   * @private
   */
  _determineAction(threatAnalysis, behaviorAnalysis) {
    // Start with no action
    const action = {
      recommended: 'none',
      confidence: 0,
      reason: []
    };
    
    // Check for URLs in threats as a special high-risk factor
    const hasHighRiskURLPattern = threatAnalysis.threats.some(threat => 
      threat.pattern.includes('http') && threat.type === 'phishing');
    
    // Check for multiple threat types as a risk amplifier
    const uniqueThreatTypes = new Set(threatAnalysis.threats.map(t => t.type));
    const hasMultipleThreatTypes = uniqueThreatTypes.size > 1;
    
    // High threat confidence means immediate action
    if (threatAnalysis.confidence > 0.7 || hasHighRiskURLPattern) {
      action.recommended = 'ban';
      action.confidence = Math.max(threatAnalysis.confidence, hasHighRiskURLPattern ? 0.9 : 0);
      action.reason.push(`High threat confidence: ${action.confidence.toFixed(2)}`);
      
      if (hasHighRiskURLPattern) {
        action.reason.push('Suspicious URL detected matching phishing patterns');
      }
    }
    // Medium-high threat confidence means possible ban/suspend
    else if (threatAnalysis.confidence > 0.5 || hasMultipleThreatTypes) {
      action.recommended = threatAnalysis.confidence > 0.65 ? 'ban' : 'suspend';
      action.confidence = threatAnalysis.confidence * (hasMultipleThreatTypes ? 1.2 : 1.0);
      action.reason.push(`Moderate-high threat confidence: ${action.confidence.toFixed(2)}`);
      
      if (hasMultipleThreatTypes) {
        action.reason.push(`Multiple threat types detected: ${Array.from(uniqueThreatTypes).join(', ')}`);
      }
    }
    // Moderate threat confidence plus suspicious behavior means suspension
    else if (threatAnalysis.confidence > 0.4 && behaviorAnalysis.suspicious) {
      action.recommended = 'suspend';
      action.confidence = threatAnalysis.confidence * 0.8;
      action.reason.push(`Moderate threat with suspicious behavior`);
    }
    // Low-moderate threat confidence means warning
    else if (threatAnalysis.confidence > 0.25) {
      action.recommended = 'warn';
      action.confidence = threatAnalysis.confidence;
      action.reason.push(`Low-moderate threat detected: ${action.confidence.toFixed(2)}`);
    }
    // Just suspicious behavior means warning
    else if (behaviorAnalysis.suspicious) {
      action.recommended = 'warn';
      action.confidence = 0.6;
      action.reason.push(`Suspicious behavior detected`);
      action.reason.push(...behaviorAnalysis.reasons);
    }
    
    // Special case - if there's any phishing threat detected, always at least warn
    if (action.recommended === 'none' && threatAnalysis.threats.some(t => t.type === 'phishing')) {
      action.recommended = 'warn';
      action.confidence = 0.55;
      action.reason.push('Potential phishing content detected');
    }
    
    return action;
  }

  /**
   * Add a ban record
   * @param {String} telegramId - Telegram user ID
   * @param {String} chatId - Chat ID
   * @param {Object} banData - Ban details
   * @returns {Promise<Object>} - Ban record
   */
  async addBan(telegramId, chatId, banData = {}) {
    await this.ensureInitialized();
    
    return this._resilientOperation(async () => {
      const {
        reason = 'No reason provided',
        bannedBy = 'system',
        expiresAt = null,
        propagate = false
      } = banData;
      
      // Ensure the user exists in the users table
      try {
        // Check if user exists, first by username (which might be the ID in some cases)
        let userExists = await sqliteService.db.get(
          'SELECT id FROM users WHERE username = ? OR id = ?',
          [telegramId, Number(telegramId)]
        );
        
        // If user doesn't exist, create a placeholder record
        if (!userExists) {
          logger.debug('Creating placeholder user record for ban', { telegramId });
          await sqliteService.db.run(
            'INSERT OR IGNORE INTO users (username, first_name, last_name, created_at) VALUES (?, ?, ?, ?)',
            [telegramId, 'Unknown', 'User', Date.now()]
          );
          
          // Get the inserted user ID
          userExists = await sqliteService.db.get(
            'SELECT id FROM users WHERE username = ?',
            [telegramId]
          );
        }
        
        // Store user ID for the ban
        const userId = userExists ? userExists.id : null;
        
        // Ensure the chat exists in the chats table
        let chatExists = await sqliteService.db.get(
          'SELECT id FROM chats WHERE id = ?',
          [Number(chatId)]
        );
        
        // If chat doesn't exist, create a placeholder record
        if (!chatExists) {
          logger.debug('Creating placeholder chat record for ban', { chatId });
          await sqliteService.db.run(
            'INSERT OR IGNORE INTO chats (id, type, title, created_at) VALUES (?, ?, ?, ?)',
            [Number(chatId), 'group', 'Unknown Chat', Date.now()]
          );
          
          // Get the inserted chat ID
          chatExists = await sqliteService.db.get(
            'SELECT id FROM chats WHERE id = ?',
            [Number(chatId)]
          );
        }
        
        // Store chat ID for the ban
        const chatDbId = chatExists ? chatExists.id : null;
        
        // Check if already banned
        const existingBan = await this.checkBan(telegramId, chatId);
        if (existingBan) {
          // Update existing ban
          await sqliteService.db.run(
            `UPDATE bans SET 
             reason = ?, 
             banned_by = ?, 
             expires_at = ?, 
             propagate = ? 
             WHERE user_id = ? AND chat_id = ?`,
            [
              reason,
              bannedBy,
              expiresAt,
              propagate ? 1 : 0,
              userId || telegramId,
              chatDbId || chatId
            ]
          );
          
          logger.info('Updated existing ban', {
            telegramId,
            chatId,
            reason,
            service: 'ban-storage'
          });
        } else {
          // Try to create new ban, with error handling for foreign key issues
          try {
            await sqliteService.db.run(
              `INSERT INTO bans (
                user_id, 
                chat_id, 
                reason, 
                banned_by, 
                expires_at, 
                propagate
              ) VALUES (?, ?, ?, ?, ?, ?)`,
              [
                userId || telegramId,
                chatDbId || chatId,
                reason,
                userId || bannedBy,
                expiresAt,
                propagate ? 1 : 0
              ]
            );
            
            logger.info('Added new ban', {
              telegramId,
              chatId,
              reason,
              service: 'ban-storage'
            });
          } catch (insertError) {
            // If we still get a foreign key error, try disabling constraints temporarily
            if (insertError.message.includes('FOREIGN KEY constraint failed')) {
              logger.warn('Foreign key constraint failed, attempting with pragma workaround', {
                telegramId,
                chatId,
                error: insertError.message
              });
              
              try {
                // Temporarily disable foreign key constraints
                await sqliteService.db.exec('PRAGMA foreign_keys = OFF;');
                
                await sqliteService.db.run(
                  `INSERT INTO bans (
                    user_id, 
                    chat_id, 
                    reason, 
                    banned_by, 
                    expires_at, 
                    propagate
                  ) VALUES (?, ?, ?, ?, ?, ?)`,
                  [
                    userId || telegramId,
                    chatDbId || chatId,
                    reason,
                    userId || bannedBy,
                    expiresAt,
                    propagate ? 1 : 0
                  ]
                );
                
                // Re-enable foreign key constraints
                await sqliteService.db.exec('PRAGMA foreign_keys = ON;');
                
                logger.info('Added new ban with constraints disabled', {
                  telegramId,
                  chatId,
                  reason,
                  service: 'ban-storage'
                });
              } catch (finalError) {
                logger.error('Failed to add ban even with constraints disabled', {
                  error: finalError.message,
                  telegramId,
                  chatId
                });
                throw finalError;
              }
            } else {
              // If it's not a foreign key error, rethrow
              throw insertError;
            }
          }
        }
        
        // Return updated ban data
        return this.checkBan(telegramId, chatId);
      } catch (error) {
        logger.error('Error in addBan operation', { 
          error: error.message,
          telegramId,
          chatId
        });
        
        // Final fallback - try adding a ban record without any foreign key checks
        try {
          // Temporarily disable foreign key constraints
          await sqliteService.db.exec('PRAGMA foreign_keys = OFF;');
          
          await sqliteService.db.run(
            `INSERT OR REPLACE INTO bans (
              user_id, 
              chat_id, 
              reason, 
              banned_by, 
              expires_at, 
              propagate
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              telegramId,
              chatId,
              reason,
              bannedBy,
              expiresAt,
              propagate ? 1 : 0
            ]
          );
          
          // Re-enable foreign key constraints
          await sqliteService.db.exec('PRAGMA foreign_keys = ON;');
          
          logger.info('Added ban record using final fallback method', {
            telegramId,
            chatId,
            service: 'ban-storage'
          });
          
          return {
            userId: telegramId,
            chatId: chatId,
            reason: reason,
            bannedBy: bannedBy,
            bannedAt: Date.now(),
            expiresAt: expiresAt,
            propagate: propagate
          };
        } catch (finalError) {
          logger.error('Failed to add ban with fallback method', {
            error: finalError.message
          });
          throw error; // Throw original error
        }
      }
    }, 'addBan');
  }

  /**
   * Check if a user is banned
   * @param {String} telegramId - Telegram user ID
   * @param {String} chatId - Chat ID (optional for global check)
   * @returns {Promise<Object|null>} - Ban data or null if not banned
   */
  async checkBan(telegramId, chatId) {
    await this.ensureInitialized();
    
    return this._resilientOperation(async () => {
      try {
        // Try to get the user ID from the users table
        let userId = telegramId;
        const userRecord = await sqliteService.db.get(
          'SELECT id FROM users WHERE username = ? OR id = ?',
          [telegramId, Number(telegramId)]
        );
        
        if (userRecord) {
          userId = userRecord.id;
        }
        
        // First check if the user is a verified scammer
        const scammer = await sqliteService.db.get(
          'SELECT * FROM scammers WHERE user_id = ? AND verified = 1',
          [userId]
        );
        
        if (scammer) {
          return {
            userId: telegramId,
            chatId: 'global',
            reason: scammer.reason || 'Verified scammer',
            bannedAt: scammer.reported_at,
            expiresAt: null,
            propagate: true,
            global: true
          };
        }
        
        // Try to get the chat ID from the chats table
        let chatDbId = chatId;
        if (chatId) {
          const chatRecord = await sqliteService.db.get(
            'SELECT id FROM chats WHERE id = ?',
            [Number(chatId)]
          );
          
          if (chatRecord) {
            chatDbId = chatRecord.id;
          }
          
          // If chat ID is provided, check specific ban
          const ban = await sqliteService.db.get(
            'SELECT * FROM bans WHERE user_id = ? AND chat_id = ? AND (expires_at IS NULL OR expires_at > ?)',
            [userId, chatDbId, Date.now()]
          );
          
          if (ban) {
            return {
              userId: telegramId,
              chatId: chatId,
              reason: ban.reason,
              bannedBy: ban.banned_by,
              bannedAt: ban.banned_at,
              expiresAt: ban.expires_at,
              propagate: ban.propagate === 1
            };
          }
        }
        
        // Check for propagated bans from other chats
        const propagatedBan = await sqliteService.db.get(
          'SELECT * FROM bans WHERE user_id = ? AND propagate = 1 AND (expires_at IS NULL OR expires_at > ?)',
          [userId, Date.now()]
        );
        
        if (propagatedBan) {
          // Get the chat info for the ban's chat_id if available
          let banChatId = propagatedBan.chat_id;
          try {
            const chatRecord = await sqliteService.db.get(
              'SELECT * FROM chats WHERE id = ?',
              [propagatedBan.chat_id]
            );
            
            if (chatRecord) {
              banChatId = chatRecord.id;
            }
          } catch (error) {
            // Ignore errors, just use the numeric ID
          }
          
          return {
            userId: telegramId,
            chatId: banChatId,
            reason: propagatedBan.reason,
            bannedBy: propagatedBan.banned_by,
            bannedAt: propagatedBan.banned_at,
            expiresAt: propagatedBan.expires_at,
            propagate: true,
            propagated: true
          };
        }
        
        return null;
      } catch (error) {
        logger.error('Error checking ban status', { 
          error: error.message,
          telegramId,
          chatId,
          service: 'ban-storage'
        });
        
        // Fallback to direct check, bypassing foreign keys
        try {
          const ban = await sqliteService.db.get(
            'SELECT * FROM bans WHERE (user_id = ? OR user_id = ?) AND (chat_id = ? OR chat_id = ?) AND (expires_at IS NULL OR expires_at > ?)',
            [telegramId, Number(telegramId), chatId, Number(chatId), Date.now()]
          );
          
          if (ban) {
            return {
              userId: telegramId,
              chatId: chatId,
              reason: ban.reason,
              bannedBy: ban.banned_by,
              bannedAt: ban.banned_at,
              expiresAt: ban.expires_at,
              propagate: ban.propagate === 1
            };
          }
        } catch (fallbackError) {
          // Ignore fallback errors, just return null
          logger.debug('Fallback ban check also failed', { error: fallbackError.message });
        }
        
        return null;
      }
    }, 'checkBan');
  }

  /**
   * Remove a ban
   * @param {String} telegramId - Telegram user ID
   * @param {String} chatId - Chat ID
   * @param {Object} options - Removal options
   * @returns {Promise<Boolean>} - Success status
   */
  async removeBan(telegramId, chatId, options = {}) {
    await this.ensureInitialized();
    
    return this._resilientOperation(async () => {
      const { removedBy = 'system', reason = 'No reason provided' } = options;
      
      // Check if banned
      const ban = await this.checkBan(telegramId, chatId);
      if (!ban || (ban.propagated && ban.chatId !== chatId)) {
        logger.warn('Attempted to remove non-existent ban', {
          telegramId,
          chatId,
          service: 'ban-storage'
        });
        return false;
      }
      
      // Remove ban
      const result = await sqliteService.db.run(
        'DELETE FROM bans WHERE user_id = ? AND chat_id = ?',
        [telegramId, chatId]
      );
      
      if (result.changes > 0) {
        logger.info('Removed ban', {
          telegramId,
          chatId,
          removedBy,
          reason,
          service: 'ban-storage'
        });
        return true;
      } else {
        logger.warn('Failed to remove ban, not found in database', {
          telegramId,
          chatId,
          service: 'ban-storage'
        });
        return false;
      }
    }, 'removeBan');
  }

  /**
   * Mark a user as a scammer
   * @param {String} telegramId - Telegram user ID
   * @param {Object} scamData - Scam details
   * @returns {Promise<Object>} - Scammer record
   */
  async markAsScammer(telegramId, scamData = {}) {
    await this.ensureInitialized();
    
    return this._resilientOperation(async () => {
      const {
        reason = 'Suspected scam activity',
        reportedBy = 'system',
        evidence = '',
        verified = false
      } = scamData;
      
      // Check if already marked
      const existingScammer = await sqliteService.db.get(
        'SELECT * FROM scammers WHERE user_id = ?',
        [telegramId]
      );
      
      if (existingScammer) {
        // Update existing record
        await sqliteService.db.run(
          `UPDATE scammers SET 
           reason = ?, 
           reported_by = ?, 
           evidence = ?, 
           verified = ? 
           WHERE user_id = ?`,
          [reason, reportedBy, evidence, verified ? 1 : 0, telegramId]
        );
        
        logger.info('Updated existing scammer record', {
          telegramId,
          reason,
          service: 'ban-storage'
        });
      } else {
        // Create new record
        await sqliteService.db.run(
          `INSERT INTO scammers (
            user_id, 
            reason, 
            reported_by, 
            evidence, 
            verified
          ) VALUES (?, ?, ?, ?, ?)`,
          [telegramId, reason, reportedBy, evidence, verified ? 1 : 0]
        );
        
        logger.info('Added new scammer record', {
          telegramId,
          reason,
          service: 'ban-storage'
        });
      }
      
      // Return updated record
      return sqliteService.db.get(
        'SELECT * FROM scammers WHERE user_id = ?',
        [telegramId]
      );
    }, 'markAsScammer');
  }

  /**
   * Get all bans for a chat
   * @param {String} chatId - Chat ID
   * @returns {Promise<Array>} - List of bans
   */
  async getChatBans(chatId) {
    await this.ensureInitialized();
    
    return this._resilientOperation(async () => {
      const bans = await sqliteService.db.all(
        `SELECT * FROM bans 
         WHERE chat_id = ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY banned_at DESC`,
        [chatId, Date.now()]
      );
      
      return bans.map(ban => ({
        userId: ban.user_id,
        chatId: ban.chat_id,
        reason: ban.reason,
        bannedBy: ban.banned_by,
        bannedAt: ban.banned_at,
        expiresAt: ban.expires_at,
        propagate: ban.propagate === 1
      }));
    }, 'getChatBans');
  }

  /**
   * Get all propagated bans
   * @returns {Promise<Array>} - List of propagated bans
   */
  async getPropagatedBans() {
    await this.ensureInitialized();
    
    return this._resilientOperation(async () => {
      // Get propagated bans
      const propagatedBans = await sqliteService.db.all(
        `SELECT * FROM bans 
         WHERE propagate = 1 AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY banned_at DESC`,
        [Date.now()]
      );
      
      // Get verified scammers
      const scammers = await sqliteService.db.all(
        'SELECT * FROM scammers WHERE verified = 1 ORDER BY reported_at DESC'
      );
      
      // Combine results
      const result = [
        ...propagatedBans.map(ban => ({
          userId: ban.user_id,
          chatId: ban.chat_id,
          reason: ban.reason,
          bannedBy: ban.banned_by,
          bannedAt: ban.banned_at,
          expiresAt: ban.expires_at,
          propagate: true,
          type: 'ban'
        })),
        ...scammers.map(scammer => ({
          userId: scammer.user_id,
          chatId: 'global',
          reason: scammer.reason,
          bannedBy: scammer.reported_by,
          bannedAt: scammer.reported_at,
          expiresAt: null,
          propagate: true,
          type: 'scammer'
        }))
      ];
      
      return result;
    }, 'getPropagatedBans');
  }

  /**
   * Enable or disable AI-powered scam detection
   * @param {Boolean} enabled - Whether AI detection should be enabled
   * @param {Object} options - Additional options
   * @returns {Boolean} - Success status
   */
  setAIDetectionEnabled(enabled, options = {}) {
    this.aiAnalysisEnabled = !!enabled;
    
    if (options.confidenceThreshold && 
        options.confidenceThreshold >= 0 && 
        options.confidenceThreshold <= 1) {
      this.aiConfidenceThreshold = options.confidenceThreshold;
    }
    
    if (typeof options.useAIForAllMessages === 'boolean') {
      this.useAIForAllMessages = options.useAIForAllMessages;
    }
    
    logger.info('AI scam detection settings updated', {
      enabled: this.aiAnalysisEnabled,
      threshold: this.aiConfidenceThreshold,
      allMessages: this.useAIForAllMessages,
      service: 'ban-storage'
    });
    
    return true;
  }
}

module.exports = new BanStorage(); 