---
name: building-canvas
description: Builds or expands an Obsidian canvas by reading vault structure and
  placing linked notes as nodes. Use when the user asks to create a canvas,
  build a visual map, or visualize note connections as a diagram.
allowed-tools: mcp__specorator-obsidian-mcp__canvas_read,
  mcp__specorator-obsidian-mcp__canvas_list,
  mcp__specorator-obsidian-mcp__links_bfs,
  mcp__specorator-obsidian-mcp__metadata_frontmatter
---

# Building a Canvas

1. Read any existing canvas with `mcp__specorator-obsidian-mcp__canvas_list` then `mcp__specorator-obsidian-mcp__canvas_read`.
2. Walk the note graph from the chosen root with `mcp__specorator-obsidian-mcp__links_bfs` (depth 2, direction both).
3. For each discovered note, read frontmatter with `mcp__specorator-obsidian-mcp__metadata_frontmatter` to extract tags and headings for card labels.
4. Present a dry-run preview listing nodes to place and their positions; confirm before writing.
5. Read the canvas folder from `.specorator/catalog-config.md` (field `mocFolder`) if present; else default to vault root.
6. Fallback: if `canvas_read` is unavailable, describe the planned canvas structure as a markdown table for the user to create manually.
