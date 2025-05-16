#!/usr/bin/env node

/**
 * Video PDF Report Generator Script
 * 
 * This script generates PDF reports for processed videos.
 * 
 * Usage: 
 * - Generate PDF for video by ID: node scripts/generate-video-pdf.js --id <VIDEO_ID>
 * - Generate PDF for video by CID: node scripts/generate-video-pdf.js --cid <VIDEO_CID>
 * - Generate PDFs for all processed videos: node scripts/generate-video-pdf.js --all
 */

const path = require('path');
const fs = require('fs');
const videoProcessor = require('../src/modules/jackal/videoProcessor');
const pdfReportService = require('../src/services/pdfReportService');
const sqliteService = require('../src/db/sqliteService');
const logger = require('../src/utils/logger');

// Parse command line arguments
const args = process.argv.slice(2);
let videoId = null;
let videoCid = null;
let processAll = false;

// Process arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--id' && args[i + 1]) {
    videoId = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--cid' && args[i + 1]) {
    videoCid = args[i + 1];
    i++;
  } else if (args[i] === '--all') {
    processAll = true;
  }
}

// Display usage if no valid arguments
if (!videoId && !videoCid && !processAll) {
  console.log('Usage:');
  console.log('  node scripts/generate-video-pdf.js --id <VIDEO_ID> - Generate PDF for a specific video ID');
  console.log('  node scripts/generate-video-pdf.js --cid <VIDEO_CID> - Generate PDF for a video by CID');
  console.log('  node scripts/generate-video-pdf.js --all - Generate PDFs for all processed videos');
  process.exit(1);
}

// Main function
async function main() {
  try {
    // Initialize services
    await sqliteService.ensureInitialized();
    await videoProcessor.initialize();
    await pdfReportService.initialize();
    
    // Process single video by ID
    if (videoId) {
      const result = await generatePDFForVideo(videoId);
      console.log(result.message);
      return result.success;
    }
    
    // Process single video by CID
    if (videoCid) {
      const video = await sqliteService.db.get(
        'SELECT id FROM educational_videos WHERE cid = ?',
        [videoCid]
      );
      
      if (!video) {
        console.log(`Video not found with CID: ${videoCid}`);
        return false;
      }
      
      const result = await generatePDFForVideo(video.id);
      console.log(result.message);
      return result.success;
    }
    
    // Process all videos
    if (processAll) {
      const videos = await sqliteService.db.all(
        `SELECT id FROM educational_videos 
         WHERE status = 'processed' 
         AND has_frame_analysis = 1 
         AND has_transcription = 1 
         AND has_summary = 1`
      );
      
      if (!videos || videos.length === 0) {
        console.log('No processed videos found to generate PDF reports for.');
        return false;
      }
      
      console.log(`Generating PDF reports for ${videos.length} videos...`);
      
      let successCount = 0;
      let failCount = 0;
      
      for (const video of videos) {
        try {
          const result = await generatePDFForVideo(video.id);
          if (result.success) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          console.error(`Error generating PDF for video ID ${video.id}:`, error.message);
          failCount++;
        }
      }
      
      console.log(`PDF generation complete. Success: ${successCount}, Failed: ${failCount}`);
      return successCount > 0;
    }
    
    return false;
  } catch (error) {
    console.error('Error:', error.message);
    return false;
  } finally {
    // Clean up and exit
    process.exit(0);
  }
}

/**
 * Generate a PDF report for a specific video
 * @param {number} id - Video ID
 * @returns {Promise<Object>} - Result object
 */
async function generatePDFForVideo(id) {
  try {
    // Check if video exists and is processed
    const video = await sqliteService.db.get(
      `SELECT * FROM educational_videos WHERE id = ?`,
      [id]
    );
    
    if (!video) {
      return {
        success: false,
        message: `Video not found with ID: ${id}`
      };
    }
    
    // Check if video has all required data for a PDF report
    if (!video.has_frame_analysis || !video.has_transcription || !video.has_summary) {
      return {
        success: false,
        message: `Video ID ${id} doesn't have all required analysis data. Process the video first.`
      };
    }
    
    // Check if PDF already exists and overwrite if needed
    if (video.pdf_report_path && fs.existsSync(video.pdf_report_path)) {
      console.log(`PDF report already exists for video ID ${id}. Regenerating...`);
    }
    
    // Generate PDF report
    console.log(`Generating PDF report for video ID ${id}...`);
    const result = await videoProcessor._generatePDFReport(id, {
      filename: `video-analysis-${id}-${Date.now()}.pdf`
    });
    
    if (result && result.reportPath) {
      // Update database with new report path
      await sqliteService.db.run(
        'UPDATE educational_videos SET pdf_report_path = ? WHERE id = ?',
        [result.reportPath, id]
      );
      
      return {
        success: true,
        message: `PDF report generated successfully: ${result.reportPath}`,
        path: result.reportPath
      };
    } else {
      return {
        success: false,
        message: `Failed to generate PDF report for video ID ${id}`
      };
    }
  } catch (error) {
    logger.error(`Error generating PDF for video ID ${id}:`, error);
    return {
      success: false,
      message: `Error generating PDF report: ${error.message}`
    };
  }
}

// Run the script
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 