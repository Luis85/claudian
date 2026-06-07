---
type: feature
name: RAG Layer - Ask your Vault
title: RAG Layer — Ask your Vault
status: planned
scope: product feature overview
parent: "[[Specorator - Product Vision]]"
related:
  - "[[Specorator RAG Layer Spec]]"
  - "[[2026-06-07-semantic-rag-layer-design]]"
  - "[[Specorator Agent Harness PRD]]"
tags: [feature, specorator, rag, ask-vault, semantic-search]
date: 2026-06-07
---

# RAG Layer — Ask your Vault

Ask Vault lets Specorator answer questions from the notes already in your Obsidian vault, with citations back to the notes it used.

Instead of treating your vault like a plain folder of files, Specorator builds a local retrieval layer over Markdown notes, headings, tags, frontmatter, aliases, and wikilinks. When you ask a question, it finds the smallest useful set of note excerpts, sends those excerpts to the selected answer path, and shows the answer with clickable `[[note#heading]]` sources.

## What it solves

- You half-remember writing something, but not where.
- You want a synthesis across notes without manually gathering context.
- You need citations back to real notes, not a free-form answer.
- You want every provider to understand the same vault context.
- You need private folders to stay out of AI retrieval entirely.

## User promise

Ask a question in plain language. Specorator searches your vault, answers from the relevant notes, and cites the sources.

If the semantic index is ready, Ask Vault uses hybrid retrieval: meaning, keywords, headings, tags, and current-note context. If semantic indexing is still building or unavailable, Ask Vault still works with keyword retrieval and tells you the current quality tier.

## Core behaviors

- **Ask Vault:** answer from the whole allowed vault.
- **Ask Current Note:** bias retrieval toward the active note and its headings.
- **Cited answers:** show `[[note#heading]]` links and source previews.
- **Transparent semantic upgrade:** no separate mode required; semantic retrieval improves Ask Vault when ready.
- **Ignore-aware indexing:** excluded folders and `.obsidian-agentignore` content never enter retrieval.
- **Provider-neutral retrieval:** the same retrieval layer can serve Lite, Claude, Codex, Opencode, Cursor, and Vault MCP tools.
- **Graceful fallback:** keyword search remains available when semantic search is unavailable.

## What users see

The UI should describe state in product terms, not implementation jargon:

- `Vault index ready`
- `Improving search quality in the background`
- `Using keyword search until semantic indexing finishes`
- `Some folders are excluded from Ask Vault`
- `This answer will send selected note excerpts to your selected model`

Advanced users can configure backend profiles and index settings, but the default interaction remains simple: **Ask Vault**.

## Privacy and trust

Ask Vault must respect the user's read boundaries before any AI step happens. Ignored files are not parsed, indexed, embedded, retrieved, exposed over MCP, or sent to a model.

When an answer path sends note excerpts to a remote provider, Specorator should say so before the request. Fully local profiles can be offered as opt-in power-user paths, but the product should not imply remote generation is local.

## Relationship to the harness roadmap

The RAG layer is one of the main ways Specorator becomes a vault-native harness. It supports:

- Lite onboarding answers with citations.
- Semantic search for delegated provider agents.
- Vault MCP tools such as `semantic_search` and `ask_vault`.
- Future context management, memory, provenance, and verification features.

The product surface is Ask Vault. The technical substrate is a provider-neutral retrieval layer shared by every answer path.

## Success criteria

- A user can ask a vault question and receive a cited answer.
- The answer uses the same Ask Vault surface whether retrieval is keyword-only or semantic/hybrid.
- Excluded notes never appear in answer context or source previews.
- Semantic indexing improves answer relevance without adding a new user decision.
- Delegated providers can use the same retrieval layer through Vault MCP tools.
