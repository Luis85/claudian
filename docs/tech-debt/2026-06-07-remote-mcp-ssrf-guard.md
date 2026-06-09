---
type: tech-debt
title: "Remote MCP connections lack an SSRF blocking guard"
date: 2026-06-07
updated: 2026-06-09
status: partially-shipped
priority: "1 - high"
severity: high
scope: mcp-security
tags:
  - tech-debt
  - security
  - mcp
  - ssrf
related:
  - "[[remote-mcp-ssrf-blocking-guard]]"
  - "[[unified-in-app-mcp-control-plane]]"
---

# Remote MCP connections lack an SSRF blocking guard

## Summary

The MCP tester resolves secrets and curates stdio environments, but URL-based MCP transports still connect directly to the configured URL without a private-address denylist or DNS-rebinding protection. A vault-supplied remote MCP server can make the plugin test path contact localhost, link-local, or private network services.

## Evidence

- `src/core/mcp/McpTester.ts` builds URL transports with `new URL(config.url)` and `StreamableHTTPClientTransport` / legacy SSE transport.
- `createNodeFetch()` uses Node `http`/`https.request` against the request URL directly.
- There is no denylist for loopback, RFC1918, link-local, IPv6 ULA, or cloud metadata ranges before socket open.
- There is no pinning of the connection to a vetted resolved IP, so a preflight-only check would be DNS-rebinding vulnerable if added naively.
- The issue [[remote-mcp-ssrf-blocking-guard]] remains open and already captures the desired control.

## Why it matters

MCP servers can be vault-defined and therefore untrusted. Testing a server is an outbound network action from the user's machine. SSRF controls need to block before connecting; a warning can be pre-accepted or ignored and does not protect private infrastructure.

## Suggested remediation

1. Add a URL safety module that resolves hosts and denies loopback, link-local, RFC1918, IPv6 ULA, and metadata IPs.
2. Pin HTTP(S) connections to the vetted IP with a custom lookup/agent or equivalent transport control.
3. Show provenance and destination host in the settings UI.
4. Treat remote MCP tool descriptions as untrusted text in the UI and prompt layer.
5. Unit-test denied ranges and DNS-rebinding behavior.

## Acceptance criteria

- [x] A Test action against `localhost`, `127.0.0.1`, `::1`, RFC1918, or `169.254.169.254` is refused before any socket opens.
- [x] A hostname that resolves public during preflight but private at connect time cannot bypass the guard.
- [ ] UI labels the server provenance and destination host.
- [ ] Tool descriptions from remote MCP are rendered/demarcated as untrusted content.

## Resolution (2026-06-09)

**Shipped (blocking, not warning):**

- New URL-safety module `src/core/security/urlSafety.ts`:
  - `getDeniedIpReason` classifies loopback (127/8, `::1`), link-local
    (169.254/16 incl. metadata, fe80::/10), RFC1918 (10/8, 172.16/12,
    192.168/16), RFC6598 shared/CGNAT (100.64/10), IPv6 ULA (fc00::/7),
    unspecified (0.0.0.0/8, `::`), IANA non-global ranges (multicast 224/4 +
    ff00::/8, reserved 240/4 incl. broadcast, benchmarking 198.18/15,
    documentation TEST-NET-1/2/3 + 2001:db8::/32, IETF 192.0.0/24, deprecated
    6to4 anycast 192.88.99/24), and
    embedded-IPv4 spellings of all of the above (IPv4-mapped `::ffff:0:0/96`,
    IPv4-compatible `::/96`, NAT64 `64:ff9b::/96`). Non-IP input fails closed.
  - `assertSafeRemoteUrl` preflights scheme (http/https only), checks literal
    IP hostnames without DNS (WHATWG URL canonicalizes decimal/octal/hex IPv4
    hosts first), resolves hostnames via injectable `dns.lookup` seam, and
    denies when **any** resolved record is in a denied range. Resolution
    failure fails closed.
  - `createPinnedLookup` is the DNS-rebinding (TOCTOU) defense: a
    `net.LookupFunction` that hands the socket the *preflight-vetted*
    addresses for the vetted hostname (never re-resolves it) and re-vets any
    other hostname inside the same lookup call.
- `src/core/mcp/McpTester.ts` wires both layers: `testMcpServer` refuses
  unsafe URLs before any transport/client is constructed, and
  `createNodeFetch({ lookup })` threads the pinned lookup into
  `http(s).request` so both the Streamable HTTP and legacy SSE transports
  (SDK ≥1.29 routes all requests through the custom `fetch`) dial only vetted
  IPs. Host header and TLS SNI/cert validation are untouched.
- Loopback is denied by default (per the acceptance criteria). The module
  exposes an `allowLoopback` opt-in for a future settings surface; stdio MCP
  servers are unaffected (the guard applies to URL transports only).
- Tests: `tests/unit/core/security/urlSafety.test.ts` (deny matrix per range
  family, literal-IP URLs, mocked-DNS private/multi-record cases, rebinding
  pin asserting no re-resolution), `tests/unit/core/mcp/McpTester.test.ts` and
  `tests/unit/core/mcp/createNodeFetch.test.ts` (refusal before transport
  construction; socket dials the pinned IP for the vetted hostname),
  `tests/integration/core/mcp/mcp.test.ts` (loopback refusal end-to-end).

**Residual (why partially-shipped):**

- UI provenance + destination-host display (criterion 3) and untrusted
  tool-description framing (criterion 4) are not implemented — UI work was out
  of scope for this hardening pass.
- No user-facing opt-in yet for developers running MCP servers on localhost;
  the `allowLoopback` option exists in the module but nothing sets it.
- The guard protects the plugin's own connection path (`McpTester`). Provider
  CLIs (Claude/Codex/etc.) open their own MCP connections at chat time outside
  the plugin process and cannot be pinned from here.
