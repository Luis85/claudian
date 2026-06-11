import { t } from '../../../../i18n/i18n';
import { CustomModelsTable } from '../../customModels/CustomModelsTable';
import { renderProviderSettingsWidget } from '../providers/providerWidgets';
import { registerProviderTab } from '../providers/registerProviderTab';
import { getSettingsRegistry } from '../registry';

// Field definitions mirror the legacy `cursorSettingsTabRenderer` (the parity
// source of truth — see tests/integration/settings/cursorPort). The
// family-grouped visible-models picker (search, count badge, refresh button),
// the hostname-keyed CLI path editor, and the environment section mount the
// SAME widget code the legacy tab uses, via the provider `widgets` seam.
//
// Deliberately absent:
// - the provider `enabled` toggle — the General tab owns
//   `providerConfigs.cursor.enabled`, and this tab is only visible while
//   Cursor is enabled;
// - a `modelAliases` editor — Cursor persists no `modelAliases` setting and
//   the legacy tab renders no such editor (custom-model aliases live in the
//   Custom models table; env-model aliases in the environment section). The
//   former registry stub pointed at a settings path nothing reads.
export function registerCursorTabFields(): void {
  const r = getSettingsRegistry();

  registerProviderTab(r, {
    providerId: 'cursor',
    label: 'Cursor',
    order: 50,
    sections: [
      { id: 'models', label: t('settings.models'), order: 10 },
      { id: 'environment', label: t('settings.environment'), order: 20 },
    ],
  });

  r.registerField({
    id: 'providerConfigs.cursor.enabledModelsByHost',
    tabId: 'cursor',
    sectionId: 'models',
    label: 'Visible models',
    description:
      'Choose which Cursor models appear in the picker. `auto` is always available.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'cursor', 'visibleModels'),
    },
    default: null,
    keywords: ['visible', 'enabled', 'models', 'families', 'picker', 'refresh'],
  });

  r.registerField({
    id: 'providerConfigs.cursor.customModels',
    tabId: 'cursor',
    sectionId: 'models',
    label: 'Custom models',
    description: 'Add custom model ids with optional aliases and context windows.',
    type: {
      kind: 'custom',
      render: (ctx, host) => {
        const table = new CustomModelsTable(host, 'cursor', ctx);
        table.render();
      },
    },
    default: null,
    keywords: ['custom', 'models', 'model id', 'alias', 'context window'],
  });

  // Decision 1: the persisted shape is the hostname-keyed map, not a flat
  // string. The widget edits the current host's entry. Lives under Models to
  // match the legacy tab's ordering (picker → refresh → CLI path).
  r.registerField({
    id: 'providerConfigs.cursor.cliPathsByHost',
    tabId: 'cursor',
    sectionId: 'models',
    label: 'Cursor Agent CLI path',
    description: 'Path to the `agent` binary, or leave empty to search PATH.',
    type: {
      kind: 'custom',
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'cursor', 'cliPathsByHost'),
    },
    default: null,
    keywords: ['cli', 'path', 'executable', 'binary', 'agent', 'cursor'],
  });

  r.registerField({
    id: 'providerConfigs.cursor.environmentVariables',
    tabId: 'cursor',
    sectionId: 'environment',
    label: 'Cursor Agent environment',
    description:
      'Variables such as CURSOR_API_KEY. Chats are stored under ~/.cursor/chats/<workspace-hash>/<session-id>/.',
    type: {
      kind: 'custom',
      // Heading intentionally omitted: the section walker renders it.
      render: (ctx, host) => renderProviderSettingsWidget(ctx, host, 'cursor', 'environment'),
    },
    default: '',
    keywords: ['environment', 'env', 'variables', 'api key', 'cursor'],
  });
}
