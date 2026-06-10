---
title: Obsidian plugin design guidelines for design agents
date: 2026-06-10
status: active
scope: Instruction set for design agents (e.g. Claude Design) producing UI designs and handoff packages for Obsidian plugins. Sections 1–9 are project-agnostic and portable to any Obsidian plugin; the appendix is the only project-specific part.
---

# Designing UI for Obsidian plugins — instructions for design agents

You are designing UI that will be implemented inside an **Obsidian plugin**. Obsidian
is not a normal web app: the runtime, styling system, review guidelines, and host
conventions constrain what a design may assume. Designs that ignore these constraints
are expensive to implement; designs that embrace them translate almost mechanically
into shipping code.

Read this document before producing any mockup, prototype, or handoff. Treat every
**MUST / MUST NOT** as a hard constraint, not a preference — most of them are enforced
downstream by lint rules, plugin-review guidelines, or the Obsidian API itself.

---

## 1. The runtime you are designing for

Obsidian plugins are **TypeScript that builds DOM imperatively** through Obsidian's
API. There is no React, Vue, or Svelte in production, no JSX, no virtual DOM, no
portals API, no component-state library, and no CSS-in-JS.

What the implementation actually has to work with:

- **DOM construction:** `createEl()`, `createDiv()`, `createSpan()`, `setText()`,
  `.empty()` on Obsidian's extended `HTMLElement`. Raw HTML injection
  (`innerHTML` / `outerHTML` / `insertAdjacentHTML`) is **banned** — by Obsidian's
  plugin guidelines (XSS) and typically by project lint rules. Never deliver a design
  whose only practical implementation is an HTML string.
- **Markdown content** (user notes, agent output, descriptions) renders through
  `MarkdownRenderer.render(...)`. You do not control its inner markup — style it from
  the outside via a wrapping class, and don't design pixel-exact internals for it.
- **Icons:** Obsidian bundles **Lucide** (`setIcon(el, 'icon-name')`). Design with
  Lucide icon names only — browse [lucide.dev](https://lucide.dev/) and note that
  Obsidian supports Lucide only up to a pinned version (v0.446.0 at time of writing),
  so verify the icon exists before specifying it. Custom icons are possible via
  `addIcon()` but must follow Lucide's geometry (24×24 grid, 2px centered stroke,
  rounded joins/caps) — propose them only when no Lucide icon fits.
- **No inline styles in production.** Obsidian's guidelines require styling via CSS
  classes so themes and snippets can restyle the plugin. The one sanctioned escape
  hatch is setting a **CSS custom property** on an element for truly dynamic values
  (e.g. a per-status accent: `el.style.setProperty('--wo-status-color', ...)` consumed
  by a stylesheet rule). If a design needs per-element dynamic styling, express it as
  a custom property + class, never as literal inline style values.
- **Native primitives exist — design around them, not against them:**
  - `Modal` — backdrop, close button, Esc handling, focus trap come for free.
  - `Setting` — the standard row (name + description left, control right) used in
    settings tabs and forms; `setHeading()` for section headers.
  - `Menu` — native context/dropdown menu with icons and sections.
  - `Notice` — toast notifications. Don't design a custom toast system.
  - `SuggestModal` / `FuzzySuggestModal` — searchable pickers.
  - `setTooltip` / `title` — native tooltips; don't design custom tooltip bubbles.
- **All user-visible strings are localized** through a string table. Write copy as
  complete, self-contained strings. Avoid designs that require concatenating sentence
  fragments around values, mid-sentence styled spans, or text baked into images —
  none of these survive translation. Assume translated strings can be **~30% longer**
  than English and design labels/buttons to tolerate that.

**Prototypes:** building a runnable HTML/React prototype as a *visual reference* is
fine and often helpful — but it is a reference, never code to port. Every pattern in
it must be expressible as imperative DOM + CSS classes. See §7 for how to package it.

---

