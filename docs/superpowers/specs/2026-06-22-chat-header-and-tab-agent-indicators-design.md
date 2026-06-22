---
title: "Chat Header Declutter + Agent-Bound Indicators"
date: 2026-06-22
status: draft
scope: chat
related:
  - "[[docs/superpowers/specs/2026-06-22-agent-detail-page-overhaul-design]]"
  - "[[docs/superpowers/specs/2026-06-17-ai-agents-roster-design]]"
---

# Chat Header Declutter + Agent-Bound Indicators

## Problem

The chat sidepanel header (`.claudian-header`) is a single flex row:
`[logo + title (flex:1)] [Git "Commit & push"] [bound-agent chip]`. The bound-agent
chip is a wide pill — avatar + an "AGENT" tag + the agent name + an `×` unbind
button — and the `×` is visually awkward. Together with the Git button and a
potentially long conversation title, the row feels crowded. Separately, a chat
tab that is bound to a roster agent looks identical to an unbound tab in the tab
badge row, so there is no at-a-glance signal that a tab carries an agent.

## Goals

- Slim the bound-agent chip and remove the `×`/unbind affordance.
- Let the `.claudian-header` row breathe (title + Git + chip on one clean line).
- Mark agent-bound chat tabs with a small glyph in the tab badge row.

## Non-goals (YAGNI)

- No changes to the input-mode action cluster (`.claudian-input-nav-content`:
  Quick actions / New tab / New conversation / History) — explicitly out of scope.
- No re-adding "unbind" elsewhere. Binding is a per-conversation property; to use
  a different agent (or none), start a new chat.
- No agent name on the tab tooltip — the badge glyph plus the header chip cover
  identity. (The tab bar builds items synchronously and only has a cheap boolean
  via `getConversationSync`; resolving the agent name would need the async roster
  store.)
- No header-mode (`tabBarPosition: 'header'`) action-cluster restructuring.

## Decisions (from brainstorming)

1. Bound-agent indicator in the header = **avatar + name only** (drop the "AGENT"
   tag and the `×`).
2. Unbind affordance is **removed entirely**, not relocated.
3. Agent-bound chat tabs get a `user` glyph **before** the index number.

## Design

### 1. Bound-agent chip — compact, no unbind

`ClaudianView.syncBoundAgentChip()` (`src/features/chat/ClaudianView.ts:864`)
currently renders: avatar, a `claudian-bound-agent-chip-tag` span ("AGENT"), a
`claudian-bound-agent-chip-label` span (name), and a
`claudian-bound-agent-chip-unbind` button that calls
`updateConversation(conversationId, { boundAgentId: undefined })`.

Change it to render only the avatar + the name label, keeping the
`title` tooltip (`agentRoster.chattingWith`). Delete the tag span, the unbind
button, and its click handler. The generation-token guard and the
empty-slot-hides behavior are unchanged.

Removed/unused after this:
- i18n keys `agentRoster.chipTag` and `agentRoster.unbind` — remove from
  `src/i18n/types/agents.ts` and all 10 `src/i18n/locales/*.json` (verify no
  other references first; both are used only by the chip).
- CSS `.claudian-bound-agent-chip-tag`, `.claudian-bound-agent-chip-unbind`,
  `.claudian-bound-agent-chip-unbind:hover`, `.claudian-bound-agent-chip-unbind svg`
  in `src/style/components/header.css` — delete (dead after the change).

### 2. Header row layout

In `src/style/components/header.css`:
- Add overflow handling to `.claudian-title-text` so a long title truncates
  (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`)
  instead of pushing the Git button and chip. `.claudian-title-slot` already has
  `flex: 1; min-width: 0`, so the title yields space; the truncation completes it.
- Tighten the chip: it no longer needs the bottom margin that implied a wrapped
  second row. Keep it a compact pill, vertically centered in the row, with a
  sensible `max-width` + label ellipsis (the label already has
  `text-overflow: ellipsis`).

No DOM/order change beyond the chip simplification; the row stays
`[title-slot flex:1] [git] [chip]`.

### 3. Tab badge agent glyph

- Add `isAgentBound: boolean` to `TabBarItem` (`src/features/chat/tabs/types.ts`).
- `TabManager.getTabBarItems()` (`src/features/chat/tabs/TabManager.ts:478`) sets
  `isAgentBound: Boolean(tab.conversationId && this.plugin.getConversationSync(tab.conversationId)?.boundAgentId)`.
- `TabBar.renderBadge()` (`src/features/chat/tabs/TabBar.ts:64`): for a **chat**
  tab (not work-order) with `isAgentBound`, add a `claudian-tab-badge--agent`
  class and prepend a small `user` glyph span
  (`claudian-tab-badge-agent-icon`) before the index number. Work-order tabs are
  unaffected (they already render a `wrench` instead of a number).
- Aria-label: include `agent` in the existing `qualifiers` array so an agent-bound
  tab reads e.g. `"My chat (agent)"` (and `"… (agent, working)"` when streaming),
  mirroring the existing `work order` / `working` qualifier composition.
- CSS in `src/style/components/tabs.css` (where `.claudian-tab-badge*` live): a
  small icon sized to sit inline before the number without enlarging the badge.

### Data flow

`Conversation.boundAgentId` (already persisted) is the single source of truth.
The header chip reads it via the async `getConversationById` (it already awaits to
resolve the agent record for the avatar/name). The tab badge reads it via the
synchronous `getConversationSync` (boolean only — no agent record needed). Both
are read-only; nothing writes `boundAgentId` from these surfaces anymore (the
unbind write is removed).

## Testing

- **`TabBar`** unit test (jsdom): an `isAgentBound` chat item renders the
  `claudian-tab-badge-agent-icon` span and an aria-label containing `agent`; a
  non-bound chat item does not; a work-order item is unchanged (still a `wrench`,
  no agent glyph even if some future bound flag were set — agent glyph is gated to
  `kind === 'chat'`).
- The chip + header CSS are manually-verified UI (consistent with the rest of
  `ClaudianView`), so no new unit test there.
- Regression guard: `agentBoardNoUntranslatedLiterals` and the i18n parity tests
  must stay green after removing the two keys.

## Quality gates

- LOC: net-neutral/negative (removing chip code + dead CSS; small additions to
  `TabBar`/`TabManager`/`types`).
- Duplication/dead-code: removing the now-unused i18n keys and CSS keeps
  `deadCodeIssues=0`; the tab-glyph branch mirrors the existing work-order branch
  without copy-paste large enough to form a clone.
- i18n parity must hold after the two key removals (remove from every locale +
  the type union together).

## Rollout

Single change set on the existing branch (`claude/ai-agents-plugin-research-ljdmgg`,
PR #117). No storage/schema changes — `Conversation.boundAgentId` is untouched;
this is a view-layer + styling change. The only behavior change is that a
conversation can no longer be unbound from its agent through the header (by
design).
