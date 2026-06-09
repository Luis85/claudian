---
title: Cursor AskUserQuestion transport — resume-based now, ACP gated on a spike
date: 2026-06-08
status: accepted
scope: src/providers/cursor, src/providers/acp, src/features/chat (AskUserQuestion delivery)
supersedes: none
relates-to: docs/adr/0001-transport-agnostic-provider-seam.md
method: codebase exploration (ACP transport + Opencode permission path + Cursor stream-json coupling) + external research (Zed ACP external-agent docs, community cursor-agent ACP adapters)
---

# ADR 0002 — Cursor AskUserQuestion transport

## Status

**Accepted.** Keep the shipped resume-based follow-up delivery for Cursor
AskUserQuestion. Do **not** migrate the Cursor adaptor to ACP now. Any future
migration is **gated on the empirical spike** defined below proving that an
ACP path actually solves the problem without regressing Cursor's native
history/session model.

## Context

Cursor runs as `cursor-agent --print --output-format stream-json` — a
**one-shot, non-interactive** process (confirmed against Cursor's headless
docs: no `--input-format stream-json`, no stdin channel, no elicitation event).
When the agent calls its AskQuestion tool, the CLI immediately self-rejects it
(`rejected: "Questions skipped by user"`) and ends the turn, so an answer
collected in Claudian can never reach the agent **within that turn**.

PR #72 ships the pragmatic fix: collect the answer, then auto-resume the
session carrying it as the next turn.

- `ChatTurnMetadata.autoFollowUpText` (`src/core/runtime/types.ts`) signals the
  follow-up.
- `CursorChatRuntime.query()` buffers the answer (`onAskUserAnswers`) and sets
  the metadata on completion (skipped on cancel).
- The interceptor re-keys answers from `question.id` back to the displayed
  prompt text (`resolveCursorAnswerLabels` in
  `src/providers/cursor/runtime/cursorAskUserQuestion.ts`) so the resumed turn
  reads `- Pick a focus: A`, not `- focus: A`.
- `InputController.autoResumeWith()` auto-sends it as a resumed follow-up turn
  (mirrors the post-plan auto-implement path).

This works, is vendor-native, dependency-free, and CI-green. Its only cost is
that the answer arrives as a **resumed turn** (one extra invocation) rather than
truly in-turn, the way Claude (`canUseTool`) and Codex (JSON-RPC elicitation)
deliver it.

This ADR records why we are **not** reaching for ACP to close that gap yet.

## What ACP offers (and the repo already has)

Claudian's `src/providers/acp/` implements a **true in-process bidirectional
channel** — the exact mechanism Cursor's one-shot CLI lacks:

- `AcpJsonRpcTransport.handleRequest()` dispatches agent→client JSON-RPC
  *requests* to a registered handler and sends the handler's resolved value back
  on the same `id`. The agent **blocks** until the client answers.
- `methodNames.ts` aliases `requestPermission → ['session/request_permission',
  'requestPermission']`.
- Opencode already uses this:
  `OpencodeChatRuntime.handlePermissionRequest()` awaits `approvalCallback` and
  returns the decision as the RPC response — a genuine mid-turn block.

So the "agent waits for the user mid-turn" plumbing is production-ready in the
repo. The bottleneck is **not** Claudian's architecture.

## Why ACP is not a slam-dunk for Cursor

1. **`cursor-agent` does not natively speak ACP.** ACP-for-Cursor exists only
   through **community wrapper adapters** (`npx -y cursor-agent-acp` and several
   GitHub forks) that Zed documents. Adopting one puts a **third-party
   dependency on Cursor's critical path**, directly against the
   *vendor-native-first* principle ADR 0001 establishes (Cursor was deliberately
   placed on the documented stream-json path, and ADR 0001 explicitly rejects
   transport uniformity).

2. **The adapters wrap the same `cursor-agent` CLI**, so it is **unverified**
   whether they round-trip AskQuestion in-process or merely relocate the same
   one-shot rejection. This is the central unknown and cannot be confirmed from
   the current sandbox (cursor-agent is not installed here).

3. **AskUserQuestion over ACP is unproven even for Opencode.**
   `OpencodeChatRuntime.setAskUserQuestionCallback()` is a **no-op** — ACP's
   blocking path is wired in this codebase for *permissions*, not multi-choice
   *questions*. Cursor-over-ACP would still need net-new AskQuestion→ACP mapping.

