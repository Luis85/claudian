/**
 * @jest-environment jsdom
 */

import type { SettingsField } from '../../../../../src/features/settings/registry/SettingsField';
import { SearchResultsView } from '../../../../../src/features/settings/search/SearchResultsView';

describe('SearchResultsView', () => {
  beforeEach(() => {
    // Setup DOM helpers for Obsidian-like API
    if (!HTMLElement.prototype.createDiv) {
      (HTMLElement.prototype as any).createDiv = function (options?: { cls?: string }) {
        const div = document.createElement('div');
        if (options?.cls) {
          div.className = options.cls;
        }
        this.appendChild(div);
        return div;
      };
    }
    if (!HTMLElement.prototype.createEl) {
      (HTMLElement.prototype as any).createEl = function (tag: string, options?: { text?: string; attr?: Record<string, string>; cls?: string }) {
        const el = document.createElement(tag);
        if (options?.text) {
          el.textContent = options.text;
        }
        if (options?.cls) {
          el.className = options.cls;
        }
        if (options?.attr) {
          Object.entries(options.attr).forEach(([k, v]) => {
            el.setAttribute(k, v);
          });
        }
        this.appendChild(el);
        return el;
      };
    }
    if (!HTMLElement.prototype.createSpan) {
      (HTMLElement.prototype as any).createSpan = function (options?: { text?: string; cls?: string }) {
        const span = document.createElement('span');
        if (options?.text) {
          span.textContent = options.text;
        }
        if (options?.cls) {
          span.className = options.cls;
        }
        this.appendChild(span);
        return span;
      };
    }
    if (!HTMLElement.prototype.empty) {
      (HTMLElement.prototype as any).empty = function () {
        this.innerHTML = '';
      };
    }
  });

  function makeField(
    id: string,
    label: string,
    tabId: string,
    sectionId: string,
    description?: string,
  ): SettingsField {
    return {
      id,
      label,
      tabId,
      sectionId,
      type: { kind: 'toggle' },
      default: false,
      description,
    };
  }

  it('renders empty results notice with Reset button', () => {
    const host = document.createElement('div');
    const onReset = jest.fn();
    const onGoTo = jest.fn();
    new SearchResultsView(host, [], onGoTo, onReset).render();

    expect(host.textContent).toContain('Nothing matches');
    const resetBtn = host.querySelector('[data-action="reset"]') as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();
    resetBtn.click();
    expect(onReset).toHaveBeenCalled();
  });

  it('groups matched fields by tab then section with breadcrumbs', () => {
    const host = document.createElement('div');
    const results = [
      makeField('general.providers.x', 'Field X', 'general', 'providers', 'X description'),
      makeField('general.language.y', 'Field Y', 'general', 'language', 'Y description'),
      makeField('claude.models.z', 'Field Z', 'claude', 'models', 'Z description'),
    ];
    new SearchResultsView(host, results, jest.fn(), jest.fn()).render();

    // Check general tab grouping
    const generalSections = host.querySelectorAll('[data-tab="general"]');
    expect(generalSections.length).toBeGreaterThan(0);

    // Check breadcrumbs contain expected paths
    const breadcrumbs = host.querySelectorAll('.specorator-search-breadcrumb');
    const breadcrumbTexts = Array.from(breadcrumbs).map((b) => b.textContent);
    expect(breadcrumbTexts.some((t) => t?.includes('general'))).toBe(true);
  });

  it('renders Go button on each field row that calls onGoTo', () => {
    const host = document.createElement('div');
    const onGoTo = jest.fn();
    const results = [
      makeField('general.providers.x', 'Field X', 'general', 'providers'),
      makeField('claude.models.y', 'Field Y', 'claude', 'models'),
    ];
    new SearchResultsView(host, results, onGoTo, jest.fn()).render();

    const goButtons = host.querySelectorAll('[data-action="go"]');
    expect(goButtons.length).toBe(2);

    (goButtons[0] as HTMLButtonElement).click();
    expect(onGoTo).toHaveBeenCalledWith('general', 'providers', 'general.providers.x');

    (goButtons[1] as HTMLButtonElement).click();
    expect(onGoTo).toHaveBeenCalledWith('claude', 'models', 'claude.models.y');
  });

  it('displays label and description for each result', () => {
    const host = document.createElement('div');
    const results = [
      makeField('test.section.field', 'My Label', 'test', 'section', 'My description text'),
    ];
    new SearchResultsView(host, results, jest.fn(), jest.fn()).render();

    expect(host.textContent).toContain('My Label');
    expect(host.textContent).toContain('My description text');
  });

  it('renders breadcrumb showing tab › section › field path', () => {
    const host = document.createElement('div');
    const results = [makeField('claude.models.cliPath', 'CLI path', 'claude', 'models')];
    new SearchResultsView(host, results, jest.fn(), jest.fn()).render();

    const breadcrumb = host.querySelector('.specorator-search-breadcrumb');
    expect(breadcrumb?.textContent).toContain('claude');
    expect(breadcrumb?.textContent).toContain('models');
  });
});
