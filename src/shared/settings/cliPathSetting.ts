import * as fs from 'fs';
import type { Setting } from 'obsidian';

import type { PluginContext } from '../../core/types/PluginContext';
import { t } from '../../i18n/i18n';
import { expandHomePath } from '../../utils/path';

export interface CliPathTextControlOptions {
  setting: Setting;
  /** Host for the inline validation message element. */
  validationHost: HTMLElement;
  placeholder: string;
  currentValue: string;
  validate(value: string): string | null;
  /** Persist the validated value (already trimmed; '' clears the host entry). */
  persist(trimmed: string): Promise<void>;
}

/** Standard CLI-path rule: the value must point to an existing file. */
export function validateCliPathAsFile(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const expandedPath = expandHomePath(trimmed);

  if (!fs.existsSync(expandedPath)) {
    return t('settings.cliPath.validation.notExist');
  }
  const stat = fs.statSync(expandedPath);
  if (!stat.isFile()) {
    return t('settings.cliPath.validation.isDirectory');
  }
  return null;
}

/** Returns a copy of the hostname-keyed map with this host's entry set or cleared. */
export function withHostCliPath(
  cliPathsByHost: Record<string, string>,
  hostnameKey: string,
  trimmed: string,
): Record<string, string> {
  const next = { ...cliPathsByHost };
  if (trimmed) {
    next[hostnameKey] = trimmed;
  } else {
    delete next[hostnameKey];
  }
  return next;
}

/**
 * Shared CLI-path text control: inline validation element, error styling on
 * the input, and validate-before-persist wiring. Provider widgets supply the
 * validation rule and the persistence (hostname-keyed map update plus any
 * runtime restart side effects).
 */
export function addCliPathTextControl(options: CliPathTextControlOptions): void {
  const { setting, validationHost, placeholder, currentValue, validate, persist } = options;

  const validationEl = validationHost.createDiv({
    cls: 'specorator-cli-path-validation specorator-setting-validation specorator-setting-validation-error specorator-hidden',
  });

  const updateValidation = (value: string, inputEl: HTMLInputElement): boolean => {
    const error = validate(value);
    if (error) {
      validationEl.setText(error);
      validationEl.toggleClass('specorator-hidden', false);
      inputEl.toggleClass('specorator-input-error', true);
      return false;
    }

    validationEl.toggleClass('specorator-hidden', true);
    inputEl.toggleClass('specorator-input-error', false);
    return true;
  };

  setting.addText((text) => {
    text
      .setPlaceholder(placeholder)
      .setValue(currentValue)
      .onChange(async (value) => {
        if (!updateValidation(value, text.inputEl)) {
          return;
        }
        await persist(value.trim());
      });
    text.inputEl.addClass('specorator-settings-cli-path-input');

    updateValidation(currentValue, text.inputEl);
  });
}

/** Restart every open tab's runtime so the next turn picks up the new CLI path. */
export async function broadcastCliPathRuntimeCleanup(plugin: PluginContext): Promise<void> {
  const view = plugin.getView();
  await view?.getTabManager()?.broadcastToAllTabs(
    (service) => Promise.resolve(service.cleanup()),
  );
}
