const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const config = require('../../config/config');
const db = require('../../db/sqliteService');
const videoProcessor = require('./videoProcessor');
const jackalPinService = require('./jackalPinService');

class ProcessingQueue {
  constructor() {
    this.processing = false;
    this.processingDir = path.join(process.cwd(), 'processing');
    this.initialized = false;
  }
  
  async initialize() {
    try {
      // Create directories if they don't exist
      if (!fs.existsSync(this.processingDir)) {
        fs.mkdirSync(this.processingDir, { recursive: true });
      }
      
      const downloadDir = path.join(this.processingDir, 'downloads');
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }
      
      // Create queue table in SQLite if it doesn't exist
      await db.run(`
        CREATE TABLE IF NOT EXISTS processing_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cid TEXT NOT NULL,
          name TEXT,
          status TEXT DEFAULT 'pending',
          metadata TEXT,
          failed_attempts INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Create index for status lookups
      await db.run(`
        CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON processing_queue(status)
      `);
      
      // Create index for CID lookups
      await db.run(`
        CREATE INDEX IF NOT EXISTS idx_processing_queue_cid ON processing_queue(cid)
      `);
      
      // Initialize Jackal PIN service
      await jackalPinService.initialize();
      
      // Initialize video processor
      await videoProcessor.initialize();
      
      this.initialized = true;
      logger.info('Processing Queue initialized');
      
      // Start processing existing queue items
      this.processNextInQueue();
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize Processing Queue', { error: error.message });
      throw error;
    }
  }
  
  async addVideo(video) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    try {
      // Check if video is already in queue
      const existing = await db.get(
        'SELECT id FROM processing_queue WHERE cid = ?',
        [video.cid]
      );
      
      if (existing) {
        logger.info(`Video already in queue: ${video.name} (CID: ${video.cid})`);
        return true;
      }
      
      // Add to queue
      await db.run(
        `INSERT INTO processing_queue (cid, name, metadata, status) VALUES (?, ?, ?, 'pending')`,
        [video.cid, video.name, JSON.stringify(video)]
      );
      
      logger.info(`Added video to processing queue: ${video.name} (CID: ${video.cid})`);
      
      // Start processing if not already in progress
      if (!this.processing) {
        this.processNextInQueue();
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to add video to queue: ${video.name}`, { error: error.message });
      throw error;
    }
  }
  
  async processNextInQueue() {
    if (this.processing) {
      return;
    }
    
    this.processing = true;
    
    try {
      // Get next pending item from queue
      const video = await db.get(`
        SELECT id, cid, name, metadata, failed_attempts
        FROM processing_queue
        WHERE status = 'pending'
        ORDER BY failed_attempts ASC, created_at ASC
        LIMIT 1
      `);
      
      if (!video) {
        logger.debug('No pending videos in queue');
        this.processing = false;
        return;
      }
      
      logger.info(`Processing video: ${video.name} (CID: ${video.cid})`);
      
      // Update status to processing
      await db.run(
        `UPDATE processing_queue SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [video.id]
      );
      
      // Parse metadata
      const videoData = JSON.parse(video.metadata || '{}');
      
      // Pin the video to ensure availability
      await jackalPinService.pinFile(video.cid);
      
      // Download the video locally
      const videoPath = await this.downloadVideo(videoData);
      
      // Process the video
      await videoProcessor.processVideo(videoPath, videoData);
      
      // Update status to completed
      await db.run(
        `UPDATE processing_queue SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [video.id]
      );
      
      logger.info(`Completed processing video: ${video.name}`);
      
      // Clean up temporary files
      try {
        if (fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
          logger.debug(`Deleted temporary video file: ${videoPath}`);
        }
      } catch (error) {
        logger.warn(`Failed to delete temporary video file: ${videoPath}`, { error: error.message });
      }
    } catch (error) {
      // Get the current video being processed
      const failedVideo = await db.get(`
        SELECT id, cid, name, failed_attempts
        FROM processing_queue
        WHERE status = 'processing'
        LIMIT 1
      `);
      
      if (failedVideo) {
        const newFailedAttempts = (failedVideo.failed_attempts || 0) + 1;
        
        logger.error('Error processing video from queue', { 
          error: error.message,
          video: failedVideo.name,
          attempt: newFailedAttempts 
        });
        
        // After 3 attempts, mark as failed
        if (newFailedAttempts < 3) {
          // Mark as pending for retry
          await db.run(
            `UPDATE processing_queue 
             SET status = 'pending', 
                 failed_attempts = ?, 
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [newFailedAttempts, failedVideo.id]
          );
        } else {
          // Mark as failed
          await db.run(
            `UPDATE processing_queue 
             SET status = 'failed', 
                 failed_attempts = ?,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [newFailedAttempts, failedVideo.id]
          );
          
          logger.error(`Video processing failed after 3 attempts: ${failedVideo.name}`);
        }
      }
    } finally {
      this.processing = false;
      
      // Check if there are more items to process
      const pendingCount = await db.get(
        'SELECT COUNT(*) as count FROM processing_queue WHERE status = "pending"'
      );
      
      if (pendingCount && pendingCount.count > 0) {
        // Small delay before processing next item
        setTimeout(() => this.processNextInQueue(), 1000);
      }
    }
  }
  
  async downloadVideo(video) {
    try {
      const downloadDir = path.join(this.processingDir, 'downloads');
      const outputPath = path.join(downloadDir, video.name);
      
      // Use jackalPinService to download the file
      const fileData = await jackalPinService.downloadFile(video.cid);
      
      fs.writeFileSync(outputPath, fileData);
      logger.info(`Downloaded video: ${video.name}`);
      
      return outputPath;
    } catch (error) {
      logger.error(`Failed to download video ${video.name}`, { error: error.message });
      throw error;
    }
  }
  
  async getQueueStatus() {
    try {
      const status = await db.all(`
        SELECT status, COUNT(*) as count
        FROM processing_queue
        GROUP BY status
      `);
      
      return status.reduce((result, item) => {
        result[item.status] = item.count;
        return result;
      }, {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0
      });
    } catch (error) {
      logger.error('Failed to get queue status', { error: error.message });
      throw error;
    }
  }
  
  async clearCompletedItems(olderThanDays = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      const result = await db.run(`
        DELETE FROM processing_queue
        WHERE status = 'completed'
        AND updated_at < ?
      `, [cutoffDate.toISOString()]);
      
      logger.info(`Cleared ${result.changes} completed items older than ${olderThanDays} days`);
      return result.changes;
    } catch (error) {
      logger.error('Failed to clear completed items', { error: error.message });
      throw error;
    }
  }
  
  async retryFailedItems() {
    try {
      const result = await db.run(`
        UPDATE processing_queue
        SET status = 'pending', failed_attempts = 0, updated_at = CURRENT_TIMESTAMP
        WHERE status = 'failed'
      `);
      
      logger.info(`Reset ${result.changes} failed items for retry`);
      
      if (result.changes > 0 && !this.processing) {
        this.processNextInQueue();
      }
      
      return result.changes;
    } catch (error) {
      logger.error('Failed to retry failed items', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
const processingQueue = new ProcessingQueue();
module.exports = processingQueue; 