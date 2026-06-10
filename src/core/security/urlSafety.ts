/**
 * SECURITY (SEC-D): SSRF guard for URL-based remote MCP transports.
 *
 * Remote MCP servers can be vault-defined and therefore untrusted. Connecting
 * to one is an outbound network action from the user's machine, so a
 * vault-supplied URL must not be able to reach loopback, link-local (incl.
 * cloud metadata 169.254.169.254), RFC1918/ULA private ranges, or the
 * unspecified address — including via IPv4-mapped IPv6 spellings.
 *
 * Two layers:
 *  1. `assertSafeRemoteUrl` — preflight: scheme check, literal-IP check
 *     without DNS, and full-answer DNS vetting (ANY private record denies).
 *  2. `createPinnedLookup` — DNS-rebinding (TOCTOU) defense: a Node
 *     `net.LookupFunction` that hands the socket the *preflight-vetted*
 *     addresses for the vetted hostname instead of re-resolving, so the IP
 *     that was checked is the IP that receives the connection. Any other
 *     hostname the transport dials is re-vetted inside the same lookup call.
 */
import type { LookupAddress, LookupOptions } from 'dns';
import { lookup as dnsLookup } from 'dns';
import type { LookupFunction } from 'net';
import { isIP } from 'net';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Injectable DNS resolution seam so the guard is unit-testable without network. */
export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface UrlSafetyOptions {
  resolveHost?: HostResolver;
  /**
   * Explicit opt-in for loopback targets (developers running MCP servers on
   * localhost). Default false: the Test path refuses loopback per the SSRF
   * guard docs. Loopback-only — every other denied range stays denied.
   */
  allowLoopback?: boolean;
}

export interface VettedRemoteUrl {
  url: URL;
  /** Normalized (lowercased, unbracketed, no trailing dot) hostname. */
  hostname: string;
  /** Addresses the connection is allowed to dial. */
  addresses: ResolvedAddress[];
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export type DeniedIpReason =
  | 'loopback'
  | 'link-local'
  | 'private'
  | 'unique-local'
  | 'unspecified'
  | 'reserved'
  | 'invalid';

const defaultResolveHost: HostResolver = (hostname) =>
  new Promise((resolve, reject) => {
    // dns.lookup (not dns.resolve) so /etc/hosts and OS resolver behavior match
    // what a direct socket connect would have used.
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(
        addresses
          .filter((entry) => entry.family === 4 || entry.family === 6)
          .map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 })),
      );
    });
  });

/** @internal exported for direct tests of the fail-closed parsing paths. */
export function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((value) => Number.isNaN(value) || value > 255)) return null;
  return octets as [number, number, number, number];
}

/** IANA special-purpose IPv4 denylist as [CIDR prefix octets, prefix length, reason]. */
const DENIED_IPV4_RANGES: Array<[[number, number, number, number], number, DeniedIpReason]> = [
  [[0, 0, 0, 0], 8, 'unspecified'], // "this network", incl. 0.0.0.0
  [[127, 0, 0, 0], 8, 'loopback'],
  [[10, 0, 0, 0], 8, 'private'],
  [[172, 16, 0, 0], 12, 'private'],
  [[192, 168, 0, 0], 16, 'private'],
  // RFC6598 shared address space (CGNAT) — not publicly routable and hosts
  // some cloud-provider metadata endpoints (e.g. 100.100.100.200).
  [[100, 64, 0, 0], 10, 'private'],
  [[169, 254, 0, 0], 16, 'link-local'], // incl. metadata 169.254.169.254
  // Remaining IANA non-global ranges: an HTTP(S) MCP endpoint can never
  // legitimately live here, so deny rather than assume "not RFC1918" is routable.
  [[224, 0, 0, 0], 3, 'reserved'], // 224/4 multicast + 240/4 reserved incl. broadcast
  [[192, 0, 0, 0], 24, 'reserved'], // IETF protocol assignments
  [[192, 0, 2, 0], 24, 'reserved'], // documentation TEST-NET-1
  [[192, 88, 99, 0], 24, 'reserved'], // deprecated 6to4 anycast (RFC 7526)
  [[198, 18, 0, 0], 15, 'reserved'], // benchmarking
  [[198, 51, 100, 0], 24, 'reserved'], // documentation TEST-NET-2
  [[203, 0, 113, 0], 24, 'reserved'], // documentation TEST-NET-3
];

function ipv4ToInt(octets: [number, number, number, number]): number {
  // >>> 0 keeps the value an unsigned 32-bit int (<< yields signed).
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function deniedIpv4Reason(octets: [number, number, number, number]): DeniedIpReason | null {
  const value = ipv4ToInt(octets);
  for (const [prefix, bits, reason] of DENIED_IPV4_RANGES) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((value & mask) >>> 0 === ipv4ToInt(prefix)) return reason;
  }
  return null;
}

