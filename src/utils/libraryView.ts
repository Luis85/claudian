import { setIcon } from 'obsidian';

import type { VaultFileAdapter } from '../core/storage/VaultFileAdapter';

/** Slugifies a user-entered library item name into a vault-safe folder name. */
export function librarySlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Resolves the first free `<parent>/<slug>` (then `-2`, `-3`, …) directory so a
 * new library item never clobbers an existing one.
 */
export async function uniqueChildDir(
  adapter: VaultFileAdapter,
  parent: string,
  slug: string,
): Promise<string> {
  const base = slug || 'item';
  let dir = `${parent}/${base}`;
  for (let n = 2; await adapter.exists(dir); n += 1) dir = `${parent}/${base}-${n}`;
  return dir;
}

/**
 * Renames a `<root>/<oldName>/<file>` library item by moving it into a fresh
 * `<root>/<newSlug>/` directory and removing the old one. Writes `content` (the
 * possibly-edited body) to the new file and returns its path.
 */
export async function renameLibraryItemDir(
  adapter: VaultFileAdapter,
  oldFilePath: string,
  root: string,
  newSlug: string,
  content: string,
): Promise<string> {
  const filename = oldFilePath.slice(oldFilePath.lastIndexOf('/') + 1);
  const oldDir = oldFilePath.slice(0, oldFilePath.length - filename.length - 1);
  const newDir = await uniqueChildDir(adapter, root, newSlug);
  const newPath = `${newDir}/${filename}`;
  await adapter.write(newPath, content);
  if (newPath !== oldFilePath) {
    await adapter.delete(oldFilePath);
    await adapter.deleteFolder(oldDir);
  }
  return newPath;
}

/**
 * Builds the shared Tool/Skill library shell — `.claudian-library` root, a
 * header with the title, an actions container, and an empty list container —
 * returning the `actions` and `list` elements the caller fills in.
 */
export function renderLibraryShell(
  contentEl: HTMLElement,
  title: string,
  renderNav?: (container: HTMLElement) => void,
): { actions: HTMLElement; list: HTMLElement } {
  contentEl.empty();
  contentEl.addClass('claudian-library');
  renderNav?.(contentEl);
  const header = contentEl.createDiv({ cls: 'claudian-library-header' });
  header.createEl('h2', { text: title });
  const actions = header.createDiv({ cls: 'claudian-library-header-actions' });
  const list = contentEl.createDiv({ cls: 'claudian-library-list' });
  return { actions, list };
}

export interface LibraryEmptyStateOptions {
  /** Lucide icon name for the empty-state glyph. */
  icon: string;
  message: string;
  /** When both are present, a primary CTA button is rendered below the message. */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Renders a centered empty state — glyph, message, and an optional primary CTA —
 * shared by the Agent Roster, Tool, and Skill library views so a first-run user
 * sees a clear next action instead of a bare muted line.
 */
export function renderLibraryEmptyState(list: HTMLElement, opts: LibraryEmptyStateOptions): void {
  const empty = list.createDiv({ cls: 'claudian-library-empty' });
  setIcon(empty.createDiv({ cls: 'claudian-library-empty-icon' }), opts.icon);
  empty.createDiv({ cls: 'claudian-library-empty-text', text: opts.message });
  if (opts.actionLabel && opts.onAction) {
    const btn = empty.createEl('button', { cls: 'mod-cta claudian-library-empty-action', text: opts.actionLabel });
    btn.onclick = opts.onAction;
  }
}

/** A brief muted placeholder shown while an async list resolves. */
export function renderLibraryLoading(list: HTMLElement, text: string): void {
  list.createDiv({ cls: 'claudian-library-loading', text });
}

/** Uppercase section label used inside the library editor modals. */
export function renderModalLabel(parent: HTMLElement, text: string): void {
  parent.createDiv({ cls: 'claudian-library-modal-label', text });
}

/** Label + value metadata row used inside the library editor modals. */
export function renderModalField(parent: HTMLElement, label: string, value: string): void {
  const field = parent.createDiv({ cls: 'claudian-library-modal-field' });
  renderModalLabel(field, label);
  field.createDiv({ cls: 'claudian-library-modal-value', text: value });
}

/** Label + editable text input row used for rename inside the editor modals. */
export function renderModalTextField(parent: HTMLElement, label: string, value: string): HTMLInputElement {
  const field = parent.createDiv({ cls: 'claudian-library-modal-field' });
  renderModalLabel(field, label);
  const input = field.createEl('input', { type: 'text', cls: 'claudian-library-modal-input' });
  input.value = value;
  return input;
}

/** Monospace, spellcheck-off code/content textarea seeded with `value`. */
export function createModalCodeArea(parent: HTMLElement, value: string): HTMLTextAreaElement {
  const el = parent.createEl('textarea', { cls: 'claudian-library-modal-code' });
  el.value = value;
  el.spellcheck = false;
  return el;
}

/** Right-aligned modal footer with an optional primary Save and a Close button. */
export function renderModalFooter(
  parent: HTMLElement,
  opts: { saveLabel?: string; onSave?: () => void; closeLabel: string; onClose: () => void },
): void {
  const footer = parent.createDiv({ cls: 'claudian-library-modal-footer' });
  if (opts.saveLabel && opts.onSave) {
    footer.createEl('button', { cls: 'mod-cta', text: opts.saveLabel }).onclick = opts.onSave;
  }
  footer.createEl('button', { text: opts.closeLabel }).onclick = opts.onClose;
}

/**
 * Builds a shared library card scaffold (card → body → name row + actions) and
 * returns the seams the caller decorates: the `nameRow` (seeded with `name`) for
 * status/provider chips, the `body` for description/error, and `actions`.
 */
export function createLibraryCard(
  list: HTMLElement,
  name: string,
): { nameRow: HTMLElement; body: HTMLElement; actions: HTMLElement } {
  const card = list.createDiv({ cls: 'claudian-library-card' });
  const body = card.createDiv({ cls: 'claudian-library-card-body' });
  const nameRow = body.createDiv({ cls: 'claudian-library-card-name' });
  nameRow.createSpan({ text: name });
  const actions = card.createDiv({ cls: 'claudian-library-card-actions' });
  return { nameRow, body, actions };
}
