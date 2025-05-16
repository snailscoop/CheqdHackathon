const axios = require('axios');
const config = require('../config/config');
const logger = require('./logger');

/**
 * This is an adapter that provides an OpenAI-compatible interface
 * but uses Grok's API under the hood.
 */
class GrokAdapter {
  constructor() {
    this.apiKey = config.grok.apiKey;
    this.baseUrl = config.grok.baseUrl;
    this.model = config.grok.model || 'grok-3-beta';
    this.temperature = config.grok.temperature || 0.7;
    this.maxTokens = config.grok.maxTokens || 1500;
    this.timeout = config.grok.timeout || 30000;
    
    logger.info('Initialized Grok adapter with model: ' + this.model);
  }

  async createChatCompletion(params) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: params.model || this.model,
          messages: params.messages,
          max_tokens: params.max_tokens || this.maxTokens,
          temperature: params.temperature || this.temperature,
          stream: params.stream || false,
          function_call: params.function_call,
          functions: params.functions
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: this.timeout
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Grok API call failed', { error: error.message });
      throw error;
    }
  }
}

// Create and export a singleton instance
const grokAdapter = new GrokAdapter();
module.exports = grokAdapter; 