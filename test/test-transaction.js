const axios = require('axios');

/**
 * Test script to check a Stargaze transaction hash using different API approaches
 * Transaction hash: F9FAD5A47E9CF475083A6813FC2959237CE82C118218A1088A61F9C8F9BEF5C5
 */

const TX_HASH = 'F9FAD5A47E9CF475083A6813FC2959237CE82C118218A1088A61F9C8F9BEF5C5';
const CHAIN_ID = 'stargaze-1';

// Configuration for different API endpoints
const API_CONFIGS = [
  {
    name: 'Stargaze RPC (LCD)',
    url: `https://rest.stargaze-apis.com/cosmos/tx/v1beta1/txs/${TX_HASH}`,
    headers: {},
    transformResponse: (data) => data
  },
  {
    name: 'MintScan API',
    url: `https://api-stargaze.cosmostation.io/v1/tx/${TX_HASH}`,
    headers: {},
    transformResponse: (data) => data
  },
  {
    name: 'Stargaze Block Explorer',
    url: `https://stargaze-explorer.publicnode.com/api/txs/${TX_HASH}`,
    headers: {},
    transformResponse: (data) => data
  },
  {
    name: 'Cosmos Directory',
    url: `https://rest.cosmos.directory/stargaze/cosmos/tx/v1beta1/txs/${TX_HASH}`,
    headers: {},
    transformResponse: (data) => data
  },
  {
    name: 'Keplr LCD',
    url: `https://lcd-stargaze.keplr.app/cosmos/tx/v1beta1/txs/${TX_HASH}`,
    headers: {},
    transformResponse: (data) => data
  }
];

/**
 * Fetch transaction data using a specific API configuration
 * @param {Object} apiConfig - API configuration
 * @returns {Promise<Object>} - Transaction data
 */
async function fetchTransactionData(apiConfig) {
  console.log(`Fetching data from ${apiConfig.name}...`);
  const startTime = Date.now();
  
  try {
    const response = await axios.get(apiConfig.url, {
      headers: apiConfig.headers,
      timeout: 10000 // 10s timeout
    });
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`✅ Success! Response received in ${duration}ms`);
    
    // Process and return formatted response
    return {
      apiName: apiConfig.name,
      successful: true,
      statusCode: response.status,
      duration: duration,
      data: apiConfig.transformResponse(response.data),
      rawData: response.data
    };
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`❌ Error: ${error.message} (${duration}ms)`);
    
    return {
      apiName: apiConfig.name,
      successful: false,
      statusCode: error.response?.status,
      duration: duration,
      error: error.message,
      rawError: error.response?.data
    };
  }
}

/**
 * Analyze successful transaction responses to find the best approach
 * @param {Array} results - API results
 */
