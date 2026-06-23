import type { AgentsTranslationKey } from './types/agents';
import type { ChatTranslationKey } from './types/chat';
import type { CommandsTranslationKey } from './types/commands';
import type { CommonTranslationKey } from './types/common';
import type { DiagnosticsTranslationKey } from './types/diagnostics';
import type { EnvTranslationKey } from './types/env';
import type { InlineEditTranslationKey } from './types/inlineEdit';
import type { ProviderTranslationKey } from './types/provider';
import type { QuickActionsTranslationKey } from './types/quickActions';
import type { RibbonTranslationKey } from './types/ribbon';
import type { SecurityTranslationKey } from './types/security';
import type { SettingsTranslationKey } from './types/settings';
import type { TasksTranslationKey } from './types/tasks';
import type { ToolLibraryTranslationKey } from './types/toolLibrary';
import type { WorkOrderActivityTranslationKey } from './types/workOrderActivity';

export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'de' | 'fr' | 'es' | 'ru' | 'pt';

/**
 * Structured validation error returned by `validate*` / `parseOptional*` helpers
 * so callers can defer translation to the Notice boundary. See
 * docs/issues/translate-validator-helper-strings.md for the rollout plan.
 */
export interface ValidationError {
  key: TranslationKey;
  params?: Record<string, string | number>;
}

/**
 * Every translation key, composed from the per-namespace unions in `./types/`.
 * Add new keys to the matching namespace file (one literal per union line);
 * the locale JSON dictionaries in `./locales/` carry the actual strings.
 */
export type TranslationKey =
  | CommonTranslationKey
  | ChatTranslationKey
  | DiagnosticsTranslationKey
  | SettingsTranslationKey
  | EnvTranslationKey
  | ProviderTranslationKey
  | InlineEditTranslationKey
  | TasksTranslationKey
  | AgentsTranslationKey
  | WorkOrderActivityTranslationKey
  | QuickActionsTranslationKey
  | SecurityTranslationKey
  | ToolLibraryTranslationKey
  | RibbonTranslationKey
  | CommandsTranslationKey;
