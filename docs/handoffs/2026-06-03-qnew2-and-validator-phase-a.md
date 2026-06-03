---
title: Session handoff — 2026-06-03 (Q-NEW-2 closed + validator Phase A in flight)
date: 2026-06-03
status: open
scope: pickup of validator-helper translation Phase A and Phase B
related:
  - "[[docs/handoffs/2026-06-04-q1-complete.md]]"
  - "[[docs/issues/translate-validator-helper-strings.md]]"
  - "[[docs/reviews/2026-06-02-codebase-review-and-improvement-plan.md]]"
supersedes:
  - "Q-NEW-2 section of 2026-06-04-q1-complete.md"
---

# Session handoff — 2026-06-03 (Q-NEW-2 closed + validator Phase A in flight)

Picks up from the 2026-06-04 Q-1-complete handoff. Two queue items moved
this session.

## What shipped this session (2 commits on main)

| Commit | Item | Verified |
|--------|------|----------|
| `cce9b47` | Q-NEW-2 — Opencode approval helpers extracted to a sibling module + 35 unit tests | tc/lint/test/build |
| `8c00618` | Validator Phase A chunk 1 — `validateOpencodeAgentName` → `ValidationError \| null` (6 keys under `provider.opencode.subagent.validation.*`) | tc/lint/test/build |
| `c8fad1b` | Validator Phase A chunk 2 — shared `validateSlugName` returns `{ rule, params? }`; `validateAgentName` + `validateCommandName` route into their own subspaces (8 keys total) | tc/lint/test/build |

All verified with `npx tsc --noEmit && npm run lint && npm run test && npm run build`
before commit. Current state: 6749 tests pass / 36 skipped / 361 suites.

## Q-NEW-2 — closure

The handoff section was wider than the actual gap. After tracing the
provider runtimes:

- **Cursor approval surface is a no-op** — `setApprovalCallback(_callback): void {}`
  in `CursorChatRuntime`, `capabilities.supportsMcpTools: false`. Nothing
  to extract or test.
- **Opencode MCP surface is empty** — `reloadMcpServers(): Promise<void> {}`
  is a no-op, `mcpServers: []` is hardcoded into every launch, and
  `capabilities.supportsMcpTools: false`. OpenCode owns its own MCP config
  internally (per `CLAUDE.md`); Claudian does not dispatch MCP for it.
- **Opencode approval surface was substantial.** Nine pure helper
  functions lived inside `OpencodeChatRuntime.ts` (lines 1334–1614),
  plus a duplicate of `selectPermissionOption` inside
  `OpencodeAuxQueryRunner.ts`. Both runtimes consumed approval data but
  the helpers were untestable in their previous location.

Resolution: extracted the nine helpers to
`src/providers/opencode/runtime/opencodeApprovalHelpers.ts`. Public
surface is five functions (`normalizeApprovalInput`,
`buildOpencodePermissionPresentation`, `mapApprovalDecision`,
`buildAcpApprovalDecisionOptions`, `selectPermissionOption`) plus three
exported types (`OpencodePermissionOption`,
`OpencodePermissionOptionKind`, `OpencodePermissionPresentation`).
Internal helpers: `normalizePermissionId`, `extractPermissionPath`,
`summarizeWorkflowTools`, `formatPermissionLabel`. Both runtimes now
import from the shared module; the duplicate inside
`OpencodeAuxQueryRunner` is gone.

Test file `tests/unit/providers/opencode/runtime/opencodeApprovalHelpers.test.ts`
covers all five exported functions across 35 cases including the path-
precedence order for `extractPermissionPath`, the `>3-tool "+N more"`
truncation in the workflow summarizer, the malformed-entry filter, and
the cancellation fallback when preferred kinds are missing.

## Validator-helper translation — Phase A in flight

Per the plan in [[docs/issues/translate-validator-helper-strings.md]]:
Phase A migrates the `validate*` helpers, Phase B migrates the
`parseOptional*` helpers plus the `runToolbarAction` / `notifyImageError`
parameter pattern.

### Phase A — landed this session

**Shared infrastructure:**

```ts
// src/i18n/types.ts
export interface ValidationError {
  key: TranslationKey;
  params?: Record<string, string | number>;
}
```

**`validateOpencodeAgentName` (`8c00618`).** Self-contained validator
with six distinct error messages. Routes through
`provider.opencode.subagent.validation.{required,slashSegments,emptySegment,whitespaceSegment,dotSegment,reservedChars}`.
None of the keys carry params. Tests now cover all six branches (was 5,
now 7); the `emptySegment` branch was previously untested.

**`validateSlugName` (`c8fad1b`).** Refactored from
`(name, label) => string | null` to `(name) => SlugValidationResult | null`
where `SlugValidationResult = { rule: SlugValidationRule, params? }` and
`SlugValidationRule = 'required' | 'tooLong' | 'invalidChars' | 'yamlReserved'`.
Two callers migrated:

- `validateAgentName` → `settings.subagents.validation.*` (4 keys)
- `validateCommandName` → `settings.slashCommands.validation.*` (4 keys)

The `tooLong` key carries `{max}` (= 64) as a param so translators can
position the number naturally inside their sentence rather than relying
on a baked-in English number.

