const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const db = require('../../db/sqliteService');
const processingQueue = require('./processingQueue');
const jackalPinServiceModule = require('./jackalPinService');
const jackalPinService = jackalPinServiceModule.jackalPinService;
const videoProcessor = require('./videoProcessor');
const config = require('../../config/config');

/**
 * Monitors Jackal Protocol PIN service for new videos and adds them to
 * the processing queue.
 */
class JackalMonitor {
  /**
   * Creates a new JackalMonitor instance
   */
  constructor() {
    this.checkInProgress = false;
    this.checkForNewVideosPromise = null;
    this.monitorInterval = null;
    this.processingDir = path.join(process.cwd(), 'processing');
    this.initialized = false;
    
    // Common video MIME types
    this.videoMimeTypes = [
      'video/mp4', 
      'video/webm', 
      'video/quicktime', 
      'video/avi', 
      'video/x-msvideo',
      'video/x-matroska',
      'video/x-ms-wmv',
      'video/x-flv',
      'video/mpeg'
    ];
    
    // Common video file extensions
    this.videoExtensions = /\.(mp4|webm|mov|avi|mkv|mpg|mpeg|m4v|wmv|flv)$/i;
  }
  
  /**
   * Checks if a file is a video based on MIME type or extension
   * @param {Object} file - File object with name and mimeType properties
   * @returns {boolean} True if the file is a video
   */
  isVideoFile(file) {
    // Check by MIME type if available
    if (file.mimeType && this.videoMimeTypes.includes(file.mimeType.toLowerCase())) {
      return true;
    }
    
    // Check by file extension
    return this.videoExtensions.test(file.name);
  }
  
  /**
   * Initializes the JackalMonitor
   * @returns {Promise<boolean>} Initialization status
   */
  async initialize() {
    try {
      // Create processing directory if it doesn't exist
      if (!fsSync.existsSync(this.processingDir)) {
        await fs.mkdir(this.processingDir, { recursive: true });
      }
      
      // Create processed videos table in SQLite if it doesn't exist
      await db.run(`
        CREATE TABLE IF NOT EXISTS processed_videos (
          cid TEXT PRIMARY KEY,
          name TEXT,
          processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          metadata TEXT
        )
      `);
      
      // Initialize required services
      await jackalPinService.ensureInitialized();
      await videoProcessor.initialize();
      await processingQueue.initialize();
      
      this.initialized = true;
      logger.info('Jackal Monitor initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Jackal Monitor', { error: error.message, stack: error.stack });
      throw error;
    }
  }
  
  /**
   * Starts monitoring for new videos at the specified interval
   * @param {number} [intervalMinutes=1440] - Monitoring interval in minutes
   * @returns {Promise<void>}
   */
  async startMonitoring(intervalMinutes = 1440) { // Default: once a day
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Clear any existing monitor
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    
    // Run immediately once, then schedule
    await this.checkForNewVideos();
    
    // Schedule regular checks
    this.monitorInterval = setInterval(
      () => {
        // Prevent overlapping checks
        if (!this.checkInProgress) {
          this.checkForNewVideos()
            .catch(err => logger.error('Scheduled check failed', { error: err.message }));
        } else {
          logger.warn('Skipping scheduled check - previous check still running');
        }
      },
      intervalMinutes * 60 * 1000
    );
    
    logger.info(`Started Jackal PIN monitoring (interval: ${intervalMinutes} minutes)`);
  }
  
  /**
   * Stops the monitoring process
   * @returns {Promise<void>}
   */
  async stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      logger.info('Stopped Jackal PIN monitoring');
      
