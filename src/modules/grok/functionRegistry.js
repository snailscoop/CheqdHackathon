/**
 * Grok Function Registry
 * 
 * This module registers and manages all available Grok functions.
 */

// Import function handlers
const transactionAnalysis = require('./functions/transactionAnalysis');

// Function registry with metadata
const functionRegistry = {
  // Blockchain functions
  transaction_analysis: {
    name: 'transaction_analysis',
    description: 'Analyze a blockchain transaction and provide detailed insights, error analysis, and recommendations',
    parameters: {
      txHash: {
        type: 'string',
        description: 'The transaction hash to analyze',
        required: true
      },
      chainId: {
        type: 'string',
        description: 'The blockchain chain ID (e.g., "stargaze-1", "osmosis-1")',
        required: false,
        default: 'stargaze-1'
      }
    },
    handler: transactionAnalysis,
    examples: [
      {
        input: {
          txHash: 'F9FAD5A47E9CF475083A6813FC2959237CE82C118218A1088A61F9C8F9BEF5C5',
          chainId: 'stargaze-1'
        },
        description: 'Analyze a Stargaze transaction'
      }
    ],
    category: 'blockchain'
  },
  
  // Additional functions can be registered here
  // example_function: { ... }
};

/**
 * Get a function handler by name
 * @param {string} functionName - Name of the function to get
 * @returns {Function|null} - Function handler or null if not found
 */
function getFunction(functionName) {
  const func = functionRegistry[functionName];
  return func ? func.handler : null;
}

/**
 * Get function metadata
 * @param {string} functionName - Name of the function to get metadata for
 * @returns {Object|null} - Function metadata or null if not found
 */
function getFunctionMetadata(functionName) {
  const func = functionRegistry[functionName];
  if (!func) return null;
  
  // Return a copy without the handler
  const { handler, ...metadata } = func;
  return metadata;
}

/**
 * List all available functions
 * @param {string} [category] - Optional category to filter by
 * @returns {Array<Object>} - List of function metadata
 */
function listFunctions(category = null) {
  return Object.values(functionRegistry)
    .filter(func => !category || func.category === category)
    .map(({ handler, ...metadata }) => metadata);
}

/**
 * Execute a function by name
 * @param {string} functionName - Name of the function to execute
 * @param {Object} params - Parameters to pass to the function
 * @returns {Promise<Object>} - Function result
 */
async function executeFunction(functionName, params = {}) {
  const handler = getFunction(functionName);
  
  if (!handler) {
    throw new Error(`Function ${functionName} not found`);
  }
  
  try {
    return await handler(params);
  } catch (error) {
    console.error(`Error executing function ${functionName}:`, error);
    throw error;
  }
}

module.exports = {
  getFunction,
  getFunctionMetadata,
  listFunctions,
  executeFunction
}; 