/**
 * Transaction Analysis Module for Cheqd Bot
 * 
 * This module provides advanced analysis for blockchain transactions
 * with a focus on providing actionable recommendations for failed transactions.
 */

const axios = require('axios');
const logger = require('../../utils/logger');
const cosmosRegistry = require('../../utils/cosmosRegistry');

class TransactionAnalyzer {
  constructor() {
    this.initialized = true;
  }
  
  /**
   * Analyze a transaction and provide insights
   * @param {Object} params - Transaction parameters
   * @param {string} params.txHash - Transaction hash
   * @param {string} params.chainId - Chain ID (e.g., "stargaze-1", "osmosis-1")
   * @param {boolean} params.detailed - Whether to provide detailed analysis (default: false)
   * @returns {Promise<Object>} - Transaction analysis with recommendations
   */
  async analyzeTransaction(params) {
    const { txHash, chainId = 'stargaze-1', detailed = false } = params;
    
    if (!txHash) {
      throw new Error('Transaction hash is required');
    }
    
    try {
      logger.info('Analyzing transaction', {
        service: 'txAnalyzer',
        txHash,
        chainId,
        detailed
      });
      
      // Get endpoint from registry
      const chainName = cosmosRegistry.chainIdToName(chainId);
      const endpoint = await cosmosRegistry.getRestEndpoint(chainName);
      
      // Fetch transaction data
      const txData = await this._fetchTxData(endpoint, txHash);
      
      // Basic analysis
      const basicAnalysis = await this._performBasicAnalysis(txData, chainId);
      
      // For successful transactions or non-detailed requests, return basic analysis
      if (basicAnalysis.success || !detailed) {
        return {
          ...basicAnalysis,
          recommendations: basicAnalysis.success ? [] : this._getBasicRecommendations(basicAnalysis)
        };
      }
      
      // Perform detailed analysis for failed transactions
      const detailedAnalysis = await this._performDetailedAnalysis(txData, chainId, basicAnalysis);
      
      return detailedAnalysis;
    } catch (error) {
      logger.error('Error analyzing transaction', {
        service: 'txAnalyzer',
        txHash,
        chainId,
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * Fetch transaction data from API
   * @param {string} endpoint - API endpoint
   * @param {string} txHash - Transaction hash
   * @returns {Promise<Object>} - Transaction data
   * @private
   */
  async _fetchTxData(endpoint, txHash) {
    try {
      // Transaction endpoint for Cosmos SDK chains
      const url = `${endpoint}/cosmos/tx/v1beta1/txs/${txHash}`;
      
      logger.info('Fetching transaction data', {
        service: 'txAnalyzer',
        url,
        txHash
      });
      
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch transaction: ${response.statusText}`);
      }
      
      return response.data;
    } catch (error) {
      // Try backup endpoint if primary fails
      if (error.response && error.response.status === 404) {
        return this._fetchFromBackupEndpoint(txHash);
      }
      
      throw error;
    }
  }
  
  /**
   * Fetch transaction data from backup endpoint
   * @param {string} txHash - Transaction hash
   * @returns {Promise<Object>} - Transaction data
   * @private
   */
  async _fetchFromBackupEndpoint(txHash) {
    try {
      // Use Cosmos Directory as backup
      const url = `https://rest.cosmos.directory/stargaze/cosmos/tx/v1beta1/txs/${txHash}`;
      
      logger.info('Fetching from backup endpoint', {
        service: 'txAnalyzer',
        url,
        txHash
      });
      
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch transaction from backup: ${response.statusText}`);
      }
      
      return response.data;
    } catch (error) {
      throw new Error(`Transaction ${txHash} not found: ${error.message}`);
    }
  }
  
  /**
   * Perform basic transaction analysis
   * @param {Object} txData - Transaction data
   * @param {string} chainId - Chain ID
   * @returns {Promise<Object>} - Basic analysis
   * @private
   */
  async _performBasicAnalysis(txData, chainId) {
    try {
      const txResponse = txData.tx_response;
      const chainName = cosmosRegistry.chainIdToName(chainId);
      
      if (!txResponse) {
        return {
          success: false,
          errorType: 'invalid_data',
          error: 'Invalid transaction data format',
          analysis: 'Unable to analyze transaction due to invalid data format.'
        };
      }
      
      // Determine if transaction was successful
      const isSuccess = txResponse.code === 0;
      const rawError = !isSuccess ? txResponse.raw_log : null;
      
      // Extract basic transaction info
      const analysis = {
        hash: txResponse.txhash,
        success: isSuccess,
        chainId,
        chainName,
        blockHeight: txResponse.height,
        timestamp: txResponse.timestamp,
        gasWanted: txResponse.gas_wanted,
        gasUsed: txResponse.gas_used,
        error: rawError,
        errorType: null,
      };
      
      // Extract message information
      if (txData.tx && txData.tx.body && txData.tx.body.messages) {
        analysis.messages = txData.tx.body.messages;
        analysis.messageCount = txData.tx.body.messages.length;
        analysis.transactionType = this._determineTransactionType(analysis.messages, chainName);
      }
      
      // Extract fee information
      if (txData.tx && txData.tx.auth_info && txData.tx.auth_info.fee) {
        analysis.fees = txData.tx.auth_info.fee.amount || [];
      }
      
      // For failed transactions, determine error type
      if (!isSuccess && rawError) {
        analysis.errorType = this._determineErrorType(rawError);
        analysis.cleanError = this._cleanErrorMessage(rawError);
        analysis.analysis = `Transaction failed on ${chainName} blockchain. Error: ${analysis.cleanError}`;
      } else if (isSuccess) {
        analysis.analysis = `Transaction was successful on ${chainName} blockchain.`;
      } else {
        analysis.analysis = `Transaction status could not be determined on ${chainName} blockchain.`;
      }
      
      return analysis;
    } catch (error) {
      logger.error('Error in basic analysis', {
        service: 'txAnalyzer',
        error: error.message
      });
      
      return {
        success: false,
        errorType: 'analysis_error',
        error: `Error analyzing transaction: ${error.message}`,
        analysis: 'Failed to analyze transaction due to an internal error.'
      };
    }
  }
  
  /**
   * Perform detailed transaction analysis for failed transactions
   * @param {Object} txData - Transaction data
   * @param {string} chainId - Chain ID
   * @param {Object} basicAnalysis - Basic analysis results
   * @returns {Promise<Object>} - Detailed analysis
   * @private
   */
  async _performDetailedAnalysis(txData, chainId, basicAnalysis) {
    try {
      const detailedAnalysis = { ...basicAnalysis };
      
      // Add recommendations based on error type
      detailedAnalysis.recommendations = this._generateRecommendations(detailedAnalysis);
      
      // Add additional context for certain error types
      switch (detailedAnalysis.errorType) {
        case 'insufficient_funds':
          // Enhance with account balance info if possible
          if (this._canExtractAddress(txData)) {
            const address = this._extractSenderAddress(txData);
            if (address) {
              try {
                // Attempt to get current balance
                detailedAnalysis.context = {
                  address,
                  balanceCheck: 'Recommend checking current balance'
                };
              } catch (e) {
                // Ignore balance fetch errors
              }
            }
          }
          break;
          
        case 'nft_related':
          // Add specifics about the NFT if available
          if (this._canExtractNftInfo(txData)) {
            const nftInfo = this._extractNftInfo(txData);
            if (nftInfo) {
              detailedAnalysis.context = {
                nftInfo
              };
            }
          }
          break;
          
        case 'contract_execution_failed':
          // Add contract-specific details
          detailedAnalysis.context = {
            contractError: this._extractContractError(detailedAnalysis.error)
          };
          break;
      }
      
      return detailedAnalysis;
    } catch (error) {
      logger.error('Error in detailed analysis', {
        service: 'txAnalyzer',
        error: error.message
      });
      
      // Fall back to basic analysis if detailed fails
      return {
        ...basicAnalysis,
        recommendations: this._getBasicRecommendations(basicAnalysis)
      };
    }
  }
  
  /**
   * Determine transaction type from messages
   * @param {Array} messages - Transaction messages
   * @param {string} chainName - Chain name
   * @returns {string} - Transaction type
   * @private
   */
  _determineTransactionType(messages, chainName) {
    if (!messages || messages.length === 0) {
      return 'unknown';
    }
    
    try {
      const firstMsg = messages[0];
      const typeUrl = firstMsg['@type'] || firstMsg.type_url;
      
      if (!typeUrl) {
        return 'unknown';
      }
      
      // Extract the message type from the type URL
      const msgType = typeUrl.split('.').pop();
      
      // Common message types across chains
      switch (msgType) {
        case 'MsgSend':
          return 'transfer';
        case 'MsgExecuteContract':
          return 'contract_execution';
        case 'MsgInstantiateContract':
          return 'contract_instantiation';
        case 'MsgStoreCode':
          return 'code_upload';
        case 'MsgDelegate':
          return 'delegation';
        case 'MsgUndelegate':
          return 'undelegation';
        case 'MsgBeginRedelegate':
          return 'redelegation';
        case 'MsgWithdrawDelegatorReward':
          return 'reward_claim';
        case 'MsgVote':
          return 'governance_vote';
        case 'MsgSubmitProposal':
          return 'proposal_submission';
        default:
          return 'unknown';
      }
    } catch (error) {
      return 'unknown';
    }
  }
  
  /**
   * Determine error type from error message
   * @param {string} errorMessage - Error message
   * @returns {string} - Error type
   * @private
   */
  _determineErrorType(errorMessage) {
    if (!errorMessage) {
      return 'unknown';
    }
    
    // Common error types
    if (errorMessage.includes('insufficient funds') || 
        errorMessage.includes('not enough funds')) {
      return 'insufficient_funds';
    }
    
    if (errorMessage.includes('out of gas') || 
        errorMessage.includes('gas limit exceeded')) {
      return 'gas_limit_exceeded';
    }
    
    if (errorMessage.includes('insufficient fee') || 
        errorMessage.includes('fee smaller than minimum')) {
      return 'insufficient_fee';
    }
    
    if (errorMessage.includes('execute wasm contract failed') || 
        errorMessage.includes('contract execution failed')) {
      return 'contract_execution_failed';
    }
    
    if (errorMessage.includes('account sequence mismatch') || 
        errorMessage.includes('incorrect account sequence')) {
      return 'account_sequence_mismatch';
    }
    
    // NFT-specific errors
    if (errorMessage.includes('token not found') || 
        errorMessage.includes('listing not found') || 
        errorMessage.includes('nft')) {
      return 'nft_related';
    }
    
    return 'unknown';
  }
  
  /**
   * Clean up error message for display
   * @param {string} errorMessage - Raw error message
   * @returns {string} - Cleaned error message
   * @private
   */
  _cleanErrorMessage(errorMessage) {
    if (!errorMessage) {
      return 'Unknown error';
    }
    
    try {
      // Check if it's a JSON string
      if (errorMessage.startsWith('{') && errorMessage.endsWith('}')) {
        try {
          const errorObj = JSON.parse(errorMessage);
          if (errorObj.message) {
            return errorObj.message;
          }
        } catch (e) {
          // Not a valid JSON, continue with regular processing
        }
      }
      
      // Remove common prefixes
      let cleanMessage = errorMessage;
      const prefixesToRemove = [
        'failed to execute message; message index: 0:',
        'rpc error:',
        'Exception:',
        'Error:'
      ];
      
      for (const prefix of prefixesToRemove) {
        if (cleanMessage.includes(prefix)) {
          cleanMessage = cleanMessage.split(prefix).pop().trim();
        }
      }
      
      // Limit length
      return cleanMessage.length > 100 
        ? cleanMessage.substring(0, 100) + '...' 
        : cleanMessage;
    } catch (error) {
      return errorMessage;
    }
  }
  
  /**
   * Extract more specific contract error
   * @param {string} errorMessage - Raw error message
   * @returns {string} - Contract error
   * @private
   */
  _extractContractError(errorMessage) {
    if (!errorMessage) {
      return 'Unknown contract error';
    }
    
    try {
      // Check for JSON patterns in the error
      const jsonMatch = errorMessage.match(/{.*}/);
      if (jsonMatch) {
        try {
          const errorObj = JSON.parse(jsonMatch[0]);
          if (errorObj.msg) {
            return errorObj.msg;
          }
        } catch (e) {
          // Not valid JSON
        }
      }
      
      // Look for common error patterns
      const errorPatterns = [
        /failed: (.*?) at/i,
        /error: (.*?)(?:$|\n)/i,
        /message: "(.*?)"/i,
        /msg: "(.*?)"/i
      ];
      
      for (const pattern of errorPatterns) {
        const match = errorMessage.match(pattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
      
      return errorMessage;
    } catch (error) {
      return 'Unknown contract error';
    }
  }
  
  /**
   * Generate recommendations based on error type
   * @param {Object} analysis - Basic analysis
   * @returns {Array<string>} - Recommendations
   * @private
   */
  _generateRecommendations(analysis) {
    // Default recommendations for unknown errors
    const defaultRecommendations = [
      'Try the transaction again',
      'Check your network connection',
      'Ensure you have sufficient balance including gas fees',
      'If the issue persists, check the blockchain\'s status or contact support'
    ];
    
    if (!analysis.errorType) {
      return defaultRecommendations;
    }
    
    // Error-specific recommendations
    switch (analysis.errorType) {
      case 'insufficient_funds':
        return [
          'Check your wallet balance',
          'Ensure you have enough tokens to cover both the transaction amount and gas fees',
          'If needed, transfer more tokens to your wallet before retrying'
        ];
        
      case 'gas_limit_exceeded':
        return [
          'Increase the gas limit for your transaction',
          `Try setting gas limit to at least 1.5x the amount that was used (${analysis.gasUsed})`,
          'Consider simplifying your transaction if possible'
        ];
        
      case 'insufficient_fee':
        return [
          'Increase the transaction fee',
          'Check the current network fee requirements',
          'Wait for network congestion to decrease if fees are currently high'
        ];
        
      case 'contract_execution_failed':
        const contractError = this._extractContractError(analysis.error);
        if (contractError.includes('listing not found')) {
          return [
            'The NFT listing you tried to interact with no longer exists',
            'The NFT may have been sold or delisted',
            'Refresh the marketplace page to see the current status',
            'Try searching for other available NFTs'
          ];
        } else if (contractError.includes('token not found')) {
          return [
            'The NFT token you tried to interact with does not exist or is not owned by the expected address',
            'Verify that the token ID is correct',
            'Check that you own the NFT you\'re trying to list or transfer',
            'Refresh the collection page and try again'
          ];
        } else if (contractError.includes('invalid funds')) {
          return [
            'The funds provided for this transaction were invalid',
            'Check that you\'re using the correct token denomination (e.g., STARS)',
            'Verify the price matches what\'s listed',
            'Make sure you have enough tokens plus gas fees'
          ];
        }
        return [
          'Check that you meet all the requirements for this contract interaction',
          'Verify your parameters and inputs are correct',
          'Try again with different parameters if needed',
          'Check if the contract has specific requirements (e.g., whitelist, minimum amounts)'
        ];
        
      case 'account_sequence_mismatch':
        return [
          'Your wallet nonce (transaction sequence) is out of sync with the blockchain',
          'Reset your wallet connection',
          'Refresh the page and try again',
          'Try using a different wallet app if the issue persists',
          'Wait a few minutes for any pending transactions to complete'
        ];
        
      case 'nft_related':
        return [
          'Verify the NFT still exists and is available',
          'Check that you have the correct permissions for this NFT operation',
          'Refresh the NFT marketplace or collection page',
          'If you\'re trying to buy an NFT, it may have already been purchased'
        ];
        
      default:
        return defaultRecommendations;
    }
  }
  
  /**
   * Get basic recommendations for error types
   * @param {Object} analysis - Basic analysis
   * @returns {Array<string>} - Basic recommendations
   * @private
   */
  _getBasicRecommendations(analysis) {
    if (analysis.success) {
      return [];
    }
    
    return [
      'Check transaction details and try again',
      'Ensure you have sufficient balance for the transaction',
      'For detailed analysis, request transaction details with the detailed flag'
    ];
  }
  
  /**
   * Check if we can extract sender address
   * @param {Object} txData - Transaction data
   * @returns {boolean} - Whether address can be extracted
   * @private
   */
  _canExtractAddress(txData) {
    return !!(txData.tx && 
             txData.tx.body && 
             txData.tx.body.messages && 
             txData.tx.body.messages.length > 0 &&
             (txData.tx.body.messages[0].from_address || txData.tx.body.messages[0].sender));
  }
  
  /**
   * Extract sender address
   * @param {Object} txData - Transaction data
   * @returns {string|null} - Sender address
   * @private
   */
  _extractSenderAddress(txData) {
    try {
      const msg = txData.tx.body.messages[0];
      return msg.from_address || msg.sender || null;
    } catch (e) {
      return null;
    }
  }
  
  /**
   * Check if we can extract NFT info
   * @param {Object} txData - Transaction data
   * @returns {boolean} - Whether NFT info can be extracted
   * @private
   */
  _canExtractNftInfo(txData) {
    if (!txData.tx || !txData.tx.body || !txData.tx.body.messages || txData.tx.body.messages.length === 0) {
      return false;
    }
    
    const msg = txData.tx.body.messages[0];
    return !!(msg['@type'] === '/cosmwasm.wasm.v1.MsgExecuteContract' && msg.msg);
  }
  
  /**
   * Extract NFT info
   * @param {Object} txData - Transaction data
   * @returns {Object|null} - NFT info
   * @private
   */
  _extractNftInfo(txData) {
    try {
      const msg = txData.tx.body.messages[0];
      
      if (msg['@type'] !== '/cosmwasm.wasm.v1.MsgExecuteContract' || !msg.msg) {
        return null;
      }
      
      // Try to parse the message
      let nftMsg;
      if (typeof msg.msg === 'string') {
        try {
          nftMsg = JSON.parse(msg.msg);
        } catch (e) {
          return null;
        }
      } else {
        nftMsg = msg.msg;
      }
      
      // Check for common NFT operations
      if (nftMsg.buy_nft) {
        return {
          operation: 'buy_nft',
          ...nftMsg.buy_nft
        };
      } else if (nftMsg.list_nft) {
        return {
          operation: 'list_nft',
          ...nftMsg.list_nft
        };
      } else if (nftMsg.transfer_nft) {
        return {
          operation: 'transfer_nft',
          ...nftMsg.transfer_nft
        };
      }
      
      return null;
    } catch (e) {
      return null;
    }
  }
}

module.exports = new TransactionAnalyzer(); 