      // Wait for any ongoing check to complete
      await this.checkForNewVideosPromise?.catch(() => {});
    }
  }
  
  /**
   * Checks for new videos in Jackal PIN service
   * @returns {Promise<void>}
   */
  async checkForNewVideos() {
    if (this.checkInProgress) {
      logger.warn('Check already in progress, skipping');
      return;
    }
    
    this.checkInProgress = true;
    let retries = 3;
    
    // Store the promise so we can wait for it during shutdown
    this.checkForNewVideosPromise = (async () => {
      try {
        logger.info('Checking Jackal PIN for new videos');
        
        // Query videos using the PinService
        const files = await jackalPinService.listFiles();
        let newVideosFound = 0;
        
        // Filter for video files using our helper method
        const videoFiles = files.filter(file => this.isVideoFile(file));
        
        logger.info(`Found ${videoFiles.length} videos in Jackal PIN out of ${files.length} total files`);
        
        for (const video of videoFiles) {
          // Check if this video has been processed already
          const processed = await db.get(
            'SELECT cid FROM processed_videos WHERE cid = ?',
            [video.cid]
          );
          
          if (!processed) {
            // Add to processing queue
            await processingQueue.addVideo(video);
            
            // Mark as processed in the database
            await db.run(
              'INSERT INTO processed_videos (cid, name, metadata) VALUES (?, ?, ?)',
              [video.cid, video.name, JSON.stringify(video)]
            );
            
            newVideosFound++;
            logger.info(`Found new video: ${video.name} (CID: ${video.cid})`);
          }
        }
        
        logger.info(`Found ${newVideosFound} new videos to process`);
      } catch (error) {
        logger.error('Error checking for new videos', { 
          error: error.message, 
          stack: error.stack,
          retryCount: 3 - retries
        });
        
        // Retry logic
        retries--;
        if (retries > 0) {
          logger.info(`Retrying check, ${retries} attempts remaining`);
          // Wait before retry (exponential backoff: 5s, 10s, 20s)
          const delay = Math.pow(2, 3 - retries) * 5000;
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.checkForNewVideos();
        }
      } finally {
        this.checkInProgress = false;
      }
    })();
    
    return this.checkForNewVideosPromise;
  }
  
  /**
   * Gets a list of processed videos
   * @param {Object} options - Options for filtering
   * @param {number} options.limit - Maximum number of videos to return
   * @param {number} options.offset - Offset for pagination
   * @returns {Promise<Array>} List of processed videos
   */
  async getProcessedVideos(options = {}) {
    const limit = options.limit || 100;
    const offset = options.offset || 0;
    
    try {
      const videos = await db.all(
        `SELECT cid, name, processed_at, metadata 
         FROM processed_videos 
         ORDER BY processed_at DESC 
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      
      return videos.map(video => ({
        ...video,
        metadata: JSON.parse(video.metadata || '{}')
      }));
    } catch (error) {
      logger.error('Failed to get processed videos', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Clears the processed videos history
   * @param {Object} options - Options for clearing
   * @param {boolean} options.keepLast30Days - Whether to keep videos from the last 30 days
   * @returns {Promise<number>} Number of records deleted
   */
  async clearProcessedVideos(options = {}) {
    try {
      let query = 'DELETE FROM processed_videos';
      const params = [];
      
      if (options.keepLast30Days) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        
        query += ' WHERE processed_at < ?';
        params.push(cutoffDate.toISOString());
      }
      
      const result = await db.run(query, params);
      
      logger.info(`Cleared ${result.changes} processed videos from history`);
      return result.changes;
    } catch (error) {
      logger.error('Failed to clear processed videos', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Manually adds a video to be processed
   * @param {string} cid - Content ID of the video
   * @param {Object} options - Processing options
   * @param {boolean} options.force - Force re-processing if already processed
   * @returns {Promise<Object>} Processing result with video data
   */
  async addVideoByContentId(cid, options = {}) {
    try {
      if (!cid) {
        throw new Error('Content ID is required');
      }
      
      logger.info(`Starting direct processing for video with CID: ${cid}`);
      
      // Ensure all required services are initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Use videoProcessor.processVideoByCid which handles downloading and processing
      const result = await videoProcessor.processVideoByCid(cid, {
        force: options.force,
        name: options.name || `Video-${cid.substring(0, 8)}`,
        type: options.type || 'educational'
      });
      
      if (result) {
        // Also add to processed_videos tracking table
        await db.run(
          'INSERT OR REPLACE INTO processed_videos (cid, name, metadata) VALUES (?, ?, ?)',
          [cid, result.name, JSON.stringify(result)]
        );
        
        logger.info(`Successfully processed video: ${result.name} (CID: ${cid})`);
        return result;
      } else {
        throw new Error(`No result returned from video processing for CID: ${cid}`);
      }
    } catch (error) {
      logger.error(`Failed to process video by content ID: ${cid}`, { error: error.message, stack: error.stack });
      throw error;
    }
  }
}

// Export singleton instance
const jackalMonitor = new JackalMonitor();
module.exports = jackalMonitor; 