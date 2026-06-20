import { ItemView, type WorkspaceLeaf } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { toSkillLibraryRows } from '../skillLibraryRows';

export const VIEW_TYPE_SKILL_LIBRARY = 'claudian-skill-library';

export class SkillLibraryView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_SKILL_LIBRARY; }
  // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Skill Library" is the product feature name.
  getDisplayText(): string { return 'Skill Library'; }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('claudian-skill-library');
    root.createEl('h2', { text: t('skillLibrary.title') });
    const entries = (await this.plugin.vaultSkillAggregator?.listAll()) ?? [];
    const rows = toSkillLibraryRows(entries);
    if (rows.length === 0) root.createEl('p', { text: t('skillLibrary.empty') });
    for (const r of rows) {
      const card = root.createDiv({ cls: 'claudian-skill-card' });
      card.createEl('div', { cls: 'claudian-skill-name', text: r.name });
      card.createEl('div', { text: r.description });
      card.createEl('div', {
        cls: 'claudian-skill-meta',
        text: r.editable ? r.providerDisplayName : `${r.providerDisplayName} · ${t('skillLibrary.readOnlySuffix')}`,
      });
    }
  }
}
