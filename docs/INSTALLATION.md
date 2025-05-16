# Installation Guide

## Prerequisites

Before installing the Cheqd Bot, ensure you have the following prerequisites:

- **Node.js** (v16.0 or higher)
- **NPM** (v8.0 or higher) or **Yarn** (v1.22 or higher)
- **SQLite** (v3.0 or higher)
- **Python** (v3.8 or higher, for video processing)
- **Telegram Bot API token** (obtain from [@BotFather](https://t.me/BotFather))
- **Cheqd network access** (testnet or mainnet)

### Optional Requirements

- **OpenAI API key** (for Grok AI features)
- **Jackal Protocol API access** (for video storage)

## Basic Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/cheqd-bot.git
cd cheqd-bot
```

### 2. Install Dependencies

Using npm:
```bash
npm install
```

Or using Yarn:
```bash
yarn install
```

### 3. Configure Environment Variables

Copy the example environment file:
```bash
cp example.env .env
```

Edit the `.env` file with your configuration details:

```
# Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
BOT_USERNAME=your_bot_username

# Cheqd Configuration
CHEQD_NETWORK=testnet
CHEQD_MNEMONIC=your_mnemonic_phrase
CHEQD_REST_URL=https://api.cheqd.network

# OpenAI Configuration (optional)
OPENAI_API_KEY=your_openai_api_key

# Database Configuration
DB_PATH=data/cheqd.db

# API Configuration
API_PORT=3000
API_SECRET=your_api_secret
```

### 4. Initialize the Database

```bash
npm run init-db
```

Or:

```bash
yarn init-db
```

### 5. Start the Bot

For development:
```bash
npm run dev
```

For production:
```bash
npm start
```

## Advanced Installation

### Docker Installation

1. Build the Docker image:

```bash
docker build -t cheqd-bot .
```

2. Run the container:

```bash
docker run -d --name cheqd-bot -p 3000:3000 --env-file .env cheqd-bot
```

### Video Processing Setup

If you plan to use video processing features:

1. Install Python dependencies:

```bash
pip install -r requirements.txt
```

2. Install FFmpeg:

On Debian/Ubuntu:
```bash
apt-get update && apt-get install -y ffmpeg
```

On macOS:
```bash
brew install ffmpeg
```

### Trust Registry Initialization

Initialize the trust registry structure:

```bash
npm run init-trust-registry
```

## Configuration Options

### Logging

Adjust logging levels in the `.env` file:

```
LOG_LEVEL=info # debug, info, warn, error
LOG_FORMAT=json # json, pretty
LOG_TO_FILE=true
LOG_FILE_PATH=logs/bot.log
```

### API Server

Disable the API server if not needed:

```
ENABLE_API=false
```

Or change its configuration:

```
API_PORT=8080
API_CORS_ORIGIN=*
API_RATE_LIMIT=100
```

## Troubleshooting

### Common Issues

#### Bot Doesn't Respond

- Verify your Telegram bot token is correct
- Ensure the bot is started with `npm start`
- Check logs for any errors

#### Database Errors

- Try reinitializing the database with `npm run init-db`
- Ensure the database directory is writable

#### API Access Issues

- Verify the API server is running (`npm run api`)
- Check that your API key is configured correctly
- Ensure correct permissions in firewall/network settings

## Next Steps

After installation, refer to the [TELEGRAM-COMMANDS.md](./TELEGRAM-COMMANDS.md) for available bot commands and [API.md](./API.md) for API documentation.

For development and contributions, see the [CONTRIBUTING.md](../CONTRIBUTING.md) guide. 