# Cheqd Video Processing System

This document explains the Cheqd video processing system, its components, and how to use it for processing educational videos and generating quizzes.

## Overview

The Cheqd video processing system is designed to:

1. Process videos from multiple sources (Jackal, local files, IPFS, S3)
2. Extract and analyze frames from videos
3. Extract and transcribe audio from videos
4. Generate comprehensive summaries of video content
5. Create conversational quizzes based on video content
6. Store processed data in a structured database

## Video Processing Pipeline

The video processing pipeline consists of the following steps:

1. **Video Source Handling**: Downloads/locates video from source (Jackal, local, IPFS, S3)
2. **Frame Extraction**: Extracts frames at defined intervals using FFmpeg
3. **Frame Analysis**: Uses Grok to analyze frame content
4. **Audio Extraction**: Extracts audio track from video
5. **Audio Transcription**: Transcribes audio using Vosk/other services
6. **Summary Generation**: Creates a comprehensive summary of video content
7. **Quiz Generation**: Creates a conversational quiz based on video content

## Database Structure

The system uses SQLite to store video data with the following tables:

- `educational_videos`: Core video metadata
- `video_frames`: Extracted frame data and analysis
- `video_transcriptions`: Transcription segments
- `video_summaries`: Generated summaries
- `video_quizzes`: Generated quizzes
- `quiz_sessions`: User quiz interaction data
- `quiz_states`: User current quiz state

## Using the Video Processor

### Processing a Video

```javascript
// Initialize the video processor
const videoProcessor = require('./modules/jackal/videoProcessor');
await videoProcessor.initialize();

// Process a Jackal video
const result = await videoProcessor.processVideo({
  type: 'jackal',
  id: 'your-jackal-cid-here'
}, {
  steps: ['extract_frames', 'analyze_frames', 'extract_audio', 'transcribe_audio', 'generate_summary', 'generate_quiz']
});

// Process a local video file
const localResult = await videoProcessor.processVideo({
  type: 'local',
  id: 'local-video-id',
  path: '/path/to/your/video.mp4'
}, {
  title: 'My Educational Video',
  description: 'A video about blockchain technology'
});
```

### Getting Video Data

```javascript
// Get video by CID
const videoData = await videoProcessor.getVideoData('your-jackal-cid-here');

// Get video by ID
const videoById = await videoProcessor.getVideoById(123);
```

### Getting Quiz Data

```javascript
// Get quiz for a video
const quiz = await videoProcessor.getVideoQuiz(videoId);

// Format quiz for display
const formattedQuiz = await videoProcessor.formatQuiz(quiz);
```

## Conversational Quiz Structure

Each quiz has the following structure:

```json
{
  "title": "Quiz Title",
  "description": "Quiz description",
  "difficulty": "medium",
  "questions": [
    {
      "id": 1,
      "question": "Question text?",
      "referenceAnswer": "The comprehensive answer",
      "evaluationCriteria": ["Point 1", "Point 2"],
      "followUp": "Follow-up question or comment"
    }
  ]
}
```

## Evaluating Quiz Responses

The system can evaluate user responses to quiz questions:

```javascript
const evaluation = await grokService.evaluateQuizResponse({
  question: question,
  userResponse: "User's answer text",
  videoContext: {
    title: "Video title",
    topic: "Video topic"
  }
});
```

Evaluation results include:
- `score`: Numerical score (40-100)
- `correct`: Boolean indicating if broadly correct
- `feedback`: Evaluation and feedback
- `learningAddition`: Additional information
- `encouragement`: Supportive comment
- `followUpQuestion`: Follow-up question

## Frame Analysis Format

Each frame analysis includes:

```json
{
  "description": "Detailed description of the frame",
  "visibleText": "Text visible in the frame",
  "educationalConcepts": ["Concept 1", "Concept 2"],
  "keyElements": ["Element 1", "Element 2"]
}
```

## Customizing Processing

You can customize the video processing by:

1. Setting `frameRate` (frames per second to extract)
2. Specifying which steps to run in the `steps` option
3. Setting processing options like `continueOnError`
4. Customizing quiz generation parameters

## Integration with Telegram

The system integrates with Telegram to:
1. Allow users to select and watch videos
2. Take interactive quizzes on video content
3. Receive quiz evaluations and feedback
4. Track educational progress

## Supported Video Sources

- **Jackal Network**: Blockchain-based content network
- **Local Files**: Videos stored on the local filesystem
- **IPFS**: InterPlanetary File System videos
- **S3**: Amazon S3 stored videos (implementation pending)

## Error Handling

The system provides robust error handling with:
1. Detailed error logging
2. Ability to continue processing despite errors in specific steps
3. Recovery mechanisms for interrupted processing
4. Frame analysis retry logic

## Future Enhancements

Planned future enhancements include:
1. Additional video source adapters
2. Enhanced frame analysis with more detailed concept extraction
3. Integration with additional LLMs beyond Grok
4. More customizable quiz generation options
5. Enhanced quiz interaction features 