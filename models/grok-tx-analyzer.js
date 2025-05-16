/**
 * Grok Transaction Analyzer
 * 
 * This module leverages LLM capabilities to provide detailed analysis of blockchain transactions
 * with natural language explanations and intelligent recommendations.
 */

const fs = require('fs');
const axios = require('axios');

class GrokTransactionAnalyzer {
  constructor(config = {}) {
    this.config = {
      model: config.model || 'gpt-4',
      temperature: config.temperature || 0.3,
      maxTokens: config.maxTokens || 1000,
      apiEndpoint: config.apiEndpoint || process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1/chat/completions',
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      ...config
    };
  }

  /**
   * Analyze a transaction using Grok/LLM
   * @param {Object} txData - Transaction data
   * @param {string} txHash - Transaction hash
   * @param {string} chainId - Chain ID (e.g., "stargaze-1")
   * @returns {Promise<Object>} - LLM analysis results
   */
  async analyzeTransaction(txData, txHash, chainId = 'stargaze-1') {
    try {
      // Process and prepare transaction data
      const processedData = this._processTransactionData(txData, txHash, chainId);
      
      // Generate prompt for LLM
      const prompt = this._generatePrompt(processedData);
      
      // Call the LLM API
      const analysis = await this._callLLM(prompt, processedData);
      
      return {
        txHash,
        chainId,
        timestamp: new Date().toISOString(),
        analysis,
        processedData
      };
    } catch (error) {
      console.error('Error analyzing transaction with Grok/LLM:', error.message);
      return {
        txHash,
        chainId,
        error: error.message,
        timestamp: new Date().toISOString(),
        analysis: {
          summary: 'Failed to analyze transaction due to an error.',
          recommendations: ['Try analyzing the transaction manually.']
        }
      };
    }
  }

  /**
   * Process and extract relevant transaction data
   * @param {Object} txData - Raw transaction data
   * @param {string} txHash - Transaction hash
   * @param {string} chainId - Chain ID
   * @returns {Object} - Processed transaction data
   * @private
   */
  _processTransactionData(txData, txHash, chainId) {
    // Determine if we have Cosmos SDK format or other
    const txResponse = txData.tx_response || txData;
    const isSuccess = txResponse.code === 0;
    
    // Basic transaction info
    const processedData = {
      txHash,
      chainId,
      success: isSuccess,
      height: txResponse.height,
      timestamp: txResponse.timestamp,
      gasWanted: txResponse.gas_wanted || txResponse.gasWanted,
      gasUsed: txResponse.gas_used || txResponse.gasUsed,
      error: !isSuccess ? txResponse.raw_log || txResponse.rawLog : null,
      messages: [],
      events: [],
      contractCalls: []
    };
    
    // Extract transaction fee
    if (txData.tx && txData.tx.auth_info && txData.tx.auth_info.fee) {
      processedData.fee = {
        amount: txData.tx.auth_info.fee.amount || [],
        gasLimit: txData.tx.auth_info.fee.gas_limit
      };
    }
    
    // Extract messages
    if (txData.tx && txData.tx.body && txData.tx.body.messages) {
      processedData.messages = txData.tx.body.messages;
      
      // Process contract calls
      processedData.contractCalls = this._extractContractCalls(txData.tx.body.messages);
    }
    
    // Extract events
    if (txResponse.logs && txResponse.logs.length > 0) {
      // Process event logs to be more readable
      processedData.events = this._extractEvents(txResponse.logs);
    }
    
    return processedData;
  }

  /**
   * Extract contract calls from transaction messages
   * @param {Array} messages - Transaction messages
   * @returns {Array} - Processed contract calls
   * @private
   */
  _extractContractCalls(messages) {
    const contractCalls = [];
    
    if (!messages || !Array.isArray(messages)) {
      return contractCalls;
    }
    
    messages.forEach((msg, index) => {
      if (msg['@type'] === '/cosmwasm.wasm.v1.MsgExecuteContract') {
        const contractCall = {
          index,
          contract: msg.contract,
          sender: msg.sender,
          funds: msg.funds || [],
          action: 'unknown',
          params: {}
        };
        
        // Try to parse contract message
        if (msg.msg) {
          try {
            const contractMsg = typeof msg.msg === 'string' ? JSON.parse(msg.msg) : msg.msg;
            const action = Object.keys(contractMsg)[0];
            contractCall.action = action;
            contractCall.params = contractMsg[action];
          } catch (e) {
            contractCall.rawMsg = msg.msg;
          }
        }
        
        contractCalls.push(contractCall);
      }
    });
    
    return contractCalls;
  }

  /**
   * Extract and process events from transaction logs
   * @param {Array} logs - Transaction logs
   * @returns {Array} - Processed events
   * @private
   */
  _extractEvents(logs) {
    const processedEvents = [];
    
    if (!logs || !Array.isArray(logs)) {
      return processedEvents;
    }
    
    logs.forEach((log, logIndex) => {
      if (log.events && Array.isArray(log.events)) {
        log.events.forEach((event) => {
          const processedEvent = {
            type: event.type,
            logIndex,
            attributes: {}
          };
          
          // Convert attributes array to object for easier access
          if (event.attributes && Array.isArray(event.attributes)) {
            event.attributes.forEach(attr => {
              if (attr.key) {
                processedEvent.attributes[attr.key] = attr.value;
              }
            });
          }
          
          processedEvents.push(processedEvent);
        });
      }
    });
    
    return processedEvents;
  }

