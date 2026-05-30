---
status: open
type: issue
target-version: 3.0.0
tags:
  - ux
priority: 1 - high
---
# User-manual settings cross-links — follow-up after settings overhaul (v3.0.0)

## Problem

Four new Windows install guides shipped under `docs/user-manuals/`:

- [[install-claude]]
- [[install-codex]]
- [[install-opencode]]
- [[install-cursor]]

Each links to [[settings]] using tab names, section headings, and setting labels that match the **pre-overhaul** settings panel. The v3.0.0 settings overhaul (design: [[docs/superpowers/specs/2026-05-30-settings-overhaul-design.md]]) will move, rename, or delete several of those surfaces. Once it lands, the install guides plus [[settings]] itself drift out of sync.

## Concrete drift to fix

Mapped from the design doc:

### Per-tab "Enable X" toggle removed (single source of truth in General → Providers)

- `install-codex.md` references **Setup → Enable Codex provider** as a mirror toggle. Row goes away. Replace prose with: "Toggle Codex on under **Settings → Claudian → General → Providers**. Codex tab only renders while it is on."
- `install-opencode.md` references **Setup → Enable OpenCode**. Same treatment.

### Tab visibility — disabled provider tabs disappear

Every install guide says "open **Settings → Claudian → \<Provider\>**". Add the precondition: provider must be enabled in General first, otherwise the tab is hidden. Worth one sentence each.

### Custom models moved to per-provider Models → Custom models

- `install-codex.md` says `OPENAI_MODEL` env var takes precedence over the **Custom models** list. Verify the section path (now `Codex → Models → Custom models`) and the env-source pill behavior (read-only id + alias, editable context window, Remove disabled with `Set via env` tooltip).
- `install-claude.md` says `ANTHROPIC_MODEL` similarly. Same audit.
- Drop any prose pointing custom context-window/alias edits at General → Environment. That widget is gone; one-shot migration moves entries to per-provider tabs.

### Models section gains a Default model dropdown

Per-provider `{providerId}.defaultModel` field is new. Worth a row in each provider's install-guide next-steps table.

### Default provider resolver

[[install-codex]] does not currently reference Agent Board defaults, but the broader manual set may. Worth checking [[settings]]'s Agent Board section against the new resolver rules (0 / 1 / ≥ 2 enabled providers, no auto-rewrite). Confirm `agentBoard.defaultProvider` default is documented as `null`, not `'codex'`.

### First-run banner on General tab

New surface. Add a "First run" subsection to [[settings]] (or a dedicated `first-run-setup.md` manual) that documents: banner content, **Enable selected** + **Dismiss** behaviour, `Show setup again` link, `firstRunDismissed` flag.

### Settings search box

New surface. Add a "Searching settings" subsection: `/` focuses, `Esc` clears, results grouped by tab → section, hidden fields filtered, **Go** scrolls + pulses target. Worth a brief callout in each install guide ("can't find a setting? press `/` in the settings panel").

### Hotkeys section now shows live bindings

`install-claude.md` and friends do not currently mention hotkeys, but [[settings]] does. Update its Hotkeys row to reflect the live binding chip + Edit deep-link behavior, and the `commandHotkeyRegistry` source.

### Legacy storage paths gone

[[settings]] currently ends with "The legacy path `.claude/claudian-settings.json` is still read for migration." That line goes — paths are stripped in v3.

## Files to audit

- `docs/user-manuals/install-claude.md`
- `docs/user-manuals/install-codex.md`
- `docs/user-manuals/install-opencode.md`
- `docs/user-manuals/install-cursor.md`
- `docs/user-manuals/settings.md`
- Any other `docs/user-manuals/*.md` matching `rg "Settings → Claudian"`
- Any manual matching `rg "General → Environment"` (model-override section moves out)
- Any manual matching `rg "Enable (Codex|OpenCode)"` (toggles removed)

## Acceptance

- `rg "Settings → Claudian"` in `docs/user-manuals/` shows zero stale paths against the shipped v3 UI.
- `rg "General → Environment"` returns zero hits referring to per-model overrides.
- `rg -i "enable codex provider|enable opencode"` in install guides returns zero hits.
- Every wikilink from an install guide into [[settings]] resolves to a real heading post-rename.
- [[settings]] documents: first-run banner, search box, tab visibility rules, per-provider Models section (Default model + Custom models), live-binding Hotkeys section, resolved-vs-stored Agent Board default provider.
- Spot-check each install guide against the actual v3 settings UI on a fresh Windows install.

## Related

- Design: [[docs/superpowers/specs/2026-05-30-settings-overhaul-design.md]]
- Plan (to be written): `docs/superpowers/plans/2026-05-30-settings-overhaul.md`
- New install guides: [[install-claude]], [[install-codex]], [[install-opencode]], [[install-cursor]]
- Settings manual: [[settings]]

## Status

Deferred. Pick up after v3.0.0 settings overhaul lands. Treat as part of the v3.0.0 release-notes pass — release should not ship while these manuals contradict the shipped UI.
