---
title: Cursor Hardening — Verified findings
date: 2026-06-02
status: PR1 shipped
scope: src/providers/cursor, src/providers/acp, src/core/providers
verified-against: main HEAD 045c485 (post-3.2.0 release)
related:
  - docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md (source plan)
  - docs/superpowers/plans/2026-05-30-cursor-hardening-telemetry-design.md (telemetry sub-design)
---

# Cursor Hardening — Verified findings

Re-verified 2026-06-02 against main HEAD `045c485` (after 3.2.0 release).
PR1 shipped 2026-06-02 (PR #24, merge commit `60dbc4a`).
Source plan: `docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md`.

## Status legend
- **DONE** — fixed in PR1; cite commit
- **ALREADY-FIXED** — covered by a pre-PR1 commit; cite that commit
- **DISMISSED** — false positive (reaffirmed) or DISMISSED-ON-REVIEW
- **PENDING-PR2** — deferred to PR2

## Findings

| ID | Symptom | STATUS | Fixed by / Notes |
|----|---------|--------|------------------|
| C3 | SQLite `DatabaseSync` never closed | DONE | `0b0eaa9` close SQLite handle (try/finally) |
| C4 | Spawn lock helper missing | DONE | `dfc3e30` `runWithCursorAgentSpawnLock` + aux runner migration. Cross-process file lock still deferred per plan |
| H1 | `child.on('close')` race with `kill('SIGTERM')` | ALREADY-FIXED | `631ec40` `terminateChild()` attaches `exit` before `kill()` + `5fe877d` SIGKILL escalation. PR2 may land cosmetic close-listener cleanup (no feature flag needed) |
| H2 | SIGTERM on Windows is a no-op | PENDING-PR2 | Task 6 |
| H3 | `timeoutMs=0` pending leak on close | ALREADY-FIXED | `AcpJsonRpcTransport.dispose()` already drains pending. Task 7 no-op |
| H4 | `nextId` unbounded | PENDING-PR2 | Task 8 |
| H5 | Full `process.env` leaked into Cursor subprocess | DONE | `9e51066` shared `subprocessEnvironmentAllowlist` + Cursor wiring |
| H6 | Workspace hash not path-normalized | DONE | `8940702` normalize + two-hash fallback (`cursorWorkspaceHashLegacy`) |
| H7 | History errors silently return `[]` | DONE | `b27b4a1` `loadCursorChatMessagesFromStoreResult` + `getLastHistoryLoadError` getter |
| H8 | `updateCursorProviderSettings` writes stale `environmentVariables` | DISMISSED-ON-REVIEW | Codex P1 on PR #24: writeback is load-bearing (full-block `setProviderConfig` would wipe env on next `saveHash` call). Reverted in `8bd097c` |
| H9 | Empty saved environmentHash never recomputed | ALREADY-FIXED | `EnvHashReconciler.ts:41` plain equality |
| H10 | Inline edit cancel does not abort spawn | ALREADY-FIXED | `ff3a179` `QueryBackedInlineEditService` passes AbortController |
| H11 | Duplicate `tool_result` emission | PENDING-PR2 | Task 13 |
| H12 | Missing tool result; no fallback | PENDING-PR2 | Task 14 |
| SEC1 | sessionId path traversal | DONE | `5a7f0d2` `cursorSessionIdValidation` + history wiring. Hardened in `a949703` (pure-dot rejection) and `d101639` (trailing-dot rejection) after Codex review |
| SEC2 | Prompt temp file permissions + cleanup gap | DONE | `4babf11` dir `0o700` + file `0o600` + cleanup-on-throw |
| SEC3 | History error leaks `$HOME` paths | DONE | `b27b4a1` `redactHomeInPath` (handles `\` and `/` forms) |
| ARC1 | Env leak parallel in Opencode | DONE | `9e51066` Opencode wired to shared allowlist; `3cf949b` makes allowlist load-bearing at spawn site (dropped `...process.env` spread in both Opencode startProcess paths). `XDG_*` keys added to allowlist in same commit |
| ARC2 | Shared ACP fixes lack Opencode regression coverage | DONE (PR1 baseline) | Opencode regression suite (170/170) passes against PR1 changes. PR2 will add mock-capture coverage when AcpSubprocess gets touched |
| C1 | `chunkTracker` undefined on spawn throw | DISMISSED | Reaffirmed: outer `finally` never reaches finalize |
| C2 | Aux runner lock not released on throw | DISMISSED | Reaffirmed: existing `try/finally` correct |
| C5 | `result` event resets accumulators mid-turn | DISMISSED | Reaffirmed: `result` is terminal; reset prepares next turn |

## Review-driven additions (Codex on PR #24, not in original plan)

| ID | Finding | Fixed by |
|----|---------|----------|
| REV1 | Pure-dot sessionId (`.`, `..`, `...`) bypassed validator → `deleteConversationSession` could wipe entire workspace chat dir | `a949703` `DOTS_ONLY` regex check |
| REV2 | Trailing-dot sessionId (`sess.`) aliased to sibling dir on Win32 (silent trailing-period trim) | `d101639` `sessionId.endsWith('.')` check |
| REV3 | `deleteConversationSession` only checked normalized hash; legacy-hash transcripts (hydrated via T3 fallback) survived deletion | `a949703` iterate both hashes |
| REV4 | Opencode `startProcess` spread `...process.env` ON TOP of the allowlisted env, reintroducing every host var | `3cf949b` drop the spread; allowlist is now the base |
| REV5 | Allowlist drops `XDG_DATA_HOME` → CLI uses different DB path than our resolver computes | `3cf949b` add `XDG_*` keys to allowlist |
| REV6 | Denylist `Set.has` was case-sensitive; `node_tls_reject_unauthorized=0` on Windows bypassed the TLS-bypass kill-switch | `8e45914` case-insensitive denylist via uppercase shadow |
| REV7 | Symmetric on allowlist: `ComSpec`, `ProgramFiles`, `windir` dropped because keys mixed-case from Win32 `process.env` | `551a6dc` case-insensitive allowlist via uppercase shadow |

## New surfaces shipped in PR1

- `src/core/providers/subprocessEnvironmentAllowlist.ts` — `SUBPROCESS_ENV_ALLOWLIST`, `SUBPROCESS_ENV_DENYLIST`, `buildAllowlistedSubprocessEnvironment`, case-insensitive lookup helpers
- `src/core/providers/cursorSessionIdValidation.ts` — `isValidCursorSessionId`
- `src/providers/cursor/runtime/cursorAgentSpawnLock.ts` — `runWithCursorAgentSpawnLock` (acquire-and-release helper)
- `src/providers/cursor/history/cursorHistoryStore.ts` — `cursorWorkspaceHashLegacy`, `loadCursorChatMessagesFromStoreResult`, `CursorHistoryLoadResult`
- `src/providers/cursor/history/CursorConversationHistoryService.ts` — `getLastHistoryLoadError(conversationId)`

## PR2 scope (separate branch later)

- T5 H1 minor cosmetic close-listener cleanup (no feature flag) — optional
- T6 H2 platform-aware kill signal + ARC2 Opencode mock-capture regression coverage
- T8 H4 bounded request id allocation
- T13 H11 dedup `tool_result`
- T14 H12 fallback tool result from args
- T22 integration smoke test
- T25 telemetry log codes (logger plumbing naturally fits with PR2's `AcpSubprocess`/`AcpJsonRpcTransport` touches — see `docs/superpowers/plans/2026-05-30-cursor-hardening-telemetry-design.md`)
- T26 final verification
- T27 summary artifact

Skipped from plan PR2: T7 (H3 ALREADY-FIXED), T10 (H10 ALREADY-FIXED), T11 (H8 DISMISSED-ON-REVIEW).

## Manual smoke (Task 24, pre-PR2)

Plan-required manual gate before PR2 merges. Not yet executed. Walks:
1. New conversation → tool-call → exactly one tool_result render
2. Follow-up + history preservation
3. Cancel mid-stream → no UI hang, new send within 5s
4. Vault reload → conversation hydration
5. Windows repeat of 1-4 (most fixes Windows-flavored)
