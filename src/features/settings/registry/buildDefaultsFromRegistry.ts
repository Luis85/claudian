import { writePath } from './path';
import type { SettingsRegistry } from './SettingsRegistry';

export function buildDefaultsFromRegistry(registry: SettingsRegistry): Record<string, unknown> {
  let acc: Record<string, unknown> = {};
  for (const field of registry.getAllFields()) {
    acc = writePath(acc, field.id, field.default);
  }
  return acc;
}
