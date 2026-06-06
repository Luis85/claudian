---
date: 2026-06-04
status: shipped
scope: user-manual
parent: "[[Agent Kanban Board]]"
---
# Claudian — Agent Board collapsible lanes

This manual covers how to **collapse** and **expand** individual Agent Board lanes to reduce clutter. Collapsible lanes shrink to a narrow vertical strip showing the lane title (rotated) and a count badge of cards in that lane, then expand again with a single click.

When you collapse a lane, it stays collapsed across Obsidian sessions — your layout persists.

---

## Before you start

To use collapsible lanes, you first mark a lane as "collapsible" in the lane editor, then collapse and expand it from the board.

- **Mark a lane collapsible**: **Settings → Claudian → Agent Board → Board lanes** → toggle **Collapsible** on the lane block
- **Collapse/expand a lane**: on the board, click the chevron (`›`) in the lane header (if collapsible) to collapse, or click the collapsed strip to expand

---

## Why collapse lanes?

The Agent Board shows up to ten lanes by default: Inbox, Ready, Running, Needs input, Needs approval, Review, Needs fix, Done, Failed, and Canceled. Not all lanes deserve equal screen space while you work.

**Terminal lanes** (Done, Failed, Canceled) and **support lanes** (Inbox intake, Review waiting) accumulate cards but rarely need active attention while you are running work. They can consume horizontal space and visual weight that belongs to your active workflow (Running, Needs input, Needs approval, Review).

Collapsible lanes let you shrink low-attention lanes to a narrow strip, recovering space and focus without losing the count signal. Cards still route into collapsed lanes, and their count updates silently — no auto-expand, no noise.

---

## Lane anatomy

A **collapsible** lane has two runtime states:

| State | What you see | Click to |
|-------|--------------|----------|
| **Expanded** (default) | Normal lane column with all cards visible, title, count, and a chevron (`›`) button in the header | Click chevron to collapse |
| **Collapsed** | Narrow vertical strip with rotated title, count badge, nothing else | Click anywhere on the strip to expand |

Not all lanes need to be collapsible. You can have a mix: some lanes stay expanded full-time, others collapse to strips.

---

## Marking a lane as collapsible

1. Open **Settings → Claudian → Agent Board → Board lanes**.
2. Find the lane you want to make collapsible (e.g., Done, Failed, Canceled, or Inbox).
3. In the lane block, toggle **Collapsible** on.
4. The board refreshes immediately; the lane now shows a chevron (`›`) in its header.

To un-mark a lane as collapsible:
1. Toggle **Collapsible** off.
2. If the lane was currently collapsed, it automatically expands and **Collapsed** is cleared from storage. This prevents orphan collapsed state on a non-collapsible lane.

---

## Collapsing and expanding

Once you mark a lane as collapsible, you can toggle its state from the board:

### Collapse a lane
- Click the chevron (`›`) in the lane header (next to the title and count).
- The lane shrinks to a narrow vertical strip.
- The strip shows:
  - The lane title rotated vertically (upside-down, reading from bottom-to-top)
  - A count badge below the title showing how many cards are in the lane

### Expand a lane
- Click anywhere on the collapsed strip.
- The lane expands back to normal width and shows all cards.

**Tip:** You can collapse multiple lanes at once, giving you a board of just the active work plus a row of collapsed strips for context.

---

## Behavior

### Collapsed lanes persist across sessions
Your collapse/expand choices are saved automatically. Close Obsidian and come back tomorrow — any lane you collapsed stays collapsed.

### Cards move silently into collapsed lanes
If a card's status changes while a lane is collapsed (e.g., a task moves to **Done** while the Done lane is collapsed), the card routes into the lane and the count badge increments silently. The lane does **not** auto-expand, no animation plays, no notification appears — just the count changes.

This is intentional: you can let background work accumulate in collapsed lanes without interrupting your focus.

### Collapsed state is stored per lane
Each lane remembers its own collapse state independently. You can have Done collapsed and Review expanded at the same time.

---

## Typical flow

**Example 1: Focus on active work**
1. Open **Settings → Claudian → Agent Board → Board lanes**.
2. Toggle **Collapsible** on for **Done**, **Failed**, and **Canceled**.
3. Go back to the board.
4. Click the chevron on the **Done** lane to collapse it.
5. Click the chevron on **Failed** and **Canceled** to collapse those too.
6. Now your board shows just **Inbox → Ready → Running → Needs input → Needs approval → Review** plus three narrow strips at the end (Done, Failed, Canceled).
7. As you work, cards move into those collapsed lanes silently. When you finish your run, expand **Review** to read the result, then move cards to **Done**.

**Example 2: Keep Inbox intake out of the way**
1. Mark **Inbox** as collapsible.
2. Collapse it when you are ready to focus — new ideas still land there but do not crowd your active lanes.
3. When you want to triage, expand **Inbox**, review the backlog, and move items to **Ready**.

**Example 3: Mixed layout**
You don't have to collapse every lane. Keep **Running** and **Review** expanded (always in view), collapse **Done** and **Failed** (historical context), leave **Inbox** and **Ready** expanded (where you groom work).

---

## Reset collapse state

There is no global "expand all" button. If your layout becomes confusing:

1. Click the chevron on each collapsed lane to expand it manually, or
2. Reset the board to defaults: **Settings → Claudian → Agent Board → Board lanes → Reset to default** (this also un-marks all lanes as collapsible).

Resetting the lane configuration is permanent — back up your custom layout if you might want it later.

---

## Accessibility

- **Chevron button**: Labelled "Collapse lane" when focused.
- **Collapsed strip**: Marked as a `button` role with `aria-expanded="false"` and aria-label "Expand lane [title]", so screen readers announce it as a clickable element.

---

## Troubleshooting

**Q: I collapsed a lane and now I can't find my card.**
- Cards in collapsed lanes are still there — the count badge shows how many. Click the strip to expand and see them.

**Q: The collapsed strip looks strange / title is hard to read.**
- The strip uses your Obsidian theme's text colors and fonts. If it's hard to read, expand the lane or check your theme's contrast settings.

**Q: I toggled Collapsible off but the lane is still collapsed.**
- Toggling **Collapsible** off automatically expands the lane and clears the collapsed state. If it does not expand immediately, refresh the board by clicking another setting or closing and re-opening the board view.

**Q: Can I rename a collapsed lane?**
- Yes. Edit the title in **Settings → Claudian → Agent Board → Board lanes**. The renamed title appears on the collapsed strip next time you collapse it.
