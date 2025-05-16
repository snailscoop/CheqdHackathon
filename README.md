# Cheqd Bot

A comprehensive Telegram bot that integrates Cheqd DIDs, verifiable credentials, Jackal Protocol, and Grok AI capabilities. This bot allows users to create and manage DIDs, issue and verify credentials, pin videos to Jackal Protocol, and interact with AI.

## Features

- 🆔 **DID Management**: Create and resolve Decentralized Identifiers (DIDs) on the Cheqd network
- 📜 **Verifiable Credentials**: Issue, verify, and manage verifiable credentials
- 🎬 **Video Pinning**: Pin videos to Jackal Protocol's decentralized storage
- 🧠 **AI Integration**: Interact with Grok AI for credential analysis and generation
- 🔄 **Event Scraping**: Monitor for relevant events across networks
- 🎓 **Educational Content**: Quiz functionality for educational credentials
- 🌐 **API Access**: RESTful API for integration with other services

## Architecture

The application consists of:

- Telegram Bot interface using Telegraf
- SQLite database for reliable and consistent data storage
- Modular architecture with service-based components
- Integration layer connecting all services

## Prerequisites

- Node.js (v16+)
- NPM or Yarn
- Telegram Bot API token (from @BotFather)
- Cheqd network access
- OpenAI API key (for Grok)
- Jackal Protocol API access (optional)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/your-username/cheqd-bot.git
   cd cheqd-bot
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Configure environment variables by copying the example:
   ```
   cp example.env .env
   ```
   
4. Edit the `.env` file with your configuration

## Usage

### Starting the Bot

Start the bot and web server:
```
npm start
```

Development mode with auto-restart:
```
npm run dev
```

Run only the bot (without API server):
```
npm run bot
```

### Telegram Commands

- `/start` - Start the bot
- `/help` - Show list of commands
- `/createdid` - Create a new DID
- `/resolve <did>` - Resolve a DID
- `/issue` - Issue a new credential
- `/verify <credential>` - Verify a credential
- `/credentials` - List your credentials
- `/pin <url>` - Pin a video to Jackal
- `/search <query>` - Search for videos

### API Endpoints

The application exposes the following RESTful API endpoints:

- `GET /api/health` - Health check
- `GET /api/credentials` - List credentials
- `GET /api/credentials/:id` - Get credential by ID
- `POST /api/credentials` - Issue credential
- `GET /api/credentials/:id/verify` - Verify credential
- `GET /api/dids` - List DIDs
- `GET /api/dids/:did` - Resolve DID
- `POST /api/dids` - Create DID
- `GET /api/videos` - List pinned videos
- `POST /api/videos` - Pin video
- `GET /api/videos/search` - Search videos

## Project Structure

```
.
├── data/               # SQLite database and storage
├── public/             # Static files for web interface
├── src/
│   ├── api/            # API routes and controllers
│   ├── commands/       # Bot command handlers
│   ├── config/         # Configuration files
│   ├── db/             # Database service
│   ├── handlers/       # Message handlers
│   ├── middleware/     # Bot middleware
│   ├── modules/        # Feature modules
│   │   ├── blockchain/ # Blockchain services
│   │   ├── cheqd/      # Cheqd integration
│   │   ├── education/  # Educational services
│   │   ├── grok/       # Grok AI services
│   │   ├── integration/# Integration layer
│   │   ├── jackal/     # Jackal services
│   │   └── support/    # Support services
│   ├── services/       # Core services
│   ├── utils/          # Utilities
│   ├── app.js          # Main application entry
│   └── bot.js          # Bot-specific entry
├── .env                # Environment variables
├── example.env         # Example environment variables
├── package.json        # Package information
└── README.md           # This file
```

## Security Considerations

- API access is controlled with API keys
- Telegram commands are rate-limited
- Sensitive data is not logged
- Premium features are restricted to authorized users

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 