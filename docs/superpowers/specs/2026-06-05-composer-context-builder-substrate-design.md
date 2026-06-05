---
title: ComposerContextBuilder substrate
date: 2026-06-05
status: approved (design)
scope: src/core/context/ (new module) + tests/unit/core/context/
parent: "[[2026-06-05-plugin-improvement-roadmap]]"
slice: 1.1
related:
  - "[[2026-05-28-composer-context-pills-design]]"
  - "[[2026-05-28-plugin-improvement-research-proposal]]"
---

# ComposerContextBuilder substrate (slice 1.1)

## Summary

Introduce a pure, provider-neutral context envelope substrate at `src/core/context/`. Slice 1.1 ships only:

- Type definitions for the envelope, source handles, items, and classifications.
- A single exported pure function `buildContextEnvelope(input) → envelope` backed by private per-`sourceKind` helpers.
- A golden test suite (~14 fixtures) covering the proposal-listed input cases plus key edges.

**Zero changes to `InputController` or provider prompt encoders.** Wiring is slice 1.2.

The substrate is the seam consumed by later slices:

- 1.2 — route `InputController` + the four provider prompt encoders through the envelope.
- 1.3 — visible context-preview drawer.
- 1.4 — Phase A citations rendering via `ContextSourceHandle`.
- 2.1 — `RuntimeAuditEvent` consumes envelope classifications for redaction.
- 4.5 — `ConversationSessionEnvelope` builds on the same source-handle vocabulary.

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| First-slice scope | Strict types + pure builder + golden tests only; no wiring (Q5=A) |
| Classification surface | Full surface declared, partial population (Q6=B): `sourceKind` + `sensitivity` + `sendPreview` populated now; `trustLevel` defaults to `'unknown'`; `destination` defaults to `'provider-api'` |
| `ContextSourceHandle` shape | Bare + optional `range` (Q7=B) |
| Module location | `src/core/context/` — new top-level core dir (Q8=A) |
| Golden test scope | Proposal-listed + browser/canvas + ~5 edge cases (~15 fixtures total) (Q9=B) |
| Builder API shape | Pure orchestrator function over private per-kind helpers (Q10=A) |

## Types (`src/core/context/types.ts`)

```ts
export type SourceKind =
  | 'current-note' | 'vault-file' | 'vault-folder'
  | 'editor-selection' | 'browser-selection' | 'canvas-selection'
  | 'image' | 'mcp-resource' | 'external-path' | 'tool-output';

export type TrustLevel =
  | 'user-authored' | 'vault-local' | 'external-web'
  | 'mcp-tool-result' | 'generated' | 'unknown';

export type Destination =
  | 'provider-api' | 'local-cli' | 'mcp-server'
  | 'transcript' | 'audit-log';

export type Sensitivity =
  | 'normal' | 'secret-like' | 'private-note'
  | 'external-file' | 'image';

export type LineRange = { kind: 'line'; start: number; end: number };
export type CharRange = { kind: 'char'; start: number; end: number };
export type Range = LineRange | CharRange;

export type ContextRef =
  | { kind: 'vault'; path: string }
  | { kind: 'vault-folder'; path: string }
  | { kind: 'browser'; url?: string; source?: string }
  | { kind: 'canvas'; path: string; nodeIds?: string[] }
  | { kind: 'image'; assetId: string; vaultPath?: string }
  | { kind: 'mcp'; server: string; resource?: string; tool?: string }
  | { kind: 'external'; absPath: string };

export type SendPreview =
  | { kind: 'exact'; text: string }
  | { kind: 'summary'; text: string; truncated: boolean; estimatedTokens?: number }
  | { kind: 'asset'; assetId: string; bytes?: number };

export interface ContextSourceHandle {
  id: string;
  sourceKind: SourceKind;
  label: string;
  ref: ContextRef;
  range?: Range;
}

export interface ContextEnvelopeItem {
  id: string;
  sourceKind: SourceKind;
  label: string;
  ref: ContextRef;
  range?: Range;
  sensitivity: Sensitivity;
  destination: Destination;
  trustLevel: TrustLevel;
  sendPreview: SendPreview;
  unresolved?: boolean;
  truncated?: boolean;
  duplicateOf?: string;
}

export interface CleanupTask {
  kind: 'temp-asset' | 'detached-mention';
  ref: ContextRef;
}

export interface ContextEnvelope {
  displayText: string;
  conversationText: string;
  items: ContextEnvelopeItem[];
  handles: ContextSourceHandle[];
  flags: {
    compactCommand: boolean;
    instructionMode: boolean;
  };
  cleanup: CleanupTask[];
}

export interface ContextBuilderInput {
  displayText: string;
  conversationText: string;
  currentNote?: { path: string; basename: string };
  attachedFiles?: { path: string }[];
  attachedFolders?: {
    path: string;
    fileCount?: number;
    hasPrivateTag?: boolean;
    estimatedTokens?: number;
  }[];
  editorSelection?: { path: string; range: Range; text: string };
  browserSelection?: { source?: string; title?: string; url?: string; text: string };
  canvasSelection?: { path: string; nodeIds?: string[]; text: string };
  images?: { assetId: string; vaultPath?: string; bytes?: number }[];
  mcpMentions?: { server: string; resource?: string; tool?: string; label: string }[];
  externalPaths?: { absPath: string; accessMode?: 'read' | 'readwrite' }[];
  flags?: { compactCommand?: boolean; instructionMode?: boolean };
}
```

