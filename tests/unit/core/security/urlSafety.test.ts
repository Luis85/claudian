import type { LookupAddress } from 'dns';

// Node core module properties are non-configurable, so the default-resolver
// seam is covered via a module mock instead of jest.spyOn(dns, 'lookup').
const mockDnsLookup = jest.fn();
jest.mock('dns', () => ({
  lookup: (...args: unknown[]) => mockDnsLookup(...args) as unknown,
}));

import type { HostResolver, ResolvedAddress } from '@/core/security/urlSafety';
import {
  assertSafeRemoteUrl,
  createPinnedLookup,
  expandIpv6Groups,
  getDeniedIpReason,
  parseIpv4Octets,
  UnsafeUrlError,
} from '@/core/security/urlSafety';

const PUBLIC_V4: ResolvedAddress = { address: '93.184.216.34', family: 4 };
const PUBLIC_V6: ResolvedAddress = { address: '2606:4700::1111', family: 6 };

function resolverOf(...addresses: ResolvedAddress[]): HostResolver {
  return jest.fn(async () => addresses);
}

function neverResolver(): HostResolver {
  return jest.fn(async () => {
    throw new Error('resolver must not be called for literal IP hostnames');
  });
}

describe('getDeniedIpReason', () => {
  describe('denied ranges', () => {
    const denied: Array<[string, string]> = [
      // loopback
      ['127.0.0.1', 'loopback'],
      ['127.255.0.10', 'loopback'],
      ['::1', 'loopback'],
      // link-local (includes cloud metadata)
      ['169.254.169.254', 'link-local'],
      ['169.254.0.1', 'link-local'],
      ['fe80::1', 'link-local'],
      ['febf::1234', 'link-local'],
      // RFC1918 private
      ['10.0.0.1', 'private'],
      ['10.255.255.255', 'private'],
      ['172.16.0.1', 'private'],
      ['172.31.255.254', 'private'],
      ['192.168.1.1', 'private'],
      // RFC6598 shared address space (CGNAT), 100.64.0.0/10 — hosts some
      // cloud-provider metadata endpoints (e.g. 100.100.100.200)
      ['100.64.0.0', 'private'],
      ['100.100.100.200', 'private'],
      ['100.127.255.255', 'private'],
      ['::ffff:100.64.0.1', 'private'],
      // IPv6 ULA fc00::/7
      ['fc00::1', 'unique-local'],
      ['fd12:3456:789a::1', 'unique-local'],
      // unspecified / "this network"
      ['0.0.0.0', 'unspecified'],
      ['::', 'unspecified'],
      // IANA non-global IPv4 ranges
      ['224.0.0.1', 'reserved'], // multicast 224.0.0.0/4
      ['239.255.255.255', 'reserved'],
      ['240.0.0.1', 'reserved'], // reserved 240.0.0.0/4
      ['255.255.255.255', 'reserved'], // broadcast
      ['192.0.0.1', 'reserved'], // IETF protocol assignments 192.0.0.0/24
      ['192.0.2.1', 'reserved'], // documentation TEST-NET-1
      ['198.51.100.7', 'reserved'], // documentation TEST-NET-2
      ['203.0.113.9', 'reserved'], // documentation TEST-NET-3
      ['198.18.0.1', 'reserved'], // benchmarking 198.18.0.0/15
      ['198.19.255.255', 'reserved'],
      ['192.88.99.1', 'reserved'], // deprecated 6to4 anycast (RFC 7526)
      ['::ffff:224.0.0.1', 'reserved'], // embedded multicast
      ['ff02::1', 'reserved'], // IPv6 multicast ff00::/8
      ['2001:db8::1', 'reserved'], // IPv6 documentation 2001:db8::/32
      // remaining IANA non-global IPv6 ranges
      ['100::', 'reserved'], // discard-only 100::/64 (RFC 6666)
      ['100::1', 'reserved'],
      ['2001:2::1', 'reserved'], // benchmarking 2001:2::/48 (RFC 5180)
      ['2001:10::1', 'reserved'], // ORCHID 2001:10::/28 (deprecated)
      ['2001:20::1', 'reserved'], // ORCHIDv2 2001:20::/28 (RFC 7343)
      ['3fff::1', 'reserved'], // documentation 3fff::/20 (RFC 9637)
      ['5f00::1', 'reserved'], // SRv6 SIDs 5f00::/16 (RFC 9602)
      ['64:ff9b:1::1', 'reserved'], // local-use NAT64 64:ff9b:1::/48 (RFC 8215)
      // IPv4-mapped IPv6 forms of denied ranges
      ['::ffff:127.0.0.1', 'loopback'],
      ['::ffff:10.0.0.1', 'private'],
      ['::ffff:169.254.169.254', 'link-local'],
      ['::ffff:192.168.0.1', 'private'],
      ['::ffff:a00:1', 'private'], // hex spelling of ::ffff:10.0.0.1
      // IPv4-compatible IPv6 (::/96, deprecated RFC 4291) embedded forms
      ['::127.0.0.1', 'loopback'],
      ['::7f00:1', 'loopback'], // hex spelling of ::127.0.0.1
      ['::10.0.0.1', 'private'],
      ['::169.254.169.254', 'link-local'],
      // NAT64 (64:ff9b::/96, RFC 6052) embedded forms
      ['64:ff9b::127.0.0.1', 'loopback'],
      ['64:ff9b::7f00:1', 'loopback'],
      ['64:ff9b::a00:1', 'private'],
      ['64:ff9b::169.254.169.254', 'link-local'],
    ];

    it.each(denied)('denies %s as %s', (ip, reason) => {
      expect(getDeniedIpReason(ip)).toBe(reason);
    });
  });

  describe('allowed public addresses', () => {
    const allowed = [
      '93.184.216.34',
      '8.8.8.8',
      '172.15.255.255', // just below 172.16/12
      '172.32.0.1', // just above 172.16/12
      '169.253.255.255',
      '11.0.0.1',
      '100.63.255.255', // just below 100.64.0.0/10
      '100.128.0.1', // just above 100.64.0.0/10
      '2606:4700::1111',
      '2001:db7::1', // just below documentation 2001:db8::/32
      '2001:db9::1', // just above documentation 2001:db8::/32
      '2001:1::1', // PCP anycast — globally reachable, just below benchmarking 2001:2::/48
      '2001:3::1', // AMT — globally reachable, just above benchmarking
      '100:0:0:1::1', // just outside discard-only 100::/64
      '3fff:1000::1', // just outside documentation 3fff::/20
      '5eff::1', // just below SRv6 5f00::/16
      '6000::1', // just above SRv6 5f00::/16
      '223.255.255.255', // just below multicast 224.0.0.0/4
      '198.17.255.255', // just below benchmarking 198.18.0.0/15
      '198.20.0.1', // just above benchmarking 198.18.0.0/15
      '192.0.1.1', // just below TEST-NET-1
      '192.0.3.1', // just above TEST-NET-1
      '::ffff:8.8.8.8', // IPv4-mapped public stays allowed
      '64:ff9b::808:808', // NAT64 of public 8.8.8.8 stays allowed
      '64:ff9c::7f00:1', // outside 64:ff9b::/96, plain global unicast
      'fe00::1', // below fe80::/10
    ];

    it.each(allowed)('allows %s', (ip) => {
      expect(getDeniedIpReason(ip)).toBeNull();
    });
  });

  it('denies loopback unless allowLoopback opts in', () => {
    expect(getDeniedIpReason('127.0.0.1', { allowLoopback: true })).toBeNull();
    expect(getDeniedIpReason('::1', { allowLoopback: true })).toBeNull();
    expect(getDeniedIpReason('::ffff:127.0.0.1', { allowLoopback: true })).toBeNull();
    // Opt-in is loopback-only; other ranges stay denied.
    expect(getDeniedIpReason('10.0.0.1', { allowLoopback: true })).toBe('private');
  });

  it('fails closed on non-IP input', () => {
    expect(getDeniedIpReason('not-an-ip')).toBe('invalid');
    expect(getDeniedIpReason('')).toBe('invalid');
    expect(getDeniedIpReason('1.2.3.4.5')).toBe('invalid');
    expect(getDeniedIpReason('300.1.2.3')).toBe('invalid');
  });

  it('denies zone-scoped link-local literals', () => {
    expect(getDeniedIpReason('fe80::1%eth0')).toBe('link-local');
  });
});

