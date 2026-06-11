import { ProviderWorkspaceRegistry } from '../../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderSettingsWidgetContext } from '../../../../core/providers/settingsWidgets';
import type { ProviderId } from '../../../../core/providers/types';
import { renderCustomContextLimits } from '../../ui/CustomContextLimits';
import type { SettingsCtx } from '../SettingsField';

/**
 * Mounts a provider-owned settings widget into a registry custom field.
 *
 * Widgets are looked up on the provider's `settingsTabRenderer.widgets` map
 * through `ProviderWorkspaceRegistry` — the sanctioned seam that lets the
 * features zone render the SAME legacy widget code without importing
 * `src/providers/**` (settings-registry port, Decision 2). Renders nothing
 * when the provider workspace is not initialized; provider tabs are only
 * reachable when their provider is enabled and registered.
 */
export function renderProviderSettingsWidget(
  ctx: SettingsCtx,
  host: HTMLElement,
  providerId: ProviderId,
  widgetId: string,
): void {
  const widgets = ProviderWorkspaceRegistry.getSettingsTabRenderer(providerId)?.widgets;
  const mount = widgets?.[widgetId];
  if (!mount) {
    return;
  }
  mount(host, widgetContextFromSettingsCtx(ctx));
}

function widgetContextFromSettingsCtx(ctx: SettingsCtx): ProviderSettingsWidgetContext {
  return {
    plugin: ctx.plugin,
    refreshModelSelectors: () => {
      for (const view of ctx.plugin.getAllViews()) {
        view.refreshModelSelector();
      }
    },
    requestRefresh: () => ctx.refresh(),
    renderCustomContextLimits: (container, providerId) =>
      renderCustomContextLimits(ctx.plugin, container, providerId),
  };
}
