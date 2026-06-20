import { STANDARD_PERSONA_ID } from '../../../../src/features/agents/agentTypes';
import {
  buildPersonaResolver,
  listPersonas,
  resolvePersona,
  rosterAgentToPersona,
} from '../../../../src/features/agents/personaRegistry';
import type { AgentRosterStore } from '../../../../src/features/agents/roster/AgentRosterStore';
import { createRosterAgent } from '../../../../src/features/agents/roster/rosterCapabilities';

describe('personaRegistry', () => {
  describe('resolvePersona', () => {
    it('resolves an absent id to the Standard built-in', () => {
      const persona = resolvePersona(undefined);
      expect(persona.id).toBe(STANDARD_PERSONA_ID);
      expect(persona.builtin).toBe(true);
      // Display name is sourced from i18n (English default in tests).
      expect(persona.name).toBe('Standard');
    });

    it('resolves an empty id to Standard', () => {
      expect(resolvePersona('').id).toBe(STANDARD_PERSONA_ID);
    });

    it('resolves an unknown id to Standard (the id itself is not consumed here)', () => {
      const persona = resolvePersona('refactorer-not-registered');
      expect(persona.id).toBe(STANDARD_PERSONA_ID);
      expect(persona.builtin).toBe(true);
    });

    it('resolves the standard id to the built-in', () => {
      const persona = resolvePersona(STANDARD_PERSONA_ID);
      expect(persona.id).toBe(STANDARD_PERSONA_ID);
      expect(persona.builtin).toBe(true);
    });

    it('gives the built-in a CSS-variable color and no initials', () => {
      const persona = resolvePersona(undefined);
      expect(persona.color).toBe('var(--color-base-90)');
      expect(persona.initials).toBeUndefined();
    });
  });

  describe('listPersonas', () => {
    it('includes Standard', () => {
      const ids = listPersonas().map((p) => p.id);
      expect(ids).toContain(STANDARD_PERSONA_ID);
    });

    it('lists only Standard until custom personas ship', () => {
      const personas = listPersonas();
      expect(personas).toHaveLength(1);
      expect(personas[0].id).toBe(STANDARD_PERSONA_ID);
    });
  });

  describe('rosterAgentToPersona', () => {
    it('uses the agent color and initials when present', () => {
      const agent = { ...createRosterAgent('Code Reviewer', 1), color: 'var(--color-purple)', initials: 'CR' };
      const persona = rosterAgentToPersona(agent);
      expect(persona.id).toBe('roster:code-reviewer');
      expect(persona.name).toBe('Code Reviewer');
      expect(persona.color).toBe('var(--color-purple)');
      expect(persona.initials).toBe('CR');
      expect(persona.builtin).toBe(false);
    });

    it('derives a monogram and neutral color when the agent has none', () => {
      const persona = rosterAgentToPersona(createRosterAgent('Test Author', 1));
      expect(persona.initials).toBe('TA');
      expect(persona.color).toBe('var(--color-base-70)');
    });
  });

  describe('buildPersonaResolver', () => {
    it('resolves a roster id to its persona once preloaded', async () => {
      const agent = { ...createRosterAgent('Debugger', 1), color: 'var(--color-red)', initials: 'DB' };
      let resolveList!: (a: typeof agent[]) => void;
      const store = {
        list: jest.fn(() => new Promise<typeof agent[]>((r) => { resolveList = r; })),
      } as unknown as AgentRosterStore;
      const resolve = buildPersonaResolver(store);

      // Before the preload lands, unknown roster ids fall back to Standard.
      expect(resolve('roster:debugger').id).toBe(STANDARD_PERSONA_ID);

      resolveList([agent]);
      await Promise.resolve();

      const persona = resolve('roster:debugger');
      expect(persona.id).toBe('roster:debugger');
      expect(persona.initials).toBe('DB');
    });

    it('falls back to resolvePersona for built-in and unknown ids', () => {
      const resolve = buildPersonaResolver(null);
      expect(resolve(undefined).id).toBe(STANDARD_PERSONA_ID);
      expect(resolve(STANDARD_PERSONA_ID).id).toBe(STANDARD_PERSONA_ID);
    });
  });
});
