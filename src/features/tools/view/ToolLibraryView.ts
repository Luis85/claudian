import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type ClaudianPlugin from '../../../main';
import { TOOLS_DIR } from '../ClaudianToolRegistry';

export const VIEW_TYPE_TOOL_LIBRARY = 'claudian-tool-library';

const TEMPLATE = `import { z } from 'zod';

export default {
  manifest: {
    name: 'my_tool',
    description: 'Describe what this tool does and when to use it.',
    input: z.object({ text: z.string().describe('Example input') }),
  },
  handler: async (args, ctx) => {
    return { content: [{ type: 'text', text: 'You sent: ' + args.text }] };
  },
};
`;

export class ToolLibraryView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_TOOL_LIBRARY; }
  getDisplayText(): string { return 'Tool Library'; }
  getIcon(): string { return 'wrench'; }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('claudian-tool-library');
    const header = root.createDiv();
    header.createEl('h2', { text: 'Tool Library' });
    header.createEl('button', { text: 'New Tool' }).onclick = async () => {
      const adapter = this.plugin.vaultFileAdapter;
      const dir = `${TOOLS_DIR}/my-tool`;
      await adapter.ensureFolder(dir);
      const path = `${dir}/tool.ts`;
      if (!(await adapter.exists(path))) {
        await adapter.write(path, TEMPLATE);
      }
      await this.plugin.toolRegistry.load();
      new Notice(`Created ${path}. Edit it, then it loads automatically.`);
      await this.render();
    };
    header.createEl('button', { text: 'Reload' }).onclick = async () => {
      await this.plugin.toolRegistry.load();
      await this.render();
    };

    const list = root.createDiv();
    const tools = this.plugin.toolRegistry.list();
    if (tools.length === 0) list.createEl('p', { text: 'No tools yet.' });
    for (const t of tools) {
      const card = list.createDiv({ cls: 'claudian-tool-card' });
      card.createEl('div', { cls: 'claudian-tool-name', text: t.id });
      if (t.error) {
        card.createEl('div', { cls: 'claudian-tool-error', text: `Error: ${t.error}` });
      } else if (t.module) {
        card.createEl('div', { text: t.module.manifest.description });
      }
    }
  }
}
