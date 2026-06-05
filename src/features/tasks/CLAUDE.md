# Tasks / Agent Board Feature

`features/tasks` owns Markdown work orders, Agent Board UI, task prompt rendering, run coordination, and generated ledger/handoff writes.

## Boundaries

- Task code may call chat only through `TaskExecutionSurface`.
- Direct chat must not depend on tasks.
- Provider-specific behavior stays behind `ChatRuntime`, `ProviderRegistry`, and existing chat controllers/renderers.
- Work-order notes are the durable source of task state for this feature slice.
- WO card right-click is a renderer→view callback seam (`AgentBoardRenderCallbacks.onContextMenu`) dispatched through `ui/workOrderContextMenu.ts`, which reuses `features/quickActions/` helpers without coupling tasks to chat.