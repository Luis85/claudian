import type { Editor, Menu, TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { openContextMenuQuickAction } from '@/features/quickActions/openContextMenuQuickAction';
import { createWorkOrderFromSelectionInteractive, createWorkOrderInteractive } from '@/features/tasks/ui/createWorkOrderInteractive';
import { t } from '@/i18n/i18n';
import type ClaudianPlugin from '@/main';

export function registerWorkspaceMenus(plugin: ClaudianPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
      if (file instanceof TFile) {
        menu.addItem((item) => {
          item
            .setTitle('Add file to Claudian chat')
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
            .setTitle(t('quickActions.contextMenu.title'))
            .setIcon('zap')
            .onClick(() => {
              openContextMenuQuickAction(plugin, file);
            });
        });
      } else if (file instanceof TFolder) {
        menu.addItem((item) => {
          item
            .setTitle('Add folder to Claudian chat')
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
            .setTitle(t('quickActions.contextMenu.title'))
            .setIcon('zap')
            .onClick(() => {
              openContextMenuQuickAction(plugin, file);
            });
        });
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
