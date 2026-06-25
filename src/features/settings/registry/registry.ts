import { SettingsRegistry } from './SettingsRegistry';

let instance: SettingsRegistry | null = null;

export function getSettingsRegistry(): SettingsRegistry {
  if (!instance) {
    instance = new SettingsRegistry();
  }
  return instance;
}

/**
 * Drops the singleton so the next `getSettingsRegistry()` starts empty.
 * Production use: locale changes — field labels/descriptions are captured by
 * `t()` at registration time, so the registry must be rebuilt under the new
 * locale (see SpecoratorSettingTab.display).
 */
export function resetSettingsRegistry(): void {
  instance = null;
}

export function resetSettingsRegistryForTests(): void {
  resetSettingsRegistry();
}
