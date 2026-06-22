import { type DropdownComponent, Notice, Setting } from 'obsidian';

import { ProviderRegistry } from '../../../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../../../core/providers/types';
import { asSettingsBag } from '../../../../core/types/settings';
import { t } from '../../../../i18n/i18n';
import type ClaudianPlugin from '../../../../main';
import { confirm } from '../../../../shared/modals/ConfirmModal';
import { renderAgentAvatar } from '../../agentAvatar';
import { rosterAgentToPersona } from '../../personaRegistry';
import { agentPreferredProviderId } from '../resolveAgentProvider';
import { toolCapabilityId } from '../rosterCapabilities';
import { isRosterAgentDirty } from '../rosterDirty';
import type { RosterAgent } from '../rosterTypes';
import { type CapabilityItem, renderCapabilityPicker } from './CapabilityPicker';

const AVATAR_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];
const ICON_CHOICES = ['bot', 'bug', 'wrench', 'telescope', 'flask-conical', 'map', 'shield-check', 'pencil', 'book-open', 'search', 'sparkles', 'code'];
const DETAIL_AVATAR_SIZE = 48;

export interface AgentDetailEditorCallbacks {
  onBack(): void;
  onStartChat(agent: RosterAgent): void;
  onDeleted(agent: RosterAgent): void;
}

/** Owns the agent detail/edit page: cards, pickers, dirty tracking, sticky footer. */
export class AgentDetailEditor {
  private avatarHost: HTMLElement | null = null;
  private dirtyDot: HTMLElement | null = null;
  private original!: RosterAgent;
  private draft!: RosterAgent;

  constructor(private readonly plugin: ClaudianPlugin, private readonly callbacks: AgentDetailEditorCallbacks) {}

  async render(root: HTMLElement, agent: RosterAgent): Promise<void> {
    this.original = agent;
    this.draft = { ...agent, roles: [...agent.roles], skills: [...agent.skills], tools: [...agent.tools] };

    root.empty();
    root.removeClass('claudian-roster');
    root.addClass('claudian-roster-detail');

    this.renderTopbar(root);
    this.renderHeaderCard(root);
    this.renderModelCard(root);
    this.renderInstructionsCard(root);
    await this.renderSkillsCard(root);
    this.renderToolsCard(root);
    this.renderFooter(root);
    this.updateDirty();
  }

  private card(root: HTMLElement, heading?: string): HTMLElement {
    const card = root.createDiv({ cls: 'claudian-roster-card-section' });
    if (heading) card.createEl('h3', { cls: 'claudian-roster-section', text: heading });
    return card;
  }

  private renderTopbar(root: HTMLElement): void {
    const topbar = root.createDiv({ cls: 'claudian-roster-detail-topbar' });
    const back = topbar.createEl('button', { text: t('agentRoster.back') });
    back.onclick = () => this.handleBack();
  }

  private handleBack(): void {
    if (!isRosterAgentDirty(this.original, this.draft)) {
      this.callbacks.onBack();
      return;
    }
    void confirm(this.plugin.app, t('agentRoster.discardConfirm'), t('agentRoster.discard')).then((ok) => {
      if (ok) this.callbacks.onBack();
    });
  }

  private renderHeaderCard(root: HTMLElement): void {
    const head = root.createDiv({ cls: 'claudian-roster-detail-head' });
    this.avatarHost = head.createDiv({ cls: 'claudian-roster-detail-avatar' });
    this.refreshAvatar();

    const fields = head.createDiv({ cls: 'claudian-roster-detail-headfields' });
    const nameEl = fields.createEl('input', { cls: 'claudian-roster-detail-name', type: 'text' });
    nameEl.value = this.draft.name;
    nameEl.placeholder = t('agentRoster.fieldName');
    nameEl.addEventListener('input', () => {
      this.draft.name = nameEl.value;
      this.refreshAvatar();
      this.updateDirty();
    });
    const descEl = fields.createEl('input', { cls: 'claudian-roster-detail-desc', type: 'text' });
    descEl.value = this.draft.description;
    descEl.placeholder = t('agentRoster.fieldDescription');
    descEl.addEventListener('input', () => { this.draft.description = descEl.value; this.updateDirty(); });

    this.renderAppearanceRow(fields);
    this.renderRolesRow(fields);
  }