function analyzeResults(results) {
  console.log('\n\n=== ANALYSIS RESULTS ===');
  
  const successfulResults = results.filter(r => r.successful);
  
  if (successfulResults.length === 0) {
    console.log('❌ No API endpoints were successful');
    return;
  }
  
  // Sort by response time
  const fastestResponse = [...successfulResults].sort((a, b) => a.duration - b.duration)[0];
  console.log(`Fastest response: ${fastestResponse.apiName} (${fastestResponse.duration}ms)`);
  
  // Check for additional data
  const withTransactionDetails = successfulResults.filter(r => 
    r.rawData && (r.rawData.tx_response || r.rawData.txhash)
  );
  
  console.log(`\nSuccessful endpoints with transaction details: ${withTransactionDetails.length}`);
  withTransactionDetails.forEach(result => {
    console.log(`- ${result.apiName}`);
  });
  
  // Analyze transaction
  const bestResult = fastestResponse.rawData;
  
  console.log('\n=== TRANSACTION DETAILS ===');
  try {
    // Determine transaction success/failure
    let isSuccess = false;
    let errorMessage = null;
    
    if (bestResult.tx_response) {
      // Cosmos SDK format
      isSuccess = bestResult.tx_response.code === 0;
      errorMessage = !isSuccess ? bestResult.tx_response.raw_log : null;
      
      console.log(`Transaction status: ${isSuccess ? 'SUCCESS' : 'FAILED'}`);
      if (!isSuccess && errorMessage) {
        console.log(`Error: ${errorMessage}`);
      }
      
      // Transaction details
      if (bestResult.tx_response.txhash) {
        console.log(`Hash: ${bestResult.tx_response.txhash}`);
      }
      if (bestResult.tx_response.height) {
        console.log(`Block height: ${bestResult.tx_response.height}`);
      }
      if (bestResult.tx_response.timestamp) {
        console.log(`Timestamp: ${bestResult.tx_response.timestamp}`);
      }
      
      // Extract messages
      if (bestResult.tx && bestResult.tx.body && bestResult.tx.body.messages) {
        console.log(`\nTransaction type: ${determineTransactionType(bestResult.tx.body.messages)}`);
        console.log(`Message count: ${bestResult.tx.body.messages.length}`);
      }
      
      // Extract fees
      if (bestResult.tx && bestResult.tx.auth_info && bestResult.tx.auth_info.fee) {
        const fees = bestResult.tx.auth_info.fee.amount || [];
        if (fees.length > 0) {
          console.log(`\nFees: ${formatCoinAmount(fees[0].amount, fees[0].denom)}`);
        }
      }
    } else if (bestResult.txhash) {
      // MintScan format
      isSuccess = bestResult.code === 0;
      errorMessage = !isSuccess ? bestResult.raw_log : null;
      
      console.log(`Transaction status: ${isSuccess ? 'SUCCESS' : 'FAILED'}`);
      if (!isSuccess && errorMessage) {
        console.log(`Error: ${errorMessage}`);
      }
      
      // Transaction details
      console.log(`Hash: ${bestResult.txhash}`);
      if (bestResult.height) {
        console.log(`Block height: ${bestResult.height}`);
      }
      if (bestResult.timestamp) {
        console.log(`Timestamp: ${bestResult.timestamp}`);
      }
    }
    
    console.log('\n=== RECOMMENDATION ===');
    console.log(`Best API endpoint: ${fastestResponse.apiName}`);
    console.log(`Response format: ${bestResult.tx_response ? 'Cosmos SDK' : 'Custom'}`);
    
    // Additional recommendations based on test results
    if (successfulResults.length > 1) {
      console.log('\nBackup endpoints:');
      successfulResults
        .filter(r => r.apiName !== fastestResponse.apiName)
        .slice(0, 2)
        .forEach(r => console.log(`- ${r.apiName} (${r.duration}ms)`));
    }
  } catch (err) {
    console.log(`Error analyzing transaction: ${err.message}`);
  }
}

/**
 * Determine transaction type from messages
 * @param {Array} messages - Transaction messages
 * @returns {string} - Transaction type
 */
function determineTransactionType(messages) {
  if (!messages || messages.length === 0) {
    return 'unknown';
  }
  
  const firstMsg = messages[0];
  const typeUrl = firstMsg['@type'] || firstMsg.type || '';
  
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
}

/**
 * Format coin amount with proper denomination
 * @param {string} amount - Coin amount
 * @param {string} denom - Coin denomination
 * @returns {string} - Formatted amount
 */
function formatCoinAmount(amount, denom) {
  const denomMap = {
    'ustars': { symbol: 'STARS', exponent: 6 },
    'uatom': { symbol: 'ATOM', exponent: 6 },
    'uosmo': { symbol: 'OSMO', exponent: 6 }
  };
  
  const denomInfo = denomMap[denom] || { symbol: denom, exponent: 0 };
  let formattedAmount = amount;
  
  if (denomInfo.exponent > 0) {
    const amountNum = parseInt(amount, 10) / Math.pow(10, denomInfo.exponent);
    formattedAmount = amountNum.toLocaleString('en-US', { 
      minimumFractionDigits: 2,
      maximumFractionDigits: 6 
    });
  }
  
  return `${formattedAmount} ${denomInfo.symbol}`;
}

/**
 * Main function to run the tests
 */
async function main() {
  console.log(`Testing APIs for transaction: ${TX_HASH}`);
  
  const results = [];
  
  // Run tests for each API configuration
  for (const apiConfig of API_CONFIGS) {
    const result = await fetchTransactionData(apiConfig);
    results.push(result);
    console.log('---');
  }
  
  // Analyze the results
  analyzeResults(results);
}

// Run the script
main().catch(err => {
  console.error('Error running tests:', err.message);
}); 