/**
 * Clear the settings search-bar input and restore the tabbed view: show the
 * tab bar and hide the search-results pane. Shared by the "go to field" and
 * "reset search" flows so both leave the panel in the same neutral state.
 */
export function clearSearchAndShowTabs(
  containerEl: HTMLElement,
  tabBar: HTMLElement,
  resultsHost: HTMLElement,
): void {
  const searchInput = containerEl.querySelector(
    '.claudian-settings-search-bar input[type="search"]',
  ) as HTMLInputElement;
  if (searchInput) {
    searchInput.value = '';
  }

  tabBar.toggleClass('claudian-hidden', false);
  resultsHost.toggleClass('claudian-hidden', true);
}
