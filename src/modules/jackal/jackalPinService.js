const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const logger = require('../../utils/logger');
const config = require('../../config/config');
const db = require('../../db/sqliteService');
const path = require('path');
const crypto = require('crypto');
const jackalClient = require('../../clients/jackalClient');
const sqliteService = require('../../db/sqliteService');

/**
 * Service for interacting with Jackal PIN API
 */
class JackalPinService {
  constructor() {
    this.baseUrl = config.jackal?.apiUrl || 'https://api.jackalprotocol.com';
    this.ipfsUrl = config.jackal?.ipfsUrl || 'https://ipfs.jackallabs.io/ipfs';
    this.apiKey = config.jackal?.pinApiKey;
    this.pinDirectory = config.jackal?.pinDirectory || './data/pins';
    this.ipfsGateways = [
      'https://ipfs.jackallabs.io',
      'https://ipfs.io',
      'https://cloudflare-ipfs.com',
      'https://gateway.pinata.cloud'
    ];
    this.initialized = false;
  }

  /**
   * Initialize the service
   */
  async initialize() {
    if (!this.apiKey) {
      logger.warn('Jackal PIN API key not configured');
      return false;
    }

    try {
      // Ensure the table exists for tracking pinned files
      await db.run(`
        CREATE TABLE IF NOT EXISTS jackal_pins (
          id TEXT PRIMARY KEY,
          cid TEXT NOT NULL,
          name TEXT,
          size INTEGER,
          mime_type TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          status TEXT DEFAULT 'active',
          metadata TEXT
        )
      `);
      
      // Create index for CID lookups
      await db.run(`
        CREATE INDEX IF NOT EXISTS idx_jackal_pins_cid ON jackal_pins(cid)
      `);

      // Ensure the pin directory exists
      if (!fs.existsSync(this.pinDirectory)) {
        fs.mkdirSync(this.pinDirectory, { recursive: true });
      }

      this.initialized = true;
      logger.info('Jackal PIN Service initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Jackal PIN Service', { error: error.message });
      return false;
    }
  }

  /**
   * Test the API connection
   * @returns {Promise<boolean>} Connection status
   */
  async testConnection() {
    try {
      const response = await this._makeRequest('GET', '/test');
      logger.info('Jackal PIN API connection test successful', { message: response.message });
      return true;
    } catch (error) {
      logger.error('Failed to connect to Jackal PIN API', { error: error.message });
      return false;
    }
  }

  /**
   * List files from PIN API
   * @param {Object} options - Query options
   * @param {number} options.page - Page number for pagination
   * @param {number} options.limit - Number of items per page
   * @param {string} options.name - Filter by file name
   * @returns {Promise<Array>} List of files
   */
  async listFiles(options = {}) {
    try {
      const queryParams = new URLSearchParams();
      if (options.page !== undefined) queryParams.append('page', options.page);
      if (options.limit !== undefined) queryParams.append('limit', options.limit);
      if (options.name) queryParams.append('name', options.name);

      const queryString = queryParams.toString();
      const url = `/files${queryString ? '?' + queryString : ''}`;
      
      const response = await this._makeRequest('GET', url);
      
      // Store files in SQLite for tracking/caching
      if (response.files && response.files.length) {
        await this._updateLocalPinCache(response.files);
      }
      
      logger.info('Retrieved files from Jackal PIN API', { 
        count: response.count,
        files: response.files?.length
      });
      
      return response.files || [];
    } catch (error) {
      logger.error('Failed to list files from Jackal PIN API', { error: error.message });
      throw error;
    }
  }

