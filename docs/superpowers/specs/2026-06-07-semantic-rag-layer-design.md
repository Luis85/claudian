---
type: design
name: semantic-rag-layer
title: Semantic RAG Layer — Ask your Vault design
status: approved
date: 2026-06-07
scope: docs/product, src/features/rag, src/core/mcp, src/features/chat, src/features/settings
parent: "[[Specorator RAG Layer Spec]]"
related:
  - "[[Specorator - Product Vision]]"
  - "[[Specorator Agent Harness PRD]]"
  - "[[RAG Layer - Ask your Vault]]"
tags: [design, specorator, rag, semantic-search, ask-vault, vault-mcp]
---

# Semantic RAG Layer — Ask your Vault design

## Summary

Specorator's semantic RAG layer upgrades **Ask Vault** from keyword-grounded answers to hybrid semantic retrieval while keeping the user-facing promise simple: ask a question, get an answer grounded in vault notes, and see citations back to the source notes.

The feature is a transparent quality upgrade, not a new mode users must understand. Ask Vault works with keyword retrieval immediately, then automatically uses semantic + keyword retrieval when the semantic index is ready. Delegated providers receive the same retrieval capability through Vault MCP tools, so Claude, Codex, Opencode, Cursor, and the Lite answer path all depend on one plugin-owned retrieval layer.

This design complements the existing [[Specorator RAG Layer Spec]] by turning it into a product-shaped implementation boundary: Ask Vault remains the primary surface; semantic RAG is the provider-neutral substrate behind it.

## Goals

- Keep **Ask Vault** as the primary user-facing surface for vault Q&A.
- Add semantic/hybrid retrieval without making users choose retrieval modes.
- Share one retrieval implementation across Lite/Ask Vault and delegated providers.
- Preserve grounded answers with `[[note#heading]]` citations.
- Respect `.obsidian-agentignore` and RAG exclude settings before parsing, embedding, indexing, retrieval, MCP exposure, or cloud generation.
- Degrade gracefully to keyword-only retrieval when semantic indexing is unavailable, stale, or still building.
- Keep backend choices swappable behind ports so renderer, local-power, and BYOK profiles can evolve independently.

## Non-goals

- Do not build a separate RAG plugin.
- Do not make semantic search a separate user-facing mode for the default experience.
- Do not reimplement an agentic loop in the plugin.
- Do not allow Lite/Ask Vault to write notes; write intents must escalate to a full provider path.
- Do not index non-Markdown formats in this design.
- Do not claim that default remote generation is fully local; retrieved excerpts may leave the device and must be disclosed.

## Key decisions

1. **Transparent hybrid upgrade.** Ask Vault keeps the same UX. Retrieval becomes semantic/hybrid when the semantic index is ready.
2. **One provider-neutral retrieval layer.** Lite, chat, and Vault MCP tools call the same application use cases.
3. **Keyword remains the fallback.** Keyword retrieval is both the initial MVP path and the safe degradation path.
4. **Read-scope privacy is enforced at the index boundary.** Ignored notes never become chunks or vectors.
5. **Semantic readiness is profile-scoped.** Ask Vault can be usable while the semantic index is incomplete; the UI reports the active quality tier instead of blocking answers.
6. **MCP is an adapter, not a second implementation.** `semantic_search` and `ask_vault` expose the same retriever used by the UI.

## Product experience

Ask Vault should feel like a vault-native answer surface, not a search-settings panel. The normal path is:

1. User asks a question from the chat sidebar, command palette, current note, or onboarding/Lite surface.
2. Specorator retrieves relevant chunks from the vault.
3. Specorator sends only the selected chunks to the chosen generation path.
4. The answer renders with citations and a compact source list.

UI copy should expose state without jargon:

- `Vault index ready`
- `Improving search quality in the background`
- `Using keyword search until semantic indexing finishes`
- `3 folders excluded from Ask Vault`
- `This answer will send selected note excerpts to your selected model`

The user should not need to choose between keyword, vector, or hybrid retrieval during normal use. Advanced settings may expose backend profile and indexing controls, but the default experience should remain one action: **Ask Vault**.

## Architecture

Place the feature under a plugin-owned module such as `src/features/rag/`. The module should follow a hexagonal boundary so domain logic stays Obsidian-free and provider-neutral.

```text
src/features/rag/
  application/
    IndexVaultUseCase
    AskVaultUseCase
    ClearIndexUseCase
    GetRagStatusUseCase
  domain/
    VaultDocument
    RagChunk
    RetrievalResult
    RagIndexStatus
    scoring
  ports/
    VaultReader
    MarkdownParser
    Chunker
    EmbeddingProvider
    VectorStore
    KeywordIndex
    LlmAnswerProvider
    IgnoreMatcher
    RagDisclosureSink
  infrastructure/
    obsidian/
    markdown/
    keyword/
    embeddings/
    vector/
    ranking/
    prompt/
    mcp/
    settings/
    ui/
```

