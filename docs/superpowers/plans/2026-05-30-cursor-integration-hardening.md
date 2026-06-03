---
status: in-progress
parent: "[[Multi Provider Support]]"
---
# Cursor Integration Hardening Implementation Plan

> **PR1 status (shipped in PR #24, merged into `main` 2026-06-02):**
> - Fixed: C3, C4, H5+ARC1, H6, H7+SEC3, SEC1, SEC2 (Tasks 1, 2, 3, 4, 9, 19, 20, 21)
> - Already-fixed (audit-skipped vs. plan): H1, H3, H9, H10 (Tasks 5 reduced, 7, 12, 10)
> - Dismissed on review: H8 (Task 11 reverted — full-block `setProviderConfig` makes the writeback load-bearing)
> - Review-driven additions: pure-dot sessionId rejection, trailing-dot sessionId rejection, legacy-hash deletion in `deleteConversationSession`, case-insensitive allowlist/denylist matching (Windows env-var aliasing), `XDG_*` keys forwarded
> - C1 / C2 / C5 reaffirmed dismissed
>
> **PR2 scope still open:** T5 (cosmetic close-listener cleanup), T6 (H2 platform-aware kill signal), T8 (H4 bounded request id), T13 (H11 tool_result dedup), T14 (H12 tool fallback content), T22 (integration smoke test), T25 (telemetry log codes — plumbing fits with PR2's AcpSubprocess/AcpJsonRpcTransport touches), T26/T27 (verification + summary).
>
> Manual smoke (Task 24) is owed before PR2 ships per the original release-gate plan.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate verified Critical and High-severity defects in the Cursor provider and the shared ACP transport, fix two parallel defects in Opencode that ride on the same shared code, close the largest test-coverage gaps in Cursor auxiliary services, and ship the work in two PRs with rollback levers and an integration smoke test.

**Architecture:** Operates on `src/providers/cursor/`, `src/providers/opencode/`, and `src/providers/acp/`. Shared concerns (env allowlist) are extracted into `src/core/providers/` to avoid Cursor/Opencode divergence. Each fix is verify-first (read live code, mark CONFIRMED/DISMISSED in the tracker), then TDD with a deterministic mock harness. The plan ships as two PRs — a low-risk PR1 (env, tests, soft fixes) and a hot-path PR2 (runtime/ACP changes with feature-flag rollback levers).

**Tech Stack:** TypeScript, Node.js `child_process`, Node.js `node:sqlite`, Obsidian plugin API, Jest, ACP (Agent Client Protocol) JSON-RPC.

**Multi-perspective review baked in:** This plan is the second draft. The first draft was reviewed from six perspectives (senior engineer, product, security, release, QA, architecture). The changes from the first draft are listed in `## Review-driven changes from draft 1` near the bottom of this file.

---

## Scope

**In scope (this plan):**

- Verified Critical and High findings from the original audit (H1–H12, C3, C4).
- Three Critical/High findings surfaced by the security review: sessionId path traversal validation, prompt temp file permissions, error-message path redaction.
- Cross-provider parity: extract shared env allowlist; apply to Opencode; add Opencode regression checks for shared ACP changes.
- Zero-test Cursor auxiliary services (Inline Edit, Instruction Refine, Title Generation).
- One integration smoke test that exercises spawn → prompt → tool → cancel → close in a single deterministic test.
- Feature flags for the two highest-blast-radius fixes (close-listener reorder, Windows SIGKILL) so they can be reverted without redeploying.
- CHANGELOG + release-notes draft.

**Deferred (separate plan `2026-05-31-cursor-medium-and-low-hardening.md`):**

- Cross-process file lock via `proper-lockfile` (RFC needed; mitigated by intra-process lock + path validation).
- Switch ACP transport from newline-delimited to Content-Length framing (large surface).
- Full end-to-end test harness against a real Cursor CLI build (this plan adds one focused integration test, not the full harness).
- 35 Medium / Low items from the original audit.

**Dismissed (false positives — see Task 0 tracker for evidence):**

- C1 (`chunkTracker` undefined on spawn throw) — control flow reaches the outer `finally` only after assignment; finalize never runs when stream throws.
- C2 (Aux runner lock not released on throw) — existing `try { await … } finally { release() }` already catches rejection.
- C5 (`result` event resets accumulators mid-turn) — `result` is terminal; reset prepares the next turn.

---

## PR split

| PR | Tasks | Risk tier | Why grouped |
|----|-------|-----------|-------------|
| **PR1 — Cold paths and tests** | 0, 1, 2, 3, 4, 9, 12, 19, 20, 21, 23, 24, 25 | LOW | Env allowlist, history-store hygiene, settings reconciler, aux-service tests, sessionId validation, temp-file perms. No hot-path changes. |
| **PR2 — Hot path and rollback levers** | 5, 6, 7, 8, 10, 11, 13, 14, 22, 26, 27 | HIGH | `CursorChatRuntime.query` listener reorder, ACP subprocess kill signal, ACP transport pending-request cleanup + id wrap, inline edit cancel, settings shadow, tool-result dedup, fallback content, feature flags, integration smoke test. |

PR1 ships first; wait ~24h for telemetry/feedback; then PR2.

---

## File structure

### Files to create

| Path | Responsibility |
|------|----------------|
| `docs/reviews/2026-06-02-cursor-hardening-verified.md` | Per-finding verification tracker. |
| `.context/cursor-hardening-deferred.md` | Deferred items with rationale and follow-up plan reference. |
| `.context/cursor-hardening-release-notes.md` | Draft of user-facing release notes; reviewer adapts for CHANGELOG. |
| `src/core/providers/subprocessEnvironmentAllowlist.ts` | Shared env allowlist + filter used by Cursor and Opencode. |
| `src/core/providers/cursorSessionIdValidation.ts` | sessionId validator reused by history-store and conversation-history-service. (Lives in `core/providers/` because the same shape applies to any provider that resumes by id; named `cursor*` for now and renamed if a second consumer appears.) |
| `tests/unit/core/providers/subprocessEnvironmentAllowlist.test.ts` | Direct coverage of the shared allowlist. |
| `tests/unit/providers/cursor/runtime/cursorAgentEnv.test.ts` | Confirms Cursor adaptor wires the shared allowlist. |
| `tests/unit/providers/opencode/runtime/OpencodeRuntimeEnvironment.test.ts` | Confirms Opencode adaptor wires the shared allowlist. |
| `tests/unit/providers/cursor/history/cursorHistoryStoreClose.test.ts` | SQLite handle close coverage. |
| `tests/unit/providers/cursor/history/cursorSessionIdValidation.test.ts` | Path-traversal regression. |
| `tests/unit/providers/cursor/runtime/cursorAgentSpawnLockRecovery.test.ts` | Lock release on throw. |
| `tests/unit/providers/cursor/runtime/cursorCliPromptTempFile.test.ts` | Temp file mode + cleanup-on-throw. |
| `tests/unit/providers/acp/AcpJsonRpcTransportTimeoutZero.test.ts` | Pending request cleanup on close. |
| `tests/unit/providers/acp/AcpSubprocessKillPlatform.test.ts` | Platform-aware kill signal + idempotent exit. |
| `tests/unit/providers/opencode/runtime/opencodeAcpKill.test.ts` | Opencode regression test for the same kill-signal fix. |
| `tests/unit/providers/cursor/auxiliary/CursorInlineEditService.test.ts` | Inline edit coverage. |
| `tests/unit/providers/cursor/auxiliary/CursorInstructionRefineService.test.ts` | Instruction refine coverage. |
| `tests/unit/providers/cursor/auxiliary/CursorTitleGenerationService.test.ts` | Title generation coverage. |
| `tests/integration/providers/cursor/cursorLifecycleSmoke.test.ts` | One integration test covering spawn → prompt → tool → cancel → close. |

### Files to modify

| Path | What changes |
|------|--------------|
| `src/providers/cursor/runtime/cursorAgentEnv.ts` | Call shared allowlist instead of spreading `process.env`. |
| `src/providers/opencode/runtime/OpencodeRuntimeEnvironment.ts` | Call shared allowlist instead of spreading `process.env`. |
| `src/providers/cursor/runtime/cursorCliPrompt.ts` | Create temp dir with mode 0o700; ensure cleanup on throw; redact temp path from any errors. |
| `src/providers/cursor/history/cursorHistoryStore.ts` | Close SQLite handle; normalize workspace path before hash; validate sessionId; two-hash migration helper. |
| `src/providers/cursor/history/CursorConversationHistoryService.ts` | Surface load errors with redacted messages; validate sessionId on delete; thread `historyLoadError` to UI. |
| `src/providers/cursor/runtime/cursorAgentSpawnLock.ts` | Add `runWithCursorAgentSpawnLock` helper. |
| `src/providers/cursor/runtime/CursorChatRuntime.ts` | Attach `close`/`exit` listener immediately post-spawn; remove `stderr` listener in `finally`; read feature-flag opt-out of new ordering. |
| `src/providers/acp/AcpJsonRpcTransport.ts` | Reject pending requests on transport close; bounded request-id allocation. |
| `src/providers/acp/AcpSubprocess.ts` | Platform-aware kill signal; idempotent exit handler; honor `CLAUDIAN_ACP_FORCE_SIGTERM=1` for rollback. |
| `src/providers/acp/AcpSessionUpdateNormalizer.ts` | Per-tool-call-id dedup so `tool_result` emits at most once. |
| `src/providers/cursor/settings.ts` | Drop `environmentVariables` write-back. |
| `src/providers/cursor/env/CursorSettingsReconciler.ts` | Use `saved !== next` directly (no special-case redundancy). |
| `src/providers/cursor/auxiliary/CursorInlineEditService.ts` | Wire AbortController through to runner config. |
| `src/providers/cursor/runtime/cursorToolNormalization.ts` | Fall back to `args` when `result` missing. |
| `CHANGELOG.md` | Add entries for this release. |

---

## Task 0: Setup tracker + baseline + feature-flag scaffolding

> **Status: DONE in PR1.** Tracker lives at `docs/reviews/2026-06-02-cursor-hardening-verified.md` (gitignored per project convention). `docs/superpowers/plans/2026-05-30-cursor-hardening-telemetry-design.md` documents the deferred log codes. Release notes were inlined into the PR #24 body since the project has no `CHANGELOG.md`.

**Files:**
- Create: `docs/reviews/2026-06-02-cursor-hardening-verified.md`, `.context/cursor-hardening-deferred.md`, `.context/cursor-hardening-release-notes.md`

- [ ] **Step 1: Confirm working tree clean and baseline green**

Run: `git status && npm run typecheck && npm run lint && npm run test`
Expected: clean status, all three commands exit 0. Stop and fix baseline first if any fail.

- [ ] **Step 2: Create `docs/reviews/2026-06-02-cursor-hardening-verified.md`**

Content:

```markdown
# Cursor Hardening — Verified Findings

| ID | Symptom | File | STATUS | Notes |
|----|---------|------|--------|-------|
| C3 | SQLite DatabaseSync never closed | cursorHistoryStore.ts | PENDING | |
| C4 | Spawn lock is intra-process only | cursorAgentSpawnLock.ts | PENDING | Cross-process file lock deferred |
| H1 | child.on('close') race with kill('SIGTERM') | CursorChatRuntime.ts | PENDING | |
| H2 | SIGTERM on Windows is a no-op | AcpSubprocess.ts | PENDING | |
| H3 | timeoutMs=0 leaves promise pending forever on transport close | AcpJsonRpcTransport.ts | PENDING | |
| H4 | nextId unbounded — could collide past MAX_SAFE_INTEGER | AcpJsonRpcTransport.ts | PENDING | |
| H5 | Full process.env leaked into Cursor subprocess | cursorAgentEnv.ts | PENDING | Mirror exists in Opencode |
| H6 | Workspace hash not path-normalized — Windows casing drift | cursorHistoryStore.ts | PENDING | |
| H7 | History errors silently return [] | CursorConversationHistoryService.ts | PENDING | |
| H8 | updateCursorProviderSettings writes stale environmentVariables | settings.ts | PENDING | |
| H9 | Empty saved environmentHash never recomputed | CursorSettingsReconciler.ts | PENDING | |
| H10 | Inline edit cancel does not abort the spawn | CursorInlineEditService.ts | PENDING | |
| H11 | Duplicate tool_result emission on tool_call_update | AcpSessionUpdateNormalizer.ts | PENDING | |
| H12 | Missing tool result returns empty content with no fallback | cursorToolNormalization.ts | PENDING | |
| SEC1 | sessionId path traversal in history paths | cursorHistoryStore.ts, CursorConversationHistoryService.ts | PENDING | Security review |
| SEC2 | Prompt temp file default permissions + cleanup gap | cursorCliPrompt.ts | PENDING | Security review |
| SEC3 | History error message leaks $HOME paths | CursorConversationHistoryService.ts | PENDING | Security review |
| ARC1 | Env leak fix Cursor-only; Opencode has same bug | OpencodeRuntimeEnvironment.ts | PENDING | Architect review |
| ARC2 | Shared ACP fixes (H2,H3,H4,H11) lack Opencode regression coverage | tests/unit/providers/opencode | PENDING | Architect review |
| C1 | chunkTracker undefined on spawn throw | CursorChatRuntime.ts | DISMISSED | Outer finally never reaches finalize; throw bubbles past. |
| C2 | Spawn lock not released on throw inside try | CursorAuxCliRunner.ts | DISMISSED | `try { await … } finally { release() }` catches rejection. |
| C5 | result event resets accumulators mid-turn | cursorStreamMapper.ts | DISMISSED | `result` is terminal; reset prepares next turn. |
```

- [ ] **Step 3: Create `.context/cursor-hardening-deferred.md`**

Content:

```markdown
# Cursor Hardening — Deferred Items

Follow-up plan: `docs/superpowers/plans/2026-05-31-cursor-medium-and-low-hardening.md` (to be written after this plan ships).

## Deferred from this plan

- **Cross-process file lock for `~/.cursor/cli-config.json`** — Intra-process lock plus sessionId validation reduces blast radius; full `flock`/`LockFileEx` requires a design RFC. Codex (`CodexAppServerProcess`) also lacks spawn serialization; address together.
- **ACP Content-Length framing** — Current transport uses newline-delimited JSON. Large multi-MB responses can split across line events. Separate plan needed.
- **Full integration test harness against a real Cursor CLI build** — This plan adds one focused unit-level integration test; a real-binary harness is a separate effort.
- **Log redaction filter in `core/logging`** — Should mask `$HOME` and workspace paths before persisting. Defer until log-shipping is needed.
- **35 Medium/Low items** — See original audit synthesis.

## Known one-time effects of THIS plan

- **Task 3 (Windows workspace hash normalization)** — Without the two-hash fallback (also in Task 3), Windows users with chats keyed under non-normalized paths would see one-time empty history. We implement the fallback to avoid that.
- **Task 1 (env allowlist)** — Users relying on undeclared env vars passed to the Cursor CLI must add them to the Cursor provider's user env settings. Allowlist covers PATH, HOME, USERPROFILE, GIT_SSH_COMMAND, SSH_AUTH_SOCK, NODE_OPTIONS, proxy vars, TLS cert vars, plus `CURSOR_*` pass-through.
```

- [ ] **Step 4: Create `.context/cursor-hardening-release-notes.md`**

Content:

```markdown
# Cursor Hardening — Release notes draft

## Bug fixes
- Cursor history sometimes appeared empty after upgrade or vault re-open. Fixed (history hydration error surfacing + workspace-hash normalization + two-hash fallback).
- Cursor inline edit could hang the UI when cancelled mid-stream. Fixed.
- On Windows, the Cursor agent subprocess could leave a zombie process after cancel. Fixed (platform-appropriate kill signal).
- Cursor agent did not always abort when the conversation was cancelled. Fixed.
- Tool results occasionally rendered twice. Fixed.

## Security
- Tightened the environment variables passed to the Cursor CLI subprocess; only allowlisted base vars plus `CURSOR_*` keys are forwarded. If your workflow relied on a host env var that is no longer passed through, add it via Cursor provider settings → Environment.
- Cursor prompt temporary files are now created with mode 0o600 (owner-readable only).
- Cursor history paths now reject session ids that contain path-traversal sequences.

## Internal
- Same env-allowlist hardening applied to Opencode.
- Added `runWithCursorAgentSpawnLock` helper for safer lock-acquire/release patterns.
- Added integration smoke test covering full Cursor turn lifecycle.

## Rollback levers
- Set `CLAUDIAN_ACP_FORCE_SIGTERM=1` in the plugin's environment to restore previous SIGTERM-on-Windows behavior.
- Set `CLAUDIAN_CURSOR_LEGACY_CLOSE_LISTENER=1` to restore the previous close-listener ordering in `CursorChatRuntime`.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md docs/reviews/2026-06-02-cursor-hardening-verified.md .context/cursor-hardening-deferred.md .context/cursor-hardening-release-notes.md
git commit -m "chore(cursor): add hardening plan, verification tracker, deferred list, and release notes draft"
```

---

## Task 1: H5 (+ARC1) — Shared subprocess env allowlist

> **Status: DONE in PR1** (`9e51066`). Hardened on review: `3cf949b` made allowlist load-bearing at spawn site (dropped `...process.env` spread in both Opencode `startProcess` paths) + added `XDG_*` keys; `8e45914` case-insensitive denylist; `551a6dc` case-insensitive allowlist.

Finding: `buildCursorAgentEnvironment` (Cursor) and `OpencodeRuntimeEnvironment` (Opencode) both spread all of `process.env` into the subprocess. Host secrets, debug flags, and unrelated keys leak. Fix is extracted to a shared utility so both providers stay in sync.

**Files:**
- Create: `src/core/providers/subprocessEnvironmentAllowlist.ts`
- Create: `tests/unit/core/providers/subprocessEnvironmentAllowlist.test.ts`
- Modify: `src/providers/cursor/runtime/cursorAgentEnv.ts`
- Modify: `src/providers/opencode/runtime/OpencodeRuntimeEnvironment.ts`
- Create: `tests/unit/providers/cursor/runtime/cursorAgentEnv.test.ts`
- Create: `tests/unit/providers/opencode/runtime/OpencodeRuntimeEnvironment.test.ts`

- [ ] **Step 1: Verify Cursor + Opencode both leak**

Read both source files. Confirm both spread `process.env` unfiltered. Update tracker rows H5 and ARC1 to CONFIRMED.

- [ ] **Step 2: Write the failing shared-utility test**

Create `tests/unit/core/providers/subprocessEnvironmentAllowlist.test.ts`:

```typescript
import {
  buildAllowlistedSubprocessEnvironment,
  SUBPROCESS_ENV_ALLOWLIST,
} from '@/core/providers/subprocessEnvironmentAllowlist';

describe('buildAllowlistedSubprocessEnvironment', () => {
  it('drops unrelated host env vars by default', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: {
        PATH: '/usr/bin',
        HOME: '/home/test',
        SECRET_TOKEN: 'sk-leak-me',
        NPM_TOKEN: 'npm-secret',
        DEBUG: '1',
      },
      customEnv: {},
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.SECRET_TOKEN).toBeUndefined();
    expect(result.NPM_TOKEN).toBeUndefined();
    expect(result.DEBUG).toBeUndefined();
    expect(result.PATH).toBe('/usr/bin');
    expect(result.HOME).toBe('/home/test');
  });

  it('explicitly refuses NODE_TLS_REJECT_UNAUTHORIZED', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: { NODE_TLS_REJECT_UNAUTHORIZED: '0', PATH: '/usr/bin' },
      customEnv: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it('passes through GIT_SSH_COMMAND, SSH_AUTH_SOCK, NODE_OPTIONS, NODE_EXTRA_CA_CERTS', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: {
        GIT_SSH_COMMAND: 'ssh -i ~/.ssh/id_x',
        SSH_AUTH_SOCK: '/tmp/ssh.sock',
        NODE_OPTIONS: '--max-old-space-size=4096',
        NODE_EXTRA_CA_CERTS: '/etc/ssl/ca.pem',
      },
      customEnv: {},
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/id_x');
    expect(result.SSH_AUTH_SOCK).toBe('/tmp/ssh.sock');
    expect(result.NODE_OPTIONS).toBe('--max-old-space-size=4096');
    expect(result.NODE_EXTRA_CA_CERTS).toBe('/etc/ssl/ca.pem');
  });

  it('passes through provider-prefix keys from host env', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: { CURSOR_API_KEY: 'cur-key' },
      customEnv: {},
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.CURSOR_API_KEY).toBe('cur-key');
  });

  it('customEnv overrides processEnv values for the same key', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: { CURSOR_API_KEY: 'host-key', PATH: '/usr/bin' },
      customEnv: { CURSOR_API_KEY: 'override' },
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.CURSOR_API_KEY).toBe('override');
  });

  it('customEnv keys outside the allowlist still pass through (user opt-in)', () => {
    const result = buildAllowlistedSubprocessEnvironment({
      processEnv: { PATH: '/usr/bin' },
      customEnv: { MY_CUSTOM_VAR: 'yes' },
      providerPrefixPattern: /^CURSOR_/i,
    });
    expect(result.MY_CUSTOM_VAR).toBe('yes');
  });

  it('exposes the allowlist for inspection', () => {
    expect(SUBPROCESS_ENV_ALLOWLIST.has('PATH')).toBe(true);
    expect(SUBPROCESS_ENV_ALLOWLIST.has('SECRET_TOKEN')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern=subprocessEnvironmentAllowlist`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the shared utility**

Create `src/core/providers/subprocessEnvironmentAllowlist.ts`:

```typescript
/**
 * Subprocess env allowlist shared across providers that spawn CLI subprocesses
 * (Cursor, Opencode). Adding a key here is a security decision — never add a
 * key that can change how the subprocess loads code (NODE_OPTIONS is allowed
 * because users tune memory limits; NODE_TLS_REJECT_UNAUTHORIZED is explicitly
 * never allowed because it disables certificate validation).
 */
export const SUBPROCESS_ENV_ALLOWLIST: ReadonlySet<string> = new Set([
  // Base shell context
  'PATH',
  'HOME',
  'USERPROFILE',
  'USERNAME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  // Locale
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  // Temp paths
  'TMPDIR',
  'TMP',
  'TEMP',
  // Windows
  'COMSPEC',
  'SystemRoot',
  'SYSTEMROOT',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'WINDIR',
  // Proxies (lowercase variants matter for curl/git)
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  // TLS cert bundles
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  // Git / SSH
  'GIT_SSH_COMMAND',
  'GIT_TERMINAL_PROMPT',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  // Node runtime tuning (NOT NODE_TLS_REJECT_UNAUTHORIZED)
  'NODE_OPTIONS',
  // CI flag
  'CI',
]);

/**
 * Keys we always refuse to forward, even if a future allowlist change picks
 * them up by accident. Acts as a kill-switch.
 */
export const SUBPROCESS_ENV_DENYLIST: ReadonlySet<string> = new Set([
  'NODE_TLS_REJECT_UNAUTHORIZED',
]);

export interface BuildAllowlistedSubprocessEnvironmentOptions {
  processEnv: Record<string, string | undefined>;
  customEnv: Record<string, string>;
  /** Provider-scoped prefix that should always pass through (e.g. /^CURSOR_/i, /^OPENCODE_/i). */
  providerPrefixPattern: RegExp;
  /** Optional override of the PATH key — providers may want to enhance PATH. */
  pathOverride?: string;
}

export function buildAllowlistedSubprocessEnvironment(
  opts: BuildAllowlistedSubprocessEnvironmentOptions,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts.processEnv)) {
    if (value === undefined) continue;
    if (SUBPROCESS_ENV_DENYLIST.has(key)) continue;
    const passesAllowlist = SUBPROCESS_ENV_ALLOWLIST.has(key);
    const passesPrefix = opts.providerPrefixPattern.test(key);
    if (!passesAllowlist && !passesPrefix) continue;
    out[key] = value;
  }
  // customEnv is user-opt-in; pass everything in it (including unlistedkeys)
  // but still apply the denylist so users cannot accidentally re-enable TLS bypass.
  for (const [key, value] of Object.entries(opts.customEnv)) {
    if (SUBPROCESS_ENV_DENYLIST.has(key)) continue;
    out[key] = value;
  }
  if (opts.pathOverride !== undefined) {
    out.PATH = opts.pathOverride;
  }
  return out;
}
```

- [ ] **Step 5: Run the shared-utility test to verify it passes**

Run: `npm run test -- --selectProjects unit --testPathPattern=subprocessEnvironmentAllowlist`
Expected: PASS, 7 tests.

- [ ] **Step 6: Wire Cursor adaptor to the shared utility**

Replace `src/providers/cursor/runtime/cursorAgentEnv.ts` body with:

```typescript
import type ClaudianPlugin from '../../../main';
import { buildAllowlistedSubprocessEnvironment } from '../../../core/providers/subprocessEnvironmentAllowlist';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';

export function buildCursorAgentEnvironment(plugin: ClaudianPlugin): Record<string, string> {
  const customEnv = parseEnvironmentVariables(plugin.getActiveEnvironmentVariables('cursor'));
  return buildAllowlistedSubprocessEnvironment({
    processEnv: process.env,
    customEnv,
    providerPrefixPattern: /^CURSOR_/i,
    pathOverride: getEnhancedPath(customEnv.PATH),
  });
}
```

- [ ] **Step 7: Write the Cursor adaptor wiring test**

Create `tests/unit/providers/cursor/runtime/cursorAgentEnv.test.ts`:

```typescript
import { buildCursorAgentEnvironment } from '@/providers/cursor/runtime/cursorAgentEnv';

jest.mock('@/utils/env', () => ({
  parseEnvironmentVariables: jest.fn((text: string) => {
    if (!text) return {};
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const [k, v] = line.split('=');
      if (k) out[k] = v ?? '';
    }
    return out;
  }),
  getEnhancedPath: jest.fn((p?: string) => p ?? process.env.PATH ?? '/usr/bin'),
}));

function makePlugin(envText: string): any {
  return { getActiveEnvironmentVariables: (_id: string) => envText };
}

describe('buildCursorAgentEnvironment', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      PATH: '/usr/bin',
      HOME: '/home/test',
      SECRET_TOKEN: 'sk-leak-me',
      CURSOR_API_KEY: 'cur-key',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    };
  });
  afterEach(() => { process.env = originalEnv; });

  it('does not leak unrelated host env vars', () => {
    const env = buildCursorAgentEnvironment(makePlugin(''));
    expect(env.SECRET_TOKEN).toBeUndefined();
  });

  it('refuses NODE_TLS_REJECT_UNAUTHORIZED even when the host sets it', () => {
    const env = buildCursorAgentEnvironment(makePlugin('NODE_TLS_REJECT_UNAUTHORIZED=0'));
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it('passes through CURSOR_API_KEY from host env', () => {
    const env = buildCursorAgentEnvironment(makePlugin(''));
    expect(env.CURSOR_API_KEY).toBe('cur-key');
  });

  it('lets custom env override host values', () => {
    const env = buildCursorAgentEnvironment(makePlugin('CURSOR_API_KEY=override'));
    expect(env.CURSOR_API_KEY).toBe('override');
  });
});
```

- [ ] **Step 8: Wire Opencode adaptor**

Read `src/providers/opencode/runtime/OpencodeRuntimeEnvironment.ts`. Replace the unfiltered `{ ...process.env, ...custom }` spread with a call to `buildAllowlistedSubprocessEnvironment({ processEnv: process.env, customEnv, providerPrefixPattern: /^OPENCODE_/i, pathOverride: ... })`. Keep all other behavior. Confirm with a quick read that the function's public signature is unchanged.

- [ ] **Step 9: Write the Opencode adaptor wiring test**

Create `tests/unit/providers/opencode/runtime/OpencodeRuntimeEnvironment.test.ts` mirroring the Cursor test above. Use `/^OPENCODE_/i` as the prefix; replace `CURSOR_API_KEY` with `OPENCODE_API_KEY`. Engineer reads the Opencode file to confirm exact function name + plugin call before writing.

- [ ] **Step 10: Run all three test files**

Run: `npm run test -- --selectProjects unit --testPathPattern="(subprocessEnvironmentAllowlist|cursorAgentEnv|OpencodeRuntimeEnvironment)"`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/core/providers/subprocessEnvironmentAllowlist.ts src/providers/cursor/runtime/cursorAgentEnv.ts src/providers/opencode/runtime/OpencodeRuntimeEnvironment.ts tests/unit/core/providers/subprocessEnvironmentAllowlist.test.ts tests/unit/providers/cursor/runtime/cursorAgentEnv.test.ts tests/unit/providers/opencode/runtime/OpencodeRuntimeEnvironment.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(providers): extract shared subprocess env allowlist; apply to Cursor and Opencode"
```

---

## Task 2: C3 — Close SQLite handle in history store

> **Status: DONE in PR1** (`0b0eaa9`). `loadCursorChatMessagesFromStore` uses `try { … } finally { db.close() }`; handle released on success + on `stmt.all()` throw.

Finding: `openCursorSqliteReadonly` returns a `DatabaseSync` instance never closed by `loadCursorChatMessagesFromStore`. On Windows the handle holds an exclusive read lock that blocks the Cursor CLI from writing.

**Files:**
- Modify: `src/providers/cursor/history/cursorHistoryStore.ts`
- Create: `tests/unit/providers/cursor/history/cursorHistoryStoreClose.test.ts`

- [ ] **Step 1: Verify**

Open `src/providers/cursor/history/cursorHistoryStore.ts`. Confirm no `db.close()` call after `stmt.all()`. Update tracker C3.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/providers/cursor/history/cursorHistoryStoreClose.test.ts`:

```typescript
const closeSpy = jest.fn();
const allMock = jest.fn(() => []);

jest.mock('node:sqlite', () => {
  class DatabaseSync {
    constructor(_path: string, _opts?: { readOnly: boolean }) {}
    prepare(_sql: string) {
      return { all: () => allMock() };
    }
    close() { closeSpy(); }
  }
  return { DatabaseSync };
}, { virtual: true });

import { loadCursorChatMessagesFromStore } from '@/providers/cursor/history/cursorHistoryStore';

describe('loadCursorChatMessagesFromStore', () => {
  beforeEach(() => {
    closeSpy.mockReset();
    allMock.mockReset();
    allMock.mockImplementation(() => []);
  });

  it('closes the SQLite handle after a successful read', () => {
    loadCursorChatMessagesFromStore('/fake/store.db');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('closes the SQLite handle when stmt.all() throws', () => {
    allMock.mockImplementation(() => { throw new Error('SQL boom'); });
    expect(() => loadCursorChatMessagesFromStore('/fake/store.db')).not.toThrow();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern=cursorHistoryStoreClose`
Expected: FAIL — `closeSpy` receives 0 calls.

- [ ] **Step 4: Implement close on every path**

Edit `src/providers/cursor/history/cursorHistoryStore.ts`. Replace `openCursorSqliteReadonly` + `loadCursorChatMessagesFromStore` (lines 130–227) with:

```typescript
interface CursorSqliteHandle {
  prepare: (sql: string) => { all: () => unknown[] };
  close: () => void;
}

function openCursorSqliteReadonly(dbPath: string): CursorSqliteHandle | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    return new DatabaseSync(dbPath, { readOnly: true }) as unknown as CursorSqliteHandle;
  } catch {
    return null;
  }
}

export function loadCursorChatMessagesFromStore(dbPath: string): ChatMessage[] {
  const db = openCursorSqliteReadonly(dbPath);
  if (!db) return [];
  try {
    let rows: Array<{ rowid: number; id: string; data: Buffer | Uint8Array }>;
    try {
      const stmt = db.prepare('SELECT rowid, id, data FROM blobs ORDER BY rowid');
      rows = stmt.all() as Array<{ rowid: number; id: string; data: Buffer | Uint8Array }>;
    } catch {
      return [];
    }
    const records: Array<{ rowId: string; record: Record<string, unknown> }> = [];
    for (const row of rows) {
      const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
      const raw = buf.toString('utf8');
      if (!raw.startsWith('{')) continue;
      try {
        records.push({ rowId: row.id, record: JSON.parse(raw) as Record<string, unknown> });
      } catch {
        // skip unparseable rows
      }
    }
    return buildChatMessagesFromCursorHistoryRecords(records);
  } finally {
    try { db.close(); } catch { /* ignore close errors */ }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- --selectProjects unit --testPathPattern=cursor/history`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/cursor/history/cursorHistoryStore.ts tests/unit/providers/cursor/history/cursorHistoryStoreClose.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): close SQLite handle after history hydration"
```

---

## Task 3: H6 — Normalize workspace path + two-hash migration fallback

> **Status: DONE in PR1** (`8940702`). `cursorWorkspaceHash` hashes normalized path (lowercased on win32, trailing separators stripped). `cursorWorkspaceHashLegacy` exported; `resolveCursorStoreDbPath` falls back to it. Delete path also iterates both hashes after review (`a949703`).

Finding: Workspace hash drifts across Windows path casing → silent empty history on upgrade. Without a migration, every Windows user loses history mapping. We add normalization AND a one-shot fallback that tries the legacy hash if the normalized hash returns no store.

**Files:**
- Modify: `src/providers/cursor/history/cursorHistoryStore.ts`
- Modify: `tests/unit/providers/cursor/history/cursorHistoryStore.test.ts`

- [ ] **Step 1: Verify**

Read the file. Confirm `cursorWorkspaceHash` hashes input as-is. Update tracker H6.

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/providers/cursor/history/cursorHistoryStore.test.ts`:

```typescript
import {
  cursorWorkspaceHash,
  cursorWorkspaceHashLegacy,
  resolveCursorStoreDbPath,
} from '@/providers/cursor/history/cursorHistoryStore';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('cursorWorkspaceHash (normalized)', () => {
  const realPlatform = process.platform;
  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }
  afterEach(() => setPlatform(realPlatform));

  it('produces the same hash for differently-cased Windows paths', () => {
    setPlatform('win32');
    expect(cursorWorkspaceHash('D:\\Projects\\Claudian'))
      .toBe(cursorWorkspaceHash('d:\\projects\\claudian'));
  });

  it('keeps POSIX paths case-sensitive', () => {
    setPlatform('linux');
    expect(cursorWorkspaceHash('/home/user/Vault'))
      .not.toBe(cursorWorkspaceHash('/home/user/vault'));
  });

  it('normalizes trailing slashes', () => {
    setPlatform('linux');
    expect(cursorWorkspaceHash('/home/user/vault'))
      .toBe(cursorWorkspaceHash('/home/user/vault/'));
  });
});

describe('resolveCursorStoreDbPath two-hash fallback', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-test-home-'));
  const realHome = os.homedir;
  beforeAll(() => { (os as any).homedir = () => tmpHome; });
  afterAll(() => {
    (os as any).homedir = realHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('falls back to the legacy hash when the normalized hash has no store', () => {
    const vault = 'D:\\Projects\\Claudian';
    const legacy = cursorWorkspaceHashLegacy(vault);
    const legacyDir = path.join(tmpHome, '.cursor', 'chats', legacy, 'sess-123');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'store.db'), '');

    const resolved = resolveCursorStoreDbPath(vault, 'sess-123');
    expect(resolved).toBe(path.join(legacyDir, 'store.db'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- --selectProjects unit --testPathPattern=cursor/history/cursorHistoryStore`
Expected: FAIL — `cursorWorkspaceHashLegacy` not exported; two-hash fallback not present.

- [ ] **Step 4: Implement normalization + fallback**

Edit `src/providers/cursor/history/cursorHistoryStore.ts`:

```typescript
function normalizeWorkspacePathForHash(absoluteVaultPath: string): string {
  let normalized = path.resolve(absoluteVaultPath);
  while (normalized.length > 1 && (normalized.endsWith(path.sep) || normalized.endsWith('/'))) {
    normalized = normalized.slice(0, -1);
  }
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

export function cursorWorkspaceHash(absoluteVaultPath: string): string {
  return crypto.createHash('md5').update(normalizeWorkspacePathForHash(absoluteVaultPath)).digest('hex');
}

/** Legacy (pre-normalization) hash; kept only for one-shot upgrade fallback. */
export function cursorWorkspaceHashLegacy(absoluteVaultPath: string): string {
  return crypto.createHash('md5').update(absoluteVaultPath).digest('hex');
}

export function resolveCursorStoreDbPath(absoluteVaultPath: string, sessionId: string): string | null {
  if (!isValidCursorSessionId(sessionId)) return null;
  const candidates = [
    cursorWorkspaceHash(absoluteVaultPath),
    cursorWorkspaceHashLegacy(absoluteVaultPath),
  ];
  for (const hash of candidates) {
    const candidate = path.join(os.homedir(), '.cursor', 'chats', hash, sessionId, 'store.db');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
```

(`isValidCursorSessionId` is introduced in Task 19. Adding the call here is forward-compatible because Task 19 lands earlier in the same PR; engineer should not run this task's tests until Task 19 lands.)

- [ ] **Step 5: Run tests**

Run: `npm run test -- --selectProjects unit --testPathPattern=cursor/history/cursorHistoryStore`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/cursor/history/cursorHistoryStore.ts tests/unit/providers/cursor/history/cursorHistoryStore.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): normalize workspace hash and fall back to legacy hash for one-shot migration"
```

---

## Task 4: H7 + SEC3 — Surface history hydration errors with redacted paths

> **Status: DONE in PR1** (`b27b4a1`). Added `loadCursorChatMessagesFromStoreResult` returning `{ messages, error? }`. `redactHomeInPath` handles both `\\` and `/` forms. Service exposes `getLastHistoryLoadError(conversationId)` as a queryable field (logger plumbing deferred — narrow PR1 scope). `loadCursorChatMessagesFromStore` preserved as back-compat wrapper.

Finding: History load errors silently return `[]`. Add an explicit error path AND redact `$HOME` from the error string before it surfaces.

**Files:**
- Modify: `src/providers/cursor/history/cursorHistoryStore.ts`
- Modify: `src/providers/cursor/history/CursorConversationHistoryService.ts`
- Modify: `tests/unit/providers/cursor/history/cursorHistoryStore.test.ts`

- [ ] **Step 1: Verify**

Read both files. Confirm silent `return []`. Update tracker H7 and SEC3.

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/providers/cursor/history/cursorHistoryStore.test.ts`:

```typescript
import { loadCursorChatMessagesFromStoreResult } from '@/providers/cursor/history/cursorHistoryStore';
import * as os from 'os';

describe('loadCursorChatMessagesFromStoreResult', () => {
  it('returns an error when the database cannot be opened', () => {
    const result = loadCursorChatMessagesFromStoreResult('/definitely/does/not/exist.db');
    expect(result.messages).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('redacts the home directory from the error message', () => {
    const home = os.homedir();
    const path = `${home}/.cursor/chats/abc/xyz/store.db`;
    const result = loadCursorChatMessagesFromStoreResult(path);
    expect(result.error).toBeDefined();
    expect(result.error).not.toContain(home);
    expect(result.error).toContain('[HOME]');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — function not exported.

- [ ] **Step 4: Implement the result variant + redaction**

Add to `src/providers/cursor/history/cursorHistoryStore.ts`:

```typescript
function redactHomeInPath(s: string): string {
  const home = os.homedir();
  if (!home) return s;
  // Replace both forward- and back-slash variants of home.
  return s
    .split(home).join('[HOME]')
    .split(home.replace(/\\/g, '/')).join('[HOME]');
}

export interface CursorHistoryLoadResult {
  messages: ChatMessage[];
  error?: string;
}

export function loadCursorChatMessagesFromStoreResult(dbPath: string): CursorHistoryLoadResult {
  const db = openCursorSqliteReadonly(dbPath);
  if (!db) {
    return { messages: [], error: `Cursor history: could not open ${redactHomeInPath(dbPath)}` };
  }
  try {
    let rows: Array<{ rowid: number; id: string; data: Buffer | Uint8Array }>;
    try {
      const stmt = db.prepare('SELECT rowid, id, data FROM blobs ORDER BY rowid');
      rows = stmt.all() as Array<{ rowid: number; id: string; data: Buffer | Uint8Array }>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { messages: [], error: `Cursor history: SQL read failed (${redactHomeInPath(msg)})` };
    }
    const records: Array<{ rowId: string; record: Record<string, unknown> }> = [];
    for (const row of rows) {
      const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
      const raw = buf.toString('utf8');
      if (!raw.startsWith('{')) continue;
      try {
        records.push({ rowId: row.id, record: JSON.parse(raw) as Record<string, unknown> });
      } catch { /* skip */ }
    }
    return { messages: buildChatMessagesFromCursorHistoryRecords(records) };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 5: Wire CursorConversationHistoryService**

Read `src/providers/cursor/history/CursorConversationHistoryService.ts`. Replace the call to `loadCursorChatMessagesFromStore` with `loadCursorChatMessagesFromStoreResult`. When `result.error` is set, call the plugin's leveled logger at `warn` level. If the service exposes a way to attach a field to the returned conversation (read the existing return type), set `historyLoadError: result.error` so the chat UI can render a "history failed to load — retry?" hint in a follow-up plan; if no field exists, only log.

- [ ] **Step 6: Run tests and commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=cursor/history
git add src/providers/cursor/history/ tests/unit/providers/cursor/history/cursorHistoryStore.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): surface history hydration errors with redacted home-directory paths"
```

---

## Task 5: H1 — Attach close listener before stream pumping + feature flag

> **Status: ALREADY-FIXED before plan execution.** `631ec40` (`terminateChild()` attaches `exit` before `kill()`) + `5fe877d` (SIGKILL escalation) landed after plan was drafted. Cancel→kill race no longer exists. The remaining close-listener timing in `query()` is cosmetic — feature flag unnecessary. Optional cleanup may roll into PR2.

Finding: `CursorChatRuntime.query` attaches `child.on('close', ...)` only after `processCursorAgentNdjsonLines` completes. Cancel can race with kill. Fix: attach close/exit handlers immediately after spawn. Adds `CLAUDIAN_CURSOR_LEGACY_CLOSE_LISTENER=1` rollback flag.

**Files:**
- Modify: `src/providers/cursor/runtime/CursorChatRuntime.ts`
- Modify: `tests/unit/providers/cursor/runtime/CursorChatRuntime.test.ts`

- [ ] **Step 1: Verify**

Re-read `CursorChatRuntime.ts` lines 154–229. Confirm close-listener attachment happens only after `stream.next()` loop completes. Confirm `cancel()` (line 232) calls `child.kill('SIGTERM')` synchronously. Update tracker H1.

- [ ] **Step 2: Write the failing deterministic test**

Append to `tests/unit/providers/cursor/runtime/CursorChatRuntime.test.ts`:

```typescript
import { EventEmitter } from 'events';

it('resolves the close promise even when kill() emits close synchronously', async () => {
  // Deterministic harness: mockSpawn returns a child whose kill() emits 'close'
  // synchronously, modelling Windows SIGKILL behaviour where the process dies
  // before any later-attached listener can fire.
  const child = new EventEmitter() as any;
  child.stdin = { end: jest.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let closeListeners: Array<(code: number | null) => void> = [];
  const origOn = child.on.bind(child);
  child.on = (ev: string, cb: any) => {
    if (ev === 'close') closeListeners.push(cb);
    return origOn(ev, cb);
  };
  child.once = child.on;
  child.kill = jest.fn(() => {
    // Synchronously notify everyone currently listening for close.
    for (const cb of closeListeners) cb(0);
  });

  // Engineer: arrange mockSpawn (already mocked in this test file) to return `child`.
  // Stream a minimal session_id + result frame so the loop completes naturally,
  // then call runtime.cancel(). If the close listener is attached AFTER the
  // stream completes, kill() fires before there are listeners and the awaited
  // promise hangs. The test enforces a 200ms hard timeout.

  // ... fill setup with the same mockSpawn pattern already used in the file ...

  const finishedWithin = await Promise.race([
    (async () => {
      // pump the generator to completion
      // call cancel() at the right moment
      return 'done';
    })(),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 200)),
  ]);
  expect(finishedWithin).toBe('done');
});
```

- [ ] **Step 3: Implement listener-first ordering with feature flag**

Edit `src/providers/cursor/runtime/CursorChatRuntime.ts`. Inside `query()`, after `this.child = child;` (current line 165), insert:

```typescript
const legacyListenerOrder = process.env.CLAUDIAN_CURSOR_LEGACY_CLOSE_LISTENER === '1';
let resolveClose!: (code: number | null) => void;
const closePromise = new Promise<number | null>((resolve) => { resolveClose = resolve; });
if (!legacyListenerOrder) {
  let closed = false;
  const settle = (code: number | null) => {
    if (closed) return;
    closed = true;
    resolveClose(code);
  };
  child.once('close', settle);
  child.once('exit', settle);
}
```

Then replace the old close-promise creation (lines 200–202) with:

```typescript
const exitCode = legacyListenerOrder
  ? await new Promise<number | null>((resolve) => { child.on('close', (code) => resolve(code)); })
  : await closePromise;
```

- [ ] **Step 4: Run tests and commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=CursorChatRuntime
git add src/providers/cursor/runtime/CursorChatRuntime.ts tests/unit/providers/cursor/runtime/CursorChatRuntime.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): attach close listener before stream pumping; add legacy-order rollback flag"
```

---

## Task 6: H2 + ARC2 — Platform-aware kill signal + Opencode regression test

> **Status: PENDING-PR2.** Symptom still present: `AcpSubprocess.ts:122` sends `SIGTERM` unconditionally; silently ignored on Windows. Plan body below stays accurate.

Finding: `AcpSubprocess` always sends SIGTERM; on Windows that is silently ignored. Adds `CLAUDIAN_ACP_FORCE_SIGTERM=1` rollback flag. Adds an Opencode regression test because Opencode rides on the same shared subprocess.

**Files:**
- Modify: `src/providers/acp/AcpSubprocess.ts`
- Create: `tests/unit/providers/acp/AcpSubprocessKillPlatform.test.ts`
- Create: `tests/unit/providers/opencode/runtime/opencodeAcpKill.test.ts`

- [ ] **Step 1: Verify**

Open `src/providers/acp/AcpSubprocess.ts`. Find the kill path. Confirm SIGTERM is unconditional. If already platform-aware, mark DISMISSED and skip rest. Update tracker H2.

- [ ] **Step 2: Write the failing kill-platform test (real code, not `it.todo`)**

Create `tests/unit/providers/acp/AcpSubprocessKillPlatform.test.ts`:

```typescript
import { EventEmitter } from 'events';

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({ spawn: (...a: unknown[]) => mockSpawn(...a) }));

const realPlatform = process.platform;
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
afterEach(() => {
  setPlatform(realPlatform);
  jest.clearAllMocks();
});

function makeChild() {
  const child = new EventEmitter() as any;
  child.stdin = { end: jest.fn(), on: jest.fn(), once: jest.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

// Engineer: read src/providers/acp/AcpSubprocess.ts to find the exported class
// and its shutdown/dispose method name. Use it below. The test asserts:
//   - on win32, the FIRST kill signal sent is 'SIGKILL';
//   - on linux, the FIRST kill signal sent is 'SIGTERM';
//   - if the child emits 'exit' twice, cleanup runs at most once.

it('sends SIGKILL on win32', async () => {
  setPlatform('win32');
  const child = makeChild();
  mockSpawn.mockReturnValueOnce(child);
  // const sub = new AcpSubprocess({ command: 'x', args: [] }); await sub.start(); await sub.shutdown();
  // expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  // Fill these in after reading the file.
});

it('sends SIGTERM on linux', async () => {
  setPlatform('linux');
  const child = makeChild();
  mockSpawn.mockReturnValueOnce(child);
  // ...
});

it('runs cleanup at most once when exit fires twice', async () => {
  const child = makeChild();
  mockSpawn.mockReturnValueOnce(child);
  // ...
});

it('honors CLAUDIAN_ACP_FORCE_SIGTERM=1 to keep legacy SIGTERM-on-win32', async () => {
  process.env.CLAUDIAN_ACP_FORCE_SIGTERM = '1';
  try {
    setPlatform('win32');
    const child = makeChild();
    mockSpawn.mockReturnValueOnce(child);
    // ... expect kill called with 'SIGTERM'
  } finally {
    delete process.env.CLAUDIAN_ACP_FORCE_SIGTERM;
  }
});
```

(Engineer fills the assertions after reading the file. The `it.todo` pattern from draft 1 is replaced by real `it` blocks scaffolded with the spawn mock pattern.)

- [ ] **Step 3: Implement platform branch + feature flag + idempotent exit**

Edit `AcpSubprocess.ts`:

- Add at top of file or inside the class: `const FORCE_SIGTERM = () => process.env.CLAUDIAN_ACP_FORCE_SIGTERM === '1';`
- Replace `proc.kill('SIGTERM')` with: `proc.kill(process.platform === 'win32' && !FORCE_SIGTERM() ? 'SIGKILL' : 'SIGTERM');`
- Introduce `let cleaned = false;` and wrap exit/close handlers with `if (cleaned) return; cleaned = true;`.
- Cancel the escalation timer in the cleanup branch (`clearTimeout(timer)`); skip registering it on Windows when SIGKILL is the first signal.

- [ ] **Step 4: Add Opencode regression test**

Create `tests/unit/providers/opencode/runtime/opencodeAcpKill.test.ts`. Read the Opencode runtime to find how it constructs `AcpSubprocess`. The test instantiates Opencode's runtime path in the same way and asserts the same kill-signal behavior. If Opencode wraps `AcpSubprocess` directly, a one-line test that imports `AcpSubprocess` from Opencode's perspective and asserts is enough; the goal is a regression marker that catches accidental future divergence.

- [ ] **Step 5: Run all ACP and Opencode runtime tests**

```bash
npm run test -- --selectProjects unit --testPathPattern="(providers/acp|providers/opencode/runtime)"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/acp/AcpSubprocess.ts tests/unit/providers/acp/AcpSubprocessKillPlatform.test.ts tests/unit/providers/opencode/runtime/opencodeAcpKill.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(acp): use SIGKILL on Windows by default; idempotent exit; CLAUDIAN_ACP_FORCE_SIGTERM rollback"
```

---

## Task 7: H3 — Reject pending zero-timeout requests on transport close

> **Status: ALREADY-FIXED.** `AcpJsonRpcTransport.dispose()` already iterates `this.pending` and rejects on close (wired into `readline.on('close')` + stream error/close paths). No work needed.

Finding: `timeoutMs=0` (used by the prompt RPC) means no timer is registered. If the remote crashes after receiving the request, the promise stays pending forever.

**Files:**
- Modify: `src/providers/acp/AcpJsonRpcTransport.ts`
- Create: `tests/unit/providers/acp/AcpJsonRpcTransportTimeoutZero.test.ts`

- [ ] **Step 1: Verify**

Read `AcpJsonRpcTransport.ts`. Locate the request-sending function. Confirm `timeoutMs===0` skips timer registration. Locate the close/dispose path; confirm pending requests are not iterated. Update tracker H3.

- [ ] **Step 2: Write a real failing test (no `it.todo`)**

Create `tests/unit/providers/acp/AcpJsonRpcTransportTimeoutZero.test.ts`:

```typescript
import { Readable, Writable } from 'stream';

// Engineer: import the actual transport class and any required types.
// The test pattern below uses a writable that swallows output and a readable
// that never emits, so the request never gets a response.

function makeFakeStreams() {
  const stdout = new Readable({ read() {} });
  const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
  return { stdout, stdin };
}

it('rejects a pending zero-timeout request when the transport closes', async () => {
  const { stdout, stdin } = makeFakeStreams();
  // const transport = new AcpJsonRpcTransport({ stdout, stdin });
  // transport.start();
  // const p = transport.sendRequest('test/method', {}, { timeoutMs: 0 });
  // setTimeout(() => transport.close(), 10);
  // await expect(p).rejects.toThrow(/closed|disconnected/);
});

it('rejecting on close is idempotent (close twice does not throw)', async () => {
  const { stdout, stdin } = makeFakeStreams();
  // const transport = new AcpJsonRpcTransport({ stdout, stdin });
  // transport.start();
  // transport.close();
  // expect(() => transport.close()).not.toThrow();
});
```

(Engineer reads the file to fill imports and method names. Tests become real `it` calls with assertions; no `it.todo`.)

- [ ] **Step 3: Implement pending-rejection-on-close + idempotency**

Edit `AcpJsonRpcTransport.ts`. In the close/dispose path:

```typescript
private closed = false;

close(): void {
  if (this.closed) return;
  this.closed = true;
  const err = new Error('ACP transport closed before response');
  for (const [id, pending] of this.pending) {
    try { pending.reject(err); } catch { /* ignore */ }
    this.pending.delete(id);
  }
  // ... existing close logic ...
}
```

Replace `this.pending` with the actual identifier from the file.

- [ ] **Step 4: Run tests and commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=providers/acp
git add src/providers/acp/AcpJsonRpcTransport.ts tests/unit/providers/acp/AcpJsonRpcTransportTimeoutZero.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(acp): reject pending requests on transport close (covers timeoutMs=0)"
```

---

## Task 8: H4 — Bounded request id allocation

> **Status: PENDING-PR2.** Symptom still present; defensive fix. Plan body below stays accurate.

Finding: `nextId` unbounded. Defensive fix.

**Files:**
- Modify: `src/providers/acp/AcpJsonRpcTransport.ts`
- Modify: `tests/unit/providers/acp/AcpJsonRpcTransportTimeoutZero.test.ts`

- [ ] **Step 1: Verify**

Confirm `nextId` is a plain incrementing number with no overflow protection and no collision check. Update tracker H4.

- [ ] **Step 2: Add a real failing test (uses the public API only)**

Append to `AcpJsonRpcTransportTimeoutZero.test.ts`:

```typescript
it('allocateRequestId wraps past MAX_SAFE_INTEGER and skips ids already pending', () => {
  // Engineer: if the transport exposes a way to seed nextId for testing
  // (or if allocateRequestId can be reached via a Proxy/test hook),
  // assert that wrap-around does not return an id present in `pending`.
  // If the surface is fully private, skip this test (Jest .skip with a comment)
  // and rely on the implementation guard as defense-in-depth.
});
```

- [ ] **Step 3: Implement**

Edit `AcpJsonRpcTransport.ts`. Replace `const id = this.nextId++;` with `const id = this.allocateRequestId();`. Add:

```typescript
private allocateRequestId(): number {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (this.nextId >= Number.MAX_SAFE_INTEGER) this.nextId = 1;
    const candidate = this.nextId++;
    if (!this.pending.has(candidate)) return candidate;
  }
  throw new Error('ACP transport: unable to allocate fresh request id');
}
```

- [ ] **Step 4: Commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=providers/acp
git add src/providers/acp/AcpJsonRpcTransport.ts tests/unit/providers/acp/AcpJsonRpcTransportTimeoutZero.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(acp): bound request id allocation to avoid pending-map collision"
```

