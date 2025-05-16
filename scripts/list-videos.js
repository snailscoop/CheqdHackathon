#!/usr/bin/env node

/**
 * List Educational Videos
 * 
 * This script lists all educational videos in the database with their CIDs and stats.
 * 
 * Usage: node scripts/list-videos.js [--all] [--topic <TOPIC>]
 */

const db = require('../src/db/sqliteService');
const logger = require('../src/utils/logger');

// Parse command-line arguments
const args = process.argv.slice(2);
const showAll = args.includes('--all');
const topicIndex = args.indexOf('--topic');
const topic = topicIndex > -1 ? args[topicIndex + 1] : null;

// Format file size in human readable format
function formatFileSize(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Byte';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}

async function listVideos() {
  try {
    // Initialize database
    await db.ensureInitialized();
    
    // Prepare SQL query based on arguments
    let query = `
      SELECT ev.*, 
             vs.title as summary_title,
             COUNT(DISTINCT vf.id) as frame_count,
             COUNT(DISTINCT vt.id) as transcript_count,
             COUNT(DISTINCT vq.id) as quiz_count,
             GROUP_CONCAT(DISTINCT et.topic_name) as topics
      FROM educational_videos ev
      LEFT JOIN video_summaries vs ON ev.id = vs.video_id
      LEFT JOIN video_frames vf ON ev.id = vf.video_id
      LEFT JOIN video_transcriptions vt ON ev.id = vt.video_id
      LEFT JOIN video_quizzes vq ON ev.id = vq.video_id
      LEFT JOIN educational_topics et ON ev.cid = et.video_cid
    `;
    
    const params = [];
    
    // Add WHERE clause if needed
    if (!showAll) {
      query += ` WHERE ev.processed = 1`;
    }
    
    // Add topic filter if specified
    if (topic) {
      if (!showAll) {
        query += ` AND`;
      } else {
        query += ` WHERE`;
      }
      query += ` (et.topic_name LIKE ? OR et.topic_keywords LIKE ?)`;
      params.push(`%${topic}%`, `%${topic}%`);
    }
    
    // Add GROUP BY and ORDER BY
    query += `
      GROUP BY ev.id
      ORDER BY ev.processed_at DESC
    `;
    
    // Execute query
    const videos = await db.all(query, params);
    
    if (!videos || videos.length === 0) {
      console.log('No educational videos found in the database');
      return;
    }
    
    console.log(`\n==== EDUCATIONAL VIDEOS (${videos.length}) ====\n`);
    
    // Display each video
    videos.forEach((video, index) => {
      console.log(`${index + 1}. ${video.name || 'Untitled'} ${video.processed ? '✅' : '⏳'}`);
      console.log(`   CID: ${video.cid}`);
      console.log(`   Size: ${formatFileSize(video.size)}`);
      console.log(`   Type: ${video.type || 'video'}`);
      console.log(`   Owner: ${video.owner || 'Unknown'}`);
      
      if (video.summary_title) {
        console.log(`   Summary: ${video.summary_title}`);
      }
      
      if (video.frame_count) {
        console.log(`   Frames: ${video.frame_count}`);
      }
      
      if (video.transcript_count) {
        console.log(`   Transcript Segments: ${video.transcript_count}`);
      }
      
      if (video.quiz_count && video.quiz_count > 0) {
        console.log(`   Quiz: Available ✓`);
      } else {
        console.log(`   Quiz: Not available ✗`);
      }
      
      if (video.topics) {
        console.log(`   Topics: ${video.topics}`);
      }
      
      console.log(`   Processed: ${video.processed_at || 'Not processed'}`);
      console.log('');
    });
    
    // Show info about accessing videos
    console.log('To get detailed information about a video:');
    console.log('- Telegram: /video <CID>');
    console.log('- Command Line: node scripts/telegram-video-info.js --cid <CID> --chatId <CHAT_ID>');
    console.log('');
    
    return videos;
  } catch (error) {
    console.error('Error listing videos:', error);
    return null;
  }
}

// Run the script
listVideos()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  }); 