Provider adapters should not own indexes. Claude, Codex, Opencode, Cursor, and Lite should reach retrieval through application use cases or MCP-facing adapters. This keeps privacy, scoring, citation formatting, and fallback behavior consistent.

## Components

### Vault reader and ignore matcher

`ObsidianVaultReader` lists Markdown files through Obsidian vault APIs and enriches them with path, basename, modified time, frontmatter, tags, aliases, and links. `IgnoreMatcher` combines RAG include/exclude settings with `.obsidian-agentignore`. The ignore matcher runs before content is parsed or embedded.

### Markdown parser and chunker

The parser extracts frontmatter, heading hierarchy, body sections, wikilinks, tags, aliases, and line ranges. The chunker prefers heading-aware chunks, splits oversized sections by paragraph, avoids splitting fenced code blocks, and creates stable IDs from path, heading path, and content hash.

### Keyword index

The keyword index stores searchable text from chunk body, path, heading path, tags, and aliases. It is the fallback path and may answer while semantic indexing is unavailable.

### Embedding provider

The embedding provider is a port. The default target is the no-terminal renderer-friendly profile if feasibility checks pass. Ollama and BYOK embeddings are opt-in profiles. Embedding providers must validate vector dimensions and report clear backend errors.

### Vector store

The vector store persists embedded chunks and metadata. The default target remains renderer-friendly storage where feasible; local-power profiles may use a native desktop store. Upsert replaces chunks by ID, changed notes invalidate only their own chunks, and clear removes both vectors and metadata.

### Hybrid retriever

The retriever runs semantic and keyword searches, merges by chunk ID, normalizes scores, and applies safe boosts for current note, heading, tag, and exact path matches. It returns ranked chunks plus reasons suitable for debugging and source previews.

### Prompt and answer builder

The answer builder creates a grounded context envelope. Retrieved note text is treated as untrusted data, not instructions. The prompt requires answers to cite sources using Obsidian links and to say what is missing when the context is insufficient.

### MCP adapter

Vault MCP exposes retrieval through `semantic_search` and `ask_vault`. These tools call the same use cases as Ask Vault. Tool responses include chunk text, path, heading path, line ranges, score reasons, and citation links. MCP exposure must respect the same ignore and disclosure boundaries as the UI path.

## Data model

Use the model already sketched in [[Specorator RAG Layer Spec]] as the starting point:

- `VaultDocument`: path, content, frontmatter, tags, aliases, links, timestamps.
- `RagChunk`: path, heading path, text, line range, tags, links, hash.
- `EmbeddedChunk`: chunk plus embedding metadata.
- `RetrievalResult`: chunk plus vector, keyword, optional graph, final score, and score reasons.

Add an index status model so UI and provider adapters can distinguish states:

```ts
type RagQualityTier = "keyword" | "hybrid";

type RagIndexState =
  | "not_started"
  | "keyword_ready"
  | "semantic_indexing"
  | "hybrid_ready"
  | "degraded"
  | "error";

interface RagIndexStatus {
  state: RagIndexState;
  qualityTier: RagQualityTier;
  indexedDocuments: number;
  indexedChunks: number;
  excludedDocuments: number;
  semanticChunksReady: number;
  semanticChunksTotal: number;
  lastIndexedAt?: string;
  activeProfile: "renderer" | "ollama" | "byok";
  message: string;
}
```

## Indexing flow

1. Resolve include/exclude settings and `.obsidian-agentignore`.
2. List Markdown documents through the vault reader.
3. Skip ignored paths before reading body content where possible.
4. Parse each allowed note.
5. Chunk by heading-aware sections.
6. Update keyword index for allowed chunks.
7. Embed changed chunks for the active semantic profile.
8. Upsert embedded chunks into vector storage.
9. Delete stale chunks for changed or removed documents.
10. Publish index status and per-file error summaries.

Initial indexing may run in phases: keyword first, semantic second. This lets Ask Vault become useful quickly while semantic quality improves in the background.

Incremental indexing should be the normal update path after the first build. Chunk hashes determine whether a chunk needs re-embedding. Full rebuild remains available for recovery and backend-profile changes.

## Retrieval flow

