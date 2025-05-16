# Cheqd Bot Trust Registry Architecture

## Overview

The trust registry is a hierarchical system that manages trust relationships for the Cheqd bot ecosystem. It enables verifiable credentials to be issued, verified, and trusted across different communities and contexts by creating a chain of trust from a root authority through various levels of delegation.

## About Dail Bot

Dail Bot is the core application that implements the trust registry system, serving as a trusted authority for credential issuance and verification. As a Telegram bot built on the Cheqd blockchain infrastructure, Dail Bot provides:

- Verifiable credential issuance for education, moderation, support, and P2P services
- Cryptographic verification of trust chains for all credentials
- Integration with Cheqd's DID (Decentralized Identifier) ecosystem
- On-chain storage of credential proofs with local caching for performance

Dail Bot forms the technical foundation that enables trust relationships between users, communities, and service providers while ensuring cryptographic verification of all authority delegations.

## Trust Registry Hierarchy

The trust registry is organized in a hierarchical structure with four levels:

1. **ROOT**: The top-level authority (SNAILS platform)
2. **PARTNER**: Partner organizations or related platforms
3. **COMMUNITY**: Individual Telegram groups/communities
4. **ISSUER**: Bot instances authorized to issue credentials

This hierarchy reflects real-world trust relationships and allows for flexible delegation of authority while maintaining a chain of trust back to the root.

## Comprehensive Trust Registry Structure

```
┌──────────────────────────────────────────────────────────────────┐
│                  Comprehensive Trust Registry                     │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ┴───────────────┐
                                               ▼
      ┌───────────────────┐        ┌─────────────────────┐
      │     Dail Bot      │◄───────│   SNAILS Co-Op      │
      │  (Root Authority) │        │  (Governance Body)  │
      └───────────────────┘        └─────────────────────┘
              │    │                        │
      ┌───────┘    └───────┐                │
      ▼                    ▼                ▼
┌────────────┐      ┌────────────┐   ┌─────────────────┐
│ Global Mods│      │Trusted Mods│   │  SNAILS Holders │
│ (Master    │      │(Cross-Chat │   │  (Special NFT   │
│ Moderators)│      │Moderators) │   │   Privileges)   │
└────────────┘      └────────────┘   └─────────────────┘
      │                    │                 │
      └─────────┬──────────┘                 │
                ▼                            ▼
          ┌────────────┐             ┌────────────────┐
          │ Group Admin│◄────────────┤ Admin w/ SNAILS│
          │ (Standard  │             │ (Enhanced      │
          │  Admins)   │             │  Privileges)   │
          └────────────┘             └────────────────┘
                │
         ┌──────┴───────┐
         ▼              ▼
  ┌─────────────┐   ┌───────────────┐
  │ Community   │   │ P2P Support   │
  │ Moderators  │   │ Providers     │
  └─────────────┘   └───────────────┘
                           │
                    ┌──────┴────────┐
                    ▼               ▼
             ┌────────────┐   ┌───────────┐
             │  Helper    │   │ Advisor   │
             │  Level     │   │  Level    │
             └────────────┘   └───────────┘
```

## Credential Types Registry

The system now supports an expanded set of credential types, all managed within the trust registry:

```
┌───────────────────────────────────────────────────────────────┐
│                      Credential Types                         │
└───────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼─────────────────┬─────────────────┐
          ▼                ▼                 ▼                 ▼
┌───────────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  Moderation       │ │  Education    │ │   Support     │ │ P2P Support   │
│  Credentials      │ │  Credentials  │ │  Credentials  │ │ Credentials   │
└────────┬──────────┘ └───────┬───────┘ └───────┬───────┘ └───────┬───────┘
         │                    │                 │                 │
    ┌────┴────┐         ┌────┴────┐        ┌───┴────┐       ┌────┴────┐
    ▼         ▼         ▼         ▼        ▼        ▼       ▼         ▼
┌─────────┐ ┌─────────┐ ┌────────┐ ┌──────────┐ ┌────────┐ ┌───────┐ ┌───────┐
│GroupMod │ │Platform │ │Course  │ │Quiz      │ │Basic   │ │Helper │ │Advisor│
│Credential│ │Mod Cred │ │Complet.│ │Complet.  │ │Support │ │Level  │ │Level  │
└─────────┘ └─────────┘ └────────┘ └──────────┘ └────────┘ └───────┘ └───────┘
```

## Credential Verification Process

```
┌────────────────────────────────────────────────────────────┐
│                  Credential Verification                    │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌────────────────────────────────────┐
        │  1. Retrieve Credential            │
        │  From blockchain or GunDB cache    │
        └───────────────┬────────────────────┘
                        │
                        ▼
        ┌────────────────────────────────────┐
        │  2. Check Credential Format        │
        │  Validate structure and timestamps  │
        └───────────────┬────────────────────┘
                        │
                        ▼
        ┌────────────────────────────────────┐
        │  3. Trace Trust Chain              │
        │  Walk up chain of credentials      │
        └───────────────┬────────────────────┘
                        │
                        ▼
        ┌────────────────────────────────────┐
        │  4. Verify Trust Anchor            │
        │  Confirm root is Dail Bot or Co-Op │
        └───────────────┬────────────────────┘
                        │
                        ▼
        ┌────────────────────────────────────┐
        │  5. Validate Credential Type       │
        │  Check issuer authorization for    │
        │  this specific credential type     │
        └───────────────┬────────────────────┘
                        │
                        ▼
        ┌────────────────────────────────────┐
        │  6. Credential-Specific Validation │
        │  For each credential type:         │
        │  - Moderation: Check permissions   │
        │  - Education: Verify achievement   │
        │  - Support: Verify tier access     │
        │  - P2P Support: Verify provider    │
        └───────────────┬────────────────────┘
                        │
                        ▼
        ┌────────────────────────────────────┐
        │  7. Return Verification Result     │
        │  Include all validation details    │
        └────────────────────────────────────┘
```

