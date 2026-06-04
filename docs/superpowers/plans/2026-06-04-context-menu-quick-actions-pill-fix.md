---
status: done
---
# Context-menu quick action pill-attach ordering fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-clicking a file or folder, picking a quick action, opens chat AND attaches the file/folder as context that actually reaches the provider.

**Architecture:** One-line ordering swap in `openContextMenuQuickAction`. Move `attachFileAsPill`/`attachFolderAsPill` from before `switchToTab` to after. `switchToTab` triggers `ConversationController.initializeWelcome()` → `FileContextManager.resetForNewConversation()` which currently wipes the pill. Single code path covers both blank-tab-reuse and new-tab paths.

**Tech Stack:** TypeScript, Jest, Obsidian plugin API.

**Spec:** [[docs/superpowers/specs/2026-06-04-context-menu-quick-actions-design.md]]

**Idea:** [[docs/ideas/As a user I want to start a new chat by right-clicking a file or folder and select a quick-action.md]]

---

## Task 1: Add regression test for switch-before-attach ordering

**Files:**
- Modify: `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`

- [ ] **Step 1: Add the failing ordering test**

Open `tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`. Inside the `describe('onRun chip injection', () => {` block (currently around lines 171–197), append this new test after the existing `'attaches folder pill for TFolder'` case:

```typescript
    it('attaches pill AFTER switchToTab to survive initializeWelcome reset', async () => {
      const activeTab = makeMockTab('blank');
      const tabManager = makeMockTabManager({ activeTab, canCreate: true });
      const plugin = makeMockPlugin(tabManager);

      const file = Object.assign(Object.create(TFile.prototype), { path: 'note.md' });
      await openContextMenuQuickAction(plugin as any, file);
      await capturedOnRun!(MOCK_ACTION);

      const switchOrder = (tabManager.switchToTab as jest.Mock).mock.invocationCallOrder[0];
      const attachOrder = (activeTab.ui.fileContextManager.attachFileAsPill as jest.Mock).mock.invocationCallOrder[0];
      expect(switchOrder).toBeLessThan(attachOrder);
    });
```

- [ ] **Step 2: Run test, verify it FAILS**

Run: `npm run test -- tests/unit/features/quickActions/openContextMenuQuickAction.test.ts -t "attaches pill AFTER switchToTab"`

Expected: FAIL. Message like `expect(received).toBeLessThan(expected)` with `received` greater than `expected`, because `attachFileAsPill` currently runs before `switchToTab`.

- [ ] **Step 3: Commit failing test**

```bash
git add tests/unit/features/quickActions/openContextMenuQuickAction.test.ts
git commit -m "test(quickActions): guard switch-before-attach ordering"
```

---

## Task 2: Fix ordering in openContextMenuQuickAction

**Files:**
- Modify: `src/features/quickActions/openContextMenuQuickAction.ts`

- [ ] **Step 1: Read the current onRun body**

Open `src/features/quickActions/openContextMenuQuickAction.ts`. The current onRun body (lines 27–69) attaches the pill before `switchToTab`:

```typescript
        // Attach the right-clicked file or folder as a visible chip.
        if (file instanceof TFile) {
          targetTab.ui.fileContextManager?.attachFileAsPill(file.path);
        } else if (file instanceof TFolder) {
          targetTab.ui.fileContextManager?.attachFolderAsPill(file.path);
        }

        // Bring the tab into focus and fire the prompt.
        await tabManager.switchToTab(targetTab.id);
        void targetTab.controllers.inputController?.sendMessage({ content: action.prompt });
```

- [ ] **Step 2: Swap the order — switch first, then attach**

Replace the block above with:

```typescript
        // Bring the tab into focus FIRST. switchToTab triggers
        // ConversationController.initializeWelcome() on a blank tab, which calls
        // FileContextManager.resetForNewConversation() and wipes any pill we
        // attached beforehand. Attach AFTER the switch resolves so the pill
        // survives and gets folded into the outgoing prompt via
        // FileContextManager.getAttachedMentionSuffix().
        await tabManager.switchToTab(targetTab.id);

        // Attach the right-clicked file or folder as a visible chip.
        if (file instanceof TFile) {
          targetTab.ui.fileContextManager?.attachFileAsPill(file.path);
        } else if (file instanceof TFolder) {
          targetTab.ui.fileContextManager?.attachFolderAsPill(file.path);
        }

        // Fire the prompt — sendMessage folds attached pills into content.
        void targetTab.controllers.inputController?.sendMessage({ content: action.prompt });
```

