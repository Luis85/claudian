# Chat Header Declutter + Agent-Bound Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the bound-agent header chip (avatar + name, no tag/×, no unbind), let the `.claudian-header` row truncate/breathe, and mark agent-bound chat tabs with a small `user` glyph before the index number.

**Architecture:** Three localized view-layer changes. The tab badge reads agent-binding synchronously via `getConversationSync`; the header chip already resolves the agent async. No storage/schema changes.

**Tech Stack:** TypeScript, Obsidian DOM (`createEl`/`createSpan`/`setIcon`), Jest with the `createMockEl` element mock (not jsdom) for `TabBar`, i18n across 10 locales.

---

## File Structure

- **Modify** `src/features/chat/tabs/types.ts` — add `isAgentBound?: boolean` to `TabBarItem`.
- **Modify** `src/features/chat/tabs/TabBar.ts` — render the agent glyph + `--agent` class + aria qualifier for agent-bound chat badges.
- **Modify** `src/features/chat/tabs/TabManager.ts` — populate `isAgentBound` in `getTabBarItems()`.
- **Modify** `src/style/components/tabs.css` — agent badge + icon styling.
- **Modify** `src/features/chat/ClaudianView.ts` — simplify `syncBoundAgentChip` (drop tag + unbind).
- **Modify** `src/style/components/header.css` — title ellipsis, chip tidy, remove dead chip CSS.
- **Modify** `src/i18n/types/agents.ts` + `src/i18n/locales/*.json` — remove `agentRoster.chipTag` + `agentRoster.unbind`.
- **Test** `tests/unit/features/chat/tabs/TabBar.test.ts` — agent-bound badge cases.

---

## Task 1: Tab badge agent glyph (TDD)

**Files:**
- Modify: `src/features/chat/tabs/types.ts`
- Modify: `src/features/chat/tabs/TabBar.ts`
- Modify: `src/features/chat/tabs/TabManager.ts`
- Modify: `src/style/components/tabs.css`
- Test: `tests/unit/features/chat/tabs/TabBar.test.ts`

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `tests/unit/features/chat/tabs/TabBar.test.ts` (the file already imports `createMockEl`, `TabBar`, `TabBarItem`, and defines `createMockCallbacks()` + `createTabBarItem(overrides)`):

```ts
describe('agent-bound badge', () => {
  it('renders a user glyph, --agent class, number span, and "agent" aria qualifier', () => {
    const containerEl = createMockEl();
    const tabBar = new TabBar(containerEl, createMockCallbacks());

    tabBar.update([createTabBarItem({ index: 2, isAgentBound: true, title: 'My chat' })]);

    const badge = containerEl._children[0];
    expect(badge.hasClass('claudian-tab-badge--agent')).toBe(true);
    expect(badge._children.some((c) => c.hasClass('claudian-tab-badge-agent-icon'))).toBe(true);
    const number = badge._children.find((c) => c.hasClass('claudian-tab-badge-number'));
    expect(number?.textContent).toBe('2');
    expect(badge.getAttribute('aria-label')).toBe('My chat (agent)');
  });

  it('does not mark a non-bound chat badge', () => {
    const containerEl = createMockEl();
    const tabBar = new TabBar(containerEl, createMockCallbacks());

    tabBar.update([createTabBarItem({ index: 3 })]);

    const badge = containerEl._children[0];
    expect(badge.hasClass('claudian-tab-badge--agent')).toBe(false);
    expect(badge._children.some((c) => c.hasClass('claudian-tab-badge-agent-icon'))).toBe(false);
    // Unchanged path: number rendered directly as the badge's text.
    expect(badge.textContent).toBe('3');
  });

  it('ignores isAgentBound on a work-order badge (glyph gated to chat)', () => {
    const containerEl = createMockEl();
    const tabBar = new TabBar(containerEl, createMockCallbacks());

    tabBar.update([createTabBarItem({ kind: 'work-order', isAgentBound: true })]);

    const badge = containerEl._children[0];
    expect(badge.hasClass('claudian-tab-badge--agent')).toBe(false);
    expect(badge._children.some((c) => c.hasClass('claudian-tab-badge-agent-icon'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest --selectProjects unit TabBar.test -t "agent-bound badge"`
