#!/bin/bash

# Cheqd Bot - Start Script

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Ensure we're in the project root directory
cd "$(dirname "$0")/.."

# Print welcome message
echo "==================================="
echo " Cheqd Bot - Starting"
echo "==================================="
echo ""

# Check if bot is already running
if [ -f .cheqd-bot.pid ]; then
    PID=$(cat .cheqd-bot.pid)
    if ps -p $PID > /dev/null; then
        echo "❌ Cheqd Bot is already running with PID $PID"
        echo "   If you believe this is an error, delete the .cheqd-bot.pid file and try again."
        exit 1
    else
        echo "ℹ️ Stale PID file found, removing..."
        rm .cheqd-bot.pid
    fi
fi

# Check for .env file
if [ ! -f .env ]; then
    echo "❌ No .env file found. Please run 'scripts/setup.sh' first."
    exit 1
fi

# Check for TELEGRAM_BOT_TOKEN
if ! grep -q "TELEGRAM_BOT_TOKEN=.*[^your_token_here]" .env; then
    echo "❌ TELEGRAM_BOT_TOKEN is not set properly in .env file."
    echo "   Please update it with your actual token."
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 14 or higher."
    exit 1
fi

# Set environment to production
export NODE_ENV=production

echo -e "${GREEN}Starting Cheqd Bot...${NC}"

# Check if PM2 is installed
if command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}Starting with PM2...${NC}"
    # Start the application with PM2
    pm2 start src/app.js --name "cheqd-bot" --time
    pm2 save
    echo -e "${GREEN}Cheqd Bot started with PM2. Use 'pm2 logs cheqd-bot' to view logs.${NC}"
else
    echo -e "${YELLOW}PM2 not found, starting with Node.js...${NC}"
    echo -e "${YELLOW}(For production use, consider installing PM2: npm install -g pm2)${NC}"
    
    # Start with Node.js
    nohup node src/app.js > logs/cheqd-bot.log 2>&1 &
    PID=$!
    echo $PID > .cheqd-bot.pid
    echo -e "${GREEN}Cheqd Bot started with PID $PID.${NC}"
    echo -e "${YELLOW}Logs available at logs/cheqd-bot.log${NC}"
fi

# Wait a moment to see if it stays running
sleep 2
if ps -p $PID > /dev/null; then
    echo "✅ Cheqd Bot started successfully with PID $PID"
    echo "   Logs are available in logs/cheqd-bot.log"
else
    echo "❌ Failed to start Cheqd Bot. Check logs for details."
    exit 1
fi

# Print status message
echo ""
echo "==================================="
echo "✅ Cheqd Bot is now running!"
echo "==================================="
echo ""
echo "To stop the bot, run:"
echo "scripts/stop.sh"
echo "" 