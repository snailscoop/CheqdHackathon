/**
 * Quiz Commands
 * 
 * Handles all quiz-related Telegram commands and callbacks.
 */

const logger = require('../utils/logger');
const educationalCredentialService = require('../modules/education/educationalCredentialService');
const { Markup } = require('telegraf');

/**
 * Start a quiz
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function startQuiz(ctx) {
  try {
    // Extract topic from command if provided
    let topic = 'blockchain';
    const match = ctx.message.text.match(/\/quiz\s+(.*)/i);
    if (match && match[1]) {
      topic = match[1].trim();
    }
    
    return await educationalCredentialService.startQuiz(ctx, { topic });
  } catch (error) {
    logger.error('Error in startQuiz command', { error: error.message });
    return ctx.reply('Sorry, there was an error starting the quiz. Please try again later.');
  }
}

/**
 * Handle quiz callback queries
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
async function handleQuizCallback(ctx) {
  try {
    const user = ctx.from;
    const data = ctx.callbackQuery.data;
    const parts = data.split(':');
    
    if (parts.length < 2) {
      return ctx.answerCbQuery('Invalid callback data');
    }
    
    // Get the action (start, answer)
    const action = parts[1];
    
    // Initialize session if not exists
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.quizzes) ctx.session.quizzes = {};
    
    // Get user's quiz session
    const quizSession = ctx.session.quizzes[user.id];
    
    if (!quizSession && action !== 'start') {
      return ctx.answerCbQuery('No active quiz session. Start a new quiz with /quiz');
    }
    
    // Handle different quiz actions
    if (action === 'start') {
      const topic = parts[2] || 'blockchain';
      return await startQuizQuestion(ctx, user.id);
    } else if (action === 'answer') {
      const answerIndex = parseInt(parts[2], 10);
      return await processQuizAnswer(ctx, user.id, answerIndex);
    } else if (action === 'next') {
      return await startQuizQuestion(ctx, user.id);
    } else if (action === 'end') {
      return await endQuiz(ctx, user.id);
    }
    
    return ctx.answerCbQuery('Unrecognized quiz action');
  } catch (error) {
    logger.error('Error handling quiz callback', { error: error.message });
    return ctx.answerCbQuery('An error occurred. Please try again.');
  }
}

/**
 * Send the next question in the quiz
 * @param {Object} ctx - Telegram context
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
async function startQuizQuestion(ctx, userId) {
  try {
    const quizSession = ctx.session.quizzes[userId];
    
    if (!quizSession) {
      return ctx.answerCbQuery('No active quiz session');
    }
    
    // Check if quiz is complete
    if (quizSession.currentQuestion >= quizSession.questions.length) {
      return await endQuiz(ctx, userId);
    }
    
    // Get current question
    const question = quizSession.questions[quizSession.currentQuestion];
    
    // Format question message
    let message = `*Question ${quizSession.currentQuestion + 1}/${quizSession.questions.length}*\n\n`;
    message += `${question.text}\n\n`;
    
    // Create answer buttons
    const buttons = question.options.map((option, index) => {
      return Markup.button.callback(option, `quiz:answer:${index}`);
    });
    
    // Send question
    await ctx.answerCbQuery();
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons.map(button => [button]))
    });
    
    logger.info('Sent quiz question', { 
      userId, 
      questionNumber: quizSession.currentQuestion + 1
    });
    
    return;
  } catch (error) {
    logger.error('Error sending quiz question', { error: error.message });
    return ctx.answerCbQuery('Error sending question. Please try again.');
  }
}

/**
 * Process a quiz answer
 * @param {Object} ctx - Telegram context
 * @param {string} userId - User ID
 * @param {number} answerIndex - Selected answer index
 * @returns {Promise<void>}
 */