### Population rules

| Field | Rule for slice 1.1 |
|-------|---------------------|
| `sourceKind` | Derived per input field. |
| `sensitivity` | `current-note` / `vault-file` / `editor-selection` → `'normal'` (or `'private-note'` if a folder has `hasPrivateTag` or path matches a `private` tag heuristic). `image` → `'image'`. `external-path` → `'external-file'`. `mcp-resource` → `'normal'`. `'secret-like'` left for slice 1.4+ (no heuristic yet). |
| `destination` | Always `'provider-api'` in 1.1. |
| `trustLevel` | Always `'unknown'` in 1.1. Slice 1.4 fills (vault → `'user-authored'`, browser → `'external-web'`, mcp → `'mcp-tool-result'`). |
| `sendPreview` | Vault file / current-note: `{ kind: 'exact', text: full content }`. Folder: `{ kind: 'summary', text: file-tree, truncated, estimatedTokens }`. Selection: `{ kind: 'exact', text }`. Image: `{ kind: 'asset', assetId, bytes }`. MCP / external: `{ kind: 'summary', text: label, truncated: false }`. |
| `id` | `hashId(sourceKind, canonicalRef, canonicalRange)`. Deterministic across calls. |

## Builder (`src/core/context/buildContextEnvelope.ts`)

```ts
export function buildContextEnvelope(input: ContextBuilderInput): ContextEnvelope;
```

### Module layout

```
src/core/context/
├── types.ts                       // all types above
├── buildContextEnvelope.ts        // only public export beyond types
├── handles.ts                     // hashId, deriveHandle
├── dedupe.ts                      // collapse rules
├── sendPreview.ts                 // truncation + summary helpers
├── items/
│   ├── buildCurrentNoteItem.ts
│   ├── buildFileItem.ts
│   ├── buildFolderItem.ts
│   ├── buildSelectionItem.ts
│   ├── buildBrowserSelectionItem.ts
│   ├── buildCanvasSelectionItem.ts
│   ├── buildImageItem.ts
│   ├── buildMcpResourceItem.ts
│   └── buildExternalPathItem.ts
└── index.ts                       // re-exports buildContextEnvelope + types
```

Per-kind helper signature:

```ts
function buildXxxItem(part: ContextBuilderInput['xxx']): ContextEnvelopeItem | ContextEnvelopeItem[] | null;
```

### Orchestrator flow

1. Call each per-kind helper. Collect non-null items.
2. **De-dupe pass**: if `attachedFiles[i].path === currentNote.path`, drop the file item and set the `currentNote` item's `duplicateOf` to the dropped item's id. Current note wins (matches shipped pills behavior in [[2026-05-28-composer-context-pills-design]]).
3. For each surviving item, derive a `ContextSourceHandle` (subset of fields). Append to `handles` in the same order.
4. Assemble `cleanup` (empty array in 1.1 — placeholder for future temp-asset cleanup).
5. Return envelope.

### Determinism guarantees

- Pure transformation. No I/O. No `Date.now()`. No `Math.random()`. No env reads. No fs reads.
- Helpers are total: builder never throws on malformed input. Unresolvable items get `unresolved: true`.
- Item ordering: `currentNote`, then `attachedFiles` in input order, then `attachedFolders`, then `editorSelection`, `browserSelection`, `canvasSelection`, `images` in input order, then `mcpMentions`, then `externalPaths`.

### `hashId` (`handles.ts`)

```ts
function hashId(sourceKind: SourceKind, ref: ContextRef, range?: Range): string;
```

- Lowercases vault paths (Obsidian on win32 is case-insensitive for lookup).
- Canonicalises `range` (`undefined` → empty string).
- Runs through FNV-1a (pinned — `djb2` rejected so golden hex strings stay deterministic across implementations). No `node:crypto` (Obsidian plugin runtime).
- Returns `'ctx-' + 8 hex chars`.

### Edge rules

