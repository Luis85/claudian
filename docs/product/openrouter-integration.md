---
title: OpenRouter Integration
date: 2026-06-13
status: draft
scope: feature spec
---

# OpenRouter Integration

## Overview

OpenRouter is an opt-in provider gateway that routes LLM prompts through a unified API for cost optimization and model availability. Users can integrate OpenRouter as an alternative provider in Claudian to manage costs and access a broader model catalog without maintaining multiple provider API keys.

## Problem Statement

Users currently manage multiple LLM provider API keys and have limited visibility into cost optimization strategies. OpenRouter solves this by:
- Consolidating API key management to a single endpoint
- Providing cost-optimized routing across model providers
- Exposing a unified model catalog with price comparison
- Enabling fallback strategies when preferred models are unavailable

## User Stories

### US-1: Opt-in OpenRouter Provider
**As a** user  
**I want to** enable OpenRouter as an alternative provider in the chat sidebar  
**So that** I can route LLM prompts through OpenRouter for cost management

**Acceptance Criteria:**
- OpenRouter can be enabled/disabled via settings
- When enabled, OpenRouter appears as a selectable provider option
- The feature is opt-in and does not affect existing provider configurations

### US-2: Manual Model Selection
**As a** user  
**I want to** manually select which provider and model OpenRouter should use  
**So that** I have explicit control over cost and performance tradeoffs

**Acceptance Criteria:**
- Settings UI exposes a dropdown/selector for available models
- Users can browse OpenRouter's model catalog with pricing information
- Selected model persists across sessions
- Chat turns respect the user's model selection

### US-3: Automatic Model Selection
**As a** user  
**I want to** delegate model selection to OpenRouter's routing algorithm  
**So that** I benefit from OpenRouter's cost optimization without manual decisions

**Acceptance Criteria:**
- An "Auto" or "Recommended" mode is available
- When enabled, OpenRouter picks the optimal model based on its routing algorithm
- User can see which model was selected in the chat UI
- The selected model remains consistent across follow-up turns in the same conversation

### US-4: Agent Board Support
**As a** user  
**I want to** use OpenRouter as the provider for Agent Board work orders  
**So that** I can cost-optimize automated agent runs

**Acceptance Criteria:**
- OpenRouter provider is selectable in Agent Board settings
- Work orders respect the selected OpenRouter model
- Manual and automatic model selection both work on Agent Board

## Functional Requirements

### Configuration
- OpenRouter API key stored securely in Obsidian `SecretStorage` (consistent with other providers)
- Settings tab with:
  - Enable/disable toggle
  - API key input (masked)
  - Model selection mode: "Manual" or "Auto"
  - For manual mode: dropdown/search of available models with pricing display
  - For auto mode: informational text explaining OpenRouter's routing logic
- Auto mode model representation: Register `openrouter/auto` as a selectable model option so Agent Board can persist Auto mode as a work-order frontmatter value (required for launch validation and card-to-card portability)

### Provider Registration
- Unlike other providers (Claude, Codex, Opencode, Cursor), OpenRouter is API-key-only and does not require a CLI command
- Provider registration should make CLI requirement optional: the first-run banner and registration UI should not show "Requires CLI on path" for OpenRouter
- Onboarding path: API key input → model catalog fetch → ready for use (no CLI validation step)

### Chat Sidebar Integration
- Provider selector includes "OpenRouter" when enabled
- Selecting OpenRouter allows switching between manual and auto model modes
- Chat messages display the OpenRouter provider and selected model (e.g., "via OpenRouter (gpt-4-turbo)")

### Agent Board Integration
- OpenRouter available as a provider option in Agent Board settings
- Work-order runs respect the OpenRouter model selection (both manual and `openrouter/auto`)
- Model metadata (pricing, capabilities) propagates to work-order context
- **Tool execution requirement (MVP gate)**: Agent Board work orders must perform file edits and checklist updates as required by the work-order prompt. For MVP, OpenRouter integration requires integration with a local agent runtime that executes tools (e.g., Claude Agent SDK). Read-only inference-only work orders are explicitly out of MVP scope.

