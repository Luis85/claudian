---
type: issue
id: issue-20260603-normalizepath-coverage
title: Ensure normalizePath() coverage on every user/agent-constructed vault path
status: done
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-03
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (OBS-C)"
scope: obsidian-compliance
tags:
  - obsidian-compliance
  - paths
---

# normalizePath() coverage

## Problem

Obsidian submission requirements explicitly flag missing `normalizePath()` on user/agent-constructed paths.
With agents writing vault files, every plugin-side vault path built from user/agent input should pass
through `normalizePath()`.

## Proposed change

Audit vault path construction (note writes, context attachment, work-order/ledger writes, MCP config paths)
and apply `normalizePath()` where missing.

## Acceptance criteria

- User/agent-constructed vault paths are normalized; an audit (or lint rule) documents coverage.

## Audit results (2026-06-06)

Scope: `normalizePath()` applies only to VAULT-RELATIVE paths built from
user/agent/dynamic input and handed to an Obsidian vault API
(`app.vault.*`, `app.fileManager.*`, `VaultFileAdapter` reads/writes,
`getAbstractFileByPath`). Absolute non-vault filesystem paths
(`~/.claude`, `~/.codex`, `os.tmpdir()`, CLI resolution, `HomeFileAdapter`'s
Node `fs` paths) are deliberately left untouched — `normalizePath()` would
corrupt them.

| Site | Verdict | Action |
|------|---------|--------|
| `RunSidecarStore.runDir` (ledger/heartbeat) | already-normalized | none |
| `TemplateNoteStore.getFilePathForName` / `save` | already-normalized | none |
| `installPresetTemplates` (settings folder) | already-normalized | none |
| `taskCommands` (work-order/archive/example writes) | already-normalized | none |
| `WorkOrderContextMenu` / `AgentBoardView` (`task.path`) | static-safe (vault-enumerated) | none |
| `AgentVaultStorage.resolvePath` (Claude agents) | needs-normalize | wrapped constructed path |
| `SlashCommandStorage.getFilePath` (Claude commands) | needs-normalize | wrapped constructed path |
| `SkillStorage.save`/`delete` (Claude skills) | needs-normalize | wrapped constructed paths |
| `CodexSubagentStorage.resolveCurrentPath`/`resolveTargetPath` | needs-normalize | wrapped constructed paths |
| `CodexSkillStorage.buildLocationPaths` | needs-normalize | wrapped `dirPath`/`filePath` |
| `OpencodeAgentStorage.resolveCurrentPath`/`resolveTargetPath` | needs-normalize | wrapped constructed paths |
| `QuickActionStorage.getFilePathForName` | already-normalized | none |
| `QuickActionStorage.save` (`ensureFolder(folder)`) | needs-normalize | wrapped folder before mkdir |
| `FileContextManager.normalizePathForVault` | already-normalized (util) | none |
| `persistPastedImages` (`getAvailablePathForAttachment` → `createBinary`) | already-normalized (API returns vault-normalized path) | none |
| `McpStorage` (`.claude/mcp.json`) | static-safe (constant path) | none |
| `HomeFileAdapter` (`~/.codex`, `~/.claude` via Node `fs`) | out-of-scope-absolute | none |
| `CodexImage` temp dir (`os.tmpdir()`) | out-of-scope-absolute | none |

Coverage is asserted by `tests/unit/providers/codex/storage/CodexSkillStorage.test.ts`
("normalizes the vault path before writing"), which spies the adapter and
verifies a name carrying `//` / `\\` reaches the adapter normalized. The shared
`obsidian` test mock now provides a faithful `normalizePath` so every storage
save/delete path is exercised under test.
