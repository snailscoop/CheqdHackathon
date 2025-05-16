/**
 * Master Transaction Analysis Test
 * 
 * This test verifies the Grok transaction analysis functionality with a real Stargaze transaction.
 * It tests the core transaction analyzer module with the actual blockchain APIs.
 */

const txAnalyzer = require('./src/modules/blockchain/txAnalyzer');
const grokTxAnalyzer = require('./src/modules/blockchain/grokTxAnalyzer');

// Test configuration
const TEST_CONFIG = {
  txHash: 'F9FAD5A47E9CF475083A6813FC2959237CE82C118218A1088A61F9C8F9BEF5C5',
  chainId: 'stargaze-1',
  expectedStatus: 'FAILED' // Expected transaction status
};

// Set environment variables for testing
process.env.LOG_LEVEL = 'debug'; // Enable debug logging for tests

/**
 * Run test for transaction analyzer functionality
 */
async function runTestTransactionAnalysis() {
  console.log('\n=======================================');
  console.log('TRANSACTION ANALYSIS TEST');
  console.log('=======================================');
  console.log(`Testing transaction hash: ${TEST_CONFIG.txHash}`);
  console.log(`Chain ID: ${TEST_CONFIG.chainId}`);
  console.log('---------------------------------------');
  
  try {
    // STEP 1: Basic transaction analysis
    console.log('\n[STEP 1] Basic Transaction Analysis...');
    const basicAnalysis = await txAnalyzer.analyzeTransaction({
      txHash: TEST_CONFIG.txHash,
      chainId: TEST_CONFIG.chainId
    });
    
    // Verify basic analysis results
    verifyBasicAnalysis(basicAnalysis);
    
    // STEP 2: Detailed transaction analysis
    console.log('\n[STEP 2] Detailed Transaction Analysis...');
    const detailedAnalysis = await txAnalyzer.analyzeTransaction({
      txHash: TEST_CONFIG.txHash,
      chainId: TEST_CONFIG.chainId,
      detailed: true
    });
    
    // Verify detailed analysis results
    verifyDetailedAnalysis(detailedAnalysis);
    
    // STEP 3: Grok advanced analysis
    console.log('\n[STEP 3] Grok Advanced Analysis...');
    const grokAnalysis = await grokTxAnalyzer.analyze({
      txHash: TEST_CONFIG.txHash,
      chainId: TEST_CONFIG.chainId
    });
    
    // Verify Grok analysis results
    verifyGrokAnalysis(grokAnalysis);
    
    // STEP 4: Enhanced data extraction (raw JSON, logs, and events)
    console.log('\n[STEP 4] Enhanced Data Extraction...');
    const enhancedAnalysis = await grokTxAnalyzer.analyze({
      txHash: TEST_CONFIG.txHash,
      chainId: TEST_CONFIG.chainId,
      includeRawData: true
    });
    
    // Verify enhanced data extraction
    verifyEnhancedDataExtraction(enhancedAnalysis);
    
    // Test completed successfully
    console.log('\n=======================================');
    console.log('✅ TEST COMPLETED SUCCESSFULLY');
    console.log('=======================================');
    
  } catch (error) {
    console.error('\n=======================================');
    console.error('❌ TEST FAILED');
    console.error('=======================================');
    console.error(`Error: ${error.message}`);
    console.error('Stack trace:');
    console.error(error.stack);
    
    process.exit(1);
  }
}

/**
 * Verify basic transaction analysis results
 * @param {Object} analysis - Analysis results to verify
 */
function verifyBasicAnalysis(analysis) {
  console.log('Verifying basic analysis...');
  
  // Check for required fields
  const requiredFields = ['hash', 'success', 'chainId', 'blockHeight', 'timestamp'];
  const missingFields = requiredFields.filter(field => analysis[field] === undefined);
  
  if (missingFields.length > 0) {
    throw new Error(`Basic analysis missing required fields: ${missingFields.join(', ')}`);
  }
  
  // Verify transaction status matches expected
  const expectedSuccess = TEST_CONFIG.expectedStatus === 'SUCCESS';
  if (analysis.success !== expectedSuccess) {
    throw new Error(`Transaction status mismatch. Expected: ${expectedSuccess}, Got: ${analysis.success}`);
  }
  
  // For failed transactions, verify error information
  if (!analysis.success) {
    if (!analysis.error || !analysis.errorType) {
      throw new Error('Failed transaction analysis missing error information');
    }
    console.log(`Error type: ${analysis.errorType}`);
    console.log(`Error: ${analysis.error.substring(0, 100)}${analysis.error.length > 100 ? '...' : ''}`);
  }
  
  console.log('✅ Basic analysis verification passed');
}

