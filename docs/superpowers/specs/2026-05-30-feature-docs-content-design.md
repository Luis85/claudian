---
status: shipped
parent: "[[Specorator - Product Vision]]"
superseded_for_scope: "Orchestrator feature removed 2026-06-06"
---
# Feature docs content design

Date: 2026-05-30 (revised 2026-06-07 to reflect Orchestrator removal + path move under `docs/product/features/`)

> **Scope correction (2026-06-07).** Original scope listed five feature docs under `docs/features/`, including `Orchestrator.md`. Actual landed location is `docs/product/features/`. The Orchestrator feature was **removed** 2026-06-06 (see [[Remove the Orchestrator feature]]) and `Orchestrator.md` was never created. Current feature-doc set: `Co-Worker - Chat.md`, `Multi Provider Support.md`, `Agent Kanban Board.md`, `Quick Actions.md`, plus the post-2026-05-30 additions `Workspace Isolation.md` and `RAG Layer - Ask your Vault.md`. The content-design principles in the rest of this spec stand; only the file list and the Orchestrator worked example below are stale.

## Scope

Design for the feature docs under `docs/product/features/`:

- `Co-Worker - Chat.md` (formerly `Chat.md` in the original draft)
- `Multi Provider Support.md`
- ~~`Orchestrator.md`~~ — removed 2026-06-06
- `Agent Kanban Board.md`
- `Quick Actions.md`

These docs are the single-source content for product landing pages. They are authored once in the vault and adapted per channel: product website, GitHub README, in-app onboarding, and so on.

---

## Content philosophy

Every feature page starts from one question: **"When in their day does a Specorator user reach for this?"** The answer becomes the tagline, the scenario, and the framing for every capability claim.

Pages never open with a feature name or a bullet list. They open with the reader in a situation they recognize. Only then does the page show how the feature changes the outcome.

The Obsidian guarantee (local files, plain Markdown, no lock-in) is the backdrop, not a claim that needs proving. Specorator adds AI on top of that guarantee, not instead of it.

Tone: trusted co-worker showing you something useful, not a salesperson. Claims are grounded in what the feature actually does. Scope limits are stated honestly. What a feature does not do is as valuable to the reader as what it does.

Product name throughout: **Specorator**.

---

## Target personas

Two primary personas, addressed with a unified voice. No explicit segmentation on the page.

| Persona | Description |
|---------|-------------|
| **Knowledge worker** | Heavy Obsidian user. Wants AI in their note workflow. Values portability, local-first, readable files. Not necessarily a developer. |
| **PM / coordinator** | Delegates work to AI agents. Cares about process, oversight, and visible control. Wants durability and reviewability, not magic. |

Both personas are reached by scenario-led copy that grounds features in workflow moments they recognize.

---

## Feature information architecture: hub and spoke

One overarching product page (not in scope for this spec) links out to feature pages. Feature pages cross-reference each other where relevant but do not enforce a reading order. Each page is self-contained.

---

## Three-layer structure

Every feature page carries three layers. Layer function is fixed; heading names adapt to the feature's story.

### Layer 1: 5-second hook

One sentence. The workflow moment plus what changes.

Rules:
- The feature name does not appear in the first sentence. The reader recognizes themselves before they know what to call it.
- Feature name appears as the first body `h1` (e.g. `# Quick Actions`), immediately before Layer 1 prose. The frontmatter `name` field is the machine-readable source of truth used by hub pages and queries.
- Hook lives in the frontmatter `tagline` field, single source of truth for channel adaptation.

Example:
> "Some prompts you write every single day. Quick Actions stores them as plain Markdown notes in your vault and surfaces them as a one-tap picker in every chat."

### Layer 2: 60-second overview

Two to four short paragraphs. One screenshot placeholder.

Rules:
- Prose only. No bullet lists in this layer.
- Pattern: situation, then friction, then how the feature removes the friction, then outcome.
- First paragraph puts the reader in a moment they recognize.
- One `<!-- screenshot: [description] -->` placed where a visual would be most persuasive.
- Warm and direct. No superlatives, no buzzwords.
- When a feature gets confused with an adjacent thing (Orchestrator vs. tab-switching, Multi Provider Support vs. a provider picker), add one short boundary sentence near the top of Layer 2 naming the confusable thing in plain language. Skip this on features readers already understand from the hook.