Call sites updated in `AgentSettings.ts:150`, `SlashCommandSettings.ts:226`,
`CodexSkillSettings.ts:95`. All now read
`new Notice(t(nameError.key, nameError.params))`, ESLint-clean
(identifier pass-throughs to `t(...)` stay allowed by the chunk-16 rule).

Helper scripts (gitignored under `.context/`):
- `add-opencode-agent-validation-keys.sh` (6 keys × 9 locales)
- `add-slug-validation-keys.sh` (8 keys × 9 locales)

Both follow the chunks 1–16 pattern (idempotent Python `setdefault`).

### Phase A — what's still open

Two Codex validators per the issue doc. Same pattern as `validateAgentName`:

- `validateCodexSubagentName` — referenced from `CodexSubagentSettings.ts:194`
- `validateCodexNicknameCandidates` — referenced from `CodexSubagentSettings.ts:216`

Neither has been read yet this session. The shape will mirror the
slug-validation pattern: structured result, per-caller key routing under
`provider.codex.subagent.validation.*`.

### Phase B — not started

Per the issue doc:

- **`parseOptional*` helpers** in `OpencodeAgentSettings.ts` (`parseOptionalNumber`,
  `parseOptionalPositiveInteger`, `parseOptionalJsonObjectOfBooleans`,
  `parseOptionalJson`, `parseOptionalJsonObject`). Six call sites at lines
  285, 291, 297, 303, 309, 315. The `label` parameter currently receives a
  raw English noun ("Temperature", "Top P") — the migration needs to thread
  a `TranslationKey` for the label too, or callers pass an already-localized
  string. Open design question, see "Out of scope" in the issue doc.
- **`runToolbarAction({ failureMessage })`** at `InputToolbar.ts:37`.
  Six callers (lines 154, 183, 311, 347, 418, 646) pass hardcoded English.
  Change contract to `{ failureMessageKey, failureMessageParams? }`.
- **`notifyImageError(message)`** in `ImageContext.ts`. Five callers
  (lines 211, 217, 238, 360, 362) pass English plus composed suffixes like
  `' (File not found)'`. Change to `{ key, params? }` shape — composed
  suffixes need their own translation strategy.
- **`taskCommands.ts:289`** `for (const warning of resolved.warnings) new Notice(warning)`.
  Upstream contract change in `resolveProviderModel` /
  `buildTemplateVars` so `warnings[]` carries `ValidationError`-shaped
  entries.

## Pickup queue — current snapshot

Linear order. Items 1–2 are immediate follow-up; 3–6 are pre-existing
queue from the prior handoff.

1. **Validator Phase A finish** — `validateCodexSubagentName` +
   `validateCodexNicknameCandidates`. Estimated ≤2 commits.
2. **Validator Phase B** — `parseOptional*` + `runToolbarAction` +
   `notifyImageError` + `taskCommands.ts` warnings. Estimated 4–6
   commits depending on the label-translation design call for
   `parseOptional*`.
3. **Phase 1c F2 + F3 (PERF-4 tuning)** — needs real ≥1000-msg
   transcript measurement. Capture in
   `docs/research/2026-06-04-perf4-prod-measurement.md`.
4. **Q-7** — finish settings registry port. 5 imperative tabs
   (`general`, `claude`, `codex`, `opencode`, `cursor`), ~53 fields per
   `docs/issues/settings-registry-port-followup.md`.
5. **ADR-0001 Phase 2b** — RuntimeHost migration. ~500 LOC mechanical
   refactor across 4 provider runtimes + `tabControllers` + 5 test files.
6. **Phase 2b ARCH-5** — split `InputController.ts` (1464 LOC). Pair
   with the RuntimeHost work to amortize test churn.

ADR-0001 Phase 3 (`core/transport/` extraction) is still blocked on the
cursor-integration-hardening PR2.

## How to resume

1. Open repo at `D:\Projects\claudian`. On `main` branch.
2. Check `git log --oneline -5` — top commit should be the handoff close
   for this session, with `c8fad1b` just below.
3. For Phase A finish: read `CodexSubagentSettings.ts:194` and `:216`,
   trace the validator definitions, mirror the slug-validation pattern.
   Add keys under `provider.codex.subagent.validation.*`. One helper
   script per chunk per the chunks 1–16 convention.
4. For Phase B: start with `parseOptional*` since they're concentrated in
   one file (`OpencodeAgentSettings.ts`). The label-translation design
   decision is the only blocker — either (a) make `label` a
   `TranslationKey`, (b) make callers pass an already-translated
   `t('settings.opencode.fields.temperature')` string, or (c) emit
   `params: { label }` and add per-field keys. Recommendation: (b) keeps
   the helpers stupid and pushes the i18n contract to the caller, which
   is consistent with the rest of the validator design.
5. For `notifyImageError` composed suffixes (e.g.
   `' (File not found)'`): these are actually `errno` string mappings.
   Best path is to extract them to a small `imageErrorReason` enum + key
   map rather than passing raw English suffixes through.

## CLAUDE.md / memory state

No `CLAUDE.md` or `MEMORY.md` changes this session. The four existing
entries (window-timer convention, lint-clean policy, release process,
dev-build setup) remain accurate.
