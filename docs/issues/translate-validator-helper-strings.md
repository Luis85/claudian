---
title: Translate validator and parser helper strings used by Notice sites
status: partially-shipped
priority: 2 - normal
related:
  - "[[2026-06-02-codebase-review-and-improvement-plan]]"
  - Q-1 Notice i18n sweep
created: 2026-06-03
type: issue
relations:
  - Cross Cutting
---

# Translate validator + parser helper strings

## Background

The Q-1 Notice i18n sweep routes hardcoded `new Notice('...')` sites through `t()`.
The chunk pattern explicitly skips pure-dynamic pass-throughs:

```ts
const nameError = validateOpencodeAgentName(name);
if (nameError) {
  new Notice(nameError);                       // <— skipped per chunk pattern
  return;
}
```

These sites stay untranslated because the English string is produced inside a helper
function, not at the call site. Translating them requires changing the helpers'
return contract.

## Affected helpers

Identified during chunks 4 and 5:

### `src/providers/opencode/ui/OpencodeAgentSettings.ts`

- `validateOpencodeAgentName(name)` — returns one of 6 English error strings
  ("Agent name is required", "Agent name must use slash-separated path segments...",
  etc.) or `null`.
- `parseOptionalNumber(value, label)` — returns `{ error: '${label} must be a valid number' }`.
- `parseOptionalPositiveInteger(value, label)` — returns `{ error: '${label} must be a positive integer' }`.
- `parseOptionalJsonObjectOfBooleans(value, label)` — JSON-related errors.
- `parseOptionalJson(value, label)` — returns `{ error: '${label} must be valid JSON' }`.
- `parseOptionalJsonObject(value, label)` — returns `{ error: '${label} must be a JSON object' }`.

### `src/providers/claude/ui/AgentSettings.ts`

- `validateAgentName(name)` — same shape as `validateOpencodeAgentName`, different
  validation rules and error strings.

### `src/providers/claude/ui/SlashCommandSettings.ts`

- `validateCommandName(name)` — produces English validation errors for slash command
  names.

### Helper-parameter pass-through pattern (surfaced by Q-1 final review 2026-06-03)

Two helper functions accept a `failureMessage` / `error` *parameter* as English
and surface it through `new Notice()` without going through `t()`:

- `runToolbarAction(action, { failureMessage })` in
  `src/features/chat/ui/InputToolbar.ts` — callers at lines 154, 183, 311, 347,
  418, 646 pass hardcoded English strings (e.g. `'Failed to refresh mention
  catalog'`, `'Could not open external context picker'`). The Notice itself
  fires from a single site at line 37 (`new Notice(failureMessage)`).
- `notifyImageError(message)` in `src/features/chat/ui/ImageContext.ts` —
  callers at lines 211, 217, 238, 360, 362 pass hardcoded English plus
  composed suffixes like `' (File not found)'` and `' (Permission denied)'`.

These are not caught by the chunk-16 ESLint rule (the call sites are
`new Notice(failureMessage)` / `new Notice(message)` — identifier
pass-throughs, which the rule deliberately allows). The follow-up should
extend the contract:

```ts
runToolbarAction(action, { failureMessageKey: TranslationKey, failureMessageParams?: Record<string, string | number> })
notifyImageError({ key: TranslationKey, params?: Record<string, string | number> })
```

so callers pass a key + params and the Notice fires through `t(key, params)`
at the helper boundary.

## Pass-through Notice sites that depend on these helpers

| Source file | Line | Helper |
|-------------|------|--------|
| `OpencodeAgentSettings.ts` | 257 | `validateOpencodeAgentName` |
| `OpencodeAgentSettings.ts` | 285, 291, 297, 303, 309, 315 | `parseOptional*` |
| `AgentSettings.ts` (claude) | 150 | `validateAgentName` |
| `SlashCommandSettings.ts` | 226 | `validateCommandName` |
| `CodexSubagentSettings.ts` | 194 | `validateCodexSubagentName` |
| `CodexSubagentSettings.ts` | 216 | `validateCodexNicknameCandidates` |
| `CodexSkillSettings.ts` | 95 | `validateCommandName` |
| `InputToolbar.ts` | 37 | `runToolbarAction` (callers at 154, 183, 311, 347, 418, 646 pass English strings as `failureMessage`) |
| `ImageContext.ts` | various | `notifyImageError` (callers at 211, 217, 238, 360, 362 pass English strings) |
| `taskCommands.ts` | 289 | `for (const warning of resolved.warnings) new Notice(warning)` — `warnings[]` populated upstream by `resolveProviderModel` / `buildTemplateVars` |

## Why this is a separate chunk

Three reasons:

1. **Contract change.** The helpers currently return a plain `string` or
   `{ error: string }`. Translating in-place would either need them to call `t()`
   directly (couples the helper to i18n) or change the contract to return a
   `TranslationKey` (or `{ key, params }`) that the call site translates.

2. **Test surface.** These helpers are likely covered by unit tests (or should be).
   Changing their return contract requires either parallel test updates or the
   tests will silently start exercising the new shape.

3. **Cross-helper consistency.** Multiple helpers across multiple files share the
   same `{ label } must be...` pattern. A unified approach (e.g. a shared
   `ValidationError` discriminated union) makes more sense than per-helper drift.

## Proposed approach

When this chunk runs:

1. Define a shared validator result type:
   ```ts
   type ValidationError = { key: TranslationKey; params?: Record<string, string | number> };
   ```
   under `src/i18n/types.ts` or a new `src/core/validation.ts`.
2. Migrate each helper to return `ValidationError | null` instead of `string | null`.
3. Update each call site to translate at the Notice boundary:
   ```ts
   const result = validateOpencodeAgentName(name);
   if (result) {
     new Notice(t(result.key, result.params));
     return;
   }
   ```
4. Add the new validator keys under existing subspaces:
   - `provider.opencode.subagent.validation.*` for Opencode
   - `settings.subagents.validation.*` for Claude (in keeping with the chunk 5
     decision to extend the existing subspace)
   - `settings.slash.validation.*` for slash command names
5. Update the existing unit tests for each helper to assert the new
   `{ key, params }` shape.

## Out of scope

- The `parseOptional*` `label` parameter currently takes the localized field name
  ("Temperature", "Top P", etc.). When translating, the call site should pass a
  `TranslationKey` for the label, not the raw string. This is a separate decision
  about how to thread label translation through the parser.

## Tracking

Treat as Q-1 follow-up. Land after the main `new Notice()` sweep finishes (and
after the ESLint rule blocking new hardcoded notices is in place, so this chunk
is the only remaining source of English-string Notice flow).