4. **Migration cost and regression surface.** ~2K LOC of stream-json-specific
   Cursor logic (`cursorStreamMapper`, `cursorToolNormalization`,
   `cursorQueryProcessing`, `cursorAskUserQuestion`, `cursorLaunchArgs`) would be
   replaced, and the native history/session model (JSONL under
   `~/.cursor/chats/<workspace>/<session>/`, `--resume <id>`) may not survive an
   adapter that owns its own session lifecycle — risking history hydration,
   fork, and resume.

## Options considered

- **A. Keep resume-based follow-up (chosen for now).** Lowest risk,
  vendor-native, no new dependency, honors ADR 0001. Cost: resumed-turn delivery
  rather than in-turn.
- **B. Migrate Cursor to ACP via a community adapter now.** Only path to
  truly in-turn Q/A, but depends on an unofficial dependency, contradicts
  ADR 0001, and carries an unverified-benefit + large-rewrite + history-regression
  risk. Rejected without evidence.
- **C. Spike-first.** De-risk B with a throwaway probe before committing. This
  ADR adopts C as the *gate* for ever reconsidering B.

## Decision

Keep **A**. Treat **B** as blocked until the spike below passes its decision
gate. Revisit promptly if Cursor ships **native** ACP support (which would
remove caveat 1 entirely).

## Spike plan (run on a machine with `cursor-agent` installed)

Throwaway only — keep scripts/captures in `.context/`, do not wire into `src/`.

1. **Install & launch.** Install `cursor-agent`; start the adapter
   (`npx -y cursor-agent-acp`). Capture its stderr/handshake.
2. **Connect via the existing client.** Drive it with a throwaway script using
   `AcpClientConnection` (`src/providers/acp/`) — `initialize`, `newSession`,
   `prompt`. Register a `requestPermission` delegate that logs every agent→client
   request verbatim.
3. **Trigger AskQuestion.** Send a prompt that forces the agent to ask the user
   a multi-choice question. **Record whether** a blocking agent→client request
   arrives (permission *or* elicitation), what its shape is, and whether
   answering it makes the agent **continue in the same turn** using the answer.
4. **History/session check.** Inspect whether `~/.cursor/chats/...` is still
   written and whether `loadSession`/resume map onto Cursor's native ids — i.e.
   whether `CursorConversationHistoryService` hydration would still work.
5. **Capability parity check.** Confirm model selection, plan mode, and image
   attachments survive the adapter.
6. **Trust posture.** Record the adapter's author, license, last-commit recency,
   and dependency footprint.

### Decision gate (all must hold to pursue B)

- AskQuestion (or an equivalent elicitation) **round-trips in-process** and the
  agent acts on the answer **within the same turn**.
- Cursor's native history/session model is **preserved or cheaply adaptable**
  (no loss of history reload / resume).
- The adapter's trust/maintenance posture is acceptable for a critical-path
  dependency, **or** Cursor has shipped native ACP by then.

If any fails, stay on A and re-file this spike when the landscape changes.

## Consequences

- **Now:** Cursor AskUserQuestion is real and usable (resumed-turn delivery);
  no new dependencies; ADR 0001 intact.
- **Later:** A clear, evidence-driven trigger and procedure exist for migrating
  Cursor to ACP — turning a vague "maybe ACP" into a gated decision.
- **Watch:** Cursor shipping first-party ACP support is the event that most
  changes this calculus.

## References

- ADR 0001 — Transport-agnostic provider seam (`docs/adr/0001-transport-agnostic-provider-seam.md`).
- ACP transport: `src/providers/acp/AcpJsonRpcTransport.ts`, `methodNames.ts`, `AcpClientConnection.ts`.
- Opencode permission path: `src/providers/opencode/runtime/OpencodeChatRuntime.ts` (`handlePermissionRequest`, no-op `setAskUserQuestionCallback`).
- Cursor resume-based fix: `src/providers/cursor/runtime/cursorAskUserQuestion.ts`, `CursorChatRuntime.ts`; `src/features/chat/controllers/InputController.ts` (`autoResumeWith`).
- Zed ACP external agents: https://zed.dev/docs/ai/external-agents ; Cursor over ACP: https://zed.dev/acp/agent/cursor ; community adapter: https://github.com/konsumer/cursor-agent-acp
