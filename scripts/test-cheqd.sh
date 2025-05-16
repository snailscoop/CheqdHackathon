#!/bin/bash

# Test Cheqd DID and Credential Script
# This script runs the Cheqd DID and credential test

# Set environment
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to project root directory
cd "$PROJECT_ROOT" || exit 1

# Check if .env file exists
if [ ! -f .env ]; then
  echo "Error: .env file not found"
  echo "Please create a .env file with CHEQD_STUDIO_API_KEY and other required variables"
  exit 1
fi

# Check if node is installed
if ! command -v node &> /dev/null; then
  echo "Error: node is not installed"
  exit 1
fi

# Create data directory if it doesn't exist
mkdir -p "$PROJECT_ROOT/data/test-results"

# Run the test
echo "Starting Cheqd DID and Credential test..."
node "$SCRIPT_DIR/test-cheqd-did-credential.js"

# Check the exit code
if [ $? -eq 0 ]; then
  echo "Test completed successfully!"
  echo "Results have been saved to data/test-results/"
else
  echo "Test failed!"
fi 