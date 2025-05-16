#!/usr/bin/env node

/**
 * Reprocess Video Quiz and Generate PDF Report
 * 
 * This script reprocesses an existing video by analyzing the frames and audio,
 * generating a new quiz, and creating a PDF report.
 * 
 * Usage: 
 * - By ID:  node scripts/reprocess-quiz-and-pdf.js --id <VIDEO_ID>
 * - By CID: node scripts/reprocess-quiz-and-pdf.js --cid <VIDEO_CID>
 */

const videoProcessor = require('../src/modules/jackal/videoProcessor');
const sqliteService = require('../src/db/sqliteService');
const logger = require('../src/utils/logger');
const path = require('path');
const fs = require('fs');

// Parse command line arguments
const args = process.argv.slice(2);
const idIndex = args.indexOf('--id');
const cidIndex = args.indexOf('--cid');
const generateQuiz = !args.includes('--no-quiz');
const generatePdf = !args.includes('--no-pdf');

let videoId = null;
let videoCid = null;

if (idIndex !== -1) {
  videoId = args[idIndex + 1];
}

if (cidIndex !== -1) {
  videoCid = args[cidIndex + 1];
}

if (!videoId && !videoCid) {
  console.error('Error: Either --id or --cid must be provided');
  console.error('Usage:');
  console.error('  node scripts/reprocess-quiz-and-pdf.js --id <VIDEO_ID>');
  console.error('  node scripts/reprocess-quiz-and-pdf.js --cid <VIDEO_CID>');
  process.exit(1);
}

async function reprocessVideo() {
  try {
    console.log('Initializing services...');
    await sqliteService.ensureInitialized();
    await videoProcessor.initialize();
    
    // Identify the video
    let video;
    
    if (videoId) {
      video = await sqliteService.db.get(
        'SELECT * FROM educational_videos WHERE id = ?',
        [videoId]
      );
    } else if (videoCid) {
      video = await sqliteService.db.get(
        'SELECT * FROM educational_videos WHERE cid = ?',
        [videoCid]
      );
    }
    
    if (!video) {
      console.error('Error: Video not found');
      process.exit(1);
    }
    
    console.log(`Processing video: ${video.name} (ID: ${video.id}, CID: ${video.cid})`);
    
    if (generateQuiz) {
      console.log('\nDeleting existing quiz for this video...');
      await sqliteService.db.run(
        'DELETE FROM video_quizzes WHERE video_id = ?',
        [video.id]
      );
      
      console.log('Generating new quiz...');
      const quizId = await videoProcessor._generateVideoQuiz(video.id);
      
      if (quizId) {
        console.log(`Quiz generated successfully with ID: ${quizId}`);
        
        // Get the quiz data
        const quizData = await sqliteService.db.get(
          'SELECT * FROM video_quizzes WHERE id = ?',
          [quizId]
        );
        
        if (quizData) {
          console.log(`\nNew Quiz Title: ${quizData.title}`);
          console.log(`Description: ${quizData.description.substring(0, 100)}...`);
          
          try {
            const questions = JSON.parse(quizData.questions);
            console.log(`Total questions: ${questions.length}`);
            
            // Show first question as example
            if (questions.length > 0) {
              console.log('\nSample Question: ');
              console.log(`Q: ${questions[0].question.substring(0, 100)}...`);
            }
          } catch (error) {
            console.error('Error parsing quiz questions:', error.message);
          }
        }
      } else {
        console.error('Failed to generate quiz');
      }
    }
    
    if (generatePdf) {
      console.log('\nGenerating PDF report...');
      const pdfResult = await videoProcessor._generatePDFReport(video.id);
      
      if (pdfResult && pdfResult.reportPath) {
        console.log(`PDF report generated successfully at: ${pdfResult.reportPath}`);
        
        // Update the video record with the PDF path
        await sqliteService.db.run(
          'UPDATE educational_videos SET pdf_report_path = ? WHERE id = ?',
          [pdfResult.reportPath, video.id]
        );
        
        console.log('Video record updated with PDF report path');
      } else {
        console.error('Failed to generate PDF report');
      }
    }
    
    console.log('\nProcessing completed successfully!');
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the reprocessing
reprocessVideo()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  }); 