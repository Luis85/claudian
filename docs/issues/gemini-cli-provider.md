---
type: issue
id: issue-20260603-gemini-cli-provider
title: Add a Gemini CLI provider (+ pluggable custom-binary) for roster parity
status: open
priority: 3 - low
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (PN-10)"
scope: provider-roster
tags:
  - provider
  - gemini
  - roadmap
---

# Gemini CLI provider

## Problem

Competing Obsidian embedded-agent plugins (Agent Client ~2.1k★, Agentic Copilot) ship Gemini CLI and
arbitrary-custom-binary support. Claudian has four providers but no Gemini, leaving a roster-parity gap.

## Proposed change

Add a Gemini CLI provider via the existing `ProviderRegistration` + stream-mapper seam (likely ACP if
Gemini CLI supports it, otherwise its native headless output format). Consider a pluggable custom-binary
provider as a follow-up.

## Acceptance criteria

- Gemini CLI registered as a provider with send/stream/cancel/resume at minimum, no `providerId === 'x'`
  branches, no edits to hardcoded provider lists in `core/`/`features/`.

## Note

Sequence after ADR-0001 Phase 2b/3 so a 5th provider lands on the tightened seam (RuntimeHost + shared transport).
