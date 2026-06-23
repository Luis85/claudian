import type { ProviderId } from '../../../../core/providers/types';
import type { SpecoratorSettings } from '../../../../core/types/settings';
import type { SettingsRegistry } from '../SettingsRegistry';

export interface ProviderTabSpec {
  providerId: ProviderId;
  label: string;
  order: number;
  sections: Array<{ id: string; label: string; order: number; description?: string }>;
}

export function isProviderEnabled(
  settings: SpecoratorSettings,
  providerId: ProviderId,
): boolean {
  const cfg = settings.providerConfigs?.[providerId] as { enabled?: boolean } | undefined;
  return Boolean(cfg?.enabled);
}

export function registerProviderTab(registry: SettingsRegistry, spec: ProviderTabSpec): void {
  registry.registerTab({
    id: spec.providerId,
    label: spec.label,
    order: spec.order,
    visible: (s) => isProviderEnabled(s, spec.providerId),
  });
  for (const section of spec.sections) {
    registry.registerSection({
      id: section.id,
      tabId: spec.providerId,
      label: section.label,
      order: section.order,
      description: section.description,
    });
  }
}
