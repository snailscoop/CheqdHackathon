/**
 * Educational Credential Schema
 * 
 * Schema definition for educational credentials to be used with Cheqd Trust Registry.
 * This schema includes fields for educational achievements, quiz completions,
 * and course progress tracking.
 */

const educationalCredentialSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "Educational Credential",
  description: "Schema for educational achievements and progress tracking",
  required: [
    "achievementType",
    "subject",
    "issuer",
    "issuanceDate"
  ],
  properties: {
    // Credential type information
    achievementType: {
      type: "string",
      enum: ["QuizCompletion", "CourseCompletion", "Specialization", "Certificate"],
      description: "Type of educational achievement"
    },
    name: {
      type: "string",
      description: "Name of the achievement"
    },
    description: {
      type: "string",
      description: "Description of the achievement"
    },
    
    // Subject information (the learner)
    subject: {
      type: "object",
      description: "Information about the learner who earned this credential",
      required: ["id", "name"],
      properties: {
        id: {
          type: "string",
          description: "DID or unique identifier of the learner"
        },
        name: {
          type: "string",
          description: "Name of the learner"
        },
        telegramId: {
          type: "string",
          description: "Telegram ID of the learner (if applicable)"
        }
      }
    },
    
    // Achievement details
    achievement: {
      type: "object",
      description: "Details about the educational achievement",
      properties: {
        topic: {
          type: "string",
          description: "Topic or subject area of the achievement"
        },
        category: {
          type: "string",
          description: "Category of educational content (e.g., Blockchain, DeFi, etc.)"
        },
        score: {
          type: "number",
          description: "Score achieved (for quiz/test completions)"
        },
        maxScore: {
          type: "number",
          description: "Maximum possible score"
        },
        percentile: {
          type: "number",
          description: "Percentile rank compared to other learners"
        },
        completedModules: {
          type: "array",
          description: "List of completed modules (for course completions)",
          items: {
            type: "string"
          }
        },
        skills: {
          type: "array",
          description: "Skills demonstrated by this achievement",
          items: {
            type: "string"
          }
        },
        level: {
          type: "string",
          enum: ["Beginner", "Intermediate", "Advanced", "Expert"],
          description: "Difficulty level of the achievement"
        }
      }
    },
    
    // Verification information
    verificationMethod: {
      type: "string",
      description: "Method used to verify the achievement"
    },
    evidence: {
      type: "array",
      description: "Evidence supporting the achievement claim",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "Type of evidence"
          },
          url: {
            type: "string",
            description: "URL where evidence can be accessed"
          },
          description: {
            type: "string",
            description: "Description of the evidence"
          }
        }
      }
    },
    
    // Progress tracking
    progressTrackingId: {
      type: "string",
      description: "ID for tracking overall educational progress"
    },
    prerequisiteCredentials: {
      type: "array",
      description: "List of credential IDs that were prerequisites for this achievement",
      items: {
        type: "string"
      }
    },
    
    // Issuer information
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
    
    // Timing information
    issuanceDate: {
      type: "string",
      format: "date-time",
      description: "Date and time when the credential was issued"
    },
    expirationDate: {
      type: "string",
      format: "date-time",
      description: "Date and time when the credential expires (if applicable)"
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

module.exports = educationalCredentialSchema; 