## 2. Design in Obsidian's token system — never in raw values

Obsidian exposes a full CSS variable system, and **themes (plus the user's accent
color) override it at will**. A design specified in raw hex/px values has to be
reverse-translated by the implementer and will break under community themes. So:

> **Every visual value in your spec MUST be named as an Obsidian CSS variable.**
> Raw values may appear only as parenthetical "renders as" annotations.

### Surfaces and lines

| Use | Variable |
|---|---|
| Main surface | `--background-primary` (`-alt` for nested) |
| Secondary surface (sidebars, footers, cards) | `--background-secondary` (`-alt`) |
| Raised elements / cards | `--background-tertiary` (where themes define it) or `--background-primary-alt` |
| Hover wash | `--background-modifier-hover` |
| Active/pressed wash | `--background-modifier-active` |
| Borders / dividers | `--background-modifier-border` (hover: `-border-hover`, focus: `-border-focus`) |
| Error surface | `--background-modifier-error` |

### Text

| Use | Variable |
|---|---|
| Primary text | `--text-normal` |
| Secondary / captions | `--text-muted` |
| Tertiary / hints / disabled-ish | `--text-faint` |
| Links, highlighted interactive text | `--text-accent` |
| Text on accent-colored fills | `--text-on-accent` |
| Status text | `--text-error`, `--text-warning`, `--text-success` |

### Interaction and status color

- Primary actions / selected states: `--interactive-accent` (hover:
  `--interactive-accent-hover`); standard controls `--interactive-normal` / `-hover`.
- The accent is **user-configurable** — it can be any hue. Never design something
  that only works when the accent is, say, purple, and never pair the accent with a
  hardcoded color that could clash with it.
- Status/semantic hues: the extended palette `--color-red`, `--color-orange`,
  `--color-yellow`, `--color-green`, `--color-cyan`, `--color-blue`,
  `--color-purple`, `--color-pink`, plus neutral steps `--color-base-00` …
  `--color-base-100`. Each extended color has an `--color-*-rgb` twin for
  alpha washes: `rgba(var(--color-red-rgb), 0.15)`. Use these for soft badge/avatar
  backgrounds instead of inventing tints.

### Spacing, radius, shadows, layers

- Obsidian uses a **4px grid**: `--size-4-1` (4px) through `--size-4-18` (72px), with
  `--size-2-*` (2/4/6px) for fine adjustments. Specify padding/margins/gaps in
  multiples of 4; oddball values (9px, 13px, 26px) are acceptable only as deliberate,
  annotated exceptions.
- Radii: `--radius-s` (2), `--radius-m` (4), `--radius-l` (8), `--radius-xl`,
  and full-round pills via `--radius-full` / `border-radius: 50%` for avatars.
- Shadows: `--shadow-s` / `--shadow-l`; modals use the theme's modal shadow.
- Stacking: Obsidian defines `--layer-*` z-index variables (cover, sidedock,
  status-bar, popover, slides, modal, notice, menu, tooltip). Specify stacking in
  terms of these layers — never invent `z-index: 9999`.

### Typography

- Interface text uses the interface font and the **fixed UI sizes**:
  `--font-ui-smaller` (12px), `--font-ui-small` (13px), `--font-ui-medium` (15px),
  `--font-ui-large` (20px). Note-content surfaces use the relative `--font-*` editor
  scale instead — don't mix the two.
- Families: `--font-interface` (UI), `--font-text` (notes), `--font-monospace`
  (code, IDs, paths). **Never specify a web font or any font download** — fonts are
  the user's/theme's choice.
- Weights `--font-thin`…`--font-black` (use `--font-normal/-medium/-semibold/-bold`);
  line heights `--line-height-tight` (1.3) / `--line-height-normal` (1.5).
- Live-updating numbers (timers, counters) must specify
  `font-variant-numeric: tabular-nums` so digits don't reflow.

### Icon sizing

