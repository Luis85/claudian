import { Notice } from 'obsidian';

import type {
  ProviderCapabilities,
  ProviderChatUIConfig,
} from '../../../../core/providers/types';

export function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 10_000) return `${(tokens / 1000).toFixed(1)}k`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/**
 * Count-driven icon+badge state shared by the toolbar selectors: the icon goes
 * active with a tooltip when count > 0; the numeric badge shows only past 1.
 */
export function updateCountBadgeDisplay(params: {
  iconEl: HTMLElement;
  badgeEl: HTMLElement;
  count: number;
  activeTitle: string;
  inactiveTitle: string;
}): void {
  const { iconEl, badgeEl, count, activeTitle, inactiveTitle } = params;

  if (count > 0) {
    iconEl.addClass('active');
    iconEl.setAttribute('title', activeTitle);

    if (count > 1) {
      badgeEl.setText(String(count));
      badgeEl.addClass('visible');
    } else {
      badgeEl.removeClass('visible');
    }
  } else {
    iconEl.removeClass('active');
    iconEl.setAttribute('title', inactiveTitle);
    badgeEl.removeClass('visible');
  }
}

export interface ToolbarSettings {
  model: string;
  thinkingBudget: string;
  effortLevel: string;
  serviceTier: string;
  permissionMode: string;
  [key: string]: unknown;
}

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onModeChange: (mode: string) => Promise<void>;
  onThinkingBudgetChange: (budget: string) => Promise<void>;
  onEffortLevelChange: (effort: string) => Promise<void>;
  onServiceTierChange: (serviceTier: string) => Promise<void>;
  onPermissionModeChange: (mode: string) => Promise<void>;
  /** Toggles plan mode on/off (saves/restores pre-plan permission mode). */
  onPlanModeToggle?: () => Promise<void>;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  getUIConfig: () => ProviderChatUIConfig;
  getCapabilities: () => ProviderCapabilities;
}