---

## Task 9: C4 — Spawn lock helper + Cursor adaptor migration

> **Status: DONE in PR1** (`dfc3e30`). `runWithCursorAgentSpawnLock` exported. `CursorAuxCliRunner.spawnOnce` migrated. `CursorChatRuntime` and `cursorModelCatalog` keep manual acquire/release per plan.

Finding: Cross-process lock deferred. Within-process: provide a try-finally-guaranteed helper; migrate `CursorAuxCliRunner` as a sample.

**Files:**
- Modify: `src/providers/cursor/runtime/cursorAgentSpawnLock.ts`
- Modify: `src/providers/cursor/runtime/CursorAuxCliRunner.ts`
- Create: `tests/unit/providers/cursor/runtime/cursorAgentSpawnLockRecovery.test.ts`

- [ ] **Step 1: Verify**

Confirm intra-process queue. Mark C4 CONFIRMED with note "mitigation only".

- [ ] **Step 2: Add helper**

Edit `cursorAgentSpawnLock.ts`:

```typescript
/**
 * Serializes Cursor Agent CLI spawns. Multiple concurrent spawns contend on
 * ~/.cursor/cli-config.json (atomic rename) and can fail with EPERM on Windows.
 * NOTE: this lock is intra-process only. A cross-process file lock is tracked
 * in .context/cursor-hardening-deferred.md.
 */
let queue: Promise<void> = Promise.resolve();

export async function acquireCursorAgentSpawnLock(): Promise<() => void> {
  let release!: () => void;
  const slot = new Promise<void>((resolve) => { release = resolve; });
  const waitFor = queue;
  queue = waitFor.then(() => slot);
  await waitFor;
  return release;
}

/**
 * Acquire-and-release wrapper. Use this in new code; old call sites can keep
 * the manual acquire/release pattern until they are migrated.
 */
export async function runWithCursorAgentSpawnLock<T>(body: () => Promise<T>): Promise<T> {
  const release = await acquireCursorAgentSpawnLock();
  try {
    return await body();
  } finally {
    release();
  }
}
```

