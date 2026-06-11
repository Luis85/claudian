import type { PluginContext } from '../types/PluginContext';
import type { ProviderId } from '../types/provider';

export interface ProviderSettingsTabRendererContext {
  plugin: PluginContext;
  renderHiddenProviderCommandSetting(
    container: HTMLElement,
    providerId: ProviderId,
    copy: { name: string; desc: string; placeholder: string },
  ): void;
  refreshModelSelectors(): void;
  renderCustomContextLimits(container: HTMLElement, providerId?: ProviderId): void;
}

/**
 * Context handed to a provider-owned settings widget. Both render paths build
 * one: the legacy provider tab renderer derives it from its
 * `ProviderSettingsTabRendererContext`, and the settings registry derives it
 * from its `SettingsCtx`. Keeping the surface minimal is what lets the SAME
 * widget code serve both paths (settings-registry port, Decision 2).
 */
export interface ProviderSettingsWidgetContext {
  plugin: PluginContext;
  refreshModelSelectors(): void;
  /** Re-render the hosting settings surface after a cross-field dependency change (e.g. Codex installation method). */
  requestRefresh(): void;
  renderCustomContextLimits(container: HTMLElement, providerId?: ProviderId): void;
}

export type ProviderSettingsWidgetMount = (
  host: HTMLElement,
  context: ProviderSettingsWidgetContext,
) => void;

export interface ProviderSettingsTabRenderer {
  render(container: HTMLElement, context: ProviderSettingsTabRendererContext): void;
  /**
   * Named widget mounts shared with the settings registry. Registry custom
   * fields mount the same legacy widget code through
   * `ProviderWorkspaceRegistry.getSettingsTabRenderer(id)?.widgets` so the
   * features zone never imports provider modules directly.
   */
  widgets?: Readonly<Record<string, ProviderSettingsWidgetMount>>;
}

/**
 * Adapts the legacy provider-tab renderer context to the widget context so a
 * legacy tab can mount the same extracted widgets the registry mounts.
 * `requestRefresh` is caller-supplied because only the tab knows how to
 * re-render itself (the registry passes its own `SettingsCtx.refresh`).
 */
export function widgetContextFromTabRenderer(
  context: ProviderSettingsTabRendererContext,
  requestRefresh: () => void,
): ProviderSettingsWidgetContext {
  return {
    plugin: context.plugin,
    refreshModelSelectors: () => context.refreshModelSelectors(),
    requestRefresh,
    renderCustomContextLimits: (container, providerId) =>
      context.renderCustomContextLimits(container, providerId),
  };
}
