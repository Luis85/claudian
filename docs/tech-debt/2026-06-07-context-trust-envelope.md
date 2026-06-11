---
type: tech-debt
title: "Context has no pre-send trust envelope or citation handle"
date: 2026-06-07
updated: 2026-06-10
status: in-progress
priority: "1 - high"
severity: high
scope: composer-context
tags:
  - tech-debt
  - context
  - citations
  - prompt-safety
  - trust
related:
  - "[[composer-context-pre-send-preview]]"
  - "[[explicit-context-citations]]"
  - "[[prompt-injection-untrusted-content-demarcation]]"
---

# Context has no pre-send trust envelope or citation handle

## Summary

Context is assembled and sent without a normalized envelope that records provenance, estimated size, trust level, and source handles. This leaves three connected gaps: users cannot preview exactly what will be sent, prompts do not consistently demarcate untrusted content, and assistant answers cannot cite the note/selection that grounded them.

## Evidence

- `src/core/prompt/mainAgent.ts` documents XML tags for current note, editor selection, and browser selection, but it does not define a structured context source model or citation handle.
- `src/core/prompt/inlineEdit.ts` appends selections/context files directly into prompt strings.
- No production `ContextSourceHandle` or citation model exists in `src/`.
- Existing issue docs remain open: [[composer-context-pre-send-preview]], [[explicit-context-citations]], and [[prompt-injection-untrusted-content-demarcation]].

## Why it matters

In an Obsidian vault, source trust varies: a user's own note, an external browser selection, an MCP resource, and an image OCR result should not all look like equivalent instructions. Without provenance, the UI cannot explain what was sent, the model cannot reliably cite sources, and prompt-injection defense relies almost entirely on approval mode.

## Suggested remediation

1. Introduce a provider-neutral `ComposerContextBuilder` that emits context items, not provider prompt strings.
2. Each item should include source type, path/range, trust/provenance, token estimate, and a stable citation handle.
3. Render a pre-send context preview drawer from this envelope.
4. Provider prompt encoders should wrap untrusted/external content in labeled data blocks.
5. Render citations for explicitly attached context first; defer embeddings/RAG to a later phase.

## Acceptance criteria

- [ ] The composer can show exactly which files, ranges, folders, images, browser selections, and MCP resources are attached before send.
- [x] Untrusted/external context is clearly delimited in provider prompts. — shipped 2026-06-10, see progress note.
- [ ] Assistant output can cite an explicitly attached note or selected range.
- [ ] Unit tests cover current note, file, folder, selection, image, MCP, and external-path context items.

## Progress (2026-06-10): trust demarcation shipped

The security-relevant slice landed; `src/core/context/` now exists as the
substrate the roadmap names (`untrustedContent.ts`):

- `ContextTrust` provenance model (`vault` / `granted-external` /
  `untrusted-external`) and `wrapUntrustedExternalData()`, which wraps
  external content in `<untrusted_external_data>` and escapes embedded
  closing tags so content cannot break out of the envelope.
- Browser selections — the one context source that crosses the trust
  boundary today — are demarcated on **all four providers**: the XML path
  (`utils/browser.formatBrowserContext`, used by Claude + Opencode) emits
  `trust="untrusted-external"` plus the wrapped body, and the sectioned path
  (`core/prompt/sectionedTurn`, used by Codex + Cursor) wraps the bracketed
  block body, which previously interpolated raw web text with no escaping at
  all.
- The shared system prompt (`core/prompt/mainAgent`, used by Claude, Codex,
  and Opencode) gained an "Untrusted external content" section defining the
  envelope contract (data not instructions; surface injection attempts).
  Cursor builds its prompt without `buildSystemPrompt`, so it gets the
  envelope but not the system-prompt contract — revisit if Cursor gains a
  shared-prompt path.

Still open: the pre-send context preview (needs the full
`ContextSourceHandle`/`ContextEnvelope` model with token estimates), citation
handles, and item-level unit coverage for the remaining source types. Build
the envelope model when the preview drawer is designed, so the types ship
with a real consumer.
