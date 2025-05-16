# AI TruthRise Hackathon - Cheqd Bot

## Project Overview

Cheqd Bot is our submission for the AI TruthRise Hackathon, addressing the challenge of establishing trust in AI systems through verifiable credentials and blockchain-based verification.

## Problem Statement

As AI becomes increasingly prevalent, the lack of trust verification creates serious problems:

- Deepfakes and synthetic media are being used for scams (like the £20 million Hong Kong scam via deepfake video call)
- Impersonation using AI is becoming more sophisticated (such as the Brad Pitt impersonation scam)
- Users cannot verify if AI agents are acting in their best interests
- There's no standardized way to verify AI-generated content

## Our Solution

Cheqd Bot provides a comprehensive trust framework built on blockchain-verified credentials, featuring:

1. **Trust Registry**: A hierarchical system for establishing chains of trust from root authorities
2. **Verifiable Credentials**: Cryptographically secure credentials for education, moderation, support, and P2P assistance
3. **Credential Verification Flow**: A robust 7-step verification process ensuring cryptographic integrity
4. **Hybrid Storage**: On-chain verification with SQL caching for performance optimization

## Key Technical Features

### Trust Registry Architecture

Our system implements a four-tiered trust registry:

- **ROOT**: Top-level authority (SNAILS Co-Op)
- **PARTNER**: Trusted partner organizations
- **COMMUNITY**: Individual Telegram communities
- **ISSUER**: Bot instances authorized to issue credentials

### Credential Types

- **ModeratorCredential**: For community moderation authority
- **EducationalCredential**: For educational achievements
- **SupportTierCredential**: For access to support features
- **P2PSupportProviderCredential**: For peer-to-peer support providers

### Verification Process

All credentials undergo thorough verification:

1. Retrieve credential from blockchain or cache
2. Validate credential format and structure
3. Trace the trust chain
4. Verify the trust anchor (Dail Bot or Co-Op)
5. Validate credential type authorization
6. Perform credential-specific validation
7. Return comprehensive verification details

## Demonstration

Our demonstration showcases:

1. **Credential Issuance**: Creating and issuing verifiable credentials
2. **Cross-Platform Verification**: Verifying credentials across different platforms
3. **Trust Chain Validation**: Showing how trust chains prevent spoofing
4. **Real-World Use Case**: Preventing impersonation and deepfake scams

## Technical Innovation

- **DID Integration**: Full integration with Cheqd's DID (Decentralized Identifier) system
- **Performance Optimization**: Hybrid approach using both blockchain and local caching
- **Modular Architecture**: Extensible design allowing for new credential types
- **Telegram Integration**: Seamless user experience via familiar Telegram interface

## Future Roadmap

1. **Cross-Chain Support**: Expanding beyond Cheqd to other blockchains
2. **Content Credential Expansion**: Adding more AI content verification features
3. **Trust Ecosystem Growth**: Building a wider network of trust partners
4. **SDK Development**: Enabling other developers to integrate with our system

## Impact & Potential

Our solution addresses the hackathon challenges by:

- **AI Agent Verification**: Ensuring AI agents are trustworthy
- **Preventing Impersonation**: Verifying agent-to-agent credentials
- **Trusted Data Handling**: Confirming AI is using verified information
- **Content Authentication**: Providing a framework for verifying AI-generated content

## Resources

- [API Documentation](./API.md)
- [Telegram Commands](./TELEGRAM-COMMANDS.md)
- [Installation Guide](./INSTALLATION.md)
- [Trust Registry Architecture](./trust-registry-architecture.md)
- [Trust Registry Diagrams](./trust-registry-diagram.md) 