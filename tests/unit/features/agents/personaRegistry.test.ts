import { STANDARD_PERSONA_ID } from '../../../../src/features/agents/agentTypes';
import { listPersonas, resolvePersona } from '../../../../src/features/agents/personaRegistry';

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
});
