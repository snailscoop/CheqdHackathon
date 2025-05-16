/**
 * Cheqd Bot - Main Application Entry Point
 * 
 * Initializes both the Telegram bot and Express API server.
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config();

// Import services
const logger = require('./utils/logger');
const config = require('./config/config');
const bot = require('./bot');
const api = require('./api');

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  next();
});

// Logging middleware
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  }));
}

// Set up API routes
api.setupApiRoutes(app);

// Static files
const publicPath = path.join(__dirname, '../public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  
  // Serve index.html for any unmatched routes (SPA support)
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(publicPath, 'index.html'));
    }
  });
}

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Express error', { error: err.message, stack: err.stack, requestId: req.id });
  
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: {
      message: err.message || 'Internal server error',
      requestId: req.id
    }
  });
});

/**
 * Start the application - both bot and web server
 */
async function startApp() {
  try {
    // Start the Telegram bot
    await bot.startBot();
    
    // Start the Express server
    app.listen(port, () => {
      logger.info(`API server listening on port ${port}`);
    });
    
    return true;
  } catch (error) {
    logger.error('Failed to start application', { error: error.message });
    process.exit(1);
  }
}

// Start the application if this file is run directly
if (require.main === module) {
  startApp();
}

// Export for testing
module.exports = {
  app,
  startApp
}; 