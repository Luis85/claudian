import { t } from '../../i18n/i18n';
import { type AgentPersona, STANDARD_PERSONA_ID } from './agentTypes';
import type { AgentRosterStore } from './roster/AgentRosterStore';

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

/**
 * Returns a `getAgentOptions` callback and kicks off an async preload of roster
 * agents so the callback stays synchronous at call time. Persona options are
 * always available immediately; roster agents are available once the preload
 * resolves (typically before the modal renders, since the list call is fast).
 *
 * Usage:
 * ```ts
 * const getAgentOptions = buildAgentOptionsLoader(plugin.agentRosterStore);
 * // then pass as: getAgentOptions,
 * ```
 */
export function buildAgentOptionsLoader(
  store: AgentRosterStore | null | undefined,
): () => Array<{ value: string; label: string }> {
  let rosterOptions: Array<{ value: string; label: string }> = [];
  void store?.list().then((agents) => {
    rosterOptions = agents.map((a) => ({ value: a.id, label: `Agent: ${a.name}` }));
  });
  return () => [
    ...listPersonas().map((p) => ({ value: p.id, label: p.name })),
    ...rosterOptions,
  ];
}