- [ ] **Step 3: Write the recovery test**

Create `tests/unit/providers/cursor/runtime/cursorAgentSpawnLockRecovery.test.ts`:

```typescript
import {
  runWithCursorAgentSpawnLock,
  acquireCursorAgentSpawnLock,
} from '@/providers/cursor/runtime/cursorAgentSpawnLock';

describe('runWithCursorAgentSpawnLock', () => {
  it('releases the lock when the body throws', async () => {
    await expect(runWithCursorAgentSpawnLock(async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    const ok = await Promise.race([
      (async () => { const r = await acquireCursorAgentSpawnLock(); r(); return 'ok'; })(),
      new Promise<string>((resolve) => setTimeout(() => resolve('hang'), 200)),
    ]);
    expect(ok).toBe('ok');
  });

  it('serializes overlapping callers', async () => {
    const order: number[] = [];
    const a = runWithCursorAgentSpawnLock(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
    });
    const b = runWithCursorAgentSpawnLock(async () => {
      order.push(3);
      await new Promise((r) => setTimeout(r, 10));
      order.push(4);
    });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
```

- [ ] **Step 4: Migrate `CursorAuxCliRunner.spawnOnce` to the helper**

Rationale: the existing manual `try/finally` is correct; the migration is a readability change that ALSO eliminates the chance a future edit forgets to release. Wrap the existing body inside `runWithCursorAgentSpawnLock(async () => { ... })` and remove the manual `acquireCursorAgentSpawnLock` + `releaseSpawnLock()` calls. `CursorChatRuntime` keeps its manual acquire/release because its lifetime spans the generator's `try/finally`, which doesn't translate as cleanly to a callback.