Expected: FAIL — `isAgentBound` is not on `TabBarItem` (type error) and/or the `--agent` class isn't rendered.

- [ ] **Step 3: Add the type field**

In `src/features/chat/tabs/types.ts`, inside `interface TabBarItem` (after the `kind: TabKind;` line), add:

```ts
  /** True when the tab's conversation is bound to a roster agent — drives the badge glyph. */
  isAgentBound?: boolean;
```

- [ ] **Step 4: Render the glyph in `TabBar.renderBadge`**

In `src/features/chat/tabs/TabBar.ts`, in `renderBadge`, add the `--agent` class to `stateClasses` (after the existing work-order class push, before the badge is created):

```ts
    if (item.kind !== 'work-order' && item.isAgentBound) {
      stateClasses.push('claudian-tab-badge--agent');
    }
```

Then replace the badge-creation + work-order-icon block:

```ts
    // Work-order tabs render a wrench glyph instead of the index number so the
    // kind reads at a glance. Chat tabs keep the numeric badge.
    const badgeEl = item.kind === 'work-order'
      ? this.containerEl.createDiv({ cls: stateClasses.join(' ') })
      : this.containerEl.createDiv({ cls: stateClasses.join(' '), text: String(item.index) });

    if (item.kind === 'work-order') {
      const iconEl = badgeEl.createSpan({ cls: 'claudian-tab-badge-icon' });
      setIcon(iconEl, 'wrench');
    }
```

with this three-way (work-order → wrench only; agent-bound chat → user glyph + number span; plain chat → number as text, unchanged so existing `textContent` assertions hold):

```ts
    // Work-order tabs render a wrench glyph instead of the index number. An
    // agent-bound chat tab prepends a small user glyph before the number so the
    // binding reads at a glance. A plain chat tab keeps the number as the badge's
    // own text (unchanged).
    let badgeEl: HTMLElement;
    if (item.kind === 'work-order') {
      badgeEl = this.containerEl.createDiv({ cls: stateClasses.join(' ') });
      setIcon(badgeEl.createSpan({ cls: 'claudian-tab-badge-icon' }), 'wrench');
    } else if (item.isAgentBound) {
      badgeEl = this.containerEl.createDiv({ cls: stateClasses.join(' ') });
      setIcon(badgeEl.createSpan({ cls: 'claudian-tab-badge-agent-icon' }), 'user');
      badgeEl.createSpan({ cls: 'claudian-tab-badge-number', text: String(item.index) });
    } else {
      badgeEl = this.containerEl.createDiv({ cls: stateClasses.join(' '), text: String(item.index) });
    }
```

Then add `agent` to the aria-label qualifiers. Replace:

```ts
    const qualifiers: string[] = [];
    if (item.kind === 'work-order') qualifiers.push('work order');
    if (item.isStreaming) qualifiers.push('working');
```

with:

```ts
    const qualifiers: string[] = [];
    if (item.kind === 'work-order') qualifiers.push('work order');
    if (item.kind !== 'work-order' && item.isAgentBound) qualifiers.push('agent');
    if (item.isStreaming) qualifiers.push('working');
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx jest --selectProjects unit TabBar.test`
Expected: PASS — the new `agent-bound badge` cases plus the pre-existing TabBar cases (including `display index number as text` → still `'5'`).

- [ ] **Step 6: Populate `isAgentBound` in `TabManager.getTabBarItems`**

In `src/features/chat/tabs/TabManager.ts`, in `getTabBarItems()`, add the field to the pushed object (after `kind: tab.kind,`):

```ts
        kind: tab.kind,
        isAgentBound: Boolean(
          tab.conversationId && this.plugin.getConversationSync(tab.conversationId)?.boundAgentId,
        ),
```

