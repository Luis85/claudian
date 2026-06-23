import type { TFile } from 'obsidian';
import { setIcon } from 'obsidian';

import { buildExternalContextDisplayEntries } from '../../utils/externalContext';
import { type ExternalContextFile, externalContextScanner } from '../../utils/externalContextScanner';
import { extractMcpMentions } from '../../utils/mcp';
import { SelectableDropdown } from '../components/SelectableDropdown';
import { appendMcpIcon } from '../icons';
import {
  type ActiveContextFilter,
  buildAgentItems,
  buildContextFileItems,
  buildContextFolderItems,
  buildMcpServerItems,
  buildVaultItems,
  resolveContextFilter,
  scanContextFiles,
} from './mentionItemBuilders';
import {
  type AgentMentionProvider,
  type FolderMentionItem,
  type MentionItem,
} from './types';

export type { AgentMentionProvider };

export interface MentionDropdownOptions {
  fixed?: boolean;
}

export interface MentionDropdownCallbacks {
  onAttachFile: (path: string) => void;
  /** Called when a mention item should be added as a pill rather than inserted as text (Task 4). */
  onAddContextPill: (path: string, kind: 'file' | 'folder') => void;
  onMcpMentionChange?: (servers: Set<string>) => void;
  onAgentMentionSelect?: (agentId: string) => void;
  getMentionedMcpServers: () => Set<string>;
  setMentionedMcpServers: (mentions: Set<string>) => boolean;
  addMentionedMcpServer: (name: string) => void;
  getExternalContexts: () => string[];
  getCachedVaultFolders: () => Array<Pick<FolderMentionItem, 'name' | 'path'>>;
  getCachedVaultFiles: () => TFile[];
  normalizePathForVault: (path: string | undefined | null) => string | null;
}

export interface McpMentionProvider {
  getContextSavingServers: () => Array<{ name: string }>;
}

export class MentionDropdownController {
  private containerEl: HTMLElement;
  private inputEl: HTMLTextAreaElement | HTMLInputElement;
  private callbacks: MentionDropdownCallbacks;
  private dropdown: SelectableDropdown<MentionItem>;
  private mentionStartIndex = -1;
  private selectedMentionIndex = 0;
  private filteredMentionItems: MentionItem[] = [];
  private filteredContextFiles: ExternalContextFile[] = [];
  private activeContextFilter: ActiveContextFilter | null = null;
  private activeAgentFilter = false;
  private mcpManager: McpMentionProvider | null = null;
  private agentService: AgentMentionProvider | null = null;
  private fixed: boolean;
  private debounceTimer: number | null = null;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement | HTMLInputElement,
    callbacks: MentionDropdownCallbacks,
    options: MentionDropdownOptions = {}
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.fixed = options.fixed ?? false;

