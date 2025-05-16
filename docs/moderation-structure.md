# Cheqd Bot Moderation Structure

## Overview: Group-Controlled Opt-In Model

The Cheqd Bot implements a "Group-Controlled Opt-In Model" for moderation that prioritizes the autonomy of group administrators while enabling optional cross-chat features.

## Core Principles

1. **Group Autonomy**: Group administrators maintain complete control over their groups and bot features
2. **Opt-In Participation**: Cross-chat moderation features are strictly opt-in
3. **Credential-Based Authority**: All moderation roles are backed by verifiable credentials on Cheqd
4. **Transparent Hierarchy**: Clear separation between group-specific and platform-wide roles

## Authority Structure

### Group-Level Authority (Controlled by Group Admins)

| Role | Description | Authority |
|------|-------------|-----------|
| **Group Admin** | Telegram administrators and owners | Complete control over group settings, moderator appointments, and all bot features |
| **Group Moderator** | Trusted members appointed by admins | Moderation capabilities as defined by group admins (warnings, mutes, message deletion) |
| **Group Helper** | Entry-level moderators/trusted users | Limited capabilities (reporting, content flagging) |

### Platform-Level Authority (Optional)

| Role | Description | Applies To |
|------|-------------|-----------|
| **SNAILS Platform Moderator** | Platform-wide moderators | Only affects groups that have opted into the platform moderation system |
| **Cross-Chat Moderator** | Moderators who work across multiple groups | Only affects groups that have opted into cross-chat moderation |

## Key Features

### For Group Administrators

- **Complete Control**: Full authority over their group's moderation settings
- **Feature Selection**: Can enable/disable any bot feature, including cross-chat moderation
- **Moderator Management**: Can appoint and remove moderators within their own group
- **Credential Issuance**: Can issue moderation credentials for their own group

### Opt-In Features

- **Cross-Chat Moderation**: When enabled, allows sharing of ban lists and coordination with other participating groups
- **Platform Moderation**: When enabled, allows SNAILS platform moderators to assist with moderation
- **Trust Network**: When enabled, participates in the wider trust network for verifiable credentials

## Trust Registry Integration

The moderation structure integrates with the Cheqd trust registry as follows:

- Each group represents a **COMMUNITY** entity in the trust registry
- Group admins can issue credentials within their community scope
- Cross-chat features operate through the **PARTNER** level in the trust registry
- The SNAILS platform represents the **ROOT** of the trust registry

## Implementation Details

### Credential Types

- **GroupAdminCredential**: Issued to group administrators
- **GroupModeratorCredential**: Issued to group moderators
- **CrossChatModeratorCredential**: Issued to cross-chat moderators (requires platform approval)
- **PlatformModeratorCredential**: Issued to platform moderators (requires platform approval)

### Authorization Flow

1. All moderation actions first check if the user has appropriate credentials
2. Group-level actions are authorized by group-specific credentials
3. Cross-chat actions are only authorized if:
   - The user has appropriate cross-chat credentials
   - Both groups have opted into cross-chat moderation
   - The action type is permitted for cross-chat moderation

## Group Setup Process

During group setup:

1. The bot analyzes the group to recommend a subscription tier
2. Group admins select their subscription and features
3. Group admins explicitly choose whether to enable cross-chat features
4. The system issues appropriate credentials to group admins
5. Group admins can then manage their own moderation team 