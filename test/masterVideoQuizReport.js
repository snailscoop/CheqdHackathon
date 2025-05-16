/**
 * Master Video Quiz HTML Report Generator
 * 
 * This script processes a video through the quiz pipeline and generates
 * a detailed HTML report showing:
 * 1. Frame-by-frame analysis
 * 2. Vosk transcription
 * 3. Grok processing details
 * 4. Quiz simulation and results
 */

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const sqliteService = require('../src/db/sqliteService');
const videoProcessor = require('../src/modules/jackal/videoProcessor');
const jackalService = require('../src/modules/jackal/jackalPinService');
const grokService = require('../src/services/grokService');

// Capture all events for reporting
const reportData = {
  cid: null,
  startTime: null,
  endTime: null,
  frames: [],
  transcription: [],
  grokProcessing: [],
  summary: null,
  quiz: null,
  quizSimulation: null,
  errors: []
};

// Intercept logger for reporting
const originalInfo = logger.info;
const originalError = logger.error;

logger.info = function(message, meta) {
  originalInfo(message, meta);
  reportData.grokProcessing.push({
    type: 'info',
    timestamp: new Date().toISOString(),
    message,
    meta
  });
};

logger.error = function(message, meta) {
  originalError(message, meta);
  reportData.grokProcessing.push({
    type: 'error',
    timestamp: new Date().toISOString(),
    message,
    meta
  });
  
  reportData.errors.push({
    timestamp: new Date().toISOString(),
    message,
    meta
  });
};

/**
 * Run a master video quiz test and generate HTML report
 */
