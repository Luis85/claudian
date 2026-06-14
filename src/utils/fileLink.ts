/**
 * Claudian - Vault file link utilities (provider-neutral).
 *
 * One resolution + click path for chat markdown (wikilinks, Cursor inline paths)
 * and tool UI path chips. Only vault files that exist in Obsidian are linkable.
 */

import type { App, Component } from 'obsidian';
import * as path from 'path';

import { getVaultFileByPath } from './obsidianCompat';
import {
  getVaultPath,
  isPathWithinVault,
  normalizePathForFilesystem,
  normalizePathForVault,
} from './path';

/** Strips Cursor-style relative prefixes (`../.\\foo.md`) before vault resolution. */
export function cleanToolPathCandidate(rawPath: string): string {
  let cleaned = rawPath.trim().replace(/\\/g, '/');
  cleaned = cleaned.replace(/^(?:\.\.?\/)+/g, '');
  cleaned = cleaned.replace(/^\/+/, '');
  return cleaned;
}

function candidatePathIsInsideVault(candidate: string, vaultPath: string): boolean {
  const normalized = normalizePathForFilesystem(candidate);
  if (!normalized) {
    return false;
  }

  if (path.isAbsolute(normalized)) {
    return isPathWithinVault(normalized, vaultPath);
  }

  const resolved = path.resolve(vaultPath, cleanToolPathCandidate(candidate));
  return isPathWithinVault(resolved, vaultPath);
}

function isVaultRelativeOpenPath(relative: string | null): relative is string {
  if (!relative || relative.startsWith('/')) {
    return false;
  }
  // Reject any `..` segment so an escaping candidate can never reach the vault
  // lookup, keeping this gate consistent with candidatePathIsInsideVault.
  if (relative.split('/').some(segment => segment === '..')) {
    return false;
  }
  return !/^[A-Za-z]:/.test(relative) && !relative.includes('://');
}

/**
 * `allowCleaning` controls the junk-prefix recovery (`cleanToolPathCandidate`,
 * which strips `../`, `.\`, leading `/`). That recovery can rescue an out-of-vault
 * path (`/tmp/x`, `../x`) into a vault-looking one, so it's only safe for
 * user-authored references (chat links); tool-edit paths must trust the path as
 * written. `requireExists` gates on the file already being indexed.
 */
interface VaultResolveOptions {
  requireExists: boolean;
  allowCleaning: boolean;
}

function findVaultRelativePath(app: App, rawPath: string, opts: VaultResolveOptions): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  const vaultPath = getVaultPath(app);
  if (!vaultPath) {
    return null;
  }

  const candidates = opts.allowCleaning ? [trimmed, cleanToolPathCandidate(trimmed)] : [trimmed];

  for (const candidate of candidates) {
    if (!candidatePathIsInsideVault(candidate, vaultPath)) {
      continue;
    }

    const relative = normalizePathForVault(candidate, vaultPath);
    if (!isVaultRelativeOpenPath(relative)) {
      continue;
    }

    if (!opts.requireExists || getVaultFileByPath(app, relative)) {
      return relative;
    }
  }

  return null;
}

/**
 * Resolves a path to a vault-relative file only when it lives in the vault and
 * exists. Junk-prefix recovery is on — for user-authored references (chat links,
 * Cursor inline path citations).
 */
export function resolveOpenableVaultPath(app: App, rawPath: string): string | null {
  return findVaultRelativePath(app, rawPath, { requireExists: true, allowCleaning: true });
}

/**
 * Resolves a tool-reported path to a vault-relative path WITHOUT requiring the
 * file to be indexed yet and WITHOUT junk-prefix recovery. Use for paths a tool
 * just wrote: a brand-new file's vault discovery may still be in flight, and an
 * out-of-vault path must not be cleaned into the vault.
 */
export function toVaultRelativeOpenPath(app: App, rawPath: string): string | null {
  return findVaultRelativePath(app, rawPath, { requireExists: false, allowCleaning: false });
}