/**
 * Verify detailed transaction analysis results
 * @param {Object} analysis - Analysis results to verify
 */
function verifyDetailedAnalysis(analysis) {
  console.log('Verifying detailed analysis...');
  
  // Verify recommendations
  if (!analysis.recommendations || !Array.isArray(analysis.recommendations)) {
    throw new Error('Detailed analysis missing recommendations array');
  }
  
  console.log(`Recommendations count: ${analysis.recommendations.length}`);
  
  if (analysis.recommendations.length > 0) {
    console.log('First recommendation: ' + analysis.recommendations[0]);
  }
  
  // Verify messages
  if (analysis.messages && Array.isArray(analysis.messages)) {
    console.log(`Found ${analysis.messages.length} transaction messages`);
    
    if (analysis.messages.length > 0) {
      const firstMsgType = analysis.messages[0]['@type'] || 'Unknown';
      console.log(`First message type: ${firstMsgType}`);
    }
  }
  
  console.log('✅ Detailed analysis verification passed');
}

/**
 * Verify Grok AI transaction analysis results
 * @param {Object} analysis - Analysis results to verify
 */
function verifyGrokAnalysis(analysis) {
  console.log('Verifying Grok analysis...');
  
  // Verify Grok analysis contains required fields
  if (!analysis.analysis) {
    throw new Error('Grok analysis missing analysis field');
  }
  
  const grokResults = analysis.analysis;
  
  // Check for required fields in Grok analysis
  const requiredFields = ['summary', 'explanation'];
  const missingFields = requiredFields.filter(field => grokResults[field] === undefined);
  
  if (missingFields.length > 0) {
    throw new Error(`Grok analysis missing required fields: ${missingFields.join(', ')}`);
  }
  
  // For failed transactions, verify recommendations
  if (TEST_CONFIG.expectedStatus !== 'SUCCESS') {
    if (!grokResults.recommendations || !Array.isArray(grokResults.recommendations)) {
      throw new Error('Grok analysis missing recommendations for failed transaction');
    }
    
    if (grokResults.recommendations.length === 0) {
      throw new Error('Grok analysis has empty recommendations array for failed transaction');
    }
  }
  
  // Display summary
  console.log('Grok Analysis Summary: ' + grokResults.summary);
  
  if (grokResults.failure_reason) {
    console.log('Failure Reason: ' + grokResults.failure_reason);
  }
  
  if (grokResults.recommendations && grokResults.recommendations.length > 0) {
    console.log('Recommendations:');
    grokResults.recommendations.forEach((rec, index) => {
      console.log(` ${index + 1}. ${rec}`);
    });
  }
  
  console.log('✅ Grok analysis verification passed');
}

/**
 * Verify enhanced data extraction with events, logs, and raw JSON
 * @param {Object} analysis - Analysis results to verify
 */
