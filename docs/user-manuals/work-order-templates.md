# Agent Board — Work-Order Templates

This manual covers **work-order templates**: reusable starting points you pick from when creating an Agent Board work order, so common task types are faster to prepare.

A **template** is a Markdown note (`type: claudian-work-order-template`) that supplies a work order's body and optional defaults for provider, model, and priority. Templates live in their own folder and never appear on the board as work orders.

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

### Scaffold one (command)
Command palette → **Create work-order template**. This writes an example template into your **Template folder** and opens it. Edit it to taste.

### Author one by hand
Create a Markdown note in the **Template folder** with `type: claudian-work-order-template`. Anatomy:

```markdown
---
type: claudian-work-order-template
schema_version: 1
name: Bug fix              # picker label (falls back to the filename)
description: Fix a defect. # optional; shown as the picker's detail line
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
- Generated fields (`id`, `created`, `updated`, run fields) and the Run Ledger / Handoff regions are always written by Claudian.

Templates do **not** set the initial status — that stays controlled by where you created the work order (the board's **Add work order** lands in `inbox`; the commands land in `ready`).

---

## Using a template

When you create a work order, a **picker** opens listing **Blank** plus every template (alphabetical). Pick one to apply it; pick **Blank** for the classic empty skeleton.

- **No templates yet?** The picker is skipped and a **Blank** work order is created.
- **Press Esc / dismiss** the picker → nothing is created.

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
| **Create work order** | Opens the template picker, then creates (Blank if none/dismissed). |
| **Create work order from current note** | Picker, then creates with the active note linked as source. |
| **Create work order from selection** | Picker, then creates from the editor selection. |

---

## Typical flow

1. Run **Create work-order template** once and edit the example into, say, a `Bug fix` template — cheap model, `high` priority, a repro checklist.
2. Later, click **Add work order** on the board (or run a create command).
3. In the picker, choose **Bug fix** → the new work order opens prefilled with that body, provider, model, and priority.
4. Scope it, move it to **`ready`**, and run it like any other work order.
