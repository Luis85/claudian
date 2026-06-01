---
priority: 1 - high
relations:
  - Product
status: open
---
# Specorator standalone product vision

Status: idea / product-transition draft  
Date: 2026-05-28  
Owner: Specorator / Claudian transition  
Repository transition target: <https://github.com/Luis85/specorator>  
Current implementation source: this repository (`claudian`)  
Related:

- [[docs/ideas/2026-05-28-plugin-improvement-research-proposal.md]]
- [[docs/ideas/agent-board-symphony.md]]
- [[docs/issues/agent-board-mvp.md]]

## Executive summary

This plugin should become the new **Specorator** Obsidian plugin.

The current `claudian` codebase should supersede the existing `Luis85/specorator` plugin implementation. The existing Specorator repository should not be treated as the implementation baseline to incrementally patch. It should be treated as the product-history, requirements, docs, and naming home that will be rethought around the stronger product foundation now present here: provider-native agent runtimes, Obsidian-native context, safe edits, auditability, and future Markdown work orders.

The product transition should move from:

> Specorator as a workflow-cockpit shell for an external agentic workflow template

and from:

> Claudian as a fork-derived embedded agent chat plugin

to:

> **Specorator is the spec-driven agent workspace for Obsidian: capture intent in Markdown, run provider-native agents, review every change with evidence, and keep the durable product/spec/code trail in your vault.**

This is a rename plus a product synthesis, not just a repository move. The current plugin state here becomes the new implementation foundation; the previous Specorator work is mined for product concepts, terminology, docs, traceability ideas, and workflow discipline.

Important sequencing decision: **Agent Board MVP is the next product increment before the migration to `Luis85/specorator`.** The migration should not happen while the product is still "mostly embedded chat plus future vision." Build the Agent Board MVP here first, using [[docs/issues/agent-board-mvp.md]] as the increment PRD, then migrate the stronger implementation and product story into Specorator.

## Source-state assumptions

As of 2026-05-28, the public `Luis85/specorator` repository describes Specorator as an Obsidian plugin and companion app for spec-driven, agentic software development. Its README says v1 alpha establishes a plugin foundation, installs/manages an `agentic-workflow` template, provides a workflow cockpit, and keeps generated content as Markdown. It also describes a v2 companion-app direction with `agentonomous`, a Vue/Vite/Pinia stack, BRAT distribution, requirements intake, traceability docs, and a separate MCP plugin.

Those ideas still matter, but the implementation center should change:

- **Keep / reinterpret:** spec-driven workflow, Markdown artifacts, requirements intake, traceability, quality gates, documentation discipline, the Specorator name, and the desire to guide users from idea to release.
- **Supersede:** the existing plugin shell as the primary implementation baseline, the workflow-cockpit-first product center, and any roadmap that assumes the agent layer arrives later through a separate companion-app direction.
- **Adopt from this repository:** provider-native sidepanel runtime, multi-provider architecture, inline edit, provider sessions, skills/subagents, safety work, context work, and Agent Board planning.


## Bridge increment before migration: Agent Board MVP

Before the repository/product migration, the current plugin should receive one major bridge increment: **Agent Board MVP** from [[docs/issues/agent-board-mvp.md]]. This increment is the proof that the future Specorator is not just a renamed Claudian and not just the old Specorator workflow shell.

### Why Agent Board must land before migration

- It creates the missing bridge between legacy Specorator's spec/workflow intent and this repository's provider-native agent execution.
- It gives the migration a concrete product reason: Specorator becomes a work-order control plane, not a rebranded chat sidebar.
- It lets the old Specorator "workflow cockpit" be superseded by a better cockpit: Markdown work orders, status lanes, visible sidepanel runs, ledgers, and handoffs.
- It keeps migration risk lower: first prove the feature in the current implementation, then move/rename with a stronger demo and clearer docs.

### Scope to honor from the PRD

The migration plan should treat the Agent Board MVP PRD as binding for the next increment:

- New feature module: `features/tasks`.
- Deep modules:
  - `TaskNoteStore` for safe work-order parsing/writes, generated-region ownership, and compare-and-swap protection.
  - `TaskStateMachine` for pure status transition rules.
  - `TaskExecutionSurface` with `ChatTabExecutionSurface` as the only MVP adapter.
  - `WorkflowNoteStore` for strict workflow prompt rendering.