    this.dropdown = new SelectableDropdown<MentionItem>(this.containerEl, {
      listClassName: 'specorator-mention-dropdown',
      itemClassName: 'specorator-mention-item',
      emptyClassName: 'specorator-mention-empty',
      fixed: this.fixed,
      fixedClassName: 'specorator-mention-dropdown-fixed',
    });
  }

  setMcpManager(manager: McpMentionProvider | null): void {
    this.mcpManager = manager;
  }

  setAgentService(service: AgentMentionProvider | null): void {
    if (this.agentService !== service && this.dropdown.isVisible()) {
      this.hide();
    }
    this.agentService = service;
  }

  preScanExternalContexts(): void {
    const externalContexts = this.callbacks.getExternalContexts() || [];
    if (externalContexts.length === 0) return;

    window.setTimeout(() => {
      try {
        externalContextScanner.scanPaths(externalContexts);
      } catch {
        // Pre-scan is best-effort, ignore failures
      }
    }, 0);
  }

  isVisible(): boolean {
    return this.dropdown.isVisible();
  }

  hide(): void {
    this.dropdown.hide();
    this.mentionStartIndex = -1;
  }

  containsElement(el: Node): boolean {
    return this.dropdown.getElement()?.contains(el) ?? false;
  }

  destroy(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.dropdown.destroy();
  }

  updateMcpMentionsFromText(text: string): void {
    if (!this.mcpManager) return;

    const validNames = new Set(
      this.mcpManager.getContextSavingServers().map(s => s.name)
    );

    const newMentions = extractMcpMentions(text, validNames);
    const changed = this.callbacks.setMentionedMcpServers(newMentions);

    if (changed) {
      this.callbacks.onMcpMentionChange?.(newMentions);
    }
  }

  handleInputChange(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      const text = this.inputEl.value;
      this.updateMcpMentionsFromText(text);

      const cursorPos = this.inputEl.selectionStart || 0;
      const textBeforeCursor = text.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');

      if (lastAtIndex === -1) {
        this.hide();
        return;
      }

      const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      if (!/\s/.test(charBeforeAt) && lastAtIndex !== 0) {
        this.hide();
        return;
      }

      // Spaces are allowed in the query so multi-word filenames stay searchable
      // (#748); the default path closes the dropdown when nothing matches instead.
      const searchText = textBeforeCursor.substring(lastAtIndex + 1);

      this.mentionStartIndex = lastAtIndex;
      this.showMentionDropdown(searchText);
    }, 200);
  }

  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.dropdown.isVisible()) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.dropdown.moveSelection(1);
      this.selectedMentionIndex = this.dropdown.getSelectedIndex();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.dropdown.moveSelection(-1);
      this.selectedMentionIndex = this.dropdown.getSelectedIndex();
      return true;
    }
    // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) {
      e.preventDefault();
      this.selectMentionItem();
      return true;
    }
    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      // If in secondary menu, return to first level instead of closing
      if (this.activeContextFilter || this.activeAgentFilter) {
        this.returnToFirstLevel();
        return true;
      }
      this.hide();
      return true;
    }

    return false;
  }

  private showMentionDropdown(searchText: string): void {
    const searchLower = searchText.toLowerCase();
    this.filteredMentionItems = [];
    this.filteredContextFiles = [];

    const contextEntries = buildExternalContextDisplayEntries(
      this.callbacks.getExternalContexts() || []
    );
    const isFilterSearch = searchText.includes('/');

    if (isFilterSearch && searchLower.startsWith('agents/')) {
      this.populateAgentFilterItems(searchText);
      return;
    }

    if (isFilterSearch) {
      const { filter, fileSearchText } = resolveContextFilter(searchText, searchLower, contextEntries);
      this.activeContextFilter = filter;
      if (filter) {
        this.populateContextFilterItems(searchLower, fileSearchText);
        return;
      }
    }

    this.populateDefaultItems(searchLower, contextEntries);
  }

  /** `@agents/<query>` submenu: list matching agents only. */
  private populateAgentFilterItems(searchText: string): void {
    this.activeAgentFilter = true;
    this.activeContextFilter = null;
    const agentSearchText = searchText.substring('agents/'.length).toLowerCase();

    this.filteredMentionItems.push(
      ...buildAgentItems(this.agentService?.searchAgents(agentSearchText) ?? [])
    );

    this.selectedMentionIndex = 0;
    this.renderMentionDropdown();
  }

  /** `@folder/<query>` submenu: context files for the active filter plus vault items. */
  private populateContextFilterItems(searchLower: string, fileSearchText: string): void {
    const activeFilter = this.activeContextFilter;
    if (!activeFilter) return;

    this.filteredContextFiles = scanContextFiles(activeFilter.contextRoot, fileSearchText);
    this.filteredMentionItems.push(
      ...buildContextFileItems(this.filteredContextFiles, activeFilter.folderName)
    );

    const firstVaultItemIndex = this.filteredMentionItems.length;
    const vaultItemCount = this.appendVaultItems(searchLower);

    this.selectedMentionIndex = this.filteredContextFiles.length === 0 && vaultItemCount > 0
      ? firstVaultItemIndex
      : 0;

    this.renderMentionDropdown();
  }

  /** First-level `@` menu: MCP servers, agents folder, context folders, then vault items. */
  private populateDefaultItems(
    searchLower: string,
    contextEntries: ReturnType<typeof buildExternalContextDisplayEntries>,
  ): void {
    this.activeContextFilter = null;
    this.activeAgentFilter = false;

    this.filteredMentionItems.push(
      ...buildMcpServerItems(this.mcpManager?.getContextSavingServers() ?? [], searchLower)
    );
    if (this.agentService && this.agentService.searchAgents('').length > 0 && 'agents'.includes(searchLower)) {
      this.filteredMentionItems.push({ type: 'agent-folder', name: 'Agents' });
    }
    this.filteredMentionItems.push(...buildContextFolderItems(contextEntries, searchLower));

    const firstVaultItemIndex = this.filteredMentionItems.length;
    const vaultItemCount = this.appendVaultItems(searchLower);

    // Close instead of showing an empty list so prose that merely contains an
    // "@" (now that spaces no longer gate the search, #748) doesn't keep the
    // dropdown open. Submenu paths keep their "No matches" affordance.
    if (this.filteredMentionItems.length === 0) {
      this.hide();
      return;
    }

    this.selectedMentionIndex = vaultItemCount > 0 ? firstVaultItemIndex : 0;

    this.renderMentionDropdown();
  }

  private appendVaultItems(searchLower: string): number {
    const vaultItems = buildVaultItems(
      this.callbacks.getCachedVaultFolders(),
      this.callbacks.getCachedVaultFiles(),
      searchLower,
    );
    this.filteredMentionItems.push(...vaultItems);
    return vaultItems.length;
  }

  private renderMentionDropdown(): void {
    this.dropdown.render({
      items: this.filteredMentionItems,
      selectedIndex: this.selectedMentionIndex,
      emptyText: 'No matches',
      getItemClass: (item) => {
        switch (item.type) {
          case 'mcp-server': return 'mcp-server';
          case 'folder': return 'vault-folder';
          case 'agent': return 'agent';
          case 'agent-folder': return 'agent-folder';
          case 'context-file': return 'context-file';
          case 'context-folder': return 'context-folder';
          default: return undefined;
        }
      },
      renderItem: (item, itemEl) => {
        const iconEl = itemEl.createSpan({ cls: 'specorator-mention-icon' });
        switch (item.type) {
          case 'mcp-server':
            appendMcpIcon(iconEl);
            break;
          case 'agent':
          case 'agent-folder':
            setIcon(iconEl, 'bot');
            break;
          case 'context-file':
            setIcon(iconEl, 'folder-open');
            break;
          case 'folder':
          case 'context-folder':
            setIcon(iconEl, 'folder');
            break;
          default:
            setIcon(iconEl, 'file-text');
        }

        const textEl = itemEl.createSpan({ cls: 'specorator-mention-text' });

        switch (item.type) {
          case 'mcp-server':
            textEl.createSpan({ cls: 'specorator-mention-name' }).setText(`@${item.name}`);
            break;
          case 'agent-folder':
            textEl.createSpan({
              cls: 'specorator-mention-name specorator-mention-name-agent-folder',
            }).setText(`@${item.name}/`);
            break;
          case 'agent': {
            // Show ID (which is namespaced for plugin agents) for consistency with inserted text
            textEl.createSpan({
              cls: 'specorator-mention-name specorator-mention-name-agent',
            }).setText(`@${item.id}`);
            if (item.description) {
              textEl.createSpan({ cls: 'specorator-mention-agent-desc' }).setText(item.description);
            }
            break;
          }
          case 'context-folder':
            textEl.createSpan({
              cls: 'specorator-mention-name specorator-mention-name-folder',
            }).setText(`@${item.name}/`);
            break;
          case 'context-file':
            textEl.createSpan({
              cls: 'specorator-mention-name specorator-mention-name-context',
            }).setText(item.name);
            break;
          case 'folder':
            textEl.createSpan({
              cls: 'specorator-mention-name specorator-mention-name-folder',
            }).setText(`@${item.path}/`);
            break;
          default:
            textEl.createSpan({ cls: 'specorator-mention-path' }).setText(item.path || item.name);
        }
      },
      onItemClick: (item, index, e) => {
        // Stop propagation for folder items to prevent document click handler
        // from hiding dropdown (since dropdown is re-rendered with new DOM)
        if (item.type === 'context-folder' || item.type === 'agent-folder') {
          e.stopPropagation();
        }
        this.selectedMentionIndex = index;
        this.selectMentionItem();
      },
      onItemHover: (_item, index) => {
        this.selectedMentionIndex = index;
      },
    });

    if (this.fixed) {
      this.positionFixed();
    }
  }

  private positionFixed(): void {
    const dropdownEl = this.dropdown.getElement();
    if (!dropdownEl) return;

    const inputRect = this.inputEl.getBoundingClientRect();
    dropdownEl.setCssProps({
      '--specorator-fixed-dropdown-bottom': `${window.innerHeight - inputRect.top + 4}px`,
      '--specorator-fixed-dropdown-left': `${inputRect.left}px`,
      '--specorator-fixed-dropdown-width': `${Math.max(inputRect.width, 280)}px`,
    });
  }

  private insertReplacement(beforeAt: string, replacement: string, afterCursor: string): void {
    this.inputEl.value = beforeAt + replacement + afterCursor;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + replacement.length;
  }

  private returnToFirstLevel(): void {
    const text = this.inputEl.value;
    const beforeAt = text.substring(0, this.mentionStartIndex);
    const cursorPos = this.inputEl.selectionStart || 0;
    const afterCursor = text.substring(cursorPos);

    this.inputEl.value = beforeAt + '@' + afterCursor;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + 1;

    this.activeContextFilter = null;
    this.activeAgentFilter = false;

    this.showMentionDropdown('');
  }

  private selectMentionItem(): void {
    if (this.filteredMentionItems.length === 0) return;

    const selectedIndex = this.dropdown.getSelectedIndex();
    this.selectedMentionIndex = selectedIndex;
    const selectedItem = this.filteredMentionItems[selectedIndex];
    if (!selectedItem) return;

    const text = this.inputEl.value;
    const beforeAt = text.substring(0, this.mentionStartIndex);
    const cursorPos = this.inputEl.selectionStart || 0;
    const afterCursor = text.substring(cursorPos);

    switch (selectedItem.type) {
      case 'mcp-server': {
        const replacement = `@${selectedItem.name} `;
        this.insertReplacement(beforeAt, replacement, afterCursor);
        this.callbacks.addMentionedMcpServer(selectedItem.name);
        this.callbacks.onMcpMentionChange?.(this.callbacks.getMentionedMcpServers());
        break;
      }
      case 'agent-folder':
        // Don't modify input text - just show agents submenu
        this.activeAgentFilter = true;
        this.inputEl.focus();
        this.showMentionDropdown('Agents/');
        return;
      case 'agent': {
        const replacement = `@${selectedItem.id} (agent) `;
        this.insertReplacement(beforeAt, replacement, afterCursor);
        this.callbacks.onAgentMentionSelect?.(selectedItem.id);
        break;
      }
      case 'context-folder': {
        const replacement = `@${selectedItem.name}/`;
        this.insertReplacement(beforeAt, replacement, afterCursor);
        this.inputEl.focus();
        this.handleInputChange();
        return;
      }
      case 'context-file': {
        // Display friendly name in input; absolute path resolution happens at send time.
        const displayName = selectedItem.folderName
          ? `@${selectedItem.folderName}/${selectedItem.name}`
          : `@${selectedItem.name}`;
        if (selectedItem.absolutePath) {
          this.callbacks.onAttachFile(selectedItem.absolutePath);
        }
        this.insertReplacement(beforeAt, `${displayName} `, afterCursor);
        break;
      }
      case 'folder': {
        const normalizedPath = this.callbacks.normalizePathForVault(selectedItem.path);
        if (!normalizedPath) break; // can't resolve — leave the typed @query intact
        this.insertReplacement(beforeAt, '', afterCursor);
        this.callbacks.onAddContextPill(normalizedPath, 'folder');
        break;
      }
      default: {
        const rawPath = selectedItem.file?.path ?? selectedItem.path;
        const normalizedPath = this.callbacks.normalizePathForVault(rawPath);
        if (!normalizedPath) break; // can't resolve — leave the typed @query intact
        this.insertReplacement(beforeAt, '', afterCursor);
        this.callbacks.onAddContextPill(normalizedPath, 'file');
        break;
      }
    }

    this.hide();
    this.inputEl.focus();
  }
}