/**
 * Expand an IPv6 literal to its 8 16-bit groups. Returns null when unparseable.
 * @internal exported for direct tests of the fail-closed parsing paths.
 */
export function expandIpv6Groups(input: string): number[] | null {
  let ip = input;
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex !== -1) ip = ip.slice(0, zoneIndex);

  // Fold a dotted-quad tail (e.g. ::ffff:127.0.0.1) into two hex groups.
  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':');
    const v4 = parseIpv4Octets(ip.slice(lastColon + 1));
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (missing < 0) return null;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (groups.length !== 8) return null;

  const values = groups.map((group) => (/^[0-9a-fA-F]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  if (values.some((value) => Number.isNaN(value))) return null;
  return values;
}

/**
 * IANA special-purpose IPv6 denylist as [prefix literal, prefix length, reason].
 * Embedded-IPv4 forms (mapped/compatible/NAT64) are classified separately so
 * they inherit the IPv4 denylist instead of needing rows here.
 */
const DENIED_IPV6_RANGES: Array<[number[], number, DeniedIpReason]> = (
  [
    ['fe80::', 10, 'link-local'],
    ['fc00::', 7, 'unique-local'],
    ['ff00::', 8, 'reserved'], // multicast
    ['2001:db8::', 32, 'reserved'], // documentation
    ['100::', 64, 'reserved'], // discard-only (RFC 6666)
    ['2001:2::', 48, 'reserved'], // benchmarking (RFC 5180)
    ['2001:10::', 28, 'reserved'], // ORCHID (deprecated)
    ['2001:20::', 28, 'reserved'], // ORCHIDv2 (RFC 7343)
    ['3fff::', 20, 'reserved'], // documentation (RFC 9637)
    ['5f00::', 16, 'reserved'], // SRv6 SIDs (RFC 9602)
    ['64:ff9b:1::', 48, 'reserved'], // local-use NAT64 (RFC 8215)
  ] as Array<[string, number, DeniedIpReason]>
).map(([prefix, bits, reason]) => {
  const groups = expandIpv6Groups(prefix);
  if (!groups) throw new Error(`Invalid IPv6 denylist prefix: ${prefix}`);
  return [groups, bits, reason];
});

function ipv6MatchesPrefix(groups: number[], prefixGroups: number[], bits: number): boolean {
  let remaining = bits;
  for (let i = 0; i < 8 && remaining > 0; i++) {
    const take = Math.min(16, remaining);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if ((groups[i] & mask) !== (prefixGroups[i] & mask)) return false;
    remaining -= take;
  }
  return true;
}

/**
 * Extract the low 32 bits as IPv4 octets for the prefixes that embed an IPv4
 * address — IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96, deprecated
 * RFC 4291), and NAT64 (64:ff9b::/96, RFC 6052) — so e.g. ::ffff:127.0.0.1,
 * ::127.0.0.1, or 64:ff9b::7f00:1 cannot sidestep the IPv4 denylist. `::` and
 * `::1` are excluded: they classify as unspecified/loopback, not as embedded
 * 0.0.0.0/0.0.0.1.
 */
function embeddedIpv4Octets(groups: number[]): [number, number, number, number] | null {
  const low: [number, number, number, number] = [
    groups[6] >> 8,
    groups[6] & 0xff,
    groups[7] >> 8,
    groups[7] & 0xff,
  ];
  if (!groups.slice(0, 5).every((value) => value === 0)) {
    const nat64 =
      groups[0] === 0x0064 && groups[1] === 0xff9b &&
      groups.slice(2, 6).every((value) => value === 0);
    return nat64 ? low : null;
  }
  if (groups[5] === 0xffff) return low; // IPv4-mapped
  if (groups[5] !== 0) return null;
  // IPv4-compatible — but :: and ::1 classify as unspecified/loopback instead.
  return groups[6] !== 0 || groups[7] > 1 ? low : null;
}

function deniedIpv6Reason(ip: string): DeniedIpReason | null {
  const groups = expandIpv6Groups(ip);
  if (!groups) return 'invalid'; // fail closed on anything we cannot parse

  const embedded = embeddedIpv4Octets(groups);
  if (embedded) return deniedIpv4Reason(embedded);

  const firstSevenZero = groups.slice(0, 7).every((value) => value === 0);
  if (firstSevenZero && groups[7] === 0) return 'unspecified'; // ::
  if (firstSevenZero && groups[7] === 1) return 'loopback'; // ::1

  for (const [prefixGroups, bits, reason] of DENIED_IPV6_RANGES) {
    if (ipv6MatchesPrefix(groups, prefixGroups, bits)) return reason;
  }
  return null;
}

/**
 * Classify an IP literal against the SSRF denylist. Returns the deny reason or
 * null when the address is publicly routable. Non-IP input fails closed
 * ('invalid') — resolve hostnames before calling.
 */
export function getDeniedIpReason(
  ip: string,
  options?: Pick<UrlSafetyOptions, 'allowLoopback'>,
): DeniedIpReason | null {
  // IPv4 first; everything else goes through the IPv6 parser, which fails
  // closed ('invalid') on input that is not an IP literal.
  const octets = parseIpv4Octets(ip);
  const reason = octets ? deniedIpv4Reason(octets) : deniedIpv6Reason(ip);
  if (reason === 'loopback' && options?.allowLoopback) return null;
  return reason;
}

function normalizeHostname(hostname: string): string {
  let normalized = hostname.toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.endsWith('.') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function denialMessage(host: string, address: string, reason: DeniedIpReason): string {
  const detail = host === address ? address : `${host} → ${address}`;
  return `Blocked for safety: ${detail} is a ${reason} address. Remote MCP servers must resolve to public addresses.`;
}

async function resolveAndVet(
  hostname: string,
  options: UrlSafetyOptions,
): Promise<ResolvedAddress[]> {
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveHost(hostname);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UnsafeUrlError(`Could not resolve host "${hostname}": ${detail}`);
  }
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Could not resolve host "${hostname}": no addresses returned`);
  }
  // ANY private record denies — a multi-A-record answer mixing public and
  // private addresses is a classic rebinding/SSRF setup.
  for (const entry of addresses) {
    const reason = getDeniedIpReason(entry.address, options);
    if (reason) {
      throw new UnsafeUrlError(denialMessage(hostname, entry.address, reason));
    }
  }
  return addresses;
}

/**
 * Preflight SSRF guard. Throws `UnsafeUrlError` (or a URL parse error) before
 * any socket opens when the URL scheme is not http(s), the hostname is a
 * denied IP literal, or DNS resolution fails / returns any denied address.
 */
export async function assertSafeRemoteUrl(
  rawUrl: string,
  options: UrlSafetyOptions = {},
): Promise<VettedRemoteUrl> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError(`Unsupported URL scheme "${url.protocol}" — remote MCP servers must use http:// or https://.`);
  }

  // WHATWG URL guarantees a non-empty host for http(s) and canonicalizes
  // exotic IPv4 spellings (decimal/octal/hex) to dotted-quad, so the literal
  // check below cannot be dodged with `http://2130706433/`-style hosts.
  const hostname = normalizeHostname(url.hostname);
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    // Literal IPs are checked directly — no DNS round-trip to spoof.
    const reason = getDeniedIpReason(hostname, options);
    if (reason) {
      throw new UnsafeUrlError(denialMessage(hostname, hostname, reason));
    }
    return { url, hostname, addresses: [{ address: hostname, family: literalFamily }] };
  }

  const addresses = await resolveAndVet(hostname, options);
  return { url, hostname, addresses };
}