- Board statuses: `inbox`, `ready`, `running`, `needs_input`, `needs_approval`, `review`, `needs_fix`, `done`, `failed`, `canceled`.
- Work-order notes remain plain Markdown with YAML frontmatter and explicit generated ledger/handoff regions.
- Execution reuses the existing sidepanel chat/runtime UI; it must not parse provider JSON-RPC or transcripts directly.
- MVP remains manual and visible: Run, Stop, Retry, Mark review/done/canceled.
- Out of scope before migration: autonomous daemon, dependency DAGs, multi-agent pool, worktree allocator, headless execution, auto-push, auto-PR, auto-merge.

### Migration gate

Do not replace the `Luis85/specorator` implementation until Agent Board MVP has at least:

- work-order creation/indexing;
- board lanes and cards;
- run binding to a sidepanel chat tab;
- generated run ledger and handoff writes;
- one-run-per-work-order protection;
- status transition tests;
- `TaskNoteStore` tests proving user-authored Markdown is preserved.

The migration can still be prepared in docs while Agent Board is built, but the implementation move should wait until this bridge increment exists.


### Non-regression rule: chat remains first-class

Agent Board / workspace workflows are additive. They must not become mandatory. A user must always be able to use provider-backed agent chat sessions exactly as they can today, without creating a work order, opening the workspace/board feature, or adopting a spec-driven workflow.

Required product rule:

- **Chat sidepanel is a standalone primary surface.** It remains available for ad-hoc questions, current-note work, inline edits, provider sessions, history, skills, subagents, and normal agent chat.
- **Workspace / Agent Board is optional.** It adds durable work-order orchestration for users who want spec-driven execution, but it must not gate chat, provider setup, send/stream/cancel, resume, fork, inline edit, attachments, or provider-specific capabilities.
- **The two surfaces should interoperate.** A chat can be promoted into a work order, and a work order can run through a chat tab, but neither surface owns the other.
- **No regression is acceptable on the chat sidepanel.** Agent Board changes must preserve existing chat behavior and should be tested as such.

Architectural implication:

- `features/tasks` depends on the existing chat/runtime seams through `TaskExecutionSurface` / `ChatTabExecutionSurface`.
- Chat modules must not depend on Agent Board state to function.
- Work-order metadata can link to conversations, but conversations must not require work-order metadata.


### Configurable workspace rule

The workspace / Agent Board must be configurable enough to fit the user's process, role, and available collaborators. The default board can ship with opinionated MVP lanes, but it must not hard-code one universal delivery workflow.

Required product rule:

- **Board lanes are configurable.** Users should be able to adapt lane names, order, visibility, WIP expectations, and which statuses appear on the board.
- **Definition of ready and definition of done are configurable per lane/step.** Each board step can define entry criteria, exit criteria, required evidence, review checklist, and handoff expectations.
- **Roles are configurable.** A board can model a solo user, humans plus agents, or agent-only roles. Roles might include owner, requester, implementer, reviewer, QA, release owner, architect, or named/custom agents.
- **Assignments are explicit.** A work order should be able to say who/what owns the next step: a human, a provider-backed agent, a named subagent/skill, or an external collaborator.
- **Defaults remain simple.** New users should get a usable default board without configuring process rules first.

Architectural implication:

- Keep the MVP status lifecycle stable internally, but introduce a future `WorkspaceBoardConfig` / workflow-config model that maps user-facing lanes and criteria to the underlying state machine.
- Do not bake lane names, DoR/DoD text, or role assumptions into core task logic.
- Store board configuration as readable Markdown/YAML/JSON in the vault or plugin settings, with versioning and validation.
- Agent prompts for work orders should include the relevant lane criteria and assigned role, not global process folklore.

## Product identity decision

### Decision

Specorator should be the standalone product name and future repository identity. The current Claudian plugin should become Specorator's implementation foundation.

### What remains true

- The current codebase has upstream history from the original Claudian Obsidian plugin and must preserve appropriate MIT license attribution.
- The existing Specorator repository contains product history and useful docs that should be reviewed before the transition is finalized.
- Git history should not be rewritten to hide either origin.
- Provider-native runtimes such as Claude Code and Codex remain a core strength.

### What changes

