---
type: issue
id: issue-20260603-remote-mcp-ssrf
title: Block SSRF for remote MCP before connecting + add transport hygiene (provenance, untrusted descriptions)
status: partially-shipped
priority: 2 - normal
triage: ready-for-agent
created: 2026-06-03
updated: 2026-06-09
owner: Claudian
source: "[[2026-06-03-comprehensive-improvement-proposal]] (SEC-D)"
scope: mcp-transport-safety
tags:
  - security
  - mcp
  - ssrf
---

# Remote-MCP SSRF blocking guard + transport hygiene

## Problem

Remote (SSE/HTTP) MCP servers are connected with **no SSRF guard**: `McpTester` hands vault-supplied URLs
directly to `new URL(...)` and the SDK transport with a custom Node fetch. Pressing **Test** on a
vault-supplied URL server can make the user's machine contact `169.254.169.254` (cloud metadata),
localhost, or other private services. There are also no provenance/risk labels, no plaintext-`http://`
warning, and tool descriptions are treated as fully trusted.

## Evidence

- `src/core/mcp/McpTester.ts:50-113` (raw `http`/`https` fetch, no host allow/deny), `:253` (`new URL`, no scheme/host check).
- MCP UI files: no warning/provenance/risk surfaces.

## Proposed change (block, don't just warn)

A warning a malicious vault can pre-acknowledge is not a control. **Before opening the socket** in
`McpTester`/the SDK transport:

- Resolve the target host and **deny** link-local (`169.254.0.0/16`, incl. metadata `169.254.169.254`),
  loopback, RFC1918/IPv6-ULA private ranges, and internal-only hosts.
- **Pin the connection to the vetted IP** — a preflight resolve + separate connect is *still*
  DNS-rebinding-vulnerable (TOCTOU): Node/the MCP SDK's `http.request` performs its **own** lookup when it
  opens the socket, so a hostname can pass the guard with a public answer and then rebind to a private
  address for the real connection. Enforce the vetted IP via a custom `lookup` on the agent/transport (or
  connect directly to the checked IP while preserving `Host`/SNI), so the IP that was checked is the IP that
  receives the socket.
- This deny is mandatory for vault-provenance servers.

Then layer UX on top: non-loopback `http://` warning, destination host + provenance (vault vs user-added),
untrusted-tool-description framing.

## Acceptance criteria

- A Test against a link-local/loopback/private host is **refused before any socket opens** (with a clear message).
- Provenance + destination host shown in the enable/test UI; tool descriptions rendered as untrusted.
- Unit tests cover the deny ranges incl. a DNS-rebinding (hostname→private IP) case, asserting the socket
  connects to the **vetted** IP (not a re-resolved one).
- **Not done while the Test path can still reach private services.**

## Resolution (2026-06-09)

**Shipped — the blocking control:**

- `src/core/security/urlSafety.ts` (new): `assertSafeRemoteUrl` preflight
  (http/https-only scheme check; literal-IP hostnames classified without DNS;
  DNS answers vetted in full — ANY private record denies; resolution failure
  fails closed) over a denylist covering loopback (127/8, `::1`), link-local
  (169.254/16 incl. `169.254.169.254`, fe80::/10), RFC1918, IPv6 ULA
  (fc00::/7), unspecified (0.0.0.0/8, `::`), and IPv4-mapped IPv6 forms.
- **Rebinding pin implemented**: `createPinnedLookup` returns a custom
  `net.LookupFunction` passed through `createNodeFetch({ lookup })` into
  `http(s).request`, so the socket receives the preflight-vetted addresses for
  the vetted hostname — it is never re-resolved (no TOCTOU window). Any other
  hostname the transport dials is vetted inside the same lookup call.
  `Host`/SNI/cert validation keep using the hostname; only address resolution
  is constrained. The MCP SDK (1.29.0) routes all Streamable HTTP and legacy
  SSE requests through the provided `fetch`, so both transports are covered.
- `McpTester.testMcpServer` refuses unsafe URLs before any transport or client
  object is constructed, with a clear `Blocked for safety: …` message. The
  deny applies to all URL-based servers regardless of provenance (stdio
  servers are untouched). Loopback is denied by default; the module's
  `allowLoopback` option is reserved for a future explicit user opt-in.
- Tests: deny-range matrix per family, literal-IP URLs, mocked-DNS
  hostname→private and mixed multi-A-record cases, fail-closed resolution, and
  a socket-level pin test (`createNodeFetch.test.ts`) asserting the connection
  reaches the vetted IP for a hostname real DNS would not resolve there.

**Residual (why partially-shipped, not done):**

- Transport-hygiene UX: provenance (vault vs user-added) + destination-host
  labels, non-loopback `http://` warning, and untrusted-tool-description
  framing are not implemented in the MCP settings UI.
- No settings surface yet wires `allowLoopback` for localhost MCP developers.
- Scope: the guard covers the plugin's own Test/connection path. Provider CLI
  subprocesses establish their own MCP connections and are out of reach here.
