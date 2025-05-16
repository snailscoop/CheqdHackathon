#!/usr/bin/env node

/**
 * Telegram Quiz Integration Script
 * 
 * This script helps integrate generated quizzes with the Telegram bot.
 * It formats quiz data correctly for Telegram's inline keyboard format.
 * 
 * Usage: node scripts/telegram-quiz-integration.js <CID> [--chatId <CHAT_ID>]
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { jackalPinService } = require('../src/modules/jackal/jackalPinService');
const videoProcessor = require('../src/modules/jackal/videoProcessor');
const logger = require('../src/utils/logger');
const db = require('../src/db/sqliteService');
const config = require('../src/config/config');

// Parse command line arguments
const args = process.argv.slice(2);
const cid = args[0];
const chatIdIndex = args.indexOf('--chatId');
const chatId = chatIdIndex > -1 ? args[chatIdIndex + 1] : null;

// Validate arguments
if (!cid) {
  console.error('Error: CID is required');
  console.error('Usage: node scripts/telegram-quiz-integration.js <CID> [--chatId <CHAT_ID>]');
  process.exit(1);
}

// Initialize services
async function initialize() {
  try {
    await db.ensureInitialized();
    await jackalPinService.ensureInitialized();
    await videoProcessor.initialize();
    return true;
  } catch (error) {
    console.error('Error initializing services:', error.message);
    return false;
  }
}

// Generate Telegram inline keyboard buttons for a quiz
function generateTelegramButtons(quiz) {
  if (!quiz) {
    console.error('No quiz data available');
    return null;
  }
  
  try {
    // Parse quiz questions if needed
    const questions = typeof quiz.questions === 'string' 
      ? JSON.parse(quiz.questions) 
      : quiz.questions;
    
    // Check if we have valid quiz data
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      console.error('Invalid quiz format - questions not found or empty');
      return null;
    }
    
    // Start with first question
    const firstQuestion = questions[0];
    
    // Format options as Telegram inline keyboard buttons
    const inlineKeyboard = [];
    
    if (firstQuestion.options && Array.isArray(firstQuestion.options)) {
      // Split options into rows of 2 buttons each
      for (let i = 0; i < firstQuestion.options.length; i += 2) {
        const row = [];
        
        // Add button for current option
        row.push({
          text: firstQuestion.options[i],
          callback_data: `quiz:${quiz.id}:q0:${i}` // Format: quiz:quizId:questionIndex:optionIndex
        });
        
        // Add next button if available
        if (i + 1 < firstQuestion.options.length) {
          row.push({
            text: firstQuestion.options[i + 1],
            callback_data: `quiz:${quiz.id}:q0:${i + 1}`
          });
        }
        
        inlineKeyboard.push(row);
      }
    } else {
      // If no options, create a "Start Quiz" button
      inlineKeyboard.push([{
        text: "Start Quiz",
        callback_data: `quiz:${quiz.id}:start`
      }]);
    }
    
    // Create complete data for Telegram
    const telegramData = {
      quiz_id: quiz.id,
      title: quiz.title,
      description: quiz.description || "Test your knowledge with this quiz!",
      question_text: firstQuestion.question,
      inline_keyboard: inlineKeyboard,
      total_questions: questions.length,
      current_question: 0
    };
    
    return telegramData;
  } catch (error) {
    console.error('Error generating Telegram buttons:', error);
    return null;
  }
}

// Send quiz to Telegram chat if chatId is provided
async function sendQuizToTelegram(telegramData, chatId) {
  try {
    if (!chatId) {
      console.log('No chatId provided - not sending to Telegram');
      return false;
    }
    
    if (!config.telegram || !config.telegram.botToken) {
      console.error('Telegram bot token not configured');
      return false;
    }
    
    const botToken = config.telegram.botToken;
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    // Prepare message with inline keyboard
    const message = {
      chat_id: chatId,
      text: `📝 *${telegramData.title}*\n\n${telegramData.description}\n\nQuestion 1/${telegramData.total_questions}:\n${telegramData.question_text}`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: telegramData.inline_keyboard
      }
    };
    
    // Send to Telegram
    console.log(`Sending quiz to Telegram chat ID: ${chatId}`);
    const response = await axios.post(apiUrl, message);
    
    if (response.data && response.data.ok) {
      console.log('Quiz sent successfully to Telegram!');
      return true;
    } else {
      console.error('Failed to send quiz to Telegram:', response.data);
      return false;
    }
  } catch (error) {
    console.error('Error sending quiz to Telegram:', error.message);
    if (error.response) {
      console.error('Telegram API response:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// Save Telegram format for future use
function saveQuizTelegramFormat(telegramData, quizId) {
  try {
    const quizDir = path.join(process.cwd(), 'data', 'quizzes', 'telegram');
    if (!fs.existsSync(quizDir)) {
      fs.mkdirSync(quizDir, { recursive: true });
    }
    
    const outFile = path.join(quizDir, `telegram-quiz-${quizId}.json`);
    fs.writeFileSync(outFile, JSON.stringify(telegramData, null, 2));
    console.log(`Telegram format saved to: ${outFile}`);
    return true;
  } catch (error) {
    console.error('Error saving Telegram format:', error);
    return false;
  }
}

// Main function
async function main() {
  try {
    const initialized = await initialize();
    if (!initialized) {
      process.exit(1);
    }
    
    // Get video data with quiz
    const videoData = await videoProcessor.getVideoData(cid);
    
    if (!videoData) {
      console.error(`No video found for CID: ${cid}`);
      console.log('Processing video first...');
      
      await videoProcessor.processVideoByCid(cid);
      const updatedVideo = await videoProcessor.getVideoData(cid);
      
      if (!updatedVideo || !updatedVideo.quiz) {
        console.error('Failed to process video or generate quiz');
        console.log('Try running: node scripts/generate-quiz.js generate ' + cid);
        process.exit(1);
      }
      
      console.log('Video processed successfully!');
    } else if (!videoData.quiz) {
      console.error(`Video found but no quiz available for CID: ${cid}`);
      console.log('Generating quiz...');
      
      const quizId = await videoProcessor._generateVideoQuiz(videoData.id);
      console.log(`Quiz generated with ID: ${quizId}`);
      
      // Reload video data with new quiz
      const updatedVideo = await videoProcessor.getVideoData(cid);
      if (!updatedVideo.quiz) {
        console.error('Failed to generate quiz');
        process.exit(1);
      }
    }
    
    // Get final video data
    const finalVideo = await videoProcessor.getVideoData(cid);
    
    // Generate Telegram buttons for quiz
    console.log('Generating Telegram keyboard format...');
    const telegramData = generateTelegramButtons(finalVideo.quiz);
    
    if (!telegramData) {
      console.error('Failed to generate Telegram format');
      process.exit(1);
    }
    
    // Save Telegram format
    saveQuizTelegramFormat(telegramData, finalVideo.quiz.id);
    
    // Display formatted data
    console.log('\n=== TELEGRAM QUIZ FORMAT ===');
    console.log(`Title: ${telegramData.title}`);
    console.log(`Questions: ${telegramData.total_questions}`);
    console.log('First question:');
    console.log(telegramData.question_text);
    console.log('\nInline keyboard:');
    console.log(JSON.stringify(telegramData.inline_keyboard, null, 2));
    
    // Send to Telegram if chatId provided
    if (chatId) {
      await sendQuizToTelegram(telegramData, chatId);
    }
    
    console.log('\nTelegram integration complete!');
    console.log('You can now use this quiz in your Telegram bot.');
    console.log(`Quiz ID: ${finalVideo.quiz.id}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Unhandled error:', error);
    process.exit(1);
  }
}

// Run the script
main(); 