import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { itPosix } from '@test/helpers/platform';

import {
  OPENCODE_SAFE_MODE_ID,
  OPENCODE_YOLO_MODE_ID,
} from '../../../../src/providers/opencode/modes';
import {
  buildOpencodeManagedConfig,
  prepareOpencodeLaunchArtifacts,
} from '../../../../src/providers/opencode/runtime/OpencodeLaunchArtifacts';

describe('buildOpencodeManagedConfig', () => {
  it('pins OpenCode build, YOLO, safe, and plan prompts to the managed prompt file', () => {
    expect(buildOpencodeManagedConfig({}, '/vault/.specorator/opencode/system.md', 'Yishen')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      agent: {
        build: {
          prompt: '{file:/vault/.specorator/opencode/system.md}',
        },
        [OPENCODE_YOLO_MODE_ID]: {
          mode: 'primary',
          permission: {
            plan_enter: 'allow',
            question: 'allow',
          },
          prompt: '{file:/vault/.specorator/opencode/system.md}',
        },
        [OPENCODE_SAFE_MODE_ID]: {
          mode: 'primary',
          permission: {
            bash: 'ask',
            edit: 'ask',
            plan_enter: 'allow',
            question: 'allow',
          },
          prompt: '{file:/vault/.specorator/opencode/system.md}',
        },
        plan: {
          prompt: '{file:/vault/.specorator/opencode/system.md}',
        },
      },
      username: 'Yishen',
    });
  });

  it('can create a dedicated aux agent and default it for the process', () => {
    expect(buildOpencodeManagedConfig(
      {},
      '/vault/.specorator/opencode/auxiliary/system.md',
      undefined,
      [{
        definition: {
          mode: 'primary',
          permission: {
            '*': 'deny',
            read: 'allow',
          },
        },
        id: 'specorator-aux-readonly',
      }],
      'specorator-aux-readonly',
    )).toEqual({
      $schema: 'https://opencode.ai/config.json',
      agent: {
        'specorator-aux-readonly': {
          mode: 'primary',
          permission: {
            '*': 'deny',
            read: 'allow',
          },
          prompt: '{file:/vault/.specorator/opencode/auxiliary/system.md}',
        },
      },
      default_agent: 'specorator-aux-readonly',
    });
  });

  it('merges the user config instead of replacing it', () => {
    expect(buildOpencodeManagedConfig({
      agent: {
        build: {
          model: 'openai/gpt-5',
          permission: {
            bash: 'ask',
            edit: 'ask',
          },
        },
      },
      default_agent: 'build',
      providers: {
        openai: {
          api_key: 'test-key',
        },
      },
      username: 'Existing',
    }, '/vault/.specorator/opencode/system.md')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      agent: {
        build: {
          model: 'openai/gpt-5',
          permission: {
            bash: 'ask',
            edit: 'ask',
          },
          prompt: '{file:/vault/.specorator/opencode/system.md}',
        },
        [OPENCODE_YOLO_MODE_ID]: {
          mode: 'primary',
          permission: {
            plan_enter: 'allow',
            question: 'allow',
          },
          prompt: '{file:/vault/.specorator/opencode/system.md}',
        },
        [OPENCODE_SAFE_MODE_ID]: {
          mode: 'primary',
          permission: {
            bash: 'ask',
            edit: 'ask',
            plan_enter: 'allow',
            question: 'allow',
          },
          prompt: '{file:/vault/.specorator/opencode/system.md}',
        },
        plan: {
          prompt: '{file:/vault/.specorator/opencode/system.md}',
        },
      },
      default_agent: 'build',
      providers: {
        openai: {
          api_key: 'test-key',
        },
      },
      username: 'Existing',
    });
  });

  it('adds mcp.specorator remote entry when an httpToolServerConfig is provided', () => {
    const result = buildOpencodeManagedConfig(
      {},
      '/vault/.specorator/opencode/system.md',
      undefined,
      undefined,
      undefined,
      { url: 'http://127.0.0.1:54321/mcp', headers: { Authorization: 'Bearer test-token' } },
    );
    expect(result.mcp).toEqual({
      specorator: {
        type: 'remote',
        url: 'http://127.0.0.1:54321/mcp',
        headers: { Authorization: 'Bearer test-token' },
        enabled: true,
      },
    });
  });

  it('omits mcp.specorator when httpToolServerConfig is null', () => {
    const result = buildOpencodeManagedConfig(
      {},
      '/vault/.specorator/opencode/system.md',
      undefined,
      undefined,
      undefined,
      null,
    );
    expect(result.mcp).toBeUndefined();
  });

  it('omits mcp.specorator when httpToolServerConfig is not provided', () => {
    const result = buildOpencodeManagedConfig({}, '/vault/.specorator/opencode/system.md');
    expect(result.mcp).toBeUndefined();
  });

  it('merges mcp.specorator with existing mcp entries from base config', () => {
    const result = buildOpencodeManagedConfig(
      { mcp: { other: { type: 'stdio', command: 'my-server' } } },
      '/vault/.specorator/opencode/system.md',
      undefined,
      undefined,
      undefined,
      { url: 'http://127.0.0.1:54321/mcp', headers: { Authorization: 'Bearer token' } },
    );
    expect(result.mcp).toMatchObject({
      other: { type: 'stdio', command: 'my-server' },
      specorator: { type: 'remote', enabled: true },
    });
  });
});

