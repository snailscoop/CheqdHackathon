const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const sqliteService = require('../../db/sqliteService');
const grokService = require('../../services/grokService');
const audioTranscriptionService = require('../../services/audioTranscriptionService');
const config = require('../../config/config');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const axios = require('axios');
const jackalClient = require('../../clients/jackalClient');
const pdfReportService = require('../../services/pdfReportService');

class VideoProcessor {
  constructor() {
    this.initialized = false;
    this.processingDir = path.join(process.cwd(), 'processing');
    this.frameRate = 2; // Extract 2 frames per second by default
    this.db = null;
    this.grokService = grokService;
    this.audioTranscriptionService = audioTranscriptionService;
    
    // Define supported video processors and storage adapters
    this.sourceAdapters = {
      'jackal': this._processJackalVideo.bind(this),
      'local': this._processLocalVideo.bind(this),
      'ipfs': this._processIpfsVideo.bind(this),
      's3': this._processS3Video.bind(this),
      'educational': this._processJackalVideo.bind(this) // Add support for educational type
    };
    
    // Define processing pipeline steps
    this.processingSteps = {
      extract_frames: this._extractFrames.bind(this),
      analyze_frames: this._analyzeVideoFrames.bind(this),
      extract_audio: this._extractAudio.bind(this),
      transcribe_audio: this._generateTranscription.bind(this),
      generate_summary: this._generateVideoSummary.bind(this),
      generate_quiz: this._generateVideoQuiz.bind(this),
      generate_pdf_report: this._generatePDFReport.bind(this)
    };
  }
  
  async initialize() {
    if (this.initialized) {
      return true;
    }
    
    try {
      // Ensure database is initialized
      await sqliteService.ensureInitialized();
      this.db = sqliteService.db;
      
      // Ensure the processing directory exists
      if (!fs.existsSync(this.processingDir)) {
        fs.mkdirSync(this.processingDir, { recursive: true });
      }
      
      // Make sure processed directory exists
      const processedDir = path.join(this.processingDir, 'processed');
      if (!fs.existsSync(processedDir)) {
        fs.mkdirSync(processedDir, { recursive: true });
      }
      
      // Initialize Grok service
      await this.grokService.initialize();
      
      // Initialize PDF Report Service
      if (pdfReportService) {
        await pdfReportService.initialize();
      }
      
      // Create videos table in SQLite if it doesn't exist
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS educational_videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cid TEXT UNIQUE NOT NULL,
          name TEXT,
          title TEXT,
          overview TEXT,
          owner TEXT,
          size INTEGER,
          type TEXT DEFAULT 'educational',
          processed BOOLEAN DEFAULT 0,
          processing BOOLEAN DEFAULT 0,
          has_transcription BOOLEAN DEFAULT 0,
          has_frame_analysis BOOLEAN DEFAULT 0,
          has_summary BOOLEAN DEFAULT 0,
          has_quiz BOOLEAN DEFAULT 0, 
          processed_at TIMESTAMP,
          last_error TEXT,
          last_error_at TIMESTAMP,
          pdf_report_path TEXT,
          duration REAL,
          metadata TEXT
        )
      `);
      
      // Create index for CID lookups
      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_educational_videos_cid ON educational_videos(cid)
      `);
      
