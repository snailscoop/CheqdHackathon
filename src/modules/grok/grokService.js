/**
 * Grok Service
 * 
 * Provides natural language processing and function execution for bot commands.
 * Integrates with Grok AI for enhanced conversation handling and function calling.
 * 
 * SQLite-based implementation with improved reliability and performance.
 */

const logger = require('../../utils/logger');
const config = require('../../config/config');
const sqliteService = require('../../db/sqliteService');
const credentialNlpService = require('./credentialNlpService');
const { functionDefinitions, getFunctionDefinition } = require('./functionDefinitions');
const systemPrompts = require('./systemPrompts');
const { OpenAI } = require('openai');

// Initialize the OpenAI client for Grok API access
let openai;
try {
  // Use Grok API configuration with OpenAI client
  openai = new OpenAI({
    apiKey: process.env.GROK_API_KEY || config.grok?.apiKey,
    baseURL: process.env.GROK_API_ENDPOINT || config.grok?.baseUrl || 'https://api.grok.ai/v1'
  });
  logger.info('OpenAI client initialized with Grok API configuration');
} catch (error) {
  logger.warn('Failed to initialize OpenAI client', { error: error.message });
  openai = null;
}

// Cache for user roles
const userRoleCache = new Map();
const ROLE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Add conversation context cache
const conversationContextCache = new Map();
const CONTEXT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_HISTORY_LENGTH = 10; // Maximum number of messages to retain in history

// Create a class for better 'this' context handling
class GrokServiceImpl {
  constructor() {
    this.initialized = false;
    this.model = process.env.GROK_MODEL || config.grok?.model || 'grok-1';
  }
  
  /**
   * Generate a conversational quiz based on video content
   * @param {Object} options - Quiz generation options
   * @returns {Promise<Object>} - Generated quiz
   */
  async generateConversationalQuiz(options) {
    try {
      logger.info('Generating conversational quiz');
      
      const content = options.content;
      const questionCount = options.questionCount || 3;
      const difficulty = options.difficulty || 'medium';
      
      // Build the prompt with content information
      let promptContent = `Create a conversational quiz about Crypto Dungeon blockchain technology for an educational video with the following information:
  
  TITLE: ${content.title || 'Educational Video about Crypto Dungeon'}
  
  OVERVIEW: ${content.overview || 'Educational content about Crypto Dungeon blockchain technology'}
  
  TOPIC: Crypto Dungeon blockchain technology
  
  KEY POINTS:
  ${content.keyPoints ? content.keyPoints.map(point => `- ${point}`).join('\n') : 'Not provided'}`;
  
      if (content.transcription) {
        promptContent += `\n\nTRANSCRIPT EXCERPT:
  ${content.transcription.substring(0, 2000)}...`;
      }
      
      promptContent += `\n\nPlease create a conversational quiz about Crypto Dungeon blockchain technology with ${questionCount} questions of ${difficulty} difficulty. 
  
  The quiz should:
  1. Test understanding of blockchain and crypto concepts related to Crypto Dungeon
  2. Focus EXCLUSIVELY on blockchain/crypto aspects, NOT on unrelated visual elements
  3. Be conversational in nature (not multiple choice)
  4. Include reference answers for evaluation
  5. Be engaging and educational
  6. Connect all questions directly to blockchain, cryptocurrency, or digital assets concepts
  
  Format your response as a valid JSON object with these fields:
  - title: A title for the quiz
  - description: A brief description
  - difficulty: ${difficulty}
  - questions: An array of question objects, each with:
    - id: Question number
    - question: The question text
    - referenceAnswer: A comprehensive reference answer
    - evaluationCriteria: Points to look for in user responses
    - followUp: A follow-up question or comment to continue the conversation
  
  Ensure the entire response is valid JSON.`;
      
      const requestData = {
        model: this.model,
        stream: false,
        max_tokens: 2000,
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert blockchain educator specializing in Crypto Dungeon and blockchain technology. Your task is to create engaging conversational quizzes STRICTLY about blockchain concepts. Your quizzes should be educational, challenging, and focused exclusively on blockchain/crypto topics. YOUR MOST IMPORTANT TASK IS TO CREATE QUESTIONS THAT DIRECTLY RELATE TO CRYPTO DUNGEON BLOCKCHAIN TECHNOLOGY AND CRYPTO CONCEPTS ONLY. NEVER CREATE QUESTIONS ABOUT UNRELATED VISUAL ELEMENTS LIKE BRICKS, GENERAL IMAGES, OR NON-BLOCKCHAIN TOPICS.'
          },
          { 
            role: 'user', 
            content: promptContent
          }
        ]
      };
      
      const response = await this._makeRequest(requestData);
      
      // Parse the JSON from the response
      const quizText = response.choices[0].message.content;
      let quiz;
      