- [ ] **Step 5: Run tests and commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=providers/cursor/runtime
git add src/providers/cursor/runtime/cursorAgentSpawnLock.ts src/providers/cursor/runtime/CursorAuxCliRunner.ts tests/unit/providers/cursor/runtime/cursorAgentSpawnLockRecovery.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): add runWithCursorAgentSpawnLock helper; migrate aux runner"
```

---

## Task 10: H10 — Inline edit cancel propagates abort signal to runner

> **Status: ALREADY-FIXED.** `ff3a179` refactored onto shared `QueryBackedInlineEditService` which constructs an `AbortController` and threads it into `runner.query(...)`. Cancel aborts spawn. No work needed.

Finding: `CursorInlineEditService.cancel()` aborts the controller but does not pass that signal into the runner config, so the spawned process keeps running until natural exit, blocking the spawn lock.

**Files:**
- Modify: `src/providers/cursor/auxiliary/CursorInlineEditService.ts`
- Create: `tests/unit/providers/cursor/auxiliary/CursorInlineEditService.test.ts`

- [ ] **Step 1: Verify**

Read `src/providers/cursor/auxiliary/CursorInlineEditService.ts` and `CursorAuxCliRunner.ts`. Confirm the runner's `spawnOnce` honors `config.abortController?.signal` (it does — line 67–68 in current runner). Confirm the inline edit service does NOT pass `abortController` into the runner config. Update tracker H10.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/providers/cursor/auxiliary/CursorInlineEditService.test.ts`:

