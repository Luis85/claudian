import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { renderLibraryNav } from '../../../shared/libraryNav';
import { confirm } from '../../../shared/modals/ConfirmModal';
import { promptReason } from '../../../shared/modals/PromptModal';
import { withErrorNotice } from '../../../shared/uiAction';
import { createLibraryCard, librarySlug, renderLibraryEmptyState, renderLibraryShell, uniqueChildDir } from '../../../utils/libraryView';
import { TOOLS_DIR } from '../ClaudianToolRegistry';
import { ToolEditorModal } from './ToolEditorModal';

export const VIEW_TYPE_TOOL_LIBRARY = 'claudian-tool-library';

function toolTemplate(manifestName: string): string {
  return `import { z } from 'zod';

export default {
  manifest: {
    name: '${manifestName}',
    description: 'Describe what this tool does and when to use it.',
    input: z.object({ text: z.string().describe('Example input') }),
  },
  handler: async (args, ctx) => {
    return { content: [{ type: 'text', text: 'You sent: ' + args.text }] };
  },
};
`;
}

export class ToolLibraryView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_TOOL_LIBRARY; }
  getDisplayText(): string { return t('toolLibrary.title'); }
  getIcon(): string { return 'wrench'; }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const { actions, list } = renderLibraryShell(this.contentEl, t('toolLibrary.title'),
      (c) => renderLibraryNav(c, this.plugin, VIEW_TYPE_TOOL_LIBRARY));
    const fail = t('toolLibrary.actionFailed');
    const newBtn = actions.createEl('button', { cls: 'mod-cta', text: t('toolLibrary.newTool') });
    newBtn.onclick = () => void withErrorNotice(() => this.createTool(), fail, (e) => this.fail(e));
    const reloadBtn = actions.createEl('button', { text: t('toolLibrary.reload') });
    reloadBtn.onclick = () => void withErrorNotice(() => this.reload(), fail, (e) => this.fail(e));

    const tools = this.plugin.toolRegistry.list();
    if (tools.length === 0) {
      renderLibraryEmptyState(list, {
        icon: 'wrench',
        message: t('toolLibrary.empty'),
        actionLabel: t('toolLibrary.newTool'),
        onAction: () => void withErrorNotice(() => this.createTool(), fail, (e) => this.fail(e)),
      });
      return;
    }

    for (const tool of tools) {
      const { nameRow, body, actions: cardActions } = createLibraryCard(list, tool.module?.manifest.name ?? tool.id);
      nameRow.createSpan({
        cls: `claudian-library-chip ${tool.error ? 'claudian-library-chip-error' : 'claudian-library-chip-ready'}`,
        text: tool.error ? t('toolLibrary.statusError') : t('toolLibrary.statusReady'),
      });
      if (tool.error) {
        body.createDiv({ cls: 'claudian-library-card-error', text: t('toolLibrary.errorPrefix', { error: tool.error }) });
      } else if (tool.module) {
        body.createDiv({ cls: 'claudian-library-card-desc', text: tool.module.manifest.description });
      }

      const editBtn = cardActions.createEl('button', { text: t('toolLibrary.edit') });
      editBtn.onclick = () => this.openEditor(tool.id);
      const deleteBtn = cardActions.createEl('button', { cls: 'claudian-library-card-delete', text: t('toolLibrary.delete') });
      deleteBtn.onclick = () => void withErrorNotice(() => this.deleteTool(tool.id), fail, (e) => this.fail(e));
    }
  }

  private async createTool(): Promise<void> {
    const name = await promptReason(this.plugin.app, t('toolLibrary.namePrompt'));
    if (!name) return;
    const dir = await uniqueChildDir(this.plugin.vaultFileAdapter, TOOLS_DIR, librarySlug(name) || 'tool');
    const path = `${dir}/tool.ts`;
    const manifestName = dir.split('/').pop()!.replace(/-/g, '_');
    await this.plugin.vaultFileAdapter.write(path, toolTemplate(manifestName));
    await this.plugin.toolRegistry.load();
    new Notice(t('toolLibrary.toolCreated', { path }));
    await this.render();
    this.openEditor(dir.split('/').pop()!);
  }

  private openEditor(toolId: string): void {
    new ToolEditorModal(this.plugin.app, this.plugin, toolId, () => void this.render()).open();
  }

  private fail(error: unknown): void {
    this.plugin.logger.scope('tools').error('tool library action failed', error);
  }

  private async reload(): Promise<void> {
    await this.plugin.toolRegistry.load();
    new Notice(t('toolLibrary.reloadDone'));
    await this.render();
  }

  private async deleteTool(id: string): Promise<void> {
    const ok = await confirm(
      this.plugin.app,
      t('toolLibrary.deleteConfirm', { name: id }),
      t('toolLibrary.delete'),
    );
    if (!ok) return;
    const adapter = this.plugin.vaultFileAdapter;
    const dir = `${TOOLS_DIR}/${id}`;
    // deleteFolder fails on a non-empty dir, so remove the file first.
    await adapter.delete(`${dir}/tool.ts`);
    await adapter.deleteFolder(dir);
    await this.plugin.toolRegistry.load();
    new Notice(t('toolLibrary.deleted', { name: id }));
    await this.render();
  }
}
