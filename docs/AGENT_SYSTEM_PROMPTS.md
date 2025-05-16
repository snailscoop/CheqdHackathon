# System Prompt Engineering Guide

This document explains how the system prompts have been optimized to make Grok function more like an agent than a chatbot.

## Core Improvements

The system has been enhanced with a centralized system prompts module that ensures consistency across all interactions. This eliminates contradictions in permissions and capabilities descriptions that previously existed between different modules.

## Key Features

### 1. Domain-Specific Instructions

Each of the three core domains (moderation, education, support) has specific instructions that guide Grok's behavior:

- **Moderation Domain**: Clear instructions about permissions and actions for moderation tasks
- **Education Domain**: Guidelines for educational content delivery and quiz management
- **Support Domain**: Structure for handling support tier inquiries and upgrades

### 2. Unified Language and Terminology

The system prompts now use consistent language and terminology across all modules:
- Consistent descriptions of functions and capabilities
- Uniform permission statements
- Standardized action execution instructions

### 3. Action-Oriented Focus

All prompts prioritize taking actions over providing information:
- Explicit instructions to prioritize function calls
- Specific examples showing input → action mappings
- Clear direction to avoid unnecessary explanations

### 4. Context-Aware Prompting

The system adapts prompts based on:
- Conversation history
- User context
- Chat environment (group vs. private)
- Previous interactions

### 5. Parameter Extraction Enhancement

Improved methods for extracting action parameters:
- Inferring parameters from context
- Using conversation history to fill in missing parameters
- Default values for optional parameters

## Implementation Details

The `systemPrompts.js` module provides:

1. `getCoreAgentPrompt()` - The fundamental identity of the agent
2. `getAgentIdentityPrompt(user, chat)` - Builds on core with user/chat context
3. `getActionExecutionPrompt()` - Instructions for executing actions
4. `getDomainInstructions(domain)` - Domain-specific guidance
5. `getExecutionExamplesPrompt()` - Examples of input → action mappings
6. `getSystemPrompt(options)` - Combines all components
7. `getFunctionCallPrompt(options)` - Function-calling specific instructions
8. `getJSONResponsePrompt(options)` - Format for JSON response structure
9. `getImageAnalysisPrompt(focusArea)` - Image analysis specialty prompts

## Usage Examples

### Intent Recognition

Before:
```
> I want to kick Bob
< I understand you want to kick Bob. To do that, please use the command: /kick @Bob
```

After:
```
> I want to kick Bob
< [Executes kick_user function with parameters: {user: "Bob"}]
```

### Multi-Step Tasks

Before:
```
> Start a quiz
< What topic would you like the quiz to be about?
> Blockchain
< Here's a quiz about blockchain... [proceeds to ask questions one by one]
```

After:
```
> Start a quiz
< [Executes generate_quiz function with default parameters]
> How am I doing?
< [Executes show_progress function, remembering context of ongoing quiz]
```

### Parameter Inference

Before:
```
> Upgrade my tier
< What tier would you like to upgrade to?
> Premium
< [Executes upgrade after two interactions]
```

After:
```
> Upgrade my tier
< [Executes upgrade_support_tier function with inferred parameter target_tier="premium"]
```

## Benefits

This unified system prompt approach:

1. Eliminates contradictions between modules
2. Creates a consistent agent personality
3. Reduces multi-turn interactions when unnecessary
4. Enables better parameter extraction
5. Maintains context across conversations
6. Prioritizes actions over explanations

The result is a bot that behaves more like an agent that takes action rather than a chatbot that simply provides information. 