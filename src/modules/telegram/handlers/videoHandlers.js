/**
 * Get PDF report for a video and share it in the chat
 * @param {Object} ctx - Telegram context
 * @param {Object} params - Command parameters with videoId or cid
 * @returns {Promise<void>}
 */
async function getVideoPDF(ctx, params) {
  try {
    const { videoId, cid } = params;
    
    if (!videoId && !cid) {
      return ctx.reply('Please provide a video ID or CID to get the PDF report.');
    }
    
    // Show loading message
    const loadingMsg = await ctx.reply('Generating PDF report, please wait...');
    
    // Generate or retrieve PDF report
    const identifier = videoId || cid;
    const pdfPath = await videoProcessor.generatePDFReportIfNeeded(identifier);
    
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      // Delete loading message
      await ctx.deleteMessage(loadingMsg.message_id).catch(() => {});
      return ctx.reply('No PDF report available for this video. Make sure the video is fully processed first.');
    }
    
    // Get video details for caption
    let videoDetails = null;
    if (cid) {
      videoDetails = await sqliteService.db.get(
        'SELECT title, overview FROM educational_videos WHERE cid = ?',
        [cid]
      );
    } else {
      videoDetails = await sqliteService.db.get(
        'SELECT title, overview FROM educational_videos WHERE id = ?',
        [videoId]
      );
    }
    
    // Create caption
    const caption = videoDetails ? 
      `📊 *Video Analysis Report*\n\n*${videoDetails.title || 'Educational Video'}*\n\n${videoDetails.overview || ''}` : 
      '📊 Video Analysis Report';
    
    // Send PDF file
    await ctx.replyWithDocument({
      source: pdfPath,
      filename: path.basename(pdfPath)
    }, {
      caption,
      parse_mode: 'Markdown'
    });
    
    // Delete loading message
    await ctx.deleteMessage(loadingMsg.message_id).catch(() => {});
  } catch (error) {
    logger.error(`Error getting video PDF: ${error.message}`);
    return ctx.reply(`Error generating PDF report: ${error.message}`);
  }
}

module.exports = {
  getVideoPDF,
}; 