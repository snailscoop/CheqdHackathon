/**
 * Grok Function Handler: Transaction Analysis
 * 
 * This handler processes blockchain transaction analysis requests for Grok
 */

const axios = require('axios');
const txAnalyzer = require('../../blockchain/txAnalyzer');

/**
 * Handle transaction analysis requests
 * @param {Object} params - Function parameters
 * @param {string} params.txHash - Transaction hash to analyze
 * @param {string} params.chainId - Chain ID (e.g., "stargaze-1")
 * @returns {Promise<Object>} - Analysis results
 */
async function transactionAnalysis(params) {
  const { txHash, chainId = 'stargaze-1' } = params;
  
  if (!txHash) {
    return {
      success: false,
      error: 'Transaction hash is required',
      response: 'Please provide a valid transaction hash to analyze.'
    };
  }
  
  try {
    // Get detailed transaction data using the existing txAnalyzer
    const txDetails = await txAnalyzer.analyzeTransaction({
      txHash,
      chainId,
      detailed: true
    });
    
    // Extract key data for the response
    const { success, error, errorType, recommendations } = txDetails;
    
    // Generate a human-friendly response
    let response = '';
    
    if (success) {
      response = `This transaction (${txHash}) was successful on the ${chainId} blockchain.`;
    } else {
      response = `I analyzed your transaction (${txHash}) on the ${chainId} blockchain and found that it failed.`;
      
      if (errorType) {
        response += `\n\nThe issue appears to be: ${_getHumanReadableError(errorType, error)}`;
      }
      
      if (recommendations && recommendations.length > 0) {
        response += `\n\nHere's what you can do to fix it:\n`;
        recommendations.forEach((rec, index) => {
          response += `${index + 1}. ${rec}\n`;
        });
      }
      
      // Add some helpful context for specific error types
      response += _getAdditionalContext(errorType, chainId);
    }
    
    return {
      success: true,
      txHash,
      chainId,
      txStatus: success ? 'SUCCESS' : 'FAILED',
      errorType,
      response
    };
  } catch (error) {
    // Handle errors gracefully
    return {
      success: false,
      error: error.message,
      response: `I couldn't analyze this transaction. ${error.message}`
    };
  }
}

/**
 * Get a human-readable error description
 * @param {string} errorType - Error type from analysis
 * @param {string} errorMessage - Raw error message
 * @returns {string} - Human-readable description
 * @private
 */
function _getHumanReadableError(errorType, errorMessage) {
  switch (errorType) {
    case 'insufficient_funds':
      return "You don't have enough tokens in your wallet to complete this transaction.";
      
    case 'gas_limit_exceeded':
      return "The transaction ran out of gas before it could complete.";
      
    case 'insufficient_fee':
      return "The transaction fee you provided was too low.";
      
    case 'contract_execution_failed':
      return "The smart contract you tried to interact with encountered an error.";
      
    case 'account_sequence_mismatch':
      return "Your wallet's transaction sequence is out of sync with the blockchain.";
      
    case 'nft_related':
      return "There was an issue with the NFT you were trying to interact with.";
      
    default:
      // Try to extract a cleaner message from the raw error
      return errorMessage && errorMessage.length < 100 
        ? errorMessage 
        : "The transaction failed for an unknown reason.";
  }
}

/**
 * Get additional context based on error type
 * @param {string} errorType - Error type
 * @param {string} chainId - Chain ID
 * @returns {string} - Additional context
 * @private
 */
function _getAdditionalContext(errorType, chainId) {
  if (!errorType) return '';
  
  let context = '\n\n';
  
  switch (errorType) {
    case 'insufficient_funds':
      context += `💡 Every blockchain transaction requires both the amount you're sending AND gas fees to process the transaction. Make sure your wallet has enough for both.`;
      break;
      
    case 'gas_limit_exceeded':
      context += `💡 Gas is like fuel for blockchain transactions. Complex operations (like smart contract interactions) need more gas than simple transfers.`;
      break;
      
    case 'nft_related':
      if (chainId === 'stargaze-1') {
        context += `💡 Stargaze NFT transactions can fail if the NFT was already sold, if someone else outbid you, or if the listing was cancelled.`;
      }
      break;
      
    case 'account_sequence_mismatch':
      context += `💡 Blockchain wallets keep track of transaction order using a "nonce" or sequence number. This error means they're out of sync, usually due to a pending transaction or connection issue.`;
      break;
  }
  
  return context;
}

module.exports = transactionAnalysis; 