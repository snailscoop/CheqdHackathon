#!/bin/bash

# Hook Telegram Bot Script
#
# This script makes it easy to hook the Telegram bot to our video processing and quiz system.
# It modifies the necessary files to ensure the bot can handle educational commands.
#
# Usage: ./scripts/hook-telegram-bot.sh

echo "Integrating Telegram bot with video processing system..."

# Create the data directories if they don't exist
mkdir -p data/quizzes
mkdir -p data/quizzes/telegram

# Make sure all scripts are executable
chmod +x scripts/process-video.js
chmod +x scripts/generate-quiz.js
chmod +x scripts/telegram-quiz-integration.js
chmod +x scripts/telegram-educational-command.js
chmod +x scripts/telegram-video-info.js
chmod +x scripts/list-videos.js
chmod +x scripts/register-video-topic.js

# Check if bot integration is already set up
BOT_HANDLER=$(grep -r "telegram-educational-command.js" src/handlers 2>/dev/null)

if [ -z "$BOT_HANDLER" ]; then
  echo "Bot integration not found. Adding Telegram command handlers..."
  
  # Determine the bot handler file
  BOT_HANDLER_FILE=$(find src/handlers -name "*telegram*.js" | head -n 1)
  
  if [ -z "$BOT_HANDLER_FILE" ]; then
    echo "No Telegram handler file found. Please integrate manually."
    echo "Add the following to your Telegram bot handler:"
    echo ""
    echo "  // Handle learning/educational commands"
    echo "  if (messageText.startsWith('/learn') || messageText.toLowerCase().includes('learn about')) {"
    echo "    const topic = messageText.replace(/^\\/learn\\s+|learn about\\s+/i, '').trim();"
    echo "    if (topic) {"
    echo "      // Call educational command handler"
    echo "      const { spawn } = require('child_process');"
    echo "      const childProcess = spawn('node', ["
    echo "        'scripts/telegram-educational-command.js',"
    echo "        '--topic', topic,"
    echo "        '--chatId', chatId,"
    echo "        '--userId', userId || ''"
    echo "      ]);"
    echo "      // Log process output for debugging"
    echo "      childProcess.stdout.on('data', (data) => {"
    echo "        logger.info(`Educational command stdout: ${data}`);"
    echo "      });"
    echo "      childProcess.stderr.on('data', (data) => {"
    echo "        logger.error(`Educational command stderr: ${data}`);"
    echo "      });"
    echo "      return;"
    echo "    }"
    echo "  }"
    echo ""
    echo "  // Handle video info command (/video <CID>)"
    echo "  if (messageText.startsWith('/video')) {"
    echo "    const cid = messageText.replace(/^\\/video\\s+/, '').trim();"
    echo "    if (cid) {"
    echo "      logger.info(`Requested video info for CID: ${cid}`);"
    echo "      const { spawn } = require('child_process');"
    echo "      const childProcess = spawn('node', ["
    echo "        'scripts/telegram-video-info.js',"
    echo "        '--cid', cid,"
    echo "        '--chatId', chatId"
    echo "      ]);"
    echo "      childProcess.stdout.on('data', (data) => {"
    echo "        logger.info(`Video info command stdout: ${data}`);"
    echo "      });"
    echo "      childProcess.stderr.on('data', (data) => {"
    echo "        logger.error(`Video info command stderr: ${data}`);"
    echo "      });"
    echo "      return;"
    echo "    }"
    echo "  }"
    echo ""
    echo "  // Handle quiz command (/quiz <CID>)"
    echo "  if (messageText.startsWith('/quiz')) {"
    echo "    const cid = messageText.replace(/^\\/quiz\\s+/, '').trim();"
    echo "    if (cid) {"
    echo "      logger.info(`Requested quiz for CID: ${cid}`);"
    echo "      const { spawn } = require('child_process');"
    echo "      const childProcess = spawn('node', ["
    echo "        'scripts/telegram-quiz-integration.js',"
    echo "        cid,"
    echo "        '--chatId', chatId"
    echo "      ]);"
    echo "      childProcess.stdout.on('data', (data) => {"
    echo "        logger.info(`Quiz command stdout: ${data}`);"
    echo "      });"
    echo "      childProcess.stderr.on('data', (data) => {"
    echo "        logger.error(`Quiz command stderr: ${data}`);"
    echo "      });"
    echo "      return;"
    echo "    }"
    echo "  }"
    echo ""
    echo "  // Handle videos command to list available videos"
    echo "  if (messageText === '/videos') {"
    echo "    logger.info('Requested list of educational videos');"
    echo "    const { spawn } = require('child_process');"
    echo "    const childProcess = spawn('node', ["
    echo "      'scripts/list-videos.js'"
    echo "    ]);"
    echo "    "
    echo "    let videoList = '';"
    echo "    childProcess.stdout.on('data', (data) => {"
    echo "      videoList += data.toString();"
    echo "    });"
    echo "    "
    echo "    childProcess.on('close', () => {"
    echo "      // Format video list for Telegram"
    echo "      if (videoList) {"
    echo "        // Extract just the video names and CIDs"
    echo "        const videoLines = videoList.split('\\n').filter(line => "
    echo "          line.match(/^\\d+\\./) || line.match(/^\\s+CID:/) || line.match(/^\\s+Topics:/)"
    echo "        );"
    echo "        "
    echo "        let formattedList = '🎬 *Available Educational Videos*\\n\\n';"
    echo "        "
    echo "        for (let i = 0; i < videoLines.length; i++) {"
    echo "          const line = videoLines[i];"
    echo "          if (line.match(/^\\d+\\./)) {"
    echo "            // Video name line"
    echo "            formattedList += line + '\\n';"
    echo "          } else if (line.match(/^\\s+CID:/)) {"
    echo "            // CID line - extract just the CID value"
    echo "            const cid = line.replace(/^\\s+CID:\\s+/, '').trim();"
    echo "            formattedList += `  /video ${cid}\\n`;"
    echo "          } else if (line.match(/^\\s+Topics:/)) {"
    echo "            // Topics line"
    echo "            formattedList += line + '\\n\\n';"
    echo "          }"
    echo "        }"
    echo "        "
    echo "        // Send formatted list back to user"
    echo "        bot.sendMessage(chatId, formattedList, { parse_mode: 'Markdown' });"
    echo "      } else {"
    echo "        bot.sendMessage(chatId, 'No educational videos found in the database');"
    echo "      }"
    echo "    });"
    echo "    "
    echo "    childProcess.stderr.on('data', (data) => {"
    echo "      logger.error(`List videos command stderr: ${data}`);"
    echo "      bot.sendMessage(chatId, 'Error listing videos');"
    echo "    });"
    echo "    "
    echo "    return;"
    echo "  }"
    echo ""
  else
    echo "Found Telegram handler: $BOT_HANDLER_FILE"
    
    # Check if we need to add our command handlers
    if ! grep -q "educational-command" "$BOT_HANDLER_FILE"; then
      # Create a backup of the handler file
      cp "$BOT_HANDLER_FILE" "${BOT_HANDLER_FILE}.bak"
      
      # Find a good place to insert our code - after message handling begins
      INSERT_POINT=$(grep -n "message.*text" "$BOT_HANDLER_FILE" | head -n 1 | cut -d':' -f1)
      
      if [ -z "$INSERT_POINT" ]; then
        echo "Couldn't find a good place to insert the command handlers."
        echo "Please integrate manually using the code above."
      else
        # Insert our handler code
        INSERT_POINT=$((INSERT_POINT + 1))
        
        HANDLER_CODE="\n  // Handle learning/educational commands\n  if (messageText.startsWith('/learn') || messageText.toLowerCase().includes('learn about')) {\n    const topic = messageText.replace(/^\\/learn\\s+|learn about\\s+/i, '').trim();\n    if (topic) {\n      logger.info(\`Detected learning command for topic: \${topic}\`);\n      // Call educational command handler\n      const { spawn } = require('child_process');\n      const childProcess = spawn('node', [\n        'scripts/telegram-educational-command.js',\n        '--topic', topic,\n        '--chatId', chatId,\n        '--userId', userId || ''\n      ]);\n      // Log process output for debugging\n      childProcess.stdout.on('data', (data) => {\n        logger.info(\`Educational command stdout: \${data}\`);\n      });\n      childProcess.stderr.on('data', (data) => {\n        logger.error(\`Educational command stderr: \${data}\`);\n      });\n      return;\n    }\n  }\n\n  // Handle video info command (/video <CID>)\n  if (messageText.startsWith('/video')) {\n    const cid = messageText.replace(/^\\/video\\s+/, '').trim();\n    if (cid) {\n      logger.info(\`Requested video info for CID: \${cid}\`);\n      const { spawn } = require('child_process');\n      const childProcess = spawn('node', [\n        'scripts/telegram-video-info.js',\n        '--cid', cid,\n        '--chatId', chatId\n      ]);\n      childProcess.stdout.on('data', (data) => {\n        logger.info(\`Video info command stdout: \${data}\`);\n      });\n      childProcess.stderr.on('data', (data) => {\n        logger.error(\`Video info command stderr: \${data}\`);\n      });\n      return;\n    }\n  }\n\n  // Handle quiz command (/quiz <CID>)\n  if (messageText.startsWith('/quiz')) {\n    const cid = messageText.replace(/^\\/quiz\\s+/, '').trim();\n    if (cid) {\n      logger.info(\`Requested quiz for CID: \${cid}\`);\n      const { spawn } = require('child_process');\n      const childProcess = spawn('node', [\n        'scripts/telegram-quiz-integration.js',\n        cid,\n        '--chatId', chatId\n      ]);\n      childProcess.stdout.on('data', (data) => {\n        logger.info(\`Quiz command stdout: \${data}\`);\n      });\n      childProcess.stderr.on('data', (data) => {\n        logger.error(\`Quiz command stderr: \${data}\`);\n      });\n      return;\n    }\n  }\n\n  // Handle videos command to list available videos\n  if (messageText === '/videos') {\n    logger.info('Requested list of educational videos');\n    const { spawn } = require('child_process');\n    const childProcess = spawn('node', [\n      'scripts/list-videos.js'\n    ]);\n    \n    let videoList = '';\n    childProcess.stdout.on('data', (data) => {\n      videoList += data.toString();\n    });\n    \n    childProcess.on('close', () => {\n      // Format video list for Telegram\n      if (videoList) {\n        // Extract just the video names and CIDs\n        const videoLines = videoList.split('\\n').filter(line => \n          line.match(/^\\d+\\./) || line.match(/^\\s+CID:/) || line.match(/^\\s+Topics:/)\n        );\n        \n        let formattedList = '🎬 *Available Educational Videos*\\n\\n';\n        \n        for (let i = 0; i < videoLines.length; i++) {\n          const line = videoLines[i];\n          if (line.match(/^\\d+\\./)) {\n            // Video name line\n            formattedList += line + '\\n';\n          } else if (line.match(/^\\s+CID:/)) {\n            // CID line - extract just the CID value\n            const cid = line.replace(/^\\s+CID:\\s+/, '').trim();\n            formattedList += \`  /video \${cid}\\n\`;\n          } else if (line.match(/^\\s+Topics:/)) {\n            // Topics line\n            formattedList += line + '\\n\\n';\n          }\n        }\n        \n        // Send formatted list back to user\n        bot.sendMessage(chatId, formattedList, { parse_mode: 'Markdown' });\n      } else {\n        bot.sendMessage(chatId, 'No educational videos found in the database');\n      }\n    });\n    \n    childProcess.stderr.on('data', (data) => {\n      logger.error(\`List videos command stderr: \${data}\`);\n      bot.sendMessage(chatId, 'Error listing videos');\n    });\n    \n    return;\n  }\n"
        
        # Use sed to insert the code at the specified line
        sed -i "${INSERT_POINT}i\\${HANDLER_CODE}" "$BOT_HANDLER_FILE"
        
        echo "Successfully added command handlers to $BOT_HANDLER_FILE"
        echo "Original file backed up to ${BOT_HANDLER_FILE}.bak"
      fi
    else
      echo "Command handlers already integrated in $BOT_HANDLER_FILE"
    fi
  fi