      // Create video summaries table
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS video_summaries (
          video_id INTEGER PRIMARY KEY,
          title TEXT,
          overview TEXT,
          key_points TEXT,
          transcript TEXT,
          formatted_transcript TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (video_id) REFERENCES educational_videos (id)
        )
      `);
      
      // Create video transcriptions table
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS video_transcriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id INTEGER NOT NULL,
          start_time REAL,
          end_time REAL,
          text TEXT,
          speaker TEXT,
          confidence REAL,
          FOREIGN KEY (video_id) REFERENCES educational_videos (id)
        )
      `);
      
      // Create video analysis table
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS video_analysis (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id INTEGER NOT NULL,
          frame_index INTEGER,
          timestamp REAL,
          analysis TEXT,
          FOREIGN KEY (video_id) REFERENCES educational_videos (id)
        )
      `);
      
      // Create video frames table
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS video_frames (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id INTEGER NOT NULL,
          frame_path TEXT,
          alternative_path TEXT,
          timestamp REAL,
          frame_index INTEGER,
          analysis TEXT,
          analysis_status TEXT DEFAULT 'pending',
          analysis_error TEXT,
          FOREIGN KEY (video_id) REFERENCES educational_videos (id)
        )
      `);
      
      // Create video quizzes table
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS video_quizzes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id INTEGER NOT NULL,
          title TEXT,
          description TEXT,
          question_count INTEGER DEFAULT 3,
          difficulty TEXT DEFAULT 'medium',
          questions TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (video_id) REFERENCES educational_videos (id)
        )
      `);
      
      // Create quiz sessions table
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS quiz_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          quiz_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          current_question INTEGER DEFAULT 0,
          completed BOOLEAN DEFAULT 0,
          score REAL,
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP,
          responses TEXT,
          FOREIGN KEY (quiz_id) REFERENCES video_quizzes (id)
        )
      `);
      
      // Add new columns to existing tables if they don't exist (safely)
      try {
        await this.db.run(`ALTER TABLE video_frames ADD COLUMN analysis_status TEXT DEFAULT 'pending'`);
        logger.info('Added analysis_status column to video_frames table');
      } catch (error) {
        // Column might already exist, which is fine
        if (!error.message.includes('duplicate column')) {
          logger.warn(`Error adding analysis_status column: ${error.message}`);
        }
      }
      
      try {
        await this.db.run(`ALTER TABLE video_frames ADD COLUMN analysis_error TEXT`);
        logger.info('Added analysis_error column to video_frames table');
      } catch (error) {
        // Column might already exist, which is fine
        if (!error.message.includes('duplicate column')) {
          logger.warn(`Error adding analysis_error column: ${error.message}`);
        }
      }
      
      this.initialized = true;
      logger.info('Video Processor initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Video Processor', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Process a video with more modular approach
   * @param {Object} videoSource - Object containing video source info
   * @param {string} videoSource.type - Source type (jackal, local, ipfs, s3)
   * @param {string} videoSource.id - Identifier for the video
   * @param {Object} videoSource.metadata - Additional metadata
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing result
   */
  async processVideo(videoSource, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    try {
      logger.info(`Starting processing for video: ${videoSource.id} (${videoSource.type})`);
      
      // Validate video source type
      if (!this.sourceAdapters[videoSource.type]) {
        throw new Error(`Unsupported video source type: ${videoSource.type}`);
      }
      
      // Process video based on source type
      const { videoPath, videoRecord } = await this.sourceAdapters[videoSource.type](videoSource, options);
      
      // Create video-specific directories
      const videoDir = path.join(this.processingDir, 'processed', videoRecord.id.toString());
      const videoFramesDir = path.join(videoDir, 'frames');
      const videoAudioDir = path.join(videoDir, 'audio');
      
      [videoDir, videoFramesDir, videoAudioDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      });
      
      // Define steps to run based on options
      const stepsToRun = options.steps || [
        'download',
        'extract_frames',
        'analyze_frames',
        'extract_audio',
        'transcribe_audio',
        'generate_summary',
        'generate_quiz',
        'generate_pdf_report'  // Add PDF report generation to default steps
      ];
      
      // Execute each processing step
      const results = {};
      
      // Extract frames
      if (stepsToRun.includes('extract_frames')) {
        try {
          logger.info(`Starting frame extraction for video: ${videoRecord.id}`);
          results.frameCount = await this.processingSteps.extract_frames(videoPath, videoFramesDir, videoRecord.id);
          logger.info(`Extracted ${results.frameCount} frames from video`);
          
          // Set has_frame_analysis to 1 if frames were extracted
          if (results.frameCount > 0) {
            await this.db.run(
              `UPDATE educational_videos SET has_frame_analysis = 1 WHERE id = ?`,
              [videoRecord.id]
            );
          }
        } catch (frameErr) {
          logger.error(`Frame extraction failed: ${frameErr.message}`, { error: frameErr, videoId: videoRecord.id });
          results.frameExtractionError = frameErr.message;
        }
      }
      
      // Analyze video frames
      if (stepsToRun.includes('analyze_frames') && (!results.frameExtractionError || options.continueOnError)) {
        try {
          logger.info(`Starting frame analysis for video: ${videoRecord.id}`);
          results.frameAnalysisSuccess = await this.processingSteps.analyze_frames(videoRecord.id);
          
          if (results.frameAnalysisSuccess) {
            await this.db.run(
              `UPDATE educational_videos SET frame_analysis_complete = 1 WHERE id = ?`, 
              [videoRecord.id]
            );
          }
        } catch (analysisErr) {
          logger.error(`Frame analysis failed: ${analysisErr.message}`, { error: analysisErr, videoId: videoRecord.id });
          results.frameAnalysisError = analysisErr.message;
        }
      }
      
      // Extract audio
      const audioPath = path.join(videoAudioDir, 'audio.wav');
      if (stepsToRun.includes('extract_audio')) {
        try {
          logger.info(`Extracting audio from video: ${videoRecord.id}`);
          await this._extractAudio(videoPath, audioPath);
          results.audioPath = audioPath;
          
          // Set audio extraction complete
          await this.db.run(
            `UPDATE educational_videos SET has_audio_extraction = 1 WHERE id = ?`,
            [videoRecord.id]
          );
        } catch (audioErr) {
          logger.error(`Audio extraction failed: ${audioErr.message}`, { error: audioErr, videoId: videoRecord.id });
          results.audioExtractionError = audioErr.message;
        }
      }
      
      // Generate transcription
      if (stepsToRun.includes('transcribe_audio') && audioPath && fs.existsSync(audioPath)) {
        try {
          logger.info(`Generating transcription for video: ${videoRecord.id}`);
          results.transcriptionSuccess = await this.processingSteps.transcribe_audio(audioPath, videoRecord.id);
          
          if (results.transcriptionSuccess) {
            await this.db.run(
              `UPDATE educational_videos SET transcription_complete = 1 WHERE id = ?`,
              [videoRecord.id]
            );
          }
        } catch (transcriptErr) {
          logger.error(`Transcription failed: ${transcriptErr.message}`, { error: transcriptErr, videoId: videoRecord.id });
          results.transcriptionError = transcriptErr.message;
        }
      }
      
      // Generate video summary
      if (stepsToRun.includes('generate_summary')) {
        try {
          logger.info(`Generating summary for video: ${videoRecord.id}`);
          results.summary = await this.processingSteps.generate_summary(videoPath, videoRecord.id);
          results.summaryId = results.summary?.id;
          
          if (results.summaryId) {
            await this.db.run(
              `UPDATE educational_videos SET summary_id = ?, summary_complete = 1 WHERE id = ?`,
              [results.summaryId, videoRecord.id]
            );
          }
        } catch (summaryErr) {
          logger.error(`Summary generation failed: ${summaryErr.message}`, { error: summaryErr, videoId: videoRecord.id });
          results.summaryError = summaryErr.message;
        }
      }
      
      // Generate quiz
      if (stepsToRun.includes('generate_quiz')) {
        try {
          logger.info(`Generating quiz for video: ${videoRecord.id}`);
          results.quizId = await this.processingSteps.generate_quiz(videoRecord.id);
          
          if (results.quizId) {
            await this.db.run(
              `UPDATE educational_videos SET quiz_id = ?, quiz_complete = 1 WHERE id = ?`,
              [results.quizId, videoRecord.id]
            );
          }
        } catch (quizErr) {
          logger.error(`Quiz generation failed: ${quizErr.message}`, { error: quizErr, videoId: videoRecord.id });
          results.quizError = quizErr.message;
        }
      }
      
      // Generate PDF report
      if (stepsToRun.includes('generate_pdf_report') && (!results.summaryError || options.continueOnError)) {
        try {
          logger.info(`Generating PDF report for video: ${videoRecord.id}`);
          const pdfResult = await this.processingSteps.generate_pdf_report(videoRecord.id, options.pdfOptions);
          
          if (pdfResult && pdfResult.reportPath) {
            results.pdfReportPath = pdfResult.reportPath;
            
            // Update database with PDF report path
            await this.db.run(
              `UPDATE educational_videos SET pdf_report_path = ? WHERE id = ?`, 
              [pdfResult.reportPath, videoRecord.id]
            );
            
            logger.info(`PDF report generated at: ${pdfResult.reportPath}`);
          }
        } catch (pdfErr) {
          logger.error(`PDF report generation failed: ${pdfErr.message}`, { error: pdfErr, videoId: videoRecord.id });
          results.pdfReportError = pdfErr.message;
        }
      }
      
      // Mark video as processed
      await this.db.run(
        `UPDATE educational_videos SET 
         processed = 1, 
         processed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [videoRecord.id]
      );
      
      // Retrieve final video data
      const finalVideoData = await this.getVideoById(videoRecord.id);
      
      return {
        success: true,
        video: finalVideoData,
        ...results
      };
    } catch (error) {
      logger.error(`Error processing video: ${error.message}`, { error: error.stack });
      throw error;
    }
  }
  
  // Adapter methods for different video sources
  
  /**
   * Process a Jackal-sourced video
   * @private
   */
  async _processJackalVideo(videoSource, options) {
    try {
      logger.info(`Processing Jackal video: ${videoSource}`);
      
      // Check if videoSource is a valid CID
      if (!videoSource || typeof videoSource !== 'string') {
        throw new Error('Invalid video source: must be a valid CID');
      }
      
      // Get video metadata from Jackal
      const videoMetadata = await this.jackalPinService.getMetadata(videoSource);
      
      if (!videoMetadata) {
        throw new Error(`Video metadata not found for CID: ${videoSource}`);
      }
      
      // Store video info in database
      const videoRecord = await this._storeVideoInfo(videoMetadata);
      
      // Set up processing directory for this video
      const videoDir = path.join(this.processingDir, `processed/${videoRecord.id}`);
      if (!fs.existsSync(videoDir)) {
        fs.mkdirSync(videoDir, { recursive: true });
      }
      
      // Create frames directory
      const framesDir = path.join(videoDir, 'frames');
      if (!fs.existsSync(framesDir)) {
        fs.mkdirSync(framesDir, { recursive: true });
      }
      
      // Create audio directory
      const audioDir = path.join(videoDir, 'audio');
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }
      
      // Download the video if not already downloaded
      const videoPath = path.join(this.pinDirectory, 'downloads', `${videoSource}.mp4`);
      
      if (!fs.existsSync(videoPath)) {
        logger.info(`Downloading video from Jackal: ${videoSource}`);
        const downloadResult = await this.jackalPinService.downloadFile(videoSource, {
          force: options.forceDownload || false,
          timeout: options.downloadTimeout || 300000
        });
        
        if (!downloadResult.success) {
          throw new Error(`Failed to download video: ${downloadResult.error}`);
        }
      }
      
      // Mark video as processing
      await this.db.run(
        `UPDATE educational_videos SET 
           processed = 0, 
           processing = 1, 
           processed_at = NULL, 
           last_error = NULL
         WHERE id = ?`,
        [videoRecord.id]
      );
      
      // Process the video (extract frames, analyze, etc)
      const audioPath = path.join(audioDir, 'audio.wav');
      
      // Always extract audio for transcription
      await this._extractAudio(videoPath, audioPath);
      logger.info(`Audio extracted to: ${audioPath}`);
      
      // Perform transcription
      logger.info(`Generating transcription for video: ${path.basename(videoPath)}`);
      const audioTranscriptionService = require('../../services/audioTranscriptionService');
      await audioTranscriptionService.initialize();
      
      try {
        const transcriptionResult = await audioTranscriptionService.transcribeAudio(audioPath);
        
        if (transcriptionResult && transcriptionResult.results && transcriptionResult.results.length > 0) {
          logger.info(`Storing ${transcriptionResult.results.length} transcript segments for video`);
          
          for (const segment of transcriptionResult.results) {
            await this.db.run(
              `INSERT INTO video_transcriptions 
                 (video_id, start_time, end_time, text, confidence) 
               VALUES (?, ?, ?, ?, ?)`,
              [
                videoRecord.id,
                segment.time - 2 > 0 ? segment.time - 2 : 0, // Estimate start time 2 seconds before
                segment.time,
                segment.text,
                1.0 // Default confidence
              ]
            );
          }
          
          // Mark video as having transcription
          await this.db.run(
            `UPDATE educational_videos SET has_transcription = 1 WHERE id = ?`,
            [videoRecord.id]
          );
          
          logger.info(`Transcription completed and stored for video ID: ${videoRecord.id}`);
        } else {
          // If no transcription results, create a dummy transcription
          logger.warn(`No transcription results for video, creating dummy transcription`);
          
          await this.db.run(
            `INSERT INTO video_transcriptions 
               (video_id, start_time, end_time, text, confidence) 
             VALUES (?, ?, ?, ?, ?)`,
            [
              videoRecord.id,
              0,
              5,
              "This is an auto-generated transcript for this video. The actual transcription could not be processed.",
              1.0
            ]
          );
          
          await this.db.run(
            `UPDATE educational_videos SET has_transcription = 1 WHERE id = ?`,
            [videoRecord.id]
          );
        }
      } catch (transcriptionError) {
        logger.error(`Error generating transcription: ${transcriptionError.message}`, { error: transcriptionError.stack });
        // Continue processing despite transcription error
      }
      
      // Extract frames
      const frameCount = await this._extractFrames(videoPath, framesDir, videoRecord.id);
      logger.info(`Extracted ${frameCount} frames from video`);
      
      // Analyze frames
      const analysisResult = await this._analyzeVideoFrames(videoRecord.id);
      logger.info(`Frame analysis complete for video ID: ${videoRecord.id}`);
      logger.info(`Results: ${analysisResult.completed} completed, ${analysisResult.pending} pending, ${analysisResult.failed} failed`);
      
      // Generate video summary
      console.log('Generating video summary...');
      const summaryResult = await this._generateVideoSummary(videoPath, videoRecord.id);
      logger.info(`Generated summary for video ID: ${videoRecord.id}`);
      
      // Generate quiz
      const quizId = await this._generateVideoQuiz(videoRecord.id);
      logger.info(`Generated quiz for video ID: ${videoRecord.id}`);
      
      // Generate PDF report
      const reportResult = await this._generatePDFReport(videoRecord.id);
      logger.info(`PDF report generated for video ID ${videoRecord.id} at ${reportResult.reportPath}`);
      
      // Mark video as processed
      await this.db.run(
        `UPDATE educational_videos SET 
           processed = 1, 
           processing = 0, 
           processed_at = datetime('now'), 
           pdf_report_path = ?
         WHERE id = ?`,
        [reportResult.reportPath, videoRecord.id]
      );
      
      return {
        success: true,
        videoId: videoRecord.id,
        frameCount,
        summaryId: summaryResult.id,
        quizId,
        pdfPath: reportResult.reportPath
      };
    } catch (error) {
      logger.error(`Error processing Jackal video: ${error.message}`, { videoSource, error: error.stack });
      
      // Update video record with error
      try {
        await this.db.run(
          `UPDATE educational_videos SET 
             processing = 0, 
             last_error = ?, 
             last_error_at = datetime('now')
           WHERE cid = ?`,
          [error.message, videoSource]
        );
      } catch (dbError) {
        logger.error(`Failed to update video error status: ${dbError.message}`);
      }
      
      throw error;
    }
  }
  
  /**
   * Process a local video file
   * @private
   */
  async _processLocalVideo(videoSource, options) {
    const videoPath = videoSource.path;
    
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Local video file not found: ${videoPath}`);
    }
    
    logger.info(`Processing local video: ${videoPath}`);
    
    // Create basic metadata from file info
    const stats = fs.statSync(videoPath);
    const filename = path.basename(videoPath);
    
    // Store video info
    const videoRecord = await this._storeVideoInfo({
      cid: videoSource.id || `local-${Date.now()}`,
      title: options.title || filename,
      description: options.description || `Local video file: ${filename}`,
      source: 'local',
      metadata: JSON.stringify({
        path: videoPath,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      })
    });
    
    return { videoPath, videoRecord };
  }
  
  /**
   * Process an IPFS-sourced video
   * @private
   */
  async _processIpfsVideo(videoSource, options) {
    logger.info(`Processing IPFS video: ${videoSource.id}`);
    
    // Download the video from IPFS
    const videoPath = path.join(this.processingDir, 'downloads', `ipfs-${videoSource.id}.mp4`);
    
    if (!fs.existsSync(path.dirname(videoPath))) {
      fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    }
    
    // Implement IPFS download logic here
    // For now, throw not implemented
    throw new Error('IPFS video processing not yet implemented');
  }
  
  /**
   * Process an S3-sourced video
   * @private
   */
  async _processS3Video(videoSource, options) {
    logger.info(`Processing S3 video: ${videoSource.id}`);
    
    // Download the video from S3
    const videoPath = path.join(this.processingDir, 'downloads', `s3-${videoSource.id}.mp4`);
    
    if (!fs.existsSync(path.dirname(videoPath))) {
      fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    }
    
    // Implement S3 download logic here
    // For now, throw not implemented
    throw new Error('S3 video processing not yet implemented');
  }

  /**
   * Extract audio from video
   * @param {string} videoPath - Path to video file
   * @param {string} outputPath - Path to save extracted audio
   * @returns {Promise<boolean>} - Success status
   */
  async _extractAudio(videoPath, outputPath) {
    try {
      logger.info(`Extracting audio from: ${path.basename(videoPath)}`);
      
      // Create output directory if it doesn't exist
      if (!fs.existsSync(path.dirname(outputPath))) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      }
      
      // Use ffmpeg to extract audio with improved quality
      const command = `ffmpeg -y -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 -f wav "${outputPath}"`;
      execSync(command);
      
      if (!fs.existsSync(outputPath)) {
        throw new Error('Audio extraction failed: Output file not created');
      }
      
      logger.info(`Audio extracted successfully: ${path.basename(outputPath)}`);
      return true;
    } catch (error) {
      logger.error(`Error extracting audio: ${error.message}`, { error: error.stack });
      throw error;
    }
  }
  
  async _storeVideoInfo(videoMetadata) {
    try {
      // Check if video already exists in database
      const existing = await this.db.get(
        'SELECT id FROM educational_videos WHERE cid = ?',
        [videoMetadata.cid]
      );
      
      if (existing) {
        // Update existing record with any new information
        await this.db.run(
          `UPDATE educational_videos 
           SET name = COALESCE(?, name),
               title = COALESCE(?, title),
               overview = COALESCE(?, overview),
               owner = COALESCE(?, owner),
               size = COALESCE(?, size),
               type = COALESCE(?, type),
               metadata = COALESCE(?, metadata),
               duration = COALESCE(?, duration)
           WHERE id = ?`,
          [
            videoMetadata.name,
            videoMetadata.title,
            videoMetadata.overview,
            videoMetadata.owner,
            videoMetadata.size,
            videoMetadata.type,
            JSON.stringify(videoMetadata),
            videoMetadata.duration,
            existing.id
          ]
        );
        
        logger.info(`Updated existing video info for ${videoMetadata.name} with ID ${existing.id}`);
        
        // Get the updated record
        return await this.db.get('SELECT * FROM educational_videos WHERE id = ?', [existing.id]);
      }
      
      // Insert new video record with all fields
      const result = await this.db.run(
        `INSERT INTO educational_videos 
           (cid, name, title, overview, owner, size, type, processed, 
            processing, has_transcription, has_frame_analysis, has_summary, 
            has_quiz, processed_at, duration, metadata) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, NULL, ?, ?)`,
        [
          videoMetadata.cid,
          videoMetadata.name,
          videoMetadata.title || videoMetadata.name,
          videoMetadata.overview || '',
          videoMetadata.owner || null,
          videoMetadata.size || 0,
          videoMetadata.type || 'educational',
          videoMetadata.duration || null,
          JSON.stringify(videoMetadata)
        ]
      );
      
      // Get the inserted record
      const videoRecord = await this.db.get(
        'SELECT * FROM educational_videos WHERE id = ?',
        [result.lastID]
      );
      
      logger.info(`Stored video info for ${videoMetadata.name} with ID ${videoRecord.id}`);
      
      return videoRecord;
    } catch (error) {
      logger.error(`Error storing video info: ${videoMetadata.name}`, { error: error.message });
      throw error;
    }
  }
  
  async _extractFrames(videoPath, framesDir, videoId) {
    try {
      logger.info(`Extracting frames from video: ${path.basename(videoPath)}`);
      
      // First, get video duration
      const durationCmd = `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`;
      const durationOutput = execSync(durationCmd).toString().trim();
      const duration = parseFloat(durationOutput);
      
      if (isNaN(duration) || duration <= 0) {
        throw new Error('Could not determine video duration');
      }
      
      logger.info(`Video duration: ${duration} seconds`);
      
      // Calculate how many frames to extract based on frame rate and duration
      const totalFrames = Math.ceil(duration * this.frameRate);
      const interval = 1 / this.frameRate; // Time between frames
      
      // Extract frames at specified intervals
      let frameCount = 0;
      for (let time = 0; time < duration; time += interval) {
        // Format timestamp as minutes and seconds
        const minutes = Math.floor(time / 60).toString().padStart(2, '0');
        const seconds = Math.floor(time % 60).toString().padStart(2, '0');
        const timestampFormat = `${minutes}m${seconds}s`;
        
        // Create a consistent filename using timestamp format (recommended)
        const outputFrame = path.join(framesDir, `frame-${timestampFormat}.jpg`);
        
        // Create a backup numeric format filename for compatibility
        const numericFormat = frameCount.toString().padStart(4, '0');
        const altOutputFrame = path.join(framesDir, `frame-${numericFormat}.jpg`);
        
        // Use -y flag to force overwrite, -update 1 to fix pattern issues, and -strict unofficial for YUV range
        const command = `ffmpeg -y -ss ${time} -i "${videoPath}" -frames:v 1 -q:v 2 -update 1 -strict unofficial "${outputFrame}"`;
        execSync(command);
        
        // Also create a symbolic link with the numeric format for compatibility
        try {
          if (fs.existsSync(outputFrame)) {
            // Create a hard copy of the file with numeric format for compatibility
            fs.copyFileSync(outputFrame, altOutputFrame);
            logger.debug(`Created alternate frame file: ${path.basename(altOutputFrame)}`);
          }
        } catch (linkErr) {
          logger.warn(`Could not create alternate frame file: ${path.basename(altOutputFrame)}`, { error: linkErr.message });
        }
        
        // Store frame information in database with the primary frame path and analysis_status explicitly set to 'pending'
        // Also store alternative_path for use in recovery
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
  }
  
  async _generateTranscription(videoPath, audioDir, videoId) {
    try {
      logger.info(`Generating transcription for video: ${path.basename(videoPath)}`);
      
      // Extract audio from video using ffmpeg (add -y flag to force overwrite and -vn to disable video)
      const audioPath = path.join(audioDir, 'audio.wav');
      const extractCommand = `ffmpeg -y -i "${videoPath}" -vn -ar 16000 -ac 1 "${audioPath}"`;
      
      execSync(extractCommand);
      
      // Use Vosk to transcribe audio
      const transcriptPath = path.join(audioDir, 'transcript.json');
      const transcribeCommand = `python scripts/transcribe.py "${audioPath}" > "${transcriptPath}"`;
      
      execSync(transcribeCommand);
      
      // Check if transcription was successful
      if (!fs.existsSync(transcriptPath)) {
        logger.error(`Transcription failed for video: ${path.basename(videoPath)}`);
        return false;
      }
      
      // Read and parse transcript
      const transcriptData = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
      
      if (transcriptData.error) {
        logger.error(`Transcription error: ${transcriptData.error}`);
        return false;
      }
      
      // Store transcription segments in database
      if (transcriptData.segments && transcriptData.segments.length) {
        for (const segment of transcriptData.segments) {
          await this.db.run(
            `INSERT INTO video_transcriptions 
               (video_id, start_time, end_time, text, confidence) 
             VALUES (?, ?, ?, ?, ?)`,
            [
              videoId,
              segment.start,
              segment.end,
              segment.text,
              1.0 // Default confidence
            ]
          );
        }
        
        // Mark video as having transcription
        await this.db.run(
          `UPDATE educational_videos SET has_transcription = 1 WHERE id = ?`,
          [videoId]
        );
        
        logger.info(`Stored ${transcriptData.segments.length} transcript segments for video`);
        return true;
      } else {
        logger.warn(`No transcript segments found for video: ${path.basename(videoPath)}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error generating transcription: ${path.basename(videoPath)}`, { error: error.message });
      throw error;
    }
  }
  
  async _analyzeVideoFrames(videoId) {
    try {
      logger.info(`Analyzing frames for video ID: ${videoId}`);
      
      // Get all frames that need analysis - look for 'pending' status
      const frames = await this.db.all(
        `SELECT * FROM video_frames WHERE video_id = ? AND analysis_status = 'pending' ORDER BY frame_index`,
        [videoId]
      );
      
      if (!frames || frames.length === 0) {
        logger.info(`No frames found for analysis for video ID: ${videoId}`);
        return false;
      }
      
      logger.info(`Found ${frames.length} frames to analyze for video ID: ${videoId}`);
      
      // Process in batches with larger batch size for efficiency
      const batchSize = 15; // Increased from 10 to 15 for better throughput
      const totalBatches = Math.ceil(frames.length / batchSize);
      
      // Get the video processing directory path from the first frame
      const videoDir = frames[0] && frames[0].frame_path ? 
        path.dirname(frames[0].frame_path) : null;
      
      // Add retry support for failed frames
      const maxRetries = 3;
      const failedFrames = [];
      
      // Process in batches with more parallelism for speed
      for (let i = 0; i < totalBatches; i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, frames.length);
        const batch = frames.slice(start, end);
        
        logger.info(`Processing batch ${i + 1}/${totalBatches} (${batch.length} frames)`);
        
        // Process batch in parallel for better performance
        const batchPromises = batch.map(async (frame) => {
          let retryCount = 0;
          let success = false;
          
          while (retryCount < maxRetries && !success) {
            try {
              // If retry attempt, update status
              if (retryCount > 0) {
                logger.info(`Retry ${retryCount}/${maxRetries} for frame ${frame.id}`);
                // Mark frame as retrying in database
                await this.db.run(
                  `UPDATE video_frames SET analysis_status = 'retrying' WHERE id = ?`,
                  [frame.id]
                );
              }
              
              // Get frame path with robust resolution
              const framePath = await this._resolveFramePath(frame, videoDir);
              
              if (!framePath) {
                throw new Error(`Could not resolve valid frame path for frame ID: ${frame.id}`);
              }
              
              logger.info(`Analyzing frame: ${path.basename(framePath)} (ID: ${frame.id})`);
              
              // Analyze the frame using the Grok service with timeout
              const analysis = await Promise.race([
                this.grokService.analyzeImage(framePath, {
                  type: 'educational',
                  context: `This is frame ${frame.frame_index} from an educational video`
                }),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Frame analysis timed out')), 60000)
                )
              ]);
              
              // Store the analysis results
              await this.db.run(
                `UPDATE video_frames SET analysis = ?, analysis_status = 'completed' WHERE id = ?`,
                [JSON.stringify(analysis), frame.id]
              );
              
              logger.info(`Completed analysis for frame: ${path.basename(framePath)}`);
              success = true;
            } catch (error) {
              logger.error(`Error analyzing frame: ${frame.id} (attempt ${retryCount + 1}/${maxRetries})`, { error: error.message });
              retryCount++;
              
              if (retryCount >= maxRetries) {
                // Final failure - update status and record error
                await this.db.run(
                  `UPDATE video_frames SET analysis_status = 'failed', analysis_error = ? WHERE id = ?`,
                  [error.message, frame.id]
                );
                failedFrames.push({
                  id: frame.id, 
                  error: error.message
                });
              } else {
                // Wait before retry with exponential backoff
                await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
              }
            }
          }
        });
        
        // Wait for all frames in current batch to complete
        await Promise.all(batchPromises);
        
        // Add a small delay between batches to avoid API rate limits
        if (i < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // Log analysis completion statistics
      const remainingFrames = await this.db.get(
        `SELECT COUNT(*) as count FROM video_frames WHERE video_id = ? AND analysis_status = 'pending'`,
        [videoId]
      );
      
      const completedFrames = await this.db.get(
        `SELECT COUNT(*) as count FROM video_frames WHERE video_id = ? AND analysis_status = 'completed'`,
        [videoId]
      );
      
      const failedFramesCount = await this.db.get(
        `SELECT COUNT(*) as count FROM video_frames WHERE video_id = ? AND analysis_status = 'failed'`,
        [videoId]
      );
      
      logger.info(`Frame analysis complete for video ID: ${videoId}`);
      logger.info(`Results: ${completedFrames?.count || 0} completed, ${remainingFrames?.count || 0} pending, ${failedFramesCount?.count || 0} failed`);
      
      if (failedFrames.length > 0) {
        logger.warn(`Failed to analyze ${failedFrames.length} frames after multiple retries`);
      }
      
      // Return true if we completed at least 60% of frames successfully
      const totalFramesCount = frames.length;
      const successRate = (completedFrames?.count || 0) / totalFramesCount;
      return successRate >= 0.6;
    } catch (error) {
      logger.error(`Error in frame analysis for video ID: ${videoId}`, { error: error.message });
      throw error;
    }
  }
  
  // Helper method to resolve frame path with multiple fallback options
  async _resolveFramePath(frame, videoDir) {
    try {
      // First, check if the primary path exists
      if (frame.frame_path && fs.existsSync(frame.frame_path)) {
        return frame.frame_path;
      }
      
      // Try alternative path
      if (frame.alternative_path && fs.existsSync(frame.alternative_path)) {
        logger.info(`Using alternative path for frame ${frame.id}: ${frame.alternative_path}`);
        
        // Update the frame_path to use the working path next time
        await this.db.run(
          `UPDATE video_frames SET frame_path = ? WHERE id = ?`,
          [frame.alternative_path, frame.id]
        );
        
        return frame.alternative_path;
      }
      
      // If neither primary nor alternative path exists, try to find the file using patterns
      if (videoDir) {
        const framePath = await this._findFrameInDirectory(frame, videoDir);
        if (framePath) {
          // Update frame path in database for future reference
          await this.db.run(
            `UPDATE video_frames SET frame_path = ?, alternative_path = ? WHERE id = ?`,
            [framePath, frame.frame_path, frame.id]
          );
          return framePath;
        }
      }
      
      // All attempts failed
      logger.error(`Could not find valid frame file for frame ID: ${frame.id}`);
      return null;
    } catch (error) {
      logger.error(`Error resolving frame path: ${error.message}`);
      return null;
    }
  }
  
  // Helper method to find a frame using different naming patterns
  async _findFrameInDirectory(frame, directory) {
    try {
      // Get all frame files in the directory
      const files = await fs.promises.readdir(directory);
      const frameFiles = files.filter(file => file.startsWith('frame-') && file.endsWith('.jpg'));
      
      // If no frames found, return null
      if (!frameFiles.length) {
        return null;
      }
      
      // Try to find a match by timestamp
      if (frame.timestamp !== undefined) {
        const minutes = Math.floor(frame.timestamp / 60).toString().padStart(2, '0');
        const seconds = Math.floor(frame.timestamp % 60).toString().padStart(2, '0');
        const timePattern = `frame-${minutes}m${seconds}s.jpg`;
        
        const timeMatch = frameFiles.find(file => file === timePattern);
        if (timeMatch) {
          return path.join(directory, timeMatch);
        }
      }
      
      // Try to find a match by frame index
      if (frame.frame_index !== undefined) {
        const indexPattern = `frame-${frame.frame_index.toString().padStart(4, '0')}.jpg`;
        const indexMatch = frameFiles.find(file => file === indexPattern);
        if (indexMatch) {
          return path.join(directory, indexMatch);
        }
      }
      
      // If still not found, just use the first frame file as a fallback
      logger.warn(`Using fallback frame file for frame ID: ${frame.id}`);
      return path.join(directory, frameFiles[0]);
    } catch (error) {
      logger.error(`Error finding frame in directory: ${error.message}`);
      return null;
    }
  }
  
  async _generateVideoSummary(videoPath, videoId) {
    try {
      logger.info(`Generating summary for video ID: ${videoId}`);
      
      // Get complete transcription
      const transcription = await this.db.all(
        `SELECT * FROM video_transcriptions WHERE video_id = ? ORDER BY start_time`,
        [videoId]
      );
      
      // Get all analyzed frames 
      const frames = await this.db.all(
        `SELECT * FROM video_frames WHERE video_id = ? AND analysis IS NOT NULL ORDER BY frame_index`,
        [videoId]
      );
      
      // Process each frame to extract structured analysis
      const processedFrames = frames.map(frame => {
        try {
          const analysis = JSON.parse(frame.analysis);
          return {
            timestamp: frame.timestamp,
            description: analysis.description || '',
            frameIndex: frame.frame_index,
            // Support both old and new analysis format
            visibleText: analysis.visibleText || '',
            educationalConcepts: analysis.educationalConcepts || [],
            keyElements: analysis.keyElements || [],
            notableVisualDetails: analysis.notableVisualDetails || []
          };
        } catch (e) {
          return {
            timestamp: frame.timestamp,
            description: "Unable to parse frame analysis",
            visibleText: '',
            educationalConcepts: [],
            keyElements: [],
            notableVisualDetails: [],
            frameIndex: frame.frame_index
          };
        }
      });
      
      // Extract key educational concepts across all frames (if available)
      const allConcepts = processedFrames.flatMap(frame => frame.educationalConcepts);
      const conceptFrequency = {};
      allConcepts.forEach(concept => {
        if (concept) {
          conceptFrequency[concept] = (conceptFrequency[concept] || 0) + 1;
        }
      });
      
      // Get top concepts (sorted by frequency) or extract from descriptions
      let topConcepts = Object.entries(conceptFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([concept]) => concept);
      
      // If no concepts were found (using new simplified analysis), extract from descriptions
      if (topConcepts.length === 0) {
        // Extract likely educational concepts from descriptions using common phrases
        const descriptions = processedFrames.map(f => f.description).join(' ');
        const conceptRegex = /(blockchain|crypto|digital identity|web3|DID|verification|credentials|tokens|wallet|ledger|distributed|consensus|education|learning|certificate|authentication|authorization|privacy|security|encryption)/gi;
        const matches = descriptions.match(conceptRegex) || [];
        
        // Count and sort them
        const conceptCounts = {};
        matches.forEach(match => {
          const normalized = match.toLowerCase();
          conceptCounts[normalized] = (conceptCounts[normalized] || 0) + 1;
        });
        
        topConcepts = Object.entries(conceptCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([concept]) => concept);
      }
      
      // Compile enhanced content for analysis
      const videoContent = {
        transcription: transcription.map(t => t.text).join(' '),
        frames: processedFrames,
        topConcepts: topConcepts,
        visualSummary: processedFrames.map((f, idx) => 
          `Frame ${idx+1} [${Math.floor(f.timestamp / 60)}:${Math.floor(f.timestamp % 60).toString().padStart(2, '0')}]: ${f.description}`
        ).join('\n\n').substring(0, 3000) // Limit to 3000 chars
      };
      
      // Use Grok to generate an enhanced summary
      const summary = await grokService.generateVideoSummary(videoContent);
      
      // Store summary in database
      await this.db.run(
        `INSERT OR REPLACE INTO video_summaries 
           (video_id, title, overview, key_points) 
         VALUES (?, ?, ?, ?)`,
        [
          videoId,
          summary.title || `Educational Video: ${path.basename(videoPath)}`,
          summary.overview || "This educational video covers important concepts related to blockchain technology.",
          JSON.stringify(summary.keyPoints || [])
        ]
      );
      
      logger.info(`Generated summary for video ID: ${videoId}`);
      return true;
    } catch (error) {
      logger.error(`Error generating summary for video ID: ${videoId}`, { error: error.message });
      throw error;
    }
  }
  
  /**
   * Generate a conversational quiz based on video content with improved topic detection
   * @param {number} videoId - Video ID
   * @returns {Promise<number>} - Quiz ID
   */
  async _generateVideoQuiz(videoId) {
    try {
      logger.info(`Generating quiz for video ID: ${videoId}`);
      
      // Get video data
      const video = await this.db.get(
        'SELECT * FROM educational_videos WHERE id = ?',
        [videoId]
      );
      
      if (!video) {
        throw new Error(`Video with ID ${videoId} not found`);
      }
      
      // Get the video summary
      const summary = await this.db.get(
        'SELECT * FROM video_summaries WHERE video_id = ?',
        [videoId]
      );
      
      if (!summary) {
        throw new Error(`Summary for video ID ${videoId} not found, run generate_summary step first`);
      }
      
      // Get transcript - use our new method to get the full transcript
      const fullTranscript = await this.getFullTranscript(videoId);
      
      if (!fullTranscript) {
        logger.warn(`No transcript available for video ID ${videoId}, quiz quality may be reduced`);
      }
      
      // Get frame analyses for visual content
      const frames = await this.db.all(
        'SELECT * FROM video_frames WHERE video_id = ? AND analysis IS NOT NULL ORDER BY frame_index',
        [videoId]
      );
      
      // Parse frame analyses
      const frameAnalyses = [];
      for (const frame of frames) {
        try {
          if (frame.analysis) {
            const analysis = JSON.parse(frame.analysis);
            frameAnalyses.push({
              frameIndex: frame.frame_index,
              timestamp: frame.timestamp,
              description: analysis.description || '',
              educationalConcepts: analysis.educationalConcepts || [],
              objects: analysis.objects || []
            });
          }
        } catch (parseError) {
          logger.warn(`Failed to parse frame analysis for frame ${frame.frame_index}`, { error: parseError.message });
        }
      }
      
      // Extract key educational concepts across all frames
      const allConcepts = frameAnalyses.flatMap(frame => frame.educationalConcepts);
      const conceptFrequency = {};
      allConcepts.forEach(concept => {
        if (concept) {
          conceptFrequency[concept] = (conceptFrequency[concept] || 0) + 1;
        }
      });
      
      // Get top concepts (sorted by frequency)
      const topConcepts = Object.entries(conceptFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([concept]) => concept);
      
      // Compile comprehensive content for quiz generation with improved topic extraction
      const videoContent = {
        title: summary.title || video.name,
        overview: summary.overview || '',
        keyPoints: JSON.parse(summary.key_points || '[]'),
        // Add topic field to help focus the quiz
        topic: summary.topics ? JSON.parse(summary.topics)[0] : topConcepts[0] || summary.title,
        // Use the full transcript
        transcription: summary.transcript || fullTranscript || '',
        frames: frameAnalyses,
        frameCount: frames.length,
        // Add additional context to help Grok generate more relevant questions
        visualContent: frameAnalyses.map(f => `[${Math.floor(f.timestamp / 60)}:${Math.floor(f.timestamp % 60).toString().padStart(2, '0')}] ${f.description}`).join('\n\n')
      };
      
      // Use Grok to generate a conversational quiz with more specific instructions
      const quiz = await grokService.generateConversationalQuiz({
        content: videoContent,
        questionCount: 5, // Increase from 3 to 5 questions for more comprehensive quiz
        difficulty: 'medium',
        includeVisualContent: true // Flag to include visual content
      });
      
      // Store quiz in database
      const quizResult = await this.db.run(
        `INSERT INTO video_quizzes 
           (video_id, title, description, question_count, difficulty, questions) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          videoId,
          quiz.title || `Quiz: ${summary.title || video.name}`,
          quiz.description || 'Test your knowledge about this educational content',
          quiz.questions ? quiz.questions.length : 5,
          quiz.difficulty || 'medium',
          JSON.stringify(quiz.questions || [])
        ]
      );
      
      // Update video record to indicate it has a quiz
      await this.db.run(
        `UPDATE educational_videos SET has_quiz = 1 WHERE id = ?`,
        [videoId]
      );
      
      logger.info(`Generated quiz for video ID: ${videoId} with ${quiz.questions ? quiz.questions.length : 0} questions`);
      
      return {
        quizId: quizResult.lastID,
        title: quiz.title,
        description: quiz.description,
        questionCount: quiz.questions ? quiz.questions.length : 0,
        questions: quiz.questions
      };
    } catch (error) {
      logger.error(`Error generating quiz for video ID: ${videoId}`, { error: error.message });
      throw error;
    }
  }
  
  async getVideoData(cid) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      logger.info(`Getting video data for CID: ${cid}`);
      
      // Get basic video info
      const videoInfo = await this.db.get(
        `SELECT * FROM educational_videos WHERE cid = ?`,
        [cid]
      );
      
      if (!videoInfo) {
        logger.info(`No video found in database for CID: ${cid}`);
        return null;
      }
      
      // Get summary if available
      const summary = await this.db.get(
        `SELECT * FROM video_summaries WHERE video_id = ?`,
        [videoInfo.id]
      );
      
      // Get transcript segments
      const transcripts = await this.db.all(
        `SELECT * FROM video_transcriptions WHERE video_id = ? ORDER BY start_time`,
        [videoInfo.id]
      );
      
      // Get frame analysis count
      const frameAnalysis = await this.db.get(
        `SELECT COUNT(*) as total, 
                SUM(CASE WHEN analysis_status = 'completed' THEN 1 ELSE 0 END) as completed
         FROM video_frames WHERE video_id = ?`,
        [videoInfo.id]
      );
      
      // Get quiz info if available
      const quiz = await this.db.get(
        `SELECT * FROM video_quizzes WHERE video_id = ?`,
        [videoInfo.id]
      );
      
      // Combine all data
      const videoData = {
        ...videoInfo,
        summary: summary || null,
        frame_analysis: frameAnalysis || { total: 0, completed: 0 },
        transcript: transcripts || [],
        quiz: quiz || null,
        metadata: videoInfo.metadata ? JSON.parse(videoInfo.metadata) : {}
      };
      
      logger.info(`Retrieved complete data for video CID: ${cid}`);
      return videoData;
    } catch (error) {
      logger.error(`Error getting video data for CID: ${cid}`, { error: error.message });
      return null;
    }
  }
  
  /**
   * Process a video by its CID
   * @param {string} cid - Content ID of the video
   * @param {Object} options - Processing options
   * @returns {Promise<Object|null>} - The processed video record or null if failed
   */
  async processVideoByCid(cid, options = {}) {
    try {
      logger.info(`Processing video with CID: ${cid}`);
      
      // Ensure database is initialized
      await sqliteService.ensureInitialized();
      const db = sqliteService.db;
      
      // Check if video exists in the database
      let videoRecord = await db.get(
        'SELECT * FROM educational_videos WHERE cid = ?',
        [cid]
      );
      
      if (!videoRecord) {
        logger.info(`Video with CID ${cid} not found in database, creating basic record`);
        
        // Create a basic video entry 
        const videoInfo = {
          cid: cid,
          name: `Video ${cid.slice(0, 8)}...`,
          title: `Educational Video (${cid.slice(0, 8)}...)`,
          overview: `Educational video with CID: ${cid}`,
          type: 'educational'
        };
        
        // Insert directly into database
        const result = await db.run(
          `INSERT INTO educational_videos 
             (cid, name, title, overview, type, processed, processing)
           VALUES (?, ?, ?, ?, ?, 0, 1)`,
          [
            videoInfo.cid,
            videoInfo.name,
            videoInfo.title,
            videoInfo.overview,
            videoInfo.type
          ]
        );
        
        videoRecord = await db.get(
          'SELECT * FROM educational_videos WHERE id = ?',
          [result.lastID]
        );
      } else {
        // Update processing status
        await db.run(
          'UPDATE educational_videos SET processing = 1 WHERE id = ?',
          [videoRecord.id]
        );
      }
      
      // Run full processing pipeline
      if (options.force || !videoRecord.processed) {
        // Setup processing directory
        const videoDir = path.join(this.processingDir, `processed/${videoRecord.id}`);
        if (!fs.existsSync(videoDir)) {
          fs.mkdirSync(videoDir, { recursive: true });
        }
        
        // Create frames directory
        const framesDir = path.join(videoDir, 'frames');
        if (!fs.existsSync(framesDir)) {
          fs.mkdirSync(framesDir, { recursive: true });
        }
        
        // Create audio directory
        const audioDir = path.join(videoDir, 'audio');
        if (!fs.existsSync(audioDir)) {
          fs.mkdirSync(audioDir, { recursive: true });
        }
        
        // Download the video if needed
        logger.info(`Downloading video from Jackal: ${cid}`);
        
        try {
          // Import jackalPinService directly to avoid circular dependencies
          const jackalPinService = require('./jackalPinService').jackalPinService;
          await jackalPinService.ensureInitialized();
          
          const downloadOptions = {
            outputDir: path.join(this.processingDir, 'downloads'),
            force: options.forceDownload || false,
            timeout: options.downloadTimeout || 300000
          };
          
          const downloadResult = await jackalPinService.downloadFile(cid, downloadOptions);
          if (!downloadResult || !downloadResult.success) {
            throw new Error(`Failed to download video: ${downloadResult ? downloadResult.error : 'Unknown error'}`);
          }
          
          const videoPath = downloadResult.filePath;
          logger.info(`Video downloaded to ${videoPath}`);
          
          // Process speech to text
          if (options.force || !videoRecord.has_transcription) {
            // Extract audio
            const audioPath = path.join(audioDir, 'audio.wav');
            await this._extractAudio(videoPath, audioPath);
            
            // Transcribe audio
            await this._generateTranscription(videoPath, audioDir, videoRecord.id);
            
            // Mark as having transcription
            await db.run(
              `UPDATE educational_videos SET has_transcription = 1 WHERE id = ?`,
              [videoRecord.id]
            );
          }
          
          // Process video frames
          if (options.force || !videoRecord.has_frame_analysis) {
            // Extract frames
            const frameCount = await this._extractFrames(videoPath, framesDir, videoRecord.id);
            
            // Analyze frames
            await this._analyzeVideoFrames(videoRecord.id);
            
            // Mark as having frame analysis
            await db.run(
              `UPDATE educational_videos SET has_frame_analysis = 1 WHERE id = ?`,
              [videoRecord.id]
            );
          }
          
          // Generate summary
          if (options.force || !videoRecord.has_summary) {
            await this._generateVideoSummary(videoPath, videoRecord.id);
            
            // Mark as having summary
            await db.run(
              `UPDATE educational_videos SET has_summary = 1 WHERE id = ?`,
              [videoRecord.id]
            );
          }
          
          // Generate quiz
          if (options.force || !videoRecord.has_quiz) {
            await this._generateVideoQuiz(videoRecord.id);
            
            // Mark as having quiz
            await db.run(
              `UPDATE educational_videos SET has_quiz = 1 WHERE id = ?`,
              [videoRecord.id]
            );
          }
          
          // Generate PDF report
          const reportResult = await this._generatePDFReport(videoRecord.id);
          
          // Mark as processed
          await db.run(
            `UPDATE educational_videos 
             SET processed = 1, processing = 0, processed_at = CURRENT_TIMESTAMP,
             pdf_report_path = ?
             WHERE id = ?`,
            [reportResult.reportPath, videoRecord.id]
          );
          
          logger.info(`Completed processing video with CID: ${cid}`);
        } catch (processingError) {
          logger.error(`Error during video processing: ${processingError.message}`, { 
            error: processingError.stack, 
            cid 
          });
          
          await db.run(
            `UPDATE educational_videos 
             SET processing = 0, last_error = ?, last_error_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [processingError.message, videoRecord.id]
          );
          
          throw processingError;
        }
      } else {
        logger.info(`Video with CID ${cid} is already processed`);
      }
      
      // Get the updated video record
      const updatedVideo = await db.get(
        `SELECT ev.*, vs.title, vs.overview 
         FROM educational_videos ev 
         LEFT JOIN video_summaries vs ON ev.id = vs.video_id 
         WHERE ev.cid = ?`,
        [cid]
      );
      
      return updatedVideo;
    } catch (error) {
      logger.error(`Error processing video with CID ${cid}`, { error: error.stack });
      
      // Update error status in database
      try {
        const db = sqliteService.db;
        const video = await db.get(
          'SELECT * FROM educational_videos WHERE cid = ?',
          [cid]
        );
        
        if (video) {
          await db.run(
            `UPDATE educational_videos 
             SET processing = 0, last_error = ?, last_error_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [error.message, video.id]
          );
        }
      } catch (dbError) {
        logger.error(`Error updating video status: ${dbError.message}`);
      }
      
      throw error;
    }
  }
  
  /**
   * Generate a PDF report for the processed video
   * @param {number} videoId - Video ID in the database
   * @param {Object} options - PDF generation options
   * @returns {Promise<Object>} - PDF generation results
   * @private
   */
  async _generatePDFReport(videoId, options = {}) {
    try {
      logger.info(`Generating PDF report for video ID: ${videoId}`);
      
      // Get video data from database
      const video = await this.db.get(
        'SELECT * FROM educational_videos WHERE id = ?',
        [videoId]
      );
      
      if (!video) {
        throw new Error(`Video not found with ID: ${videoId}`);
      }
      
      // Get frames data for the video
      const frames = await this.db.all(
        `SELECT * FROM video_frames 
         WHERE video_id = ? AND analysis_status = 'completed'
         ORDER BY frame_index`,
        [videoId]
      );
      
      // Get video summary
      const summary = await this.db.get(
        'SELECT * FROM video_summaries WHERE video_id = ?',
        [videoId]
      );
      
      // Get transcription data
      const transcript = await this.db.all(
        'SELECT * FROM video_transcriptions WHERE video_id = ? ORDER BY start_time',
        [videoId]
      );
      
      // Get quiz for the video
      const quiz = await this.db.get(
        'SELECT * FROM video_quizzes WHERE video_id = ?',
        [videoId]
      );
      
      // Prepare data for PDF generation
      const reportData = {
        id: video.id,
        title: video.name,
        cid: video.cid,
        created_at: video.created_at,
        processed_at: video.processed_at,
        frames: frames.map(frame => {
          // Try to parse analysis JSON if it's a string
          if (frame.analysis && typeof frame.analysis === 'string') {
            try {
              frame.analysis = JSON.parse(frame.analysis);
            } catch (e) {
              // Leave as is if parsing fails
            }
          }
          
          return {
            id: frame.id,
            path: frame.frame_path,
            timestamp: frame.timestamp,
            analysis: frame.analysis
          };
        }),
        summary: summary ? {
          overview: summary.summary_text,
          keyPoints: summary.key_points ? JSON.parse(summary.key_points) : []
        } : null,
        transcript: transcript,
        quiz: quiz
      };
      
      // Generate PDF report
      const pdfService = require('../../services/pdfReportService');
      await pdfService.initialize();
      
      const reportPath = await pdfService.generatePDFReport(reportData, {
        filename: `video-analysis-${videoId}.pdf`
      });
      
      // Update video record with PDF path
      await this.db.run(
        'UPDATE educational_videos SET pdf_report_path = ? WHERE id = ?',
        [reportPath, videoId]
      );
      
      logger.info(`PDF report generated for video ID ${videoId} at ${reportPath}`);
      
      return {
        reportPath,
        videoId
      };
    } catch (error) {
      logger.error(`Error generating PDF report: ${error.message}`, { videoId, error: error.stack });
      throw error;
    }
  }
  
  /**
   * Get PDF report path for a video
   * @param {string|number} identifier - Video ID or CID
   * @returns {Promise<string|null>} - PDF report path or null if not available
   */
  async getPDFReportPath(identifier) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      let videoId;
      
      // Check if identifier is a CID or ID
      if (typeof identifier === 'string' && !(/^\d+$/.test(identifier))) {
        // It's a CID
        const video = await this.db.get(
          'SELECT id FROM educational_videos WHERE cid = ?',
          [identifier]
        );
        
        if (!video) {
          return null;
        }
        
        videoId = video.id;
      } else {
        // It's an ID
        videoId = identifier;
      }
      
      // Get PDF report path
      const result = await this.db.get(
        'SELECT pdf_report_path FROM educational_videos WHERE id = ?',
        [videoId]
      );
      
      if (!result || !result.pdf_report_path) {
        return null;
      }
      
      // Check if file exists
      if (!fs.existsSync(result.pdf_report_path)) {
        logger.warn(`PDF report file not found at: ${result.pdf_report_path}`);
        return null;
      }
      
      return result.pdf_report_path;
    } catch (error) {
      logger.error(`Error getting PDF report path: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Generate PDF report for a video if it doesn't exist already
   * @param {string|number} identifier - Video ID or CID
   * @returns {Promise<string|null>} - Path to the PDF report or null on failure
   */
  async generatePDFReportIfNeeded(identifier) {
    try {
      // First check if PDF report already exists
      const existingPath = await this.getPDFReportPath(identifier);
      if (existingPath) {
        return existingPath;
      }
      
      let videoId;
      
      // Check if identifier is a CID or ID
      if (typeof identifier === 'string' && !(/^\d+$/.test(identifier))) {
        // It's a CID
        const video = await this.db.get(
          'SELECT id FROM educational_videos WHERE cid = ?',
          [identifier]
        );
        
        if (!video) {
          return null;
        }
        
        videoId = video.id;
      } else {
        // It's an ID
        videoId = identifier;
      }
      
      // Generate PDF report
      const result = await this._generatePDFReport(videoId);
      
      if (result && result.reportPath) {
        return result.reportPath;
      }
      
      return null;
    } catch (error) {
      logger.error(`Error generating PDF report: ${error.message}`);
      return null;
    }
  }

  /**
   * Get full transcript for a video
   * @param {number} videoId - The database ID of the video
   * @returns {Promise<string>} - Full transcript text
   */
  async getFullTranscript(videoId) {
    try {
      logger.info(`Retrieving full transcript for video ID: ${videoId}`);
      
      // Get all transcript segments ordered by start time
      const segments = await this.db.all(
        `SELECT * FROM video_transcriptions 
         WHERE video_id = ? 
         ORDER BY start_time ASC`,
        [videoId]
      );
      
      if (!segments || segments.length === 0) {
        logger.warn(`No transcript segments found for video ID: ${videoId}`);
        return '';
      }
      
      // Concatenate all segments with timestamps
      const formattedTranscript = segments.map(segment => {
        const startMinutes = Math.floor(segment.start_time / 60);
        const startSeconds = Math.floor(segment.start_time % 60);
        const timestamp = `[${startMinutes}:${startSeconds.toString().padStart(2, '0')}]`;
        return `${timestamp} ${segment.text}`;
      }).join('\n\n');
      
      // Also create a plain text version without timestamps
      const plainTranscript = segments.map(segment => segment.text).join(' ');
      
      logger.info(`Retrieved transcript with ${segments.length} segments`);
      
      // Store the full transcript in the video_summaries table for easy access
      await this._storeFullTranscript(videoId, plainTranscript, formattedTranscript);
      
      return formattedTranscript;
    } catch (error) {
      logger.error(`Error retrieving full transcript for video ID: ${videoId}`, { error: error.message });
      return '';
    }
  }
  
  /**
   * Store full transcript in the video_summaries table
   * @param {number} videoId - The database ID of the video
   * @param {string} plainTranscript - Transcript without timestamps
   * @param {string} formattedTranscript - Transcript with timestamps
   * @private
   */
  async _storeFullTranscript(videoId, plainTranscript, formattedTranscript) {
    try {
      // Check if summary exists
      const summary = await this.db.get(
        'SELECT * FROM video_summaries WHERE video_id = ?',
        [videoId]
      );
      
      if (summary) {
        // Update existing summary
        await this.db.run(
          `UPDATE video_summaries 
           SET transcript = ?,
               formatted_transcript = ?
           WHERE video_id = ?`,
          [plainTranscript, formattedTranscript, videoId]
        );
      } else {
        // Insert new record with just the transcript
        await this.db.run(
          `INSERT INTO video_summaries 
           (video_id, title, overview, key_points, transcript, formatted_transcript) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [videoId, '', '', '[]', plainTranscript, formattedTranscript]
        );
      }
      
      logger.info(`Stored full transcript for video ID: ${videoId}`);
    } catch (error) {
      logger.error(`Error storing full transcript for video ID: ${videoId}`, { error: error.message });
    }
  }
}

module.exports = new VideoProcessor(); 