# Cheqd Trust Registry Diagrams

## Comprehensive Trust Registry Structure

```
┌──────────────────────────────────────────────────────────────────┐
│                  Comprehensive Trust Registry                     │
└──────────────────────────────────────────────────────────────────┘
                               │
                ┌──────────────┴───────────────┐
                ▼                              ▼
      ┌───────────────────┐        ┌─────────────────────┐
      │     Dail Bot      │        │   SNAILS Co-Op      │
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

## Trust Chain Hierarchy

```
┌──────────────────────────────────────────────────────────┐
│                  Trust Chain Hierarchy                    │
└──────────────────────────────────────────────────────────┘
                      │
  ┌───────────────────┴──────────────────────┐
  ▼                                          ▼
┌───────────────────────┐         ┌──────────────────────┐
│      Root Registry    │         │    SNAILS Co-Op      │
│  (Registry Type: ROOT)│         │   (On-chain entity)  │
└───────────┬───────────┘         └──────────────────────┘
            │
  ┌─────────┴────────┐
  ▼                  ▼
┌───────────────┐  ┌───────────────────┐
│Partner Registry│  │ Bot Registry      │
│(Type: PARTNER) │  │ (Type: ISSUER)    │
└───────┬───────┘  └─────────┬─────────┘
        │                    │
        ▼                    ▼
┌─────────────────┐  ┌────────────────────┐
│Community Registry│  │Credential Issuance │
│(Type: COMMUNITY) │  │(Moderation, Education│
└─────────────────┘  │Support, P2P Support)│
                     └────────────────────┘
```

## Technical Integration

```
┌──────────────────────────────────────────────────────────┐
│                Technical Integration                      │
└──────────────────────────────────────────────────────────┘
                           │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
┌──────────────────┐ ┌──────────────┐ ┌───────────────┐
│Trust Registry Svc│ │Trust Chain Svc│ │Credential Svcs│
└────────┬─────────┘ └──────┬───────┘ └───────┬───────┘
         │                  │                 │
         └──────────────────┼─────────────────┘
                            │
                 ┌──────────┴─────────┐
                 ▼                    ▼
      ┌────────────────────┐  ┌────────────────────┐
      │On-chain Operations │  │   Local Storage    │
      │(Cheqd blockchain)  │  │   (SQLite, GunDB)  │
      └────────────────────┘  └────────────────────┘
``` 