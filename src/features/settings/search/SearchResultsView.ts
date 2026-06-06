import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { SettingsField } from '../registry/SettingsField';

interface GroupedResults {
  [tabId: string]: {
    [sectionId: string]: SettingsField[];
  };
}

export class SearchResultsView {
  constructor(
    private readonly host: HTMLElement,
    private readonly results: SettingsField[],
    private readonly onGoTo: (tabId: string, sectionId: string, fieldId: string) => void,
    private readonly onReset: () => void,
  ) {}

  render(): void {
    this.host.empty();

    if (this.results.length === 0) {
      this.renderEmptyState();
      return;
    }

    this.renderResults();
  }

  private renderEmptyState(): void {
    const container = this.host.createDiv({ cls: 'claudian-search-empty' });
    container.createEl('p', { text: 'Nothing matches. Try fewer words.' });
    const resetBtn = container.createEl('button', { text: 'Reset' });
    resetBtn.dataset.action = 'reset';
    resetBtn.onclick = () => this.onReset();
  }

  private renderResults(): void {
    const grouped = this.groupByTabAndSection();

    // Tab order: general, <registered providers in registration order>, agentBoard, diagnostics.
    // Provider tab ids match provider ids by convention (see registry/providers/registerProviderTab.ts).
    const tabOrder = [
      'general',
      ...ProviderRegistry.getRegisteredProviderIds(),
      'agentBoard',
      'diagnostics',
    ];
    const sortedTabIds = Object.keys(grouped).sort((a, b) => {
      const aIdx = tabOrder.indexOf(a);
      const bIdx = tabOrder.indexOf(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    for (const tabId of sortedTabIds) {
      const tabDiv = this.host.createDiv({ cls: 'claudian-search-tab-group' });
      tabDiv.dataset.tab = tabId;

      const sections = grouped[tabId];
      const sortedSectionIds = Object.keys(sections).sort();
      for (const sectionId of sortedSectionIds) {
        const fields = sections[sectionId];
        const sectionDiv = tabDiv.createDiv({ cls: 'claudian-search-section-group' });
        sectionDiv.dataset.section = sectionId;

        for (const field of fields) {
          this.renderFieldRow(sectionDiv, field);
        }
      }
    }
  }

  private renderFieldRow(container: HTMLElement, field: SettingsField): void {
    const row = container.createDiv({ cls: 'claudian-search-field-row' });
    row.dataset.fieldId = field.id;

    // Breadcrumb
    const breadcrumb = row.createDiv({ cls: 'claudian-search-breadcrumb' });
    breadcrumb.createSpan({ text: field.tabId });
    breadcrumb.createSpan({ text: ' › ' });
    breadcrumb.createSpan({ text: field.sectionId });
    breadcrumb.createSpan({ text: ' › ' });
    breadcrumb.createSpan({ text: field.label });

    // Label and description
    const content = row.createDiv({ cls: 'claudian-search-content' });
    content.createEl('strong', { text: field.label });
    if (field.description) {
      content.createEl('p', { text: field.description, cls: 'claudian-search-description' });
    }

    // Go button
    const goBtn = row.createEl('button', { text: 'Go' });
    goBtn.dataset.action = 'go';
    goBtn.onclick = () => this.onGoTo(field.tabId, field.sectionId, field.id);
  }

  private groupByTabAndSection(): GroupedResults {
    const grouped: GroupedResults = {};

    for (const field of this.results) {
      if (!grouped[field.tabId]) {
        grouped[field.tabId] = {};
      }
      if (!grouped[field.tabId][field.sectionId]) {
        grouped[field.tabId][field.sectionId] = [];
      }
      grouped[field.tabId][field.sectionId].push(field);
    }

    return grouped;
  }
}