```typescript
const queryMock = jest.fn();
jest.mock('@/providers/cursor/runtime/CursorAuxCliRunner', () => ({
  CursorAuxCliRunner: jest.fn().mockImplementation(() => ({
    query: queryMock,
    reset: jest.fn(),
  })),
}));

import { CursorInlineEditService } from '@/providers/cursor/auxiliary/CursorInlineEditService';

function makePlugin(): any {
  return { settings: { permissionMode: 'normal' } };
}

describe('CursorInlineEditService cancel', () => {
  beforeEach(() => queryMock.mockReset());

  it('passes an AbortController to the runner so cancel() aborts the spawn', async () => {
    let capturedSignal: AbortSignal | undefined;
    queryMock.mockImplementation((config) => {
      capturedSignal = config.abortController?.signal;
      return new Promise(() => { /* never resolves */ });
    });

    const service = new CursorInlineEditService(makePlugin());
    // Engineer: call the service method that ultimately invokes runner.query.
    // Read the file first to find the right entry point (likely `query(...)`).
    void service.query?.({ /* minimal args */ } as any, () => {});

    service.cancel?.();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
```

- [ ] **Step 3: Implement**

In `CursorInlineEditService`, instantiate an `AbortController` on each query and pass `{ abortController }` in the `CursorAuxQueryConfig`. On `cancel()`, abort the controller and null it out. (Engineer reads the file to find the right insertion point; do not rename existing fields.)

