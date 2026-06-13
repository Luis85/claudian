import type { TFile } from 'obsidian';

import type { ExternalContextDisplayEntry } from '../../utils/externalContext';
import { type ExternalContextFile, externalContextScanner } from '../../utils/externalContextScanner';
import {
  type AgentMentionItem,
  type ContextFileMentionItem,
  type ContextFolderMentionItem,
  type FolderMentionItem,
  type McpServerMentionItem,
  type MentionItem,
} from './types';

export interface ActiveContextFilter {
  folderName: string;
  contextRoot: string;
}

interface AgentSearchResult {
  id: string;
  name: string;
  description?: string;
  source: AgentMentionItem['source'];
}

export function buildAgentItems(agents: AgentSearchResult[]): AgentMentionItem[] {
  return agents.map(agent => ({
    type: 'agent',
    id: agent.id,
    name: agent.name,
    description: agent.description,
    source: agent.source,
  }));
}

/**
 * Resolve the longest external-context prefix matching a slash search. Returns
 * the active filter (or null) plus the file-search text (the portion after the
 * matched `folder/` prefix, or the full lowercased search when nothing matches).
 */
export function resolveContextFilter(
  searchText: string,
  searchLower: string,
  contextEntries: ExternalContextDisplayEntry[],
): { filter: ActiveContextFilter | null; fileSearchText: string } {
  const matchingContext = contextEntries
    .filter(entry => searchLower.startsWith(`${entry.displayNameLower}/`))
    .sort((a, b) => b.displayNameLower.length - a.displayNameLower.length)[0];

  if (!matchingContext) {
    return { filter: null, fileSearchText: searchLower };
  }

  const prefixLength = matchingContext.displayName.length + 1;
  return {
    filter: {
      folderName: matchingContext.displayName,
      contextRoot: matchingContext.contextRoot,
    },
    fileSearchText: searchText.substring(prefixLength).toLowerCase(),
  };
}

export function scanContextFiles(
  contextRoot: string,
  fileSearchText: string,
): ExternalContextFile[] {
  return externalContextScanner
    .scanPaths([contextRoot])
    .filter(file => {
      const pathLower = file.relativePath.replace(/\\/g, '/').toLowerCase();
      return pathLower.includes(fileSearchText) || file.name.toLowerCase().includes(fileSearchText);
    })
    .sort((a, b) => {
      const aNameMatch = a.name.toLowerCase().startsWith(fileSearchText);
      const bNameMatch = b.name.toLowerCase().startsWith(fileSearchText);
      if (aNameMatch !== bNameMatch) return aNameMatch ? -1 : 1;
      return b.mtime - a.mtime;
    });
}

export function buildContextFileItems(
  files: ExternalContextFile[],
  folderName: string,
): ContextFileMentionItem[] {
  return files.map(file => ({
    type: 'context-file',
    name: file.relativePath.replace(/\\/g, '/'),
    absolutePath: file.path,
    contextRoot: file.contextRoot,
    folderName,
  }));
}

export function buildMcpServerItems(
  servers: Array<{ name: string }>,
  searchLower: string,
): McpServerMentionItem[] {
  return servers
    .filter(server => server.name.toLowerCase().includes(searchLower))
    .map(server => ({ type: 'mcp-server', name: server.name }));
}

export function buildContextFolderItems(
  contextEntries: ExternalContextDisplayEntry[],
  searchLower: string,
): ContextFolderMentionItem[] {
  const seen = new Set<string>();
  const items: ContextFolderMentionItem[] = [];
  for (const entry of contextEntries) {
    if (entry.displayNameLower.includes(searchLower) && !seen.has(entry.displayName)) {
      seen.add(entry.displayName);
      items.push({
        type: 'context-folder',
        name: entry.displayName,
        contextRoot: entry.contextRoot,
        folderName: entry.displayName,
      });
    }
  }
  return items;
}

type ScoredItem =
  | { type: 'folder'; name: string; path: string; startsWithQuery: boolean; mtime: number }
  | { type: 'file'; name: string; path: string; file: TFile; startsWithQuery: boolean; mtime: number };

function compareScored(a: ScoredItem, b: ScoredItem): number {
  if (a.startsWithQuery !== b.startsWithQuery) return a.startsWithQuery ? -1 : 1;
  if (a.mtime !== b.mtime) return b.mtime - a.mtime;
  if (a.type !== b.type) return a.type === 'file' ? -1 : 1;
  return a.path.localeCompare(b.path);
}

/** Derive each folder's mtime from the most recently modified file within it. */
function deriveFolderMtimes(allFiles: TFile[]): Map<string, number> {
  const folderMtimeMap = new Map<string, number>();
  for (const f of allFiles) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join('/');
      const existing = folderMtimeMap.get(folderPath) ?? 0;
      if (f.stat.mtime > existing) {
        folderMtimeMap.set(folderPath, f.stat.mtime);
      }
    }
  }
  return folderMtimeMap;
}

/**
 * Build the merged, scored, and capped vault file/folder mention items for a
 * query (folders capped at 50, files at 100, then re-sorted together).
 */
export function buildVaultItems(
  folders: Array<Pick<FolderMentionItem, 'name' | 'path'>>,
  allFiles: TFile[],
  searchLower: string,
): MentionItem[] {
  const folderMtimeMap = deriveFolderMtimes(allFiles);

  const scoredFolders: ScoredItem[] = folders
    .map(f => ({
      name: f.name,
      path: f.path.replace(/\\/g, '/').replace(/\/+$/, ''),
    }))
    .filter(f =>
      f.path.length > 0 &&
      (f.path.toLowerCase().includes(searchLower) || f.name.toLowerCase().includes(searchLower))
    )
    .map(f => ({
      type: 'folder' as const,
      name: f.name,
      path: f.path,
      startsWithQuery: f.name.toLowerCase().startsWith(searchLower),
      mtime: folderMtimeMap.get(f.path) ?? 0,
    }))
    .sort(compareScored)
    .slice(0, 50);

  const scoredFiles: ScoredItem[] = allFiles
    .filter(f =>
      f.path.toLowerCase().includes(searchLower) || f.name.toLowerCase().includes(searchLower)
    )
    .map(f => ({
      type: 'file' as const,
      name: f.name,
      path: f.path,
      file: f,
      startsWithQuery: f.name.toLowerCase().startsWith(searchLower),
      mtime: f.stat.mtime,
    }))
    .sort(compareScored)
    .slice(0, 100);

  return [...scoredFolders, ...scoredFiles]
    .sort(compareScored)
    .map(item => item.type === 'folder'
      ? { type: 'folder', name: item.name, path: item.path }
      : { type: 'file', name: item.name, path: item.path, file: item.file });
}
