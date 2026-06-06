---
type: issue
id: issue-20260603-actionable-error-states
title: Render runtime errors as actionable cards (open settings, retry) + handle context-too-large / unauthenticated
status: done
priority: 1 - high
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (UX-F, UX-J)"
related:
  - "[[provider-health-check-detect-and-test]]"
scope: error-states
tags:
  - ux
  - error-handling
  - onboarding
---

# Actionable runtime error / empty states

## Problem

Runtime errors render as **plain inline text with no recovery action** — `projectErrorText` just prefixes
the message and it appears as a normal stream line. No error card, no "Open settings / Fix CLI path", no
retry. "CLI not found" and "check login state" tell the user *what* but provide no *click-through* to fix
it. Related gaps: no graceful "context too large — trim attachments" handling (only the >80% meter), and
"unauthenticated" is not a distinct guided state (folded into generic start errors).

## Evidence

- `src/features/chat/.../StreamProjection.ts:102-104` (`projectErrorText` prefix only).
- No token-limit/overflow guard in the send path; auth failure folded into CLI/start errors.

## Proposed change

- Render runtime errors as an actionable card with click-through to the relevant settings + a retry action.
- Add a distinct, guided "unauthenticated" state (e.g. hint to run `claude login`).
- Add a graceful "context too large" message that points at trimming attachments.

Mirror the polished MCP test modal copy quality.

## Acceptance criteria

- A CLI-not-found / auth / context-too-large failure shows an actionable card, not raw stream text.
- Tests cover the error-card rendering + the "Open settings"/retry affordances.
