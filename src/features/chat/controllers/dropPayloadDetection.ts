/**
 * Specorator - Drop payload detection for chat drag-and-drop.
 *
 * Pure function. Given a DataTransfer-like object and the Obsidian app
 * dragManager, classify the drop into Obsidian-internal vault items, OS image
 * files, OS non-image files, and OS folders. Caller is responsible for the
 * vault-vs-external classification of OS paths (see classifyOsPath).
 */

import type { TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

export interface DroppedPayload {
  vaultFiles: TFile[];
  vaultFolders: TFolder[];
  osImageFiles: File[];
  osFiles: File[];
  osFolders: { path: string }[];
  unknown: number;
}

export interface DragManagerLike {
  draggable?: ObsidianDraggable | null;
}

export interface ObsidianDraggable {
  type: 'file' | 'files' | 'folder';
  file?: TAbstractFile;
  files?: TAbstractFile[];
}

export interface DataTransferLike {
  types: readonly string[];
  files: ArrayLike<File>;
  items?: ArrayLike<DataTransferItemLike>;
}

export interface DataTransferItemLike {
  kind: string;
  type: string;
  webkitGetAsEntry?: () => { isDirectory: boolean; isFile: boolean } | null;
  getAsFile?: () => File | null;
}

export function detectPayload(
  dataTransfer: DataTransferLike,
  dragManager: DragManagerLike | null
): DroppedPayload {
  const payload: DroppedPayload = {
    vaultFiles: [],
    vaultFolders: [],
    osImageFiles: [],
    osFiles: [],
    osFolders: [],
    unknown: 0,
  };

  const internal = consumeInternalDrag(dragManager);
  if (internal.consumed) {
    payload.vaultFiles.push(...internal.files);
    payload.vaultFolders.push(...internal.folders);
    return payload;
  }

  if (!Array.from(dataTransfer.types).includes('Files')) {
    return payload;
  }

  const directoryPaths = collectDirectoryPaths(dataTransfer.items);

  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    const filePath = getFilePath(file);

    if (filePath && directoryPaths.has(filePath)) {
      payload.osFolders.push({ path: filePath });
      continue;
    }

    if (file.type.startsWith('image/')) {
      payload.osImageFiles.push(file);
      continue;
    }

    payload.osFiles.push(file);
  }

  return payload;
}

function consumeInternalDrag(dragManager: DragManagerLike | null): {
  consumed: boolean;
  files: TFile[];
  folders: TFolder[];
} {
  const draggable = dragManager?.draggable;
  if (!draggable) return { consumed: false, files: [], folders: [] };

  const files: TFile[] = [];
  const folders: TFolder[] = [];

  if (draggable.type === 'file' && draggable.file instanceof TFile) {
    files.push(draggable.file);
  } else if (draggable.type === 'folder' && draggable.file instanceof TFolder) {
    folders.push(draggable.file);
  } else if (draggable.type === 'files' && Array.isArray(draggable.files)) {
    for (const item of draggable.files) {
      if (item instanceof TFile) files.push(item);
      else if (item instanceof TFolder) folders.push(item);
    }
  }

  if (files.length === 0 && folders.length === 0) {
    return { consumed: false, files: [], folders: [] };
  }
  return { consumed: true, files, folders };
}

function collectDirectoryPaths(
  items: ArrayLike<DataTransferItemLike> | undefined
): Set<string> {
  const paths = new Set<string>();
  if (!items) return paths;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file' || !item.webkitGetAsEntry) continue;
    const entry = item.webkitGetAsEntry();
    if (!entry?.isDirectory) continue;
    const file = item.getAsFile?.();
    const filePath = file ? getFilePath(file) : null;
    if (filePath) paths.add(filePath);
  }
  return paths;
}

export function getFilePath(file: File): string | null {
  const electronPath = (file as unknown as { path?: string }).path;
  return typeof electronPath === 'string' && electronPath.length > 0 ? electronPath : null;
}
