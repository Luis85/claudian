/**
 * Provider-neutral extraction + bookkeeping for "files the agent changed".
 *
 * A completed Write/Edit/NotebookEdit (Claude/Opencode/Cursor) or apply_patch
 * (Codex) names the file(s) the agent created, edited, renamed, or deleted. The
 * chat tab surfaces created/edited files as a clickable list above the composer;
 * this module owns the pure path extraction and the dedupe/order rules, so the
 * live streaming hook and the history-derived rebuild produce an identical list.
 */
import type { App } from 'obsidian';

import { getPathFromToolInput } from '../../../core/tools/toolInput';
import { isEditTool, TOOL_APPLY_PATCH, TOOL_WRITE } from '../../../core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import { toVaultRelativeOpenPath } from '../../../utils/fileLink';

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

/** Cursor's standalone file-delete tool (see `cursorToolNameMap`). */
const TOOL_DELETE = 'delete';

/** The add/edit targets and the removals (deletes + vacated rename sources) of a patch. */
interface ApplyPatchOps {
  added: RawEditedPath[];
  removed: string[];
}

/**
 * Paths a completed file-mutating tool created or edited — the chip targets.
 * Renames resolve to the destination; deletions are excluded. Returns raw paths;
 * the caller resolves them against the vault.
 */
export function collectEditedPathsFromToolCall(toolCall: ToolCallInfo): RawEditedPath[] {
  if (toolCall.name === TOOL_APPLY_PATCH) {
    return parseApplyPatch(toolCall.input).added;
  }

  if (isEditTool(toolCall.name)) {
    const path = getPathFromToolInput(toolCall.name, toolCall.input) ?? toolCall.diffData?.filePath ?? null;
    return path ? [{ path, changeKind: resolveEditToolKind(toolCall) }] : [];
  }

  return [];
}

/**
 * Paths a completed tool removed from their original location — apply_patch
 * deletes + vacated rename sources, and Cursor's standalone `delete` tool — so
 * the live list can drop stale chips for files that no longer exist. Raw paths.
 */
