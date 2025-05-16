#!/usr/bin/env node

/**
 * Quiz Generator Script
 * 
 * This script generates quizzes from processed videos and formats them for use in the Telegram bot.
 * 
 * Usage: 
 * - Generate quiz: node scripts/generate-quiz.js generate <CID> [--force]
 * - Format quiz for Telegram: node scripts/generate-quiz.js format <CID>
 * - List available quizzes: node scripts/generate-quiz.js list
 */

const path = require('path');
const fs = require('fs');
const { jackalPinService } = require('../src/modules/jackal/jackalPinService');
const videoProcessor = require('../src/modules/jackal/videoProcessor');
const logger = require('../src/utils/logger');
const db = require('../src/db/sqliteService');

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const cid = args[1];
const force = args.includes('--force');

// Display usage if no command is provided
if (!command) {
  console.log('Usage:');
  console.log('  node scripts/generate-quiz.js generate <CID> [--force] - Generate a quiz for a video');
  console.log('  node scripts/generate-quiz.js format <CID> - Format a quiz for Telegram');
  console.log('  node scripts/generate-quiz.js list - List all available quizzes');
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

// Generate a quiz for a specific video
async function generateQuiz(cid, force = false) {
  try {
    console.log(`Generating quiz for video CID: ${cid}`);

    // Check if video exists and is processed
    const videoData = await videoProcessor.getVideoData(cid);
    
    if (!videoData) {
      console.log(`Video not found in database. Processing video first...`);
      await videoProcessor.processVideoByCid(cid, { force });
    } else if (!videoData.processed) {
      console.log(`Video exists but is not processed. Processing video...`);
      await videoProcessor.processVideoByCid(cid, { force });
    } else if (videoData.quiz && !force) {
      console.log(`Quiz already exists for this video. Use --force to regenerate.`);
      return formatQuiz(videoData.quiz);
    }
    
    // Refresh video data after processing
    const updatedVideo = await videoProcessor.getVideoData(cid);
    
    if (!updatedVideo) {
      throw new Error(`Unable to retrieve video data after processing`);
    }
    
    if (!updatedVideo.quiz) {
      console.log(`Generating quiz for video ID: ${updatedVideo.id}`);
      const quizId = await videoProcessor._generateVideoQuiz(updatedVideo.id);
      console.log(`Quiz generated with ID: ${quizId}`);
    }
    
    // Get the final video data with quiz
    const finalVideo = await videoProcessor.getVideoData(cid);
    return formatQuiz(finalVideo.quiz);
  } catch (error) {
    console.error('Error generating quiz:', error);
    return null;
  }
}

// Format quiz for display or use in Telegram
function formatQuiz(quiz) {
  if (!quiz) {
    console.error('No quiz data available');
    return null;
  }
  
  try {
    const questions = JSON.parse(quiz.questions);
    
    console.log('\n=== QUIZ ===');
    console.log(`Title: ${quiz.title}`);
    console.log(`Description: ${quiz.description}`);
    console.log(`Questions: ${questions.length}`);
    console.log('');
    
    // Format each question
    questions.forEach((question, index) => {
      console.log(`Q${index + 1}: ${question.question}`);
      
      if (question.options) {
        question.options.forEach((option, optIndex) => {
          const marker = option === question.answer ? '✓' : ' ';
          console.log(`  ${marker} ${optIndex + 1}. ${option}`);
        });
      } else {
        console.log(`  Answer: ${question.answer}`);
      }
      console.log('');
    });
    
    // Generate Telegram-compatible format
    const telegramFormat = {
      quiz_id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      questions: questions.map((q, i) => ({
        id: `q-${quiz.id}-${i}`,
        text: q.question,
        options: q.options ? q.options.map((opt, j) => ({
          id: `q-${quiz.id}-${i}-${j}`,
          text: opt,
          is_correct: opt === q.answer
        })) : [{ id: `q-${quiz.id}-${i}-0`, text: q.answer, is_correct: true }]
      }))
    };
    
    console.log('\n=== TELEGRAM FORMAT ===');
    console.log('Format ready for Telegram bot integration');
    
    // Save to file for easy access
    const quizDir = path.join(process.cwd(), 'data', 'quizzes');
    if (!fs.existsSync(quizDir)) {
      fs.mkdirSync(quizDir, { recursive: true });
    }
    
    const outFile = path.join(quizDir, `quiz-${quiz.id}.json`);
    fs.writeFileSync(outFile, JSON.stringify(telegramFormat, null, 2));
    console.log(`Telegram format saved to: ${outFile}`);
    
    return telegramFormat;
  } catch (error) {
    console.error('Error formatting quiz:', error);
    return null;
  }
}

// List all quizzes in the database
async function listQuizzes() {
  try {
    const db = await sqliteService.getDb();
    
    const quizzes = await db.all(`
      SELECT vq.*, ev.cid, ev.name as video_name
      FROM video_quizzes vq
      JOIN educational_videos ev ON vq.video_id = ev.id
      ORDER BY vq.created_at DESC
    `);
    
    console.log('\n=== AVAILABLE QUIZZES ===');
    
    if (!quizzes || quizzes.length === 0) {
      console.log('No quizzes found in the database');
      return [];
    }
    
    console.log(`Found ${quizzes.length} quizzes:\n`);
    
    quizzes.forEach((quiz, index) => {
      console.log(`${index + 1}. Title: ${quiz.title}`);
      console.log(`   Video: ${quiz.video_name} (CID: ${quiz.cid})`);
      console.log(`   Quiz ID: ${quiz.id}`);
      console.log(`   Created: ${quiz.created_at}`);
      console.log('');
    });
    
    return quizzes;
  } catch (error) {
    console.error('Error listing quizzes:', error);
    return [];
  }
}

// Main function
async function main() {
  try {
    const initialized = await initialize();
    if (!initialized) {
      process.exit(1);
    }
    
    switch (command) {
      case 'generate':
        if (!cid) {
          console.error('Error: CID is required for generate command');
          console.error('Usage: node scripts/generate-quiz.js generate <CID> [--force]');
          process.exit(1);
        }
        await generateQuiz(cid, force);
        break;
        
      case 'format':
        if (!cid) {
          console.error('Error: CID is required for format command');
          console.error('Usage: node scripts/generate-quiz.js format <CID>');
          process.exit(1);
        }
        const videoData = await videoProcessor.getVideoData(cid);
        if (!videoData || !videoData.quiz) {
          console.error('No quiz found for this CID. Generate a quiz first.');
          process.exit(1);
        }
        formatQuiz(videoData.quiz);
        break;
        
      case 'list':
        await listQuizzes();
        break;
        
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Valid commands: generate, format, list');
        process.exit(1);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Unhandled error:', error);
    process.exit(1);
  }
}

// Run the script
main(); 