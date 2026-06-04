---
status: shipped
parent: "[[Multi Provider Support]]"
---
# Cursor model families and modes — design

Date: 2026-05-28

## Problem

The Cursor provider lists every model id returned by `cursor-agent --list-models`
as a separate, flat entry in the model picker. Cursor encodes a model's
mode/effort as a suffix on the model id (`sonnet-4` vs `sonnet-4-thinking`), so a
single model family appears many times — once per mode. This floods the picker
with near-duplicates.

Claude and Codex (and the existing `opencode` provider) instead expose **one
entry per model family** plus a **mode/effort dropdown** in the composer. Cursor
should match that look, feel, behavior, and functionality.

## Verified runtime facts

- `cursor-agent --help` documents `--model` examples `gpt-5, sonnet-4,
  sonnet-4-thinking`. Mode lives in the model id suffix; there is **no** separate
  effort flag.
- `--mode` accepts only `plan` / `ask` — that is collaboration/permission mode,
  already mapped to Claudian's permission toggle. It is unrelated to model
  mode/effort.
- The `opencode` provider already implements the desired UX (base-model picker +
  per-model variant dropdown via `getReasoningOptions` / `applyReasoningSelection`
  / `combineOpencodeRawModelSelection`). Cursor copies this shape.

## Decisions (from brainstorming)

1. **Mode detection: Hybrid.** Derive from the discovered list when the bare
   family id is also present; fall back to a curated suffix vocabulary otherwise.
2. **Composer control: reuse the reasoning dropdown; hide it when a family has
   ≤1 variant.** Same slot Claude/Codex use.
3. **Settings curation: families only.** Refresh discovers all raw ids; the
   curation list shows one row per family. Enabling a family auto-includes its
   mode variants.
4. **Scope: all families** (cursor-native + third-party routed through Cursor).
   `auto` stays a standalone first entry with no mode dropdown.
5. **Effort scope: model/mode redesign + UI/UX coherence polish.** Provider
   commands, MCP management, fork/rewind are out of scope.
6. **UI/UX coherence:** all four polish items in scope — Cursor flows through the
   shared composer controls (reasoning selector reuse + stale-selection fix),
   dropdown descriptions + vendor grouping, auth-aware empty state, and
   cross-provider plan-label alignment (`'PLAN' → 'Plan'`).

## Components

### 1. `src/providers/cursor/runtime/cursorModelFamily.ts` (new, pure)

Single source of truth for family/mode decomposition. Fully unit-tested.

- `CURSOR_MODE_SUFFIXES: ReadonlySet<string>` — curated fallback vocabulary:
  `thinking, fast, max, high, medium, low`.
- `resolveCursorFamilyId(rawId, allRawIds): string` — **hybrid**:
  - Derive: if `rawId === base + "-" + suffix` and `base ∈ allRawIds`, the family
    is `base`.
  - Fallback: else if the trailing `-token` token ∈ `CURSOR_MODE_SUFFIXES`, the
    family is the prefix.
  - Else the whole `rawId` is the family.
  - Guards version-style ids (`claude-opus-4-7`, `gpt-5.5`) because their trailing
    token is neither a discovered base split nor a curated suffix.
- `extractCursorModeValue(rawId, allRawIds): string | null` — the mode token, or
  null when `rawId` is itself a family.
- `buildCursorFamilies(rawIds): CursorModelFamily[]` where
  `CursorModelFamily = { familyId; label; variants: CursorModeVariant[] }` and
  `CursorModeVariant = { value; label }`. `variants` always contains a `standard`
  entry (the bare family id) plus one entry per discovered mode. Deterministic
  ordering: `standard, low, medium, high, max, thinking, fast`, then alphabetical
  for unknown modes.
- `combineCursorModelSelection(familyId, mode): string` — returns `familyId` when
  `mode` is empty/`standard`, else `familyId-mode`.

The `standard` sentinel value (constant, e.g. `CURSOR_STANDARD_MODE = 'standard'`)
represents the bare family id in the dropdown.

### 2. `src/providers/cursor/ui/CursorChatUIConfig.ts`

- `getModelOptions(settings)` — build families from the enabled raw ids; option
  value `cursor:<familyId>`, label via family label. `auto` (`cursor:auto`) stays
  first and standalone. Env `CURSOR_MODEL` override still honored (collapsed to its
  family).
