import { SettingsRegistry } from './SettingsRegistry';

let instance: SettingsRegistry | null = null;

export function getSettingsRegistry(): SettingsRegistry {
  if (!instance) {
    instance = new SettingsRegistry();
  }
  return instance;
}

export function resetSettingsRegistryForTests(): void {
  instance = null;
}
