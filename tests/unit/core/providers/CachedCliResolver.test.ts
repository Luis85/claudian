import { CachedCliResolver, type CliResolutionSpec } from '@/core/providers/CachedCliResolver';
import { getHostnameKey } from '@/utils/env';

jest.mock('@/utils/env', () => {
  const actual = jest.requireActual('@/utils/env');
  return { ...actual, getHostnameKey: jest.fn(() => 'current-host') };
});

jest.mock('@/core/providers/providerEnvironment', () => {
  const actual = jest.requireActual('@/core/providers/providerEnvironment');
  return {
    ...actual,
    getRuntimeEnvironmentText: jest.fn(
      (settings: Record<string, unknown>) => (settings.__envText as string | undefined) ?? '',
    ),
  };
});

interface FakeSettings {
  __legacy?: string;
  __byHost?: Record<string, string>;
  __extra?: string;
  __envText?: string;
}

function makeResolver(resolveFn: jest.Mock) {
  const spec: CliResolutionSpec<string> = {
    providerId: 'claude',
    read: (settings: Record<string, unknown>) => {
      const typed = settings as FakeSettings;
      return {
        cliPath: typed.__legacy ?? '',
        cliPathsByHost: typed.__byHost ?? {},
        extra: typed.__extra ?? '',
      };
    },
    resolve: resolveFn as unknown as CliResolutionSpec<string>['resolve'],
    cacheKeyForExtra: extra => extra,
  };
  return new CachedCliResolver(spec);
}

describe('CachedCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getHostnameKey as jest.Mock).mockReturnValue('current-host');
  });

  it('selects the current host path, trims inputs, and returns the resolved path', () => {
    const resolve = jest.fn().mockReturnValue('/bin/cli');
    const resolver = makeResolver(resolve);

    const result = resolver.resolveFromSettings({
      __byHost: { 'current-host': '  /custom/cli  ', 'other-host': '/other/cli' },
      __legacy: '  /legacy/cli  ',
      __envText: 'PATH=/bin',
      __extra: 'native',
    });

    expect(result).toBe('/bin/cli');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({
      hostnamePath: '/custom/cli',
      legacyPath: '/legacy/cli',
      envText: 'PATH=/bin',
      extra: 'native',
    });
  });

  it('ignores host entries that do not match the current host', () => {
    const resolve = jest.fn().mockReturnValue('/legacy/cli');
    const resolver = makeResolver(resolve);

    resolver.resolveFromSettings({ __byHost: { 'other-host': '/other/cli' }, __legacy: '/legacy/cli' });

    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ hostnamePath: '', legacyPath: '/legacy/cli' }));
  });

  it('memoizes when inputs are unchanged', () => {
    const resolve = jest.fn().mockReturnValue('/bin/cli');
    const resolver = makeResolver(resolve);
    const settings = { __byHost: { 'current-host': '/custom/cli' }, __envText: 'PATH=/bin' };

    expect(resolver.resolveFromSettings(settings)).toBe('/bin/cli');
    expect(resolver.resolveFromSettings(settings)).toBe('/bin/cli');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('caches a null result rather than re-resolving every call', () => {
    const resolve = jest.fn().mockReturnValue(null);
    const resolver = makeResolver(resolve);
    const settings = { __legacy: '/missing/cli' };

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['host path', { __byHost: { 'current-host': '/a' } }, { __byHost: { 'current-host': '/b' } }],
    ['legacy path', { __legacy: '/a' }, { __legacy: '/b' }],
    ['env text', { __envText: 'PATH=/a' }, { __envText: 'PATH=/b' }],
    ['extra key', { __extra: 'native' }, { __extra: 'wsl' }],
  ])('re-resolves when the %s changes', (_label, first, second) => {
    const resolve = jest.fn().mockReturnValue('/bin/cli');
    const resolver = makeResolver(resolve);

    resolver.resolveFromSettings(first);
    resolver.resolveFromSettings(second);

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('re-resolves after reset()', () => {
    const resolve = jest.fn().mockReturnValue('/bin/cli');
    const resolver = makeResolver(resolve);
    const settings = { __legacy: '/custom/cli' };

    resolver.resolveFromSettings(settings);
    resolver.reset();
    resolver.resolveFromSettings(settings);

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('omits cacheKeyForExtra contribution when the spec has none', () => {
    const resolve = jest.fn().mockReturnValue('/bin/cli');
    const spec: CliResolutionSpec = {
      providerId: 'claude',
      read: () => ({ cliPath: '/custom/cli', cliPathsByHost: {}, extra: undefined }),
      resolve: resolve as unknown as CliResolutionSpec['resolve'],
    };
    const resolver = new CachedCliResolver(spec);

    resolver.resolveFromSettings({});
    resolver.resolveFromSettings({});

    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
