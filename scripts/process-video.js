#!/usr/bin/env node

/**
 * Video Processing Script
 * 
 * This script processes a video from Jackal by CID and stores the results in the database.
 * It now includes enhanced automation for quizzes and Telegram integration.
 * 
 * Usage: 
 * - Basic:    node scripts/process-video.js <CID> [--force]
 * - With quiz: node scripts/process-video.js <CID> --quiz
 * - Telegram: node scripts/process-video.js <CID> --telegram --chatId <CHAT_ID>
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { jackalPinService } = require('../src/modules/jackal/jackalPinService');
const videoProcessor = require('../src/modules/jackal/videoProcessor');
const logger = require('../src/utils/logger');
const db = require('../src/db/sqliteService');

// Parse command line arguments
const args = process.argv.slice(2);
const cid = args[0];
const force = args.includes('--force');
const generateQuiz = args.includes('--quiz');
const useTelegram = args.includes('--telegram');
const chatIdIndex = args.indexOf('--chatId');
const chatId = chatIdIndex > -1 ? args[chatIdIndex + 1] : null;

// Print usage information if needed
if (!cid) {
  console.error('Error: CID is required');
  console.error('Usage:');
  console.error('  Basic:     node scripts/process-video.js <CID> [--force]');
  console.error('  With quiz: node scripts/process-video.js <CID> --quiz');
  console.error('  Telegram:  node scripts/process-video.js <CID> --telegram --chatId <CHAT_ID>');
  process.exit(1);
}

async function processVideo(cid, options = {}) {
  console.log(`Starting processing for video with CID: ${cid}`);
  
  try {
    // Initialize required services
    await db.ensureInitialized();
    await jackalPinService.ensureInitialized();
    await videoProcessor.initialize();
    
    // Let the videoProcessor handle everything
    console.log(`Using videoProcessor to directly process CID: ${cid}`);
    const result = await videoProcessor.processVideoByCid(cid, {
      force: options.force,
      name: `Script-${cid.substring(0, 8)}`,
      type: 'educational',
      cleanup: false // Keep downloaded files
    });
    
    console.log('\nVideo processing completed successfully!');
    console.log(`Video ID: ${result.id}`);
    console.log(`Name: ${result.name}`);
    console.log(`Status: ${result.processed ? 'Processed' : 'Pending'}`);
    
    // Show frame statistics
    if (result.frame_analysis) {
      console.log(`Frames: ${result.frame_analysis.total} total, ${result.frame_analysis.completed} analyzed`);
    }
    
    // Show transcript statistics
    if (result.transcript && result.transcript.length) {
      console.log(`Transcript: ${result.transcript.length} segments`);
    }
    
    // Show summary if available
    if (result.summary) {
      console.log('\nVideo Summary:');
      console.log(`Title: ${result.summary.title}`);
      console.log(`Overview: ${result.summary.overview.substring(0, 150)}...`);
    }
    
    // Handle quiz generation if requested or if quiz already exists
    let quizData = result.quiz;
    
    if (!quizData && options.generateQuiz) {
      console.log('\nGenerating quiz for video...');
      const quizId = await videoProcessor._generateVideoQuiz(result.id);
      
      if (quizId) {
        console.log(`Quiz generated successfully with ID: ${quizId}`);
        
        // Reload video data to get the quiz
        const updatedVideo = await videoProcessor.getVideoData(cid);
        quizData = updatedVideo.quiz;
      } else {
        console.log('Failed to generate quiz');
      }
    }
    
    // Display quiz information if available
    if (quizData) {
      try {
        console.log('\nQuiz:');
        console.log(`Title: ${quizData.title}`);
        console.log(`Questions: ${quizData.question_count}`);
        
        // Parse and show questions/answers
        const questions = JSON.parse(quizData.questions);
        console.log(`\nQuiz contains ${questions.length} questions`);
        
        // Show first question as example
        if (questions.length > 0) {
          console.log('\nSample Question:');
          console.log(`Q: ${questions[0].question}`);
          
          if (questions[0].options) {
            console.log('Options:');
            questions[0].options.forEach((opt, i) => {
              const marker = opt === questions[0].answer ? '✓' : ' ';
              console.log(`  ${marker} ${i+1}. ${opt}`);
            });
          } else {
            console.log(`A: ${questions[0].answer}`);
          }
        }
        
        console.log('\nFor the full quiz and options:');
        console.log(`Run: node scripts/generate-quiz.js format ${cid}`);
      } catch (error) {
        console.error('Error parsing quiz data:', error.message);
      }
    }
    
    // Handle Telegram integration if requested
    if (options.useTelegram) {
      if (!quizData && !options.generateQuiz) {
        console.log('\nNo quiz available for Telegram. Generate one first with --quiz option');
      } else if (quizData) {
        console.log('\nPreparing Telegram integration...');
        
        try {
          // Call the telegram integration script
          const telegramCmd = `node scripts/telegram-quiz-integration.js ${cid}${options.chatId ? ` --chatId ${options.chatId}` : ''}`;
          console.log(`Running: ${telegramCmd}`);
          
          console.log('\n=== TELEGRAM INTEGRATION OUTPUT ===');
          execSync(telegramCmd, { stdio: 'inherit' });
          console.log('=== END TELEGRAM INTEGRATION ===\n');
          
          console.log('Telegram integration complete!');
        } catch (error) {
          console.error('Error running Telegram integration:', error.message);
        }
      }
    }
    
    console.log('\nProcessing completed. To use this video in educational contexts:');
    console.log(`- View data:   node scripts/process-video.js ${cid}`);
    console.log(`- Generate quiz: node scripts/generate-quiz.js generate ${cid}`);
    console.log(`- Telegram bot: node scripts/telegram-quiz-integration.js ${cid} --chatId <CHAT_ID>`);
    
    return result;
  } catch (error) {
    console.error('Error processing video:', error);
    process.exit(1);
  }
}

// Run the processing
processVideo(cid, { 
  force, 
  generateQuiz,
  useTelegram,
  chatId
})
  .then(() => {
    console.log('Processing script completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  }); 