## Identity System: Telegram IDs vs. DIDs

The system uses two different identifier systems that work together:

### Telegram IDs
- Numeric identifiers assigned by Telegram (e.g., 7341570819)
- Used for all Telegram-specific operations
- Serve as the "known identity" in the Telegram ecosystem
- Used to look up corresponding DIDs in the system

### Decentralized Identifiers (DIDs)
- Blockchain-based identifiers on the Cheqd network (e.g., did:cheqd:testnet:b68460e-9fb4-4e0f-b2b5-79884eba7d2d)
- Used for signing operations and trust registry verification
- Provide cryptographic verification capabilities
- Stored permanently on the Cheqd blockchain

### Relationship Between IDs
- Each Telegram entity (bot, user, group) can have a corresponding DID
- The system maintains mappings between Telegram IDs and DIDs
- When operations require blockchain verification, the system looks up the appropriate DID

## Trust Registry Data Model

Each registry entry contains:

| Field | Description |
|-------|-------------|
| `registry_id` | Unique identifier for the registry (e.g., "root-1747247321725") |
| `registry_name` | Human-readable name |
| `registry_type` | Type (ROOT, PARTNER, COMMUNITY, ISSUER) |
| `parent_id` | ID of the parent registry (null for ROOT) |
| `did` | The DID associated with this registry |
| `data` | Additional metadata (JSON) |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |

## Supported Credential Types

The trust registry now supports the following credential types:

1. **ModeratorCredential**: For community moderation authority
2. **EducationalCredential**: For educational achievements and course completion
3. **SupportTierCredential**: For access to different support tiers
4. **P2PSupportProviderCredential**: For peer-to-peer support providers
5. **AdminCredential**: For administrative functions

## Accreditation Process

Accreditation is the process by which one registry authorizes another, creating a chain of trust:

1. **ROOT Accreditation**: The ROOT registry accredits PARTNER, COMMUNITY, and ISSUER registries
2. **PARTNER Accreditation**: PARTNER registries can accredit COMMUNITY registries
3. **BOT Accreditation**: The bot (ISSUER) is accredited by the ROOT to issue credentials

Accreditations are stored as verifiable credentials with:
- `BOT_CREDENTIAL_ID`: Identifies the bot's credential
- `BOT_ACCREDITATION_ID`: Identifies the accreditation credential

## Environment Configuration

The trust registry system requires these environment variables:

```
CHEQD_ROOT_REGISTRY_ID=root-[uuid]
CHEQD_ROOT_DID=did:cheqd:testnet:[did-suffix]
BOT_REGISTRY_ID=bot-[uuid]
BOT_DID=did:cheqd:testnet:[did-suffix]
BOT_CREDENTIAL_ID=bot-credential-[timestamp]
BOT_ACCREDITATION_ID=accreditation-[uuid]
```

## Credential Issuance and Verification

1. **Issuance Process**:
   - User requests credential (e.g., moderation authority, educational achievement, support tier)
   - System checks if issuer (BOT_DID) is accredited for that credential type
   - Credential is issued using the BOT_DID to sign
   - Credential is stored both locally and on-chain

2. **Verification Process**:
   - When credential is presented, system verifies:
     - Cryptographic validity (signature matches BOT_DID)
     - Trust path (BOT_DID is accredited by ROOT_DID)
     - Credential status (not revoked or expired)
     - Specific validation for credential type (permissions, achievements, support level)

## Integration with Core Systems

The trust registry integrates with multiple system components:

1. **Moderation System**:
   - Each Telegram group is a COMMUNITY entity in the trust registry
   - Moderation credentials define permission scopes and action types
   - Cross-chat features operate through the PARTNER level

2. **Educational System**:
   - Educational achievements are registered as credentials
   - Course completion triggers credential issuance
   - Educational credentials unlock access to advanced features

3. **Support System**:
   - Support tiers are encoded as credentials
   - Different tiers grant access to specific support features
   - Support credentials determine response priority and resource allocation

4. **P2P Support System**:
   - P2P support providers receive special credentials
   - Helper and Advisor levels determine support capabilities
   - All AI support tiers can access P2P support providers

## Technical Implementation

The trust registry is implemented in:
- `trustRegistryService.js`: Core service managing registries and credentials
- `trustChainService.js`: Handles trust chains and verification logic
- `didUtils.js`: Manages DID operations
- `signUtils.js`: Handles cryptographic signing operations
- `educationalCredentialService.js`: Manages educational credentials
- `supportCredentialService.js`: Manages support tier and P2P support credentials
- `moderationCredentialService.js`: Manages moderation credentials

## Initialization Process

1. System checks for existing ROOT registry (CHEQD_ROOT_REGISTRY_ID)
2. If not found, creates new ROOT registry and DID
3. Creates BOT registry and associates BOT_DID
4. ROOT registry accredits BOT registry
5. Stores all registry and accreditation IDs in environment

## Security Considerations

- Registry DIDs must be properly secured
- The ROOT registry DID is particularly sensitive
- Chain of trust must be maintained for credential verification
- Revocation capability ensures compromised DIDs can be addressed
- P2P Support credentials require additional validation to prevent abuse
- Moderation credentials use a hierarchical authority structure to prevent escalation attacks 