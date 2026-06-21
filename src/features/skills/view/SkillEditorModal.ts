import { type App, Notice } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { LibraryEditorModal } from '../../../shared/modals/LibraryEditorModal';
import { createModalCodeArea, librarySlug, renameLibraryItemDir, renderModalField, renderModalFooter, renderModalLabel, renderModalTextField } from '../../../utils/libraryView';
import type { SkillLibraryRow } from '../skillLibraryRows';

/**
 * Edits a skill's `SKILL.md` in a modal. Skill files live under provider
 * dot-folders (e.g. `.claude/skills/`) that Obsidian's vault index ignores, so
 * an editor tab can't open them. This modal reads/writes through
 * `vaultFileAdapter`. Read-only rows (no `sourceFilePath`) are shown but not
 * editable.
 */
export class SkillEditorModal extends LibraryEditorModal {
  private contentArea: HTMLTextAreaElement | null = null;
  private nameEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    private readonly plugin: ClaudianPlugin,
    private row: SkillLibraryRow,
    private readonly onSaved: () => void,
  ) {
    super(app);
  }

  protected title(): string {
    return this.row.name;
  }

  protected async renderBody(root: HTMLElement): Promise<void> {
    const meta = root.createDiv({ cls: 'claudian-library-modal-meta' });
    renderModalField(meta, t('skillLibrary.provider'), this.row.providerDisplayName);
    if (this.row.description) {
      meta.createDiv({ cls: 'claudian-library-modal-hint', text: this.row.description });
    }

    if (!this.row.editable || !this.row.sourceFilePath) {
      root.createDiv({ cls: 'claudian-library-modal-hint', text: t('skillLibrary.readonlyNotice') });
      renderModalFooter(root, { closeLabel: t('skillLibrary.close'), onClose: () => this.close() });
      return;
    }

    this.nameEl = renderModalTextField(root, t('skillLibrary.nameField'), this.row.name);
    renderModalLabel(root, t('skillLibrary.content'));
    const content = await this.plugin.vaultFileAdapter.read(this.row.sourceFilePath).catch(() => '');
    this.contentArea = createModalCodeArea(root, content);

    this.renderSaveFooter(root, {
      saveLabel: t('skillLibrary.save'),
      closeLabel: t('skillLibrary.close'),
      failedMessage: t('skillLibrary.actionFailed'),
      onSave: () => this.save(),
      onError: (e) => this.plugin.logger.scope('skills').error('skill save failed', e),
    });
  }

  private async save(): Promise<void> {
    if (!this.contentArea || !this.row.sourceFilePath) return;
    const adapter = this.plugin.vaultFileAdapter;
    const oldPath = this.row.sourceFilePath;
    const currentSlug = oldPath.split('/').slice(-2, -1)[0];
    const newName = this.nameEl?.value.trim() || this.row.name;
    const newSlug = librarySlug(newName) || currentSlug;
    if (newSlug === currentSlug) {
      await adapter.write(oldPath, this.contentArea.value);
    } else {
      // root is the directory holding the per-skill folder, e.g. `.claude/skills`.
      const root = oldPath.split('/').slice(0, -2).join('/');
      const newPath = await renameLibraryItemDir(adapter, oldPath, root, newSlug, this.contentArea.value);
      this.row = { ...this.row, name: newName, sourceFilePath: newPath };
    }
    this.onSaved();
    new Notice(t('skillLibrary.saved', { name: this.row.name }));
    this.close();
  }
}
