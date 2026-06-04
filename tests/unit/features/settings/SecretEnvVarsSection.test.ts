import { SecretComponent, Setting } from 'obsidian';

import type { PluginContext } from '../../../../src/core/types/PluginContext';
import type { SecretEnvVarRef } from '../../../../src/core/types/settings';
import { renderSecretEnvVarsSection } from '../../../../src/features/settings/ui/SecretEnvVarsSection';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeContainer(): any {
  const host: any = { empty: jest.fn(), createDiv: () => host };
  return { createDiv: () => host };
}

function makePlugin(secretEnvVars: SecretEnvVarRef[], stored: Record<string, string> = {}): PluginContext {
  const secrets = new Map<string, string>(Object.entries(stored));
  const settings = { secretEnvVars };
  const plugin = {
    app: {
      secretStorage: {
        getSecret: (id: string) => (secrets.has(id) ? (secrets.get(id) as string) : null),
        setSecret: (id: string, v: string) => secrets.set(id, v),
        listSecrets: () => Array.from(secrets.keys()),
      },
    },
    settings,
    saveSettings: jest.fn().mockResolvedValue(undefined),
    // Mirrors SecretStore.clear (the API has no delete; it overwrites with '').
    secretStore: {
      clear: jest.fn((id: string) => secrets.set(id, '')),
      get: (id: string) => {
        const v = secrets.get(id);
        return v === undefined || v === '' ? null : v;
      },
    },
    applySecretEnvVars: jest.fn().mockImplementation(async (refs: SecretEnvVarRef[]) => {
      settings.secretEnvVars = refs;
    }),
  } as unknown as PluginContext;
  return plugin;
}

// The mock Setting tracks `instances`/`components` and SecretComponent exposes
// `value`/`triggerChange` — none of which are on the real Obsidian types.
function settingInstances(): any[] {
  return (Setting as unknown as { instances: any[] }).instances;
}
function allComponents(): any[] {
  return settingInstances().flatMap((s) => s.components);
}
function secretComponents(): any[] {
  return allComponents().map((c) => c.props).filter((p) => p instanceof SecretComponent);
}
function buttons(): any[] {
  return allComponents().filter((c) => c.kind === 'button').map((c) => c.props);
}
function textComponents(): any[] {
  return allComponents().filter((c) => c.kind === 'text').map((c) => c.props);
}