- The product should stop presenting itself as a Claudian fork.
- The product should also stop presenting old Specorator as a workflow shell waiting for agents in a later v2.
- **Specorator becomes the name for the integrated product:** spec workflow + provider-native agents + Obsidian-native control plane + review evidence.
- The `Luis85/specorator` repository should become the long-term home after a deliberate replacement/migration, not a parallel competing plugin.

### Recommended positioning

> **Specorator turns Obsidian into a spec-driven agent workspace.** Capture requirements and ideas as Markdown, delegate work to provider-native agents, keep context and permissions visible, and review the resulting changes with evidence before they become part of your vault or codebase.

### Short tagline candidates

- **From spec to shipped change, inside Obsidian.**
- **Plan in Markdown. Run agents. Review with evidence.**
- **Spec-driven agent work for Obsidian.**
- **Your vault as the control plane for agentic delivery.**

Recommended first tagline: **From spec to shipped change, inside Obsidian.**

It keeps the Specorator name meaningful and connects the old spec-driven product idea with the new agent runtime foundation.

## Acknowledgement and provenance model

Specorator should acknowledge two roots:

1. **Original Claudian plugin origin** — the current implementation began from MIT-licensed Claudian work by Yishen Tu and evolved through this repository.
2. **Legacy Specorator product origin** — the existing `Luis85/specorator` repository contains earlier product work around spec-driven workflows, templates, requirements intake, and traceability.

The acknowledgement should be honest but not let either origin dominate the new product story.

### Recommended README wording

Use a short "Origins and acknowledgements" section near the bottom of the future Specorator README:

> Specorator combines two project lines: the earlier Specorator work around spec-driven Obsidian workflows, and an evolved provider-native agent plugin that began as a fork of the original Claudian Obsidian plugin by Yishen Tu. The new Specorator product direction supersedes the previous Specorator plugin shell while preserving useful ideas, docs, and attribution. We are grateful for the original MIT-licensed Claudian work and preserve provenance in the license, credits, and project history.

### Recommended transition-note wording

For the release or PR that performs the move:

> This change starts Specorator's transition to a new implementation foundation. The existing Specorator plugin shell is superseded by the current provider-native agent workspace codebase. Earlier Specorator docs and workflow concepts remain product inputs; the original Claudian upstream is acknowledged as implementation provenance.

### Recommended metadata stance

- Final display name: **Specorator**.
- Working subtitle: **Spec-driven agent workspace for Obsidian**.
- Keep MIT license notices and add a `CREDITS.md` or `NOTICE` if needed.
- Do not imply endorsement by the original Claudian upstream.
- Do not keep "Claudian" in end-user product copy except in provenance/credits and migration notes.
- Use "legacy Specorator" only in transition docs, not recurring marketing copy.

## What Specorator is becoming

### Product category

Specorator should define a category broader than "AI chat plugin" and more concrete than "agentic workflow cockpit":

> **Spec-driven agent workspace** — a local-first Obsidian control plane where requirements, specs, provider runtimes, tool permissions, work orders, review evidence, and release memory live as Markdown.

This category has five pillars.

### 1. Spec-first intent

The user starts with intent, not a blank chat box.

Specorator should help capture:

- idea notes;
- requirements;
- acceptance criteria;
- constraints;
- linked context;
- decisions;
- review checklists;
- release or handoff notes.

The agent should be grounded in a spec-shaped artifact whenever work needs durability.

### 2. Provider-native agency

Specorator should use real provider runtimes rather than reimplementing shallow chat behavior.

Current foundation from this repository:

- Claude provider via Claude Code / Claude Agent SDK paths;
- Codex provider via app-server and JSON-RPC transport;
- provider-neutral conversations with provider-owned state;
- provider-specific skills, commands, subagents, sessions, history, and streaming;
- inline edit and sidepanel execution.

Product implication:

- Specorator can support different agent engines while preserving a common spec/review workflow.
- Provider differences should be visible as capabilities, not hidden as broken parity.

### 3. Vault-native context and artifacts

Specorator should treat Obsidian as the source of product truth:

- notes, selections, folders, images, canvases, browser captures, and wiki-links are context;
- work orders, specs, ledgers, and handoffs are Markdown artifacts;
- generated regions are explicit and narrowly owned;
- durable discoveries should update or link to canonical notes rather than disappear in chat.

