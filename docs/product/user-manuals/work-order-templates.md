---
date: 2026-06-04
status: shipped
scope: user-manual
parent: "[[Agent Kanban Board]]"
---
# Agent Board — Work-Order Templates

This manual covers **work-order templates**: reusable starting points you pick from when creating an Agent Board work order, so common task types are faster to prepare.

A **template** is a Markdown note (`type: claudian-work-order-template`) that supplies a work order's body and optional defaults for provider, model, priority, and a picker **icon**. Templates live in their own folder and never appear on the board as work orders.

---

## Before you start

Set this once in **Settings → Claudian → Agent Board**:

| Setting | What it does | Default |
|---------|--------------|---------|
| **Template folder** | Where template notes live. | `Agent Board/templates` |

Keep the **Template folder** different from the **Work order folder**. If they match, the settings panel shows a warning — templates in the work-order folder would be flagged as invalid notes on the board.

Templates still use your Agent Board **Default provider** / **Default model** as a fallback (see [Prefill rules](#prefill-rules)), so set those too.

---

## Creating a template

Four ways, easiest first.

### 1. Install the starter set
Two equivalent surfaces — pick either:

- Command palette → **Install common work-order templates**.
- **Settings → Claudian → Agent Board → Common templates → Install**.

Writes six presets — **Bug fix**, **Feature**, **Refactor**, **Research spike**, **Documentation**, **Test backfill** — into your **Template folder**. Idempotent: any preset whose filename already exists is skipped, so re-running won't clobber edits.

### 2. Inline editor (picker)
Open the template picker (any work-order create surface — see [Using a template](#using-a-template)) → click **New template** in the footer. A modal opens with fields for **Name**, **Description**, **Icon** (Lucide picker), **Provider** (enabled providers), **Model** (filtered to the chosen provider), **Priority**, and **Body** (textarea with placeholder support). Save → the template is written to the Template folder and the picker refreshes so you can apply it right away.

Edit and Delete buttons on each picker row open the same editor or move the note to the system trash (respecting your "Move to system trash" preference).

### 3. Scaffold one (command)
Command palette → **Create work-order template**. Writes a single example template into your **Template folder** and opens it. Edit it to taste.

### 4. Author one by hand
Create a Markdown note in the **Template folder** with `type: claudian-work-order-template`. Anatomy:

```markdown
---
type: claudian-work-order-template
schema_version: 1
name: Bug fix              # picker label (falls back to the filename)
description: Fix a defect. # optional; shown as the picker's detail line
icon: bug                  # optional Lucide icon id shown on the picker row
provider: claude           # optional default
model: sonnet              # optional default
priority: high             # optional (low | normal | high | urgent)
---
# {{title}}

## Objective
Fix the bug described below.

## Acceptance Criteria
- [ ] Repro confirmed
- [ ] Fix covered by a test

## Context
{{source}}

## Constraints
- Do not modify unrelated files.
```

Write only the human sections. Claudian appends the **Run Ledger** and **Result / Handoff** regions automatically when the work order is created — don't add them yourself.

> Keep the `## Objective`, `## Acceptance Criteria`, `## Context`, and `## Constraints` headings. The run prompt reads them by name; a template that drops one just produces an empty section.

> The inline editor writes YAML values double-quoted (e.g. `name: "Bug fix"`). Hand-authored templates can use unquoted scalars too — both parse the same.

---

## Placeholders

Template bodies support three placeholders, filled in at creation time:

| Placeholder | Becomes |
|-------------|---------|
| `{{title}}` | The work-order title (source note/folder name, or `New work order`). |
| `{{date}}` | Creation date, `YYYY-MM-DD`. |
| `{{source}}` | A wiki-link to the source note (`[[…]]`), a `` `folder/path` `` for a folder source, or empty when there's no source. |

Only these three are allowed. An unknown placeholder (e.g. `{{author}}`) **aborts creation** with a notice naming the bad token — no file is written. Fix the template and try again.

---

## Prefill rules

When you create a work order from a template:

- **Body** — the template body, with placeholders resolved.
- **Provider / model / priority** — taken from the template's frontmatter when set and valid; otherwise the Agent Board **Default provider** / **Default model** (priority falls back to `normal`).
- If the template names a provider that isn't enabled, or a model that provider doesn't own, Claudian falls back to the default and shows a notice.
- **Icon** — used only on the picker row; never written to the created work-order note.
- Generated fields (`id`, `created`, `updated`, run fields) and the Run Ledger / Handoff regions are always written by Claudian.

Templates do **not** set the initial status — that stays controlled by where you created the work order (the board's **Add work order** lands in `inbox`; the commands land in `ready`).

---

## Using a template

When you create a work order, a **picker modal** always opens. It lists a pinned **Blank work order** row at the top, then every template (alphabetical) as a row with its icon, name, and description. A **New template** button at the bottom opens an editor for authoring a fresh template inline.

- Click a row to apply that template (or pick **Blank work order** for the classic empty skeleton).
- Each template row has **Edit** and **Delete** buttons. **Edit** opens the same editor pre-filled; **Delete** moves the template note to the system trash (respecting your "trash" preference).
- **New template** opens the editor with empty fields. Save → the picker list refreshes; pick the new row to apply it.
- **No templates yet?** The picker still opens with just the **Blank work order** row plus the **New template** button.
- **Press Esc / dismiss** the picker → nothing is created.

The editor exposes: **Name** (filename source; disabled on edit), **Description**, **Icon** (Lucide picker), **Provider** (dropdown of enabled providers), **Model** (dropdown filtered to the chosen provider), **Priority** (dropdown), and **Body** (textarea with placeholders).

The picker appears on these fresh-creation surfaces:

- **Add work order** button on the board
- Command **Create work order**
- Command **Create work order from current note**
- Command / editor right-click **Create work order from selection**
- File-explorer right-click **Create work order** (on a file or folder)

> Capture flows that pull content from a source — **browser selection** and the chat **Create work order** / **current chat conversation** promotions — do **not** show the picker. Their objective/context come from the captured material, which a template body would overwrite.

---

## Command reference

| Command | What it does |
|---------|--------------|
| **Create work-order template** | Scaffolds an example template note in the Template folder and opens it. |
| **Install common work-order templates** | Writes a starter set (Bug fix, Feature, Refactor, Research spike, Documentation, Test backfill) into the Template folder. Skips any whose filename already exists. |
| **Create work order** | Opens the template picker, then creates from the picked row (or nothing if dismissed). |
| **Create work order from current note** | Picker, then creates with the active note linked as source. |
| **Create work order from selection** | Picker, then creates from the editor selection. |

---

## Typical flow

1. Run **Install common work-order templates** once (or build your own via the picker's **New template** button).
2. Click **Add work order** on the board (or run a create command).
3. In the picker, choose **Bug fix** (or any template) → the new work order opens prefilled with that body, provider, model, and priority.
4. Scope it, move it to **`ready`**, and run it like any other work order.

To tweak a template later: open the picker, click **Edit** on its row, save. To remove one: click **Delete** (moves to system trash).
