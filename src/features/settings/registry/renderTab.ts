import { Setting } from 'obsidian';

import { FirstRunBanner } from '../firstRunBanner/FirstRunBanner';
import { hasAnyProviderEnabled } from '../firstRunBanner/hasAnyProviderEnabled';
import { renderField } from './renderField';
import type { SettingsCtx } from './SettingsField';
import type { SettingsRegistry } from './SettingsRegistry';

// Returns a disposer that runs every field-level disposer in the order they
// were registered. The CALLER (typically `ClaudianSettings.display()`) owns the
// lifecycle: it must invoke the returned disposer before the host element is
// removed, otherwise widget subscriptions to the event bus accumulate. A
// previous implementation tracked disposers in a WeakMap keyed by `host`, but
// each `display()` call creates a fresh tab-content element, so the WeakMap
// could never find the previous round. The result was an exponential listener
// leak that froze the settings UI after a few rapid lane-editor clicks.
export function renderTab(
  host: HTMLElement,
  tabId: string,
  ctx: SettingsCtx,
  registry: SettingsRegistry,
): () => void {
  const disposers: Array<() => void> = [];

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
        disposers.push(disposer);
      }
    }
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // Disposers should be defensive themselves; swallow errors so a single
        // bad widget cannot block the rest of the tab from cleaning up.
      }
    }
  };
}
