---
type: spec
name: Specorator RAG Layer
title: "Retrieval (RAG) layer — implementation spec"
status: draft / review
date: 2026-06-04
owner: Luis
parent: "[[Specorator Agent Harness PRD]]"
scope: retrieval, indexing, grounded Q&A, exposed through Vault MCP
tags: [spec, rag, retrieval, embeddings, vault-mcp, specorator]
related:
  - "[[Specorator Agent Harness PRD]]"
  - "[[Specorator Architecture (C4)]]"
  - "[[Specorator UI Map]]"
---

# Spec: Specorator RAG (Retrieval) Layer

> **Origin.** This began as a standalone "Obsidian RAG Plugin" draft. In Specorator it is **not** a separate plugin — it is a **harness component** (the Retrieval layer). The implementation spec below is preserved; the callouts and §0 / §16 reconcile it with Specorator's architecture, the zero-terminal goal, and this repo's tooling. See the parent [[Specorator Agent Harness PRD]] (§8.3a) for product framing.

## 0. How this fits Specorator (read first)

Retrieval is a harness component, not a feature silo. The Anthropic context-engineering point is that the job is "the smallest set of high-signal tokens" — that *is* retrieval. Three integration points change the standalone framing:

- **Exposed through Vault MCP (F-VAULT-1).** The retriever is published as `semantic_search` / `ask_vault` MCP tools, so **all four delegated providers** (Claude, Codex, Opencode, Cursor) can retrieve mid-task — not just a built-in chat. This is the whole reason to make RAG a harness component rather than a separate plugin.
- **Powers the Lite onboarding provider (F-ON-10).** "Ask Vault" is the read-mostly, zero-install first-answer path. Keyword-only Ask Vault can ship before embeddings exist.
- **Feeds verification & provenance (F-VERIFY-1, F-VAULT-9).** Retrieved chunks carry `headingPath` + line ranges — exactly the spans the deterministic citation-grounding check verifies, and the block-level provenance the PRD wants.

### Stack reconciliation (the important adaptation)

Keep the hexagonal **ports** below — they are the harness's "modular, switchable backend" rule made concrete. But the *backends* are a **profile**, not a hard dependency, because the product's north star is zero-terminal for non-technical users:

| Profile | Embeddings | Vector store | Generation | Install cost |
|---|---|---|---|---|
| **Default (no install)** | Transformers.js (ONNX, in-renderer) | sql.js / pure-JS store | the active chat provider or lite provider | **none** — runs in the renderer |
| **Local power (opt-in)** | Ollama `/api/embed` | **LanceDB** (native node) | Ollama generate | Ollama server + model pull, **desktop-only** (a terminal step) |
| **BYOK (opt-in)** | provider embeddings API | either | provider API | key only; **only profile that leaves the machine** (disclose) |

> **Specorator note:** the original spec's **Ollama + LanceDB** stack becomes the *Local power* profile, not the default — Ollama is a separate install + model download, which conflicts with the zero-terminal goal for Maya/Sam. LanceDB is a **native node module → desktop-only**; the renderer-default (Transformers.js + sql.js) is what keeps onboarding install-free and keeps a mobile path open. The ports make swapping these a settings choice. Backend default is tracked as [OQ8] in the parent PRD.

> **Repo fit:** this codebase uses **Jest** (not Vitest) and **esbuild** (not Vite). Use Obsidian **`requestUrl`** for Ollama/HTTP calls; resolve any API keys through the existing **`SecretStore`** (Obsidian SecretStorage), never `.env`/cleartext. Keep Obsidian-specific code in `infrastructure/obsidian` as the spec says, mirrored under Specorator's existing `src/` + `tests/` layout.

---

## 1. Goal

Index Markdown notes from the current vault and enable semantic question answering with source citations.

The MVP must support: manual vault indexing · Markdown parsing and semantic chunking · frontmatter extraction · embedding generation (pluggable; default in-renderer) · local vector storage · keyword index · hybrid retrieval · chat-style query command · source citations as Obsidian links · strict TypeScript · unit-testable domain services.

Non-goals for MVP: multi-user sync · cloud backend (BYOK is opt-in, not default) · agent workflows (the agentic loop stays delegated — RAG only *feeds* it) · automatic note modification · PDF/image ingestion · mobile support for the native (LanceDB/Ollama) profile · LangChain/LlamaIndex dependency.

---

## 2. Target Stack