describe('fail-closed IP parsers', () => {
  describe('parseIpv4Octets', () => {
    it('parses dotted quads', () => {
      expect(parseIpv4Octets('10.0.0.255')).toEqual([10, 0, 0, 255]);
    });

    it.each([
      '1.2.3', // too few parts
      '1.2.3.4.5', // too many parts
      '1.2.3.256', // octet out of range
      '1.2.3.x', // non-numeric
      '1.2.3.1000', // more than 3 digits
      '', // empty
    ])('returns null for %s', (input) => {
      expect(parseIpv4Octets(input)).toBeNull();
    });
  });

  describe('expandIpv6Groups', () => {
    it('expands full and compressed forms', () => {
      expect(expandIpv6Groups('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(expandIpv6Groups('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
      expect(expandIpv6Groups('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('strips zone identifiers', () => {
      expect(expandIpv6Groups('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    });

    it('folds dotted-quad tails into hex groups', () => {
      expect(expandIpv6Groups('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
    });

    it.each([
      '1::2::3', // more than one compression
      '1:2:3:4:5:6:7', // too few groups without compression
      '1:2:3:4:5:6:7:8:9', // too many groups
      '1:2:3:4:5:6::7:8:9', // compression with no room
      '::ffff:300.0.0.1', // invalid embedded IPv4
      '::ffff:1.2.3', // truncated embedded IPv4
      'g::1', // non-hex group
      '12345::1', // group too wide
      'not-an-ip',
    ])('returns null for %s', (input) => {
      expect(expandIpv6Groups(input)).toBeNull();
    });
  });
});

describe('assertSafeRemoteUrl', () => {
  it('rejects non-http(s) schemes before any resolution', async () => {
    const resolve = neverResolver();
    await expect(assertSafeRemoteUrl('ftp://example.com/mcp', { resolveHost: resolve }))
      .rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeRemoteUrl('file:///etc/passwd', { resolveHost: resolve }))
      .rejects.toThrow(UnsafeUrlError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects invalid URLs', async () => {
    await expect(assertSafeRemoteUrl('not a url')).rejects.toThrow();
  });

  describe('literal IP hostnames are checked without DNS', () => {
    const blockedLiterals = [
      'http://127.0.0.1:8080/mcp',
      'http://[::1]:8080/mcp',
      'http://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/mcp',
      'http://192.168.1.10/mcp',
      'http://[fd00::1]/mcp',
      'http://0.0.0.0/mcp',
      'http://[::ffff:127.0.0.1]/mcp',
    ];

    it.each(blockedLiterals)('blocks %s without resolving', async (url) => {
      const resolve = neverResolver();
      await expect(assertSafeRemoteUrl(url, { resolveHost: resolve })).rejects.toThrow(UnsafeUrlError);
      expect(resolve).not.toHaveBeenCalled();
    });

    it('allows a public literal IP and returns it as the vetted address', async () => {
      const resolve = neverResolver();
      const vetted = await assertSafeRemoteUrl('https://93.184.216.34/mcp', { resolveHost: resolve });
      expect(vetted.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  describe('hostname resolution', () => {
    it('blocks hostnames that resolve to a private IP', async () => {
      const resolve = resolverOf({ address: '10.1.2.3', family: 4 });
      await expect(assertSafeRemoteUrl('https://internal.example/mcp', { resolveHost: resolve }))
        .rejects.toThrow(/10\.1\.2\.3/);
    });

    it('blocks localhost-style hostnames that resolve to loopback', async () => {
      const resolve = resolverOf({ address: '127.0.0.1', family: 4 });
      await expect(assertSafeRemoteUrl('http://localhost:3000/mcp', { resolveHost: resolve }))
        .rejects.toThrow(UnsafeUrlError);
    });

    it('blocks when ANY record of a multi-A-record answer is private', async () => {
      const resolve = resolverOf(PUBLIC_V4, { address: '192.168.0.7', family: 4 });
      await expect(assertSafeRemoteUrl('https://mixed.example/mcp', { resolveHost: resolve }))
        .rejects.toThrow(UnsafeUrlError);
    });

    it('blocks hostnames that resolve to a denied IPv6 address', async () => {
      const resolve = resolverOf({ address: 'fd00::2', family: 6 });
      await expect(assertSafeRemoteUrl('https://ula.example/mcp', { resolveHost: resolve }))
        .rejects.toThrow(UnsafeUrlError);
    });

    it('allows hostnames resolving only to public addresses and returns the vetted set', async () => {
      const resolve = resolverOf(PUBLIC_V4, PUBLIC_V6);
      const vetted = await assertSafeRemoteUrl('https://mcp.example.com/mcp', { resolveHost: resolve });
      expect(vetted.hostname).toBe('mcp.example.com');
      expect(vetted.addresses).toEqual([PUBLIC_V4, PUBLIC_V6]);
      expect(vetted.url.href).toBe('https://mcp.example.com/mcp');
    });

    it('fails closed when resolution fails', async () => {
      const resolve: HostResolver = jest.fn(async () => {
        throw new Error('ENOTFOUND');
      });
      await expect(assertSafeRemoteUrl('https://nx.example/mcp', { resolveHost: resolve }))
        .rejects.toThrow(UnsafeUrlError);
    });

    it('fails closed when resolution returns no addresses', async () => {
      const resolve = resolverOf();
      await expect(assertSafeRemoteUrl('https://empty.example/mcp', { resolveHost: resolve }))
        .rejects.toThrow(UnsafeUrlError);
    });

    it('wraps non-Error resolver failures', async () => {
      const resolve: HostResolver = jest.fn(async () => {
        throw 'resolver exploded';
      });
      await expect(assertSafeRemoteUrl('https://odd.example/mcp', { resolveHost: resolve }))
        .rejects.toThrow(/resolver exploded/);
    });
  });

  it('permits loopback only with explicit allowLoopback opt-in', async () => {
    const vetted = await assertSafeRemoteUrl('http://127.0.0.1:3000/mcp', {
      resolveHost: neverResolver(),
      allowLoopback: true,
    });
    expect(vetted.addresses).toEqual([{ address: '127.0.0.1', family: 4 }]);
  });
});

describe('createPinnedLookup', () => {
  function callLookup(
    lookup: ReturnType<typeof createPinnedLookup>,
    hostname: string,
    options: { all?: boolean; family?: number },
  ): Promise<{ err: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }> {
    return new Promise((resolve) => {
      lookup(hostname, options as never, (err, address, family) => {
        resolve({ err, address: address as string | LookupAddress[], family });
      });
    });
  }

  const vetted = {
    url: new URL('https://mcp.example.com/mcp'),
    hostname: 'mcp.example.com',
    addresses: [PUBLIC_V4, PUBLIC_V6],
  };

  it('returns the vetted addresses for the pinned hostname WITHOUT re-resolving (rebinding defense)', async () => {
    // A rebinding attacker flips DNS to a private answer after preflight; the
    // pinned lookup must never consult DNS again for the vetted hostname.
    const rebindingResolver = resolverOf({ address: '169.254.169.254', family: 4 });
    const lookup = createPinnedLookup(vetted, { resolveHost: rebindingResolver });

    const single = await callLookup(lookup, 'mcp.example.com', {});
    expect(single.err).toBeNull();
    expect(single.address).toBe(PUBLIC_V4.address);
    expect(single.family).toBe(4);
    expect(rebindingResolver).not.toHaveBeenCalled();
  });

  it('supports all:true callbacks with the vetted address list', async () => {
    const lookup = createPinnedLookup(vetted, { resolveHost: neverResolver() });
    const result = await callLookup(lookup, 'mcp.example.com', { all: true });
    expect(result.err).toBeNull();
    expect(result.address).toEqual([PUBLIC_V4, PUBLIC_V6]);
  });

  it('filters by requested family', async () => {
    const lookup = createPinnedLookup(vetted, { resolveHost: neverResolver() });
    const v6 = await callLookup(lookup, 'mcp.example.com', { family: 6 });
    expect(v6.address).toBe(PUBLIC_V6.address);
    expect(v6.family).toBe(6);
  });

  it('accepts string family hints (IPv4/IPv6)', async () => {
    const lookup = createPinnedLookup(vetted, { resolveHost: neverResolver() });
    const v4 = await callLookup(lookup, 'mcp.example.com', { family: 'IPv4' as never });
    expect(v4.address).toBe(PUBLIC_V4.address);
    const v6 = await callLookup(lookup, 'mcp.example.com', { family: 'IPv6' as never });
    expect(v6.address).toBe(PUBLIC_V6.address);
  });

  it('matches the pinned hostname case-insensitively and with a trailing dot', async () => {
    const lookup = createPinnedLookup(vetted, { resolveHost: neverResolver() });
    const result = await callLookup(lookup, 'MCP.Example.COM.', {});
    expect(result.err).toBeNull();
    expect(result.address).toBe(PUBLIC_V4.address);
  });

  it('vets any non-pinned hostname and denies private answers', async () => {
    const resolve = resolverOf({ address: '10.9.8.7', family: 4 });
    const lookup = createPinnedLookup(vetted, { resolveHost: resolve });
    const result = await callLookup(lookup, 'other.example', {});
    expect(result.err).toBeInstanceOf(Error);
    expect(result.err?.message).toMatch(/10\.9\.8\.7/);
  });

  it('allows non-pinned hostnames that resolve public', async () => {
    const resolve = resolverOf({ address: '8.8.8.8', family: 4 });
    const lookup = createPinnedLookup(vetted, { resolveHost: resolve });
    const result = await callLookup(lookup, 'other.example', {});
    expect(result.err).toBeNull();
    expect(result.address).toBe('8.8.8.8');
  });

  it('errors when family filtering leaves no usable address', async () => {
    const v4Only = { ...vetted, addresses: [PUBLIC_V4] };
    const lookup = createPinnedLookup(v4Only, { resolveHost: neverResolver() });
    const result = await callLookup(lookup, 'mcp.example.com', { family: 6 });
    expect(result.err).toBeInstanceOf(Error);
  });

  it('errors when the vetted set is empty', async () => {
    const lookup = createPinnedLookup({ hostname: 'mcp.example.com', addresses: [] });
    const result = await callLookup(lookup, 'mcp.example.com', {});
    expect(result.err).toBeInstanceOf(Error);
  });

  it('works without an options argument and with undefined lookup options', async () => {
    const lookup = createPinnedLookup(vetted);
    const result = await callLookup(lookup, 'mcp.example.com', undefined as never);
    expect(result.err).toBeNull();
    expect(result.address).toBe(PUBLIC_V4.address);
  });

  it('reports a thrown non-Error from the success callback as an Error on the failure path', async () => {
    const lookup = createPinnedLookup(vetted, { resolveHost: neverResolver() });
    const calls: Array<{ err: NodeJS.ErrnoException | null }> = [];
    await new Promise<void>((resolve) => {
      lookup('mcp.example.com', {} as never, (err) => {
        calls.push({ err });
        if (calls.length === 1) {
          resolve();
          // Defensive double-call path: a callback that throws must surface as
          // an Error, never an unhandled rejection.
          throw 'callback exploded';
        }
      });
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(2);
    expect(calls[0].err).toBeNull();
    expect(calls[1].err).toBeInstanceOf(Error);
    expect(calls[1].err?.message).toMatch(/callback exploded/);
  });
});

describe('default host resolver (dns.lookup seam)', () => {
  type LookupCallback = (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void;

  afterEach(() => {
    mockDnsLookup.mockReset();
  });

  it('vets all OS-resolver answers and denies private ones', async () => {
    mockDnsLookup.mockImplementation((_hostname: string, _options: unknown, callback: LookupCallback) => {
      callback(null, [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]);
    });

    await expect(assertSafeRemoteUrl('https://rebind.example/mcp')).rejects.toThrow(/10\.0\.0\.1/);
    expect(mockDnsLookup).toHaveBeenCalledWith('rebind.example', { all: true }, expect.any(Function));
  });

  it('allows public answers from the OS resolver and drops unknown families', async () => {
    mockDnsLookup.mockImplementation((_hostname: string, _options: unknown, callback: LookupCallback) => {
      callback(null, [
        { address: '8.8.8.8', family: 4 },
        { address: 'weird', family: 0 as never },
      ]);
    });

    const vetted = await assertSafeRemoteUrl('https://public.example/mcp');
    expect(vetted.addresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });

  it('fails closed when the OS resolver errors', async () => {
    mockDnsLookup.mockImplementation((_hostname: string, _options: unknown, callback: LookupCallback) => {
      callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
    });

    await expect(assertSafeRemoteUrl('https://nx.example/mcp')).rejects.toThrow(UnsafeUrlError);
  });
});
