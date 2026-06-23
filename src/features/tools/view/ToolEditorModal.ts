import { type App, Notice } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type SpecoratorPlugin from '../../../main';
import { LibraryEditorModal } from '../../../shared/modals/LibraryEditorModal';
import { createModalCodeArea, librarySlug, renameLibraryItemDir, renderModalField, renderModalLabel, renderModalTextField } from '../../../utils/libraryView';
import { TOOLS_DIR } from '../SpecoratorToolRegistry';
import type { LoadedTool } from '../toolTypes';

/**
 * Edits a user tool's source in a modal. The tool files live under the
 * `.specorator/` dot-folder, which Obsidian's vault index ignores — so the editor
 * tab can't open them. This modal reads/writes through `vaultFileAdapter`
 * (backed by `vault.adapter`, which sees dot-files) and shows the parsed
 * metadata alongside an editable source area.
 */
export class ToolEditorModal extends LibraryEditorModal {
  private sourceEl: HTMLTextAreaElement | null = null;
  private nameEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    private readonly plugin: SpecoratorPlugin,
    private toolId: string,
    private readonly onSaved: () => void,
  ) {
    super(app);
  }

  protected title(): string {
    return this.toolId;
  }

  protected async renderBody(root: HTMLElement): Promise<void> {
    const tool = this.plugin.toolRegistry.get(this.toolId);
    const path = `${TOOLS_DIR}/${this.toolId}/tool.ts`;

    this.nameEl = renderModalTextField(root, t('toolLibrary.nameField'), this.toolId);
    this.renderMeta(root.createDiv({ cls: 'specorator-library-modal-meta' }), tool);

    renderModalLabel(root, t('toolLibrary.source'));
    const source = await this.plugin.vaultFileAdapter.read(path).catch(() => '');
    this.sourceEl = createModalCodeArea(root, source, t('toolLibrary.source'));

    this.renderSaveFooter(root, {
      saveLabel: t('toolLibrary.save'),
      closeLabel: t('toolLibrary.close'),
      failedMessage: t('toolLibrary.actionFailed'),
      onSave: () => this.save(path),
      onError: (e) => this.plugin.logger.scope('tools').error('tool save failed', e),
    });
  }

  private renderMeta(meta: HTMLElement, tool: LoadedTool | undefined): void {
    const hasError = Boolean(tool?.error);
    meta.createDiv({ cls: 'specorator-library-modal-status' }).createSpan({
      cls: `specorator-library-chip ${hasError ? 'specorator-library-chip-error' : 'specorator-library-chip-ready'}`,
      text: hasError ? t('toolLibrary.statusError') : t('toolLibrary.statusReady'),
    });
    if (tool?.module) {
      this.renderLoadedMeta(meta, tool);
    } else if (tool?.error) {
      meta.createDiv({ cls: 'specorator-library-modal-hint', text: t('toolLibrary.notLoaded') });
      meta.createEl('pre', { cls: 'specorator-library-modal-error', text: tool.error });
    }
  }

  private renderLoadedMeta(meta: HTMLElement, tool: LoadedTool): void {
    if (!tool.module) return;
    renderModalField(meta, t('toolLibrary.metaName'), tool.module.manifest.name);
    renderModalField(meta, t('toolLibrary.metaDescription'), tool.module.manifest.description);
    if (!tool.jsonSchema) return;
    const schema = meta.createDiv({ cls: 'specorator-library-modal-field' });
    renderModalLabel(schema, t('toolLibrary.inputSchema'));
    schema.createEl('pre', { cls: 'specorator-library-modal-schema', text: JSON.stringify(tool.jsonSchema, null, 2) });
  }

  private async save(path: string): Promise<void> {
    if (!this.sourceEl) return;
    const adapter = this.plugin.vaultFileAdapter;
    const newSlug = librarySlug(this.nameEl?.value ?? '') || this.toolId;
    if (newSlug === this.toolId) {
      await adapter.write(path, this.sourceEl.value);
    } else {
      const newPath = await renameLibraryItemDir(adapter, path, TOOLS_DIR, newSlug, this.sourceEl.value);
      this.toolId = newPath.slice(TOOLS_DIR.length + 1, newPath.lastIndexOf('/'));
      this.titleEl.setText(this.toolId);
    }
    await this.plugin.toolRegistry.load();
    this.onSaved();
    new Notice(t('toolLibrary.saved', { name: this.toolId }));
    // Re-render so the parsed metadata (and any transpile/validation error)
    // reflects the just-saved source.
    await this.rerender();
  }
}