  private renderAppearanceRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: 'claudian-roster-appearance' });

    const color = row.createEl('select', { cls: 'claudian-roster-appearance-color dropdown' });
    color.createEl('option', { value: '', text: t('agentRoster.colorNone') });
    for (const name of AVATAR_COLORS) color.createEl('option', { value: `var(--color-${name})`, text: name });
    color.value = this.draft.color ?? '';
    color.addEventListener('change', () => {
      this.draft.color = color.value || undefined;
      this.refreshAvatar();
      this.updateDirty();
    });

    const initials = row.createEl('input', { cls: 'claudian-roster-appearance-initials', type: 'text' });
    initials.maxLength = 2;
    initials.value = this.draft.initials ?? '';
    initials.placeholder = t('agentRoster.initials');
    initials.addEventListener('input', () => {
      this.draft.initials = initials.value.toUpperCase() || undefined;
      this.refreshAvatar();
      this.updateDirty();
    });

    const iconSelect = row.createEl('select', { cls: 'claudian-roster-appearance-icon dropdown' });
    iconSelect.setAttribute('aria-label', t('agentRoster.icon'));
    iconSelect.createEl('option', { value: '', text: t('agentRoster.iconNone') });
    for (const name of ICON_CHOICES) iconSelect.createEl('option', { value: name, text: name });
    iconSelect.value = this.draft.icon ?? '';
    iconSelect.addEventListener('change', () => {
      this.draft.icon = iconSelect.value || undefined;
      this.refreshAvatar();
      this.updateDirty();
    });
  }

  private renderRolesRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: 'claudian-roster-roles' });
    const roles: Array<['worker' | 'verifier', string]> = [
      ['worker', t('agentRoster.roleWorker')],
      ['verifier', t('agentRoster.roleVerifier')],
    ];
    for (const [role, label] of roles) {
      const chip = row.createEl('button', { cls: 'claudian-roster-role-chip', text: label });
      const sync = (): void => { chip.classList.toggle('is-on', this.draft.roles.includes(role)); };
      sync();
      chip.addEventListener('click', () => {
        this.draft.roles = this.draft.roles.includes(role)
          ? this.draft.roles.filter((r) => r !== role)
          : [...this.draft.roles, role];
        sync();
        this.updateDirty();
      });
    }
  }

  private renderModelCard(root: HTMLElement): void {
    const card = this.card(root, t('agentRoster.sectionModel'));
    const grid = card.createDiv({ cls: 'claudian-roster-model-grid' });
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
      const current = this.draft.modelSelection?.modelId ?? '';
      modelDropdown.setValue(options.some((o) => o.value === current) ? current : '');
    };

    new Setting(grid).setName(t('agentRoster.provider')).addDropdown((c) => {
      c.addOption('', t('agentRoster.providerDefault'));
      for (const id of providerIds) c.addOption(id, id);
      c.setValue(this.draft.providerOverride ?? '');
      c.onChange((v) => {
        this.draft.providerOverride = (v || undefined) as ProviderId | undefined;
        this.draft.modelSelection = undefined;
        populateModels(v);
        this.updateDirty();
      });
    });

    new Setting(grid).setName(t('agentRoster.model')).addDropdown((c) => {
      modelDropdown = c;
      c.onChange((v) => {
        const providerId = agentPreferredProviderId(this.draft) ?? providerIds[0];
        this.draft.modelSelection = v && providerId ? { modelId: v, providerId } : undefined;
        this.updateDirty();
      });
      populateModels(agentPreferredProviderId(this.draft) ?? '');
    });
  }

  private renderInstructionsCard(root: HTMLElement): void {
    const card = this.card(root, t('agentRoster.sectionInstructions'));
    const ta = card.createEl('textarea', { cls: 'claudian-roster-prompt-area' });
    ta.value = this.draft.prompt;
    ta.rows = 8;
    ta.addEventListener('input', () => { this.draft.prompt = ta.value; this.updateDirty(); });
  }

  private async renderSkillsCard(root: HTMLElement): Promise<void> {
    const card = this.card(root);
    const entries = (await this.plugin.vaultSkillAggregator?.listAll()) ?? [];
    const items: CapabilityItem[] = entries.map((e) => ({
      id: e.name, name: e.name, description: e.description, badge: e.providerDisplayName,
    }));
    renderCapabilityPicker(card, {
      label: t('agentRoster.skills'),
      items,
      selectedIds: this.draft.skills,
      emptyHint: t('agentRoster.noSkillsHint'),
      searchPlaceholder: t('agentRoster.searchSkills'),
      onChange: (ids) => { this.draft.skills = ids; this.updateDirty(); },
    });
  }

  private renderToolsCard(root: HTMLElement): void {
    const card = this.card(root);
    const tools = (this.plugin.toolRegistry?.list() ?? []).filter((tool) => tool.module && !tool.error);
    const items: CapabilityItem[] = tools.flatMap((tool) =>
      tool.module ? [{ id: toolCapabilityId(tool.module.manifest.name), name: tool.module.manifest.name, description: tool.module.manifest.description }] : [],
    );
    renderCapabilityPicker(card, {
      label: t('agentRoster.tools'),
      items,
      selectedIds: this.draft.tools,
      emptyHint: t('agentRoster.noToolsHint'),
      searchPlaceholder: t('agentRoster.searchTools'),
      onChange: (ids) => { this.draft.tools = ids; this.updateDirty(); },
    });
  }

  private renderFooter(root: HTMLElement): void {
    const footer = root.createDiv({ cls: 'claudian-roster-detail-footer' });
    this.dirtyDot = footer.createSpan({ cls: 'claudian-roster-dirty', text: t('agentRoster.unsavedChanges') });
    footer.createDiv({ cls: 'claudian-roster-footer-spacer' });

    const save = footer.createEl('button', { cls: 'mod-cta', text: t('agentRoster.save') });
    save.onclick = () => void this.save();
    const start = footer.createEl('button', { text: t('agentRoster.startChat') });
    // Start chat binds by persisted agent id + config; pass the saved agent so a
    // dirty, unsaved provider/model edit can't diverge from what actually launches.
    start.onclick = () => this.callbacks.onStartChat(this.original);
    const del = footer.createEl('button', { cls: 'claudian-roster-card-delete', text: t('agentRoster.delete') });
    del.onclick = () => this.callbacks.onDeleted(this.original);
  }

  private async save(): Promise<void> {
    this.draft.updatedAt = Date.now();
    await this.plugin.agentRosterStore?.save(this.draft);
    this.original = { ...this.draft, roles: [...this.draft.roles], skills: [...this.draft.skills], tools: [...this.draft.tools] };
    new Notice(t('agentRoster.saved', { name: this.draft.name }));
    this.updateDirty();
  }

  private updateDirty(): void {
    this.dirtyDot?.classList.toggle('is-visible', isRosterAgentDirty(this.original, this.draft));
  }

  private refreshAvatar(): void {
    if (!this.avatarHost) return;
    this.avatarHost.empty();
    renderAgentAvatar(this.avatarHost, rosterAgentToPersona(this.draft), DETAIL_AVATAR_SIZE);
  }
}