      try {
        quiz = JSON.parse(quizText);
      } catch (parseError) {
        // If parsing fails, try to extract JSON using regex
        const jsonMatch = quizText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            quiz = JSON.parse(jsonMatch[0]);
          } catch (nestedError) {
            // If that fails too, create a structured quiz from the text
            quiz = this._createFallbackQuiz(content, difficulty, questionCount);
          }
        } else {
          quiz = this._createFallbackQuiz(content, difficulty, questionCount);
        }
      }
      
      logger.info('Conversational quiz generated successfully', { 
        title: quiz.title, 
        questions: quiz.questions?.length 
      });
      
      return quiz;
    } catch (error) {
      logger.error('Error generating conversational quiz', { error: error.message });
      // Return a fallback quiz
      return this._createFallbackQuiz(options.content, options.difficulty, options.questionCount);
    }
  }
  
  /**
   * Evaluate a user's response to a quiz question
   * @param {Object} options - Evaluation options
   * @returns {Promise<Object>} - Evaluation result
   */
  async evaluateQuizResponse(options) {
    try {
      logger.info('Evaluating quiz response');
      
      const { question, userResponse, videoContext } = options;
      
      const requestData = {
        model: this.model,
        stream: false,
        max_tokens: 1000,
        messages: [
          { 
            role: 'system', 
            content: 'You are an educational assessment expert. Your task is to evaluate student responses to conversational quiz questions in a supportive, encouraging, and educational manner. Be generous in your scoring and focus primarily on what the student got right rather than wrong. Provide constructive and encouraging feedback that helps users learn and improve.'
          },
          { 
            role: 'user', 
            content: `Evaluate this student response to a quiz question about an educational video.
  
  QUESTION: ${question.question}
  
  REFERENCE ANSWER: ${question.referenceAnswer}
  
  EVALUATION CRITERIA:
  ${question.evaluationCriteria ? question.evaluationCriteria.join(", ") : 'None provided'}
  
  VIDEO CONTEXT: ${videoContext ? JSON.stringify(videoContext) : 'Educational video about blockchain/crypto technology'}
  
  USER'S RESPONSE: "${userResponse}"
  
  IMPORTANT EVALUATION GUIDELINES:
  - Be generous in your scoring - if the answer shows any understanding of blockchain/crypto concepts, give at least 40 points
  - Any reasonable attempt that mentions any blockchain or crypto terminology should get a minimum of 50 points
  - Focus on what's correct about blockchain concepts first before suggesting improvements
  - Provide specific, helpful feedback about blockchain/crypto ideas rather than generic comments
  - Never say the answer contains "undefined" or placeholder text
  - If the answer is brief but mentions blockchain concepts, score it 60-70
  - ALWAYS acknowledge and reward when answers mention relevant blockchain/crypto concepts
  - Focus your evaluation ONLY on blockchain/crypto understanding, not on unrelated content
  
  Format your response as a valid JSON object with these fields:
  - score: Numerical score (40-100, be generous)
  - correct: Boolean indicating if the answer is broadly correct (>65 points)
  - feedback: Your evaluation and feedback (focus on what's correct first)
  - learningAddition: Additional information to enhance understanding
  - encouragement: Supportive comment to encourage learning
  - followUpQuestion: Question to ask next based on their response`
          }
        ]
      };
      
      const response = await this._makeRequest(requestData);
      
      // Parse the JSON from the response
      const evaluationText = response.choices[0].message.content;
      let evaluation;
      
      try {
        evaluation = JSON.parse(evaluationText);
      } catch (parseError) {
        // If parsing fails, try to extract JSON using regex
        const jsonMatch = evaluationText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            evaluation = JSON.parse(jsonMatch[0]);
          } catch (nestedError) {
            // If that fails too, create a fallback evaluation
            evaluation = {
              score: 70,
              correct: true,
              feedback: "Your answer contains some good points.",
              learningAddition: "Remember to consider all aspects of the topic discussed in the video.",
              encouragement: "Keep learning and exploring this topic!",
              followUpQuestion: question.followUp || "Can you expand on your answer?"
            };
          }
        } else {
          evaluation = {
            score: 70,
            correct: true,
            feedback: "Your answer contains some good points.",
            learningAddition: "Remember to consider all aspects of the topic discussed in the video.",
            encouragement: "Keep learning and exploring this topic!",
            followUpQuestion: question.followUp || "Can you expand on your answer?"
          };
        }
      }
      
      logger.info('Quiz response evaluated', { score: evaluation.score, correct: evaluation.correct });
      
      return evaluation;
    } catch (error) {
      logger.error('Error evaluating quiz response', { error: error.message });
      
      // Return a fallback evaluation
      return {
        score: 70,
        correct: true,
        feedback: "Your answer contains some good points.",
        learningAddition: "Consider the key points from the video in your future answers.",
        encouragement: "You're making progress!",
        followUpQuestion: options.question.followUp || "Would you like to try answering in a different way?"
      };
    }
  }
  
  /**
   * Make an API request to Grok
   * @param {Object} requestData - Request data for Grok API
   * @returns {Promise<Object>} - API response
   * @private
   */
  async _makeRequest(requestData) {
    try {
      if (!openai) {
        throw new Error('OpenAI client not initialized');
      }
      
      // Override with environment variables if available
      requestData.model = this.model || process.env.GROK_MODEL || config.grok?.model || requestData.model || 'grok-1';
      
      // Call the API
      const response = await openai.chat.completions.create(requestData);
      
      if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
        throw new Error('Invalid response from Grok API');
      }
      
      return response;
    } catch (error) {
      logger.error('Error making request to Grok API', { 
        error: error.message, 
        model: requestData.model
      });
      
      // Return a mock response for demo/testing when API fails
      return {
        choices: [
          {
            message: {
              role: 'assistant',
              content: '{"title":"Fallback Quiz","description":"This is a fallback quiz due to API error","difficulty":"medium","questions":[{"id":1,"question":"What is the main topic of this content?","referenceAnswer":"The main topic relates to blockchain and digital credentials.","evaluationCriteria":["Topic identification"],"followUp":"Why is this important?"}]}'
            }
          }
        ]
      };
    }
  }
  
  /**
   * Create a fallback quiz when generation fails
   * @param {Object} content - Content information
   * @param {string} difficulty - Quiz difficulty
   * @param {number} questionCount - Number of questions
   * @returns {Object} - Fallback quiz
   * @private
   */
  _createFallbackQuiz(content, difficulty = 'medium', questionCount = 3) {
    return {
      title: `Quiz: Crypto Dungeon Blockchain Technology`,
      description: `Test your knowledge about Crypto Dungeon blockchain technology with this conversational quiz.`,
      difficulty: difficulty,
      questions: [
        {
          id: 1,
          question: `What are the key benefits of Crypto Dungeon blockchain technology compared to traditional blockchain systems?`,
          referenceAnswer: `Crypto Dungeon blockchain offers improved efficiency, enhanced security mechanisms, innovative tokenization, and unique consensus models that differentiate it from traditional blockchain systems.`,
          evaluationCriteria: ["Understanding of blockchain concepts", "Identification of crypto benefits"],
          followUp: "How might these blockchain benefits impact the future of digital assets?"
        },
        {
          id: 2,
          question: `How does Crypto Dungeon utilize smart contracts within its blockchain ecosystem?`,
          referenceAnswer: `Crypto Dungeon leverages smart contracts to automate transactions, create trustless agreements, and enable complex tokenized asset management within its blockchain ecosystem.`,
          evaluationCriteria: ["Understanding of smart contracts", "Technical blockchain knowledge"],
          followUp: "What specific blockchain features make smart contracts valuable in the Crypto Dungeon ecosystem?"
        },
        {
          id: 3,
          question: `What challenges or limitations does Crypto Dungeon face in the broader blockchain and cryptocurrency landscape?`,
          referenceAnswer: `Challenges include scalability issues common to blockchain systems, regulatory compliance concerns, competing blockchain protocols, and the need for wider adoption in the decentralized finance ecosystem.`,
          evaluationCriteria: ["Critical thinking about blockchain", "Awareness of crypto ecosystem limitations"],
          followUp: "How might these blockchain challenges be addressed through technical innovation?"
        }
      ].slice(0, questionCount)
    };
  }
}

