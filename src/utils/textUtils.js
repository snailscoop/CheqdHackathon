/**
 * Text Utilities
 * 
 * Common utilities for text processing, formatting, and manipulation.
 */

/**
 * Truncate text to a specified length with an ellipsis
 * @param {String} text - Text to truncate
 * @param {Number} length - Maximum length
 * @param {String} [suffix='...'] - Suffix to append
 * @returns {String} - Truncated text
 */
function truncate(text, length, suffix = '...') {
  if (!text) return '';
  
  if (text.length <= length) {
    return text;
  }
  
  return text.substring(0, length - suffix.length) + suffix;
}

/**
 * Format date string to a human-readable format
 * @param {String|Date} date - Date to format
 * @param {Object} options - Locale options
 * @returns {String} - Formatted date
 */
function formatDate(date, options = {}) {
  if (!date) return 'Unknown';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  const defaultOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options
  };
  
  return dateObj.toLocaleDateString('en-US', defaultOptions);
}

/**
 * Format relative time (e.g., "2 hours ago")
 * @param {String|Date} date - Date to format
 * @returns {String} - Relative time string
 */
function timeAgo(date) {
  if (!date) return 'Unknown';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now - dateObj;
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(months / 12);
  
  if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
}

/**
 * Escape markdown characters in text
 * @param {String} text - Text to escape
 * @returns {String} - Escaped text
 */
function escapeMarkdown(text) {
  if (!text) return '';
  
  return text
    .replace(/\_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\~/g, '\\~')
    .replace(/\`/g, '\\`')
    .replace(/\>/g, '\\>')
    .replace(/\#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/\-/g, '\\-')
    .replace(/\=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/\!/g, '\\!');
}

/**
 * Strip HTML tags from text
 * @param {String} html - HTML text
 * @returns {String} - Plain text
 */
function stripHtml(html) {
  if (!html) return '';
  
  return html.replace(/<[^>]*>?/gm, '');
}

/**
 * Convert bytes to human-readable size
 * @param {Number} bytes - Size in bytes
 * @param {Number} [decimals=2] - Decimal places
 * @returns {String} - Formatted size
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Extract URLs from text
 * @param {String} text - Text to search
 * @returns {Array} - Array of URLs
 */
function extractUrls(text) {
  if (!text) return [];
  
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
}

/**
 * Slugify text (convert to URL-friendly format)
 * @param {String} text - Text to slugify
 * @returns {String} - Slugified text
 */
function slugify(text) {
  if (!text) return '';
  
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * Capitalize first letter of each word
 * @param {String} text - Text to capitalize
 * @returns {String} - Capitalized text
 */
function capitalizeWords(text) {
  if (!text) return '';
  
  return text.replace(/\w\S*/g, (word) => {
    return word.charAt(0).toUpperCase() + word.substr(1).toLowerCase();
  });
}

module.exports = {
  truncate,
  formatDate,
  timeAgo,
  escapeMarkdown,
  stripHtml,
  formatBytes,
  extractUrls,
  slugify,
  capitalizeWords
}; 