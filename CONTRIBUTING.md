# Contributing to Cheqd Bot

Thank you for your interest in contributing to Cheqd Bot! This document provides guidelines and instructions for contributing to this project.

## Project Structure

The repository is organized as follows:

```
.
├── data/              # Database and storage files
├── docs/              # Documentation files
│   ├── trust-registry-architecture.md    # Trust registry architecture
│   ├── trust-registry-diagram.md         # Trust registry diagrams
│   ├── moderation-structure.md           # Moderation system documentation
│   └── ...                               # Other documentation
├── examples/          # Example code and usage examples
├── logs/              # Log files
├── models/            # AI models and model-related files
├── processing/        # Data processing utilities
├── reports/           # Generated reports
├── scripts/           # Utility scripts
├── src/               # Source code
│   ├── api/           # API routes and controllers
│   ├── commands/      # Bot command handlers
│   ├── config/        # Configuration files
│   ├── db/            # Database service
│   ├── handlers/      # Message handlers
│   ├── middleware/    # Bot middleware
│   ├── modules/       # Feature modules
│   │   ├── blockchain/  # Blockchain services
│   │   ├── cheqd/       # Cheqd integration
│   │   ├── education/   # Educational services
│   │   ├── grok/        # Grok AI services
│   │   ├── integration/ # Integration layer
│   │   ├── jackal/      # Jackal services
│   │   ├── moderation/  # Moderation services
│   │   └── support/     # Support services
│   ├── services/      # Core services
│   ├── utils/         # Utilities
│   ├── app.js         # Main application entry
│   └── bot.js         # Bot-specific entry
└── test/              # Test files
```

## Development Workflow

### Setting Up Development Environment

1. Clone the repository
2. Install dependencies with `npm install`
3. Copy `example.env` to `.env` and configure your environment variables
4. Run `npm run dev` to start the development server

### Making Changes

1. Create a feature branch: `git checkout -b feature-name`
2. Make your changes
3. Add and commit your changes: `git add . && git commit -m "Description of changes"`
4. Push to your branch: `git push origin feature-name`
5. Create a Pull Request

### Testing

Before submitting a PR, make sure your changes pass all tests:

```bash
npm test
```

## Coding Standards

- Follow the existing code style
- Write clear, descriptive commit messages
- Include comments for complex logic
- Update documentation when changing functionality

## Pull Request Process

1. Update the README.md with details of changes if applicable
2. Update the docs with details of changes to interfaces
3. The PR requires approval from at least one maintainer
4. Maintainers will merge the PR once approved

## Questions?

If you have any questions or need help, please open an issue or contact the project maintainers. 