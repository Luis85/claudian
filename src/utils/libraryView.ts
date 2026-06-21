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
 * Builds the shared Tool/Skill library shell — `.claudian-library` root, a
 * header with the title, an actions container, and an empty list container —
 * returning the `actions` and `list` elements the caller fills in.
 */
export function renderLibraryShell(
  contentEl: HTMLElement,
  title: string,
): { actions: HTMLElement; list: HTMLElement } {
  contentEl.empty();
  contentEl.addClass('claudian-library');
  const header = contentEl.createDiv({ cls: 'claudian-library-header' });
  header.createEl('h2', { text: title });
  const actions = header.createDiv({ cls: 'claudian-library-header-actions' });
  const list = contentEl.createDiv({ cls: 'claudian-library-list' });
  return { actions, list };
}

/** Renders the muted empty-state row inside a library list container. */
export function renderLibraryEmpty(list: HTMLElement, text: string): void {
  list.createEl('p', { cls: 'claudian-library-empty', text });
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
