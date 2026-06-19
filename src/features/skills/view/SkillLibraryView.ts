import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type ClaudianPlugin from '../../../main';
import { toSkillLibraryRows } from '../skillLibraryRows';

export const VIEW_TYPE_SKILL_LIBRARY = 'claudian-skill-library';

export class SkillLibraryView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_SKILL_LIBRARY; }
  getDisplayText(): string { return 'Skill Library'; }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('claudian-skill-library');
    root.createEl('h2', { text: 'Skill Library' });
    const entries = (await this.plugin.vaultSkillAggregator?.listAll()) ?? [];
    const rows = toSkillLibraryRows(entries);
    if (rows.length === 0) root.createEl('p', { text: 'No skills discovered.' });
    for (const r of rows) {
      const card = root.createDiv({ cls: 'claudian-skill-card' });
      card.createEl('div', { cls: 'claudian-skill-name', text: r.name });
      card.createEl('div', { text: r.description });
      card.createEl('div', {
        cls: 'claudian-skill-meta',
        text: `${r.providerDisplayName}${r.editable ? '' : ' · read-only'}`,
      });
    }
  }
}
