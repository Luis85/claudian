---
type: feature
name: Quick Actions
tagline: Your most-used prompts, one tap away. Stored as vault notes you own.
status: draft
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Chat]]"
user_manual: "[[quick-actions]]"
parent: "[[Chat]]"
---

# Quick Actions

Some prompts you type every single day. *Draft a thank-you email for me. Summarize this note in three bullets. Compare these two options side by side.* Retyping them gets old fast.

**Quick Actions** stores any prompt as a plain Markdown note in your vault and surfaces it as a one-tap picker in every chat.

---

You keep a folder of quick-action notes. Each one has a name, an optional description, and a prompt body. Open the chat toolbar's lightning-bolt picker, click a row, and the stored prompt fires into the active chat as if you had typed and sent it.

The actions live in your vault as ordinary files. You can edit them in any text editor, sync them with the rest of your notes, back them up, and share them with someone else. Specorator does not own them.

<!-- screenshot: quick actions picker open in chat toolbar, showing 4-5 action rows with icons -->

---

### What it does

- Store any prompt as a Markdown note in a vault folder you choose
- Surface all actions alphabetically in the chat composer's lightning-bolt picker
- Fire the stored prompt verbatim into the active chat with one click, no edit step
- Create and edit actions from an inline modal without leaving the chat
- Inherit whatever context is already active in the chat: open note, mentions, attached files
- Organize actions in subfolders inside the quick actions folder

### What it doesn't do

- Placeholder substitution is not supported. Tokens like `{{title}}`, `{{selection}}`, or `{{date}}` will not be filled in. Prompts send word for word.
- The current selection is not injected automatically. Write prompts that ask the helper to use what is already attached.
- Quick actions are not slash commands or plugin commands. They are stored prompts, sent as written.

### Goes well with

- [[Chat]]: quick actions fire into the active chat tab, which decides the provider and the context

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open this feature from **Settings → Specorator → Quick Actions**.