- [ ] **Step 3: Run the new ordering test, verify it PASSES**

Run: `npm run test -- tests/unit/features/quickActions/openContextMenuQuickAction.test.ts -t "attaches pill AFTER switchToTab"`

Expected: PASS.

- [ ] **Step 4: Run the full openContextMenuQuickAction suite, verify all PASS**

Run: `npm run test -- tests/unit/features/quickActions/openContextMenuQuickAction.test.ts`

Expected: every test in the file passes. The existing `'reuses blank active tab'` test already asserts `switchToTab` is called with `'tab-1'`, which matches the new always-switch behavior.

- [ ] **Step 5: Commit the fix**

```bash
git add src/features/quickActions/openContextMenuQuickAction.ts
git commit -m "fix(quickActions): attach pill after switchToTab so it survives welcome reset"
```

---

## Task 3: Run full project gates

**Files:** none modified — verification only.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`

Expected: exit 0, no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`

Expected: exit 0, no errors.

- [ ] **Step 3: Full unit test suite**

Run: `npm run test`

Expected: exit 0, all tests pass.

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: exit 0, no errors.

- [ ] **Step 5: If any gate failed, stop and surface the failure**

Do not attempt a fix on top of a broken gate without re-reading the spec and the relevant source. Report the failing command and its output verbatim.

---

## Task 4: Mark idea doc shipped, link spec

**Files:**
- Modify: `docs/ideas/As a user I want to start a new chat by right-clicking a file or folder and select a quick-action.md`

- [ ] **Step 1: Read the current idea doc**

Current content:

```markdown
---
status: open
priority: 2 - normal
relations:
  - "[[Chat]]"
  - "[[Quick Actions]]"
tags:
  - qol
---
I want to right-click a file or folder and have a "Quick-Actions" option, the selected file or folder gets added to the chats context and starts a new chat if one is available, if no new tab is available due to tab limit, the user gets presented an error message to inform him.
```

- [ ] **Step 2: Update frontmatter and append a shipped note**

Replace the file contents with:

```markdown
---
status: shipped
priority: 2 - normal
relations:
  - "[[Chat]]"
  - "[[Quick Actions]]"
  - "[[2026-06-04-context-menu-quick-actions-design]]"
tags:
  - qol
---
I want to right-click a file or folder and have a "Quick-Actions" option, the selected file or folder gets added to the chats context and starts a new chat if one is available, if no new tab is available due to tab limit, the user gets presented an error message to inform him.

## Shipped 2026-06-04

Implemented via spec [[2026-06-04-context-menu-quick-actions-design]]. Blank-active tab is reused when present (no needless tab spawn); otherwise a new tab is created and the pill is attached after `switchToTab` so the welcome reset does not wipe it.
```

- [ ] **Step 3: Commit doc update**

```bash
git add docs/ideas/"As a user I want to start a new chat by right-clicking a file or folder and select a quick-action.md"
git commit -m "docs(ideas): mark right-click quick-action idea as shipped"
```

---

## Self-Review

**Spec coverage:**
- Pill attach ordering (Revision item 1) → Task 1 (test) + Task 2 (fix).
- One code path / always-switch (Revision item 2) → Task 2 implementation matches single-path pseudocode.
- Target tab selection (blank-reuse | createTab | Notice bail) → unchanged from current code; existing tests in the file already cover all three paths.
- TFile / TFolder branch → unchanged; covered by existing tests.
- Self-switch tradeoff (wipes manual pills) → documented in comment inside Task 2 implementation.
- Tests table → existing tests cover most rows; Task 1 adds the new ordering row.

**Placeholder scan:** No TBDs, TODOs, "implement later", or vague handwaves. Every step has the literal text/code to apply.

**Type consistency:** Method names `attachFileAsPill`, `attachFolderAsPill`, `switchToTab`, `sendMessage`, `getAttachedMentionSuffix`, `resetForNewConversation` match real source. Test uses `mock.invocationCallOrder` which is the actual Jest API.
