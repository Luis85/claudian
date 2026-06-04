import { type SecretStorageApi,SecretStore } from '../../../../src/core/security/secretStore';

/** In-memory fake matching Obsidian's SecretStorage contract. */
function createFakeSecretStorage(): SecretStorageApi & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    setSecret: (id, secret) => {
      map.set(id, secret);
    },
    getSecret: (id) => (map.has(id) ? (map.get(id) as string) : null),
    listSecrets: () => Array.from(map.keys()),
  };
}

describe('SecretStore', () => {
  it('stores and reads a secret value', () => {
    const api = createFakeSecretStorage();
    const store = new SecretStore(api);

    store.set('env-shared-anthropic-api-key', 'dummy-abc123');

    expect(store.get('env-shared-anthropic-api-key')).toBe('dummy-abc123');
    expect(api.map.get('env-shared-anthropic-api-key')).toBe('dummy-abc123');
  });

  it('returns null for an unknown id', () => {
    const store = new SecretStore(createFakeSecretStorage());
    expect(store.get('missing')).toBeNull();
  });

  it('reports presence via has()', () => {
    const store = new SecretStore(createFakeSecretStorage());
    expect(store.has('k')).toBe(false);
    store.set('k', 'v');
    expect(store.has('k')).toBe(true);
  });

  it('treats a cleared (empty-string) secret as absent', () => {
    const store = new SecretStore(createFakeSecretStorage());
    store.set('k', 'v');
    store.clear('k');
    expect(store.has('k')).toBe(false);
  });

  it('overwrites an existing value (no delete in the API)', () => {
    const store = new SecretStore(createFakeSecretStorage());
    store.set('k', 'first');
    store.set('k', 'second');
    expect(store.get('k')).toBe('second');
  });

  it('lists stored ids', () => {
    const store = new SecretStore(createFakeSecretStorage());
    store.set('a', '1');
    store.set('b', '2');
    expect(store.list().sort()).toEqual(['a', 'b']);
  });

  it('normalizes a cleared (empty-string) secret to null on get()', () => {
    const api = createFakeSecretStorage();
    const store = new SecretStore(api);
    store.set('k', 'v');
    store.clear('k');
    expect(store.get('k')).toBeNull();
    expect(api.map.get('k')).toBe(''); // underlying API still holds the empty sentinel
  });
});
