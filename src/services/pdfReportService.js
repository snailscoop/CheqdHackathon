/**
 * PDF Report Service
 * 
 * This service generates PDF reports from video analysis data.
 * It supports both direct PDF generation with PDFKit and HTML-to-PDF conversion with Puppeteer.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const puppeteer = require('puppeteer');
const logger = require('../utils/logger');

class PDFReportService {
  constructor() {
    this.initialized = false;
    this.reportsDir = path.join(process.cwd(), 'reports');
  }

  /**
   * Initialize the PDF Report Service
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    // Ensure reports directory exists
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }

    this.initialized = true;
    logger.info('PDF Report Service initialized');
  }

  /**
   * Generate a PDF report from video analysis data using PDFKit
   * @param {Object} videoData - Video analysis data
   * @param {Object} options - Report generation options
   * @returns {Promise<string>} - Path to the generated PDF
   */
  async generatePDFReport(videoData, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const reportFilename = options.filename || `video-analysis-${videoData.id || Date.now()}.pdf`;
    const reportPath = path.join(this.reportsDir, reportFilename);

    return new Promise((resolve, reject) => {
      try {
        // Create a new PDF document
        const doc = new PDFDocument({
          margin: 50,
          size: 'A4',
          info: {
            Title: `Video Analysis Report: ${videoData.title || 'Educational Video'}`,
            Author: 'Cheqd Video Analysis System',
            Subject: 'Video Analysis Report',
            Keywords: 'video analysis, AI, education, blockchain'
          }
        });

        // Pipe output to the file
        const stream = fs.createWriteStream(reportPath);
        doc.pipe(stream);

        // Add title and header
        doc.fontSize(24)
          .fillColor('#333333')
          .text('Video Analysis Report', { align: 'center' })
          .moveDown(0.5);

        // Add video title and metadata
        doc.fontSize(16)
          .fillColor('#0066cc')
          .text(videoData.title || 'Educational Video', { align: 'center' })
          .moveDown(0.5);

        doc.fontSize(12)
          .fillColor('#666666')
          .text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' })
          .moveDown(0.5);

        if (videoData.cid) {
          doc.text(`CID: ${videoData.cid}`, { align: 'center' })
            .moveDown(1);
        }

        // Add section separators
        const addSectionDivider = () => {
          doc.strokeColor('#cccccc')
            .lineWidth(1)
            .moveTo(50, doc.y)
            .lineTo(doc.page.width - 50, doc.y)
            .stroke()
            .moveDown(0.5);
        };

        // Add summary section
        if (videoData.summary) {
          addSectionDivider();
          doc.fontSize(16)
            .fillColor('#333333')
            .text('Summary', { underline: true })
            .moveDown(0.5);

          doc.fontSize(12)
            .fillColor('#000000')
            .text('Overview:', { continued: true, bold: true })
            .text(` ${videoData.summary.overview}`)
            .moveDown(0.5);

          // Add key points if available
          if (videoData.summary.keyPoints && videoData.summary.keyPoints.length > 0) {
            doc.text('Key Points:', { bold: true })
              .moveDown(0.2);

            let keyPoints = Array.isArray(videoData.summary.keyPoints) 
              ? videoData.summary.keyPoints 
              : JSON.parse(videoData.summary.keyPoints || '[]');

            keyPoints.forEach((point, index) => {
              doc.text(`${index + 1}. ${point}`)
                .moveDown(0.2);
            });
          }
          doc.moveDown(0.5);
        }

        // Add transcript section if available
        if (videoData.transcript && videoData.transcript.length > 0) {
          addSectionDivider();
          doc.addPage();
          doc.fontSize(16)
            .fillColor('#333333')
            .text('Video Transcript', { underline: true })
            .moveDown(0.5);

          doc.fontSize(12)
            .fillColor('#000000');

          // Group segments that are close in time
          let groupedTranscript = [];
          let currentGroup = null;

          videoData.transcript.forEach(segment => {
            if (!currentGroup || 
                (segment.start_time - currentGroup.end_time) > 3) { // 3 second gap threshold
              if (currentGroup) {
                groupedTranscript.push(currentGroup);
              }
              currentGroup = {
                start_time: segment.start_time,
                end_time: segment.end_time,
                text: segment.text
              };
            } else {
              currentGroup.end_time = segment.end_time;
              currentGroup.text += ' ' + segment.text;
            }
          });

          if (currentGroup) {
            groupedTranscript.push(currentGroup);
          }

          // Display the grouped transcript
          groupedTranscript.forEach(segment => {
            const startTime = this._formatTimestamp(segment.start_time);
            const endTime = this._formatTimestamp(segment.end_time);
            
            doc.font('Helvetica-Bold')
              .text(`[${startTime} - ${endTime}]`, { continued: false })
              .font('Helvetica')
              .text(segment.text)
              .moveDown(0.5);
            
            // Add page break if getting close to bottom
            if (doc.y > doc.page.height - 150) {
              doc.addPage();
            }
          });
        }

        // Add quiz section if available
        if (videoData.quiz) {
          addSectionDivider();
          doc.addPage();
          doc.fontSize(16)
            .fillColor('#333333')
            .text('Educational Quiz', { underline: true })
            .moveDown(0.5);

          // Quiz title and description
          doc.fontSize(14)
            .fillColor('#0066cc')
            .text(videoData.quiz.title || 'Educational Quiz')
            .moveDown(0.3);

          doc.fontSize(12)
            .fillColor('#000000')
            .text(videoData.quiz.description || 'Test your knowledge with this quiz.')
            .moveDown(1);

          // Quiz questions
          const questions = videoData.quiz.questions && typeof videoData.quiz.questions === 'string'
            ? JSON.parse(videoData.quiz.questions) 
            : (videoData.quiz.questions || []);

          questions.forEach((question, index) => {
            doc.fontSize(12)
              .fillColor('#000000')
              .font('Helvetica-Bold')
              .text(`Question ${index + 1}: `, { continued: true })
              .font('Helvetica')
              .text(question.question)
              .moveDown(0.5);

            // Reference answer
            if (question.referenceAnswer) {
              doc.font('Helvetica-Bold')
                .text('Reference Answer: ', { continued: true })
                .font('Helvetica')
                .text(question.referenceAnswer)
                .moveDown(0.5);
            }

            // Add page break if getting close to bottom
            if (doc.y > doc.page.height - 150) {
              doc.addPage();
            }
          });
        }

        // Add frame analysis section (if available)
        if (videoData.frames && videoData.frames.length > 0) {
          addSectionDivider();
          doc.addPage();
          doc.fontSize(16)
            .fillColor('#333333')
            .text('Frame Analysis', { underline: true })
            .moveDown(0.5);

          // Include all frames with their analysis
          const keyFrames = videoData.frames.filter(f => f.analysis);
          
          keyFrames.forEach((frame, index) => {
            // Add frame number and timestamp
            doc.fontSize(14)
              .fillColor('#0066cc')
              .text(`Frame ${index + 1}`, { continued: true })
              .fillColor('#666666')
              .text(` (${this._formatTimestamp(frame.timestamp)})`)
              .moveDown(0.3);

            // Add frame image if available
            if (frame.path && fs.existsSync(frame.path)) {
              try {
                doc.image(frame.path, {
                  fit: [400, 225],
                  align: 'center'
                }).moveDown(0.3);
              } catch (imgErr) {
                logger.warn(`Could not embed frame image: ${imgErr.message}`);
              }
            }

            // Add frame analysis
            if (frame.analysis) {
              const analysis = typeof frame.analysis === 'string' 
                ? JSON.parse(frame.analysis) 
                : frame.analysis;

              doc.fontSize(12)
                .fillColor('#000000')
                .text('Description:', { bold: true, continued: true })
                .text(` ${analysis.description || 'No description available'}`)
                .moveDown(0.3);

              // Add visible text if available
              if (analysis.visibleText) {
                doc.text('Visible Text:', { bold: true, continued: true })
                  .text(` ${analysis.visibleText}`)
                  .moveDown(0.3);
              }

              // Add educational concepts if available
              if (analysis.educationalConcepts && analysis.educationalConcepts.length > 0) {
                doc.text('Educational Concepts:', { bold: true })
                  .moveDown(0.2);

                analysis.educationalConcepts.forEach(concept => {
                  doc.text(`• ${concept}`)
                    .moveDown(0.1);
                });
                doc.moveDown(0.2);
              }
            }

            // Add page break if not the last frame
            if (index < keyFrames.length - 1) {
              doc.addPage();
            }
          });
        }

        // Finalize the PDF and end the stream
        doc.end();

        // Handle stream events
        stream.on('finish', () => {
          logger.info(`PDF report generated successfully at ${reportPath}`);
          resolve(reportPath);
        });

        stream.on('error', (err) => {
          logger.error(`Error writing PDF report: ${err.message}`);
          reject(err);
        });
      } catch (error) {
        logger.error(`Error generating PDF report: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * Generate a PDF report from HTML content using Puppeteer
   * @param {string} htmlContent - HTML content to convert to PDF
   * @param {Object} options - Report generation options
   * @returns {Promise<string>} - Path to the generated PDF
   */
  async generatePDFFromHTML(htmlContent, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const reportFilename = options.filename || `video-analysis-${Date.now()}.pdf`;
      const reportPath = path.join(this.reportsDir, reportFilename);

      // Create a temporary HTML file
      const tempHtmlPath = path.join(this.reportsDir, `temp-${Date.now()}.html`);
      fs.writeFileSync(tempHtmlPath, htmlContent);

      // Launch browser
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();

      // Load HTML content
      await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'networkidle0' });

      // Generate PDF
      await page.pdf({
        path: reportPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '1cm',
          right: '1cm',
          bottom: '1cm',
          left: '1cm'
        }
      });

      // Close browser and clean up temp file
      await browser.close();
      fs.unlinkSync(tempHtmlPath);

      logger.info(`PDF report generated from HTML at ${reportPath}`);
      return reportPath;
    } catch (error) {
      logger.error(`Error generating PDF from HTML: ${error.message}`);
      throw error;
    }
  }

  /**
   * Format a timestamp to human-readable format
   * @param {number} timestamp - Timestamp in seconds
   * @returns {string} - Formatted timestamp
   * @private
   */
  _formatTimestamp(timestamp) {
    if (!timestamp && timestamp !== 0) return 'N/A';
    
    const minutes = Math.floor(timestamp / 60);
    const seconds = Math.floor(timestamp % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

module.exports = new PDFReportService(); 