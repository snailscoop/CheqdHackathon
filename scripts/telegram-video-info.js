#!/usr/bin/env node

/**
 * Telegram Video Information Command
 * 
 * This script retrieves and displays detailed information about a video by CID.
 * It can be called directly from the Telegram bot.
 * 
 * Usage: node scripts/telegram-video-info.js --cid <CID> --chatId <CHAT_ID> [--showFrames]
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { jackalPinService } = require('../src/modules/jackal/jackalPinService');
const videoProcessor = require('../src/modules/jackal/videoProcessor');
const logger = require('../src/utils/logger');
const db = require('../src/db/sqliteService');
const config = require('../src/config/config');

// Parse command-line arguments
const args = process.argv.slice(2);
const cidIndex = args.indexOf('--cid');
const chatIdIndex = args.indexOf('--chatId');
const showFrames = args.includes('--showFrames');

const cid = cidIndex > -1 ? args[cidIndex + 1] : null;
const chatId = chatIdIndex > -1 ? args[chatIdIndex + 1] : null;

// Validate arguments
if (!cid || !chatId) {
  console.error('Error: CID and chatId are required');
  console.error('Usage: node scripts/telegram-video-info.js --cid <CID> --chatId <CHAT_ID> [--showFrames]');
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
      reply_markup: options.replyMarkup,
      disable_web_page_preview: options.disablePreview || false
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

// Send a photo to Telegram
async function sendTelegramPhoto(chatId, photoPath, caption) {
  try {
    if (!config.telegram || !config.telegram.botToken) {
      console.error('Telegram bot token not configured');
      return false;
    }
    
    if (!fs.existsSync(photoPath)) {
      console.error(`Photo file not found: ${photoPath}`);
      return false;
    }
    
    const botToken = config.telegram.botToken;
    const apiUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;
    
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('photo', fs.createReadStream(photoPath));
    
    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', 'Markdown');
    }
    
    const response = await axios.post(apiUrl, formData, {
      headers: formData.getHeaders()
    });
    
    return response.data;
  } catch (error) {
    console.error('Error sending Telegram photo:', error.message);
    return null;
  }
}

// Format file size in human readable format
function formatFileSize(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Byte';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
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
    
    console.log(`Retrieving video information for CID: ${cid}`);
    
    // Send initial response to user
    await sendTelegramMessage(chatId, `🔍 Retrieving information for video with CID: \`${cid}\`...`);
    
    // Get video data
    let videoData = await videoProcessor.getVideoData(cid);
    
    // If video not found or not processed, process it now
    if (!videoData || !videoData.processed) {
      await sendTelegramMessage(chatId, `Video not fully processed. Processing now...\nThis may take a few minutes.`);
      
      try {
        await videoProcessor.processVideoByCid(cid);
        videoData = await videoProcessor.getVideoData(cid);
        
        if (!videoData) {
          await sendTelegramMessage(chatId, `❌ Failed to process video with CID: \`${cid}\``);
          process.exit(1);
        }
      } catch (error) {
        console.error('Error processing video:', error.message);
        await sendTelegramMessage(chatId, `❌ Error processing video: ${error.message}`);
        process.exit(1);
      }
    }
    
    // Prepare video information message
    const metadataObj = videoData.metadata ? 
      (typeof videoData.metadata === 'string' ? JSON.parse(videoData.metadata) : videoData.metadata) : {};
    
    let videoInfo = `🎬 *Video Information*\n\n`;
    videoInfo += `*Title:* ${videoData.name || 'Untitled'}\n`;
    videoInfo += `*CID:* \`${videoData.cid}\`\n`;
    videoInfo += `*Size:* ${formatFileSize(videoData.size)}\n`;
    videoInfo += `*Type:* ${videoData.type || 'video'}\n`;
    videoInfo += `*Owner:* ${videoData.owner || 'Unknown'}\n`;
    videoInfo += `*Processed:* ${videoData.processed ? '✅' : '❌'}\n`;
    
    // Add IPFS link if applicable
    if (videoData.cid) {
      const ipfsLink = `https://ipfs.io/ipfs/${videoData.cid}`;
      videoInfo += `*IPFS Link:* [View on IPFS](${ipfsLink})\n`;
    }
    
    // Send basic video info
    await sendTelegramMessage(chatId, videoInfo, { disablePreview: true });
    
    // Send summary if available
    if (videoData.summary) {
      let summaryText = `📝 *Video Summary*\n\n`;
      summaryText += `*Title:* ${videoData.summary.title || 'Untitled'}\n\n`;
      summaryText += `${videoData.summary.overview || 'No overview available.'}\n\n`;
      
      // Add key points if available
      if (videoData.summary.key_points) {
        try {
          const keyPoints = JSON.parse(videoData.summary.key_points);
          if (keyPoints.length > 0) {
            summaryText += `*Key Points:*\n`;
            keyPoints.forEach((point, index) => {
              summaryText += `${index + 1}. ${point}\n`;
            });
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
      
      await sendTelegramMessage(chatId, summaryText);
    }
    
    // Send transcript excerpt if available
    if (videoData.transcript && videoData.transcript.length > 0) {
      // Get first 5-10 segments or fewer if less are available
      const segmentCount = Math.min(videoData.transcript.length, 5);
      const transcriptSegments = videoData.transcript.slice(0, segmentCount);
      
      let transcriptText = `🎙️ *Transcript Excerpt*\n\n`;
      
      transcriptSegments.forEach((segment) => {
        const minutes = Math.floor(segment.start_time / 60);
        const seconds = Math.floor(segment.start_time % 60).toString().padStart(2, '0');
        transcriptText += `[${minutes}:${seconds}] ${segment.text}\n\n`;
      });
      
      transcriptText += `_... and ${videoData.transcript.length - segmentCount} more segments._`;
      
      await sendTelegramMessage(chatId, transcriptText);
    }
    
    // Send frame analysis information
    if (videoData.frame_analysis) {
      let frameText = `🖼️ *Frame Analysis*\n\n`;
      frameText += `Total frames: ${videoData.frame_analysis.total}\n`;
      frameText += `Analyzed frames: ${videoData.frame_analysis.completed}\n`;
      
      await sendTelegramMessage(chatId, frameText);
      
      // Send sample frames if requested
      if (showFrames && videoData.frame_analysis.total > 0) {
        // Get a few sample frames
        const framesSql = `
          SELECT * FROM video_frames 
          WHERE video_id = ? AND analysis_status = 'completed'
          ORDER BY frame_index LIMIT 3
        `;
        
        const dbConn = await db.getDb();
        const frames = await dbConn.all(framesSql, [videoData.id]);
        
        if (frames && frames.length > 0) {
          await sendTelegramMessage(chatId, `Sending ${frames.length} sample frames...`);
          
          for (const frame of frames) {
            try {
              // Check if frame file exists
              if (frame.frame_path && fs.existsSync(frame.frame_path)) {
                // Extract info from analysis
                let analysisInfo = '';
                try {
                  const analysis = JSON.parse(frame.analysis);
                  analysisInfo = analysis.description || '';
                } catch (e) {
                  analysisInfo = 'Frame analysis not available';
                }
                
                // Send frame
                await sendTelegramPhoto(chatId, frame.frame_path, `Frame ${frame.frame_index}: ${analysisInfo}`);
              } else if (frame.alternative_path && fs.existsSync(frame.alternative_path)) {
                await sendTelegramPhoto(chatId, frame.alternative_path, `Frame ${frame.frame_index}`);
              }
            } catch (error) {
              console.error(`Error sending frame: ${error.message}`);
            }
          }
        }
      }
    }
    
    // Send quiz information if available
    if (videoData.quiz) {
      let quizText = `🧠 *Quiz Available*\n\n`;
      quizText += `Title: ${videoData.quiz.title}\n`;
      quizText += `Questions: ${videoData.quiz.question_count}\n\n`;
      quizText += `To take this quiz, use the command:\n\`/quiz ${videoData.cid}\``;
      
      // Create button to start the quiz
      const quizButton = {
        inline_keyboard: [
          [
            {
              text: "Start Quiz",
              callback_data: `start_quiz:${videoData.cid}`
            }
          ]
        ]
      };
      
      await sendTelegramMessage(chatId, quizText, { replyMarkup: quizButton });
    } else {
      await sendTelegramMessage(chatId, `No quiz available for this video yet. Generate one with:\n\`/generate_quiz ${videoData.cid}\``);
    }
    
    console.log('Video information sent successfully');
    process.exit(0);
  } catch (error) {
    console.error('Unhandled error:', error);
    try {
      await sendTelegramMessage(chatId, `❌ Error retrieving video information: ${error.message}`);
    } catch (e) {
      // Ignore
    }
    process.exit(1);
  }
}

// Run the script
main(); 