export function collectRemovedPathsFromToolCall(toolCall: ToolCallInfo): string[] {
  if (toolCall.name === TOOL_APPLY_PATCH) {
    return parseApplyPatch(toolCall.input).removed;
  }
  if (toolCall.name === TOOL_DELETE) {
    const path = firstStringField(toolCall.input, ['path', 'file_path']);
    return path ? [path] : [];
  }
  return [];
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

function parseApplyPatch(input: Record<string, unknown>): ApplyPatchOps {
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const fromText = parseApplyPatchMarkers(patchText);
  // Legacy structured-array shape (some Codex transports emit `changes[]`).
  const fromChanges = parseApplyPatchChanges(input.changes);
  return {
    added: [...fromText.added, ...fromChanges.added],
    removed: [...fromText.removed, ...fromChanges.removed],
  };
}

function parseApplyPatchMarkers(patchText: string): ApplyPatchOps {
  const added: RawEditedPath[] = [];
  const removed: string[] = [];
  let pending: RawEditedPath | null = null;

  for (const match of patchText.matchAll(APPLY_PATCH_MARKER)) {
    const value = match[2]?.trim();
    if (!value) continue;
    pending = applyPatchMarker(match[1], value, pending, added, removed);
  }

  if (pending) added.push(pending);
  return { added, removed };
}

/**
 * Folds one patch marker into the running parse. Returns the still-open entry
 * (an Add/Update awaiting a possible `Move to`), pushing completed entries into
 * `added` and vacated sources/deletes into `removed`.
 */
function applyPatchMarker(
  marker: string,
  value: string,
  pending: RawEditedPath | null,
  added: RawEditedPath[],
  removed: string[],
): RawEditedPath | null {
  if (marker === 'Move to') {
    // `Update File: old` then `Move to: new`: the source is vacated; the
    // destination is the file to show.
    if (pending) {
      removed.push(pending.path);
      pending.path = value;
    }
    return pending;
  }

  if (pending) added.push(pending);
  if (marker === 'Delete File') {
    removed.push(value);
    return null;
  }
  return { path: value, changeKind: marker === 'Add File' ? 'created' : 'edited' };
}

function parseApplyPatchChanges(changes: unknown): ApplyPatchOps {
  const added: RawEditedPath[] = [];
  const removed: string[] = [];
  if (!Array.isArray(changes)) return { added, removed };

  for (const change of changes) {
    const op = classifyApplyPatchChange(change);
    if (!op) continue;
    if (op.added) added.push(op.added);
    if (op.removed) removed.push(op.removed);
  }

  return { added, removed };
}

/**
 * Classifies one structured apply_patch change: deletes become a removal, renames
 * add the destination and remove the vacated source, and adds/updates add the path.
 */
function classifyApplyPatchChange(change: unknown): { added?: RawEditedPath; removed?: string } | null {
  if (!isPlainObject(change)) return null;

  const operation = (firstStringField(change, ['kind', 'type']) ?? '').toLowerCase();
  const source = firstStringField(change, ['path']);
  if (isDeleteOperation(operation)) {
    return source ? { removed: source } : null;
  }

  const dest = firstStringField(change, ['new_path', 'newPath', 'movePath']);
  const path = dest ?? source;
  if (!path) return null;

  return {
    added: { path, changeKind: isCreateOperation(operation) ? 'created' : 'edited' },
    removed: renameSource(source, dest),
  };
}

/** The vacated source of a rename, or undefined when the change isn't a move. */
function renameSource(source: string | null, dest: string | null): string | undefined {
  return dest && source && dest !== source ? source : undefined;
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
 * Rebuilds the edited-files list from a conversation transcript by replaying each
 * completed tool's adds then removals (deletes + rename sources), in order. Uses
 * the same in-vault-but-existence-agnostic resolver as live recording, so a
 * just-created file whose vault discovery is still in flight is kept (not dropped),
 * a created-then-deleted/renamed file nets out, and out-of-vault paths are rejected
 * (no junk-prefix recovery). Ordered most-recent first.
 */
export function deriveEditedFilesFromMessages(app: App, messages: readonly ChatMessage[]): EditedFileEntry[] {
  let list: EditedFileEntry[] = [];
  for (const message of messages) {
    if (message.toolCalls) {
      list = applyToolCallsToList(app, message.toolCalls, list);
    }
  }
  return list;
}

/**
 * Replays a tool-call list onto the edited-files list, recursing into sub-agent
 * tool calls regardless of the parent's status (a sub-agent can succeed under a
 * parent Agent tool that later errors). The parent's own effects apply only when
 * it completed.
 */
function applyToolCallsToList(
  app: App,
  toolCalls: readonly ToolCallInfo[],
  list: EditedFileEntry[],
): EditedFileEntry[] {
  let next = list;
  for (const toolCall of toolCalls) {
    if (toolCall.status === 'completed') {
      next = applyToolCallEffects(app, toolCall, next);
    }
    const nested = toolCall.subagent?.toolCalls;
    if (nested && nested.length > 0) {
      next = applyToolCallsToList(app, nested, next);
    }
  }
  return next;
}

/** Applies one completed tool's adds (created/edited) then removals to the list. */
function applyToolCallEffects(
  app: App,
  toolCall: ToolCallInfo,
  list: EditedFileEntry[],
): EditedFileEntry[] {
  let next = list;
  for (const raw of collectEditedPathsFromToolCall(toolCall)) {
    const openable = toVaultRelativeOpenPath(app, raw.path);
    if (openable) next = mergeEditedFileEntry(next, { path: openable, changeKind: raw.changeKind });
  }
  for (const removed of collectRemovedPathsFromToolCall(toolCall)) {
    const openable = toVaultRelativeOpenPath(app, removed);
    if (openable) next = next.filter((entry) => entry.path !== openable);
  }
  return next;
}