- `isAdaptiveReasoningModel(model)` — true when the resolved family has more than
  one variant.
- `getReasoningOptions(model, settings)` — return the family's variants mapped to
  `{ value, label }`. When ≤1 the composer hides the dropdown.
- `getDefaultReasoningValue(model, settings)` — the persisted
  `preferredModeByFamily[familyId]` if still valid, else `standard`.
- `applyReasoningSelection(model, value, settings)` — persist (or clear, when
  `standard`/invalid) `preferredModeByFamily[familyId]`.
- `applyModelDefaults(model, settings)` — store the family as `lastModel`; reset
  the mode selection for that family to its default.
- `normalizeModelVariant(model, settings)` — collapse a full-variant value
  (`cursor:sonnet-4-thinking`) to its family value (`cursor:sonnet-4`) and seed
  `preferredModeByFamily` (migration, see §5).
- Remove the `REASONING_OFF` stub and the `getReasoningOptions → Off` behavior.

### 3. `src/providers/cursor/capabilities.ts`

- `reasoningControl: 'none' → 'effort'` so the composer renders the dropdown.

### 4. Runtime CLI wiring — `CursorChatRuntime.query`

Replace the current `resolveCursorModelForCli(queryOptions?.model ?? providerModel)`
call with family+mode resolution:

1. Strip the `cursor:` prefix → `familyId`.
2. Read the validated `preferredModeByFamily[familyId]` from cursor settings
   (validate against the family's discovered variants; ignore unknown modes).
3. `combineCursorModelSelection(familyId, mode)` → raw id → `--model`.

`auto` resolves to `auto` with no mode. Mode lives in settings (matching opencode),
not in `queryOptions`, so the existing `ChatRuntimeQueryOptions` contract is
unchanged. `resolveCursorModelForCli` is updated or superseded by a new
`resolveCursorModelSelectionForCli(model, settings)` helper that owns the combine.

### 5. Settings tab — `src/providers/cursor/ui/CursorSettingsTab.ts`

- Replace `getAllModelIds` (flat) with a family-level grouping built from
  discovered + currently-enabled raw ids.
- One checkbox row per family: family label + a small hint of available modes
  (e.g. "3 modes"). `auto` remains implicit and unlisted.
- Enabling a family writes that family's discovered variant raw ids (including the
  bare family id) into `enabledModelsByHost` for the current host. Disabling
  removes them. This preserves the existing storage shape; `getModelOptions`
  regroups raw ids into families.
- Search filter matches against the family label and member raw ids.
- Refresh button unchanged — it repopulates discovery and regroups.

### 6. Settings storage — `src/providers/cursor/settings.ts`

- Add `preferredModeByFamily: Record<string, string>` to `CursorProviderSettings`
  with normalization (trim keys/values, drop junk) and default `{}`.
- Getter/updater plumbing mirrors the existing `enabledModelsByHost` handling.

### 7. Migration / back-compat — `CursorSettingsReconciler` + `normalizeModelVariant`

- A persisted `settings.model = cursor:sonnet-4-thinking` is split to family
  `cursor:sonnet-4` and seeds `preferredModeByFamily[sonnet-4] = thinking`.
- Env `CURSOR_MODEL=sonnet-4-thinking` is split the same way (reconciler stores the
  family value, seeds the preferred mode).
- `ownsModel` continues to match `cursor:*`, so an un-migrated full-variant value
  is still routed to Cursor and gets collapsed on next normalization — no broken
  state mid-flight.
- Normalization must run on settings load / tab activation, **before the first
  composer render**, so `ModelSelector` shows the correct active family rather than
  falling back to `auto` (see §8 item 2).

### 8. UI/UX coherence

Goal: the user sees the **same behavior across every provider**, gated only by
capabilities. The composer (`InputToolbar`) is already provider-neutral and
capability-driven — each control auto-hides from `ProviderCapabilities` +
`ProviderChatUIConfig`. Cursor conforms by declaring the right capabilities/config
so it flows through the existing shared controls; no Cursor-specific UI widgets.

#### Coherence contract (applies to all providers)

- Model selection: one entry per family in the shared `ModelSelector`; provider
  icon, optional `group` header, and `description` tooltip per option.
- Reasoning/mode: the shared `ThinkingBudgetSelector` (the "Effort:" gear control)
  renders when `reasoningControl !== 'none'` and the model has >1 option, and hides
  when there is ≤1 option (`InputToolbar.ts` lines 358-359). No provider ships its
  own reasoning widget.
