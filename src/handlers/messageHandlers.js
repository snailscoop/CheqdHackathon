/**
 * Message Handlers
 * 
 * Handlers for Telegram text messages.
 */

const logger = require('../utils/logger');
const sqliteService = require('../db/sqliteService');
const grokService = require('../services/grokService');
const educationalCredentialService = require('../modules/education/educationalCredentialService');

/**
 * Handle generic text message
 * @param {Object} ctx - Telegram context
 */
async function handleTextMessage(ctx) {
  try {
    // Skip handling in channels or automated messages
    if (ctx.chat.type === 'channel' || !ctx.from || ctx.from.is_bot) {
      return;
    }
    
    // Record message in database
    await sqliteService.recordMessage({
      message_id: ctx.message.message_id,
      chat: ctx.chat,
      from: ctx.from,
      text: ctx.message.text,
      type: 'text'
    });
    
    // Check if private chat AI chat should be enabled
    const aiChatEnabled = await sqliteService.getSetting('ai_chat_enabled') === 'true';
    const isPrivateChat = ctx.chat.type === 'private';
    
    if (isPrivateChat && aiChatEnabled) {
      await handleAIChat(ctx);
    }
  } catch (error) {
    logger.error('Error handling text message', { error: error.message });
  }
}

/**
 * Handle quiz response
 * @param {Object} ctx - Telegram context
 */
async function handleQuizResponse(ctx) {
  try {
    // Get user ID
    const userId = ctx.from.id;
    
    // Check if user has an active quiz session
    const session = educationalCredentialService.getActiveQuizSession(userId);
    
    if (!session || !session.active) {
      return;
    }
    
    // Get current question
    const currentQuestion = session.questions[session.currentQuestionIndex];
    
    if (!currentQuestion) {
      await ctx.reply('Error: No active question found.');
      educationalCredentialService.endQuizSession(userId);
      return;
    }
    
    // Process the answer
    const userAnswer = ctx.message.text.trim();
    let answerIndex = -1;
    
    // Check if answer is option number (1-4)
    if (/^[1-4]$/.test(userAnswer)) {
      answerIndex = parseInt(userAnswer, 10) - 1;
    } else {
      // Try to match answer text
      answerIndex = currentQuestion.options.findIndex(
        option => option.toLowerCase() === userAnswer.toLowerCase()
      );
    }
    
    // Record and check answer
    if (answerIndex === -1) {
      await ctx.reply(
        'Please select a valid answer option (1-4 or the exact text of an option).'
      );
      return;
    }
    
    const isCorrect = answerIndex === currentQuestion.correctAnswer;
    
    // Record the answer
    session.answers.push({
      questionIndex: session.currentQuestionIndex,
      userAnswer: answerIndex,
      correct: isCorrect
    });
    
    // Provide feedback
    if (isCorrect) {
      await ctx.reply('✅ Correct!');
    } else {
      const correctOption = currentQuestion.options[currentQuestion.correctAnswer];
      await ctx.reply(`❌ Incorrect. The correct answer is: ${correctOption}`);
    }
    
    // Move to next question or finish quiz
    session.currentQuestionIndex++;
    
    if (session.currentQuestionIndex >= session.questions.length) {
      // Quiz completed, calculate score and save results
      await finishQuiz(ctx, session);
    } else {
      // Send next question
      await sendQuizQuestion(ctx, session);
    }
  } catch (error) {
    logger.error('Error handling quiz response', { error: error.message });
    await ctx.reply('Sorry, there was an error processing your answer.');
  }
}

/**
 * Send a quiz question
 * @param {Object} ctx - Telegram context
 * @param {Object} session - Quiz session
 * @private
 */
async function sendQuizQuestion(ctx, session) {
  try {
    const currentQuestion = session.questions[session.currentQuestionIndex];
    
    let questionText = `Question ${session.currentQuestionIndex + 1}/${session.questions.length}:\n\n`;
    questionText += `${currentQuestion.text}\n\n`;
    
    // Add options
    for (let i = 0; i < currentQuestion.options.length; i++) {
      questionText += `${i + 1}. ${currentQuestion.options[i]}\n`;
    }
    
    await ctx.reply(questionText);
  } catch (error) {
    logger.error('Error sending quiz question', { error: error.message });
    await ctx.reply('Sorry, there was an error sending the quiz question.');
  }
}

/**
 * Finish a quiz and calculate results
 * @param {Object} ctx - Telegram context
 * @param {Object} session - Quiz session
 * @private
 */
