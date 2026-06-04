---
type: issue
id: issue-20260603-settings-ia
title: Reorganize settings information architecture (4 buckets) as the registry port completes
status: open
priority: 2 - normal
triage: needs-scoping
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (UX-H)"
related:
  - "[[settings-registry-port-followup]]"
scope: settings-ux
tags:
  - ux
  - settings
  - information-architecture
---

# Settings information architecture reorg

## Problem

Settings are tab-heavy and the General tab is overloaded: it renders Providers, Language, Quick Actions,
Display, Conversations, Content, Input, Hotkeys, Environment, and Diagnostics — ~25+ controls in one
scroll across ~10 sections. The proposed 4-bucket IA (Basic / Workflow / Integrations / Advanced) is
unbuilt. The search bar mitigates but doesn't fix the cognitive load.

## Evidence

- `src/features/settings/ClaudianSettings.ts:303-637` (General-tab section density).

## Proposed change

Reorganize into the 4-bucket IA as the registry port (`settings-registry-port-followup`) completes — do
the IA grouping in the registry field definitions so the two land together rather than re-laying-out twice.

- **Basic:** provider enablement, model, safe mode, CLI/auth status.
- **Workflow:** skills, commands, subagents, instructions.
- **Integrations:** MCP, external paths, browser/Chrome.
- **Advanced:** env vars, custom models, context limits, diagnostics.

## Acceptance criteria

- General tab no longer carries ~25 controls in one scroll; sections grouped into the 4 buckets.
- Coordinated with the registry port so fields are defined once.