### 4. Trust and review loop

The core activation metric should be:

> first trusted spec-to-change loop

not merely:

> first model response

That loop is:

1. create or select a spec-shaped artifact;
2. inspect what context and permissions the agent will use;
3. run the provider-native agent visibly;
4. review diffs, actions, and evidence;
5. write the handoff/result back into Markdown.

### 5. Work-order orchestration

The Agent Board becomes the product wedge that makes the rename worthwhile.

Specorator should evolve from one-off chat into:

- Markdown work orders;
- status lanes;
- visible sidepanel runs;
- run ledgers;
- evidence bundles;
- review gates;
- later, worktrees and controlled automation.

The board should not be a generic task manager. It should be an execution/review layer for spec-driven agent work.


### 6. Configurable workspace process

Specorator should support different ways of working. A solo builder, a product manager coordinating agents, a developer using human review, and an agent-only experimentation setup should all be able to shape the board.

Configuration should eventually cover:

- lane names, order, and visible statuses;
- per-lane definition of ready;
- per-lane definition of done;
- required evidence and review checklists;
- role definitions and assignment rules;
- whether a lane is human-owned, agent-owned, or mixed;
- default prompts/templates for each lane or role.

The product should provide strong defaults, but the workspace belongs to the user.

## Relationship to legacy Specorator

The existing Specorator repo should be reviewed and selectively harvested, but not preserved as the primary architecture.

| Legacy Specorator element | Future treatment |
| --- | --- |
| Specorator name | Keep as final product identity. |
| Spec-driven workflow | Keep, but connect it directly to agent execution and review. |
| Workflow cockpit | Reinterpret as Agent Board + spec/work-order detail panes. |
| Agentic workflow templates | Convert into workflow notes/templates for work orders. |
| Requirements intake | Keep as a product discipline; potentially use for work-order creation. |
| Traceability docs | Keep and connect to run ledger, evidence, and handoff. |
| Vue/Vite app shell | Supersede unless a future UI rewrite explicitly justifies it. |
| Companion app / agentonomous v2 | Re-evaluate; provider-native agent runtimes are now already inside the plugin. |
| Separate MCP plugin note | Re-evaluate under the new safety/control-plane story. |
| Existing issues/PRs | Triage into keep, superseded, migrate, or close with explanation. |

## Relationship to Claudian

The current repository should be treated as the implementation source and transitional codename, not the final product identity.

| Claudian element | Future Specorator treatment |
| --- | --- |
| Provider-neutral core | Keep and deepen. |
| Claude/Codex adapters | Keep as provider-native runtime foundation. |
| Sidebar chat | Keep as live execution surface, not final product center. |
| Inline edit | Keep and make spec/review-aware. |
| Skills/subagents/provider commands | Keep, surface as capabilities. |
| `.claudian/` storage | Decide whether to migrate to `.specorator/`; avoid breaking users silently. |
| Claudian name | Remove from user-facing product copy after migration, keep in credits/history. |
| Fork-origin README copy | Replace with Specorator product positioning. |
| Current Agent Board idea | Promote as central Specorator wedge. |

## Product principles

Use these as review criteria for future Specorator ideas, issues, and PRs.


### 0. Chat remains a first-class mode

Specorator must preserve the current agent chat sidepanel as an independent workflow. The workspace/Agent Board feature is an optional orchestration layer, not a replacement for chat. Users can choose ad-hoc chat, spec/work-order mode, or both.

### 1. Start with a spec-shaped artifact

If the user is delegating meaningful work, the workflow should create or reference a durable artifact: idea, requirement, spec, work order, acceptance criteria, design note, or issue.

### 2. Make context inspectable

The user should see what notes, selections, files, folders, images, browser selections, MCP resources, and external paths are involved.

### 3. Make agent action reviewable

File writes, shell commands, MCP calls, network access, external paths, commits, and generated handoffs should leave a trail.

### 4. Prefer provider-native depth over fake parity

Each runtime can keep its strengths. Shared Specorator value lives in workflow, context, safety, review, and durable Markdown artifacts.

### 5. Keep artifacts readable without the plugin

Specs, work orders, ledgers, decisions, and handoffs should be ordinary Markdown with YAML frontmatter where useful.

### 6. Supersede deliberately, not destructively