// Create an instance of the service implementation
const grokServiceImpl = new GrokServiceImpl();

/**
 * Initialize the Grok service
 * Sets up necessary tables and configurations
 */
async function initialize() {
  try {
    logger.info('Initializing Grok service');
    
    // Create roles table if it doesn't exist
    await sqliteService.db.exec(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        chat_id INTEGER,
        role TEXT NOT NULL,
        assigned_by INTEGER,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (assigned_by) REFERENCES users(id),
        UNIQUE(user_id, chat_id)
      )
    `);
    
    // Create function_calls table to track function usage
    await sqliteService.db.exec(`
      CREATE TABLE IF NOT EXISTS function_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        chat_id INTEGER,
        function_name TEXT NOT NULL,
        parameters TEXT,
        result TEXT,
        success INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    
    // Create conversation_context table to persist conversations
    await sqliteService.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_context (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        chat_id INTEGER,
        context_data TEXT NOT NULL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, chat_id)
      )
    `);
    
    logger.info('Grok service initialized successfully');
    return true;
  } catch (error) {
    logger.error('Failed to initialize Grok service', { error: error.message });
    return false;
  }
}

/**
 * Process a command using Grok AI
 * @param {String} text - Command text
 * @param {Object} context - Message context (user, chat, etc.)
 * @returns {Promise<Object>} - Processing result
 */
async function processCommand(text, context = {}) {
  try {
    // First do a pattern match for critical moderation commands
    // This ensures high reliability for these important features
    const kickRegex = /\b(?:kick|remove|boot)\s+(?:@)?(\w+)\b/i;
    const banRegex = /\b(?:ban|block)\s+(?:@)?(\w+)\b/i;
    const muteRegex = /\b(?:mute|silence)\s+(?:@)?(\w+)\b/i;
    const modRegex = /\b(?:make|set|add)\s+(?:@)?(\w+)(?:\s+(?:a|as))?\s+(?:mod|moderator)(?:\s+(\w+))?\b/i;
    const removeModRegex = /\b(?:remove|delete|revoke)\s+(?:@)?(\w+)(?:\s+(?:as|from))?\s+(?:mod|moderator)\b/i;

    const kickMatch = text.match(kickRegex);
    const banMatch = text.match(banRegex);
    const muteMatch = text.match(muteRegex);
    const modMatch = text.match(modRegex);
    const removeModMatch = text.match(removeModRegex);

    if (kickMatch) {
      logger.info('Direct pattern match for kick command', { target: kickMatch[1] });
      return {
        type: 'function',
        function: 'kick_user',
        parameters: { user: kickMatch[1].replace(/^@/, '') }
      };
    }
    
    if (banMatch) {
      logger.info('Direct pattern match for ban command', { target: banMatch[1] });
      return {
        type: 'function',
        function: 'ban_user',
        parameters: { user: banMatch[1].replace(/^@/, '') }
      };
    }
    
    if (muteMatch) {
      logger.info('Direct pattern match for mute command', { target: muteMatch[1] });
      return {
        type: 'function',
        function: 'mute_user',
        parameters: { user: muteMatch[1].replace(/^@/, '') }
      };
    }
    
    if (modMatch) {
      const username = modMatch[1];
      const level = modMatch[2] || 'basic';
      logger.info('Direct pattern match for make moderator command', { target: username, level });
      return {
        type: 'function',
        function: 'make_moderator',
        parameters: { 
          user: username.replace(/^@/, ''),
          level: level.toLowerCase()
        }
      };
    }
    
    if (removeModMatch) {
      const username = removeModMatch[1];
      logger.info('Direct pattern match for remove moderator command', { target: username });
      return {
        type: 'function',
        function: 'remove_moderator',
        parameters: { 
          user: username.replace(/^@/, '')
        }
      };
    }

    // Direct pattern matching for education features
    const quizRegex = /\b(?:start|take|begin|create|do)\s+(?:a\s+)?(?:quiz|test)(?:\s+(?:about|on)\s+)?([a-zA-Z0-9 ]+)?/i;
    const progressRegex = /\b(?:check|show|view|get)(?:\s+my)?\s+(?:progress|stats|achievements|learning)/i;
    
    const quizMatch = text.match(quizRegex);
    const progressMatch = progressRegex.test(text);
    
    if (quizMatch) {
      const topic = quizMatch[1]?.trim() || 'blockchain';
      logger.info('Direct pattern match for quiz command', { topic });
      return {
        type: 'function',
        function: 'generate_quiz',
        parameters: { topic, difficulty: 'medium' }
      };
    }
    
    if (progressMatch) {
      logger.info('Direct pattern match for progress command');
      return {
        type: 'function',
        function: 'show_progress',
        parameters: {}
      };
    }
    
    // Direct pattern matching for support features
    const checkTierRegex = /\b(?:check|show|view|get)(?:\s+my)?\s+(?:support|tier|subscription)/i;
    const upgradeTierRegex = /\b(?:upgrade|subscribe)(?:\s+to)?(?:\s+the)?(?:\s+(?:support|tier))?(?:\s+(?:level|plan))?\s+([a-zA-Z]+)/i;
    
    const checkTierMatch = checkTierRegex.test(text);
    const upgradeTierMatch = text.match(upgradeTierRegex);
    
    if (checkTierMatch) {
      logger.info('Direct pattern match for check tier command');
      return {
        type: 'function',
        function: 'check_support_tier',
        parameters: {}
      };
    }
    
    if (upgradeTierMatch) {
      const targetTier = upgradeTierMatch[1]?.trim().toLowerCase() || 'standard';
      logger.info('Direct pattern match for upgrade tier command', { targetTier });
      return {
        type: 'function',
        function: 'upgrade_support_tier',
        parameters: { target_tier: targetTier }
      };
    }

    // Next check if it's a credential-related request
    const credentialResult = await credentialNlpService.processCredentialCommand(text, context);
    
    if (credentialResult.isCredentialOperation && credentialResult.confidence > 0.7) {
      logger.debug('Credential operation detected', { intent: credentialResult.intent });
      return {
        type: 'credential',
        result: credentialResult
      };
    }
    
    // If not matched by patterns, use Grok AI for more flexible understanding
    const user = context.user || {};
    const chat = context.chat || {};
    
    // Get conversation history for this user/chat
    const conversationHistory = await getConversationContext(user.id, chat.id);
    
    // Build system prompt
    const systemPromptOptions = {
      user,
      chat,
      domain: 'all',
      includeExamples: true
    };
    
    // Track conversation in database and update context
    await trackConversation(user.id, chat.id, text);
    
    // Add the current user message to history
    updateConversationContext(user.id, chat.id, {
      role: 'user',
      content: text
    });
    
    // Call Grok API with conversation history
    const response = await callGrokApi(text, systemPromptOptions, context, conversationHistory);
    
    // Process the response
    const result = processGrokResponse(response, context);
    
    // If the result contains a message, add it to the conversation history
    if (result.type === 'text' && result.message) {
      updateConversationContext(user.id, chat.id, {
        role: 'assistant',
        content: result.message
      });
    } else if (result.type === 'function') {
      // For function calls, add a note about the action
      updateConversationContext(user.id, chat.id, {
        role: 'assistant', 
        content: `Executed function: ${result.function} with parameters: ${JSON.stringify(result.parameters)}`
      });
    }
    
    return result;
  } catch (error) {
    logger.error('Error processing command', { error: error.message });
    return {
      type: 'error',
      message: 'Sorry, I encountered an error processing your request.'
    };
  }
}

/**
 * Call the Grok API
 * @param {String} text - User input
 * @param {Object} systemPromptOptions - Options for system prompt
 * @param {Object} context - Additional context
 * @param {Array} conversationHistory - Previous conversation messages
 * @returns {Promise<Object>} - API response
 */
async function callGrokApi(text, systemPromptOptions, context, conversationHistory = []) {
  try {
    // If openai client is not available, return a mock response
    if (!openai) {
      logger.warn('OpenAI client not available, using mock response');
      return mockGrokResponse(text, systemPromptOptions, conversationHistory);
    }
    
    // Build enhanced system message with function call specific instructions
    const enhancedSystemMessage = systemPrompts.getFunctionCallPrompt(systemPromptOptions);
    
    // Build the messages array with conversation history
    const messages = [
      { role: 'system', content: enhancedSystemMessage }
    ];
    
    // Add conversation history (limited to last MAX_HISTORY_LENGTH messages)
    if (conversationHistory && conversationHistory.length > 0) {
      messages.push(...conversationHistory.slice(-MAX_HISTORY_LENGTH));
    }
    
    // Add current user message if not already included in history
    const userMessageExists = conversationHistory.some(
      msg => msg.role === 'user' && msg.content === text
    );
    
    if (!userMessageExists) {
      messages.push({ role: 'user', content: text });
    }
    
    // Make the API call with function definitions
    const response = await openai.chat.completions.create({
      model: config.grok?.model || 'grok-3-beta',
      messages: messages,
      functions: functionDefinitions,
      function_call: 'auto',
      temperature: 0.2, // Lower temperature for more consistent intent recognition
      max_tokens: 500
    });
    
    return response;
  } catch (error) {
    logger.error('Error calling Grok API', { error: error.message });
    return mockGrokResponse(text, systemPromptOptions, conversationHistory);
  }
}

/**
 * Create a mock response when the API is not available
 * @param {String} text - User input
 * @param {Object} systemPromptOptions - Options for system prompt
 * @param {Array} conversationHistory - Previous conversation messages
 * @returns {Object} - Mock response object
 */
function mockGrokResponse(text, systemPromptOptions, conversationHistory = []) {
  logger.info('Using mock Grok response');
  
  // Simple response generator that considers conversation history
  let responseText = 'I\'m currently operating in offline mode with limited capabilities.';
  
  // Check if there's relevant context in conversation history
  const hasContextAbout = (topic) => {
    return conversationHistory.some(msg => 
      msg.content.toLowerCase().includes(topic.toLowerCase())
    );
  };
  
  if (text.toLowerCase().includes('hello') || text.toLowerCase().includes('hi')) {
    responseText = 'Hello! I\'m Dail, the Cheqd assistant. How can I help you today?';
  } else if (text.toLowerCase().includes('help')) {
    responseText = 'I can help you with information about Cheqd, verifiable credentials, and DIDs. What would you like to know?';
  } else if (text.toLowerCase().includes('cheqd')) {
    responseText = 'Cheqd is a purpose-built network for decentralized identity, designed to make verifiable credentials mainstream.';
  } else if (hasContextAbout('quiz') || text.toLowerCase().includes('quiz')) {
    responseText = 'I remember we were discussing quizzes. Would you like to start a quiz about blockchain technology?';
  } else if (hasContextAbout('support') || text.toLowerCase().includes('support')) {
    responseText = 'Based on our conversation, I see you\'re interested in support tiers. Would you like to check your current tier or upgrade?';
  }
  
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: responseText
        }
      }
    ]
  };
}

/**
 * Process the Grok API response
 * @param {Object} response - API response
 * @param {Object} context - Message context
 * @returns {Promise<Object>} - Processed response
 */
async function processGrokResponse(response, context) {
  try {
    const message = response.choices[0].message;
    
    // Check if there's a function call
    if (message.function_call) {
      const functionName = message.function_call.name;
      let parameters;
      
      try {
        parameters = JSON.parse(message.function_call.arguments);
      } catch (e) {
        logger.warn('Error parsing function arguments', { error: e.message });
        parameters = {};
      }
      
      logger.debug('Function call detected', { function: functionName, parameters });
      
      // Parameter enhancement for special function types
      if (['kick_user', 'ban_user', 'mute_user'].includes(functionName) && !parameters.user) {
        // Try to extract user from the original message for moderation functions
        const userRegex = /\b(?:@)?(\w+)\b/i;
        const matches = context.originalText?.match(userRegex);
        
        if (matches && matches[1]) {
          const potentialUser = matches[1].toLowerCase();
          
          // Don't use words that are likely commands rather than usernames
          const nonUserwords = ['kick', 'ban', 'mute', 'dail', 'remove', 'please', 'can', 'you'];
          
          if (!nonUserwords.includes(potentialUser)) {
            parameters.user = potentialUser;
            logger.debug('Extracted user from message', { user: potentialUser });
          }
        }
      } else if (['generate_quiz', 'learn_topic'].includes(functionName) && !parameters.topic) {
        // Set default topic for education functions if missing
        parameters.topic = 'blockchain';
        logger.debug('Set default topic for education function');
      } else if (['upgrade_support_tier'].includes(functionName) && !parameters.target_tier) {
        // Set default tier for support functions if missing
        parameters.target_tier = 'standard';
        logger.debug('Set default tier for support function');
      }
      
      // Track function call in database
      await trackFunctionCall(
        context.user?.id, 
        context.chat?.id, 
        functionName, 
        parameters
      );
      
      return {
        type: 'function',
        function: functionName,
        parameters: parameters
      };
    } else {
      // Regular text response - Check if we should convert to a function call based on content
      const content = message.content || '';
      
      // Try to derive moderation actions from text responses
      const kickMatch = content.match(/(?:kick|remove|boot)\s+(?:@)?(\w+)/i);
      const banMatch = content.match(/(?:ban|block)\s+(?:@)?(\w+)/i);
      const muteMatch = content.match(/(?:mute|silence)\s+(?:@)?(\w+)/i);
      
      if (kickMatch) {
        const user = kickMatch[1];
        logger.info('Converted text response to kick function', { user });
        return {
          type: 'function',
          function: 'kick_user',
          parameters: { user }
        };
      }
      
      if (banMatch) {
        const user = banMatch[1];
        logger.info('Converted text response to ban function', { user });
        return {
          type: 'function',
          function: 'ban_user',
          parameters: { user }
        };
      }
      
      if (muteMatch) {
        const user = muteMatch[1];
        logger.info('Converted text response to mute function', { user });
        return {
          type: 'function',
          function: 'mute_user',
          parameters: { user }
        };
      }
      
      // Try to derive education actions
      const quizMatch = content.match(/quiz(?:.+?)(?:about|on)\s+([a-zA-Z0-9 ]+)/i);
      if (quizMatch || content.toLowerCase().includes('start a quiz')) {
        const topic = quizMatch ? quizMatch[1].trim() : 'blockchain';
        logger.info('Converted text response to quiz function', { topic });
        return {
          type: 'function',
          function: 'generate_quiz',
          parameters: { topic }
        };
      }
      
      if (content.toLowerCase().includes('progress') || 
          content.toLowerCase().includes('achievement') || 
          content.toLowerCase().includes('learning status')) {
        logger.info('Converted text response to progress function');
        return {
          type: 'function',
          function: 'show_progress',
          parameters: {}
        };
      }
      
      // Try to derive support actions
      if (content.toLowerCase().includes('support tier') || 
          content.toLowerCase().includes('subscription status')) {
        logger.info('Converted text response to check tier function');
        return {
          type: 'function',
          function: 'check_support_tier',
          parameters: {}
        };
      }
      
      const upgradeTierMatch = content.match(/upgrade(?:.+?)(?:to)\s+([a-zA-Z]+)\s+(?:tier|plan|subscription)/i);
      if (upgradeTierMatch) {
        const targetTier = upgradeTierMatch[1].toLowerCase();
        logger.info('Converted text response to upgrade tier function', { targetTier });
        return {
          type: 'function',
          function: 'upgrade_support_tier',
          parameters: { target_tier: targetTier }
        };
      }
      
      // Return as regular text if no functions detected
      return {
        type: 'text',
        message: content
      };
    }
  } catch (error) {
    logger.error('Error processing Grok response', { error: error.message });
    return {
      type: 'error',
      message: 'Sorry, I had trouble understanding the response.'
    };
  }
}

/**
 * Track conversation in database
 * @param {Number} userId - User ID
 * @param {Number} chatId - Chat ID
 * @param {String} text - Message text
 * @returns {Promise<void>}
 */
async function trackConversation(userId, chatId, text) {
  try {
    if (!userId) return;
    
    // We can track this in the messages table which already exists
    const message = {
      message_id: Date.now(), // Use timestamp as placeholder
      from: { id: userId },
      chat: chatId ? { id: chatId } : null,
      text: text
    };
    
    await sqliteService.saveMessage(message);
  } catch (error) {
    logger.warn('Failed to track conversation', { error: error.message });
    // Non-critical error, don't throw
  }
}

/**
 * Track function call in database
 * @param {Number} userId - User ID
 * @param {Number} chatId - Chat ID
 * @param {String} functionName - Function name
 * @param {Object} parameters - Function parameters
 * @param {String} result - Function result (optional)
 * @param {Boolean} success - Whether the call succeeded (optional)
 * @param {String} errorMessage - Error message if failed (optional)
 * @returns {Promise<void>}
 */
async function trackFunctionCall(
  userId, 
  chatId, 
  functionName, 
  parameters, 
  result = null, 
  success = null, 
  errorMessage = null
) {
  try {
    if (!userId || !functionName) return;
    
    await sqliteService.db.run(
      `INSERT INTO function_calls 
       (user_id, chat_id, function_name, parameters, result, success, error_message) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        chatId,
        functionName,
        JSON.stringify(parameters),
        result ? JSON.stringify(result) : null,
        success !== null ? (success ? 1 : 0) : null,
        errorMessage
      ]
    );
  } catch (error) {
    logger.warn('Failed to track function call', { 
      error: error.message,
      function: functionName 
    });
    // Non-critical error, don't throw
  }
}

