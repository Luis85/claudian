/**
 * Provider-neutral extraction + bookkeeping for "files the agent changed".
 *
 * A completed Write/Edit/NotebookEdit (Claude/Opencode/Cursor) or apply_patch
 * (Codex) names the file(s) the agent created or edited. The chat tab surfaces
 * those as a clickable list above the composer; this module owns the pure path
 * extraction and the dedupe/order rules, so both the live streaming hook and the
 * history-derived rebuild produce an identical list.
 */
import type { App } from 'obsidian';

import { getPathFromToolInput } from '../../../core/tools/toolInput';
import { isEditTool, TOOL_APPLY_PATCH, TOOL_WRITE } from '../../../core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import { resolveOpenableVaultPath } from '../../../utils/fileLink';

export type EditedFileChangeKind = 'created' | 'edited';

/** A file the agent changed, with an openable vault-relative path. */
export interface EditedFileEntry {
  /** Vault-relative path that resolves to an openable file (resolved at record time). */
  path: string;
  changeKind: EditedFileChangeKind;
}

/** A raw (unresolved) path + change kind pulled from a completed tool call. */
export interface RawEditedPath {
  path: string;
  changeKind: EditedFileChangeKind;
}

/** Matches the per-file action markers in a Codex apply_patch patch body. */
const APPLY_PATCH_MARKER = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/gm;

/**
 * Pulls the created/edited file path(s) out of a completed file-mutating tool
 * call. Deletions are intentionally dropped (the list is "files you can open").
 * Returns raw paths — the caller resolves them against the vault.
 */
export function collectEditedPathsFromToolCall(toolCall: ToolCallInfo): RawEditedPath[] {
  if (toolCall.name === TOOL_APPLY_PATCH) {
    return collectApplyPatchPaths(toolCall.input);
  }

  if (isEditTool(toolCall.name)) {
    const path = getPathFromToolInput(toolCall.name, toolCall.input) ?? toolCall.diffData?.filePath ?? null;
    if (!path) return [];
    return [{ path, changeKind: resolveEditToolKind(toolCall) }];
  }

  return [];
}

/**
 * Paths a completed apply_patch removed (patch-text `*** Delete File:` markers or
 * structured `changes[]` deletes). The live list uses these to drop a stale chip
 * for a file that was created/edited earlier in the conversation and then deleted.
 * Returns raw paths — the caller normalizes them against the vault.
 */
export function collectDeletedPathsFromToolCall(toolCall: ToolCallInfo): string[] {
  if (toolCall.name !== TOOL_APPLY_PATCH) return [];
  const patchText = typeof toolCall.input.patch === 'string' ? toolCall.input.patch : '';
  return [
    ...collectPatchTextDeletes(patchText),
    ...collectStructuredDeletes(toolCall.input.changes),
  ];
}

function collectPatchTextDeletes(patchText: string): string[] {
  const out: string[] = [];
  for (const match of patchText.matchAll(APPLY_PATCH_MARKER)) {
    if (match[1] !== 'Delete File') continue;
    const path = match[2]?.trim();
    if (path) out.push(path);
  }
  return out;
}

function collectStructuredDeletes(changes: unknown): string[] {
  if (!Array.isArray(changes)) return [];
  const out: string[] = [];
  for (const change of changes) {
    if (!isPlainObject(change)) continue;
    const operation = (firstStringField(change, ['kind', 'type']) ?? '').toLowerCase();
    if (!isDeleteOperation(operation)) continue;
    const path = firstStringField(change, ['path']);
    if (path) out.push(path);
  }
  return out;
}

/**
 * Write authors a whole file: a brand-new file (no lines removed) reads as
 * "created", while overwriting existing content reads as "edited". Edit and
 * NotebookEdit always modify an existing file.
 */
function resolveEditToolKind(toolCall: ToolCallInfo): EditedFileChangeKind {
  if (toolCall.name !== TOOL_WRITE) return 'edited';
  const removed = toolCall.diffData?.stats.removed ?? 0;
  return removed > 0 ? 'edited' : 'created';
}

