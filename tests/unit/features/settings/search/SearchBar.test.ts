/** @jest-environment jsdom */

import { createMockEl } from '@test/helpers/mockElement';

import { SearchBar } from '@/features/settings/search/SearchBar';

describe('SearchBar', () => {
  let hostEl: any;
  let onChange: jest.Mock;
  let searchBar: SearchBar;

  beforeEach(() => {
    jest.useFakeTimers();
    hostEl = createMockEl('div');
    onChange = jest.fn();
    searchBar = new SearchBar(hostEl, onChange);
  });

  afterEach(() => {
    searchBar.dispose();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('renders input with placeholder "Search settings…"', () => {
    searchBar.render();

    expect(hostEl.children).toHaveLength(1);
    const inputEl = hostEl.children[0];
    expect(inputEl.tagName).toBe('INPUT');
    expect(inputEl.getAttribute('type')).toBe('search');
    expect(inputEl.getAttribute('placeholder')).toBe('Search settings…');
  });

  it('focuses input when "/" key is pressed from outside the input', () => {
    searchBar.render();
    const inputEl = hostEl.children[0];

    // Track if focus was called
    let focusCalled = false;
    inputEl.focus = () => {
      focusCalled = true;
    };

    // Dispatch "/" keydown from document. Since activeElement starts as body/null,
    // the input won't be the activeElement, so it should focus
    const slashEvent = new KeyboardEvent('keydown', { key: '/' });
    (global as any).document.dispatchEvent(slashEvent);

    expect(focusCalled).toBe(true);
  });

  it('clears input and calls onChange("") when Escape is pressed', () => {
    searchBar.render();
    const inputEl = hostEl.children[0];
    inputEl.value = 'test query';

    const escapeEvent = { key: 'Escape', stopPropagation: jest.fn() };
    inputEl.dispatchEvent('keydown', escapeEvent);

    expect(inputEl.value).toBe('');
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('debounces onChange with 120ms delay when typing', () => {
    searchBar.render();
    const inputEl = hostEl.children[0];

    inputEl.value = 'test';
    inputEl.dispatchEvent('input');

    // onChange should not be called yet
    expect(onChange).not.toHaveBeenCalled();

    // Advance time by 120ms
    jest.advanceTimersByTime(120);

    // onChange should now be called with trimmed query
    expect(onChange).toHaveBeenCalledWith('test');
  });

  it('trims whitespace from input before calling onChange', () => {
    searchBar.render();
    const inputEl = hostEl.children[0];

    inputEl.value = '  query with spaces  ';
    inputEl.dispatchEvent('input');

    jest.advanceTimersByTime(120);

    expect(onChange).toHaveBeenCalledWith('query with spaces');
  });

  it('cancels previous debounce when input changes again', () => {
    searchBar.render();
    const inputEl = hostEl.children[0];

    inputEl.value = 'first';
    inputEl.dispatchEvent('input');
    jest.advanceTimersByTime(60);

    inputEl.value = 'second';
    inputEl.dispatchEvent('input');
    jest.advanceTimersByTime(60);

    // onChange should not have been called yet
    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(60);

    // onChange should only be called once with the latest value
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('second');
  });

  it('removes document keydown listener on dispose', () => {
    searchBar.render();

    const removeEventListenerSpy = jest.spyOn((global as any).document, 'removeEventListener');
    searchBar.dispose();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