### Auto Router Session Pinning
- For Auto mode, derive a stable `session_id` from the Claudian conversation ID or Agent Board run ID
- Send this `session_id` with each request to OpenRouter's Auto Router
- **Session expiry handling**: OpenRouter's Auto Router session stickiness expires after 5 minutes of inactivity. For conversations/runs paused/resumed beyond this window:
  - Persist the actual `model` name returned in the first Auto Router response (not just the session_id)
  - On subsequent requests after the sticky window expires, reuse the persisted model instead of allowing Auto Router to re-route
  - This ensures consistent model selection across the full conversation/work-order lifecycle, not just within the 5-minute window

### Model Catalog
- Query OpenRouter API to fetch available models with metadata (pricing, availability, supported parameters)
- Cache model list to avoid excessive API calls
- Display pricing information in model selector UI
- **For Agent Board only**: Identify tool-capable models by checking `supported_parameters` (e.g., `tools` support)
- Separate/filter tool-capable models in the Agent Board model picker so users can easily select work-order-appropriate models

### Agent Board Tool Capability Validation
- Launch validation must verify that selected models support required tool execution:
  - If a work order is assigned to a tool-less model, reject the launch with clear messaging
  - Allow sidebar chat to use any OpenRouter model (inference-only), but restrict Agent Board to tool-capable models when tools are required

## Non-Functional Requirements

- **Backward Compatibility:** Existing provider configurations remain unaffected
- **Graceful Degradation:** If OpenRouter API is unavailable, fallback to manual configuration or disable the feature
- **Performance:** Model catalog fetch should not block UI or startup
- **Security:** API keys handled via `SecretStorage` only, never logged or persisted in config files

## Open Questions

1. **Model Fallback:** What happens if the user's selected model becomes unavailable on OpenRouter? Should we implement automatic fallback logic?
2. **Pricing Display:** Should we refresh pricing periodically, or rely on OpenRouter's documented rates?
3. **Rate Limits:** How do we handle OpenRouter API rate limits on model catalog queries?
4. **Metrics:** Should we surface usage/cost tracking within the chat UI, or defer to OpenRouter's dashboard?
5. **Conflict Resolution:** If a user has OpenRouter and other providers configured, how should they switch between them in the UI?

## Success Metrics

- Users can successfully configure and enable OpenRouter in settings
- Chat messages route through OpenRouter without errors
- Agent Board work orders complete with OpenRouter provider
- Model selection (manual or auto) consistently applies across sessions
- No impact on performance or stability of existing providers

## Scope and Constraints

### Included in MVP
- OpenRouter provider registration and settings UI
- Manual model selection with catalog browsing
- Automatic model selection (routing delegation)
- Chat sidebar integration
- Agent Board integration (provider selection + manual/automatic model selection)

### Future / Out of Scope
- Pricing analytics dashboard
- Cost alerting and budgets
- Advanced fallback strategies
- Usage tracking and reporting
- OpenRouter-specific command features

## Related Documents

- Claudian Architecture: `CLAUDE.md` (provider boundaries and architecture)
- Claude Provider Reference: `src/providers/claude/CLAUDE.md`
- Codex Provider Reference: `src/providers/codex/CLAUDE.md`
- Chat Feature: `src/features/chat/CLAUDE.md`
- Agent Board: `src/features/tasks/CLAUDE.md`

## Notes

- OpenRouter integration follows the existing provider pattern established by Claude, Codex, Opencode, and Cursor
- Provider-agnostic runtime contracts should be leveraged; OpenRouter adaption code belongs in `src/providers/openrouter/`
- API key storage must use `SecretStorage` to maintain parity with other providers (see `src/core/security/secretStore.ts`)