function collectApplyPatchPaths(input: Record<string, unknown>): RawEditedPath[] {
  return [
    ...collectApplyPatchMarkerPaths(typeof input.patch === 'string' ? input.patch : ''),
    // Legacy structured-array shape (some Codex transports emit `changes[]`).
    ...collectApplyPatchChangesPaths(input.changes),
  ];
}

function collectApplyPatchMarkerPaths(patchText: string): RawEditedPath[] {
  const out: RawEditedPath[] = [];
  let pending: RawEditedPath | null = null;
  for (const match of patchText.matchAll(APPLY_PATCH_MARKER)) {
    const marker = match[1];
    const value = match[2]?.trim();
    if (!value) continue;
    // A rename emits `*** Update File: old` then `*** Move to: new`; record the
    // destination rather than the (now removed) source path.
    if (marker === 'Move to') {
      if (pending) pending.path = value;
      continue;
    }
    if (pending) out.push(pending);
    pending = markerToEntry(marker, value);
  }
  if (pending) out.push(pending);
  return out;
}

function markerToEntry(marker: string, path: string): RawEditedPath | null {
  if (marker === 'Delete File') return null;
  return { path, changeKind: marker === 'Add File' ? 'created' : 'edited' };
}

function collectApplyPatchChangesPaths(changes: unknown): RawEditedPath[] {
  if (!Array.isArray(changes)) return [];
  const out: RawEditedPath[] = [];
  for (const change of changes) {
    const entry = readApplyPatchChange(change);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Reads one structured apply_patch change entry, honoring its operation: deletes
 * are dropped (the list is "files you can open"), renames prefer the destination
 * path over the source, and adds map to created.
 */
function readApplyPatchChange(change: unknown): RawEditedPath | null {
  if (!isPlainObject(change)) return null;

  const operation = (firstStringField(change, ['kind', 'type']) ?? '').toLowerCase();
  if (isDeleteOperation(operation)) return null;

  const path = firstStringField(change, ['new_path', 'newPath', 'movePath', 'path']);
  if (!path) return null;

  return { path, changeKind: isCreateOperation(operation) ? 'created' : 'edited' };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDeleteOperation(operation: string): boolean {
  return operation.includes('delete') || operation.includes('remove');
}

function isCreateOperation(operation: string): boolean {
  return operation.startsWith('add') || operation.startsWith('create');
}

function firstStringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Folds an entry into the list: deduped by path, most-recently-changed first,
 * and "created" is sticky (a file created this conversation stays "created" even
 * after later edits).
 */
export function mergeEditedFileEntry(
  list: readonly EditedFileEntry[],
  entry: EditedFileEntry,
): EditedFileEntry[] {
  const existing = list.find((e) => e.path === entry.path);
  const changeKind: EditedFileChangeKind =
    existing?.changeKind === 'created' ? 'created' : entry.changeKind;
  return [{ path: entry.path, changeKind }, ...list.filter((e) => e.path !== entry.path)];
}

/**
 * Rebuilds the edited-files list from a conversation transcript. Only completed
 * top-level tool calls that resolve to an openable vault file are included, so
 * deleted or out-of-vault paths drop out naturally. Ordered most-recent first.
 */
export function deriveEditedFilesFromMessages(app: App, messages: readonly ChatMessage[]): EditedFileEntry[] {
  let list: EditedFileEntry[] = [];
  for (const message of messages) {
    const toolCalls = message.toolCalls;
    if (!toolCalls) continue;
    for (const toolCall of toolCalls) {
      if (toolCall.status !== 'completed') continue;
      for (const raw of collectEditedPathsFromToolCall(toolCall)) {
        const openable = resolveOpenableVaultPath(app, raw.path);
        if (!openable) continue;
        list = mergeEditedFileEntry(list, { path: openable, changeKind: raw.changeKind });
      }
    }
  }
  return list;
}
