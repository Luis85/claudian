---
type: issue
id: issue-20260603-provider-health-check
title: Add a per-provider "Detect & Test" health check (CLI path + auth state) in settings
status: open
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[docs/reviews/2026-06-03-comprehensive-improvement-proposal.md]] (UX-A)"
related:
  - "[[docs/ideas/2026-05-28-plugin-improvement-research-proposal.md]]"
scope: onboarding
tags:
  - ux
  - onboarding
  - settings
---

# Provider health check / Detect & Test

## Problem

There is **no CLI detection feedback or health check anywhere**. No provider settings tab has a
"Test connection / Detect CLI / status" affordance. CLI resolution failure only surfaces *after the first
send* as an inline stream error (`"Claude CLI not found…"`, `"Failed to start OpenCode. Check the CLI path
and login state."`). A new user setting a CLI path gets zero confirmation it resolved until a turn fails.
This is the #1 onboarding journey with no validation gate and the largest support-ticket category
(`spawn claude ENOENT`, login state).

## Evidence

- `src/providers/claude/runtime/ClaudeChatRuntime.ts:1165`; `OpencodeChatRuntime.ts:356` — failures only at send time.
- Provider settings tabs (`ClaudeSettingsTab.ts`, `CodexSettingsTab.ts`, …) have only descriptive copy, no test button.

## Proposed change

Add a synchronous "Detect & Test" button per provider settings tab that runs the existing `*CliResolver`
and shows the resolved CLI path + auth/login state (and a clear fix hint on failure). Lead with
auto-detection (per README guidance), not "set the path manually."

## Acceptance criteria

- Each provider tab has a Detect & Test action surfacing resolved path + auth state, with a failure hint.
- Verified manually for at least one provider where credentials are available.
