/**
 * Blockchain Service for Dail Bot
 * 
 * This module handles blockchain queries, transaction analysis, and API calls
 * for Cosmos ecosystem chains.
 */

const axios = require('axios');
const logger = require('../../utils/logger');
const cosmosRegistry = require('../../utils/cosmosRegistry');

class BlockchainService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the blockchain service
   */
  initialize() {
    this.initialized = true;
    logger.info('Blockchain service initialized successfully', {
      service: 'dail-bot'
    });
  }

  /**
   * Get transaction details from Cosmos chain
   * @param {Object} params - Transaction parameters
   * @param {string} params.txHash - Transaction hash
   * @param {string} params.chainId - Chain ID (e.g., "stargaze-1", "osmosis-1")
   * @returns {Promise<Object>} - Transaction details and analysis
   */
  async getTransactionDetails(params) {
    if (!this.initialized) {
      throw new Error('Blockchain service not initialized');
    }

    const { txHash, chainId = 'stargaze-1' } = params;

    if (!txHash) {
      throw new Error('Transaction hash is required');
    }

    try {
      logger.info('Getting transaction details', {
        service: 'dail-bot',
        txHash,
        chainId
      });

      // Convert chain ID to name for registry lookup
      const chainName = cosmosRegistry.chainIdToName(chainId);
      const endpoint = await cosmosRegistry.getRestEndpoint(chainName);

      // Fetch transaction data
      const txData = await this._fetchTxData(endpoint, txHash);
      
      // Analyze the transaction
      const analysis = this._analyzeTxData(txData, chainId);

      return {
        chain: chainName,
        chainId,
        txHash,
        ...txData,
        analysis
      };
    } catch (error) {
      logger.error('Error fetching transaction details', {
        service: 'dail-bot',
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
        service: 'dail-bot',
        url,
        txHash
      });

      const response = await axios.get(url);
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch transaction: ${response.statusText}`);
      }

      return response.data;
    } catch (error) {
      // Check if transaction not found
      if (error.response && error.response.status === 404) {
        throw new Error(`Transaction ${txHash} not found`);
      }
      
      throw new Error(`Failed to fetch transaction data: ${error.message}`);
    }
  }

  /**
   * Analyze transaction data to provide insights
   * @param {Object} txData - Transaction data from API
   * @param {string} chainId - Chain ID
   * @returns {Object} - Transaction analysis
   * @private
   */
  _analyzeTxData(txData, chainId) {
    try {
      const analysis = {
        status: 'unknown',
        messages: [],
        fees: [],
        events: [],
        errorCode: null,
        errorMessage: null,
        humanReadableSummary: '',
        timestamp: null,
        txType: 'unknown',
        chainSpecific: {}
      };

      // Check if we have a valid tx response
      if (!txData || !txData.tx_response) {
        return {
          ...analysis,
          status: 'error',
          errorMessage: 'Invalid transaction data format'
        };
      }

      const txResponse = txData.tx_response;
      const chainName = cosmosRegistry.chainIdToName(chainId);

      // Transaction success/failure status
      analysis.status = txResponse.code === 0 ? 'success' : 'failed';
      analysis.errorCode = txResponse.code || null;
      analysis.errorMessage = txResponse.raw_log || null;
      analysis.timestamp = txResponse.timestamp || null;

      // Extract events
      if (txResponse.logs && txResponse.logs.length > 0) {
        for (const log of txResponse.logs) {
          if (log.events) {
            analysis.events = analysis.events.concat(log.events);
          }
        }
      }

      // Extract fee information
      if (txData.tx && txData.tx.auth_info && txData.tx.auth_info.fee) {
        analysis.fees = txData.tx.auth_info.fee.amount || [];
      }

      // Extract message information
      if (txData.tx && txData.tx.body && txData.tx.body.messages) {
        analysis.messages = txData.tx.body.messages;
        
        // Determine transaction type from messages
        analysis.txType = this._determineTxType(analysis.messages, chainName);
      }

      // Add chain-specific analysis
      analysis.chainSpecific = this._extractChainSpecificData(analysis, txResponse, chainName);

      // Create human-readable summary
      analysis.humanReadableSummary = this._createTransactionSummary(analysis, txResponse, chainId);

      return analysis;
    } catch (error) {
      logger.error('Error analyzing transaction data', {
        service: 'dail-bot',
        error: error.message
      });

      return {
        status: 'error',
        errorMessage: `Error analyzing transaction: ${error.message}`,
        humanReadableSummary: 'Unable to analyze transaction due to an error.'
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
  _determineTxType(messages, chainName) {
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
        case 'MsgDeposit':
          return 'proposal_deposit';
        case 'MsgCreateValidator':
          return 'validator_creation';
        case 'MsgEditValidator':
          return 'validator_update';
        default:
          break;
      }

      // Chain-specific message types
      if (chainName === 'stargaze' && msgType === 'MsgExecuteContract') {
        // Check if this is a marketplace transaction
        if (messages.length > 0 && messages[0].contract) {
          return 'nft_transaction';
        }
      }

      // Jackal-specific message types
      if (chainName === 'jackal') {
        if (msgType.includes('Post') || msgType.includes('Put')) {
          return 'storage_upload';
        }
        if (msgType.includes('Delete')) {
          return 'storage_delete';
        }
      }

      // If we can't determine a specific type, return the message type as-is
      return msgType.toLowerCase();
    } catch (error) {
      logger.error('Error determining transaction type', {
        service: 'dail-bot',
        error: error.message
      });
      return 'unknown';
    }
  }

  /**
   * Extract chain-specific data from transaction
   * @param {Object} analysis - Current analysis object
   * @param {Object} txResponse - Transaction response
   * @param {string} chainName - Chain name
   * @returns {Object} - Chain-specific data
   * @private
   */
  _extractChainSpecificData(analysis, txResponse, chainName) {
    const chainSpecific = {};

    try {
      // Check chain-specific logic
      switch (chainName) {
        case 'stargaze':
          // Extract NFT data for Stargaze transactions
          if (analysis.txType === 'nft_transaction' || analysis.txType === 'contract_execution') {
            chainSpecific.nft = this._extractNftData(analysis.events);
          }
          break;
        
        case 'osmosis':
          // Extract swap data for Osmosis transactions
          if (analysis.events && analysis.events.length > 0) {
            chainSpecific.swap = this._extractSwapData(analysis.events);
            chainSpecific.liquidity = this._extractLiquidityData(analysis.events);
          }
          break;
        
        case 'jackal':
          // Extract storage data for Jackal transactions
          if (analysis.txType.includes('storage')) {
            chainSpecific.storage = this._extractStorageData(analysis.events);
          } else if (analysis.txType.includes('deployment')) {
            chainSpecific.deployment = this._extractDeploymentData(analysis.events);
          } else if (analysis.txType.includes('lease')) {
            chainSpecific.lease = this._extractLeaseData(analysis.events);
          }
          // Extract unencrypted events
          chainSpecific.unencryptedEvents = this._extractUnencryptedEvents(analysis.events);
          break;
        
        default:
          // No chain-specific data extraction for other chains
          break;
      }

      return chainSpecific;
    } catch (error) {
      logger.error('Error extracting chain-specific data', {
        service: 'dail-bot',
        chainName,
        error: error.message
      });
      
      return chainSpecific;
    }
  }

  /**
   * Extract NFT data from transaction events
   * @param {Array} events - Transaction events
   * @returns {Object} - NFT data
   * @private
   */
  _extractNftData(events) {
    const nftData = {
      tokenId: null,
      collection: null,
      action: 'unknown',
      price: null,
      seller: null,
      buyer: null
    };

    try {
      if (!events || events.length === 0) {
        return nftData;
      }

      // Look for wasm events
      for (const event of events) {
        if (event.type === 'wasm') {
          // Extract relevant attributes
          for (const attr of event.attributes) {
            const key = attr.key;
            const value = attr.value;
            
            if (key === 'token_id') {
              nftData.tokenId = value;
            } else if (key === 'collection') {
              nftData.collection = value;
            } else if (key === 'action') {
              nftData.action = value;
            } else if (key === 'price') {
              nftData.price = value;
            } else if (key === 'seller') {
              nftData.seller = value;
            } else if (key === 'buyer') {
              nftData.buyer = value;
            }
          }
        }
      }

      return nftData;
    } catch (error) {
      logger.error('Error extracting NFT data', {
        service: 'dail-bot',
        error: error.message
      });
      return nftData;
    }
  }

  /**
   * Extract swap data from Osmosis transaction events
   * @param {Array} events - Transaction events
   * @returns {Object} - Swap data
   * @private
   */
  _extractSwapData(events) {
    const swapData = {
      tokenIn: null,
      amountIn: null,
      tokenOut: null,
      amountOut: null
    };

    try {
      if (!events || events.length === 0) {
        return swapData;
      }

      // Look for token_swapped events
      for (const event of events) {
        if (event.type === 'token_swapped') {
          // Extract relevant attributes
          for (const attr of event.attributes) {
            const key = attr.key;
            const value = attr.value;
            
            if (key === 'tokens_in') {
              swapData.amountIn = value;
            } else if (key === 'tokens_out') {
              swapData.amountOut = value;
            }
          }
        } else if (event.type === 'transfer') {
          // Additional logic to determine token types
          // Not implemented for brevity
        }
      }

      return swapData;
    } catch (error) {
      logger.error('Error extracting swap data', {
        service: 'dail-bot',
        error: error.message
      });
      return swapData;
    }
  }

  /**
   * Extract liquidity data from Osmosis transaction events
   * @param {Array} events - Transaction events
   * @returns {Object} - Liquidity data
   * @private
   */
  _extractLiquidityData(events) {
    const liquidityData = {
      poolId: null,
      tokens: [],
      shares: null,
      action: 'unknown'
    };

    try {
      if (!events || events.length === 0) {
        return liquidityData;
      }

      // Look for liquidity-related events
      for (const event of events) {
        if (event.type === 'add_liquidity' || event.type === 'remove_liquidity') {
          liquidityData.action = event.type.replace('_', ' ');
          
          // Extract relevant attributes
          for (const attr of event.attributes) {
            const key = attr.key;
            const value = attr.value;
            
            if (key === 'pool_id') {
              liquidityData.poolId = value;
            } else if (key === 'tokens_in' || key === 'tokens_out') {
              liquidityData.tokens.push(value);
            } else if (key === 'shares') {
              liquidityData.shares = value;
            }
          }
        }
      }

      return liquidityData;
    } catch (error) {
      logger.error('Error extracting liquidity data', {
        service: 'dail-bot',
        error: error.message
      });
      return liquidityData;
    }
  }

  /**
   * Extract deployment data from Jackal transaction events
   * @param {Array} events - Transaction events
   * @returns {Object} - Deployment data
   * @private
   */
  _extractDeploymentData(events) {
    const deploymentData = {
      provider: null,
      storage: null,
      duration: null,
      cost: null
    };

    try {
      if (!events || events.length === 0) {
        return deploymentData;
      }

      // Implementation specific to Jackal deployment events
      // This is a simplified version

      return deploymentData;
    } catch (error) {
      logger.error('Error extracting deployment data', {
        service: 'dail-bot',
        error: error.message
      });
      return deploymentData;
    }
  }

  /**
   * Extract lease data from Jackal transaction events
   * @param {Array} events - Transaction events
   * @returns {Object} - Lease data
   * @private
   */
  _extractLeaseData(events) {
    const leaseData = {
      provider: null,
      size: null,
      duration: null,
      cost: null
    };

    try {
      if (!events || events.length === 0) {
        return leaseData;
      }

      // Implementation specific to Jackal lease events
      // This is a simplified version

      return leaseData;
    } catch (error) {
      logger.error('Error extracting lease data', {
        service: 'dail-bot',
        error: error.message
      });
      return leaseData;
    }
  }

  /**
   * Extract unencrypted events from Jackal transaction
   * @param {Array} events - Transaction events
   * @returns {Array} - Unencrypted events
   * @private
   */
  _extractUnencryptedEvents(events) {
    try {
      if (!events || events.length === 0) {
        return [];
      }

      // This would extract data from Jackal-specific events
      // Implementation simplified for brevity
      return [];
    } catch (error) {
      logger.error('Error extracting unencrypted events', {
        service: 'dail-bot',
        error: error.message
      });
      return [];
    }
  }

  /**
   * Extract storage data from Jackal transaction events
   * @param {Array} events - Transaction events
   * @returns {Object} - Storage data
   * @private
   */
  _extractStorageData(events) {
    const storageData = {
      files: [],
      folders: [],
      action: 'unknown',
      size: null
    };

    try {
      if (!events || events.length === 0) {
        return storageData;
      }

      // Implementation specific to Jackal storage events
      // This is a simplified version

      return storageData;
    } catch (error) {
      logger.error('Error extracting storage data', {
        service: 'dail-bot',
        error: error.message
      });
      return storageData;
    }
  }

  /**
   * Create a human-readable summary of the transaction
   * @param {Object} analysis - Transaction analysis
   * @param {Object} txResponse - Transaction response
   * @param {string} chainId - Chain ID
   * @returns {string} - Human-readable summary
   * @private
   */
  _createTransactionSummary(analysis, txResponse, chainId) {
    try {
      const chainName = cosmosRegistry.chainIdToName(chainId);
      let summary = '';

      // Base summary based on transaction status
      if (analysis.status === 'success') {
        summary = `Transaction was successful on ${chainName} blockchain.`;
      } else {
        summary = `Transaction failed on ${chainName} blockchain.`;
        
        // Add error details if available
        if (analysis.errorMessage) {
          const cleanError = this._extractCleanErrorMessage(analysis.errorMessage);
          summary += ` Error: ${cleanError}`;
        }
        
        return summary;
      }

      // Add type-specific details
      switch (analysis.txType) {
        case 'transfer':
          summary += this._createTransferSummary(analysis);
          break;
        case 'delegation':
          summary += ' Tokens were delegated to a validator.';
          break;
        case 'undelegation':
          summary += ' Tokens were undelegated from a validator.';
          break;
        case 'redelegation':
          summary += ' Tokens were redelegated from one validator to another.';
          break;
        case 'reward_claim':
          summary += ' Staking rewards were claimed.';
          break;
        case 'governance_vote':
          summary += ' A vote was cast on a governance proposal.';
          break;
        case 'proposal_submission':
          summary += ' A new governance proposal was submitted.';
          break;
        case 'contract_execution':
          summary += this._createContractExecutionSummary(analysis, chainName);
          break;
        case 'nft_transaction':
          summary += this._createNftTransactionSummary(analysis, chainName);
          break;
        case 'storage_upload':
          summary += ' Data was uploaded to Jackal storage.';
          break;
        case 'storage_delete':
          summary += ' Data was deleted from Jackal storage.';
          break;
        default:
          // For other transaction types, just use the type
          summary += ` Transaction type: ${analysis.txType}.`;
          break;
      }

      // Add fee information if available
      if (analysis.fees && analysis.fees.length > 0) {
        const fee = analysis.fees[0];
        if (fee.amount && fee.denom) {
          const formattedFee = this._formatCoinAmount(fee.amount, fee.denom);
          summary += ` Transaction fee: ${formattedFee}.`;
        }
      }

      return summary;
    } catch (error) {
      logger.error('Error creating transaction summary', {
        service: 'dail-bot',
        error: error.message
      });
      return 'Transaction details unavailable.';
    }
  }

  /**
   * Create a summary for transfer transactions
   * @param {Object} analysis - Transaction analysis
   * @returns {string} - Transfer summary
   * @private
   */
  _createTransferSummary(analysis) {
    let summary = '';
    
    try {
      // Extract sender, receiver, and amount from messages
      if (analysis.messages && analysis.messages.length > 0) {
        const msg = analysis.messages[0];
        
        if (msg.from_address && msg.to_address) {
          const shortenedFrom = this._shortenAddress(msg.from_address);
          const shortenedTo = this._shortenAddress(msg.to_address);
          
          summary += ` Tokens were transferred from ${shortenedFrom} to ${shortenedTo}.`;
          
          // Add amount information if available
          if (msg.amount && msg.amount.length > 0) {
            const amount = msg.amount[0];
            if (amount.amount && amount.denom) {
              const formattedAmount = this._formatCoinAmount(amount.amount, amount.denom);
              summary += ` Amount: ${formattedAmount}.`;
            }
          }
        }
      }
      
      return summary;
    } catch (error) {
      logger.error('Error creating transfer summary', {
        service: 'dail-bot',
        error: error.message
      });
      return ' Token transfer transaction.';
    }
  }

  /**
   * Create a summary for contract execution transactions
   * @param {Object} analysis - Transaction analysis
   * @param {string} chainName - Chain name
   * @returns {string} - Contract execution summary
   * @private
   */
  _createContractExecutionSummary(analysis, chainName) {
    let summary = '';
    
    try {
      // Chain-specific contract execution handling
      if (chainName === 'stargaze' && analysis.chainSpecific && analysis.chainSpecific.nft) {
        return this._createNftTransactionSummary(analysis, chainName);
      }
      
      summary = ' A smart contract was executed.';
      
      return summary;
    } catch (error) {
      logger.error('Error creating contract execution summary', {
        service: 'dail-bot',
        error: error.message
      });
      return ' Smart contract execution.';
    }
  }

  /**
   * Create a summary for NFT transactions
   * @param {Object} analysis - Transaction analysis
   * @param {string} chainName - Chain name
   * @returns {string} - NFT transaction summary
   * @private
   */
  _createNftTransactionSummary(analysis, chainName) {
    let summary = '';
    
    try {
      if (analysis.chainSpecific && analysis.chainSpecific.nft) {
        const nftData = analysis.chainSpecific.nft;
        
        if (nftData.action === 'buy_nft') {
          summary += ` NFT was purchased`;
        } else if (nftData.action === 'list_nft') {
          summary += ` NFT was listed for sale`;
        } else if (nftData.action === 'transfer_nft') {
          summary += ` NFT was transferred`;
        } else if (nftData.action === 'mint_nft') {
          summary += ` NFT was minted`;
        } else {
          summary += ` NFT transaction occurred`;
        }
        
        // Add collection and token ID if available
        if (nftData.collection) {
          summary += ` from collection ${nftData.collection}`;
        }
        
        if (nftData.tokenId) {
          summary += `, token ID ${nftData.tokenId}`;
        }
        
        // Add price information for buy/sell transactions
        if (nftData.price && (nftData.action === 'buy_nft' || nftData.action === 'list_nft')) {
          summary += ` for ${nftData.price}`;
        }
        
        summary += '.';
      } else {
        summary += ' NFT transaction.';
      }
      
      return summary;
    } catch (error) {
      logger.error('Error creating NFT transaction summary', {
        service: 'dail-bot',
        error: error.message
      });
      return ' NFT transaction.';
    }
  }

  /**
   * Format coin amount with proper denomination
   * @param {string} amount - Coin amount
   * @param {string} denom - Coin denomination
   * @returns {string} - Formatted coin amount
   * @private
   */
  _formatCoinAmount(amount, denom) {
    try {
      // Common denominations in Cosmos
      const denomMap = {
        'ustars': { name: 'STARS', exponent: 6 },
        'uatom': { name: 'ATOM', exponent: 6 },
        'uosmo': { name: 'OSMO', exponent: 6 },
        'ujuno': { name: 'JUNO', exponent: 6 },
        'ujkl': { name: 'JKL', exponent: 6 },
        'untrn': { name: 'NTRN', exponent: 6 },
        'ucheq': { name: 'CHEQ', exponent: 6 },
        'uakt': { name: 'AKT', exponent: 6 }
      };
      
      if (denomMap[denom]) {
        const { name, exponent } = denomMap[denom];
        const convertedAmount = Number(amount) / Math.pow(10, exponent);
        return `${convertedAmount.toFixed(4)} ${name}`;
      }
      
      // Default formatting for unknown denominations
      return `${amount} ${denom}`;
    } catch (error) {
      return `${amount} ${denom}`;
    }
  }

  /**
   * Shorten an address for display
   * @param {string} address - Blockchain address
   * @returns {string} - Shortened address
   * @private
   */
  _shortenAddress(address) {
    if (!address || address.length < 10) {
      return address;
    }
    
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  /**
   * Extract a clean error message from the raw error
   * @param {string} errorMessage - Raw error message
   * @returns {string} - Clean error message
   * @private
   */
  _extractCleanErrorMessage(errorMessage) {
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
   * Get account balance from Cosmos chain
   * @param {Object} params - Balance parameters
   * @param {string} params.address - Account address
   * @param {string} params.chainId - Chain ID (e.g., "stargaze-1", "osmosis-1")
   * @returns {Promise<Object>} - Account balance
   */
  async getAccountBalance(params) {
    if (!this.initialized) {
      throw new Error('Blockchain service not initialized');
    }

    const { address, chainId = 'stargaze-1' } = params;

    if (!address) {
      throw new Error('Account address is required');
    }

    try {
      logger.info('Getting account balance', {
        service: 'dail-bot',
        address,
        chainId
      });

      // Convert chain ID to name for registry lookup
      const chainName = cosmosRegistry.chainIdToName(chainId);
      const endpoint = await cosmosRegistry.getRestEndpoint(chainName);

      // Fetch account balance data
      const url = `${endpoint}/cosmos/bank/v1beta1/balances/${address}`;
      
      const response = await axios.get(url);
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch account balance: ${response.statusText}`);
      }

      // Format the balance data
      const balances = response.data.balances || [];
      const formattedBalances = balances.map(balance => ({
        amount: balance.amount,
        denom: balance.denom,
        formatted: this._formatCoinAmount(balance.amount, balance.denom)
      }));

      return {
        address,
        chain: chainName,
        chainId,
        balances: formattedBalances
      };
    } catch (error) {
      logger.error('Error fetching account balance', {
        service: 'dail-bot',
        address,
        chainId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Get NFT details from Stargaze chain
   * @param {Object} params - NFT parameters
   * @param {string} params.collectionAddress - Collection contract address
   * @param {string} params.tokenId - Token ID
   * @returns {Promise<Object>} - NFT details
   */
  async getNFTDetails(params) {
    if (!this.initialized) {
      throw new Error('Blockchain service not initialized');
    }

    const { collectionAddress, tokenId } = params;

    if (!collectionAddress || !tokenId) {
      throw new Error('Collection address and token ID are required');
    }

    try {
      logger.info('Getting NFT details', {
        service: 'dail-bot',
        collectionAddress,
        tokenId
      });

      // Get Stargaze endpoint
      const endpoint = await cosmosRegistry.getRestEndpoint('stargaze');

      // Prepare the query for NFT info
      const nftInfoQuery = {
        nft_info: {
          token_id: tokenId
        }
      };

      // Encode the query for the URL
      const encodedQuery = encodeURIComponent(JSON.stringify(nftInfoQuery));
      const url = `${endpoint}/cosmwasm/wasm/v1/contract/${collectionAddress}/smart/${encodedQuery}`;

      // Fetch NFT data
      const response = await axios.get(url);
      
      if (response.status !== 200) {
        throw new Error(`Failed to fetch NFT details: ${response.statusText}`);
      }

      const nftData = response.data.data;

      // Get collection info
      const collectionInfoQuery = {
        contract_info: {}
      };
      const encodedCollectionQuery = encodeURIComponent(JSON.stringify(collectionInfoQuery));
      const collectionUrl = `${endpoint}/cosmwasm/wasm/v1/contract/${collectionAddress}/smart/${encodedCollectionQuery}`;

      const collectionResponse = await axios.get(collectionUrl);
      const collectionData = collectionResponse.data.data;

      // Format the response
      return {
        tokenId,
        collectionAddress,
        name: nftData.extension?.name || 'Unknown',
        description: nftData.extension?.description || '',
        image: nftData.extension?.image || '',
        attributes: nftData.extension?.attributes || [],
        collection: {
          name: collectionData.name || 'Unknown Collection',
          symbol: collectionData.symbol || '',
          description: collectionData.description || ''
        }
      };
    } catch (error) {
      logger.error('Error fetching NFT details', {
        service: 'dail-bot',
        collectionAddress,
        tokenId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Get chain information
   * @param {Object} params - Chain parameters
   * @param {string} params.chainId - Chain ID (e.g., "stargaze-1", "osmosis-1")
   * @returns {Promise<Object>} - Chain information
   */
  async getChainInfo(params) {
    if (!this.initialized) {
      throw new Error('Blockchain service not initialized');
    }

    const { chainId } = params;

    if (!chainId) {
      throw new Error('Chain ID is required');
    }

    try {
      logger.info('Getting chain information', {
        service: 'dail-bot',
        chainId
      });

      // Convert chain ID to name for registry lookup
      const chainName = cosmosRegistry.chainIdToName(chainId);
      
      // Get chain info from registry
      const registryInfo = await cosmosRegistry.getChainInfo(chainName);
      
      // Get node status
      const endpoint = await cosmosRegistry.getRestEndpoint(chainName);
      const nodeStatusUrl = `${endpoint}/cosmos/base/tendermint/v1beta1/node_info`;
      
      const nodeResponse = await axios.get(nodeStatusUrl);
      const nodeInfo = nodeResponse.data.default_node_info;
      
      // Get latest block
      const latestBlockUrl = `${endpoint}/cosmos/base/tendermint/v1beta1/blocks/latest`;
      const blockResponse = await axios.get(latestBlockUrl);
      const blockInfo = blockResponse.data.block;
      
      // Format the response
      return {
        name: registryInfo.chain_name,
        prettyName: registryInfo.pretty_name || registryInfo.chain_name,
        chainId: nodeInfo.network,
        version: nodeInfo.version,
        latestHeight: blockInfo.header.height,
        latestTime: blockInfo.header.time,
        chainInfo: {
          description: registryInfo.description || '',
          website: registryInfo.website || '',
          logo: registryInfo.logo_URIs?.png || registryInfo.logo_URIs?.svg || '',
          decimals: registryInfo.decimals || 6,
          symbols: registryInfo.slip44 || 118
        }
      };
    } catch (error) {
      logger.error('Error fetching chain information', {
        service: 'dail-bot',
        chainId,
        error: error.message
      });

      throw error;
    }
  }
}

module.exports = new BlockchainService(); 