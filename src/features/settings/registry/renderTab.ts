import { Setting } from 'obsidian';

import { FirstRunBanner } from '../firstRunBanner/FirstRunBanner';
import { hasAnyProviderEnabled } from '../firstRunBanner/hasAnyProviderEnabled';
import { renderField } from './renderField';
import type { SettingsCtx } from './SettingsField';
import type { SettingsRegistry } from './SettingsRegistry';

// Custom-field render functions can return an unsubscribe handle (event-bus
// subscriptions, observers, etc.). Without disposal on re-render those handlers
// accumulate every time renderTab fires. This WeakMap keeps the disposers per
// host so each renderTab call disposes the previous round before re-mounting.
const tabDisposers = new WeakMap<HTMLElement, Array<() => void>>();

export function renderTab(
  host: HTMLElement,
  tabId: string,
  ctx: SettingsCtx,
  registry: SettingsRegistry,
): void {
  const previous = tabDisposers.get(host);
  if (previous) {
    for (const dispose of previous) {
      try {
        dispose();
      } catch {
        // Disposers should be defensive themselves; swallow errors so a single
        // bad widget cannot block the rest of the tab from re-rendering.
      }
    }
  }
  const next: Array<() => void> = [];
  tabDisposers.set(host, next);

  host.empty();
  if (tabId === 'general' && !ctx.settings.firstRunDismissed && !hasAnyProviderEnabled(ctx.settings)) {
    const bannerHost = host.createDiv({ cls: 'claudian-first-run-banner-host' });
    new FirstRunBanner(bannerHost, ctx).render();
  }
  for (const section of registry.getSections(tabId, ctx.settings)) {
    const fields = registry.getFields(tabId, section.id, ctx.settings);
    if (fields.length === 0) continue;
    const sectionEl = host.createDiv({ cls: 'claudian-settings-section' });
    sectionEl.dataset.sectionId = section.id;
    // Use Obsidian's native heading row so registry tabs visually match the
    // imperative General tab. setHeading() applies `.setting-item-heading` —
    // the same class the legacy ClaudianSettings.renderGeneralTab uses.
    const heading = new Setting(sectionEl).setName(section.label).setHeading();
    if (section.description) {
      heading.setDesc(section.description);
    }
    for (const field of fields) {
      const fieldEl = sectionEl.createDiv({ cls: 'claudian-settings-field' });
      fieldEl.dataset.fieldId = field.id;
      const disposer = renderField(fieldEl, field, ctx);
      if (disposer) {
        next.push(disposer);
      }
    }
  }
}
