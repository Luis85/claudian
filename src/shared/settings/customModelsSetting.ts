import { Setting } from 'obsidian';

import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import type { ProviderCustomModel } from '../../core/types/settings';

// The textarea operates on a newline-delimited id string, while the persisted
// shape is ProviderCustomModel[]; serialize/parse coerce between the two so the
// legacy UI keeps round-tripping ids (J1 cleanup pending).
const serializeModelIds = (rows: readonly { id: string }[]): string =>
  rows.map((row) => row.id).join('\n');

const parseModelIds = (value: string): ProviderCustomModel[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((id, index, list) => id.length > 0 && list.indexOf(id) === index)
    .map((id) => ({ id, source: 'user' as const }));

const readString = (bag: Record<string, unknown>, key: string): string =>
  typeof bag[key] === 'string' ? (bag[key] as string) : '';

export interface CustomModelsSettingOptions {
  /** Settings row name. */
  name: string;
  /** Settings row description. */
  desc: string;
  /** Textarea placeholder. */
  placeholder: string;
  /** Textarea visible row count. */
  rows: number;
  /** The shared `asSettingsBag(...)` view used for model/title reconciliation. */
  settingsBag: Record<string, unknown>;
  /** The provider's currently persisted custom models. */
  currentModels: readonly { id: string }[];
  /** Persist the parsed models into the provider's settings slice. */
  applyCustomModels: (models: ProviderCustomModel[]) => void;
  /** Reconcile the active model selection for this provider. */
  reconcileActiveModelSelection: () => void;
  /**
   * Optional second reconcile pass — Codex re-projects its saved selection while
   * inactive. Receives the pre-commit serialized list and returns whether it
   * mutated state, so the commit can detect change and persist.
   */
  reconcileInactiveProjection?: (previousCustomModels: string) => boolean;
  saveSettings: () => Promise<void>;
  refreshModelSelectors: () => void;
}

/**
 * The "custom models" textarea shared by the Claude and Codex settings tabs.
 * Round-trips a newline-delimited id list against the persisted
 * `ProviderCustomModel[]`; on blur it commits, reconciles model selection (and
 * the title-generation model), then persists + refreshes selectors only when
 * something actually changed.
 */
export function mountCustomModelsSetting(
  container: HTMLElement,
  opts: CustomModelsSettingOptions,
): void {
  const { settingsBag } = opts;
  new Setting(container)
    .setName(opts.name)
    .setDesc(opts.desc)
    .addTextArea((text) => {
      let pendingCustomModels = serializeModelIds(opts.currentModels);
      let savedCustomModels = pendingCustomModels;

      const commitCustomModels = async (): Promise<void> => {
        const previousCustomModels = savedCustomModels;
        const previousModel = readString(settingsBag, 'model');
        const previousTitleModel = readString(settingsBag, 'titleGenerationModel');

        if (pendingCustomModels !== savedCustomModels) {
          opts.applyCustomModels(parseModelIds(pendingCustomModels));
          savedCustomModels = pendingCustomModels;
        }

        opts.reconcileActiveModelSelection();
        const didReconcileInactiveProjection =
          opts.reconcileInactiveProjection?.(previousCustomModels) ?? false;
        const didReconcileTitleModel =
          ProviderSettingsCoordinator.reconcileTitleGenerationModelSelection(settingsBag);
        const didModelSelectionChange = previousModel !== readString(settingsBag, 'model');
        const didCustomModelsChange = previousCustomModels !== savedCustomModels;

        if (
          !didCustomModelsChange &&
          !didModelSelectionChange &&
          !didReconcileInactiveProjection &&
          !didReconcileTitleModel &&
          previousTitleModel === readString(settingsBag, 'titleGenerationModel')
        ) {
          return;
        }

        await opts.saveSettings();
        opts.refreshModelSelectors();
      };

      text
        .setPlaceholder(opts.placeholder)
        .setValue(serializeModelIds(opts.currentModels))
        .onChange((value) => {
          pendingCustomModels = value;
        });
      text.inputEl.rows = opts.rows;
      text.inputEl.cols = 40;
      text.inputEl.addEventListener('blur', () => {
        void commitCustomModels();
      });
    });
}
