import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { promptReason } from '../../../shared/modals/PromptModal';
import { createLibraryCard, librarySlug, openFileInEditor, renderLibraryEmpty, renderLibraryShell, uniqueChildDir } from '../../../utils/libraryView';
import { toSkillLibraryRows } from '../skillLibraryRows';

export const VIEW_TYPE_SKILL_LIBRARY = 'claudian-skill-library';

// Canonical vault skill location (Claude-compatible). Kept local so the view
// stays in the features layer rather than importing provider storage.
const SKILLS_DIR = '.claude/skills';

function skillTemplate(name: string): string {
  return `---
description: Describe what this skill does and when to use it.
---

# ${name}

Write the skill instructions here.
`;
}

export class SkillLibraryView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_SKILL_LIBRARY; }
  // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Skill Library" is the product feature name.
  getDisplayText(): string { return 'Skill Library'; }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const { actions, list } = renderLibraryShell(this.contentEl, t('skillLibrary.title'));
    const newBtn = actions.createEl('button', { cls: 'mod-cta', text: t('skillLibrary.newSkill') });
    newBtn.onclick = () => void this.createSkill();

    const entries = (await this.plugin.vaultSkillAggregator?.listAll()) ?? [];
    const rows = toSkillLibraryRows(entries);
    if (rows.length === 0) {
      renderLibraryEmpty(list, t('skillLibrary.empty'));
      return;
    }

    for (const row of rows) {
      const { nameRow, body, actions } = createLibraryCard(list, row.name);
      nameRow.createSpan({ cls: 'claudian-library-chip claudian-library-chip-muted', text: row.providerDisplayName });
      if (!row.editable) {
        nameRow.createSpan({ cls: 'claudian-library-chip claudian-library-chip-muted', text: t('skillLibrary.readOnlyNote') });
      }
      body.createDiv({ cls: 'claudian-library-card-desc', text: row.description });

      if (row.editable && row.sourceFilePath) {
        const openBtn = actions.createEl('button', { text: t('skillLibrary.open') });
        openBtn.onclick = () => void openFileInEditor(this.plugin.app, row.sourceFilePath as string);
      }
    }
  }

  private async createSkill(): Promise<void> {
    const name = await promptReason(this.plugin.app, t('skillLibrary.namePrompt'));
    if (!name) return;
    const dir = await uniqueChildDir(this.plugin.vaultFileAdapter, SKILLS_DIR, librarySlug(name) || 'skill');
    const path = `${dir}/SKILL.md`;
    await this.plugin.vaultFileAdapter.write(path, skillTemplate(name));
    new Notice(t('skillLibrary.created', { path }));
    await this.render();
    await openFileInEditor(this.plugin.app, path);
  }
}
