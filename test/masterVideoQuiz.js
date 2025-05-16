/**
 * Master Video Quiz Test
 * 
 * This test script creates a streamlined version of the video processing pipeline
 * that extracts 10 equally-spaced frames from a video rather than using a constant 
 * frame rate, and processes the complete audio.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const sqliteService = require('../src/db/sqliteService');
const videoProcessor = require('../src/modules/jackal/videoProcessor');
const jackalService = require('../src/modules/jackal/jackalPinService');
const grokService = require('../src/services/grokService');

/**
 * Run a master video quiz test using the core video processor
 * but configured for exactly 10 frames
 */
async function runMasterVideoTest(cid) {
  try {
    logger.info(`Starting master video quiz test for CID: ${cid}`);
    
    // Ensure DB and services are initialized
    await sqliteService.ensureInitialized();
    await grokService.initialize();
    await videoProcessor.initialize();
    await jackalService.ensureInitialized();
    
    // Store original frame rate
    const originalFrameRate = videoProcessor.frameRate;
    
    // Configure video processor to use our desired settings
    // We'll dynamically adjust the frame rate based on video duration to get exactly 10 frames
    videoProcessor.frameCount = 10; // Add a property to control number of frames
    
    // Create a patched version of the _extractFrames method that uses frameCount instead of frameRate
    const originalExtractFrames = videoProcessor._extractFrames;
    videoProcessor._extractFrames = async function(videoPath, framesDir, videoId) {
      try {
        logger.info(`Extracting exactly ${this.frameCount} equally-spaced frames from video: ${path.basename(videoPath)}`);
        
        // First, get video duration
        const { execSync } = require('child_process');
        const durationCmd = `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`;
        const durationOutput = execSync(durationCmd).toString().trim();
        const duration = parseFloat(durationOutput);
        
        if (isNaN(duration) || duration <= 0) {
          throw new Error('Could not determine video duration');
        }
        
        logger.info(`Video duration: ${duration} seconds`);
        
        // Calculate frame intervals to get exactly frameCount frames
        // Avoid going to the very end of the video which can sometimes cause issues
        const safeEndTime = Math.max(0, duration - 0.5); // 0.5 second before the end
        const interval = safeEndTime / (this.frameCount - 1);
        
        // Extract frames at calculated times
        let frameCount = 0;
        for (let i = 0; i < this.frameCount; i++) {
          const time = i * interval;
          
          // Make sure we don't go beyond video duration
          if (time >= duration) {
            logger.warn(`Skipping frame at ${time}s which is beyond video duration of ${duration}s`);
            continue;
          }
          
          // Format timestamp as minutes and seconds
          const minutes = Math.floor(time / 60).toString().padStart(2, '0');
          const seconds = Math.floor(time % 60).toString().padStart(2, '0');
          const timestamp = `${minutes}m${seconds}s`;
          
          const outputFrame = path.join(framesDir, `frame-${timestamp}.jpg`);
          
          // Create a backup numeric format filename for compatibility
          const numericFormat = frameCount.toString().padStart(4, '0');
          const altOutputFrame = path.join(framesDir, `frame-${numericFormat}.jpg`);
          
          // Use -y flag to force overwrite, -update 1 to fix pattern issues, and -strict unofficial for YUV range
          const command = `ffmpeg -y -ss ${time} -i "${videoPath}" -frames:v 1 -q:v 2 -update 1 -strict unofficial "${outputFrame}"`;
          execSync(command);
          
          // Also create a copy with the numeric format for compatibility
          try {
            if (fs.existsSync(outputFrame)) {
              // Create a hard copy of the file with numeric format 
              fs.copyFileSync(outputFrame, altOutputFrame);
              logger.debug(`Created alternate frame file: ${path.basename(altOutputFrame)}`);
            }
          } catch (copyErr) {
            logger.warn(`Could not create alternate frame file: ${path.basename(altOutputFrame)}`, { error: copyErr.message });
          }
          
          // Store frame information in database
          await this.db.run(
            `INSERT INTO video_frames (video_id, frame_path, alternative_path, timestamp, frame_index, analysis_status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [videoId, outputFrame, altOutputFrame, time, frameCount]
          );
          
          frameCount++;
        }
        
        logger.info(`Extracted ${frameCount} frames from video`);
        return frameCount;
      } catch (error) {
        logger.error(`Error extracting frames: ${path.basename(videoPath)}`, { error: error.message });
        throw error;
      }
    };
    
    // Process video with master quiz settings
    // Use processVideoByCid which handles downloading and processing
    const result = await videoProcessor.processVideoByCid(cid, {
      name: `Master-Quiz-${cid.substring(0, 8)}`,
      force: true  // Force reprocessing even if already processed
    });
    
    // Test quiz interaction - simulate a user taking the quiz
    if (result.quiz && result.quiz.questions && result.quiz.questions.length > 0) {
      logger.info(`Simulating quiz interaction for ${result.quiz.questions.length} questions`);
      
      const quizResults = [];
      
      // For each question, generate a simulated user response and evaluate it
      for (let i = 0; i < result.quiz.questions.length; i++) {
        const question = result.quiz.questions[i];
        
        // Have Grok generate a simulated user response to the question
        const simulatedResponseData = await grokService.chatCompletion([
          { 
            role: 'system', 
            content: 'You are simulating a human learner answering educational quiz questions. Provide a thoughtful, realistic answer that demonstrates understanding but may include minor misconceptions or incompleteness as a real student might. Aim for 2-3 sentences.'
          },
          { 
            role: 'user',
            content: `Provide a realistic student answer to this educational quiz question about a video:\n\n${question.question}`
          }
        ]);
        
        const simulatedResponse = simulatedResponseData.choices[0].message.content;
        logger.info(`Question ${i+1}: ${question.question.substring(0, 50)}...`);
        logger.info(`Simulated response: ${simulatedResponse.substring(0, 50)}...`);
        
        // Evaluate the simulated user response
        const evaluation = await grokService.evaluateQuizResponse({
          question: question,
          userResponse: simulatedResponse
        });
        
        // Record the result
        quizResults.push({
          questionId: question.id,
          question: question.question,
          simulatedResponse,
          evaluation
        });
        
        logger.info(`Evaluation score: ${evaluation.score}, Correct: ${evaluation.correct}`);
      }
      
      // Calculate overall quiz performance
      const averageScore = quizResults.reduce((sum, item) => sum + item.evaluation.score, 0) / quizResults.length;
      const correctCount = quizResults.filter(item => item.evaluation.correct).length;
      
      logger.info(`Quiz simulation complete. Average score: ${averageScore.toFixed(1)}, Correct answers: ${correctCount}/${quizResults.length}`);
      
      // Store quiz results in result object
      result.quizSimulation = {
        averageScore,
        correctCount,
        totalQuestions: quizResults.length,
        questionResults: quizResults
      };
    }
    
    // Restore original frame rate and method
    videoProcessor.frameRate = originalFrameRate;
    videoProcessor._extractFrames = originalExtractFrames;
    delete videoProcessor.frameCount;
    
    logger.info(`Completed master video quiz test for CID: ${cid}`);
    
    // Return processed video data
    return {
      success: true,
      videoId: result.video.id,
      quizId: result.quiz?.id,
      quizTitle: result.quiz?.title || 'Master Video Quiz',
      quizQuestions: result.quiz?.questions?.length || 0,
      quizSimulation: result.quizSimulation || null
    };
  } catch (error) {
    logger.error(`Error in master video quiz test: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Simple CLI interface for testing
async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      console.log('Usage: node masterVideoQuiz.js <video-cid>');
      process.exit(1);
    }
    
    const cid = args[0];
    const result = await runMasterVideoTest(cid);
    
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

// Run test if this script is executed directly
if (require.main === module) {
  main();
} else {
  // Export for use as a module
  module.exports = { runMasterVideoTest };
} 