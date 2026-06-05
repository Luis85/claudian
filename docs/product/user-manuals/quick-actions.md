---
parent: "[[Quick Actions]]"
---
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

Three ways — inline editor, capture from chat, or hand-authored.

### 1. Inline editor

Open the chat **Quick actions** button → click **Add action** in the footer. A modal opens with these fields:

- **Name** — required. Becomes both the YAML `name:` and the filename. Slugified to lowercase kebab-case for the filename (e.g. `Summarize selection` → `summarize-selection.md`). A name of all symbols falls back to `action.md`.
- **Description** — optional. Saved only when it differs from the name.
- **Icon** — optional Lucide picker.
- **Prompt** — required. Ten-row textarea; this becomes the note body and the message sent to chat.

Save → the note is written to your **Quick actions folder** and the picker refreshes so you can run it immediately. **Cancel** or dismiss to discard.

If **Name** or **Prompt** is empty on save, a notice tells you which one. Save failures also surface as a notice.

### 2. Capture from chat

Every sent **user message** in a chat exposes a **Capture as quick action** button (the `bookmark-plus` Lucide icon) in the per-message toolbar, next to the thumbs and work-order actions. Click it to open the inline editor pre-seeded with:

- **Name** — first non-empty line of the prompt, trimmed, truncated at 50 characters with an ellipsis.
- **Prompt** — the full message body.

The button is hidden for messages that cannot be safely captured:

- Assistant replies.
- Empty messages and image-only messages.
- Slash, dollar, hash, and bang command prefixes (`/compact`, `$skill`, `#instruction`, `!ls`) — these are runtime invocations, not prompt bodies.

On save the file is written under your **Quick actions folder**, a notice confirms the save, the picker refreshes so the new action is immediately available, and the saved note opens in a pane for further editing.

Two guard rails:

- **Folder missing** — if you cleared the **Quick actions folder** setting, clicking capture shows a notice and the editor does not open.
- **Name collision** — if a quick action with the same slugified name already exists, the save is blocked with a notice and the modal stays open so you can rename. Editing an existing action bypasses this check.

### 3. Hand-authored

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

---

## Skills tab

The picker opens with two tabs: **Quick actions** (covered above) and **Skills**. The Skills tab is a read-only listing of every provider-discovered skill in your vault, grouped by provider.

### Where skills come from

| Provider | Source folder | Trigger |
|----------|---------------|---------|
| Claude | `.claude/skills/<name>/SKILL.md` | `/<name>` |
| Codex | `.codex/skills/<name>/SKILL.md` (vault) plus `~/.codex/skills/...` (home) | `$<name>` |
| Opencode | Discovered from the Opencode runtime at session start | `/<name>` |
| Cursor | Not surfaced (Cursor does not expose skills today) | — |

Each skill row shows the skill name, its description, and a provider header (Claude, Codex, …) above its group. Rows are alphabetical inside a provider group; provider order matches the registration order.

### Running a skill

Click a row → the modal closes and the skill invocation (`/skill-name` for Claude/Opencode, `$skill-name` for Codex) is sent into the chat as your next message.

The runtime picks a chat tab for you:

- If your **currently active** tab is on the same provider as the skill **and** the tab is blank (no conversation yet), the active tab is reused.
- If the active tab is on the same provider but already has a conversation, a new tab is opened for the skill.
- If the active tab is on a different provider, the picker first looks for an **existing blank tab** on the skill's provider; if it finds one, that tab is reused. Otherwise a new tab is opened with the skill's provider pre-selected.

When you opened the picker by right-clicking a file or folder, the file/folder pill is attached to the target tab **after** the tab switch, so it survives the new-tab welcome reset.

### Right-click on a work-order card

The Agent Board also surfaces favorites and the picker via right-click on any work-order card. The favorites and the **Quick actions** entry appear below **Open note** and **Open conversation**, run against the work-order note as the target file, and are hidden while the work order is **running** or its note path no longer resolves. `needs_input` and `needs_approval` keep them. See [[agent-board#Right-click menu]] for the full menu layout.

### Disabled providers

A skill belonging to a provider you have disabled in settings is dimmed in the list and tagged with a small **disabled** badge. Clicking it shows a notice instead of sending — the provider must be enabled (Settings → Claudian → its tab) before the skill can run. The check happens at the moment you click, so toggling a provider while the picker is open is honored without reopening.

### Edit in settings

When the picker knows the skill is backed by an editable file on disk (vault `SKILL.md`, Codex home-folder `SKILL.md`, etc.), each row gets an **Edit in {provider} settings** button on the right. Today it closes the modal so you can finish navigating to the provider's settings; a future change will deep-link directly to the entry. For runtime-discovered skills (e.g. Opencode), the Edit button is hidden because the file path is unknown to Obsidian.

### Search

The Skills tab has its own search box, separate from Quick actions search. Substring matches against the skill name, description, and provider display name. Press **Enter** to run the first match. **Escape** clears the field. Switching tabs resets both searches to empty.
