# Educational Quiz Guidelines

This document outlines best practices and requirements for adding new videos to the conversational quiz feature of the cheqd-bot.

## Video Requirements

1. **Quality** - Videos should have clear audio and good resolution
2. **Length** - Optimal length is 5-15 minutes for educational videos
3. **Content** - Content should be educational and related to Akash Network, cheqd, or relevant blockchain topics
4. **Format** - Support for MP4, WebM, and other standard formats
5. **Transcript** - Videos should ideally include a transcript for generating better quiz questions

## Quiz Testing Procedure

Before making any new educational video available to users through the conversational quiz feature, follow these steps:

1. **Upload the video** - Upload the video to Jackal storage using the appropriate command
2. **Generate initial quiz** - After uploading, get the CID of the video
3. **Test the quiz** - Use the admin-only test command to verify all aspects of the quiz:

```
/testquiz <video-cid>
```

This command will:
- Verify the video can be found
- Test quiz generation
- Validate the quiz data structure
- Test database interactions
- Simulate a full quiz flow

4. **Fix any issues** - If the test identifies problems, fix them before making the quiz public
5. **Verify manually** - Take the quiz yourself once to ensure a good user experience

## Common Issues and Solutions

### 1. Quiz Generation Fails

- **Possible causes**:
  - Video transcript is missing
  - Video content is not clear or educational
  - Integration with Grok service is failing

- **Solutions**:
  - Ensure the video has a clear transcript
  - Check Grok service connectivity
  - Provide more educational content in the video

### 2. Quiz Flow Problems

- **Possible causes**:
  - Database schema issues
  - Quiz data format is incorrect
  - Questions aren't well-formed

- **Solutions**:
  - Use the validation function to check quiz data
  - Ensure questions have proper structure
  - Verify database tables and fields are correct

### 3. Feedback Issues

- **Possible causes**:
  - Evaluation logic is flawed
  - Feedback messages aren't helpful

- **Solutions**:
  - Customize feedback templates
  - Improve evaluation criteria
  - Add better learning resources

## Data Structure Requirements

For proper functioning, quiz data must have this structure:

```javascript
{
  title: "Quiz Title",
  questions: [
    {
      question: "Question text goes here?",
      // Optional fields that may improve quiz experience
      correctAnswer: "The correct answer",
      explanation: "Explanation of the answer"
    },
    // More questions...
  ]
}
```

## Testing New Quiz Content

When adding new educational videos:

1. Use automated testing:
   ```
   /testquiz <video-cid>
   ```

2. Perform a manual review:
   - Take the quiz yourself
   - Check for question relevance
   - Ensure feedback is helpful
   - Verify credential issuance

3. Document any unusual issues in the project issue tracker

## Technical Implementation

For developers working on the quiz system, review these files:

- `src/modules/telegram/handlers/conversationalVideoQuizHandler.js` - Main quiz logic
- `src/db/sqliteService.js` - Database interactions for quizzes
- `src/services/grokService.js` - Integration with Grok for quiz generation

When making changes to the quiz system, always add validation to prevent regression of the fixes we've implemented. 