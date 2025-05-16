/**
 * AI Agent Schema
 * 
 * Schema definition for AI agent credentials to be used with Cheqd Trust Registry.
 * This schema includes fields for basic agent identity as well as educational,
 * support, and moderation capabilities.
 */

const aiAgentSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "AI Agent Credential",
  description: "Schema for AI agent identity and capability credentials",
  required: [
    "aiAgentName",
    "modelName",
    "modelVersion",
    "issuer",
    "capabilities",
    "verificationLevel"
  ],
  properties: {
    // Basic identity properties
    aiAgentName: {
      type: "string",
      description: "The name of the AI agent"
    },
    aiAgentId: {
      type: "string",
      description: "Unique identifier for the AI agent"
    },
    modelName: {
      type: "string",
      description: "The base model name (e.g., 'Grok-2')"
    },
    modelVersion: {
      type: "string",
      description: "The specific model version"
    },
    issuer: {
      type: "object",
      description: "Information about the entity that issued this credential",
      required: ["id", "name"],
      properties: {
        id: {
          type: "string",
          description: "DID of the issuing entity"
        },
        name: {
          type: "string",
          description: "Name of the issuing entity"
        },
        url: {
          type: "string",
          description: "URL of the issuing entity"
        }
      }
    },
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
    
    // Technical specifications
    technicalSpecs: {
      type: "object",
      description: "Technical specifications of the AI agent",
      properties: {
        contextWindow: {
          type: "integer",
          description: "Context window size in tokens"
        },
        maxOutputTokens: {
          type: "integer",
          description: "Maximum output tokens"
        },
        temperature: {
          type: "number",
          description: "Temperature setting for generation"
        },
        topP: {
          type: "number",
          description: "Top-p sampling parameter"
        },
        topK: {
          type: "integer",
          description: "Top-k sampling parameter"
        }
      }
    },
    
    // Capability fields
    capabilities: {
      type: "object",
      description: "AI agent capabilities",
      required: ["educational", "support", "moderation"],
      properties: {
        educational: {
          type: "object",
          description: "Educational capabilities",
          properties: {
            enabled: {
              type: "boolean",
              description: "Whether educational capabilities are enabled"
            },
            topics: {
              type: "array",
              description: "Educational topics the agent is trained on",
              items: {
                type: "string"
              }
            },
            quizGeneration: {
              type: "boolean",
              description: "Whether the agent can generate quizzes"
            },
            videoSummary: {
              type: "boolean",
              description: "Whether the agent can summarize educational videos"
            },
            learningPath: {
              type: "boolean",
              description: "Whether the agent can create personalized learning paths"
            }
          }
        },
        support: {
          type: "object",
          description: "Support capabilities",
          properties: {
            enabled: {
              type: "boolean",
              description: "Whether support capabilities are enabled"
            },
            blockchainSupport: {
              type: "array",
              description: "List of blockchains the agent can provide support for",
              items: {
                type: "string"
              }
            },
            technicalSupportLevel: {
              type: "string",
              enum: ["basic", "intermediate", "advanced"],
              description: "Level of technical support provided"
            },
            responseTime: {
              type: "string",
              description: "Expected response time for support queries"
            }
          }
        },
        moderation: {
          type: "object",
          description: "Moderation capabilities",
          properties: {
            enabled: {
              type: "boolean",
              description: "Whether moderation capabilities are enabled"
            },
            contentCategories: {
              type: "array",
              description: "Content categories the agent can moderate",
              items: {
                type: "string",
                enum: ["spam", "scam", "inappropriate", "harmful", "misleading"]
              }
            },
            crossChatModeration: {
              type: "boolean",
              description: "Whether the agent can moderate across multiple chats"
            },
            automatedAction: {
              type: "boolean",
              description: "Whether the agent can take automated moderation actions"
            }
          }
        },
        customFunctions: {
          type: "array",
          description: "List of custom functions the agent can perform",
          items: {
            type: "object",
            required: ["name", "description"],
            properties: {
              name: {
                type: "string",
                description: "Function name"
              },
              description: {
                type: "string",
                description: "Function description"
              },
              permissions: {
                type: "array",
                description: "Permissions required for this function",
                items: {
                  type: "string"
                }
              }
            }
          }
        }
      }
    },
    
    // Verification and trust
    verificationLevel: {
      type: "string",
      enum: ["self", "basic", "verified", "certified"],
      description: "Level of verification for this agent"
    },
    certifications: {
      type: "array",
      description: "List of certifications the agent has received",
      items: {
        type: "object",
        required: ["name", "issuer", "date"],
        properties: {
          name: {
            type: "string",
            description: "Name of certification"
          },
          issuer: {
            type: "string",
            description: "Entity that issued the certification"
          },
          date: {
            type: "string",
            format: "date-time",
            description: "Date when certification was issued"
          },
          expirationDate: {
            type: "string",
            format: "date-time",
            description: "Date when certification expires"
          },
          identifier: {
            type: "string",
            description: "Unique identifier for the certification"
          }
        }
      }
    },
    parentRegistry: {
      type: "string",
      description: "DID URL of the parent registry in the trust chain"
    },
    rootAuthority: {
      type: "string",
      description: "DID URL of the root authority in the trust chain"
    }
  }
};

module.exports = aiAgentSchema; 