The old Specorator implementation should be replaced by the new foundation, but useful docs, issues, design decisions, and domain language should be migrated or credited rather than discarded blindly.

## Transition plan

### Phase 0 — Inventory and decision record

Goal: decide exactly how the new Specorator replaces the old Specorator repo.

Actions:

- Inventory legacy `Luis85/specorator` docs, issues, PRs, workflows, requirements, and release assets.
- Classify each major artifact as:
  - **keep** — still directly relevant;
  - **migrate** — useful but needs new product framing;
  - **supersede** — old implementation or direction replaced by current codebase;
  - **archive** — preserve for history only.
- Decide repository strategy:
  - replace contents of `Luis85/specorator` with the current implementation;
  - or create a new repository and archive/redirect old Specorator;
  - or keep old repo as docs/history and move code separately.
- Decide package/plugin identity:
  - plugin ID;
  - display name;
  - install path;
  - settings folder;
  - migration from `.claudian/` to `.specorator/` if desired.

Recommended default:

- Use `Luis85/specorator` as the long-term public repository.
- Replace its implementation with this plugin after docs and migration notes are ready.
- Keep **Specorator** as display name.
- Do not change plugin ID/storage paths until migration impact is explicitly handled.

Exit criteria:

- A decision note exists for repo strategy, plugin ID, storage, and attribution.
- Legacy Specorator artifacts have a keep/migrate/supersede/archive classification.

### Phase 1 — Rewrite the product narrative

Goal: prepare docs before code movement.

Actions in this repository first:

- Update this idea note as the source of transition intent.
- Add a future README outline for Specorator.
- Convert Claudian standalone language into Specorator language.
- Add provenance wording for original Claudian and legacy Specorator.
- Define the new primary demo:
  - create/open a spec or work order;
  - run agent visibly;
  - review diff/evidence;
  - persist handoff in Markdown.

Actions later in `Luis85/specorator`:

- Mark old roadmap assumptions as superseded where needed.
- Add a transition notice before replacing implementation files.
- Preserve links to legacy docs that are still useful.

Exit criteria:

- A user reading the docs understands that new Specorator is not the old workflow shell and not a Claudian fork brand.
- The transition rationale is clear before large file changes happen.

### Phase 2 — Migration decisions, not renaming yet

Goal: prepare identity and compatibility decisions while the plugin still ships from this repository as the pre-migration implementation.

This phase should produce decisions and draft copy, not broad in-app renames. Agent Board MVP is the next implementation increment; product-facing renaming should wait until the bridge demo exists.

Decisions to prepare:

- `manifest.json`
  - future `name`: `Specorator`
  - future `description`: spec-driven agent workspace for Obsidian
  - author/author URL: final maintainer identity
  - `id`: decide carefully; do not change without migration plan
- `package.json`
  - future package name and description
  - future repository URL to `Luis85/specorator` once move is real
- README badges and install instructions
  - draft replacement of Claudian URLs with Specorator URLs
  - draft BRAT/community install instructions for the final repo
- In-app strings
  - inventory Claudian product copy that will later become Specorator copy
  - keep provider names unchanged
- Storage
  - decide whether `.claudian/` remains compatibility storage or migrates to `.specorator/`

Exit criteria:

- The future metadata changes are decided and documented.
- No broad rename has happened before Agent Board MVP unless explicitly approved.
- Existing users will not be silently stranded by future ID/storage changes.

### Phase 3 — Claudian bridge increment: Agent Board MVP before migration

Goal: build the next product increment in the current plugin before moving the implementation to `Luis85/specorator`.

This phase is governed by [[docs/issues/agent-board-mvp.md]]. It is the concrete bridge from Claudian's provider-native chat/runtime foundation to Specorator's spec-driven workflow identity.

Required outcomes:

- `features/tasks` exists as the work-order/board feature module.
- Work-order notes can be created, indexed, opened, and safely updated.
- Agent Board lanes render the MVP status set.
- The implementation does not hard-code user-facing process assumptions in a way that blocks later configurable lanes, roles, definitions of ready, or definitions of done.
- A work order can start a visible sidepanel run through `ChatTabExecutionSurface`.
- The run writes a concise ledger and handoff into generated regions.
- One active run per work order is enforced.
- Tests cover `TaskNoteStore`, `TaskStateMachine`, workflow rendering, execution-surface coordination, and chat sidepanel non-regression paths.
- Existing ad-hoc chat sessions still work without any work-order/workspace state.

