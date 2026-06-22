import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';

import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../../core/providers/types';
import { asSettingsBag } from '../../../../core/types/settings';
import { t } from '../../../../i18n/i18n';
import type ClaudianPlugin from '../../../../main';
import { renderLibraryNav } from '../../../../shared/libraryNav';
import { confirm } from '../../../../shared/modals/ConfirmModal';
import { withErrorNotice } from '../../../../shared/uiAction';
import { renderLibraryEmptyState } from '../../../../utils/libraryView';
import { renderAgentAvatar } from '../../agentAvatar';
import { rosterAgentToPersona } from '../../personaRegistry';
import { installPresetAgents } from '../presetAgents';
import { createRosterAgent, dedupeRosterId } from '../rosterCapabilities';
import type { RosterAgent } from '../rosterTypes';
import { AgentDetailEditor } from './AgentDetailEditor';

export const VIEW_TYPE_AGENT_ROSTER = 'claudian-agent-roster';

const CARD_AVATAR_SIZE = 36;

export class AgentRosterView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ClaudianPlugin) {
    super(leaf);
  }

  private get store() {
    return this.plugin.agentRosterStore;
  }

  getViewType(): string { return VIEW_TYPE_AGENT_ROSTER; }
  // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Agent Roster" is the product feature name.
  getDisplayText(): string { return 'Agent Roster'; }
  getIcon(): string { return 'users'; }

  async onOpen(): Promise<void> {
    await this.renderList();
  }

  // ── List / dashboard ──────────────────────────────────────────────────────

  private async renderList(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.removeClass('claudian-roster-detail');
    root.addClass('claudian-roster');

    renderLibraryNav(root, this.plugin, VIEW_TYPE_AGENT_ROSTER);

    const header = root.createDiv({ cls: 'claudian-roster-header' });
    header.createEl('h2', { text: t('agentRoster.title') });
    const headerActions = header.createDiv({ cls: 'claudian-roster-header-actions' });

    const fail = t('agentRoster.actionFailed');
    const newBtn = headerActions.createEl('button', { cls: 'mod-cta', text: t('agentRoster.newAgent') });
    newBtn.onclick = () => void withErrorNotice(() => this.createAndEdit(), fail, (e) => this.fail(e));

    const installBtn = headerActions.createEl('button', { text: t('agentRoster.installStarter') });
    installBtn.onclick = () => void withErrorNotice(() => this.installStarters(), fail, (e) => this.fail(e));

    const syncBtn = headerActions.createEl('button', { text: t('agentRoster.syncProviders') });
    syncBtn.onclick = () => void withErrorNotice(() => this.syncToProviders(), fail, (e) => this.fail(e));

    const agents = await this.store.list();
    const list = root.createDiv({ cls: 'claudian-roster-list' });
    if (agents.length === 0) {
      renderLibraryEmptyState(list, {
        icon: 'users',
        message: t('agentRoster.emptyState'),
        actionLabel: t('agentRoster.installStarter'),
        onAction: () => void withErrorNotice(() => this.installStarters(), fail, (e) => this.fail(e)),
      });
      return;
    }

    for (const agent of agents) {
      this.renderCard(list, agent);
    }
  }

  private renderCard(list: HTMLElement, agent: RosterAgent): void {
    const card = list.createDiv({ cls: 'claudian-roster-card' });
    card.onclick = () => void this.openDetail(agent);
    this.wireCardKeyboard(card, agent);

    const avatar = card.createDiv({ cls: 'claudian-roster-card-avatar' });
    renderAgentAvatar(avatar, rosterAgentToPersona(agent), CARD_AVATAR_SIZE);

    const body = card.createDiv({ cls: 'claudian-roster-card-body' });
    body.createDiv({ cls: 'claudian-roster-card-name', text: agent.name });
    body.createDiv({ cls: 'claudian-roster-card-desc', text: agent.description || '—' });

    const caps = body.createDiv({ cls: 'claudian-roster-card-caps' });
    for (const role of agent.roles) {
      const roleLabel = role === 'verifier' ? t('agentRoster.roleVerifier') : t('agentRoster.roleWorker');
      caps.createSpan({ cls: 'claudian-roster-chip claudian-roster-chip-role', text: roleLabel });
    }
    // Only surface the capability count once the agent actually has skills or
    // tools — a "0 · 0" chip on a fresh agent is noise.
    if (agent.skills.length > 0 || agent.tools.length > 0) {
      caps.createSpan({
        cls: 'claudian-roster-chip',
        text: t('agentRoster.capsSummary', {
          skills: String(agent.skills.length),
          tools: String(agent.tools.length),
        }),
      });
    }

    const actions = card.createDiv({ cls: 'claudian-roster-card-actions' });
    const fail = t('agentRoster.actionFailed');
    const startBtn = actions.createEl('button', { cls: 'mod-cta', text: t('agentRoster.startChatShort') });
    startBtn.onclick = (e) => {
      e.stopPropagation();
      void withErrorNotice(() => this.startChatWithAgent(agent), fail, (err) => this.fail(err));
    };
    const deleteBtn = actions.createEl('button', { cls: 'claudian-roster-card-delete', text: t('agentRoster.delete') });
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      void withErrorNotice(() => this.deleteAgent(agent), fail, (err) => this.fail(err));
    };
  }

  /** Makes the card open the detail editor on Enter/Space for keyboard users. */
  private wireCardKeyboard(card: HTMLElement, agent: RosterAgent): void {
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void this.openDetail(agent);
      }
    });
  }

  // ── Detail editor ─────────────────────────────────────────────────────────

  private async openDetail(agent: RosterAgent): Promise<void> {
    const editor = new AgentDetailEditor(this.plugin, {
      onBack: () => void this.renderList(),
      onStartChat: (a) => void withErrorNotice(() => this.startChatWithAgent(a), t('agentRoster.actionFailed'), (e) => this.fail(e)),
      onDeleted: (a) => void withErrorNotice(() => this.deleteAgent(a), t('agentRoster.actionFailed'), (e) => this.fail(e)),
    });
    await editor.render(this.contentEl, agent);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private async createAndEdit(): Promise<void> {
    const existing = await this.store.list();
    const agent = createRosterAgent(t('agentRoster.newAgent'), Date.now());
    const uniqueId = dedupeRosterId(agent.id, existing.map((a) => a.id));
    if (uniqueId !== agent.id) {
      agent.id = uniqueId;
      agent.name = `${t('agentRoster.newAgent')} ${uniqueId.split('-').pop()}`;
    }
    await this.store.save(agent);
    await this.openDetail(agent);
  }

  private async syncToProviders(): Promise<void> {
    const result = await this.plugin.syncRosterAgentsToProviders();
    if (result.failed.length > 0) {
      new Notice(t('agentRoster.syncFailed', { written: String(result.written), failed: String(result.failed.length) }));
      return;
    }
    new Notice(
      result.providers.length > 0
        ? t('agentRoster.syncDone', {
            written: String(result.written),
            providers: result.providers.join(', '),
          })
        : t('agentRoster.syncNone'),
    );
  }

  private fail(error: unknown): void {
    this.plugin.logger.scope('agents').error('roster action failed', error);
  }

  private async installStarters(): Promise<void> {
    const result = await installPresetAgents(this.store);
    new Notice(
      result.installed.length > 0
        ? t('agentRoster.installStarterDone', {
            installed: String(result.installed.length),
            skipped: String(result.skipped.length),
          })
        : t('agentRoster.installStarterNone'),
    );
    await this.renderList();
  }

  private async deleteAgent(agent: RosterAgent): Promise<void> {
    const ok = await confirm(
      this.plugin.app,
      t('agentRoster.deleteConfirm', { name: agent.name }),
      t('agentRoster.delete'),
    );
    if (!ok) return;
    await this.store.delete(agent.id);
    new Notice(t('agentRoster.deleted', { name: agent.name }));
    await this.renderList();
  }

  /**
   * Opens a chat bound to the agent on a supported provider. The agent's
   * preferred provider (explicit `providerOverride`, else its model's provider)
   * wins only when that provider is actually enabled; otherwise it falls back to
   * the user's active/default enabled provider. This prevents defaulting to a
   * disabled Claude (which would error with "CLI not found") when, say, only
   * Cursor is enabled.
   */
  private resolveAgentProvider(agent: RosterAgent): ProviderId {
    const settings = asSettingsBag(this.plugin.settings);
    const preferred = agent.providerOverride ?? agent.modelSelection?.providerId;
    if (preferred && ProviderRegistry.isEnabled(preferred, settings)) {
      return preferred;
    }
    return ProviderRegistry.resolveSettingsProviderId(settings);
  }

  private async startChatWithAgent(agent: RosterAgent): Promise<void> {
    const conversation = await this.plugin.createConversation({
      providerId: this.resolveAgentProvider(agent),
      boundAgentId: agent.id,
    });
    // Always open the agent in a fresh tab so it never hijacks a chat already in
    // use (e.g. a streaming conversation in the active tab).
    await this.plugin.openConversation(conversation.id, { requireNewTab: true });
  }
}
