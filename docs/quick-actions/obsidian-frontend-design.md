---
type: quick-action
name: Obsidian Frontend Design
description: Design or implement Specorator UI changes with Obsidian-native styling, strong visual direction, and no generic web-app assumptions.
icon: palette
tags:
  - frontend
  - design
  - obsidian
  - ui
---

Use this action for Specorator frontend or web-design work: chat UI, input/composer surfaces, tool-call displays, settings screens, modals, tabs, Agent Board, or other Obsidian plugin UI.

## 1. Ground in project context

Before proposing or changing UI, read:

- `CLAUDE.md` for architecture and development rules.
- `src/style/CLAUDE.md` for CSS structure and conventions.
- Relevant existing CSS modules under `src/style/`.
- Relevant UI/rendering TypeScript under `src/features/` or `src/shared/`.

If the target surface is unclear, ask one concise question for the surface and desired outcome.

## 2. Establish design intent

State the intended direction in 3-6 bullets before editing:

- **Purpose**: what user problem this UI solves.
- **Context**: where it appears in Obsidian and at what pane sizes.
- **States**: empty, loading/streaming, success, warning/error, disabled, hover, focus.
- **Tone**: native Obsidian, calm developer tool, clear agent status, restrained but memorable.
- **Differentiation**: the one detail that makes the surface easier to understand or more pleasant.

Avoid generic AI-generated web aesthetics: marketing-page gradients, Tailwind/shadcn assumptions, oversized hero layouts, decorative effects that do not serve the plugin workflow, and CDN fonts.

## 3. Design with Specorator constraints

Follow these rules:

- Use `.specorator-` prefixed classes for Specorator-owned selectors.
- Use Obsidian CSS variables first: `--background-*`, `--text-*`, `--interactive-*`, `--font-*`, `--radius-*`.
- Use existing Specorator tokens from `src/style/base/variables.css` before adding new ones.
- Keep CSS modular and register new modules in `src/style/index.css`.
- Prefer logical properties (`inline`, `block`, `inset-inline-*`) where directionality matters.
- Design for both `body.theme-dark` and `body.theme-light`.
- Make compact sidebar layouts first-class, not an afterthought.

## 4. Implement only if requested

If the user asked for implementation, follow `AGENTS.md` project workflow. Keep changes focused on one UI concern. Do not rewrite large files or unrelated styles.

If the user only asked for design direction, return a concise design proposal with affected files and verification steps, then stop.

## 5. Verify

For implemented changes, run the narrowest relevant checks and report exactly what passed. Prefer:

```bash
npm run build:css
npm run typecheck
npm run lint
```

If TypeScript was not touched, `npm run build:css` plus a quick grep/status review may be sufficient; state why broader checks were skipped.
