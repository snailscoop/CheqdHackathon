#!/usr/bin/env node

/**
 * Example script for the Cheqd Video Processing System
 * 
 * This script demonstrates how to use the enhanced VideoProcessor class
 * to process videos from different sources, analyze frames, extract audio,
 * generate summaries, and create educational quizzes.
 */

const videoProcessor = require('../src/modules/jackal/videoProcessor');
const path = require('path');
const logger = require('../src/utils/logger');

// Process a video with full configuration
async function processVideoExample(videoSource, options = {}) {
  try {
    // Initialize the video processor if not already initialized
    if (!videoProcessor.initialized) {
      await videoProcessor.initialize();
    }
    
    console.log(`\n=== Processing Video: ${videoSource.id} (${videoSource.type}) ===\n`);
    
    // Set default options
    const processingOptions = {
      steps: options.steps || ['extract_frames', 'analyze_frames', 'extract_audio', 'transcribe_audio', 'generate_summary', 'generate_quiz'],
      frameRate: options.frameRate || 2,
      continueOnError: options.continueOnError !== undefined ? options.continueOnError : true,
      ...options
    };
    
    console.log(`Processing with options: ${JSON.stringify(processingOptions, null, 2)}`);
    
    // Process the video
    const startTime = Date.now();
    const result = await videoProcessor.processVideo(videoSource, processingOptions);
    const processingTime = (Date.now() - startTime) / 1000;
    
    console.log(`\n=== Video Processing Completed in ${processingTime.toFixed(2)}s ===\n`);
    
    // Display results summary
    console.log(`Video ID: ${result.video.id}`);
    console.log(`Title: ${result.video.title}`);
    
    if (result.frameCount) {
      console.log(`Frames Extracted: ${result.frameCount}`);
    }
    
    if (result.summary) {
      console.log(`\nSummary: ${result.summary.overview.substring(0, 150)}...`);
      console.log(`\nKey Points:`);
      const keyPoints = JSON.parse(result.summary.key_points || '[]');
      keyPoints.slice(0, 3).forEach((point, i) => {
        console.log(`  ${i+1}. ${point}`);
      });
    }
    
    // Get quiz if available
    if (result.quizId) {
      const quiz = await videoProcessor.getQuizById(result.quizId);
      
      if (quiz) {
        const questions = JSON.parse(quiz.questions || '[]');
        console.log(`\nQuiz: ${quiz.title}`);
        console.log(`Total Questions: ${questions.length}`);
        
        if (questions.length > 0) {
          console.log(`\nSample Question: ${questions[0].question}`);
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error(`Error processing video: ${error.message}`);
    console.error(error.stack);
    throw error;
  }
}

// Main function to run examples
async function runExamples() {
  try {
    // Example 1: Process a Jackal video
    // Uncomment and add a real CID to test
    /*
    await processVideoExample({
      type: 'jackal',
      id: 'your-jackal-cid-here'
    });
    */
    
    // Example 2: Process a local video file
    await processVideoExample({
      type: 'local',
      id: 'sample-local-video',
      path: path.join(__dirname, '../sample-videos/educational-video.mp4')
    }, {
      title: 'Sample Educational Video',
      description: 'A sample educational video about blockchain technology',
      // Only run certain steps
      steps: ['extract_frames', 'analyze_frames', 'generate_summary', 'generate_quiz']
    });
    
    // Example 3: Jackal video with custom frame rate
    // Uncomment and add a real CID to test
    /*
    await processVideoExample({
      type: 'jackal',
      id: 'your-jackal-cid-here'
    }, {
      frameRate: 1, // 1 frame per second
      // Skip audio processing
      steps: ['extract_frames', 'analyze_frames', 'generate_summary', 'generate_quiz']
    });
    */
    
    console.log('\nAll examples completed successfully');
  } catch (error) {
    console.error(`Error running examples: ${error.message}`);
    process.exit(1);
  }
}

// Run the examples if this script is executed directly
if (require.main === module) {
  runExamples().catch(error => {
    console.error(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  processVideoExample
}; 