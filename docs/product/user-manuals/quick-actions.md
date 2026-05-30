# Claudian — Quick actions

This manual covers **quick actions**: reusable one-tap prompts authored as vault notes and surfaced as a picker in the chat composer.

A **quick action** is a Markdown note that supplies a name, optional description and icon, and a **prompt body**. Picking it from the chat toolbar sends that body verbatim into the active chat as your next message — no edit step, no confirmation.

---

## Before you start

Set this once in **Settings → Claudian → Quick Actions**:

| Setting | What it does | Default |
|---------|--------------|---------|
| **Quick actions folder** | Vault folder scanned for quick-action notes. | `Quick Actions` |

The folder is created on demand the first time the picker opens or you save an action. Clearing the field falls back to `Quick Actions`.

There is no ribbon entry and no command-palette entry — quick actions are reached only from the chat composer's **Quick actions** button (the `zap` icon in the input toolbar).

---

## Anatomy of a quick action

A quick action is a Markdown note in your **Quick actions folder** with optional YAML frontmatter and a body. Both the inline editor and hand-authoring produce the same shape:

```markdown
---
type: quick-action
name: Summarize selection
description: Summarize the current editor selection.
icon: list
---
Summarize the following selection in three bullet points,
keeping any code identifiers verbatim.
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | Optional | When present, must be `quick-action` — any other value makes the parser skip the file. When absent, the file is still accepted. |
| `name` | Optional | Picker label and modal heading. Falls back to the filename (kebab-case `→` spaces, `.md` stripped). |
| `description` | Optional | Shown as the picker's detail line. Falls back to the name; if it equals the name, the picker hides the detail row. |
| `icon` | Optional | Lucide icon id rendered on the picker row. |
| Body | Required | Everything after the frontmatter. **This is the prompt sent to chat.** A file with an empty body is ignored. |

> Placeholders are **not** supported in the body. The prompt is sent exactly as written — no `{{title}}`, `{{date}}`, or `{{source}}` substitution, no selection injection. If you need dynamic context, write a prompt that asks the agent to use whatever is already attached (open file, mentions, etc.).

> Sub-folders inside the **Quick actions folder** are scanned recursively, so you can group actions by purpose if you want.

---

## Creating a quick action

Two ways — inline editor or hand-authored.

### 1. Inline editor

Open the chat **Quick actions** button → click **Add action** in the footer. A modal opens with these fields:

- **Name** — required. Becomes both the YAML `name:` and the filename. Slugified to lowercase kebab-case for the filename (e.g. `Summarize selection` → `summarize-selection.md`). A name of all symbols falls back to `action.md`.
- **Description** — optional. Saved only when it differs from the name.
- **Icon** — optional Lucide picker.
- **Prompt** — required. Ten-row textarea; this becomes the note body and the message sent to chat.

Save → the note is written to your **Quick actions folder** and the picker refreshes so you can run it immediately. **Cancel** or dismiss to discard.

If **Name** or **Prompt** is empty on save, a notice tells you which one. Save failures also surface as a notice.

### 2. Hand-authored

Create a Markdown note in the **Quick actions folder** with the [anatomy](#anatomy-of-a-quick-action) above. Both quoted YAML (`name: "Summarize selection"`) and unquoted scalars parse the same. The list refreshes the next time the picker opens.

---

## Editing or deleting

Open the **Quick actions** picker. Each row has **Edit** and **Delete** buttons on the right.

- **Edit** opens the same modal pre-filled. The **Name** field is **disabled** while editing — the filename is frozen. To rename a quick action, delete it and create a new one (or rename the note in the vault and update the `name:` frontmatter by hand).
- **Delete** removes the underlying note via the vault adapter. The picker list refreshes. On failure you get a notice: *"Failed to delete quick action"*.

Editing or deleting a quick action while the picker is open updates the list in place — no need to reopen it.

---

## Running a quick action from chat

Open a Claudian chat tab. The composer's input toolbar shows a **Quick actions** button (a `zap` Lucide icon, labelled *Quick actions*). Click it to open the picker.

The picker shows:

- An intro line: *"Click an action to send its prompt into the current chat. Use Edit or Delete on the right to manage vault files."*
- One row per quick action, alphabetical by **Name**, with the icon (if any) and description (when it differs from the name).
- An **Add action** button in the footer.

Click a row → the modal closes and the action's **prompt body** is sent into the **active** chat tab as your next message, exactly as if you'd typed and submitted it. The send goes through the same input controller as a normal turn, so the active conversation, provider, model, and any attached context apply.

> Picking an action does **not** populate the composer for editing — it sends. If you want to tweak the prompt first, edit the quick action's note or copy the body manually.

### Empty state

When the **Quick actions folder** is empty (or missing), the picker still opens. Instead of a row list it shows a short explanation and three hints:

- Each file uses frontmatter `type: quick-action`, plus `name`, optional `description` and `icon`; the note body is the message sent to chat.
- After you create actions, open this dialog from the toolbar and click a row to run one instantly.
- Use **Add action** below to create your first quick action, or set the vault folder under **Settings → Quick Actions**.

---

## Typical flow

1. Set **Settings → Claudian → Quick Actions → Quick actions folder** (or keep the default `Quick Actions`).
2. Open a chat tab, click the toolbar's **Quick actions** (`zap`) button, then **Add action**.
3. Fill in **Name**, an optional **Description** and **Icon**, and the **Prompt** body you want sent. Save.
4. Next time you want it, open the picker and click the row — the prompt fires straight into the active chat.
5. To reorganize, edit the underlying note (rename via the vault and adjust `name:` to rename; tweak the body anytime to change what gets sent).
