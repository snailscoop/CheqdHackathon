/**
 * Grok Service
 * 
 * This service handles integration with the Grok AI system.
 * It provides function calling capabilities and manages the communication 
 * with the Grok backend.
 */

const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');
const sqliteService = require('../db/sqliteService');
const openaiClient = require('../utils/openaiClient');
const systemPrompts = require('../modules/grok/systemPrompts');
const fs = require('fs');
const https = require('https');
const path = require('path');
const functionRegistry = require('../modules/grok/functionRegistry');

class GrokService {
  constructor() {
    // Configure using Grok exclusively, not OpenAI
    this.apiKey = config.grok?.apiKey || process.env.GROK_API_KEY;
    this.apiUrl = config.grok?.baseUrl || 'https://api.x.ai/v1';
    this.model = config.grok?.model || process.env.GROK_MODEL || 'grok-3-beta';
    this.temperature = config.grok?.temperature || 0.7;
    this.maxTokens = config.grok?.maxTokens || 1500;
    
    // Log config for debugging
    console.log('====================== GROK CONFIG ======================');
    console.log('API Key exists:', !!this.apiKey);
    console.log('API URL:', this.apiUrl);
    console.log('Model:', this.model);
    console.log('=========================================================');
    
    this.supportedModels = {
      chat: process.env.GROK_MODEL || 'grok-3-beta',
      multimodal: process.env.GROK_VISION_MODEL || 'grok-2-vision'
    };
    
    // Initialize based on API key availability
    this.initialized = false;
    this.useMock = !this.apiKey;
    
    if (this.useMock) {
      logger.warn('GrokService initialized in mock mode (Grok API key not available)');
    } else {
      logger.info('Initialized Grok adapter with model: ' + this.model);
    }
  }

  async initialize() {
    try {
      if (!this.apiKey) {
        logger.warn('No Grok API key is set (GROK_API_KEY), Grok service will operate in mocked mode');
        this.useMock = true;
        this.initialized = true;
        return true;
      }
      
      // Test API connection if API key is available
      await this.testApiConnection();
      
      this.initialized = true;
      logger.info('Grok service initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Grok service', { error: error.message });
      // Don't throw, just operate in limited mode
      this.useMock = true;
      this.initialized = true;
      return false;
    }
  }

  async testApiConnection() {
    try {
      // Make a simple call to check if API key is valid
      const response = await axios.post(
        `${this.apiUrl}/chat/completions`,
        {
          model: this.model || this.supportedModels.chat,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          httpsAgent: new https.Agent({
            rejectUnauthorized: false
          })
        }
      );
      
      if (response.status === 200) {
        logger.info('Grok API connection successful');
        return true;
      } else {
        throw new Error(`API responded with status: ${response.status}`);
      }
    } catch (error) {
      logger.error('Grok API connection failed', { error: error.message });
      throw new Error(`Could not connect to Grok API: ${error.message}`);
    }
  }

