# VideoQuest - Conversational Video Quizzes

VideoQuest is a feature that transforms educational videos stored on Jackal Protocol into interactive, conversational quizzes with blockchain-verified credentials upon completion.

## Overview

VideoQuest processes educational videos through the following pipeline:
1. Video download from Jackal Protocol using CID
2. Frame extraction (2 frames per second) using FFmpeg
3. Audio transcription using Vosk
4. Content analysis with Grok AI
5. Conversational quiz generation
6. Blockchain credential issuance upon completion

## Setup Requirements

### Python Dependencies
Install the required Python packages:
```
pip install -r requirements.txt
```

### Vosk Model
Download the Vosk speech recognition model:
```
mkdir -p models
cd models
wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip
```

### FFmpeg
Ensure FFmpeg is installed on your system:
```
# Ubuntu/Debian
sudo apt-get install ffmpeg

# macOS
brew install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

## Usage

### Bot Commands
- `/videoquiz` or `/vquiz` - List available educational videos for quizzes
- `/testcid <cid>` - Test a specific Jackal CID for quiz generation

### Testing with a Sample CID
```
/testcid bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
```

## Quiz Flow

1. **Video Processing**:
   - Video is downloaded from Jackal
   - Frames are extracted and analyzed
   - Audio is transcribed
   - Content summary is generated

2. **Quiz Generation**:
   - 3-question conversational quiz is created
   - Questions focus on key educational concepts
   - Reference answers and evaluation criteria are prepared

3. **Interaction**:
   - User receives questions one at a time
   - Responses are evaluated with contextual understanding
   - Detailed feedback is provided for each answer

4. **Completion**:
   - Score is calculated based on response quality
   - Educational credential is issued if score is >= 70%
   - Credential is stored on the blockchain for verification

## Credential Issuance

Upon successful completion (score >= 70%), users receive:
- Blockchain-verified educational credential
- Permanent proof of knowledge understanding
- Addition to their educational credential portfolio

## Architecture

### Data Flow
```
Jackal Protocol → Video Download → FFmpeg Processing → Vosk Transcription 
→ Grok Analysis → Quiz Generation → User Interaction → Credential Issuance
```

### Database Schema
- `educational_videos` - Video metadata and processing status
- `video_frames` - Extracted frame data and analysis
- `video_transcriptions` - Speech transcription segments
- `video_summaries` - Generated content summaries
- `video_quizzes` - Generated quiz questions
- `quiz_sessions` - User quiz progress

## Future Improvements

- Multi-part video series with progressive difficulty
- Personalized learning paths based on performance
- Community-contributed educational content
- Integration with learning management systems 

# Master Video Quiz

## Overview

The Master Video Quiz feature is an advanced quiz generation system that creates comprehensive quizzes from educational videos stored on Jackal. Unlike standard quizzes that extract frames at a constant rate (2fps), the Master Video Quiz:

1. Extracts exactly 10 frames equally spaced throughout the video duration
2. Processes the entire audio track for complete transcription
3. Creates a more challenging quiz with 5 questions (vs standard 3)
4. Uses a higher difficulty level for questions

This focused approach enables deeper analysis of key video moments while maintaining full context from the audio transcription.

## How It Works

The Master Video Quiz processing pipeline:

1. **Video Retrieval**: Downloads the specified video from Jackal network using its CID
2. **Frame Extraction**: Calculates video duration and extracts 10 equally-spaced frames to capture key moments
3. **Audio Processing**: Extracts the full audio track and transcribes it using Vosk speech recognition
4. **AI Analysis**: Uses Grok to analyze frames and transcription to understand the educational content
5. **Quiz Generation**: Creates a challenging 5-question quiz that tests deeper understanding of concepts
6. **Credential Issuance**: Awards blockchain-verified credentials to users who pass the quiz

## Usage

To create a Master Video Quiz:

```
/mastervideotest <video-cid>
```

Where `<video-cid>` is the content identifier of a video stored on Jackal network.

### Example

```
/mastervideotest QmYbA3Hvb9P6nPWj6SBx3JZVqwYqoLqXmvK5Zse456C3B
```

## Technical Implementation

The Master Video Quiz feature builds on the existing video processing infrastructure with these key optimizations:

1. **Smart Frame Selection**: Instead of using a constant frame rate, frames are selected using:
   ```javascript
   interval = duration / (frameCount - 1)
   ```

2. **Complete Audio Transcription**: Processes the entire audio track with higher quality settings

3. **Parallel Processing**: Analyzes all frames in parallel for faster processing:
   ```javascript
   await Promise.all(frames.map(async (frame) => {
     // Analyze frame...
   }));
   ```

4. **Advanced Quiz Generation**: Creates more challenging questions:
   ```javascript
   const quiz = await grokService.generateConversationalQuiz({
     content: videoContent,
     questionCount: 5,
     difficulty: 'hard'
   });
   ```

## Dependencies

The Master Video Quiz feature requires:

- **Vosk**: Speech recognition for audio transcription
- **FFmpeg**: For video and audio processing
- **Grok API**: For AI analysis of frames and quiz generation
- **Jackal Network**: For video storage and retrieval

For Python dependencies, see `requirements.txt`.

## Future Enhancements

Planned enhancements include:

- Scene detection for more intelligent frame selection
- Multilingual transcription support
- Enhanced frame analysis using specialized vision models
- Multiple difficulty levels for different learning stages

## Troubleshooting

If you encounter issues:

1. Ensure the video CID is valid and accessible on Jackal
2. Check the processing directory has sufficient disk space
3. Verify Vosk models are installed properly
4. Check API keys for AI services are configured

For detailed error logs, check the application logs for events labeled with "Master Video Quiz". 