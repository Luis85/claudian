import type { Editor, Menu, TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { appendQuickActionFavoritesAndPicker } from '@/features/quickActions/appendQuickActionMenu';
import { addToWorkOrderInteractive } from '@/features/tasks/ui/AddToWorkOrderModal';
import { createWorkOrderFromSelectionInteractive, createWorkOrderInteractive } from '@/features/tasks/ui/createWorkOrderInteractive';
import type SpecoratorPlugin from '@/main';

export function registerWorkspaceMenus(plugin: SpecoratorPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
      if (file instanceof TFile) {
        menu.addSeparator();
        menu.addItem((item) => {
          item
            .setTitle('Add file to Specorator chat')
            .setIcon('at-sign')
            .onClick(() => {
              void plugin.addFileToActiveChat(file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('Create work order')
            .setIcon('kanban-square')
            .onClick(() => {
              void createWorkOrderInteractive(plugin, file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('Add to work order')
            .setIcon('list-plus')
            .onClick(() => {
              addToWorkOrderInteractive(plugin, file);
            });
        });
        // Helper returns the favorite count. When favs > 0 the helper already
        // closed its block with a trailing separator that doubles as the outer
        // bottom bracket — no need to emit a second one. When favs === 0 we
        // still need to close the Specorator block ourselves.
        const favsAppended = appendQuickActionFavoritesAndPicker(menu, plugin, file);
        if (favsAppended === 0) menu.addSeparator();
      } else if (file instanceof TFolder) {
        menu.addSeparator();
        menu.addItem((item) => {
          item
            .setTitle('Add folder to Specorator chat')
            .setIcon('folder')
            .onClick(() => {
              void plugin.addFolderToActiveChat(file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('Create work order')
            .setIcon('kanban-square')
            .onClick(() => {
              void createWorkOrderInteractive(plugin, file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle('Add to work order')
            .setIcon('list-plus')
            .onClick(() => {
              addToWorkOrderInteractive(plugin, file);
            });
        });
        const favsAppended = appendQuickActionFavoritesAndPicker(menu, plugin, file);
        if (favsAppended === 0) menu.addSeparator();
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
      if (!editor.getSelection().trim()) return;
      menu.addItem((item) => {
        item
          .setTitle('Create work order from selection')
          .setIcon('kanban-square')
          .onClick(() => {
            void createWorkOrderFromSelectionInteractive(plugin);
          });
      });
    }),
  );
}