async function runMasterVideoQuizReport(cid) {
  try {
    reportData.cid = cid;
    reportData.startTime = new Date().toISOString();
    
    logger.info(`Starting master video quiz report for CID: ${cid}`);
    
    // Ensure DB and services are initialized
    await sqliteService.ensureInitialized();
    await grokService.initialize();
    await videoProcessor.initialize();
    await jackalService.ensureInitialized();
    
    // Store original frame rate
    const originalFrameRate = videoProcessor.frameRate;
    
    // Configure video processor to use our desired settings
    // We'll dynamically adjust the frame rate based on video duration to get exactly 10 frames
    videoProcessor.frameCount = 10; // Add a property to control number of frames
    
    // Create a patched version of the _extractFrames method that captures frames for report
    const originalExtractFrames = videoProcessor._extractFrames;
    videoProcessor._extractFrames = async function(videoPath, framesDir, videoId) {
      try {
        logger.info(`Extracting exactly ${this.frameCount} equally-spaced frames from video: ${path.basename(videoPath)}`);
        
        // First, get video duration
        const { execSync } = require('child_process');
        const durationCmd = `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`;
        const durationOutput = execSync(durationCmd).toString().trim();
        const duration = parseFloat(durationOutput);
        
        if (isNaN(duration) || duration <= 0) {
          throw new Error('Could not determine video duration');
        }
        
        logger.info(`Video duration: ${duration} seconds`);
        
        // Calculate frame intervals to get exactly frameCount frames
        // Avoid going to the very end of the video which can sometimes cause issues
        const safeEndTime = Math.max(0, duration - 0.5); // 0.5 second before the end
        const interval = safeEndTime / (this.frameCount - 1);
        
        // Extract frames at calculated times
        let frameCount = 0;
        for (let i = 0; i < this.frameCount; i++) {
          const time = i * interval;
          
          // Make sure we don't go beyond video duration
          if (time >= duration) {
            logger.warn(`Skipping frame at ${time}s which is beyond video duration of ${duration}s`);
            continue;
          }
          
          // Format timestamp as minutes and seconds
          const minutes = Math.floor(time / 60).toString().padStart(2, '0');
          const seconds = Math.floor(time % 60).toString().padStart(2, '0');
          const timestamp = `${minutes}m${seconds}s`;
          
          const outputFrame = path.join(framesDir, `frame-${timestamp}.jpg`);
          
          // Create a backup numeric format filename for compatibility
          const numericFormat = frameCount.toString().padStart(4, '0');
          const altOutputFrame = path.join(framesDir, `frame-${numericFormat}.jpg`);
          
          // Use -y flag to force overwrite, -update 1 to fix pattern issues, and -strict unofficial for YUV range
          const command = `ffmpeg -y -ss ${time} -i "${videoPath}" -frames:v 1 -q:v 2 -update 1 -strict unofficial "${outputFrame}"`;
          execSync(command);
          
          // Also create a copy with the numeric format for compatibility
          try {
            if (fs.existsSync(outputFrame)) {
              // Create a hard copy of the file with numeric format
              fs.copyFileSync(outputFrame, altOutputFrame);
              logger.debug(`Created alternate frame file: ${path.basename(altOutputFrame)}`);
            }
          } catch (copyErr) {
            logger.warn(`Could not create alternate frame file: ${path.basename(altOutputFrame)}`, { error: copyErr.message });
          }
          
          // Store frame information in database
          await this.db.run(
            `INSERT INTO video_frames (video_id, frame_path, alternative_path, timestamp, frame_index, analysis_status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [videoId, outputFrame, altOutputFrame, time, frameCount]
          );
          
          // Copy frame to report data
          const frameBase64 = fs.readFileSync(outputFrame).toString('base64');
          reportData.frames.push({
            index: frameCount,
            timestamp: time,
            formattedTime: `${minutes}m${seconds}s`,
            path: outputFrame,
            base64: frameBase64,
            analysis: null
          });
          
          frameCount++;
        }
        
        logger.info(`Extracted ${frameCount} frames from video`);
        return frameCount;
      } catch (error) {
        logger.error(`Error extracting frames: ${path.basename(videoPath)}`, { error: error.message });
        throw error;
      }
    };
    
    // Intercept frame analysis to capture for report
    const originalAnalyzeFrames = videoProcessor._analyzeVideoFrames;
    videoProcessor._analyzeVideoFrames = async function(videoId) {
      try {
        logger.info(`Analyzing frames for video ID: ${videoId}`);
        
        // Get all frames that need analysis
        const frames = await this.db.all(
          `SELECT * FROM video_frames WHERE video_id = ? AND analysis_status = 'pending' ORDER BY frame_index`,
          [videoId]
        );
        
        if (!frames || frames.length === 0) {
          logger.info(`No frames found for analysis for video ID: ${videoId}`);
          return false;
        }
        
        logger.info(`Found ${frames.length} frames to analyze for video ID: ${videoId}`);
        
        // Process each frame and capture the analysis
        for (const frame of frames) {
          try {
            // Use frame.frame_path directly (this should be the full path to the image)
            const framePath = frame.frame_path;
            
            logger.info(`Analyzing frame: ${path.basename(framePath)} for video ID: ${videoId}`);
            
            // Check if the file exists
            if (!fs.existsSync(framePath)) {
              logger.error(`Frame file not found: ${framePath}`);
              await this.db.run(
                `UPDATE video_frames SET analysis_status = 'error', analysis_error = ? WHERE id = ?`,
                [`Image file not found: ${framePath}`, frame.id]
              );
              continue;
            }
            
            // Analyze the frame using the Grok service
            const analysis = await grokService.analyzeImage(framePath, {
              type: 'educational',
              context: `This is frame ${frame.frame_index} from an educational video`
            });
            
            // Store the analysis results
            await this.db.run(
              `UPDATE video_frames SET analysis = ?, analysis_status = 'completed' WHERE id = ?`,
              [JSON.stringify(analysis), frame.id]
            );
            
            // Update report data with analysis
            const frameIndex = reportData.frames.findIndex(f => f.index === frame.frame_index);
            if (frameIndex !== -1) {
              reportData.frames[frameIndex].analysis = analysis;
            }
            
            logger.info(`Completed analysis for frame: ${path.basename(framePath)}`);
          } catch (error) {
            logger.error(`Error analyzing frame: ${frame.id}`, { error: error.message });
            
            // Update the frame with error status
            await this.db.run(
              `UPDATE video_frames SET analysis_status = 'error', analysis_error = ? WHERE id = ?`,
              [error.message, frame.id]
            );
          }
        }
        
        return true;
      } catch (error) {
        logger.error(`Error in frame analysis for video ID: ${videoId}`, { error: error.message });
        throw error;
      }
    };
    
    // Intercept transcription generation to capture for report
    const originalGenerateTranscription = videoProcessor._generateTranscription;
    videoProcessor._generateTranscription = async function(videoPath, audioDir, videoId) {
      const result = await originalGenerateTranscription.call(this, videoPath, audioDir, videoId);
      
      // Get transcription data from database and store in report
      const transcription = await this.db.all(
        `SELECT * FROM video_transcriptions WHERE video_id = ? ORDER BY start_time`,
        [videoId]
      );
      
      reportData.transcription = transcription.map(t => ({
        id: t.id,
        start: t.start_time,
        end: t.end_time,
        text: t.text,
        confidence: t.confidence
      }));
      
      return result;
    };
    
    // Intercept summary generation to capture for report
    const originalGenerateSummary = videoProcessor._generateVideoSummary;
    videoProcessor._generateVideoSummary = async function(videoPath, videoId) {
      const result = await originalGenerateSummary.call(this, videoPath, videoId);
      
      // Get summary from database
      const summary = await this.db.get(
        `SELECT * FROM video_summaries WHERE video_id = ?`,
        [videoId]
      );
      
      if (summary) {
        reportData.summary = {
          title: summary.title,
          overview: summary.overview,
          keyPoints: JSON.parse(summary.key_points || '[]')
        };
      }
      
      return result;
    };
    
    // Intercept quiz generation to capture for report
    const originalGenerateQuiz = videoProcessor._generateVideoQuiz;
    videoProcessor._generateVideoQuiz = async function(videoId) {
      const result = await originalGenerateQuiz.call(this, videoId);
      
      // Get quiz from database
      const quiz = await this.db.get(
        `SELECT * FROM video_quizzes WHERE video_id = ?`,
        [videoId]
      );
      
      if (quiz) {
        reportData.quiz = {
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          questionCount: quiz.question_count,
          difficulty: quiz.difficulty,
          questions: JSON.parse(quiz.questions || '[]')
        };
      }
      
      return result;
    };
    
    // Process video with master quiz settings
    const result = await videoProcessor.processVideoByCid(cid, {
      name: `Master-Quiz-${cid.substring(0, 8)}`,
      force: true  // Force reprocessing even if already processed
    });
    
    // Test quiz interaction - simulate a user taking the quiz
    if (result.quiz && result.quiz.questions && result.quiz.questions.length > 0) {
      logger.info(`Simulating quiz interaction for ${result.quiz.questions.length} questions`);
      
      const quizResults = [];
      
      // For each question, generate a simulated user response and evaluate it
      for (let i = 0; i < result.quiz.questions.length; i++) {
        const question = result.quiz.questions[i];
        
        // Have Grok generate a simulated user response to the question
        const simulatedResponseData = await grokService.chatCompletion([
          { 
            role: 'system', 
            content: 'You are simulating a human learner answering educational quiz questions. Provide a thoughtful, realistic answer that demonstrates understanding but may include minor misconceptions or incompleteness as a real student might. Aim for 2-3 sentences.'
          },
          { 
            role: 'user',
            content: `Provide a realistic student answer to this educational quiz question about a video:\n\n${question.question}`
          }
        ]);
        
        const simulatedResponse = simulatedResponseData.choices[0].message.content;
        logger.info(`Question ${i+1}: ${question.question.substring(0, 50)}...`);
        logger.info(`Simulated response: ${simulatedResponse.substring(0, 50)}...`);
        
        // Evaluate the simulated user response
        const evaluation = await grokService.evaluateQuizResponse({
          question: question,
          userResponse: simulatedResponse
        });
        
        // Record the result
        quizResults.push({
          questionId: question.id,
          question: question.question,
          simulatedResponse,
          evaluation
        });
        
        logger.info(`Evaluation score: ${evaluation.score}, Correct: ${evaluation.correct}`);
      }
      
      // Calculate overall quiz performance
      const averageScore = quizResults.reduce((sum, item) => sum + item.evaluation.score, 0) / quizResults.length;
      const correctCount = quizResults.filter(item => item.evaluation.correct).length;
      
      logger.info(`Quiz simulation complete. Average score: ${averageScore.toFixed(1)}, Correct answers: ${correctCount}/${quizResults.length}`);
      
      // Store quiz results in report data
      reportData.quizSimulation = {
        averageScore,
        correctCount,
        totalQuestions: quizResults.length,
        questionResults: quizResults
      };
    }
    
    // Restore original methods
    videoProcessor.frameRate = originalFrameRate;
    videoProcessor._extractFrames = originalExtractFrames;
    videoProcessor._analyzeVideoFrames = originalAnalyzeFrames;
    videoProcessor._generateTranscription = originalGenerateTranscription;
    videoProcessor._generateVideoSummary = originalGenerateSummary;
    videoProcessor._generateVideoQuiz = originalGenerateQuiz;
    delete videoProcessor.frameCount;
    
    // Set completion time
    reportData.endTime = new Date().toISOString();
    
    // Generate HTML report
    const reportPath = path.join(process.cwd(), 'reports', `video-quiz-report-${cid.substring(0, 8)}.html`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, generateHtmlReport(reportData));
    
    logger.info(`Report generated at: ${reportPath}`);
    console.log(`\nHTML Report generated: ${reportPath}\n`);
    
    // Restore original logger
    logger.info = originalInfo;
    logger.error = originalError;
    
    return {
      success: true,
      reportPath,
      videoId: result.video.id,
      quizId: result.quiz?.id,
      quizTitle: result.quiz?.title || 'Master Video Quiz',
      quizQuestions: result.quiz?.questions?.length || 0
    };
  } catch (error) {
    logger.error(`Error in master video quiz report: ${error.message}`);
    
    // Restore original methods and logger
    logger.info = originalInfo;
    logger.error = originalError;
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate an HTML report from the report data
 */
function generateHtmlReport(data) {
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Master Video Quiz Report: ${data.cid}</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9f9f9;
    }
    h1, h2, h3, h4 {
      color: #2c3e50;
    }
    .header {
      background-color: #2c3e50;
      color: white;
      padding: 20px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .section {
      background-color: white;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .frame {
      border: 1px solid #ddd;
      padding: 15px;
      margin-bottom: 15px;
      border-radius: 5px;
    }
    .frame-img {
      max-width: 100%;
      max-height: 300px;
      display: block;
      margin-bottom: 10px;
    }
    .transcription-item {
      padding: 10px;
      border-bottom: 1px solid #eee;
    }
    .log-item {
      padding: 8px;
      border-bottom: 1px solid #eee;
      font-family: monospace;
      white-space: pre-wrap;
      font-size: 0.9em;
    }
    .log-info {
      color: #2c3e50;
    }
    .log-error {
      color: #e74c3c;
      background-color: #fadbd8;
    }
    .quiz-question {
      background-color: #eef2f7;
      padding: 15px;
      margin-bottom: 15px;
      border-radius: 5px;
    }
    .quiz-response {
      margin: 10px 0;
      padding: 10px;
      background-color: #f8f9fa;
      border-left: 3px solid #6c757d;
    }
    .quiz-evaluation {
      margin: 10px 0;
      padding: 10px;
      background-color: #e3f2fd;
      border-left: 3px solid #2196f3;
    }
    .correct {
      color: #28a745;
    }
    .incorrect {
      color: #dc3545;
    }
    .tab-container {
      margin-bottom: 20px;
    }
    .tab-buttons {
      display: flex;
      margin-bottom: 10px;
    }
    .tab-button {
      padding: 10px 15px;
      background-color: #f1f1f1;
      border: none;
      cursor: pointer;
      margin-right: 2px;
    }
    .tab-button.active {
      background-color: #2c3e50;
      color: white;
    }
    .tab-content {
      display: none;
      padding: 15px;
      background-color: white;
      border-radius: 0 5px 5px 5px;
    }
    .tab-content.active {
      display: block;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 8px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background-color: #f2f2f2;
    }
    pre {
      background-color: #f8f9fa;
      padding: 10px;
      border-radius: 5px;
      overflow-x: auto;
    }
    .stats {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .stat-card {
      background-color: white;
      padding: 15px;
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      width: 30%;
      margin-bottom: 10px;
    }
    .error-list {
      background-color: #feedeb;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .error-item {
      color: #e74c3c;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid #e74c3c;
    }
    @media (max-width: 768px) {
      .stat-card {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Master Video Quiz Report</h1>
    <p>CID: ${data.cid}</p>
    <p>Generated: ${formatTimestamp(data.endTime)}</p>
  </div>
  
  <!-- Summary Stats -->
  <div class="section">
    <h2>Summary</h2>
    <div class="stats">
      <div class="stat-card">
        <h3>Frames</h3>
        <p>${data.frames.length} frames analyzed</p>
      </div>
      <div class="stat-card">
        <h3>Transcription</h3>
        <p>${data.transcription.length} segments</p>
      </div>
      <div class="stat-card">
        <h3>Processing Time</h3>
        <p>${new Date(data.endTime) - new Date(data.startTime)}ms</p>
      </div>
    </div>
    ${data.errors.length > 0 ? `
    <div class="error-list">
      <h3>Errors (${data.errors.length})</h3>
      ${data.errors.map(err => `
        <div class="error-item">
          <p><strong>${formatTimestamp(err.timestamp)}</strong>: ${err.message}</p>
          ${err.meta ? `<pre>${JSON.stringify(err.meta, null, 2)}</pre>` : ''}
        </div>
      `).join('')}
    </div>
    ` : ''}
  </div>
  
  <!-- Frame Analysis -->
  <div class="section">
    <h2>Frame Analysis</h2>
    ${data.frames.map((frame, index) => `
      <div class="frame">
        <h3>Frame ${index + 1} (${frame.formattedTime})</h3>
        <img class="frame-img" src="data:image/jpeg;base64,${frame.base64}" alt="Frame ${index + 1}">
        
        ${frame.analysis ? `
          <div class="tab-container">
            <div class="tab-buttons">
              <button class="tab-button active" onclick="openTab(event, 'frame${index}-description')">Description</button>
              <button class="tab-button" onclick="openTab(event, 'frame${index}-text')">Visible Text</button>
              <button class="tab-button" onclick="openTab(event, 'frame${index}-concepts')">Educational Concepts</button>
              <button class="tab-button" onclick="openTab(event, 'frame${index}-raw')">Raw Analysis</button>
            </div>
            
            <div id="frame${index}-description" class="tab-content active">
              <p>${frame.analysis.description || 'No description available'}</p>
            </div>
            
            <div id="frame${index}-text" class="tab-content">
              <p>${frame.analysis.visibleText || 'No visible text detected'}</p>
            </div>
            
            <div id="frame${index}-concepts" class="tab-content">
              ${frame.analysis.educationalConcepts && frame.analysis.educationalConcepts.length > 0 
                ? `<ul>${frame.analysis.educationalConcepts.map(concept => `<li>${concept}</li>`).join('')}</ul>` 
                : '<p>No educational concepts identified</p>'}
            </div>
            
            <div id="frame${index}-raw" class="tab-content">
              <pre>${JSON.stringify(frame.analysis, null, 2)}</pre>
            </div>
          </div>
        ` : '<p>No analysis available for this frame</p>'}
      </div>
    `).join('')}
  </div>
  
  <!-- Transcription -->
  <div class="section">
    <h2>Vosk Transcription</h2>
    ${data.transcription.length > 0 ? `
      <table>
        <tr>
          <th>Time</th>
          <th>Text</th>
        </tr>
        ${data.transcription.map(segment => `
          <tr>
            <td>${Math.floor(segment.start / 60)}:${Math.floor(segment.start % 60).toString().padStart(2, '0')} - ${Math.floor(segment.end / 60)}:${Math.floor(segment.end % 60).toString().padStart(2, '0')}</td>
            <td>${segment.text}</td>
          </tr>
        `).join('')}
      </table>
    ` : '<p>No transcription data available</p>'}
  </div>
  
  <!-- Summary -->
  <div class="section">
    <h2>Video Summary</h2>
    ${data.summary ? `
      <h3>${data.summary.title}</h3>
      <p><strong>Overview:</strong> ${data.summary.overview}</p>
      
      <h4>Key Points:</h4>
      <ul>
        ${data.summary.keyPoints.map(point => `<li>${point}</li>`).join('')}
      </ul>
    ` : '<p>No summary data available</p>'}
  </div>
  
  <!-- Quiz -->
  <div class="section">
    <h2>Generated Quiz</h2>
    ${data.quiz ? `
      <h3>${data.quiz.title}</h3>
      <p>${data.quiz.description}</p>
      <p><strong>Difficulty:</strong> ${data.quiz.difficulty}</p>
      <p><strong>Questions:</strong> ${data.quiz.questionCount}</p>
      
      <div class="quiz-questions">
        ${data.quiz.questions.map((question, index) => `
          <div class="quiz-question">
            <h4>Question ${index + 1}: ${question.question}</h4>
            <p><strong>Reference Answer:</strong> ${question.referenceAnswer}</p>
            
            ${data.quizSimulation && data.quizSimulation.questionResults[index] ? `
              <div class="quiz-response">
                <h5>Simulated Student Response:</h5>
                <p>${data.quizSimulation.questionResults[index].simulatedResponse}</p>
              </div>
              
              <div class="quiz-evaluation">
                <h5>Evaluation: <span class="${data.quizSimulation.questionResults[index].evaluation.correct ? 'correct' : 'incorrect'}">${data.quizSimulation.questionResults[index].evaluation.score}/100</span></h5>
                <p><strong>Feedback:</strong> ${data.quizSimulation.questionResults[index].evaluation.feedback}</p>
                <p><strong>Learning Addition:</strong> ${data.quizSimulation.questionResults[index].evaluation.learningAddition}</p>
                <p><strong>Encouragement:</strong> ${data.quizSimulation.questionResults[index].evaluation.encouragement}</p>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
      
      ${data.quizSimulation ? `
        <div class="quiz-results">
          <h3>Quiz Simulation Results</h3>
          <p><strong>Average Score:</strong> ${data.quizSimulation.averageScore.toFixed(1)}/100</p>
          <p><strong>Correct Answers:</strong> ${data.quizSimulation.correctCount}/${data.quizSimulation.totalQuestions}</p>
        </div>
      ` : ''}
    ` : '<p>No quiz data available</p>'}
  </div>
  
  <!-- Grok Processing Log -->
  <div class="section">
    <h2>Grok Processing Log</h2>
    <div class="log-container" style="max-height: 400px; overflow-y: auto;">
      ${data.grokProcessing.map(log => `
        <div class="log-item log-${log.type}">
          <span class="log-timestamp">[${formatTimestamp(log.timestamp)}]</span>
          <span class="log-message">${log.message}</span>
          ${log.meta ? `<div class="log-meta"><pre>${JSON.stringify(log.meta, null, 2)}</pre></div>` : ''}
        </div>
      `).join('')}
    </div>
  </div>
  
  <script>
    function openTab(evt, tabName) {
      const tabContents = evt.currentTarget.parentElement.parentElement.getElementsByClassName("tab-content");
      for (let i = 0; i < tabContents.length; i++) {
        tabContents[i].classList.remove("active");
      }
      
      const tabButtons = evt.currentTarget.parentElement.getElementsByClassName("tab-button");
      for (let i = 0; i < tabButtons.length; i++) {
        tabButtons[i].classList.remove("active");
      }
      
      document.getElementById(tabName).classList.add("active");
      evt.currentTarget.classList.add("active");
    }
  </script>
</body>
</html>`;
}

// Simple CLI interface for testing
async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      console.log('Usage: node masterVideoQuizReport.js <video-cid>');
      process.exit(1);
    }
    
    const cid = args[0];
    const result = await runMasterVideoQuizReport(cid);
    
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

// Run test if this script is executed directly
if (require.main === module) {
  main();
} else {
  // Export for use as a module
  module.exports = { runMasterVideoQuizReport };
} 