/**
 * Build a Node `lookup` for the HTTP(S) request path that pins the vetted
 * hostname to its preflight-vetted addresses (no re-resolution → no rebinding
 * window) and re-vets any other hostname inside the same call, so the address
 * handed to `net.Socket` is always one that passed the denylist.
 */
export function createPinnedLookup(
  vetted: Pick<VettedRemoteUrl, 'hostname' | 'addresses'>,
  options: UrlSafetyOptions = {},
): LookupFunction {
  return (hostname, lookupOptions, callback) => {
    void (async (): Promise<void> => {
      const requested = normalizeHostname(hostname);
      const addresses = requested === vetted.hostname
        ? vetted.addresses
        : await resolveAndVet(requested, options);

      const requestedFamily = readRequestedFamily(lookupOptions);
      const usable = requestedFamily
        ? addresses.filter((entry) => entry.family === requestedFamily)
        : addresses;
      if (usable.length === 0) {
        throw new UnsafeUrlError(`No vetted IPv${requestedFamily ?? '?'} address available for "${requested}".`);
      }

      if (lookupOptions && (lookupOptions as LookupOptions).all) {
        const all: LookupAddress[] = usable.map((entry) => ({ address: entry.address, family: entry.family }));
        callback(null, all);
      } else {
        callback(null, usable[0].address, usable[0].family);
      }
    })().catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      callback(err, '', undefined);
    });
  };
}

function readRequestedFamily(lookupOptions: LookupOptions | undefined): 4 | 6 | undefined {
  const family = lookupOptions?.family;
  if (family === 4 || family === 6) return family;
  if (family === 'IPv4') return 4;
  if (family === 'IPv6') return 6;
  return undefined;
}
