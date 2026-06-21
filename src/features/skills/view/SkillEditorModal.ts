import { type App, Notice } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { LibraryEditorModal } from '../../../shared/modals/LibraryEditorModal';
import { createModalCodeArea, renderModalField, renderModalFooter, renderModalLabel } from '../../../utils/libraryView';
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

  constructor(
    app: App,
    private readonly plugin: ClaudianPlugin,
    private readonly row: SkillLibraryRow,
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

    renderModalLabel(root, t('skillLibrary.content'));
    const content = await this.plugin.vaultFileAdapter.read(this.row.sourceFilePath).catch(() => '');
    this.contentArea = createModalCodeArea(root, content);

    renderModalFooter(root, {
      saveLabel: t('skillLibrary.save'),
      onSave: () => void this.save(),
      closeLabel: t('skillLibrary.close'),
      onClose: () => this.close(),
    });
  }

  private async save(): Promise<void> {
    if (!this.contentArea || !this.row.sourceFilePath) return;
    await this.plugin.vaultFileAdapter.write(this.row.sourceFilePath, this.contentArea.value);
    this.onSaved();
    new Notice(t('skillLibrary.saved', { name: this.row.name }));
    this.close();
  }
}
