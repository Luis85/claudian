import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { renderLibraryNav } from '../../../shared/libraryNav';
import { promptReason } from '../../../shared/modals/PromptModal';
import { withErrorNotice } from '../../../shared/uiAction';
import { createLibraryCard, librarySlug, renderLibraryEmptyState, renderLibraryLoading, renderLibraryShell, uniqueChildDir } from '../../../utils/libraryView';
import { type SkillLibraryRow, toSkillLibraryRows } from '../skillLibraryRows';
import { SkillEditorModal } from './SkillEditorModal';

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
  getDisplayText(): string { return t('skillLibrary.title'); }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const { actions, list } = renderLibraryShell(this.contentEl, t('skillLibrary.title'),
      (c) => renderLibraryNav(c, this.plugin, VIEW_TYPE_SKILL_LIBRARY));
    const newBtn = actions.createEl('button', { cls: 'mod-cta', text: t('skillLibrary.newSkill') });
    newBtn.onclick = () => this.createSkillSafely();

    renderLibraryLoading(list, t('common.loading'));
    const entries = (await this.plugin.vaultSkillAggregator?.listAll()) ?? [];
    list.empty();
    const rows = toSkillLibraryRows(entries);
    if (rows.length === 0) {
      renderLibraryEmptyState(list, {
        icon: 'book-open',
        message: t('skillLibrary.empty'),
        actionLabel: t('skillLibrary.newSkill'),
        onAction: () => this.createSkillSafely(),
      });
      return;
    }

    for (const row of rows) {
      const { nameRow, body, actions } = createLibraryCard(list, row.name);
      nameRow.createSpan({ cls: 'claudian-library-chip claudian-library-chip-muted', text: row.providerDisplayName });
      if (!row.editable) {
        // Outline (not filled) so the read-only marker reads as distinct from
        // the adjacent filled provider chip rather than merging into one gray pair.
        nameRow.createSpan({ cls: 'claudian-library-chip claudian-library-chip-outline', text: t('skillLibrary.readOnlyNote') });
      }
      body.createDiv({ cls: 'claudian-library-card-desc', text: row.description });

      const openBtn = actions.createEl('button', { text: t('skillLibrary.open') });
      openBtn.onclick = () => this.openEditor(row);
    }
  }

  private createSkillSafely(): void {
    void withErrorNotice(
      () => this.createSkill(),
      t('skillLibrary.actionFailed'),
      (e) => this.plugin.logger.scope('skills').error('skill library action failed', e),
    );
  }

  private openEditor(row: SkillLibraryRow): void {
    new SkillEditorModal(this.plugin.app, this.plugin, row, () => void this.render()).open();
  }

  private async createSkill(): Promise<void> {
    const name = await promptReason(this.plugin.app, t('skillLibrary.namePrompt'));
    if (!name) return;
    const dir = await uniqueChildDir(this.plugin.vaultFileAdapter, SKILLS_DIR, librarySlug(name) || 'skill');
    const path = `${dir}/SKILL.md`;
    await this.plugin.vaultFileAdapter.write(path, skillTemplate(name));
    new Notice(t('skillLibrary.created', { path }));
    await this.render();
    this.openEditor({
      id: `skill-${dir.split('/').pop()}`,
      name,
      description: '',
      providerDisplayName: t('skillLibrary.providerVault'),
      sourceFilePath: path,
      editable: true,
    });
  }
}
