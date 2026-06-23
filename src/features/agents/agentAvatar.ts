import { setIcon } from 'obsidian';

import type { AgentPersona } from './agentTypes';

/** Glyph icon proportion of the avatar diameter for the built-in persona. */
const ICON_RATIO = 0.58;

/**
 * Render a persona avatar: a circular chip whose size, color, and content come
 * from the persona. The dynamic per-persona color is injected as the
 * `--agent-color` CSS custom property (the persona color is itself an Obsidian
 * `var(--color-…)` token); the chip's background / text / border all derive from
 * it in CSS via `color-mix`, so no static color or `rgba` literal is set here.
 * The size is likewise pushed as `--agent-avatar-size` rather than assigned to
 * `style.*` directly (lint: `no-static-styles-assignment`).
 *
 * - Built-in personas render the `cpu` icon at ~58% of the avatar.
 * - Custom personas render their `icon` glyph when set, otherwise their `initials`.
 *
 * `title` (and `aria-label`) is the persona name so the assignee reads on hover
 * and to assistive tech.
 */
export function renderAgentAvatar(
  parent: HTMLElement,
  persona: AgentPersona,
  sizePx: number,
): HTMLElement {
  const avatar = parent.createSpan({ cls: 'specorator-agent-avatar' });
  avatar.setCssProps({
    '--agent-color': persona.color,
    '--agent-avatar-size': `${sizePx}px`,
    '--agent-avatar-icon-size': `${Math.round(sizePx * ICON_RATIO)}px`,
  });
  avatar.setAttr('title', persona.name);
  avatar.setAttr('aria-label', persona.name);

  const glyph = persona.builtin ? 'cpu' : persona.icon;
  if (glyph) {
    // The mock `setIcon` is a no-op; record the glyph intent so tests can assert
    // it (consistent with the rest of the board / modal).
    avatar.setAttr('data-icon', glyph);
    setIcon(avatar, glyph);
  } else if (persona.initials) {
    avatar.addClass('specorator-agent-avatar--initials');
    avatar.setText(persona.initials);
  } else {
    avatar.setAttr('data-icon', 'cpu');
    setIcon(avatar, 'cpu');
  }

  return avatar;
}