Exit criteria:

- The plugin can demo: idea/spec -> Markdown work order -> visible agent run -> ledger/handoff in the note.
- The plugin can also demo the existing flow: open chat sidepanel -> start/resume agent session -> use provider capabilities without Agent Board.
- The old Specorator workflow cockpit can be credibly replaced by Agent Board rather than migrated as-is.
- Repository migration remains pending until this increment is complete.

### Phase 4 — Trust baseline before autonomy claims

Goal: make the new product promise credible before marketing autonomous/spec-to-release workflows.

Source: [[docs/ideas/2026-05-28-plugin-improvement-research-proposal.md]]

Priority work:

1. Provider setup health and diagnostics.
2. Safe default permission modes.
3. Context preview and source handles.
4. Markdown-aware diff/review/revert.
5. Audit events and redacted diagnostic bundles.
6. Clear data-flow copy.

Exit criteria:

- A first-time user can safely connect a provider and complete a trusted spec-to-change loop.
- Specorator can credibly say what leaves the vault and what actions the agent may take.

### Phase 5 — Promote Agent Board as the Specorator workflow cockpit

Goal: after Agent Board MVP exists in this repository, make it the conceptual successor to the old Specorator workflow cockpit.

Sources:

- [[docs/ideas/agent-board-symphony.md]]
- [[docs/issues/agent-board-mvp.md]]

Product promise to carry into the migration:

> Create a Markdown work order from a spec or idea, run it through a visible provider-native sidepanel session, and write the run ledger and handoff back into the note.

Why this supersedes old Specorator:

- The cockpit is no longer just a checklist over templates.
- It becomes a real execution control plane.
- Requirements, context, run state, evidence, and handoff are connected.

Migration mapping:

- chat sidepanel remains the direct agent-session surface for users who do not opt into workspace/work-order mode;
- legacy workflow stages become configurable lanes, workflow notes/templates, and board filters;
- legacy feature records become work-order notes or linked spec notes;
- legacy traceability docs connect to run ledger, evidence, and handoff;
- legacy quality gates become configurable definition-of-ready / definition-of-done criteria rather than a separate cockpit model.

Exit criteria:

- The default migration demo is "turn this spec into a work order, run it visibly, and review the evidence in Markdown."
- The direct chat demo still works independently and is documented as a first-class mode.
- The board has a documented path from MVP fixed statuses to configurable lanes, roles, and DoR/DoD criteria.
- The old workflow cockpit can be retired or reimagined as a board/detail view.

### Phase 6 — Architecture alignment

Goal: make the implementation express Specorator's product seams.

Priority seams:

- `ComposerContextBuilder`
  - normalizes note/selection/file/browser/canvas/image/tool context before provider encoders.
- Provider capability resolver
  - exposes real provider abilities and unsupported features honestly.
- `ConversationSessionEnvelope`
  - provider-neutral session metadata with opaque provider state.
- `TaskExecutionSurface`
  - Agent Board uses chat tabs now and can add worktree/headless adapters later.
- Audit/diagnostics module
  - redactable operational event stream.
- Workflow/template store
  - converts legacy Specorator workflow templates into strict prompt/work-order templates.
- `WorkspaceBoardConfig`
  - maps configurable lanes, role definitions, definitions of ready/done, and review evidence requirements onto the internal task state model.

Exit criteria:

- Provider work does not duplicate context/safety/work-order logic.
- Spec/workflow artifacts become first-class product modules.
- Legacy Specorator workflow concepts have a clean place in the new architecture.

### Phase 7 — Repository replacement / move

Goal: make `Luis85/specorator` the actual home of the new product.

Potential strategies:

#### Strategy A — Replace repository contents in place

- Create a transition branch in `Luis85/specorator`.
- Preserve selected legacy docs under `docs/legacy/` or through git history.
- Copy/move current implementation from this repository.
- Update package metadata and README.
- Close/migrate old PRs/issues with labels and explanations.

Pros:

- Keeps existing repo URL and BRAT install target.
- Clear public continuity for Specorator.

Cons:

- Large diff; must be carefully explained.
- Open PRs and issue context may become stale.