  /**
   * Generate a prompt for the LLM
   * @param {Object} processedData - Processed transaction data
   * @returns {string} - Generated prompt
   * @private
   */
  _generatePrompt(processedData) {
    return `
You are an AI assistant specialized in blockchain transaction analysis. Please analyze this transaction data from the ${processedData.chainId} blockchain:

Transaction Hash: ${processedData.txHash}
Status: ${processedData.success ? 'SUCCESS' : 'FAILED'}
Block Height: ${processedData.height}
Timestamp: ${processedData.timestamp}
Gas (wanted/used): ${processedData.gasWanted}/${processedData.gasUsed}
${!processedData.success ? `\nError: ${processedData.error}` : ''}

Transaction Messages:
${JSON.stringify(processedData.messages, null, 2)}

${processedData.contractCalls.length > 0 ? `Contract Calls:\n${JSON.stringify(processedData.contractCalls, null, 2)}` : ''}

${processedData.events.length > 0 ? `Events:\n${JSON.stringify(processedData.events, null, 2)}` : ''}

Based on the transaction data, please provide:

1. A clear explanation of what this transaction was trying to accomplish in simple terms
2. ${!processedData.success ? 'An explanation of why the transaction failed and what exactly went wrong' : 'Confirmation of what the transaction successfully did'}
3. ${!processedData.success ? 'Specific, actionable steps the user can take to fix this issue' : 'Any relevant information about the transaction outcome'}
4. Explanation of any blockchain-specific concepts that would help the user understand what happened

Format your response as JSON with the following structure:
{
  "summary": "One sentence summary of the transaction",
  "explanation": "Detailed explanation of what the transaction was doing",
  "failure_reason": "Explanation of why it failed (if applicable)",
  "recommendations": ["List", "of", "specific", "recommendations"],
  "technical_notes": "Technical details that might be helpful"
}
`.trim();
  }

  /**
   * Call the LLM API with the generated prompt
   * @param {string} prompt - The generated prompt 
   * @param {Object} processedData - Processed transaction data (for backup)
   * @returns {Promise<Object>} - LLM response
   * @private
   */
  async _callLLM(prompt, processedData) {
    try {
      // Check if API key is available
      if (!this.config.apiKey) {
        console.log('No API key provided. Returning mock analysis.');
        return this._generateMockAnalysis(processedData);
      }
      
      const response = await axios.post(
        this.config.apiEndpoint,
        {
          model: this.config.model,
          messages: [
            { role: 'system', content: 'You are a blockchain transaction analysis assistant. Provide detailed, accurate analysis in JSON format as requested.' },
            { role: 'user', content: prompt }
          ],
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          }
        }
      );
      
      // Extract and parse the JSON response
      const content = response.data.choices[0].message.content;
      return JSON.parse(content);
    } catch (error) {
      console.error('Error calling LLM API:', error.message);
      
      // Return mock analysis as backup
      return this._generateMockAnalysis(processedData);
    }
  }

  /**
   * Generate mock analysis when API is unavailable
   * @param {Object} processedData - Processed transaction data
   * @returns {Object} - Mock analysis
   * @private
   */
  _generateMockAnalysis(processedData) {
    const isSuccess = processedData.success;
    
    if (isSuccess) {
      return {
        summary: "This transaction appears to have completed successfully",
        explanation: "The transaction was processed by the blockchain with no errors",
        failure_reason: null,
        recommendations: [
          "No action needed as the transaction was successful"
        ],
        technical_notes: "Review the transaction events for more details on what actions were performed"
      };
    } else {
      // Basic error analysis based on common patterns
      let failureReason = "Unknown error occurred";
      const recommendations = ["Try the transaction again"];
      
      if (processedData.error) {
        if (processedData.error.includes("insufficient funds")) {
          failureReason = "The wallet did not have enough funds to complete this transaction";
          recommendations.push("Add more funds to your wallet");
          recommendations.push("Ensure you have enough for both the transaction amount and gas fees");
        } else if (processedData.error.includes("out of gas")) {
          failureReason = "The transaction ran out of gas before completion";
          recommendations.push("Increase the gas limit for your transaction");
        }
      }
      
      return {
        summary: "Transaction failed on the blockchain",
        explanation: "The transaction was submitted but encountered an error during processing",
        failure_reason: failureReason,
        recommendations: recommendations,
        technical_notes: `Error: ${processedData.error}`
      };
    }
  }

  /**
   * Load transaction data from a file
   * @param {string} filePath - Path to the transaction data file
   * @returns {Object} - Transaction data
   */
  static loadTransactionData(filePath) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error loading transaction data from ${filePath}:`, error.message);
      throw error;
    }
  }
}

module.exports = GrokTransactionAnalyzer; 