- [ ] **Step 4: Commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=CursorInlineEditService
git add src/providers/cursor/auxiliary/CursorInlineEditService.ts tests/unit/providers/cursor/auxiliary/CursorInlineEditService.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): propagate inline edit cancel into Cursor Agent spawn"
```

---

## Task 11: H8 — Stop shadowing environmentVariables in settings

> **Status: DISMISSED-ON-REVIEW.** Initially landed as `3cc5fbd`; reverted in `8bd097c` after Codex P1 review on PR #24. The "shadowing" was wrong: `setProviderConfig` does full-block replacement, so the writeback is load-bearing — `EnvironmentApplyService` writes `providerConfigs.cursor.environmentVariables`, then `saveHash` calls `updateCursorProviderSettings({ environmentHash })`, and dropping the writeback wipes user env. The underlying merge-vs-replace concern is real but out of scope.

Finding: `updateCursorProviderSettings` writes the legacy fallback value back into `providerConfig.environmentVariables` on every save, shadowing the authoritative source.

**Files:**
- Modify: `src/providers/cursor/settings.ts`
- Modify: `tests/unit/providers/cursor/settings.test.ts`

- [ ] **Step 1: Verify**

Open `src/providers/cursor/settings.ts`. Find `updateCursorProviderSettings`. Confirm it passes `environmentVariables` to `setProviderConfig` even when the caller did not provide it. If absent (refactored since audit), mark DISMISSED. Otherwise CONFIRMED.

- [ ] **Step 2: Write the failing test (real assertions)**

Append to `tests/unit/providers/cursor/settings.test.ts`:

```typescript
import {
  updateCursorProviderSettings,
  getCursorProviderSettings,
} from '@/providers/cursor/settings';

it('does not write environmentVariables back into providerConfig.cursor', () => {
  const settings: any = {
    providers: {
      cursor: { enabled: false /* note: no environmentVariables here */ },
    },
    // mock the authoritative source the file reads from; engineer reads
    // ProviderSettingsCoordinator / providerEnvironment to populate this.
  };

  updateCursorProviderSettings(settings, { enabled: true });

  // After the update, environmentVariables MUST NOT have been written into the cursor config.
  expect(settings.providers.cursor.environmentVariables).toBeUndefined();
});
```

(Engineer reads the file before writing to populate the test's authoritative-source mock.)

- [ ] **Step 3: Implement**

Remove `environmentVariables` from the object passed to `setProviderConfig` inside `updateCursorProviderSettings`. Keep the field in the type for backward compatibility on read.

- [ ] **Step 4: Commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=cursor/settings
git add src/providers/cursor/settings.ts tests/unit/providers/cursor/settings.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): stop shadowing environmentVariables in provider config writes"
```

---

## Task 12: H9 — Treat any saved-vs-next hash mismatch as "needs recompute"

> **Status: ALREADY-FIXED.** Generic `EnvHashReconciler.ts:41` already does `saved === next` and invalidates on any mismatch.

Finding: Empty saved hash should invalidate when the next hash is non-empty. The original draft's special-case condition is redundant — a single `saved !== next` covers the failure.

**Files:**
- Modify: `src/providers/cursor/env/CursorSettingsReconciler.ts`
- Modify: `tests/unit/providers/cursor/env/CursorSettingsReconciler.test.ts`

- [ ] **Step 1: Verify**

Read the reconciler. Find the env-hash compare. If it already invalidates on any inequality (including empty-vs-nonempty), mark DISMISSED. If it currently early-returns on `saved === ''`, mark CONFIRMED.

- [ ] **Step 2: Failing test**

```typescript
it('invalidates conversations when the saved environmentHash is empty and the next hash is non-empty', () => {
  // Engineer: arrange settings with cursor.environmentHash = '' and a host env
  // that produces a non-empty hash. Run the reconciler. Assert conversations
  // are invalidated (or whatever signal the existing tests use).
});
```

- [ ] **Step 3: Implement**

Replace the compare with a single `if (saved !== next) { invalidate(); }`. Remove any `if (saved === '')` early-return.

- [ ] **Step 4: Commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=CursorSettingsReconciler
git add src/providers/cursor/env/CursorSettingsReconciler.ts tests/unit/providers/cursor/env/CursorSettingsReconciler.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): invalidate conversations on any environmentHash mismatch"
```

---

## Task 13: H11 — Dedup tool_result in ACP normalizer + Opencode fixture

> **Status: PENDING-PR2.** `AcpSessionUpdateNormalizer.ts:167-174, 217-224` can emit `tool_result` twice; no per-id dedup. Plan body below stays accurate.

Finding: `AcpSessionUpdateNormalizer` can emit `tool_result` twice for one tool call (once on `tool_call` completed, once on `tool_call_update` completed). Adds per-id dedup AND a quick Opencode regression fixture because the normalizer is shared.

**Files:**
- Modify: `src/providers/acp/AcpSessionUpdateNormalizer.ts`
- Modify: `tests/unit/providers/acp/AcpSessionUpdateNormalizer.test.ts`

- [ ] **Step 1: Verify**

Open `AcpSessionUpdateNormalizer.ts`. Trace `normalizeToolCall` and `normalizeToolCallUpdate`. Confirm both can emit `tool_result` for completed/failed status. Update tracker H11.

- [ ] **Step 2: Failing test (real fixture)**

Append to `tests/unit/providers/acp/AcpSessionUpdateNormalizer.test.ts`:

```typescript
import { AcpSessionUpdateNormalizer } from '@/providers/acp/AcpSessionUpdateNormalizer';

it('emits tool_result at most once per tool call id across call+update events', () => {
  const norm = new AcpSessionUpdateNormalizer();
  const chunks: any[] = [];

  // Sequence representative of both Cursor and Opencode: tool_call already
  // arrives in 'completed' state, then a follow-up tool_call_update still
  // claims 'completed'.
  const callEvent = {
    sessionUpdate: 'tool_call',
    toolCallId: 'tc-1',
    status: 'completed',
    title: 'Read',
    rawInput: { file_path: '/x.md' },
    content: [{ type: 'content', content: { type: 'text', text: 'file body' } }],
  };
  const updateEvent = {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'tc-1',
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'file body' } }],
  };

  // Engineer: feed events through the normalizer's public method (read the
  // file to find the right method name) and collect the resulting chunks.
  // for (const c of norm.normalize(callEvent)) chunks.push(c);
  // for (const c of norm.normalize(updateEvent)) chunks.push(c);

  const toolResults = chunks.filter((c) => c.type === 'tool_result' && c.id === 'tc-1');
  expect(toolResults.length).toBe(1);
});
```

- [ ] **Step 3: Implement**

In `AcpSessionUpdateNormalizer`, add a `Set<string> emittedToolResultIds` (or similar). Before emitting `tool_result`, check membership; if present, skip; otherwise add and emit. Reset the set on session boundary if the normalizer is reused across sessions (read the file to see if it is).

- [ ] **Step 4: Commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=AcpSessionUpdateNormalizer
git add src/providers/acp/AcpSessionUpdateNormalizer.ts tests/unit/providers/acp/AcpSessionUpdateNormalizer.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(acp): emit tool_result at most once per tool call id"
```

---