Size icons via `--icon-size` / the presets (`--icon-xs/s/m/l` ≈ 14/16/18/20px) on the
container, not by hand-tuning SVG dimensions.

### Theming reality check

Every design must hold up in **both light and dark base themes**, under an arbitrary
user accent color, and under popular community themes (Minimal, AnuPpuccin, Things…)
that re-map all of the variables above. Practical consequences:

- Don't rely on a specific contrast relationship between two raw colors — rely on the
  semantic roles (`--text-muted` on `--background-primary` is always legible because
  the theme guarantees it).
- If a fixed brand color is unavoidable (e.g. a provider logo color), define it as a
  plugin-namespaced variable with explicit light/dark values keyed off
  `body.theme-dark` / `body.theme-light`, and annotate both values in the spec.
- Provide your mock in **dark and light** variants, or at minimum state explicitly
  that all values are theme variables so the light rendering follows automatically.

---

## 3. The surfaces you can design, and their constraints

### Sidebar / pane views (`ItemView`)

Plugin views live in workspace panes the **user resizes freely**. A right-sidebar
pane is commonly **250–450px wide**; the same view can also be dropped into the main
area at 1000px+. Constraints:

- Design **narrow-first**. Single-column layouts, wrapping toolbars, ellipsized text
  with `title` tooltips. Anything requiring >~280px fixed width needs an explicit
  overflow story (horizontal scroll, collapse, wrap).
- **`@media` queries respond to the window, not the pane.** A pane can be 300px wide
  in a maximized window. Pane-level responsiveness must come from intrinsic layout
  (flex/grid `auto-fit`, wrapping, `min()` widths) or from container queries /
  width-observing classes — say which you intend. Media queries are only valid for
  window-scoped surfaces like modals.
- The view owns its scroll. Specify exactly **which element scrolls** and which parts
  pin (header, composer, toolbar). The implementation pattern is a flex column where
  every intermediate level needs `min-height: 0` — a design with ambiguous scroll
  regions is the single most common source of implementation churn.
- **Long lists are windowed.** Chat histories, boards, and other unbounded lists
  render only a window of items for performance. Don't design features that require
  all items to be mounted at once (e.g. "scrollbar minimap of every message",
  full-list measure-and-align). Per-item cost must be constant.

### Modals

- Built on Obsidian's `Modal`: backdrop, Esc-to-close, close button, and focus
  handling are native. Don't redesign those affordances; do specify what Esc/close
  should do with unsaved state.
- Sizing convention: a width clamp such as `min(600px, 90vw)` for simple dialogs and
  up to `min(960px, 92vw)` for work-item style modals; height capped around
  `min(86vh, 760px)`. The modal is a flex column: **fixed header / scrolling body /
  fixed footer** — primary actions must never be inside the scroll region (this was
  the original sin the work-order modal redesign fixed).
- Multi-column modal bodies must define their collapse: e.g. two-pane
  (main + properties sidebar) collapsing to one column below `720px` window width
  (media query is fine here — modals are window-scoped).

### Settings tabs

- Compose from **`Setting` rows** (name + optional description left, control right)
  and `setHeading()` section headers. Don't design bespoke settings layouts unless a
  list-editor genuinely needs one.
- Per Obsidian review guidelines: **no top-level "General" heading**, avoid the word
  "settings" in headings ("Advanced", not "Advanced settings"), sentence case
  throughout.

### Menus and custom popovers

- Prefer the native `Menu` for context/overflow menus; specify items as
  icon + label (+ destructive styling where relevant).
- If a custom popover is required, the spec MUST state: rendered detached from the
  trigger's scroll container (body-level portal or `position: fixed` computed from
  `getBoundingClientRect()`), flips when near the viewport edge, and closes on
  outside-click, Esc, scroll, and resize. *An absolutely-positioned popover inside an
  `overflow: auto` container stretches the container and adds phantom scrollbars —
  this was a real shipped bug.*

