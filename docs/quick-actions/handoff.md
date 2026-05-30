---
type: quick-action
name: Handoff
description: Compact the current conversation into a handoff document for the next session.
icon: hand
tags:
  - workflow
  - session
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save it to `docs/handoffs/` inside this vault, using a filename of the format `YYYY-MM-DD-<slug>.md` where the slug is a short kebab-case description of the session's focus.

Include these sections:

1. **Context** — what was worked on, why, and what decisions were made.
2. **Current state** — what is done, what is in-progress, what is blocked.
3. **Next steps** — ordered list of concrete actions the next agent should take.
4. **Suggested skills** — which skills the next agent should invoke (e.g. `superpowers:writing-plans`, `tdd`, `code-review`).

Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits). Reference them by vault path or wikilink instead.

Redact any sensitive information (API keys, passwords, personal data).

If the user passed a description of what the next session will focus on, tailor the handoff to that goal. Otherwise write a general handoff covering the full session.

After saving, report the vault path of the created file.