#### Strategy B — Archive old repo and create clean new repo

- Archive or freeze `Luis85/specorator` with a pointer to the new repository.
- Move current implementation into a new Specorator repo.

Pros:

- Clean history and issue tracker.

Cons:

- Loses existing URL continuity and BRAT install path.
- More public confusion.

#### Strategy C — Keep old repo as docs/history, code elsewhere

- Use old Specorator for product docs and a separate plugin repo for code.

Pros:

- Avoids destructive replacement.

Cons:

- Splits attention and weakens product clarity.

Recommended default: **Strategy A**, but only after docs, metadata, and migration notes are prepared.

Exit criteria:

- The public Specorator repo contains the new implementation.
- Legacy artifacts are preserved or intentionally closed/superseded.
- README and release instructions match the new product.

### Phase 8 — Standalone release

Goal: release Specorator as the new product, not as a Claudian fork and not as the legacy shell.

Release checklist:

- Product-facing metadata updated.
- README rewritten around Specorator.
- Provenance and credits added.
- Legacy Specorator transition note added.
- Build/typecheck/lint/tests pass.
- Release asset smoke test passes.
- Screenshots show Specorator surfaces.
- BRAT/community install instructions are correct.
- Migration notes explain plugin ID, folder, settings, and provider-config impacts.

Exit criteria:

- A user installing the release sees Specorator as one coherent product.
- Existing watchers of `Luis85/specorator` understand what changed and why.
- Claudian remains an acknowledged implementation origin, not the current brand.

## Migration concerns

### Plugin ID

Changing the Obsidian plugin ID can create a clean Specorator identity but may break upgrades or create duplicate installs.

Recommended approach:

1. Do not change `manifest.id` until install impact is decided.
2. If changing the ID, provide explicit migration instructions for:
   - plugin folder;
   - settings files;
   - `.claudian/` vs `.specorator/`;
   - provider configs;
   - session metadata;
   - BRAT/community update path.
3. If keeping the ID initially, change display name and docs first.

### Storage path

A future `.specorator/` path is cleaner, but `.claudian/` may hold existing settings/sessions.

Options:

- Keep `.claudian/` as compatibility storage for one or more releases.
- Add read-through migration from `.claudian/` to `.specorator/`.
- Store a migration marker to avoid repeated moves.
- Leave provider-native paths (`.claude/`, `.codex/`) untouched.

### Legacy Specorator issues and PRs

The existing repo has open issues and PRs. Before replacing implementation:

- label them as `keep`, `migrate`, `superseded`, or `needs-rewrite`;
- preserve any requirements that still matter;
- close obsolete implementation PRs with a transition note;
- turn surviving requirements into new Specorator work orders or docs issues.

### Documentation continuity

Old docs such as product vision, PRD, roadmap, traceability, requirements intake, and glossary may contain useful domain language. They should be migrated selectively into the new docs rather than bulk-copied as authoritative truth.

## Risks and mitigations

### Risk: users see the move as abandoning old Specorator

Mitigation:

- Explain that old Specorator is being superseded because the new foundation is more capable.
- Preserve core ideas: spec-driven workflows, Markdown artifacts, traceability, quality gates.
- Keep a legacy transition note.

### Risk: users see the move as hiding Claudian provenance

Mitigation:

- Add credits and license acknowledgement.
- Keep git history where practical.
- Do not remove upstream attribution.

### Risk: repo replacement creates a confusing massive diff

Mitigation:

- Prepare docs first.
- Use a clearly named transition branch.
- Add a PR summary that explains keep/migrate/supersede/archive decisions.
- Link to this idea note.

### Risk: naming changes break installs

Mitigation:

- Decide plugin ID separately from display name.
- Provide migration instructions.
- Consider a compatibility release before a hard ID/storage migration.

### Risk: workspace mode regresses the chat sidepanel

Mitigation:

- Treat Agent Board as an optional consumer of chat/runtime seams, not as a replacement.
- Keep chat session creation, send/stream/cancel, resume/history, fork, inline edit, attachments, and provider capabilities independent of work-order state.
- Add explicit regression checks for ad-hoc chat flows in Agent Board PRs.
- Document two first-class modes: direct chat and workspace/work-order orchestration.

### Risk: one fixed board workflow does not fit the user's role or team

