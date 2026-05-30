import { FirstRunBanner } from '../firstRunBanner/FirstRunBanner';
import { hasAnyProviderEnabled } from '../firstRunBanner/hasAnyProviderEnabled';
import { renderField } from './renderField';
import type { SettingsCtx } from './SettingsField';
import type { SettingsRegistry } from './SettingsRegistry';

export function renderTab(
  host: HTMLElement,
  tabId: string,
  ctx: SettingsCtx,
  registry: SettingsRegistry,
): void {
  host.empty();
  if (tabId === 'general' && !ctx.settings.firstRunDismissed && !hasAnyProviderEnabled(ctx.settings)) {
    const bannerHost = host.createDiv({ cls: 'claudian-first-run-banner-host' });
    new FirstRunBanner(bannerHost, ctx).render();
  }
  for (const section of registry.getSections(tabId, ctx.settings)) {
    const sectionEl = host.createDiv({ cls: 'claudian-settings-section' });
    sectionEl.dataset.sectionId = section.id;
    sectionEl.createEl('h3', { text: section.label });
    if (section.description) {
      sectionEl.createEl('p', { text: section.description, cls: 'setting-item-description' });
    }
    for (const field of registry.getFields(tabId, section.id, ctx.settings)) {
      const fieldEl = sectionEl.createDiv({ cls: 'claudian-settings-field' });
      fieldEl.dataset.fieldId = field.id;
      renderField(fieldEl, field, ctx);
    }
  }
}