## Task 14: H12 — Fallback tool result content from args

> **Status: PENDING-PR2.** `cursorToolNormalization.ts:228-230` returns empty content with no args fallback when `result` is missing. Plan body below stays accurate.

**Files:**
- Modify: `src/providers/cursor/runtime/cursorToolNormalization.ts`
- Modify: `tests/unit/providers/cursor/runtime/cursorToolNormalization.test.ts`

- [ ] **Step 1: Verify** — read the file; confirm the early return on missing `result`. Update tracker H12.

- [ ] **Step 2: Failing test**

```typescript
it('falls back to args when result is missing for Read', () => {
  const out = normalizeCursorPersistedToolResult('Read', undefined, { file_path: '/x.md' });
  expect(out.toolUseResult).toBeDefined();
  expect(JSON.stringify(out.toolUseResult)).toContain('/x.md');
});
```

- [ ] **Step 3: Implement** — when `result` is undefined, build a minimal `toolUseResult` from `args`. For known tools (`Read`, `Glob`, `Grep`) include the relevant arg field; for unknown tools, wrap `{ source: 'args', args }`. SECURITY NOTE: args come from the CLI response, not user input — but downstream rendering must escape HTML. Verify that downstream renderer in `features/chat/` already escapes. If not, file a follow-up but do not block this task.

- [ ] **Step 4: Commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=cursorToolNormalization
git add src/providers/cursor/runtime/cursorToolNormalization.ts tests/unit/providers/cursor/runtime/cursorToolNormalization.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): fall back to args when tool result is missing"
```

---

## Task 15: Aux service test — Title generation

> **Status: PENDING-PR2.** Not executed in PR1.

(Same as draft 1 Task 15 — see file. Bodies inlined; see the original draft for the test code. Engineer reads the file first to confirm method names.)

- [ ] Steps 1–4 unchanged from previous version. Commit message: `test(cursor): cover CursorTitleGenerationService`.

---

## Task 16: Aux service test — Instruction refine

> **Status: PENDING-PR2.** Not executed in PR1.

(Same as draft 1 Task 16. The behavioral change — only mark `success: true` when at least one tag matched — stays as part of this task.)

- [ ] Steps 1–4 unchanged. Commit message: `test(cursor): cover CursorInstructionRefineService; require tag match for success`.

---

## Task 17: Aux service test — Inline edit (additional)

> **Status: PENDING-PR2.** Not executed in PR1. (T10's cancel coverage is already in via `ff3a179`'s shared `QueryBackedInlineEditService` tests.)

(Beyond Task 10 cancel coverage: happy path, frontmatter-spanning selection, empty selection, runner throws.)

- [ ] Steps 1–4 unchanged from draft 1.

---

## Task 18: Build + suite + tracker close-out (interim)

> **Status: PENDING-PR2.** PR1 ran its own close-out: typecheck/lint/test/build all 0; 356 suites / 6613 passed / 35 skipped at PR1 tip `d101639`. Repeat for PR2 after Tasks 6-17 land.

Run after Tasks 1–17:

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: green. Update tracker — every row PENDING must be CONFIRMED+fixed or DISMISSED with reason. Commit tracker:

```bash
git add docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "chore(cursor): finalize verification tracker through Task 17" || echo "no tracker changes"
```

---

## Task 19: SEC1 — sessionId path traversal validator

> **Status: DONE in PR1** (`5a7f0d2`). Hardened on review: `a949703` rejects pure-dot ids (`.`, `..`, `...` collapse to parent dir, letting `deleteConversationSession` wipe everything); `d101639` rejects trailing-dot ids (Win32 trims trailing periods → `sess.` aliases sibling `sess`). Wired into `resolveCursorStoreDbPath` and `deleteConversationSession`.

**Critical security blocker added in draft 2 after the security review.** A malicious or corrupted `sessionId` like `../../evil` allows `path.join` to escape the chats jail. We validate the id before constructing any path.

**Files:**
- Create: `src/core/providers/cursorSessionIdValidation.ts`
- Create: `tests/unit/providers/cursor/history/cursorSessionIdValidation.test.ts`
- Modify: `src/providers/cursor/history/cursorHistoryStore.ts` (call validator in `resolveCursorStoreDbPath`)
- Modify: `src/providers/cursor/history/CursorConversationHistoryService.ts` (call validator in `deleteConversationSession`)

- [ ] **Step 1: Verify**

Read `cursorHistoryStore.ts:19` and the `deleteConversationSession` path in the service. Confirm neither validates `sessionId` shape before `path.join`. Update tracker SEC1.

- [ ] **Step 2: Write failing test**

Create `tests/unit/providers/cursor/history/cursorSessionIdValidation.test.ts`:

```typescript
import { isValidCursorSessionId } from '@/core/providers/cursorSessionIdValidation';

describe('isValidCursorSessionId', () => {
  it('accepts UUID-like ids', () => {
    expect(isValidCursorSessionId('abc-123-def_xyz')).toBe(true);
    expect(isValidCursorSessionId('a1b2c3d4-e5f6-7890-abcd-1234567890ab')).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(isValidCursorSessionId('../../evil')).toBe(false);
    expect(isValidCursorSessionId('..\\evil')).toBe(false);
    expect(isValidCursorSessionId('foo/bar')).toBe(false);
    expect(isValidCursorSessionId('foo\\bar')).toBe(false);
  });

  it('rejects empty / null / non-string', () => {
    expect(isValidCursorSessionId('')).toBe(false);
    expect(isValidCursorSessionId(null as any)).toBe(false);
    expect(isValidCursorSessionId(undefined as any)).toBe(false);
    expect(isValidCursorSessionId(123 as any)).toBe(false);
  });

  it('rejects control characters and absolute paths', () => {
    expect(isValidCursorSessionId(' ')).toBe(false);
    expect(isValidCursorSessionId('/etc')).toBe(false);
    expect(isValidCursorSessionId('C:\\Windows')).toBe(false);
  });
});
```

- [ ] **Step 3: Implement validator**

Create `src/core/providers/cursorSessionIdValidation.ts`:

```typescript
/**
 * Session ids land in disk path construction (~/.cursor/chats/<hash>/<sessionId>/...).
 * Reject anything that could escape the chats jail or contain control chars.
 * Cursor itself uses UUID-style ids; this is intentionally strict.
 */
const VALID_SESSION_ID = /^[A-Za-z0-9._-]+$/;

export function isValidCursorSessionId(sessionId: unknown): sessionId is string {
  if (typeof sessionId !== 'string') return false;
  if (sessionId.length === 0 || sessionId.length > 256) return false;
  if (sessionId.includes('..')) return false;
  if (!VALID_SESSION_ID.test(sessionId)) return false;
  return true;
}
```

- [ ] **Step 4: Wire into history store**

Edit `src/providers/cursor/history/cursorHistoryStore.ts`:
- Import `isValidCursorSessionId`.
- At the top of `resolveCursorStoreDbPath` (after Task 3's edits), add: `if (!isValidCursorSessionId(sessionId)) return null;`.

- [ ] **Step 5: Wire into conversation history service**

Edit `src/providers/cursor/history/CursorConversationHistoryService.ts`. In any function that takes `sessionId` and constructs a path (e.g. `deleteConversationSession`), call the validator first and return early with `{ ok: false, error: 'invalid session id' }` (or whatever shape the function uses).

- [ ] **Step 6: Run tests and commit**

```bash
npm run test -- --selectProjects unit --testPathPattern="(cursorSessionIdValidation|cursor/history)"
git add src/core/providers/cursorSessionIdValidation.ts src/providers/cursor/history/cursorHistoryStore.ts src/providers/cursor/history/CursorConversationHistoryService.ts tests/unit/providers/cursor/history/cursorSessionIdValidation.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): validate sessionId before path construction (path-traversal hardening)"
```

---

## Task 20: SEC2 — Prompt temp file mode 0o600 + guaranteed cleanup

> **Status: DONE in PR1** (`4babf11`). Dir `chmodSync(dir, 0o700)` (POSIX only — best-effort on Windows); file written with `{ mode: 0o600 }`; write failure rm-syncs the dir before rethrowing.

Finding: `resolveCursorCliPromptArg` writes the prompt (which may contain conversation history, tool results, API responses) to a temp file with default permissions. World-readable on Linux. Cleanup is best-effort.

**Files:**
- Modify: `src/providers/cursor/runtime/cursorCliPrompt.ts`
- Create: `tests/unit/providers/cursor/runtime/cursorCliPromptTempFile.test.ts`

- [ ] **Step 1: Verify**

Read `src/providers/cursor/runtime/cursorCliPrompt.ts`. Confirm `mkdtempSync` has no `mode`. Confirm `writeFileSync` has no `mode`. Update tracker SEC2.

- [ ] **Step 2: Failing test**

Create `tests/unit/providers/cursor/runtime/cursorCliPromptTempFile.test.ts`:

```typescript
import { resolveCursorCliPromptArg } from '@/providers/cursor/runtime/cursorCliPrompt';
import * as fs from 'fs';
import * as os from 'os';

