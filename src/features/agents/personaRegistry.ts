import { t } from '../../i18n/i18n';
import { type AgentPersona, STANDARD_PERSONA_ID } from './agentTypes';

/**
 * The built-in Standard persona. Neutral color, no initials (rendered with the
 * `cpu` icon by the avatar). Its display name is read from i18n at call time so
 * it follows the active locale. This is the resolve fallback for any absent or
 * unknown agent id.
 */
function standardPersona(): AgentPersona {
  return {
    id: STANDARD_PERSONA_ID,
    name: t('agents.persona.standard'),
    color: 'var(--color-base-90)',
    builtin: true,
  };
}

/**
 * All selectable personas, in picker order. Only Standard ships today; a future
 * Agents feature extends this list (and `resolvePersona`) without touching the
 * card / modal read sites that consume them.
 */
export function listPersonas(): AgentPersona[] {
  return [standardPersona()];
}

/**
 * Resolve an agent id to its persona. An absent id (no assignment yet) OR an
 * unknown id (a persona a future Agents feature owns but this build does not
 * know) both resolve to Standard, so a read site always has a persona to render
 * while the underlying `agent` frontmatter id round-trips untouched.
 */
export function resolvePersona(id?: string): AgentPersona {
  if (!id) return standardPersona();
  return listPersonas().find((persona) => persona.id === id) ?? standardPersona();
}
