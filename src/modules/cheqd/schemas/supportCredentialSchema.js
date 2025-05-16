/**
 * Support Credential Schema
 * 
 * Schema definition for support credentials to be used with Cheqd Trust Registry.
 * This schema defines tiered support access levels from basic to premium.
 */

const supportCredentialSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "Support Credential",
  description: "Schema for tiered support access and capabilities",
  required: [
    "supportTier",
    "subject",
    "issuer",
    "issuanceDate"
  ],
  properties: {
    // Support tier information
    supportTier: {
      type: "string",
      enum: ["Basic", "Standard", "Premium", "Enterprise", "Admin"],
      description: "Level of support access granted"
    },
    name: {
      type: "string",
      description: "Name of the support credential"
    },
    description: {
      type: "string",
      description: "Description of the support permissions"
    },
    
    // Subject information (credential holder)
    subject: {
      type: "object",
      description: "Information about the entity receiving support access",
      required: ["id", "name"],
      properties: {
        id: {
          type: "string",
          description: "DID of the credential subject"
        },
        name: {
          type: "string",
          description: "Name of the credential subject"
        },
        telegramId: {
          type: "string",
          description: "Telegram ID of the subject (if applicable)"
        },
        organizationId: {
          type: "string",
          description: "Organization ID of the subject (if applicable)"
        }
      }
    },
    
    // Support scope
    scope: {
      type: "object",
      description: "Scope of support access",
      properties: {
        products: {
          type: "array",
          description: "Products covered by this support credential",
          items: {
            type: "string"
          }
        },
        services: {
          type: "array",
          description: "Services covered by this support credential",
          items: {
            type: "string"
          }
        }
      }
    },
    
    // Support details
    supportDetails: {
      type: "object",
      description: "Details about the support provided",
      properties: {
        responseTime: {
          type: "string",
          description: "Expected response time for support requests"
        },
        availabilityHours: {
          type: "string",
          description: "Hours during which support is available"
        },
        channels: {
          type: "array",
          description: "Support channels available",
          items: {
            type: "string",
            enum: ["chat", "email", "phone", "video", "inPerson"]
          }
        },
        dedicatedAgent: {
          type: "boolean",
          description: "Whether a dedicated support agent is provided"
        },
        maxIncidentsPerMonth: {
          type: "integer",
          description: "Maximum number of support incidents per month"
        },
        priorityLevel: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Priority level for support requests"
        }
      }
    },
    
    // Access permissions
    accessPermissions: {
      type: "object",
      description: "Specific access permissions granted",
      properties: {
        canAccessPremiumContent: {
          type: "boolean",
          description: "Access to premium content"
        },
        canAccessDevelopmentTools: {
          type: "boolean",
          description: "Access to development tools"
        },
        canRequestFeatures: {
          type: "boolean",
          description: "Can request new features"
        },
        canParticipateInBeta: {
          type: "boolean",
          description: "Can participate in beta testing"
        },
        canReceiveTraining: {
          type: "boolean",
          description: "Can receive training services"
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
        }
      }
    }
  }
};

module.exports = supportCredentialSchema; 