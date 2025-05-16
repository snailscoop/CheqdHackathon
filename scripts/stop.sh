#!/bin/bash

# Cheqd Bot - Stop Script

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Stopping Cheqd Bot...${NC}"

# Check if PM2 is installed and bot is running with it
if command -v pm2 &> /dev/null && pm2 list | grep -q "cheqd-bot"; then
    echo -e "${YELLOW}Stopping with PM2...${NC}"
    pm2 stop cheqd-bot
    echo -e "${GREEN}Cheqd Bot stopped.${NC}"
    exit 0
fi

# If not running with PM2, check for PID file
if [ -f .pid ]; then
    PID=$(cat .pid)
    
    # Check if process is running
    if ps -p $PID > /dev/null; then
        echo -e "${YELLOW}Sending SIGTERM to process $PID...${NC}"
        kill $PID
        
        # Wait for process to terminate gracefully
        WAIT_TIME=0
        while ps -p $PID > /dev/null && [ $WAIT_TIME -lt 10 ]; do
            sleep 1
            WAIT_TIME=$((WAIT_TIME+1))
            echo -e "${YELLOW}Waiting for process to terminate ($WAIT_TIME/10)...${NC}"
        done
        
        # Force kill if still running
        if ps -p $PID > /dev/null; then
            echo -e "${YELLOW}Process didn't terminate gracefully, forcing...${NC}"
            kill -9 $PID
        fi
        
        # Remove PID file
        rm .pid
        echo -e "${GREEN}Cheqd Bot stopped.${NC}"
    else
        echo -e "${YELLOW}Process $PID not found, possibly already stopped.${NC}"
        rm .pid
    fi
else
    echo -e "${YELLOW}PID file not found. Checking for running processes...${NC}"
    
    # Try to find by process name
    PID=$(ps aux | grep "[n]ode src/app.js" | awk '{print $2}')
    
    if [ -n "$PID" ]; then
        echo -e "${YELLOW}Found process $PID, stopping...${NC}"
        kill $PID
        echo -e "${GREEN}Cheqd Bot stopped.${NC}"
    else
        echo -e "${YELLOW}No running Cheqd Bot process found.${NC}"
    fi
fi

# Print status message
echo ""
echo "==================================="
echo "✅ Cheqd Bot has been stopped"
echo "==================================="
echo ""
echo "To start the bot again, run:"
echo "scripts/start.sh"
echo "" 