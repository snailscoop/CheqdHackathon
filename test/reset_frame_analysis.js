const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const logger = require('../src/utils/logger');
const sqliteService = require('../src/db/sqliteService');
const videoProcessor = require('../src/modules/jackal/videoProcessor');
const grokService = require('../src/services/grokService');

async function main() {
  try {
    // Initialize services
    await sqliteService.initialize();
    await videoProcessor.initialize();
    
    // Get all frames with analysis errors
    const errorFrames = await sqliteService.db.all(
      `SELECT * FROM video_frames WHERE analysis_status = 'error' LIMIT 20`
    );
    
    if (!errorFrames || errorFrames.length === 0) {
      console.log('No error frames found.');
      return;
    }
    
    console.log(`Found ${errorFrames.length} frames with errors. Attempting to reset and retry...`);
    
    // Get the video ID from the first frame
    const videoId = errorFrames[0]?.video_id;
    if (!videoId) {
      console.log('Could not determine video ID.');
      return;
    }
    
    // Reset status back to pending for all error frames
    console.log(`Resetting status for all error frames for video ID: ${videoId}`);
    await sqliteService.db.run(
      `UPDATE video_frames SET analysis_status = 'pending' WHERE video_id = ? AND analysis_status = 'error'`,
      [videoId]
    );
    
    // Verify the Grok API is working by doing a simple test completion
    console.log('Testing Grok API connection...');
    try {
      const testResult = await grokService.processCommand('Hello, just testing the connection', {
        max_tokens: 10
      });
      console.log('Grok API test successful');
    } catch (apiError) {
      console.error('Grok API test failed:', apiError.message);
      console.log('To fix this, ensure your API key is properly set in the environment.');
      return;
    }
    
    // Try a manual analysis of one frame
    if (errorFrames.length > 0) {
      const testFrame = errorFrames[0];
      if (testFrame.frame_path && fs.existsSync(testFrame.frame_path)) {
        console.log(`\nTesting direct frame analysis on: ${path.basename(testFrame.frame_path)}`);
        try {
          const analysis = await grokService.analyzeImage(testFrame.frame_path, {
            type: 'educational',
            context: `This is frame ${testFrame.frame_index} from an educational video`
          });
          
          console.log('Manual analysis successful. Sample description:');
          console.log(analysis.description.substring(0, 100) + '...');
          
          // Update this frame in the database
          await sqliteService.db.run(
            `UPDATE video_frames SET analysis = ?, analysis_status = 'completed' WHERE id = ?`,
            [JSON.stringify(analysis), testFrame.id]
          );
          console.log(`Updated frame ${testFrame.id} with successful analysis.`);
        } catch (analysisError) {
          console.error('Manual frame analysis failed:', analysisError.message);
        }
      }
    }
    
    // Now run the automatic analysis for the video
    console.log(`\nAttempting to reanalyze video ID: ${videoId}`);
    const result = await videoProcessor._analyzeVideoFrames(videoId);
    console.log(`Reanalysis result: ${result ? 'Success' : 'Failed'}`);
    
    // Check status after processing
    const remainingFrames = await sqliteService.db.get(
      `SELECT COUNT(*) as count FROM video_frames WHERE video_id = ? AND analysis_status = 'pending'`,
      [videoId]
    );
    
    const completedFrames = await sqliteService.db.get(
      `SELECT COUNT(*) as count FROM video_frames WHERE video_id = ? AND analysis_status = 'completed'`,
      [videoId]
    );
    
    const erroredFrames = await sqliteService.db.get(
      `SELECT COUNT(*) as count FROM video_frames WHERE video_id = ? AND analysis_status = 'error'`,
      [videoId]
    );
    
    console.log('\nFrame analysis summary:');
    console.log(`- Pending: ${remainingFrames?.count || 0}`);
    console.log(`- Completed: ${completedFrames?.count || 0}`);
    console.log(`- Error: ${erroredFrames?.count || 0}`);
    
    console.log('\nCompleted frame reset and retry process.');
  } catch (error) {
    console.error('Error in test script:', error.message);
  } finally {
    process.exit(0);
  }
}

// Run the main function
main(); 