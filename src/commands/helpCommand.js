/**
 * Help Command
 * 
 * Provides help information to users.
 */

const logger = require('../utils/logger');

/**
 * Handle help command
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handle(ctx) {
  try {
    logger.info('Help command executed');
    
    const helpText = `
🤖 *Dail Bot Help* 🤖

*Available Commands:*
• \`/help\` - Show this help message
• \`/dail help\` - Show detailed help
• \`/quiz [topic]\` - Take an educational quiz
• \`/dail start quiz\` - Start an educational quiz
• \`/dail learn about [topic]\` - Learn about a topic
• \`/dail check progress\` - Check your educational progress
• \`/dail check support tier\` - View your support tier

*Moderation Commands (admins & mods):*
• \`/dail kick @username\` - Kick a user
• \`/dail ban @username\` - Ban a user
• \`/dail make @username moderator\` - Make user a moderator

For more information, contact @cheqd_support`;
    
    return ctx.reply(helpText, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error handling help command', { error: error.message });
    return ctx.reply('Sorry, there was an error showing help. Please try again later.');
  }
}

module.exports = {
  handle
}; 