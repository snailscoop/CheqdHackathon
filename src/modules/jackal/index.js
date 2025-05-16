/**
 * Jackal Module
 * 
 * Provides integration with Jackal Protocol for video processing and IPFS pinning.
 */

const jackalPinService = require('./jackalPinService');
const processingQueue = require('./processingQueue');
const jackalMonitor = require('./jackalMonitor');
const videoProcessor = require('./videoProcessor');

module.exports = {
  jackalPinService,
  processingQueue,
  jackalMonitor,
  videoProcessor,
  
  /**
   * Initialize the Jackal module
   * @returns {Promise<boolean>} Initialization status
   */
  async initialize() {
    try {
      await jackalPinService.initialize();
      await processingQueue.initialize();
      await jackalMonitor.initialize();
      
      return true;
    } catch (error) {
      console.error('Failed to initialize Jackal module:', error);
      return false;
    }
  },
  
  /**
   * Start the Jackal monitoring service
   * @param {number} intervalMinutes - Interval in minutes between checks
   * @returns {Promise<void>}
   */
  async startMonitoring(intervalMinutes = 1440) {
    return jackalMonitor.startMonitoring(intervalMinutes);
  },
  
  /**
   * Stop the Jackal monitoring service
   * @returns {Promise<void>}
   */
  async stopMonitoring() {
    return jackalMonitor.stopMonitoring();
  }
}; 