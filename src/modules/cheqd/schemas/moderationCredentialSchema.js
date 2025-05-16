/**
 * Moderation Credential Schema
 * 
 * Schema definition for moderation credentials to be used with Cheqd Trust Registry.
 * This schema defines moderation authorities and permissions.
 */

const moderationCredentialSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "Moderation Credential",
  description: "Schema for moderation authority and permissions",
  required: [
    "moderationRole",
    "subject",
    "issuer",
    "issuanceDate"
  ],
  properties: {
    // Moderation role information
    moderationRole: {
      type: "string",
      enum: ["CommunityModerator", "GroupAdmin", "CrossChatModerator", "MasterModerator", "PlatformAdmin"],
      description: "Type of moderation role granted"
    },
    name: {
      type: "string",
      description: "Name of the moderation credential"
    },
    description: {
      type: "string",
      description: "Description of the moderation permissions"
    },
    
    // Subject information (the moderator)
    subject: {
      type: "object",
      description: "Information about the entity receiving moderation authority",
      required: ["id", "name"],
      properties: {
        id: {
          type: "string",
          description: "DID of the moderator"
        },
        name: {
          type: "string",
          description: "Name of the moderator"
        },
        telegramId: {
          type: "string",
          description: "Telegram ID of the moderator (if applicable)"
        },
        credentials: {
          type: "array",
          description: "References to relevant credentials that qualified this person for moderation",
          items: {
            type: "string"
          }
        }
      }
    },
    
    // Moderation scope
    scope: {
      type: "object",
      description: "Scope of moderation authority",
      properties: {
        chatIds: {
          type: "array",
          description: "Telegram chat IDs where this authority applies",
          items: {
            type: "string"
          }
        },
        groupIds: {
          type: "array",
          description: "Group IDs where this authority applies",
          items: {
            type: "string"
          }
        },
        global: {
          type: "boolean",
          description: "Whether this authority applies globally"
        }
      }
    },
    
    // Permissions
    permissions: {
      type: "object",
      description: "Specific moderation permissions granted",
      properties: {
        canRemoveMessages: {
          type: "boolean",
          description: "Authority to remove messages"
        },
        canBanUsers: {
          type: "boolean",
          description: "Authority to ban users"
        },
        canMuteUsers: {
          type: "boolean",
          description: "Authority to mute users"
        },
        canApproveContent: {
          type: "boolean",
          description: "Authority to approve content"
        },
        canManageCredentials: {
          type: "boolean",
          description: "Authority to manage credentials"
        },
        canManageModerators: {
          type: "boolean",
          description: "Authority to manage other moderators"
        },
        canAccessLogs: {
          type: "boolean",
          description: "Authority to access moderation logs"
        }
      }
    },
    
    // Accountability
    accountabilityMeasures: {
      type: "array",
      description: "Measures ensuring accountability of the moderator",
      items: {
        type: "string"
      }
    },
    
    // Reference to higher authority
    appointedBy: {
      type: "object",
      description: "Information about the entity that appointed this moderator",
      properties: {
        id: {
          type: "string",
          description: "DID of the appointing entity"
        },
        name: {
          type: "string",
          description: "Name of the appointing entity"
        },
        role: {
          type: "string",
          description: "Role of the appointing entity"
        }
      }
    },
    
    // Issuer information
    issuer: {
      type: "object",
      description: "Information about the issuing entity",
      required: ["id", "name"],
      properties: {
        id: {
          type: "string",
          description: "DID of the issuer"
        },
        name: {
          type: "string",
          description: "Name of the issuer"
        },
        url: {
          type: "string",
          description: "URL of the issuer"
        },
        role: {
          type: "string",
          description: "Role of the issuer"
        }
      }
    },
    
    // Timing information
    issuanceDate: {
      type: "string",
      format: "date-time",
      description: "Date and time when the credential was issued"
    },
    expirationDate: {
      type: "string",
      format: "date-time",
      description: "Date and time when the credential expires"
    },
    
    // Additional verification information
    verificationMethod: {
      type: "string",
      description: "Method used to verify the credential"
    },
    
    // Display information
    visual: {
      type: "object",
      description: "Visual representation information",
      properties: {
        backgroundColor: {
          type: "string",
          description: "Background color for credential display"
        },
        foregroundColor: {
          type: "string",
          description: "Foreground color for credential display"
        },
        image: {
          type: "string",
          description: "URL to an image representing the credential"
        },
        badge: {
          type: "string",
          description: "URL to a badge image"
        }
      }
    }
  }
};

module.exports = moderationCredentialSchema; 