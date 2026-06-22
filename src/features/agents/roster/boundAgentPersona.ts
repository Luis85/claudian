export interface BoundAgentPersonaInput {
  name: string;
  description?: string;
  prompt?: string;
}

/** The resolved persona/model/tool projection a conversation adopts from its
 *  bound roster agent. */
export interface BoundAgentProjection {
  prompt?: string;
  model?: string;
  tools?: string[];
}

/**
 * Builds the persona directive injected when a conversation is bound to a roster
 * agent. It leads with a forceful identity statement so providers without a
 * dedicated system-prompt channel (notably Cursor, whose CLI exposes no
 * system-prompt flag) still adopt the role instead of falling back to their
 * built-in assistant identity. Returns an empty string when there is nothing to
 * say (no name and no instructions).
 */
export function formatBoundAgentPersona(agent: BoundAgentPersonaInput): string {
  const name = agent.name?.trim();
  const description = agent.description?.trim();
  const prompt = agent.prompt?.trim();

  const blocks: string[] = [];
  if (name) {
    const identity = description ? `${name} — ${description}` : name;
    blocks.push(
      `You are ${identity}. Adopt this identity, role, and voice for the entire `
      + `conversation. This overrides any default assistant identity or model name: `
      + `when asked who or what you are, answer as ${name}.`,
    );
  }
  if (prompt) {
    blocks.push(prompt);
  }
  return blocks.join('\n\n');
}
