/**
 * Command Handlers Index
 * 
 * Exports all Telegram bot command handlers.
 */

const startCommand = require('./startCommand');
const helpCommand = require('./helpCommand');
const credentialCommands = require('./credentialCommands');
const didCommands = require('./didCommands');
const videoCommands = require('./videoCommands');
const adminCommands = require('./adminCommands');
const quizCommands = require('./quizCommands');

module.exports = {
  // Basic commands
  startCommand: startCommand.handle,
  helpCommand: helpCommand.handle,
  
  // Credential commands
  issueCredential: credentialCommands.issueCredential,
  verifyCredential: credentialCommands.verifyCredential,
  listCredentials: credentialCommands.listCredentials,
  revokeCredential: credentialCommands.revokeCredential,
  
  // DID commands
  createDid: didCommands.createDid,
  resolveDid: didCommands.resolveDid,
  
  // Video commands
  pinVideo: videoCommands.pinVideo,
  searchVideos: videoCommands.searchVideos,
  
  // Admin commands
  stats: adminCommands.stats,
  broadcast: adminCommands.broadcast,
  
  // Quiz/educational commands
  startQuiz: quizCommands.startQuiz,
  
  // Register all commands with the bot
  registerCommands: (bot) => {
    bot.command('start', startCommand.handle);
    bot.command('help', helpCommand.handle);
    
    // Credential commands
    bot.command('issue', credentialCommands.issueCredential);
    bot.command('verify', credentialCommands.verifyCredential);
    bot.command('credentials', credentialCommands.listCredentials);
    bot.command('revoke', credentialCommands.revokeCredential);
    
    // DID commands
    bot.command('createdid', didCommands.createDid);
    bot.command('resolve', didCommands.resolveDid);
    
    // Video commands
    bot.command('pin', videoCommands.pinVideo);
    bot.command('search', videoCommands.searchVideos);
    
    // Admin commands (only available to admins)
    bot.command('stats', adminCommands.stats);
    bot.command('broadcast', adminCommands.broadcast);
    
    // Quiz/educational commands
    bot.command('quiz', quizCommands.startQuiz);
    
    // Handle callback queries (for buttons)
    bot.on('callback_query', async (ctx) => {
      const data = ctx.callbackQuery.data;
      
      if (data.startsWith('quiz:')) {
        return quizCommands.handleQuizCallback(ctx);
      } else if (data.startsWith('cred:')) {
        return credentialCommands.handleCredentialCallback(ctx);
      } else if (data.startsWith('did:')) {
        return didCommands.handleDidCallback(ctx);
      } else if (data.startsWith('video:')) {
        return videoCommands.handleVideoCallback(ctx);
      }
    });
  }
}; 