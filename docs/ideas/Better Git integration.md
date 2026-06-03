---
priority: 2 - normal
relations:
  - Product
status: open
tracked-by: "[[docs/issues/better-git-changed-files-view.md]]"
tags:
  - qol
---
The current git integration is lacking a dedicated view to inspect or list the changed files. Although it's possible to just ask the agent to give an Overview, this is not token friendly and can be accomplished programmatically. 

The idea is to have a dedicated, simple, lightweight git integration to give the user the basics of version control, all interactions with the repo can be done via agent but it should also be possible to see what has changed without prompting the agent. 