### Layer 3: Deep dive

Four sub-sections, always in this order:

1. **What it does**: scannable capability list. Present tense, action verbs. One concrete thing per bullet.
2. **Provider support**: small table showing per-provider availability. Only include on pages where the four providers don't behave the same. Skip when support is uniform.
3. **What it doesn't do**: honest scope limits. Short list. Prevents misaligned installs.
4. **Goes well with**: two to four wikilinks to related features, one-line context each.

Ends with the install CTA block.

---

## Frontmatter schema

```yaml
---
type: feature
name: "Feature Name"
tagline: "One-sentence hook. Workflow moment plus what changes."
status: draft
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Related Feature]]"
user_manual: "[[manual-slug]]"
support_claude: full
support_codex: full
support_opencode: partial
support_cursor: none
---
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | Yes | Always `feature`. |
| `name` | Yes | Canonical feature name used by hub page and cross-refs. |
| `tagline` | Yes | Layer 1 hook. Single source of truth for adaptation across channels. |
| `status` | Yes | `draft`, then `ready`, then `published`. |
| `personas` | Yes | Queryable. Values: `knowledge-worker`, `pm`. |
| `cta_url` | Yes | External URL. Plain string, not a wikilink. |
| `related` | Yes | Internal wikilinks only. |
| `user_manual` | Yes | Wikilink to existing detailed manual. |
| `support_claude` | Optional | One of `full`, `partial`, `none`. Omit when all four providers behave the same. |
| `support_codex` | Optional | Same values. Omit when uniform. |
| `support_opencode` | Optional | Same values. Omit when uniform. |
| `support_cursor` | Optional | Same values. Omit when uniform. |

All internal vault links are wikilinks. `cta_url` is the only plain URL field.

The `support_*` fields are flat strings rather than a nested object. Obsidian Properties renders flat string fields; nested objects stay invisible in the UI. Flat fields also keep Dataview queries readable: `WHERE support_cursor = "full"`.

---

## Proof element formats

### Screenshot placeholder

```markdown
<!-- screenshot: [describe exactly what the UI shows] -->
```

One per page. Placed inline in Layer 2 at the natural visual moment. Not a heading or a section, just an inline comment.

### Scenario (Layer 2)

Prose. Two to four short paragraphs. No headers. Pattern:

> *Situation paragraph.* The reader is in a specific moment, doing a specific thing.
>
> *Friction paragraph.* What they hit before the feature.
>
> *Feature paragraph.* What changes when they use it.
>
> *Outcome paragraph.* What they have at the end. Optional. Fold into the feature paragraph if it reads naturally.

### Capability list (Layer 3, "What it does")

```markdown
### What it does

- [Action verb] [concrete thing the user can do]
- [Action verb] [concrete thing the user can do]
```

Present tense. No sub-bullets. No vague claims ("powerful", "seamless", "intelligent").

### Provider support table (Layer 3)

```markdown
### Provider support

| Provider | This feature |
|----------|--------------|
| Claude | Full |
| Codex | Full |
| Opencode | Partial, no plan mode |
| Cursor | Not supported |
```

Plain words in the cells. `Full`, `Partial`, `Not supported`. When a cell is `Partial`, follow with a short reason after a comma. No checkmarks, no colour codes, no stars.

Skip the table entirely when all four providers support the feature the same way. A table of four identical rows is noise.

### Scope limits (Layer 3, "What it doesn't do")

```markdown
### What it doesn't do

- No [specific capability]. [One-line reason or alternative.]
- [Specific behaviour] is not supported. [One-line context.]
```

Honest, not apologetic. Reads as useful information, not a disclaimer.

For gaps that are by design or architectural, write them as finished decisions, not roadmap items. Say "X is not supported" rather than "does not currently support X". The first reads as a final state. The second reads as a promise to ship X later, which may not be the intent.

### Related features block

```markdown
### Goes well with