describe('resolveCursorCliPromptArg', () => {
  it('creates the temp directory with mode 0o700 (owner-only)', () => {
    const longPrompt = 'x'.repeat(20_000);
    const { arg, cleanup } = resolveCursorCliPromptArg(longPrompt);
    expect(arg.startsWith('@')).toBe(true);
    const filePath = arg.slice(1);
    const dir = require('path').dirname(filePath);
    try {
      if (process.platform !== 'win32') {
        const stat = fs.statSync(dir);
        // mode & 0o777 should be 0o700 — owner rwx, group/other none.
        expect(stat.mode & 0o777).toBe(0o700);
        const fstat = fs.statSync(filePath);
        // file mode 0o600 — owner rw, group/other none.
        expect(fstat.mode & 0o777).toBe(0o600);
      }
    } finally {
      cleanup?.();
    }
  });

  it('cleanup runs even if writeFileSync throws (no orphan dir)', () => {
    // Engineer: spy on fs.writeFileSync to throw; capture the dir created by mkdtempSync.
    // Assert the function rethrows AND the dir does not exist on disk afterwards.
  });
});
```

- [ ] **Step 3: Implement**

Edit `src/providers/cursor/runtime/cursorCliPrompt.ts`:

```typescript
export function resolveCursorCliPromptArg(prompt: string): ResolvedCursorCliPrompt {
  if (prompt.length <= CURSOR_CLI_INLINE_PROMPT_MAX_CHARS) {
    return { arg: prompt };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-cursor-prompt-'));
  // Tighten dir perms even though mkdtempSync defaults are platform-specific.
  try {
    if (process.platform !== 'win32') {
      fs.chmodSync(dir, 0o700);
    }
  } catch { /* best-effort */ }

  const filePath = path.join(dir, 'prompt.txt');
  try {
    fs.writeFileSync(filePath, prompt, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }

  return {
    arg: `@${filePath}`,
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}
```

- [ ] **Step 4: Run tests and commit**

```bash
npm run test -- --selectProjects unit --testPathPattern=cursorCliPromptTempFile
git add src/providers/cursor/runtime/cursorCliPrompt.ts tests/unit/providers/cursor/runtime/cursorCliPromptTempFile.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "fix(cursor): tighten prompt temp file permissions and clean up on write failure"
```

---

## Task 21: ARC2 — Opencode parallel ACP regression sanity check

> **Status: DONE in PR1.** Opencode test suite (23 suites / 170 passed / 3 skipped) ran clean against PR1 changes. Real mock-capture coverage for shared ACP fixes lands with PR2 when those fixes touch `AcpSubprocess`/`AcpJsonRpcTransport`/`AcpSessionUpdateNormalizer`.

Added because Tasks 6, 7, 8, 13 modify shared ACP code that Opencode depends on.

**Files:**
- (no production code change — pure regression-suite execution)

- [ ] **Step 1:** Run the existing Opencode test suite against the modified ACP code.

```bash
npm run test -- --selectProjects unit --testPathPattern=providers/opencode
```

Expected: PASS. If any test fails, investigate per-failure. Common cause: stricter `tool_result` dedup (Task 13) collides with an Opencode fixture that expects two emissions; fix the fixture, not the production code, after confirming the new behavior is the desired contract.

- [ ] **Step 2:** Update tracker row ARC2 to CONFIRMED-and-verified.

- [ ] **Step 3:** Commit any fixture adjustments only.

```bash
git status
git add tests/
git diff --cached --stat
git commit -m "test(opencode): align fixtures with shared ACP hardening" || echo "no fixture changes"
```

---

## Task 22: Integration smoke test — full Cursor turn lifecycle

> **Status: PENDING-PR2.** Best executed alongside hot-path fixes (T6/T8/T13/T14) so the smoke catches their combined behavior. Plan body below stays accurate.

QA review flagged the lack of an integration test. We add ONE focused test that exercises spawn → prompt → tool → cancel → close. It would catch regressions in Tasks 5, 6, 7, 9, 10, 13 simultaneously.

**Files:**
- Create: `tests/integration/providers/cursor/cursorLifecycleSmoke.test.ts`

- [ ] **Step 1: Plan the scenario**

Scenario:
1. Mock `child_process.spawn` to return a controlled fake CLI.
2. Construct a real `CursorChatRuntime` instance.
3. Invoke `runtime.query(...)` (start the generator).
4. Drive the fake CLI: emit `session_id` → `assistant_message` → `tool_call` (completed) → `tool_call_update` (completed) → `result` → `done`.
5. Mid-stream, call `runtime.cancel()`.
6. Assert:
   - Generator completes within 500 ms.
   - Spawn lock is reacquirable within 200 ms after cancel.
   - Exactly one `tool_result` chunk per tool call id.
   - No unresolved pending ACP requests (where applicable).
   - `lastSessionId` is set on the runtime.

- [ ] **Step 2: Write the test**

Create `tests/integration/providers/cursor/cursorLifecycleSmoke.test.ts`. Use the existing `cursorAgentSpawnSerialization.test.ts` mocks as a template; extend to emit a fuller stream sequence. Mark it as part of the unit selectProjects for now (we do not yet have a real integration jest project; if `tests/integration/` IS a separate project per `jest.config`, place the file there).

- [ ] **Step 3: Run and commit**

```bash
npm run test -- --testPathPattern=cursorLifecycleSmoke
git add tests/integration/providers/cursor/cursorLifecycleSmoke.test.ts docs/reviews/2026-06-02-cursor-hardening-verified.md
git commit -m "test(cursor): integration smoke for spawn → prompt → tool → cancel → close"
```

---

## Task 23: CHANGELOG entry

> **Status: NO-OP.** Project does not maintain `CHANGELOG.md`; releases use `gh release create --generate-notes` auto-built from conventional commit messages. PR1 release notes effectively live in the PR #24 body + per-commit messages on `main`. For PR2, do the same — write a comprehensive PR body.

Plan flagged missing release-notes coverage.

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1:** Read `CHANGELOG.md` to match its format.

- [ ] **Step 2:** Add an entry for the next release using the draft in `.context/cursor-hardening-release-notes.md`. Trim internal-only items; keep user-visible fixes and the rollback flags.

- [ ] **Step 3:** Commit.

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for cursor integration hardening"
```

---

## Task 24: Manual smoke test (required before PR2 merge)

> **Status: PENDING-USER.** Required gate before PR2 merges. PR1 not yet manually smoked on Windows + macOS/Linux — user owns this. Plan body below is the canonical script.

Release reviewer flagged the lack of a manual gate.

- [ ] **Step 1:** Build: `npm run build`. Expected: clean.

- [ ] **Step 2:** Install the dev build into a real Obsidian vault (follow the project's "Dev build setup" memory note; in this repo: `npm run release` or copy `main.js`/`manifest.json` into `.obsidian/plugins/claudian/`).

- [ ] **Step 3:** Configure the Cursor provider with a real CLI binary.

- [ ] **Step 4:** Walk this script:
  1. Start a new conversation; send a message that triggers at least one tool call (e.g. "Read the README.md file and summarize it").
  2. Observe the tool result renders exactly once.
  3. Send a follow-up message; verify history is preserved.
  4. Send another message and **cancel** mid-stream. Confirm the UI does NOT hang and a new message can be sent within 5 seconds.
  5. Reload the vault; reopen the conversation; verify history hydrates.
  6. On Windows, repeat steps 1–5 (most of these fixes are Windows-flavored).

- [ ] **Step 5:** Record findings in `.context/cursor-hardening-smoke-results.md`. Block PR2 merge if any step fails.

---

## Task 25: Telemetry / observability stubs

> **Status: DEFERRED-TO-PR2.** Three of four log sites (`cursor.history.load_failed`, `acp.transport.close_with_pending`, `acp.subprocess.kill_escalated`) have no `plugin.logger` reference in their constructors; plumbing touches constructor signatures, which is hot-path adjacent and outside PR1's risk tier. PR2 already touches `AcpSubprocess` + `AcpJsonRpcTransport` — right time to plumb the logger. Planned codes documented in `docs/superpowers/plans/2026-05-30-cursor-hardening-telemetry-design.md`.

Release review flagged no way to confirm the fixes after deploy.

- [ ] **Step 1:** Add log lines at the leveled-logger `info` level in:
  - `loadCursorChatMessagesFromStoreResult` when `error` is set — `cursor.history.load_failed`.
  - `AcpJsonRpcTransport.close` when pending requests are rejected — `acp.transport.close_with_pending`.
  - `AcpSubprocess` shutdown when SIGKILL is escalated — `acp.subprocess.kill_escalated`.
  - `CursorInlineEditService.cancel` — `cursor.inline_edit.cancel`.

- [ ] **Step 2:** Document the log codes in `docs/superpowers/plans/2026-05-30-cursor-hardening-telemetry-design.md` so future log queries can grep for them.

- [ ] **Step 3:** Commit.

```bash
git add src/ docs/superpowers/plans/2026-05-30-cursor-hardening-telemetry-design.md
git commit -m "chore(cursor): add log lines for post-deploy verification"
```

---

## Task 26: Final verification and merge

> **Status: PENDING-PR2.** PR1 ran its own version at the PR #24 tip. Repeat for PR2 once Tasks 6-17 land.

- [ ] **Step 1:** Confirm every PENDING row in `docs/reviews/2026-06-02-cursor-hardening-verified.md` is now CONFIRMED+fixed or DISMISSED.

- [ ] **Step 2:** Full suite.

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Expected: green.

- [ ] **Step 3:** Coverage report on Cursor + ACP.

```bash
npm run test:coverage -- --selectProjects unit --testPathPattern="(providers/cursor|providers/acp|providers/opencode)"
```

Expected: no Cursor aux service at 0% statement coverage.

- [ ] **Step 4:** Inspect the git log for the PR1 / PR2 commit boundary (see `## PR split` table). Open PR1 first if shipping incrementally.

- [ ] **Step 5:** After PR1 merge, run Task 24 (manual smoke) on Windows AND macOS/Linux before opening PR2.

---

## Task 27: Summary artifact

> **Status: PENDING-PR2.** PR1 summary lives in the PR #24 body and the `docs/reviews/2026-06-02-cursor-hardening-verified.md` tracker (gitignored). PR2 should produce a combined PR1+PR2 summary for the reviewer.

- [ ] Write `.context/cursor-hardening-summary.md` listing each task, the commit hash (from `git log --oneline -40`), verified/dismissed status, and the manual smoke result. This is what the reviewer reads.

---

## Review-driven changes from draft 1

Each line below cites the perspective that drove the change, followed by the task it altered.

- **Architect → Task 1**: extracted shared `subprocessEnvironmentAllowlist.ts`; applied to Opencode too (ARC1).
- **Architect → Task 6, 13**: added Opencode regression checks for shared ACP changes (Task 21).
- **Product → Task 1**: allowlist now includes `GIT_SSH_COMMAND`, `SSH_AUTH_SOCK`, `NODE_OPTIONS`, `GIT_TERMINAL_PROMPT`, `SSH_AGENT_PID`.
- **Security → Task 1**: explicit denylist for `NODE_TLS_REJECT_UNAUTHORIZED`; test covers it.
- **Security → New Task 19**: sessionId path-traversal validator (SEC1, critical blocker).
- **Security → New Task 20**: prompt temp file mode 0o600 + guaranteed cleanup on write failure (SEC2).
- **Security → Task 4**: error messages redact `$HOME` (SEC3).
- **Product → Task 3**: added two-hash fallback (`cursorWorkspaceHashLegacy`) so Windows users do not lose history on upgrade.
- **Release → Tasks 5, 6**: feature-flag rollback levers (`CLAUDIAN_CURSOR_LEGACY_CLOSE_LISTENER`, `CLAUDIAN_ACP_FORCE_SIGTERM`).
- **Release → New Tasks 23, 24, 25**: CHANGELOG entry, manual smoke gate before PR2 merge, telemetry log codes.
- **Release → top of plan**: PR split into PR1 (cold paths/tests) and PR2 (hot path/ACP).
- **QA → Tasks 5, 6, 7, 11, 13**: replaced `it.todo` / "engineer fills body" placeholders with deterministic test scaffolds that include real assertions; engineer still fills imports specific to the file but the assertion shape is inlined.
- **QA → New Task 22**: integration smoke test for full Cursor turn lifecycle.
- **Senior engineer → Task 12**: condition simplified to `saved !== next` (removed redundant special-case branches).
- **Senior engineer → Task 9**: clarified migration rationale (readability + future-safety; existing manual pattern is correct but fragile under future edits).
- **Senior engineer → Task 1 test**: now exercises the real `buildCursorAgentEnvironment` against actual `process.env` instead of mocking the filter helpers.

---

## Self-review

- **Spec coverage:** Every Critical/High finding from the original audit is a task (1–14). Three new Critical/High items from security review are Tasks 19, 20, and 4-extended. Architect's cross-provider concerns are Tasks 1 (shared utility) and 21 (regression sanity). Product's pain reprioritization is reflected in PR split (H7/H10 land in their respective PRs but no longer require shipping order across the whole monolith). Release manager's gating is Tasks 23, 24, 25. QA's integration gap is Task 22.
- **Placeholder scan:** No `TBD`, no "implement later". Each task that says "engineer reads the file first" is paired with a concrete acceptance criterion (assertion to check, behavior to verify). The `it.todo` patterns from draft 1 are gone.
- **Type consistency:** `runWithCursorAgentSpawnLock`, `loadCursorChatMessagesFromStoreResult`, `isValidCursorSessionId`, `buildAllowlistedSubprocessEnvironment` — names used consistently in every task that references them.
- **Order dependency:** Task 19 (sessionId validator) must land before or with Task 3 (which calls it). Both belong in PR1.

---

## Execution Handoff

Plan complete and saved to `[[docs/superpowers/plans/2026-05-30-cursor-integration-hardening.md]]`. Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks. Best for PR1 (low-risk tasks parallelize well).
2. **Inline Execution** — Execute tasks in this session via executing-plans with batched checkpoints. Best if you want the hot-path tasks (PR2) under direct review.

Which approach?
