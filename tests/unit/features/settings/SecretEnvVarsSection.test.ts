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
      { sid: 'sk-x' },
    );
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    // One row for the in-scope ref + one for the add row (the provider:claude ref is excluded).
    const components = secretComponents();
    expect(components).toHaveLength(2);
    expect(components.some((c) => c.value === 'sid')).toBe(true);
  });

  it('updates a ref secret id and saves when its SecretComponent changes', async () => {
    const plugin = makePlugin([{ scope: 'shared', name: 'OPENAI_API_KEY', secretId: 'sid' }], { sid: 'sk-x' });
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

  it('removes a ref when its trash button is clicked', async () => {
    const plugin = makePlugin([{ scope: 'shared', name: 'OPENAI_API_KEY', secretId: 'sid' }], { sid: 'sk-x' });
    renderSecretEnvVarsSection({ container: makeContainer(), plugin, scope: 'shared' });

    buttons().find((b) => b.icon === 'trash')?.clickHandler();
    await flush();

    expect(plugin.settings.secretEnvVars).toEqual([]);
    expect(plugin.applySecretEnvVars).toHaveBeenCalled();
  });
});