function verifyEnhancedDataExtraction(analysis) {
  console.log('Verifying enhanced data extraction...');
  
  // Check if raw data is included
  if (!analysis.rawData) {
    throw new Error('Enhanced analysis missing raw data');
  }
  
  console.log('Raw data successfully included in the analysis');
  
  // Check if we have event data (now might be synthetic for failed transactions)
  if (!analysis.analysis.rawEvents && !analysis.analysis.eventsByType) {
    throw new Error('Enhanced analysis missing events data (raw or synthetic)');
  }
  
  // Display some stats about the data extracted
  console.log(`Raw event count: ${analysis.analysis.rawEvents?.length || 0}`);
  
  // Check if we have error details for failed transactions
  const rawTxData = analysis.rawData.txResponse || analysis.rawData.tx_response;
  if (rawTxData && rawTxData.code !== 0) {
    console.log('\nFailed Transaction Details:');
    console.log(`Code: ${rawTxData.code}`);
    console.log(`Codespace: ${rawTxData.codespace || 'wasm'}`);
    console.log(`Raw Log: ${rawTxData.raw_log?.substring(0, 100)}${rawTxData.raw_log?.length > 100 ? '...' : ''}`);
    
    // Check for detailed error analysis
    try {
      // Get the message data - make sure it's a string before parsing
      if (rawTxData.tx?.body?.messages && rawTxData.tx.body.messages.length > 0) {
        const msg = rawTxData.tx.body.messages[0].msg;
        if (typeof msg === 'string') {
          const data = JSON.parse(msg);
          const keys = Object.keys(data);
          
          if (keys.length > 0) {
            console.log(`\nContract Action: ${keys[0]}`);
            console.log('Parameters:');
            Object.entries(data[keys[0]]).forEach(([key, value]) => {
              console.log(` - ${key}: ${value}`);
            });
          }
        } else if (typeof msg === 'object') {
          // Directly use the object if it's already parsed
          const keys = Object.keys(msg);
          
          if (keys.length > 0) {
            console.log(`\nContract Action: ${keys[0]}`);
            console.log('Parameters:');
            Object.entries(msg[keys[0]]).forEach(([key, value]) => {
              console.log(` - ${key}: ${value}`);
            });
          }
        }
      }
    } catch (error) {
      console.log(`Unable to parse contract message: ${error.message}`);
    }
  }
  
  // Show event types (synthetic or real)
  const eventTypes = Object.keys(analysis.analysis.eventsByType || {});
  if (eventTypes.length > 0) {
    console.log(`\nEvent types found: ${eventTypes.join(', ')}`);
    
    // Display info about the events
    eventTypes.forEach(type => {
      const events = analysis.analysis.eventsByType[type];
      console.log(`\n${type.toUpperCase()} Events (${events.length} total):`);
      
      if (events.length > 0) {
        const firstEvent = events[0];
        
        // Note if this is a synthetic event
        if (firstEvent.synthetic) {
          console.log('(Synthetic events created from message data)');
        }
        
        // Show attributes
        const attributes = Object.entries(firstEvent.attributes)
          .slice(0, 5) // Show first 5 attributes only
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        
        console.log(`First event attributes: ${attributes}${Object.keys(firstEvent.attributes).length > 5 ? '...' : ''}`);
        
        // Show raw params if available
        if (firstEvent.rawParams) {
          console.log('Contract parameters:');
          Object.entries(firstEvent.rawParams)
            .slice(0, 3)
            .forEach(([key, value]) => {
              console.log(` - ${key}: ${JSON.stringify(value).substring(0, 50)}`);
            });
        }
      }
    });
  } else {
    console.log('No event types found in this transaction');
  }
  
  // Check contract calls
  if (analysis.rawData.tx && analysis.rawData.tx.body && analysis.rawData.tx.body.messages) {
    const messages = analysis.rawData.tx.body.messages;
    console.log(`\nTransaction contains ${messages.length} messages`);
    
    // Check for contract calls
    const contractCalls = messages.filter(msg => msg['@type'] === '/cosmwasm.wasm.v1.MsgExecuteContract');
    if (contractCalls.length > 0) {
      console.log(`Found ${contractCalls.length} contract interactions`);
      
      // Show contract details for first call
      const firstCall = contractCalls[0];
      console.log(`Contract: ${firstCall.contract}`);
      
      try {
        if (typeof firstCall.msg === 'string') {
          const parsedMsg = JSON.parse(firstCall.msg);
          const action = Object.keys(parsedMsg)[0];
          console.log(`Action: ${action}`);
          console.log('Parameters:');
          const params = parsedMsg[action];
          Object.entries(params).forEach(([key, value]) => {
            console.log(` - ${key}: ${JSON.stringify(value).substring(0, 50)}`);
          });
        } else if (typeof firstCall.msg === 'object') {
          // For pre-parsed message objects
          const action = Object.keys(firstCall.msg)[0];
          console.log(`Action: ${action}`);
          console.log('Parameters:');
          const params = firstCall.msg[action];
          Object.entries(params).forEach(([key, value]) => {
            console.log(` - ${key}: ${JSON.stringify(value).substring(0, 50)}`);
          });
        }
      } catch (e) {
        console.log(`Could not parse contract message: ${e.message}`);
      }
    }
  }
  
  console.log('✅ Enhanced data extraction verification passed');
}

// Run the test
runTestTransactionAnalysis().catch(error => {
  console.error('Unhandled test error:', error);
  process.exit(1);
}); 