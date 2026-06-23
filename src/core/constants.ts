/**
 * Provider-neutral runtime constants.
 *
 * This module is the home for magic numbers that crossed the
 * "duplicated-in-multiple-places" or "non-obvious-cross-feature-coupling"
 * threshold (Q-NEW-1). Provider-specific limits stay in their provider
 * modules; feature-local constants that are not coupled to anything else
 * stay where they are used.
 *
 * Conventions:
 *   - All time values are milliseconds and end in `_MS`.
 *   - All character / byte limits end in `_CHARS` or `_BYTES`.
 *   - Each entry documents *why* the value is what it is, not just what it
 *     does — future tuning needs the rationale.
 */

/**
 * How often the three selection controllers (editor, browser webview,
 * canvas) poll Obsidian's host for a current selection.
 *
 * 250 ms keeps the indicator responsive (4 Hz) without burning CPU on
 * code that is mostly DOM reads. The three controllers historically each
 * defined their own constant at this value; centralizing here so a single
 * tuning decision affects all three.
 */
export const SELECTION_POLL_INTERVAL_MS = 250;

/**
 * After the user clicks into the composer textarea, ignore selection
 * polls for this long. Stops a stale editor selection from being
 * re-stamped onto the composer while the user is in the middle of
 * starting a new message. Used by `SelectionController`.
 */
export const INPUT_HANDOFF_GRACE_MS = 1500;

/**
 * Settings search "go to field" flash highlight duration.
 *
 * The settings search results view scrolls the target field into view
 * and applies a highlight class for this many ms before clearing it.
 * Long enough that the eye registers the chip, short enough that it
 * does not linger on rapid navigation.
 */
export const SETTINGS_FIELD_HIGHLIGHT_MS = 1500;

/**
 * Delay before reading Obsidian's internal settings DOM after opening a
 * private-API settings tab.
 *
 * `app.setting.openTabById('hotkeys')` triggers an async render; reading
 * `activeTab.searchInputEl` synchronously after the call returns the
 * previous tab's element. 100 ms is empirically enough on every observed
 * platform/render path. Used by `utils/obsidianPrivateApi.ts`.
 */
export const PRIVATE_SETTINGS_RENDER_DELAY_MS = 100;

/**
 * How often the hotkeys settings panel re-checks Obsidian's
 * `hotkeyManager` for binding changes.
 *
 * Obsidian does not emit a hotkey-changed event, so the panel polls.
 * 2000 ms is a felt-instant-on-save cadence with negligible CPU cost
 * (one map lookup per registered Specorator command). Used by
 * `features/settings/hotkeys/HotkeysSection.ts`.
 */
export const HOTKEY_BINDING_POLL_INTERVAL_MS = 2000;