/**
 * Update function call result
 * @param {Number} userId - User ID
 * @param {String} functionName - Function name
 * @param {Object} result - Function result
 * @param {Boolean} success - Whether the call succeeded
 * @param {String} errorMessage - Error message if failed
 * @returns {Promise<void>}
 */
async function updateFunctionResult(userId, functionName, result, success, errorMessage = null) {
  try {
    if (!userId || !functionName) return;
    
    // Get the latest function call for this user and function
    const latestCall = await sqliteService.db.get(
      `SELECT id FROM function_calls 
       WHERE user_id = ? AND function_name = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [userId, functionName]
    );
    
    if (latestCall) {
      await sqliteService.db.run(
        `UPDATE function_calls 
         SET result = ?, success = ?, error_message = ? 
         WHERE id = ?`,
        [
          JSON.stringify(result),
          success ? 1 : 0,
          errorMessage,
          latestCall.id
        ]
      );
    }
  } catch (error) {
    logger.warn('Failed to update function result', { 
      error: error.message,
      function: functionName 
    });
    // Non-critical error, don't throw
  }
}

/**
 * Get a user's role
 * @param {Number} userId - User ID
 * @param {Number} chatId - Chat ID (optional)
 * @returns {Promise<String>} - User role
 */
async function getUserRole(userId, chatId = null) {
  try {
    // Check cache first
    const cacheKey = `${userId}:${chatId || 'global'}`;
    const cachedRole = userRoleCache.get(cacheKey);
    
    if (cachedRole && cachedRole.timestamp > Date.now() - ROLE_CACHE_TTL) {
      return cachedRole.role;
    }
    
    // Query the database
    let role;
    
    if (chatId) {
      // First check chat-specific role
      role = await sqliteService.db.get(
        'SELECT role FROM user_roles WHERE user_id = ? AND chat_id = ?',
        [userId, chatId]
      );
    }
    
    if (!role) {
      // Check global role
      role = await sqliteService.db.get(
        'SELECT role FROM user_roles WHERE user_id = ? AND chat_id IS NULL',
        [userId]
      );
    }
    
    // Default to 'user' if no role found
    const userRole = role ? role.role : 'user';
    
    // Update cache
    userRoleCache.set(cacheKey, {
      role: userRole,
      timestamp: Date.now()
    });
    
    return userRole;
  } catch (error) {
    logger.error('Error getting user role', { error: error.message });
    return 'user'; // Default to user role on error
  }
}

/**
 * Set a user's role
 * @param {Number} userId - User ID
 * @param {String} role - Role to set
 * @param {Number} chatId - Chat ID (optional for global role)
 * @param {Number} assignedBy - User ID of assigner
 * @returns {Promise<Boolean>} - Success status
 */
async function setUserRole(userId, role, chatId = null, assignedBy = null) {
  try {
    // Validate role
    const validRoles = ['user', 'moderator', 'admin'];
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }
    
    // Insert or update role
    await sqliteService.db.run(
      `INSERT INTO user_roles (user_id, chat_id, role, assigned_by) 
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, chat_id) 
       DO UPDATE SET role = ?, assigned_by = ?, assigned_at = CURRENT_TIMESTAMP`,
      [userId, chatId, role, assignedBy, role, assignedBy]
    );
    
    // Update cache
    const cacheKey = `${userId}:${chatId || 'global'}`;
    userRoleCache.set(cacheKey, {
      role: role,
      timestamp: Date.now()
    });
    
    return true;
  } catch (error) {
    logger.error('Error setting user role', { error: error.message });
    return false;
  }
}

/**
 * Clear role cache
 * Used when roles are updated externally
 */
function clearRoleCache() {
  userRoleCache.clear();
}

// Export for testing (internal use)
const _getUserRole = getUserRole;

/**
 * Get conversation context for a user/chat
 * @param {Number} userId - User ID
 * @param {Number} chatId - Chat ID (optional)
 * @returns {Promise<Array>} - Conversation history
 */
async function getConversationContext(userId, chatId = null) {
  try {
    if (!userId) return [];
    
    // Generate cache key
    const cacheKey = `${userId}:${chatId || 'dm'}`;
    
    // Check if we have a cached context first
    const cachedContext = conversationContextCache.get(cacheKey);
    if (cachedContext && cachedContext.timestamp > Date.now() - CONTEXT_CACHE_TTL) {
      return cachedContext.messages;
    }
    
    // If not in cache, try to get from database
    const contextRow = await sqliteService.db.get(
      'SELECT context_data FROM conversation_context WHERE user_id = ? AND chat_id = ?',
      [userId, chatId]
    );
    
    if (contextRow) {
      try {
        const contextData = JSON.parse(contextRow.context_data);
        
        // Update cache
        conversationContextCache.set(cacheKey, {
          messages: contextData,
          timestamp: Date.now()
        });
        
        return contextData;
      } catch (e) {
        logger.warn('Failed to parse conversation context', { error: e.message });
      }
    }
    
    // If nothing found, return empty array
    return [];
  } catch (error) {
    logger.error('Error retrieving conversation context', { error: error.message });
    return [];
  }
}

/**
 * Update conversation context with a new message
 * @param {Number} userId - User ID
 * @param {Number} chatId - Chat ID (optional)
 * @param {Object} message - Message to add (role, content)
 * @returns {Promise<void>}
 */
async function updateConversationContext(userId, chatId = null, message) {
  try {
    if (!userId || !message) return;
    
    // Generate cache key
    const cacheKey = `${userId}:${chatId || 'dm'}`;
    
    // Get current context
    let currentContext = [];
    const cachedContext = conversationContextCache.get(cacheKey);
    
    if (cachedContext) {
      currentContext = cachedContext.messages;
    } else {
      // Try to get from database
      const contextRow = await sqliteService.db.get(
        'SELECT context_data FROM conversation_context WHERE user_id = ? AND chat_id = ?',
        [userId, chatId]
      );
      
      if (contextRow) {
        try {
          currentContext = JSON.parse(contextRow.context_data);
        } catch (e) {
          logger.warn('Failed to parse conversation context', { error: e.message });
        }
      }
    }
    
    // Add the new message
    currentContext.push(message);
    
    // Keep only the most recent messages
    if (currentContext.length > MAX_HISTORY_LENGTH) {
      currentContext = currentContext.slice(-MAX_HISTORY_LENGTH);
    }
    
    // Update cache
    conversationContextCache.set(cacheKey, {
      messages: currentContext,
      timestamp: Date.now()
    });
    
    // Update database (upsert)
    await sqliteService.db.run(
      `INSERT INTO conversation_context (user_id, chat_id, context_data, last_updated)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, chat_id) 
       DO UPDATE SET context_data = ?, last_updated = CURRENT_TIMESTAMP`,
      [userId, chatId, JSON.stringify(currentContext), JSON.stringify(currentContext)]
    );
  } catch (error) {
    logger.error('Error updating conversation context', { error: error.message });
    // Non-critical error, don't throw
  }
}

/**
 * Clear conversation context for a user
 * @param {Number} userId - User ID
 * @param {Number} chatId - Chat ID (optional)
 * @returns {Promise<boolean>} - Success status
 */
async function clearConversationContext(userId, chatId = null) {
  try {
    if (!userId) return false;
    
    // Generate cache key
    const cacheKey = `${userId}:${chatId || 'dm'}`;
    
    // Clear from cache
    conversationContextCache.delete(cacheKey);
    
    // Clear from database
    await sqliteService.db.run(
      'DELETE FROM conversation_context WHERE user_id = ? AND chat_id = ?',
      [userId, chatId]
    );
    
    return true;
  } catch (error) {
    logger.error('Error clearing conversation context', { error: error.message });
    return false;
  }
}

/**
 * Build system message for Grok API
 * @param {Object} user - User context
 * @param {Object} chat - Chat context
 * @returns {String} - System message
 */
function buildSystemMessage(user, chat) {
  // Basic system message
  let message = `You are Dail Bot, an AI AGENT for Telegram with the following capabilities:

1. MODERATION CAPABILITIES:
- Kick users from groups when requested (kick_user function)
- Ban users from groups when requested (ban_user function)
- Mute users in groups when requested (mute_user function)
- Set permissions for users (set_permissions function)
- Handle group management tasks (make_moderator, remove_moderator functions)

2. EDUCATION CAPABILITIES:
- Start quizzes on various topics (generate_quiz function)
- Track learning progress (show_progress function)
- Provide educational content (learn_topic function)
- Issue educational credentials (issue_credential function)
- Manage educational achievements (get_learning_activities function)

3. SUPPORT CAPABILITIES:
- Check support tier status (check_support_tier function)
- Upgrade support tiers (upgrade_support_tier function)
- Track token usage and limits
- Provide assistance based on tier level
- Manage support credentials (issue_credential function)

Your PRIMARY PURPOSE is to TAKE ACTIONS rather than just provide information.
When a user requests something, prioritize EXECUTING FUNCTIONS over giving text responses.`;

  // Add user context if available
  if (user && user.id) {
    message += `\n\nUser context:
- User ID: ${user.id}
- Username: ${user.username || 'Not provided'}`;
  }

  // Add chat context if available
  if (chat && chat.id) {
    message += `\n\nChat context:
- Chat ID: ${chat.id}
- Chat type: ${chat.type || 'Unknown'}
- Chat title: ${chat.title || 'Not provided'}`;
  }

  // Add action execution instructions
  message += `\n\nACTION EXECUTION INSTRUCTIONS:
1. Understand user commands in natural language, even with non-standard phrasing
2. Identify the specific action the user wants performed
3. Execute the appropriate function with accurate parameters
4. Handle education, support, and moderation requests without requiring specific command formats
5. Always respond with ACTIONS, not just information, whenever possible

CONVERSATION MANAGEMENT INSTRUCTIONS:
1. Maintain context across multiple interactions with the user
2. Remember previous questions, requests, and your actions
3. When a user refers to something from earlier in the conversation, use that context
4. For multi-step tasks, keep track of the current step and what's next
5. Infer unstated parameters from conversation history when appropriate

EXAMPLES OF DIRECT ACTION EXECUTION:
- "kick that spammer Bob" → Execute kick_user function with user="Bob"
- "I want to take a blockchain quiz" → Execute generate_quiz function with topic="blockchain"
- "show me my tier plan" → Execute check_support_tier function
- "upgrade me to premium" → Execute upgrade_support_tier function with target_tier="premium"
- "how am I doing with my learning" → Execute show_progress function
`;

  return message;
}

// Create the module exports
const moduleExports = {
  initialize,
  processCommand,
  getUserRole,
  setUserRole,
  clearRoleCache,
  updateFunctionResult,
  _getUserRole, // Exported for testing
  getConversationContext,
  updateConversationContext,
  clearConversationContext,
  buildSystemMessage,
  // Add the new conversational quiz methods
  generateConversationalQuiz: grokServiceImpl.generateConversationalQuiz.bind(grokServiceImpl),
  evaluateQuizResponse: grokServiceImpl.evaluateQuizResponse.bind(grokServiceImpl)
};

// Export the module
module.exports = moduleExports; 