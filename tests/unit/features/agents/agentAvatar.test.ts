/**
 * @jest-environment jsdom
 */
import '../../../setup/obsidianDom';

import { renderAgentAvatar } from '../../../../src/features/agents/agentAvatar';
import type { AgentPersona } from '../../../../src/features/agents/agentTypes';
import { resolvePersona } from '../../../../src/features/agents/personaRegistry';

const STANDARD = resolvePersona(undefined);

const CUSTOM: AgentPersona = {
  id: 'refactorer',
  name: 'Refactorer',
  color: 'var(--color-purple)',
  initials: 'RF',
};

describe('renderAgentAvatar', () => {
  it('renders a circular avatar chip carrying the persona name as title + aria-label', () => {
    const host = document.createElement('div');
    const avatar = renderAgentAvatar(host, STANDARD, 20);
    expect(avatar.classList.contains('claudian-agent-avatar')).toBe(true);
    expect(avatar.getAttribute('title')).toBe('Standard');
    expect(avatar.getAttribute('aria-label')).toBe('Standard');
  });

  it('renders the Standard built-in with the cpu icon (intent recorded via data-icon)', () => {
    const host = document.createElement('div');
    const avatar = renderAgentAvatar(host, STANDARD, 20);
    expect(avatar.getAttribute('data-icon')).toBe('cpu');
    // No initials text for the icon-backed built-in.
    expect(avatar.textContent).toBe('');
  });

  it('injects the persona color + size as CSS custom properties (no static color/hex)', () => {
    const host = document.createElement('div');
    const avatar = renderAgentAvatar(host, STANDARD, 20);
    expect(avatar.style.getPropertyValue('--agent-color')).toBe('var(--color-base-90)');
    expect(avatar.style.getPropertyValue('--agent-avatar-size')).toBe('20px');
    // Icon sized to ~58% of the avatar (20 * 0.58 = 11.6 → 12).
    expect(avatar.style.getPropertyValue('--agent-avatar-icon-size')).toBe('12px');
  });

  it('sizes the modal avatar at 18px (icon ~58% → 10px)', () => {
    const host = document.createElement('div');
    const avatar = renderAgentAvatar(host, STANDARD, 18);
    expect(avatar.style.getPropertyValue('--agent-avatar-size')).toBe('18px');
    expect(avatar.style.getPropertyValue('--agent-avatar-icon-size')).toBe('10px');
  });

  it('renders a custom persona with its initials instead of an icon', () => {
    const host = document.createElement('div');
    const avatar = renderAgentAvatar(host, CUSTOM, 20);
    expect(avatar.classList.contains('claudian-agent-avatar--initials')).toBe(true);
    expect(avatar.textContent).toBe('RF');
    expect(avatar.getAttribute('data-icon')).toBeNull();
    expect(avatar.style.getPropertyValue('--agent-color')).toBe('var(--color-purple)');
  });

  it('appends the avatar to the provided parent', () => {
    const host = document.createElement('div');
    renderAgentAvatar(host, STANDARD, 20);
    expect(host.querySelector('.claudian-agent-avatar')).not.toBeNull();
  });

  it('renders a non-builtin persona with icon: wrench using the icon glyph, not initials', () => {
    const host = document.createElement('div');
    const persona: AgentPersona = {
      id: 'fixer',
      name: 'Fixer',
      color: 'var(--color-orange)',
      initials: 'FX',
      icon: 'wrench',
    };
    const avatar = renderAgentAvatar(host, persona, 20);
    expect(avatar.getAttribute('data-icon')).toBe('wrench');
    // icon takes precedence — no initials text
    expect(avatar.textContent).toBe('');
    expect(avatar.classList.contains('claudian-agent-avatar--initials')).toBe(false);
  });

  it('renders a non-builtin persona with only initials (no icon) using initials', () => {
    const host = document.createElement('div');
    const avatar = renderAgentAvatar(host, CUSTOM, 20);
    expect(avatar.classList.contains('claudian-agent-avatar--initials')).toBe(true);
    expect(avatar.textContent).toBe('RF');
    expect(avatar.getAttribute('data-icon')).toBeNull();
  });

  it('falls back to cpu for a non-builtin persona with no icon and no initials', () => {
    const host = document.createElement('div');
    const persona: AgentPersona = {
      id: 'empty',
      name: 'Empty',
      color: 'var(--color-base-70)',
    };
    const avatar = renderAgentAvatar(host, persona, 20);
    expect(avatar.getAttribute('data-icon')).toBe('cpu');
    expect(avatar.textContent).toBe('');
  });
});
