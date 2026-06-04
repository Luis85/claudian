---
type: improvement
status: done
tags:
  - ux
priority: 1 - high
relations:
  - User Experience
---

> **Status (2026-06-03): shipped.** All four items landed in Phase 1b (`e2f389a`): active-tab badge,
> `needsAttention` indicator, tab-switch-while-blocked, and session title in the header. Verified against
> the tree in [[2026-06-03-comprehensive-improvement-proposal]].

## Issues

- when using multiple tabs and all tabs are working, its hard to depict which tab is the current active one
- when a tab needs attention, like agent waits for user input, there is no indicator for the user to inform him
- when an active tab has open user questions, the user is not able to move to another tab, he must answer the questions first
- the chat title is just visible by hovering over the tab, its hard to grasp what the active session is all about, instead of the plugins name in the header it should show the sessions title
- 