describe('renderSecretEnvVarsSection', () => {
  beforeEach(() => {
    settingInstances().length = 0;
  });

  it('renders a SecretComponent per ref in scope plus the add row', () => {
    const plugin = makePlugin(
      [
        { scope: 'shared', name: 'OPENAI_API_KEY', secretId: 'sid' },
        { scope: 'provider:claude', name: 'ANTHROPIC_API_KEY', secretId: 'other' },
      ],
      { sid: 'dummy-x' },
    );
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    // One row for the in-scope ref + one for the add row (the provider:claude ref is excluded).
    const components = secretComponents();
    expect(components).toHaveLength(2);
    expect(components.some((c) => c.value === 'sid')).toBe(true);
  });

  it('updates a ref secret id and saves when its SecretComponent changes', async () => {
    const plugin = makePlugin([{ scope: 'shared', name: 'OPENAI_API_KEY', secretId: 'sid' }], { sid: 'dummy-x' });
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    const rowComponent = secretComponents().find((c) => c.value === 'sid');
    rowComponent?.triggerChange('sid-2');
    await flush();

    expect((plugin.settings.secretEnvVars as SecretEnvVarRef[])[0].secretId).toBe('sid-2');
    expect(plugin.applySecretEnvVars).toHaveBeenCalled();
  });

  it('adds a new secret variable from the add row', async () => {
    const plugin = makePlugin([]);
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    textComponents()[0].changeHandler('ANTHROPIC_API_KEY'); // the var-name input
    secretComponents()[0].triggerChange('new-sid'); // the add-row SecretComponent (only one when empty)
    buttons().find((b) => b.buttonText === 'Add')?.clickHandler();
    await flush();

    expect(plugin.settings.secretEnvVars).toEqual([
      { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'new-sid' },
    ]);
    expect(plugin.applySecretEnvVars).toHaveBeenCalled();
  });

  it('replaces an existing same-(scope,name) ref instead of appending a duplicate', async () => {
    const oldId = 'claudian-env-shared-anthropic-api-key';
    const plugin = makePlugin(
      [{ scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: oldId }],
      { [oldId]: 'dummy-old' },
    );
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    // Re-add the SAME name in the same scope with a different secret.
    textComponents()[0].changeHandler('ANTHROPIC_API_KEY');
    secretComponents()[0].triggerChange('new-sid');
    buttons().find((b) => b.buttonText === 'Add')?.clickHandler();
    await flush();

    // Exactly one ref for that (scope, name), pointing at the new secret.
    expect(plugin.settings.secretEnvVars).toEqual([
      { scope: 'shared', name: 'ANTHROPIC_API_KEY', secretId: 'new-sid' },
    ]);
    // The replaced Claudian-owned id is orphaned → cleared so it can't re-activate.
    expect(plugin.secretStore.clear).toHaveBeenCalledWith(oldId);
  });

  it('does not add when name or secret is missing', async () => {
    const plugin = makePlugin([]);
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    // Only a name, no secret picked.
    textComponents()[0].changeHandler('ANTHROPIC_API_KEY');
    buttons().find((b) => b.buttonText === 'Add')?.clickHandler();
    await flush();

    expect(plugin.settings.secretEnvVars).toEqual([]);
    expect(plugin.applySecretEnvVars).not.toHaveBeenCalled();
  });

  it('removes a ref and clears its orphaned Claudian-generated secret on delete', async () => {
    const id = 'claudian-env-shared-openai-api-key';
    const plugin = makePlugin([{ scope: 'shared', name: 'OPENAI_API_KEY', secretId: id }], { [id]: 'dummy-x' });
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    buttons().find((b) => b.icon === 'trash')?.clickHandler();
    await flush();

    expect(plugin.settings.secretEnvVars).toEqual([]);
    expect(plugin.applySecretEnvVars).toHaveBeenCalled();
    // The deleted key/token no longer lingers in SecretStorage.
    expect(plugin.secretStore.clear).toHaveBeenCalledWith(id);
    expect(plugin.secretStore.get(id)).toBeNull();
  });

  it('does not clear an external (non-Claudian) secret id on delete', async () => {
    // SecretStorage ids are global; an id another plugin owns must survive.
    const plugin = makePlugin([{ scope: 'shared', name: 'OPENAI_API_KEY', secretId: 'external-id' }], {
      'external-id': 'dummy-x',
    });
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    buttons().find((b) => b.icon === 'trash')?.clickHandler();
    await flush();

    expect(plugin.settings.secretEnvVars).toEqual([]);
    expect(plugin.secretStore.clear).not.toHaveBeenCalled();
    expect(plugin.secretStore.get('external-id')).toBe('dummy-x');
  });

  it('does not clear a secret value still referenced by another row', async () => {
    const id = 'claudian-env-shared-shared-key';
    const plugin = makePlugin(
      [
        { scope: 'shared', name: 'OPENAI_API_KEY', secretId: id },
        { scope: 'provider:claude', name: 'ALT_KEY', secretId: id },
      ],
      { [id]: 'dummy-x' },
    );
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    buttons().find((b) => b.icon === 'trash')?.clickHandler();
    await flush();

    expect(plugin.settings.secretEnvVars).toEqual([
      { scope: 'provider:claude', name: 'ALT_KEY', secretId: id },
    ]);
    expect(plugin.secretStore.clear).not.toHaveBeenCalled(); // still referenced → preserved
  });

  it('clears the previous Claudian id when a row is retargeted to a new secret', async () => {
    const oldId = 'claudian-env-shared-openai-api-key';
    const plugin = makePlugin([{ scope: 'shared', name: 'OPENAI_API_KEY', secretId: oldId }], { [oldId]: 'dummy-x' });
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    secretComponents().find((c) => c.value === oldId)?.triggerChange('claudian-env-shared-new');
    await flush();

    expect((plugin.settings.secretEnvVars as SecretEnvVarRef[])[0].secretId).toBe('claudian-env-shared-new');
    expect(plugin.secretStore.clear).toHaveBeenCalledWith(oldId); // old value no longer orphaned
  });

  it('does not clear an external previous id when a row is retargeted', async () => {
    const plugin = makePlugin([{ scope: 'shared', name: 'OPENAI_API_KEY', secretId: 'external-id' }], {
      'external-id': 'dummy-x',
    });
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    secretComponents().find((c) => c.value === 'external-id')?.triggerChange('claudian-env-shared-new');
    await flush();

    expect(plugin.secretStore.clear).not.toHaveBeenCalled();
    expect(plugin.secretStore.get('external-id')).toBe('dummy-x');
  });
});