Mitigation:

- Ship simple defaults, but design the board config as a user-owned process layer.
- Let users define lane names/order, DoR/DoD, role ownership, evidence expectations, and review checklists.
- Keep internal status semantics stable while mapping configurable user-facing lanes to them.
- Make role assignment explicit so a board can represent humans, agents, or mixed collaboration.

### Risk: old workflow-cockpit concepts fight the new agent-workspace model

Mitigation:

- Treat the Agent Board as the successor cockpit.
- Convert workflow templates into work-order templates and review gates.
- Avoid two parallel navigation centers.

## Definition of transition done

Specorator's transition is done when:

- `Luis85/specorator` is the public home for the new implementation or clearly redirects to it.
- End-user product surfaces say **Specorator**.
- Claudian appears only in provenance, migration, and credits.
- Legacy Specorator docs/issues are triaged into keep/migrate/supersede/archive.
- The product pitch is spec-driven agent workspace, not workflow shell or chat fork.
- The chat sidepanel remains a documented first-class mode that works without workspace/work-order adoption.
- Workspace configuration has a documented model for lanes, roles, definitions of ready, and definitions of done.
- The trust baseline supports setup health, visible context, safe edit review, and diagnostics.
- Agent Board or its PRD is positioned as the successor to the old workflow cockpit.
- Release/install instructions match the actual repository and plugin identity.

## Recommended next PR sequence

1. **Transition-docs PR in this repository**
   - Keep this idea note updated.
   - Add README outline for future Specorator positioning.
   - Add initial provenance wording.

2. **Legacy Specorator inventory PR / issue set**
   - Inventory docs, issues, PRs, and release assets in `Luis85/specorator`.
   - Mark keep/migrate/supersede/archive.

3. **Agent Board MVP PR series in this repository**
   - Build the work-order cockpit from [[docs/issues/agent-board-mvp.md]].
   - Keep product strings mostly stable until migration decisions are made.
   - Prove the bridge demo before replacing the Specorator repo.

4. **Identity decision PR**
   - Decide plugin ID, storage path, repo strategy, author metadata, credits file.
   - Use the completed Agent Board MVP to inform naming and migration copy.

5. **Trust baseline PR series**
   - Setup health.
   - Safe permission defaults.
   - Context preview.
   - Markdown diff/revert.
   - Redacted diagnostics/audit foundation.

6. **Metadata rename PR**
   - Rename display strings to Specorator.
   - Update descriptions and docs.
   - Keep compatibility where needed.

7. **Repository replacement PR**
   - Move/copy implementation into `Luis85/specorator` according to the chosen strategy.
   - Preserve or archive selected legacy docs.
   - Publish migration notes.

## Open questions

- Should the final plugin ID be `specorator`, or should compatibility with the current ID take priority for early transition releases?
- Should `.claudian/` migrate to `.specorator/`, remain as compatibility storage, or be abstracted behind a stable storage service first?
- Which legacy Specorator docs should become canonical product docs, and which should move to archive?
- Does `agentonomous` remain part of the roadmap, or does provider-native runtime integration supersede it for the foreseeable future?
- Should the separate `specorator-obsidian-mcp` plugin remain separate, or become an optional companion controlled from Specorator's safety surface?
- Which parts of the trust baseline must land before migration, and which can follow after Agent Board MVP?
- What board configuration belongs in MVP versus the first Specorator release: lane names/order, DoR/DoD, roles, assignment rules, or workflow templates?

## Recommendation

Proceed with the transition, but make it explicit that this is a **Specorator supersession**:

1. Build Agent Board MVP in the current plugin first, using [[docs/issues/agent-board-mvp.md]] as the next-increment PRD.
2. Then make the current plugin the new Specorator implementation foundation.
3. Treat the old Specorator repo as the target home and product-history source.
4. Acknowledge Claudian origin respectfully.
5. Do not let legacy Specorator implementation assumptions constrain the new architecture.
6. Preserve direct agent chat as a first-class non-workspace mode with no regressions.
7. Design workspace configuration so users can adapt lanes, roles, definitions of ready, and definitions of done to their process.
8. Make the product promise: **spec-driven agent work in Obsidian, with visible context, provider-native execution, configurable workspace flow, and reviewable evidence — while keeping ad-hoc provider chat always available.**
