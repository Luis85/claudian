import type { WorkspaceLeaf } from 'obsidian';

import { VIEW_TYPE_CLAUDIAN, VIEW_TYPE_CLAUDIAN_AGENT_BOARD } from '@/core/types';
import type { ChatViewPlacement } from '@/core/types/settings';
import type { ClaudianView } from '@/features/chat/ClaudianView';
import { AgentBoardView } from '@/features/tasks/ui/AgentBoardView';
import type ClaudianPlugin from '@/main';
import { revealWorkspaceLeaf } from '@/utils/obsidianCompat';

export class PluginViewActivator {
  constructor(private readonly plugin: ClaudianPlugin) {}

  async activateView(): Promise<void> {
    const { workspace } = this.plugin.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN)[0];

    if (!leaf) {
      const newLeaf = this.getLeafForPlacement(this.plugin.settings.chatViewPlacement);
      if (newLeaf) {
        await newLeaf.setViewState({ type: VIEW_TYPE_CLAUDIAN, active: true });
        leaf = newLeaf;
      }
    }

    if (leaf) {
      await revealWorkspaceLeaf(workspace, leaf);
    }
  }

  async activateAgentBoardView(): Promise<void> {
    const { workspace } = this.plugin.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN_AGENT_BOARD)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE_CLAUDIAN_AGENT_BOARD, active: true });
    }

    await revealWorkspaceLeaf(workspace, leaf);
  }

  async ensureViewOpen(): Promise<ClaudianView | null> {
    const existingView = this.plugin.getView();
    if (existingView) return existingView;
    await this.activateView();
    return this.plugin.getView();
  }

  async openNewTab(): Promise<void> {
    const existingView = this.plugin.getView();
    if (existingView) {
      await existingView.createNewTab();
      return;
    }

    const restoredTabCount = this.getLastKnownOpenTabCount();
    const view = await this.ensureViewOpen();
    if (!view) return;

    if (restoredTabCount === 0) return;
    await view.createNewTab();
  }

  canCreateNewTab(): boolean {
    const hasClaudianLeaf =
      this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN).length > 0;
    const view = this.plugin.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return tabManager.canCreateTab();
    }
    if (hasClaudianLeaf) return false;
    return this.getLastKnownOpenTabCount() < this.getMaxTabsLimit();
  }

  async runNextReadyWorkOrder(): Promise<void> {
    await this.activateAgentBoardView();
    const leaf = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN_AGENT_BOARD)[0];
    const view = leaf?.view;
    if (view instanceof AgentBoardView) {
      await view.runNextReady();
    }
  }

  private getLeafForPlacement(placement: ChatViewPlacement): WorkspaceLeaf | null {
    const { workspace } = this.plugin.app;
    switch (placement) {
      case 'main-tab':
        return workspace.getLeaf('tab');
      case 'left-sidebar':
        return workspace.getLeftLeaf(false);
      case 'right-sidebar':
        return workspace.getRightLeaf(false);
    }
  }

  private getLastKnownOpenTabCount(): number {
    return this.plugin.lastKnownTabManagerState?.openTabs.length ?? 0;
  }

  private getMaxTabsLimit(): number {
    const maxTabs = this.plugin.settings.maxTabs ?? 3;
    return Math.max(3, Math.min(10, maxTabs));
  }
}
