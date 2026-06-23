import { t } from '../i18n/i18n';
import type { TranslationKey } from '../i18n/types';

/**
 * Stable view-type ids for the library views. Kept here (as literals, not
 * imported from each view) so the shared nav avoids an import cycle with the
 * view modules that render it.
 */
export const LIBRARY_VIEW_TYPES = {
  agents: 'claudian-agent-roster',
  tools: 'claudian-tool-library',
  skills: 'claudian-skill-library',
  loops: 'claudian-loop-library',
} as const;

const LIBRARY_NAV_ITEMS: ReadonlyArray<{ type: string; labelKey: TranslationKey }> = [
  { type: LIBRARY_VIEW_TYPES.agents, labelKey: 'agentRoster.navLabel' },
  { type: LIBRARY_VIEW_TYPES.tools, labelKey: 'toolLibrary.navLabel' },
  { type: LIBRARY_VIEW_TYPES.skills, labelKey: 'skillLibrary.navLabel' },
  { type: LIBRARY_VIEW_TYPES.loops, labelKey: 'loopLibrary.navLabel' },
];

export interface LibraryNavHost {
  openLeafView(viewType: string): Promise<void>;
}

/** Renders the Agents / Tools / Skills / Loops nav strip, highlighting `activeType`. */
export function renderLibraryNav(container: HTMLElement, host: LibraryNavHost, activeType: string): void {
  const nav = container.createDiv({ cls: 'claudian-library-nav' });
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', t('agentRoster.navAriaLabel'));
  for (const item of LIBRARY_NAV_ITEMS) {
    const active = item.type === activeType;
    const btn = nav.createEl('button', {
      cls: `claudian-library-nav-item${active ? ' is-active' : ''}`,
      text: t(item.labelKey),
    });
    if (active) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.onclick = () => void host.openLeafView(item.type);
    }
  }
}
