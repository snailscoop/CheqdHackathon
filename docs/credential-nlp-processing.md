# Enhanced Credential NLP Processing

This document explains the enhanced natural language processing (NLP) capabilities for credential operations in the Cheqd system.

## Overview

The credential NLP system has been enhanced to:

1. Automatically detect and understand credential-related operations in natural language
2. Utilize database context to improve understanding of user intentions
3. Support detailed credential schema querying
4. Provide richer credential information

## Features

### Database Context Awareness

When a user sends a credential-related message, the system now:

1. Retrieves the user's existing credentials from the database
2. Extracts credential types available to the user
3. Uses this context to better understand what the user is asking about
4. Provides more relevant and personalized responses

Example:
- When a user asks "show my education credential", the system can identify if they have an education credential and show it directly, without requiring an exact credential ID.

### Credential Schema Recognition

Users can now query the database schema for credential types:

```
/dail what is the structure of education credentials?
```

The system will respond with:
- Database column information for the credentials table
- Data structure details specific to the credential type
- JSON schema information where available

### Enhanced Credential Intents

New credential intents supported:

| Intent | Description | Example Query |
|--------|-------------|---------------|
| `credential_details` | Show detailed info about a credential | "Show details of my education credential" |
| `credential_schema` | Show structure of a credential type | "What's in an education credential?" |
| `check_revocation` | Check if a credential is still valid | "Is my support credential still valid?" |

### Improved Entity Extraction

The system can now extract:
- Credential IDs from natural language
- Credential types from user queries
- Specific properties users are interested in
- User intent with better accuracy

## Under the Hood

### Database Integration

1. **Credential Type Recognition**: Automatically extracts and recognizes credential types from the database.
2. **Schema Introspection**: Uses SQLite's `PRAGMA table_info` to get schema details.
3. **Sample Data Analysis**: Examines existing credentials to extract schema information.

### Context Building

The NLP processor creates a rich context for each credential query:
- User's available credential types
- Recent credential activities
- Common credential operations

### Processing Flow

1. **Initial NLP Analysis**: Basic keyword and pattern matching
2. **Database Context Enhancement**: Enriches understanding with database information
3. **Intent Classification**: Determines the user's specific intent
4. **Entity Extraction**: Identifies specific entities (credential IDs, types, etc.)
5. **Handler Selection**: Routes to the appropriate handler for the intent

## Usage Examples

### Checking Credential Details

User query:
```
/dail show me my education credential
```

System:
1. Recognizes intent as `credential_details`
2. Retrieves user's DIDs
3. Searches for education credential
4. Formats and displays credential details

### Querying Schema Information

User query:
```
/dail what information is in a moderation credential?
```

System:
1. Recognizes intent as `credential_schema`
2. Identifies "moderation" as credential type
3. Retrieves schema information
4. Formats and displays credential structure

## Integration Points

- **Telegram Bot**: Integrated with the unified credential handler
- **Grok AI Service**: Enhanced context passing for better AI understanding
- **SQLite Database**: Direct database introspection for schema information

## Future Enhancements

Planned improvements include:
1. Full fuzzy matching for credential types
2. Learning from user interactions to improve recognition
3. Richer schema visualization
4. Support for credential relationships and dependencies 