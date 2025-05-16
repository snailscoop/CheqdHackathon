const axios = require('axios');
const transactionAdvisor = require('./transaction-advisor');
const fs = require('fs');

// The transaction hash to check
const TX_HASH = 'F9FAD5A47E9CF475083A6813FC2959237CE82C118218A1088A61F9C8F9BEF5C5';

// API endpoints to try
const API_ENDPOINTS = [
  {
    name: 'Cosmos Directory',
    url: `https://rest.cosmos.directory/stargaze/cosmos/tx/v1beta1/txs/${TX_HASH}`,
    format: 'cosmos-sdk'
  },
  {
    name: 'Stargaze LCD',
    url: `https://rest.stargaze-apis.com/cosmos/tx/v1beta1/txs/${TX_HASH}`,
    format: 'cosmos-sdk'
  },
  {
    name: 'MintScan API',
    url: `https://api-stargaze.cosmostation.io/v1/tx/${TX_HASH}`,
    format: 'mintscan'
  }
];

/**
 * Fetch transaction data and analyze it
 */
async function analyzeStargazeTransaction() {
  console.log(`=== ANALYZING STARGAZE TRANSACTION ===`);
  console.log(`Transaction Hash: ${TX_HASH}`);
  console.log('');
  
  let txData = null;
  let usedEndpoint = null;
  
  // Try each endpoint until we get data
  for (const endpoint of API_ENDPOINTS) {
    try {
      console.log(`Trying ${endpoint.name}...`);
      const response = await axios.get(endpoint.url, { timeout: 5000 });
      if (response.status === 200 && response.data) {
        console.log(`✅ Success! Got data from ${endpoint.name}`);
        txData = response.data;
        usedEndpoint = endpoint;
        break;
      }
    } catch (error) {
      console.log(`❌ Failed: ${error.message}`);
    }
    console.log('');
  }
  
  if (!txData) {
    console.error('Failed to fetch transaction data from any endpoint');
    return;
  }
  
  // Save raw transaction data for analysis
  fs.writeFileSync('tx_raw_data.json', JSON.stringify(txData, null, 2));
  console.log(`\nSaved raw transaction data to tx_raw_data.json`);
  
  console.log(`\n=== TRANSACTION BASIC INFO (from ${usedEndpoint.name}) ===`);
  const txResponse = usedEndpoint.format === 'cosmos-sdk' ? txData.tx_response : txData;
  
  // Basic transaction info
  console.log(`Hash: ${txResponse.txhash}`);
  console.log(`Height: ${txResponse.height}`);
  console.log(`Status: ${txResponse.code === 0 ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Gas (wanted/used): ${txResponse.gas_wanted}/${txResponse.gas_used}`);
  console.log(`Timestamp: ${txResponse.timestamp}`);
  
  // Extract transaction fee
  if (usedEndpoint.format === 'cosmos-sdk' && txData.tx && txData.tx.auth_info && txData.tx.auth_info.fee) {
    const fee = txData.tx.auth_info.fee;
    if (fee.amount && fee.amount.length > 0) {
      console.log(`Fee: ${fee.amount[0].amount} ${fee.amount[0].denom}`);
    }
    console.log(`Gas Limit: ${fee.gas_limit}`);
  }
  
  // Extract transaction type and messages
  console.log(`\n=== TRANSACTION MESSAGES ===`);
  if (usedEndpoint.format === 'cosmos-sdk' && txData.tx && txData.tx.body && txData.tx.body.messages) {
    const messages = txData.tx.body.messages;
    console.log(`Message Count: ${messages.length}`);
    
    messages.forEach((msg, index) => {
      console.log(`\nMessage #${index + 1}:`);
      console.log(`Type: ${msg['@type'] || 'Unknown'}`);
      
      // Extract key information based on message type
      if (msg['@type'] === '/cosmwasm.wasm.v1.MsgExecuteContract') {
        console.log(`Contract: ${msg.contract}`);
        console.log(`Sender: ${msg.sender}`);
        
        // Try to parse contract message
        if (msg.msg) {
          try {
            const contractMsg = typeof msg.msg === 'string' ? JSON.parse(msg.msg) : msg.msg;
            console.log(`Contract Action: ${Object.keys(contractMsg)[0]}`);
            console.log(`Contract Data: ${JSON.stringify(contractMsg[Object.keys(contractMsg)[0]], null, 2)}`);
          } catch (e) {
            console.log(`Contract Message: ${msg.msg}`);
          }
        }
        
        // Show funds sent with the message
        if (msg.funds && msg.funds.length > 0) {
          console.log(`Funds: ${msg.funds.map(f => `${f.amount} ${f.denom}`).join(', ')}`);
        }
      } else if (msg['@type'] === '/cosmos.bank.v1beta1.MsgSend') {
        console.log(`From: ${msg.from_address}`);
        console.log(`To: ${msg.to_address}`);
        if (msg.amount && msg.amount.length > 0) {
          console.log(`Amount: ${msg.amount.map(a => `${a.amount} ${a.denom}`).join(', ')}`);
        }
      }
    });
  }
  
  // Extract events
  console.log(`\n=== TRANSACTION EVENTS ===`);
  if (txResponse.logs && txResponse.logs.length > 0) {
    txResponse.logs.forEach((log, logIndex) => {
      console.log(`\nLog #${logIndex + 1}:`);
      
      if (log.events && log.events.length > 0) {
        console.log(`Event Count: ${log.events.length}`);
        
        // Extract important events
        const transferEvents = log.events.filter(e => e.type === 'transfer');
        const wasmEvents = log.events.filter(e => e.type === 'wasm');
        
        if (transferEvents.length > 0) {
          console.log('\nTransfer Events:');
          transferEvents.forEach((event, eventIndex) => {
            console.log(`  Event #${eventIndex + 1}:`);
            if (event.attributes) {
              event.attributes.forEach(attr => {
                console.log(`    ${attr.key}: ${attr.value}`);
              });
            }
          });
        }
        
        if (wasmEvents.length > 0) {
          console.log('\nWasm Contract Events:');
          wasmEvents.forEach((event, eventIndex) => {
            console.log(`  Event #${eventIndex + 1}:`);
            if (event.attributes) {
              event.attributes.forEach(attr => {
                console.log(`    ${attr.key}: ${attr.value}`);
              });
            }
          });
        }
        
        // Show other event types
        const otherEvents = log.events.filter(e => e.type !== 'transfer' && e.type !== 'wasm');
        if (otherEvents.length > 0) {
          console.log('\nOther Events:');
          otherEvents.forEach(event => {
            console.log(`  ${event.type} (${event.attributes ? event.attributes.length : 0} attributes)`);
          });
        }
      } else {
        console.log('No events found in this log');
      }
    });
  } else {
    console.log('No event logs found');
  }
  
  // Error details for failed transactions
  if (txResponse.code !== 0) {
    console.log(`\n=== ERROR DETAILS ===`);
    console.log(`Error Code: ${txResponse.code}`);
    console.log(`Raw Error: ${txResponse.raw_log}`);
    
    // Try to parse the error JSON if available
    try {
      if (txResponse.raw_log && txResponse.raw_log.trim().startsWith('{')) {
        const errorJson = JSON.parse(txResponse.raw_log);
        console.log('\nParsed Error:');
        if (errorJson.message) console.log(`Message: ${errorJson.message}`);
        if (errorJson.code) console.log(`Code: ${errorJson.code}`);
        if (errorJson.data) console.log(`Data: ${errorJson.data}`);
      }
    } catch (e) {
      // Not valid JSON, ignore
    }
  }
  
  // Run analysis with transaction advisor
  console.log('\n=== TRANSACTION ANALYSIS ===');
  const analysis = transactionAdvisor.analyzeTransaction(txData);
  
  console.log(`Success: ${analysis.success}`);
  console.log(`Transaction Type: ${analysis.errorType || 'N/A'}`);
  console.log(`Analysis: ${analysis.analysis}`);
  
  if (!analysis.success) {
    console.log('\n=== RECOMMENDATIONS ===');
    if (analysis.recommendations && analysis.recommendations.length > 0) {
      analysis.recommendations.forEach((rec, index) => {
        console.log(`${index + 1}. ${rec}`);
      });
    } else {
      console.log('No specific recommendations available');
    }
  }
  
  // Prepare data for GPT/AI analysis
  const grokAnalysisData = {
    txHash: TX_HASH,
    chain: 'stargaze',
    status: txResponse.code === 0 ? 'SUCCESS' : 'FAILED',
    rawLog: txResponse.raw_log,
    messages: txData.tx?.body?.messages || [],
    events: txResponse.logs || [],
    errorType: analysis.errorType,
    recommendations: analysis.recommendations
  };
  
  // Save data for GPT/AI analysis
  fs.writeFileSync('tx_for_grok_analysis.json', JSON.stringify(grokAnalysisData, null, 2));
  console.log(`\nSaved formatted data for GPT/AI analysis to tx_for_grok_analysis.json`);
  
  console.log('\n=== GPT/AI ANALYSIS PROMPT ===');
  console.log(`You are an AI assistant specialized in blockchain transactions analysis.
Please analyze this Stargaze blockchain transaction:

Transaction Hash: ${TX_HASH}
Status: ${txResponse.code === 0 ? 'SUCCESS' : 'FAILED'}
${txResponse.code !== 0 ? `Error: ${txResponse.raw_log}` : ''}

Based on the transaction data in tx_for_grok_analysis.json, please:
1. Explain what this transaction was trying to accomplish
2. If failed, explain exactly why it failed in simple terms
3. Provide specific, actionable recommendations to fix the issue
4. Explain any blockchain-specific concepts that might help the user understand the problem

Use the event logs and message details to provide insights about what was happening in this transaction.`);
  
  // Return the analysis for potential further use
  return {
    txData,
    analysis,
    endpoint: usedEndpoint
  };
}

// Run the analysis
analyzeStargazeTransaction().catch(error => {
  console.error('Error:', error.message);
}); 