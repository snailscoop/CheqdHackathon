#!/bin/bash

# Cheqd Bot - Setup Script

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up Cheqd Bot...${NC}"

# Ensure we're in the project root directory
cd "$(dirname "$0")/.."

# Print welcome message
echo "==================================="
echo " Cheqd Bot - Setup"
echo "==================================="
echo ""

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 14 or higher."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d 'v' -f 2)
MAJOR_VERSION=$(echo $NODE_VERSION | cut -d '.' -f 1)

if [ $MAJOR_VERSION -lt 14 ]; then
    echo "❌ Node.js version 14 or higher is required. You have v$NODE_VERSION."
    exit 1
fi

echo "✅ Node.js v$NODE_VERSION detected"

# Create directories
echo -e "${YELLOW}Creating necessary directories...${NC}"
mkdir -p data
mkdir -p logs
mkdir -p public
echo "✅ Directories created successfully"

# Check for .env file
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file from example...${NC}"
    cp example.env .env
    echo -e "${GREEN}Created .env file. Please edit it with your configuration.${NC}"
else
    echo -e "${YELLOW}.env file already exists. Skipping...${NC}"
fi

# Prompt for Telegram Bot Token if not set
if ! grep -q "TELEGRAM_BOT_TOKEN=.*[^your_token_here]" .env; then
    echo ""
    echo "ℹ️ You need to set your Telegram Bot Token in the .env file"
    read -p "Would you like to enter your Telegram Bot Token now? (y/n): " SET_TOKEN
    if [[ $SET_TOKEN == "y" || $SET_TOKEN == "Y" ]]; then
        read -p "Enter your Telegram Bot Token: " TOKEN
        sed -i "s/TELEGRAM_BOT_TOKEN=.*/TELEGRAM_BOT_TOKEN=$TOKEN/" .env
        echo "✅ Telegram Bot Token has been set"
    else
        echo "ℹ️ Please update the TELEGRAM_BOT_TOKEN in the .env file before starting the bot"
    fi
fi

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install
if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies. Please check the error messages above."
    exit 1
fi
echo "✅ Dependencies installed successfully"

# Set execute permissions for scripts
echo -e "${YELLOW}Setting execute permissions for scripts...${NC}"
chmod +x scripts/*.sh

# Initialize database
echo -e "${YELLOW}Initializing database...${NC}"
NODE_ENV=development node -e "require('./src/db/sqliteService').initialize()"

# Success message
echo ""
echo "==================================="
echo "✅ Setup completed successfully!"
echo "==================================="
echo ""
echo "To start the bot, run:"
echo "npm start"
echo ""

# Make script executable
chmod +x scripts/setup.sh
chmod +x scripts/start.sh
chmod +x scripts/stop.sh

echo -e "${GREEN}Setup complete!${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo -e "1. Edit the ${YELLOW}.env${NC} file with your configuration"
echo -e "2. Run ${YELLOW}npm start${NC} to start the bot"
echo -e "3. Or run ${YELLOW}npm run dev${NC} for development mode" 