- Permission/plan, service tier, MCP, context meter: capability-gated, identical
  presentation across providers.

#### Item 1+2 — Cursor flows through the shared controls

- `capabilities.reasoningControl: 'none' → 'effort'`. Cursor's mode variants then
  render in the **shared** "Effort:" gear selector exactly like Claude/Codex. The
  label stays the shared `"Effort:"` text (coherence over per-provider wording);
  no special-casing in `ThinkingBudgetSelector`.
- Stale-selection display fix: a persisted full-variant value
  (`cursor:sonnet-4-thinking`) must be normalized to its family value
  **before the first composer render**, not only on env change. `ModelSelector.updateDisplay`
  falls back to `models[0]` (→ `auto`) for any unmatched value, so without
  early normalization the toolbar would briefly mislabel the active model.
  Normalize on settings load / tab activation via `normalizeModelVariant` +
  reconciler (see §7).

#### Item 3 — dropdown descriptions + vendor grouping

- Each Cursor family option carries a `description` (e.g. mode count or vendor),
  matching how Claude/Codex populate option tooltips.
- Optional `group` header per family, bucketed by vendor
  (`Cursor`, `Anthropic`, `OpenAI`, `Google`, `xAI`, `Other`), mirroring
  `opencode`'s `groupOpencodeDiscoveredModels`. Keeps a long multi-vendor list
  readable. `auto` stays ungrouped and first.

#### Item 4 — auth-aware empty state

- When `cursor-agent --list-models` reports no models because the CLI is not
  authenticated, surface a clear, actionable notice in the settings tab
  ("Cursor CLI not logged in — run `cursor-agent login`") rather than a generic
  "Failed to refresh" message. Detection is best-effort string match on the CLI
  output / exit; the existing fallback model list is still preserved.

#### Item 5 — cross-provider label alignment

- Align Claude's permission plan label `'PLAN'` → `'Plan'` in
  `ClaudeChatUIConfig` so all providers read identically. Tiny, low-risk, touches
  only the label constant.

#### Labels — `src/providers/cursor/modelLabels.ts`

- Family labels are derived from the family id (suffix already stripped by family
  resolution), so a suffix-bearing id is never labeled with its mode.
- Add `formatCursorModeLabel(mode)` for the dropdown: `thinking → Thinking`,
  `fast → Fast`, `max → Max`, effort levels capitalized (`high → High`).

## Data flow

```
cursor-agent --list-models
  → parseModelListOutput (existing) → raw ids
  → buildCursorFamilies → families (settings list + composer model picker)

composer model pick (cursor:<familyId>)
  + composer mode pick (applyReasoningSelection → preferredModeByFamily)
  → CursorChatRuntime.query
  → combineCursorModelSelection(familyId, mode)
  → --model <rawId>
```

## Out of scope

Provider slash commands, in-app MCP management, fork, rewind. Several are
`cursor-agent` CLI limitations (`cli-config.json` shows `"rewind": false`). Logged
for a separate effort.

## Testing

Unit tests, mirrored under `tests/unit/providers/cursor/`:

- `cursorModelFamily.test.ts` — derive split, curated fallback split, version-id
  guards (`gpt-5.5`, `claude-opus-4-7` stay whole), `buildCursorFamilies`
  grouping + variant ordering, `combineCursorModelSelection` round-trip.
- `CursorChatUIConfig.test.ts` — families-only options, `auto` first,
  `isAdaptiveReasoningModel`, reasoning options per family, default + persisted
  mode, `applyReasoningSelection` persistence.
- `settings.test.ts` — `preferredModeByFamily` normalization; family
  enable/disable expands to variant raw ids.
- `CursorSettingsReconciler.test.ts` / `cursorCliModel`-equivalent — full-variant
  and env migration split + CLI combine; normalization collapses a persisted
  full-variant `settings.model` to its family before render.
- `modelLabels.test.ts` — `formatCursorModeLabel` mode labels; family labels strip
  the mode suffix.
- Coherence checks: `capabilities.reasoningControl === 'effort'`; family options
  carry `description` and vendor `group`; Claude plan label is `'Plan'`.

Run `npm run typecheck && npm run lint && npm run test && npm run build`.
</content>
</invoke>