async function finishQuiz(ctx, session) {
  try {
    // Calculate score
    const totalQuestions = session.questions.length;
    const correctAnswers = session.answers.filter(a => a.correct).length;
    const score = Math.round((correctAnswers / totalQuestions) * 100);
    
    // Check if passed
    const passThreshold = session.passThreshold || 70;
    const passed = score >= passThreshold;
    
    // Create result
    const result = {
      userId: session.userId,
      topic: session.topic,
      score,
      passed,
      totalQuestions,
      correctAnswers,
      completedAt: new Date().toISOString()
    };
    
    // Save quiz result
    await educationalCredentialService.saveQuizResult(result);
    
    // End quiz session
    educationalCredentialService.endQuizSession(session.userId);
    
    // Create result message
    let resultMessage = '📝 Quiz Complete!\n\n';
    resultMessage += `Topic: ${session.topic}\n`;
    resultMessage += `Score: ${score}% (${correctAnswers}/${totalQuestions})\n`;
    resultMessage += `Result: ${passed ? '✅ Passed' : '❌ Failed'}\n\n`;
    
    if (passed) {
      // Issue credential if passed
      try {
        const credential = await educationalCredentialService.issueEducationalCredential(
          session.userId,
          session.topic,
          score
        );
        
        if (credential) {
          resultMessage += `🎓 You've earned an Educational Credential!\n`;
          resultMessage += `Credential ID: ${credential.credential_id}\n\n`;
        }
      } catch (credError) {
        logger.error('Error issuing educational credential', { error: credError.message });
      }
    } else {
      resultMessage += `Keep learning and try again to earn a credential.\n\n`;
    }
    
    // Add next steps
    resultMessage += `Next Steps:\n`;
    resultMessage += `• Use /progress to view your educational progress\n`;
    resultMessage += `• Use /quiz to try another topic\n`;
    
    await ctx.reply(resultMessage);
  } catch (error) {
    logger.error('Error finishing quiz', { error: error.message });
    await ctx.reply('Sorry, there was an error completing the quiz.');
  }
}

/**
 * Handle AI chat for natural language conversation
 * @param {Object} ctx - Telegram context
 */
async function handleAIChat(ctx) {
  try {
    // Get user info
    const user = {
      id: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name
    };
    
    // Get message
    const message = ctx.message.text;
    
    // Skip very short messages or commands
    if (message.length < 3 || message.startsWith('/')) {
      return;
    }
    
    // Check if message is addressed to bot
    const botUsername = await sqliteService.getSetting('bot_username');
    const isBotMentioned = botUsername && message.includes(`@${botUsername}`);
    const isReplyToBot = ctx.message.reply_to_message && 
                        ctx.message.reply_to_message.from.username === botUsername;
    
    // Only respond in groups if mentioned or reply to bot's message
    if (ctx.chat.type !== 'private' && !isBotMentioned && !isReplyToBot) {
      return;
    }
    
    // Show typing indicator
    await ctx.replyWithChatAction('typing');
    
    // Load chat history
    const chatHistory = await getChatHistory(ctx.chat.id, ctx.from.id, 5);
    
    // Process with Grok
    const response = await grokService.generateChatResponse(message, user, chatHistory);
    
    // Reply with AI response
    return ctx.reply(
      response.text,
      { reply_to_message_id: ctx.message.message_id }
    );
  } catch (error) {
    logger.error('Error handling AI chat', { error: error.message });
  }
}

/**
 * Get recent chat history
 * @param {Number} chatId - Chat ID
 * @param {Number} userId - User ID
 * @param {Number} limit - Maximum number of messages
 * @returns {Promise<Array>} - Chat history
 * @private
 */
async function getChatHistory(chatId, userId, limit = 5) {
  try {
    // Get recent messages between user and bot
    const messages = await sqliteService.db.all(
      `SELECT m.message_id, m.user_id, m.text, m.created_at
       FROM messages m
       WHERE m.chat_id = ? AND (m.user_id = ? OR m.user_id IS NULL)
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [chatId, userId, limit]
    );
    
    // Format for Grok
    return messages.reverse().map(msg => ({
      text: msg.text,
      isUser: msg.user_id === userId
    }));
  } catch (error) {
    logger.error('Error getting chat history', { error: error.message });
    return [];
  }
}

module.exports = {
  handleTextMessage,
  handleQuizResponse,
  handleAIChat
}; 