/** Opens a vault file when the target is a resolvable path or wikilink. */
export function openVaultFileLink(app: App, rawTarget: string): void {
  const trimmed = rawTarget.trim();
  if (!trimmed) {
    return;
  }

  if (trimmed.includes('[[')) {
    const linkTarget = extractLinkTarget(trimmed);
    const basePath = extractLinkPathFromTarget(linkTarget);
    if (vaultFileIsOpenable(app, basePath)) {
      void app.workspace.openLinkText(linkTarget, '', 'tab');
    }
    return;
  }

  const hashIndex = trimmed.search(/[#^]/);
  const pathPart = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const suffix = hashIndex >= 0 ? trimmed.slice(hashIndex) : '';

  const openPath = resolveOpenableVaultPath(app, pathPart);
  if (openPath) {
    void app.workspace.openLinkText(openPath + suffix, '', 'tab');
    return;
  }

  if (vaultFileIsOpenable(app, pathPart)) {
    void app.workspace.openLinkText(trimmed, '', 'tab');
  }
}

/**
 * Marks an element clickable when `rawPath` resolves to a vault file.
 * Uses the same `claudian-file-link` + `data-href` contract as chat wikilinks.
 */
export function decorateVaultFileLink(app: App, el: HTMLElement, rawPath: string): void {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return;
  }

  const openTarget = resolveOpenableVaultPath(app, trimmed);
  if (!openTarget) {
    return;
  }

  el.classList.add('claudian-file-link');
  el.dataset.href = openTarget;
  el.setAttr('role', 'link');
}

/**
 * Regex pattern to match Obsidian wikilinks in text content.
 *
 * Matches:
 * - Standard wikilinks: [[note]] or [[folder/note]]
 * - Wikilinks with display text: [[note|display text]]
 * - Wikilinks with headings: [[note#heading]]
 * - Wikilinks with block references: [[note^block]]
 *
 * Does NOT match image embeds ![[image.png]] (those are handled separately).
 */
const WIKILINK_PATTERN_SOURCE = '(?<!!)\\[\\[([^\\]|#^]+)(?:#[^\\]|]+)?(?:\\^[^\\]|]+)?(?:\\|[^\\]]+)?\\]\\]';

/** Creates a fresh regex instance to avoid global state issues */
function createWikilinkPattern(): RegExp {
  return new RegExp(WIKILINK_PATTERN_SOURCE, 'g');
}

/** Cursor often cites created files as a single absolute path inside inline `code`. */
function processInlineCodeVaultPath(app: App, codeEl: HTMLElement): boolean {
  const text = codeEl.textContent?.trim();
  if (!text || text.includes('[[')) {
    return false;
  }

  const openPath = resolveOpenableVaultPath(app, text);
  if (!openPath) {
    return false;
  }

  codeEl.textContent = '';
  codeEl.appendChild(createWikilink(codeEl.ownerDocument, openPath, text));
  return true;
}

interface WikilinkMatch {
  index: number;
  fullMatch: string;
  linkPath: string;
  linkTarget: string;
  displayText: string;
}

function buildWikilinkMatch(
  fullMatch: string,
  linkPath: string,
  index: number
): WikilinkMatch {
  const pipeIndex = fullMatch.lastIndexOf('|');
  const displayText = pipeIndex > 0 ? fullMatch.slice(pipeIndex + 1, -2) : linkPath;

  return {
    index,
    fullMatch,
    linkPath,
    linkTarget: extractLinkTarget(fullMatch),
    displayText,
  };
}

export function extractLinkTarget(fullMatch: string): string {
  const inner = fullMatch.slice(2, -2);
  const pipeIndex = inner.indexOf('|');
  return pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner;
}

/**
 * Finds all wikilinks in text that exist in the vault.
 * Sorted by index descending for end-to-start processing.
 */
function findWikilinks(app: App, text: string): WikilinkMatch[] {
  const pattern = createWikilinkPattern();
  const matches: WikilinkMatch[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const linkPath = match[1];

    if (!vaultFileIsOpenable(app, linkPath)) continue;

    matches.push(buildWikilinkMatch(fullMatch, linkPath, match.index));
  }

  return matches.sort((a, b) => b.index - a.index);
}

function vaultFileIsOpenable(app: App, linkPath: string): boolean {
  if (resolveOpenableVaultPath(app, linkPath)) {
    return true;
  }

  const file = app.metadataCache.getFirstLinkpathDest(linkPath, '');
  if (file) {
    return true;
  }

  const directFile = getVaultFileByPath(app, linkPath);
  if (directFile) {
    return true;
  }

  if (!linkPath.endsWith('.md')) {
    const withExt = getVaultFileByPath(app, linkPath + '.md');
    if (withExt) {
      return true;
    }
  }

  return false;
}

function extractLinkPathFromTarget(linkTarget: string): string {
  const subpathIndex = linkTarget.search(/[#^]/);
  return subpathIndex >= 0 ? linkTarget.slice(0, subpathIndex) : linkTarget;
}

/**
 * Creates a link element for a wikilink.
 * Click handling is done via event delegation in registerFileLinkHandler.
 */
function createWikilink(
  ownerDocument: Document,
  linkTarget: string,
  displayText: string
): HTMLElement {
  const link = ownerDocument.createElement('a');
  link.className = 'claudian-file-link internal-link';
  link.textContent = displayText;
  link.setAttribute('data-href', linkTarget);
  link.setAttribute('href', linkTarget);
  return link;
}

function repairEmptyInternalLink(app: App, link: HTMLAnchorElement): void {
  if ((link.textContent || '').trim()) return;

  const linkTarget = link.dataset.href || link.getAttribute('data-href') || link.getAttribute('href');
  if (!linkTarget) return;

  const linkPath = extractLinkPathFromTarget(linkTarget);
  if (!linkPath || !vaultFileIsOpenable(app, linkPath)) return;

  link.classList.add('claudian-file-link');
  if (!link.dataset.href) {
    link.setAttribute('data-href', linkTarget);
  }
  link.textContent = linkTarget;
}

/**
 * Registers a delegated click handler for file links on a container.
 * Should be called once on the messages container.
 * Handles both our custom .claudian-file-link and Obsidian's .internal-link.
 */
export function registerFileLinkHandler(
  app: App,
  container: HTMLElement,
  component: Component,
): void {
  component.registerDomEvent(container, 'click', (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const link = target.closest(
      'a.claudian-file-link, a.internal-link, [data-href].claudian-file-link',
    ) as HTMLElement | null;

    if (!link) {
      return;
    }

    const linkTarget = link.dataset.href || link.getAttribute('href');
    if (!linkTarget) {
      return;
    }

    event.preventDefault();
    if (link.tagName !== 'A' && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
    void app.workspace.openLinkText(linkTarget, '', 'tab');
  });
}

function buildFragmentWithLinks(ownerDocument: Document, text: string, matches: WikilinkMatch[]): DocumentFragment {
  const fragment = ownerDocument.createDocumentFragment();
  let currentIndex = text.length;

  for (const { index, fullMatch, linkTarget, displayText } of matches) {
    const endIndex = index + fullMatch.length;

    if (endIndex < currentIndex) {
      fragment.insertBefore(
        ownerDocument.createTextNode(text.slice(endIndex, currentIndex)),
        fragment.firstChild
      );
    }

    fragment.insertBefore(createWikilink(ownerDocument, linkTarget, displayText), fragment.firstChild);
    currentIndex = index;
  }

  if (currentIndex > 0) {
    fragment.insertBefore(
      ownerDocument.createTextNode(text.slice(0, currentIndex)),
      fragment.firstChild
    );
  }

  return fragment;
}

function processTextNode(app: App, node: Text): boolean {
  const text = node.textContent;
  if (!text || !text.includes('[[')) return false;

  const matches = findWikilinks(app, text);
  if (matches.length === 0) return false;

  node.parentNode?.replaceChild(buildFragmentWithLinks(node.ownerDocument, text, matches), node);
  return true;
}

/**
 * Call after MarkdownRenderer.renderMarkdown().
 * Catches wikilinks that remain as raw text after rendering, especially inline code spans.
 */
export function processFileLinks(app: App, container: HTMLElement): void {
  if (!app || !container) return;

  // Repair resolved internal links that rendered as empty anchors.
  container.querySelectorAll('a.internal-link').forEach((linkEl) => {
    repairEmptyInternalLink(app, linkEl as HTMLAnchorElement);
  });

  // Inline code: vault paths (Cursor) and raw wikilinks Obsidian does not render
  container.querySelectorAll('code').forEach((codeEl) => {
    if (codeEl.parentElement?.tagName === 'PRE') return;

    if (processInlineCodeVaultPath(app, codeEl)) return;

    const text = codeEl.textContent;
    if (!text || !text.includes('[[')) return;

    const matches = findWikilinks(app, text);
    if (matches.length === 0) return;

    codeEl.textContent = '';
    codeEl.appendChild(buildFragmentWithLinks(container.ownerDocument, text, matches));
  });

  if (!(container.textContent ?? '').includes('[[')) {
    return;
  }

  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tagName = parent.tagName.toUpperCase();
        if (tagName === 'PRE' || tagName === 'CODE' || tagName === 'A') {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.closest('pre, code, a, .claudian-file-link, .internal-link')) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  // Modifying DOM while walking causes issues, so collect first
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    processTextNode(app, textNode);
  }
}
