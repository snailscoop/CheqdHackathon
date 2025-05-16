/**
 * Function definitions for Grok function calling
 * These definitions are used to structure AI responses for natural language commands
 * processed through the /dail command interface
 */

const logger = require('../../utils/logger');

/**
 * Define function definitions for Grok
 * Each function represents a specific action the bot can take
 */
const functionDefinitions = [
  // === MODERATION FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'make_moderator',
      description: 'Make a user a moderator in the current chat',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username of the user to make a moderator (with or without @ symbol)'
          },
          level: {
            type: 'string',
            enum: ['basic', 'full', 'admin'],
            description: 'The moderator permission level to assign'
          }
        },
        required: ['user']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_moderator',
      description: 'Remove moderator status from a user',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username of the user to remove moderator status from (with or without @ symbol)'
          }
        },
        required: ['user']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ban_user',
      description: 'Ban a user from the chat (always available for admins and moderators)',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username of the user to ban (with or without @ symbol)'
          },
          reason: {
            type: 'string',
            description: 'The reason for the ban'
          },
          duration: {
            type: 'string',
            description: 'Optional duration of the ban (e.g., "1 day", "permanent")'
          }
        },
        required: ['user']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kick_user',
      description: 'Kick a user from the current chat (always available for admins and moderators)',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username of the user to kick (with or without @ symbol)'
          },
          reason: {
            type: 'string',
            description: 'The reason for kicking the user'
          }
        },
        required: ['user']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'unban_user',
      description: 'Remove a ban from a user (always available for admins and moderators)',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username of the user to unban (with or without @ symbol)'
          }
        },
        required: ['user']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mute_user',
      description: 'Mute a user in the current chat (always available for admins and moderators)',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username of the user to mute (with or without @ symbol)'
          },
          duration: {
            type: 'integer',
            description: 'Duration of the mute in minutes (default: 60)'
          },
          reason: {
            type: 'string',
            description: 'The reason for muting the user'
          }
        },
        required: ['user']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'unmute_user',
      description: 'Unmute a user in the current chat (always available for admins and moderators)',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username of the user to unmute (with or without @ symbol)'
          }
        },
        required: ['user']
      }
    }
  },

  // === CHEQD CREDENTIAL FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'issue_credential',
      description: 'Issue a verifiable credential to a user',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username of the recipient (with or without @ symbol)'
          },
          credential_type: {
            type: 'string',
            enum: ['educational', 'support', 'moderation', 'verification', 'agent'],
            description: 'The type of credential to issue'
          },
          attributes: {
            type: 'object',
            description: 'Additional attributes for the credential'
          },
          expiration: {
            type: 'string',
            description: 'Optional expiration date/duration (e.g., "30 days", "2024-12-31")'
          }
        },
        required: ['user', 'credential_type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_user_credentials',
      description: 'Check if the current user or a specified user has any credentials',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username to check (with or without @ symbol). If not provided, checks the requesting user.'
          },
          credential_type: {
            type: 'string',
            enum: ['educational', 'support', 'moderation', 'verification', 'agent', 'any'],
            description: 'The type of credential to check for'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verify_credential',
      description: 'Verify a user\'s credential',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username whose credential to verify (with or without @ symbol)'
          },
          credential_type: {
            type: 'string',
            enum: ['educational', 'support', 'moderation', 'verification', 'agent', 'any'],
            description: 'The type of credential to verify'
          },
          check_trust_chain: {
            type: 'boolean',
            description: 'Whether to verify the entire trust chain'
          }
        },
        required: ['user']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'revoke_credential',
      description: 'Revoke a previously issued credential',
      parameters: {
        type: 'object',
        properties: {
          credential_id: {
            type: 'string',
            description: 'The ID of the credential to revoke'
          },
          reason: {
            type: 'string',
            description: 'The reason for revocation'
          }
        },
        required: ['credential_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_credential',
      description: 'Get information about a credential',
      parameters: {
        type: 'object',
        properties: {
          credential_id: {
            type: 'string',
            description: 'The ID of the credential to retrieve'
          }
        },
        required: ['credential_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_user_credentials',
      description: 'Get all credentials for a user',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username or user ID to get credentials for'
          },
          type: {
            type: 'string',
            enum: ['educational', 'support', 'moderation', 'verification', 'agent', 'any'],
            description: 'Optional filter for credential type'
          }
        },
        required: ['user']
      }
    }
  },

  // === EDUCATIONAL FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'learn_topic',
      description: 'Provide educational information about a topic',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'The topic to learn about'
          },
          depth: {
            type: 'string',
            enum: ['beginner', 'intermediate', 'advanced'],
            description: 'The level of detail to provide'
          }
        },
        required: ['topic']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'show_progress',
      description: 'Show a user\'s educational progress',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username to show progress for (with or without @ symbol). If not provided, shows the requesting user\'s progress.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_quiz',
      description: 'Generate a quiz on a particular topic',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'The topic for the quiz'
          },
          difficulty: {
            type: 'string',
            enum: ['easy', 'medium', 'hard'],
            description: 'The difficulty level of the quiz'
          },
          num_questions: {
            type: 'integer',
            description: 'The number of questions to generate'
          }
        },
        required: ['topic']
      }
    }
  },

  // === BLOCKCHAIN FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'get_transaction_info',
      description: 'Get information about a blockchain transaction',
      parameters: {
        type: 'object',
        properties: {
          tx_hash: {
            type: 'string',
            description: 'The transaction hash/ID'
          },
          chain: {
            type: 'string',
            description: 'The blockchain network (e.g., "stargaze-1", "osmosis-1")'
          }
        },
        required: ['tx_hash']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'transaction_analysis',
      description: 'Analyze a failed blockchain transaction with detailed reasoning and provide troubleshooting steps',
      parameters: {
        type: 'object',
        properties: {
          tx_hash: {
            type: 'string',
            description: 'The transaction hash to analyze'
          },
          chain_id: {
            type: 'string',
            description: 'Optional chain ID for the transaction (defaults to stargaze-1 for marketplace transactions)'
          },
          reasoning_level: {
            type: 'string',
            enum: ['basic', 'detailed'],
            description: 'The level of reasoning analysis to provide (basic or detailed)'
          }
        },
        required: ['tx_hash']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_account_balance',
      description: 'Get the balance of a blockchain account',
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'The account address to check'
          },
          chain: {
            type: 'string',
            description: 'The blockchain network (e.g., "cosmos", "ethereum", "cheqd")'
          }
        },
        required: ['address']
      }
    }
  },

  // === SUPPORT FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'check_security',
      description: 'Check if a website, file, or message is secure or a potential scam',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The URL, message, or content to check'
          },
          content_type: {
            type: 'string',
            enum: ['url', 'message', 'file', 'address'],
            description: 'The type of content being checked'
          }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_support_tier',
      description: 'Check a user\'s current support tier',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username to check (with or without @ symbol). If not provided, checks the requesting user.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upgrade_support_tier',
      description: 'Initiate the process to upgrade a user\'s support tier',
      parameters: {
        type: 'object',
        properties: {
          target_tier: {
            type: 'string',
            enum: ['basic', 'premium', 'enterprise'],
            description: 'The support tier to upgrade to'
          }
        },
        required: ['target_tier']
      }
    }
  },

  // === DATABASE FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'get_user_info',
      description: 'Get information about a user from the database',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username to get information for (with or without @ symbol)'
          }
        },
        required: ['user']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_learning_activities',
      description: 'Get a user\'s learning activities',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'The username to get activities for (with or without @ symbol)'
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of activities to return'
          }
        },
        required: ['user']
      }
    }
  },

  // === IMAGE FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'analyze_image',
      description: 'Analyze content of an image',
      parameters: {
        type: 'object',
        properties: {
          image_path: {
            type: 'string',
            description: 'Path or URL to the image to analyze'
          },
          detail_level: {
            type: 'string',
            enum: ['basic', 'standard', 'detailed'],
            description: 'Level of detail for the analysis'
          }
        },
        required: ['image_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compare_images',
      description: 'Compare multiple images',
      parameters: {
        type: 'object',
        properties: {
          image_paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Paths or URLs to the images to compare'
          },
          comparison_type: {
            type: 'string',
            enum: ['similarity', 'differences', 'objects'],
            description: 'Type of comparison to perform'
          }
        },
        required: ['image_paths']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Generate an image from a text prompt',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text prompt describing the image to generate'
          },
          style: {
            type: 'string',
            description: 'Optional style for the image'
          },
          count: {
            type: 'integer',
            description: 'Number of images to generate'
          }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_image_variation',
      description: 'Generate a variation of an existing image',
      parameters: {
        type: 'object',
        properties: {
          image_path: {
            type: 'string',
            description: 'Path or URL to the source image'
          },
          prompt: {
            type: 'string',
            description: 'Optional text prompt to guide the variation'
          },
          count: {
            type: 'integer',
            description: 'Number of variations to generate'
          }
        },
        required: ['image_path']
      }
    }
  },
  
  // === WEB SEARCH FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query'
          },
          num_results: {
            type: 'integer',
            description: 'Maximum number of results to return'
          },
          search_type: {
            type: 'string',
            enum: ['web', 'news', 'images'],
            description: 'Type of search to perform'
          }
        },
        required: ['query']
      }
    }
  },

  // === EVENT FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'get_events',
      description: 'Get information about upcoming Cosmos ecosystem events, Twitter spaces, Discord events, etc.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: 'Maximum number of events to return (default: 5)'
          },
          days_ahead: {
            type: 'integer',
            description: 'Number of days ahead to look for events (default: 7)'
          }
        }
      }
    }
  },
  
  // === JACKAL FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'pin_video',
      description: 'Pin a video to Jackal network for storage and transcription',
      parameters: {
        type: 'object',
        properties: {
          video_url: {
            type: 'string',
            description: 'The URL of the video to pin'
          },
          title: {
            type: 'string',
            description: 'Optional title for the video'
          },
          description: {
            type: 'string',
            description: 'Optional description for the video'
          }
        },
        required: ['video_url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_pinned_videos',
      description: 'Get a list of videos pinned to Jackal network',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: 'Maximum number of videos to return'
          },
          offset: {
            type: 'integer',
            description: 'Offset for pagination'
          }
        }
      }
    }
  },

  // === TRUST REGISTRY FUNCTIONS ===
  {
    type: 'function',
    function: {
      name: 'create_root_registry',
      description: 'Create a root trust registry for the SNAILS ecosystem',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the root registry'
          },
          description: {
            type: 'string',
            description: 'Description of the registry purpose'
          },
          trustFramework: {
            type: 'string',
            description: 'URL of the trust framework document'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_bot_identity_registry',
      description: 'Create a bot identity registry for Dail Bot',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the bot identity registry'
          },
          description: {
            type: 'string',
            description: 'Description of the registry purpose'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verify_trusted_issuer',
      description: 'Verify if a DID is a trusted issuer for a specific credential type',
      parameters: {
        type: 'object',
        properties: {
          issuerDid: {
            type: 'string',
            description: 'DID of the issuer to verify'
          },
          credentialType: {
            type: 'string',
            description: 'Type of credential to verify authorization for'
          }
        },
        required: ['issuerDid', 'credentialType']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'register_credential_type',
      description: 'Register a credential type with a trust registry',
      parameters: {
        type: 'object',
        properties: {
          registryId: {
            type: 'string',
            description: 'ID of the registry to register the credential type with'
          },
          credentialType: {
            type: 'string',
            description: 'Credential type to register'
          },
          metadata: {
            type: 'object',
            description: 'Additional metadata for the credential type'
          }
        },
        required: ['registryId', 'credentialType']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_registry_by_did',
      description: 'Get a trust registry by its DID',
      parameters: {
        type: 'object',
        properties: {
          did: {
            type: 'string',
            description: 'DID of the registry to look up'
          }
        },
        required: ['did']
      }
    }
  }
];

// Helper to get a specific function definition by name
function getFunctionDefinition(name) {
  return functionDefinitions.find(def => def.function.name === name);
}

// Export the function definitions
module.exports = {
  functionDefinitions,
  getFunctionDefinition
}; 