else
  echo "Telegram command handlers already set up."
fi

# Create database table for topic to video mapping if it doesn't exist
cat > scripts/create-topics-table.js << EOL
#!/usr/bin/env node

/**
 * Create Educational Topics Table
 * 
 * This script creates a table for mapping topics to educational videos.
 */

const db = require('../src/db/sqliteService');
const logger = require('../src/utils/logger');

async function createTopicsTable() {
  try {
    // Initialize database
    await db.ensureInitialized();
    logger.info('Database initialized');
    
    // Create educational_topics table if it doesn't exist
    await db.run(\`
      CREATE TABLE IF NOT EXISTS educational_topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_name TEXT NOT NULL,
        topic_keywords TEXT,
        video_cid TEXT NOT NULL,
        relevance INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_cid) REFERENCES educational_videos(cid)
      )
    \`);
    
    // Create index for topic lookups
    await db.run(\`
      CREATE INDEX IF NOT EXISTS idx_educational_topics_name 
      ON educational_topics(topic_name)
    \`);
    
    logger.info('Educational topics table created successfully');
    return true;
  } catch (error) {
    logger.error('Error creating educational topics table:', error);
    return false;
  }
}

// Run if called directly
if (require.main === module) {
  createTopicsTable()
    .then(result => {
      if (result) {
        console.log('✅ Educational topics table created successfully');
        process.exit(0);
      } else {
        console.error('❌ Failed to create educational topics table');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
} else {
  // Export for use as a module
  module.exports = { createTopicsTable };
}
EOL

chmod +x scripts/create-topics-table.js

# Create a startup script to ensure all needed services are initialized
cat > scripts/init-educational-system.js << EOL
#!/usr/bin/env node

/**
 * Initialize Educational System
 * 
 * This script initializes all required services for the educational video processing system.
 * Run this during application startup to ensure system readiness.
 */

const jackalPinService = require('../src/modules/jackal/jackalPinService').jackalPinService;
const videoProcessor = require('../src/modules/jackal/videoProcessor');
const db = require('../src/db/sqliteService');
const logger = require('../src/utils/logger');
const { createTopicsTable } = require('./create-topics-table');

async function initialize() {
  try {
    logger.info('Initializing educational system...');
    
    // Initialize database
    await db.ensureInitialized();
    logger.info('Database initialized');
    
    // Initialize Jackal PIN service
    await jackalPinService.ensureInitialized();
    logger.info('Jackal PIN service initialized');
    
    // Initialize video processor
    await videoProcessor.initialize();
    logger.info('Video processor initialized');
    
    // Create educational topics table if it doesn't exist
    await createTopicsTable();
    logger.info('Educational topics table initialized');
    
    logger.info('Educational system initialization complete');
    return true;
  } catch (error) {
    logger.error('Error initializing educational system:', error);
    return false;
  }
}

// Run initialization if script is called directly
if (require.main === module) {
  initialize()
    .then(result => {
      if (result) {
        console.log('✅ Educational system initialized successfully');
        process.exit(0);
      } else {
        console.error('❌ Failed to initialize educational system');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Unhandled error during initialization:', error);
      process.exit(1);
    });
} else {
  // Export for use as a module
  module.exports = { initialize };
}
EOL

chmod +x scripts/init-educational-system.js

# Create a script to register a video with a topic
cat > scripts/register-video-topic.js << EOL
#!/usr/bin/env node

/**
 * Register Video Topic
 * 
 * This script registers a video CID with one or more educational topics.
 * 
 * Usage: node scripts/register-video-topic.js --cid <CID> --topic <TOPIC> [--keywords <KEYWORDS>]
 */

const db = require('../src/db/sqliteService');
const logger = require('../src/utils/logger');
const { createTopicsTable } = require('./create-topics-table');

// Parse command-line arguments
const args = process.argv.slice(2);
const cidIndex = args.indexOf('--cid');
const topicIndex = args.indexOf('--topic');
const keywordsIndex = args.indexOf('--keywords');

const cid = cidIndex > -1 ? args[cidIndex + 1] : null;
const topic = topicIndex > -1 ? args[topicIndex + 1] : null;
const keywords = keywordsIndex > -1 ? args[keywordsIndex + 1] : '';

// Validate arguments
if (!cid || !topic) {
  console.error('Error: CID and topic are required');
  console.error('Usage: node scripts/register-video-topic.js --cid <CID> --topic <TOPIC> [--keywords <KEYWORDS>]');
  process.exit(1);
}

async function registerVideoTopic() {
  try {
    // Initialize database
    await db.ensureInitialized();
    logger.info('Database initialized');
    
    // Ensure topics table exists
    await createTopicsTable();
    
    // Check if video exists
    const video = await db.get('SELECT * FROM educational_videos WHERE cid = ?', [cid]);
    
    if (!video) {
      console.error(\`No video found with CID: \${cid}\`);
      console.log('Please process the video first using: node scripts/process-video.js <CID>');
      return false;
    }
    
    // Check if topic mapping already exists
    const existingTopic = await db.get(
      'SELECT * FROM educational_topics WHERE video_cid = ? AND topic_name = ?',
      [cid, topic]
    );
    
    if (existingTopic) {
      console.log(\`Topic mapping already exists for "\${topic}" with CID: \${cid}\`);
      
      // Update keywords if provided
      if (keywords) {
        await db.run(
          'UPDATE educational_topics SET topic_keywords = ? WHERE id = ?',
          [keywords, existingTopic.id]
        );
        console.log('Updated keywords for existing topic mapping');
      }
      
      return true;
    }
    
    // Register new topic mapping
    const result = await db.run(
      'INSERT INTO educational_topics (topic_name, topic_keywords, video_cid) VALUES (?, ?, ?)',
      [topic, keywords, cid]
    );
    
    console.log(\`✅ Successfully registered video with topic: "\${topic}"\`);
    console.log(\`Video: \${video.name} (CID: \${cid})\`);
    if (keywords) {
      console.log(\`Keywords: \${keywords}\`);
    }
    
    return true;
  } catch (error) {
    console.error('Error registering video topic:', error);
    return false;
  }
}

// Run the script
registerVideoTopic()
  .then(result => {
    if (result) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
EOL

chmod +x scripts/register-video-topic.js

echo "Created initialization script: scripts/init-educational-system.js"
echo "Created topics registration script: scripts/register-video-topic.js"
echo "Add init-educational-system.js to your application startup to ensure system readiness"

echo "Integration complete!"
echo ""
echo "You can now use the following commands in Telegram:"
echo "- /learn blockchain            - Learn about blockchain with a quiz"
echo "- /video <CID>                 - Get detailed information about a video"
echo "- /quiz <CID>                  - Take a quiz for a specific video"
echo "- /videos                      - List all available educational videos"
echo ""
echo "To register videos with topics for better discovery:"
echo "node scripts/register-video-topic.js --cid <CID> --topic \"Blockchain\" --keywords \"crypto,web3,tokens\""
echo ""
echo "To test the system manually, use:"
echo "node scripts/process-video.js <CID> --quiz       # Process a video and generate a quiz"
echo "node scripts/list-videos.js                      # List all processed videos"
echo "node scripts/generate-quiz.js list               # List all available quizzes"
echo "node scripts/telegram-video-info.js --cid <CID> --chatId <CHAT_ID> # View video info in Telegram"
echo "" 