  /**
   * Upload a file to Jackal PIN
   * @param {string} filePath - Path to the file to upload
   * @returns {Promise<Object>} Upload result with CID
   */
  async uploadFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));

      const response = await this._makeRequest('POST', '/files', formData, {
        headers: {
          ...formData.getHeaders()
        }
      });

      // Store pin info in local database
      await this._storePinInfo(response);

      logger.info('File uploaded to Jackal PIN', { 
        name: response.name,
        cid: response.cid
      });

      return response;
    } catch (error) {
      logger.error('Failed to upload file to Jackal PIN', { 
        error: error.message,
        filePath
      });
      throw error;
    }
  }

  /**
   * Upload multiple files to Jackal PIN using v1 API
   * @param {Array<string>} filePaths - Paths to files to upload
   * @returns {Promise<Array>} Upload results
   */
  async uploadMultipleFiles(filePaths) {
    try {
      const formData = new FormData();
      
      // Add each file to the form data
      for (const filePath of filePaths) {
        if (!fs.existsSync(filePath)) {
          logger.warn(`File not found: ${filePath}, skipping`);
          continue;
        }
        
        formData.append('files', fs.createReadStream(filePath));
      }

      const response = await this._makeRequest('POST', '/v1/files', formData, {
        headers: {
          ...formData.getHeaders()
        }
      });

      // Store each pin in the local database
      if (Array.isArray(response)) {
        for (const fileInfo of response) {
          await this._storePinInfo(fileInfo);
        }
      }

      logger.info('Multiple files uploaded to Jackal PIN', { 
        count: response.length
      });

      return response;
    } catch (error) {
      logger.error('Failed to upload multiple files to Jackal PIN', { 
        error: error.message,
        filePaths
      });
      throw error;
    }
  }

  /**
   * Delete a file from Jackal PIN
   * @param {string} fileId - ID of the file to delete
   * @returns {Promise<boolean>} Success indicator
   */
  async deleteFile(fileId) {
    try {
      await this._makeRequest('DELETE', `/files/${fileId}`);
      
      // Update local database to mark file as deleted
      await db.run(`
        UPDATE jackal_pins 
        SET status = 'deleted', 
            metadata = json_set(metadata, '$.deleted_at', ?)
        WHERE id = ?
      `, [new Date().toISOString(), fileId]);
      
      logger.info('File deleted from Jackal PIN', { fileId });
      return true;
    } catch (error) {
      logger.error('Failed to delete file from Jackal PIN', { 
        error: error.message,
        fileId
      });
      throw error;
    }
  }

  /**
   * Get IPFS URL for a CID
   * @param {string} cid - Content ID
   * @param {string} filename - Optional filename
   * @returns {string} IPFS URL
   */
  getIpfsUrl(cid, filename = null) {
    if (!cid) return null;
    
    let url = `${this.ipfsUrl}/${cid}`;
    if (filename) {
      url += `?filename=${encodeURIComponent(filename)}`;
    }
    
    return url;
  }

  /**
   * Download a file from IPFS by CID
   * @param {string} cid - Content ID to download
   * @param {Object} options - Download options
   * @param {boolean} options.force - Force re-download even if file exists
   * @param {number} options.timeout - Download timeout in ms (default: 120000)
   * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
   * @returns {Promise<string>} File path where the content was saved
   */
  async downloadFile(cid, options = {}) {
    const defaultOptions = {
      outputDir: path.join(this.pinDirectory, 'downloads'),
      force: false,
      timeout: 60000,
      maxRetries: 3,
      updateStatus: true
    };
    
    const opts = { ...defaultOptions, ...options };
    
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Create output directory if it doesn't exist
      if (!fs.existsSync(opts.outputDir)) {
        fs.mkdirSync(opts.outputDir, { recursive: true });
      }
      
      // Generate output file path
      const filePath = path.join(opts.outputDir, cid);
      
      // Check if file already exists (and force is not enabled)
      if (fs.existsSync(filePath) && !opts.force) {
        logger.info(`File already downloaded: ${filePath}`);
        
        // If the file exists but has zero bytes, it might be corrupted
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
          logger.warn(`Found zero-byte file for CID: ${cid}. Will re-download.`);
        } else {
          return { 
            success: true, 
            filePath,
            message: 'File already exists'
          };
        }
      }
      
      // Prepare to download from IPFS gateway
      logger.info(`Downloading file for CID: ${cid}`);
      
      // Update status to downloading if requested
      if (opts.updateStatus) {
        try {
          await this.updateVideoStatus(cid, 'downloading', null);
        } catch (statusErr) {
          logger.warn(`Failed to update status for CID: ${cid}`, { error: statusErr.message });
          // Continue with download despite status update failure
        }
      }

      // Use direct IPFS URL for download
      const ipfsUrl = `${this.ipfsUrl}/${cid}`;
      try {
        const response = await axios({
          method: 'get',
          url: ipfsUrl,
          responseType: 'stream',
          timeout: opts.timeout
        });
        
        // Create write stream
        const writer = fs.createWriteStream(filePath);
        
        // Pipe the data to the file
        response.data.pipe(writer);
        
        // Wait for the download to complete
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        
        logger.info(`Successfully downloaded CID: ${cid} to ${filePath}`);
        
        // Update status to downloaded if requested
        if (opts.updateStatus) {
          try {
            await this.updateVideoStatus(cid, 'downloaded', null);
          } catch (statusErr) {
            logger.warn(`Failed to update status for CID: ${cid}`, { error: statusErr.message });
          }
        }
        
        return { 
          success: true, 
          filePath,
          message: 'File downloaded successfully'
        };
        
      } catch (downloadError) {
        logger.error(`Failed to download from IPFS gateway: ${downloadError.message}`, { cid });
        throw new Error(`Failed to download CID: ${cid} - ${downloadError.message}`);
      }
      
    } catch (error) {
      logger.error(`Error downloading file: ${error.message}`, { 
        error: error.stack, 
        cid
      });
      
      // Update status to error if requested
      if (opts.updateStatus) {
        try {
          await this.updateVideoStatus(cid, 'error', error.message);
        } catch (statusErr) {
          logger.warn(`Failed to update error status for CID: ${cid}`, { error: statusErr.message });
        }
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Update video processing status in database
   * @param {string} cid - Content ID
   * @param {string} status - Status to set
   * @param {string|null} errorMessage - Optional error message
   * @returns {Promise<boolean>} - Success status
   */
  async updateVideoStatus(cid, status, errorMessage = null) {
    try {
      await sqliteService.ensureInitialized();
      const db = sqliteService.db;
      
      if (errorMessage) {
        await db.run(
          `UPDATE educational_videos SET 
             processing = CASE WHEN ? = 'error' THEN 0 ELSE processing END,
             processed = CASE WHEN ? = 'completed' THEN 1 ELSE processed END,
             last_error = ?,
             last_error_at = CURRENT_TIMESTAMP
           WHERE cid = ?`,
          [status, status, errorMessage, cid]
        );
      } else {
        await db.run(
          `UPDATE educational_videos SET 
             processing = CASE WHEN ? IN ('downloading', 'processing') THEN 1 ELSE 0 END,
             processed = CASE WHEN ? = 'completed' THEN 1 ELSE processed END
           WHERE cid = ?`,
          [status, status, cid]
        );
      }
      
      logger.info(`Updated status for CID: ${cid} to ${status}`);
      return true;
    } catch (error) {
      logger.error(`Failed to update status for CID: ${cid}`, { error: error.message });
      return false;
    }
  }

  /**
   * Pin a file by CID
   * @param {string} cid - Content ID to pin
   * @returns {Promise<Object>} Pin result
   */
  async pinFile(cid) {
    try {
      if (!cid) {
        throw new Error('CID is required');
      }
      
      const response = await this._makeRequest('POST', '/pins', {
        cid
      });
      
      // Store pin info in local database
      await this._storePinInfo({
        id: response.id,
        cid,
        name: response.name || `Pin-${cid.substring(0, 8)}`
      });
      
      logger.info('File pinned to Jackal PIN', { 
        cid,
        pinId: response.id
      });
      
      return response;
    } catch (error) {
      logger.error('Failed to pin file to Jackal PIN', { 
        error: error.message,
        cid
      });
      throw error;
    }
  }
  
  /**
   * Get a list of files from local database
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of files
   */
  async getLocalPins(options = {}) {
    try {
      let query = `
        SELECT id, cid, name, size, mime_type, created_at, status, metadata
        FROM jackal_pins
        WHERE status = 'active'
      `;
      
      const params = [];
      
      if (options.name) {
        query += ` AND name LIKE ?`;
        params.push(`%${options.name}%`);
      }
      
      if (options.cid) {
        query += ` AND cid = ?`;
        params.push(options.cid);
      }
      
      query += ` ORDER BY created_at DESC`;
      
      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }
      
      if (options.offset) {
        query += ` OFFSET ?`;
        params.push(options.offset);
      }
      
      const rows = await db.all(query, params);
      
      return rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      }));
    } catch (error) {
      logger.error('Failed to get local pins', { error: error.message });
      throw error;
    }
  }

  /**
   * Store pin info in local database
   * @param {Object} pinInfo - Pin information
   * @returns {Promise<void>}
   * @private
   */
  async _storePinInfo(pinInfo) {
    try {
      const { id, cid, name, size, mimeType } = pinInfo;
      
      // Store metadata as a JSON string
      const metadata = JSON.stringify({
        ...pinInfo,
        updated_at: new Date().toISOString()
      });
      
      await db.run(`
        INSERT OR REPLACE INTO jackal_pins (id, cid, name, size, mime_type, status, metadata)
        VALUES (?, ?, ?, ?, ?, 'active', ?)
      `, [id, cid, name, size || 0, mimeType, metadata]);
    } catch (error) {
      logger.error('Failed to store pin info', { error: error.message, pinInfo });
      // Don't throw error to avoid disrupting the main flow
    }
  }
  
  /**
   * Update local pin cache with multiple files
   * @param {Array} files - Array of file objects
   * @returns {Promise<void>}
   * @private
   */
  async _updateLocalPinCache(files) {
    try {
      for (const file of files) {
        await this._storePinInfo(file);
      }
    } catch (error) {
      logger.error('Failed to update local pin cache', { error: error.message });
      // Don't throw error to avoid disrupting the main flow
    }
  }

  /**
   * Make a request to the Jackal PIN API
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {any} data - Request body
   * @param {Object} options - Additional axios options
   * @returns {Promise<any>} Response data
   * @private
   */
  async _makeRequest(method, path, data = null, options = {}) {
    try {
      const url = this.baseUrl + path;
      
      const response = await axios({
        method,
        url,
        data,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': data instanceof FormData ? 'multipart/form-data' : 'application/json',
          ...options.headers
        },
        ...options
      });
      
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const responseData = error.response?.data;
      
      logger.error('Jackal PIN API request failed', {
        method,
        path,
        status,
        responseData,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Pin a video to Jackal
   * @param {String} videoUrl - URL of the video to pin
   * @param {Object} options - Pinning options
   * @returns {Promise<Object>} - Pinning result
   */
  async pinVideo(videoUrl, options = {}) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      logger.info('Pinning video to Jackal', { videoUrl });
      
      // Mock implementation
      const videoId = 'mock-' + crypto.randomBytes(8).toString('hex');
      
      // Store metadata
      const metadata = {
        videoId,
        url: videoUrl,
        title: options.title || 'Untitled Video',
        description: options.description || '',
        status: 'pending',
        pinnedAt: new Date().toISOString()
      };
      
      fs.writeFileSync(
        path.join(this.pinDirectory, `${videoId}.json`),
        JSON.stringify(metadata, null, 2)
      );
      
      return { 
        success: true, 
        videoId,
        message: 'Video pinning initiated (mock)' 
      };
    } catch (error) {
      logger.error('Failed to pin video', { error: error.message, videoUrl });
      
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
  
  /**
   * Get the status of a pinned video
   * @param {String} videoId - ID of the video
   * @returns {Promise<Object>} - Video status
   */
  async getVideoStatus(videoId) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Mock implementation
      const metadataPath = path.join(this.pinDirectory, `${videoId}.json`);
      
      if (!fs.existsSync(metadataPath)) {
        return null;
      }
      
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      
      // Simulate processing completion after a few seconds
      if (metadata.status === 'pending') {
        const pinnedAtTime = new Date(metadata.pinnedAt).getTime();
        const currentTime = new Date().getTime();
        
        if (currentTime - pinnedAtTime > 5000) {
          metadata.status = 'completed';
          metadata.ipfsHash = 'ipfs://mock-' + crypto.randomBytes(16).toString('hex');
          
          fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        }
      }
      
      return {
        videoId,
        status: metadata.status,
        ipfsHash: metadata.ipfsHash || null
      };
    } catch (error) {
      logger.error('Failed to get video status', { error: error.message, videoId });
      return null;
    }
  }
  
  /**
   * Get the transcript of a video
   * @param {String} videoId - ID of the video
   * @returns {Promise<String>} - Video transcript
   */
  async getVideoTranscript(videoId) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Mock implementation
      return "This is a mock transcript for video with ID: " + videoId;
    } catch (error) {
      logger.error('Failed to get video transcript', { error: error.message, videoId });
      return null;
    }
  }
  
  /**
   * Sync pinned contents from Jackal
   */
  async syncPinnedContents() {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      logger.info('Syncing pinned contents from Jackal (mock)');
      
      // Mock implementation
      return { success: true, syncedItems: 0 };
    } catch (error) {
      logger.error('Failed to sync pinned contents', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  // Required method by the serviceConnector
  async shutdown() {
    logger.info('Shutting down Jackal PIN service');
    return true;
  }

  /**
   * Ensure the service is initialized
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.initialized;
  }
}

// Export singleton instance
const jackalPinService = new JackalPinService();

/**
 * Get video data by CID
 * @param {string} cid - The content ID to retrieve
 * @returns {Promise<Object|null>} - Video data or null if not found
 */
async function getVideoData(cid) {
  try {
    logger.info(`Retrieving video data for CID: ${cid}`);
    
    // First check if we have it in our database
    await sqliteService.ensureInitialized();
    const db = sqliteService.db;
    
    const videoData = await db.get(`
      SELECT ev.*, vs.title, vs.overview, vs.key_points
      FROM educational_videos ev
      LEFT JOIN video_summaries vs ON ev.id = vs.video_id
      WHERE ev.cid = ?
    `, [cid]);
    
    if (videoData) {
      logger.info(`Found video data in database for CID: ${cid}`);
      return videoData;
    }
    
    // If not in database, try to retrieve the metadata from Jackal
    logger.info(`Video data not in database, retrieving metadata from Jackal for CID: ${cid}`);
    
    // Create a basic video entry for now, don't try to process it immediately
    const videoInfo = {
      cid: cid,
      name: `Video ${cid.slice(0, 8)}...`,
      title: `Educational Video (${cid.slice(0, 8)}...)`,
      overview: `Educational video with CID: ${cid}`,
      type: 'educational'
    };
    
    try {
      // Insert basic info into database without doing a full retrieval
      await db.run(
        `INSERT INTO educational_videos
          (cid, name, title, overview, type, processed, processing)
         VALUES (?, ?, ?, ?, ?, 0, 0)`,
        [
          videoInfo.cid,
          videoInfo.name,
          videoInfo.title,
          videoInfo.overview,
          videoInfo.type
        ]
      );
      
      const insertedVideo = await db.get(
        'SELECT * FROM educational_videos WHERE cid = ?',
        [cid]
      );
      
      return insertedVideo;
    } catch (insertError) {
      logger.error(`Failed to insert basic video data: ${insertError.message}`);
      return null;
    }
  } catch (error) {
    logger.error(`Error retrieving video data: ${error.message}`, { error, cid });
    return null;
  }
}

module.exports = {
  jackalPinService,
  getVideoData,
}; 