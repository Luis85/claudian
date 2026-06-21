import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';

import { t } from '../../../../i18n/i18n';
import type ClaudianPlugin from '../../../../main';
import { installPresetAgents } from '../presetAgents';
import { createRosterAgent, dedupeRosterId, toolCapabilityId } from '../rosterCapabilities';
import type { RosterAgent } from '../rosterTypes';

export const VIEW_TYPE_AGENT_ROSTER = 'claudian-agent-roster';

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

  private async renderList(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('claudian-roster');
    const header = root.createDiv({ cls: 'claudian-roster-header' });
     
    header.createEl('h2', { text: t('agentRoster.title') });
     
    header.createEl('button', { text: t('agentRoster.newAgent') }).onclick = async () => {
      const existing = await this.store.list();
      const agent = createRosterAgent('New Agent', Date.now());
      const uniqueId = dedupeRosterId(agent.id, existing.map((a) => a.id));
      if (uniqueId !== agent.id) {
        agent.id = uniqueId;
        agent.name = `New Agent ${uniqueId.split('-').pop()}`;
      }
      await this.store.save(agent);
      await this.renderDetail(agent);
    };

    header.createEl('button', { text: t('agentRoster.installStarter') }).onclick = async () => {
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
    };

    const agents = await this.store.list();
    const list = root.createDiv({ cls: 'claudian-roster-list' });
    if (agents.length === 0) {
      list.createEl('p', { text: t('agentRoster.emptyState') });
    }
    for (const agent of agents) {
      const card = list.createDiv({ cls: 'claudian-roster-card' });
      card.createEl('div', { cls: 'claudian-roster-card-name', text: agent.name });
      card.createEl('div', { cls: 'claudian-roster-card-desc', text: agent.description });
      card.createEl('div', {
        cls: 'claudian-roster-card-caps',
        text: `${agent.skills.length} skills · ${agent.tools.length} tools`,
      });
      card.onclick = () => void this.renderDetail(agent);

      // Per-card "Start chat" action — stopPropagation so the card body click
      // (which opens the detail view) doesn't also fire.
      const actions = card.createDiv({ cls: 'claudian-roster-card-actions' });
      const startChatBtn = actions.createEl('button', { text: t('agentRoster.startChat') });
      startChatBtn.onclick = (e) => {
        e.stopPropagation();
        void this.startChatWithAgent(agent);
      };
    }
  }

  /**
   * Opens a chat bound to the agent on its preferred provider: an explicit
   * `providerOverride` wins, else the model selection's provider, else the
   * conversation store's default. The agent is provider-neutral, so this lets it
   * run on whichever backend the user configured for it.
   */
  private async startChatWithAgent(agent: RosterAgent): Promise<void> {
    const providerId = agent.providerOverride ?? agent.modelSelection?.providerId;
    const conversation = await this.plugin.createConversation({
      providerId,
      boundAgentId: agent.id,
    });
    await this.plugin.openConversation(conversation.id);
  }

  private async renderDetail(agent: RosterAgent): Promise<void> {
    const root = this.contentEl;
    root.empty();
    const back = root.createEl('button', { text: t('agentRoster.back') });
    back.onclick = () => void this.renderList();

    const nameInput = this.field(root, t('agentRoster.fieldName'), agent.name);
    const descInput = this.field(root, t('agentRoster.fieldDescription'), agent.description);
    const promptArea = this.textArea(root, t('agentRoster.fieldInstructions'), agent.prompt);

    // Skills picker
    root.createEl('h3', { text: t('agentRoster.skills') });
    const skillBox = root.createDiv();
    const skillEntries = (await this.plugin.vaultSkillAggregator?.listAll()) ?? [];
    for (const s of skillEntries) {
      const label = skillBox.createEl('label');
      const cb = label.createEl('input', { type: 'checkbox' });
      cb.checked = agent.skills.includes(s.name);
      cb.onchange = () => {
        agent.skills = cb.checked
          ? [...new Set([...agent.skills, s.name])]
          : agent.skills.filter((n) => n !== s.name);
      };
      label.appendText(` ${s.name}`);
    }

    // Tools picker (user tools from the registry)
    root.createEl('h3', { text: t('agentRoster.tools') });
    const toolBox = root.createDiv();
    for (const t of this.plugin.toolRegistry?.list() ?? []) {
      if (t.error || !t.module) continue;
      const cap = toolCapabilityId(t.module.manifest.name);
      const label = toolBox.createEl('label');
      const cb = label.createEl('input', { type: 'checkbox' });
      cb.checked = agent.tools.includes(cap);
      cb.onchange = () => {
        agent.tools = cb.checked
          ? [...new Set([...agent.tools, cap])]
          : agent.tools.filter((n) => n !== cap);
      };
      label.appendText(` ${t.module.manifest.name} — ${t.module.manifest.description}`);
    }

    const save = root.createEl('button', { text: t('agentRoster.save') });
    save.onclick = async () => {
      agent.name = nameInput.value;
      agent.description = descInput.value;
      agent.prompt = promptArea.value;
      agent.updatedAt = Date.now();
      await this.store.save(agent);
      await this.renderList();
    };

    const startChat = root.createEl('button', { text: t('agentRoster.startChat') });
    startChat.onclick = () => void this.startChatWithAgent(agent);
  }

  private field(parent: HTMLElement, label: string, value: string): HTMLInputElement {
    parent.createEl('label', { text: label });
    const input = parent.createEl('input', { type: 'text' });
    input.value = value;
    return input;
  }

  private textArea(parent: HTMLElement, label: string, value: string): HTMLTextAreaElement {
    parent.createEl('label', { text: label });
    const area = parent.createEl('textarea');
    area.value = value;
    return area;
  }
}
