---
type: quick-action
name: Create work-order from plan
description: Generate a populated work-order file from a plan document. Provide plan path.
icon: clipboard-list
favorite: true
favoriteRank: 2
---

Create a work-order from a plan document.

Steps:
1. Read the plan file (user will provide path or it's in current note context)
2. Extract: objective/goal, acceptance criteria, and instruction to execute the linked plan
3. Before writing, read an existing work-order in `Agent Board/tasks/` to confirm the exact frontmatter schema in use
4. Create work-order markdown file in `Agent Board/tasks/` named `work-order-YYYYMMDD-<slug>.md` with:
   - Frontmatter (exact schema — do not invent field names or values):
     ```yaml
     type: claudian-work-order
     schema_version: 1
     id: work-order-YYYYMMDD-<slug>
     title: "<title>"
     status: inbox
     priority: 2 - normal
     created: <ISO timestamp>
     updated: <ISO timestamp>
     provider: claude
     model: claude-sonnet-4-5
     run_id:
     conversation_id:
     sidepanel_tab_id:
     started:
     finished:
     attempts: 0
     ```
   - Objective section (goal + wikilinks to plan/spec/issue docs)
   - Acceptance Criteria section (all criteria as checklist items)
   - Context section with clear link and instruction to execute the linked plan
   - Plan reference: ask user for plan file path or look in current note context, add the provided plan as wikilink to the work-order.
   - Constraints section (any limitations or out-of-scope items)
   - Execution Instructions: Subagent-Driven (recommended) on an isolated worktree — fresh subagent per task, review between tasks and keep the work-order updated between tasks, two-stage check with dedicated subagents; follow up with a dedicated review and polishing pass once done 
   - Important: Update docs during execution to keep underlying work-order and docs up-to-date;
   - Add wikilinks to the referenced plan to link WO and plan together for better visibility
   - Run Ledger section:
     ```
     ## Run Ledger
     <!-- claudian:run-ledger-start -->
     - <ISO timestamp> [inbox] Created from plan.
     <!-- claudian:run-ledger-end -->
     ```
   - Result / Handoff section:
     ```
     ## Result / Handoff
     <!-- claudian:handoff-start -->
     <!-- claudian:handoff-end -->
     ```
5. Use Write tool directly — do NOT use TaskCreate. File body must be fully populated, not templated.
6. Return the path to the created work-order file.
