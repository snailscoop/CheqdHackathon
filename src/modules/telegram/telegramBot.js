const logger = require('../../utils/logger');
// Import the conversational video quiz handler
const conversationalVideoQuizHandler = require('./handlers/conversationalVideoQuizHandler');

// Register bot commands and handlers
function registerHandlers(bot) {
  // ... existing code ...
  
  // Add this new handler for conversational commands
  bot.hears(/^\/dail (.+)$/i, async (ctx) => {
    try {
      const query = ctx.match[1].trim();
      logger.info(`Received natural language command: /dail ${query}`);
      await conversationalVideoQuizHandler.processNaturalLanguageQuery(ctx, query);
    } catch (error) {
      logger.error(`Error processing /dail command: ${error.message}`, { error });
      ctx.reply("Sorry, I encountered an error processing your request. Please try again later.");
    }
  });
  
  // ... existing code ...
}

module.exports = {
  registerHandlers
}; 