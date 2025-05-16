const path = require('path');
const dotenv = require('dotenv');
const { buildConfig } = require('./moduleConfig');

// Load environment variables from .env file
dotenv.config();

// Define default values
const defaults = {
  port: 3000,
  host: 'localhost',
  dbPath: path.join(__dirname, '../../data/cheqd-bot.sqlite'),
  logLevel: 'info',
  logPath: path.join(__dirname, '../../logs/cheqd-bot.log'),
};

// Basic configuration
const basicConfig = {
  // Server configuration
  server: {
    port: process.env.API_PORT || defaults.port,
    host: process.env.API_HOST || defaults.host,
  },
  
  // Database configuration (override moduleConfig default)
  database: {
    path: process.env.DB_PATH || defaults.dbPath,
  },
  
  // Telegram bot configuration
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    username: process.env.BOT_USERNAME,
  },
  
  // Cheqd API configuration (partial override of moduleConfig)
  cheqd: {
    apiUrl: process.env.CHEQD_API_URL || process.env.CHEQD_NETWORK_URL || 'https://studio-api.cheqd.net',
    networkChainId: process.env.CHEQD_NETWORK_CHAIN_ID || 'cheqd-mainnet-1',
    studioApiKey: process.env.CHEQD_STUDIO_API_KEY,
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || defaults.logLevel,
    path: process.env.LOG_FILE_PATH || defaults.logPath,
  },
};

// Build complete configuration using moduleConfig for additional module settings
const config = buildConfig(basicConfig);

module.exports = config; 