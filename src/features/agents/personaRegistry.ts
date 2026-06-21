import { t } from '../../i18n/i18n';
import { type AgentPersona, STANDARD_PERSONA_ID } from './agentTypes';
import type { AgentRosterStore } from './roster/AgentRosterStore';
import type { RosterAgent } from './roster/rosterTypes';

/** Resolves an `agent` frontmatter id to the persona used to render its avatar. */
export type PersonaResolver = (id?: string) => AgentPersona;

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
 * Projects a roster agent onto the persona shape so the board / modal can render
 * its avatar. Uses the agent's own color + initials when present, otherwise
 * derives a two-letter monogram from the name and a neutral color.
 */
export function rosterAgentToPersona(agent: RosterAgent): AgentPersona {
  const derived = agent.name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return {
    id: agent.id,
    name: agent.name,
    color: agent.color || 'var(--color-base-70)',
    initials: agent.initials?.trim() || derived || 'AG',
    builtin: false,
  };
}

/**
 * Returns a synchronous persona resolver and kicks off an async preload of
 * roster agents (mirrors `buildAgentOptionsLoader`). Built-in personas resolve
 * immediately; `roster:<id>` ids resolve to their custom avatar once the preload
 * lands, falling back to `resolvePersona` (Standard) until then.
 */
export function buildPersonaResolver(
  store: AgentRosterStore | null | undefined,
): PersonaResolver {
  const rosterPersonas = new Map<string, AgentPersona>();
  void store?.list().then((agents) => {
    for (const agent of agents) rosterPersonas.set(agent.id, rosterAgentToPersona(agent));
  });
  return (id?: string) => (id && rosterPersonas.get(id)) || resolvePersona(id);
}

/**
 * Builds the combined persona + roster-agent options for the agent picker from
 * an already-loaded roster list. Callers preload the list (e.g. `await
 * store.list()`) before opening the modal so the dropdown is populated on first
 * render — an async preload would leave roster agents missing on open. Personas
 * are labelled as their name; roster agents as `Agent: <name>`.
 */
export function buildAgentOptions(
  agents: RosterAgent[],
): Array<{ value: string; label: string }> {
  return [
    ...listPersonas().map((p) => ({ value: p.id, label: p.name })),
    ...agents.map((a) => ({ value: a.id, label: `Agent: ${a.name}` })),
  ];
}
