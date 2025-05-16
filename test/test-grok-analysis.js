/**
 * Test script for the Grok Transaction Analyzer
 * 
 * This script uses the Grok/LLM analyzer to provide detailed natural language
 * analysis of a blockchain transaction.
 */

const GrokTransactionAnalyzer = require('./grok-tx-analyzer');
const fs = require('fs');

// Transaction hash to analyze
const TX_HASH = 'F9FAD5A47E9CF475083A6813FC2959237CE82C118218A1088A61F9C8F9BEF5C5';
const CHAIN_ID = 'stargaze-1';

/**
 * Main function to test Grok transaction analysis
 */
async function testGrokAnalysis() {
  console.log(`=== TESTING GROK TRANSACTION ANALYSIS ===`);
  console.log(`Transaction Hash: ${TX_HASH}`);
  console.log(`Chain ID: ${CHAIN_ID}`);
  console.log('');
  
  try {
    // Check if we have the transaction data file from the previous script
    if (!fs.existsSync('tx_raw_data.json')) {
      console.error('Transaction data file not found. Please run test-stargaze-tx.js first.');
      return;
    }
    
    console.log('Loading transaction data...');
    const txData = GrokTransactionAnalyzer.loadTransactionData('tx_raw_data.json');
    
    // Create analyzer with mock configuration (no API key needed for testing)
    const analyzer = new GrokTransactionAnalyzer({
      // You can provide an API key here to use the real LLM API
      // apiKey: process.env.OPENAI_API_KEY 
    });
    
    console.log('Analyzing transaction with Grok...');
    const analysis = await analyzer.analyzeTransaction(txData, TX_HASH, CHAIN_ID);
    
    // Save analysis results
    fs.writeFileSync('grok_analysis_results.json', JSON.stringify(analysis, null, 2));
    console.log('\nSaved analysis results to grok_analysis_results.json');
    
    // Display analysis
    console.log('\n=== GROK ANALYSIS RESULTS ===');
    console.log(`\nSummary: ${analysis.analysis.summary}`);
    
    console.log('\nExplanation:');
    console.log(analysis.analysis.explanation);
    
    if (analysis.analysis.failure_reason) {
      console.log('\nFailure Reason:');
      console.log(analysis.analysis.failure_reason);
    }
    
    console.log('\nRecommendations:');
    if (analysis.analysis.recommendations && analysis.analysis.recommendations.length > 0) {
      analysis.analysis.recommendations.forEach((rec, index) => {
        console.log(`${index + 1}. ${rec}`);
      });
    } else {
      console.log('No specific recommendations available.');
    }
    
    if (analysis.analysis.technical_notes) {
      console.log('\nTechnical Notes:');
      console.log(analysis.analysis.technical_notes);
    }
    
    // Demonstrate how to integrate this with a bot handler
    console.log('\n=== SAMPLE BOT RESPONSE ===');
    const botResponse = generateBotResponse(analysis);
    console.log(botResponse);
    
    return analysis;
  } catch (error) {
    console.error('Error in Grok analysis test:', error.message);
  }
}

/**
 * Generate a formatted bot response based on the analysis
 * @param {Object} analysis - The Grok analysis results
 * @returns {string} - Formatted response for a bot
 */
function generateBotResponse(analysis) {
  const { success } = analysis.processedData;
  const { summary, explanation, failure_reason, recommendations } = analysis.analysis;
  
  let response = `🔍 **Transaction Analysis**\n\n`;
  response += `${summary}\n\n`;
  
  if (success) {
    response += `✅ This transaction was successful! ${explanation}\n\n`;
  } else {
    response += `❌ **Transaction Failed**\n${explanation}\n\n`;
    response += `**Why it failed:**\n${failure_reason}\n\n`;
    
    response += `**How to fix it:**\n`;
    recommendations.forEach((rec, index) => {
      response += `${index + 1}. ${rec}\n`;
    });
  }
  
  response += `\nTransaction Hash: \`${analysis.txHash}\``;
  
  return response;
}

// Run the test
testGrokAnalysis().catch(console.error); 