  // Chat completion method
  async chatCompletion(messages, options = {}) {
    try {
      if (!this.apiKey) {
        // For credential-related operations, don't allow mocking
        const isCredentialOperation = messages.some(m => 
          typeof m.content === 'string' && (
            m.content.toLowerCase().includes('credential') ||
            m.content.toLowerCase().includes('issue') ||
            m.content.toLowerCase().includes('verify') ||
            m.content.toLowerCase().includes('cheqd')
          )
        );
        
        if (isCredentialOperation) {
          throw new Error('API key is required for credential operations - strict no-fallbacks policy is enforced');
        }
        
        return this.mockChatResponse(messages);
      }
      
      const response = await axios.post(
        `${this.apiUrl}/chat/completions`,
        {
          model: options.model || this.supportedModels.chat,
          messages,
          max_tokens: options.max_tokens || this.maxTokens,
          temperature: options.temperature || this.temperature,
          stream: options.stream || false,
          function_call: options.function_call,
          functions: options.functions
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          httpsAgent: new https.Agent({
            rejectUnauthorized: false
          })
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Grok chat completion failed', { error: error.message });
      throw error;
    }
  }

  // Multimodal completion method (for images)
  async multimodalCompletion(messages, options = {}) {
    try {
      if (!this.apiKey) {
        return this.mockMultimodalResponse(messages);
      }
      
      const response = await axios.post(
        `${this.apiUrl}/chat/completions`,
        {
          model: this.supportedModels.multimodal,
          messages,
          max_tokens: options.max_tokens || this.maxTokens,
          temperature: options.temperature || this.temperature
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          httpsAgent: new https.Agent({
            rejectUnauthorized: false
          })
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Grok multimodal completion failed', { error: error.message });
      throw error;
    }
  }

  // Function calling method
  async functionCall(messages, functions, options = {}) {
    try {
      if (!this.apiKey) {
        // Check if this is a credential-related function call
        const isCredentialFunction = functions.some(f => 
          f.name.includes('credential') || 
          f.name.includes('issue') ||
          f.name.includes('verify') ||
          f.name.includes('cheqd')
        );
        
        if (isCredentialFunction) {
          throw new Error('API key is required for credential function calls - strict no-fallbacks policy is enforced');
        }
        
        return this.mockFunctionCallResponse(messages, functions);
      }
      
      const response = await axios.post(
        `${this.apiUrl}/chat/completions`,
        {
          model: options.model || this.supportedModels.chat,
          messages,
          functions,
          function_call: options.function_call || 'auto',
          max_tokens: options.max_tokens || this.maxTokens,
          temperature: options.temperature || this.temperature
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          httpsAgent: new https.Agent({
            rejectUnauthorized: false
          })
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Grok function calling failed', { error: error.message });
      throw error;
    }
  }

  // Natural language understanding for credential operations
  async processCredentialQuery(userMessage, userId) {
    try {
      // Enforce strict API requirement for credential operations
      if (!this.apiKey) {
        throw new Error('API key is required for credential operations - strict no-fallbacks policy is enforced');
      }
      
      const functions = [
        {
          name: 'issue_credential',
          description: 'Issue a credential to a user',
          parameters: {
            type: 'object',
            properties: {
              credentialType: {
                type: 'string',
                enum: ['Education', 'Support', 'Moderation'],
                description: 'The type of credential to issue'
              },
              recipientId: {
                type: 'string',
                description: 'The recipient user ID'
              },
              data: {
                type: 'object',
                description: 'Additional data for the credential'
              }
            },
            required: ['credentialType', 'recipientId']
          }
        },
        {
          name: 'verify_credential',
          description: 'Verify a credential',
          parameters: {
            type: 'object',
            properties: {
              credentialId: {
                type: 'string',
                description: 'The ID of the credential to verify'
              }
            },
            required: ['credentialId']
          }
        },
        {
          name: 'get_user_credentials',
          description: 'Get the credentials for a user',
          parameters: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
                description: 'The user ID'
              },
              type: {
                type: 'string',
                description: 'Filter by credential type'
              }
            },
            required: ['userId']
          }
        }
      ];
      
      const messages = [
        {
          role: 'system',
          content: 'You are a credential assistant that helps users manage their verifiable credentials. You can issue, verify, and retrieve credentials.'
        },
        {
          role: 'user',
          content: userMessage
        }
      ];
      
      const response = await this.functionCall(messages, functions);
      
      // Process the response
      if (!response.choices || response.choices.length === 0) {
        return { text: 'Sorry, I could not understand your request.' };
      }
      
      const choice = response.choices[0];
      
      // Check if function call was made
      if (choice.message && choice.message.function_call) {
        const functionCall = choice.message.function_call;
        const functionName = functionCall.name;
        const functionArgs = JSON.parse(functionCall.arguments);
        
        // Call the actual functions based on the function name
        const cheqdService = require('./cheqdService');
        const sqliteService = require('../db/sqliteService');
        
        switch (functionName) {
          case 'issue_credential': {
            const { credentialType, recipientId, data } = functionArgs;
            
            // Get or create user DIDs
            const issuerDids = await cheqdService.getUserDids(userId);
            const recipientDids = await cheqdService.getUserDids(recipientId);
            
            let issuerDid, recipientDid;
            
            // Get or create issuer DID
            if (issuerDids && issuerDids.length > 0) {
              issuerDid = issuerDids[0].did;
            } else {
              issuerDid = await cheqdService.createDid(userId);
            }
            
            // Get or create recipient DID
            if (recipientDids && recipientDids.length > 0) {
              recipientDid = recipientDids[0].did;
            } else {
              recipientDid = await cheqdService.createDid(recipientId);
            }
            
            // Issue credential
            const credential = await cheqdService.issueCredential(
              issuerDid,
              recipientDid,
              credentialType,
              data
            );
            
            return {
              functionCall: true,
              name: functionName,
              args: functionArgs,
              result: credential,
              text: `Successfully issued ${credentialType} credential from ${issuerDid} to ${recipientDid}`
            };
          }
          
          case 'verify_credential': {
            const { credentialId } = functionArgs;
            
            // Verify credential
            const verificationResult = await cheqdService.verifyCredential(credentialId);
            
            return {
              functionCall: true,
              name: functionName,
              args: functionArgs,
              result: verificationResult,
              text: verificationResult.verified 
                ? `Credential ${credentialId} is valid and active.` 
                : `Credential ${credentialId} verification failed: ${verificationResult.reason}`
            };
          }
          
          case 'get_user_credentials': {
            const { userId: targetUserId, type } = functionArgs;
            
            // Get user DIDs
            const userDids = await cheqdService.getUserDids(targetUserId);
            
            if (!userDids || userDids.length === 0) {
              return {
                functionCall: true,
                name: functionName,
                args: functionArgs,
                result: [],
                text: `No DIDs found for user ID: ${targetUserId}`
              };
            }
            
            // Get credentials for all user DIDs
            const credentials = [];
            for (const didRecord of userDids) {
              const holderCredentials = await sqliteService.db.all(
                type
                  ? `SELECT * FROM credentials WHERE holder_did = ? AND type = ? ORDER BY issued_at DESC`
                  : `SELECT * FROM credentials WHERE holder_did = ? ORDER BY issued_at DESC`,
                type ? [didRecord.did, type] : [didRecord.did]
              );
              
              credentials.push(...holderCredentials);
            }
            
            return {
              functionCall: true,
              name: functionName,
              args: functionArgs,
              result: credentials,
              text: credentials.length > 0
                ? `Found ${credentials.length} credentials for user ${targetUserId}`
                : `No credentials found for user ${targetUserId}`
            };
          }
          
          default:
        return {
          functionCall: true,
          name: functionName,
          args: functionArgs,
              text: `Function ${functionName} not implemented yet.`
        };
        }
      }
      
      // Regular text response
      return { text: choice.message.content };
    } catch (error) {
      logger.error('Failed to process credential query', { error: error.message });
      return { text: 'Sorry, there was an error processing your request.' };
    }
  }

  // Mock responses for when API key is not available
  mockChatResponse(messages) {
    // Simulated AI response when no API key is available
    logger.info('Using mock chat response');
    
    let userMessage = '';
    
    // Find user message
    const userMsgObj = messages.find(msg => msg.role === 'user');
    if (userMsgObj) {
      if (typeof userMsgObj.content === 'string') {
        userMessage = userMsgObj.content;
      } else if (Array.isArray(userMsgObj.content)) {
        // Handle array content (typically for multimodal)
        userMessage = userMsgObj.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join(' ');
      }
    }
    
    return {
      id: `mock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `This is a mock response. No Grok API key is configured. Your message: "${userMessage.substring(0, 50)}..."`
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }

  mockMultimodalResponse(messages) {
    logger.info('Using mock multimodal response');
    
    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'I see you sent an image. This is a mocked response as the Grok API is not connected.'
          }
        }
      ]
    };
  }

  mockFunctionCallResponse(messages, functions) {
    logger.info('Using mock function call response');
    
    const userMessage = messages.find(msg => msg.role === 'user')?.content || '';
    
    // Simple logic to determine if we should return a function call
    if (userMessage.toLowerCase().includes('issue') && userMessage.toLowerCase().includes('credential')) {
      return {
        choices: [
          {
            message: {
              role: 'assistant',
              function_call: {
                name: 'issue_credential',
                arguments: JSON.stringify({
                  credentialType: 'Education',
                  recipientId: '123456',
                  data: {
                    course: 'Introduction to Blockchain',
                    score: 95
                  }
                })
              }
            }
          }
        ]
      };
    }
    
    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'I understand you want to perform an operation, but I am currently in mocked mode. With a proper API key, I could execute functions based on your request.'
          }
        }
      ]
    };
  }

  /**
   * Generate an image using Grok's image generation capabilities
   * @param {String} prompt - Text prompt describing the image to generate
   * @param {Object} options - Generation options (n, size, response_format)
   * @returns {Promise<Object>} - Generated image data
   */
  async imageGeneration(prompt, options = {}) {
    try {
      if (!this.apiKey) {
        return this.mockImageGenerationResponse(prompt);
      }
      
      logger.info('Generating image with Grok', {
        promptLength: prompt.length,
        imageCount: options.n || 1
      });
      
      // Set default options
      const generationOptions = {
        model: 'grok-2-image', // Or the appropriate model name
        prompt: prompt,
        n: options.n || 1, // Number of images to generate
        size: options.size || '1024x1024', // Image size
        response_format: options.response_format || 'url' // 'url' or 'b64_json'
      };
      
      // Call the Grok API
      const response = await axios.post(
        `${this.apiUrl}/images/generations`,
        generationOptions,
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Check response
      if (!response.data || !response.data.data) {
        throw new Error('Invalid response from Grok API');
      }
      
      return response.data;
    } catch (error) {
      logger.error('Error generating image', {
        error: error.message,
        prompt: prompt.substring(0, 100) // Log just the start of the prompt for privacy
      });
      
      throw error;
    }
  }

  /**
   * Mock image generation for when API key is not available
   * @param {String} prompt - Text prompt describing the image
   * @returns {Object} - Mock image generation response
   */
  mockImageGenerationResponse(prompt) {
    logger.info('Using mock image generation', { promptLength: prompt.length });
    
    // Return a placeholder image response
    return {
      created: Date.now(),
      data: [
        {
          url: 'https://via.placeholder.com/1024x1024?text=Mock+Image+Generation',
          revised_prompt: prompt
        }
      ]
    };
  }

  /**
   * Perform a web search using Grok's web search capabilities
   * @param {String} query - The search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} - Web search results
   */
  async webSearch(query, options = {}) {
    try {
      if (!this.apiKey) {
        return this.mockWebSearchResponse(query);
      }
      
      logger.info('Performing web search', { query });
      
      // Create messages with web search system prompt
      const messages = [
        {
          role: 'system',
          content: options.systemPrompt || 'You are a helpful assistant with web browsing capabilities. When asked to search the web, provide comprehensive, accurate results with useful information.'
        },
        {
          role: 'user',
          content: `Search the web for: ${query.trim()}`
        }
      ];
      
      // Set up web search tool
      const functions = [
        {
          name: 'web_search',
          description: 'Search the web for information',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query'
              }
            },
            required: ['query']
          }
        }
      ];
      
      // Use function calling to trigger web search
      const response = await this.functionCall(messages, functions, {
        max_tokens: options.max_tokens || 2000,
        temperature: options.temperature || 0.3
      });
      
      // Process the response
      if (!response.choices || response.choices.length === 0) {
        throw new Error('No response from API');
      }
      
      const choice = response.choices[0];
      
      // The assistant's response when using web search
      return { 
        text: choice.message.content || 'No search results found.',
        status: 'success'
      };
    } catch (error) {
      logger.error('Error performing web search', { error: error.message, query });
      return { 
        text: `I couldn't search the web for "${query}" due to an error: ${error.message}`,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Mock web search response when API key is not available
   * @param {String} query - The search query
   * @returns {Object} - Mock web search response
   */
  async mockWebSearchResponse(query) {
    // Simulate a delay to mimic network latency
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return {
      text: `Here are some search results for "${query}":\n\n` +
            `1. Example result 1: Information about ${query} and its applications.\n` +
            `2. Example result 2: How ${query} relates to blockchain technology.\n` +
            `3. Example result 3: Latest news about ${query} in the context of digital identity.\n\n` +
            `These are simulated results as the web search feature is currently in mock mode.`
    };
  }

  /**
   * Generate a chat response using the Grok AI model
   * @param {string} message - The user's message
   * @param {object} user - User information object
   * @param {array} history - Previous chat history (optional)
   * @returns {object} - The response object
   */
  async generateChatResponse(message, user, history = []) {
    try {
      if (!this.initialized) {
        return this.mockChatResponse(message);
      }
      
      // Get domain for the chat based on message content
      let domain = 'all';
      
      if (message.toLowerCase().includes('ban') || 
          message.toLowerCase().includes('kick') ||
          message.toLowerCase().includes('mute') ||
          message.toLowerCase().includes('moderat')) {
        domain = 'moderation';
      } else if (message.toLowerCase().includes('quiz') || 
                 message.toLowerCase().includes('learn') ||
                 message.toLowerCase().includes('educat') ||
                 message.toLowerCase().includes('course')) {
        domain = 'education';
      } else if (message.toLowerCase().includes('support') || 
                 message.toLowerCase().includes('tier') ||
                 message.toLowerCase().includes('plan') ||
                 message.toLowerCase().includes('premium')) {
        domain = 'support';
      }
      
      // Get system message with appropriate domain focus
      const systemPromptOptions = {
        user,
        domain,
        includeExamples: true
      };
      
      // System message for chat
      const systemMessage = {
        role: 'system',
        content: systemPrompts.getSystemPrompt(systemPromptOptions)
      };
      
      // Construct user message
      const userMessage = {
        role: 'user',
        content: message
      };
      
      // Construct messages array with system message, history, and user message
      const messages = [systemMessage];
      
      // Add history if provided (limited to last 10 messages)
      if (history && history.length > 0) {
        const limitedHistory = history.slice(-10);
        messages.push(...limitedHistory);
      }
      
      // Add current user message
      messages.push(userMessage);
      
      // Generate chat completion
      const chatResponse = await this.chatCompletion(messages, {
        temperature: 0.7,
        max_tokens: this.maxTokens || 800
      });
      
      // Track token usage (to be implemented)
      
      return {
        text: chatResponse.choices[0].message.content,
        success: true
      };
    } catch (error) {
      logger.error('Error generating chat response', { error: error.message });
      return this.mockChatResponse(message);
    }
  }

  /**
   * Process a command to determine intent and extract entities
   * @param {String} command - The command to process
   * @param {Object} context - Context information like user, chat, etc.
   * @returns {Promise<Object>} - Command processing result with intent and entities
   */
  async processCommand(command, context = {}) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      logger.info('Processing command with Grok', { 
        command: command.substring(0, 100) // Log just the start for privacy
      });
      
      // Normalize command
      const normalizedCommand = command.trim();
      
      // Quick handling for simple greetings
      const simpleGreetings = ['hi', 'hello', 'hey', 'hi there', 'hello there', 'hey there'];
      if (simpleGreetings.includes(normalizedCommand.toLowerCase())) {
        // Directly handle greetings without AI call
        const greeting = `Hello${context.firstName ? ' ' + context.firstName : ''}! How can I help you today?`;
        return {
          intent: 'greeting',
          entities: {},
          message: greeting,
          success: true
        };
      }

      // First pass: Check for explicit moderation actions using regex
      // This improves reliability for critical moderation functions
      const kickRegex = /\b(?:kick|remove|boot)\s+(?:@)?(\w+)\b/i;
      const banRegex = /\b(?:ban|block)\s+(?:@)?(\w+)\b/i;
      const muteRegex = /\b(?:mute|silence)\s+(?:@)?(\w+)\b/i;

      const kickMatch = normalizedCommand.match(kickRegex);
      const banMatch = normalizedCommand.match(banRegex);
      const muteMatch = normalizedCommand.match(muteRegex);

      if (kickMatch) {
        return {
          intent: 'kick_user',
          entities: { user: kickMatch[1] },
          message: `Executing kick action for user @${kickMatch[1]}`,
          success: true
        };
      }
      
      if (banMatch) {
        return {
          intent: 'ban_user',
          entities: { user: banMatch[1] },
          message: `Executing ban action for user @${banMatch[1]}`,
          success: true
        };
      }
      
      if (muteMatch) {
        return {
          intent: 'mute_user',
          entities: { user: muteMatch[1] },
          message: `Executing mute action for user @${muteMatch[1]}`,
          success: true
        };
      }
      
      // Check if this is a credential-related command
      // Use processCredentialQuery for credential operations
      if (normalizedCommand.toLowerCase().includes('credential') || 
          normalizedCommand.toLowerCase().includes('verify') ||
          normalizedCommand.toLowerCase().includes('issue') || 
          normalizedCommand.toLowerCase().includes('revoke')) {
        
        const result = await this.processCredentialQuery(normalizedCommand, context.userId);
        
        return {
          intent: result.name || 'credential_operation',
          entities: result.args || {},
          message: result.text,
          success: true
        };
      }

      // Check if this is a support tier related command
      if (normalizedCommand.toLowerCase().includes('tier') ||
          normalizedCommand.toLowerCase().includes('support') ||
          normalizedCommand.toLowerCase().includes('upgrade') ||
          normalizedCommand.toLowerCase().includes('subscription')) {
          
        // Handle support tier intents
        if (normalizedCommand.toLowerCase().includes('upgrade') || 
            normalizedCommand.toLowerCase().includes('subscribe')) {
          return {
            intent: 'upgrade_support',
            entities: { requested_tier: this._extractTierFromCommand(normalizedCommand) },
            message: 'Processing support tier upgrade request',
            success: true
          };
        }
        
        if (normalizedCommand.toLowerCase().includes('check') || 
            normalizedCommand.toLowerCase().includes('status') || 
            normalizedCommand.toLowerCase().includes('what is my')) {
          return {
            intent: 'check_support_tier',
            entities: {},
            message: 'Checking your current support tier',
            success: true
          };
        }
      }

      // Check if this is a help command
      if (normalizedCommand.toLowerCase() === 'help') {
        logger.info('Direct help command matched in Grok service', { command: normalizedCommand });
        return {
          intent: 'help',
          entities: {},
          message: 'Displaying help information',
          success: true
        };
      }
      
      // Check if this is a features command
      if (normalizedCommand.toLowerCase() === 'features') {
        logger.info('Direct features command matched in Grok service', { command: normalizedCommand });
        return {
          intent: 'features',
          entities: {},
          message: 'Displaying feature configuration',
          success: true
        };
      }
      
      // Check if this is a make moderator command
      const modPattern = /(?:make|set|add)\s+(?:@)?(\w+)(?:\s+(?:a|as))?\s+(?:mod|moderator)(?:\s+(\w+))?/i;
      const modMatch = normalizedCommand.match(modPattern);
      if (modMatch) {
        const username = modMatch[1].replace('@', '');
        const role = modMatch[2] || 'basic';
        
        logger.info('Direct pattern match for make moderator command in Grok service', { 
          target: username, 
          role: role 
        });
        
        return {
          intent: 'make_moderator',
          entities: {
            user: username,
            level: role.toLowerCase()
          },
          message: `Making ${username} a moderator with ${role} level`,
          success: true
        };
      }
      
      // Check if this is a DID-related command 
      const didCheckPattern = /(?:what\s+(?:are|is)|check|show|list|view|see|get)\s+my\s+did(?:s)?/i;
      if (didCheckPattern.test(normalizedCommand.toLowerCase())) {
        logger.info('Direct DID listing pattern matched in Grok service', { command: normalizedCommand });
        return {
          intent: 'my_dids',
          entities: {},
          message: 'Retrieving your DIDs',
          success: true
        };
      }
      
      // Check if this is an educational command
      if (normalizedCommand.toLowerCase().includes('quiz') || 
          normalizedCommand.toLowerCase().includes('course') ||
          normalizedCommand.toLowerCase().includes('learn') ||
          normalizedCommand.toLowerCase().includes('progress') || 
          normalizedCommand.toLowerCase().includes('study')) {
          
        if (normalizedCommand.toLowerCase().includes('start') || 
            normalizedCommand.toLowerCase().includes('take') || 
            normalizedCommand.toLowerCase().includes('begin')) {
          return {
            intent: 'start_quiz',
            entities: { topic: this._extractTopicFromCommand(normalizedCommand) },
            message: 'Preparing quiz for you',
            success: true
          };
        }
        
        if (normalizedCommand.toLowerCase().includes('progress') || 
            normalizedCommand.toLowerCase().includes('status') || 
            normalizedCommand.toLowerCase().includes('stats')) {
          return {
            intent: 'check_progress',
            entities: {},
            message: 'Checking your educational progress',
            success: true
          };
        }
      }
      
      // For general conversation, use direct chat completion instead of function calling
      if (normalizedCommand.length < 20 || 
          !normalizedCommand.includes(' ') ||
          normalizedCommand.endsWith('?')) {
        
        try {
          const chatResponse = await this.chatCompletion([
            {
              role: 'system',
              content: `You are Dail Bot, an AI assistant for Telegram with the following capabilities:

- Managing verifiable credentials on the Cheqd network
- Creating and managing DIDs (Decentralized Identifiers)
- Providing educational content about blockchain and digital identity
- Answering questions about the Cheqd ecosystem
- Supporting users with blockchain access and technical questions

MODERATION CAPABILITIES:
- You MUST identify moderation intents like kick_user, ban_user, and mute_user when users request these actions
- You MUST extract the target username as an entity when users request moderation actions
- You HAVE FULL PERMISSION to kick, ban, and mute users when an admin issues the command through you
- When asked about your ability to kick someone, say: "Yes, I can kick users. Just type '/dail kick @username'"
- When asked to kick someone, IMMEDIATELY identify this as a moderation action

EDUCATION CAPABILITIES:
- Identify quiz-related requests with start_quiz intent
- Identify educational progress requests with check_progress intent
- Extract topic names for educational content

SUPPORT CAPABILITIES:
- Identify support tier requests with check_support_tier or upgrade_support intents
- Extract requested tier levels from upgrade requests

IMPORTANT: You MUST correctly classify user intents to enable action execution. Do not default to general_chat for specific actions.

Provide helpful, concise responses to user queries about these topics.`
            },
            {
              role: 'user',
              content: normalizedCommand
            }
          ], {
            temperature: 0.3, // Lower temperature for more consistent intent recognition
            max_tokens: 300
          });
          
          if (chatResponse?.choices?.length > 0) {
            // Try to extract action intents from general chat responses
            const responseText = chatResponse.choices[0].message.content;
            
            // Check if response indicates a moderation action
            if (responseText.toLowerCase().includes('kick') && responseText.toLowerCase().includes('@')) {
              const usernameMatch = responseText.match(/@(\w+)/);
              if (usernameMatch) {
                return {
                  intent: 'kick_user',
                  entities: { user: usernameMatch[1] },
                  message: responseText,
                  success: true
                };
              }
            }
            
            return {
              intent: 'general_chat',
              entities: {},
              message: responseText,
              success: true
            };
          }
        } catch (chatError) {
          logger.warn('Error getting chat response', { error: chatError.message });
          // Continue to function calling approach
        }
      }
      
      // Create messages for intent detection
      const messages = [
        {
          role: 'system',
          content: `You are an AI assistant that analyzes user commands to identify the intent and extract relevant entities.
Intent categories include:
- DID management (create_did, list_dids)
- Credential operations (issue_credential, verify_credential, revoke_credential)
- Moderation actions (ban_user, unban_user, kick_user, mute_user, unmute_user, restrict_user, make_moderator, remove_moderator)
- Chat settings (enable_antispam, disable_antispam, set_permissions)
- Educational queries (learn_topic, check_progress, start_quiz)
- Support operations (check_support_tier, upgrade_support)
- Blockchain queries (check_transaction, get_balance)
- Media operations (analyze_image, generate_image)
- Help and status (check_status, help, show_commands)
- General chat (greeting, farewell, gratitude, general_question)

EXPLICIT MODERATION INSTRUCTION:
- If the user mentions kicking, banning, or muting ANYONE, you MUST classify it as kick_user/ban_user/mute_user
- Even indirect mentions like "remove X from the chat" should be classified as kick_user
- NEVER classify moderation requests as general_chat
- Include the target username in the entities with the key "user"
- Remove the @ symbol from usernames when storing in entities

EXAMPLE MODERATION CLASSIFICATIONS:
- "kick @Bob" → intent: "kick_user", entities: {"user": "Bob"}
- "please remove Alice from this group" → intent: "kick_user", entities: {"user": "Alice"}
- "can you ban Charlie" → intent: "ban_user", entities: {"user": "Charlie"}
- "I want Dave to be muted" → intent: "mute_user", entities: {"user": "Dave"}

When in doubt about a potential moderation request, always classify it as the appropriate moderation action.

Format your response as JSON with the following structure:
{
  "intent": "detected_intent",
  "entities": {
    "entity_name": "entity_value"
  },
  "confidence": 0.0-1.0 (how confident you are in this classification)
}`
        },
        {
          role: 'user',
          content: normalizedCommand
        }
      ];

      // Get completion from API
      try {
        const response = await this.functionCall(messages, [{
          name: "classify_intent",
          description: "Classifies the user's intent and extracts entities",
          parameters: {
            type: "object",
            properties: {
              intent: {
                type: "string",
                description: "The detected intent"
              },
              entities: {
                type: "object",
                description: "Extracted entities as key-value pairs"
              },
              confidence: {
                type: "number",
                description: "Confidence score between 0.0 and 1.0"
              }
            },
            required: ["intent"]
          }
        }]);

        if (!response || !response.choices || response.choices.length === 0) {
          return {
            intent: 'error',
            entities: {},
            message: 'Failed to understand command',
            success: true
          };
        }

        const choice = response.choices[0];
        
        // Check if there's a function call
        if (choice.message && choice.message.function_call) {
          const functionName = choice.message.function_call.name;
          if (functionName === 'classify_intent') {
            try {
              const functionArgs = JSON.parse(choice.message.function_call.arguments);
              
              // Special handling for moderation intents
              if (['kick_user', 'ban_user', 'mute_user'].includes(functionArgs.intent)) {
                // Ensure we have a user entity
                if (!functionArgs.entities?.user && normalizedCommand.match(/\b\w+\b/g)) {
                  // Try to extract a username as fallback
                  const words = normalizedCommand.match(/\b\w+\b/g);
                  // Get last word that's not a moderation action as potential username
                  const potentialUsername = words.filter(word => 
                    !['kick', 'ban', 'mute', 'remove'].includes(word.toLowerCase())
                  ).pop();
                  
                  if (potentialUsername) {
                    functionArgs.entities = functionArgs.entities || {};
                    functionArgs.entities.user = potentialUsername;
                  }
                }
                
                // Sanitize username (remove @ if present)
                if (functionArgs.entities?.user) {
                  functionArgs.entities.user = functionArgs.entities.user.replace(/^@/, '');
                }
                
                logger.info('Moderation intent detected', {
                  intent: functionArgs.intent,
                  user: functionArgs.entities?.user
                });
              }
              
              if (chatResponse?.choices?.length > 0) {
                return {
                  intent: functionArgs.intent,
                  entities: functionArgs.entities || {},
                  confidence: functionArgs.confidence || 0.7,
                  message: chatResponse.choices[0].message.content,
                  success: true
                };
              }
            
              return {
                intent: functionArgs.intent,
                entities: functionArgs.entities || {},
                confidence: functionArgs.confidence || 0.7,
                message: `Intent detected: ${functionArgs.intent}`,
                success: true
              };
            } catch (e) {
              logger.error('Error parsing function arguments', { error: e.message });
            }
          }
        }
        
        // Regular text response if no function call - use the content directly
        return {
          intent: 'general_chat',
          entities: {},
          message: choice.message.content || "I'm not sure how to help with that. Could you try asking something else?",
          success: true
        };
      } catch (error) {
        logger.error('Error calling function API', { error: error.message });
        // Fall back to general chat
        return {
          intent: 'general_chat',
          entities: {},
          message: "I'm not sure how to process that request right now. Could you try again with different wording?",
          success: true
        };
      }
    } catch (error) {
      logger.error('Error processing command', { error: error.message });
      
      // Even on error, return success: true with fallback message so the bot can respond
      return {
        intent: 'error',
        entities: {},
        message: `I'm sorry, I ran into a problem processing your request. How can I help you in a different way?`,
        success: true,
        error: error.message
      };
    }
  }
  
  /**
   * Extract tier from command text
   * @private
   */
  _extractTierFromCommand(command) {
    const tiers = ['basic', 'standard', 'premium', 'enterprise'];
    const text = command.toLowerCase();
    
    for (const tier of tiers) {
      if (text.includes(tier)) {
        return tier;
      }
    }
    
    return 'standard'; // Default tier
  }
  
  /**
   * Extract topic from command text
   * @private
   */
  _extractTopicFromCommand(command) {
    // Strip common phrases and extract what's likely the topic
    const text = command.toLowerCase()
      .replace(/start|begin|take|quiz|about|on/g, '')
      .trim();
    
    if (text) {
      return text;
    }
    
    // Default topics
    const defaultTopics = ['blockchain', 'cheqd', 'digital identity', 'verifiable credentials'];
    return defaultTopics[Math.floor(Math.random() * defaultTopics.length)];
  }

  /**
   * Stream chat completions for real-time responses
   * @param {Array} messages - Array of message objects
   * @param {Object} options - Options for the completion
   * @param {Function} onChunk - Callback for each chunk received
   * @returns {Promise<Object>} - Stream result object
   */
  async streamChat(messages, options = {}, onChunk = null) {
    try {
      if (!this.apiKey) {
        // Can't do streaming in mock mode, fall back to regular chat
        const mockResponse = await this.mockChatResponse(messages);
        if (onChunk && typeof onChunk === 'function') {
          onChunk(mockResponse.choices[0].message.content);
        }
        return {
          success: true,
          content: mockResponse.choices[0].message.content,
          finish_reason: 'mock'
        };
      }
      
      logger.info('Starting streaming chat', {
        messageCount: messages.length
      });
      
      // Prepare request options
      const requestOptions = {
        model: options.model || this.supportedModels.chat,
        messages: messages,
        max_tokens: options.max_tokens || 1024,
        temperature: options.temperature || 0.7,
        stream: true
      };
      
      // Add function calling if provided
      if (options.functions) {
        requestOptions.functions = options.functions;
        requestOptions.function_call = options.function_call || 'auto';
      }
      
      // Handle streaming with proper error handling
      let content = '';
      let finishReason = null;
      
      // Perform streaming request
      const response = await axios({
        method: 'post',
        url: `${this.apiUrl}/chat/completions`,
        data: requestOptions,
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        responseType: 'stream'
      });
      
      // Process stream with a promise
      await new Promise((resolve, reject) => {
        let buffer = '';
        
        response.data.on('data', (chunk) => {
          const textChunk = chunk.toString();
          buffer += textChunk;
          
          // Process complete events
          const lines = buffer.split('\n\n');
          buffer = lines.pop(); // Keep the last (potentially incomplete) part
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.substring(6); // Remove 'data: ' prefix
              
              // Handle [DONE] message
              if (data.trim() === '[DONE]') {
                resolve();
                return;
              }
              
              try {
                const parsed = JSON.parse(data);
                
                if (parsed.choices && parsed.choices.length > 0) {
                  const delta = parsed.choices[0].delta;
                  const chunkContent = delta.content || '';
                  
                  if (chunkContent) {
                    content += chunkContent;
                    
                    // Call the callback if provided
                    if (onChunk && typeof onChunk === 'function') {
                      onChunk(chunkContent, content);
                    }
                  }
                  
                  if (parsed.choices[0].finish_reason) {
                    finishReason = parsed.choices[0].finish_reason;
                  }
                }
              } catch (parseError) {
                logger.warn('Error parsing streaming chunk', { 
                  error: parseError.message,
                  data: data.substring(0, 100) 
                });
              }
            }
          }
        });
        
        response.data.on('end', () => {
          resolve();
        });
        
        response.data.on('error', (error) => {
          logger.error('Stream error', { error: error.message });
          reject(error);
        });
      });
      
      return {
        success: true,
        content,
        finish_reason: finishReason
      };
    } catch (error) {
      logger.error('Error in streaming chat', { error: error.message });
      
      return {
        success: false,
        error: error.message,
        content: '',
        finish_reason: 'error'
      };
    }
  }

  /**
   * Analyze an image and generate description
   * @param {string} imagePath - Path to image file
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeImage(imagePath, options = {}) {
    try {
      logger.info('Analyzing image', { imagePath });
      
      if (!fs.existsSync(imagePath)) {
        throw new Error(`Image file not found: ${imagePath}`);
      }
      
      // Read the image file as base64
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      
      // Simplified prompt for better success rate
      const messages = [
        {
          role: 'system',
          content: 'You are an expert at analyzing video frames. Objectively describe what is visible in this frame.'
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            { type: 'text', text: 'Describe everything visible in this video frame as objectively as possible.' }
          ]
        }
      ];
      
      // Use mock response if no API key is available
      if (!this.apiKey) {
        logger.warn('No API key provided for Grok API request');
        logger.info('Using mock chat response');
        return this._mockImageAnalysisResponse(imagePath);
      }
      
      // Make the API request
      const response = await axios.post(
        `${this.apiUrl}/chat/completions`,
        {
          model: this.supportedModels.multimodal,
          messages,
          max_tokens: 500,
          temperature: 0.3
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          httpsAgent: new https.Agent({
            rejectUnauthorized: false
          })
        }
      );
      
      const analysisText = response.data.choices[0].message.content;
      
      // Simple structure for the analysis result
      const analysis = {
        description: analysisText,
        imagePath
      };
      
      logger.info('Image analysis completed', { 
        imagePath, 
        description: analysis.description.substring(0, 50) + '...'
      });
      
      return analysis;
    } catch (error) {
      logger.error('Error analyzing image', { 
        error: error.message, 
        imagePath 
      });
      
      // If we're getting API errors, return a mock response instead of failing completely
      if (error.response && (error.response.status === 404 || error.response.status === 429)) {
        logger.warn(`Failed to analyze frame with Grok: ${error.message}. Using mock analysis.`);
        return this._mockImageAnalysisResponse(imagePath);
      }
      
      throw error;
    }
  }
  
  /**
   * Create a mock image analysis response when API fails
   * @param {string} imagePath - Path to the image
   * @returns {Object} - Mock analysis response
   * @private
   */
  _mockImageAnalysisResponse(imagePath) {
    const filename = path.basename(imagePath);
    // Extract timestamp if available in the filename
    const timestampMatch = filename.match(/(\d+)m(\d+)s/);
    let timeInfo = '';
    if (timestampMatch) {
      timeInfo = ` at timestamp ${timestampMatch[1]}:${timestampMatch[2]}`;
    }
    
    return {
      description: `This appears to be a frame from an educational video${timeInfo}. The frame shows visual content related to the topic being presented. There may be text, diagrams, people, or other educational elements visible.`,
      imagePath,
      isMockResponse: true
    };
  }

  /**
   * Generate a summary of a video based on frames and transcription
   * @param {Object} videoContent - Content from video frames and transcription
   * @returns {Promise<Object>} - Video summary
   */
  async generateVideoSummary(videoContent) {
    try {
      logger.info('Generating video summary');
      
      // Prepare prompt for Grok
      const transcriptionPreview = videoContent.transcription || '';
      const framesPreview = videoContent.frames || [];
      const topConcepts = videoContent.topConcepts || [];
      const visualSummary = videoContent.visualSummary || '';
      
      // Build a comprehensive prompt with enhanced visual content
      let analysisPrompt = `I need you to generate a detailed summary of an educational video based on its transcript and frame analysis.`;
      
      // Add visual summary if available
      if (visualSummary) {
        analysisPrompt += `\n\nVISUAL CONTENT ANALYSIS:\n${visualSummary}`;
      }
      // Otherwise use the frames directly
      else if (framesPreview && framesPreview.length > 0) {
        // Create a summarized version of the frames to avoid token limits
        analysisPrompt += `\n\nFRAME ANALYSIS:\n`;
        for (let i = 0; i < Math.min(framesPreview.length, 10); i++) {
          const frame = framesPreview[i];
          
          analysisPrompt += `Frame ${i+1} [${Math.floor(frame.timestamp / 60)}:${Math.floor(frame.timestamp % 60).toString().padStart(2, '0')}]: ${frame.description || 'No description'}\n`;
          
          if (frame.visibleText) {
            analysisPrompt += `Visible Text: ${frame.visibleText}\n`;
          }
          
          if (frame.educationalConcepts && frame.educationalConcepts.length > 0) {
            analysisPrompt += `Educational Concepts: ${frame.educationalConcepts.join(', ')}\n`;
          }
          
          if (frame.keyElements && frame.keyElements.length > 0) {
            analysisPrompt += `Key Elements: ${frame.keyElements.join(', ')}\n`;
          }
          
          analysisPrompt += '\n';
        }
      }
      
      // Add top concepts if available
      if (topConcepts && topConcepts.length > 0) {
        analysisPrompt += `\n\nKEY EDUCATIONAL CONCEPTS IDENTIFIED:\n- ${topConcepts.join('\n- ')}`;
      }
      
      // Add transcript excerpt
      analysisPrompt += `\n\nTRANSCRIPT EXCERPT:\n${transcriptionPreview.substring(0, 3000)}...`;
      
      // Add output formatting requirements
      analysisPrompt += `\n\nPlease analyze this content and provide a comprehensive video summary in JSON format with these fields:
- title: A descriptive title for the video
- overview: A paragraph summarizing the main content and purpose
- keyPoints: An array of key educational points covered
- topics: An array of main topics discussed
- difficulty: The approximate difficulty level (beginner, intermediate, advanced)
- targetAudience: Who this video is most appropriate for
- learningObjectives: What viewers will learn from this video

Format your response as valid JSON.`;
      
      const requestData = {
        model: this.model,
        stream: false,
        max_tokens: 1500,
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert educational content analyzer. Your task is to generate comprehensive summaries of educational videos based on transcripts and visual content analysis. Focus on extracting meaningful educational concepts and learning objectives.'
          },
          { 
            role: 'user', 
            content: analysisPrompt
          }
        ]
      };
      
      const response = await this._makeRequest(requestData);
      
      // Parse the JSON from the response
      const summaryText = response.choices[0].message.content;
      let summary;
      
      try {
        summary = JSON.parse(summaryText);
      } catch (parseError) {
        // If parsing fails, try to extract JSON using regex
        const jsonMatch = summaryText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            summary = JSON.parse(jsonMatch[0]);
          } catch (nestedError) {
            // If that fails too, create a structured object from the text
            summary = {
              title: "Educational Video",
              overview: summaryText.substring(0, 500),
              keyPoints: [],
              topics: topConcepts.slice(0, 5), // Use top concepts if available
              difficulty: "intermediate",
              targetAudience: "general",
              learningObjectives: []
            };
          }
        } else {
          summary = {
            title: "Educational Video",
            overview: summaryText.substring(0, 500),
            keyPoints: [],
            topics: topConcepts.slice(0, 5), // Use top concepts if available
            difficulty: "intermediate",
            targetAudience: "general",
            learningObjectives: []
          };
        }
      }
      
      logger.info('Video summary generated', { title: summary.title });
      
      return summary;
    } catch (error) {
      logger.error('Error generating video summary', { error: error.message });
      throw error;
    }
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
      const includeVisualContent = options.includeVisualContent || false;
      const videoTopic = content.topic || content.title || 'blockchain technology';
      
      // Build the prompt with visual content if available
      let promptContent = `Create a conversational quiz about ${videoTopic} for an educational video with the following information:

TITLE: ${content.title || 'Educational Video'}

OVERVIEW: ${content.overview || `Educational content about ${videoTopic}`}

KEY POINTS:
${content.keyPoints ? content.keyPoints.map(point => `- ${point}`).join('\n') : 'Not provided'}

TOPIC: ${videoTopic}

TRANSCRIPT EXCERPT:
${content.transcription ? content.transcription.substring(0, 3000) + '...' : 'Not provided'}`;

      // Add visual content if available and requested
      if (includeVisualContent && content.visualContent) {
        promptContent += `\n\nVISUAL CONTENT (TIMESTAMPS AND DESCRIPTIONS):
${content.visualContent.substring(0, 3000)}`;
      } else if (includeVisualContent && content.frames && content.frames.length > 0) {
        // Alternative way to add frame information
        promptContent += `\n\nVISUAL CONTENT (KEY FRAMES):
${content.frames.slice(0, 10).map(frame => 
  `[${Math.floor(frame.timestamp / 60)}:${Math.floor(frame.timestamp % 60).toString().padStart(2, '0')}] ${frame.description}`
).join('\n')}`;
      }
      
      promptContent += `\n\nPlease create a conversational quiz about ${videoTopic} with ${questionCount} questions of ${difficulty} difficulty. 

The quiz should:
1. Test understanding of the concepts related to ${videoTopic}
2. Focus EXCLUSIVELY on relevant aspects of the topic
3. Be conversational in nature (not multiple choice)
4. Include reference answers for evaluation
5. Be engaging and educational
6. Connect all questions directly to concepts covered in the video

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
            content: `You are an expert educator specializing in ${videoTopic}. Your task is to create engaging conversational quizzes STRICTLY about concepts relevant to the video topic. Your quizzes should be educational, challenging, and focused exclusively on the video's subject matter. YOUR MOST IMPORTANT TASK IS TO CREATE QUESTIONS THAT DIRECTLY RELATE TO ${videoTopic.toUpperCase()} ONLY. NEVER CREATE QUESTIONS ABOUT UNRELATED VISUAL ELEMENTS LIKE BRICKS, GENERAL IMAGES, OR OFF-TOPIC SUBJECTS.`
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
            quiz = {
              title: `Quiz: ${content.title || 'Educational Video'}`,
              description: "Test your knowledge on this educational content.",
              difficulty: difficulty,
              questions: [
                {
                  id: 1,
                  question: "What is the main topic covered in this video?",
                  referenceAnswer: "The main topic is related to the content of the educational video.",
                  evaluationCriteria: ["Topic identification", "Understanding of main concepts"],
                  followUp: "Can you elaborate on why this topic is important?"
                }
              ]
            };
          }
        } else {
          quiz = {
            title: `Quiz: ${content.title || 'Educational Video'}`,
            description: "Test your knowledge on this educational content.",
            difficulty: difficulty,
            questions: [
              {
                id: 1,
                question: "What is the main topic covered in this video?",
                referenceAnswer: "The main topic is related to the content of the educational video.",
                evaluationCriteria: ["Topic identification", "Understanding of main concepts"],
                followUp: "Can you elaborate on why this topic is important?"
              }
            ]
          };
        }
      }
      
      logger.info('Quiz generated', { title: quiz.title, questions: quiz.questions?.length });
      
      return quiz;
    } catch (error) {
      logger.error('Error generating quiz', { error: error.message });
      throw error;
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
${question.evaluationCriteria || 'None provided'}

VIDEO CONTEXT: ${videoContext ? JSON.stringify(videoContext) : 'Educational video about blockchain/crypto technology'}

USER'S RESPONSE: "${userResponse}"

IMPORTANT EVALUATION GUIDELINES:
- Be generous in your scoring - if the answer shows any understanding, give at least 40 points
- Any reasonable attempt should get a minimum of 50 points
- Focus on what's correct first before suggesting improvements
- Provide specific, helpful feedback rather than generic comments
- Never say the answer contains "undefined" or placeholder text
- If the answer is brief but has core concepts, score it 60-70
- If the answer mentions any relevant blockchain/crypto concepts, acknowledge them positively

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
            // If that fails too, create a structured evaluation from the text
            evaluation = {
              score: 70,
              correct: true,
              feedback: evaluationText.substring(0, 300),
              learningAddition: "Consider reviewing the material again for a deeper understanding.",
              encouragement: "You're making good progress!",
              followUpQuestion: question.followUp || "Can you explain more about this topic?"
            };
          }
        } else {
          evaluation = {
            score: 70,
            correct: true,
            feedback: evaluationText.substring(0, 300),
            learningAddition: "Consider reviewing the material again for a deeper understanding.",
            encouragement: "You're making good progress!",
            followUpQuestion: question.followUp || "Can you explain more about this topic?"
          };
        }
      }
      
      logger.info('Quiz response evaluated', { score: evaluation.score, correct: evaluation.correct });
      
      return evaluation;
    } catch (error) {
      logger.error('Error evaluating quiz response', { error: error.message });
      throw error;
    }
  }

  /**
   * Make a request to the Grok API
   * @param {Object} requestData - Request data to send
   * @returns {Promise<Object>} - API response
   * @private
   */
  async _makeRequest(requestData) {
    try {
      if (!this.apiKey) {
        throw new Error('Grok API key is required. Please set GROK_API_KEY in your environment.');
      }
      
      logger.debug('Making request to Grok API', { 
        model: requestData.model,
        messageCount: requestData.messages?.length || 0
      });
      
      const response = await axios.post(
        `${this.apiUrl}/chat/completions`,
        {
          ...requestData,
          model: requestData.model || this.model
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          httpsAgent: new https.Agent({
            rejectUnauthorized: false
          })
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Error making Grok API request', {
        error: error.message,
        stack: error.stack,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Extract topic from a natural language query
   * @param {string} query - User query text
   * @returns {Promise<{topic: string}>} - Extracted topic
   */
  async extractTopicFromQuery(query) {
    try {
      const prompt = `
Extract the main educational topic from this query. If multiple topics are present, identify the most specific one.
Return only the topic name, no additional text or explanation.

User query: "${query}"

Topic:`;

      const requestOptions = {
        messages: [
          { role: "system", content: "You are a helpful AI assistant that extracts educational topics from user queries." },
          { role: "user", content: prompt }
        ],
        model: this.model,
        temperature: 0.1,
        max_tokens: 50
      };

      const response = await this._makeRequest(requestOptions);
      const topic = response.choices[0].message.content.trim();
      
      logger.info(`Extracted topic "${topic}" from query: ${query}`);
      return { topic };
    } catch (error) {
      logger.error(`Error extracting topic from query: ${error.message}`, { error });
      return { topic: null, error: error.message };
    }
  }

  /**
   * Issue an agent credential using cheqd service - no fallbacks allowed
   * @param {Object} credentialData - The credential data to issue
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - The issued credential
   */
  async issueAgentCredential(credentialData, options = {}) {
    try {
      logger.info('Issuing agent credential', { 
        userId: options.metadata?.userId,
        type: credentialData.achievementType
      });
      
      // Require cheqdService to be available
      const cheqdService = require('./cheqdService');
      
      if (!cheqdService.initialized) {
        await cheqdService.initialize();
      }
      
      // Ensure there's an issuer DID
      if (!credentialData.issuer?.id) {
        if (!config.cheqd.botDid) {
          throw new Error('No bot DID configured for issuing credentials');
        }
        
        if (!credentialData.issuer) {
          credentialData.issuer = {};
        }
        
        credentialData.issuer.id = config.cheqd.botDid;
      }
      
      // Ensure recipient DID exists
      if (!credentialData.subject?.id) {
        throw new Error('No subject DID provided for credential issuance');
      }
      
      // Determine the credential type
      const credentialType = credentialData.achievementType || 'VerifiableCredential';

      // Extract subject data
      const subjectData = { ...credentialData };
      
      // Remove fields that shouldn't be in the subject data
      delete subjectData.subject;
      delete subjectData.issuer;
      
      // Issue credential using direct blockchain API - no fallbacks
      const credential = await cheqdService.issueCredential(
        credentialData.issuer.id,
        credentialData.subject.id,
        credentialType,
        subjectData,
        options
      );
      
      if (!credential) {
        throw new Error('Failed to issue credential through blockchain');
      }
      
      logger.info('Successfully issued agent credential', {
        userId: options.metadata?.userId,
        credentialId: credential.id || credential.credential_id
      });
      
      return {
        issued: true,
        credential: credential
      };
    } catch (error) {
      logger.error('Failed to issue agent credential', { 
        error: error.message || error,
        userId: options.metadata?.userId
      });
      
      // No fallbacks - strict policy
      throw new Error(`Cannot issue agent credential: ${error.message}`);
    }
  }

  /**
   * Call a function by name with specified parameters
   * @param {string} functionName - Name of the function to call
   * @param {Object} params - Parameters to pass to the function
   * @returns {Promise<Object>} - Function result
   */
  async functionHandler(functionName, params = {}) {
    try {
      logger.info(`Calling function: ${functionName}`, {
        service: 'grokService',
        functionName,
        paramsKeys: Object.keys(params)
      });
      
      // Get registry - in production this would use the actual registry
      // For testing, we're implementing a simple handler
      switch (functionName) {
        case 'transaction_analysis':
          return this._handleTransactionAnalysis(params);
        default:
          throw new Error(`Function ${functionName} not implemented`);
      }
    } catch (error) {
      logger.error(`Error calling function ${functionName}:`, {
        service: 'grokService',
        functionName,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message,
        response: `Error executing function ${functionName}: ${error.message}`
      };
    }
  }

  /**
   * Handle transaction analysis request
   * @param {Object} params - Transaction analysis parameters
   * @returns {Promise<Object>} - Analysis result
   * @private
   */
  async _handleTransactionAnalysis(params) {
    const { txHash, chainId, data, prompt } = params;
    
    logger.info('Processing transaction analysis request', {
      service: 'grokService',
      txHash,
      chainId
    });
    
    try {
      // In production, this would call the Grok LLM
      // For testing, we're generating a reasonable response based on the data
      
      // Extract information from transaction data
      const isSuccess = data.success;
      const error = data.error;
      const messageTypes = data.messageTypes || [];
      
      // Prepare the response
      let response = {};
      
      if (isSuccess) {
        // For successful transactions
        let explanation = "The transaction was processed by the blockchain without errors.";
        
        // Provide more details based on message type
        if (messageTypes.includes('MsgExecuteContract')) {
          explanation = "This transaction successfully executed a smart contract on the blockchain.";
          
          // If we have contract calls, add more details
          if (data.contractCalls && data.contractCalls.length > 0) {
            const action = data.contractCalls[0].action;
            explanation += ` The contract action was "${action}".`;
          }
        } else if (messageTypes.includes('MsgSend')) {
          explanation = "This transaction successfully transferred tokens between wallets.";
        }
        
        response = {
          summary: "Transaction completed successfully",
          explanation,
          recommendations: ["No action needed as the transaction was successful."]
        };
      } else {
        // For failed transactions
        let failureReason = "The transaction failed during processing.";
        let recommendations = ["Try the transaction again."];
        
        // Analyze the error message
        if (error) {
          if (error.includes("ask not found")) {
            failureReason = "The NFT listing you tried to buy no longer exists or has been sold already.";
            recommendations = [
              "Refresh the marketplace page to see current listings.",
              "The NFT may have been sold or delisted.",
              "Try searching for other available NFTs."
            ];
          } else if (error.includes("insufficient funds")) {
            failureReason = "Your wallet didn't have enough tokens to complete this transaction.";
            recommendations = [
              "Add more tokens to your wallet.",
              "Ensure you have enough for both the transaction amount and gas fees.",
              "Check your balance before trying again."
            ];
          } else if (error.includes("out of gas")) {
            failureReason = "The transaction ran out of gas before it could complete.";
            recommendations = [
              "Increase the gas limit for your transaction.",
              "Try setting gas limit to at least 1.5x the amount that was used."
            ];
          } else if (error.includes("account sequence mismatch")) {
            failureReason = "Your wallet's transaction sequence was out of sync with the blockchain.";
            recommendations = [
              "Reset your wallet connection.",
              "Refresh the page and try again.",
              "Wait a few minutes for any pending transactions to complete."
            ];
          } else if (error.includes("contract execution failed")) {
            failureReason = "The smart contract execution failed due to an error in the contract logic.";
            recommendations = [
              "Check that your inputs are correct.",
              "Verify that you meet all requirements for this contract interaction.",
              "The contract may have restrictions or conditions that weren't met."
            ];
          }
        }
        
        response = {
          summary: "Transaction failed on the blockchain",
          explanation: "The transaction was submitted but encountered an error during processing.",
          failure_reason: failureReason,
          recommendations
        };
      }
      
      logger.info('Transaction analysis completed', {
        service: 'grokService',
        txHash,
        success: isSuccess
      });
      
      return {
        success: true,
        txHash,
        chainId,
        response
      };
    } catch (error) {
      logger.error('Error processing transaction analysis', {
        service: 'grokService',
        txHash,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message,
        response: {
          summary: "Analysis failed",
          explanation: "There was an error analyzing the transaction.",
          recommendations: ["Try again later."]
        }
      };
    }
  }
}

// Export singleton instance
const grokService = new GrokService();
module.exports = grokService; 