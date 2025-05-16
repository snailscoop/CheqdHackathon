/**
 * Grok Transaction Analyzer Integration
 * 
 * This module integrates with the existing Grok service to provide
 * transaction analysis capabilities for blockchain transactions.
 */

const axios = require('axios');
const logger = require('../../utils/logger');
const grokService = require('../../services/grokService');

/**
 * Analyzes blockchain transactions using Grok
 */
class GrokTxAnalyzer {
  constructor() {
    this.initialized = true;
  }

  /**
   * Analyze a transaction hash using Grok
   * @param {Object} params - Transaction parameters
   * @param {string} params.txHash - Transaction hash
   * @param {string} params.chainId - Chain ID (e.g., "stargaze-1")
   * @param {boolean} params.includeRawData - Whether to include raw transaction data in the response
   * @returns {Promise<Object>} - Analysis results
   */
  async analyze(params) {
    const { txHash, chainId = 'stargaze-1', includeRawData = false } = params;
    
    if (!txHash) {
      throw new Error('Transaction hash is required');
    }
    
    try {
      logger.info('Analyzing transaction with Grok', {
        service: 'grokTxAnalyzer',
        txHash,
        chainId
      });
      
      // Get transaction data first (using existing txAnalyzer or direct API call)
      const txData = await this._fetchTransactionData(txHash, chainId);
      
      // Check if transaction was not found
      if (txData.tx_response && txData.tx_response.not_found) {
        // Return a user-friendly "not found" analysis
        return {
          txHash,
          chainId,
          analysis: {
            summary: "Transaction not found",
            explanation: "This transaction could not be found on the blockchain. It may be too old and pruned from the node's database, on a different chain, or the hash might be incorrect.",
            failure_reason: "Transaction not found on the blockchain",
            recommendations: [
              "Verify the transaction hash is correct",
              "Check if you're using the right chain ID",
              "Try searching for this transaction on a block explorer"
            ]
          },
          timestamp: new Date().toISOString(),
          transactionNotFound: true
        };
      }
      
      // Process the transaction data for analysis
      const processedData = this._processTransactionData(txData, txHash, chainId);
      
      // Send to Grok for analysis
      const analysisResult = await this._callGrokService(processedData);
      
      // Construct the response
      const response = {
        txHash,
        chainId,
        analysis: analysisResult,
        timestamp: new Date().toISOString()
      };
      
      // Include detailed data if requested
      if (includeRawData) {
        response.rawData = {
          tx: txData.tx,
          txResponse: txData.tx_response || txData
        };
      }
      
      return response;
    } catch (error) {
      logger.error('Error analyzing transaction with Grok', {
        service: 'grokTxAnalyzer',
        txHash,
        chainId,
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * Fetch transaction data
   * @param {string} txHash - Transaction hash
   * @param {string} chainId - Chain ID
   * @returns {Promise<Object>} - Transaction data
   * @private
   */
  async _fetchTransactionData(txHash, chainId) {
    try {
      // Determine API endpoint based on chain
      const endpoint = this._getChainEndpoint(chainId);
      
      // Fetch transaction data
      const url = `${endpoint}/cosmos/tx/v1beta1/txs/${txHash}`;
      logger.info(`Fetching transaction data from ${url}`, { txHash });
      
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch transaction: ${response.statusText}`);
      }
      
      return response.data;
    } catch (error) {
      // Try backup endpoint if primary fails
      if (error.response && error.response.status === 404) {
        return this._fetchFromBackupEndpoint(txHash, chainId);
      }
      
      throw error;
    }
  }
  
  /**
   * Get chain endpoint by chain ID
   * @param {string} chainId - Chain ID
   * @returns {string} - Chain endpoint
   * @private
   */
  _getChainEndpoint(chainId) {
    // Map of chain IDs to REST endpoints
    const endpoints = {
      'stargaze-1': 'https://rest.stargaze-apis.com',
      'osmosis-1': 'https://lcd-osmosis.keplr.app',
      'cosmoshub-4': 'https://lcd-cosmoshub.keplr.app',
      'juno-1': 'https://lcd-juno.keplr.app',
      'cheqd-mainnet-1': 'https://api.cheqd.io'
    };
    
    return endpoints[chainId] || `https://rest.cosmos.directory/${chainId.split('-')[0]}`;
  }
  
  /**
   * Fetch transaction data from backup endpoint
   * @param {string} txHash - Transaction hash 
   * @param {string} chainId - Chain ID
   * @returns {Promise<Object>} - Transaction data
   * @private
   */
  async _fetchFromBackupEndpoint(txHash, chainId) {
    try {
      // Use Cosmos Directory as backup
      const chainName = chainId.split('-')[0];
      const url = `https://rest.cosmos.directory/${chainName}/cosmos/tx/v1beta1/txs/${txHash}`;
      
      logger.info('Fetching from backup endpoint', {
        service: 'grokTxAnalyzer',
        url,
        txHash
      });
      
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch transaction from backup: ${response.statusText}`);
      }
      
      return response.data;
    } catch (error) {
      logger.warn(`Transaction not found in backup endpoint: ${txHash}`, { error: error.message });
      
      // Return a structured "not found" response instead of throwing
      return {
        tx_response: {
          code: 404,
          raw_log: "Transaction not found in blockchain. It may have been too old, pruned, or on a different chain.",
          height: "0",
          txhash: txHash,
          timestamp: new Date().toISOString(),
          not_found: true
        }
      };
    }
  }
  
  /**
   * Process transaction data for Grok
   * @param {Object} txData - Transaction data
   * @param {string} txHash - Transaction hash
   * @param {string} chainId - Chain ID
   * @returns {Object} - Processed data
   * @private
   */
  _processTransactionData(txData, txHash, chainId) {
    try {
      // Extract the relevant parts of the transaction for Grok analysis
      const txResponse = txData.tx_response || txData;
      const isSuccess = txResponse.code === 0;
      
      // Keep a copy of the raw data
      const rawTxData = JSON.parse(JSON.stringify(txData));
      
      const processedData = {
        txHash,
        chainId,
        success: isSuccess,
        height: txResponse.height,
        timestamp: txResponse.timestamp,
        gasWanted: txResponse.gas_wanted || txResponse.gasWanted,
        gasUsed: txResponse.gas_used || txResponse.gasUsed,
        error: !isSuccess ? txResponse.raw_log || txResponse.rawLog : null,
        memo: txData.tx?.body?.memo || null,
        messages: [],
        logs: [],
        events: [],
        rawJson: JSON.stringify(txData)
      };
      
      // Extract codespace if present
      if (txResponse.codespace) {
        processedData.codespace = txResponse.codespace;
      }
      
      // For failed transactions, parse error details
      if (!isSuccess) {
        const errorDetails = this._parseErrorDetails(txResponse.raw_log || txResponse.rawLog);
        processedData.errorDetails = errorDetails;
      }
      
      // Extract message details
      if (txData.tx && txData.tx.body && txData.tx.body.messages) {
        try {
          // Store original messages
          processedData.messages = txData.tx.body.messages;
          
          // Extract message types for easier analysis
          processedData.messageTypes = txData.tx.body.messages.map(msg => {
            const type = msg['@type'] || '';
            return type.split('.').pop() || 'unknown';
          });
          
          // Extract contract calls for easier analysis
          if (txData.tx.body.messages.some(msg => msg['@type'] === '/cosmwasm.wasm.v1.MsgExecuteContract')) {
            processedData.contractCalls = txData.tx.body.messages
              .filter(msg => msg['@type'] === '/cosmwasm.wasm.v1.MsgExecuteContract')
              .map(msg => {
                let action = 'unknown';
                let params = {};
                
                if (msg.msg) {
                  try {
                    // Handle both string and object message formats
                    const contractMsg = typeof msg.msg === 'string' 
                      ? JSON.parse(msg.msg) 
                      : (typeof msg.msg === 'object' ? msg.msg : {});
                    
                    action = Object.keys(contractMsg)[0] || 'unknown';
                    params = contractMsg[action] || {};
                  } catch (e) {
                    // Parsing failed, use raw message
                    logger.debug('Error parsing contract message', { 
                      error: e.message, 
                      msg: typeof msg.msg === 'string' ? msg.msg.substring(0, 100) : 'non-string message'
                    });
                    action = 'unparsable';
                    params = { raw: msg.msg };
                  }
                }
                
                return {
                  contract: msg.contract,
                  sender: msg.sender,
                  action,
                  params,
                  funds: msg.funds || []
                };
              });
          }
        } catch (msgError) {
          logger.warn('Error processing transaction messages', { 
            error: msgError.message,
            txHash 
          });
          // Still continue processing other parts
        }
      }
      
      // Extract detailed logs and events
      try {
        if (txResponse.logs && txResponse.logs.length > 0) {
          processedData.logs = txResponse.logs;
          
          // Extract and process events for easier analysis
          const events = [];
          const detailedEvents = [];
          
          txResponse.logs.forEach((log, logIndex) => {
            if (log.events && Array.isArray(log.events)) {
              log.events.forEach((event, eventIndex) => {
                // Create processed event with attributes as an object for easier access
                const processedEvent = {
                  type: event.type,
                  logIndex,
                  eventIndex,
                  attributes: {}
                };
                
                // Full detailed event with original structure
                const detailedEvent = {
                  type: event.type,
                  logIndex,
                  eventIndex,
                  attributes: event.attributes || [],
                  originalAttributes: event.attributes || []
                };
                
                // Convert attributes array to object
                if (event.attributes && Array.isArray(event.attributes)) {
                  event.attributes.forEach(attr => {
                    if (attr.key) {
                      // Store in processed event (as object)
                      processedEvent.attributes[attr.key] = attr.value;
                      
                      // Also add to detailed event for reference
                      detailedEvent.attributesMap = detailedEvent.attributesMap || {};
                      detailedEvent.attributesMap[attr.key] = attr.value;
                    }
                  });
                }
                
                events.push(processedEvent);
                detailedEvents.push(detailedEvent);
              });
            }
          });
          
          processedData.events = events;
          processedData.detailedEvents = detailedEvents;
          
          // Extract important event data for common event types
          // This makes it easier to access important information
          const eventsByType = {};
          events.forEach(event => {
            eventsByType[event.type] = eventsByType[event.type] || [];
            eventsByType[event.type].push(event);
          });
          
          processedData.eventsByType = eventsByType;
        } else if (!isSuccess) {
          // For failed transactions with no logs, create synthetic events from message details
          const syntheticEvents = this._createSyntheticEventsFromMessages(txData.tx?.body?.messages);
          
          if (syntheticEvents.length > 0) {
            processedData.events = syntheticEvents;
            processedData.detailedEvents = syntheticEvents;
            
            // Group by type
            const eventsByType = {};
            syntheticEvents.forEach(event => {
              eventsByType[event.type] = eventsByType[event.type] || [];
              eventsByType[event.type].push(event);
            });
            
            processedData.eventsByType = eventsByType;
          }
        }
      } catch (eventError) {
        logger.warn('Error processing transaction events', { 
          error: eventError.message,
          txHash 
        });
        // Continue processing other parts
      }
      
      // Extract fee information
      try {
        if (txData.tx && txData.tx.auth_info && txData.tx.auth_info.fee) {
          const fee = txData.tx.auth_info.fee;
          processedData.fee = {
            amount: fee.amount || [],
            gasLimit: fee.gas_limit
          };
        }
      } catch (feeError) {
        logger.debug('Error extracting fee information', { error: feeError.message });
        // Non-critical, continue processing
      }
      
      // Add signers information if available
      try {
        if (txData.tx?.auth_info?.signer_infos) {
          processedData.signers = txData.tx.auth_info.signer_infos.map(signer => {
            return {
              publicKey: signer.public_key?.key || null,
              sequence: signer.sequence || null,
              mode: signer.mode_info?.single?.mode || null
            };
          });
        }
      } catch (signerError) {
        logger.debug('Error extracting signer information', { error: signerError.message });
        // Non-critical, continue processing
      }
      
      return processedData;
    } catch (error) {
      logger.error('Error processing transaction data', { 
        error: error.message,
        txHash,
        chainId 
      });
      
      // Return a minimal set of data on error
      return {
        txHash,
        chainId,
        success: false,
        error: error.message,
        raw_log: txData?.tx_response?.raw_log || 'Processing error',
        processingError: true
      };
    }
  }
  
  /**
   * Parse error details from raw error log
   * @param {string} rawLog - Raw error log
   * @returns {Object} - Parsed error details
   * @private
   */
  _parseErrorDetails(rawLog) {
    if (!rawLog) return { message: 'Unknown error' };
    
    const errorDetails = {
      message: rawLog,
      type: 'unknown',
      module: 'unknown',
      data: {}
    };
    
    try {
      // Extract error type
      if (rawLog.includes('InvalidInput:')) {
        errorDetails.type = 'InvalidInput';
      } else if (rawLog.includes('OutOfGas')) {
        errorDetails.type = 'OutOfGas';
      } else if (rawLog.includes('insufficient funds')) {
        errorDetails.type = 'InsufficientFunds';
      } else if (rawLog.includes('unauthorized')) {
        errorDetails.type = 'Unauthorized';
      } else if (rawLog.includes('already exists')) {
        errorDetails.type = 'AlreadyExists';
      } else if (rawLog.includes('not found')) {
        errorDetails.type = 'NotFound';
      }
      
      // Extract specific data
      if (rawLog.includes('ask not found')) {
        errorDetails.module = 'marketplace';
        errorDetails.data.askId = this._extractId(rawLog);
        errorDetails.data.operation = 'buy';
      } else if (rawLog.includes('bid not found')) {
        errorDetails.module = 'marketplace';
        errorDetails.data.bidId = this._extractId(rawLog);
        errorDetails.data.operation = 'accept_bid';
      }
    } catch (error) {
      logger.debug('Error parsing error details', { error: error.message });
      // If parsing fails, return the original error message
    }
    
    return errorDetails;
  }
  
  /**
   * Extract ID from error message
   * @param {string} message - Error message
   * @returns {string} - Extracted ID or empty string
   * @private
   */
  _extractId(message) {
    try {
      // Try to extract ID between square brackets
      const bracketMatch = message.match(/\[(.*?)\]/);
      if (bracketMatch && bracketMatch[1]) {
        return bracketMatch[1];
      }
    } catch (error) {
      logger.debug('Error extracting ID from message', { error: error.message });
    }
    
    return '';
  }
  
  /**
   * Create synthetic events from message data for failed transactions
   * @param {Array} messages - Transaction messages
   * @returns {Array} - Synthetic events
   * @private
   */
  _createSyntheticEventsFromMessages(messages) {
    if (!messages || !Array.isArray(messages)) return [];
    
    const syntheticEvents = [];
    
    try {
      messages.forEach((msg, index) => {
        if (msg['@type'] === '/cosmwasm.wasm.v1.MsgExecuteContract') {
          // Create a synthetic wasm event
          const event = {
            type: 'wasm',
            synthetic: true,
            logIndex: 0,
            eventIndex: index,
            attributes: {}
          };
          
          // Add basic attributes
          event.attributes['_contract_address'] = msg.contract;
          event.attributes['_sender'] = msg.sender;
          
          // Add action type if available
          if (msg.msg) {
            try {
              // Handle both string and object message formats
              const contractMsg = typeof msg.msg === 'string' 
                ? JSON.parse(msg.msg) 
                : (typeof msg.msg === 'object' ? msg.msg : {});
              
              const action = Object.keys(contractMsg)[0] || 'unknown';
              
              event.attributes['action'] = action;
              
              // Add specific parameters based on action type
              const params = contractMsg[action] || {};
              
              if (action === 'buy') {
                event.attributes['ask_id'] = params.ask_id || '';
                event.attributes['operation'] = 'buy_nft';
              } else if (action === 'accept_bid') {
                event.attributes['bid_id'] = params.bid_id || '';
                event.attributes['operation'] = 'accept_bid';
              } else if (action === 'place_bid') {
                event.attributes['collection'] = params.collection || '';
                event.attributes['token_id'] = params.token_id || '';
                event.attributes['operation'] = 'place_bid';
              } else if (action === 'list') {
                event.attributes['token_id'] = params.token_id || '';
                event.attributes['price'] = params.price?.amount || '';
                event.attributes['operation'] = 'list_nft';
              } else if (action === 'update_ask') {
                event.attributes['id'] = params.id || '';
                if (params.details?.price) {
                  event.attributes['price'] = params.details.price.amount || '';
                  event.attributes['denom'] = params.details.price.denom || '';
                }
                event.attributes['operation'] = 'update_ask';
              }
              
              // Add raw parameters for reference
              event.rawParams = params;
            } catch (e) {
              // Can't parse message
              event.attributes['parse_error'] = 'true';
              logger.debug('Error parsing contract message for synthetic event', { 
                error: e.message,
                msg: typeof msg.msg === 'string' ? msg.msg.substring(0, 100) : 'non-string message'
              });
            }
          }
          
          // Add funds information if available
          if (msg.funds && msg.funds.length > 0) {
            const fund = msg.funds[0];
            event.attributes['amount'] = fund.amount || '';
            event.attributes['denom'] = fund.denom || '';
          }
          
          syntheticEvents.push(event);
        } else {
          // Create a synthetic message event
          const event = {
            type: 'message',
            synthetic: true,
            logIndex: 0,
            eventIndex: index,
            attributes: {}
          };
          
          // Extract type
          const type = msg['@type'] || '';
          const messageType = type.split('.').pop() || 'unknown';
          
          event.attributes['action'] = messageType;
          event.attributes['module'] = type.split('.')[1] || 'unknown';
          
          // Add message-specific attributes
          if (messageType === 'MsgSend') {
            event.attributes['sender'] = msg.from_address || '';
            event.attributes['recipient'] = msg.to_address || '';
            
            if (msg.amount && msg.amount.length > 0) {
              event.attributes['amount'] = msg.amount[0].amount || '';
              event.attributes['denom'] = msg.amount[0].denom || '';
            }
          }
          
          syntheticEvents.push(event);
        }
      });
    } catch (error) {
      logger.warn('Error creating synthetic events', { error: error.message });
      // Return any events we managed to create
    }
    
    return syntheticEvents;
  }
  
  /**
   * Call Grok service for transaction analysis
   * @param {Object} processedData - Processed transaction data
   * @returns {Promise<Object>} - Analysis results
   * @private
   */
  async _callGrokService(processedData) {
    try {
      logger.info('Calling Grok service for transaction analysis', {
        service: 'grokTxAnalyzer',
        txHash: processedData.txHash
      });
      
      // Create prompt for Grok
      const prompt = this._createAnalysisPrompt(processedData);
      
      // Call the function through the Grok service
      const result = await grokService.functionHandler('transaction_analysis', {
        txHash: processedData.txHash,
        chainId: processedData.chainId,
        data: processedData,
        prompt: prompt
      });
      
      if (!result || !result.response) {
        throw new Error('Invalid response from Grok service');
      }
      
      // Extract and format the analysis from the response
      return {
        summary: result.response.summary || "Transaction analyzed",
        explanation: result.response.explanation || result.response,
        failure_reason: result.response.failure_reason || null,
        recommendations: result.response.recommendations || [],
        rawEvents: processedData.detailedEvents || [],
        eventsByType: processedData.eventsByType || {},
        errorDetails: processedData.errorDetails || null
      };
    } catch (error) {
      logger.error('Error calling Grok service', {
        service: 'grokTxAnalyzer',
        error: error.message
      });
      
      // Return a basic fallback analysis
      return {
        summary: processedData.success ? "Transaction completed" : "Transaction failed",
        explanation: processedData.success 
          ? "The transaction was processed successfully by the blockchain." 
          : `The transaction failed: ${processedData.error || 'Unknown error'}`,
        failure_reason: processedData.error || null,
        recommendations: !processedData.success ? [
          "Check the transaction details and try again",
          "Ensure you have sufficient funds for gas fees",
          "Verify contract addresses and parameters"
        ] : [],
        processingError: true,
        rawEvents: [],
        eventsByType: {}
      };
    }
  }
  
  /**
   * Create analysis prompt for Grok
   * @param {Object} processedData - Processed transaction data
   * @returns {string} - Analysis prompt
   * @private
   */
  _createAnalysisPrompt(processedData) {
    const { txHash, chainId, success, error, messageTypes, events, codespace } = processedData;
    
    // Create text sections for the prompt
    let messageTypeText = '';
    if (messageTypes && messageTypes.length > 0) {
      messageTypeText = `\nMessage Types: ${messageTypes.join(', ')}`;
    }
    
    let eventText = '';
    if (events && events.length > 0) {
      const eventTypes = [...new Set(events.map(e => e.type))].join(', ');
      eventText = `\nEvent Types: ${eventTypes}`;
    }
    
    // Add detailed contract information if available
    let contractText = '';
    if (processedData.contractCalls && processedData.contractCalls.length > 0) {
      const call = processedData.contractCalls[0];
      contractText = `\nContract: ${call.contract}\nAction: ${call.action}`;
      
      if (call.funds && call.funds.length > 0) {
        const fundsText = call.funds.map(f => `${f.amount} ${f.denom}`).join(', ');
        contractText += `\nFunds: ${fundsText}`;
      }
    }
    
    // Add important event details if available
    let importantEventText = '';
    const importantEventTypes = ['wasm', 'transfer', 'message', 'coin_spent', 'coin_received'];
    
    importantEventTypes.forEach(type => {
      if (processedData.eventsByType && processedData.eventsByType[type]) {
        const events = processedData.eventsByType[type];
        if (events.length > 0) {
          importantEventText += `\n\n${type.toUpperCase()} Events:`;
          
          events.slice(0, 3).forEach((event, i) => {
            const attributes = Object.entries(event.attributes)
              .map(([key, value]) => `${key}: ${value}`)
              .join(', ');
            
            importantEventText += `\n- Event ${i+1}: ${attributes.substring(0, 200)}${attributes.length > 200 ? '...' : ''}`;
          });
          
          if (events.length > 3) {
            importantEventText += `\n- ${events.length - 3} more ${type} events...`;
          }
        }
      }
    });
    
    return `
Analyze this ${chainId} blockchain transaction: ${txHash}
Status: ${success ? 'SUCCESS' : 'FAILED'}${messageTypeText}${eventText}${contractText}
${codespace ? `Codespace: ${codespace}` : ''}
${!success ? `\nError: ${error}` : ''}
${importantEventText}

Please explain:
1. What this transaction was trying to do
2. ${success ? 'What it accomplished' : 'Why it failed'}
3. ${success ? 'Any important details about the outcome' : 'How to fix the issue'}
4. Any blockchain concepts that would help understand the transaction
`.trim();
  }
}

module.exports = new GrokTxAnalyzer(); 