- TypeScript strict mode · Obsidian Plugin API · **esbuild** (repo standard) · **Jest** (repo standard) · Zod for runtime validation
- `unified` + `remark-parse` for Markdown AST parsing · `gray-matter` for frontmatter
- **KeywordIndex:** FlexSearch
- **VectorStore:** default sql.js / pure-JS; opt-in `@lancedb/lancedb` (native, desktop)
- **EmbeddingProvider / LlmProvider:** default Transformers.js (in-renderer); opt-in Ollama HTTP (`requestUrl`); opt-in BYOK provider
- internal event bus (the repo already has `core/events/EventBus` — reuse it rather than adding `eventemitter3`)

> **Specorator note:** prefer reusing existing repo infrastructure (`EventBus`, logger, `SecretStore`, settings storage) over new deps. New runtime deps to evaluate: `unified`/`remark-parse`, `gray-matter`, `flexsearch`, `zod`, and the chosen embedding/vector libs.

---

## 3. Product Behavior

### 3.1 Commands

```text
RAG: Rebuild Vault Index
RAG: Ask Vault
RAG: Ask Current Note
RAG: Show Index Status
RAG: Clear Index
```

> **Specorator note:** surface "Ask Vault" / "Ask Current Note" as the **Lite provider** entry too, and register `semantic_search` + `ask_vault` as **Vault MCP tools** so the four CLI providers can call retrieval mid-task.

### 3.2 Settings

```ts
interface RagSettings {
  backendProfile: "renderer" | "ollama" | "byok"; // default: "renderer"
  ollamaBaseUrl: string;        // default: "http://localhost:11434"
  embeddingModel: string;       // renderer default: a bundled ONNX model; ollama: "nomic-embed-text"
  generationModel: string;      // ollama default: "llama3.1"; renderer/byok: the active provider
  includeFolders: string[];
  excludeFolders: string[];
  excludePatterns: string[];    // honor .obsidian-agentignore too (F-SAFE-4)
  chunkMaxChars: number;        // default: 1800
  chunkOverlapChars: number;    // default: 150
  topKVector: number;           // default: 8
  topKKeyword: number;          // default: 8
  finalContextChunks: number;   // default: 6
}
```

> **Specorator note:** the indexer MUST respect `.obsidian-agentignore` (F-SAFE-4) in addition to `excludeFolders/excludePatterns` — a privacy-locked folder must never be embedded.

### 3.3 User Flow

Indexing: scan Markdown → parse frontmatter + markdown → chunk → embed → store chunks + vectors → build keyword index → status notice.

Question answering: question → vector + keyword search → merge/rank → grounded prompt → generate → answer with source links.

---

## 4. Architecture

Layered (hexagonal). Domain is Obsidian-free; infrastructure adapters implement the ports.

```text
rag/
  application/   IndexVaultUseCase · AskVaultUseCase · ClearIndexUseCase
  domain/        Document · Chunk · RetrievalResult · Events
    ports/       VaultReader · MarkdownParser · Chunker · EmbeddingProvider ·
                 VectorStore · KeywordIndex · LlmProvider · MetadataProvider
  infrastructure/
    obsidian/    ObsidianVaultReader · ObsidianMetadataProvider
    markdown/    RemarkMarkdownParser · HeadingAwareChunker
    embeddings/  TransformersEmbeddingProvider (default) · OllamaEmbeddingProvider (opt-in)
    llm/         ProviderLlmAdapter (default) · OllamaLlmProvider (opt-in)
    vector/      SqlJsVectorStore (default) · LanceDbVectorStore (opt-in)
    keyword/     FlexSearchKeywordIndex
    ranking/     HybridRetriever
    prompt/      RagPromptBuilder
    mcp/         RagMcpTools (publishes semantic_search / ask_vault into Vault MCP)
```