| Case | Behavior |
|------|----------|
| (a) attached file path equals `currentNote.path` | Drop the file item; mark the `currentNote` item's `duplicateOf` with the dropped id |
| (b) editor selection text is empty / whitespace | Skip — no item, no handle |
| (c) folder with `hasPrivateTag: true` | Item ships; `sensitivity: 'private-note'`; `truncated: true`; `sendPreview` summary includes `"contains private-tagged notes"` |
| (d) attached file path missing / unresolved | Item ships; `unresolved: true`; `sendPreview: { kind: 'summary', text: '<missing>', truncated: false }` |
| (e) folder over input-supplied size limit | Item ships; `truncated: true`; `sendPreview` summary lists the first N children plus the remaining count |
| (f) image without `vaultPath` (pasted asset) | Item ships; `sendPreview: { kind: 'asset', assetId, bytes }` |
| (g) MCP mention with both `resource` and `tool` | Treated as `mcp-resource`; tool name folds into `label` |
| (h) external path under vault root | Item ships; `sensitivity: 'external-file'`. Vault containment is a runtime concern (SEC-5) — the builder does not gate. |
| (i) `flags` omitted from input | Default `compactCommand: false`, `instructionMode: false` |

## Tests (`tests/unit/core/context/`)

```
tests/unit/core/context/
├── buildContextEnvelope.test.ts       // 15 golden cases
├── handles.test.ts                    // hashId determinism, range-sensitive ids
├── dedupe.test.ts                     // collapse rules
├── sendPreview.test.ts                // truncation thresholds
└── fixtures/
    ├── currentNoteOnly.fixture.ts
    ├── attachedFile.fixture.ts
    ├── attachedFolder.fixture.ts
    ├── editorSelection.fixture.ts
    ├── browserSelection.fixture.ts
    ├── canvasSelection.fixture.ts
    ├── image.fixture.ts
    ├── mcpMention.fixture.ts
    ├── externalPath.fixture.ts
    ├── compactFlag.fixture.ts
    ├── instructionMode.fixture.ts
    ├── edgeDuplicate.fixture.ts
    ├── edgeEmptySelection.fixture.ts
    ├── edgePrivateFolder.fixture.ts
    ├── edgeUnresolvedFile.fixture.ts
    └── edgeOversizedFolder.fixture.ts
```

### Fixture shape

```ts
export const fixture: {
  name: string;
  input: ContextBuilderInput;
  expected: ContextEnvelope;
} = { ... };
```

### Golden-case test (`buildContextEnvelope.test.ts`)

- `describe.each(fixtures)` runs each fixture through `buildContextEnvelope` and asserts deep equality on the returned envelope.
- Stable id assertions are hand-written hex strings — golden tests fail if `hashId` algorithm changes (intentional; forces explicit version bump if hashing changes).

### Determinism guards

- Same input → identical envelope across 100 calls.
- Item-order rule (above) asserted by snapshot.
- Lint guard: `no-restricted-syntax` rule for `Date.now()` / `Math.random()` under `src/core/context/`.

### `hashId` cross-platform (`handles.test.ts`)

- Same path with different case → same id on win32 (`itWin32` from CLAUDE.md memory).
- Same path with different case → different ids on POSIX (`itPosix`).
- Same path + different range → different ids on both platforms.
- Stable hex format `ctx-XXXXXXXX` enforced by regex assertion.

### Coverage target

95%+ for `src/core/context/`. Pure code; no excuse for gaps. Enforced via existing coverage thresholds.

## Non-goals (deferred)

- Wiring `InputController` to use the builder → slice 1.2.
- Routing provider prompt encoders through envelope items → slice 1.2.
- Rendering `ContextSourceHandle` as a citation UI → slice 1.4.
- Filling `trustLevel` with real heuristics → slice 1.4.
- Setting `destination` to anything other than `'provider-api'` → slice 2.1.
- Temp-asset cleanup population (paste-image-vault-persist) → later slice.
- Provider-specific projection fixtures → slice 1.2.

## Verification

```bash
npm run typecheck
npm run lint
npm run test -- --selectProjects unit -- tests/unit/core/context
npm run test:coverage -- --selectProjects unit -- tests/unit/core/context
```

All four must pass. The substrate is not imported by any consumer in this slice, so a full `npm run test` is sufficient; no manual UI verification needed.

## Risks

- **Type churn from later slices** — mitigated by declaring the full classification surface up front (Q6=B); consumers slot in without envelope shape changes.
- **Premature de-dupe rule** — current-note-wins matches shipped pills behavior; if slice 1.4 citations need both items separately rendered, revisit the rule then.
- **`hashId` collisions** — FNV-1a on `sourceKind + ref + range` strings; with 8 hex chars the collision space is ~4 billion. Acceptable for in-memory dedup within a single envelope (max ~30 items). Document the assumption in `handles.ts`. If a later slice needs cross-envelope stability with stronger collision guarantees, widen to 12 hex chars and version the prefix (`ctx2-`).

## Related docs

- Parent roadmap: [[2026-06-05-plugin-improvement-roadmap]]
- Shipped pills design (display layer this substrate sits behind): [[2026-05-28-composer-context-pills-design]]
- Origin proposal: [[2026-05-28-plugin-improvement-research-proposal]] §1
