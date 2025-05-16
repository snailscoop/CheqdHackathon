#!/bin/bash

# Script to initialize the database for Cheqd Bot

# Source environment file if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo "Loaded environment variables from .env"
else
  # Use default from example.env
  export DATABASE_PATH="./data/cheqd.db"
  echo "Using default database path: $DATABASE_PATH"
fi

echo "Starting database initialization..."
node scripts/create_database.js

echo "Checking database structure..."
if [ -f "$DATABASE_PATH" ]; then
  echo "Database file exists at $DATABASE_PATH. Checking tables..."
  
  # List tables in the database
  tables=$(sqlite3 "$DATABASE_PATH" ".tables")
  echo "Tables in database: $tables"
  
  # Check a specific table structure
  echo "Users table structure:"
  sqlite3 "$DATABASE_PATH" ".schema users"
  
  echo "Database initialization complete."
else
  echo "Error: Database file does not exist at $DATABASE_PATH after initialization!"
  exit 1
fi 