(`this.plugin.getConversationSync(id)` returns `Conversation | null` with a `boundAgentId` field; `tab.conversationId` is the tab's bound conversation id.)

- [ ] **Step 7: Add the CSS**

In `src/style/components/tabs.css`, after the `.claudian-tab-badge-icon svg { ... }` rule (around line 127), add:

```css
/*
 * Agent-bound chat badge — a small person glyph before the index number marks
 * the tab as bound to a roster agent. The badge relaxes its fixed 24px square to
 * a slightly wider pill so the glyph + number sit side by side.
 */
.claudian-tab-badge--agent {
  width: auto;
  min-width: 24px;
  gap: 2px;
  padding: 0 5px;
}

.claudian-tab-badge-agent-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 11px;
  height: 11px;
}

.claudian-tab-badge-agent-icon svg {
  width: 11px;
  height: 11px;
}
```

- [ ] **Step 8: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all clean (run `npm run lint:fix` if import/format ordering is flagged).

- [ ] **Step 9: Commit**

```bash
git add src/features/chat/tabs/types.ts src/features/chat/tabs/TabBar.ts src/features/chat/tabs/TabManager.ts src/style/components/tabs.css tests/unit/features/chat/tabs/TabBar.test.ts
git commit -m "feat(chat): mark agent-bound chat tabs with a badge glyph

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TKwFw4YfCCeejo4kHRSUBF"
```

---

## Task 2: Slim the bound-agent chip + header tidy + i18n cleanup

**Files:**
- Modify: `src/features/chat/ClaudianView.ts`
- Modify: `src/style/components/header.css`
- Modify: `src/i18n/types/agents.ts` + `src/i18n/locales/*.json`

No new unit test (the chip + header are manually-verified UI, consistent with the rest of `ClaudianView`). Validated by typecheck/lint/build + i18n parity.

- [ ] **Step 1: Simplify `syncBoundAgentChip`**

In `src/features/chat/ClaudianView.ts`, replace the chip-rendering tail of `syncBoundAgentChip()` (the block from `const chip = slot.createDiv(...)` through the end of the method) with:

```ts
    const chip = slot.createDiv({ cls: 'claudian-bound-agent-chip' });
    chip.setAttribute('title', t('agentRoster.chattingWith', { name: agent.name }));

    const avatarEl = chip.createDiv({ cls: 'claudian-bound-agent-chip-avatar' });
    renderAgentAvatar(avatarEl, rosterAgentToPersona(agent), 18);

    chip.createSpan({ cls: 'claudian-bound-agent-chip-label', text: agent.name });
  }
```

This drops the `claudian-bound-agent-chip-tag` span (`t('agentRoster.chipTag')`), the `claudian-bound-agent-chip-unbind` button, its `setIcon(unbindBtn, 'x')`, and the click handler that called `this.plugin.updateConversation(conversationId, { boundAgentId: undefined })`. The generation guard, the `slot.empty()` + early returns, and the avatar/label remain. `conversationId` is still referenced by the `if (!conversationId || !agent) return;` guard, so no unused-variable lint error.

- [ ] **Step 2: Remove the two now-unused i18n keys**

In `src/i18n/types/agents.ts`, delete the lines `| 'agentRoster.chipTag'` and `| 'agentRoster.unbind'`.

Then remove them from every locale:

```bash
python3 - <<'PY'
import json, collections
for loc in ['en','de','es','fr','ja','ko','pt','ru','zh-CN','zh-TW']:
    p = f'src/i18n/locales/{loc}.json'
    with open(p, encoding='utf-8') as fh:
        d = json.load(fh, object_pairs_hook=collections.OrderedDict)
    ns = d['agentRoster']
    for k in ('chipTag', 'unbind'):
        ns.pop(k, None)
    with open(p, 'w', encoding='utf-8') as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
print('done')
PY
```

- [ ] **Step 3: Header CSS — title ellipsis, chip tidy, remove dead rules**

In `src/style/components/header.css`:

(a) Make the title truncate. Replace the `.claudian-title-text` rule:

```css
.claudian-title-text {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
```

with:

```css
.claudian-title-text {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
```

(b) Tidy the chip — replace the `.claudian-bound-agent-chip` rule:

```css
.claudian-bound-agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 5px 3px 4px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 999px;
  font-size: var(--font-ui-smaller);
  color: var(--text-normal);
  max-width: calc(100% - 24px);
  margin: 0 12px 6px 12px;
}
```

with (smaller padding now that the tag/× are gone, centered in the row via a left-gap margin, capped so a long agent name can't dominate):

```css
.claudian-bound-agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px 2px 3px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 999px;
  font-size: var(--font-ui-smaller);
  color: var(--text-normal);
  max-width: 40%;
  margin-inline-start: 8px;
  flex: 0 1 auto;
  min-width: 0;
}
```

(c) Delete the now-dead rules entirely: `.claudian-bound-agent-chip-tag`, `.claudian-bound-agent-chip-unbind`, `.claudian-bound-agent-chip-unbind:hover`, and `.claudian-bound-agent-chip-unbind svg`.

- [ ] **Step 4: Verify keys are gone and nothing references them**

Run: `grep -rn "agentRoster.chipTag\|agentRoster.unbind\|claudian-bound-agent-chip-tag\|claudian-bound-agent-chip-unbind" src/`
Expected: NO matches (all removed together).

- [ ] **Step 5: Typecheck, lint, i18n parity, build**

Run: `npm run typecheck && npm run lint && npx jest --selectProjects unit -t "locale|i18n|parity" && npm run build`
Expected: typecheck/lint clean; i18n parity PASS (keys removed from all locales + the union together); `Built styles.css`.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/ClaudianView.ts src/style/components/header.css src/i18n/types/agents.ts src/i18n/locales/*.json
git commit -m "feat(chat): slim the bound-agent header chip and let the header breathe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TKwFw4YfCCeejo4kHRSUBF"
```

---

## Task 3: Full gate sweep + push

**Files:** none (verification + push).

- [ ] **Step 1: Run the full gate suite**

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run check:loc
mv coverage /tmp/cov_bak 2>/dev/null; npm run check:quality; mv /tmp/cov_bak coverage 2>/dev/null
npm run test:coverage
npm run test:perf
```

Expected: typecheck/lint clean; all tests pass; `LOC guard OK`; `Quality ratchet OK` (this change is net-neutral/negative — removed chip code + dead CSS + two i18n keys; small TabBar/TabManager additions); coverage thresholds met; perf 23 passed.

- [ ] **Step 2: Push**

```bash
git push origin claude/ai-agents-plugin-research-ljdmgg
```

- [ ] **Step 3: Confirm the commit author**

Run: `git log -2 --format='%h %an <%ae>'`
Expected: both commits `Claude <noreply@anthropic.com>`. If not, run `git config user.email noreply@anthropic.com && git config user.name Claude && git commit --amend --no-edit --reset-author` on the tip (or rebase --exec for both), then force-push with `--force-with-lease`.

---

## Notes for the implementer

- No `console.*` in `src/`; no `innerHTML`. Build DOM with `createEl`/`createDiv`/`createSpan`/`setText`/`.empty()`; render icons with `setIcon`.
- The `TabBar` test uses the `createMockEl` element mock (not jsdom); `setIcon` is a no-op there, so assert the glyph by its **span class** (`claudian-tab-badge-agent-icon`), not by SVG.
- Keep the plain (non-bound, non-work-order) chat badge path exactly as today — number set via `createDiv({ text })` — so the existing `display index number as text` assertion (`badge.textContent === '5'`) keeps passing. Only the agent-bound path uses child spans.
- Removing `agentRoster.chipTag` + `agentRoster.unbind` is the only intended behavior change beyond styling: a conversation can no longer be unbound from its agent via the header (by design — start a new chat for a different agent).
