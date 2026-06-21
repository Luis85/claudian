---
name: story-mapping-the-solution
description: Use when building a user story map, planning releases, finding a minimal viable release or walking skeleton, or turning a backlog into a visual end-to-end narrative. For the product trio shaping a solution into shippable slices after the problem is understood.
---

# Story Mapping the Solution

## Overview

A user story map (Jeff Patton) replaces a flat, context-free backlog with a **two-dimensional narrative**: what the user does, end to end, sliced into releases that each deliver a complete journey. Use it after discovery has established *what's worth building*, to shape *how it ships*.

## Structure

- **Backbone (top):** large **user activities** — the essential things people do — arranged **left-to-right in narrative/time order** (the order you'd explain the system in).
- **Body (below each activity):** smaller tasks/stories hanging down, ordered **vertically by necessity** (most necessary at top).
- **Walking skeleton (top slice):** the highest stories across the whole backbone form the **smallest possible end-to-end system** (Cockburn: "a tiny implementation that performs a small end-to-end function… links together the main architectural components"). 
- **Release slices (horizontal):** each release spans the **whole backbone** so every release is a complete, usable journey — you slice *across* the narrative, never building one activity to completion while others are empty.

## Workflow

1. Build the backbone: list user activities, order them left-to-right by narrative flow.
2. Hang the detail: place tasks/stories under each activity, highest = most necessary.
3. Cut the walking skeleton: the top row that gives end-to-end functionality across every activity.
4. Slice releases horizontally; each slice must span the full backbone.
5. Do it collaboratively (PM + design + engineering) — the conversation produces the shared understanding, not just the artifact.
6. Hand off slices to `writing-requirements` and `prioritizing-with-evidence`.

## Quality bar

- [ ] Backbone reads as a coherent left-to-right narrative.
- [ ] Backbone has **≥3 distinct activities** in time order — one column means you've listed tasks, not activities; decompose the end-to-end flow first.
- [ ] Top slice is a true walking skeleton: end-to-end and minimal, spanning every activity.
- [ ] Every release slice spans the full backbone (a complete journey, not one deep feature).
- [ ] Vertical position consistently encodes necessity.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Map is a re-sorted flat backlog | Add the narrative backbone across the top |
| First release builds one activity fully | Slice across all activities (walking skeleton) |
| Built solo as a deliverable | Build it with the trio; the conversation is the point |

## Reference

`docs/research/2026-06-21-agent-skills-for-product-discovery.md` §5.8. Sources: Jeff Patton (*User Story Mapping*, "The New Backlog is a Map"); Alistair Cockburn (walking skeleton); Martin Fowler.
