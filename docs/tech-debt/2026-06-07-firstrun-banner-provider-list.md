---
type: tech-debt
title: "First-run banner hardcodes the provider list (name/blurb/cli)"
date: 2026-06-07
updated: 2026-06-09
status: done
priority: "3 - low"
severity: low
scope: providers
tags:
  - tech-debt
  - architecture
  - providers
  - quality-gates
related:
  - "[[2026-06-07-agentic-quality-gates]]"
---

# First-run banner hardcodes the provider list (name/blurb/cli)

## Summary

`src/features/settings/firstRunBanner/FirstRunBanner.ts` carries a hardcoded
`PROVIDERS` array — one `{ id, name, blurb, cli }` object per provider — instead
of deriving the list from `ProviderRegistry`. Adding a provider therefore
requires editing this scattered list, the exact failure mode the
no-hardcoded-provider-list guard exists to prevent. The guard currently
**grandfathers** this file (allowlist entry with a reason); this note tracks
removing the exemption.

## Evidence

```ts
// src/features/settings/firstRunBanner/FirstRunBanner.ts:4
const PROVIDERS: Array<{ id: ProviderId; name: string; blurb: string; cli: string }> = [
  { id: 'claude', name: 'Claude', blurb: 'Anthropic Claude Code', cli: 'claude' },
  { id: 'codex', name: 'Codex', blurb: 'OpenAI Codex CLI', cli: 'codex' },
  { id: 'opencode', name: 'Opencode', blurb: 'Opencode CLI server', cli: 'opencode' },
  { id: 'cursor', name: 'Cursor', blurb: 'Cursor Agent CLI', cli: 'cursor-agent' },
];
```

Surfaced by Codex review on PR #60: the object-shaped list evaded the guard's
original comma/whitespace regex. The guard was strengthened to count distinct
provider-id literals (comment-stripped), which now flags this file — so it was
added to the guard's allowlist rather than left as a silent false negative.

## Why it matters

`name` already exists on the registry as `displayName`
(`ProviderRegistry.getProviderDisplayName`). Only `blurb` and `cli` are missing.
Until they move to the registration, the first-run onboarding list and the
provider registry can disagree, and a new provider silently never appears in the
banner.

## Suggested remediation

1. Add the two missing fields to `ProviderRegistration` (e.g. `firstRunBlurb`
   and `cliCommand`), contributed by each provider's `registration.ts`.
2. Rewrite `FirstRunBanner` to iterate `ProviderRegistry.getRegisteredProviderIds()`
   and read `getProviderDisplayName(id)` + the two new fields — no local list.
3. Remove the `FirstRunBanner.ts` entry from the allowlist in
   `tests/unit/core/providers/noHardcodedProviderList.test.ts`. The guard's
   "allowlist honest" check will then confirm the exemption is no longer needed.

## Acceptance criteria

- [x] `blurb`/`cli` provider metadata live on `ProviderRegistration`, contributed per provider.
- [x] `FirstRunBanner` renders from the registry with no hardcoded provider list.
- [x] The `FirstRunBanner.ts` allowlist entry is removed and the guard stays green.

## Resolution (2026-06-09)

`ProviderRegistration` (src/core/providers/types.ts) gained `firstRunBlurb` and
`cliCommand`, exposed via `ProviderRegistry.getFirstRunBlurb`/`getCliCommand`
and contributed by all four `src/providers/<id>/registration.ts` files with the
exact blurb/cli strings the banner previously hardcoded. `FirstRunBanner` now
iterates `ProviderRegistry.getRegisteredProviderIds()` and reads display name,
blurb, and CLI command from the registry — the local `PROVIDERS` array is gone.
The `FirstRunBanner.ts` allowlist entry was removed from
`tests/unit/core/providers/noHardcodedProviderList.test.ts`, the registration
contract test now requires both fields, and the banner unit test asserts
registry-driven rendering against stub registrations.
