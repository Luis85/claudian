import { type DropdownComponent, ItemView, Notice, Setting, type WorkspaceLeaf } from 'obsidian';

import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../../core/providers/types';
import { asSettingsBag } from '../../../../core/types/settings';
import { t } from '../../../../i18n/i18n';
import type ClaudianPlugin from '../../../../main';
import { renderLibraryNav } from '../../../../shared/libraryNav';
import { confirm } from '../../../../shared/modals/ConfirmModal';
import { withErrorNotice } from '../../../../shared/uiAction';
import { renderAgentAvatar } from '../../agentAvatar';
import { rosterAgentToPersona } from '../../personaRegistry';
import { installPresetAgents } from '../presetAgents';
import { createRosterAgent, dedupeRosterId, toolCapabilityId } from '../rosterCapabilities';
import type { RosterAgent } from '../rosterTypes';

export const VIEW_TYPE_AGENT_ROSTER = 'claudian-agent-roster';

// Obsidian theme color variables offered for an agent's avatar accent.
const AVATAR_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];
const AVATAR_AVATAR_SIZE = 48;
const CARD_AVATAR_SIZE = 36;

export class AgentRosterView extends ItemView {
  private avatarHostEl: HTMLElement | null = null;

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
      list.createEl('p', { cls: 'claudian-roster-empty', text: t('agentRoster.emptyState') });
      return;
    }

    for (const agent of agents) {
      this.renderCard(list, agent);
    }
  }

  private renderCard(list: HTMLElement, agent: RosterAgent): void {
    const card = list.createDiv({ cls: 'claudian-roster-card' });
    card.onclick = () => void this.renderDetail(agent);
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
    caps.createSpan({
      cls: 'claudian-roster-chip',
      text: `${agent.skills.length} skills · ${agent.tools.length} tools`,
    });

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
        void this.renderDetail(agent);
      }
    });
  }

  // ── Detail editor ─────────────────────────────────────────────────────────

  private async renderDetail(agent: RosterAgent): Promise<void> {
    // Edit a working copy so unsaved field edits don't mutate the list's object.
    const draft: RosterAgent = { ...agent, roles: [...agent.roles] };
    const root = this.contentEl;
    root.empty();
    root.removeClass('claudian-roster');
    root.addClass('claudian-roster-detail');

    const topbar = root.createDiv({ cls: 'claudian-roster-detail-topbar' });
    const back = topbar.createEl('button', { text: t('agentRoster.back') });
    back.onclick = () => void this.renderList();

    const head = root.createDiv({ cls: 'claudian-roster-detail-head' });
    this.avatarHostEl = head.createDiv({ cls: 'claudian-roster-detail-avatar' });
    this.refreshAvatar(draft);
    const titleEl = head.createEl('h2', { cls: 'claudian-roster-detail-title', text: draft.name });

    // Identity
    this.sectionHeading(root, t('agentRoster.sectionIdentity'));
    new Setting(root).setName(t('agentRoster.fieldName')).addText((c) =>
      c.setValue(draft.name).onChange((v) => {
        draft.name = v;
        titleEl.setText(v);
        this.refreshAvatar(draft);
      }),
    );
    new Setting(root).setName(t('agentRoster.fieldDescription')).addText((c) =>
      c.setValue(draft.description).onChange((v) => { draft.description = v; }),
    );

    // Appearance
    this.sectionHeading(root, t('agentRoster.sectionAppearance'));
    new Setting(root).setName(t('agentRoster.color')).addDropdown((c) => {
      c.addOption('', t('agentRoster.providerDefault'));
      for (const name of AVATAR_COLORS) c.addOption(`var(--color-${name})`, name);
      c.setValue(draft.color ?? '').onChange((v) => {
        draft.color = v || undefined;
        this.refreshAvatar(draft);
      });
    });
    new Setting(root).setName(t('agentRoster.initials')).addText((c) => {
      c.setValue(draft.initials ?? '');
      c.inputEl.maxLength = 2;
      c.onChange((v) => {
        draft.initials = v.toUpperCase() || undefined;
        this.refreshAvatar(draft);
      });
    });

    // Model (provider + model selectors)
    this.sectionHeading(root, t('agentRoster.sectionModel'));
    this.renderModelSection(root, draft);

    // Instructions
    this.sectionHeading(root, t('agentRoster.sectionInstructions'));
    const promptSetting = new Setting(root).setClass('claudian-roster-prompt-setting');
    promptSetting.settingEl.addClass('claudian-roster-prompt');
    promptSetting.addTextArea((c) => {
      c.setValue(draft.prompt).onChange((v) => { draft.prompt = v; });
      c.inputEl.rows = 8;
    });

    // Skills + Tools
    this.sectionHeading(root, t('agentRoster.skills'));
    await this.renderSkillPicker(root, draft);
    this.sectionHeading(root, t('agentRoster.tools'));
    this.renderToolPicker(root, draft);

    // Roles
    this.sectionHeading(root, t('agentRoster.sectionRoles'));
    this.renderRoleToggle(root, draft, 'worker', t('agentRoster.roleWorker'));
    this.renderRoleToggle(root, draft, 'verifier', t('agentRoster.roleVerifier'));

    // Footer actions
    const footer = root.createDiv({ cls: 'claudian-roster-detail-footer' });
    const fail = t('agentRoster.actionFailed');
    const save = footer.createEl('button', { cls: 'mod-cta', text: t('agentRoster.save') });
    save.onclick = () => void withErrorNotice(() => this.saveDraft(draft), fail, (e) => this.fail(e));
    const start = footer.createEl('button', { text: t('agentRoster.startChat') });
    start.onclick = () => void withErrorNotice(() => this.startChatWithAgent(draft), fail, (e) => this.fail(e));
    const del = footer.createEl('button', { cls: 'claudian-roster-card-delete', text: t('agentRoster.delete') });
    del.onclick = () => void withErrorNotice(() => this.deleteAgent(draft), fail, (e) => this.fail(e));
  }

  private renderModelSection(root: HTMLElement, draft: RosterAgent): void {
    const settings = asSettingsBag(this.plugin.settings);
    const providerIds = ProviderRegistry.getEnabledProviderIds(settings);
    let modelDropdown: DropdownComponent | null = null;

    const populateModels = (providerId: string): void => {
      if (!modelDropdown) return;
      modelDropdown.selectEl.empty();
      modelDropdown.addOption('', t('agentRoster.modelDefault'));
      const options = providerId
        ? ProviderRegistry.getChatUIConfig(providerId as ProviderId).getModelOptions(settings)
        : [];
      for (const o of options) modelDropdown.addOption(o.value, o.label);
      const current = draft.modelSelection?.modelId ?? '';
      modelDropdown.setValue(options.some((o) => o.value === current) ? current : '');
    };

    new Setting(root).setName(t('agentRoster.provider')).addDropdown((c) => {
      c.addOption('', t('agentRoster.providerDefault'));
      for (const id of providerIds) c.addOption(id, id);
      c.setValue(draft.providerOverride ?? '');
      c.onChange((v) => {
        draft.providerOverride = (v || undefined) as ProviderId | undefined;
        // Provider changed → the stored model no longer applies; clear it.
        draft.modelSelection = undefined;
        populateModels(v);
      });
    });

    new Setting(root).setName(t('agentRoster.model')).addDropdown((c) => {
      modelDropdown = c;
      c.onChange((v) => {
        const providerId = (draft.providerOverride
          ?? draft.modelSelection?.providerId
          ?? providerIds[0]) as ProviderId | undefined;
        draft.modelSelection = v && providerId ? { modelId: v, providerId } : undefined;
      });
      populateModels(draft.providerOverride ?? draft.modelSelection?.providerId ?? '');
    });
  }

  private async renderSkillPicker(root: HTMLElement, draft: RosterAgent): Promise<void> {
    const box = root.createDiv({ cls: 'claudian-roster-picker' });
    const entries = (await this.plugin.vaultSkillAggregator?.listAll()) ?? [];
    if (entries.length === 0) {
      box.createEl('p', { cls: 'claudian-roster-picker-empty', text: t('agentRoster.noSkillsHint') });
      return;
    }
    for (const s of entries) {
      const label = box.createEl('label', { cls: 'claudian-roster-picker-row' });
      const cb = label.createEl('input', { type: 'checkbox' });
      cb.checked = draft.skills.includes(s.name);
      cb.onchange = () => {
        draft.skills = cb.checked
          ? [...new Set([...draft.skills, s.name])]
          : draft.skills.filter((n) => n !== s.name);
      };
      label.appendText(` ${s.name}`);
    }
  }

  private renderToolPicker(root: HTMLElement, draft: RosterAgent): void {
    const box = root.createDiv({ cls: 'claudian-roster-picker' });
    const tools = (this.plugin.toolRegistry?.list() ?? []).filter((tool) => tool.module && !tool.error);
    if (tools.length === 0) {
      box.createEl('p', { cls: 'claudian-roster-picker-empty', text: t('agentRoster.noToolsHint') });
      return;
    }
    for (const tool of tools) {
      if (!tool.module) continue;
      const cap = toolCapabilityId(tool.module.manifest.name);
      const label = box.createEl('label', { cls: 'claudian-roster-picker-row' });
      const cb = label.createEl('input', { type: 'checkbox' });
      cb.checked = draft.tools.includes(cap);
      cb.onchange = () => {
        draft.tools = cb.checked
          ? [...new Set([...draft.tools, cap])]
          : draft.tools.filter((n) => n !== cap);
      };
      label.appendText(` ${tool.module.manifest.name} — ${tool.module.manifest.description}`);
    }
  }

  private renderRoleToggle(
    root: HTMLElement,
    draft: RosterAgent,
    role: 'worker' | 'verifier',
    name: string,
  ): void {
    new Setting(root).setName(name).addToggle((c) =>
      c.setValue(draft.roles.includes(role)).onChange((on) => {
        draft.roles = on
          ? [...new Set([...draft.roles, role])]
          : draft.roles.filter((r) => r !== role);
      }),
    );
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private async createAndEdit(): Promise<void> {
    const existing = await this.store.list();
    const agent = createRosterAgent('New Agent', Date.now());
    const uniqueId = dedupeRosterId(agent.id, existing.map((a) => a.id));
    if (uniqueId !== agent.id) {
      agent.id = uniqueId;
      agent.name = `New Agent ${uniqueId.split('-').pop()}`;
    }
    await this.store.save(agent);
    await this.renderDetail(agent);
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

  private async saveDraft(draft: RosterAgent): Promise<void> {
    draft.updatedAt = Date.now();
    await this.store.save(draft);
    new Notice(t('agentRoster.saved', { name: draft.name }));
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

  // ── Helpers ──────────────────────────────────────────────────────────────

  private sectionHeading(root: HTMLElement, text: string): void {
    root.createEl('h3', { cls: 'claudian-roster-section', text });
  }

  private refreshAvatar(draft: RosterAgent): void {
    if (!this.avatarHostEl) return;
    this.avatarHostEl.empty();
    renderAgentAvatar(this.avatarHostEl, rosterAgentToPersona(draft), AVATAR_AVATAR_SIZE);
  }
}
