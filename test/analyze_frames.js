const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const logger = require('../src/utils/logger');
const sqliteService = require('../src/db/sqliteService');
const videoProcessor = require('../src/modules/jackal/videoProcessor');

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
    
    console.log(`Found ${errorFrames.length} frames with errors. Attempting to fix...`);
    
    // Try to fix each frame
    for (const frame of errorFrames) {
      console.log(`\nChecking frame ${frame.id} - ${path.basename(frame.frame_path || 'unknown')}`);
      
      // Check primary path
      if (frame.frame_path && fs.existsSync(frame.frame_path)) {
        console.log(`Primary path exists: ${frame.frame_path}`);
      } else {
        console.log(`Primary path does not exist: ${frame.frame_path || 'not set'}`);
        
        // Check alternative path
        if (frame.alternative_path && fs.existsSync(frame.alternative_path)) {
          console.log(`Alternative path exists: ${frame.alternative_path}`);
          
          // Update the frame to use alternative path as primary
          await sqliteService.db.run(
            `UPDATE video_frames SET frame_path = ?, analysis_status = 'pending' WHERE id = ?`,
            [frame.alternative_path, frame.id]
          );
          console.log(`Updated frame to use alternative path and reset status to pending.`);
        } else {
          console.log(`Alternative path does not exist: ${frame.alternative_path || 'not set'}`);
          
          // Try to reconstruct possible paths
          const videoDir = frame.frame_path ? path.dirname(frame.frame_path) : null;
          if (videoDir && fs.existsSync(videoDir)) {
            console.log(`Video directory exists: ${videoDir}`);
            
            // List all frames in the directory
            const files = fs.readdirSync(videoDir).filter(f => f.startsWith('frame-'));
            console.log(`Found ${files.length} frame files in directory.`);
            
            if (files.length > 0) {
              // Use the first frame file as a replacement
              const newPath = path.join(videoDir, files[0]);
              console.log(`Using alternative frame: ${files[0]}`);
              
              // Update the frame
              await sqliteService.db.run(
                `UPDATE video_frames SET frame_path = ?, alternative_path = ?, analysis_status = 'pending' WHERE id = ?`,
                [newPath, frame.frame_path, frame.id]
              );
              console.log(`Updated frame to use new path and reset status to pending.`);
            }
          } else {
            console.log(`Video directory does not exist or could not be determined.`);
          }
        }
      }
    }
    
    // Reanalyze a specific video
    const videoId = errorFrames[0]?.video_id;
    if (videoId) {
      console.log(`\nAttempting to reanalyze video ID: ${videoId}`);
      const result = await videoProcessor._analyzeVideoFrames(videoId);
      console.log(`Reanalysis result: ${result ? 'Success' : 'Failed'}`);
    }
    
    console.log('\nCompleted frame path fixing process.');
  } catch (error) {
    console.error('Error in test script:', error.message);
  } finally {
    process.exit(0);
  }
}

// Run the main function
main(); 