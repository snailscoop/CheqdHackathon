/**
 * Load environment variables from .env file
 */
const fs = require('fs');

function loadEnv() {
  try {
    const envContent = fs.readFileSync('.env', 'utf8');
    const lines = envContent.split('\n');
    
    const envVars = {};
    
    // Process each line
    lines.forEach(line => {
      // Skip empty lines and comments
      if (!line || line.startsWith('#')) return;
      
      // Find key-value pairs
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        
        // Only keep the last occurrence of each key
        envVars[key] = value;
      }
    });
    
    // Set environment variables
    Object.entries(envVars).forEach(([key, value]) => {
      process.env[key] = value;
    });
    
    console.log('Environment variables loaded successfully');
    console.log('Values found:');
    ['CHEQD_ROOT_REGISTRY_ID', 'CHEQD_ROOT_DID', 'BOT_REGISTRY_ID', 'BOT_DID', 
     'BOT_CREDENTIAL_ID', 'BOT_ACCREDITATION_ID'].forEach(key => {
      if (envVars[key]) {
        console.log(`${key}=${envVars[key]}`);
      } else {
        console.log(`${key}=NOT_FOUND`);
      }
    });
    
    return envVars;
  } catch (error) {
    console.error(`Error loading .env file: ${error.message}`);
    return {};
  }
}

// Export the function
module.exports = loadEnv; 