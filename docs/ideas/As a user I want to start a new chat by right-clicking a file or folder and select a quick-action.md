---
status: shipped
priority: 2 - normal
relations:
  - "[[Chat]]"
  - "[[Quick Actions]]"
  - "[[2026-06-04-context-menu-quick-actions-design]]"
tags:
  - qol
---
I want to right-click a file or folder and have a "Quick-Actions" option, the selected file or folder gets added to the chats context and starts a new chat if one is available, if no new tab is available due to tab limit, the user gets presented an error message to inform him.

## Shipped 2026-06-04

Implemented via spec [[2026-06-04-context-menu-quick-actions-design]]. Blank-active tab is reused when present (no needless tab spawn); otherwise a new tab is created and the pill is attached after `switchToTab` so the welcome reset does not wipe it.