1. Receive a question plus optional current note, selected text, path filters, or provider identity.
2. Read index status and choose active quality tier.
3. Run keyword search.
4. Run semantic search when the active profile is ready.
5. Merge results by chunk ID.
6. Normalize scores and apply safe boosts.
7. Return top chunks with source links and score reasons.
8. Build a grounded prompt/context envelope for answer generation when using Ask Vault.
9. Render answer, citations, and source previews.

When semantic search fails, the retriever falls back to keyword results and records the degraded state. The answer should still cite sources when enough keyword-grounded context exists.

## Settings and commands

User-facing controls should stay minimal:

- Ask Vault
- Ask Current Note
- Rebuild Vault Index
- Show Index Status
- Clear Vault Index
- Excluded folders / patterns
- Backend profile
- Index freshness controls

Advanced profile details belong behind progressive disclosure. The default Ask Vault surface should not ask users to understand vector stores or embedding models.

## Error handling

- Per-note parsing or embedding errors are collected and summarized without aborting the whole index.
- Backend-profile failures put semantic search into a degraded state and keep keyword retrieval available.
- Storage corruption offers a clear rebuild path.
- Missing or unsupported desktop capabilities produce plain-language messages.
- Provider answer failures do not corrupt the index.

All production logging should use the repo logger; no production `console.*` calls.

## Privacy and security

Privacy rules are hard boundaries:

- Ignored paths are not parsed, chunked, embedded, indexed, retrieved, returned over MCP, or sent to a model.
- Excluded files are counted only as excluded status, not exposed as content.
- Retrieved chunks are treated as untrusted content and must not override system or developer instructions.
- Remote generation paths disclose that selected note excerpts leave the device.
- Secret values stay in `SecretStore`; settings store only references or non-secret profile choices.

This feature reduces context rot and improves relevance, but it also creates a concentrated read path over the vault. The implementation should prefer small, auditable services and explicit tests for ignore enforcement.

## Testing strategy

### Unit tests

- Stable chunk IDs for unchanged content.
- Heading path and line range preservation.
- Frontmatter, tags, aliases, and wikilink extraction.
- Oversized section splitting without fenced-code corruption.
- `.obsidian-agentignore` and exclude-setting enforcement.
- Keyword search returns expected chunks.
- Hybrid merge deduplicates chunks and explains score reasons.
- Prompt builder emits citation-ready context and treats chunks as data.
- Semantic failure falls back to keyword retrieval.
- Index status transitions from keyword to hybrid readiness.

### Integration tests

- Mock vault indexes allowed notes and skips ignored notes.
- Ask Vault returns grounded answer inputs with source links.
- Clear index clears keyword and vector stores.
- MCP adapter returns the same retrieval results as the application use case.

### Performance tests

- Initial index over a synthetic large Markdown vault.
- Incremental update after one changed note.
- Retrieval latency with a large chunk set.

Perf assertions should check scaling windows rather than fragile wall-clock thresholds.

## Acceptance criteria

- Ask Vault works before semantic indexing completes by using keyword retrieval.
- Once semantic indexing is ready, Ask Vault uses hybrid retrieval without a new user mode.
- Source citations render as clickable Obsidian links.
- Ignored/excluded notes never appear in retrieval or generated-answer context.
- Backend failures degrade to keyword retrieval with clear status.
- `semantic_search` and `ask_vault` MCP tools call the shared retrieval layer.
- Index status communicates active quality tier and semantic readiness.
- Tests cover chunking, ignore enforcement, ranking, fallback, and citation formatting.

## Rollout shape

1. Fill the product feature surface for Ask Vault semantics.
2. Implement provider-neutral RAG domain/use cases and keyword fallback.
3. Add semantic profile behind the embedding/vector ports.
4. Wire Ask Vault to hybrid retrieval when ready.
5. Expose Vault MCP tools over the same use cases.
6. Harden privacy, disclosure, indexing status, and performance behavior.

## Risks and mitigations

- **Renderer backend reliability.** Keep backend profile swappable and degrade to keyword retrieval.
- **Large-vault indexing cost.** Use chunk hashes, incremental indexing, and perf tests.
- **Indirect prompt injection.** Treat chunks as quoted data and constrain the answer prompt.
- **Privacy regression.** Test ignore enforcement at the earliest index boundary and at MCP output.
- **Product complexity.** Keep Ask Vault as the primary surface and hide retrieval jargon from the default flow.

## Open decisions for implementation planning

- Exact renderer embedding/vector backend after feasibility verification.
- Default staleness budget for incremental indexing.
- Whether graph-aware boosts ship with the first semantic version or remain later.
- Which provider path is the first MCP integration test target.

These decisions do not change the product direction: semantic RAG is a transparent quality upgrade to Ask Vault, backed by one provider-neutral retrieval layer.
