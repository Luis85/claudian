---
type: issue
id: issue-20260603-opencode-path-containment
title: Add vault-containment to OpencodeChatRuntime read/writeTextFile (main path)
status: shipped
priority: 2 - normal
triage: done
created: 2026-06-03
updated: 2026-06-04
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (SEC-B)"
scope: provider-filesystem-safety
tags:
  - security
  - path-traversal
  - opencode
---

# Opencode main-runtime path containment

## Problem

The live Opencode chat runtime's ACP filesystem handlers resolve paths with `resolveSessionPath`, which
returns absolute paths **verbatim** and resolves relative paths against cwd with **no `..` rejection**.
The aux runner already enforces containment, but the protection was not applied to the primary path — so a
prompt-injected agent could read `~/.ssh/id_rsa` or write outside the vault with no jail on the main path.

## Evidence

- `src/providers/opencode/runtime/OpencodeChatRuntime.ts:1281-1320` (no relative/`..` guard, absolute passthrough).
- Contrast `src/providers/opencode/runtime/OpencodeAuxQueryRunner.ts:373-382` (containment present).

## Proposed change

Hoist the aux runner's `path.relative` containment check into
`OpencodeChatRuntime.resolveSessionPath` — reject absolute paths outside cwd and `..` escapes.

## Acceptance criteria

- `read/writeTextFile` on the main runtime rejects absolute-outside-vault and `..`-escape paths.
- A unit test covers an escape attempt on the main path; existing in-vault reads/writes still pass.

## Resolution (2026-06-04)

Hoisted the aux runner's `path.relative` containment check into
`OpencodeChatRuntime.resolveSessionPath`. Absolute paths outside the session cwd and
relative `..` escapes now throw `OpenCode file access is limited to the current workspace.`
on both `readTextFile` and `writeTextFile`. Covered by POSIX + Windows escape-rejection
tests in `tests/unit/providers/opencode/OpencodeChatRuntime.test.ts`.
