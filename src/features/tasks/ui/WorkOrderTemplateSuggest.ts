import type { App } from 'obsidian';
import { FuzzySuggestModal } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import { TemplateNoteStore } from '../templates/TemplateNoteStore';
import { buildTemplateChoices } from '../templates/templateResolution';
import type { TemplateChoice, WorkOrderTemplate } from '../templates/templateTypes';

class WorkOrderTemplateSuggest extends FuzzySuggestModal<TemplateChoice> {
  private chosen = false;

  constructor(
    app: App,
    private readonly choices: TemplateChoice[],
    private readonly resolve: (choice: TemplateChoice | null) => void,
  ) {
    super(app);
    this.setPlaceholder('Pick a work-order template');
  }

  getItems(): TemplateChoice[] {
    return this.choices;
  }

  getItemText(choice: TemplateChoice): string {
    return choice.kind === 'blank' ? 'Blank' : choice.template.name;
  }

  onChooseItem(choice: TemplateChoice, _evt: MouseEvent | KeyboardEvent): void {
    this.chosen = true;
    this.resolve(choice);
  }

  onClose(): void {
    super.onClose();
    if (!this.chosen) {
      this.resolve(null);
    }
  }
}

export interface TemplatePickResult {
  cancelled: boolean;
  template?: WorkOrderTemplate;
}

export async function chooseWorkOrderTemplate(plugin: ClaudianPlugin): Promise<TemplatePickResult> {
  const folder = (plugin.settings.agentBoardTemplateFolder || 'Agent Board/templates').replace(/^\/+|\/+$/g, '');
  const { templates } = await new TemplateNoteStore().list(plugin.app.vault, folder);
  if (templates.length === 0) {
    return { cancelled: false };
  }
  const choice = await new Promise<TemplateChoice | null>((resolve) => {
    new WorkOrderTemplateSuggest(plugin.app, buildTemplateChoices(templates), resolve).open();
  });
  if (!choice) {
    return { cancelled: true };
  }
  return { cancelled: false, template: choice.kind === 'template' ? choice.template : undefined };
}