async function processQuizAnswer(ctx, userId, answerIndex) {
  try {
    const quizSession = ctx.session.quizzes[userId];
    
    if (!quizSession) {
      return ctx.answerCbQuery('No active quiz session');
    }
    
    // Get current question
    const question = quizSession.questions[quizSession.currentQuestion];
    
    // Check if answer is correct
    const isCorrect = answerIndex === question.correctIndex;
    
    // Store the answer
    quizSession.answers.push({
      questionIndex: quizSession.currentQuestion,
      answerIndex,
      isCorrect
    });
    
    // Move to next question
    quizSession.currentQuestion++;
    
    // Show result of this answer
    let resultMessage = `${isCorrect ? '✅ Correct!' : '❌ Incorrect.'}\n\n`;
    resultMessage += `The correct answer is: ${question.options[question.correctIndex]}\n\n`;
    
    if (question.explanation) {
      resultMessage += `*Explanation:*\n${question.explanation}\n\n`;
    }
    
    resultMessage += quizSession.currentQuestion < quizSession.questions.length
      ? 'Click Next to continue.'
      : 'Click Finish to see your results.';
    
    // Create next/finish button
    const buttonLabel = quizSession.currentQuestion < quizSession.questions.length
      ? 'Next Question'
      : 'Finish Quiz';
      
    const buttonAction = quizSession.currentQuestion < quizSession.questions.length
      ? 'quiz:next'
      : 'quiz:end';
    
    await ctx.answerCbQuery(isCorrect ? 'Correct!' : 'Incorrect');
    await ctx.editMessageText(resultMessage, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[
        Markup.button.callback(buttonLabel, buttonAction)
      ]])
    });
    
    logger.info('Processed quiz answer', { 
      userId, 
      questionNumber: quizSession.currentQuestion,
      isCorrect
    });
    
    return;
  } catch (error) {
    logger.error('Error processing quiz answer', { error: error.message });
    return ctx.answerCbQuery('Error processing answer. Please try again.');
  }
}

/**
 * End the quiz and show results
 * @param {Object} ctx - Telegram context
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
async function endQuiz(ctx, userId) {
  try {
    const quizSession = ctx.session.quizzes[userId];
    
    if (!quizSession) {
      return ctx.answerCbQuery('No active quiz session');
    }
    
    // Calculate results
    const totalQuestions = quizSession.questions.length;
    const correctAnswers = quizSession.answers.filter(a => a.isCorrect).length;
    const scorePercent = Math.round((correctAnswers / totalQuestions) * 100);
    const passed = scorePercent >= 70; // Pass threshold
    
    // Format results message
    let message = `🎓 *Quiz Results: ${quizSession.topic}*\n\n`;
    message += `You answered ${correctAnswers} out of ${totalQuestions} questions correctly.\n`;
    message += `Score: ${scorePercent}%\n\n`;
    message += passed 
      ? '🏆 Congratulations! You passed the quiz.'
      : '📚 Keep learning and try again soon!';
    
    // Create quiz data for credential
    const quizResult = {
      title: `Quiz on ${quizSession.topic}`,
      topic: quizSession.topic,
      score: correctAnswers,
      totalQuestions,
      category: 'Blockchain',
      skills: [quizSession.topic],
      level: 'Beginner'
    };
    
    // Send results
    await ctx.answerCbQuery();
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[
        Markup.button.callback('Take Another Quiz', 'quiz:start:blockchain')
      ]])
    });
    
    logger.info('Quiz completed', { 
      userId, 
      topic: quizSession.topic,
      score: correctAnswers,
      total: totalQuestions,
      percent: scorePercent,
      passed
    });
    
    // Issue credential if passed
    if (passed) {
      try {
        await educationalCredentialService.issueQuizCompletionCredential(
          { id: userId, ...ctx.from },
          quizResult
        );
        
        // Send credential notification
        await ctx.reply(
          `🎉 *Quiz Credential Issued!*\n\nYou've earned a verifiable credential for completing the quiz on ${quizSession.topic}. You can view it in your credentials list.`,
          { parse_mode: 'Markdown' }
        );
      } catch (credError) {
        logger.error('Error issuing quiz credential', { error: credError.message });
      }
    }
    
    // Clear the quiz session
    delete ctx.session.quizzes[userId];
    
    return;
  } catch (error) {
    logger.error('Error ending quiz', { error: error.message });
    return ctx.answerCbQuery('Error displaying results. Please try again.');
  }
}

module.exports = {
  startQuiz,
  handleQuizCallback
}; 