/**
 * Transaction Advisor Module
 * 
 * This module analyzes blockchain transaction errors and provides
 * troubleshooting suggestions to help users fix failed transactions.
 */

/**
 * Analyze a transaction and provide troubleshooting suggestions
 * @param {Object} txData - Transaction data
 * @returns {Object} - Analysis results with recommendations
 */
function analyzeTransaction(txData) {
  if (!txData) {
    return {
      success: false,
      error: 'No transaction data provided',
      recommendations: ['Ensure you have provided a valid transaction hash']
    };
  }

  // Determine if we have a Cosmos SDK format or custom format
  const txResponse = txData.tx_response || txData;
  const isSuccess = txResponse.code === 0;
  
  // Extract basic info
  const result = {
    hash: txResponse.txhash || txResponse.hash,
    success: isSuccess,
    blockHeight: txResponse.height,
    timestamp: txResponse.timestamp,
    gasWanted: txResponse.gas_wanted || txResponse.gasWanted,
    gasUsed: txResponse.gas_used || txResponse.gasUsed,
    error: null,
    errorCode: null,
    errorType: null,
    recommendations: []
  };
  
  // For successful transactions, no recommendations needed
  if (isSuccess) {
    result.analysis = "Transaction completed successfully";
    return result;
  }
  
  // Extract error message
  const errorMessage = txResponse.raw_log || txResponse.rawLog || '';
  result.error = errorMessage;
  
  // Analyze error and provide recommendations
  const errorAnalysis = analyzeError(errorMessage, txData);
  
  result.errorType = errorAnalysis.errorType;
  result.errorCode = errorAnalysis.errorCode;
  result.analysis = errorAnalysis.analysis;
  result.recommendations = errorAnalysis.recommendations;
  
  return result;
}

/**
 * Analyze an error message and provide recommendations
 * @param {string} errorMessage - Raw error message
 * @param {Object} txData - Complete transaction data
 * @returns {Object} - Error analysis and recommendations
 */
