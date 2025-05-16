# Telegram Bot Commands

This document outlines all the available commands for the Cheqd Telegram bot.

## Basic Commands

### /start
**Description**: Initialize the bot and receive a welcome message
**Example**: `/start`

### /help
**Description**: Display a list of available commands and their descriptions
**Example**: `/help`

### /status
**Description**: Check the bot's current status and health
**Example**: `/status`

## DID Management

### /did
**Description**: Manage your Decentralized Identifiers (DIDs)
**Subcommands**:
- `/did create` - Create a new DID
- `/did list` - List your DIDs
- `/did resolve [did]` - Resolve a DID
- `/did delete [did]` - Delete one of your DIDs

**Example**: `/did create`

## Credential Management

### /credential
**Description**: Manage verifiable credentials
**Subcommands**:
- `/credential issue` - Issue a new credential
- `/credential list` - List your credentials
- `/credential verify [id]` - Verify a credential
- `/credential revoke [id]` - Revoke a credential you've issued

**Example**: `/credential list`

### /verify
**Description**: Shorthand to verify a credential by ID
**Example**: `/verify credentialId123`

## Educational Features

### /quiz
**Description**: Start an educational quiz
**Subcommands**:
- `/quiz list` - List available quizzes
- `/quiz start [id]` - Start a specific quiz
- `/quiz stats` - View your quiz statistics

**Example**: `/quiz start blockchain101`

### /progress
**Description**: View your educational progress
**Example**: `/progress`

## Support and Moderation

### /support
**Description**: Access support features
**Subcommands**:
- `/support tier` - Check your current support tier
- `/support upgrade` - Upgrade your support tier
- `/support request [message]` - Request support with a message

**Example**: `/support tier`

### /become_provider
**Description**: Apply to become a P2P support provider
**Example**: `/become_provider Helper`

### /request_support
**Description**: Request help from a P2P support provider
**Example**: `/request_support I need help with creating a DID`

### /mod
**Description**: Access moderation commands (for moderators only)
**Subcommands**:
- `/mod warn @username [reason]` - Warn a user
- `/mod kick @username [reason]` - Kick a user
- `/mod ban @username [reason]` - Ban a user
- `/mod stats` - View moderation statistics

**Example**: `/mod warn @user Posting off-topic content`

## Advanced Features

### /dail
**Description**: Use the natural language interface
**Example**: `/dail How do I create a DID?`

### /ask
**Description**: Ask the AI a question
**Example**: `/ask What is a verifiable credential?`

## Admin Commands

### /admin
**Description**: Access administrative features (for admins only)
**Subcommands**:
- `/admin users` - List users
- `/admin stats` - View system statistics
- `/admin broadcast [message]` - Send a message to all users

**Example**: `/admin stats`

## Usage Notes

- Commands with `[]` indicate required parameters
- Some commands are restricted based on your user role or tier
- For most commands, you can simply type the command and follow the interactive prompts 