describe('prepareOpencodeLaunchArtifacts', () => {
  // POSIX-only path assertion; on win32 the generated config embeds Windows-style paths.
  itPosix('layers the managed prompt config on top of OPENCODE_CONFIG', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'specorator-opencode-artifacts-'));
    const baseConfigPath = path.join(tmpRoot, 'opencode.base.json');
    await fs.writeFile(baseConfigPath, JSON.stringify({
      agent: {
        build: {
          model: 'openai/gpt-5',
        },
      },
      default_agent: 'build',
      providers: {
        anthropic: {
          api_key: 'anthropic-key',
        },
      },
    }), 'utf8');

    const result = await prepareOpencodeLaunchArtifacts({
      runtimeEnv: {
        HOME: tmpRoot,
        OPENCODE_CONFIG: baseConfigPath,
      } as NodeJS.ProcessEnv,
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: 'Yishen',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    });

    expect(result.configPath).toBe(path.join(tmpRoot, '.specorator', 'opencode', 'config.json'));
    expect(result.systemPromptPath).toBe(path.join(tmpRoot, '.specorator', 'opencode', 'system.md'));
    expect(result.configContent).toContain(`"prompt": "{file:${result.systemPromptPath}}"`);
    const generatedConfig = JSON.parse(await fs.readFile(result.configPath, 'utf8'));
    expect(generatedConfig).toMatchObject({
      default_agent: 'build',
      providers: {
        anthropic: {
          api_key: 'anthropic-key',
        },
      },
      username: 'Yishen',
    });
    expect(generatedConfig.agent).toMatchObject({
      build: {
        model: 'openai/gpt-5',
        prompt: `{file:${result.systemPromptPath}}`,
      },
      [OPENCODE_YOLO_MODE_ID]: {
        mode: 'primary',
        permission: {
          plan_enter: 'allow',
          question: 'allow',
        },
        prompt: `{file:${result.systemPromptPath}}`,
      },
      [OPENCODE_SAFE_MODE_ID]: {
        mode: 'primary',
        permission: {
          bash: 'ask',
          edit: 'ask',
          plan_enter: 'allow',
          question: 'allow',
        },
        prompt: `{file:${result.systemPromptPath}}`,
      },
      plan: {
        prompt: `{file:${result.systemPromptPath}}`,
      },
    });
  });

  it('keeps the launch key stable when the resolved default database is later passed as OPENCODE_DB', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'specorator-opencode-artifacts-'));
    const baseParams = {
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    };
    const first = await prepareOpencodeLaunchArtifacts({
      ...baseParams,
      runtimeEnv: {
        HOME: tmpRoot,
      } as NodeJS.ProcessEnv,
    });

    const second = await prepareOpencodeLaunchArtifacts({
      ...baseParams,
      runtimeEnv: {
        HOME: tmpRoot,
        OPENCODE_DB: first.databasePath ?? undefined,
      } as NodeJS.ProcessEnv,
    });

    expect(first.databasePath).toBe(second.databasePath);
    expect(first.launchKey).toBe(second.launchKey);
  });

  it('creates the resolved OpenCode database directory before launch', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'specorator-opencode-artifacts-'));
    const xdgDataHome = path.join(tmpRoot, 'xdg-data');
    const databaseDir = path.join(xdgDataHome, 'opencode');

    const result = await prepareOpencodeLaunchArtifacts({
      runtimeEnv: {
        HOME: path.join(tmpRoot, 'home'),
        XDG_DATA_HOME: xdgDataHome,
      } as NodeJS.ProcessEnv,
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    });

    expect(result.databasePath).toBe(path.join(databaseDir, 'opencode.db'));
    await expect(fs.access(databaseDir)).resolves.toBeUndefined();
  });
});