function analyzeError(errorMessage, txData) {
  const result = {
    errorType: 'unknown',
    errorCode: null,
    analysis: 'An unknown error occurred',
    recommendations: [
      'Try the transaction again',
      'Check your network connection',
      'Contact support if the issue persists'
    ]
  };
  
  if (!errorMessage) {
    return result;
  }
  
  // Common error patterns for Cosmos SDK chains
  
  // Insufficient funds errors
  if (errorMessage.includes('insufficient funds') || 
      errorMessage.includes('not enough funds')) {
    result.errorType = 'insufficient_funds';
    result.analysis = 'Your wallet does not have enough tokens to complete this transaction';
    result.recommendations = [
      'Check your wallet balance',
      'Ensure you have enough tokens to cover both the transaction amount and gas fees',
      'If needed, transfer more tokens to your wallet before retrying'
    ];
    return result;
  }
  
  // Gas/fee related errors
  if (errorMessage.includes('out of gas') || 
      errorMessage.includes('gas limit exceeded')) {
    result.errorType = 'gas_limit_exceeded';
    result.analysis = 'The transaction ran out of gas before it could complete';
    result.recommendations = [
      'Increase the gas limit for your transaction',
      'Try setting gas limit to at least 1.5x the amount that was used in this failed transaction',
      'Consider simplifying your transaction if possible'
    ];
    return result;
  }
  
  if (errorMessage.includes('insufficient fee') || 
      errorMessage.includes('fee smaller than minimum')) {
    result.errorType = 'insufficient_fee';
    result.analysis = 'The transaction fee was too low';
    result.recommendations = [
      'Increase the transaction fee',
      'Check the current network fee requirements',
      'Wait for network congestion to decrease if fees are currently high'
    ];
    return result;
  }
  
  // Timeout errors
  if (errorMessage.includes('timed out') || 
      errorMessage.includes('timeout')) {
    result.errorType = 'timeout';
    result.analysis = 'The transaction timed out before it could be processed';
    result.recommendations = [
      'Try the transaction again',
      'Check your network connection',
      'Consider increasing gas limit or fees during high network congestion'
    ];
    return result;
  }
  
  // Contract execution errors
  if (errorMessage.includes('execute wasm contract failed') || 
      errorMessage.includes('contract execution failed')) {
    result.errorType = 'contract_execution_failed';
    
    // Parse specific contract error
    let contractError = extractContractError(errorMessage);
    result.analysis = `Smart contract execution failed: ${contractError || 'Unknown contract error'}`;
    
    // Stargaze specific NFT errors
    if (errorMessage.includes('listing not found') || 
        errorMessage.includes('nft_listing_not_found')) {
      result.errorType = 'nft_listing_not_found';
      result.analysis = 'The NFT listing you tried to interact with no longer exists';
      result.recommendations = [
        'The NFT may have been sold or delisted',
        'Refresh the marketplace page to see the current status',
        'Try searching for other available NFTs'
      ];
      return result;
    }
    
    if (errorMessage.includes('token not found') || 
        errorMessage.includes('token_not_found')) {
      result.errorType = 'token_not_found';
      result.analysis = 'The NFT token you tried to interact with does not exist or is not owned by the expected address';
      result.recommendations = [
        'Verify that the token ID is correct',
        'Check that you own the NFT you\'re trying to list or transfer',
        'Refresh the collection page and try again'
      ];
      return result;
    }
    
    if (errorMessage.includes('invalid funds')) {
      result.errorType = 'invalid_funds';
      result.analysis = 'The funds provided for this transaction were invalid';
      result.recommendations = [
        'Check that you\'re using the correct token denomination (e.g., STARS)',
        'Verify the price matches what\'s listed',
        'Make sure you have enough tokens plus gas fees'
      ];
      return result;
    }
    
    // Generic contract recommendations if no specific error matched
    result.recommendations = [
      'Check that you meet all the requirements for this contract interaction',
      'Verify your parameters and inputs are correct',
      'Try again with different parameters if needed',
      'Check if the contract has specific requirements (e.g., whitelist, minimum amounts)'
    ];
    return result;
  }
  
  // Account sequence errors
  if (errorMessage.includes('account sequence mismatch') || 
      errorMessage.includes('incorrect account sequence')) {
    result.errorType = 'account_sequence_mismatch';
    result.analysis = 'Your wallet nonce (transaction sequence) is out of sync with the blockchain';
    result.recommendations = [
      'Reset your wallet connection',
      'Refresh the page and try again',
      'Try using a different wallet app if the issue persists',
      'Wait a few minutes for any pending transactions to complete'
    ];
    return result;
  }
  
  // Parse JSON errors if available for more detailed analysis
  try {
    if (errorMessage.startsWith('{') && errorMessage.endsWith('}')) {
      const errorObj = JSON.parse(errorMessage);
      if (errorObj.message) {
        return analyzeError(errorObj.message, txData);
      }
    }
  } catch (e) {
    // Not valid JSON, continue with generic handling
  }
  
  // If we couldn't identify a specific error, return generic advice
  result.recommendations = [
    'Check that you have sufficient balance including gas fees',
    'Verify all transaction parameters are correct',
    'Try refreshing your connection to the blockchain',
    'If the error persists, check the community forums or Discord for similar issues'
  ];
  
  return result;
}

/**
 * Extract specific contract error message from raw log
 * @param {string} errorMessage - Raw error message
 * @returns {string} - Cleaned contract error message
 */
function extractContractError(errorMessage) {
  try {
    // Try to find JSON error in the message
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
    
    // Look for generic error patterns
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
    
    // If no specific pattern matched, clean up the message
    return errorMessage
      .replace(/^.*failed:\s*/i, '')
      .replace(/^.*error:\s*/i, '')
      .trim();
      
  } catch (e) {
    return 'Unknown contract error';
  }
}

module.exports = {
  analyzeTransaction
}; 