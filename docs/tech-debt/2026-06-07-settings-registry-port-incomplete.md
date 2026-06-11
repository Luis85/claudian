---
type: tech-debt
title: "Settings registry port is incomplete and legacy renderers remain live"
date: 2026-06-07
updated: 2026-06-11
status: in-progress
priority: "2 - normal"
severity: medium
scope: settings-architecture
tags:
  - tech-debt
  - settings
  - registry
  - architecture
related:
  - "[[settings-registry-port-followup]]"
  - "[[settings-information-architecture]]"
---

# Settings registry port is incomplete and legacy renderers remain live

## Summary

The settings registry foundation exists, but only a subset of tabs are actually rendered through it. General and provider settings still fall back to imperative renderer modules, so the settings UI has two parallel implementations and the planned information architecture cannot be completed in one place.

## Evidence

- `src/features/settings/registry/featureFlag.ts` currently enables only `agentBoard` and `diagnostics` in `REGISTRY_TABS`.
- The same file explicitly says `general`, `claude`, `codex`, `opencode`, and `cursor` fall back to legacy imperative renderers.
- `docs/issues/settings-registry-port-followup.md` audits the current state and lists missing fields/stub widgets per tab.
- `src/features/settings/ClaudianSettings.ts` remains a large shell/legacy renderer coordinator at 844 nonblank LOC.

## Why it matters

Two settings systems divide locality. Adding or changing a setting requires knowing whether the registry or legacy renderer owns it, whether search can see it, and whether provider tabs use a custom widget. This also slows accessibility/i18n work because the UI is not described once.

## Suggested remediation

1. Finish provider tab registry definitions one tab at a time.
2. Migrate complex custom widgets into registry-compatible adapters rather than no-op placeholders.
3. Remove legacy provider settings tab renderers only after parity tests pass.
4. Fold the settings information architecture reorg into the registry data rather than doing a separate layout pass.

## Acceptance criteria

- [x] `REGISTRY_TABS` includes `general`, `claude`, `codex`, `opencode`, `cursor`, `agentBoard`, and `diagnostics`. — shipped 2026-06-11; provider ids derive from `ProviderRegistry` at call time.
- [x] Search can find every user-visible setting through registry metadata. — every ported field carries `keywords`; search integration suite green.
- [ ] Legacy renderer files for provider tabs are removed. — **deferred to v4.0.0**, gated on manual vault verification (fresh + existing vault); the renderers shrank to thin shells over the same widget mounts and stay wired as fallback.
- [x] `ClaudianSettings.ts` becomes a shell around the registry renderer, not a second settings implementation. — general-tab imperative rendering moved into registry fields + extracted sections.

## Progress (2026-06-11)

The port itself is complete — all seven tabs render through the registry at
field-for-field parity, each flipped together with a passing parity test
(`tests/integration/settings/<tab>Port.test.ts`). Implementation details and
the per-tab commit trail: [[2026-06-11-settings-registry-port-completion]]
(plan) and `docs/issues/settings-registry-port-followup.md` (status). Status
stays `in-progress` until the v4.0.0 deletion pass removes the legacy
renderer files and `featureFlag.ts` after manual vault verification.