- [[Feature Name]]: one-line context for why
- [[Feature Name]]: one-line context for why
```

Two to four links max. Wikilinks only.

---

## Install CTA block

Consistent format at the bottom of every feature page. Wording is fixed. Only the settings path changes per feature.

```markdown
## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open this feature from **Settings → Specorator → [Feature Name]**.
```

---

## Feature moment mapping

The workflow moment that anchors each feature page.

| Feature | Workflow moment |
|---------|----------------|
| **Chat** | You're in Obsidian with a note open, an idea forming, or a selection highlighted, and you want an AI that already knows where you are and what you're looking at. |
| **Multi Provider Support** | You rely on Claude for writing, Codex for code. You don't want to pick one and give up the rest. Each engine stays in its lane, same workflow. |
| **Orchestrator** | Your goal splits into parallel tracks with no dependencies between them. One chat tab is the wrong tool. Orchestrator breaks it up, runs workers in parallel, synthesizes when all are done. |
| **Agent Kanban Board** | You have more work than one chat can hold. Ideas, specs, and delegated tasks need a lifecycle (inbox, running, reviewed) without disappearing into chat history. |
| **Quick Actions** | You type the same prompt repeatedly. Explain this selection. Summarize this note. Check this diff. Quick Actions turns any prompt into a one-tap toolbar button, stored as a vault note. |

---

## Worked example

Full content for `docs/features/Quick Actions.md`, demonstrating all design decisions:

~~~markdown
---
type: feature
name: "Quick Actions"
tagline: "Your most-used prompts, one tap away. Stored as vault notes you own."
status: draft
personas:
  - knowledge-worker
  - pm
cta_url: https://github.com/Luis85/specorator
related:
  - "[[Chat]]"
user_manual: "[[quick-actions]]"
---

# Quick Actions

Some prompts you write every single day. *Summarize this note in three bullets. Explain this selection. Write a commit message for this diff.* Typing them out each time is friction that adds up.

**Quick Actions** stores any prompt as a plain Markdown note in your vault and surfaces it as a one-tap picker in every chat.

---

You keep a folder of quick-action notes, each one a name, an optional description, and a prompt body. Open the chat toolbar's lightning-bolt picker, click a row, and the stored prompt fires into the active chat exactly as if you'd typed and submitted it. No clipboard, no edit step, no confirmation.

The actions live in your vault as ordinary files. You can edit them in any text editor, sync them with your vault, back them up, and share them. Specorator doesn't own them.

<!-- screenshot: quick actions picker open in chat toolbar, showing 4-5 action rows with icons -->

---

### What it does

- Store any prompt as a Markdown note in a vault folder you choose
- Surface all actions alphabetically in the chat composer's lightning-bolt picker
- Fire the stored prompt verbatim into the active chat with one click. No edit step.
- Create and edit actions from an inline modal without leaving chat
- Inherit whatever context is already active in the chat: open note, mentions, attached files
- Organise actions in subfolders inside the quick actions folder

### What it doesn't do

- No placeholder substitution. `{{title}}`, `{{selection}}`, `{{date}}` are not supported. Prompts send exactly as written.
- The current selection is not injected automatically. Write prompts that ask the agent to use what's already attached.
- Quick actions are not slash commands or plugin commands. They are stored prompts, fired verbatim.

### Goes well with

- [[Chat]]: quick actions fire into any active chat; context, provider, and model come from the chat tab

---

## Get Specorator

Install via BRAT or the Obsidian community plugins directory.

**→ [GitHub — Luis85/specorator](https://github.com/Luis85/specorator)**

Already installed? Open this feature from **Settings → Specorator → Quick Actions**.
~~~

---

## Out of scope

- Hub / product overview page content (separate design exercise)
- Channel-specific adaptations (GitHub README formatting, website CMS structure)
- Screenshot production (placeholders only for now)
- Placeholder substitution or dynamic content in quick action prompts
- Locale / i18n variants
