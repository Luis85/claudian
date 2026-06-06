---
priority: 3 - low
relations:
  - Integrations
  - Cross Cutting
status: done
tags:
  - wont-do
---

Superseded by [[2026-06-06-remove-orchestrator-feature-design]]: Orchestrator will be removed instead of integrated with Agent Board.

As of right now, the Orchestrator is just working inside the chatpanel, spawning workers in tabs and does not respect the max tabs settings, which is fine, as it usually needs up to five 5 tabs.

Since the Agent Board is implemented, we should now make the work visible on the Board, too and integrate the dispatched work there. This will also lead to better traceability by using ledger and handoff from the board.