### Other host surfaces

Status-bar items (desktop only, text + icon scale), ribbon icons, editor-embedded
UI, and `Notice` toasts. These have tight host conventions; specify content, not
custom chrome.

### Mobile

Check the plugin's `manifest.json`: if `isDesktopOnly: true`, mobile can be ignored.
Otherwise: touch targets ≥ ~44px, no hover-only affordances (every hover-revealed
action needs a visible/tap path), and assume the pane is full-screen width on phones.

---

## 4. Interaction, motion, and state rules

- **Buttons are native `<button>` elements.** Obsidian and themes impose default
  button styling (background, shadow, padding); custom-styled buttons need explicit
  resets, which the implementer handles — but your spec should use a small **variant
  vocabulary** instead of one-off buttons: **CTA** (accent bg, `--text-on-accent` —
  Obsidian's `mod-cta`), **ghost** (transparent, hover wash), **danger/warning**
  (`mod-destructive`/`mod-warning` or error tokens). One CTA per surface.
- **Hover-revealed controls** must specify their keyboard/focus equivalent
  (`:focus-within` reveals the same cluster) and their persistent-visibility cases
  (e.g. live/attention states keep actions visible, with reserved padding so they
  don't overlap content).
- **Motion:** every animation/transition is implemented inside
  `@media (prefers-reduced-motion: no-preference)`. Therefore every motion cue in
  your design MUST have a non-motion fallback that conveys the same state (a pulsing
  "live" dot must still read as live when static — color + glyph + label). Keep
  motion functional and short; no decorative ambient animation.
- **State completeness:** for each component, specify every state it can be in —
  default, hover, focus-visible, active, disabled, loading/streaming, empty, error,
  overflow/truncation — and for data-driven surfaces, a **per-status matrix** (which
  actions/labels/colors appear in which status). Implementation stalls happen almost
  exclusively in the states the mock didn't show.
- **Empty and extreme content:** show the empty state, the one-item state, and the
  absurdly-long-string state (titles, paths, model names). Specify truncation
  (`ellipsis` + `title` tooltip) wherever text can outgrow its box.
- **Focus management:** opening a menu/modal moves focus in; closing returns focus to
  the trigger on *all* close paths. Tab order must follow visual order. State this in
  the spec rather than leaving it implied.

---

## 5. Accessibility requirements (non-negotiable)

These mirror what the host app does and what reviews enforce:

1. Every interactive element has an **accessible name** (`aria-label`, `title`, or
   visible text). Icon-only buttons always get both `aria-label` and a tooltip.
2. Toggles are `role="switch"` + `aria-checked`; expanders use `aria-expanded`;
   menus use `aria-haspopup="menu"` on the trigger and `role="menu"`/`menuitem` on
   the popover; custom checkboxes use `role="checkbox"` + `aria-checked`.
3. Everything operable by mouse is operable by keyboard: native elements preferred;
   any non-native interactive element needs `tabindex="0"` + Enter/Space handling.
4. Focus is visible: `:focus-visible` outline using `--interactive-accent` (2px,
   offset 2px) — never `outline: none` without a replacement.
5. **Color is never the only signal.** Pair status colors with a glyph, label, or
   shape (e.g. freshness tiers ●/◐/◯ with per-tier `aria-label`s).
6. Inline editing (click-to-edit titles, etc.): keyboard-focusable, Enter commits,
   Esc reverts, and IME composition must not commit early — specify all three.
7. Respect `prefers-reduced-motion` (see §4).

---

## 6. UI copy rules

Per Obsidian's style guide and plugin-review guidelines:

- **Sentence case everywhere** — headings, buttons, labels, menu items.
  "Mark ready", not "Mark Ready". Proper nouns keep their capitalization
  ("Obsidian", "Markdown", "PDF").
- Imperative voice for actions ("Open note", "Set up sync"), plain common words,
  no idioms (global audience), no emoji in UI text or plugin descriptions.
- Settings: no "General" section, no "…settings" suffix in headings.
- Prefer Obsidian's terminology: "sidebar", "note", "vault", "keyboard shortcut"
  (not "hotkey"), "select" (not "click/tap") in user-facing help text.
- Remember every string is translated: keep labels short, self-contained, and free
  of baked-in values that would need mid-string substitution gymnastics.

---

## 7. What a complete design handoff contains

The agent-board/work-order redesign taught us what makes a handoff implementable.
Deliver a single handoff README plus optional reference prototypes, containing:

1. **Overview and locked decisions.** What changes, what explicitly does *not*
   change, and which explored variants were rejected. Declare **one ship
   configuration** — if your prototype has toggles/variants, state the exact shipping
   values and mark everything else "prototype-only, do not port".
2. **Fidelity statement.** Say whether values are final ("high-fidelity — match
   them") or directional. Ambiguity here costs review cycles.
3. **Target-codebase mapping.** A table of files to change (renderer, CSS module,
   model/types) and a mapping from your prototype class names to the plugin's
   existing CSS namespace. Use a *distinct* prototype namespace (`.proto-*`) so
   nothing is copy-pasted accidentally.
4. **Reuse mapping.** Tie every interaction to an **existing callback, model field,
   or state path** by name (e.g. "saves via `onSaveFields(task, { title })`"; "keep
   `parseAcceptanceProgress`"). Never invent parallel state or data flow when the
   feature already has one; if new state is genuinely required, list it explicitly
   in a "new state" section (and keep it minimal: local UI state vs persisted).
5. **Token-grounded specs.** Every color/size/font/radius/shadow as an Obsidian
   variable (§2). Layout specs per surface with explicit scroll/pin regions (§3).
6. **State matrices.** Per-status tables for actions, labels, colors (§4), plus
   empty/error/overflow states.
7. **Interactions & accessibility section.** Keyboard paths, focus behavior, close
   paths, aria roles, reduced-motion fallbacks, tooltips (§4–5).
8. **Assets statement.** Lucide icon names used (verified to exist); confirm no
   raster images and no font downloads. Avatars/badges are CSS + initials/icons.
9. **Prototypes (optional)** as runnable plain HTML files, clearly labeled
   *"design reference — not production code; the plugin builds DOM imperatively via
   Obsidian's API"*. If the prototype mirrors Obsidian variables to render
   standalone, say the mirror file must not ship.

A handoff that follows this template was implemented in 14 clean slices; the friction
that remained came from places where the prototype (React/JSX, tweak panels,
prototype-only class names) leaked assumptions the runtime can't honor. Keep the
boundary sharp.

---

## 8. Anti-patterns — never deliver these

- React/Vue/Svelte (or any npm UI library) as *implementation*, JSX in deliverable
  code, CSS-in-JS, Tailwind class soup.
- Raw hex/rgb colors, fixed px font sizes, or named fonts as the spec (tokens only).
- Inline styles as the styling mechanism; `innerHTML`-shaped designs (markup-string
  templating).
- Custom rebuilds of native affordances: tooltips, toasts, context menus, modal
  chrome, scrollbars, focus traps.
- Hover-only access to actions with no keyboard/touch path.
- Popovers absolutely positioned inside scroll containers (§3 — known bug class).
- `@media` queries for pane-level (sidebar) responsiveness (§3 — window ≠ pane).
- Arbitrary `z-index` values instead of Obsidian's `--layer-*`.
- Designs requiring every list item mounted (no-virtualization assumptions).
- Title Case copy, "Settings"/"General" headings, emoji in UI text.
- Decorative animation without a reduced-motion fallback; color-only status signals.
- Raster image assets or font downloads for UI chrome.
- New global state when an existing callback/model path already owns the behavior.

---

## 9. Pre-handoff checklist

Before handing off, confirm:

- [ ] Every visual value is an Obsidian CSS variable (or a justified, theme-aware
      plugin variable with light/dark values).
- [ ] Dark **and** light renderings hold up; nothing depends on a specific accent hue.
- [ ] Narrowest target width specified and designed for (sidebar ≈ 280px; modal
      collapse breakpoint stated).
- [ ] Scroll regions and pinned regions are explicit per surface.
- [ ] Every component lists all states incl. empty, error, overflow, loading.
- [ ] Per-status action/label/color matrices included where status exists.
- [ ] Keyboard path, focus behavior, and aria roles specified for every interaction.
- [ ] All motion has a reduced-motion fallback conveying the same information.
- [ ] All copy is sentence case and translation-safe.
- [ ] All icons are existing Lucide names.
- [ ] Prototype (if any) is labeled reference-only, uses a distinct class namespace,
      and ships with a mapping table to the plugin's namespace.
- [ ] Every interaction maps to a named existing callback/field, or is listed under
      "new state" with its minimal scope.
- [ ] "Not changing" list included.

---

## Appendix A — Project profile: Claudian

*This is the only section to replace when copying this document into another
plugin project.*

- **Plugin:** Claudian — multi-provider AI chat sidebar + Agent Board for Obsidian.
  `isDesktopOnly: true` (mobile out of scope). `minAppVersion: 1.11.5`.
- **CSS namespace:** all plugin classes are prefixed `.claudian-`, BEM-lite:
  `.claudian-{block}-{element}--{modifier}` (e.g. `.claudian-agent-board-card`,
  `.claudian-work-order-modal-action--cta`).
- **CSS layout:** modular files under `src/style/` (`base/`, `components/`,
  `toolbar/`, `features/`, `modals/`, `settings/`, `accessibility.css`), imported via
  `src/style/index.css` and bundled to a single root `styles.css`. New surfaces get a
  new file under the matching folder, registered in `index.css`.
- **Plugin-owned tokens** (in `src/style/base/variables.css`): `--claudian-brand`
  (#D97757 + `--claudian-brand-rgb`), provider brands switched via
  `data-provider="claude|codex|opencode|cursor"` on `.claudian-container`, with
  light-mode overrides under `body.theme-light`.
- **Hard rules enforced by lint:** no `innerHTML`/`outerHTML`/`insertAdjacentHTML`;
  no `console.*`; user-visible strings via `t('key.path')` (10 locales — design
  copy must be translation-safe).
- **Shared components to reuse in designs** (under `src/shared/`): `ConfirmModal`,
  `PromptModal`, `SelectableDropdown` (keyboard-navigable list dropdown),
  `SlashCommandDropdown`, `ResumeSessionDropdown`, `settingsListUI` (settings list
  rows + modal button rows), `LucideIconPicker`, custom SVG icons in
  `src/shared/icons.ts`.
- **Reference implementations of this document's patterns:**
  - `src/style/features/agent-board.css` + `src/features/tasks/ui/` — board lanes,
    cards, hover action clusters, portal popover (`portalPopover.ts`), live strips.
  - `src/style/features/work-order-modal.css` — sticky header/footer modal,
    two-pane → one-pane collapse at 720px, per-status header accents via
    `--claudian-wo-header-color` modifier classes.
  - `docs/reviews/2026-06-07-agent-board-redesign-a11y-audit.md` — the accessibility
    bar new designs are held to.
  - `docs/design/agent-board/README.md` — the prior design handoff this template is
    distilled from.
- **Performance constraint:** chat messages, history dropdowns, and board rendering
  are guarded by perf tests (`tests/perf/`) that pin DOM/listeners to a render
  window. Designs must keep per-item cost flat and must not require unbounded
  mounted DOM.
- **Modal sizing in use:** standard modals `min(600px, 90vw)`; work-order detail
  modal `min(960px, 92vw)` × `min(86vh, 760px)`.