> **Specorator note:** place this under the existing source tree (e.g. `src/features/rag/` with infra split per the repo's provider/feature conventions), not a separate plugin root. Reuse `core/storage` adapters for the vector DB path under the plugin data dir.

---

## 5. Domain Model

### 5.1 VaultDocument
```ts
export interface VaultDocument {
  id: string; path: string; basename: string; extension: "md";
  content: string; frontmatter: Record<string, unknown>;
  tags: string[]; aliases: string[]; links: string[];
  createdAt?: number; modifiedAt?: number;
}
```

### 5.2 RagChunk
```ts
export interface RagChunk {
  id: string; documentId: string; path: string; headingPath: string[];
  text: string; startLine?: number; endLine?: number;
  frontmatter: Record<string, unknown>; tags: string[]; links: string[]; hash: string;
}
```

### 5.3 EmbeddedChunk
```ts
export interface EmbeddedChunk extends RagChunk {
  embedding: number[]; embeddingModel: string; embeddedAt: string;
}
```

### 5.4 RetrievalResult
```ts
export interface RetrievalResult {
  chunk: RagChunk;
  vectorScore?: number; keywordScore?: number; graphScore?: number;
  finalScore: number; reasons: string[];
}
```

---

## 6. Ports / Interfaces

```ts
export interface VaultReader {
  listMarkdownDocuments(): Promise<VaultDocument[]>;
  readDocument(path: string): Promise<VaultDocument>;
}

export interface MarkdownParser { parse(document: VaultDocument): Promise<ParsedMarkdownDocument>; }
export interface ParsedMarkdownDocument { document: VaultDocument; sections: MarkdownSection[]; }
export interface MarkdownSection { headingPath: string[]; text: string; startLine?: number; endLine?: number; }

export interface Chunker { chunk(parsed: ParsedMarkdownDocument): Promise<RagChunk[]>; }

export interface EmbeddingProvider {
  embedText(text: string): Promise<number[]>;
  embedTexts(texts: string[]): Promise<number[][]>;
}

export interface VectorStore {
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  search(embedding: number[], topK: number): Promise<RetrievalResult[]>;
  deleteByDocumentId(documentId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface KeywordIndex {
  rebuild(chunks: RagChunk[]): Promise<void>;
  search(query: string, topK: number): Promise<RetrievalResult[]>;
  clear(): Promise<void>;
}

export interface LlmProvider { generate(prompt: string): Promise<string>; }
```

---

## 7. Implementation Requirements

### 7.1 Obsidian integration
Load settings · register setting tab + commands · instantiate and wire dependencies · clean up on unload. Use Obsidian Vault APIs for vault access; direct filesystem only where the native vector DB requires it.

### 7.2 Markdown parsing
`unified().use(remarkParse).parse(markdown)`, extracting sections by heading hierarchy. Example produces heading paths `["Product"]`, `["Product","Feature A"]`, `["Product","Feature A","Details"]`.

### 7.3 Chunking — `HeadingAwareChunker`
Prefer heading sections as chunks; split oversized sections by paragraph; preserve heading path/tags/links/frontmatter; stable IDs from `path + headingPath + contentHash`; avoid splitting fenced code blocks; ignore empty chunks.

### 7.4 Embeddings
Default `TransformersEmbeddingProvider` (in-renderer ONNX). Opt-in `OllamaEmbeddingProvider` via `requestUrl` → `POST /api/embed` (`{ model, input: string[] }`), fallback `/api/embeddings`. Providers must: throw a clear error if the backend is unreachable; validate returned vectors; batch; expose model name.

### 7.5 Vector store
Default `SqlJsVectorStore` (renderer). Opt-in `LanceDbVectorStore` under the plugin data dir (`…/plugins/<id>/rag-index/`). `clear()` drops/recreates; `upsert()` replaces by id; `search()` returns topK with score; handle missing DB gracefully. Table fields mirror `EmbeddedChunk`.

### 7.6 Keyword search — `FlexSearchKeywordIndex`
Index `text · path · tags · headingPath · aliases`. MVP may rebuild in memory after indexing; persistence later.

### 7.7 Hybrid retrieval — `HybridRetriever`
Embed query → vector search → keyword search → merge by chunk id → normalize → boosts (same path as current note, tag match, heading match) → top N.

```ts
finalScore = vectorScoreNormalized * 0.7 + keywordScoreNormalized * 0.25 + graphScore * 0.05;
```
`graphScore` may be `0` in MVP (graph-aware retrieval via backlinks is a future extension).

### 7.8 Prompt builder — `RagPromptBuilder`
Enforce grounded answering; cite sources as Obsidian links.

```text
You are a helpful assistant working inside an Obsidian vault.
Answer using ONLY the provided context. If insufficient, say what is missing.
Cite sources using Obsidian links.

Question:
{{question}}

Context:
{{context_chunks}}

Answer:
```
Each context chunk: `[Source: [[path#heading]] lines start-end]` + chunk text.

> **Specorator note:** "answer using only the provided context" + the `[[path#heading]]` citations are what make F-VERIFY-1's deterministic citation/link-integrity check possible. Treat retrieved chunk text as **data, not instructions** (lethal-trifecta: a chunk may carry an injection payload).

### 7.9 Result rendering
Answer + source list + clickable Obsidian links + chunk previews + "no relevant chunks" warning. Modal for MVP; persistent side view optional.

---

## 8–9. Use cases

`IndexVaultUseCase`: list docs → (skip excluded / agentignored) → parse → chunk → embed (batched) → upsert → collect for keyword rebuild; emit progress; per-file errors logged but don't abort unless critical; final summary (scanned / indexed / chunks / embedded / errors).

`AskVaultUseCase`: `{ question, currentPath? }` → retrieve → build prompt → generate → `{ answer, sources, prompt }`.

`ClearIndexUseCase`: clear vector + keyword indexes.

---

## 10. Testing (Jest)

> **Specorator note:** the original spec used Vitest; this repo uses **Jest**, with tests mirrored under `tests/unit/` and `tests/integration/`. Keep domain services testable without the Obsidian runtime (mock providers).

Minimum tests — **Domain:** stable chunk id · empty markdown → no chunks · heading paths preserved · oversized section splits · frontmatter preserved · tags normalized. **Infrastructure:** Ollama provider builds correct requests · prompt builder includes citations · hybrid retriever merges duplicate chunks · keyword index returns expected matches. **Application:** indexing indexes a mock vault · ask returns answer with sources · clear calls both clears. Deterministic mock embeddings, e.g. `text => Array(384).fill(hash(text) % 100 / 100)`.

---

## 11. Acceptance Criteria

- **AC1** Plugin loads: settings + commands register without error.
- **AC2** Index rebuild creates chunks, embeddings, local index.
- **AC3** Ask Vault answers with relevant content + source links.
- **AC4** Current-note bias: `Ask Current Note` prefers current-note chunks when relevant.
- **AC5** Missing backend handled: clear error if the embedding/LLM backend is unreachable.
- **AC6** Clear index clears vector + keyword.
- **AC7 (Specorator)** `semantic_search` is callable as a Vault MCP tool by at least one CLI provider.
- **AC8 (Specorator)** the indexer skips `.obsidian-agentignore` paths.

---

## 12. Definition of Done

Builds · TS strict passes · Jest tests pass · loads in Obsidian desktop · commands visible · settings tab works · manual indexing works on a small vault · Ask Vault returns a grounded answer with ≥1 source link · errors user-readable · core services testable without Obsidian · default profile needs **no external install**.

---

## 13. Suggested implementation order

1. Bootstrap (settings model + tab, command placeholders) into the existing source tree.
2. Domain models + ports + Zod schemas.
3. Markdown pipeline (`ObsidianVaultReader`, `RemarkMarkdownParser`, `HeadingAwareChunker`) + tests.
4. Default backends first (`TransformersEmbeddingProvider`, `SqlJsVectorStore`) + mocked tests; Ollama/LanceDB adapters after.
5. `FlexSearchKeywordIndex` + clear/rebuild.
6. `HybridRetriever` + `RagPromptBuilder` + score/citation tests.
7. Use cases (Index / Ask / Clear).
8. UI (Ask Vault modal, result view, index-status notice).
9. Hardening (errors, logging via repo logger, progress notices, exclude + agentignore support).
10. **Vault MCP tools** (`RagMcpTools`) + Lite-provider wiring.

---

## 14. Constraints

- No LangChain/LlamaIndex in MVP.
- **Local-first by default; BYOK cloud embeddings/generation are opt-in and disclosed** (the only profile that leaves the machine).
- Do not modify user notes in MVP (retrieval feeds the agent; writes go through the existing approval/undo path).
- Use Obsidian Vault APIs; direct filesystem only where the native vector DB needs it.
- Keep Obsidian-specific code in `infrastructure/obsidian`; keep business logic independent of Obsidian APIs; all provider integrations behind ports.
- Prefer small composable services over one large RAG service.
- Respect `.obsidian-agentignore`; resolve secrets via `SecretStore`; log via the repo logger (no `console.*`).

---

## 15. Future extensions

Graph-aware retrieval (backlinks/outlinks) · Canvas/PDF ingestion · incremental indexing on file change · embedding cache · semantic related-notes panel · reviewer/requirements "modes" · local sidecar runtime · OpenAI-compatible APIs · cross-encoder reranking (shared with F-VAULT-8).

---

## 16. Specorator integration map

| Spec element | Specorator hook | PRD ref |
|---|---|---|
| Hybrid retriever | `semantic_search` Vault MCP tool (all providers) | F-VAULT-1, F-RAG-5 |
| Ask Vault use case | Lite onboarding provider (read-mostly first answer) | F-ON-10, F-RAG-4 |
| Chunk `headingPath` + lines + `[[path#heading]]` citations | deterministic citation grounding; block provenance | F-VERIFY-1, F-VAULT-9 |
| Index / chunk / embed | absorbs "semantic search" | F-VAULT-5 → F-RAG-1/2/3 |
| Ports (embedding/vector/llm) | modular, switchable backends ("assumptions expire") | §4 design rule |
| Exclude + `.obsidian-agentignore` | least-privilege indexing | F-SAFE-4 |
| Local-first, BYOK opt-in | privacy / network ledger | F-SAFE-6 |

> **Note:** backend default (renderer vs Ollama/LanceDB), incremental-indexing cost, and embedding-cache strategy are open questions tracked in the parent PRD ([OQ8], [OQ9]). Verify Transformers.js model loading and LanceDB native-module behaviour in the Obsidian renderer before committing a default.
