#!/usr/bin/env node

/**
 * Telegram Educational Command Handler
 * 
 * This script handles educational commands from the Telegram bot.
 * It processes videos from Jackal based on topics, and sends quiz content to users.
 * 
 * Usage: node scripts/telegram-educational-command.js --topic <TOPIC> --chatId <CHAT_ID> [--userId <USER_ID>]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');
const { jackalPinService } = require('../src/modules/jackal/jackalPinService');
const videoProcessor = require('../src/modules/jackal/videoProcessor');
const logger = require('../src/utils/logger');
const db = require('../src/db/sqliteService');
const config = require('../src/config/config');

// Parse command-line arguments
const args = process.argv.slice(2);
const topicIndex = args.indexOf('--topic');
const chatIdIndex = args.indexOf('--chatId');
const userIdIndex = args.indexOf('--userId');

const topic = topicIndex > -1 ? args[topicIndex + 1] : null;
const chatId = chatIdIndex > -1 ? args[chatIdIndex + 1] : null;
const userId = userIdIndex > -1 ? args[userIdIndex + 1] : null;
const debug = args.includes('--debug');

// Validate arguments
if (!topic || !chatId) {
  console.error('Error: topic and chatId are required');
  console.error('Usage: node scripts/telegram-educational-command.js --topic <TOPIC> --chatId <CHAT_ID> [--userId <USER_ID>]');
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

// Find educational video by topic
async function findVideoByTopic(topic) {
  try {
    // Get DB connection
    const dbConn = await db.getDb();
    
    // Find video by topic in the educational_topics table if it exists
    let video = null;
    
    try {
      // Check if educational_topics table exists
      const tableExists = await dbConn.get(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='educational_topics'
      `);
      
      if (tableExists) {
        // Use the topics table to find a video
        video = await dbConn.get(`
          SELECT ev.* 
          FROM educational_topics et
          JOIN educational_videos ev ON et.video_cid = ev.cid
          WHERE et.topic_name LIKE ? OR et.topic_keywords LIKE ?
          ORDER BY et.relevance DESC LIMIT 1
        `, [`%${topic}%`, `%${topic}%`]);
      }
    } catch (e) {
      console.log('Educational topics table not found or query failed');
    }
    
    // If no video found through topics, try searching in video metadata or summaries
    if (!video) {
      // Search in video summaries
      video = await dbConn.get(`
        SELECT ev.* 
        FROM educational_videos ev
        JOIN video_summaries vs ON ev.id = vs.video_id
        WHERE vs.title LIKE ? OR vs.overview LIKE ?
        ORDER BY ev.processed_at DESC LIMIT 1
      `, [`%${topic}%`, `%${topic}%`]);
      
      // If still not found, get the most recently processed video as fallback
      if (!video) {
        video = await dbConn.get(`
          SELECT * FROM educational_videos
          WHERE processed = 1
          ORDER BY processed_at DESC LIMIT 1
        `);
      }
    }
    
    return video;
  } catch (error) {
    console.error('Error finding video by topic:', error.message);
    return null;
  }
}

// Send message to Telegram
async function sendTelegramMessage(chatId, message, options = {}) {
  try {
    if (!config.telegram || !config.telegram.botToken) {
      console.error('Telegram bot token not configured');
      return false;
    }
    
    const botToken = config.telegram.botToken;
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const response = await axios.post(apiUrl, {
      chat_id: chatId,
      text: message,
      parse_mode: options.parseMode || 'Markdown',
      reply_markup: options.replyMarkup
    });
    
    return response.data;
  } catch (error) {
    console.error('Error sending Telegram message:', error.message);
    if (error.response) {
      console.error('Telegram API response:', error.response.data);
    }
    return null;
  }
}

// Main function
async function main() {
  try {
    // Initialize services
    const initialized = await initialize();
    if (!initialized) {
      console.error('Failed to initialize services');
      process.exit(1);
    }
    
    console.log(`Processing educational command for topic: ${topic}`);
    
    // Send initial response to user
    await sendTelegramMessage(chatId, `🔍 Looking for educational content about *${topic}*...`);
    
    // Find video by topic
    const video = await findVideoByTopic(topic);
    
    if (!video) {
      console.error(`No video found for topic: ${topic}`);
      await sendTelegramMessage(chatId, `Sorry, I couldn't find any educational content about *${topic}*. Please try a different topic.`);
      process.exit(1);
    }
    
    console.log(`Found video: ${video.name} (CID: ${video.cid})`);
    await sendTelegramMessage(chatId, `Found educational content: *${video.name}*\nPreparing quiz and educational materials...`);
    
    // Check if the video is processed and has a quiz
    let videoData = await videoProcessor.getVideoData(video.cid);
    
    // If not processed or no quiz, process it now
    if (!videoData || !videoData.processed || !videoData.quiz) {
      console.log(`Video needs processing or quiz generation: ${video.cid}`);
      
      try {
        // Process video with quiz generation
        await sendTelegramMessage(chatId, `⏳ Processing video content and generating quiz...\nThis may take a few minutes.`);
        
        // Use process-video.js with quiz generation
        const cmd = `node scripts/process-video.js ${video.cid} --quiz`;
        execSync(cmd, { stdio: debug ? 'inherit' : 'pipe' });
        
        // Refresh video data
        videoData = await videoProcessor.getVideoData(video.cid);
      } catch (error) {
        console.error('Error processing video:', error.message);
        await sendTelegramMessage(chatId, `Sorry, there was an error processing the educational content. Please try again later.`);
        process.exit(1);
      }
    }
    
    // Format quiz for Telegram
    let telegramQuizData;
    try {
      // Use telegram-quiz-integration.js
      const quizDir = path.join(process.cwd(), 'data', 'quizzes', 'telegram');
      const quizFile = path.join(quizDir, `telegram-quiz-${videoData.quiz.id}.json`);
      
      // Check if quiz in Telegram format already exists
      if (fs.existsSync(quizFile)) {
        telegramQuizData = JSON.parse(fs.readFileSync(quizFile, 'utf8'));
      } else {
        // Generate Telegram format
        console.log('Generating Telegram quiz format...');
        const cmd = `node scripts/telegram-quiz-integration.js ${video.cid}`;
        execSync(cmd, { stdio: debug ? 'inherit' : 'pipe' });
        
        // Read the generated file
        if (fs.existsSync(quizFile)) {
          telegramQuizData = JSON.parse(fs.readFileSync(quizFile, 'utf8'));
        }
      }
    } catch (error) {
      console.error('Error formatting quiz for Telegram:', error.message);
      telegramQuizData = null;
    }
    
    // Send summary information to the user
    let summaryText = '';
    if (videoData && videoData.summary) {
      summaryText = `📝 *${videoData.summary.title || 'Educational Content'}*\n\n${videoData.summary.overview}\n\n`;
      
      // Add key points if available
      if (videoData.summary.key_points) {
        try {
          const keyPoints = JSON.parse(videoData.summary.key_points);
          summaryText += "\n*Key Points:*\n";
          keyPoints.forEach((point, index) => {
            summaryText += `${index + 1}. ${point}\n`;
          });
        } catch (e) {
          // Ignore parsing errors
        }
      }
    } else {
      summaryText = `📝 *Educational Content: ${topic}*\n\nThis video contains educational content about ${topic}.\n\n`;
    }
    
    // Send summary to user
    await sendTelegramMessage(chatId, summaryText);
    
    // Send quiz if available
    if (telegramQuizData) {
      // Send beginning of quiz message with inline keyboard
      console.log('Sending quiz to Telegram...');
      
      const quizMessage = `🧠 *${telegramQuizData.title}*\n\n${telegramQuizData.description}\n\nQuestion 1/${telegramQuizData.total_questions}:\n${telegramQuizData.question_text}`;
      
      await sendTelegramMessage(chatId, quizMessage, {
        replyMarkup: {
          inline_keyboard: telegramQuizData.inline_keyboard
        }
      });
      
      console.log('Quiz sent successfully!');
    } else {
      // No quiz available
      await sendTelegramMessage(chatId, "I couldn't generate a quiz for this content. Try another topic.");
    }
    
    console.log('Educational command processing completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Unhandled error:', error);
    try {
      await sendTelegramMessage(chatId, "Sorry, I encountered an error while processing your request. Please try again later.");
    } catch (e) {
      // Ignore
    }
    process.exit(1);
  }
}

// Run the script
main(); 