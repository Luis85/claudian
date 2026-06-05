---
type: quick-action
name: Frontend Performance UI
description: Audit or improve Claudian frontend responsiveness for long chats, streaming updates, large tool output, and heavy UI states.
icon: gauge
tags:
  - frontend
  - performance
  - rendering
  - ui
---

Use this action when a Claudian UI change could affect rendering performance, input responsiveness, scroll behavior, streaming updates, or large conversation/tool-call displays.

## 1. Identify the performance-sensitive path

Determine which path is affected:

- Message rendering and scrolling.
- Streaming assistant text.
- Tool-call rendering and updates.
- Conversation history dropdowns.
- Tabs/navigation sidebars.
- Agent Board cards/work orders.
- Settings screens with many controls.
- Large pasted images or file/context chips.

Read the relevant renderer/controller and existing perf tests in `tests/perf/` when applicable.

## 2. Audit common regressions

Check for:

- Rendering unbounded DOM for long conversations when a windowed/bounded pattern exists.
- Per-chunk O(n) scans during streaming or tool-call updates.
- Layout thrash from repeated measurements/writes.
- Expensive CSS effects on large/repeated elements (`filter`, heavy shadows, blur, large animations).
- Scroll handlers without throttling or clear bounds.
- Re-rendering all messages when one message changes.
- Long synchronous work on input, paste, drop, or stream events.
- CSS transitions that animate layout-affecting properties unnecessarily.

## 3. Recommend safe improvements

Prefer:

- Bounded render windows or incremental updates.
- Stable IDs and direct lookup maps for streaming/tool state.
- CSS transforms/opacity for animation instead of layout properties.
- `contain`, `content-visibility`, or virtualization only where compatible and tested.
- Existing helper utilities over new abstractions.
- Targeted perf tests for scaling behavior, not brittle timing assertions.

## 4. Output

If reviewing, return:

| Severity | File | Hot path | Finding | Suggested fix |
|----------|------|----------|---------|---------------|

If implementing, follow `AGENTS.md` project workflow. Add or update a perf test when changing a known scaling-sensitive path.

## 5. Verification

For CSS-only changes:

```bash
npm run build:css
```

For TypeScript/UI rendering changes:

```bash
npm run typecheck
npm run lint
npm run test:perf
```

If `npm run test:perf` is too broad for the change, run the specific perf spec and explain the scope.
